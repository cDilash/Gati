import * as Crypto from 'expo-crypto';
import { isHealthKitAvailable } from "./availability";
import { requestHealthKitPermissions } from "./permissions";
import { getRestingHeartRate } from "./restingHR";
import { getHRVSamples } from "./hrv";
import { getSleepData } from "./sleep";
import { getWeight } from "./weight";
import { getVO2Max } from "./vo2max";
import { getRespiratoryRate } from "./respiratory";
import { getBloodOxygen } from "./spo2";
import { getStepCount, getStepHistory } from "./steps";
import { getDatabase } from "../db/database";
import { HealthSnapshot } from "../types";

// Morning window: 10-minute cache TTL (sleep data likely syncing from Garmin)
// Rest of day: 30-minute cache TTL
function getCacheTTL(): number {
  const hour = new Date().getHours();
  const isMorning = hour >= 6 && hour < 10;
  return isMorning ? 10 * 60 * 1000 : 30 * 60 * 1000;
}

/**
 * Compare two snapshots and detect significant changes that should
 * trigger a recovery score recalculation.
 */
export function hasSignificantChanges(
  oldSnap: HealthSnapshot | null,
  newSnap: HealthSnapshot,
): { changed: boolean; reason: string } {
  if (!oldSnap) return { changed: true, reason: 'first snapshot' };

  // Sleep appeared (was null → now has value)
  if (oldSnap.sleepHours === null && newSnap.sleepHours !== null) {
    return { changed: true, reason: 'sleep data arrived' };
  }

  // Sleep changed significantly (>30 min)
  if (oldSnap.sleepHours !== null && newSnap.sleepHours !== null &&
      Math.abs(oldSnap.sleepHours - newSnap.sleepHours) > 0.5) {
    return { changed: true, reason: 'sleep changed significantly' };
  }

  // RHR changed (>2 bpm)
  if (oldSnap.restingHR !== null && newSnap.restingHR !== null &&
      Math.abs(oldSnap.restingHR - newSnap.restingHR) > 2) {
    return { changed: true, reason: 'resting HR changed' };
  }

  // HRV changed (>10 ms)
  if (oldSnap.hrvRMSSD !== null && newSnap.hrvRMSSD !== null &&
      Math.abs(oldSnap.hrvRMSSD - newSnap.hrvRMSSD) > 10) {
    return { changed: true, reason: 'HRV changed' };
  }

  return { changed: false, reason: '' };
}

export async function syncHealthData(forceRefresh: boolean = false): Promise<HealthSnapshot | null> {
  // Guard 1: HealthKit available?
  if (!isHealthKitAvailable()) {
    console.log("[HealthKit] Not available — skipping sync");
    return null;
  }

  // Guard 2: Permissions granted?
  const permitted = await requestHealthKitPermissions();
  if (!permitted) {
    console.log("[HealthKit] Permissions not granted — skipping sync");
    return null;
  }

  // Guard 3: Check cache — don't re-fetch within 30 minutes (skip if forced)
  if (!forceRefresh) {
    const cached = getCachedSnapshot();
    if (cached) {
      console.log("[HealthKit] Using cached snapshot");
      return cached;
    }
  } else {
    console.log("[HealthKit] Force refresh — bypassing cache");
  }

  // Fetch all health data in parallel — each one independent
  const [restingHR, hrv, sleep, weight, vo2max, resp, spo2, steps, stepsHist] = await Promise.allSettled([
    getRestingHeartRate(14),
    getHRVSamples(14),
    getSleepData(14),
    getWeight(),
    getVO2Max(),
    getRespiratoryRate(14),
    getBloodOxygen(14),
    getStepCount(new Date()),
    getStepHistory(7),
  ]);

  const restingHRData = restingHR.status === "fulfilled" ? restingHR.value : [];
  const hrvData = hrv.status === "fulfilled" ? hrv.value : [];
  const sleepData = sleep.status === "fulfilled" ? sleep.value : [];
  const weightData = weight.status === "fulfilled" ? weight.value : null;
  const vo2maxData = vo2max.status === "fulfilled" ? vo2max.value : null;
  const respData = resp.status === "fulfilled" ? resp.value : [];
  const spo2Data = spo2.status === "fulfilled" ? spo2.value : [];
  const stepsData = steps.status === "fulfilled" ? steps.value : null;
  const stepsHistData = stepsHist.status === "fulfilled" ? stepsHist.value : [];

  // Log any rejected promises
  const results = [
    { name: 'weight', r: weight }, { name: 'vo2max', r: vo2max },
    { name: 'resp', r: resp }, { name: 'spo2', r: spo2 },
  ];
  for (const { name, r } of results) {
    if (r.status === 'rejected') console.log(`[HealthKit] ${name} REJECTED:`, r.reason?.message || r.reason);
  }

  // Today's values — use most recent available, track staleness
  const now = Date.now();

  // Resting HR: use most recent sample (track age for display)
  let todayRHR: number | null = null;
  let restingHRAge: number | null = null;
  if (restingHRData.length > 0) {
    const mostRecentDate = new Date(restingHRData[0].date + 'T12:00:00').getTime();
    restingHRAge = Math.round((now - mostRecentDate) / 3600000); // hours
    // Use the value regardless of age — let the UI decide if it's too stale
    todayRHR = restingHRData[0].value;
    console.log(`[HealthKit] RHR: ${todayRHR} bpm, most recent date: ${restingHRData[0].date}, age: ${restingHRAge}h, ${restingHRData.length} samples`);
  } else {
    console.log('[HealthKit] RHR: NO SAMPLES returned from HealthKit');
  }

  const todayHRV = hrvData.length > 0 ? hrvData[0].value : null;
  if (hrvData.length > 0) {
    console.log(`[HealthKit] HRV: ${todayHRV} ms, date: ${hrvData[0].date}, ${hrvData.length} samples`);
  } else {
    console.log('[HealthKit] HRV: NO SAMPLES returned from HealthKit');
  }

  // Sleep: use most recent non-incomplete sleep data
  let todaySleep: number | null = null;
  let sleepAge: number | null = null;
  if (sleepData.length > 0) {
    const sleepDate = sleepData[0].date;
    const mostRecentSleepMs = new Date(sleepDate + 'T12:00:00').getTime();
    sleepAge = Math.round((now - mostRecentSleepMs) / 3600000);

    const isIncomplete = sleepData[0].isLikelyIncomplete;
    if (!isIncomplete) {
      todaySleep = sleepData[0].totalMinutes / 60;
    }
    console.log(`[HealthKit] Sleep: ${sleepData[0].totalMinutes} min, date: ${sleepDate}, age: ${sleepAge}h, incomplete: ${isIncomplete}, ${sleepData.length} nights`);
  } else {
    console.log('[HealthKit] Sleep: NO SAMPLES returned from HealthKit');
  }

  const todayResp = respData.length > 0 ? respData[0].value : null;

  // Recovery signal count (RHR, HRV, sleep, respiratory rate)
  let signalCount = 0;
  if (todayRHR !== null) signalCount++;
  if (todayHRV !== null) signalCount++;
  if (todaySleep !== null) signalCount++;
  if (todayResp !== null) signalCount++;

  const snapshot: HealthSnapshot = {
    date: new Date().toISOString().split("T")[0],
    restingHR: todayRHR,
    hrvRMSSD: todayHRV,
    sleepHours: todaySleep ? Math.round(todaySleep * 10) / 10 : null,
    restingHRTrend: restingHRData,
    hrvTrend: hrvData,
    sleepTrend: sleepData,
    weight: weightData,
    vo2max: vo2maxData,
    respiratoryRate: todayResp,
    respiratoryRateTrend: respData,
    spo2: spo2Data.length > 0 ? spo2Data[0].value : null,
    spo2Trend: spo2Data,
    steps: stepsData,
    stepsTrend: stepsHistData,
    restingHRAge,
    sleepAge,
    signalCount,
    cachedAt: new Date().toISOString(),
  };

  saveSnapshotToCache(snapshot);
  console.log(`[HealthKit] Synced — ${signalCount} signals, RHR=${todayRHR}, HRV=${todayHRV}, Sleep=${snapshot.sleepHours}h, Resp=${todayResp}, Weight=${weightData?.value ?? 'N/A'}, VO2=${vo2maxData?.value ?? 'N/A'}, SpO2=${snapshot.spo2}, Steps=${stepsData}`);

  return snapshot;
}

function getCachedSnapshot(): HealthSnapshot | null {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split("T")[0];
    const row = db.getFirstSync<any>(
      'SELECT * FROM health_snapshot WHERE date = ?',
      [today]
    );
    if (!row) return null;

    // Check TTL
    const cachedAt = new Date(row.cached_at).getTime();
    if (Date.now() - cachedAt > getCacheTTL()) return null;

    return {
      date: row.date,
      restingHR: row.resting_hr,
      hrvRMSSD: row.hrv_rmssd,
      sleepHours: row.sleep_hours,
      restingHRTrend: JSON.parse(row.resting_hr_trend_json || '[]'),
      hrvTrend: JSON.parse(row.hrv_trend_json || '[]'),
      sleepTrend: JSON.parse(row.sleep_trend_json || '[]'),
      weight: row.weight_kg != null ? { value: row.weight_kg, date: row.weight_date ?? row.date } : null,
      vo2max: row.vo2max != null ? { value: row.vo2max, date: row.date } : null,
      respiratoryRate: row.respiratory_rate ?? null,
      respiratoryRateTrend: JSON.parse(row.respiratory_rate_trend_json || '[]'),
      spo2: row.spo2 ?? null,
      spo2Trend: JSON.parse(row.spo2_trend_json || '[]'),
      steps: row.steps ?? null,
      stepsTrend: JSON.parse(row.steps_trend_json || '[]'),
      restingHRAge: null,
      sleepAge: null,
      signalCount: row.signal_count,
      cachedAt: row.cached_at,
    };
  } catch (e) {
    console.log("[HealthKit] Cache read error:", e);
    return null;
  }
}

function saveSnapshotToCache(snapshot: HealthSnapshot): void {
  try {
    const db = getDatabase();
    const id = Crypto.randomUUID();
    db.runSync(
      `INSERT OR REPLACE INTO health_snapshot
       (id, date, resting_hr, hrv_rmssd, sleep_hours, resting_hr_trend_json, hrv_trend_json, sleep_trend_json, weight_kg, vo2max, respiratory_rate, respiratory_rate_trend_json, spo2, spo2_trend_json, steps, signal_count, cached_at, steps_trend_json, weight_date)
       VALUES (
         COALESCE((SELECT id FROM health_snapshot WHERE date = ?), ?),
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        snapshot.date, id,
        snapshot.date,
        snapshot.restingHR,
        snapshot.hrvRMSSD,
        snapshot.sleepHours,
        JSON.stringify(snapshot.restingHRTrend),
        JSON.stringify(snapshot.hrvTrend),
        JSON.stringify(snapshot.sleepTrend),
        snapshot.weight?.value ?? null,
        snapshot.vo2max?.value ?? null,
        snapshot.respiratoryRate,
        JSON.stringify(snapshot.respiratoryRateTrend),
        snapshot.spo2,
        JSON.stringify(snapshot.spo2Trend),
        snapshot.steps,
        snapshot.signalCount,
        snapshot.cachedAt,
        JSON.stringify(snapshot.stepsTrend ?? []),
        snapshot.weight?.date ?? null,
      ]
    );
  } catch (e) {
    console.log("[HealthKit] Cache write error:", e);
  }
}
