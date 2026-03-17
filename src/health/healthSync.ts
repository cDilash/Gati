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

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function syncHealthData(): Promise<HealthSnapshot | null> {
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

  // Guard 3: Check cache — don't re-fetch within 2 hours
  const cached = getCachedSnapshot();
  if (cached) {
    console.log("[HealthKit] Using cached snapshot");
    return cached;
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

  // Today's values with staleness check (48-hour window)
  const now = Date.now();
  const STALENESS_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

  // Resting HR: use only if most recent sample is within 48 hours
  let todayRHR: number | null = null;
  let restingHRAge: number | null = null;
  if (restingHRData.length > 0) {
    const mostRecentDate = new Date(restingHRData[0].date + 'T12:00:00').getTime();
    restingHRAge = Math.round((now - mostRecentDate) / 3600000); // hours
    if (now - mostRecentDate <= STALENESS_THRESHOLD_MS) {
      todayRHR = restingHRData[0].value;
    }
  }

  const todayHRV = hrvData.length > 0 ? hrvData[0].value : null;

  // Sleep: use only if from last night (today's date - 1) or the night before (today's date - 2)
  // Sleep dated "2026-03-16" means the night OF March 16 (went to bed that evening)
  let todaySleep: number | null = null;
  let sleepAge: number | null = null;
  if (sleepData.length > 0) {
    const todayDate = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = yesterday.toISOString().split('T')[0];
    const dayBefore = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    const dayBeforeDate = dayBefore.toISOString().split('T')[0];

    const sleepDate = sleepData[0].date;
    const mostRecentSleepMs = new Date(sleepDate + 'T12:00:00').getTime();
    sleepAge = Math.round((now - mostRecentSleepMs) / 3600000);

    const isFresh = sleepDate === todayDate || sleepDate === yesterdayDate || sleepDate === dayBeforeDate;
    const isIncomplete = sleepData[0].isLikelyIncomplete;
    if (isFresh && !isIncomplete) {
      todaySleep = sleepData[0].totalMinutes / 60;
    }
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
    if (Date.now() - cachedAt > CACHE_TTL_MS) return null;

    return {
      date: row.date,
      restingHR: row.resting_hr,
      hrvRMSSD: row.hrv_rmssd,
      sleepHours: row.sleep_hours,
      restingHRTrend: JSON.parse(row.resting_hr_trend_json || '[]'),
      hrvTrend: JSON.parse(row.hrv_trend_json || '[]'),
      sleepTrend: JSON.parse(row.sleep_trend_json || '[]'),
      weight: row.weight_kg != null ? { value: row.weight_kg, date: row.date } : null,
      vo2max: row.vo2max != null ? { value: row.vo2max, date: row.date } : null,
      respiratoryRate: row.respiratory_rate ?? null,
      respiratoryRateTrend: JSON.parse(row.respiratory_rate_trend_json || '[]'),
      spo2: row.spo2 ?? null,
      spo2Trend: JSON.parse(row.spo2_trend_json || '[]'),
      steps: row.steps ?? null,
      stepsTrend: [],  // Not cached — re-fetched each sync
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
       (id, date, resting_hr, hrv_rmssd, sleep_hours, resting_hr_trend_json, hrv_trend_json, sleep_trend_json, weight_kg, vo2max, respiratory_rate, respiratory_rate_trend_json, spo2, spo2_trend_json, steps, signal_count, cached_at)
       VALUES (
         COALESCE((SELECT id FROM health_snapshot WHERE date = ?), ?),
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      ]
    );
  } catch (e) {
    console.log("[HealthKit] Cache write error:", e);
  }
}
