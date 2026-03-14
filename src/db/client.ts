import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { ALL_TABLES, MIGRATE_WORKOUT_ADAPTIVE, MIGRATE_STRAVA_DETAIL_9A, MIGRATE_STRAVA_DETAIL_10A } from './schema';
import { UserProfile, TrainingPlan, TrainingWeek, Workout, PerformanceMetric, CoachMessage, GeneratedPlan, AdaptiveLog, HealthSnapshot } from '../types';
import { getToday } from '../utils/dateUtils';

const DB_NAME = 'marathon_coach.db';

let db: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
  }
  return db;
}

export function initializeDatabase(): void {
  const database = getDatabase();
  database.execSync('PRAGMA journal_mode = WAL;');
  database.execSync('PRAGMA foreign_keys = ON;');

  // Create tables in a transaction
  database.withTransactionSync(() => {
    for (const createSQL of ALL_TABLES) {
      database.execSync(createSQL);
    }
  });

  // Run adaptive migrations (ALTER TABLE — safe to re-run, will fail silently if columns exist)
  for (const migration of [...MIGRATE_WORKOUT_ADAPTIVE, ...MIGRATE_STRAVA_DETAIL_9A, ...MIGRATE_STRAVA_DETAIL_10A]) {
    try {
      database.execSync(migration);
    } catch {
      // Column already exists — expected on subsequent launches
    }
  }

}

// User Profile CRUD
export function getUserProfile(): UserProfile | null {
  const database = getDatabase();
  const result = database.getFirstSync<any>('SELECT * FROM user_profile LIMIT 1');
  if (!result) return null;
  return {
    ...result,
    available_days: JSON.parse(result.available_days || '[]'),
    goal_marathon_time_seconds: result.goal_marathon_time_seconds || undefined,
  };
}

export function saveUserProfile(profile: UserProfile): void {
  const database = getDatabase();
  const now = new Date().toISOString();
  database.runSync(
    `INSERT OR REPLACE INTO user_profile (id, name, age, weight_lbs, resting_hr, max_hr, vdot, current_weekly_mileage, race_date, race_distance, recent_race_distance, recent_race_time_seconds, level, available_days, preferred_long_run_day, longest_recent_run, goal_marathon_time_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    profile.id, profile.name, profile.age, profile.weight_lbs, profile.resting_hr, profile.max_hr, profile.vdot, profile.current_weekly_mileage, profile.race_date, profile.race_distance, profile.recent_race_distance, profile.recent_race_time_seconds, profile.level, JSON.stringify(profile.available_days), profile.preferred_long_run_day, profile.longest_recent_run, profile.goal_marathon_time_seconds || null, profile.created_at || now, now
  );
}

// Plan CRUD
export function savePlan(generated: GeneratedPlan): void {
  const database = getDatabase();
  database.withTransactionSync(() => {
    const { plan, weeks, workouts } = generated;
    database.runSync(
      'INSERT INTO training_plan (id, start_date, race_date, total_weeks, peak_weekly_mileage, vdot_at_creation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      plan.id, plan.start_date, plan.race_date, plan.total_weeks, plan.peak_weekly_mileage, plan.vdot_at_creation, plan.created_at, plan.updated_at
    );

    for (const week of weeks) {
      database.runSync(
        'INSERT INTO training_week (id, plan_id, week_number, phase, is_cutback, target_volume_miles, actual_volume_miles, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        week.id, week.plan_id, week.week_number, week.phase, week.is_cutback ? 1 : 0, week.target_volume_miles, week.actual_volume_miles, week.start_date, week.end_date
      );
    }

    for (const workout of workouts) {
      database.runSync(
        'INSERT INTO workout (id, week_id, date, day_of_week, workout_type, distance_miles, target_pace_zone, intervals_json, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        workout.id, workout.week_id, workout.date, workout.day_of_week, workout.workout_type, workout.distance_miles, workout.target_pace_zone, workout.intervals_json || null, workout.status, workout.notes, workout.created_at, workout.updated_at
      );
    }
  });
}

export function deleteActivePlan(): void {
  const database = getDatabase();
  database.withTransactionSync(() => {
    // Unlink performance metrics from workouts (preserves Strava/HealthKit data;
    // rematchOrphanedMetrics() will re-link them to the new plan after regeneration)
    database.execSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (
         SELECT w.id FROM workout w
         JOIN training_week tw ON w.week_id = tw.id
         JOIN training_plan tp ON tw.plan_id = tp.id
       )`
    );
    database.execSync('DELETE FROM workout WHERE week_id IN (SELECT id FROM training_week WHERE plan_id IN (SELECT id FROM training_plan))');
    database.execSync('DELETE FROM training_week WHERE plan_id IN (SELECT id FROM training_plan)');
    database.execSync('DELETE FROM training_plan');
    database.execSync('DELETE FROM adaptive_log');
    database.execSync('DELETE FROM ai_briefing_cache');
  });
}

export function getActivePlan(): TrainingPlan | null {
  const database = getDatabase();
  return database.getFirstSync<TrainingPlan>('SELECT * FROM training_plan ORDER BY created_at DESC LIMIT 1');
}

export function getWeeksForPlan(planId: string): TrainingWeek[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>('SELECT * FROM training_week WHERE plan_id = ? ORDER BY week_number', planId);
  return rows.map(r => ({ ...r, is_cutback: r.is_cutback === 1 }));
}

export function getWorkoutsForWeek(weekId: string): Workout[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>('SELECT * FROM workout WHERE week_id = ? ORDER BY date', weekId);
  return rows.map(r => ({
    ...r,
    intervals: r.intervals_json ? JSON.parse(r.intervals_json) : undefined,
  }));
}

export function getWorkoutByDate(date: string): Workout | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>('SELECT * FROM workout WHERE date = ?', date);
  if (!row) return null;
  return {
    ...row,
    intervals: row.intervals_json ? JSON.parse(row.intervals_json) : undefined,
  };
}

export function getAllWorkoutsForPlan(planId: string): Workout[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    `SELECT w.* FROM workout w
     JOIN training_week tw ON w.week_id = tw.id
     WHERE tw.plan_id = ?
     ORDER BY w.date`,
    planId
  );
  return rows.map(r => ({
    ...r,
    intervals: r.intervals_json ? JSON.parse(r.intervals_json) : undefined,
  }));
}

export function updateWorkoutStatus(workoutId: string, status: 'completed' | 'skipped'): void {
  const database = getDatabase();
  const now = new Date().toISOString();
  database.runSync('UPDATE workout SET status = ?, updated_at = ? WHERE id = ?', status, now, workoutId);
}

export function updateWorkout(workoutId: string, changes: Partial<Workout>): void {
  const database = getDatabase();
  const now = new Date().toISOString();
  const setClauses: string[] = [];
  const values: any[] = [];

  if (changes.distance_miles !== undefined) { setClauses.push('distance_miles = ?'); values.push(changes.distance_miles); }
  if (changes.workout_type !== undefined) { setClauses.push('workout_type = ?'); values.push(changes.workout_type); }
  if (changes.target_pace_zone !== undefined) { setClauses.push('target_pace_zone = ?'); values.push(changes.target_pace_zone); }
  if (changes.status !== undefined) { setClauses.push('status = ?'); values.push(changes.status); }
  if (changes.notes !== undefined) { setClauses.push('notes = ?'); values.push(changes.notes); }
  if (changes.intervals_json !== undefined) { setClauses.push('intervals_json = ?'); values.push(changes.intervals_json); }
  if (changes.original_distance_miles !== undefined) { setClauses.push('original_distance_miles = ?'); values.push(changes.original_distance_miles); }
  if (changes.adjustment_reason !== undefined) { setClauses.push('adjustment_reason = ?'); values.push(changes.adjustment_reason); }

  setClauses.push('updated_at = ?');
  values.push(now);
  values.push(workoutId);

  database.runSync(`UPDATE workout SET ${setClauses.join(', ')} WHERE id = ?`, ...values);
}

// Performance Metrics
export function savePerformanceMetric(metric: PerformanceMetric): void {
  const database = getDatabase();
  database.runSync(
    'INSERT OR REPLACE INTO performance_metric (id, workout_id, date, source, distance_miles, duration_seconds, avg_pace_per_mile, avg_hr, max_hr, calories, route_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    metric.id, metric.workout_id || null, metric.date, metric.source, metric.distance_miles, metric.duration_seconds, metric.avg_pace_per_mile, metric.avg_hr || null, metric.max_hr || null, metric.calories || null, metric.route_json || null, metric.synced_at
  );
}

export function getRecentMetrics(days: number = 7): PerformanceMetric[] {
  const database = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE date >= ? ORDER BY date DESC',
    cutoff.toISOString().split('T')[0]
  );
}

export function getMetricsForWorkout(workoutId: string): PerformanceMetric[] {
  const database = getDatabase();
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE workout_id = ?',
    workoutId
  );
}

export function getMetricById(metricId: string): PerformanceMetric | null {
  const database = getDatabase();
  return database.getFirstSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE id = ?',
    metricId
  );
}

// Coach Messages
export function saveCoachMessage(message: CoachMessage): void {
  const database = getDatabase();
  database.runSync(
    'INSERT INTO coach_message (id, role, content, structured_action_json, action_applied, created_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    message.id, message.role, message.content, message.structured_action_json || null, message.action_applied ? 1 : 0, message.created_at, message.conversation_id
  );
}

export function getCoachMessages(conversationId: string, limit: number = 50): CoachMessage[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    'SELECT * FROM coach_message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?',
    conversationId, limit
  );
  return rows.map(r => ({ ...r, action_applied: r.action_applied === 1 }));
}

export function getLatestConversationId(): string | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>('SELECT conversation_id FROM coach_message ORDER BY created_at DESC LIMIT 1');
  return row?.conversation_id || null;
}

// Utility
export function getCurrentWeek(planId: string): TrainingWeek | null {
  const database = getDatabase();
  const today = getToday();
  return database.getFirstSync<any>(
    'SELECT * FROM training_week WHERE plan_id = ? AND start_date <= ? AND end_date >= ?',
    planId, today, today
  ) as TrainingWeek | null;
}

export function getWeeklyVolumeTrend(planId: string, numWeeks: number = 4): { week: number; target: number; actual: number }[] {
  const database = getDatabase();
  const today = getToday();
  const rows = database.getAllSync<any>(
    `SELECT week_number, target_volume_miles, actual_volume_miles
     FROM training_week
     WHERE plan_id = ? AND end_date <= ?
     ORDER BY week_number DESC LIMIT ?`,
    planId, today, numWeeks
  );
  return rows.map(r => ({ week: r.week_number, target: r.target_volume_miles, actual: r.actual_volume_miles })).reverse();
}

// ─── Adaptive Log ───────────────────────────────────────────

export function saveAdaptiveLog(log: AdaptiveLog): void {
  const database = getDatabase();
  database.runSync(
    'INSERT INTO adaptive_log (id, timestamp, type, summary, adjustments_json, metadata_json, acknowledged) VALUES (?, ?, ?, ?, ?, ?, ?)',
    log.id, log.timestamp, log.type, log.summary, JSON.stringify(log.adjustments), JSON.stringify(log.metadata), 0
  );
}

export function getRecentAdaptiveLogs(days: number = 7): AdaptiveLog[] {
  const database = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = database.getAllSync<any>(
    'SELECT * FROM adaptive_log WHERE timestamp >= ? ORDER BY timestamp DESC',
    cutoff.toISOString()
  );
  return rows.map(r => ({
    ...r,
    adjustments: JSON.parse(r.adjustments_json || '[]'),
    metadata: JSON.parse(r.metadata_json || '{}'),
  }));
}

export function getUnacknowledgedAdaptiveLogs(): AdaptiveLog[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    'SELECT * FROM adaptive_log WHERE acknowledged = 0 ORDER BY timestamp DESC'
  );
  return rows.map(r => ({
    ...r,
    adjustments: JSON.parse(r.adjustments_json || '[]'),
    metadata: JSON.parse(r.metadata_json || '{}'),
  }));
}

export function acknowledgeAdaptiveLog(logId: string): void {
  const database = getDatabase();
  database.runSync('UPDATE adaptive_log SET acknowledged = 1 WHERE id = ?', logId);
}

// ─── Extended Queries for Adaptive Engine ───────────────────

export function getMetricsForDateRange(startDate: string, endDate: string): PerformanceMetric[] {
  const database = getDatabase();
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE date >= ? AND date <= ? ORDER BY date DESC',
    startDate, endDate
  );
}

export function getStravaDetailsForMetrics(metricIds: string[]): Record<string, any> {
  const db = getDatabase();
  const details: Record<string, any> = {};
  for (const id of metricIds) {
    const row = db.getFirstSync<any>(
      'SELECT * FROM strava_activity_detail WHERE performance_metric_id = ?',
      id
    );
    if (row) details[id] = row;
  }
  return details;
}

export function getCompletedWorkoutsForDateRange(startDate: string, endDate: string): Workout[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    `SELECT * FROM workout WHERE date >= ? AND date <= ? AND status = 'completed' ORDER BY date DESC`,
    startDate, endDate
  );
  return rows.map(r => ({
    ...r,
    intervals: r.intervals_json ? JSON.parse(r.intervals_json) : undefined,
  }));
}

export function getFutureWorkouts(fromDate: string): Workout[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    `SELECT * FROM workout WHERE date >= ? AND status = 'scheduled' ORDER BY date ASC`,
    fromDate
  );
  return rows.map(r => ({
    ...r,
    intervals: r.intervals_json ? JSON.parse(r.intervals_json) : undefined,
  }));
}

// ─── Strava Detail ──────────────────────────────────────────

export function getStravaDetailForMetric(metricId: string): any | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>(
    'SELECT * FROM strava_activity_detail WHERE performance_metric_id = ?',
    metricId
  );
  if (!row) return null;
  return parseStravaDetailRow(row);
}

export function getStravaDetailForWorkout(workoutId: string): any | null {
  const database = getDatabase();
  // Join through performance_metric to find the Strava detail for a workout
  const row = database.getFirstSync<any>(
    `SELECT sad.* FROM strava_activity_detail sad
     INNER JOIN performance_metric pm ON pm.id = sad.performance_metric_id
     WHERE pm.workout_id = ?`,
    workoutId
  );
  if (!row) return null;
  return parseStravaDetailRow(row);
}

function parseStravaDetailRow(row: any): any {
  return {
    ...row,
    splits: row.splits_json ? JSON.parse(row.splits_json) : [],
    laps: row.laps_json ? JSON.parse(row.laps_json) : [],
    hrStream: row.hr_stream_json ? JSON.parse(row.hr_stream_json) : null,
    paceStream: row.pace_stream_json ? JSON.parse(row.pace_stream_json) : null,
    distanceStream: row.distance_stream_json ? JSON.parse(row.distance_stream_json) : null,
    elevationStream: row.elevation_stream_json ? JSON.parse(row.elevation_stream_json) : null,
    polylineEncoded: row.polyline_encoded ?? null,
    summaryPolylineEncoded: row.summary_polyline_encoded ?? null,
  };
}

// ─── Health Snapshot ─────────────────────────────────────────

export function getHealthSnapshot(date: string): HealthSnapshot | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>(
    'SELECT * FROM health_snapshot WHERE date = ?', date
  );
  if (!row) return null;
  return {
    ...row,
    hrv_trend_7d: row.hrv_trend_7d_json ? JSON.parse(row.hrv_trend_7d_json) : null,
  };
}

export function isHealthSnapshotFresh(date: string, maxAgeMs: number = 2 * 60 * 60 * 1000): boolean {
  const snapshot = getHealthSnapshot(date);
  if (!snapshot) return false;
  const age = Date.now() - new Date(snapshot.cached_at).getTime();
  return age < maxAgeMs;
}

// ─── Replan Helpers ──────────────────────────────────────────

/**
 * Deletes only future scheduled workouts and orphaned weeks.
 * Preserves completed/skipped workout history.
 */
export function deleteScheduledFutureWorkouts(): void {
  const database = getDatabase();
  database.withTransactionSync(() => {
    // NULL out workout_id in performance_metric for scheduled workouts about to be deleted
    database.execSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (
         SELECT w.id FROM workout w
         WHERE w.status = 'scheduled'
       )`
    );
    // Delete scheduled workouts
    database.execSync(`DELETE FROM workout WHERE status = 'scheduled'`);
    // Delete weeks that no longer have any workouts
    database.execSync(
      `DELETE FROM training_week
       WHERE id NOT IN (SELECT DISTINCT week_id FROM workout WHERE week_id IS NOT NULL)`
    );
    // Delete training plan
    database.execSync('DELETE FROM training_plan');
    // Clear caches
    database.execSync('DELETE FROM ai_briefing_cache');
  });
}

/**
 * Returns average weekly mileage over the last N weeks based on actual performance metrics.
 */
export function getRecentActualMileage(weeks: number = 2): number {
  const database = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - weeks * 7);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const rows = database.getAllSync<{ total: number }>(
    `SELECT SUM(distance_miles) as total
     FROM performance_metric
     WHERE date >= ?
       AND source IN ('strava', 'healthkit', 'manual')
     GROUP BY strftime('%Y-%W', date)
     ORDER BY date DESC`,
    cutoffStr
  );
  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  return Math.round((total / rows.length) * 10) / 10;
}

/**
 * Returns completion rate per week for the last N weeks.
 */
export function getWeeklyCompletionHistory(limit: number = 8): { week: number; rate: number }[] {
  const database = getDatabase();
  const rows = database.getAllSync<{ week_number: number; total: number; completed: number }>(
    `SELECT tw.week_number,
            COUNT(w.id) as total,
            SUM(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM training_week tw
     JOIN workout w ON w.week_id = tw.id
     WHERE w.workout_type != 'rest'
     GROUP BY tw.week_number
     ORDER BY tw.week_number DESC
     LIMIT ?`,
    limit
  );
  return rows.map(r => ({
    week: r.week_number,
    rate: r.total > 0 ? r.completed / r.total : 0,
  })).reverse();
}

export function saveHealthSnapshot(snapshot: HealthSnapshot): void {
  const database = getDatabase();
  database.runSync(
    `INSERT OR REPLACE INTO health_snapshot
     (id, date, resting_hr, hrv_sdnn, hrv_trend_7d_json, sleep_hours, sleep_quality, weight_lbs, steps, recovery_score, signal_count, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshot.id,
    snapshot.date,
    snapshot.resting_hr,
    snapshot.hrv_sdnn,
    snapshot.hrv_trend_7d ? JSON.stringify(snapshot.hrv_trend_7d) : null,
    snapshot.sleep_hours,
    snapshot.sleep_quality,
    snapshot.weight_lbs,
    snapshot.steps,
    snapshot.recovery_score,
    snapshot.signal_count,
    snapshot.cached_at
  );
}
