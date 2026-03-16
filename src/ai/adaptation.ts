/**
 * AI Adaptation — when things change, AI re-plans the remaining weeks.
 *
 * Triggers: missed workouts, injury, great performance, user request.
 * Preserves completed workouts. Only modifies future weeks.
 * Safety validator runs on the adapted plan too.
 */

import { sendStructuredMessage, extractJSON, isGeminiAvailable } from './gemini';
import { validateAndCorrectPlan } from './safetyValidator';
import {
  UserProfile,
  PaceZones,
  PerformanceMetric,
  Workout,
  TrainingWeek,
  AIGeneratedPlan,
  AIWeek,
  AIWorkout,
  IntervalStep,
  SafetyValidation,
} from '../types';
import { formatPace, formatTime } from '../engine/vdot';
import { formatPaceRange } from '../engine/paceZones';

// ─── System Prompt ──────────────────────────────────────────

const ADAPTATION_SYSTEM_INSTRUCTION = `You are the marathon coach who created this athlete's training plan. Something has changed, and you need to adapt the REMAINING weeks of the plan.

RESPOND ONLY WITH VALID JSON — the updated plan from the current week forward. Do not include past weeks. No markdown fences, no explanation.

OUTPUT SCHEMA (same as plan generation, but only future weeks):
{
  "weeks": [ ... ],
  "coachingNotes": "What changed and why you made these adjustments",
  "keyPrinciples": ["Updated principles"],
  "warnings": ["New warnings if any"]
}

RULES:
1. PRESERVE completed workouts — never modify the past.
2. Adjust future weeks based on what happened.
3. All safety rules apply: volume progression ≤15%/week, long run ≤35%, quality ≤20%, taper in last 3 weeks.
4. If the athlete missed time, DON'T try to "make up" the volume — rebuild gradually.
5. If performance improved, you may increase pace targets or add quality.
6. If the athlete reports pain/injury, immediately reduce volume and remove intensity.
7. The race date hasn't changed — work backward from there.
8. Always maintain the taper in the final 3 weeks regardless of what happened.
9. If fewer than 4 weeks remain, keep it conservative — no big changes.

Be specific about WHY you're making each change. Include your reasoning in the week-level aiNotes field.

WORKOUT TYPES: easy, long_run, threshold, intervals, hill_repeats, fartlek, marathon_pace, tempo, recovery, rest
Day numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.`;

// ─── Adaptation ─────────────────────────────────────────────

export interface AdaptationResult {
  plan: AIGeneratedPlan;
  validation: SafetyValidation;
  changesSummary: string;
}

export async function adaptPlan(
  reason: string,
  currentWeekNumber: number,
  totalWeeks: number,
  completedWorkouts: Workout[],
  recentMetrics: PerformanceMetric[],
  existingPlan: AIGeneratedPlan,
  profile: UserProfile,
  paceZones: PaceZones,
): Promise<AdaptationResult> {
  if (!isGeminiAvailable()) {
    throw new Error('Gemini API key not configured');
  }

  const userMessage = buildAdaptationMessage(
    reason, currentWeekNumber, totalWeeks,
    completedWorkouts, recentMetrics, existingPlan, profile, paceZones,
  );

  console.log(`[Adapt] Requesting adaptation: "${reason}" from week ${currentWeekNumber}`);
  const responseText = await sendStructuredMessage(ADAPTATION_SYSTEM_INSTRUCTION, userMessage, 'heavy');
  const raw = extractJSON(responseText);

  // Validate the adapted plan
  const adaptedPlan = validateAndCleanAdaptation(raw, currentWeekNumber, totalWeeks);

  // Merge: keep past weeks from existing plan, replace future with adapted
  const pastWeeks = existingPlan.weeks.filter(w => w.weekNumber < currentWeekNumber);
  const merged: AIGeneratedPlan = {
    weeks: [...pastWeeks, ...adaptedPlan.weeks],
    coachingNotes: adaptedPlan.coachingNotes,
    keyPrinciples: adaptedPlan.keyPrinciples,
    warnings: adaptedPlan.warnings,
  };

  // Safety validate the full merged plan
  const validation = validateAndCorrectPlan(merged, profile);

  // Build changes summary
  const futureWeekCount = adaptedPlan.weeks.length;
  const changesSummary = `Updated weeks ${currentWeekNumber}-${totalWeeks} (${futureWeekCount} weeks). Reason: ${reason}. ${adaptedPlan.coachingNotes}`;

  console.log(`[Adapt] Merged plan: ${merged.weeks.length} total weeks, ${validation.violations.length} safety corrections`);

  return {
    plan: validation.correctedPlan,
    validation,
    changesSummary,
  };
}

// ─── User Message Builder ───────────────────────────────────

function buildAdaptationMessage(
  reason: string,
  currentWeekNumber: number,
  totalWeeks: number,
  completedWorkouts: Workout[],
  recentMetrics: PerformanceMetric[],
  existingPlan: AIGeneratedPlan,
  profile: UserProfile,
  paceZones: PaceZones,
): string {
  const parts: string[] = [];

  parts.push(`WHAT HAPPENED: ${reason}`);
  parts.push(`CURRENT WEEK: ${currentWeekNumber} of ${totalWeeks}`);
  parts.push(`GENERATE UPDATED PLAN FOR WEEKS ${currentWeekNumber} through ${totalWeeks}.`);
  parts.push('');

  // Athlete profile (condensed)
  parts.push('ATHLETE:');
  parts.push(`- VDOT: ${profile.vdot_score}, Level: ${profile.experience_level}`);
  parts.push(`- Weekly mileage base: ${profile.current_weekly_miles}mi`);
  parts.push(`- Race: ${profile.race_name || 'Marathon'} on ${profile.race_date}`);
  if (profile.injury_history.length > 0) {
    parts.push(`- Injury history: ${profile.injury_history.join(', ')}`);
  }
  parts.push('');

  // Pace zones
  parts.push('PACE ZONES:');
  parts.push(`E: ${formatPaceRange(paceZones.E)}, M: ${formatPaceRange(paceZones.M)}, T: ${formatPaceRange(paceZones.T)}, I: ${formatPaceRange(paceZones.I)}`);
  parts.push('');

  // Schedule
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  parts.push(`Available days: ${profile.available_days.map(d => dayNames[d]).join(', ')}`);
  parts.push(`Long run day: ${dayNames[profile.long_run_day]}`);
  parts.push('');

  // Recent actual performance
  if (recentMetrics.length > 0) {
    parts.push('RECENT RUNS (last 14 days):');
    for (const m of recentMetrics.slice(0, 10)) {
      const pace = m.avg_pace_sec_per_mile ? formatPace(m.avg_pace_sec_per_mile) : '?';
      const hr = m.avg_hr ? ` HR:${m.avg_hr}` : '';
      parts.push(`  ${m.date}: ${m.distance_miles.toFixed(1)}mi @ ${pace}/mi${hr}`);
    }
    parts.push('');
  }

  // Recent completed workouts vs plan
  const recentCompleted = completedWorkouts.slice(-14);
  if (recentCompleted.length > 0) {
    parts.push('RECENT COMPLETED WORKOUTS:');
    for (const w of recentCompleted) {
      parts.push(`  ${w.scheduled_date}: ${w.title} — ${w.target_distance_miles}mi (${w.status})`);
    }
    parts.push('');
  }

  // What the remaining plan currently looks like
  const futureWeeks = existingPlan.weeks.filter(w => w.weekNumber >= currentWeekNumber);
  if (futureWeeks.length > 0) {
    parts.push('CURRENT REMAINING PLAN (what you need to adapt):');
    for (const w of futureWeeks) {
      const types = w.workouts.filter(wo => wo.type !== 'rest').map(wo => wo.type).join(', ');
      parts.push(`  Week ${w.weekNumber} [${w.phase}]: ${w.targetVolume}mi — ${types}${w.isCutback ? ' (cutback)' : ''}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ─── Response Validation ────────────────────────────────────

function validateAndCleanAdaptation(raw: any, currentWeek: number, totalWeeks: number): AIGeneratedPlan {
  if (!raw || !Array.isArray(raw.weeks) || raw.weeks.length === 0) {
    throw new Error('Invalid adaptation: missing or empty weeks array');
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
      weekNumber: typeof w.weekNumber === 'number' ? w.weekNumber : currentWeek + i,
      phase: validPhases.includes(w.phase) ? w.phase : 'build',
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

// ─── Interval Normalizer (same as planGenerator) ────────────

function normalizeIntervals(rawIntervals: any[]): IntervalStep[] {
  const validTypes = ['warmup', 'work', 'recovery', 'cooldown'];
  return rawIntervals
    .filter((step: any) => step && typeof step === 'object')
    .map((step: any): IntervalStep => {
      let type = step.type || 'work';
      if (type === 'run' || type === 'stride' || type === 'hard') type = 'work';
      if (type === 'jog' || type === 'rest' || type === 'easy') type = 'recovery';
      if (type === 'warm_up' || type === 'warm-up') type = 'warmup';
      if (type === 'cool_down' || type === 'cool-down') type = 'cooldown';
      if (!validTypes.includes(type)) type = 'work';

      const distance = step.distance_miles ?? step.distanceMiles ?? step.distance ?? 0;
      const zone = step.pace_zone ?? step.paceZone ?? step.zone ?? 'E';
      const description = step.description ?? step.desc ?? '';

      return {
        type: type as IntervalStep['type'],
        distance_miles: typeof distance === 'number' ? distance : 0,
        pace_zone: (typeof zone === 'string' ? zone : 'E') as IntervalStep['pace_zone'],
        description: typeof description === 'string' ? description : '',
      };
    });
}
