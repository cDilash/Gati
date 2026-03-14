import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import { Workout, RecoveryStatus, PerformanceMetric, PaceZones, WeatherData } from '../types';
import { formatPace } from '../engine/vdot';
import { generateContextHash, getCachedBriefing, setCachedBriefing } from './cacheHelper';
import { canMakeAPICall, incrementAPICallCount } from './rateLimiter';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

const FALLBACK = 'Unable to generate briefing';

function paceStr(seconds: number): string {
  return formatPace(seconds);
}

function buildPreWorkoutUserMessage(
  workout: Workout,
  paceZones: PaceZones,
  recoveryStatus: RecoveryStatus | null,
  recentMetrics: PerformanceMetric[],
  weather: WeatherData | null,
): string {
  const zone = workout.target_pace_zone;
  const paceRange = paceZones[zone];
  const lines: string[] = [];

  lines.push(`Today's workout: ${workout.workout_type}, ${workout.distance_miles} miles, ${zone} zone (${paceStr(paceRange.max)}-${paceStr(paceRange.min)}/mi)`);

  if (workout.intervals && workout.intervals.length > 0) {
    lines.push(`Structure: ${workout.intervals.map(s => `${s.type}: ${s.distance_miles}mi @ ${s.pace_zone}`).join(' → ')}`);
  }

  if (recoveryStatus && recoveryStatus.signalCount >= 2) {
    lines.push(`Recovery score: ${recoveryStatus.score}/100 (${recoveryStatus.recommendation})`);
    for (const sig of recoveryStatus.signals) {
      lines.push(`  ${sig.type}: ${sig.value} (${sig.status})`);
    }
  }

  if (recentMetrics.length > 0) {
    const last = recentMetrics[0];
    lines.push(`Last run: ${last.distance_miles}mi in ${paceStr(last.avg_pace_per_mile)}/mi${last.avg_hr ? ` @ ${last.avg_hr}bpm` : ''}`);
  }

  if (weather) {
    lines.push(`Weather: ${weather.temp}°F, ${weather.humidity}% humidity, ${weather.condition}`);
  }

  return lines.join('\n');
}

export async function generatePreWorkoutBriefing(
  workout: Workout,
  recoveryStatus: RecoveryStatus | null,
  recentMetrics: PerformanceMetric[],
  weather: WeatherData | null,
  paceZones: PaceZones,
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const hashData = {
    workoutId: workout.id,
    recoveryScore: recoveryStatus?.score ?? null,
    weatherTemp: weather?.temp ?? null,
  };
  const contextHash = generateContextHash(hashData);

  // Check cache first
  const cached = getCachedBriefing('pre_workout', today, contextHash);
  if (cached) return cached;

  if (!canMakeAPICall()) return FALLBACK;

  try {
    incrementAPICallCount();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are a marathon running coach. Give a concise pre-workout briefing in 2-4 sentences. Be specific — use actual pace numbers, distances, and zone names. Never use generic motivation. Reference recovery data if provided. Reference weather if provided.',
    });

    const userMessage = buildPreWorkoutUserMessage(workout, paceZones, recoveryStatus, recentMetrics, weather);
    const result = await model.generateContent(userMessage);
    const text = result.response.text().trim();

    if (text) {
      setCachedBriefing('pre_workout', today, contextHash, text);
    }

    return text || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function buildPostRunUserMessage(
  workout: Workout,
  metric: PerformanceMetric | null,
  paceZones: PaceZones,
  recoveryStatus: RecoveryStatus | null,
  weekContext: { targetVolume: number; completedVolume: number; remainingWorkouts: number },
  stravaDetail?: any,
): string {
  const zone = workout.target_pace_zone;
  const paceRange = paceZones[zone];
  const lines: string[] = [];

  lines.push(`Completed workout: ${workout.workout_type}, ${workout.distance_miles}mi planned, ${zone} zone (target: ${paceStr(paceRange.max)}-${paceStr(paceRange.min)}/mi)`);

  if (metric) {
    lines.push(`Actual: ${metric.distance_miles}mi, ${paceStr(metric.avg_pace_per_mile)}/mi avg pace${metric.avg_hr ? `, ${metric.avg_hr}bpm avg HR` : ''}`);

    // Compare actual vs target
    if (metric.avg_pace_per_mile < paceRange.max) {
      lines.push('Note: ran FASTER than target zone');
    } else if (metric.avg_pace_per_mile > paceRange.min) {
      lines.push('Note: ran SLOWER than target zone');
    } else {
      lines.push('Note: pace was within target zone');
    }
  } else {
    lines.push('No GPS/watch data available for this run');
  }

  // Strava per-mile splits for deeper analysis
  if (stravaDetail?.splits && stravaDetail.splits.length > 0) {
    const splitLines = stravaDetail.splits.map((s: any) => {
      const paceSec = s.movingTime > 0 && s.distance > 0
        ? Math.round((s.movingTime / s.distance) * 1609.344)
        : 0;
      return `  Mile ${s.split}: ${paceStr(paceSec)}/mi${s.averageHeartrate ? ` @ ${Math.round(s.averageHeartrate)}bpm` : ''}`;
    });
    lines.push(`Per-mile splits:\n${splitLines.join('\n')}`);
  }

  // Strava elevation and cadence
  if (stravaDetail) {
    const extras: string[] = [];
    if (stravaDetail.elevation_gain_ft) extras.push(`${Math.round(stravaDetail.elevation_gain_ft)}ft elevation gain`);
    if (stravaDetail.cadence_avg) extras.push(`${Math.round(stravaDetail.cadence_avg * 2)} spm cadence`);
    if (stravaDetail.suffer_score) extras.push(`relative effort: ${stravaDetail.suffer_score}`);
    if (extras.length > 0) lines.push(`Extras: ${extras.join(', ')}`);
  }

  if (recoveryStatus && recoveryStatus.signalCount >= 2) {
    lines.push(`Pre-run recovery: ${recoveryStatus.score}/100 (${recoveryStatus.recommendation})`);
  }

  lines.push(`Week volume: ${weekContext.completedVolume.toFixed(1)}/${weekContext.targetVolume.toFixed(1)} mi completed, ${weekContext.remainingWorkouts} workouts remaining`);

  return lines.join('\n');
}

export async function generatePostRunAnalysis(
  workout: Workout,
  metric: PerformanceMetric | null,
  recoveryStatus: RecoveryStatus | null,
  paceZones: PaceZones,
  weekContext: { targetVolume: number; completedVolume: number; remainingWorkouts: number },
  stravaDetail?: any,
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const hashData = {
    workoutId: workout.id,
    metricPace: metric?.avg_pace_per_mile ?? null,
    metricDistance: metric?.distance_miles ?? null,
    hasSplits: !!(stravaDetail?.splits?.length),
  };
  const contextHash = generateContextHash(hashData);

  const cached = getCachedBriefing('post_run', today, contextHash);
  if (cached) return cached;

  if (!canMakeAPICall()) return FALLBACK;

  try {
    incrementAPICallCount();
    const systemPrompt = stravaDetail?.splits?.length
      ? "You are a marathon running coach reviewing a just-completed workout with per-mile split data from Strava. Give specific feedback in 3-5 sentences. Analyze split consistency — flag positive splits (slowing down) or negative splits (speeding up). Reference actual paces vs targets. Call out if easy runs were too fast. If HR data is available per split, note cardiac drift. Mention volume progress for the week. Preview what's next. Never say 'great job' without specifics."
      : "You are a marathon running coach reviewing a just-completed workout. Give specific feedback in 3-5 sentences. Reference actual paces vs targets. Call out if easy runs were too fast. Mention volume progress for the week. Preview what's next. Never say 'great job' without specifics.";

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    const userMessage = buildPostRunUserMessage(workout, metric, paceZones, recoveryStatus, weekContext, stravaDetail);
    const result = await model.generateContent(userMessage);
    const text = result.response.text().trim();

    if (text) {
      setCachedBriefing('post_run', today, contextHash, text);
    }

    return text || FALLBACK;
  } catch {
    return FALLBACK;
  }
}
