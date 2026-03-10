# HealthKit Expansion & Recovery Scoring — Design

**Date**: 2026-03-10
**Status**: Approved

## Overview

Expand HealthKit integration from basic workout/HR reads to a comprehensive physiological data pipeline with recovery scoring. Feeds into adaptive engine (ACWR threshold modifiers) and AI coach (recovery context).

## Architecture

```
Garmin Watch → Garmin Connect → Apple HealthKit
                                      ↓
                              src/health/healthkit.ts
                              (lazy-loaded fetchers)
                                      ↓
                              health_snapshot (SQLite)
                              (2-hour cache per date)
                                      ↓
                         src/engine/recoveryScore.ts
                         (pure function: snapshot → score)
                                      ↓
                    ┌────────────┬────────────────┐
                    ↓            ↓                ↓
              Zustand state   adaptiveEngine   coachPrompt
              (UI badges)    (ACWR modifier)  (recovery context)
```

## Sync Timing

Fire-and-forget async after `initializeApp()` completes. The app renders immediately from SQLite cache; HealthKit queries run in parallel. Expo Go: `isHealthKitAvailable()` returns false → no-op → `recoveryStatus` stays null → UI shows "—".

## Types

```typescript
interface HealthSnapshot {
  id: string;
  date: string;
  resting_hr: number | null;
  hrv_sdnn: number | null;
  hrv_trend_7d: number[] | null;  // last 7 days of HRV values for coach context
  sleep_hours: number | null;
  sleep_quality: 'poor' | 'fair' | 'good' | null;
  weight_lbs: number | null;
  steps: number | null;
  recovery_score: number | null;
  signal_count: number;           // 0-4 available signals
  cached_at: string;
}

interface RecoveryStatus {
  score: number;                  // 0-100 (only valid when signalCount >= 2)
  signalCount: number;
  signals: RecoverySignal[];
  recommendation: 'full_send' | 'normal' | 'easy_only' | 'rest';
}

interface RecoverySignal {
  type: 'resting_hr' | 'hrv' | 'sleep' | 'volume_trend';
  value: number;
  score: number;                  // 0-25 contribution
  status: 'good' | 'fair' | 'poor';
}
```

**Minimum signal guard**: If `signalCount < 2`, do not display a recovery score. UI shows "Insufficient data". Engine functions treat recovery as null (no ACWR modifier).

## HealthKit Permissions

```
READ: DistanceWalkingRunning, HeartRate, Workout,
      RestingHeartRate, HeartRateVariabilitySDNN,
      SleepAnalysis, BodyMass, StepCount
WRITE: (none)
```

## HealthKit Fetchers (src/health/healthkit.ts)

All use existing `getHealthKit()` lazy-loading pattern:

- `getRestingHeartRate(date)` → `number | null`
- `getHRVSamples(date)` → `number | null` (avg SDNN for date)
- `getHRVTrend7d(date)` → `number[]` (last 7 days of daily HRV averages)
- `getSleepAnalysis(date)` → `{ hours, quality } | null`
- `getBodyMass()` → `number | null` (most recent, in lbs)
- `getStepCount(date)` → `number | null`
- `getDailyHealthSnapshot(date)` → `Partial<HealthSnapshot>` (calls all above)

## Recovery Score Calculator (src/engine/recoveryScore.ts)

Pure function. 4 signals x 25 points, normalized to available signals (min 2 required).

### Signal 1 — Resting HR (25pts)
- baseline = `profile.resting_hr`
- delta = `(snapshot.resting_hr - baseline) / baseline`
- `< -0.05` → 25, `< 0.05` → 20, `< 0.10` → 10, else → 5

### Signal 2 — HRV SDNN (25pts)
- baseline = 7-day rolling average (from `hrv_trend_7d`)
- delta = `(today - baseline) / baseline`
- `> 0.10` → 25, `> -0.05` → 20, `> -0.15` → 10, else → 5

### Signal 3 — Sleep (25pts)
- `hours >= 8 AND quality 'good'` → 25
- `hours >= 7 AND quality != 'poor'` → 20
- `hours >= 6` → 10
- else → 5

### Signal 4 — Volume Trend (25pts)
- Compare last 3 days avg daily volume to weekly avg daily volume
- ratio < 0.8 → 25, < 1.0 → 20, < 1.2 → 10, else → 5

### Normalization
`finalScore = (totalPoints / signalCount) * 4`

### Recommendation
- 80-100: `full_send`
- 60-79: `normal`
- 40-59: `easy_only`
- 0-39: `rest`

## SQLite Schema

```sql
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
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshot_date ON health_snapshot(date);
```

Cache: check if row exists for today AND `cached_at` < 2 hours old → skip fetch.

## Adaptive Engine Integration

### checkACWRSafety(acwr, workouts, today, recoveryStatus?)
- `score >= 80`: thresholds shift UP 0.1 (allow 1.4/1.6)
- `score < 40` (and signalCount >= 2): thresholds shift DOWN 0.1 (trigger at 1.2/1.4)
- `null` or `signalCount < 2`: no shift (backward compatible)

### evaluateVDOTUpdate(..., recoveryStatus?)
- `score < 40` (and signalCount >= 2): skip VDOT update — poor recovery distorts performance
- `null`: no guard

## Coach Prompt Section

```
RECOVERY STATUS:
- Score: 72/100 (3/4 signals)
- Resting HR: 52 bpm (baseline 50) — FAIR
- HRV: 48ms (7d avg 45) — GOOD
- HRV trend (7d): [42, 44, 43, 46, 45, 48, 48] — IMPROVING
- Sleep: 7.2h, fair quality — FAIR
- Volume trend: 0.95x weekly avg — GOOD
- Recommendation: NORMAL
```

If `signalCount < 2`: omit entire section (don't confuse Gemini with "insufficient data").

## UI Updates

### Today Screen
- Recovery badge next to ACWR badge: green >= 80, yellow >= 60, orange >= 40, red < 40
- Shows "72" with small "/4" signal count
- If signalCount < 2: show "—" (no score)

### Zones Screen
- New "Recovery" section at top showing all available signals with status dots
- Signal breakdown: each signal as a row with value + good/fair/poor indicator

### Coach Trigger
- If `recovery_score < 40` AND today's workout is quality AND signalCount >= 2:
  show subtle prompt "Low recovery detected — ask coach about today's workout?"

## Graceful Degradation

| Environment | HealthKit | Recovery | ACWR Modifier | Coach Section |
|---|---|---|---|---|
| Dev client (real device) | Full | Full | Applied | Included |
| Expo Go | Unavailable | null | None (default thresholds) | Omitted |
| Simulator | Unavailable | null | None | Omitted |
| HealthKit denied | Available but empty | null | None | Omitted |
