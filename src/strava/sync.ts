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
  syncedDates: string[];
}

// ─── SQLite helpers ────────────────────────────────────────

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase() as import('expo-sqlite').SQLiteDatabase;
}

function getLastSyncTimestamp(): number | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT last_sync_at FROM strava_tokens WHERE id = 1'
    ) as { last_sync_at: string | null } | null;
    if (!row?.last_sync_at) {
      console.log('[Strava Sync] last_sync_at: NULL (will fetch all)');
      return null;
    }
    // SQLite datetime('now') returns UTC without timezone suffix.
    // Append 'Z' so JS Date parses it as UTC, not local time.
    let raw = row.last_sync_at;
    if (!raw.includes('Z') && !raw.includes('+') && !raw.includes('T')) {
      raw = raw.replace(' ', 'T') + 'Z';
    } else if (!raw.includes('Z') && !raw.includes('+')) {
      raw = raw + 'Z';
    }
    const ts = Math.floor(new Date(raw).getTime() / 1000);
    console.log(`[Strava Sync] last_sync_at raw="${row.last_sync_at}" → parsed="${new Date(ts * 1000).toISOString()}" → unix=${ts}`);
    return ts;
  } catch (e) {
    console.warn('[Strava Sync] getLastSyncTimestamp failed:', e);
    return null;
  }
}

function updateLastSyncTimestamp(unixSeconds?: number): void {
  try {
    const db = getDb();
    const value = unixSeconds
      ? new Date(unixSeconds * 1000).toISOString()
      : new Date().toISOString();
    db.runSync(
      'UPDATE strava_tokens SET last_sync_at = ? WHERE id = 1',
      value,
    );
    console.log(`[Strava Sync] Updated last_sync_at = ${value}`);
  } catch (e) {
    console.warn('[Strava Sync] updateLastSyncTimestamp failed:', e);
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
      activity_name, activity_type, description,
      location_city, location_state, location_country, start_lat, start_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    detail.locationCity || null,
    detail.locationState || null,
    detail.locationCountry || null,
    detail.startLat ?? null,
    detail.startLng ?? null,
  );
}

function markWorkoutCompleted(workoutId: string, stravaActivityId: number): void {
  try {
    const db = getDb();
    db.runSync(
      "UPDATE workout SET status = 'completed', strava_activity_id = ? WHERE id = ? AND status IN ('upcoming', 'modified')",
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
  const sameDayAll = scheduledWorkouts.filter(w => w.scheduled_date === activityDate);
  const sameDayWorkouts = sameDayAll.filter(
    w => w.workout_type !== 'rest' && (w.status === 'upcoming' || w.status === 'modified' || w.status === 'skipped')
  );

  console.log(`[Strava Sync]   Match: date=${activityDate}, ${sameDayAll.length} workouts on this date, ${sameDayWorkouts.length} eligible (upcoming, non-rest)`);
  if (sameDayAll.length > 0 && sameDayWorkouts.length === 0) {
    const blocked = sameDayAll.filter(w => w.workout_type !== 'rest');
    blocked.forEach(w => console.log(`[Strava Sync]     Workout ${w.id} status=${w.status} type=${w.workout_type} — not eligible`));
  }

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
  const result: SyncResult = { newActivities: 0, matched: 0, unmatched: 0, syncedDates: [] };

  console.log('[Strava Sync] ════════════════════════════════════');
  console.log('[Strava Sync] Starting sync...');
  const lastSync = options?.afterTimestamp ?? getLastSyncTimestamp();
  if (lastSync) {
    console.log(`[Strava Sync] Fetching activities after: ${new Date(lastSync * 1000).toISOString()} (unix=${lastSync})`);
  } else {
    console.log('[Strava Sync] No last sync timestamp — fetching ALL recent activities');
  }

  const activities = await getRecentActivities(lastSync ?? undefined, options?.perPage);
  console.log(`[Strava Sync] API returned ${activities.length} running activities`);
  if (activities.length > 0) {
    activities.forEach((a, i) => {
      console.log(`[Strava Sync]   ${i + 1}. id=${a.id} "${a.name}" ${a.startDate.split('T')[0]} ${(a.distance / 1609.344).toFixed(1)}mi`);
    });
  }
  if (activities.length === 0) {
    console.log('[Strava Sync] No new activities — keeping last_sync_at unchanged');
    // Safety: if last_sync_at is less than 24h old and we got 0 results,
    // roll it back 24h so we don't miss activities that Strava is still processing
    const currentSync = getLastSyncTimestamp();
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    if (currentSync && currentSync > oneDayAgo) {
      console.log('[Strava Sync] Rolling back last_sync_at by 24h for safety');
      updateLastSyncTimestamp(oneDayAgo);
    }
    rematchOrphanedMetrics();
    console.log('[Strava Sync] ════════════════════════════════════');
    return result;
  }

  // Get scheduled workouts in the date range for matching
  const dates = activities.map(a => a.startDate.split('T')[0]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const scheduledWorkouts = getScheduledWorkoutsInRange(minDate, maxDate);

  let duplicates = 0;
  for (const activity of activities) {
    // Skip if already imported (dedup by strava_activity_id)
    if (stravaActivityAlreadyImported(activity.id)) {
      duplicates++;
      console.log(`[Strava Sync] Activity ${activity.id} "${activity.name}" — already imported, skipping`);
      continue;
    }
    // Skip if user previously deleted this activity
    try {
      const { isStravaActivityBlocked } = require('../db/database');
      if (isStravaActivityBlocked(activity.id)) {
        console.log(`[Strava Sync] Activity ${activity.id} "${activity.name}" — user deleted, blocked`);
        continue;
      }
    } catch {}
    console.log(`[Strava Sync] Activity ${activity.id} "${activity.name}" ${activity.startDate.split('T')[0]} — NEW, importing...`);

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
    console.log(`[Strava Sync]   Saved metric + detail for activity ${activity.id}`);

    // Auto-mark matched workout with quality assessment
    if (matchedWorkoutId) {
      const db = getDb();
      db.runSync(
        "UPDATE workout SET status = ?, strava_activity_id = ?, execution_quality = ? WHERE id = ?",
        [workoutStatus, detail.id, executionQuality, matchedWorkoutId]
      );
      console.log(`[Strava Sync]   Matched to workout ${matchedWorkoutId} → status=${workoutStatus}, quality=${executionQuality}`);
      result.matched++;
    } else {
      console.log(`[Strava Sync]   No matching workout found for ${activityDate}`);
      result.unmatched++;
    }

    result.newActivities++;
    if (!result.syncedDates.includes(activityDate)) result.syncedDates.push(activityDate);
  }

  // Update last_sync_at to the latest activity's start time (not "now")
  // This prevents skipping activities that Strava processes out of order
  if (result.newActivities > 0) {
    const latestActivityTime = Math.max(
      ...activities.map(a => Math.floor(new Date(a.startDate).getTime() / 1000))
    );
    updateLastSyncTimestamp(latestActivityTime);
    console.log(`[Strava Sync] Set last_sync_at to latest activity: ${new Date(latestActivityTime * 1000).toISOString()}`);
  } else {
    // All activities were duplicates/blocked — don't advance timestamp
    console.log('[Strava Sync] No new imports — last_sync_at unchanged');
  }
  rematchOrphanedMetrics();
  await backfillPolylines();
  await reverseGeocodeLocations();

  console.log(`[Strava Sync] Complete: ${result.newActivities} new, ${result.matched} matched, ${result.unmatched} unmatched, ${duplicates} duplicates`);
  console.log('[Strava Sync] ════════════════════════════════════');
  return result;
}

// ─── Re-match Orphaned Metrics ────────────────────────────

function rematchOrphanedMetrics(): void {
  try {
    const db = getDb();

    // Step 1: Fix UTC date mismatches on orphaned metrics.
    // Old code stored UTC date (start_date) instead of local date (start_date_local).
    // E.g., a 7 PM PDT run on March 18 was stored as date="2026-03-19" (UTC).
    // Fix: use utc_offset from strava_activity_detail to derive the correct local date.
    const { getToday, addDays } = require('../utils/dateUtils');
    const fiftyDaysAgo = addDays(getToday(), -56);
    const utcOrphans = db.getAllSync<{ pm_id: string; strava_id: number; pm_date: string; utc_offset: number | null }>(
      `SELECT pm.id as pm_id, pm.strava_activity_id as strava_id, pm.date as pm_date, sad.utc_offset
       FROM performance_metric pm
       JOIN strava_activity_detail sad ON sad.strava_activity_id = pm.strava_activity_id
       WHERE pm.workout_id IS NULL AND pm.date >= ?
       AND sad.utc_offset IS NOT NULL`,
      fiftyDaysAgo
    );

    for (const o of utcOrphans) {
      // Derive local date from UTC date + offset
      const utcDate = new Date(o.pm_date + 'T12:00:00Z');
      const localDate = new Date(utcDate.getTime() + (o.utc_offset! * 1000));
      const localDateStr = localDate.toISOString().split('T')[0];
      if (localDateStr !== o.pm_date) {
        console.log(`[Strava Sync] Fixing UTC date: metric ${o.pm_id} date ${o.pm_date} → ${localDateStr} (offset=${o.utc_offset})`);
        db.runSync('UPDATE performance_metric SET date = ? WHERE id = ?', localDateStr, o.pm_id);
      }
    }

    // Step 2: Find unmatched metrics from the last 8 weeks
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 56);
    const orphans = db.getAllSync<{ id: string; date: string; distance_miles: number; strava_activity_id: number | null }>(
      `SELECT id, date, distance_miles, strava_activity_id FROM performance_metric
       WHERE workout_id IS NULL AND date >= ?
       ORDER BY date DESC`,
      cutoff.toISOString().split('T')[0],
    );

    if (orphans.length === 0) return;
    console.log(`[Strava Sync] Rematch: ${orphans.length} orphaned metrics to check`);

    // Expand date range by 1 day on each side to catch UTC edge cases
    const dates = orphans.map(o => o.date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const minExpanded = new Date(minDate + 'T00:00:00');
    minExpanded.setDate(minExpanded.getDate() - 1);
    const maxExpanded = new Date(maxDate + 'T00:00:00');
    maxExpanded.setDate(maxExpanded.getDate() + 1);
    const scheduledWorkouts = getScheduledWorkoutsInRange(
      minExpanded.toISOString().split('T')[0],
      maxExpanded.toISOString().split('T')[0],
    );

    let matched = 0;
    for (const orphan of orphans) {
      // Try exact date first
      let workoutId = matchToScheduledWorkout(
        orphan.date, orphan.distance_miles, scheduledWorkouts,
      );

      // If no match, try adjacent dates (UTC offset edge case)
      if (!workoutId) {
        const prevDay = new Date(orphan.date + 'T00:00:00');
        prevDay.setDate(prevDay.getDate() - 1);
        const prevStr = prevDay.toISOString().split('T')[0];
        workoutId = matchToScheduledWorkout(prevStr, orphan.distance_miles, scheduledWorkouts);
        if (workoutId) {
          // Fix the metric date to match the workout
          console.log(`[Strava Sync]   Matched on prev day: metric date ${orphan.date} → workout date ${prevStr}`);
          db.runSync('UPDATE performance_metric SET date = ? WHERE id = ?', prevStr, orphan.id);
        }
      }

      if (!workoutId) continue;

      // Check this workout isn't already matched to another metric
      const existing = db.getFirstSync<{ id: string }>(
        'SELECT id FROM performance_metric WHERE workout_id = ?',
        workoutId,
      );
      if (existing) continue;

      db.runSync('UPDATE performance_metric SET workout_id = ? WHERE id = ?', workoutId, orphan.id);

      // Mark the workout completed
      db.runSync(
        "UPDATE workout SET status = 'completed' WHERE id = ? AND status IN ('upcoming', 'modified')",
        workoutId,
      );
      matched++;
      console.log(`[Strava Sync]   Rematch: metric ${orphan.id} → workout ${workoutId}`);
    }

    if (matched > 0) {
      console.log(`[Strava Sync] Rematch complete: linked ${matched} orphaned metrics`);
    }
  } catch (e) {
    console.warn('[Strava Sync] Rematch failed:', e);
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

// ─── Reverse Geocode Locations ──────────────────────────

/**
 * Strava's API often returns the nearest major metro as location_city
 * (e.g., "San Francisco" for a run in Emeryville). Use expo-location
 * reverse geocoding with start_lat/start_lng for accurate city names.
 * Only processes activities that have coordinates but haven't been geocoded yet.
 */
async function reverseGeocodeLocations(): Promise<void> {
  try {
    const Location = require('expo-location');
    const db = getDb();

    // Find activities with coordinates that might have inaccurate city names
    // Process up to 5 at a time to avoid rate limits
    const rows = db.getAllSync<{
      id: string; start_lat: number; start_lng: number;
      location_city: string | null; geocoded: number | null;
    }>(
      `SELECT id, start_lat, start_lng, location_city, geocoded
       FROM strava_activity_detail
       WHERE start_lat IS NOT NULL AND start_lng IS NOT NULL
       AND (geocoded IS NULL OR geocoded = 0)
       ORDER BY rowid DESC LIMIT 5`
    );

    if (rows.length === 0) return;

    let updated = 0;
    for (const row of rows) {
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: row.start_lat,
          longitude: row.start_lng,
        });

        if (results && results.length > 0) {
          const geo = results[0];
          const city = geo.city || geo.subregion || row.location_city;
          const state = geo.region || null;
          const country = geo.country || null;

          db.runSync(
            `UPDATE strava_activity_detail
             SET location_city = ?, location_state = ?, location_country = ?, geocoded = 1
             WHERE id = ?`,
            city, state, country, row.id,
          );

          if (city !== row.location_city) {
            console.log(`[Strava Sync] Geocoded: ${row.location_city} → ${city}, ${state}`);
          }
          updated++;
        } else {
          // Mark as geocoded even if no result, to avoid retrying
          db.runSync('UPDATE strava_activity_detail SET geocoded = 1 WHERE id = ?', row.id);
        }
      } catch {
        // Individual geocode failure — skip, will retry next sync
      }
    }

    if (updated > 0) {
      console.log(`[Strava Sync] Reverse geocoded ${updated} activity locations`);
    }
  } catch {
    // expo-location not available or permission denied — skip silently
  }
}
