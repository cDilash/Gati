export const CREATE_USER_PROFILE = `
CREATE TABLE IF NOT EXISTS user_profile (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  age INTEGER,
  weight_lbs REAL,
  resting_hr INTEGER,
  max_hr INTEGER,
  vdot REAL,
  current_weekly_mileage REAL,
  race_date TEXT,
  race_distance TEXT,
  recent_race_distance TEXT,
  recent_race_time_seconds INTEGER,
  level TEXT,
  available_days TEXT,
  preferred_long_run_day INTEGER,
  longest_recent_run REAL,
  goal_marathon_time_seconds INTEGER,
  created_at TEXT,
  updated_at TEXT
);`;

export const CREATE_TRAINING_PLAN = `
CREATE TABLE IF NOT EXISTS training_plan (
  id TEXT PRIMARY KEY NOT NULL,
  start_date TEXT,
  race_date TEXT,
  total_weeks INTEGER,
  peak_weekly_mileage REAL,
  vdot_at_creation REAL,
  created_at TEXT,
  updated_at TEXT
);`;

export const CREATE_TRAINING_WEEK = `
CREATE TABLE IF NOT EXISTS training_week (
  id TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT,
  week_number INTEGER,
  phase TEXT,
  is_cutback INTEGER,
  target_volume_miles REAL,
  actual_volume_miles REAL,
  start_date TEXT,
  end_date TEXT,
  FOREIGN KEY (plan_id) REFERENCES training_plan(id)
);`;

export const CREATE_WORKOUT = `
CREATE TABLE IF NOT EXISTS workout (
  id TEXT PRIMARY KEY NOT NULL,
  week_id TEXT,
  date TEXT,
  day_of_week INTEGER,
  workout_type TEXT,
  distance_miles REAL,
  target_pace_zone TEXT,
  intervals_json TEXT,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (week_id) REFERENCES training_week(id)
);`;

export const CREATE_PERFORMANCE_METRIC = `
CREATE TABLE IF NOT EXISTS performance_metric (
  id TEXT PRIMARY KEY NOT NULL,
  workout_id TEXT,
  date TEXT,
  source TEXT,
  distance_miles REAL,
  duration_seconds INTEGER,
  avg_pace_per_mile INTEGER,
  avg_hr INTEGER,
  max_hr INTEGER,
  calories INTEGER,
  route_json TEXT,
  synced_at TEXT,
  FOREIGN KEY (workout_id) REFERENCES workout(id)
);`;

export const CREATE_COACH_MESSAGE = `
CREATE TABLE IF NOT EXISTS coach_message (
  id TEXT PRIMARY KEY NOT NULL,
  role TEXT,
  content TEXT,
  structured_action_json TEXT,
  action_applied INTEGER DEFAULT 0,
  created_at TEXT,
  conversation_id TEXT
);`;

export const CREATE_ADAPTIVE_LOG = `
CREATE TABLE IF NOT EXISTS adaptive_log (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('acwr_adjustment', 'vdot_update', 'weekly_reconciliation', 'missed_workout_triage')),
  summary TEXT NOT NULL,
  adjustments_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);`;

// Migrations for adaptive columns on workout table
export const MIGRATE_WORKOUT_ADAPTIVE = [
  `ALTER TABLE workout ADD COLUMN original_distance_miles REAL;`,
  `ALTER TABLE workout ADD COLUMN adjustment_reason TEXT;`,
];

export const CREATE_HEALTH_SNAPSHOT = `
CREATE TABLE IF NOT EXISTS health_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  resting_hr INTEGER,
  hrv_sdnn REAL,
  hrv_trend_7d_json TEXT,
  sleep_hours REAL,
  sleep_quality TEXT,
  weight_lbs REAL,
  steps INTEGER,
  recovery_score INTEGER,
  signal_count INTEGER NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL
);`;

export const CREATE_HEALTH_SNAPSHOT_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshot_date ON health_snapshot(date);`;

export const ALL_TABLES = [
  CREATE_USER_PROFILE,
  CREATE_TRAINING_PLAN,
  CREATE_TRAINING_WEEK,
  CREATE_WORKOUT,
  CREATE_PERFORMANCE_METRIC,
  CREATE_COACH_MESSAGE,
  CREATE_ADAPTIVE_LOG,
  CREATE_HEALTH_SNAPSHOT,
];
