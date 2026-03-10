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
