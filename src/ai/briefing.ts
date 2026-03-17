/**
 * AI Briefings — proactive coaching content.
 *
 * Pre-workout briefings, post-run analysis, weekly digests.
 * All cached aggressively. All fail silently. All fire async.
 */

import { sendStructuredMessage, isGeminiAvailable } from './gemini';
import { getCachedAIContent, setCachedAIContent } from '../db/database';
import {
  UserProfile,
  PaceZones,
  Workout,
  PerformanceMetric,
  TrainingWeek,
} from '../types';
import { formatPace, formatTime } from '../engine/vdot';
import { formatPaceRange } from '../engine/paceZones';
import * as Crypto from 'expo-crypto';

// ─── Cache Helpers ──────────────────────────────────────────

function hashInputs(...values: any[]): string {
  // Simple string hash for cache key
  const str = JSON.stringify(values);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─── Pre-Workout Briefing ───────────────────────────────────

export async function generateBriefing(
  workout: Workout,
  recentRuns: PerformanceMetric[],
  paceZones: PaceZones,
  profile: UserProfile,
  currentWeek: TrainingWeek | null,
  daysUntilRace: number,
  recoveryInfo?: string | null,
  weatherInfo?: string | null,
): Promise<string | null> {
  if (!isGeminiAvailable()) return null;
  if (workout.workout_type === 'rest') return null;

  // Check cache
  const cacheKey = hashInputs(
    workout.id,
    recentRuns.slice(0, 3).map(r => r.id),
    daysUntilRace,
  );
  const cached = getCachedAIContent('briefing', cacheKey);
  if (cached) return cached;

  try {
    const dist = workout.target_distance_miles ?? 0;
    const isLongRun = workout.workout_type === 'long' || workout.workout_type === 'long_run' || dist >= 10;

    // Build fueling plan for long runs
    let fuelingSection = '';
    if (isLongRun && dist >= 10) {
      const gelMiles: number[] = [];
      for (let m = 5; m < dist; m += 4) gelMiles.push(m);
      fuelingSection = `
FUELING PLAN (long run ${dist}mi):
- Pre-run: light carbs 2 hours before (banana, toast, oatmeal)
- During: take a gel or chew at mile ${gelMiles.join(' and mile ')}
- Hydration: drink every 15-20 minutes (4-6 oz per stop)
- Post-run: protein + carbs within 30 minutes
Include specific fueling advice in your briefing — runners forget to fuel and bonk.`;
    } else if (isLongRun || dist >= 8) {
      fuelingSection = `
FUELING NOTE: ${dist}mi run — bring water. Consider a gel if you tend to fade in the last miles.`;
    }

    const prompt = `You are a running coach giving a quick pre-workout briefing. ${isLongRun ? '3-5 sentences — include fueling and pacing strategy.' : '2-3 sentences max.'} Be specific, reference the workout details and recent performance. Encouraging but practical.

TODAY'S WORKOUT: ${workout.title} — ${dist}mi
Description: ${workout.description}
Week ${currentWeek?.week_number || '?'}, ${currentWeek?.phase || '?'} phase. ${daysUntilRace} days to race.

${recentRuns.length > 0 ? `LAST RUN: ${recentRuns[0].date} — ${recentRuns[0].distance_miles.toFixed(1)}mi @ ${recentRuns[0].avg_pace_sec_per_mile ? formatPace(recentRuns[0].avg_pace_sec_per_mile) : '?'}/mi${recentRuns[0].avg_hr ? ` HR:${recentRuns[0].avg_hr}` : ''}` : 'No recent data.'}

PACE ZONES: E ${formatPaceRange(paceZones.E)}, M ${formatPaceRange(paceZones.M)}, T ${formatPaceRange(paceZones.T)}

${recoveryInfo || 'Recovery data: not available'}

${weatherInfo || 'Weather: not available'}
${fuelingSection}
If weather data is provided, mention it — adjust pace recommendations for heat, cold, rain, or wind. This is what real coaches do.

Respond with ONLY the briefing text. No JSON, no formatting.`;

    const text = await sendStructuredMessage(
      'You are a concise running coach. Give pre-workout briefings in 2-3 sentences.',
      prompt,
    );

    const briefing = text.trim();
    setCachedAIContent('briefing', cacheKey, briefing);
    return briefing;
  } catch (error) {
    console.warn('[Briefing] Failed:', error);
    return null;
  }
}

// ─── Post-Run Analysis ──────────────────────────────────────

export async function generatePostRunAnalysis(
  workout: Workout,
  metric: PerformanceMetric,
  paceZones: PaceZones,
  profile: UserProfile,
): Promise<string | null> {
  if (!isGeminiAvailable()) return null;

  // Check cache
  const cacheKey = hashInputs(workout.id, metric.id);
  const cached = getCachedAIContent('analysis', cacheKey);
  if (cached) return cached;

  try {
    const targetPace = workout.target_pace_zone
      ? formatPaceRange((paceZones as any)[workout.target_pace_zone] || paceZones.E)
      : 'N/A';

    let splitsInfo = '';
    if (metric.splits_json) {
      try {
        const splits = JSON.parse(metric.splits_json);
        if (Array.isArray(splits) && splits.length > 0) {
          const paces = splits.map((s: any) => {
            const pace = s.averageSpeed > 0 ? Math.round(1609.344 / s.averageSpeed) : 0;
            return pace > 0 ? formatPace(pace) : '?';
          });
          splitsInfo = `\nSPLITS (per mile): ${paces.join(', ')}`;
        }
      } catch {}
    }

    // Detect HR drift from Strava streams (long runs)
    let hrDriftInfo = '';
    try {
      const isLongish = (workout.target_distance_miles ?? 0) >= 8 || metric.distance_miles >= 8;
      if (isLongish && metric.strava_activity_id) {
        const { getDatabase } = require('../db/database');
        const detail = getDatabase().getFirstSync(
          'SELECT hr_stream_json, pace_stream_json FROM strava_activity_detail WHERE strava_activity_id = ?',
          [metric.strava_activity_id]
        ) as any;
        if (detail?.hr_stream_json) {
          const hrStream: number[] = JSON.parse(detail.hr_stream_json);
          if (hrStream.length >= 20) {
            // Compare first quarter avg HR vs last quarter avg HR at similar effort
            const q = Math.floor(hrStream.length / 4);
            const firstQHR = hrStream.slice(0, q).reduce((s, v) => s + v, 0) / q;
            const lastQHR = hrStream.slice(-q).reduce((s, v) => s + v, 0) / q;
            const drift = Math.round(lastQHR - firstQHR);
            if (drift >= 15) {
              hrDriftInfo = `\nHR DRIFT DETECTED: HR climbed from avg ${Math.round(firstQHR)} bpm (first quarter) to ${Math.round(lastQHR)} bpm (last quarter) — a ${drift} bpm drift. This suggests dehydration or overheating. Mention this in your analysis.`;
            } else if (drift >= 10) {
              hrDriftInfo = `\nMILD HR DRIFT: HR rose ${drift} bpm from first to last quarter (${Math.round(firstQHR)} → ${Math.round(lastQHR)} bpm). Normal for long runs but worth noting.`;
            }
          }
        }
      }
    } catch {}

    // Check yesterday's cross-training for context
    let ctContext = '';
    try {
      const { getCrossTrainingForDate } = require('../db/database');
      const { CROSS_TRAINING_LABELS } = require('../types');
      const runDate = new Date(metric.date + 'T12:00:00');
      const yesterday = new Date(runDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const yCT = getCrossTrainingForDate(yesterdayStr);
      if (yCT && (yCT.impact === 'high' || yCT.impact === 'moderate')) {
        ctContext = `\nNote: Athlete logged ${CROSS_TRAINING_LABELS[yCT.type] ?? yCT.type} (${yCT.impact} impact) yesterday — may explain slower pace or higher effort.`;
      }
    } catch {}

    const prompt = `You are a running coach analyzing a completed workout. 3-4 sentences. Be specific about pace, effort, and what went well or needs work. Reference actual numbers.

PLANNED: ${workout.title} — ${workout.target_distance_miles}mi at ${workout.target_pace_zone || workout.workout_type} (target: ${targetPace})

ACTUAL: ${metric.distance_miles.toFixed(1)}mi in ${metric.duration_minutes.toFixed(0)}min
Avg pace: ${metric.avg_pace_sec_per_mile ? formatPace(metric.avg_pace_sec_per_mile) : '?'}/mi
${metric.avg_hr ? `Avg HR: ${metric.avg_hr}` : ''}${metric.max_hr ? ` | Max HR: ${metric.max_hr}` : ''}
${metric.perceived_exertion ? `RPE: ${metric.perceived_exertion}/10` : ''}${splitsInfo}${hrDriftInfo}${ctContext}

Respond with ONLY the analysis text. No JSON, no formatting.`;

    const text = await sendStructuredMessage(
      'You are a concise running coach. Analyze completed workouts in 3-4 sentences.',
      prompt,
    );

    const analysis = text.trim();
    setCachedAIContent('analysis', cacheKey, analysis);
    return analysis;
  } catch (error) {
    console.warn('[Analysis] Failed:', error);
    return null;
  }
}

// ─── Race Week Pacing Strategy ──────────────────────────────

export async function generateRaceStrategy(
  profile: UserProfile,
  paceZones: PaceZones,
  recentMetrics: PerformanceMetric[],
): Promise<string | null> {
  if (!isGeminiAvailable()) return null;

  const cacheKey = hashInputs('race_strategy', profile.vdot_score, profile.race_date);
  const cached = getCachedAIContent('race_strategy', cacheKey);
  if (cached) return cached;

  try {
    const recentSummary = recentMetrics.slice(0, 5).map(m => {
      const pace = m.avg_pace_sec_per_mile ? formatPace(m.avg_pace_sec_per_mile) : '?';
      return `${m.date}: ${m.distance_miles.toFixed(1)}mi @ ${pace}/mi`;
    }).join('\n');

    const prompt = `You are a marathon running coach. Your athlete's race is in a few days. Give a specific race-day pacing strategy.

ATHLETE: VDOT ${profile.vdot_score}, ${profile.experience_level}
RACE: ${profile.race_name || 'Marathon'}, course: ${profile.race_course_profile}
${profile.target_finish_time_sec ? `Goal: ${formatTime(profile.target_finish_time_sec)}` : `Predicted: ${formatTime(require('../engine/vdot').predictMarathonTime(profile.vdot_score))}`}
Marathon pace zone: ${formatPaceRange(paceZones.M)}

RECENT RUNS:
${recentSummary || 'No recent data'}

Include:
1. Mile-by-mile pacing strategy (first 5K, 10K-half, half-30K, 30K-finish)
2. Fueling/hydration timing
3. Mental strategy for the wall (miles 20-22)
4. Course-specific advice if the course is hilly

Keep it to ~200 words. Specific paces, not ranges.
Respond with ONLY the strategy text.`;

    const text = await sendStructuredMessage(
      'You are a marathon running coach giving race-day strategy.',
      prompt,
    );

    const strategy = text.trim();
    setCachedAIContent('race_strategy', cacheKey, strategy);
    return strategy;
  } catch (error) {
    console.warn('[RaceStrategy] Failed:', error);
    return null;
  }
}
