// ─── Core Enums ──────────────────────────────────────────────

export type Phase = 'base' | 'build' | 'peak' | 'taper';
export type PaceZoneName = 'E' | 'M' | 'T' | 'I' | 'R';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type WorkoutStatus = 'upcoming' | 'completed' | 'skipped' | 'modified';

// ─── User Profile ────────────────────────────────────────────

export interface UserProfile {
  id: number;  // always 1 (single-row)
  name: string | null;
  age: number;
  gender: 'male' | 'female';
  weight_kg: number | null;
  vdot_score: number;
  max_hr: number | null;
  rest_hr: number | null;
  current_weekly_miles: number;
  longest_recent_run: number;
  experience_level: Level;
  race_date: string;
  race_name: string | null;
  race_course_profile: 'flat' | 'rolling' | 'hilly' | 'unknown';
  race_goal_type: 'finish' | 'time_goal' | 'bq' | 'pr';
  target_finish_time_sec: number | null;
  injury_history: string[];       // parsed from JSON
  known_weaknesses: string[];     // parsed from JSON
  scheduling_notes: string | null;
  available_days: number[];       // parsed from JSON
  long_run_day: number;
  updated_at: string;
}

// ─── Pace Zones ──────────────────────────────────────────────

export interface PaceRange {
  min: number; // seconds per mile (slower)
  max: number; // seconds per mile (faster)
}

export interface PaceZones {
  E: PaceRange;
  M: PaceRange;
  T: PaceRange;
  I: PaceRange;
  R: PaceRange;
}

export interface HRZone {
  name: string;
  min: number;
  max: number;
}

export interface HRZones {
  zone1: HRZone;
  zone2: HRZone;
  zone3: HRZone;
  zone4: HRZone;
  zone5: HRZone;
}

// ─── AI-Generated Plan ──────────────────────────────────────

export interface IntervalStep {
  type: 'warmup' | 'work' | 'recovery' | 'cooldown';
  distance_miles: number;
  pace_zone: PaceZoneName;
  description: string;
}

export interface AIWorkout {
  dayOfWeek: number;             // 0=Sunday, 1=Monday, ..., 6=Saturday
  type: string;                  // "easy", "long_run", "threshold", "intervals", etc.
  title: string;                 // "Progressive Long Run"
  description: string;           // full coaching description with paces
  distanceMiles: number;
  paceZone: string | null;
  intervals: IntervalStep[] | null;
  coachingCue: string;           // "Focus on relaxed shoulders..."
}

export interface AIWeek {
  weekNumber: number;
  phase: Phase;
  targetVolume: number;
  isCutback: boolean;
  focusArea: string;             // "aerobic base", "lactate threshold", etc.
  aiNotes: string;               // "This is your biggest week..."
  workouts: AIWorkout[];
}

export interface AIGeneratedPlan {
  weeks: AIWeek[];
  coachingNotes: string;
  keyPrinciples: string[];
  warnings: string[];
}

// ─── Safety Validation ──────────────────────────────────────

export interface SafetyViolation {
  weekNumber: number;
  field: string;
  originalValue: number;
  clampedValue: number;
  rule: string;
}

export interface SafetyValidation {
  isValid: boolean;
  violations: SafetyViolation[];
  correctedPlan: AIGeneratedPlan;
}

// ─── Database Row Types ─────────────────────────────────────

export interface TrainingPlan {
  id: string;
  plan_json: string;             // full AIGeneratedPlan as JSON
  coaching_notes: string | null;
  key_principles: string | null; // JSON array
  warnings: string | null;       // JSON array
  vdot_at_generation: number;
  status: 'active' | 'completed' | 'abandoned';
  created_at: string;
  updated_at: string;
}

export interface TrainingWeek {
  id: string;
  plan_id: string;
  week_number: number;
  phase: Phase;
  target_volume: number;
  actual_volume: number;
  is_cutback: boolean;
  ai_notes: string | null;
}

export interface Workout {
  id: string;
  plan_id: string;
  week_number: number;
  day_of_week: number;
  scheduled_date: string;
  workout_type: string;
  title: string;
  description: string;
  target_distance_miles: number | null;
  target_pace_zone: string | null;
  intervals_json: string | null;
  status: WorkoutStatus;
  original_distance_miles: number | null;
  modification_reason: string | null;
  strava_activity_id: number | null;
  created_at: string;
}

export interface PerformanceMetric {
  id: string;
  workout_id: string | null;
  strava_activity_id: number | null;
  date: string;
  distance_miles: number;
  duration_minutes: number;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  splits_json: string | null;
  best_efforts_json: string | null;
  perceived_exertion: number | null;
  gear_name: string | null;
  strava_workout_type: number | null;
  source: 'strava' | 'manual';
  created_at: string;
}

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  message_type: 'chat' | 'briefing' | 'analysis' | 'digest' | 'plan_change';
  metadata_json: string | null;
  created_at: string;
}

export interface AICache {
  id: string;
  cache_type: string;
  cache_key: string;
  content: string;
  created_at: string;
}

export interface Shoe {
  id: string;
  stravaGearId: string | null;
  name: string;
  brand: string | null;
  totalMiles: number;
  maxMiles: number;
  retired: boolean;
}

export interface ShoeAlert {
  shoeId: string;
  name: string;
  currentMiles: number;
  maxMiles: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

// ─── Strava Types (kept from v1) ────────────────────────────

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number;
  athleteName: string | null;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  startDate: string;
  distance: number;              // meters
  movingTime: number;            // seconds
  elapsedTime: number;           // seconds
  totalElevationGain: number;    // meters
  averageSpeed: number;          // m/s
  maxSpeed: number;              // m/s
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  hasHeartrate: boolean;
  sufferScore: number | null;
}

export interface StravaSegmentEffort {
  name: string;
  distance: number;         // meters
  movingTime: number;       // seconds
  elapsedTime: number;      // seconds
  startDate: string;
  prRank: number | null;    // 1=PR, 2=2nd, 3=3rd
  komRank: number | null;   // KOM/QOM rank (null if not top 10)
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageWatts: number | null;
}

export interface StravaActivityDetail extends StravaActivity {
  calories: number;
  description: string | null;
  splitsStandard: StravaSplit[];
  laps: StravaLap[];
  averageCadence: number | null;
  deviceName: string | null;
  bestEfforts: StravaBestEffort[];
  gearId: string | null;
  gearName: string | null;
  perceivedExertion: number | null;
  stravaWorkoutType: number | null;
  polylineEncoded: string | null;
  summaryPolylineEncoded: string | null;
  segmentEfforts: StravaSegmentEffort[];
  timezone: string | null;
  utcOffset: number | null;
}

export interface StravaBestEffort {
  name: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  startDate: string;
  prRank: number | null;
}

export interface StravaSplit {
  distance: number;
  elapsedTime: number;
  movingTime: number;
  averageSpeed: number;
  averageHeartrate: number | null;
  paceZone: number;
  split: number;
}

export interface StravaLap {
  name: string;
  distance: number;
  elapsedTime: number;
  movingTime: number;
  averageSpeed: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  lapIndex: number;
}

export interface StravaStreams {
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  distance?: { data: number[] };
  altitude?: { data: number[] };
  cadence?: { data: number[] };
  time?: { data: number[] };
}

// ─── Cloud Backup Types ─────────────────────────────────────

export interface BackupData {
  version: number;
  createdAt: string;
  deviceName: string;
  appVersion: string;
  userProfile: any;
  trainingPlan: any;
  trainingWeeks: any[];
  workouts: any[];
  performanceMetrics: any[];
  coachMessages: any[];
  shoes?: any[];
  appSettings: any;
  // Legacy fields kept for backward compatibility with existing backups
  adaptiveLogs: any[];
  healthSnapshots: any[];
  briefingCache: any[];
  stravaDetails: any[];
  stravaReference?: {
    athleteId: number | null;
    athleteName: string | null;
  } | null;
  stravaTokens?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete_id: number;
    athlete_name: string | null;
  } | null;
}

export interface BackupInfo {
  exists: boolean;
  createdAt: string | null;
  deviceName: string | null;
  appVersion: string | null;
}

// ─── Weekly Digest ──────────────────────────────────────────

export interface WeeklyDigest {
  summary: string;
  volumeComparison: string;
  highlights: string[];
  concerns: string[];
  nextWeekPreview: string;
  adaptationNeeded: boolean;
  adaptationReason: string | null;
}
