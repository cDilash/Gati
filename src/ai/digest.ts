import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import { TrainingWeek, Workout, PerformanceMetric, PlanReconciliation } from '../types';
import { formatPace } from '../engine/vdot';
import { generateContextHash, getCachedBriefing, setCachedBriefing } from './cacheHelper';
import { canMakeAPICall, incrementAPICallCount } from './rateLimiter';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export interface WeeklyDigest {
  headline: string;
  volumeSummary: string;
  highlights: string[];
  concerns: string[];
  recoveryTrend: string;
  adaptiveActions: string[];
  nextWeekPreview: string;
  coachNote: string;
}

const FALLBACK_DIGEST: WeeklyDigest = {
  headline: 'Weekly summary unavailable',
  volumeSummary: '',
  highlights: [],
  concerns: [],
  recoveryTrend: '',
  adaptiveActions: [],
  nextWeekPreview: '',
  coachNote: '',
};

function buildDigestPrompt(
  completedWeek: TrainingWeek,
  weekWorkouts: Workout[],
  weekMetrics: PerformanceMetric[],
  reconciliation: PlanReconciliation,
  recoveryScores: number[],
  upcomingWeek: TrainingWeek | null,
  upcomingWorkouts: Workout[],
): string {
  const lines: string[] = [];

  lines.push(`Week ${completedWeek.week_number} Summary (${completedWeek.phase} phase${completedWeek.is_cutback ? ', cutback' : ''}):`);
  lines.push(`Volume: ${reconciliation.actualVolume.toFixed(1)}/${reconciliation.plannedVolume.toFixed(1)} mi (${Math.round(reconciliation.completionRate * 100)}% completion)`);
  lines.push(`ACWR: ${reconciliation.acwr.toFixed(2)}`);

  lines.push('\nWorkouts:');
  for (const w of weekWorkouts) {
    if (w.workout_type === 'rest') continue;
    const metric = weekMetrics.find(m => m.workout_id === w.id);
    const status = w.status === 'completed' ? '✓' : w.status === 'skipped' ? '✕' : '–';
    let detail = `  ${status} ${w.workout_type} ${w.distance_miles}mi @ ${w.target_pace_zone}`;
    if (metric) {
      detail += ` → actual: ${metric.distance_miles}mi, ${formatPace(metric.avg_pace_per_mile)}/mi`;
      if (metric.avg_hr) detail += `, ${metric.avg_hr}bpm`;
    }
    lines.push(detail);
  }

  if (recoveryScores.length > 0) {
    const avg = Math.round(recoveryScores.reduce((s, v) => s + v, 0) / recoveryScores.length);
    lines.push(`\nRecovery scores this week: ${recoveryScores.join(', ')} (avg: ${avg})`);
  }

  if (reconciliation.adjustments.length > 0) {
    lines.push(`\nAuto-adjustments made: ${reconciliation.adjustments.length}`);
    for (const adj of reconciliation.adjustments) {
      lines.push(`  - ${adj.reason}`);
    }
  }

  if (reconciliation.vdotUpdate) {
    lines.push(`\nVDOT updated: ${reconciliation.vdotUpdate.previousVDOT} → ${reconciliation.vdotUpdate.newVDOT} (${reconciliation.vdotUpdate.reason})`);
  }

  if (upcomingWeek) {
    lines.push(`\nNext week (W${upcomingWeek.week_number}, ${upcomingWeek.phase}${upcomingWeek.is_cutback ? ' cutback' : ''}):`);
    lines.push(`  Target volume: ${upcomingWeek.target_volume_miles.toFixed(1)} mi`);
    for (const w of upcomingWorkouts) {
      if (w.workout_type === 'rest') continue;
      lines.push(`  ${w.workout_type} ${w.distance_miles}mi @ ${w.target_pace_zone}`);
    }
  }

  return lines.join('\n');
}

export async function generateWeeklyDigest(
  completedWeek: TrainingWeek,
  weekWorkouts: Workout[],
  weekMetrics: PerformanceMetric[],
  reconciliation: PlanReconciliation,
  recoveryScores: number[],
  upcomingWeek: TrainingWeek | null,
  upcomingWorkouts: Workout[],
): Promise<WeeklyDigest> {
  const contextHash = generateContextHash({
    weekNumber: completedWeek.week_number,
    actualVolume: reconciliation.actualVolume,
    completionRate: reconciliation.completionRate,
  });

  // Check cache — digest is keyed by week number
  const cached = getCachedBriefing('weekly_digest', `week-${completedWeek.week_number}`, contextHash);
  if (cached) {
    try {
      return JSON.parse(cached) as WeeklyDigest;
    } catch {
      // Corrupted cache — regenerate
    }
  }

  if (!canMakeAPICall()) return FALLBACK_DIGEST;

  try {
    incrementAPICallCount();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `You are a marathon running coach generating a weekly training digest. Respond ONLY in valid JSON matching this exact structure (no markdown, no code fences):
{"headline":"string","volumeSummary":"string","highlights":["string"],"concerns":["string"],"recoveryTrend":"string","adaptiveActions":["string"],"nextWeekPreview":"string","coachNote":"string"}

Rules:
- headline: 1 sentence summarizing the week (include volume numbers)
- volumeSummary: actual vs planned with percentage
- highlights: 1-3 specific positives (reference actual paces, distances)
- concerns: 0-2 specific issues (empty array if none)
- recoveryTrend: 1 sentence about recovery scores trend
- adaptiveActions: list any auto-adjustments that were made (empty if none)
- nextWeekPreview: 1-2 sentences previewing next week's focus
- coachNote: 1 sentence of specific, data-backed coaching advice (never generic motivation)`,
    });

    const userMessage = buildDigestPrompt(
      completedWeek, weekWorkouts, weekMetrics,
      reconciliation, recoveryScores, upcomingWeek, upcomingWorkouts,
    );

    const result = await model.generateContent(userMessage);
    let text = result.response.text().trim();

    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const digest = JSON.parse(text) as WeeklyDigest;

    // Validate structure
    if (!digest.headline || !digest.volumeSummary) {
      return FALLBACK_DIGEST;
    }

    // Cache the digest
    setCachedBriefing('weekly_digest', `week-${completedWeek.week_number}`, contextHash, JSON.stringify(digest));

    return digest;
  } catch {
    return FALLBACK_DIGEST;
  }
}
