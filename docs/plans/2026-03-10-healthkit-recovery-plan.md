# HealthKit Expansion & Recovery Scoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand HealthKit from basic workout/HR reads into a full physiological pipeline with recovery scoring that feeds into the adaptive engine and AI coach.

**Architecture:** Fire-and-forget async health sync after `initializeApp()`. HealthKit data → SQLite cache (2h TTL) → pure-function recovery scorer → Zustand state. Recovery score modifies ACWR safety thresholds and gates VDOT updates. All new code gracefully degrades when HealthKit is unavailable (Expo Go, Simulator).

**Tech Stack:** react-native-health (lazy-loaded), expo-sqlite, Zustand, pure TypeScript engine functions

**Design doc:** `docs/plans/2026-03-10-healthkit-recovery-design.md`

---

## Task 1: Add Health/Recovery Types

**Files:**
- Modify: `src/types/index.ts` (append after line 217)

**Step 1: Add the new types**

Append these types after the existing `GeneratedPlan` interface:

```typescript
// ─── Health & Recovery Types ─────────────────────────────────

export interface HealthSnapshot {
  id: string;
  date: string;
  resting_hr: number | null;
  hrv_sdnn: number | null;
  hrv_trend_7d: number[] | null;
  sleep_hours: number | null;
  sleep_quality: 'poor' | 'fair' | 'good' | null;
  weight_lbs: number | null;
  steps: number | null;
  recovery_score: number | null;
  signal_count: number;
  cached_at: string;
}

export interface RecoveryStatus {
  score: number;
  signalCount: number;
  signals: RecoverySignal[];
  recommendation: 'full_send' | 'normal' | 'easy_only' | 'rest';
}

export interface RecoverySignal {
  type: 'resting_hr' | 'hrv' | 'sleep' | 'volume_trend';
  value: number;
  score: number;
  status: 'good' | 'fair' | 'poor';
}
```

**Step 2: Add `recoveryStatus` to `TrainingContext`**

In the `TrainingContext` interface, add after the `lastReconciliation?` line:

```typescript
  recoveryStatus?: RecoveryStatus;
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors acceptable if they predate this change)

**Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add HealthSnapshot, RecoveryStatus, RecoverySignal types"
```

---

## Task 2: Add `health_snapshot` SQLite Table

**Files:**
- Modify: `src/db/schema.ts` (add table + index)
- Modify: `src/db/client.ts` (add to init + CRUD functions)

**Step 1: Add schema definition to `src/db/schema.ts`**

Add before the `ALL_TABLES` array:

```typescript
export const CREATE_HEALTH_SNAPSHOT = `
CREATE TABLE IF NOT EXISTS health_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  resting_hr INTEGER,
  hrv_sdnn REAL,
  hrv_trend_7d_json TEXT,
  sleep_hours REAL,
  sleep_quality TEXT,
  weight_lbs REAL,
  steps INTEGER,
  recovery_score INTEGER,
  signal_count INTEGER NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL
);`;

export const CREATE_HEALTH_SNAPSHOT_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshot_date ON health_snapshot(date);`;
```

Add `CREATE_HEALTH_SNAPSHOT` to the `ALL_TABLES` array.

**Step 2: Run index creation in `initializeDatabase()` in `src/db/client.ts`**

After the `MIGRATE_WORKOUT_ADAPTIVE` loop, add:

```typescript
  // Create health snapshot index
  try {
    database.execSync(CREATE_HEALTH_SNAPSHOT_INDEX);
  } catch {
    // Index already exists
  }
```

Import `CREATE_HEALTH_SNAPSHOT_INDEX` from `./schema` in the import statement.

**Step 3: Add health snapshot CRUD functions to `src/db/client.ts`**

Add these functions at the bottom, before the closing of the file. Import `HealthSnapshot` from `../types` in the import statement.

```typescript
// ─── Health Snapshot ─────────────────────────────────────────

export function getHealthSnapshot(date: string): HealthSnapshot | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>(
    'SELECT * FROM health_snapshot WHERE date = ?', date
  );
  if (!row) return null;
  return {
    ...row,
    hrv_trend_7d: row.hrv_trend_7d_json ? JSON.parse(row.hrv_trend_7d_json) : null,
  };
}

export function isHealthSnapshotFresh(date: string, maxAgeMs: number = 2 * 60 * 60 * 1000): boolean {
  const snapshot = getHealthSnapshot(date);
  if (!snapshot) return false;
  const age = Date.now() - new Date(snapshot.cached_at).getTime();
  return age < maxAgeMs;
}

export function saveHealthSnapshot(snapshot: HealthSnapshot): void {
  const database = getDatabase();
  database.runSync(
    `INSERT OR REPLACE INTO health_snapshot
     (id, date, resting_hr, hrv_sdnn, hrv_trend_7d_json, sleep_hours, sleep_quality, weight_lbs, steps, recovery_score, signal_count, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshot.id,
    snapshot.date,
    snapshot.resting_hr,
    snapshot.hrv_sdnn,
    snapshot.hrv_trend_7d ? JSON.stringify(snapshot.hrv_trend_7d) : null,
    snapshot.sleep_hours,
    snapshot.sleep_quality,
    snapshot.weight_lbs,
    snapshot.steps,
    snapshot.recovery_score,
    snapshot.signal_count,
    snapshot.cached_at
  );
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add src/db/schema.ts src/db/client.ts
git commit -m "feat: add health_snapshot table with cache-aware CRUD"
```

---

## Task 3: Expand HealthKit Fetchers

**Files:**
- Modify: `src/health/healthkit.ts` (add 6 new fetcher functions + expand permissions)

**Step 1: Expand permissions in `initHealthKit()`**

Replace the existing `permissions` object inside `initHealthKit()` with:

```typescript
    const permissions = {
      permissions: {
        read: [
          hk.Constants.Permissions.DistanceWalkingRunning,
          hk.Constants.Permissions.HeartRate,
          hk.Constants.Permissions.Workout,
          hk.Constants.Permissions.RestingHeartRate,
          hk.Constants.Permissions.HeartRateVariability,
          hk.Constants.Permissions.SleepAnalysis,
          hk.Constants.Permissions.Weight,
          hk.Constants.Permissions.StepCount,
        ],
        write: [],
      },
    };
```

**Step 2: Add `getRestingHeartRate` function**

```typescript
export function getRestingHeartRate(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getRestingHeartRate(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }
        resolve(Math.round(results[results.length - 1].value));
      }
    );
  });
}
```

**Step 3: Add `getHRVSamples` function**

```typescript
export function getHRVSamples(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getHeartRateVariabilitySamples(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }
        const avg = results.reduce((sum: number, r: any) => sum + r.value, 0) / results.length;
        resolve(Math.round(avg * 10) / 10);
      }
    );
  });
}
```

**Step 4: Add `getHRVTrend7d` function**

```typescript
export function getHRVTrend7d(date: Date): Promise<number[]> {
  return new Promise(async (resolve) => {
    const trend: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(date);
      d.setDate(d.getDate() - i);
      const val = await getHRVSamples(d);
      if (val !== null) trend.push(val);
    }
    resolve(trend);
  });
}
```

**Step 5: Add `getSleepAnalysis` function**

```typescript
export function getSleepAnalysis(date: Date): Promise<{ hours: number; quality: 'poor' | 'fair' | 'good' } | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    // Sleep for "last night" — query from 6pm previous day to noon today
    const sleepStart = new Date(date);
    sleepStart.setDate(sleepStart.getDate() - 1);
    sleepStart.setHours(18, 0, 0, 0);
    const sleepEnd = new Date(date);
    sleepEnd.setHours(12, 0, 0, 0);

    hk.getSleepSamples(
      { startDate: sleepStart.toISOString(), endDate: sleepEnd.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }

        // Sum total sleep time (exclude INBED, only count ASLEEP/CORE/DEEP/REM)
        let totalMinutes = 0;
        let deepMinutes = 0;
        let remMinutes = 0;

        for (const sample of results) {
          const value = sample.value;
          const start = new Date(sample.startDate || sample.start).getTime();
          const end = new Date(sample.endDate || sample.end).getTime();
          const mins = (end - start) / 60000;

          if (value === 'ASLEEP' || value === 'CORE' || value === 'DEEP' || value === 'REM') {
            totalMinutes += mins;
          }
          if (value === 'DEEP') deepMinutes += mins;
          if (value === 'REM') remMinutes += mins;
        }

        if (totalMinutes < 30) { resolve(null); return; }

        const hours = Math.round(totalMinutes / 60 * 10) / 10;
        const deepRatio = totalMinutes > 0 ? (deepMinutes + remMinutes) / totalMinutes : 0;

        let quality: 'poor' | 'fair' | 'good';
        if (hours >= 7 && deepRatio >= 0.35) quality = 'good';
        else if (hours >= 6 && deepRatio >= 0.2) quality = 'fair';
        else quality = 'poor';

        resolve({ hours, quality });
      }
    );
  });
}
```

**Step 6: Add `getBodyMass` and `getStepCount` functions**

```typescript
export function getBodyMass(): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    hk.getLatestWeight(
      { unit: 'pound' },
      (error: any, result: any) => {
        if (error || !result) { resolve(null); return; }
        resolve(Math.round(result.value * 10) / 10);
      }
    );
  });
}

export function getStepCount(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getStepCount(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, result: any) => {
        if (error || !result) { resolve(null); return; }
        resolve(Math.round(result.value));
      }
    );
  });
}
```

**Step 7: Add composite `getDailyHealthSnapshot` function**

```typescript
import { HealthSnapshot } from '../types';
import * as Crypto from 'expo-crypto';
```

(Add `HealthSnapshot` to the existing import if types are already imported, or add new import.)

```typescript
export async function getDailyHealthSnapshot(date: Date): Promise<Partial<HealthSnapshot>> {
  // Run all fetchers in parallel for speed
  const [restingHR, hrv, hrvTrend, sleep, weight, steps] = await Promise.all([
    getRestingHeartRate(date),
    getHRVSamples(date),
    getHRVTrend7d(date),
    getSleepAnalysis(date),
    getBodyMass(),
    getStepCount(date),
  ]);

  return {
    id: Crypto.randomUUID(),
    date: date.toISOString().split('T')[0],
    resting_hr: restingHR,
    hrv_sdnn: hrv,
    hrv_trend_7d: hrvTrend.length > 0 ? hrvTrend : null,
    sleep_hours: sleep?.hours ?? null,
    sleep_quality: sleep?.quality ?? null,
    weight_lbs: weight,
    steps,
    cached_at: new Date().toISOString(),
  };
}
```

**Step 8: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 9: Commit**

```bash
git add src/health/healthkit.ts
git commit -m "feat: expand HealthKit fetchers — resting HR, HRV, sleep, weight, steps, composite snapshot"
```

---

## Task 4: Recovery Score Calculator (Pure Engine)

**Files:**
- Create: `src/engine/recoveryScore.ts`

**Step 1: Create the recovery score calculator**

Create `src/engine/recoveryScore.ts`:

```typescript
/**
 * Recovery Score Calculator — Pure Function
 *
 * Input: health snapshot + profile baseline + recent volume data
 * Output: RecoveryStatus (0-100 score + signal breakdown)
 *
 * Zero side effects: no SQLite, no Zustand, no HealthKit.
 * Requires at least 2 signals to produce a score.
 */

import { RecoveryStatus, RecoverySignal, HealthSnapshot, UserProfile, PerformanceMetric } from '../types';

interface RecoveryInput {
  snapshot: HealthSnapshot;
  profile: UserProfile;
  recentMetrics: PerformanceMetric[]; // last 7 days
  today: string; // ISO date
}

export function calculateRecoveryScore(input: RecoveryInput): RecoveryStatus | null {
  const { snapshot, profile, recentMetrics, today } = input;
  const signals: RecoverySignal[] = [];

  // Signal 1: Resting HR
  if (snapshot.resting_hr != null && profile.resting_hr > 0) {
    const baseline = profile.resting_hr;
    const delta = (snapshot.resting_hr - baseline) / baseline;
    let score: number;
    let status: 'good' | 'fair' | 'poor';

    if (delta < -0.05) { score = 25; status = 'good'; }
    else if (delta < 0.05) { score = 20; status = 'good'; }
    else if (delta < 0.10) { score = 10; status = 'fair'; }
    else { score = 5; status = 'poor'; }

    signals.push({ type: 'resting_hr', value: snapshot.resting_hr, score, status });
  }

  // Signal 2: HRV SDNN
  if (snapshot.hrv_sdnn != null && snapshot.hrv_trend_7d && snapshot.hrv_trend_7d.length >= 3) {
    const baseline = snapshot.hrv_trend_7d.reduce((a, b) => a + b, 0) / snapshot.hrv_trend_7d.length;
    const delta = baseline > 0 ? (snapshot.hrv_sdnn - baseline) / baseline : 0;
    let score: number;
    let status: 'good' | 'fair' | 'poor';

    if (delta > 0.10) { score = 25; status = 'good'; }
    else if (delta > -0.05) { score = 20; status = 'good'; }
    else if (delta > -0.15) { score = 10; status = 'fair'; }
    else { score = 5; status = 'poor'; }

    signals.push({ type: 'hrv', value: snapshot.hrv_sdnn, score, status });
  }

  // Signal 3: Sleep
  if (snapshot.sleep_hours != null && snapshot.sleep_quality != null) {
    let score: number;
    let status: 'good' | 'fair' | 'poor';

    if (snapshot.sleep_hours >= 8 && snapshot.sleep_quality === 'good') { score = 25; status = 'good'; }
    else if (snapshot.sleep_hours >= 7 && snapshot.sleep_quality !== 'poor') { score = 20; status = 'good'; }
    else if (snapshot.sleep_hours >= 6) { score = 10; status = 'fair'; }
    else { score = 5; status = 'poor'; }

    signals.push({ type: 'sleep', value: snapshot.sleep_hours, score, status });
  }

  // Signal 4: Volume Trend
  if (recentMetrics.length > 0) {
    const todayMs = new Date(today).getTime();
    const last3dMetrics = recentMetrics.filter(m => {
      const mMs = new Date(m.date).getTime();
      return mMs >= todayMs - 3 * 86400000 && mMs <= todayMs;
    });
    const last7dMetrics = recentMetrics.filter(m => {
      const mMs = new Date(m.date).getTime();
      return mMs >= todayMs - 7 * 86400000 && mMs <= todayMs;
    });

    if (last7dMetrics.length >= 3) {
      const recent3dTotal = last3dMetrics.reduce((s, m) => s + m.distance_miles, 0);
      const weekly7dTotal = last7dMetrics.reduce((s, m) => s + m.distance_miles, 0);
      const dailyAvg3d = recent3dTotal / 3;
      const dailyAvg7d = weekly7dTotal / 7;
      const ratio = dailyAvg7d > 0 ? dailyAvg3d / dailyAvg7d : 1;

      let score: number;
      let status: 'good' | 'fair' | 'poor';

      if (ratio < 0.8) { score = 25; status = 'good'; }
      else if (ratio < 1.0) { score = 20; status = 'good'; }
      else if (ratio < 1.2) { score = 10; status = 'fair'; }
      else { score = 5; status = 'poor'; }

      signals.push({ type: 'volume_trend', value: Math.round(ratio * 100) / 100, score, status });
    }
  }

  // Minimum signal guard: require at least 2 signals
  if (signals.length < 2) return null;

  // Normalize: scale total to 0-100 regardless of signal count
  const totalPoints = signals.reduce((s, sig) => s + sig.score, 0);
  const finalScore = Math.round((totalPoints / signals.length) * 4);

  // Recommendation
  let recommendation: RecoveryStatus['recommendation'];
  if (finalScore >= 80) recommendation = 'full_send';
  else if (finalScore >= 60) recommendation = 'normal';
  else if (finalScore >= 40) recommendation = 'easy_only';
  else recommendation = 'rest';

  return {
    score: finalScore,
    signalCount: signals.length,
    signals,
    recommendation,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/engine/recoveryScore.ts
git commit -m "feat: add pure-function recovery score calculator (4 signals, normalized, min 2 required)"
```

---

## Task 5: Integrate Recovery into Adaptive Engine

**Files:**
- Modify: `src/engine/adaptiveEngine.ts` (add optional `recoveryStatus` param to 2 functions)

**Step 1: Modify `checkACWRSafety` signature and logic**

Add `RecoveryStatus` to imports:

```typescript
import {
  PerformanceMetric, Workout, WorkoutAdjustment, VDOTUpdateResult,
  PlanReconciliation, TrainingWeek, PaceZones, HRZones, WorkoutType,
  RecoveryStatus,
} from '../types';
```

Update the function signature and add threshold shifting at the top:

```typescript
export function checkACWRSafety(
  acwr: number,
  upcomingWorkouts: Workout[],
  today: string,
  recoveryStatus?: RecoveryStatus | null,
): WorkoutAdjustment[] {
  const adjustments: WorkoutAdjustment[] = [];
  const now = new Date().toISOString();

  // Recovery-based threshold shifting
  let convertThreshold = 1.3;
  let reduceThreshold = 1.5;
  if (recoveryStatus && recoveryStatus.signalCount >= 2) {
    if (recoveryStatus.score >= 80) {
      convertThreshold = 1.4;
      reduceThreshold = 1.6;
    } else if (recoveryStatus.score < 40) {
      convertThreshold = 1.2;
      reduceThreshold = 1.4;
    }
  }

  const eligible = upcomingWorkouts.filter(
    w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
  );

  if (acwr > reduceThreshold) {
    for (const w of eligible) {
      const newDistance = Math.max(Math.round(w.distance_miles * 0.8 * 10) / 10, 3);
      if (newDistance < w.distance_miles) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'reduce_distance',
          originalDistance: w.distance_miles,
          newDistance,
          originalType: w.workout_type,
          newType: w.workout_type,
          reason: `ACWR ${acwr.toFixed(2)} exceeds ${reduceThreshold} threshold${recoveryStatus ? ` (recovery ${recoveryStatus.score}/100)` : ''}. Distance reduced 20%.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  } else if (acwr > convertThreshold) {
    const qualityTypes: WorkoutType[] = ['tempo', 'interval', 'marathon_pace'];
    for (const w of eligible) {
      if (qualityTypes.includes(w.workout_type)) {
        adjustments.push({
          workoutId: w.id,
          adjustmentType: 'convert_to_easy',
          originalDistance: w.distance_miles,
          newDistance: w.distance_miles,
          originalType: w.workout_type,
          newType: 'easy',
          reason: `ACWR ${acwr.toFixed(2)} exceeds ${convertThreshold} threshold${recoveryStatus ? ` (recovery ${recoveryStatus.score}/100)` : ''}. Quality → easy.`,
          autoApplied: true,
          timestamp: now,
        });
      }
    }
  }

  return adjustments;
}
```

**Step 2: Add recovery guard to `evaluateVDOTUpdate`**

Update the signature to accept optional recovery:

```typescript
export function evaluateVDOTUpdate(
  completedQualityWorkouts: WorkoutWithMetric[],
  currentVDOT: number,
  paceZones: PaceZones,
  hrZones: HRZones,
  recoveryStatus?: RecoveryStatus | null,
): VDOTUpdateResult | null {
  if (completedQualityWorkouts.length < 2) return null;

  // Recovery guard: skip VDOT update if poorly recovered (distorted performance)
  if (recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40) {
    return null;
  }

  // ... rest of function unchanged
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src/engine/adaptiveEngine.ts
git commit -m "feat: add recovery-based ACWR threshold shifting and VDOT recovery guard"
```

---

## Task 6: Store Integration — Health Sync Action

**Files:**
- Modify: `src/store.ts` (add `recoveryStatus` state, `syncHealthData` action, pass recovery to engine calls)

**Step 1: Add imports**

Add to the imports at top of `src/store.ts`:

```typescript
import { RecoveryStatus, HealthSnapshot } from './types';
import { calculateRecoveryScore } from './engine/recoveryScore';
import { getHealthSnapshot, isHealthSnapshotFresh, saveHealthSnapshot } from './db/client';
```

**Step 2: Add state and action to `AppState` interface**

Add to the interface:

```typescript
  // In the state section:
  recoveryStatus: RecoveryStatus | null;

  // In the actions section:
  syncHealthData: () => Promise<void>;
```

**Step 3: Initialize default state**

In the store creation, add:

```typescript
  recoveryStatus: null,
```

**Step 4: Implement `syncHealthData` action**

Add this action inside the store:

```typescript
  syncHealthData: async () => {
    const { userProfile } = get();
    if (!userProfile) return;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Check cache first
    if (isHealthSnapshotFresh(todayStr)) {
      const cached = getHealthSnapshot(todayStr);
      if (cached && cached.signal_count >= 2 && cached.recovery_score != null) {
        const recentMetrics = getMetricsForDateRange(
          new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
          todayStr
        );
        const recoveryStatus = calculateRecoveryScore({
          snapshot: cached,
          profile: userProfile,
          recentMetrics,
          today: todayStr,
        });
        set({ recoveryStatus });
        return;
      }
    }

    // Fetch fresh data from HealthKit
    try {
      const { isHealthKitAvailable, initHealthKit, getDailyHealthSnapshot } = require('./health/healthkit');
      if (!isHealthKitAvailable()) return;

      const initialized = await initHealthKit();
      if (!initialized) return;

      const partial = await getDailyHealthSnapshot(today);

      // Count signals
      let signalCount = 0;
      if (partial.resting_hr != null) signalCount++;
      if (partial.hrv_sdnn != null && partial.hrv_trend_7d && partial.hrv_trend_7d.length >= 3) signalCount++;
      if (partial.sleep_hours != null && partial.sleep_quality != null) signalCount++;
      // Volume trend signal is calculated from metrics, always available if we have any
      const day7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const recentMetrics = getMetricsForDateRange(day7Ago, todayStr);
      const hasVolumeSignal = recentMetrics.length >= 3;
      if (hasVolumeSignal) signalCount++;

      const snapshot: HealthSnapshot = {
        id: partial.id || require('expo-crypto').randomUUID(),
        date: todayStr,
        resting_hr: partial.resting_hr ?? null,
        hrv_sdnn: partial.hrv_sdnn ?? null,
        hrv_trend_7d: partial.hrv_trend_7d ?? null,
        sleep_hours: partial.sleep_hours ?? null,
        sleep_quality: partial.sleep_quality ?? null,
        weight_lbs: partial.weight_lbs ?? null,
        steps: partial.steps ?? null,
        recovery_score: null, // calculated below
        signal_count: signalCount,
        cached_at: new Date().toISOString(),
      };

      // Calculate recovery score
      const recoveryStatus = calculateRecoveryScore({
        snapshot,
        profile: userProfile,
        recentMetrics,
        today: todayStr,
      });

      snapshot.recovery_score = recoveryStatus?.score ?? null;
      snapshot.signal_count = signalCount;

      // Save to SQLite cache
      saveHealthSnapshot(snapshot);

      // Update Zustand
      set({ recoveryStatus });
    } catch (e) {
      console.warn('Health sync failed (expected in Expo Go):', e);
    }
  },
```

**Step 5: Pass `recoveryStatus` to ACWR safety checks**

In `markWorkoutComplete`, update the `checkACWRSafety` call:

Find:
```typescript
      const adjustments = checkACWRSafety(acwr, futureScheduled, today);
```
Replace with:
```typescript
      const adjustments = checkACWRSafety(acwr, futureScheduled, today, get().recoveryStatus);
```

In `markWorkoutSkipped`, same change:

Find:
```typescript
      const acwrAdjustments = checkACWRSafety(acwr, futureScheduled, today);
```
Replace with:
```typescript
      const acwrAdjustments = checkACWRSafety(acwr, futureScheduled, today, get().recoveryStatus);
```

**Step 6: Pass `recoveryStatus` to VDOT evaluation in `initializeApp`**

Find in the reconciliation section:
```typescript
              vdotUpdate = evaluateVDOTUpdate(workoutMetricPairs, profile.vdot, paceZones, hrZones);
```
Replace with:
```typescript
              vdotUpdate = evaluateVDOTUpdate(workoutMetricPairs, profile.vdot, paceZones, hrZones, get().recoveryStatus);
```

**Step 7: Add `recoveryStatus` to `getTrainingContext`**

In `getTrainingContext`, add to the destructured state:

```typescript
const { ..., recoveryStatus } = get();
```

Add to the returned object:

```typescript
      recoveryStatus: recoveryStatus || undefined,
```

**Step 8: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 9: Commit**

```bash
git add src/store.ts
git commit -m "feat: add syncHealthData action with cache-aware HealthKit fetch and recovery integration"
```

---

## Task 7: Trigger Health Sync from Root Layout

**Files:**
- Modify: `app/_layout.tsx` (add fire-and-forget health sync after init)

**Step 1: Read the current `_layout.tsx`**

Read: `app/_layout.tsx` to understand current structure.

**Step 2: Add health sync effect**

After the existing `useEffect` that calls `initializeApp()`, add a second effect:

```typescript
  useEffect(() => {
    if (isInitialized) {
      // Fire-and-forget: sync health data in background
      useAppStore.getState().syncHealthData();
    }
  }, [isInitialized]);
```

This ensures health sync runs AFTER `initializeApp()` completes (which sets `isInitialized: true`), but doesn't block initial render.

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: trigger fire-and-forget health sync after app initialization"
```

---

## Task 8: Enhanced Coach Prompt with Recovery Data

**Files:**
- Modify: `src/ai/coachPrompt.ts` (add recovery section)

**Step 1: Add recovery section to `buildCoachSystemPrompt`**

After the `recentAdaptiveLogs` section (around line 87), add:

```typescript
  // Recovery status
  if (context.recoveryStatus && context.recoveryStatus.signalCount >= 2) {
    const rs = context.recoveryStatus;
    const signalLines = rs.signals.map(s => {
      switch (s.type) {
        case 'resting_hr': return `- Resting HR: ${s.value} bpm (baseline ${context.profile.resting_hr}) — ${s.status.toUpperCase()}`;
        case 'hrv': {
          const snapshot = context.recoveryStatus as any; // signals carry the raw value
          return `- HRV: ${s.value}ms — ${s.status.toUpperCase()}`;
        }
        case 'sleep': return `- Sleep: ${s.value}h — ${s.status.toUpperCase()}`;
        case 'volume_trend': return `- Volume trend: ${s.value}x weekly avg — ${s.status.toUpperCase()}`;
      }
    });
    sections.push(`RECOVERY STATUS:\n- Score: ${rs.score}/100 (${rs.signalCount}/4 signals)\n${signalLines.join('\n')}\n- Recommendation: ${rs.recommendation.toUpperCase().replace('_', ' ')}`);
  }
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/ai/coachPrompt.ts
git commit -m "feat: add recovery status section to AI coach system prompt"
```

---

## Task 9: Today Screen — Recovery Badge

**Files:**
- Modify: `app/(tabs)/index.tsx` (add RecoveryBadge component + coach trigger)

**Step 1: Add `RecoveryBadge` component**

After the existing `ACWRBadge` component, add:

```typescript
function RecoveryBadge({ recovery }: { recovery: RecoveryStatus | null }) {
  if (!recovery || recovery.signalCount < 2) {
    return (
      <View style={styles.recoveryBadge}>
        <Text style={styles.recoveryBadgeText}>—</Text>
      </View>
    );
  }

  const color = recovery.score >= 80 ? COLORS.success
    : recovery.score >= 60 ? COLORS.warning
    : recovery.score >= 40 ? '#FF9500'
    : COLORS.danger;

  return (
    <View style={[styles.recoveryBadge, { backgroundColor: color }]}>
      <Text style={styles.recoveryBadgeText}>{recovery.score}</Text>
    </View>
  );
}
```

**Step 2: Wire the badge into the Today screen**

In the `TodayScreen` component, destructure `recoveryStatus` from the store:

```typescript
  const { ..., recoveryStatus } = useAppStore();
```

In the `weekBadgeRow`, add the recovery badge after the ACWR badge:

```typescript
          <ACWRBadge acwr={currentACWR} />
          <RecoveryBadge recovery={recoveryStatus} />
```

**Step 3: Add low recovery coach prompt**

After the VDOT banner section and before the `isRest` ternary, add:

```typescript
      {recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40 && todaysWorkout && !isRest && ['tempo', 'interval', 'marathon_pace'].includes(todaysWorkout.workout_type) && todaysWorkout.status === 'scheduled' && (
        <Pressable style={styles.recoveryWarning} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.recoveryWarningText}>Low recovery detected — ask coach about today's workout?</Text>
        </Pressable>
      )}
```

Import `useRouter` from `expo-router` (add to existing imports if not present):

```typescript
import { useRouter } from 'expo-router';
```

And in the component:
```typescript
  const router = useRouter();
```

**Step 4: Add styles**

Add to the `StyleSheet.create`:

```typescript
  recoveryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: COLORS.textTertiary },
  recoveryBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Courier' },
  recoveryWarning: { backgroundColor: 'rgba(255, 59, 48, 0.12)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.3)' },
  recoveryWarningText: { color: COLORS.danger, fontSize: 13, fontWeight: '600', lineHeight: 18 },
```

**Step 5: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 6: Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat: add recovery badge on Today screen + low-recovery coach prompt"
```

---

## Task 10: Zones Screen — Recovery Section

**Files:**
- Modify: `app/(tabs)/zones.tsx` (add recovery signals display)

**Step 1: Import store and types**

Add to imports:

```typescript
import { useAppStore } from '../../src/store';
```

(Already imported — just need to destructure `recoveryStatus` from it.)

Actually `useAppStore` is already imported. Destructure `recoveryStatus`:

```typescript
  const { userProfile, paceZones, hrZones, recoveryStatus } = useAppStore();
```

**Step 2: Add Recovery section above the VDOT card**

Before `{/* VDOT Card */}`, add:

```typescript
      {/* Recovery */}
      {recoveryStatus && recoveryStatus.signalCount >= 2 && (
        <View style={styles.recoveryCard}>
          <View style={styles.recoveryHeader}>
            <Text style={styles.recoverySectionTitle}>Recovery</Text>
            <View style={[styles.recoveryScoreBadge, {
              backgroundColor: recoveryStatus.score >= 80 ? COLORS.success
                : recoveryStatus.score >= 60 ? COLORS.warning
                : recoveryStatus.score >= 40 ? '#FF9500'
                : COLORS.danger
            }]}>
              <Text style={styles.recoveryScoreText}>{recoveryStatus.score}</Text>
            </View>
          </View>
          <Text style={styles.recoveryRecommendation}>
            {recoveryStatus.recommendation === 'full_send' ? 'Fully recovered — go for it'
              : recoveryStatus.recommendation === 'normal' ? 'Normal recovery — train as planned'
              : recoveryStatus.recommendation === 'easy_only' ? 'Moderate fatigue — easy effort only'
              : 'High fatigue — consider rest'}
          </Text>
          {recoveryStatus.signals.map((sig, idx) => (
            <View key={idx} style={styles.signalRow}>
              <View style={[styles.signalDot, {
                backgroundColor: sig.status === 'good' ? COLORS.success : sig.status === 'fair' ? COLORS.warning : COLORS.danger
              }]} />
              <Text style={styles.signalType}>
                {sig.type === 'resting_hr' ? 'Resting HR' : sig.type === 'hrv' ? 'HRV' : sig.type === 'sleep' ? 'Sleep' : 'Volume'}
              </Text>
              <Text style={styles.signalValue}>
                {sig.type === 'resting_hr' ? `${sig.value} bpm`
                  : sig.type === 'hrv' ? `${sig.value} ms`
                  : sig.type === 'sleep' ? `${sig.value}h`
                  : `${sig.value}x avg`}
              </Text>
              <Text style={styles.signalStatus}>{sig.status.toUpperCase()}</Text>
            </View>
          ))}
          <Text style={styles.signalCountNote}>{recoveryStatus.signalCount}/4 signals</Text>
        </View>
      )}
```

**Step 3: Add styles**

Add to the `StyleSheet.create`:

```typescript
  recoveryCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  recoveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  recoverySectionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  recoveryScoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  recoveryScoreText: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'Courier' },
  recoveryRecommendation: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 },
  signalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  signalDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  signalType: { color: COLORS.text, fontSize: 14, flex: 1 },
  signalValue: { color: COLORS.textSecondary, fontSize: 14, fontFamily: 'Courier', marginRight: 12 },
  signalStatus: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', width: 40 },
  signalCountNote: { color: COLORS.textTertiary, fontSize: 11, marginTop: 8, textAlign: 'right' },
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add app/(tabs)/zones.tsx
git commit -m "feat: add recovery signals section to Zones screen"
```

---

## Task 11: Final Verification

**Step 1: Run TypeScript check**

Run: `cd /Users/dc/Projects/Gati && npx tsc --noEmit 2>&1 | tail -20`
Expected: No new errors from our changes.

**Step 2: Start Expo and verify no crash**

Run: `cd /Users/dc/Projects/Gati && npx expo start --ios 2>&1 | head -30`
Expected: App bundles and opens without crash. In Expo Go, recovery badge shows "—" (graceful degradation). No HealthKit errors in console.

**Step 3: Verify the health_snapshot table exists**

After app opens, check SQLite:
- The `health_snapshot` table should be created by `initializeDatabase()`
- `isHealthSnapshotFresh` should return false (no data yet)
- `syncHealthData` should log "Health sync failed (expected in Expo Go)" or succeed silently

**Step 4: Final commit (if any lint/type fixes needed)**

```bash
git add -A
git commit -m "fix: resolve any remaining type errors from health integration"
```
