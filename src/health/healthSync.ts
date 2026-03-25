/**
 * Health data utilities — cache and change detection.
 *
 * The actual health sync is handled by garminHealthSync.ts (Supabase/Garmin-only).
 * This file provides:
 * - saveSnapshotToCache() — SQLite cache for fast hydration on app launch
 * - hasSignificantChanges() — detect changes that warrant recovery score update
 */

import * as Crypto from 'expo-crypto';
import { getDatabase } from "../db/database";
import { HealthSnapshot } from "../types";

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

/**
 * Cache a HealthSnapshot to SQLite for fast hydration on next app launch.
 */
export function saveSnapshotToCache(snapshot: HealthSnapshot): void {
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
    console.log("[Health] Cache write error:", e);
  }
}
