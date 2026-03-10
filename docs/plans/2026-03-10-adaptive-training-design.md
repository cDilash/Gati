# Adaptive Training System Design

**Date**: 2026-03-10
**Status**: Approved

## Overview

Transform the static one-shot plan generator into a hybrid adaptive system. The plan generator stays untouched — the adaptive layer sits on top, adjusting future workouts based on actual performance data.

Two layers:
1. **Math layer** — automatic, runs after every completed/skipped workout and on weekly app open. Handles ACWR safety, VDOT recalculation, volume redistribution.
2. **AI layer** — Gemini analyzes the full picture with enriched context. Already exists in coach chat, now gets adaptive data fed in.

## Adaptive Engine (Pure Functions)

File: `src/engine/adaptiveEngine.ts`

All functions are pure: data in, adjustments out. Zero side effects, no SQLite, no Zustand.

### calculateACWR
- Acute = total distance last 7 days
- Chronic = avg weekly distance last 28 days
- Returns ratio

### checkACWRSafety
- ACWR > 1.3: convert quality sessions to easy
- ACWR > 1.5: reduce ALL run distances by 20%
- ACWR < 0.8: no auto-adjustment (flag for AI)
- Never touches completed/skipped/rest workouts

### evaluateVDOTUpdate
- With HR data (2+ weeks evidence): +/- 1.0 VDOT, confidence "high"
- Without HR (3+ weeks evidence): +/- 0.5 VDOT, confidence "moderate"
- Pace 10+ sec/mi faster than target + HR in Zone 3-4 = increment
- Pace 10+ sec/mi slower + HR above Zone 4 = decrement

### reconcileWeek
- Planned vs actual volume comparison
- 80-120%: no change
- < 80%: extend next 2-3 easy runs by 0.5-1mi
- > 120%: reduce next week's easy runs
- Never reschedules missed quality sessions

### triageMissedWorkout
- Easy run: distribute 50% across remaining easy runs (max 1mi/run, max 15% increase)
- Quality session: drop it
- Long run: slot shorter version if weekend day available, else drop
- Rest/recovery: no action

## Integration (Synchronous Chain)

### markWorkoutComplete
1. Update status in SQLite
2. Query last 28 days of metrics
3. calculateACWR → if > 1.3, checkACWRSafety → apply to future workouts
4. Log to adaptive_log (async)
5. Update Zustand in one set() call

### markWorkoutSkipped
1. Update status
2. triageMissedWorkout → apply redistributions
3. ACWR check (same as complete)
4. Log + update Zustand

### initializeApp (weekly reconciliation)
1. Read lastReconciliationWeek from app_settings
2. Gap = 1: reconcile normally. Gap >= 2: reconcile last week only, flag aiAnalysisNeeded
3. evaluateVDOTUpdate if 2+ quality sessions completed
4. VDOT change → update profile, recalculate pace zones, update future workouts
5. Write lastReconciliationWeek

## Schema Changes

- New `adaptive_log` table
- Add `original_distance_miles` and `adjustment_reason` columns to workout

## UI Indicators

- Today: ACWR badge (green/yellow/red), adjustment banners, VDOT notification
- Plan: modified workout icon, reconciliation summary
- Coach: enriched prompt with ACWR + adaptive logs, proactive message on aiAnalysisNeeded

## Critical Rules

1. ACWR safety adjustments auto-apply (non-negotiable)
2. Never redistribute missed quality volume as more quality
3. VDOT needs 2-3 weeks of consistent evidence
4. Never modify completed workouts
5. Log every adaptive decision
6. Math engine and AI coach don't conflict
7. Reconciliation only looks forward
