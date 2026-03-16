/**
 * backup.ts — Cloud save/restore for Marathon Coach v2
 *
 * Architecture:
 * - SQLite is ALWAYS primary. Cloud is a mirror for recovery.
 * - serializeDatabase() reads all v2 tables → JSON snapshot
 * - uploadBackup() upserts to Supabase (one row per user)
 * - restoreDatabase() writes snapshot back to SQLite
 * - Auto-backup fires after plan generation and profile saves
 */

import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getDatabase } from '../db/client';
import { supabase } from './supabase';
import { getCurrentUserId } from './auth';
import { BackupData, BackupInfo } from '../types';

export const BACKUP_SCHEMA_VERSION = 2;

// ─── Serialization (v2 schema) ──────────────────────────────

export function serializeDatabase(): BackupData {
  const db = getDatabase();

  const userProfiles = db.getAllSync<any>('SELECT * FROM user_profile');
  const trainingPlans = db.getAllSync<any>('SELECT * FROM training_plan');
  const trainingWeeks = db.getAllSync<any>('SELECT * FROM training_week');
  const workouts = db.getAllSync<any>('SELECT * FROM workout');
  const performanceMetrics = db.getAllSync<any>('SELECT * FROM performance_metric');
  const coachMessages = db.getAllSync<any>('SELECT * FROM coach_message');
  const stravaDetails = db.getAllSync<any>('SELECT * FROM strava_activity_detail');
  const shoes = db.getAllSync<any>('SELECT * FROM shoes');

  // Strava tokens for seamless restore
  const stravaRow = db.getFirstSync<any>('SELECT * FROM strava_tokens LIMIT 1');
  const stravaTokens = stravaRow
    ? {
        access_token: stravaRow.access_token,
        refresh_token: stravaRow.refresh_token,
        expires_at: stravaRow.expires_at,
        athlete_id: stravaRow.athlete_id,
        athlete_name: stravaRow.athlete_name,
      }
    : null;

  const deviceName = Device.modelName || Device.deviceName || 'Unknown Device';
  const appVersion = Constants.expoConfig?.version || '2.0.0';

  return {
    version: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    deviceName,
    appVersion,
    userProfile: userProfiles[0] || null,
    trainingPlan: trainingPlans[0] || null,
    trainingWeeks,
    workouts,
    performanceMetrics,
    coachMessages,
    shoes,
    appSettings: null,
    // Legacy fields (empty in v2, kept for type compat)
    adaptiveLogs: [],
    healthSnapshots: [],
    briefingCache: [],
    stravaDetails,
    stravaTokens,
  };
}

// ─── Upload ─────────────────────────────────────────────────

export async function uploadBackup(
  data?: BackupData,
): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false, error: 'Not signed in.' };
  }

  const backup = data ?? serializeDatabase();

  const { error } = await supabase.from('backups').upsert(
    {
      user_id: userId,
      backup_data: backup,
      app_version: backup.appVersion,
      device_name: backup.deviceName,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    console.error('[Backup] Upload error:', error);
    return { success: false, error: error.message };
  }

  console.log('[Backup] Upload successful');
  return { success: true };
}

/**
 * Silent auto-backup — fire-and-forget, never throws.
 */
export async function autoBackup(): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return; // Not logged in, skip silently
    await uploadBackup();
  } catch (e) {
    console.warn('[Backup] Auto-backup failed:', e);
  }
}

// ─── Backup Info ────────────────────────────────────────────

export async function getBackupInfo(): Promise<BackupInfo> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { exists: false, createdAt: null, deviceName: null, appVersion: null };
  }

  const { data, error } = await supabase
    .from('backups')
    .select('created_at, device_name, app_version')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return { exists: false, createdAt: null, deviceName: null, appVersion: null };
  }

  return {
    exists: true,
    createdAt: data.created_at,
    deviceName: data.device_name,
    appVersion: data.app_version,
  };
}

// ─── Download ───────────────────────────────────────────────

export async function downloadBackup(): Promise<BackupData | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('backups')
    .select('backup_data')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data.backup_data as BackupData;
}

// ─── Restore (v2 schema) ───────────────────────────────────

export async function restoreDatabase(
  data: BackupData,
): Promise<{ success: boolean; error?: string }> {
  if (!data || !data.userProfile) {
    return { success: false, error: 'Invalid backup: missing user profile.' };
  }

  const db = getDatabase();

  try {
    // Disable FK checks during restore — v1 backup data may have different FK relationships
    db.execSync('PRAGMA foreign_keys = OFF;');

    db.withTransactionSync(() => {
      // Clear all tables
      db.execSync('DELETE FROM strava_activity_detail');
      db.execSync('DELETE FROM performance_metric');
      db.execSync('DELETE FROM workout');
      db.execSync('DELETE FROM training_week');
      db.execSync('DELETE FROM training_plan');
      db.execSync('DELETE FROM coach_message');
      db.execSync('DELETE FROM ai_cache');
      db.execSync('DELETE FROM shoes');
      db.execSync('DELETE FROM user_profile');

      // Restore user profile (handle both v1 and v2 column names)
      const p = data.userProfile;
      if (p) {
        db.runSync(
          `INSERT OR REPLACE INTO user_profile
           (id, name, age, gender, weight_kg, vdot_score, max_hr, rest_hr,
            current_weekly_miles, longest_recent_run, experience_level,
            race_date, race_name, race_course_profile, race_goal_type,
            target_finish_time_sec, injury_history, known_weaknesses,
            scheduling_notes, available_days, long_run_day, updated_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          p.name ?? null,
          p.age ?? 30,
          p.gender ?? 'male',
          p.weight_kg ?? p.weight_lbs ?? null,
          p.vdot_score ?? p.vdot ?? 40,
          p.max_hr ?? null,
          p.rest_hr ?? p.resting_hr ?? null,
          p.current_weekly_miles ?? p.current_weekly_mileage ?? 20,
          p.longest_recent_run ?? 8,
          p.experience_level ?? p.level ?? 'intermediate',
          p.race_date ?? '',
          p.race_name ?? null,
          p.race_course_profile ?? 'unknown',
          p.race_goal_type ?? 'finish',
          p.target_finish_time_sec ?? p.goal_marathon_time_seconds ?? null,
          typeof p.injury_history === 'string' ? p.injury_history : JSON.stringify(p.injury_history ?? []),
          typeof p.known_weaknesses === 'string' ? p.known_weaknesses : JSON.stringify(p.known_weaknesses ?? []),
          p.scheduling_notes ?? null,
          typeof p.available_days === 'string' ? p.available_days : JSON.stringify(p.available_days ?? [1,2,3,4,5,6]),
          p.long_run_day ?? p.preferred_long_run_day ?? 0,
        );
      }

      // Restore training plan
      if (data.trainingPlan) {
        const t = data.trainingPlan;
        db.runSync(
          `INSERT OR REPLACE INTO training_plan
           (id, plan_json, coaching_notes, key_principles, warnings,
            vdot_at_generation, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.id,
          t.plan_json ?? JSON.stringify({}),
          t.coaching_notes ?? null,
          t.key_principles ?? null,
          t.warnings ?? null,
          t.vdot_at_generation ?? t.vdot_at_creation ?? 40,
          t.status ?? 'active',
          t.created_at ?? new Date().toISOString(),
          t.updated_at ?? new Date().toISOString(),
        );
      }

      // Restore training weeks
      for (const w of data.trainingWeeks ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO training_week
           (id, plan_id, week_number, phase, target_volume, actual_volume, is_cutback, ai_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          w.id, w.plan_id, w.week_number, w.phase,
          w.target_volume ?? w.target_volume_miles ?? 0,
          w.actual_volume ?? w.actual_volume_miles ?? 0,
          w.is_cutback ? 1 : 0,
          w.ai_notes ?? null,
        );
      }

      // Restore workouts
      for (const w of data.workouts ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO workout
           (id, plan_id, week_number, day_of_week, scheduled_date, workout_type,
            title, description, target_distance_miles, target_pace_zone,
            intervals_json, status, original_distance_miles, modification_reason,
            strava_activity_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          w.id,
          w.plan_id ?? w.week_id ?? '',
          w.week_number ?? 1,
          w.day_of_week ?? 0,
          w.scheduled_date ?? w.date ?? '',
          w.workout_type ?? 'easy',
          w.title ?? w.workout_type ?? 'Run',
          w.description ?? w.notes ?? '',
          w.target_distance_miles ?? w.distance_miles ?? null,
          w.target_pace_zone ?? null,
          w.intervals_json ?? null,
          w.status === 'scheduled' ? 'upcoming' : (w.status ?? 'upcoming'),
          w.original_distance_miles ?? null,
          w.modification_reason ?? w.adjustment_reason ?? null,
          w.strava_activity_id ?? null,
        );
      }

      // Restore performance metrics
      for (const m of data.performanceMetrics ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO performance_metric
           (id, workout_id, strava_activity_id, date, distance_miles, duration_minutes,
            avg_pace_sec_per_mile, avg_hr, max_hr, splits_json, best_efforts_json,
            perceived_exertion, gear_name, strava_workout_type, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          m.id,
          m.workout_id ?? null,
          m.strava_activity_id ?? null,
          m.date,
          m.distance_miles ?? 0,
          m.duration_minutes ?? (m.duration_seconds ? m.duration_seconds / 60 : 0),
          m.avg_pace_sec_per_mile ?? m.avg_pace_per_mile ?? null,
          m.avg_hr ?? null,
          m.max_hr ?? null,
          m.splits_json ?? null,
          m.best_efforts_json ?? null,
          m.perceived_exertion ?? m.rpe_score ?? null,
          m.gear_name ?? null,
          m.strava_workout_type ?? null,
          m.source ?? 'strava',
        );
      }

      // Restore strava details
      for (const d of data.stravaDetails ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO strava_activity_detail
           (id, performance_metric_id, strava_activity_id, splits_json, laps_json,
            hr_stream_json, pace_stream_json, elevation_gain_ft, calories,
            cadence_avg, suffer_score, device_name, best_efforts_json,
            gear_id, gear_name, perceived_exertion, strava_workout_type,
            moving_time_sec, elapsed_time_sec, polyline_encoded, summary_polyline_encoded,
            distance_stream_json, elevation_stream_json,
            activity_name, activity_type, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          d.id, d.performance_metric_id, d.strava_activity_id,
          d.splits_json ?? null, d.laps_json ?? null,
          d.hr_stream_json ?? null, d.pace_stream_json ?? null,
          d.elevation_gain_ft ?? null, d.calories ?? null,
          d.cadence_avg ?? null, d.suffer_score ?? null, d.device_name ?? null,
          d.best_efforts_json ?? null, d.gear_id ?? null, d.gear_name ?? null,
          d.perceived_exertion ?? null, d.strava_workout_type ?? null,
          d.moving_time_sec ?? null, d.elapsed_time_sec ?? null,
          d.polyline_encoded ?? null, d.summary_polyline_encoded ?? null,
          d.distance_stream_json ?? null, d.elevation_stream_json ?? null,
          d.activity_name ?? null, d.activity_type ?? null, d.description ?? null,
        );
      }

      // Restore coach messages
      for (const m of data.coachMessages ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO coach_message
           (id, role, content, message_type, metadata_json)
           VALUES (?, ?, ?, ?, ?)`,
          m.id, m.role, m.content,
          m.message_type ?? 'chat',
          m.metadata_json ?? m.structured_action_json ?? null,
        );
      }

      // Restore shoes
      for (const s of data.shoes ?? []) {
        db.runSync(
          `INSERT OR REPLACE INTO shoes
           (id, strava_gear_id, name, brand, total_miles, max_miles, retired)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          s.id, s.strava_gear_id ?? s.stravaGearId ?? null,
          s.name, s.brand ?? null,
          s.total_miles ?? s.totalMiles ?? 0,
          s.max_miles ?? s.maxMiles ?? 500,
          (s.retired ? 1 : 0),
        );
      }

      // Restore Strava tokens
      if (data.stravaTokens) {
        const t = data.stravaTokens;
        db.runSync(
          `INSERT OR REPLACE INTO strava_tokens
           (id, access_token, refresh_token, expires_at, athlete_id, athlete_name, connected_at)
           VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
          t.access_token, t.refresh_token, t.expires_at, t.athlete_id, t.athlete_name ?? null,
        );
      }
    });

    // Re-enable FK checks
    db.execSync('PRAGMA foreign_keys = ON;');
    console.log('[Backup] Restore successful');
    return { success: true };
  } catch (e: any) {
    // Re-enable FK checks even on failure
    try { db.execSync('PRAGMA foreign_keys = ON;'); } catch {}
    console.error('[Backup] Restore failed:', e);
    return { success: false, error: e.message || 'Restore failed' };
  }
}
