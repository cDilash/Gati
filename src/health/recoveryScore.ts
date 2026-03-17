import { HealthSnapshot, RecoveryStatus, RecoverySignal } from "../types";

/**
 * Pure function: computes a 0-100 recovery score from health data.
 * No HealthKit calls, no SQLite, no side effects.
 *
 * Scoring: 3 core signals × 33 pts each + optional respiratory rate × 25 pts.
 * Normalized to 0-100 based on available signals. Minimum 2 signals required.
 */
export function calculateRecoveryScore(
  snapshot: HealthSnapshot,
  _profile: { restHr: number | null; maxHr: number | null }
): RecoveryStatus {
  const signals: RecoverySignal[] = [];

  // ── Resting HR (33 pts max) — only score if from today/yesterday ──
  const rhrIsStale = snapshot.restingHRTrend.length > 0 &&
    (() => {
      const latestDate = snapshot.restingHRTrend[0].date;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      return latestDate !== today && latestDate !== yesterday;
    })();
  if (snapshot.restingHR !== null && snapshot.restingHRTrend.length >= 3 && !rhrIsStale) {
    const baseline = average(snapshot.restingHRTrend.map(r => r.value));
    const diff = snapshot.restingHR - baseline;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (diff <= 0) {
      score = 33;
      status = 'good';
      detail = `${snapshot.restingHR} bpm (${Math.abs(diff).toFixed(0)} below baseline ${baseline.toFixed(0)})`;
    } else if (diff <= 2) {
      score = 33;
      status = 'good';
      detail = `${snapshot.restingHR} bpm (within normal range of ${baseline.toFixed(0)})`;
    } else if (diff <= 5) {
      score = 22;
      status = 'fair';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)})`;
    } else if (diff <= 8) {
      score = 11;
      status = 'poor';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)})`;
    } else {
      score = 5;
      status = 'poor';
      detail = `${snapshot.restingHR} bpm (${diff.toFixed(0)} above baseline ${baseline.toFixed(0)} — elevated)`;
    }

    signals.push({ type: 'resting_hr', value: snapshot.restingHR, baseline: Math.round(baseline), status, score, detail });
  }

  // ── HRV RMSSD (33 pts max) ──
  if (snapshot.hrvRMSSD !== null && snapshot.hrvTrend.length >= 3) {
    const baseline = average(snapshot.hrvTrend.slice(0, 7).map(r => r.value));
    const pctBelow = ((baseline - snapshot.hrvRMSSD) / baseline) * 100;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (pctBelow <= 5) {
      score = 33;
      status = 'good';
      detail = `${snapshot.hrvRMSSD} ms (within range of baseline ${baseline.toFixed(0)} ms)`;
    } else if (pctBelow <= 15) {
      score = 22;
      status = 'fair';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline ${baseline.toFixed(0)} ms)`;
    } else if (pctBelow <= 25) {
      score = 11;
      status = 'poor';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline ${baseline.toFixed(0)} ms)`;
    } else {
      score = 5;
      status = 'poor';
      detail = `${snapshot.hrvRMSSD} ms (${pctBelow.toFixed(0)}% below baseline ${baseline.toFixed(0)} ms — suppressed)`;
    }

    signals.push({ type: 'hrv', value: snapshot.hrvRMSSD, baseline: Math.round(baseline), status, score, detail });
  }

  // ── Sleep (33 pts max) — only score if from last night ──
  const sleepIsStale = snapshot.sleepTrend.length > 0 &&
    (() => {
      const latestDate = snapshot.sleepTrend[0].date;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      return latestDate !== today && latestDate !== yesterday;
    })();
  if (snapshot.sleepHours !== null && !sleepIsStale) {
    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (snapshot.sleepHours >= 7.5) {
      score = 33;
      status = 'good';
      detail = `${snapshot.sleepHours} hrs — excellent`;
    } else if (snapshot.sleepHours >= 6.5) {
      score = 22;
      status = 'fair';
      detail = `${snapshot.sleepHours} hrs — adequate`;
    } else if (snapshot.sleepHours >= 5.5) {
      score = 11;
      status = 'poor';
      detail = `${snapshot.sleepHours} hrs — insufficient`;
    } else {
      score = 5;
      status = 'poor';
      detail = `${snapshot.sleepHours} hrs — very low`;
    }

    signals.push({ type: 'sleep', value: snapshot.sleepHours, baseline: null, status, score, detail });
  }

  // ── Respiratory Rate (optional 4th signal) ──
  if (snapshot.respiratoryRate !== null && snapshot.respiratoryRateTrend.length >= 3) {
    const baseline = average(snapshot.respiratoryRateTrend.map(r => r.value));
    const diff = snapshot.respiratoryRate - baseline;

    let score: number;
    let status: RecoverySignal['status'];
    let detail: string;

    if (diff <= 1) {
      score = 25;
      status = 'good';
      detail = `${snapshot.respiratoryRate} br/min (within range of ${baseline.toFixed(1)})`;
    } else if (diff <= 2) {
      score = 15;
      status = 'fair';
      detail = `${snapshot.respiratoryRate} br/min (${diff.toFixed(1)} above baseline ${baseline.toFixed(1)})`;
    } else {
      score = 5;
      status = 'poor';
      detail = `${snapshot.respiratoryRate} br/min (${diff.toFixed(1)} above baseline — possible illness)`;
    }

    signals.push({ type: 'respiratory_rate', value: snapshot.respiratoryRate, baseline: Math.round(baseline * 10) / 10, status, score, detail });
  }

  // ── Aggregate ──
  const signalCount = signals.length;

  // Need minimum 2 signals for a meaningful score
  if (signalCount < 2) {
    return {
      score: 0,
      signalCount,
      level: 'unknown',
      signals,
      recommendation: signalCount === 0
        ? 'No recovery data available.'
        : 'Not enough recovery signals for a score. Need at least 2 of 3 (resting HR, HRV, sleep).',
    };
  }

  const rawScore = signals.reduce((sum, s) => sum + s.score, 0);
  const maxPossible = signals.reduce((sum, s) => {
    return sum + (s.type === 'respiratory_rate' ? 25 : 33);
  }, 0);
  const normalized = Math.round((rawScore / maxPossible) * 100);

  const level = normalized >= 80 ? 'ready'
    : normalized >= 60 ? 'moderate'
    : normalized >= 40 ? 'fatigued'
    : 'rest';

  const recommendation = getRecommendation(level);

  return { score: normalized, signalCount, level, signals, recommendation };
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
