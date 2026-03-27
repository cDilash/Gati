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
  type: 'modify_workout' | 'skip_workout' | 'swap_day';
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

  // Check if weekly planning mode
  let isWeekly = false;
  let latestCheckin: any = null;
  try {
    const { isWeeklyPlanningMode, getLatestCheckin } = require('../engine/weeklyPlanning');
    isWeekly = isWeeklyPlanningMode();
    if (isWeekly) latestCheckin = getLatestCheckin();
  } catch {}

  parts.push(`You are an expert marathon running coach guiding this athlete through their training.
You follow Jack Daniels' methodology and the 80/20 polarized training approach.
Be concise, direct, encouraging, and specific. Reference actual data, not generic advice.
Keep responses to 2-4 paragraphs max unless the athlete asks for detailed analysis.
Always use ${dLabelFull} for distances, ${pLabel} for paces, and ${units === 'metric' ? 'kg' : 'lbs'} for weight.${isWeekly ? `
This athlete uses WEEK-BY-WEEK adaptive planning. Each week is generated fresh based on a check-in questionnaire.
If they ask to "adjust my plan" or "change this week": suggest specific workout swaps for the CURRENT week only.
For next week changes: tell them to update through the weekly check-in on Sunday.` : ''}`);
  parts.push('');

  // Weekly check-in context
  if (isWeekly && latestCheckin) {
    parts.push('WEEKLY CHECK-IN (latest):');
    parts.push(`  Lifting: ${latestCheckin.strengthDays?.length > 0 ? latestCheckin.strengthDays.join(', ') : 'none'}${latestCheckin.legDay ? ` (leg: ${latestCheckin.legDay})` : ''}`);
    parts.push(`  Running days: ${latestCheckin.availableDays?.join(', ') ?? '?'}`);
    parts.push(`  Energy: ${latestCheckin.energyLevel}, Soreness: ${latestCheckin.soreness}, Sleep: ${latestCheckin.sleepQuality}`);
    if (latestCheckin.injuryStatus) parts.push(`  Injury: ${latestCheckin.injuryStatus}`);
    if (latestCheckin.notes) parts.push(`  Notes: "${latestCheckin.notes}"`);
    parts.push('');
  }

  // Profile
  parts.push('ATHLETE PROFILE:');
  // VDOT with confidence context
  const vdotAge = profile.vdot_updated_at ? Math.floor((Date.now() - new Date(profile.vdot_updated_at + 'T00:00:00').getTime()) / 86400000) : null;
  const vdotStale = vdotAge !== null && vdotAge > 56; // 8 weeks
  const vdotConf = vdotStale ? 'low' : (profile.vdot_confidence ?? 'moderate');
  const vdotSourceLabel = profile.vdot_source === 'garmin_personal_record' ? 'from Garmin personal record (high confidence)'
    : profile.vdot_source === 'garmin_race_prediction' ? 'from Garmin race prediction'
    : profile.vdot_source === 'garmin_vo2max' ? 'from Garmin VO2max (conservative estimate)'
    : profile.vdot_source === 'strava_race' ? 'from Strava race'
    : profile.vdot_source === 'strava_best_effort' ? 'from Strava training run — NOT race effort, treat as conservative'
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

    // Show ALL workouts (including rest) with IDs for weekly adjustment
    for (const w of weekWorkouts) {
      let status = w.status === 'completed' ? 'DONE' : w.status === 'skipped' ? 'SKIP' : w.status === 'partial' ? 'PARTIAL' : 'TODO';
      if (w.execution_quality && w.execution_quality !== 'on_target' && (w.status === 'completed' || w.status === 'partial')) {
        const qualityLabel = w.execution_quality === 'missed_pace' ? ' ⚠️ pace missed' : w.execution_quality === 'exceeded_pace' ? ' ⚠️ too fast' : w.execution_quality === 'wrong_type' ? ' ⚠️ wrong workout' : '';
        status += qualityLabel;
      }
      const dist = w.workout_type !== 'rest' ? ` — ${formatDistance(w.target_distance_miles ?? 0, units)}` : '';
      parts.push(`  [${status}] ${w.scheduled_date} (ID:${w.id.substring(0, 8)}): ${w.title || w.workout_type}${dist}`);
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
        // Tier 2: Running dynamics + power
        if (ga.ground_contact_time_ms) teParts.push(`GCT ${Math.round(ga.ground_contact_time_ms)}ms`);
        if (ga.vertical_oscillation_cm) teParts.push(`VO ${ga.vertical_oscillation_cm}cm`);
        if (ga.stride_length_cm) teParts.push(`stride ${ga.stride_length_cm}cm`);
        if (ga.avg_power_watts) teParts.push(`power ${ga.avg_power_watts}W`);
        if (ga.performance_condition != null) teParts.push(`perf ${ga.performance_condition > 0 ? '+' : ''}${ga.performance_condition}`);
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
      require('../utils/dateUtils').addDays(require('../utils/dateUtils').getToday(), -14)
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

  // ── UNIFIED HEALTH DATA (all from Garmin via Supabase) ──
  // Single section: recovery score + all Garmin health fields (non-null only)
  const g = garminHealth;

  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    parts.push('HEALTH DATA (Garmin):');

    // Recovery score summary
    const scoredSignals = recoveryStatus.signals.filter(s => s.score > 0);
    parts.push(`Recovery Score: ${recoveryStatus.score}/100 (${recoveryStatus.level}) — ${scoredSignals.length} scored signals`);
    for (const s of scoredSignals) {
      const icon = s.status === 'good' ? '✓' : s.status === 'fair' ? '~' : '✗';
      parts.push(`  ${icon} ${s.type}: ${s.detail} (${s.score}/33)`);
    }
    parts.push(`Recommendation: ${recoveryStatus.recommendation}`);

    // Training readiness (Garmin's own composite score)
    if (g?.trainingReadiness != null) {
      parts.push(`Training Readiness: ${g.trainingReadiness}/100${g.readinessFeedbackShort ? ` (${g.readinessFeedbackShort.replace(/_/g, ' ').toLowerCase()})` : ''}`);
    }
    if (g?.recoveryTimeHours != null) parts.push(`Recovery time remaining: ${g.recoveryTimeHours}h`);

    // Resting HR trend
    if (healthSnapshot?.restingHRTrend && healthSnapshot.restingHRTrend.length >= 3) {
      parts.push(`Resting HR trend (14d): ${healthSnapshot.restingHRTrend.map(r => r.value).join(', ')}`);
    }

    // Body Battery
    if (g?.bodyBatteryMorning != null) {
      parts.push(`Body Battery: ${g.bodyBatteryMorning}/100 morning${g.bbAtWake != null ? ` (${g.bbAtWake} at wake)` : ''}${g.bodyBatteryCharged != null ? `, charged ${g.bodyBatteryCharged}, drained ${g.bodyBatteryDrained ?? '?'}` : ''}`);
    }

    // Sleep (all from Garmin)
    if (g?.sleepScore != null || g?.sleepDurationSec != null) {
      const fmtDur = (sec: number) => { const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
      let sleepLine = '';
      if (g.sleepDurationSec != null) {
        sleepLine = `Sleep: ${fmtDur(g.sleepDurationSec)}`;
        if (g.sleepScore != null) sleepLine += ` (score: ${g.sleepScore}/100)`;
      } else if (g.sleepScore != null) {
        sleepLine = `Sleep Score: ${g.sleepScore}/100`;
      }
      if (g.sleepNeedMinutes != null) {
        const need = `${Math.floor(g.sleepNeedMinutes / 60)}h${g.sleepNeedMinutes % 60 ? ` ${g.sleepNeedMinutes % 60}m` : ''}`;
        sleepLine += `, need: ${need}`;
      }
      if (g.sleepDebtMinutes) sleepLine += `, debt: ${g.sleepDebtMinutes}m`;
      if (g.sleepAwakeCount != null) sleepLine += `, ${g.sleepAwakeCount} awakening${g.sleepAwakeCount !== 1 ? 's' : ''}`;
      parts.push(sleepLine);
      // Stage breakdown (actual durations)
      if (g.sleepDeepSec != null || g.sleepLightSec != null || g.sleepRemSec != null) {
        const stages = [
          g.sleepDeepSec != null ? `Deep ${fmtDur(g.sleepDeepSec)}` : null,
          g.sleepLightSec != null ? `Light ${fmtDur(g.sleepLightSec)}` : null,
          g.sleepRemSec != null ? `REM ${fmtDur(g.sleepRemSec)}` : null,
          g.sleepAwakeSec != null ? `Awake ${fmtDur(g.sleepAwakeSec)}` : null,
        ].filter(Boolean).join(', ');
        parts.push(`  Stages: ${stages}`);
      }
      // Bed/wake times (Garmin "local" timestamps: epoch ms already in local time — use UTC methods to avoid double-shift)
      if (g.sleepStart && g.sleepEnd) {
        const fmtTime = (ts: string) => {
          try {
            const n = Number(ts);
            if (!isNaN(n) && n > 1e12) {
              const d = new Date(n);
              const h = d.getUTCHours();
              const m = d.getUTCMinutes();
              const ampm = h >= 12 ? 'PM' : 'AM';
              return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
            }
            return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          } catch { return '?'; }
        };
        parts.push(`  Bed: ${fmtTime(g.sleepStart)} → ${fmtTime(g.sleepEnd)}`);
      }
    }

    // HRV details
    if (g?.hrvLastNightAvg != null) {
      let hrvLine = `HRV: ${g.hrvLastNightAvg}ms overnight avg`;
      if (g.hrvWeeklyAvg != null) hrvLine += `, weekly avg: ${g.hrvWeeklyAvg}ms`;
      if (g.hrvStatus) hrvLine += ` (${g.hrvStatus.toLowerCase()})`;
      if (g.hrvFeedback) hrvLine += ` — ${g.hrvFeedback.replace(/_/g, ' ').toLowerCase()}`;
      parts.push(hrvLine);
    }

    // Stress
    if (g?.stressAvg != null) {
      parts.push(`Stress: avg ${g.stressAvg}/100${g.stressHigh != null ? `, peak ${g.stressHigh}` : ''}${g.stressQualifier ? ` (${g.stressQualifier.toLowerCase()})` : ''}`);
    }

    // Training load & status
    if (g?.trainingStatus) {
      let loadLine = `Training Status: ${g.trainingStatus}`;
      if (g.trainingLoad7day != null) loadLine += `, 7d load: ${g.trainingLoad7day}`;
      if (g.acwr != null) loadLine += `, ACWR: ${g.acwr}${g.acwrStatus ? ` (${g.acwrStatus})` : ''}`;
      parts.push(loadLine);
    }

    // Vitals
    if (g?.restingHr != null) {
      let vitalsLine = `Resting HR: ${g.restingHr} bpm`;
      if (g.rhr7dayAvg) vitalsLine += ` (7d avg: ${g.rhr7dayAvg})`;
      if (g.maxHrDaily != null && g.minHrDaily != null) vitalsLine += `, daily range: ${g.minHrDaily}-${g.maxHrDaily}`;
      parts.push(vitalsLine);
    }
    if (g?.respiratoryRate != null) parts.push(`Respiratory rate: ${g.respiratoryRate} br/min`);
    if (g?.spo2Avg != null) {
      let spo2Line = `SpO2: ${g.spo2Avg}%`;
      if (g.minSpo2 != null && g.minSpo2 < 92) spo2Line += ` ⚠ min: ${g.minSpo2}% (below normal)`;
      parts.push(spo2Line);
    }

    // Weight / Body composition (from Garmin Index Scale)
    if (g?.weightKg != null) {
      let weightLine = `Weight: ${g.weightKg} kg`;
      if (g.bodyFatPct != null) weightLine += `, body fat: ${g.bodyFatPct}%`;
      if (g.muscleMassKg != null) weightLine += `, muscle: ${g.muscleMassKg} kg`;
      if (g.bmi != null) weightLine += `, BMI: ${g.bmi}`;
      parts.push(weightLine);
    }

    // Fitness metrics
    if (g?.vo2max != null) parts.push(`VO2max: ${g.vo2max} ml/kg/min${g.vo2maxFitnessAge != null ? ` (fitness age: ${g.vo2maxFitnessAge})` : ''}`);
    if (g?.enduranceScore != null) parts.push(`Endurance Score: ${g.enduranceScore}${g.enduranceClassification ? ` (${g.enduranceClassification})` : ''}`);
    if (g?.hillScore != null) parts.push(`Hill Score: ${g.hillScore} (endurance: ${g.hillEndurance ?? '?'}, strength: ${g.hillStrength ?? '?'})`);
    if (g?.lactateThresholdHr != null) {
      const ltPace = g.lactateThresholdSpeed && g.lactateThresholdSpeed > 0 ? Math.round(1609.344 / g.lactateThresholdSpeed) : null;
      parts.push(`Lactate Threshold: ${g.lactateThresholdHr} bpm${ltPace ? ` @ ${Math.floor(ltPace / 60)}:${String(ltPace % 60).padStart(2, '0')}/mi` : ''}`);
    }

    // Race predictions
    if (g?.predictedMarathonSec != null) {
      const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      parts.push(`Race predictions: 5K ${g.predicted5kSec ? fmt(g.predicted5kSec) : '?'}, 10K ${g.predicted10kSec ? fmt(g.predicted10kSec) : '?'}, Half ${g.predictedHalfSec ? fmt(g.predictedHalfSec) : '?'}, Marathon ${fmt(g.predictedMarathonSec)}`);
    }

    // Warnings
    if (g?.skinTempDeviationC != null && Math.abs(g.skinTempDeviationC) > 0.3) {
      parts.push(`⚠ Skin temp deviation: ${g.skinTempDeviationC > 0 ? '+' : ''}${g.skinTempDeviationC}°C from baseline${g.skinTempDeviationC > 0.5 ? ' — possible illness/overtraining' : ''}`);
    }

    // Data freshness
    if (g?.fetchedAt) {
      const ageMin = Math.round((Date.now() - new Date(g.fetchedAt).getTime()) / 60000);
      if (ageMin > 120) {
        parts.push(`Note: Health data is ${Math.round(ageMin / 60)}h old. Recovery signals may not reflect current state.`);
      }
    }
    parts.push('');
  } else {
    parts.push('HEALTH DATA: not available (Garmin data not synced yet)');
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

  // Race week mode
  if (isRaceWeek) {
    parts.push('** RACE WEEK ** Focus on taper psychology, logistics, and positive visualization.');
    parts.push('');
  }

  // Weekly adjustment instructions — coach can modify THIS WEEK's workouts
  parts.push(`WORKOUT ADJUSTMENTS:
This athlete uses WEEKLY planning. You CAN adjust this week's upcoming workouts.
Use the workout IDs from the list above.

When the athlete asks to change their schedule, include an adjustment block AFTER your explanation:

SWAP (move a workout to a different day this week):
[ADJUST: swap | workout=WORKOUT_ID | to=YYYY-MM-DD]

MODIFY (change distance, type, or description):
[ADJUST: modify | workout=WORKOUT_ID | distance=6.0]
[ADJUST: modify | workout=WORKOUT_ID | type=easy | distance=3.0]

SKIP (mark a workout as skipped):
[ADJUST: skip | workout=WORKOUT_ID | reason=feeling sick]

ADD (add a workout on an empty/rest day):
[ADJUST: add | date=YYYY-MM-DD | type=easy | distance=3.0 | description=Easy recovery run]

RESCHEDULE (rearrange around unavailable days):
[ADJUST: reschedule | unavailable=2026-03-28,2026-03-29,2026-03-30 | longrun=2026-03-27]

RULES:
- ONLY modify workouts with status TODO (not DONE or SKIP)
- ONLY use dates within the current week
- Use the 8-character workout ID from the list (e.g., ID:abc12345 → workout=abc12345)
- Always explain the change BEFORE the adjustment block
- For a completely different week: suggest "Let's redo your weekly check-in"
- You CAN make multiple adjustments in one response (multiple [ADJUST] blocks)`);

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
  // Gemini requires: history must start with 'user' role, alternate user/model
  let history = conversationHistory
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  // Drop leading assistant messages (Gemini requires first message to be 'user')
  while (history.length > 0 && history[0].role === 'assistant') {
    history = history.slice(1);
  }
  // Remove the last message if it's from user (we'll send it separately via sendMessage)
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    history = history.slice(0, -1);
  }

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

    const validTypes = ['modify_workout', 'skip_workout', 'swap_day'];
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
