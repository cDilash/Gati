/**
 * Safety Validator — thin math layer that runs AFTER AI generates a plan.
 *
 * Only checks quantitative constraints. Silently clamps violations.
 * Never rejects. Never regenerates. Just caps dangerous numbers.
 *
 * This is ~50 lines of actual logic. That's the point.
 */

import { AIGeneratedPlan, AIWeek, SafetyValidation, SafetyViolation, UserProfile } from '../types';

// ─── Safety Rules ───────────────────────────────────────────

const SAFETY_RULES = {
  maxWeeklyVolumeIncrease: 0.15,     // 15% max week-over-week
  maxLongRunPercentOfWeekly: 0.35,   // long run ≤ 35% of weekly volume
  maxQualityPercentOfWeekly: 0.20,   // quality work ≤ 20% of weekly volume
  minRunDistance: 2.0,                // no run shorter than 2 miles
  maxPeakMultiplier: 1.6,            // peak can't exceed 1.6× starting volume
  taperWeeks: 3,                     // last 3 weeks must reduce volume
  taperMultipliers: [0.75, 0.50, 0.30],
  minRestDaysPerWeek: 1,             // at least 1 rest day per week
};

const QUALITY_TYPES = new Set([
  'threshold', 'intervals', 'tempo', 'hill_repeats', 'fartlek', 'marathon_pace',
]);

// ─── Validator ──────────────────────────────────────────────

export function validateAndCorrectPlan(
  plan: AIGeneratedPlan,
  profile: UserProfile,
): SafetyValidation {
  const violations: SafetyViolation[] = [];
  const correctedWeeks = plan.weeks.map(w => ({ ...w, workouts: w.workouts.map(wo => ({ ...wo })) }));
  const startingVolume = profile.current_weekly_miles;
  const maxPeakVolume = startingVolume * SAFETY_RULES.maxPeakMultiplier;

  for (let i = 0; i < correctedWeeks.length; i++) {
    const week = correctedWeeks[i];

    // ── Rule 1: Max weekly volume increase (15% from previous non-cutback) ──
    if (i > 0) {
      const prevWeek = correctedWeeks[i - 1];
      const prevVolume = prevWeek.isCutback && i >= 2
        ? correctedWeeks[i - 2].targetVolume
        : prevWeek.targetVolume;
      const maxAllowed = prevVolume * (1 + SAFETY_RULES.maxWeeklyVolumeIncrease);

      if (!week.isCutback && week.targetVolume > maxAllowed) {
        const original = week.targetVolume;
        week.targetVolume = Math.round(maxAllowed * 10) / 10;
        scaleWorkoutDistances(week, original, week.targetVolume);
        violations.push({
          weekNumber: week.weekNumber,
          field: 'targetVolume',
          originalValue: original,
          clampedValue: week.targetVolume,
          rule: `Weekly volume increase capped at ${SAFETY_RULES.maxWeeklyVolumeIncrease * 100}%`,
        });
      }
    }

    // ── Rule 2: Peak volume cap ──
    if (week.targetVolume > maxPeakVolume && !week.isCutback) {
      const original = week.targetVolume;
      week.targetVolume = Math.round(maxPeakVolume * 10) / 10;
      scaleWorkoutDistances(week, original, week.targetVolume);
      violations.push({
        weekNumber: week.weekNumber,
        field: 'targetVolume',
        originalValue: original,
        clampedValue: week.targetVolume,
        rule: `Peak volume capped at ${SAFETY_RULES.maxPeakMultiplier}× starting volume`,
      });
    }

    // ── Rule 3: Long run ≤ 35% of weekly volume ──
    const longRun = week.workouts.find(w => w.type === 'long_run');
    if (longRun && week.targetVolume > 0) {
      const maxLongRun = week.targetVolume * SAFETY_RULES.maxLongRunPercentOfWeekly;
      if (longRun.distanceMiles > maxLongRun) {
        const original = longRun.distanceMiles;
        longRun.distanceMiles = Math.round(maxLongRun * 10) / 10;
        violations.push({
          weekNumber: week.weekNumber,
          field: 'longRunDistance',
          originalValue: original,
          clampedValue: longRun.distanceMiles,
          rule: `Long run capped at ${SAFETY_RULES.maxLongRunPercentOfWeekly * 100}% of weekly volume`,
        });
      }
    }

    // ── Rule 4: Quality volume ≤ 20% of weekly ──
    const qualityWorkouts = week.workouts.filter(w => QUALITY_TYPES.has(w.type));
    const qualityVolume = qualityWorkouts.reduce((sum, w) => sum + w.distanceMiles, 0);
    const maxQuality = week.targetVolume * SAFETY_RULES.maxQualityPercentOfWeekly;
    if (qualityVolume > maxQuality && qualityWorkouts.length > 0) {
      const scale = maxQuality / qualityVolume;
      for (const qw of qualityWorkouts) {
        const original = qw.distanceMiles;
        qw.distanceMiles = Math.round(qw.distanceMiles * scale * 10) / 10;
        if (original !== qw.distanceMiles) {
          violations.push({
            weekNumber: week.weekNumber,
            field: `quality:${qw.type}`,
            originalValue: original,
            clampedValue: qw.distanceMiles,
            rule: `Quality volume capped at ${SAFETY_RULES.maxQualityPercentOfWeekly * 100}% of weekly volume`,
          });
        }
      }
    }

    // ── Rule 5: Minimum run distance (2 miles) ──
    for (const wo of week.workouts) {
      if (wo.type !== 'rest' && wo.distanceMiles > 0 && wo.distanceMiles < SAFETY_RULES.minRunDistance) {
        violations.push({
          weekNumber: week.weekNumber,
          field: `workout:${wo.title}`,
          originalValue: wo.distanceMiles,
          clampedValue: SAFETY_RULES.minRunDistance,
          rule: `Minimum run distance is ${SAFETY_RULES.minRunDistance} miles`,
        });
        wo.distanceMiles = SAFETY_RULES.minRunDistance;
      }
    }

    // ── Rule 6: At least 1 rest day per week ──
    const restDays = week.workouts.filter(w => w.type === 'rest').length;
    if (restDays < SAFETY_RULES.minRestDaysPerWeek) {
      // Find the easiest non-rest workout and convert to rest
      const nonRest = week.workouts
        .filter(w => w.type !== 'rest' && w.type !== 'long_run')
        .sort((a, b) => a.distanceMiles - b.distanceMiles);
      if (nonRest.length > 0) {
        const shortest = nonRest[0];
        shortest.type = 'rest';
        shortest.title = 'Rest Day';
        shortest.description = 'Full rest — recovery is training too.';
        shortest.distanceMiles = 0;
        shortest.paceZone = null;
        shortest.intervals = null;
        shortest.coachingCue = 'Let your body adapt.';
        violations.push({
          weekNumber: week.weekNumber,
          field: 'restDays',
          originalValue: restDays,
          clampedValue: 1,
          rule: 'At least 1 rest day per week required',
        });
      }
    }
  }

  // ── Rule 7: Taper enforcement ──
  const totalWeeks = correctedWeeks.length;
  if (totalWeeks >= SAFETY_RULES.taperWeeks + 1) {
    // Find peak volume (max volume across non-taper weeks)
    const nonTaperWeeks = correctedWeeks.slice(0, totalWeeks - SAFETY_RULES.taperWeeks);
    const peakVolume = Math.max(...nonTaperWeeks.map(w => w.targetVolume));

    for (let t = 0; t < SAFETY_RULES.taperWeeks; t++) {
      const weekIdx = totalWeeks - SAFETY_RULES.taperWeeks + t;
      const week = correctedWeeks[weekIdx];
      const taperTarget = peakVolume * SAFETY_RULES.taperMultipliers[t];

      // Ensure taper weeks are actually tapering
      if (week.targetVolume > taperTarget * 1.1) { // 10% tolerance
        const original = week.targetVolume;
        week.targetVolume = Math.round(taperTarget * 10) / 10;
        scaleWorkoutDistances(week, original, week.targetVolume);
        violations.push({
          weekNumber: week.weekNumber,
          field: 'taperVolume',
          originalValue: original,
          clampedValue: week.targetVolume,
          rule: `Taper week ${t + 1}: volume must be ≤ ${Math.round(SAFETY_RULES.taperMultipliers[t] * 100)}% of peak`,
        });
      }

      // Mark taper phase
      week.phase = 'taper';
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    correctedPlan: {
      ...plan,
      weeks: correctedWeeks,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Proportionally scale all workout distances in a week when total volume is clamped.
 */
function scaleWorkoutDistances(week: AIWeek, originalVolume: number, newVolume: number): void {
  if (originalVolume <= 0) return;
  const ratio = newVolume / originalVolume;
  for (const wo of week.workouts) {
    if (wo.type !== 'rest' && wo.distanceMiles > 0) {
      wo.distanceMiles = Math.round(wo.distanceMiles * ratio * 10) / 10;
      // Enforce minimum after scaling
      if (wo.distanceMiles > 0 && wo.distanceMiles < SAFETY_RULES.minRunDistance) {
        wo.distanceMiles = SAFETY_RULES.minRunDistance;
      }
    }
  }
}

/**
 * Get a human-readable summary of safety corrections.
 */
export function getViolationSummary(violations: SafetyViolation[]): string | null {
  if (violations.length === 0) return null;
  const unique = new Set(violations.map(v => v.rule));
  return `Plan adjusted: ${violations.length} correction${violations.length > 1 ? 's' : ''} applied (${Array.from(unique).join('; ')}).`;
}
