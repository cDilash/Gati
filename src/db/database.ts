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
    { table: 'user_profile', column: 'height_cm', type: 'REAL' },
    { table: 'strava_activity_detail', column: 'cadence_stream_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'time_stream_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'segment_efforts_json', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'timezone', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'utc_offset', type: 'INTEGER' },
    { table: 'user_profile', column: 'weight_source', type: "TEXT DEFAULT 'manual'" },
    { table: 'user_profile', column: 'weight_updated_at', type: 'TEXT' },
    { table: 'health_snapshot', column: 'weight_kg', type: 'REAL' },
    { table: 'health_snapshot', column: 'vo2max', type: 'REAL' },
    { table: 'health_snapshot', column: 'respiratory_rate', type: 'REAL' },
    { table: 'health_snapshot', column: 'respiratory_rate_trend_json', type: 'TEXT' },
    { table: 'health_snapshot', column: 'spo2', type: 'REAL' },
    { table: 'health_snapshot', column: 'spo2_trend_json', type: 'TEXT' },
    { table: 'health_snapshot', column: 'steps', type: 'INTEGER' },
    { table: 'user_profile', column: 'max_hr_source', type: "TEXT DEFAULT 'formula'" },
    { table: 'user_profile', column: 'vdot_updated_at', type: 'TEXT' },
    { table: 'user_profile', column: 'vdot_source', type: "TEXT DEFAULT 'manual'" },
    { table: 'user_profile', column: 'vdot_confidence', type: "TEXT DEFAULT 'moderate'" },
    { table: 'workout', column: 'execution_quality', type: "TEXT DEFAULT 'on_target'" },
    { table: 'user_profile', column: 'does_strength_training', type: 'INTEGER DEFAULT 0' },
    { table: 'user_profile', column: 'leg_day_weekday', type: 'INTEGER' },
    { table: 'ai_cache', column: 'model_used', type: 'TEXT' },
    { table: 'user_profile', column: 'avatar_base64', type: 'TEXT' },
    { table: 'health_snapshot', column: 'steps_trend_json', type: 'TEXT' },
    { table: 'health_snapshot', column: 'weight_date', type: 'TEXT' },
    { table: 'user_profile', column: 'max_hr_updated_at', type: 'TEXT' },
    { table: 'user_profile', column: 'rest_hr_updated_at', type: 'TEXT' },
    { table: 'user_profile', column: 'weekly_mileage_updated_at', type: 'TEXT' },
    { table: 'user_profile', column: 'longest_run_updated_at', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'location_city', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'location_state', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'location_country', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'start_lat', type: 'REAL' },
    { table: 'strava_activity_detail', column: 'start_lng', type: 'REAL' },
    { table: 'strava_activity_detail', column: 'weather_temp_f', type: 'REAL' },
    { table: 'strava_activity_detail', column: 'weather_humidity', type: 'INTEGER' },
    { table: 'strava_activity_detail', column: 'weather_wind_mph', type: 'REAL' },
    { table: 'strava_activity_detail', column: 'weather_condition', type: 'TEXT' },
    { table: 'strava_activity_detail', column: 'weather_fetched', type: 'INTEGER DEFAULT 0' },
    { table: 'strava_activity_detail', column: 'geocoded', type: 'INTEGER DEFAULT 0' },
  ];
  for (const { table, column, type } of newColumns) {
    try { database.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch {}
  }

  // Set formula max HR if not yet set
  try {
    const profile = database.getFirstSync<any>('SELECT max_hr, age FROM user_profile WHERE id = 1');
    if (profile && !profile.max_hr && profile.age) {
      const formulaMaxHR = 220 - profile.age;
      database.runSync('UPDATE user_profile SET max_hr = ?, max_hr_source = ? WHERE id = 1', [formulaMaxHR, 'formula']);
      console.log(`[DB] Set formula max HR: 220 - ${profile.age} = ${formulaMaxHR}`);
    }
  } catch {}

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
     (id, name, age, gender, weight_kg, height_cm, vdot_score, max_hr, rest_hr,
      current_weekly_miles, longest_recent_run, experience_level,
      race_date, race_name, race_course_profile, race_goal_type,
      target_finish_time_sec, injury_history, known_weaknesses,
      scheduling_notes, available_days, long_run_day, weight_source, weight_updated_at,
      vdot_updated_at, vdot_source, vdot_confidence, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    profile.name ?? null,
    profile.age,
    profile.gender,
    profile.weight_kg ?? null,
    profile.height_cm ?? null,
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
    profile.weight_source ?? 'manual',
    profile.weight_updated_at ?? null,
    profile.vdot_updated_at ?? null,
    profile.vdot_source ?? 'manual',
    profile.vdot_confidence ?? 'moderate',
  );
}

export function updateWeight(weightKg: number): void {
  const database = getDatabase();
  database.runSync("UPDATE user_profile SET weight_kg = ?, updated_at = datetime('now') WHERE id = 1", weightKg);
}

export function updateHeight(heightCm: number): void {
  const database = getDatabase();
  database.runSync("UPDATE user_profile SET height_cm = ?, updated_at = datetime('now') WHERE id = 1", heightCm);
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
    // Deactivate any existing active plan and clean up its data
    database.runSync("UPDATE training_plan SET status = 'abandoned', updated_at = datetime('now') WHERE status = 'active'");

    // Unlink metrics from abandoned plan workouts (preserve metrics, just clear the FK)
    database.runSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (SELECT id FROM workout WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'abandoned'))`
    );
    // Delete workouts and weeks from abandoned plans (FK-safe: metrics unlinked above)
    database.runSync(`DELETE FROM workout WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'abandoned')`);
    database.runSync(`DELETE FROM training_week WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'abandoned')`);

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
        `INSERT OR REPLACE INTO training_week (id, plan_id, week_number, phase, target_volume, is_cutback, ai_notes)
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

      // Calculate the Monday of this week — ensure plan always starts on a Monday
      const planStartDay = new Date(today + 'T00:00:00').getDay(); // 0=Sun, 1=Mon...
      const mondayOffset = planStartDay === 0 ? 1 : planStartDay === 1 ? 0 : (8 - planStartDay); // days until next Monday
      const weekStart = addDaysToDate(today, mondayOffset + (week.weekNumber - 1) * 7);

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

/**
 * Apply an adaptation to the EXISTING active plan (in-place update).
 * Only replaces UPCOMING workouts — completed/skipped/partial are preserved.
 * Does NOT create a new plan row.
 */
export function applyAdaptation(
  adaptedPlan: AIGeneratedPlan,
  planId: string,
  startDate: string,
): { updatedWeeks: number; updatedWorkouts: number } {
  const database = getDatabase();
  let updatedWeeks = 0;
  let updatedWorkouts = 0;

  // Safety check: don't let workout count exceed 200
  const existing = database.getFirstSync<{ cnt: number }>('SELECT count(*) as cnt FROM workout WHERE plan_id = ?', planId);
  if (existing && existing.cnt > 200) {
    console.error(`[DB] SAFETY: ${existing.cnt} workouts for plan — running dedup first`);
    deduplicateWorkouts();
  }

  database.withTransactionSync(() => {
    // Update plan_json with the new adapted plan
    database.runSync(
      `UPDATE training_plan SET plan_json = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(adaptedPlan), planId,
    );

    for (const week of adaptedPlan.weeks) {
      // Upsert training_week (INSERT OR REPLACE works here — UNIQUE on plan_id, week_number)
      const existingWeek = database.getFirstSync<{ id: string }>(
        'SELECT id FROM training_week WHERE plan_id = ? AND week_number = ?', planId, week.weekNumber
      );
      const weekId = existingWeek?.id ?? Crypto.randomUUID();
      database.runSync(
        `INSERT OR REPLACE INTO training_week (id, plan_id, week_number, phase, target_volume, is_cutback, ai_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        weekId, planId, week.weekNumber, week.phase, week.targetVolume, week.isCutback ? 1 : 0, week.aiNotes ?? null,
      );
      updatedWeeks++;

      // Delete ONLY upcoming workouts for this week (preserve completed/skipped/partial)
      database.runSync(
        `DELETE FROM workout WHERE plan_id = ? AND week_number = ? AND status = 'upcoming'`,
        planId, week.weekNumber,
      );

      // Calculate week start date
      const weekStart = addDaysToDate(startDate, (week.weekNumber - 1) * 7);

      // Insert new workouts for this week
      for (const workout of week.workouts) {
        const scheduledDate = addDaysToDate(weekStart, workout.dayOfWeek);

        // Check if a non-upcoming workout already exists on this date (don't overwrite)
        const existingWorkout = database.getFirstSync<{ id: string }>(
          `SELECT id FROM workout WHERE plan_id = ? AND scheduled_date = ? AND status != 'upcoming'`,
          planId, scheduledDate,
        );
        if (existingWorkout) continue; // Skip — there's a completed/skipped workout on this date

        database.runSync(
          `INSERT INTO workout
           (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
            description, target_distance_miles, target_pace_zone, intervals_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
          Crypto.randomUUID(), planId, week.weekNumber, workout.dayOfWeek, scheduledDate,
          workout.type, workout.title, workout.description,
          workout.distanceMiles ?? null, workout.paceZone ?? null,
          workout.intervals ? JSON.stringify(workout.intervals) : null,
        );
        updatedWorkouts++;
      }
    }
  });

  // Recalculate volumes from real data
  recalculateWeeklyVolumes();

  console.log(`[DB] Adaptation applied in-place: ${updatedWeeks} weeks, ${updatedWorkouts} workouts updated`);
  return { updatedWeeks, updatedWorkouts };
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
  let workouts = database.getAllSync<Workout>(
    'SELECT * FROM workout WHERE plan_id = ? ORDER BY scheduled_date',
    planId,
  );

  if (workouts.length === 0) {
    console.log(`[DB] No workouts found for plan ${planId.substring(0,8)} — normal for fresh plan`);
  }

  // Fix: re-derive week numbers if they don't start on Monday (from v1 restore)
  if (workouts.length > 5) {
    // Check if week 1 starts on a non-Monday — sign of bad derivation
    const week1Workouts = workouts.filter(w => w.week_number === 1);
    const firstDow = week1Workouts.length > 0 ? new Date(week1Workouts[0].scheduled_date + 'T00:00:00').getDay() : 1;
    const needsReDerive = workouts.every(w => w.week_number === 1) || (firstDow !== 1 && firstDow !== 0); // not Mon or Sun
    const allWeek1 = needsReDerive;
    if (allWeek1) {
      console.log(`[DB] All ${workouts.length} workouts stuck in week 1 — re-deriving week numbers from dates`);
      // Find the Monday of the first workout's week as the true start
      const firstDate = new Date(workouts[0].scheduled_date + 'T00:00:00');
      const dow = firstDate.getDay(); // 0=Sun
      const mondayOffset = dow === 0 ? -6 : 1 - dow; // shift to Monday
      const monday = new Date(firstDate);
      monday.setDate(monday.getDate() + mondayOffset);
      const startMs = monday.getTime();
      for (const w of workouts) {
        const wMs = new Date(w.scheduled_date + 'T00:00:00').getTime();
        const weekNum = Math.floor((wMs - startMs) / (7 * 86400000)) + 1;
        database.runSync('UPDATE workout SET week_number = ? WHERE id = ?', weekNum, w.id);
        w.week_number = weekNum;
      }
      console.log(`[DB] Re-derived week numbers: weeks 1-${Math.max(...workouts.map(w => w.week_number))}`);
    }
  }

  return workouts;
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
  // Select newest N messages (DESC) then reverse to chronological order for display
  const messages = database.getAllSync<CoachMessage>(
    'SELECT * FROM coach_message ORDER BY created_at DESC LIMIT ?',
    limit,
  );
  return messages.reverse();
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

// ─── Cross-Training CRUD ─────────────────────────────────────

export function saveCrossTraining(entry: import('../types').CrossTraining): void {
  const database = getDatabase();
  database.runSync(
    `INSERT OR REPLACE INTO cross_training (id, date, type, impact, notes) VALUES (?, ?, ?, ?, ?)`,
    [entry.id, entry.date, entry.type, entry.impact, entry.notes ?? null]
  );
}

export function getCrossTrainingForDate(date: string): import('../types').CrossTraining | null {
  const database = getDatabase();
  const row = database.getFirstSync<any>(
    'SELECT * FROM cross_training WHERE date = ? ORDER BY created_at DESC',
    [date]
  );
  if (!row) return null;
  return { id: row.id, date: row.date, type: row.type, impact: row.impact, notes: row.notes, createdAt: row.created_at };
}

export function getCrossTrainingForWeek(weekStart: string, weekEnd: string): import('../types').CrossTraining[] {
  const database = getDatabase();
  const rows = database.getAllSync<any>(
    'SELECT * FROM cross_training WHERE date >= ? AND date <= ? ORDER BY date',
    [weekStart, weekEnd]
  );
  return rows.map((r: any) => ({ id: r.id, date: r.date, type: r.type, impact: r.impact, notes: r.notes, createdAt: r.created_at }));
}

export function getCrossTrainingHistory(daysBack: number): import('../types').CrossTraining[] {
  const database = getDatabase();
  const { getToday, addDays } = require('../utils/dateUtils');
  const cutoffStr = addDays(getToday(), -daysBack);
  const rows = database.getAllSync<any>(
    'SELECT * FROM cross_training WHERE date >= ? ORDER BY date DESC',
    [cutoffStr]
  );
  return rows.map((r: any) => ({ id: r.id, date: r.date, type: r.type, impact: r.impact, notes: r.notes, createdAt: r.created_at }));
}

export function deleteCrossTraining(id: string): void {
  const database = getDatabase();
  database.runSync('DELETE FROM cross_training WHERE id = ?', [id]);
}

// ─── Sweep & Volume ─────────────────────────────────────────

/**
 * Clean up plan data: ensure exactly ONE active plan, remove orphaned workouts
 * from abandoned plans, and deduplicate any remaining duplicate rows.
 */
export function deduplicateWorkouts(): number {
  const database = getDatabase();
  try {
    // Disable FK checks during cleanup to avoid constraint ordering issues
    database.execSync('PRAGMA foreign_keys = OFF');

    const totalBefore = (database.getFirstSync<any>('SELECT count(*) as cnt FROM workout'))?.cnt ?? 0;
    const weeksBefore = (database.getFirstSync<any>('SELECT count(*) as cnt FROM training_week'))?.cnt ?? 0;
    const plansBefore = (database.getFirstSync<any>('SELECT count(*) as cnt FROM training_plan'))?.cnt ?? 0;
    console.log(`[Dedup] BEFORE: ${totalBefore} workouts, ${weeksBefore} weeks, ${plansBefore} plans`);

    // Step 1: Find the ONE active plan to keep (most recent)
    const activePlan = database.getFirstSync<{ id: string }>(
      `SELECT id FROM training_plan WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (!activePlan) {
      console.log('[Dedup] No active plan — nothing to clean');
      database.execSync('PRAGMA foreign_keys = ON');
      return 0;
    }
    const keepPlanId = activePlan.id;
    console.log(`[Dedup] Keeping plan: ${keepPlanId.substring(0, 8)}`);

    // Step 2: Mark all other active plans as abandoned
    database.runSync(
      `UPDATE training_plan SET status = 'abandoned' WHERE status = 'active' AND id != ?`, [keepPlanId]
    );

    // Step 3: Unlink metrics from workouts we're about to delete (preserve metrics)
    database.runSync(
      `UPDATE performance_metric SET workout_id = NULL
       WHERE workout_id IN (SELECT id FROM workout WHERE plan_id != ?)`,
      [keepPlanId]
    );

    // Step 4: DELETE WORKOUTS from non-active plans (FK-safe: metrics unlinked)
    database.runSync(`DELETE FROM workout WHERE plan_id != ?`, [keepPlanId]);

    // Step 4: DELETE TRAINING_WEEKS from non-active plans SECOND
    database.runSync(`DELETE FROM training_week WHERE plan_id != ?`, [keepPlanId]);

    // Step 5: DELETE abandoned plan rows THIRD
    database.runSync(`DELETE FROM training_plan WHERE id != ?`, [keepPlanId]);

    // Step 6: DEDUP workouts within active plan — brute force, one per date
    const allWorkouts = database.getAllSync<{ rowid: number; id: string; scheduled_date: string; status: string }>(
      `SELECT rowid, id, scheduled_date, status FROM workout WHERE plan_id = ? ORDER BY scheduled_date, rowid`,
      [keepPlanId]
    );

    const keeperIds = new Set<string>();
    const byDate = new Map<string, typeof allWorkouts>();
    for (const w of allWorkouts) {
      if (!byDate.has(w.scheduled_date)) byDate.set(w.scheduled_date, []);
      byDate.get(w.scheduled_date)!.push(w);
    }

    for (const [, rows] of byDate) {
      // Sort: completed=1, partial=2, skipped=3, upcoming=4, then lowest rowid
      rows.sort((a, b) => {
        const pri: Record<string, number> = { completed: 1, partial: 2, skipped: 3 };
        const pa = pri[a.status] ?? 4;
        const pb = pri[b.status] ?? 4;
        return pa !== pb ? pa - pb : a.rowid - b.rowid;
      });
      keeperIds.add(rows[0].id);
    }

    const deleteIds = allWorkouts.map(w => w.id).filter(id => !keeperIds.has(id));
    for (const id of deleteIds) {
      // Unlink any metrics pointing to this workout before deleting (FK safety)
      database.runSync('UPDATE performance_metric SET workout_id = NULL WHERE workout_id = ?', [id]);
      database.runSync('DELETE FROM workout WHERE id = ?', [id]);
    }

    // Step 7: DEDUP training_weeks — one per week_number
    const allWeeks = database.getAllSync<{ rowid: number; id: string; week_number: number }>(
      `SELECT rowid, id, week_number FROM training_week WHERE plan_id = ? ORDER BY week_number, rowid`,
      [keepPlanId]
    );
    const seenWeeks = new Set<number>();
    for (const w of allWeeks) {
      if (seenWeeks.has(w.week_number)) {
        database.runSync('DELETE FROM training_week WHERE id = ?', [w.id]);
      } else {
        seenWeeks.add(w.week_number);
      }
    }

    // Re-enable FK checks
    database.execSync('PRAGMA foreign_keys = ON');

    // Step 8: Rematch orphaned performance_metrics to current workouts
    // (metrics may point to workout IDs from deleted plans)
    const orphanedMetrics = database.getAllSync<{ id: string; date: string; workout_id: string | null }>(
      `SELECT id, date, workout_id FROM performance_metric
       WHERE workout_id IS NULL
          OR workout_id NOT IN (SELECT id FROM workout)`
    );
    if (orphanedMetrics.length > 0) {
      console.log(`[Dedup] Rematching ${orphanedMetrics.length} orphaned metrics`);
      for (const m of orphanedMetrics) {
        const match = database.getFirstSync<{ id: string }>(
          `SELECT id FROM workout WHERE plan_id = ? AND scheduled_date = ? LIMIT 1`,
          [keepPlanId, m.date]
        );
        if (match) {
          database.runSync('UPDATE performance_metric SET workout_id = ? WHERE id = ?', [match.id, m.id]);
          database.runSync(
            `UPDATE workout SET status = 'completed' WHERE id = ? AND status = 'upcoming'`,
            [match.id]
          );
        }
      }
      console.log(`[Dedup] Rematched ${orphanedMetrics.length} metrics`);
    }

    // Step 9: Sweep past upcoming workouts as skipped
    const { getToday } = require('../utils/dateUtils');
    const today = getToday();
    database.runSync(
      `UPDATE workout SET status = 'skipped'
       WHERE plan_id = ? AND scheduled_date < ? AND status = 'upcoming'
       AND workout_type != 'rest'
       AND id NOT IN (SELECT workout_id FROM performance_metric WHERE workout_id IS NOT NULL)`,
      [keepPlanId, today]
    );
    // Mark past rest days as completed
    database.runSync(
      `UPDATE workout SET status = 'completed'
       WHERE plan_id = ? AND scheduled_date < ? AND status = 'upcoming' AND workout_type = 'rest'`,
      [keepPlanId, today]
    );

    // Step 10: Recalculate volumes
    recalculateWeeklyVolumes();

    // Print final state
    const totalAfter = (database.getFirstSync<any>('SELECT count(*) as cnt FROM workout'))?.cnt ?? 0;
    const weeksAfter = (database.getFirstSync<any>('SELECT count(*) as cnt FROM training_week'))?.cnt ?? 0;
    const plansAfter = (database.getFirstSync<any>('SELECT count(*) as cnt FROM training_plan'))?.cnt ?? 0;
    const dupsAfter = (database.getFirstSync<any>(
      `SELECT count(*) as cnt FROM (SELECT scheduled_date FROM workout GROUP BY scheduled_date HAVING count(*) > 1)`
    ))?.cnt ?? 0;

    console.log(`[Dedup] AFTER: ${totalAfter} workouts, ${weeksAfter} weeks, ${plansAfter} plans, ${dupsAfter} duplicate dates`);
    console.log(`[Dedup] Removed: ${totalBefore - totalAfter} workouts, ${weeksBefore - weeksAfter} weeks, ${plansBefore - plansAfter} plans`);

    return totalBefore - totalAfter;
  } catch (e: any) {
    console.error('[Dedup] FAILED:', e?.message ?? e);
    try { database.execSync('PRAGMA foreign_keys = ON'); } catch {}
    return 0;
  }
}

export function sweepPastWorkouts(): { skipped: number; lateMatched: number } {
  const database = getDatabase();
  let skipped = 0;
  let lateMatched = 0;

  // Never sweep today's workouts — only yesterday and older
  const { getToday, addDays } = require('../utils/dateUtils');
  const cutoffDate = addDays(getToday(), -1); // yesterday

  // Helper: find an unmatched metric for a workout date (±1 day for timezone tolerance)
  function findMetricForDate(scheduledDate: string): any {
    // Exact date match first
    const exact = database.getFirstSync<any>(
      `SELECT id FROM performance_metric WHERE date = ? AND workout_id IS NULL`,
      [scheduledDate]
    );
    if (exact) return exact;

    // ±1 day tolerance (Strava UTC vs local date mismatch)
    const { addDays: ad } = require('../utils/dateUtils');
    const dayBefore = ad(scheduledDate, -1);
    const dayAfter = ad(scheduledDate, 1);
    return database.getFirstSync<any>(
      `SELECT id FROM performance_metric WHERE date IN (?, ?) AND workout_id IS NULL`,
      [dayBefore, dayAfter]
    );
  }

  // Step 1: Re-check SKIPPED workouts — Strava may have synced late
  const pastSkipped = database.getAllSync<any>(
    `SELECT w.id, w.scheduled_date, w.workout_type
     FROM workout w
     JOIN training_plan tp ON w.plan_id = tp.id
     WHERE tp.status = 'active'
     AND w.status = 'skipped'
     AND w.scheduled_date <= ?
     AND w.workout_type != 'rest'`,
    [cutoffDate]
  );

  for (const workout of pastSkipped) {
    const metric = findMetricForDate(workout.scheduled_date);
    if (metric) {
      // Un-skip! Strava synced after the sweep — link and mark completed
      database.runSync('UPDATE performance_metric SET workout_id = ? WHERE id = ?', [workout.id, metric.id]);
      database.runSync("UPDATE workout SET status = 'completed' WHERE id = ?", [workout.id]);
      lateMatched++;
      console.log(`[Sweep] Un-skipped workout ${workout.scheduled_date} (${workout.workout_type}) — late match found`);
    }
  }

  // Step 2: Sweep upcoming workouts that are past due
  const pastUpcoming = database.getAllSync<any>(
    `SELECT w.id, w.scheduled_date, w.workout_type
     FROM workout w
     JOIN training_plan tp ON w.plan_id = tp.id
     WHERE tp.status = 'active'
     AND w.status = 'upcoming'
     AND w.scheduled_date <= ?
     AND w.workout_type != 'rest'`,
    [cutoffDate]
  );

  for (const workout of pastUpcoming) {
    const metric = findMetricForDate(workout.scheduled_date);
    if (metric) {
      // Late match — link the metric and mark completed
      database.runSync('UPDATE performance_metric SET workout_id = ? WHERE id = ?', [workout.id, metric.id]);
      database.runSync("UPDATE workout SET status = 'completed' WHERE id = ?", [workout.id]);
      lateMatched++;
    } else {
      // No activity — mark as skipped
      database.runSync("UPDATE workout SET status = 'skipped' WHERE id = ?", [workout.id]);
      skipped++;
    }
  }

  // Also auto-complete rest days that are past (keep plan view clean)
  database.runSync(
    `UPDATE workout SET status = 'completed'
     WHERE status = 'upcoming' AND workout_type = 'rest' AND scheduled_date <= ?
     AND plan_id IN (SELECT id FROM training_plan WHERE status = 'active')`,
    [cutoffDate]
  );

  if (skipped > 0 || lateMatched > 0) {
    console.log(`[DB] Sweep: ${skipped} skipped, ${lateMatched} late-matched`);
    // Clear cached rest day briefing so it regenerates with updated workout statuses
    try {
      const today = require('../utils/dateUtils').getToday();
      database.runSync(`DELETE FROM ai_cache WHERE cache_type = 'rest_briefing' AND cache_key = ?`, [`rest_day_briefing_${today}`]);
    } catch {}
  }

  return { skipped, lateMatched };
}

// ─── Delete Activity ──────────────────────────────────────────

export interface DeletedActivitySnapshot {
  metric: any;
  detail: any | null;
  workoutId: string | null;
  workoutPrevStatus: string | null;
  workoutPrevQuality: string | null;
  workoutPrevStravaId: number | null;
}

export function deleteActivity(metricId: string): DeletedActivitySnapshot | null {
  const database = getDatabase();

  // 1. Get the metric row (before transaction — need it for snapshot)
  const metric = database.getFirstSync<any>(
    'SELECT * FROM performance_metric WHERE id = ?', [metricId]
  );
  if (!metric) return null;

  // 2. Snapshot for undo (before any mutations)
  const detail = metric.strava_activity_id
    ? database.getFirstSync<any>('SELECT * FROM strava_activity_detail WHERE strava_activity_id = ?', [metric.strava_activity_id])
    : database.getFirstSync<any>('SELECT * FROM strava_activity_detail WHERE performance_metric_id = ?', [metricId]);

  let workoutPrevStatus: string | null = null;
  let workoutPrevQuality: string | null = null;
  let workoutPrevStravaId: number | null = null;
  if (metric.workout_id) {
    const workout = database.getFirstSync<any>('SELECT status, execution_quality, strava_activity_id FROM workout WHERE id = ?', [metric.workout_id]);
    if (workout) {
      workoutPrevStatus = workout.status;
      workoutPrevQuality = workout.execution_quality;
      workoutPrevStravaId = workout.strava_activity_id;
    }
  }

  const snapshot: DeletedActivitySnapshot = {
    metric,
    detail,
    workoutId: metric.workout_id,
    workoutPrevStatus,
    workoutPrevQuality,
    workoutPrevStravaId,
  };

  // 3-9. All mutations in a single transaction — rollback if any step fails
  database.withTransactionSync(() => {
    // 3. Add to blocklist (prevent Strava re-import)
    if (metric.strava_activity_id) {
      database.runSync(
        'INSERT OR IGNORE INTO deleted_strava_activities (strava_activity_id) VALUES (?)',
        [String(metric.strava_activity_id)]
      );
    }

    // 4. Delete strava_activity_detail
    if (metric.strava_activity_id) {
      database.runSync('DELETE FROM strava_activity_detail WHERE strava_activity_id = ?', [metric.strava_activity_id]);
    }
    database.runSync('DELETE FROM strava_activity_detail WHERE performance_metric_id = ?', [metricId]);

    // 5. Revert matched workout
    if (metric.workout_id) {
      database.runSync(
        `UPDATE workout SET status = 'upcoming', strava_activity_id = NULL, execution_quality = NULL, modification_reason = NULL WHERE id = ?`,
        [metric.workout_id]
      );
    }

    // 6. Delete the metric
    database.runSync('DELETE FROM performance_metric WHERE id = ?', [metricId]);

    // 7. Clear AI caches
    database.runSync(`DELETE FROM ai_cache WHERE cache_type = 'analysis'`);
    const today = require('../utils/dateUtils').getToday();
    database.runSync(`DELETE FROM ai_cache WHERE cache_type = 'rest_briefing' AND cache_key = ?`, [`rest_day_briefing_${today}`]);

    // 8. Invalidate training load cache
    database.runSync('DELETE FROM training_load_cache');
  });

  // 9. Recalculate weekly volumes (outside transaction — reads from DB)
  recalculateWeeklyVolumes();

  console.log(`[DB] Deleted activity ${metricId} (strava: ${metric.strava_activity_id}, workout: ${metric.workout_id})`);

  return snapshot;
}

export function restoreActivity(snapshot: DeletedActivitySnapshot): void {
  const database = getDatabase();

  // Re-insert metric
  const m = snapshot.metric;
  database.runSync(
    `INSERT OR REPLACE INTO performance_metric (id, workout_id, strava_activity_id, date, distance_miles, duration_minutes, avg_pace_sec_per_mile, avg_hr, max_hr, splits_json, best_efforts_json, perceived_exertion, gear_name, strava_workout_type, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.workout_id, m.strava_activity_id, m.date, m.distance_miles, m.duration_minutes, m.avg_pace_sec_per_mile, m.avg_hr, m.max_hr, m.splits_json, m.best_efforts_json, m.perceived_exertion, m.gear_name, m.strava_workout_type, m.source, m.created_at]
  );

  // Re-insert detail (if exists)
  if (snapshot.detail) {
    const d = snapshot.detail;
    const cols = Object.keys(d).filter(k => d[k] !== undefined);
    const vals = cols.map(k => d[k]);
    const placeholders = cols.map(() => '?').join(',');
    database.runSync(`INSERT OR REPLACE INTO strava_activity_detail (${cols.join(',')}) VALUES (${placeholders})`, vals);
  }

  // Restore workout status
  if (snapshot.workoutId && snapshot.workoutPrevStatus) {
    database.runSync(
      'UPDATE workout SET status = ?, execution_quality = ?, strava_activity_id = ? WHERE id = ?',
      [snapshot.workoutPrevStatus, snapshot.workoutPrevQuality, snapshot.workoutPrevStravaId, snapshot.workoutId]
    );
  }

  // Remove from blocklist
  if (m.strava_activity_id) {
    database.runSync('DELETE FROM deleted_strava_activities WHERE strava_activity_id = ?', [String(m.strava_activity_id)]);
  }

  // Recalculate
  recalculateWeeklyVolumes();
  try { database.runSync('DELETE FROM training_load_cache'); } catch {}

  console.log(`[DB] Restored activity ${m.id}`);
}

export function isStravaActivityBlocked(stravaActivityId: number): boolean {
  const database = getDatabase();
  const row = database.getFirstSync<any>(
    'SELECT 1 FROM deleted_strava_activities WHERE strava_activity_id = ?',
    [String(stravaActivityId)]
  );
  return row != null;
}

export function recalculateWeeklyVolumes(): void {
  const database = getDatabase();

  // Get all training weeks for the active plan
  const weeks = database.getAllSync<any>(
    `SELECT tw.id, tw.week_number, w_start.scheduled_date as week_start
     FROM training_week tw
     JOIN training_plan tp ON tw.plan_id = tp.id
     LEFT JOIN (
       SELECT plan_id, week_number, MIN(scheduled_date) as scheduled_date
       FROM workout GROUP BY plan_id, week_number
     ) w_start ON w_start.plan_id = tw.plan_id AND w_start.week_number = tw.week_number
     WHERE tp.status = 'active'`
  );

  for (const week of weeks) {
    if (!week.week_start) continue;

    // Calculate week end (6 days after start)
    const start = new Date(week.week_start + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

    // Sum ALL performance metrics in that date range (matched + unmatched + manual)
    const volumeRow = database.getFirstSync<any>(
      `SELECT COALESCE(SUM(distance_miles), 0) as total
       FROM performance_metric
       WHERE date >= ? AND date <= ?`,
      [week.week_start, endStr]
    );

    const actualVolume = Math.round((volumeRow?.total ?? 0) * 10) / 10;

    // Also recalculate target_volume from workout target distances (if current target is 0 or missing)
    const currentTarget = database.getFirstSync<any>(
      'SELECT target_volume FROM training_week WHERE id = ?', [week.id]
    );
    let targetVolume = currentTarget?.target_volume ?? 0;
    if (targetVolume === 0) {
      const targetRow = database.getFirstSync<any>(
        `SELECT COALESCE(SUM(target_distance_miles), 0) as total
         FROM workout
         WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
         AND week_number = ? AND workout_type != 'rest'`,
        [week.week_number]
      );
      targetVolume = Math.round((targetRow?.total ?? 0) * 10) / 10;
    }

    database.runSync(
      'UPDATE training_week SET actual_volume = ?, target_volume = CASE WHEN target_volume = 0 THEN ? ELSE target_volume END WHERE id = ?',
      [actualVolume, targetVolume, week.id]
    );
  }
}

// ─── Training Load Cache ─────────────────────────────────────

export function getPMCCache(dataHash: string): string | null {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ pmc_json: string }>(
      'SELECT pmc_json FROM training_load_cache WHERE id = 1 AND data_hash = ?',
      dataHash,
    );
    return row?.pmc_json ?? null;
  } catch { return null; }
}

export function setPMCCache(pmcJson: string, dataHash: string): void {
  try {
    const db = getDatabase();
    db.runSync(
      `INSERT OR REPLACE INTO training_load_cache (id, pmc_json, data_hash, calculated_at)
       VALUES (1, ?, ?, datetime('now'))`,
      pmcJson,
      dataHash,
    );
  } catch (e) { console.warn('[DB] PMC cache write failed:', e); }
}

export function getUpcomingWorkouts(planId: string, fromDate: string): import('../types').Workout[] {
  const db = getDatabase();
  return db.getAllSync<import('../types').Workout>(
    `SELECT * FROM workout WHERE plan_id = ? AND status = 'upcoming' AND scheduled_date >= ? ORDER BY scheduled_date`,
    planId,
    fromDate,
  );
}

export function getPlanStartDate(planId: string): string | null {
  const db = getDatabase();
  const row = db.getFirstSync<{ d: string }>(
    'SELECT MIN(scheduled_date) as d FROM workout WHERE plan_id = ? AND week_number = 1',
    planId,
  );
  return row?.d ?? null;
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
