/**
 * backup.ts — Cloud save/restore for Marathon Coach
 *
 * Architecture:
 * - SQLite is ALWAYS primary. This module is only touched during explicit backup/restore.
 * - serializeDatabase() reads all tables and produces a JSON snapshot
 * - uploadBackup() upserts that snapshot to Supabase (one row per user, overwritten each time)
 * - getBackupInfo() fetches just the metadata (timestamp, device) without downloading all data
 *
 * Security: Strava access_token and refresh_token are NEVER included in the backup.
 */

import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getDatabase } from '../db/client';
import { supabase } from './supabase';
import { getCurrentUserId } from './auth';
import { BackupData, BackupInfo } from '../types';

// Current schema version — bump this when the schema changes in a breaking way
export const BACKUP_SCHEMA_VERSION = 1;

// ─── Serialization ───────────────────────────────────────────

/**
 * Reads all SQLite tables and produces a single BackupData object.
 * Strava access_token and refresh_token are stripped for security.
 */
export function serializeDatabase(): BackupData {
  const db = getDatabase();

  // Read all tables
  const userProfiles = db.getAllSync<any>('SELECT * FROM user_profile');
  const trainingPlans = db.getAllSync<any>('SELECT * FROM training_plan');
  const trainingWeeks = db.getAllSync<any>('SELECT * FROM training_week');
  const workouts = db.getAllSync<any>('SELECT * FROM workout');
  const performanceMetrics = db.getAllSync<any>('SELECT * FROM performance_metric');
  const coachMessages = db.getAllSync<any>('SELECT * FROM coach_message');
  const adaptiveLogs = db.getAllSync<any>('SELECT * FROM adaptive_log');
  const strava_activity_details = db.getAllSync<any>('SELECT * FROM strava_activity_detail');
  const briefingCache = db.getAllSync<any>('SELECT * FROM ai_briefing_cache');

  // Health snapshots — last 30 days only (keeps backup size manageable)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const healthSnapshots = db.getAllSync<any>(
    'SELECT * FROM health_snapshot WHERE date >= ? ORDER BY date DESC',
    thirtyDaysAgo.toISOString().split('T')[0]
  );

  // Strava tokens — include full tokens for seamless restore
  const stravaRow = db.getFirstSync<any>('SELECT * FROM strava_tokens LIMIT 1');
  const stravaReference = stravaRow
    ? { athleteId: stravaRow.athlete_id, athleteName: stravaRow.athlete_name }
    : null;
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
  const appVersion = Constants.expoConfig?.version || '1.0.0';

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
    adaptiveLogs,
    healthSnapshots,
    stravaReference,
    stravaTokens,
    appSettings: null, // reserved for future settings store
    briefingCache,
    stravaDetails: strava_activity_details,
  };
}

// ─── Upload ──────────────────────────────────────────────────

/**
 * Uploads a BackupData object to Supabase.
 * Upserts — overwrites the previous backup for this user.
 */
export async function uploadBackup(
  data: BackupData
): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false, error: 'Not signed in to cloud backup.' };
  }

  const { error } = await supabase.from('backups').upsert(
    {
      user_id: userId,
      backup_data: data,
      app_version: data.appVersion,
      device_name: data.deviceName,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('Backup upload error:', error);
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return { success: false, error: 'Network error. Check your connection and try again.' };
    }
    if (error.message.includes('JWT') || error.message.includes('auth')) {
      return { success: false, error: 'Session expired. Please sign in again.' };
    }
    if (error.message.includes('too large') || error.code === '54000') {
      return { success: false, error: 'Backup too large. Contact support.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Backup Info ─────────────────────────────────────────────

/**
 * Fetches just the backup metadata (timestamp, device name, app version)
 * without downloading the full backup_data payload.
 */
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

// ─── Download ────────────────────────────────────────────────

/**
 * Downloads the full backup from Supabase.
 * Returns the BackupData object, or null if no backup exists.
 */
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

// ─── Validation ──────────────────────────────────────────────

/**
 * Validates a BackupData object before writing it to SQLite.
 * Catches obviously malformed or incompatible backups early.
 */
export function validateBackupData(data: BackupData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Backup data is missing or malformed.'] };
  }

  // Schema version check
  if (typeof data.version !== 'number') {
    errors.push('Missing schema version.');
  } else if (data.version > BACKUP_SCHEMA_VERSION) {
    errors.push(`Backup was created with a newer app version (schema v${data.version}). Please update the app first.`);
  }

  // Required fields
  if (!data.userProfile || typeof data.userProfile !== 'object') {
    errors.push('Missing user profile.');
  }
  if (!Array.isArray(data.trainingWeeks)) {
    errors.push('Missing training weeks array.');
  }
  if (!Array.isArray(data.workouts)) {
    errors.push('Missing workouts array.');
  }
  if (!Array.isArray(data.performanceMetrics)) {
    errors.push('Missing performance metrics array.');
  }

  // Sanity checks on sizes (catch obviously corrupt data)
  if (data.workouts && data.workouts.length > 10000) {
    errors.push('Backup contains an implausible number of workouts.');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Restore ────────────────────────────────────────────────

/**
 * Restores all SQLite tables from a BackupData object.
 *
 * CRITICAL: The entire restore is wrapped in a SQLite transaction.
 * If anything fails mid-restore, the transaction rolls back and
 * local data is completely untouched.
 *
 * After restore, call store.initializeApp() to reload Zustand state.
 * Strava: user must re-authenticate (tokens were excluded from backup).
 */
export async function restoreDatabase(
  data: BackupData
): Promise<{ success: boolean; error?: string }> {
  const validation = validateBackupData(data);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join(' ') };
  }

  const db = getDatabase();

  try {
    db.withTransactionSync(() => {
      // Clear all tables in reverse foreign-key order to avoid constraint errors
      db.execSync('DELETE FROM strava_activity_detail');
      db.execSync('DELETE FROM performance_metric');
      db.execSync('DELETE FROM workout');
      db.execSync('DELETE FROM training_week');
      db.execSync('DELETE FROM training_plan');
      db.execSync('DELETE FROM coach_message');
      db.execSync('DELETE FROM adaptive_log');
      db.execSync('DELETE FROM health_snapshot');
      db.execSync('DELETE FROM ai_briefing_cache');
      db.execSync('DELETE FROM strava_tokens');
      db.execSync('DELETE FROM user_profile');

      // Restore user profile
      if (data.userProfile) {
        const p = data.userProfile;
        db.runSync(
          `INSERT OR REPLACE INTO user_profile
           (id, name, age, weight_lbs, resting_hr, max_hr, vdot, current_weekly_mileage,
            race_date, race_distance, recent_race_distance, recent_race_time_seconds,
            level, available_days, preferred_long_run_day, longest_recent_run,
            goal_marathon_time_seconds, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          p.id, p.name, p.age, p.weight_lbs, p.resting_hr, p.max_hr, p.vdot,
          p.current_weekly_mileage, p.race_date, p.race_distance, p.recent_race_distance,
          p.recent_race_time_seconds, p.level, p.available_days, p.preferred_long_run_day,
          p.longest_recent_run, p.goal_marathon_time_seconds || null,
          p.created_at, p.updated_at
        );
      }

      // Restore training plan
      if (data.trainingPlan) {
        const p = data.trainingPlan;
        db.runSync(
          `INSERT OR REPLACE INTO training_plan
           (id, start_date, race_date, total_weeks, peak_weekly_mileage, vdot_at_creation, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          p.id, p.start_date, p.race_date, p.total_weeks, p.peak_weekly_mileage,
          p.vdot_at_creation, p.created_at, p.updated_at
        );
      }

      // Restore training weeks
      for (const w of data.trainingWeeks || []) {
        db.runSync(
          `INSERT OR REPLACE INTO training_week
           (id, plan_id, week_number, phase, is_cutback, target_volume_miles, actual_volume_miles, start_date, end_date)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          w.id, w.plan_id, w.week_number, w.phase, w.is_cutback,
          w.target_volume_miles, w.actual_volume_miles, w.start_date, w.end_date
        );
      }

      // Restore workouts
      for (const w of data.workouts || []) {
        db.runSync(
          `INSERT OR REPLACE INTO workout
           (id, week_id, date, day_of_week, workout_type, distance_miles, target_pace_zone,
            intervals_json, status, notes, created_at, updated_at,
            original_distance_miles, adjustment_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          w.id, w.week_id, w.date, w.day_of_week, w.workout_type, w.distance_miles,
          w.target_pace_zone, w.intervals_json || null, w.status, w.notes || null,
          w.created_at, w.updated_at,
          w.original_distance_miles || null, w.adjustment_reason || null
        );
      }

      // Restore performance metrics
      for (const m of data.performanceMetrics || []) {
        db.runSync(
          `INSERT OR REPLACE INTO performance_metric
           (id, workout_id, date, source, distance_miles, duration_seconds,
            avg_pace_per_mile, avg_hr, max_hr, calories, route_json, synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          m.id, m.workout_id || null, m.date, m.source, m.distance_miles,
          m.duration_seconds, m.avg_pace_per_mile, m.avg_hr || null,
          m.max_hr || null, m.calories || null, m.route_json || null, m.synced_at
        );
      }

      // Restore Strava activity details
      for (const d of data.stravaDetails || []) {
        db.runSync(
          `INSERT OR REPLACE INTO strava_activity_detail
           (id, performance_metric_id, strava_activity_id, splits_json, laps_json,
            hr_stream_json, pace_stream_json, elevation_gain_ft, calories,
            cadence_avg, suffer_score, device_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          d.id, d.performance_metric_id, d.strava_activity_id,
          d.splits_json || null, d.laps_json || null,
          d.hr_stream_json || null, d.pace_stream_json || null,
          d.elevation_gain_ft || null, d.calories || null,
          d.cadence_avg || null, d.suffer_score || null, d.device_name || null
        );
      }

      // Restore coach messages
      for (const m of data.coachMessages || []) {
        db.runSync(
          `INSERT OR REPLACE INTO coach_message
           (id, role, content, structured_action_json, action_applied, created_at, conversation_id)
           VALUES (?,?,?,?,?,?,?)`,
          m.id, m.role, m.content, m.structured_action_json || null,
          m.action_applied || 0, m.created_at, m.conversation_id
        );
      }

      // Restore adaptive logs
      for (const l of data.adaptiveLogs || []) {
        db.runSync(
          `INSERT OR REPLACE INTO adaptive_log
           (id, timestamp, type, summary, adjustments_json, metadata_json, acknowledged)
           VALUES (?,?,?,?,?,?,?)`,
          l.id, l.timestamp, l.type, l.summary,
          l.adjustments_json || '[]', l.metadata_json || '{}', l.acknowledged || 0
        );
      }

      // Restore health snapshots
      for (const s of data.healthSnapshots || []) {
        db.runSync(
          `INSERT OR REPLACE INTO health_snapshot
           (id, date, resting_hr, hrv_sdnn, hrv_trend_7d_json, sleep_hours,
            sleep_quality, weight_lbs, steps, recovery_score, signal_count, cached_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          s.id, s.date, s.resting_hr || null, s.hrv_sdnn || null,
          s.hrv_trend_7d_json || null, s.sleep_hours || null,
          s.sleep_quality || null, s.weight_lbs || null, s.steps || null,
          s.recovery_score || null, s.signal_count || 0, s.cached_at
        );
      }

      // Restore AI briefing cache
      for (const b of data.briefingCache || []) {
        db.runSync(
          `INSERT OR REPLACE INTO ai_briefing_cache
           (id, type, date, context_hash, content, created_at)
           VALUES (?,?,?,?,?,?)`,
          b.id, b.type, b.date, b.context_hash, b.content, b.created_at
        );
      }

      // Restore Strava tokens if included in backup (seamless reconnection)
      if (data.stravaTokens) {
        const t = data.stravaTokens;
        db.runSync(
          `INSERT OR REPLACE INTO strava_tokens
           (id, access_token, refresh_token, expires_at, athlete_id, athlete_name, connected_at)
           VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
          t.access_token, t.refresh_token, t.expires_at, t.athlete_id, t.athlete_name || null
        );
      }
    });

    return { success: true };
  } catch (e: any) {
    console.error('Restore failed, transaction rolled back:', e);
    return {
      success: false,
      error: `Restore failed: ${e?.message || 'Unknown error'}. Your local data was not changed.`,
    };
  }
}
