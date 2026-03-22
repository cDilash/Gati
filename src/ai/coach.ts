/**
 * AI Coach Chat — conversational coaching powered by Gemini.
 *
 * Every message includes fresh training context. The coach can suggest
 * plan modifications returned as structured JSON alongside the text response.
 */

import { sendChatMessage, extractJSON, isGeminiAvailable } from './gemini';
import {
  UserProfile,
  PaceZones,
  Workout,
  TrainingWeek,
  PerformanceMetric,
  CoachMessage,
  Shoe,
  RecoveryStatus,
  HealthSnapshot,
} from '../types';
import { formatPace, formatTime, predictMarathonTime } from '../engine/vdot';
import { formatPaceRange, calculateHRZones } from '../engine/paceZones';
import { getUnits } from '../hooks/useUnits';
import {
  formatDistance,
  formatWeightKg,
  formatHeight,
  formatElevation,
  formatPaceWithUnit,
  paceLabel,
  paceSuffix,
  distanceLabel,
  distanceLabelFull,
  formatVolume,
} from '../utils/units';

// ─── Types ──────────────────────────────────────────────────

export interface CoachResponse {
  message: string;
  planChange: PlanChangeRequest | null;
}

export interface PlanChangeRequest {
  type: 'adapt_plan' | 'modify_workout' | 'skip_workout';
  description: string;
  reason: string;
  workoutId?: string;
  changes?: Record<string, any>;
}

// ─── System Prompt Builder ──────────────────────────────────

export async function buildCoachSystemPrompt(
  profile: UserProfile,
  paceZones: PaceZones,
  currentWeek: TrainingWeek | null,
  weekWorkouts: Workout[],
  todaysWorkout: Workout | null,
  recentMetrics: PerformanceMetric[],
  weeks: TrainingWeek[],
  allWorkouts: Workout[],
  shoes: Shoe[],
  daysUntilRace: number,
  isRaceWeek: boolean,
  recoveryStatus?: RecoveryStatus | null,
  healthSnapshot?: HealthSnapshot | null,
  garminHealth?: import('../types').GarminHealthData | null,
): Promise<string> {
  const units = getUnits();
  const dLabel = distanceLabel(units);
  const dLabelFull = distanceLabelFull(units);
  const pLabel = paceLabel(units);
  const parts: string[] = [];

  parts.push(`You are an expert marathon running coach guiding this athlete through their training.
You follow Jack Daniels' methodology and the 80/20 polarized training approach.
Be concise, direct, encouraging, and specific. Reference actual data, not generic advice.
Keep responses to 2-4 paragraphs max unless the athlete asks for detailed analysis.
Always use ${dLabelFull} for distances, ${pLabel} for paces, and ${units === 'metric' ? 'kg' : 'lbs'} for weight.`);
  parts.push('');

  // Profile
  parts.push('ATHLETE PROFILE:');
  // VDOT with confidence context
  const vdotAge = profile.vdot_updated_at ? Math.floor((Date.now() - new Date(profile.vdot_updated_at + 'T00:00:00').getTime()) / 86400000) : null;
  const vdotStale = vdotAge !== null && vdotAge > 56; // 8 weeks
  const vdotConf = vdotStale ? 'low' : (profile.vdot_confidence ?? 'moderate');
  const vdotSourceLabel = profile.vdot_source === 'strava_race' ? 'from Strava race'
    : profile.vdot_source === 'strava_best_effort' ? 'from Strava best effort'
    : 'manual entry';
  const vdotAgeLabel = vdotAge !== null ? `${vdotAge} days ago` : 'unknown date';
  parts.push(`- Age: ${profile.age}, Gender: ${profile.gender}`);
  parts.push(`- VDOT: ${profile.vdot_score} (${vdotConf} confidence, ${vdotSourceLabel}, ${vdotAgeLabel})${vdotStale ? ' ⚠️ STALE — may be outdated' : ''}`);
  if (profile.height_cm && profile.weight_kg) {
    const heightM = profile.height_cm / 100;
    const bmi = Math.round((profile.weight_kg / (heightM * heightM)) * 10) / 10;
    parts.push(`- Height: ${formatHeight(profile.height_cm, units)}, Weight: ${formatWeightKg(profile.weight_kg, units)}, BMI: ${bmi}`);
    if (bmi > 30) parts.push(`- NOTE: Elevated BMI — favor time-based long run targets, add extra recovery, be conservative with volume`);
  } else if (profile.weight_kg) {
    parts.push(`- Weight: ${formatWeightKg(profile.weight_kg, units)}`);
  }
  if (profile.max_hr) {
    const source = (profile as any).max_hr_source === 'strava' ? 'observed from Strava' : 'formula estimate';
    parts.push(`- Max HR: ${profile.max_hr}bpm (${source})${profile.rest_hr ? `, Resting HR: ${profile.rest_hr}bpm` : ''}`);
  }
  // HR zones (Karvonen) — if both max and resting HR available
  if (profile.max_hr && profile.rest_hr) {
    const hrz = calculateHRZones(profile.max_hr, profile.rest_hr);
    parts.push(`- HR Zones: Z1 ${hrz.zone1.min}-${hrz.zone1.max} | Z2 ${hrz.zone2.min}-${hrz.zone2.max} | Z3 ${hrz.zone3.min}-${hrz.zone3.max} | Z4 ${hrz.zone4.min}-${hrz.zone4.max} | Z5 ${hrz.zone5.min}-${hrz.zone5.max} bpm`);
  }
  parts.push(`- Experience: ${profile.experience_level}`);
  parts.push(`- Race: ${profile.race_name || 'Marathon'} on ${profile.race_date} (${daysUntilRace} days away)`);
  if (profile.race_course_profile !== 'unknown') parts.push(`- Course: ${profile.race_course_profile}`);
  if (profile.target_finish_time_sec) parts.push(`- Goal time: ${formatTime(profile.target_finish_time_sec)}`);
  parts.push(`- Predicted marathon: ${formatTime(predictMarathonTime(profile.vdot_score))}`);
  // Check for flagged weight change
  try {
    const { getSetting, setSetting } = require('../db/database');
    const weightFlag = getSetting('weight_change_flag');
    if (weightFlag) {
      parts.push(`- ⚠️ WEIGHT CHANGE THIS WEEK: ${weightFlag}kg. Ask if this is accurate. Rapid changes affect performance.`);
      setSetting('weight_change_flag', ''); // Clear after surfacing
    }
  } catch {}
  if (profile.injury_history.length > 0) parts.push(`- Injury history: ${profile.injury_history.join(', ')}`);
  if (profile.known_weaknesses.length > 0) parts.push(`- Weaknesses: ${profile.known_weaknesses.join(', ')}`);
  if (profile.scheduling_notes) parts.push(`- Schedule: ${profile.scheduling_notes}`);
  parts.push('');

  // Pace zones
  parts.push(`PACE ZONES (${pLabel}):`);
  if (units === 'metric') {
    // Convert pace ranges to min/km for display
    const fmtRange = (range: { min: number; max: number }) =>
      `${formatPaceWithUnit(range.min, units)}-${formatPaceWithUnit(range.max, units)}`;
    parts.push(`  E: ${fmtRange(paceZones.E)} | M: ${fmtRange(paceZones.M)} | T: ${fmtRange(paceZones.T)} | I: ${fmtRange(paceZones.I)} | R: ${fmtRange(paceZones.R)}`);
  } else {
    parts.push(`  E: ${formatPaceRange(paceZones.E)} | M: ${formatPaceRange(paceZones.M)} | T: ${formatPaceRange(paceZones.T)} | I: ${formatPaceRange(paceZones.I)} | R: ${formatPaceRange(paceZones.R)}`);
  }
  parts.push('');

  // Current week
  if (currentWeek) {
    parts.push(`CURRENT WEEK: ${currentWeek.week_number} of ${weeks.length} — ${currentWeek.phase} phase${currentWeek.is_cutback ? ' (cutback)' : ''}`);
    parts.push(`Volume: ${formatDistance(currentWeek.actual_volume, units)} of ${formatDistance(currentWeek.target_volume, units)} completed`);

    const scheduled = weekWorkouts.filter(w => w.workout_type !== 'rest');
    for (const w of scheduled) {
      let status = w.status === 'completed' ? 'DONE' : w.status === 'skipped' ? 'SKIP' : w.status === 'partial' ? 'PARTIAL' : 'TODO';
      if (w.execution_quality && w.execution_quality !== 'on_target' && (w.status === 'completed' || w.status === 'partial')) {
        const qualityLabel = w.execution_quality === 'missed_pace' ? ' ⚠️ pace missed' : w.execution_quality === 'exceeded_pace' ? ' ⚠️ too fast' : w.execution_quality === 'wrong_type' ? ' ⚠️ wrong workout' : '';
        status += qualityLabel;
      }
      parts.push(`  [${status}] ${w.scheduled_date}: ${w.title} — ${formatDistance(w.target_distance_miles ?? 0, units)}`);
    }
    parts.push('');
  }

  // Today
  if (todaysWorkout) {
    if (todaysWorkout.workout_type === 'rest') {
      parts.push('TODAY: Rest day');
    } else {
      parts.push(`TODAY: ${todaysWorkout.title} — ${formatDistance(todaysWorkout.target_distance_miles ?? 0, units)} at ${todaysWorkout.target_pace_zone || todaysWorkout.workout_type} pace`);
      parts.push(`  ${todaysWorkout.description}`);
    }
    parts.push('');
  }

  // Recent performance (last 7 days) — enriched with splits, elevation, cadence
  if (recentMetrics.length > 0) {
    // Fetch strava detail for enrichment
    let detailMap = new Map<number, any>();
    try {
      const { getDatabase } = require('../db/database');
      const details = getDatabase().getAllSync(
        `SELECT strava_activity_id, elevation_gain_ft, cadence_avg, suffer_score, splits_json, hr_stream_json
         FROM strava_activity_detail WHERE strava_activity_id IN (${recentMetrics.filter(m => m.strava_activity_id).map(m => m.strava_activity_id).join(',') || '0'})`
      );
      for (const d of details) detailMap.set(d.strava_activity_id, d);
    } catch {}

    // Fetch Garmin per-activity data for enrichment (5s timeout to prevent hang)
    let garminActivityMap = new Map<string, any>();
    try {
      console.log('[Coach:prompt] Fetching Garmin activity data from Supabase...');
      const { supabase } = require('../backup/supabase');
      const dates = recentMetrics.map(m => m.date);
      const garminPromise = supabase
        .from('garmin_activity_data')
        .select('*')
        .in('activity_date', dates);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Supabase timeout')), 5000)
      );
      const { data: gActs } = await Promise.race([garminPromise, timeout]) as any;
      console.log('[Coach:prompt] Garmin activity data:', gActs?.length ?? 0, 'rows');
      if (gActs) for (const ga of gActs) garminActivityMap.set(ga.activity_date, ga);
    } catch (e: any) {
      console.log('[Coach:prompt] Garmin activity fetch failed:', e?.message || e);
    }

    parts.push('RECENT RUNS (last 7 days):');
    for (let mi = 0; mi < Math.min(recentMetrics.length, 5); mi++) {
      const m = recentMetrics[mi];
      const pace = m.avg_pace_sec_per_mile ? formatPaceWithUnit(m.avg_pace_sec_per_mile, units) : '?';
      const hr = m.avg_hr ? ` HR:${m.avg_hr}` : '';
      const rpe = m.perceived_exertion ? ` RPE:${m.perceived_exertion}` : '';
      const gear = m.gear_name ? ` [${m.gear_name}]` : '';

      // Enrichments from strava detail
      const detail = m.strava_activity_id ? detailMap.get(m.strava_activity_id) : null;
      const elev = detail?.elevation_gain_ft ? ` +${formatElevation(detail.elevation_gain_ft, units)}` : '';
      const cadence = detail?.cadence_avg ? ` ${Math.round(detail.cadence_avg * 2)}spm` : '';
      const suffer = detail?.suffer_score ? ` effort:${detail.suffer_score}` : '';

      parts.push(`  ${m.date}: ${formatDistance(m.distance_miles, units)} @ ${pace}${paceSuffix(units)}${hr}${rpe}${elev}${cadence}${suffer}${gear}`);

      // Garmin per-activity enrichment
      const ga = garminActivityMap.get(m.date);
      if (ga) {
        const teParts: string[] = [];
        if (ga.aerobic_training_effect != null) {
          const msg = (ga.aerobic_te_message || '').replace(/_\d+$/, '').replace(/_/g, ' ').toLowerCase();
          teParts.push(`TE ${ga.aerobic_training_effect} aerobic (${msg})`);
        }
        if (ga.stamina_start != null && ga.stamina_end != null) {
          teParts.push(`Stamina ${ga.stamina_start}→${ga.stamina_end}%`);
        }
        if (ga.activity_training_load != null) teParts.push(`Load ${ga.activity_training_load}`);
        if (ga.temperature_avg_c != null) {
          const tempF = Math.round(ga.temperature_avg_c * 9 / 5 + 32);
          teParts.push(`${ga.temperature_avg_c}°C/${tempF}°F`);
        }
        if (ga.grade_adjusted_speed != null && ga.grade_adjusted_speed > 0) {
          const gapSec = Math.round(1609.344 / ga.grade_adjusted_speed);
          teParts.push(`GAP ${formatPaceWithUnit(gapSec, units)}${paceSuffix(units)}`);
        }
        if (teParts.length > 0) {
          parts.push(`    Garmin: ${teParts.join(', ')}`);
        }
      }

      // Per-mile splits for the last 3 runs (most valuable coaching data)
      if (mi < 3) {
        const splitsSource = detail?.splits_json || m.splits_json;
        if (splitsSource) {
          try {
            const splits = JSON.parse(splitsSource);
            if (splits.length >= 2) {
              const splitPaces = splits.map((sp: any) => {
                let secPerMile: number | null = null;
                if (sp.averageSpeed && sp.averageSpeed > 0) {
                  secPerMile = Math.round(1609.344 / sp.averageSpeed);
                } else if (sp.movingTime && sp.distance) {
                  secPerMile = Math.round((sp.movingTime / sp.distance) * 1609.344);
                }
                return secPerMile ? formatPaceWithUnit(secPerMile, units) : '?';
              });
              parts.push(`    Splits: ${splitPaces.join(' | ')}`);
            }
          } catch {}
        }

        // HR drift detection for runs 8+ miles
        if (mi < 3 && m.distance_miles >= 8 && detail?.hr_stream_json) {
          try {
            const hrStream: number[] = JSON.parse(detail.hr_stream_json);
            if (hrStream.length >= 20) {
              const q = Math.floor(hrStream.length / 4);
              const firstQ = Math.round(hrStream.slice(0, q).reduce((s: number, v: number) => s + v, 0) / q);
              const lastQ = Math.round(hrStream.slice(-q).reduce((s: number, v: number) => s + v, 0) / q);
              const drift = lastQ - firstQ;
              if (drift >= 15) {
                parts.push(`    ⚠️ HR DRIFT: ${firstQ} → ${lastQ} bpm (+${drift}) — likely dehydration/overheating`);
              } else if (drift >= 10) {
                parts.push(`    HR drift: ${firstQ} → ${lastQ} bpm (+${drift}) — mild, normal for distance`);
              }
            }
          } catch {}
        }
      }
    }
    parts.push('');
  }

  // Personal records from all-time bests
  try {
    const { computeAllTimePRs, formatPRTime } = require('../utils/personalRecords');
    const allTimePRs = computeAllTimePRs();
    if (allTimePRs.length > 0) {
      const prLines = allTimePRs.map((pr: any) => `${pr.distance}: ${formatPRTime(pr.timeSeconds)} (${pr.date})`);
      parts.push('PERSONAL RECORDS (all-time bests from Strava):');
      parts.push(`  ${prLines.join(' | ')}`);
      parts.push('');
    }
  } catch {}

  // Flag runs on rest days
  try {
    const { getDatabase: getDb } = require('../db/database');
    const restDayRuns = getDb().getAllSync(
      `SELECT pm.date, pm.distance_miles
       FROM performance_metric pm
       JOIN workout w ON w.scheduled_date = pm.date AND w.workout_type = 'rest'
       JOIN training_plan tp ON w.plan_id = tp.id
       WHERE tp.status = 'active'
       AND pm.date >= ?
       AND pm.workout_id IS NULL`,
      require('../utils/dateUtils').addDaysToDate(require('../utils/dateUtils').getToday(), -14)
    );
    if (restDayRuns.length > 0) {
      parts.push('REST DAY ACTIVITY:');
      for (const r of restDayRuns) {
        parts.push(`  ⚠️ ${(r as any).date}: ran ${formatDistance((r as any).distance_miles, units)} on a scheduled rest day`);
      }
      parts.push('');
    }
  } catch {}

  // Volume trend (last 4 weeks)
  if (weeks.length > 0) {
    const recentWeeks = weeks.slice(-4);
    parts.push('VOLUME TREND:');
    for (const w of recentWeeks) {
      const pct = w.target_volume > 0 ? Math.round((w.actual_volume / w.target_volume) * 100) : 0;
      parts.push(`  Week ${w.week_number}: ${formatDistance(w.actual_volume, units)}/${formatDistance(w.target_volume, units)} (${pct}%)${w.is_cutback ? ' CB' : ''}`);
    }
    const adherence = recentWeeks.reduce((sum, w) => {
      const completed = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.status === 'completed').length;
      const total = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.workout_type !== 'rest').length;
      return sum + (total > 0 ? completed / total : 1);
    }, 0) / recentWeeks.length;
    parts.push(`  Adherence: ${Math.round(adherence * 100)}%`);
    parts.push('');
  }

  // Training load (PMC) if available
  try {
    const store = require('../store').useAppStore;
    const pmcData = store.getState().pmcData;
    if (pmcData && pmcData.totalDays >= 7) {
      const { detectTrainingPhase } = require('../components/PMCSummary');
      const phase = detectTrainingPhase(pmcData);
      parts.push('TRAINING LOAD (PMC):');
      parts.push(`  Fitness (CTL): ${pmcData.currentCTL.toFixed(1)}${pmcData.peakCTL > 0 ? ` (peak: ${pmcData.peakCTL.toFixed(1)})` : ''}`);
      parts.push(`  Fatigue (ATL): ${pmcData.currentATL.toFixed(1)}`);
      parts.push(`  Form (TSB): ${pmcData.currentTSB.toFixed(1)} (${pmcData.currentTSB > 10 ? 'fresh' : pmcData.currentTSB > 0 ? 'neutral' : pmcData.currentTSB > -20 ? 'fatigued' : 'overreaching'})`);
      parts.push(`  Phase: ${phase}`);
      const acwr = pmcData.currentCTL > 0 ? (pmcData.currentATL / pmcData.currentCTL).toFixed(2) : 'N/A';
      parts.push(`  ACWR: ${acwr} (safe: 0.8-1.3)`);
      if (pmcData.raceDayTSB != null) {
        parts.push(`  Projected race day form: ${pmcData.raceDayTSB.toFixed(1)}`);
      }
      parts.push(`  Data quality: ${pmcData.dataQuality} (${pmcData.hrMethodPercent}% HR-based)`);
      parts.push('');
    }
  } catch {}

  // Shoe warnings
  const wornShoes = shoes.filter(s => s.totalMiles > s.maxMiles * 0.8);
  if (wornShoes.length > 0) {
    parts.push('SHOE ALERTS:');
    for (const s of wornShoes) {
      parts.push(`  ${s.name}: ${formatDistance(s.totalMiles, units, 0)}/${formatDistance(s.maxMiles, units, 0)} (${Math.round(s.totalMiles / s.maxMiles * 100)}%)`);
    }
    parts.push('');
  }

  // Cross-training context
  try {
    const { getCrossTrainingForWeek, getCrossTrainingHistory } = require('../db/database');
    const { CROSS_TRAINING_LABELS } = require('../types');
    // This week's cross-training
    if (currentWeek && allWorkouts.length > 0) {
      const weekWorkouts = allWorkouts.filter(w => w.week_number === currentWeek.week_number);
      if (weekWorkouts.length > 0) {
        const dates = weekWorkouts.map(w => w.scheduled_date).sort();
        const weekCT = getCrossTrainingForWeek(dates[0], dates[dates.length - 1]);
        if (weekCT.length > 0) {
          parts.push('CROSS-TRAINING THIS WEEK:');
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          for (const ct of weekCT) {
            const d = new Date(ct.date + 'T12:00:00');
            const day = dayNames[d.getDay()];
            parts.push(`  ${day}: ${CROSS_TRAINING_LABELS[ct.type] ?? ct.type} (${ct.impact} impact)${ct.notes ? ` — "${ct.notes}"` : ''}`);
          }
          parts.push('');
        }
      }
    }
    // Strength training pattern from profile
    if (profile && (profile as any).does_strength_training) {
      const legDay = (profile as any).leg_day_weekday;
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      parts.push('STRENGTH TRAINING:');
      parts.push(`  Athlete does strength training regularly.`);
      if (legDay !== null && legDay !== undefined) {
        parts.push(`  Regular leg day: ${dayNames[legDay]}. Heavy leg days affect running for 24-48 hours.`);
      }
      parts.push('');
    }
  } catch {}

  // Recovery status
  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    parts.push('RECOVERY STATUS:');
    const scoredSignals = recoveryStatus.signals.filter(s => s.score > 0);
    parts.push(`Score: ${recoveryStatus.score}/100 (${recoveryStatus.level}) — ${scoredSignals.length} scored signals`);
    for (const s of scoredSignals) {
      const icon = s.status === 'good' ? '✓' : s.status === 'fair' ? '~' : '✗';
      parts.push(`  ${icon} ${s.type}: ${s.detail} (${s.score}/33)`);
    }
    // Include resting HR 14-day trend for context
    if (healthSnapshot?.restingHRTrend && healthSnapshot.restingHRTrend.length >= 3) {
      parts.push(`  Resting HR trend (14d): ${healthSnapshot.restingHRTrend.map(r => r.value).join(', ')}`);
    }
    parts.push(`Recommendation: ${recoveryStatus.recommendation}`);
    parts.push('');
  } else {
    parts.push('Recovery data: not available (HealthKit not connected)');
    parts.push('');
  }

  // Injury risk assessment
  try {
    const { calculateInjuryRisk } = require('../health/injuryRisk');
    const risk = calculateInjuryRisk(
      weeks, allWorkouts, currentWeek?.week_number ?? 0,
      recoveryStatus, healthSnapshot?.sleepHours ?? null, healthSnapshot?.sleepTrend ?? [],
    );
    if (risk.level !== 'low') {
      parts.push(`INJURY RISK: ${risk.level.toUpperCase()} (score: ${risk.score}/100)`);
      for (const f of risk.factors.filter((f: any) => f.status !== 'ok')) {
        parts.push(`  ⚠️ ${f.name}: ${f.detail}`);
      }
      parts.push(`Recommendation: ${risk.recommendation}`);
      parts.push('If injury risk is MODERATE or HIGH, proactively suggest backing off quality sessions.');
      parts.push('');
    }
  } catch {}

  // Additional health signals
  if (healthSnapshot) {
    const extras: string[] = [];
    if (healthSnapshot.weight) {
      extras.push(`Weight: ${healthSnapshot.weight.value} kg (from Apple Health, ${healthSnapshot.weight.date})`);
    }
    if (healthSnapshot.vo2max) {
      extras.push(`Garmin VO2max: ${healthSnapshot.vo2max.value} mL/kg/min (${healthSnapshot.vo2max.date})`);
    }
    // Respiratory rate already in RECOVERY STATUS signals — don't duplicate
    if (healthSnapshot.spo2 !== null) {
      const spo2Warning = healthSnapshot.spo2 < 94 ? ' ⚠️ LOW' : '';
      extras.push(`SpO2: ${healthSnapshot.spo2}%${spo2Warning}`);
    }
    if (healthSnapshot.steps !== null) {
      extras.push(`Steps today: ${healthSnapshot.steps.toLocaleString()}`);
    }
    if (extras.length > 0) {
      parts.push('ADDITIONAL HEALTH DATA:');
      extras.forEach(e => parts.push(`  ${e}`));
      parts.push('');
    }
  }

  // Garmin Connect data
  if (garminHealth) {
    const g = garminHealth;
    // Only include Garmin-exclusive data here (HRV + respiratory already in RECOVERY STATUS)
    const lines: string[] = [];
    if (g.vo2max != null) lines.push(`VO2max: ${g.vo2max} ml/kg/min`);
    if (g.bodyBatteryMorning != null) {
      lines.push(`Body Battery: ${g.bodyBatteryMorning} morning${g.bodyBatteryCharged != null ? ` (charged ${g.bodyBatteryCharged}, drained ${g.bodyBatteryDrained ?? '?'})` : ''}`);
    }
    if (g.stressAvg != null) lines.push(`Stress: avg ${g.stressAvg}/100${g.stressHigh != null ? `, peak ${g.stressHigh}/100` : ''}`);
    if (g.trainingStatus) lines.push(`Training Status: ${g.trainingStatus}`);
    if (g.trainingLoad7day != null) lines.push(`Training Load (7-day): ${g.trainingLoad7day} (ACWR: ${g.acwr ?? '?'}, status: ${g.acwrStatus ?? '?'})`);
    if (g.restingHr != null) lines.push(`Resting HR (Garmin): ${g.restingHr} bpm`);
    if (g.sleepScore != null) lines.push(`Sleep Score (Garmin): ${g.sleepScore}/100`);
    if (g.trainingReadiness != null) lines.push(`Training Readiness: ${g.trainingReadiness}/100`);
    if (lines.length > 0) {
      parts.push('GARMIN CONNECT DATA:');
      lines.forEach(l => parts.push(`  ${l}`));
      parts.push('');
    }
  }

  // Race week mode
  if (isRaceWeek) {
    parts.push('** RACE WEEK ** Focus on taper psychology, logistics, and positive visualization.');
    parts.push('');
  }

  // Plan change instructions
  parts.push(`PLAN CHANGES:
If you suggest modifying the training plan, include this JSON block at the END of your message:
\`\`\`json
{"planChange": {"type": "adapt_plan", "description": "what to change", "reason": "why"}}
\`\`\`
Types: "adapt_plan" (replan future weeks), "modify_workout" (change a specific workout), "skip_workout" (skip a workout).
Only suggest changes when clearly warranted. Don't force changes.`);

  return parts.join('\n');
}

// ─── Send Message ───────────────────────────────────────────

export async function sendCoachMessage(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: CoachMessage[],
): Promise<CoachResponse> {
  console.log('[Coach:sendCoachMessage] isGeminiAvailable:', isGeminiAvailable());
  if (!isGeminiAvailable()) {
    return {
      message: "I'm currently unavailable — check your Gemini API key. Your training plan is still running as scheduled.",
      planChange: null,
    };
  }

  // Convert to chat format (last 20 messages for context efficiency)
  const history = conversationHistory
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  console.log('[Coach:sendCoachMessage] Sending to Gemini, history:', history.length, 'messages, prompt:', systemPrompt.length, 'chars');
  const responseText = await sendChatMessage(systemPrompt, history, userMessage);
  console.log('[Coach:sendCoachMessage] Gemini responded, length:', responseText.length);

  // Parse plan change if present
  const planChange = parsePlanChange(responseText);

  // Clean the response text (remove the JSON block if present)
  let cleanMessage = responseText;
  const jsonBlockMatch = responseText.match(/```json\s*\{[\s\S]*?"planChange"[\s\S]*?\}\s*```/);
  if (jsonBlockMatch) {
    cleanMessage = responseText.replace(jsonBlockMatch[0], '').trim();
  }

  return {
    message: cleanMessage,
    planChange,
  };
}

// ─── Plan Change Parser ─────────────────────────────────────

function parsePlanChange(responseText: string): PlanChangeRequest | null {
  try {
    const jsonBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonBlockMatch) return null;

    const parsed = JSON.parse(jsonBlockMatch[1]);
    const pc = parsed.planChange || parsed;

    if (!pc || !pc.type || !pc.description) return null;

    const validTypes = ['adapt_plan', 'modify_workout', 'skip_workout'];
    if (!validTypes.includes(pc.type)) return null;

    return {
      type: pc.type,
      description: pc.description,
      reason: pc.reason || '',
      workoutId: pc.workoutId,
      changes: pc.changes,
    };
  } catch {
    return null;
  }
}
