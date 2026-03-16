/**
 * AI Weekly Review — analyzes a completed training week and determines
 * if the plan needs adaptation.
 *
 * Triggered on app open when a new week starts.
 */

import { sendStructuredMessage, extractJSON, isGeminiAvailable } from './gemini';
import {
  UserProfile,
  PaceZones,
  Workout,
  TrainingWeek,
  PerformanceMetric,
  WeeklyDigest,
} from '../types';
import { formatPace } from '../engine/vdot';
import { formatPaceRange } from '../engine/paceZones';

// ─── Types ──────────────────────────────────────────────────

export interface WeeklyReview {
  summary: string;
  volumeComparison: string;
  highlights: string[];
  concerns: string[];
  nextWeekPreview: string;
  adaptationNeeded: boolean;
  adaptationReason: string | null;
  vdotAssessment: string | null;
}

// ─── System Prompt ──────────────────────────────────────────

const REVIEW_SYSTEM_INSTRUCTION = `You are an expert marathon running coach reviewing your athlete's completed training week.

Analyze their planned vs actual performance and provide a structured weekly review.

RESPOND ONLY WITH VALID JSON matching this schema. No markdown fences, no extra text.

{
  "summary": "One sentence summary of the week",
  "volumeComparison": "X of Y miles (Z%)",
  "highlights": ["positive observation 1", "positive observation 2"],
  "concerns": ["concern 1 if any"],
  "nextWeekPreview": "Brief preview of what's coming next week",
  "adaptationNeeded": false,
  "adaptationReason": null,
  "vdotAssessment": null
}

RULES:
1. Be concise — each field should be 1-2 sentences max.
2. "adaptationNeeded" should be true ONLY if:
   - Actual volume was <70% of target for this week AND the week before
   - Athlete completed significantly more than planned (>130%)
   - Evidence of injury or overtraining (very slow paces, high HR at easy effort)
3. "vdotAssessment" should note if recent race/hard effort paces suggest VDOT has changed.
4. Keep it encouraging but honest. Don't sugarcoat missed workouts.
5. Reference actual numbers, not generic motivation.`;

// ─── Review Generation ──────────────────────────────────────

export async function generateWeeklyReview(
  completedWeek: TrainingWeek,
  weekWorkouts: Workout[],
  weekMetrics: PerformanceMetric[],
  upcomingWeek: TrainingWeek | null,
  upcomingWorkouts: Workout[],
  profile: UserProfile,
  paceZones: PaceZones,
): Promise<WeeklyReview> {
  if (!isGeminiAvailable()) {
    return getDefaultReview(completedWeek, weekWorkouts, weekMetrics, upcomingWeek);
  }

  try {
    const userMessage = buildReviewMessage(
      completedWeek, weekWorkouts, weekMetrics,
      upcomingWeek, upcomingWorkouts, profile, paceZones,
    );

    const responseText = await sendStructuredMessage(REVIEW_SYSTEM_INSTRUCTION, userMessage);
    const raw = extractJSON(responseText);
    return validateReview(raw, completedWeek, weekMetrics);
  } catch (error) {
    console.warn('[WeeklyReview] Gemini failed, using default:', error);
    return getDefaultReview(completedWeek, weekWorkouts, weekMetrics, upcomingWeek);
  }
}

// ─── Message Builder ────────────────────────────────────────

function buildReviewMessage(
  week: TrainingWeek,
  workouts: Workout[],
  metrics: PerformanceMetric[],
  upcomingWeek: TrainingWeek | null,
  upcomingWorkouts: Workout[],
  profile: UserProfile,
  paceZones: PaceZones,
): string {
  const parts: string[] = [];

  parts.push(`WEEK ${week.week_number} REVIEW — ${week.phase.toUpperCase()} phase${week.is_cutback ? ' (cutback)' : ''}`);
  parts.push(`Target volume: ${week.target_volume}mi | Actual: ${week.actual_volume}mi`);
  parts.push('');

  parts.push('PLANNED vs ACTUAL:');
  for (const w of workouts) {
    const metric = metrics.find(m => m.workout_id === w.id);
    if (w.workout_type === 'rest') {
      parts.push(`  ${w.scheduled_date}: REST`);
      continue;
    }
    const planned = `${w.title} ${w.target_distance_miles}mi`;
    if (w.status === 'completed' && metric) {
      const pace = metric.avg_pace_sec_per_mile ? formatPace(metric.avg_pace_sec_per_mile) : '?';
      const hr = metric.avg_hr ? ` HR:${metric.avg_hr}` : '';
      parts.push(`  ${w.scheduled_date}: [DONE] ${planned} → actual ${metric.distance_miles.toFixed(1)}mi @ ${pace}/mi${hr}`);
    } else if (w.status === 'skipped') {
      parts.push(`  ${w.scheduled_date}: [SKIP] ${planned}`);
    } else {
      parts.push(`  ${w.scheduled_date}: [MISS] ${planned}`);
    }
  }
  parts.push('');

  parts.push(`Athlete: VDOT ${profile.vdot_score}, ${profile.experience_level}`);
  parts.push(`Pace zones: E ${formatPaceRange(paceZones.E)}, M ${formatPaceRange(paceZones.M)}, T ${formatPaceRange(paceZones.T)}`);
  parts.push('');

  if (upcomingWeek) {
    parts.push(`NEXT WEEK (${upcomingWeek.week_number}): ${upcomingWeek.phase} phase, ${upcomingWeek.target_volume}mi target${upcomingWeek.is_cutback ? ' (cutback)' : ''}`);
    const keyWorkouts = upcomingWorkouts
      .filter(w => w.workout_type !== 'rest' && w.workout_type !== 'easy' && w.workout_type !== 'recovery')
      .map(w => w.title);
    if (keyWorkouts.length > 0) {
      parts.push(`Key workouts: ${keyWorkouts.join(', ')}`);
    }
  }

  return parts.join('\n');
}

// ─── Validation ─────────────────────────────────────────────

function validateReview(raw: any, week: TrainingWeek, metrics: PerformanceMetric[]): WeeklyReview {
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : `Week ${week.week_number} complete.`,
    volumeComparison: typeof raw.volumeComparison === 'string'
      ? raw.volumeComparison
      : `${week.actual_volume.toFixed(1)} of ${week.target_volume}mi`,
    highlights: Array.isArray(raw.highlights) ? raw.highlights.filter((h: any) => typeof h === 'string').slice(0, 4) : [],
    concerns: Array.isArray(raw.concerns) ? raw.concerns.filter((c: any) => typeof c === 'string').slice(0, 3) : [],
    nextWeekPreview: typeof raw.nextWeekPreview === 'string' ? raw.nextWeekPreview : '',
    adaptationNeeded: typeof raw.adaptationNeeded === 'boolean' ? raw.adaptationNeeded : false,
    adaptationReason: typeof raw.adaptationReason === 'string' ? raw.adaptationReason : null,
    vdotAssessment: typeof raw.vdotAssessment === 'string' ? raw.vdotAssessment : null,
  };
}

// ─── Fallback ───────────────────────────────────────────────

function getDefaultReview(
  week: TrainingWeek,
  workouts: Workout[],
  metrics: PerformanceMetric[],
  upcomingWeek: TrainingWeek | null,
): WeeklyReview {
  const completed = workouts.filter(w => w.status === 'completed').length;
  const total = workouts.filter(w => w.workout_type !== 'rest').length;
  const adherence = total > 0 ? Math.round((completed / total) * 100) : 100;

  const highlights: string[] = [];
  if (adherence >= 90) highlights.push('Excellent consistency this week');
  if (adherence >= 70 && adherence < 90) highlights.push('Good week overall');

  const concerns: string[] = [];
  if (adherence < 70) concerns.push(`Only ${adherence}% of workouts completed`);

  return {
    summary: `Week ${week.week_number}: ${adherence}% adherence, ${week.actual_volume.toFixed(1)} of ${week.target_volume}mi.`,
    volumeComparison: `${week.actual_volume.toFixed(1)} of ${week.target_volume}mi (${Math.round((week.actual_volume / week.target_volume) * 100)}%)`,
    highlights,
    concerns,
    nextWeekPreview: upcomingWeek
      ? `Week ${upcomingWeek.week_number}: ${upcomingWeek.phase} phase, ${upcomingWeek.target_volume}mi target.`
      : '',
    adaptationNeeded: adherence < 50,
    adaptationReason: adherence < 50 ? `Low adherence (${adherence}%) — plan may need adjustment.` : null,
    vdotAssessment: null,
  };
}
