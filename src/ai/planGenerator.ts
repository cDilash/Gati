/**
 * AI Plan Generator — Gemini generates the full training plan.
 *
 * This replaces the old 5-step deterministic engine. Gemini IS the coach.
 * The safety validator (safetyValidator.ts) runs AFTER to clamp any dangerous values.
 */

import { sendStructuredMessage, extractJSON, isGeminiAvailable } from './gemini';
import {
  UserProfile,
  PaceZones,
  PerformanceMetric,
  AIGeneratedPlan,
  AIWeek,
  AIWorkout,
  IntervalStep,
} from '../types';
import { formatPace, formatTime, predictMarathonTime, predict5KTime, predict10KTime, predictHalfMarathonTime } from '../engine/vdot';
import { formatPaceRange } from '../engine/paceZones';
import { daysBetween } from '../utils/dateUtils';

// ─── System Prompt ──────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are an elite marathon running coach with 20 years of experience coaching runners from beginners to Boston qualifiers. You're designing a complete, personalized, week-by-week marathon training plan.

RESPOND ONLY WITH VALID JSON matching the schema below. No explanation, no markdown fences, no extra text. Just raw JSON.

OUTPUT SCHEMA:
{
  "weeks": [
    {
      "weekNumber": 1,
      "phase": "base",
      "targetVolume": 30,
      "isCutback": false,
      "focusArea": "aerobic base building",
      "aiNotes": "Easy start — focus on consistency and building the running habit.",
      "workouts": [
        {
          "dayOfWeek": 0,
          "type": "easy",
          "title": "Easy Aerobic Run",
          "description": "Run at conversational pace. You should be able to hold a full conversation.",
          "distanceMiles": 5.0,
          "paceZone": "E",
          "intervals": null,
          "coachingCue": "Relax your shoulders, quick light steps."
        }
      ]
    }
  ],
  "coachingNotes": "Overall plan philosophy...",
  "keyPrinciples": ["Principle 1", "Principle 2"],
  "warnings": ["Warning if any"]
}

RULES YOU MUST FOLLOW:
1. Total weeks: use the exact number provided. Every week must have workouts.
2. Phase distribution: ~30-35% Base, ~30-35% Build, ~15-20% Peak, last 3 weeks Taper.
3. Volume progression: start from the athlete's CURRENT weekly mileage, build gradually.
4. Include a cutback week (reduced volume ~70-80%) every 3rd or 4th week.
5. Last 3 weeks MUST be taper: ~75%, ~55%, ~30% of peak volume.
6. 80% of weekly volume should be easy pace. 20% quality/intensity max.
7. One long run per week on the athlete's preferred day.
8. Quality sessions: threshold/tempo in build phase, add VO2max intervals in peak.
9. Recovery run or rest the day after long run or hard quality session.
10. Rest days on days NOT in the athlete's available days list.
11. Day numbers (Monday-based): 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday.

WORKOUT TYPES TO USE:
- easy: conversational pace at E zone
- long_run: variations include steady, progressive, fast_finish, negative_split, marathon_pace_middle
- threshold: cruise intervals, tempo runs at T zone
- intervals: VO2max intervals (800m-1200m repeats) at I zone
- hill_repeats: uphill intervals for strength
- fartlek: unstructured speed play
- marathon_pace: sustained M zone running
- tempo: continuous threshold effort
- recovery: very easy, blood flow only
- rest: no running (distanceMiles = 0)

FOR EACH WORKOUT INCLUDE:
- A specific title — not generic. "Progressive Long Run" not "Long Run".
- Exact distance in miles (numbers, not ranges).
- Pacing instructions using the athlete's ACTUAL pace zones provided below.
- A coaching cue — one sentence about form, effort, or mindset.
- For interval workouts: structured intervals array with warmup, work, recovery, cooldown steps.

PERSONALIZATION:
- If injury history exists, avoid aggravating movements and explain why.
- If race course is hilly, include hill work in build/peak phases.
- If athlete tends to "go out too fast", prescribe negative split long runs.
- If athlete is a beginner, be more conservative with quality and include more rest days.
- Reference the athlete's ACTUAL pace numbers, not generic paces.
- Make every workout description tell the athlete exactly what to do and why.

The plan should read like a real coach wrote it — specific, personalized, and actionable.`;

// ─── Plan Generation ────────────────────────────────────────

export async function generateTrainingPlan(
  profile: UserProfile,
  paceZones: PaceZones,
  stravaHistory: PerformanceMetric[] | null,
): Promise<AIGeneratedPlan> {
  if (!isGeminiAvailable()) {
    throw new Error('Gemini API key not configured');
  }

  const userMessage = buildUserMessage(profile, paceZones, stravaHistory);
  console.log('[PlanGen] Sending plan generation request to Gemini...');

  const responseText = await sendStructuredMessage(SYSTEM_INSTRUCTION, userMessage, 'heavy');
  console.log('[PlanGen] Received response, parsing JSON...');

  const raw = extractJSON(responseText);
  const plan = validateAndCleanPlan(raw, profile);

  console.log(`[PlanGen] Plan parsed: ${plan.weeks.length} weeks, ${plan.weeks.reduce((n, w) => n + w.workouts.length, 0)} workouts`);
  return plan;
}

// ─── User Message Builder ───────────────────────────────────

function buildUserMessage(
  profile: UserProfile,
  paceZones: PaceZones,
  stravaHistory: PerformanceMetric[] | null,
): string {
  const today = require('../utils/dateUtils').getToday();
  const totalWeeks = Math.max(4, Math.floor(daysBetween(today, profile.race_date) / 7));

  const parts: string[] = [];

  parts.push(`GENERATE A ${totalWeeks}-WEEK MARATHON TRAINING PLAN.`);
  parts.push('');

  // Athlete profile
  parts.push('ATHLETE PROFILE:');
  parts.push(`- Age: ${profile.age}, Gender: ${profile.gender}`);
  if (profile.height_cm && profile.weight_kg) {
    const heightM = profile.height_cm / 100;
    const bmi = Math.round((profile.weight_kg / (heightM * heightM)) * 10) / 10;
    parts.push(`- Height: ${profile.height_cm}cm, Weight: ${profile.weight_kg}kg, BMI: ${bmi}`);
  } else {
    if (profile.weight_kg) parts.push(`- Weight: ${profile.weight_kg} kg`);
    if (profile.height_cm) parts.push(`- Height: ${profile.height_cm}cm`);
  }
  const vSource = profile.vdot_source === 'strava_race' ? ' (from race)' : profile.vdot_source === 'strava_best_effort' ? ' (from Strava best effort)' : ' (manual entry)';
  parts.push(`- VDOT: ${profile.vdot_score}${vSource}`);
  if (profile.max_hr) {
    const hrSource = (profile as any).max_hr_source === 'strava' ? ' (observed from Strava)' : ' (formula estimate)';
    parts.push(`- Max HR: ${profile.max_hr}bpm${hrSource}`);
    if (profile.rest_hr) {
      parts.push(`- Resting HR: ${profile.rest_hr}bpm`);
      // Include HR zones for the plan generator
      const { calculateHRZones } = require('../engine/paceZones');
      const hrz = calculateHRZones(profile.max_hr, profile.rest_hr);
      parts.push(`- HR Zones: Z1 ${hrz.zone1.min}-${hrz.zone1.max} | Z2 ${hrz.zone2.min}-${hrz.zone2.max} | Z3 ${hrz.zone3.min}-${hrz.zone3.max} | Z4 ${hrz.zone4.min}-${hrz.zone4.max} | Z5 ${hrz.zone5.min}-${hrz.zone5.max} bpm`);
    }
  }
  parts.push(`- Experience: ${profile.experience_level}`);
  parts.push(`- Current weekly mileage: ${profile.current_weekly_miles} miles/week`);
  parts.push(`- Longest recent run: ${profile.longest_recent_run} miles`);
  parts.push('');

  // Race details
  parts.push('RACE DETAILS:');
  if (profile.race_name) parts.push(`- Race: ${profile.race_name}`);
  parts.push(`- Date: ${profile.race_date} (${totalWeeks} weeks away)`);
  parts.push(`- Course profile: ${profile.race_course_profile}`);
  parts.push(`- Goal: ${profile.race_goal_type}`);
  if (profile.target_finish_time_sec) {
    parts.push(`- Target finish time: ${formatTime(profile.target_finish_time_sec)}`);
  }
  parts.push(`- Predicted marathon time (VDOT ${profile.vdot_score}): ${formatTime(predictMarathonTime(profile.vdot_score))}`);
  parts.push(`- Predicted half marathon: ${formatTime(predictHalfMarathonTime(profile.vdot_score))}`);
  parts.push(`- Predicted 10K: ${formatTime(predict10KTime(profile.vdot_score))}`);
  parts.push(`- Predicted 5K: ${formatTime(predict5KTime(profile.vdot_score))}`);
  parts.push('');

  // Pace zones
  parts.push('PACE ZONES (min:sec per mile):');
  parts.push(`- E (Easy): ${formatPaceRange(paceZones.E)}`);
  parts.push(`- M (Marathon): ${formatPaceRange(paceZones.M)}`);
  parts.push(`- T (Threshold): ${formatPaceRange(paceZones.T)}`);
  parts.push(`- I (Interval): ${formatPaceRange(paceZones.I)}`);
  parts.push(`- R (Repetition): ${formatPaceRange(paceZones.R)}`);
  parts.push('');

  // Schedule
  parts.push('SCHEDULE:');
  // Convert JS day numbers (0=Sun) to Monday-based (0=Mon) for the AI
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const toMondayBased = (jsDow: number) => jsDow === 0 ? 6 : jsDow - 1; // 0=Sun→6, 1=Mon→0, etc.
  parts.push(`- Available days: ${profile.available_days.map((d: number) => `${dayNames[d]} (day ${toMondayBased(d)})`).join(', ')}`);
  parts.push(`- Long run day: ${dayNames[profile.long_run_day]} (day ${toMondayBased(profile.long_run_day)})`);
  parts.push('');

  // Coaching context
  if (profile.injury_history.length > 0) {
    parts.push(`INJURY HISTORY: ${profile.injury_history.join(', ')}`);
  }
  if (profile.known_weaknesses.length > 0) {
    parts.push(`KNOWN WEAKNESSES: ${profile.known_weaknesses.join(', ')}`);
  }
  if (profile.scheduling_notes) {
    parts.push(`SCHEDULING NOTES: ${profile.scheduling_notes}`);
  }
  // Strength training constraint
  if ((profile as any).does_strength_training) {
    const legDay = (profile as any).leg_day_weekday;
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    parts.push('');
    parts.push('STRENGTH TRAINING CONSTRAINT:');
    parts.push('Athlete does strength training / bodybuilding with a dedicated leg day.');
    if (legDay !== null && legDay !== undefined) {
      parts.push(`Regular leg day: ${dayNames[legDay]}.`);
      parts.push(`RULE: Never schedule threshold, intervals, tempo, or hill repeats the day after ${dayNames[legDay]} (leg day).`);
      parts.push(`Schedule easy or recovery runs the day after leg day. The plan must coexist with the athlete's strength schedule.`);
    } else {
      parts.push('No fixed leg day — but avoid back-to-back quality + heavy lifting when possible.');
    }
  }
  parts.push('');

  // Strava history summary
  if (stravaHistory && stravaHistory.length > 0) {
    parts.push('RECENT TRAINING HISTORY (from Strava):');
    const last8Weeks = stravaHistory.slice(0, 56); // ~8 weeks of daily data
    const weeklyVolumes: number[] = [];
    for (let i = 0; i < last8Weeks.length; i += 7) {
      const weekRuns = last8Weeks.slice(i, i + 7);
      const volume = weekRuns.reduce((sum, m) => sum + m.distance_miles, 0);
      weeklyVolumes.push(Math.round(volume * 10) / 10);
    }
    if (weeklyVolumes.length > 0) {
      parts.push(`- Recent weekly volumes: ${weeklyVolumes.join(', ')} miles`);
    }
    const longestRun = Math.max(...last8Weeks.map(m => m.distance_miles));
    parts.push(`- Longest run in period: ${longestRun.toFixed(1)} miles`);
    const avgPace = last8Weeks.reduce((sum, m) => sum + (m.avg_pace_sec_per_mile || 0), 0) / last8Weeks.length;
    if (avgPace > 0) {
      parts.push(`- Average training pace: ${formatPace(avgPace)}/mi`);
    }
    parts.push('');
  }

  // Recovery baseline (if health data available from Garmin)
  try {
    const { useAppStore } = require('../store');
    const snap = useAppStore.getState().healthSnapshot;
    if (snap) {
      const baselines: string[] = [];
      if (snap.restingHRTrend.length >= 3) {
        const avg = Math.round(snap.restingHRTrend.reduce((s: number, r: any) => s + r.value, 0) / snap.restingHRTrend.length);
        baselines.push(`Avg resting HR: ${avg}bpm`);
      }
      if (snap.sleepTrend.length >= 3) {
        const avgSleepMin = Math.round(snap.sleepTrend.reduce((s: number, n: any) => s + n.totalMinutes, 0) / snap.sleepTrend.length);
        const { formatSleepDuration } = require('../utils/formatTime');
        baselines.push(`Avg sleep: ${formatSleepDuration(avgSleepMin)}`);
      }
      if (baselines.length > 0) {
        parts.push(`RECOVERY BASELINE: ${baselines.join(', ')}`);
        parts.push('');
      }
    }
  } catch {}

  // Best efforts from Strava for calibration
  try {
    const { getDatabase } = require('../db/database');
    const bestRows = getDatabase().getAllSync(
      `SELECT best_efforts_json FROM performance_metric
       WHERE best_efforts_json IS NOT NULL AND best_efforts_json != '[]'
       ORDER BY date DESC LIMIT 10`
    );
    const allBestEfforts: any[] = [];
    for (const row of bestRows) {
      try { allBestEfforts.push(...JSON.parse(row.best_efforts_json)); } catch {}
    }
    const prDistances = ['1 mile', '5k', '10k'];
    const prs = prDistances
      .map(dist => {
        const matching = allBestEfforts.filter((e: any) => e.name === dist && e.pr_rank === 1);
        if (matching.length === 0) return null;
        const best = matching[0];
        const mins = Math.floor(best.elapsed_time / 60);
        const secs = best.elapsed_time % 60;
        const prDate = best.start_date?.split('T')[0] || '';
        return `${dist} PR: ${mins}:${String(secs).padStart(2, '0')}${prDate ? ` (${prDate})` : ''}`;
      })
      .filter(Boolean);
    if (prs.length > 0) {
      parts.push(`\nRecent PRs (from Strava): ${prs.join(', ')}`);
    }
  } catch {}

  return parts.join('\n');
}

// ─── Response Validation ────────────────────────────────────

function validateAndCleanPlan(raw: any, profile: UserProfile): AIGeneratedPlan {
  if (!raw || !Array.isArray(raw.weeks) || raw.weeks.length === 0) {
    throw new Error('Invalid plan: missing or empty weeks array');
  }

  const validPhases = ['base', 'build', 'peak', 'taper'];
  const validWorkoutTypes = [
    'easy', 'long_run', 'threshold', 'intervals', 'tempo',
    'hill_repeats', 'fartlek', 'marathon_pace', 'recovery', 'rest',
  ];

  const weeks: AIWeek[] = raw.weeks.map((w: any, i: number): AIWeek => {
    const workouts: AIWorkout[] = (w.workouts || []).map((wo: any): AIWorkout => ({
      dayOfWeek: typeof wo.dayOfWeek === 'number' ? Math.min(6, Math.max(0, wo.dayOfWeek)) : 1,
      type: validWorkoutTypes.includes(wo.type) ? wo.type : 'easy',
      title: typeof wo.title === 'string' ? wo.title : 'Run',
      description: typeof wo.description === 'string' ? wo.description : '',
      distanceMiles: typeof wo.distanceMiles === 'number' ? Math.max(0, wo.distanceMiles) : 0,
      paceZone: typeof wo.paceZone === 'string' ? wo.paceZone : null,
      intervals: Array.isArray(wo.intervals) ? normalizeIntervals(wo.intervals) : null,
      coachingCue: typeof wo.coachingCue === 'string' ? wo.coachingCue : '',
    }));

    return {
      weekNumber: typeof w.weekNumber === 'number' ? w.weekNumber : i + 1,
      phase: validPhases.includes(w.phase) ? w.phase : 'base',
      targetVolume: typeof w.targetVolume === 'number' ? Math.max(0, w.targetVolume) : 0,
      isCutback: !!w.isCutback,
      focusArea: typeof w.focusArea === 'string' ? w.focusArea : '',
      aiNotes: typeof w.aiNotes === 'string' ? w.aiNotes : '',
      workouts,
    };
  });

  return {
    weeks,
    coachingNotes: typeof raw.coachingNotes === 'string' ? raw.coachingNotes : '',
    keyPrinciples: Array.isArray(raw.keyPrinciples)
      ? raw.keyPrinciples.filter((p: any) => typeof p === 'string').slice(0, 7)
      : [],
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((w: any) => typeof w === 'string').slice(0, 5)
      : [],
  };
}

/**
 * Normalize interval steps from Gemini's variable naming conventions.
 * Gemini may return { distance, zone, description } or { distance_miles, pace_zone, description }
 * or other variations. We normalize to our IntervalStep schema.
 */
function normalizeIntervals(rawIntervals: any[]): IntervalStep[] {
  const validTypes = ['warmup', 'work', 'recovery', 'cooldown'];

  return rawIntervals
    .filter((step: any) => step && typeof step === 'object')
    .map((step: any): IntervalStep => {
      // Normalize type — Gemini sometimes uses "run", "stride", "jog", "rest"
      let type = step.type || 'work';
      if (type === 'run' || type === 'stride' || type === 'hard') type = 'work';
      if (type === 'jog' || type === 'rest' || type === 'easy') type = 'recovery';
      if (type === 'warm_up' || type === 'warm-up') type = 'warmup';
      if (type === 'cool_down' || type === 'cool-down') type = 'cooldown';
      if (!validTypes.includes(type)) type = 'work';

      // Normalize distance — Gemini uses distance, distance_miles, distanceMiles
      const distance = step.distance_miles ?? step.distanceMiles ?? step.distance ?? 0;

      // Normalize pace zone — Gemini uses pace_zone, paceZone, zone
      const zone = step.pace_zone ?? step.paceZone ?? step.zone ?? 'E';

      // Normalize description
      const description = step.description ?? step.desc ?? '';

      return {
        type: type as IntervalStep['type'],
        distance_miles: typeof distance === 'number' ? distance : 0,
        pace_zone: (typeof zone === 'string' ? zone : 'E') as IntervalStep['pace_zone'],
        description: typeof description === 'string' ? description : '',
      };
    });
}
