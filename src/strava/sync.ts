/**
 * Strava → SQLite sync pipeline.
 * Fetches new running activities, converts to PerformanceMetrics,
 * matches to scheduled workouts, and stores rich Strava detail.
 */

import * as Crypto from 'expo-crypto';
import { getRecentActivities, getActivityDetail, getActivityStreams } from './api';
import { metersToMiles, mpsToSecondsPerMile, metersToFeet } from './convert';
import {
  PerformanceMetric,
  Workout,
  StravaActivityDetail,
  StravaStreams,
} from '../types';

export interface SyncResult {
  newActivities: number;
  matched: number;
  unmatched: number;
}

// ─── SQLite helpers ────────────────────────────────────────

function getDb() {
  const SQLite = require('expo-sqlite');
  return SQLite.openDatabaseSync('marathon_coach.db');
}

function getLastSyncTimestamp(): number | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT last_sync_at FROM strava_tokens WHERE id = 1'
    ) as { last_sync_at: string | null } | null;
    if (!row?.last_sync_at) return null;
    return Math.floor(new Date(row.last_sync_at).getTime() / 1000);
  } catch {
    return null;
  }
}

function updateLastSyncTimestamp(): void {
  try {
    const db = getDb();
    db.runSync(
      "UPDATE strava_tokens SET last_sync_at = datetime('now') WHERE id = 1"
    );
  } catch {
    // Non-critical
  }
}

function metricExistsForDate(date: string, source: string): boolean {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT id FROM performance_metric WHERE date = ? AND source = ?',
      date, source
    );
    return row !== null;
  } catch {
    return false;
  }
}

function stravaActivityAlreadyImported(stravaActivityId: number): boolean {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT id FROM strava_activity_detail WHERE strava_activity_id = ?',
      stravaActivityId
    );
    return row !== null;
  } catch {
    return false;
  }
}

function getScheduledWorkoutsInRange(startDate: string, endDate: string): Workout[] {
  try {
    const db = getDb();
    const rows = db.getAllSync(
      'SELECT * FROM workout WHERE date >= ? AND date <= ? ORDER BY date',
      startDate, endDate
    ) as any[];
    return rows.map(parseWorkoutRow);
  } catch {
    return [];
  }
}

function parseWorkoutRow(row: any): Workout {
  return {
    ...row,
    is_cutback: !!row.is_cutback,
    intervals: row.intervals_json ? JSON.parse(row.intervals_json) : undefined,
  };
}

function saveMetric(metric: PerformanceMetric): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO performance_metric
     (id, workout_id, date, source, distance_miles, duration_seconds, avg_pace_per_mile, avg_hr, max_hr, calories, route_json, rpe_score, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    metric.id,
    metric.workout_id || null,
    metric.date,
    metric.source,
    metric.distance_miles,
    metric.duration_seconds,
    metric.avg_pace_per_mile,
    metric.avg_hr || null,
    metric.max_hr || null,
    metric.calories || null,
    metric.route_json || null,
    metric.rpe_score ?? null,
    metric.synced_at,
  );
}

function saveStravaDetail(
  metricId: string,
  detail: StravaActivityDetail,
  streams: StravaStreams | null,
): void {
  const db = getDb();
  const id = Crypto.randomUUID();

  // Subsample streams to ~1 point per minute to save space
  // All streams use the same interval so indices stay aligned
  const streamLength = streams?.heartrate?.data?.length
    ?? streams?.velocity_smooth?.data?.length
    ?? streams?.distance?.data?.length
    ?? 0;
  const subsampleInterval = streamLength > 60 ? Math.ceil(streamLength / 60) : 1;

  function subsampleAt(data: number[] | undefined): number[] | null {
    if (!data || data.length === 0) return null;
    if (data.length <= 60) return data;
    const result: number[] = [];
    for (let i = 0; i < data.length; i += subsampleInterval) {
      result.push(data[i]);
    }
    if (result[result.length - 1] !== data[data.length - 1]) {
      result.push(data[data.length - 1]);
    }
    return result;
  }

  const hrStream = subsampleAt(streams?.heartrate?.data);
  const paceStream = subsampleAt(streams?.velocity_smooth?.data);
  const distanceStream = subsampleAt(streams?.distance?.data);
  const elevationStream = subsampleAt(streams?.altitude?.data);

  db.runSync(
    `INSERT OR REPLACE INTO strava_activity_detail
     (id, performance_metric_id, strava_activity_id, splits_json, laps_json,
      hr_stream_json, pace_stream_json, elevation_gain_ft, calories,
      cadence_avg, suffer_score, device_name,
      best_efforts_json, gear_id, gear_name, perceived_exertion,
      strava_workout_type, moving_time_sec, elapsed_time_sec,
      polyline_encoded, summary_polyline_encoded,
      distance_stream_json, elevation_stream_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    metricId,
    detail.id,
    JSON.stringify(detail.splitsStandard),
    JSON.stringify(detail.laps),
    hrStream ? JSON.stringify(hrStream) : null,
    paceStream ? JSON.stringify(paceStream) : null,
    metersToFeet(detail.totalElevationGain),
    detail.calories,
    detail.averageCadence,
    detail.sufferScore,
    detail.deviceName,
    detail.bestEfforts.length > 0 ? JSON.stringify(detail.bestEfforts) : null,
    detail.gearId,
    detail.gearName,
    detail.perceivedExertion,
    detail.stravaWorkoutType,
    detail.movingTime,
    detail.elapsedTime,
    detail.polylineEncoded,
    detail.summaryPolylineEncoded,
    distanceStream ? JSON.stringify(distanceStream) : null,
    elevationStream ? JSON.stringify(elevationStream) : null,
  );
}

function markWorkoutCompleted(workoutId: string): void {
  try {
    const db = getDb();
    db.runSync(
      "UPDATE workout SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'",
      workoutId
    );
  } catch {
    // Non-critical
  }
}

// ─── Stream Subsampling ────────────────────────────────────



// ─── Activity → PerformanceMetric Conversion ───────────────

function stravaActivityToMetric(
  detail: StravaActivityDetail,
  matchedWorkoutId: string | null,
): PerformanceMetric {
  const distanceMiles = metersToMiles(detail.distance);
  const avgPacePerMile = Math.round(mpsToSecondsPerMile(detail.averageSpeed));

  return {
    id: Crypto.randomUUID(),
    workout_id: matchedWorkoutId || undefined,
    date: detail.startDate.split('T')[0], // ISO date only
    source: 'strava',
    distance_miles: Math.round(distanceMiles * 100) / 100, // 2 decimal places
    duration_seconds: detail.movingTime,
    avg_pace_per_mile: avgPacePerMile,
    avg_hr: detail.averageHeartrate || undefined,
    max_hr: detail.maxHeartrate || undefined,
    calories: detail.calories || undefined,
    rpe_score: detail.perceivedExertion ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ─── Workout Matching ──────────────────────────────────────

/**
 * Match a Strava activity to a scheduled workout by date and distance proximity.
 * Returns the workout_id or null if no match.
 */
function matchToScheduledWorkout(
  activityDate: string,
  activityDistanceMiles: number,
  scheduledWorkouts: Workout[],
): string | null {
  // Find workouts on the same date that aren't rest days
  const sameDayWorkouts = scheduledWorkouts.filter(
    w => w.date === activityDate && w.workout_type !== 'rest'
  );

  if (sameDayWorkouts.length === 0) return null;

  if (sameDayWorkouts.length === 1) return sameDayWorkouts[0].id;

  // Multiple workouts on same date (e.g., AM easy + PM intervals):
  // match by closest distance
  let bestMatch = sameDayWorkouts[0];
  let bestDiff = Math.abs(sameDayWorkouts[0].distance_miles - activityDistanceMiles);

  for (let i = 1; i < sameDayWorkouts.length; i++) {
    const diff = Math.abs(sameDayWorkouts[i].distance_miles - activityDistanceMiles);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = sameDayWorkouts[i];
    }
  }

  return bestMatch.id;
}

// ─── Main Sync Function ───────────────────────────────────

/**
 * Sync recent Strava activities to SQLite.
 * Fetches new runs, converts to PerformanceMetrics, matches to workouts.
 */
export async function syncStravaActivities(options?: {
  afterTimestamp?: number;
  perPage?: number;
}): Promise<SyncResult> {
  const result: SyncResult = { newActivities: 0, matched: 0, unmatched: 0 };

  // Get the timestamp to sync from (use override for historical sync)
  const lastSync = options?.afterTimestamp ?? getLastSyncTimestamp();

  // Fetch recent activities (runs only)
  const activities = await getRecentActivities(lastSync ?? undefined, options?.perPage);
  if (activities.length === 0) {
    updateLastSyncTimestamp();
    await backfillPolylines();
    rematchOrphanedMetrics();
    return result;
  }

  // Get all scheduled workouts in the date range for matching
  const dates = activities.map(a => a.startDate.split('T')[0]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const scheduledWorkouts = getScheduledWorkoutsInRange(minDate, maxDate);

  for (const activity of activities) {
    // Skip if already imported (dedup by strava_activity_id)
    if (stravaActivityAlreadyImported(activity.id)) continue;

    // Fetch detailed data
    const detail = await getActivityDetail(activity.id);
    if (!detail) continue;

    // Fetch streams
    const streams = await getActivityStreams(activity.id);

    // Convert to PerformanceMetric
    const activityDate = detail.startDate.split('T')[0];
    const distanceMiles = metersToMiles(detail.distance);

    // Match to scheduled workout
    const matchedWorkoutId = matchToScheduledWorkout(
      activityDate,
      distanceMiles,
      scheduledWorkouts,
    );

    // Create and save the metric
    const metric = stravaActivityToMetric(detail, matchedWorkoutId);
    saveMetric(metric);

    // Save the rich Strava detail
    saveStravaDetail(metric.id, detail, streams);

    // Auto-mark matched workout as completed
    if (matchedWorkoutId) {
      markWorkoutCompleted(matchedWorkoutId);
      result.matched++;
    } else {
      result.unmatched++;
    }

    result.newActivities++;
  }

  updateLastSyncTimestamp();

  // Backfill polylines for activities synced before the 10A migration
  await backfillPolylines();

  // Re-match unmatched metrics to current plan workouts
  rematchOrphanedMetrics();

  return result;
}

// ─── Polyline Backfill ────────────────────────────────────

/**
 * Re-fetch detail for activities missing polyline data.
 * These were synced before the MIGRATE_STRAVA_DETAIL_10A migration
 * added the polyline_encoded column.
 */
async function backfillPolylines(): Promise<void> {
  try {
    const db = getDb();
    const rows = db.getAllSync<{ strava_activity_id: number; id: string }>(
      `SELECT id, strava_activity_id FROM strava_activity_detail
       WHERE polyline_encoded IS NULL AND strava_activity_id IS NOT NULL
       LIMIT 10`
    );

    if (rows.length === 0) return;
    console.log(`[Backfill] ${rows.length} activities missing polyline — re-fetching`);

    for (const row of rows) {
      const detail = await getActivityDetail(row.strava_activity_id);
      if (!detail?.polylineEncoded) continue;

      const streams = await getActivityStreams(row.strava_activity_id);

      // Subsample streams consistently
      const streamLength = streams?.heartrate?.data?.length
        ?? streams?.velocity_smooth?.data?.length
        ?? streams?.distance?.data?.length
        ?? 0;
      const interval = streamLength > 60 ? Math.ceil(streamLength / 60) : 1;

      function subsample(data: number[] | undefined): string | null {
        if (!data || data.length === 0) return null;
        if (data.length <= 60) return JSON.stringify(data);
        const result: number[] = [];
        for (let i = 0; i < data.length; i += interval) result.push(data[i]);
        if (result[result.length - 1] !== data[data.length - 1]) result.push(data[data.length - 1]);
        return JSON.stringify(result);
      }

      db.runSync(
        `UPDATE strava_activity_detail SET
           polyline_encoded = ?,
           summary_polyline_encoded = ?,
           distance_stream_json = COALESCE(distance_stream_json, ?),
           elevation_stream_json = COALESCE(elevation_stream_json, ?)
         WHERE id = ?`,
        detail.polylineEncoded,
        detail.summaryPolylineEncoded,
        subsample(streams?.distance?.data),
        subsample(streams?.altitude?.data),
        row.id,
      );
    }

    console.log(`[Backfill] Done — updated ${rows.length} activities`);
  } catch (e) {
    console.warn('[Backfill] Failed:', e);
  }
}

// ─── Re-match Orphaned Metrics ────────────────────────────

/**
 * Find performance_metric rows with no workout_id and try to match them
 * against the current training plan by date + distance proximity.
 *
 * This handles the case where activities were imported before the plan existed,
 * or when the plan was regenerated with new workout IDs.
 */
function rematchOrphanedMetrics(): void {
  try {
    const db = getDb();

    // Find unmatched metrics from the last 8 weeks
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 56);
    const orphans = db.getAllSync<{ id: string; date: string; distance_miles: number }>(
      `SELECT id, date, distance_miles FROM performance_metric
       WHERE workout_id IS NULL AND date >= ?
       ORDER BY date DESC`,
      cutoff.toISOString().split('T')[0],
    );

    if (orphans.length === 0) return;

    // Get all scheduled (unmatched) workouts in the date range
    const dates = orphans.map(o => o.date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const scheduledWorkouts = getScheduledWorkoutsInRange(minDate, maxDate);

    let matched = 0;
    for (const orphan of orphans) {
      const workoutId = matchToScheduledWorkout(
        orphan.date,
        orphan.distance_miles,
        scheduledWorkouts,
      );
      if (!workoutId) continue;

      // Check this workout isn't already matched to another metric
      const existing = db.getFirstSync<{ id: string }>(
        'SELECT id FROM performance_metric WHERE workout_id = ?',
        workoutId,
      );
      if (existing) continue;

      // Link the metric to the workout
      db.runSync(
        'UPDATE performance_metric SET workout_id = ? WHERE id = ?',
        workoutId, orphan.id,
      );
      markWorkoutCompleted(workoutId);
      matched++;
    }

    if (matched > 0) {
      console.log(`[Rematch] Linked ${matched} orphaned metrics to plan workouts`);
    }
  } catch (e) {
    console.warn('[Rematch] Failed:', e);
  }
}
