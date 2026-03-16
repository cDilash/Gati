/**
 * Strava → SQLite sync pipeline (v2).
 *
 * Fetches new running activities, converts to PerformanceMetrics,
 * matches to scheduled workouts, and stores rich Strava detail.
 * Updated for v2 schema (workout.scheduled_date, performance_metric.duration_minutes, etc.)
 */

import * as Crypto from 'expo-crypto';
import { getRecentActivities, getActivityDetail, getActivityStreams } from './api';
import { metersToMiles, mpsToSecondsPerMile, metersToFeet } from './convert';
import {
  PerformanceMetric,
  Workout,
  WorkoutStatus,
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
  const { getDatabase } = require('../db/database');
  return getDatabase() as import('expo-sqlite').SQLiteDatabase;
}

function getLastSyncTimestamp(): number | null {
  try {
    const db = getDb();
    console.log('[Sync] getLastSyncTimestamp - db instance:', !!db);
    const row = db.getFirstSync(
      'SELECT last_sync_at FROM strava_tokens WHERE id = 1'
    ) as { last_sync_at: string | null } | null;
    console.log('[Sync] last_sync_at:', row?.last_sync_at);
    if (!row?.last_sync_at) return null;
    return Math.floor(new Date(row.last_sync_at).getTime() / 1000);
  } catch (e) {
    console.warn('[Sync] getLastSyncTimestamp failed:', e);
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
    return db.getAllSync<Workout>(
      `SELECT * FROM workout
       WHERE scheduled_date >= ? AND scheduled_date <= ?
       AND plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       ORDER BY scheduled_date`,
      startDate, endDate
    );
  } catch {
    return [];
  }
}

function saveMetric(metric: Omit<PerformanceMetric, 'created_at'>): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO performance_metric
     (id, workout_id, strava_activity_id, date, distance_miles, duration_minutes,
      avg_pace_sec_per_mile, avg_hr, max_hr, splits_json, best_efforts_json,
      perceived_exertion, gear_name, strava_workout_type, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    metric.id,
    metric.workout_id ?? null,
    metric.strava_activity_id ?? null,
    metric.date,
    metric.distance_miles,
    metric.duration_minutes,
    metric.avg_pace_sec_per_mile ?? null,
    metric.avg_hr ?? null,
    metric.max_hr ?? null,
    metric.splits_json ?? null,
    metric.best_efforts_json ?? null,
    metric.perceived_exertion ?? null,
    metric.gear_name ?? null,
    metric.strava_workout_type ?? null,
    metric.source,
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
  const cadenceStream = subsampleAt(streams?.cadence?.data);
  const timeStream = subsampleAt(streams?.time?.data);

  db.runSync(
    `INSERT OR REPLACE INTO strava_activity_detail
     (id, performance_metric_id, strava_activity_id, splits_json, laps_json,
      hr_stream_json, pace_stream_json, elevation_gain_ft, calories,
      cadence_avg, suffer_score, device_name,
      best_efforts_json, gear_id, gear_name, perceived_exertion,
      strava_workout_type, moving_time_sec, elapsed_time_sec,
      polyline_encoded, summary_polyline_encoded,
      distance_stream_json, elevation_stream_json,
      cadence_stream_json, time_stream_json,
      segment_efforts_json, timezone, utc_offset,
      activity_name, activity_type, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    cadenceStream ? JSON.stringify(cadenceStream) : null,
    timeStream ? JSON.stringify(timeStream) : null,
    detail.segmentEfforts.length > 0 ? JSON.stringify(detail.segmentEfforts) : null,
    detail.timezone,
    detail.utcOffset,
    detail.name || null,
    detail.type || 'Run',
    detail.description || null,
  );
}

function markWorkoutCompleted(workoutId: string, stravaActivityId: number): void {
  try {
    const db = getDb();
    db.runSync(
      "UPDATE workout SET status = 'completed', strava_activity_id = ? WHERE id = ? AND status = 'upcoming'",
      stravaActivityId,
      workoutId,
    );
  } catch {
    // Non-critical
  }
}

// ─── Execution Quality Assessment ────────────────────────

function assessExecutionQuality(
  workout: Workout,
  metric: Omit<PerformanceMetric, 'created_at'>,
): { status: WorkoutStatus; quality: string } {
  const targetDist = workout.target_distance_miles ?? 0;
  const actualDist = metric.distance_miles;
  const distRatio = targetDist > 0 ? actualDist / targetDist : 1;

  // Determine status based on distance completion
  let status: WorkoutStatus = 'completed';
  if (distRatio >= 0.5 && distRatio < 0.8) {
    status = 'partial';
  }

  // Determine execution quality based on pace
  let quality = 'on_target';
  const qualityTypes = ['threshold', 'interval', 'tempo', 'marathon_pace'];
  const easyTypes = ['easy', 'recovery'];

  if (metric.avg_pace_sec_per_mile && workout.target_pace_zone) {
    try {
      const { calculatePaceZones } = require('../engine/paceZones');
      const { getUserProfile } = require('../db/database');
      const profile = getUserProfile();
      if (profile) {
        const zones = calculatePaceZones(profile.vdot_score);
        const targetZone = zones[workout.target_pace_zone as keyof typeof zones];
        if (targetZone) {
          const actualPace = metric.avg_pace_sec_per_mile;
          // For quality workouts: check if too slow
          if (qualityTypes.includes(workout.workout_type)) {
            if (actualPace > targetZone.max + 30) {
              quality = 'missed_pace';
            }
          }
          // For easy workouts: check if too fast
          if (easyTypes.includes(workout.workout_type)) {
            if (actualPace < targetZone.min - 15) {
              quality = 'exceeded_pace';
            }
          }
        }
      }
    } catch {}
  }

  // Distance way off = wrong type
  if (distRatio < 0.5) {
    quality = 'wrong_type';
  }

  return { status, quality };
}

// ─── Activity → PerformanceMetric Conversion ───────────────

function stravaActivityToMetric(
  detail: StravaActivityDetail,
  matchedWorkoutId: string | null,
): Omit<PerformanceMetric, 'created_at'> {
  const distanceMiles = metersToMiles(detail.distance);
  const avgPacePerMile = Math.round(mpsToSecondsPerMile(detail.averageSpeed));
  const durationMinutes = Math.round(detail.movingTime / 60 * 100) / 100;

  return {
    id: Crypto.randomUUID(),
    workout_id: matchedWorkoutId,
    strava_activity_id: detail.id,
    date: detail.startDate.split('T')[0],
    source: 'strava',
    distance_miles: Math.round(distanceMiles * 100) / 100,
    duration_minutes: durationMinutes,
    avg_pace_sec_per_mile: avgPacePerMile,
    avg_hr: detail.averageHeartrate ?? null,
    max_hr: detail.maxHeartrate ?? null,
    splits_json: detail.splitsStandard.length > 0 ? JSON.stringify(detail.splitsStandard) : null,
    best_efforts_json: detail.bestEfforts.length > 0 ? JSON.stringify(detail.bestEfforts) : null,
    perceived_exertion: detail.perceivedExertion ?? null,
    gear_name: detail.gearName ?? null,
    strava_workout_type: detail.stravaWorkoutType ?? null,
  };
}

// ─── Workout Matching ──────────────────────────────────────

function matchToScheduledWorkout(
  activityDate: string,
  activityDistanceMiles: number,
  scheduledWorkouts: Workout[],
): string | null {
  // Find workouts on the same date that aren't rest days and aren't already completed
  const sameDayWorkouts = scheduledWorkouts.filter(
    w => w.scheduled_date === activityDate &&
         w.workout_type !== 'rest' &&
         w.status === 'upcoming'
  );

  if (sameDayWorkouts.length === 0) return null;
  if (sameDayWorkouts.length === 1) return sameDayWorkouts[0].id;

  // Multiple workouts: match by closest distance
  let bestMatch = sameDayWorkouts[0];
  let bestDiff = Math.abs((sameDayWorkouts[0].target_distance_miles ?? 0) - activityDistanceMiles);

  for (let i = 1; i < sameDayWorkouts.length; i++) {
    const diff = Math.abs((sameDayWorkouts[i].target_distance_miles ?? 0) - activityDistanceMiles);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = sameDayWorkouts[i];
    }
  }

  return bestMatch.id;
}

// ─── Main Sync Function ───────────────────────────────────

export async function syncStravaActivities(options?: {
  afterTimestamp?: number;
  perPage?: number;
}): Promise<SyncResult> {
  const result: SyncResult = { newActivities: 0, matched: 0, unmatched: 0 };

  console.log('[Sync] Starting syncStravaActivities...');
  const lastSync = options?.afterTimestamp ?? getLastSyncTimestamp();
  console.log('[Sync] Last sync timestamp:', lastSync);

  // Fetch recent running activities
  const activities = await getRecentActivities(lastSync ?? undefined, options?.perPage);
  if (activities.length === 0) {
    updateLastSyncTimestamp();
    rematchOrphanedMetrics();
    return result;
  }

  // Get scheduled workouts in the date range for matching
  const dates = activities.map(a => a.startDate.split('T')[0]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const scheduledWorkouts = getScheduledWorkoutsInRange(minDate, maxDate);

  for (const activity of activities) {
    // Skip if already imported (dedup by strava_activity_id)
    if (stravaActivityAlreadyImported(activity.id)) continue;

    // Fetch detailed data + streams
    const detail = await getActivityDetail(activity.id);
    if (!detail) continue;

    const streams = await getActivityStreams(activity.id);

    // Convert and match
    const activityDate = detail.startDate.split('T')[0];
    const distanceMiles = metersToMiles(detail.distance);

    const matchedWorkoutId = matchToScheduledWorkout(
      activityDate, distanceMiles, scheduledWorkouts,
    );

    // Save metric + detail
    const metric = stravaActivityToMetric(detail, matchedWorkoutId);

    // Assess execution quality
    let workoutStatus: WorkoutStatus = 'completed';
    let executionQuality = 'on_target';
    if (matchedWorkoutId) {
      const matchedWorkout = scheduledWorkouts.find(w => w.id === matchedWorkoutId);
      if (matchedWorkout) {
        const assessment = assessExecutionQuality(matchedWorkout, metric);
        workoutStatus = assessment.status;
        executionQuality = assessment.quality;
      }
    }

    saveMetric(metric);
    saveStravaDetail(metric.id, detail, streams);

    // Auto-mark matched workout with quality assessment
    if (matchedWorkoutId) {
      const db = getDb();
      db.runSync(
        "UPDATE workout SET status = ?, strava_activity_id = ?, execution_quality = ? WHERE id = ?",
        [workoutStatus, detail.id, executionQuality, matchedWorkoutId]
      );
      result.matched++;
    } else {
      result.unmatched++;
    }

    result.newActivities++;
  }

  updateLastSyncTimestamp();
  rematchOrphanedMetrics();
  await backfillPolylines();

  return result;
}

// ─── Re-match Orphaned Metrics ────────────────────────────

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

    const dates = orphans.map(o => o.date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const scheduledWorkouts = getScheduledWorkoutsInRange(minDate, maxDate);

    let matched = 0;
    for (const orphan of orphans) {
      const workoutId = matchToScheduledWorkout(
        orphan.date, orphan.distance_miles, scheduledWorkouts,
      );
      if (!workoutId) continue;

      // Check this workout isn't already matched
      const existing = db.getFirstSync<{ id: string }>(
        'SELECT id FROM performance_metric WHERE workout_id = ?',
        workoutId,
      );
      if (existing) continue;

      db.runSync('UPDATE performance_metric SET workout_id = ? WHERE id = ?', workoutId, orphan.id);

      // Also mark the workout completed if it's still upcoming
      db.runSync(
        "UPDATE workout SET status = 'completed' WHERE id = ? AND status = 'upcoming'",
        workoutId,
      );
      matched++;
    }

    if (matched > 0) {
      console.log(`[Rematch] Linked ${matched} orphaned metrics to plan workouts`);
    }
  } catch (e) {
    console.warn('[Rematch] Failed:', e);
  }
}

// ─── Polyline Backfill ────────────────────────────────────

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

      db.runSync(
        `UPDATE strava_activity_detail SET
           polyline_encoded = ?,
           summary_polyline_encoded = ?
         WHERE id = ?`,
        detail.polylineEncoded,
        detail.summaryPolylineEncoded,
        row.id,
      );
    }
  } catch (e) {
    console.warn('[Backfill] Failed:', e);
  }
}
