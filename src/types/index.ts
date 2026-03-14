export type Phase = 'base' | 'build' | 'peak' | 'taper';
export type WorkoutType = 'easy' | 'long' | 'tempo' | 'interval' | 'recovery' | 'marathon_pace' | 'rest';
export type PaceZoneName = 'E' | 'M' | 'T' | 'I' | 'R';
export type WorkoutStatus = 'scheduled' | 'completed' | 'skipped';
export type Level = 'beginner' | 'intermediate' | 'advanced';

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  weight_lbs: number;
  resting_hr: number;
  max_hr: number;
  vdot: number;
  current_weekly_mileage: number;
  race_date: string;
  race_distance: 'marathon' | 'half';
  recent_race_distance: string;
  recent_race_time_seconds: number;
  level: Level;
  available_days: number[]; // 0=Mon..6=Sun
  preferred_long_run_day: number;
  longest_recent_run: number;
  goal_marathon_time_seconds?: number;
  created_at: string;
  updated_at: string;
}

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

export interface TrainingPlan {
  id: string;
  start_date: string;
  race_date: string;
  total_weeks: number;
  peak_weekly_mileage: number;
  vdot_at_creation: number;
  created_at: string;
  updated_at: string;
}

export interface TrainingWeek {
  id: string;
  plan_id: string;
  week_number: number;
  phase: Phase;
  is_cutback: boolean;
  target_volume_miles: number;
  actual_volume_miles: number;
  start_date: string;
  end_date: string;
}

export interface IntervalStep {
  type: 'warmup' | 'work' | 'recovery' | 'cooldown';
  distance_miles: number;
  pace_zone: PaceZoneName;
  description: string;
}

export interface Workout {
  id: string;
  week_id: string;
  date: string;
  day_of_week: number;
  workout_type: WorkoutType;
  distance_miles: number;
  target_pace_zone: PaceZoneName;
  intervals?: IntervalStep[];
  intervals_json?: string;
  status: WorkoutStatus;
  notes: string;
  original_distance_miles?: number;  // before adaptive adjustment
  adjustment_reason?: string;        // why it was changed
  created_at: string;
  updated_at: string;
}

export interface PerformanceMetric {
  id: string;
  workout_id?: string;
  date: string;
  source: 'healthkit' | 'manual' | 'strava';
  distance_miles: number;
  duration_seconds: number;
  avg_pace_per_mile: number;
  avg_hr?: number;
  max_hr?: number;
  calories?: number;
  route_json?: string;
  rpe_score?: number | null;  // 1-10 perceived exertion from Strava
  synced_at: string;
}

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  structured_action_json?: string;
  action_applied: boolean;
  created_at: string;
  conversation_id: string;
}

export interface PlanMutation {
  type: 'reduce_volume' | 'skip_workout' | 'swap_workout' | 'recalculate';
  affected_workout_ids: string[];
  description: string;
  changes?: Record<string, any>;
}

// ─── Adaptive Training Types ────────────────────────────────

export type AdaptiveAdjustmentType = 'reduce_distance' | 'increase_distance' | 'convert_to_easy' | 'convert_to_rest' | 'reschedule';
export type AdaptiveLogType = 'acwr_adjustment' | 'vdot_update' | 'weekly_reconciliation' | 'missed_workout_triage';
export type VDOTConfidence = 'high' | 'moderate';

export interface WorkoutAdjustment {
  workoutId: string;
  adjustmentType: AdaptiveAdjustmentType;
  originalDistance: number;
  newDistance: number;
  originalType: WorkoutType;
  newType: WorkoutType;
  reason: string;
  autoApplied: boolean;
  timestamp: string;
}

export interface VDOTUpdateResult {
  previousVDOT: number;
  newVDOT: number;
  reason: string;
  evidenceWorkouts: string[];
  confidenceLevel: VDOTConfidence;
}

export interface PlanReconciliation {
  weekNumber: number;
  plannedVolume: number;
  actualVolume: number;
  completionRate: number;
  acwr: number;
  adjustments: WorkoutAdjustment[];
  vdotUpdate: VDOTUpdateResult | null;
  aiAnalysisNeeded: boolean;
}

export interface AdaptiveLog {
  id: string;
  timestamp: string;
  type: AdaptiveLogType;
  summary: string;
  adjustments: WorkoutAdjustment[];
  metadata: Record<string, any>;
}

export interface TrainingContext {
  profile: UserProfile;
  paceZones: PaceZones;
  hrZones: HRZones;
  currentWeekNumber: number;
  totalWeeks: number;
  currentPhase: Phase;
  daysUntilRace: number;
  thisWeekWorkouts: Workout[];
  recentMetrics: PerformanceMetric[];
  weeklyVolumeTrend: { week: number; target: number; actual: number }[];
  adherenceRate: number;
  todaysWorkout?: Workout;
  // Adaptive context
  currentACWR?: number;
  recentAdaptiveLogs?: AdaptiveLog[];
  lastVDOTUpdate?: VDOTUpdateResult;
  lastReconciliation?: PlanReconciliation;
  recoveryStatus?: RecoveryStatus;
  rpeTrend?: { trend: 'fatigued' | 'normal' | 'fresh'; avgRPE: number; sampleSize: number } | null;
  banisterState?: BanisterState;
}

export interface PlanGeneratorConfig {
  startDate: string;
  raceDate: string;
  currentWeeklyMileage: number;
  longestRecentRun: number;
  level: Level;
  vdot: number;
  availableDays: number[];
  preferredLongRunDay: number;
}

export interface GeneratedPlan {
  plan: TrainingPlan;
  weeks: TrainingWeek[];
  workouts: Workout[];
}

// ─── Health & Recovery Types ─────────────────────────────────

export interface HealthSnapshot {
  id: string;
  date: string;
  resting_hr: number | null;
  hrv_sdnn: number | null;
  hrv_trend_7d: number[] | null;
  sleep_hours: number | null;
  sleep_quality: 'poor' | 'fair' | 'good' | null;
  weight_lbs: number | null;
  steps: number | null;
  recovery_score: number | null;
  signal_count: number;
  cached_at: string;
}

export interface RecoveryStatus {
  score: number;
  signalCount: number;
  signals: RecoverySignal[];
  recommendation: 'full_send' | 'normal' | 'easy_only' | 'rest';
}

export interface RecoverySignal {
  type: 'resting_hr' | 'hrv' | 'sleep' | 'volume_trend';
  value: number;
  score: number;
  status: 'good' | 'fair' | 'poor';
}

// ─── Banister Impulse-Response Types ────────────────────────

export interface BanisterState {
  fitness: number;          // accumulated fitness (slow decay)
  fatigue: number;          // accumulated fatigue (fast decay)
  performance: number;      // fitness - fatigue
  readiness: number;        // 0-100 normalized score
  recommendation: 'push' | 'normal' | 'easy' | 'rest';
  trimpHistory: { date: string; trimp: number }[];  // last 28 days
}

export interface DailyTRIMP {
  date: string;
  trimp: number;            // training impulse score
  source: 'hr' | 'pace' | 'rpe' | 'estimated';
}

// ─── Adaptive AI Decision Types ─────────────────────────────

export interface AdaptiveAIDecision {
  workoutId: string;
  action: 'approve' | 'modify' | 'reject';
  adjustedValues?: {
    distance_miles?: number;
    workout_type?: WorkoutType;
    target_pace_zone?: PaceZoneName;
  };
  reasoning: string;
}

export interface AdaptiveAIAddition {
  workoutId: string;
  adjustmentType: AdaptiveAdjustmentType;
  newDistance: number;
  newType: WorkoutType;
  reasoning: string;
}

export interface AdaptiveAIResponse {
  decisions: AdaptiveAIDecision[];
  additions: AdaptiveAIAddition[];
  summary: string;
  replanNeeded: boolean;
  replanReason?: string;
  vdotUpdate: {
    newVdot: number;
    confidence: 'high' | 'moderate';
    reasoning: string;
  } | null;
}

export type AdaptiveEventType = 'workout_completed' | 'workout_skipped';

export interface AdaptiveEventContext {
  eventType: AdaptiveEventType;
  workout: Workout;
  metric: PerformanceMetric | null;
  stravaDetail: Partial<StravaActivityDetail> | null;
  profile: UserProfile;
  acwr: number;
  banisterState: BanisterState;
  recoveryStatus: RecoveryStatus | null;
  rpeTrend: { trend: 'fatigued' | 'normal' | 'fresh'; avgRPE: number; sampleSize: number } | null;
  currentVDOT: number;
  paceZones: PaceZones;
  daysUntilRace: number;
  currentPhase: Phase;
  weekNumber: number;
  proposedAdjustments: WorkoutAdjustment[];
  proposedVDOTUpdate: VDOTUpdateResult | null;
  recentAdaptiveLogs: AdaptiveLog[];
}

// ─── AI Briefing Types ──────────────────────────────────────

export interface WeatherData {
  temp: number;        // fahrenheit
  humidity: number;    // percentage
  condition: string;   // "clear", "cloudy", "rain", etc.
}

// ─── Strava Types ─────────────────────────────────────────

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;    // unix timestamp (seconds)
  athleteId: number;
  athleteName: string | null;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;                   // "Run", "Ride", etc.
  startDate: string;              // ISO
  distance: number;               // meters
  movingTime: number;             // seconds
  elapsedTime: number;            // seconds
  totalElevationGain: number;     // meters
  averageSpeed: number;           // m/s
  maxSpeed: number;               // m/s
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  hasHeartrate: boolean;
  sufferScore: number | null;     // Strava's relative effort
}

export interface StravaActivityDetail extends StravaActivity {
  calories: number;
  description: string | null;
  splitsStandard: StravaSplit[];   // per-mile splits
  laps: StravaLap[];
  averageCadence: number | null;
  deviceName: string | null;      // "Garmin Forerunner 265"
  bestEfforts: StravaBestEffort[];
  gearId: string | null;
  gearName: string | null;
  perceivedExertion: number | null;  // 1-10 RPE entered in Strava
  stravaWorkoutType: number | null;  // 0=default, 1=race, 2=long run, 3=workout
  polylineEncoded: string | null;    // full precision route (for detail view)
  summaryPolylineEncoded: string | null; // simplified route (for thumbnails)
}

export interface StravaBestEffort {
  name: string;         // "400m", "1/2 mile", "1 mile", "5K", "10K", etc.
  distance: number;     // meters
  movingTime: number;   // seconds
  elapsedTime: number;  // seconds
  startDate: string;    // ISO timestamp
  prRank: number | null; // 1=all-time PR, 2=second best, null=not a PR
}

export interface StravaSplit {
  distance: number;               // meters
  elapsedTime: number;            // seconds
  movingTime: number;             // seconds
  averageSpeed: number;           // m/s
  averageHeartrate: number | null;
  paceZone: number;               // Strava's zone 0-4
  split: number;                  // mile number
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
  velocity_smooth?: { data: number[] };  // m/s
  distance?: { data: number[] };         // cumulative meters
  altitude?: { data: number[] };         // meters
  cadence?: { data: number[] };          // spm
  time?: { data: number[] };             // seconds from start
}

export type BriefingType = 'pre_workout' | 'post_run' | 'weekly_digest' | 'suggestion' | 'race_week';

export interface BriefingCache {
  id: string;
  type: BriefingType;
  date: string;
  context_hash: string;
  content: string;
  created_at: string;
}

// ─── Cloud Backup Types ─────────────────────────────────────

export interface BackupData {
  version: number;             // schema version for future compatibility
  createdAt: string;           // ISO timestamp
  deviceName: string;
  appVersion: string;
  userProfile: any;            // full user_profile row
  trainingPlan: any;           // active plan
  trainingWeeks: any[];        // all weeks
  workouts: any[];             // all workouts
  performanceMetrics: any[];   // all metrics
  coachMessages: any[];        // chat history
  adaptiveLogs: any[];         // adaptive engine history
  healthSnapshots: any[];      // last 30 days of health data
  stravaReference: {           // Strava connection info (legacy, tokens excluded)
    athleteId: number | null;
    athleteName: string | null;
  } | null;
  stravaTokens?: {             // Full Strava OAuth tokens for seamless restore
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete_id: number;
    athlete_name: string | null;
  } | null;
  appSettings: any;            // any settings
  briefingCache: any[];        // AI briefing cache
  stravaDetails: any[];        // Strava activity details (splits, etc.)
}

export interface BackupInfo {
  exists: boolean;
  createdAt: string | null;
  deviceName: string | null;
  appVersion: string | null;
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
