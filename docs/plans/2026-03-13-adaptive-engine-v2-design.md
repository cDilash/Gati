# Adaptive Engine v2 — AI-Gated, Banister-Powered

**Date:** 2026-03-13
**Status:** Approved

## Overview

Upgrade the adaptive training engine from deterministic-only adjustments to an AI-gated system where every plan modification goes through Gemini before applying. Layer the Banister impulse-response (fitness-fatigue) model on top of existing ACWR for performance readiness prediction. Use a hybrid adjustment strategy: small per-workout adjustments normally, full replan when trajectory shifts significantly.

## Design Decisions

| Decision | Choice | Alternatives Considered |
|----------|--------|------------------------|
| Adjustment strategy | Hybrid (adjust + replan) | Adjust-only, replan-only |
| Banister integration | Layer on top of ACWR | Replace ACWR, simplified Banister |
| AI involvement | AI-Gated (all adjustments through Gemini) | Two-pass pipeline, AI for replan only, deterministic only |
| Architecture | Gemini decides, deterministic fallback | Deterministic decides with AI refinement |

## Section 1: Core Flow

```
User completes/skips workout
  ↓
Step 1: Data Assembly (instant, local)
  → Pull Strava metrics (pace, HR, splits, RPE, suffer score)
  → Calculate ACWR (7d acute / 28d chronic)
  → Calculate Banister readiness (fitness − fatigue curves)
  → Assess recovery (HealthKit: resting HR, HRV, sleep)
  → Evaluate VDOT (split-level analysis, HR evidence, race detection)
  → Propose deterministic adjustments
  ↓
Step 2: AI Decision (Gemini call)
  → Send assembled data + proposed adjustments to Gemini
  → Gemini returns structured JSON: approved/modified/rejected + reasoning
  → Gemini also flags if full replan is needed
  ↓
Step 3: Apply (after AI response)
  → Apply Gemini's approved adjustments to upcoming workouts
  → Update VDOT + pace zones if confirmed
  → Log everything to adaptive_log with AI reasoning
  → Show user notification with Gemini's summary
  ↓
Fallback: If Gemini unavailable
  → Apply deterministic adjustments automatically
  → Flag as "pending AI review"
  → Retry on next event or app launch (max 2 retries)
```

## Section 2: Banister Impulse-Response Model

### Equations

```
Performance(t) = Fitness(t) − Fatigue(t)

Fitness(t) = Fitness(t-1) × e^(-1/τ₁) + w(t) × k₁
Fatigue(t) = Fatigue(t-1) × e^(-1/τ₂) + w(t) × k₂

τ₁ = 45 days (fitness decay — slow)
τ₂ = 15 days (fatigue decay — fast)
k₁ = 1.0 (fitness gain multiplier)
k₂ = 2.0 (fatigue gain multiplier)
w(t) = TRIMP for day t
```

### TRIMP Calculation

```
TRIMP = duration_minutes × intensity_factor

Intensity factor (priority order):
  1. HR: avg_hr_fraction = (avg_hr - resting_hr) / (max_hr - resting_hr)
         intensity = 0.64 × e^(1.92 × avg_hr_fraction)
  2. Pace: zone mapping (E=0.6, M=0.8, T=0.9, I=1.0, R=1.1)
  3. RPE: rpe_score / 10
```

### Readiness Score (0–100)

| Range | State | Action |
|-------|-------|--------|
| 80–100 | Fresh | Schedule quality sessions |
| 60–79 | Normal | Proceed as planned |
| 40–59 | Fatigued | Prefer easy runs |
| 0–39 | Overreached | Convert to rest or easy only |

### Integration with ACWR

- ACWR → "Is this safe?" (injury prevention, reactive)
- Banister → "Is the runner ready?" (performance optimization, predictive)
- Both feed into the Gemini decision context
- ACWR > 1.3 AND readiness < 50 → strong signal to reduce
- ACWR normal AND readiness > 80 → opportunity to push harder
- Disagreement → Gemini arbitrates using full context

### Calibration

- Use sports science defaults (τ₁=45, τ₂=15) in v1
- No auto-calibration — revisit if needed
- Gemini can suggest recalibration in reasoning

## Section 3: Gemini AI Decision Engine

### Prompt Structure

Every adaptive event sends:
- **ROLE:** Sports science engine making training adjustments
- **CONTEXT:** Runner profile, VDOT, ACWR, Banister readiness, recovery, RPE trend
- **EVENT:** What happened (completed/skipped), Strava data, comparison to target
- **PROPOSED ADJUSTMENTS:** Deterministic engine's recommendations
- **INSTRUCTIONS:** Return JSON with approve/modify/reject per adjustment + summary

### Response Schema

```typescript
interface AdaptiveAIResponse {
  decisions: {
    workoutId: string;
    action: 'approve' | 'modify' | 'reject';
    adjustedValues?: {
      distance_miles?: number;
      workout_type?: WorkoutType;
      target_pace_zone?: PaceZoneName;
    };
    reasoning: string;
  }[];
  additions: {
    workoutId: string;
    adjustmentType: AdaptiveAdjustmentType;
    newDistance: number;
    newType: WorkoutType;
    reasoning: string;
  }[];
  summary: string;
  replanNeeded: boolean;
  replanReason?: string;
  vdotUpdate: {
    newVdot: number;
    confidence: 'high' | 'moderate';
    reasoning: string;
  } | null;
}
```

### Rate Limiting & Fallback

- One Gemini call per workout event (complete or skip)
- One Gemini call per replan (reviews full plan)
- ~5-7 calls/week — well within free tier 15 RPM
- Failure: apply deterministic, flag as pending, max 2 retries

## Section 4: Data Flow — Strava to Decision

### Per-Event Data

From Strava (already synced):
- `performance_metric`: distance, duration, pace, HR, RPE
- `strava_activity_detail`: splits, HR/pace streams, suffer score, workout type, cadence, elevation, best efforts

Consumed by engine:
- Last 7d metrics → ACWR acute
- Last 28d metrics → ACWR chronic + Banister TRIMP series
- Last 7 RPE scores → trend assessment
- Today's health_snapshot → recovery signals
- All future scheduled workouts → adjustment candidates

### Split-Level VDOT Analysis (New)

- **Tempo workouts:** Extract work splits (exclude warmup/cooldown), use median work-split pace vs T-pace target
- **Interval workouts:** Use laps_json for work vs recovery intervals, compare to I-pace target
- **Races (strava_workout_type === 1):** Finish time → direct VDOT lookup, high confidence

## Section 5: Replan Engine

### Trigger Thresholds

| Trigger | Threshold |
|---------|-----------|
| Low completion | < 60% for 2 consecutive weeks |
| Major fitness shift | VDOT changes ±3 or more |
| Extended gap | 10+ consecutive days missed |
| User request | Via coach chat or settings button |

### Replan Sequence

1. Snapshot: actual recent mileage (2-week avg), current VDOT, remaining weeks
2. Deterministic generation: `planGenerator.ts` with updated inputs, all safety constraints
3. Gemini review: full new plan + history + replan reason → structured tweaks
4. Apply: delete future scheduled workouts, insert new plan, log with reasoning
5. Fallback: deterministic plan if Gemini unavailable, flag for review

### History Preservation

Keep: performance_metric, strava_activity_detail, coach_message, adaptive_log, health_snapshot, completed/skipped workouts (NULL week_id)

Delete: future scheduled workouts, future training_weeks, old training_plan

### Edge Cases

| Scenario | Handling |
|----------|----------|
| < 4 weeks to race | Taper-only plan |
| < 2 weeks to race | Refuse replan, maintenance + taper |
| VDOT dropped significantly | Gemini warns, allows |
| Mid-week trigger | Start new plan next Monday, keep current week |

## Section 6: User Experience

### Adjustment Notifications

- Toast on Today tab: "Plan updated: [Gemini summary]"
- Each includes readiness score and key reason

### Replan Modal

- Full-screen, non-dismissible
- Shows: reason, key changes (V_start, peak, phase shifts), AI note
- Actions: [View New Plan] [View Changes]

### Plan Tab Indicators

- ⚡ icon on AI-modified workouts
- Tap shows: original → adjusted values + reasoning
- Banner on replanned weeks: "Plan regenerated on [date]"

### Coach Integration

- Coach aware of all adaptive decisions
- User can ask "Why was my plan changed?" → data-driven explanation
- User can request overrides → coach applies via plan mutation flow

### Principle

**The user always knows what changed and why.** Every adjustment has a human-readable summary from Gemini. Adaptive log always accessible. Coach can explain any past decision.
