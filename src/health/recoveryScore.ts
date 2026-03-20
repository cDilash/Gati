import { HealthSnapshot, RecoveryStatus, RecoverySignal, GarminHealthData } from "../types";

/**
 * Pure function: computes a 0-100 recovery score from health data.
 * No HealthKit calls, no SQLite, no side effects.
 *
 * 3 scored signals × 33 pts each:
 * - Resting HR (HealthKit): 33 pts
 * - Sleep (HealthKit): 33 pts
 * - HRV (Garmin preferred, HealthKit fallback): 33 pts
 *
 * Body Battery and Respiratory Rate are returned as display-only signals
 * (not scored) for the Recovery screen to show as informational cards.
 *
 * Normalized to 0-100 based on available signals. Minimum 2 signals required.
 */
export function calculateRecoveryScore(
  snapshot: HealthSnapshot,
  _profile: { restHr: number | null; maxHr: number | null },
  garmin?: GarminHealthData | null,
): RecoveryStatus {
  const signals: RecoverySignal[] = [];

  // ── Resting HR (33 pts max) ──
  if (snapshot.restingHR !== null && snapshot.restingHRTrend.length >= 3) {
    const baseline = average(snapshot.restingHRTrend.map(r => r.value));
    const diff = snapshot.restingHR - baseline;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (diff <= 0) {
      score = 33; status = 'good';
      detail = `${snapshot.restingHR} bpm (${Math.abs(diff).toFixed(0)} below baseline ${baseline.toFixed(0)})`;
    } else if (diff <= 2) {
      score = 33; status = 'good';
      detail = `${snapshot.restingHR} bpm (within normal range of ${baseline.toFixed(0)})`;
    } else if (diff <= 5) {
      score = 22; status = 'fair';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)})`;
    } else if (diff <= 8) {
      score = 11; status = 'poor';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)})`;
    } else {
      score = 5; status = 'poor';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)} — elevated)`;
    }

    signals.push({ type: 'resting_hr', value: snapshot.restingHR, baseline: Math.round(baseline), status, score, detail, source: 'healthkit' });
  }

  // ── HRV (33 pts max) ──
  // Prefer Garmin HRV (has personal baseline from watch), fall back to HealthKit
  if (garmin?.hrvLastNightAvg != null && garmin.hrvBaselineLow != null && garmin.hrvBaselineHigh != null) {
    const value = garmin.hrvLastNightAvg;
    const low = garmin.hrvBaselineLow;
    const high = garmin.hrvBaselineHigh;
    const mid = (low + high) / 2;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (value >= low) {
      score = 33; status = 'good';
      detail = `${value} ms (within baseline ${low}-${high})`;
    } else {
      const pctBelow = ((low - value) / mid) * 100;
      if (pctBelow < 10) {
        score = 22; status = 'fair';
        detail = `${value} ms (slightly below baseline ${low}-${high})`;
      } else if (pctBelow < 25) {
        score = 11; status = 'poor';
        detail = `${value} ms (${pctBelow.toFixed(0)}% below baseline ${low}-${high})`;
      } else {
        score = 5; status = 'poor';
        detail = `${value} ms (${pctBelow.toFixed(0)}% below baseline — suppressed)`;
      }
    }

    // Adjust based on Garmin's own HRV status
    if (garmin.hrvStatus === 'UNBALANCED' && score > 22) score = 22;
    if (garmin.hrvStatus === 'LOW' || garmin.hrvStatus === 'POOR') score = Math.min(score, 11);

    signals.push({ type: 'garmin_hrv', value, baseline: Math.round(mid), status, score, detail, source: 'garmin' });
  } else if (snapshot.hrvRMSSD !== null && snapshot.hrvTrend.length >= 3) {
    // HealthKit HRV fallback
    const baseline = average(snapshot.hrvTrend.slice(0, 7).map(r => r.value));
    const pctBelow = ((baseline - snapshot.hrvRMSSD) / baseline) * 100;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (pctBelow <= 5) {
      score = 33; status = 'good';
      detail = `${snapshot.hrvRMSSD} ms (within range of baseline ${baseline.toFixed(0)} ms)`;
    } else if (pctBelow <= 15) {
      score = 22; status = 'fair';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline ${baseline.toFixed(0)} ms)`;
    } else if (pctBelow <= 25) {
      score = 11; status = 'poor';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline ${baseline.toFixed(0)} ms)`;
    } else {
      score = 5; status = 'poor';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline — suppressed)`;
    }

    signals.push({ type: 'hrv', value: snapshot.hrvRMSSD, baseline: Math.round(baseline), status, score, detail, source: 'healthkit' });
  }

  // ── Sleep (33 pts max) ──
  const latestSleep = snapshot.sleepTrend.length > 0 ? snapshot.sleepTrend[0] : null;
  if (snapshot.sleepHours !== null && !(latestSleep?.isLikelyIncomplete)) {
    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (snapshot.sleepHours >= 7.5) {
      score = 33; status = 'good';
      detail = `${snapshot.sleepHours} hrs — excellent`;
    } else if (snapshot.sleepHours >= 6.5) {
      score = 22; status = 'fair';
      detail = `${snapshot.sleepHours} hrs — adequate`;
    } else if (snapshot.sleepHours >= 5.5) {
      score = 11; status = 'poor';
      detail = `${snapshot.sleepHours} hrs — insufficient`;
    } else {
      score = 5; status = 'poor';
      detail = `${snapshot.sleepHours} hrs — very low`;
    }

    if (garmin?.sleepScore != null) {
      detail += ` · Garmin: ${garmin.sleepScore}/100`;
    }

    signals.push({ type: 'sleep', value: snapshot.sleepHours, baseline: null, status, score, detail, source: 'healthkit' });
  }

  // ── Display-only signals (score = 0, not counted in total) ──

  // Body Battery (display only)
  if (garmin?.bodyBatteryMorning != null) {
    const bb = garmin.bodyBatteryMorning;
    const status: RecoverySignal['status'] = bb >= 80 ? 'good' : bb >= 60 ? 'fair' : 'poor';
    let detail = `${bb}/100 morning`;
    if (garmin.bodyBatteryCharged != null) detail += ` (charged ${garmin.bodyBatteryCharged})`;
    signals.push({ type: 'body_battery', value: bb, baseline: null, status, score: 0, detail, source: 'garmin' });
  }

  // Respiratory Rate (display only)
  const respRate = garmin?.respiratoryRate ?? snapshot.respiratoryRate;
  const respSource: 'garmin' | 'healthkit' = garmin?.respiratoryRate != null ? 'garmin' : 'healthkit';
  if (respRate !== null && snapshot.respiratoryRateTrend.length >= 3) {
    const baseline = average(snapshot.respiratoryRateTrend.map(r => r.value));
    const diff = respRate - baseline;
    const status: RecoverySignal['status'] = diff <= 1 ? 'good' : diff <= 2 ? 'fair' : 'poor';
    const detail = diff <= 1
      ? `${respRate} br/min (within range of ${baseline.toFixed(1)})`
      : `${respRate} br/min (${diff.toFixed(1)} above baseline ${baseline.toFixed(1)})`;
    signals.push({ type: 'respiratory_rate', value: respRate, baseline: Math.round(baseline * 10) / 10, status, score: 0, detail, source: respSource });
  }

  // ── Aggregate (only scored signals) ──
  const scoredSignals = signals.filter(s => s.score > 0);
  const signalCount = scoredSignals.length;

  if (signalCount < 2) {
    return {
      score: 0,
      signalCount: signals.length,
      level: 'unknown',
      signals,
      recommendation: signalCount === 0
        ? 'No recovery data available.'
        : 'Not enough recovery signals for a score. Need at least 2.',
    };
  }

  const rawScore = scoredSignals.reduce((sum, s) => sum + s.score, 0);
  const maxPossible = signalCount * 33;
  const normalized = Math.round((rawScore / maxPossible) * 100);

  const level = normalized >= 80 ? 'ready'
    : normalized >= 60 ? 'moderate'
    : normalized >= 40 ? 'fatigued'
    : 'rest';

  return {
    score: normalized,
    signalCount: scoredSignals.length, // only scored signals (display-only excluded)
    level,
    signals,
    recommendation: getRecommendation(level),
  };
}

function getRecommendation(level: RecoveryStatus['level']): string {
  switch (level) {
    case 'ready':
      return 'Recovery looks good. You\'re cleared for quality work.';
    case 'moderate':
      return 'Moderate recovery. Proceed with the workout but listen to your body.';
    case 'fatigued':
      return 'Recovery signals are low. Consider swapping to an easy run.';
    case 'rest':
      return 'Multiple recovery markers are down. Take it easy or rest today.';
    default:
      return 'Not enough data to assess recovery.';
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
