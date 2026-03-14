/**
 * Banister Impulse-Response Model
 *
 * Tracks fitness (slow-decaying) and fatigue (fast-decaying) curves
 * to predict training readiness. Pure TypeScript — no React, no side effects.
 *
 * Reference: Banister et al. (1975) systems model of training.
 */

import type {
  PerformanceMetric,
  UserProfile,
  PaceZones,
  BanisterState,
  DailyTRIMP,
} from '../types';

// ─── Constants ──────────────────────────────────────────────

const TAU_FITNESS = 45;   // fitness decay time constant (days)
const TAU_FATIGUE = 15;   // fatigue decay time constant (days)
const K_FITNESS = 1.0;    // fitness gain factor
const K_FATIGUE = 2.0;    // fatigue gain factor

const LOOKBACK_DAYS = 60;
const TRIMP_HISTORY_DAYS = 28;

/** Intensity multiplier by pace zone */
const ZONE_INTENSITY: Record<string, number> = {
  E: 0.6,
  M: 0.8,
  T: 0.9,
  I: 1.0,
  R: 1.1,
};

// ─── TRIMP Calculation ──────────────────────────────────────

/**
 * Calculate Training Impulse (TRIMP) for a single workout.
 * Priority: HR-based > Pace-based > RPE-based > estimated.
 */
export function calculateTRIMP(
  metric: PerformanceMetric,
  profile: UserProfile,
  paceZones: PaceZones,
): DailyTRIMP {
  const durationMinutes = metric.duration_seconds / 60;

  // 1. HR-based TRIMP (Banister equation)
  if (metric.avg_hr && profile.max_hr > 0 && profile.resting_hr > 0) {
    const hrReserve = profile.max_hr - profile.resting_hr;
    if (hrReserve > 0) {
      const hrFraction = Math.max(0, Math.min(1,
        (metric.avg_hr - profile.resting_hr) / hrReserve,
      ));
      const intensity = 0.64 * Math.exp(1.92 * hrFraction);
      const trimp = Math.round(durationMinutes * hrFraction * intensity * 10) / 10;
      return { date: metric.date, trimp, source: 'hr' };
    }
  }

  // 2. Pace-based TRIMP (zone mapping)
  if (metric.avg_pace_per_mile > 0) {
    const zone = inferPaceZone(metric.avg_pace_per_mile, paceZones);
    const intensity = ZONE_INTENSITY[zone] ?? 0.6;
    const trimp = Math.round(durationMinutes * intensity * 10) / 10;
    return { date: metric.date, trimp, source: 'pace' };
  }

  // 3. RPE-based TRIMP
  if (metric.rpe_score && metric.rpe_score > 0) {
    const intensity = metric.rpe_score / 10;
    const trimp = Math.round(durationMinutes * intensity * 10) / 10;
    return { date: metric.date, trimp, source: 'rpe' };
  }

  // 4. Estimated TRIMP (fallback based on distance)
  const estimatedMinutes = metric.distance_miles * 10; // rough ~10 min/mile
  const trimp = Math.round(estimatedMinutes * 0.6 * 10) / 10;
  return { date: metric.date, trimp, source: 'estimated' };
}

/**
 * Infer pace zone from average pace (seconds per mile).
 * Returns the closest matching zone letter.
 */
function inferPaceZone(avgPacePerMile: number, paceZones: PaceZones): string {
  // Zones have min (slower) and max (faster) in sec/mile
  // Check from fastest to slowest
  if (avgPacePerMile <= paceZones.R.min) return 'R';
  if (avgPacePerMile <= paceZones.I.min) return 'I';
  if (avgPacePerMile <= paceZones.T.min) return 'T';
  if (avgPacePerMile <= paceZones.M.min) return 'M';
  return 'E';
}

// ─── TRIMP Series Builder ───────────────────────────────────

/**
 * Aggregate performance metrics into daily TRIMP values.
 * Multiple workouts on the same day are summed.
 */
export function buildTRIMPSeries(
  metrics: PerformanceMetric[],
  profile: UserProfile,
  paceZones: PaceZones,
): DailyTRIMP[] {
  const dailyMap = new Map<string, DailyTRIMP>();

  for (const metric of metrics) {
    const daily = calculateTRIMP(metric, profile, paceZones);
    const existing = dailyMap.get(daily.date);
    if (existing) {
      existing.trimp = Math.round((existing.trimp + daily.trimp) * 10) / 10;
      // Keep the highest-priority source
      const sourcePriority: Record<string, number> = { hr: 4, pace: 3, rpe: 2, estimated: 1 };
      if ((sourcePriority[daily.source] ?? 0) > (sourcePriority[existing.source] ?? 0)) {
        existing.source = daily.source;
      }
    } else {
      dailyMap.set(daily.date, { ...daily });
    }
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Main Banister State Calculator ─────────────────────────

/**
 * Calculate the current Banister fitness/fatigue state.
 *
 * Iterates day-by-day from 60 days back to today, applying:
 *   fitness(t) = fitness(t-1) * e^(-1/TAU_FITNESS) + K_FITNESS * trimp(t)
 *   fatigue(t) = fatigue(t-1) * e^(-1/TAU_FATIGUE) + K_FATIGUE * trimp(t)
 *   performance(t) = fitness(t) - fatigue(t)
 *
 * Returns BanisterState with readiness score (0-100) and recommendation.
 */
export function calculateBanisterState(
  metrics: PerformanceMetric[],
  profile: UserProfile,
  paceZones: PaceZones,
  today?: string,
): BanisterState {
  // Neutral state for empty metrics
  if (!metrics || metrics.length === 0) {
    return {
      fitness: 0,
      fatigue: 0,
      performance: 0,
      readiness: 50,
      recommendation: 'normal',
      trimpHistory: [],
    };
  }

  const trimpSeries = buildTRIMPSeries(metrics, profile, paceZones);
  const trimpByDate = new Map<string, number>();
  for (const t of trimpSeries) {
    trimpByDate.set(t.date, t.trimp);
  }

  // Use local date parsing to avoid UTC timezone issues
  const todayDate = today
    ? new Date(today + 'T00:00:00')
    : new Date();
  // Normalize todayDate to midnight
  todayDate.setHours(0, 0, 0, 0);

  const startDate = new Date(todayDate);
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

  const decayFitness = Math.exp(-1 / TAU_FITNESS);
  const decayFatigue = Math.exp(-1 / TAU_FATIGUE);

  let fitness = 0;
  let fatigue = 0;
  let maxPerformance = 0;

  const trimpHistory: { date: string; trimp: number }[] = [];
  const historyStartDate = new Date(todayDate);
  historyStartDate.setDate(historyStartDate.getDate() - TRIMP_HISTORY_DAYS + 1);

  // Iterate day by day
  const currentDate = new Date(startDate);
  while (currentDate <= todayDate) {
    const dateStr = formatDate(currentDate);
    const dayTrimp = trimpByDate.get(dateStr) ?? 0;

    // Apply exponential decay + new training impulse
    fitness = fitness * decayFitness + K_FITNESS * dayTrimp;
    fatigue = fatigue * decayFatigue + K_FATIGUE * dayTrimp;

    const performance = fitness - fatigue;
    if (performance > maxPerformance) {
      maxPerformance = performance;
    }

    // Collect last 28 days for history
    if (currentDate >= historyStartDate) {
      trimpHistory.push({ date: dateStr, trimp: dayTrimp });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  const performance = fitness - fatigue;

  // Normalize readiness to 0-100
  let readiness: number;
  if (maxPerformance > 0) {
    readiness = (performance / maxPerformance) * 100 + 50;
  } else {
    readiness = 50;
  }
  readiness = Math.max(0, Math.min(100, Math.round(readiness)));

  // Determine recommendation
  let recommendation: BanisterState['recommendation'];
  if (readiness >= 80) {
    recommendation = 'push';
  } else if (readiness >= 60) {
    recommendation = 'normal';
  } else if (readiness >= 40) {
    recommendation = 'easy';
  } else {
    recommendation = 'rest';
  }

  return {
    fitness: Math.round(fitness * 10) / 10,
    fatigue: Math.round(fatigue * 10) / 10,
    performance: Math.round(performance * 10) / 10,
    readiness,
    recommendation,
    trimpHistory,
  };
}

// ─── Helpers ────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD using local time */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
