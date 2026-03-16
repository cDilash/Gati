/**
 * Marathon Coach v2 — Database Layer
 *
 * Single SQLite database with synchronous reads, async writes.
 * PRAGMA user_version tracks schema migrations.
 */

import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { ALL_TABLES } from './schema';
import {
  UserProfile,
  TrainingPlan,
  TrainingWeek,
  Workout,
  PerformanceMetric,
  CoachMessage,
  AIGeneratedPlan,
  AIWeek,
  AIWorkout,
  Shoe,
} from '../types';
import { getToday } from '../utils/dateUtils';

const DB_NAME = 'marathon_coach.db';
const SCHEMA_VERSION = 2;

let db: SQLite.SQLiteDatabase | null = null;

// ─── Database Lifecycle ─────────────────────────────────────

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

  // Check if we need a v1→v2 migration
  const currentVersion = (database.getFirstSync<{ user_version: number }>('PRAGMA user_version') as any)?.user_version ?? 0;
  if (currentVersion < SCHEMA_VERSION) {
    console.log(`[DB] Schema upgrade needed: v${currentVersion} → v${SCHEMA_VERSION}`);

    // Check each critical table for v1 columns that are incompatible with v2
    const tablesToCheck: [string, string][] = [
      ['workout', 'scheduled_date'],          // v1 had 'date', v2 has 'scheduled_date'
      ['performance_metric', 'strava_activity_id'],  // v1 didn't have this column
      ['performance_metric', 'duration_minutes'],    // v1 had 'duration_seconds'
    ];

    let needsDrop = false;
    for (const [table, requiredCol] of tablesToCheck) {
      const exists = database.getFirstSync<any>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      );
      if (exists) {
        const cols = database.getAllSync<any>(`PRAGMA table_info(${table})`);
        const hasCol = cols.some((c: any) => c.name === requiredCol);
        if (!hasCol) {
          console.log(`[DB] Table '${table}' missing column '${requiredCol}' — will drop and recreate`);
          needsDrop = true;
        }
      }
    }

    if (needsDrop) {
      console.log('[DB] Dropping incompatible v1 tables for v2 rebuild');
      const tablesToDrop = [
        'coaching_plan', 'coaching_context', 'ai_briefing_cache', 'health_snapshot',
        'adaptive_log', 'coach_message', 'performance_metric', 'workout',
        'training_week', 'training_plan', 'user_profile', 'strava_activity_detail',
        'shoes', 'ai_cache',
      ];
      for (const table of tablesToDrop) {
        try { database.execSync(`DROP TABLE IF EXISTS ${table}`); } catch {}
      }
      // Reset Strava sync so it re-fetches with v2 code
      try { database.runSync("UPDATE strava_tokens SET last_sync_at = NULL WHERE id = 1"); } catch {}
    }
  }

  // Create all tables (IF NOT EXISTS — safe to run after drop or on fresh install)
  database.withTransactionSync(() => {
    for (const sql of ALL_TABLES) {
      database.execSync(sql);
    }
  });

  if (currentVersion < SCHEMA_VERSION) {
    database.execSync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  // Add new columns if they don't exist (safe to re-run)
  const newColumns = [
    { table: 'strava_activity_detail', column: 'cadence_stream_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'time_stream_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'segment_efforts_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'timezone', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'utc_offset', type: 'INTEGER' },
  ];
  for (const { table, column, type } of newColumns) {
    try { database.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch {}
  }

  // Repair: if metrics exist but strava_activity_detail is empty,
  // the data is from the old v1 sync — wipe and force clean re-sync
  try {
    const metricCount = (database.getFirstSync('SELECT COUNT(*) as cnt FROM performance_metric') as any)?.cnt ?? 0;
    const detailCount = (database.getFirstSync('SELECT COUNT(*) as cnt FROM strava_activity_detail') as any)?.cnt ?? 0;

    if (metricCount > 0 && detailCount === 0) {
      console.log(`[DB] ${metricCount} metrics but 0 strava details — wiping for clean re-sync`);
      database.execSync('DELETE FROM performance_metric');
      try { database.runSync("UPDATE strava_tokens SET last_sync_at = NULL WHERE id = 1"); } catch {}
    }
  } catch (e) {
    console.warn('[DB] Repair check failed:', e);
  }
}

// ─── User Profile ───────────────────────────────────────────

export function getUserProfile(): UserProfile | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>('SELECT * FROM user_profile WHERE id = 1');
  if (!row) return null;
  return {
    ...row,
    injury_history: safeParseJSON(row.injury_history, []),
    known_weaknesses: safeParseJSON(row.known_weaknesses, []),
    available_days: safeParseJSON(row.available_days, [1, 2, 3, 4, 5, 6]),
  };
}

export function saveUserProfile(profile: Omit<UserProfile, 'id' | 'updated_at'>): void {
  const database = getDatabase();
  database.runSync(
    `INSERT OR REPLACE INTO user_profile
     (id, name, age, gender, weight_kg, vdot_score, max_hr, rest_hr,
      current_weekly_miles, longest_recent_run, experience_level,
      race_date, race_name, race_course_profile, race_goal_type,
      target_finish_time_sec, injury_history, known_weaknesses,
      scheduling_notes, available_days, long_run_day, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    profile.name ?? null,
    profile.age,
    profile.gender,
    profile.weight_kg ?? null,
    profile.vdot_score,
    profile.max_hr ?? null,
    profile.rest_hr ?? null,
    profile.current_weekly_miles,
    profile.longest_recent_run,
    profile.experience_level,
    profile.race_date,
    profile.race_name ?? null,
    profile.race_course_profile ?? 'unknown',
    profile.race_goal_type ?? 'finish',
    profile.target_finish_time_sec ?? null,
    JSON.stringify(profile.injury_history ?? []),
    JSON.stringify(profile.known_weaknesses ?? []),
    profile.scheduling_notes ?? null,
    JSON.stringify(profile.available_days),
    profile.long_run_day,
  );
}

// ─── Training Plan ──────────────────────────────────────────

export function getActivePlan(): TrainingPlan | null {
  const database = getDatabase();
  return database.getFirstSync<TrainingPlan>(
    "SELECT * FROM training_plan WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
  );
}

export function savePlan(
  plan: AIGeneratedPlan,
  vdot: number,
  startDate: string,
): { planId: string; weekCount: number; workoutCount: number } {
  const database = getDatabase();
  const planId = Crypto.randomUUID();
  const today = startDate;

  let weekCount = 0;
  let workoutCount = 0;

  database.withTransactionSync(() => {
    // Deactivate any existing active plan
    database.runSync("UPDATE training_plan SET status = 'abandoned', updated_at = datetime('now') WHERE status = 'active'");

    // Save the plan
    database.runSync(
      `INSERT INTO training_plan (id, plan_json, coaching_notes, key_principles, warnings, vdot_at_generation, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      planId,
      JSON.stringify(plan),
      plan.coachingNotes ?? null,
      JSON.stringify(plan.keyPrinciples ?? []),
      JSON.stringify(plan.warnings ?? []),
      vdot,
    );

    // Extract weeks and workouts
    for (const week of plan.weeks) {
      const weekId = Crypto.randomUUID();
      database.runSync(
        `INSERT INTO training_week (id, plan_id, week_number, phase, target_volume, is_cutback, ai_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        weekId,
        planId,
        week.weekNumber,
        week.phase,
        week.targetVolume,
        week.isCutback ? 1 : 0,
        week.aiNotes ?? null,
      );
      weekCount++;

      // Calculate the Monday of this week
      const weekStart = addDaysToDate(today, (week.weekNumber - 1) * 7);

      for (const workout of week.workouts) {
        const workoutId = Crypto.randomUUID();
        const scheduledDate = addDaysToDate(weekStart, workout.dayOfWeek);

        database.runSync(
          `INSERT INTO workout
           (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
            description, target_distance_miles, target_pace_zone, intervals_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
          workoutId,
          planId,
          week.weekNumber,
          workout.dayOfWeek,
          scheduledDate,
          workout.type,
          workout.title,
          workout.description,
          workout.distanceMiles ?? null,
          workout.paceZone ?? null,
          workout.intervals ? JSON.stringify(workout.intervals) : null,
        );
        workoutCount++;
      }
    }
  });

  return { planId, weekCount, workoutCount };
}

export function deleteActivePlan(): void {
  const database = getDatabase();
  database.withTransactionSync(() => {
    // Unlink metrics but preserve them
    database.execSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (SELECT id FROM workout WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active'))`
    );
    database.execSync("DELETE FROM workout WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')");
    database.execSync("DELETE FROM training_week WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')");
    database.execSync("DELETE FROM training_plan WHERE status = 'active'");
  });
}

// ─── Workouts ───────────────────────────────────────────────

export function getWorkoutsByDate(date: string): Workout[] {
  const database = getDatabase();
  return database.getAllSync<Workout>(
    `SELECT * FROM workout WHERE scheduled_date = ? AND plan_id IN (SELECT id FROM training_plan WHERE status = 'active') ORDER BY day_of_week`,
    date,
  );
}

export function getTodaysWorkout(): Workout | null {
  const workouts = getWorkoutsByDate(getToday());
  return workouts.find(w => w.workout_type !== 'rest') ?? workouts[0] ?? null;
}

export function getWorkoutsForWeek(planId: string, weekNumber: number): Workout[] {
  const database = getDatabase();
  return database.getAllSync<Workout>(
    'SELECT * FROM workout WHERE plan_id = ? AND week_number = ? ORDER BY scheduled_date',
    planId,
    weekNumber,
  );
}

export function getAllWorkouts(planId: string): Workout[] {
  const database = getDatabase();
  return database.getAllSync<Workout>(
    'SELECT * FROM workout WHERE plan_id = ? ORDER BY scheduled_date',
    planId,
  );
}

export function updateWorkoutStatus(workoutId: string, status: 'completed' | 'skipped', stravaActivityId?: number): void {
  const database = getDatabase();
  if (stravaActivityId) {
    database.runSync(
      'UPDATE workout SET status = ?, strava_activity_id = ? WHERE id = ?',
      status,
      stravaActivityId,
      workoutId,
    );
  } else {
    database.runSync('UPDATE workout SET status = ? WHERE id = ?', status, workoutId);
  }
}

export function modifyWorkout(workoutId: string, changes: Partial<Workout>, reason: string): void {
  const database = getDatabase();
  // Save original distance before modification
  const current = database.getFirstSync<Workout>('SELECT * FROM workout WHERE id = ?', workoutId);
  if (!current) return;

  const fields: string[] = [];
  const values: any[] = [];

  if (changes.target_distance_miles !== undefined) {
    fields.push('target_distance_miles = ?');
    values.push(changes.target_distance_miles);
    if (!current.original_distance_miles) {
      fields.push('original_distance_miles = ?');
      values.push(current.target_distance_miles);
    }
  }
  if (changes.workout_type !== undefined) {
    fields.push('workout_type = ?');
    values.push(changes.workout_type);
  }
  if (changes.title !== undefined) {
    fields.push('title = ?');
    values.push(changes.title);
  }
  if (changes.description !== undefined) {
    fields.push('description = ?');
    values.push(changes.description);
  }

  fields.push('modification_reason = ?');
  values.push(reason);
  fields.push("status = 'modified'");

  values.push(workoutId);
  database.runSync(`UPDATE workout SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

// ─── Training Weeks ─────────────────────────────────────────

export function getWeeksForPlan(planId: string): TrainingWeek[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    'SELECT * FROM training_week WHERE plan_id = ? ORDER BY week_number',
    planId,
  );
  return rows.map(r => ({ ...r, is_cutback: !!r.is_cutback }));
}

export function getCurrentWeek(planId: string): TrainingWeek | null {
  const database = getDatabase();
  const today = getToday();
  // Find the week that contains today based on workout dates
  const row = database.getFirstSync<any>(
    `SELECT tw.* FROM training_week tw
     JOIN workout w ON w.plan_id = tw.plan_id AND w.week_number = tw.week_number
     WHERE tw.plan_id = ? AND w.scheduled_date <= ?
     GROUP BY tw.id
     ORDER BY tw.week_number DESC LIMIT 1`,
    planId,
    today,
  );
  if (!row) return null;
  return { ...row, is_cutback: !!row.is_cutback };
}

export function updateWeekActualVolume(planId: string, weekNumber: number, volume: number): void {
  const database = getDatabase();
  database.runSync(
    'UPDATE training_week SET actual_volume = ? WHERE plan_id = ? AND week_number = ?',
    volume,
    planId,
    weekNumber,
  );
}

// ─── Performance Metrics ────────────────────────────────────

export function savePerformanceMetric(metric: Omit<PerformanceMetric, 'created_at'>): void {
  const database = getDatabase();
  database.runSync(
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

export function getMetricsForDateRange(startDate: string, endDate: string): PerformanceMetric[] {
  const database = getDatabase();
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE date >= ? AND date <= ? ORDER BY date DESC',
    startDate,
    endDate,
  );
}

export function getMetricsForWorkout(workoutId: string): PerformanceMetric[] {
  const database = getDatabase();
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE workout_id = ?',
    workoutId,
  );
}

export function getRecentMetrics(days: number): PerformanceMetric[] {
  const database = getDatabase();
  const since = addDaysToDate(getToday(), -days);
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric WHERE date >= ? ORDER BY date DESC',
    since,
  );
}

export function getAllMetrics(limit: number = 100): PerformanceMetric[] {
  const database = getDatabase();
  return database.getAllSync<PerformanceMetric>(
    'SELECT * FROM performance_metric ORDER BY date DESC LIMIT ?',
    limit,
  );
}

export function getStravaDetailForMetric(metricId: string): any | null {
  const database = getDatabase();
  return database.getFirstSync<any>(
    'SELECT * FROM strava_activity_detail WHERE performance_metric_id = ?',
    metricId,
  );
}

export function getStravaDetailByActivityId(stravaActivityId: number): any | null {
  const database = getDatabase();
  return database.getFirstSync<any>(
    'SELECT * FROM strava_activity_detail WHERE strava_activity_id = ?',
    stravaActivityId,
  );
}

// ─── Coach Messages ─────────────────────────────────────────

export function saveCoachMessage(message: Omit<CoachMessage, 'created_at'>): void {
  const database = getDatabase();
  database.runSync(
    `INSERT INTO coach_message (id, role, content, message_type, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    message.id,
    message.role,
    message.content,
    message.message_type,
    message.metadata_json ?? null,
  );
}

export function getCoachMessages(limit: number = 50): CoachMessage[] {
  const database = getDatabase();
  return database.getAllSync<CoachMessage>(
    'SELECT * FROM coach_message ORDER BY created_at ASC LIMIT ?',
    limit,
  );
}

export function clearCoachMessages(): void {
  const database = getDatabase();
  database.execSync('DELETE FROM coach_message');
}

// ─── AI Cache ───────────────────────────────────────────────

export function getCachedAIContent(cacheType: string, cacheKey: string): string | null {
  const database = getDatabase();
  const row = database.getFirstSync<{ content: string }>(
    'SELECT content FROM ai_cache WHERE cache_type = ? AND cache_key = ?',
    cacheType,
    cacheKey,
  );
  return row?.content ?? null;
}

export function setCachedAIContent(cacheType: string, cacheKey: string, content: string): void {
  const database = getDatabase();
  database.runSync(
    `INSERT OR REPLACE INTO ai_cache (id, cache_type, cache_key, content)
     VALUES (?, ?, ?, ?)`,
    Crypto.randomUUID(),
    cacheType,
    cacheKey,
    content,
  );
}

export function clearAICache(): void {
  const database = getDatabase();
  database.execSync('DELETE FROM ai_cache');
}

// ─── App Settings ───────────────────────────────────────────

export function getSetting(key: string): string | null {
  const database = getDatabase();
  const row = database.getFirstSync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const database = getDatabase();
  database.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    key,
    value,
  );
}

// ─── Shoes ──────────────────────────────────────────────────

export function getShoes(): Shoe[] {
  const database = getDatabase();
  return database.getAllSync<any>('SELECT * FROM shoes WHERE retired = 0 ORDER BY name').map(r => ({
    id: r.id,
    stravaGearId: r.strava_gear_id,
    name: r.name,
    brand: r.brand,
    totalMiles: r.total_miles,
    maxMiles: r.max_miles,
    retired: !!r.retired,
  }));
}

// ─── Utilities ──────────────────────────────────────────────

function safeParseJSON<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function addDaysToDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
