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

export function buildCoachSystemPrompt(
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
): string {
  const parts: string[] = [];

  parts.push(`You are an expert marathon running coach guiding this athlete through their training.
You follow Jack Daniels' methodology and the 80/20 polarized training approach.
Be concise, direct, encouraging, and specific. Reference actual data, not generic advice.
Keep responses to 2-4 paragraphs max unless the athlete asks for detailed analysis.`);
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
    parts.push(`- Height: ${profile.height_cm}cm, Weight: ${profile.weight_kg}kg, BMI: ${bmi}`);
    if (bmi > 30) parts.push(`- NOTE: Elevated BMI — favor time-based long run targets, add extra recovery, be conservative with volume`);
  } else if (profile.weight_kg) {
    parts.push(`- Weight: ${profile.weight_kg}kg`);
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
  parts.push('PACE ZONES (min/mile):');
  parts.push(`  E: ${formatPaceRange(paceZones.E)} | M: ${formatPaceRange(paceZones.M)} | T: ${formatPaceRange(paceZones.T)} | I: ${formatPaceRange(paceZones.I)} | R: ${formatPaceRange(paceZones.R)}`);
  parts.push('');

  // Current week
  if (currentWeek) {
    parts.push(`CURRENT WEEK: ${currentWeek.week_number} of ${weeks.length} — ${currentWeek.phase} phase${currentWeek.is_cutback ? ' (cutback)' : ''}`);
    parts.push(`Volume: ${currentWeek.actual_volume.toFixed(1)} of ${currentWeek.target_volume}mi completed`);

    const scheduled = weekWorkouts.filter(w => w.workout_type !== 'rest');
    for (const w of scheduled) {
      let status = w.status === 'completed' ? 'DONE' : w.status === 'skipped' ? 'SKIP' : w.status === 'partial' ? 'PARTIAL' : 'TODO';
      if (w.execution_quality && w.execution_quality !== 'on_target' && (w.status === 'completed' || w.status === 'partial')) {
        const qualityLabel = w.execution_quality === 'missed_pace' ? ' ⚠️ pace missed' : w.execution_quality === 'exceeded_pace' ? ' ⚠️ too fast' : w.execution_quality === 'wrong_type' ? ' ⚠️ wrong workout' : '';
        status += qualityLabel;
      }
      parts.push(`  [${status}] ${w.scheduled_date}: ${w.title} — ${w.target_distance_miles}mi`);
    }
    parts.push('');
  }

  // Today
  if (todaysWorkout) {
    if (todaysWorkout.workout_type === 'rest') {
      parts.push('TODAY: Rest day');
    } else {
      parts.push(`TODAY: ${todaysWorkout.title} — ${todaysWorkout.target_distance_miles}mi at ${todaysWorkout.target_pace_zone || todaysWorkout.workout_type} pace`);
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

    parts.push('RECENT RUNS (last 7 days):');
    for (let mi = 0; mi < Math.min(recentMetrics.length, 5); mi++) {
      const m = recentMetrics[mi];
      const pace = m.avg_pace_sec_per_mile ? formatPace(m.avg_pace_sec_per_mile) : '?';
      const hr = m.avg_hr ? ` HR:${m.avg_hr}` : '';
      const rpe = m.perceived_exertion ? ` RPE:${m.perceived_exertion}` : '';
      const gear = m.gear_name ? ` [${m.gear_name}]` : '';

      // Enrichments from strava detail
      const detail = m.strava_activity_id ? detailMap.get(m.strava_activity_id) : null;
      const elev = detail?.elevation_gain_ft ? ` +${Math.round(detail.elevation_gain_ft)}ft` : '';
      const cadence = detail?.cadence_avg ? ` ${Math.round(detail.cadence_avg)}spm` : '';
      const suffer = detail?.suffer_score ? ` effort:${detail.suffer_score}` : '';

      parts.push(`  ${m.date}: ${m.distance_miles.toFixed(1)}mi @ ${pace}/mi${hr}${rpe}${elev}${cadence}${suffer}${gear}`);

      // Per-mile splits for the last 3 runs (most valuable coaching data)
      if (mi < 3) {
        const splitsSource = detail?.splits_json || m.splits_json;
        if (splitsSource) {
          try {
            const splits = JSON.parse(splitsSource);
            if (splits.length >= 2) {
              const splitPaces = splits.map((sp: any) => {
                if (sp.average_speed && sp.average_speed > 0) {
                  return formatPace(1609.34 / sp.average_speed);
                } else if (sp.moving_time && sp.distance) {
                  return formatPace((sp.moving_time / sp.distance) * 1609.34);
                }
                return '?';
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

  // Best efforts from Strava
  try {
    const { getDatabase } = require('../db/database');
    const bestEfforts = getDatabase().getAllSync(
      `SELECT best_efforts_json FROM performance_metric
       WHERE best_efforts_json IS NOT NULL AND best_efforts_json != '[]'
       ORDER BY date DESC LIMIT 5`
    );
    if (bestEfforts.length > 0) {
      const allEfforts: any[] = [];
      for (const row of bestEfforts) {
        try { allEfforts.push(...JSON.parse(row.best_efforts_json)); } catch {}
      }
      // Find PRs for key distances
      const prDistances = ['400m', '1/2 mile', '1 mile', '1k', '2 mile', '5k', '10k'];
      const prs = prDistances
        .map(dist => {
          const matching = allEfforts.filter((e: any) => e.name === dist && e.pr_rank === 1);
          if (matching.length === 0) return null;
          const best = matching[0];
          const mins = Math.floor(best.elapsed_time / 60);
          const secs = best.elapsed_time % 60;
          const prDate = best.start_date?.split('T')[0] || '';
          return `${dist}: ${mins}:${String(secs).padStart(2, '0')}${prDate ? ` (${prDate})` : ''}`;
        })
        .filter(Boolean);
      if (prs.length > 0) {
        parts.push('PERSONAL RECORDS (from Strava):');
        parts.push(`  ${prs.join(' | ')}`);
        parts.push('');
      }
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
       AND pm.date >= date('now', '-14 days')
       AND pm.workout_id IS NULL`
    );
    if (restDayRuns.length > 0) {
      parts.push('REST DAY ACTIVITY:');
      for (const r of restDayRuns) {
        parts.push(`  ⚠️ ${(r as any).date}: ran ${((r as any).distance_miles as number).toFixed(1)}mi on a scheduled rest day`);
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
      parts.push(`  Week ${w.week_number}: ${w.actual_volume.toFixed(1)}/${w.target_volume}mi (${pct}%)${w.is_cutback ? ' CB' : ''}`);
    }
    const adherence = recentWeeks.reduce((sum, w) => {
      const completed = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.status === 'completed').length;
      const total = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.workout_type !== 'rest').length;
      return sum + (total > 0 ? completed / total : 1);
    }, 0) / recentWeeks.length;
    parts.push(`  Adherence: ${Math.round(adherence * 100)}%`);
    parts.push('');
  }

  // Shoe warnings
  const wornShoes = shoes.filter(s => s.totalMiles > s.maxMiles * 0.8);
  if (wornShoes.length > 0) {
    parts.push('SHOE ALERTS:');
    for (const s of wornShoes) {
      parts.push(`  ${s.name}: ${s.totalMiles.toFixed(0)}/${s.maxMiles}mi (${Math.round(s.totalMiles / s.maxMiles * 100)}%)`);
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
    parts.push(`Score: ${recoveryStatus.score}/100 (${recoveryStatus.level}) — ${recoveryStatus.signalCount} signals`);
    for (const s of recoveryStatus.signals) {
      const icon = s.status === 'good' ? '✓' : s.status === 'fair' ? '~' : '✗';
      parts.push(`  ${icon} ${s.type}: ${s.detail}`);
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
    if (healthSnapshot.respiratoryRate !== null) {
      extras.push(`Respiratory rate: ${healthSnapshot.respiratoryRate} breaths/min`);
    }
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

  const responseText = await sendChatMessage(systemPrompt, history, userMessage);

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
