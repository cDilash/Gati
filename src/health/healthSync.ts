import * as Crypto from 'expo-crypto';
import { isHealthKitAvailable } from "./availability";
import { requestHealthKitPermissions } from "./permissions";
import { getRestingHeartRate } from "./restingHR";
import { getHRVSamples } from "./hrv";
import { getSleepData } from "./sleep";
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

  // Fetch all three in parallel — each one independent
  const [restingHR, hrv, sleep] = await Promise.allSettled([
    getRestingHeartRate(14),
    getHRVSamples(14),
    getSleepData(14),
  ]);

  const restingHRData = restingHR.status === "fulfilled" ? restingHR.value : [];
  const hrvData = hrv.status === "fulfilled" ? hrv.value : [];
  const sleepData = sleep.status === "fulfilled" ? sleep.value : [];

  // Today's values (most recent)
  const todayRHR = restingHRData.length > 0 ? restingHRData[0].value : null;
  const todayHRV = hrvData.length > 0 ? hrvData[0].value : null;
  const todaySleep = sleepData.length > 0 ? sleepData[0].totalMinutes / 60 : null;

  let signalCount = 0;
  if (todayRHR !== null) signalCount++;
  if (todayHRV !== null) signalCount++;
  if (todaySleep !== null) signalCount++;

  const snapshot: HealthSnapshot = {
    date: new Date().toISOString().split("T")[0],
    restingHR: todayRHR,
    hrvRMSSD: todayHRV,
    sleepHours: todaySleep ? Math.round(todaySleep * 10) / 10 : null,
    restingHRTrend: restingHRData,
    hrvTrend: hrvData,
    sleepTrend: sleepData,
    signalCount,
    cachedAt: new Date().toISOString(),
  };

  saveSnapshotToCache(snapshot);
  console.log(`[HealthKit] Synced — ${signalCount} signals, RHR=${todayRHR}, HRV=${todayHRV}, Sleep=${snapshot.sleepHours}h`);

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
       (id, date, resting_hr, hrv_rmssd, sleep_hours, resting_hr_trend_json, hrv_trend_json, sleep_trend_json, signal_count, cached_at)
       VALUES (
         COALESCE((SELECT id FROM health_snapshot WHERE date = ?), ?),
         ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        snapshot.signalCount,
        snapshot.cachedAt,
      ]
    );
  } catch (e) {
    console.log("[HealthKit] Cache write error:", e);
  }
}
