/**
 * Injury Risk Score — pure function, no side effects.
 *
 * Factors:
 * 1. Volume spike (ACWR — acute:chronic workload ratio)
 * 2. Recovery status (from HealthKit)
 * 3. Sleep trends (declining = risk)
 * 4. Missed workouts (missed recovery = compensatory overload)
 * 5. Execution quality (consistently missing pace = fatigue)
 */

import { TrainingWeek, Workout, RecoveryStatus } from '../types';
import { formatSleepHours } from '../utils/formatTime';

export interface InjuryRiskResult {
  level: 'low' | 'moderate' | 'high';
  score: number;         // 0-100 (higher = more risk)
  factors: InjuryFactor[];
  recommendation: string;
}

export interface InjuryFactor {
  name: string;
  status: 'ok' | 'warning' | 'danger';
  detail: string;
  points: number;        // contribution to risk score
}

export function calculateInjuryRisk(
  weeks: TrainingWeek[],
  workouts: Workout[],
  currentWeekNumber: number,
  recoveryStatus: RecoveryStatus | null,
  sleepHours: number | null,
  sleepTrend: { totalMinutes: number }[],
): InjuryRiskResult {
  const factors: InjuryFactor[] = [];
  let totalPoints = 0;

  // ── 1. ACWR (Acute:Chronic Workload Ratio) ──
  // Acute = current week volume, Chronic = avg of last 4 weeks
  const currentWeek = weeks.find(w => w.week_number === currentWeekNumber);
  const prevWeeks = weeks
    .filter(w => w.week_number < currentWeekNumber && w.week_number >= currentWeekNumber - 4)
    .sort((a, b) => b.week_number - a.week_number);

  if (currentWeek && prevWeeks.length >= 2) {
    const acute = currentWeek.actual_volume > 0 ? currentWeek.actual_volume : currentWeek.target_volume;
    const chronic = prevWeeks.reduce((s, w) => s + (w.actual_volume > 0 ? w.actual_volume : w.target_volume), 0) / prevWeeks.length;

    if (chronic > 0) {
      const acwr = acute / chronic;
      if (acwr > 1.5) {
        factors.push({ name: 'Volume Spike', status: 'danger', detail: `ACWR ${acwr.toFixed(2)} — volume jumped ${Math.round((acwr - 1) * 100)}% over recent average`, points: 35 });
        totalPoints += 35;
      } else if (acwr > 1.3) {
        factors.push({ name: 'Volume Increase', status: 'warning', detail: `ACWR ${acwr.toFixed(2)} — ${Math.round((acwr - 1) * 100)}% above average`, points: 15 });
        totalPoints += 15;
      } else {
        factors.push({ name: 'Volume Load', status: 'ok', detail: `ACWR ${acwr.toFixed(2)} — safe range`, points: 0 });
      }
    }
  }

  // ── 2. Recovery Status ──
  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    if (recoveryStatus.score < 40) {
      factors.push({ name: 'Recovery', status: 'danger', detail: `Score ${recoveryStatus.score}/100 — body needs rest`, points: 25 });
      totalPoints += 25;
    } else if (recoveryStatus.score < 60) {
      factors.push({ name: 'Recovery', status: 'warning', detail: `Score ${recoveryStatus.score}/100 — moderate fatigue`, points: 10 });
      totalPoints += 10;
    } else {
      factors.push({ name: 'Recovery', status: 'ok', detail: `Score ${recoveryStatus.score}/100 — well recovered`, points: 0 });
    }
  }

  // ── 3. Sleep Trends ──
  if (sleepTrend.length >= 5) {
    const recent3 = sleepTrend.slice(0, 3).map(s => s.totalMinutes / 60);
    const prev3 = sleepTrend.slice(3, 6).map(s => s.totalMinutes / 60);
    const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length;
    const prevAvg = prev3.length > 0 ? prev3.reduce((s, v) => s + v, 0) / prev3.length : recentAvg;

    if (recentAvg < 6) {
      factors.push({ name: 'Sleep', status: 'danger', detail: `Averaging ${formatSleepHours(recentAvg)} — critically low`, points: 20 });
      totalPoints += 20;
    } else if (recentAvg < 7 || (prevAvg - recentAvg > 0.5)) {
      factors.push({ name: 'Sleep', status: 'warning', detail: `${formatSleepHours(recentAvg)} avg${prevAvg - recentAvg > 0.5 ? ' (declining)' : ' — below optimal'}`, points: 10 });
      totalPoints += 10;
    } else {
      factors.push({ name: 'Sleep', status: 'ok', detail: `${formatSleepHours(recentAvg)} avg — good`, points: 0 });
    }
  }

  // ── 4. Missed Workouts (last 2 weeks) ──
  const recentWorkouts = workouts.filter(w =>
    w.week_number >= currentWeekNumber - 1 && w.week_number <= currentWeekNumber &&
    w.workout_type !== 'rest'
  );
  const skippedCount = recentWorkouts.filter(w => w.status === 'skipped').length;
  const totalRecent = recentWorkouts.length;

  if (totalRecent > 0 && skippedCount >= 3) {
    factors.push({ name: 'Missed Workouts', status: 'danger', detail: `${skippedCount} skipped in 2 weeks — inconsistency stresses the body when you return`, points: 15 });
    totalPoints += 15;
  } else if (skippedCount >= 2) {
    factors.push({ name: 'Missed Workouts', status: 'warning', detail: `${skippedCount} skipped recently`, points: 5 });
    totalPoints += 5;
  }

  // ── 5. Pace Degradation (execution quality) ──
  const recentQuality = workouts.filter(w =>
    w.week_number >= currentWeekNumber - 2 &&
    (w.status === 'completed' || w.status === 'partial') &&
    (w as any).execution_quality === 'missed_pace'
  );
  if (recentQuality.length >= 3) {
    factors.push({ name: 'Pace Degradation', status: 'danger', detail: `${recentQuality.length} workouts missed pace — possible overtraining`, points: 15 });
    totalPoints += 15;
  } else if (recentQuality.length >= 2) {
    factors.push({ name: 'Pace Degradation', status: 'warning', detail: `${recentQuality.length} workouts missed pace recently`, points: 5 });
    totalPoints += 5;
  }

  // ── Aggregate ──
  const score = Math.min(totalPoints, 100);
  const level: InjuryRiskResult['level'] = score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low';

  const recommendation = level === 'high'
    ? 'Multiple risk factors elevated. Consider replacing quality sessions with easy runs this week and prioritizing sleep.'
    : level === 'moderate'
    ? 'Some risk factors need attention. Listen to your body and don\'t push through fatigue.'
    : 'Risk factors are manageable. Continue training as planned.';

  return { level, score, factors, recommendation };
}
