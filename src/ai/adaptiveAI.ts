import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import {
  AdaptiveAIResponse,
  AdaptiveEventContext,
  WorkoutAdjustment,
  PaceZones,
  UserProfile,
  TrainingWeek,
  Workout,
} from '../types';
import { withRetry } from './gemini';

const apiKey = Constants.expoConfig?.extra?.geminiApiKey;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// ─── Helpers ────────────────────────────────────────────────

function formatSecondsAsPace(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatPaceZoneRange(paceZones: PaceZones, zone: string): string {
  const z = paceZones[zone as keyof PaceZones];
  if (!z) return 'N/A';
  // min is slower (higher seconds), max is faster (lower seconds)
  return `${formatSecondsAsPace(z.min)}-${formatSecondsAsPace(z.max)}/mi`;
}

// ─── Prompt Builder ─────────────────────────────────────────

export function buildAdaptivePrompt(ctx: AdaptiveEventContext): string {
  const {
    eventType, workout, metric, stravaDetail, profile, acwr,
    banisterState, recoveryStatus, rpeTrend, currentVDOT, paceZones,
    daysUntilRace, currentPhase, weekNumber, proposedAdjustments,
    proposedVDOTUpdate, recentAdaptiveLogs,
  } = ctx;

  const goalTime = profile.goal_marathon_time_seconds
    ? formatSecondsAsPace(profile.goal_marathon_time_seconds)
    : 'not set';

  // ACWR status label
  let acwrStatus = 'NORMAL';
  if (acwr > 1.5) acwrStatus = 'CRITICAL';
  else if (acwr > 1.3) acwrStatus = 'ELEVATED';
  else if (acwr < 0.8) acwrStatus = 'LOW';

  let prompt = `ROLE: You are an elite marathon coach and sports scientist making real-time training adjustments. Respond with ONLY valid JSON matching the schema below.

═══ RUNNER PROFILE ═══
VDOT: ${currentVDOT}
Age: ${profile.age} | Weight: ${profile.weight_lbs} lbs
Max HR: ${profile.max_hr} | Resting HR: ${profile.resting_hr}
Race: ${profile.race_distance} on ${profile.race_date} (${daysUntilRace} days away)
Goal time: ${goalTime}
Phase: ${currentPhase} | Week: ${weekNumber}

═══ CURRENT STATE ═══
ACWR: ${acwr.toFixed(2)} [${acwrStatus}]
Banister: readiness=${banisterState.readiness.toFixed(0)}/100, fitness=${banisterState.fitness.toFixed(1)}, fatigue=${banisterState.fatigue.toFixed(1)}, recommendation=${banisterState.recommendation}
Recovery: ${recoveryStatus ? `score=${recoveryStatus.score}/100, recommendation=${recoveryStatus.recommendation}, signals=${recoveryStatus.signalCount}` : 'unavailable'}
RPE trend: ${rpeTrend ? `${rpeTrend.trend} (avg RPE ${rpeTrend.avgRPE.toFixed(1)}, n=${rpeTrend.sampleSize})` : 'insufficient data'}

═══ EVENT ═══
Type: ${eventType}
Workout: ${workout.workout_type} | ${workout.distance_miles} mi | Zone ${workout.target_pace_zone} | Date: ${workout.date}`;

  if (metric) {
    const avgPace = formatSecondsAsPace(metric.avg_pace_per_mile);
    const targetRange = formatPaceZoneRange(paceZones, workout.target_pace_zone);
    const durationMins = (metric.duration_seconds / 60).toFixed(1);
    prompt += `

═══ ACTUAL PERFORMANCE ═══
Distance: ${metric.distance_miles.toFixed(2)} mi
Duration: ${durationMins} min
Avg pace: ${avgPace}/mi (target zone ${workout.target_pace_zone}: ${targetRange})
Avg HR: ${metric.avg_hr || 'N/A'} | Max HR: ${metric.max_hr || 'N/A'}
RPE: ${metric.rpe_score ?? 'N/A'}`;
  }

  if (stravaDetail) {
    prompt += `

═══ STRAVA DETAIL ═══
Suffer score: ${stravaDetail.suffer_score ?? 'N/A'}
Cadence: ${stravaDetail.cadence_avg ?? 'N/A'} spm
Elevation gain: ${stravaDetail.elevation_gain_ft ?? 'N/A'} ft
Race type: ${stravaDetail.strava_workout_type === 1 ? 'YES' : 'no'}`;
  }

  if (proposedAdjustments.length > 0) {
    prompt += `

═══ PROPOSED ADJUSTMENTS (deterministic engine) ═══
${proposedAdjustments.map((a, i) => `${i + 1}. [${a.adjustmentType}] workout ${a.workoutId}: ${a.originalDistance}→${a.newDistance} mi, ${a.originalType}→${a.newType} — "${a.reason}"`).join('\n')}`;
  }

  if (proposedVDOTUpdate) {
    prompt += `

═══ PROPOSED VDOT UPDATE ═══
Current: ${proposedVDOTUpdate.previousVDOT} → Proposed: ${proposedVDOTUpdate.newVDOT}
Confidence: ${proposedVDOTUpdate.confidenceLevel}
Reason: ${proposedVDOTUpdate.reason}`;
  }

  if (recentAdaptiveLogs.length > 0) {
    const recent = recentAdaptiveLogs.slice(0, 5);
    prompt += `

═══ RECENT ADAPTIVE HISTORY (last 7 days) ═══
${recent.map(l => `- [${l.type}] ${l.timestamp.slice(0, 10)}: ${l.summary}`).join('\n')}`;
  }

  prompt += `

═══ RESPONSE SCHEMA ═══
{
  "decisions": [
    {
      "workoutId": "id of proposed adjustment workout",
      "action": "approve" | "modify" | "reject",
      "adjustedValues": { "distance_miles": number, "workout_type": string, "target_pace_zone": string },
      "reasoning": "brief explanation"
    }
  ],
  "additions": [
    {
      "workoutId": "id of workout to additionally adjust",
      "adjustmentType": "reduce_distance" | "increase_distance" | "convert_to_easy" | "convert_to_rest" | "reschedule",
      "newDistance": number,
      "newType": string,
      "reasoning": "brief explanation"
    }
  ],
  "summary": "1-2 sentence coaching summary for the athlete",
  "replanNeeded": false,
  "replanReason": "only if replanNeeded is true",
  "vdotUpdate": null or { "newVdot": number, "confidence": "high"|"moderate", "reasoning": "explanation" }
}

RULES:
- "approve" each proposed adjustment that is reasonable given the runner's state
- "modify" if the proposal direction is right but values need tweaking (provide adjustedValues)
- "reject" if the proposal is unnecessary or counterproductive
- "additions" is for NEW adjustments you recommend beyond the proposals (can be empty array)
- Set "replanNeeded": true only for major disruptions (injury, illness, extended missed training, significant VDOT change)
- Keep "summary" concise — this is shown directly to the athlete
- "vdotUpdate": only set if you agree VDOT should change; null otherwise
- One "decisions" entry per proposed adjustment; if no proposals, return empty array`;

  return prompt;
}

// ─── AI Decision ────────────────────────────────────────────

export async function getAdaptiveAIDecision(
  ctx: AdaptiveEventContext
): Promise<AdaptiveAIResponse | null> {
  if (!genAI) return null;

  try {
    const prompt = buildAdaptivePrompt(ctx);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const result = await withRetry(() => model.generateContent(prompt));
    let text = result.response.text();

    // Strip markdown fences if present
    text = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

    const parsed = JSON.parse(text) as AdaptiveAIResponse;

    // Validate required fields
    if (!Array.isArray(parsed.decisions) || typeof parsed.summary !== 'string') {
      console.warn('[AdaptiveAI] Invalid response structure');
      return null;
    }

    // Ensure defaults
    parsed.additions = parsed.additions || [];
    parsed.replanNeeded = parsed.replanNeeded || false;
    parsed.vdotUpdate = parsed.vdotUpdate || null;

    return parsed;
  } catch (error) {
    console.error('[AdaptiveAI] Decision request failed:', error);
    return null;
  }
}

// ─── Replan Review ──────────────────────────────────────────

interface ReplanContext {
  profile: UserProfile;
  currentVDOT: number;
  replanReason: string;
  recentWeeklyMileage: number[];
  completionHistory: { week: number; completionRate: number }[];
  adaptiveLogSummary: string;
}

interface ReplanPlanSummary {
  weeks: {
    weekNumber: number;
    phase: string;
    isCutback: boolean;
    targetVolume: number;
    workouts: { type: string; distance: number; zone: string }[];
  }[];
}

export async function reviewReplanWithAI(
  newPlan: ReplanPlanSummary,
  context: ReplanContext
): Promise<{ tweaks: string; summary: string } | null> {
  if (!genAI) return null;

  try {
    const weekSummaries = newPlan.weeks.map(w => {
      const workoutList = w.workouts.map(wo => `${wo.type}(${wo.distance}mi/${wo.zone})`).join(', ');
      return `  Wk${w.weekNumber} [${w.phase}${w.isCutback ? '/cutback' : ''}] ${w.targetVolume}mi: ${workoutList}`;
    }).join('\n');

    const mileageStr = context.recentWeeklyMileage.map((m, i) => `W-${context.recentWeeklyMileage.length - i}: ${m.toFixed(1)}mi`).join(', ');
    const completionStr = context.completionHistory.map(c => `Wk${c.week}: ${(c.completionRate * 100).toFixed(0)}%`).join(', ');

    const prompt = `ROLE: You are an elite marathon coach reviewing a regenerated training plan. Respond with ONLY valid JSON.

═══ RUNNER ═══
VDOT: ${context.currentVDOT} | Age: ${context.profile.age} | Race: ${context.profile.race_distance} on ${context.profile.race_date}
Recent mileage: ${mileageStr}
Completion history: ${completionStr}

═══ REASON FOR REPLAN ═══
${context.replanReason}

═══ RECENT ADAPTIVE HISTORY ═══
${context.adaptiveLogSummary || 'None'}

═══ NEW PLAN ═══
${weekSummaries}

═══ RESPONSE SCHEMA ═══
{
  "tweaks": "specific suggestions for adjusting the plan (or 'none' if plan looks good)",
  "summary": "1-2 sentence assessment for the athlete"
}

RULES:
- Check that volume progression follows ~12% max week-over-week increase
- Verify cutback weeks are appropriately placed
- Ensure the plan matches the runner's recent fitness level (not too aggressive, not too conservative)
- Check that quality sessions are appropriate for the phase
- Keep suggestions actionable and specific`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const result = await withRetry(() => model.generateContent(prompt));
    let text = result.response.text();

    text = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

    const parsed = JSON.parse(text) as { tweaks: string; summary: string };

    if (typeof parsed.tweaks !== 'string' || typeof parsed.summary !== 'string') {
      console.warn('[AdaptiveAI] Invalid replan review structure');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[AdaptiveAI] Replan review failed:', error);
    return null;
  }
}
