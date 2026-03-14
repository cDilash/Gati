# Adaptive Engine v2 — AI-Gated, Banister-Powered Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the adaptive training engine to an AI-gated system where every plan modification goes through Gemini, layered with Banister impulse-response model for readiness prediction, with full replan capability when the runner's trajectory shifts significantly.

**Architecture:** Two-layer model — deterministic engine (ACWR + Banister + VDOT) proposes adjustments, Gemini AI gates all decisions before applying. Hybrid adjustment strategy: per-workout adjustments normally, full replan on major deviations. Deterministic fallback when offline.

**Tech Stack:** TypeScript pure functions (engine), Gemini 2.5 Flash (AI decisions), expo-sqlite (persistence), Zustand (state), Strava API (data source)

**Design Doc:** `docs/plans/2026-03-13-adaptive-engine-v2-design.md`

---

### Task 1: Banister Impulse-Response Model

**Files:**
- Create: `src/engine/banister.ts`
- Modify: `src/types/index.ts` (add BanisterState, ReadinessScore types)

**Step 1: Add types to `src/types/index.ts`**

Add after the `RecoverySignal` interface (~line 251):

```typescript
// ─── Banister Impulse-Response Types ────────────────────────

export interface BanisterState {
  fitness: number;          // accumulated fitness (slow decay)
  fatigue: number;          // accumulated fatigue (fast decay)
  performance: number;      // fitness - fatigue
  readiness: number;        // 0-100 normalized score
  recommendation: 'push' | 'normal' | 'easy' | 'rest';
  trimpHistory: { date: string; trimp: number }[];  // last 28 days
}

export interface DailyTRIMP {
  date: string;
  trimp: number;            // training impulse score
  source: 'hr' | 'pace' | 'rpe' | 'estimated';
}
```

**Step 2: Create `src/engine/banister.ts`**

```typescript
/**
 * banister.ts — Banister Impulse-Response Model
 *
 * Tracks two competing curves from training:
 *   Fitness(t) = Fitness(t-1) × e^(-1/τ₁) + w(t) × k₁
 *   Fatigue(t) = Fatigue(t-1) × e^(-1/τ₂) + w(t) × k₂
 *   Performance = Fitness - Fatigue
 *
 * Time constants: τ₁=45d (fitness, slow decay), τ₂=15d (fatigue, fast decay)
 * Gain constants: k₁=1.0 (fitness), k₂=2.0 (fatigue hits harder, fades faster)
 */

import { PerformanceMetric, UserProfile, PaceZones, BanisterState, DailyTRIMP } from '../types';

// ─── Constants ──────────────────────────────────────────────

const TAU_FITNESS = 45;   // days — fitness decay time constant
const TAU_FATIGUE = 15;   // days — fatigue decay time constant
const K_FITNESS = 1.0;    // fitness gain multiplier
const K_FATIGUE = 2.0;    // fatigue gain multiplier

// Intensity factors by pace zone (used when no HR data)
const ZONE_INTENSITY: Record<string, number> = {
  E: 0.6, M: 0.8, T: 0.9, I: 1.0, R: 1.1,
};

// ─── TRIMP Calculation ──────────────────────────────────────

/**
 * Calculates Training Impulse (TRIMP) for a single workout.
 * Priority: HR-based (Banister equation) > Pace-based > RPE-based
 */
export function calculateTRIMP(
  metric: PerformanceMetric,
  profile: UserProfile,
  paceZones: PaceZones,
): DailyTRIMP {
  const durationMinutes = metric.duration_seconds / 60;
  let intensity: number;
  let source: DailyTRIMP['source'];

  if (metric.avg_hr && profile.resting_hr && profile.max_hr) {
    // Banister HR-based TRIMP: intensity = 0.64 × e^(1.92 × hrFraction)
    const hrFraction = (metric.avg_hr - profile.resting_hr) / (profile.max_hr - profile.resting_hr);
    const clampedFraction = Math.max(0, Math.min(1, hrFraction));
    intensity = 0.64 * Math.exp(1.92 * clampedFraction);
    source = 'hr';
  } else if (metric.avg_pace_per_mile) {
    // Pace-based: find which zone the pace falls in
    const pace = metric.avg_pace_per_mile;
    if (pace >= paceZones.E.min) intensity = ZONE_INTENSITY.E;
    else if (pace >= paceZones.M.min) intensity = ZONE_INTENSITY.M;
    else if (pace >= paceZones.T.min) intensity = ZONE_INTENSITY.T;
    else if (pace >= paceZones.I.min) intensity = ZONE_INTENSITY.I;
    else intensity = ZONE_INTENSITY.R;
    source = 'pace';
  } else if (metric.rpe_score) {
    // RPE fallback
    intensity = metric.rpe_score / 10;
    source = 'rpe';
  } else {
    // Last resort: assume easy effort
    intensity = ZONE_INTENSITY.E;
    source = 'estimated';
  }

  return {
    date: metric.date,
    trimp: Math.round(durationMinutes * intensity * 10) / 10,
    source,
  };
}

// ─── Banister Model ─────────────────────────────────────────

/**
 * Aggregates metrics into daily TRIMP values.
 * Multiple workouts on same day are summed.
 */
export function buildTRIMPSeries(
  metrics: PerformanceMetric[],
  profile: UserProfile,
  paceZones: PaceZones,
): DailyTRIMP[] {
  const byDate = new Map<string, number>();

  for (const m of metrics) {
    const trimp = calculateTRIMP(m, profile, paceZones);
    byDate.set(trimp.date, (byDate.get(trimp.date) || 0) + trimp.trimp);
  }

  return Array.from(byDate.entries())
    .map(([date, trimp]) => ({ date, trimp, source: 'hr' as const }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculates Banister fitness, fatigue, and performance readiness.
 *
 * Iterates day-by-day from the earliest metric to today,
 * applying exponential decay + training impulse each day.
 */
export function calculateBanisterState(
  metrics: PerformanceMetric[],
  profile: UserProfile,
  paceZones: PaceZones,
  today: string,
): BanisterState {
  if (metrics.length === 0) {
    return {
      fitness: 0,
      fatigue: 0,
      performance: 0,
      readiness: 50, // neutral when no data
      recommendation: 'normal',
      trimpHistory: [],
    };
  }

  const trimpSeries = buildTRIMPSeries(metrics, profile, paceZones);
  const trimpMap = new Map(trimpSeries.map(t => [t.date, t.trimp]));

  // Find date range: 60 days back from today (covers τ₁=45 decay window)
  const startDate = new Date(today + 'T00:00:00');
  startDate.setDate(startDate.getDate() - 60);

  let fitness = 0;
  let fatigue = 0;
  const current = new Date(startDate);
  const endDate = new Date(today + 'T00:00:00');

  const recentTrimp: { date: string; trimp: number }[] = [];
  const twentyEightDaysAgo = new Date(today + 'T00:00:00');
  twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const dailyTrimp = trimpMap.get(dateStr) || 0;

    // Exponential decay + new impulse
    fitness = fitness * Math.exp(-1 / TAU_FITNESS) + dailyTrimp * K_FITNESS;
    fatigue = fatigue * Math.exp(-1 / TAU_FATIGUE) + dailyTrimp * K_FATIGUE;

    // Track recent TRIMP for context
    if (current >= twentyEightDaysAgo) {
      recentTrimp.push({ date: dateStr, trimp: dailyTrimp });
    }

    current.setDate(current.getDate() + 1);
  }

  const performance = fitness - fatigue;

  // Normalize to 0-100 readiness score
  // When performance >= fitness (fatigue = 0), readiness = 100
  // When performance <= 0 (fatigue >= fitness), readiness = 0
  // Linear scale between
  const maxPerformance = Math.max(fitness, 1); // avoid division by 0
  const rawReadiness = (performance / maxPerformance) * 100;
  const readiness = Math.max(0, Math.min(100, Math.round(rawReadiness + 50)));
  // +50 offset: when performance=0, readiness=50 (neutral)

  let recommendation: BanisterState['recommendation'];
  if (readiness >= 80) recommendation = 'push';
  else if (readiness >= 60) recommendation = 'normal';
  else if (readiness >= 40) recommendation = 'easy';
  else recommendation = 'rest';

  return {
    fitness: Math.round(fitness * 10) / 10,
    fatigue: Math.round(fatigue * 10) / 10,
    performance: Math.round(performance * 10) / 10,
    readiness,
    recommendation,
    trimpHistory: recentTrimp,
  };
}
```

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors in banister.ts or types/index.ts

**Step 4: Commit**

```bash
git add src/engine/banister.ts src/types/index.ts
git commit -m "feat: add Banister impulse-response model with TRIMP calculation"
```

---

### Task 2: Split-Level VDOT Analysis

**Files:**
- Modify: `src/engine/adaptiveEngine.ts` (upgrade `evaluateVDOTUpdate`)
- Modify: `src/db/client.ts` (add helper to fetch Strava detail for metrics)

**Step 1: Add Strava detail fetcher to `src/db/client.ts`**

Add a function to fetch Strava activity details for a list of performance metric IDs:

```typescript
export function getStravaDetailsForMetrics(metricIds: string[]): Record<string, any> {
  const db = getDatabase();
  const details: Record<string, any> = {};
  for (const id of metricIds) {
    const row = db.getFirstSync<any>(
      'SELECT * FROM strava_activity_detail WHERE performance_metric_id = ?',
      id
    );
    if (row) details[id] = row;
  }
  return details;
}
```

**Step 2: Upgrade `evaluateVDOTUpdate` in `src/engine/adaptiveEngine.ts`**

Add a new exported helper function for split-level pace extraction:

```typescript
/**
 * Extracts effective workout pace from Strava splits.
 * For tempo/threshold: uses median of "work" splits (excludes first and last mile as warmup/cooldown)
 * For intervals: uses laps data if available
 * For races: uses overall pace directly
 * Returns seconds per mile, or null if splits unavailable.
 */
export function extractEffectivePace(
  metric: PerformanceMetric,
  stravaDetail: any | null,
  workoutType: WorkoutType,
): number | null {
  if (!stravaDetail) return metric.avg_pace_per_mile || null;

  // Race: use overall finish pace (most accurate for VDOT lookup)
  const stravaWorkoutType = stravaDetail.strava_workout_type;
  if (stravaWorkoutType === 1) {
    return metric.avg_pace_per_mile || null;
  }

  // Tempo/Threshold: extract work splits (skip warmup/cooldown)
  if ((workoutType === 'tempo' || workoutType === 'marathon_pace') && stravaDetail.splits_json) {
    try {
      const splits = JSON.parse(stravaDetail.splits_json);
      if (splits.length >= 3) {
        // Skip first mile (warmup) and last mile (cooldown)
        const workSplits = splits.slice(1, -1);
        // Convert each split: movingTime / (distance in miles)
        const paces = workSplits.map((s: any) => {
          const miles = s.distance / 1609.34;
          return miles > 0 ? s.movingTime / miles : null;
        }).filter((p: number | null) => p !== null);

        if (paces.length > 0) {
          // Median pace (resists outlier miles)
          paces.sort((a: number, b: number) => a - b);
          return paces[Math.floor(paces.length / 2)];
        }
      }
    } catch { /* fall through to default */ }
  }

  // Intervals: use laps if available
  if (workoutType === 'interval' && stravaDetail.laps_json) {
    try {
      const laps = JSON.parse(stravaDetail.laps_json);
      // Work laps tend to be shorter and faster; filter by pace
      if (laps.length >= 2) {
        const lapPaces = laps.map((l: any) => {
          const miles = l.distance / 1609.34;
          return { pace: miles > 0 ? l.movingTime / miles : 9999, distance: l.distance };
        });
        // Sort by pace, take faster half as "work" laps
        lapPaces.sort((a: any, b: any) => a.pace - b.pace);
        const workLaps = lapPaces.slice(0, Math.ceil(lapPaces.length / 2));
        if (workLaps.length > 0) {
          const avgWorkPace = workLaps.reduce((s: number, l: any) => s + l.pace, 0) / workLaps.length;
          return Math.round(avgWorkPace);
        }
      }
    } catch { /* fall through to default */ }
  }

  // Default: overall avg pace
  return metric.avg_pace_per_mile || null;
}
```

Then modify `evaluateVDOTUpdate` to accept an optional `stravaDetails` parameter and use `extractEffectivePace` instead of raw `avg_pace_per_mile` for pace comparisons.

In the existing function signature (~line 168), add the parameter:
```typescript
export function evaluateVDOTUpdate(
  completedQualityWorkouts: WorkoutWithMetric[],
  currentVDOT: number,
  paceZones: PaceZones,
  hrZones: HRZones,
  recoveryStatus?: RecoveryStatus | null,
  stravaDetails?: Record<string, any>,  // NEW: keyed by metric.id
): VDOTUpdateResult | null {
```

Inside the function, where pace comparison happens, replace:
```typescript
// OLD: const pacePerMile = wm.metric.avg_pace_per_mile;
// NEW:
const stravaDetail = stravaDetails?.[wm.metric.id] || null;
const pacePerMile = extractEffectivePace(wm.metric, stravaDetail, wm.workout.workout_type)
  || wm.metric.avg_pace_per_mile;
```

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 4: Commit**

```bash
git add src/engine/adaptiveEngine.ts src/db/client.ts
git commit -m "feat: split-level VDOT analysis using Strava splits and laps"
```

---

### Task 3: Adaptive AI Response Types & Prompt Builder

**Files:**
- Modify: `src/types/index.ts` (add AdaptiveAIResponse type)
- Create: `src/ai/adaptiveAI.ts` (Gemini adaptive decision module)

**Step 1: Add AI response types to `src/types/index.ts`**

Add after BanisterState types:

```typescript
// ─── Adaptive AI Decision Types ─────────────────────────────

export interface AdaptiveAIDecision {
  workoutId: string;
  action: 'approve' | 'modify' | 'reject';
  adjustedValues?: {
    distance_miles?: number;
    workout_type?: WorkoutType;
    target_pace_zone?: PaceZoneName;
  };
  reasoning: string;
}

export interface AdaptiveAIAddition {
  workoutId: string;
  adjustmentType: AdaptiveAdjustmentType;
  newDistance: number;
  newType: WorkoutType;
  reasoning: string;
}

export interface AdaptiveAIResponse {
  decisions: AdaptiveAIDecision[];
  additions: AdaptiveAIAddition[];
  summary: string;
  replanNeeded: boolean;
  replanReason?: string;
  vdotUpdate: {
    newVdot: number;
    confidence: 'high' | 'moderate';
    reasoning: string;
  } | null;
}

export type AdaptiveEventType = 'workout_completed' | 'workout_skipped';

export interface AdaptiveEventContext {
  eventType: AdaptiveEventType;
  workout: Workout;
  metric: PerformanceMetric | null;
  stravaDetail: any | null;
  profile: UserProfile;
  acwr: number;
  banisterState: BanisterState;
  recoveryStatus: RecoveryStatus | null;
  rpeTrend: { trend: 'fatigued' | 'normal' | 'fresh'; avgRPE: number; sampleSize: number } | null;
  currentVDOT: number;
  paceZones: PaceZones;
  daysUntilRace: number;
  currentPhase: Phase;
  weekNumber: number;
  proposedAdjustments: WorkoutAdjustment[];
  proposedVDOTUpdate: VDOTUpdateResult | null;
  recentAdaptiveLogs: AdaptiveLog[];
}
```

**Step 2: Create `src/ai/adaptiveAI.ts`**

```typescript
/**
 * adaptiveAI.ts — Gemini AI-Gated Adaptive Decision Engine
 *
 * Every plan modification goes through Gemini before applying.
 * Deterministic engine proposes → Gemini approves/modifies/rejects.
 * Falls back to deterministic if Gemini unavailable.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import {
  AdaptiveAIResponse,
  AdaptiveEventContext,
  WorkoutAdjustment,
  AdaptiveAdjustmentType,
  WorkoutType,
} from '../types';
import { withRetry } from './gemini';

const apiKey = Constants.expoConfig?.extra?.geminiApiKey;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// ─── Prompt Builder ─────────────────────────────────────────

function buildAdaptivePrompt(ctx: AdaptiveEventContext): string {
  const sections: string[] = [];

  // ROLE
  sections.push(`You are an elite marathon coach and sports scientist making real-time training adjustments.
You must respond with ONLY valid JSON matching the schema below. No markdown, no explanation outside JSON.`);

  // RUNNER PROFILE
  sections.push(`## Runner Profile
- VDOT: ${ctx.currentVDOT} | Age: ${ctx.profile.age} | Weight: ${ctx.profile.weight_lbs} lbs
- Max HR: ${ctx.profile.max_hr} | Resting HR: ${ctx.profile.resting_hr}
- Race: ${ctx.profile.race_distance} on ${ctx.profile.race_date} (${ctx.daysUntilRace} days away)
- Phase: ${ctx.currentPhase} | Week ${ctx.weekNumber}
- Goal: ${ctx.profile.goal_marathon_time_seconds ? `${Math.floor(ctx.profile.goal_marathon_time_seconds / 3600)}:${String(Math.floor((ctx.profile.goal_marathon_time_seconds % 3600) / 60)).padStart(2, '0')} marathon` : 'finish strong'}`);

  // CURRENT STATE
  sections.push(`## Current Training State
- ACWR: ${ctx.acwr.toFixed(2)} ${ctx.acwr > 1.5 ? '⚠️ CRITICAL' : ctx.acwr > 1.3 ? '⚠️ ELEVATED' : ctx.acwr < 0.8 ? '📉 LOW' : '✅ NORMAL'}
- Banister Readiness: ${ctx.banisterState.readiness}/100 (${ctx.banisterState.recommendation})
  - Fitness: ${ctx.banisterState.fitness} | Fatigue: ${ctx.banisterState.fatigue}
- Recovery: ${ctx.recoveryStatus ? `${ctx.recoveryStatus.score}/100 (${ctx.recoveryStatus.recommendation})` : 'No data'}
- RPE Trend: ${ctx.rpeTrend ? `${ctx.rpeTrend.trend} (avg ${ctx.rpeTrend.avgRPE.toFixed(1)} over ${ctx.rpeTrend.sampleSize} runs)` : 'No data'}`);

  // EVENT
  const eventDesc = ctx.eventType === 'workout_completed'
    ? `COMPLETED: ${ctx.workout.workout_type} ${ctx.workout.distance_miles}mi`
    : `SKIPPED: ${ctx.workout.workout_type} ${ctx.workout.distance_miles}mi`;
  sections.push(`## Event
${eventDesc} on ${ctx.workout.date}`);

  if (ctx.metric) {
    sections.push(`### Actual Performance
- Distance: ${ctx.metric.distance_miles.toFixed(1)}mi in ${Math.floor(ctx.metric.duration_seconds / 60)}min
- Avg Pace: ${formatSecondsAsPace(ctx.metric.avg_pace_per_mile)}/mi
- Target Zone: ${ctx.workout.target_pace_zone} (${formatPaceZoneRange(ctx.paceZones, ctx.workout.target_pace_zone)})
${ctx.metric.avg_hr ? `- Avg HR: ${ctx.metric.avg_hr} | Max HR: ${ctx.metric.max_hr || 'N/A'}` : ''}
${ctx.metric.rpe_score ? `- RPE: ${ctx.metric.rpe_score}/10` : ''}`);
  }

  if (ctx.stravaDetail) {
    const detail = ctx.stravaDetail;
    const extras: string[] = [];
    if (detail.suffer_score) extras.push(`Suffer Score: ${detail.suffer_score}`);
    if (detail.cadence_avg) extras.push(`Cadence: ${detail.cadence_avg} spm`);
    if (detail.elevation_gain_ft) extras.push(`Elevation: ${detail.elevation_gain_ft}ft`);
    if (detail.strava_workout_type === 1) extras.push(`TYPE: RACE`);
    if (extras.length > 0) {
      sections.push(`### Strava Detail\n- ${extras.join('\n- ')}`);
    }
  }

  // PROPOSED ADJUSTMENTS
  if (ctx.proposedAdjustments.length > 0) {
    const adjList = ctx.proposedAdjustments.map(a =>
      `- ${a.workoutId}: ${a.adjustmentType} | ${a.originalDistance}mi ${a.originalType} → ${a.newDistance}mi ${a.newType} | Reason: ${a.reason}`
    ).join('\n');
    sections.push(`## Proposed Adjustments (from deterministic engine)
${adjList}`);
  } else {
    sections.push(`## Proposed Adjustments
None — deterministic engine found no issues.`);
  }

  // PROPOSED VDOT UPDATE
  if (ctx.proposedVDOTUpdate) {
    sections.push(`## Proposed VDOT Update
- Current: ${ctx.proposedVDOTUpdate.previousVDOT} → Proposed: ${ctx.proposedVDOTUpdate.newVDOT}
- Confidence: ${ctx.proposedVDOTUpdate.confidenceLevel}
- Reason: ${ctx.proposedVDOTUpdate.reason}`);
  }

  // RECENT HISTORY
  if (ctx.recentAdaptiveLogs.length > 0) {
    const logList = ctx.recentAdaptiveLogs.slice(0, 5).map(l =>
      `- ${l.timestamp}: ${l.type} — ${l.summary}`
    ).join('\n');
    sections.push(`## Recent Adaptive History (last 7 days)
${logList}`);
  }

  // RESPONSE SCHEMA
  sections.push(`## Required JSON Response Schema
{
  "decisions": [
    {
      "workoutId": "string (from proposed adjustments)",
      "action": "approve" | "modify" | "reject",
      "adjustedValues": { "distance_miles": number, "workout_type": "easy"|"long"|etc, "target_pace_zone": "E"|"M"|etc } (only if action=modify),
      "reasoning": "string (1 sentence)"
    }
  ],
  "additions": [
    {
      "workoutId": "string (workout to additionally adjust)",
      "adjustmentType": "reduce_distance" | "increase_distance" | "convert_to_easy" | "convert_to_rest" | "reschedule",
      "newDistance": number,
      "newType": "easy"|"long"|"tempo"|"interval"|"recovery"|"marathon_pace"|"rest",
      "reasoning": "string"
    }
  ],
  "summary": "string (1 sentence user-facing explanation of what changed)",
  "replanNeeded": boolean,
  "replanReason": "string (only if replanNeeded=true)",
  "vdotUpdate": { "newVdot": number, "confidence": "high"|"moderate", "reasoning": "string" } | null
}

Rules:
- For each proposed adjustment, you MUST include a decision (approve/modify/reject)
- You may add additional adjustments via "additions" for workouts not in the proposals
- Set replanNeeded=true ONLY if: completion <60% for 2+ weeks, VDOT shift ≥3, or 10+ day gap
- Keep summary concise — this is shown to the user as a notification
- Be conservative: when in doubt, approve the deterministic engine's recommendation
- Consider the full context: ACWR + Banister readiness + recovery + RPE trend + days until race`);

  return sections.join('\n\n');
}

// ─── Helpers ────────────────────────────────────────────────

function formatSecondsAsPace(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatPaceZoneRange(paceZones: any, zone: string): string {
  const z = paceZones[zone];
  if (!z) return 'N/A';
  return `${formatSecondsAsPace(z.max)}-${formatSecondsAsPace(z.min)}/mi`;
}

// ─── AI Decision Call ───────────────────────────────────────

/**
 * Sends adaptive context to Gemini and returns structured decision.
 * Returns null if Gemini unavailable (caller should use deterministic fallback).
 */
export async function getAdaptiveAIDecision(
  ctx: AdaptiveEventContext,
): Promise<AdaptiveAIResponse | null> {
  if (!genAI) {
    console.warn('Gemini API key not configured — using deterministic fallback');
    return null;
  }

  try {
    const prompt = buildAdaptivePrompt(ctx);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const result = await withRetry(() => model.generateContent(prompt));
    const text = result.response.text();

    // Strip markdown fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned) as AdaptiveAIResponse;

    // Validate required fields
    if (!parsed.decisions || !Array.isArray(parsed.decisions)) {
      console.error('Invalid AI response: missing decisions array');
      return null;
    }
    if (typeof parsed.summary !== 'string') {
      console.error('Invalid AI response: missing summary');
      return null;
    }

    return parsed;
  } catch (error: any) {
    console.error('Adaptive AI decision failed:', error?.message || error);
    return null; // Caller uses deterministic fallback
  }
}

// ─── Replan Review ──────────────────────────────────────────

/**
 * Sends a full regenerated plan to Gemini for review before applying.
 * Gemini can suggest tweaks to the deterministic plan.
 * Returns adjusted plan suggestions or null (use plan as-is).
 */
export async function reviewReplanWithAI(
  newPlan: { weeks: any[]; workouts: any[] },
  context: {
    profile: UserProfile;
    currentVDOT: number;
    replanReason: string;
    recentMileage: number;
    completionHistory: { week: number; rate: number }[];
    adaptiveLogSummary: string[];
  },
): Promise<{ tweaks: string; summary: string } | null> {
  if (!genAI) return null;

  try {
    const weekSummary = newPlan.weeks.map(w =>
      `Week ${w.week_number}: ${w.phase} | ${w.target_volume_miles}mi${w.is_cutback ? ' (cutback)' : ''}`
    ).join('\n');

    const prompt = `You are an elite marathon coach reviewing a regenerated training plan.

## Why Replanned
${context.replanReason}

## Runner
- VDOT: ${context.currentVDOT} | Recent avg mileage: ${context.recentMileage}mi/week
- Race: ${context.profile.race_distance} on ${context.profile.race_date}
- Recent completion: ${context.completionHistory.map(h => `Week ${h.week}: ${(h.rate * 100).toFixed(0)}%`).join(', ')}

## New Plan
${weekSummary}

## Recent Adaptive History
${context.adaptiveLogSummary.join('\n')}

Review this plan. Respond with JSON:
{
  "tweaks": "specific adjustments you'd make (or 'none' if plan looks good)",
  "summary": "1-2 sentence summary for the user about the new plan"
}

Be conservative. The deterministic engine enforces safety constraints (12% rule, cutbacks, taper). Only suggest tweaks if something looks wrong given the runner's specific situation.`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const result = await withRetry(() => model.generateContent(prompt));
    const text = result.response.text();
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch (error: any) {
    console.error('Replan AI review failed:', error?.message || error);
    return null;
  }
}
```

**Step 3: Export `withRetry` from `src/ai/gemini.ts`**

Currently `withRetry` is likely not exported. In `src/ai/gemini.ts`, change:
```typescript
// OLD: function withRetry<T>(...
// NEW: export function withRetry<T>(...
```

**Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 5: Commit**

```bash
git add src/ai/adaptiveAI.ts src/types/index.ts src/ai/gemini.ts
git commit -m "feat: add Gemini AI-gated adaptive decision engine"
```

---

### Task 4: Replan Engine

**Files:**
- Modify: `src/engine/planGenerator.ts` (add `replanFromCurrentState` function)
- Modify: `src/db/client.ts` (add `deleteScheduledWorkoutsAndWeeks`, `getRecentActualMileage`)

**Step 1: Add DB helpers to `src/db/client.ts`**

```typescript
/**
 * Deletes only future scheduled workouts and their parent weeks.
 * Preserves completed/skipped workout rows by NULLing their week_id.
 */
export function deleteScheduledFutureWorkouts(planId: string): void {
  const database = getDatabase();
  database.withTransactionSync(() => {
    // NULL out workout_id in performance_metric for scheduled workouts about to be deleted
    database.execSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (
         SELECT w.id FROM workout w
         JOIN training_week tw ON w.week_id = tw.id
         WHERE tw.plan_id IN (SELECT id FROM training_plan)
           AND w.status = 'scheduled'
       )`
    );
    // Delete scheduled workouts
    database.execSync(
      `DELETE FROM workout WHERE status = 'scheduled'
       AND week_id IN (SELECT id FROM training_week WHERE plan_id IN (SELECT id FROM training_plan))`
    );
    // Delete weeks that no longer have any workouts
    database.execSync(
      `DELETE FROM training_week
       WHERE plan_id IN (SELECT id FROM training_plan)
       AND id NOT IN (SELECT DISTINCT week_id FROM workout WHERE week_id IS NOT NULL)`
    );
    // Delete training plan
    database.execSync('DELETE FROM training_plan');
    // Clear caches
    database.execSync('DELETE FROM ai_briefing_cache');
  });
}

/**
 * Returns average weekly mileage over the last N completed weeks.
 */
export function getRecentActualMileage(weeks: number = 2): number {
  const database = getDatabase();
  const rows = database.getAllSync<{ total: number }>(
    `SELECT SUM(pm.distance_miles) as total
     FROM performance_metric pm
     WHERE pm.date >= date('now', '-${weeks * 7} days')
       AND pm.source IN ('strava', 'healthkit', 'manual')
     GROUP BY strftime('%W', pm.date)
     ORDER BY pm.date DESC
     LIMIT ?`,
    weeks
  );
  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  return Math.round((total / rows.length) * 10) / 10;
}

/**
 * Returns completion rate per week for the last N weeks.
 */
export function getWeeklyCompletionHistory(limit: number = 8): { week: number; rate: number }[] {
  const database = getDatabase();
  const rows = database.getAllSync<{ week_number: number; total: number; completed: number }>(
    `SELECT tw.week_number,
            COUNT(w.id) as total,
            SUM(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM training_week tw
     JOIN workout w ON w.week_id = tw.id
     WHERE w.workout_type != 'rest'
     GROUP BY tw.week_number
     ORDER BY tw.week_number DESC
     LIMIT ?`,
    limit
  );
  return rows.map(r => ({
    week: r.week_number,
    rate: r.total > 0 ? r.completed / r.total : 0,
  })).reverse();
}
```

**Step 2: Add `replanFromCurrentState` to `src/engine/planGenerator.ts`**

Add at the bottom of the file, before the closing:

```typescript
/**
 * Generates a new plan anchored to the runner's current fitness,
 * not their original inputs. Used when trajectory has shifted significantly.
 *
 * Differences from initial generatePlan():
 *   - V_start = actual recent mileage (not profile.current_weekly_mileage)
 *   - VDOT = current (possibly updated), not original
 *   - startDate = next Monday from today
 *   - Preserves same race date, available days, long run day
 */
export function replanFromCurrentState(
  profile: UserProfile,
  currentVDOT: number,
  actualRecentMileage: number,
  today: string,
): GeneratedPlan | null {
  // Calculate next Monday
  const todayDate = new Date(today + 'T00:00:00');
  const dayOfWeek = todayDate.getDay(); // 0=Sun
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
  const nextMonday = new Date(todayDate);
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  const startDate = formatLocalDate(nextMonday);

  // Check minimum weeks remaining
  const raceDate = new Date(profile.race_date + 'T00:00:00');
  const msRemaining = raceDate.getTime() - nextMonday.getTime();
  const weeksRemaining = Math.floor(msRemaining / (7 * 24 * 60 * 60 * 1000));

  if (weeksRemaining < 2) {
    // Too close to race — refuse replan
    return null;
  }

  // Parse available_days (stored as JSON string or number[])
  const availableDays = typeof profile.available_days === 'string'
    ? JSON.parse(profile.available_days)
    : profile.available_days;

  return generatePlan({
    startDate,
    raceDate: profile.race_date,
    currentWeeklyMileage: Math.max(actualRecentMileage, 10), // floor at 10mi
    longestRecentRun: Math.round(actualRecentMileage * 0.3), // estimate from recent volume
    level: profile.level,
    vdot: currentVDOT,
    availableDays,
    preferredLongRunDay: profile.preferred_long_run_day,
  });
}
```

Note: `formatLocalDate` is already defined in planGenerator.ts from the timezone fix.

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 4: Commit**

```bash
git add src/engine/planGenerator.ts src/db/client.ts
git commit -m "feat: add replan engine with current-state anchoring"
```

---

### Task 5: Replan Trigger Detection

**Files:**
- Create: `src/engine/replanTriggers.ts`

**Step 1: Create `src/engine/replanTriggers.ts`**

```typescript
/**
 * replanTriggers.ts — Detects when a full plan regeneration is needed.
 *
 * Four triggers:
 * 1. Completion rate < 60% for 2 consecutive weeks
 * 2. VDOT shift ≥ 3 from plan creation
 * 3. 10+ consecutive days missed
 * 4. AI flags replanNeeded (handled in store, not here)
 */

import { TrainingWeek, Workout, VDOTUpdateResult } from '../types';

export interface ReplanTriggerResult {
  shouldReplan: boolean;
  reason: string | null;
  trigger: 'low_completion' | 'vdot_shift' | 'extended_gap' | 'ai_flagged' | null;
}

/**
 * Checks if completion rate has been below 60% for 2+ consecutive weeks.
 */
export function checkLowCompletion(
  weeks: TrainingWeek[],
  workouts: Workout[],
): ReplanTriggerResult {
  // Get last 4 weeks sorted by week_number desc
  const recentWeeks = [...weeks]
    .filter(w => w.phase !== 'taper') // don't trigger on taper
    .sort((a, b) => b.week_number - a.week_number)
    .slice(0, 4);

  let consecutiveLow = 0;

  for (const week of recentWeeks) {
    const weekWorkouts = workouts.filter(
      w => w.week_id === week.id && w.workout_type !== 'rest'
    );
    const total = weekWorkouts.length;
    const completed = weekWorkouts.filter(w => w.status === 'completed').length;
    // Only count weeks that are "past" (have at least some resolved workouts)
    const resolved = weekWorkouts.filter(w => w.status !== 'scheduled').length;
    if (resolved < total * 0.5) break; // week still in progress

    const rate = total > 0 ? completed / total : 1;
    if (rate < 0.6) {
      consecutiveLow++;
    } else {
      break; // streak broken
    }
  }

  if (consecutiveLow >= 2) {
    return {
      shouldReplan: true,
      reason: `Completion rate below 60% for ${consecutiveLow} consecutive weeks. Plan needs recalibration to match your actual training load.`,
      trigger: 'low_completion',
    };
  }

  return { shouldReplan: false, reason: null, trigger: null };
}

/**
 * Checks if VDOT has shifted ≥3 from plan creation.
 */
export function checkVDOTShift(
  currentVDOT: number,
  vdotAtCreation: number,
): ReplanTriggerResult {
  const shift = Math.abs(currentVDOT - vdotAtCreation);

  if (shift >= 3) {
    const direction = currentVDOT > vdotAtCreation ? 'improved' : 'decreased';
    return {
      shouldReplan: true,
      reason: `VDOT ${direction} by ${shift.toFixed(1)} (${vdotAtCreation} → ${currentVDOT}). Paces and volumes need recalculation.`,
      trigger: 'vdot_shift',
    };
  }

  return { shouldReplan: false, reason: null, trigger: null };
}

/**
 * Checks for 10+ consecutive missed training days.
 */
export function checkExtendedGap(
  workouts: Workout[],
  today: string,
): ReplanTriggerResult {
  // Get workouts in the last 21 days, sorted by date
  const cutoff = new Date(today + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - 21);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recent = workouts
    .filter(w => w.date >= cutoffStr && w.date <= today && w.workout_type !== 'rest')
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recent.length === 0) return { shouldReplan: false, reason: null, trigger: null };

  // Find longest consecutive streak of skipped/scheduled (not completed)
  let maxGapDays = 0;
  let currentGapStart: string | null = null;

  for (const w of recent) {
    if (w.status !== 'completed') {
      if (!currentGapStart) currentGapStart = w.date;
    } else {
      if (currentGapStart) {
        const gapDays = Math.round(
          (new Date(w.date + 'T00:00:00').getTime() - new Date(currentGapStart + 'T00:00:00').getTime())
          / (24 * 60 * 60 * 1000)
        );
        maxGapDays = Math.max(maxGapDays, gapDays);
        currentGapStart = null;
      }
    }
  }

  // Check if gap extends to today
  if (currentGapStart) {
    const gapDays = Math.round(
      (new Date(today + 'T00:00:00').getTime() - new Date(currentGapStart + 'T00:00:00').getTime())
      / (24 * 60 * 60 * 1000)
    );
    maxGapDays = Math.max(maxGapDays, gapDays);
  }

  if (maxGapDays >= 10) {
    return {
      shouldReplan: true,
      reason: `${maxGapDays} consecutive days without training. Plan assumptions no longer hold — need fresh start from current fitness.`,
      trigger: 'extended_gap',
    };
  }

  return { shouldReplan: false, reason: null, trigger: null };
}

/**
 * Runs all replan trigger checks. Returns the first triggered, or none.
 */
export function checkReplanTriggers(
  weeks: TrainingWeek[],
  workouts: Workout[],
  currentVDOT: number,
  vdotAtCreation: number,
  today: string,
): ReplanTriggerResult {
  // Check in priority order
  const gap = checkExtendedGap(workouts, today);
  if (gap.shouldReplan) return gap;

  const vdot = checkVDOTShift(currentVDOT, vdotAtCreation);
  if (vdot.shouldReplan) return vdot;

  const completion = checkLowCompletion(weeks, workouts);
  if (completion.shouldReplan) return completion;

  return { shouldReplan: false, reason: null, trigger: null };
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 3: Commit**

```bash
git add src/engine/replanTriggers.ts
git commit -m "feat: add replan trigger detection (completion, VDOT shift, gap)"
```

---

### Task 6: Upgrade Store — AI-Gated Workout Completion

**Files:**
- Modify: `src/store.ts` (upgrade `markWorkoutComplete` and `markWorkoutSkipped` to use AI-gated flow)

**Step 1: Add imports to `src/store.ts`**

Add at the top with other imports:

```typescript
import { calculateBanisterState } from './engine/banister';
import { getAdaptiveAIDecision } from './ai/adaptiveAI';
import { extractEffectivePace } from './engine/adaptiveEngine';
import { checkReplanTriggers, ReplanTriggerResult } from './engine/replanTriggers';
import { replanFromCurrentState } from './engine/planGenerator';
import { reviewReplanWithAI } from './ai/adaptiveAI';
import { getStravaDetailsForMetrics, getRecentActualMileage, getWeeklyCompletionHistory, deleteScheduledFutureWorkouts } from './db/client';
```

**Step 2: Add `banisterState` and `pendingAIReview` to store interface**

In the store interface (near top of file), add:

```typescript
banisterState: BanisterState | null;
pendingAIReview: boolean;
lastAdaptiveSummary: string | null;
replanModal: { visible: boolean; reason: string; summary: string } | null;
```

And in the initial state:

```typescript
banisterState: null,
pendingAIReview: false,
lastAdaptiveSummary: null,
replanModal: null,
```

**Step 3: Upgrade `markWorkoutComplete` action**

Replace the ACWR + adjustment section of `markWorkoutComplete` (~lines 470-540) with the AI-gated flow. The key changes:

1. Calculate Banister state alongside ACWR
2. Build deterministic proposals (same as before)
3. Send to Gemini for decision
4. Apply Gemini's response (or deterministic fallback)
5. Check replan triggers

The upgraded flow (replace the section after workout status update and metric linking):

```typescript
// ── Adaptive cascade: AI-Gated ──────────────────────────

const allMetrics = getMetricsForDateRange(
  new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0],
  today
);

// 1. Calculate ACWR
const acwr = calculateACWR(allMetrics, today);

// 2. Calculate Banister readiness
const paceZones = calculatePaceZones(profile.vdot);
const banister = calculateBanisterState(allMetrics, profile, paceZones, today);

// 3. RPE trend
const rpeTrend = assessRPETrend(allMetrics);

// 4. Deterministic proposals
let proposedAdjustments: WorkoutAdjustment[] = [];
if (acwr > 1.3 || (rpeTrend?.trend === 'fatigued' && acwr > 1.2)) {
  proposedAdjustments = checkACWRSafety(
    acwr, futureWorkouts, today, get().recoveryStatus, rpeTrend?.avgRPE ?? null
  );
}

// 5. VDOT evaluation with split-level analysis
const stravaDetails = getStravaDetailsForMetrics(
  allMetrics.filter(m => m.source === 'strava').map(m => m.id)
);
const proposedVDOT = evaluateVDOTUpdate(
  qualityWorkoutsWithMetrics, profile.vdot, paceZones,
  calculateHRZones(profile.max_hr, profile.resting_hr),
  get().recoveryStatus, stravaDetails
);

// 6. Get Strava detail for this specific workout
const thisMetric = /* the linked metric */;
const thisStravaDetail = thisMetric
  ? (getStravaDetailsForMetrics([thisMetric.id])[thisMetric.id] || null)
  : null;

// 7. AI-Gated decision
const aiContext: AdaptiveEventContext = {
  eventType: 'workout_completed',
  workout,
  metric: thisMetric || null,
  stravaDetail: thisStravaDetail,
  profile,
  acwr,
  banisterState: banister,
  recoveryStatus: get().recoveryStatus,
  rpeTrend,
  currentVDOT: profile.vdot,
  paceZones,
  daysUntilRace: get().daysUntilRace || 0,
  currentPhase: get().currentPhase || 'base',
  weekNumber: get().currentWeekNumber || 1,
  proposedAdjustments,
  proposedVDOTUpdate: proposedVDOT,
  recentAdaptiveLogs: getRecentAdaptiveLogs(7),
};

// Fire async AI decision (don't block UI)
(async () => {
  try {
    set({ pendingAIReview: true });
    const aiResponse = await getAdaptiveAIDecision(aiContext);

    if (aiResponse) {
      // Apply AI decisions
      const adjustments = applyAIDecisions(aiResponse, proposedAdjustments, futureWorkouts, db);

      // VDOT update if AI confirmed
      if (aiResponse.vdotUpdate) {
        updateVDOT(aiResponse.vdotUpdate.newVdot, db);
      }

      // Log
      saveAdaptiveLog({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'acwr_adjustment',
        summary: aiResponse.summary,
        adjustments,
        metadata: { aiGated: true, acwr, readiness: banister.readiness },
      });

      set({
        lastAdaptiveSummary: aiResponse.summary,
        pendingAIReview: false,
        banisterState: banister,
        currentACWR: acwr,
      });

      // Check if AI flagged replan
      if (aiResponse.replanNeeded) {
        get().triggerReplan(aiResponse.replanReason || 'AI recommended replan');
      }
    } else {
      // Fallback: apply deterministic
      if (proposedAdjustments.length > 0) {
        applyAdjustments(proposedAdjustments, db);
        saveAdaptiveLog({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'acwr_adjustment',
          summary: `Auto-adjusted ${proposedAdjustments.length} workout(s) (deterministic fallback)`,
          adjustments: proposedAdjustments,
          metadata: { aiGated: false, acwr, readiness: banister.readiness },
        });
      }
      set({ pendingAIReview: false, banisterState: banister, currentACWR: acwr });
    }

    // Check replan triggers (independent of AI)
    const triggerResult = checkReplanTriggers(
      get().trainingWeeks, get().allWorkouts,
      profile.vdot, get().activePlan?.vdot_at_creation || profile.vdot, today
    );
    if (triggerResult.shouldReplan) {
      get().triggerReplan(triggerResult.reason!);
    }
  } catch (error) {
    console.error('Adaptive cascade error:', error);
    set({ pendingAIReview: false });
  }
})();
```

**Step 4: Add `triggerReplan` store action**

Add new action to the store:

```typescript
triggerReplan: async (reason: string) => {
  const { profile, activePlan, allWorkouts, trainingWeeks } = get();
  if (!profile || !activePlan) return;

  const today = getToday();
  const actualMileage = getRecentActualMileage(2);
  const currentVDOT = profile.vdot;

  // Generate new plan from current state
  const newPlan = replanFromCurrentState(profile, currentVDOT, actualMileage, today);
  if (!newPlan) {
    // Too close to race
    set({ replanModal: {
      visible: true,
      reason,
      summary: 'Too close to race day to regenerate plan. Maintaining current schedule with adjustments.',
    }});
    return;
  }

  // Ask Gemini to review the new plan
  const completionHistory = getWeeklyCompletionHistory(8);
  const recentLogs = getRecentAdaptiveLogs(14);
  const aiReview = await reviewReplanWithAI(
    { weeks: newPlan.weeks, workouts: newPlan.workouts },
    {
      profile,
      currentVDOT,
      replanReason: reason,
      recentMileage: actualMileage,
      completionHistory,
      adaptiveLogSummary: recentLogs.map(l => `${l.type}: ${l.summary}`),
    },
  );

  // Apply: delete old scheduled workouts, insert new plan
  const db = getDatabase();
  deleteScheduledFutureWorkouts(activePlan.id);
  savePlan(newPlan); // existing function that inserts plan + weeks + workouts

  // Log the replan
  saveAdaptiveLog({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'weekly_reconciliation',
    summary: aiReview?.summary || `Plan regenerated: ${reason}`,
    adjustments: [],
    metadata: {
      replan: true,
      reason,
      previousVStart: activePlan.peak_weekly_mileage,
      newVStart: actualMileage,
      aiReview: aiReview?.tweaks || null,
    },
  });

  // Reload store state
  get().initializeApp();

  // Show replan modal
  set({
    replanModal: {
      visible: true,
      reason,
      summary: aiReview?.summary || `Plan regenerated from week ${newPlan.weeks[0]?.week_number || 1}. Training recalibrated to match your current fitness.`,
    },
  });
},
```

**Step 5: Apply similar AI-gated upgrade to `markWorkoutSkipped`**

Same pattern as `markWorkoutComplete` but with `eventType: 'workout_skipped'` and including `triageMissedWorkout` proposals.

**Step 6: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 7: Commit**

```bash
git add src/store.ts
git commit -m "feat: AI-gated adaptive cascade with Banister readiness and replan triggers"
```

---

### Task 7: UI — Adjustment Toast Notification

**Files:**
- Create: `src/components/common/AdaptiveToast.tsx`
- Modify: `app/(tabs)/index.tsx` (add toast to Today screen)

**Step 1: Create `src/components/common/AdaptiveToast.tsx`**

```typescript
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Pressable } from 'react-native';
import { Lightning } from 'phosphor-react-native';

interface AdaptiveToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function AdaptiveToast({ message, onDismiss }: AdaptiveToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    if (message) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -20, duration: 300, useNativeDriver: true }),
        ]).start(() => onDismiss());
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View style={[s.container, { opacity, transform: [{ translateY }] }]}>
      <Pressable onPress={onDismiss} style={s.inner}>
        <Lightning size={18} color="#FF9500" weight="fill" />
        <Text style={s.text} numberOfLines={3}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    zIndex: 999,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
});
```

**Step 2: Add toast to Today screen (`app/(tabs)/index.tsx`)**

Import the component and wire it to `lastAdaptiveSummary` from the store:

```typescript
import { AdaptiveToast } from '../../src/components/common/AdaptiveToast';

// Inside the component:
const lastAdaptiveSummary = useAppStore(s => s.lastAdaptiveSummary);

// In the JSX, add before the main content:
<AdaptiveToast
  message={lastAdaptiveSummary}
  onDismiss={() => useAppStore.setState({ lastAdaptiveSummary: null })}
/>
```

**Step 3: Commit**

```bash
git add src/components/common/AdaptiveToast.tsx app/\(tabs\)/index.tsx
git commit -m "feat: add adaptive adjustment toast notification on Today tab"
```

---

### Task 8: UI — Replan Modal

**Files:**
- Create: `src/components/common/ReplanModal.tsx`
- Modify: `app/_layout.tsx` (add modal at root level)

**Step 1: Create `src/components/common/ReplanModal.tsx`**

```typescript
import React from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView } from 'react-native';
import { ArrowsClockwise } from 'phosphor-react-native';

interface ReplanModalProps {
  visible: boolean;
  reason: string;
  summary: string;
  onViewPlan: () => void;
  onDismiss: () => void;
}

export function ReplanModal({ visible, reason, summary, onViewPlan, onDismiss }: ReplanModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.container}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.iconContainer}>
            <ArrowsClockwise size={48} color="#FF9500" weight="bold" />
          </View>

          <Text style={s.title}>Plan Regenerated</Text>

          <View style={s.reasonCard}>
            <Text style={s.reasonLabel}>Reason</Text>
            <Text style={s.reasonText}>{reason}</Text>
          </View>

          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>What Changed</Text>
            <Text style={s.summaryText}>{summary}</Text>
          </View>
        </ScrollView>

        <View style={s.buttons}>
          <Pressable style={s.primaryButton} onPress={onViewPlan}>
            <Text style={s.primaryButtonText}>View New Plan</Text>
          </Pressable>
          <Pressable style={s.secondaryButton} onPress={onDismiss}>
            <Text style={s.secondaryButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    padding: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  reasonCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 16,
  },
  reasonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  reasonText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  summaryCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  buttons: {
    padding: 24,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#FF9500',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#8E8E93',
    fontSize: 17,
  },
});
```

**Step 2: Wire into root layout `app/_layout.tsx`**

Import and render the ReplanModal, driven by `replanModal` store state:

```typescript
import { ReplanModal } from '../src/components/common/ReplanModal';
import { useRouter } from 'expo-router';

// Inside the root layout component:
const replanModal = useAppStore(s => s.replanModal);
const router = useRouter();

// In JSX:
{replanModal?.visible && (
  <ReplanModal
    visible={replanModal.visible}
    reason={replanModal.reason}
    summary={replanModal.summary}
    onViewPlan={() => {
      useAppStore.setState({ replanModal: null });
      router.push('/(tabs)/calendar');
    }}
    onDismiss={() => useAppStore.setState({ replanModal: null })}
  />
)}
```

**Step 3: Commit**

```bash
git add src/components/common/ReplanModal.tsx app/_layout.tsx
git commit -m "feat: add replan modal for plan regeneration events"
```

---

### Task 9: UI — Plan Tab Adjustment Indicators

**Files:**
- Modify: `app/(tabs)/calendar.tsx` (add ⚡ indicator on adjusted workouts)

**Step 1: Add adjustment indicator to workout rows in Plan tab**

In the workout list item rendering, check if `workout.adjustment_reason` is set:

```typescript
// In the workout row component:
{workout.adjustment_reason && (
  <Pressable
    onPress={() => Alert.alert(
      'AI Adjustment',
      `Original: ${workout.original_distance_miles}mi\nAdjusted: ${workout.distance_miles}mi\n\n${workout.adjustment_reason}`
    )}
    style={{ marginLeft: 4 }}
  >
    <Lightning size={14} color="#FF9500" weight="fill" />
  </Pressable>
)}
```

**Step 2: Commit**

```bash
git add app/\(tabs\)/calendar.tsx
git commit -m "feat: add adjustment indicator on modified workouts in Plan tab"
```

---

### Task 10: Coach Integration — Banister Context

**Files:**
- Modify: `src/ai/coachPrompt.ts` (add Banister readiness data to coach context)

**Step 1: Update `buildCoachSystemPrompt` in `src/ai/coachPrompt.ts`**

Add Banister readiness section to the system prompt. Find where ACWR is included and add after it:

```typescript
// After ACWR section, add:
if (context.banisterState) {
  const b = context.banisterState;
  sections.push(`### Banister Readiness
- Readiness Score: ${b.readiness}/100 (${b.recommendation})
- Fitness Load: ${b.fitness} | Fatigue Load: ${b.fatigue}
- Net Performance: ${b.performance}
- This means the runner is ${b.recommendation === 'push' ? 'fresh and ready for quality work' :
    b.recommendation === 'normal' ? 'in a normal training state' :
    b.recommendation === 'easy' ? 'accumulating fatigue — favor easy runs' :
    'overreached — needs rest or very easy running'}`);
}
```

**Step 2: Add `banisterState` to `TrainingContext` type if not already there**

In `src/types/index.ts`, add to the `TrainingContext` interface:

```typescript
banisterState?: BanisterState;
```

**Step 3: Update store to pass `banisterState` when building coach context**

In `src/store.ts`, wherever `TrainingContext` is assembled for the coach, include:

```typescript
banisterState: get().banisterState || undefined,
```

**Step 4: Commit**

```bash
git add src/ai/coachPrompt.ts src/types/index.ts src/store.ts
git commit -m "feat: add Banister readiness context to AI coach prompt"
```

---

### Task 11: Integration Testing & Polish

**Files:**
- All modified files

**Step 1: TypeScript compilation check**

Run: `npx tsc --noEmit --pretty 2>&1 | head -50`
Expected: No errors

**Step 2: Manual testing checklist**

Test on device:
- [ ] Complete a workout → see AI-gated adaptive adjustment toast
- [ ] Skip a workout → see redistribution + AI summary
- [ ] Check Plan tab → ⚡ icons on adjusted workouts, tap for detail
- [ ] Open Coach → ask "Why was my plan changed?" → coach explains with Banister data
- [ ] Check adaptive log in Settings → all decisions logged with AI reasoning
- [ ] Kill network → complete workout → deterministic fallback applies
- [ ] Trigger replan (skip many workouts) → see replan modal

**Step 3: Build and install**

Run: `npx expo run:ios --device`

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: adaptive engine v2 — AI-gated decisions, Banister model, replan triggers"
```

---

## Dependency Order

```
Task 1 (Banister)
  ↓
Task 2 (Split VDOT) ──────────┐
  ↓                            │
Task 3 (AI Types + Module) ────┤
  ↓                            │
Task 4 (Replan Engine) ────────┤
  ↓                            │
Task 5 (Replan Triggers) ──────┘
  ↓
Task 6 (Store Integration) ← depends on all above
  ↓
Task 7 (Toast UI) ─┐
Task 8 (Replan Modal) ─┤ can run in parallel
Task 9 (Plan Indicators) ─┤
Task 10 (Coach Context) ──┘
  ↓
Task 11 (Integration Testing)
```

Tasks 1-5 are independent pure functions. Task 6 wires everything together. Tasks 7-10 are UI and can be parallelized. Task 11 is final verification.
