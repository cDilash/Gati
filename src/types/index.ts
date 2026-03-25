// ─── Core Enums ──────────────────────────────────────────────

export type Phase = 'base' | 'build' | 'peak' | 'taper';
export type PaceZoneName = 'E' | 'M' | 'T' | 'I' | 'R';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type WorkoutStatus = 'upcoming' | 'completed' | 'skipped' | 'modified' | 'partial';

// ─── User Profile ────────────────────────────────────────────

export interface UserProfile {
  id: number;  // always 1 (single-row)
  name: string | null;
  age: number;
  gender: 'male' | 'female';
  weight_kg: number | null;
  height_cm: number | null;
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
  weight_source: 'manual' | 'garmin' | 'strava' | null;
  weight_updated_at: string | null;
  vdot_updated_at: string | null;
  vdot_source: 'manual' | 'strava_race' | 'strava_best_effort' | 'ai_adaptation' | 'garmin_personal_record' | 'garmin_race_prediction' | 'garmin_vo2max' | null;
  vdot_confidence: 'high' | 'moderate' | 'low' | null;
  avatar_base64: string | null;
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
  execution_quality: 'on_target' | 'missed_pace' | 'exceeded_pace' | 'wrong_type' | null;
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
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  startLat: number | null;
  startLng: number | null;
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
  trainingPlans?: any[];
  trainingWeeks: any[];
  workouts: any[];
  performanceMetrics: any[];
  coachMessages: any[];
  shoes?: any[];
  appSettings: any[] | any;
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
  crossTraining?: any[];
  trainingLoadCache?: any[];
  deletedStravaActivities?: any[];
}

export interface BackupInfo {
  exists: boolean;
  createdAt: string | null;
  deviceName: string | null;
  appVersion: string | null;
}

// ─── Weekly Planning (Week-by-Week Adaptive) ────────────────

export type WeekDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type EnergyLevel = 'high' | 'moderate' | 'low' | 'exhausted';
export type SorenessLevel = 'none' | 'mild' | 'moderate' | 'severe';
export type SleepQualityLevel = 'great' | 'ok' | 'poor' | 'terrible';
export type PhaseName = 'base' | 'build' | 'peak' | 'taper' | 'race_week';

export interface WeeklyCheckin {
  id: string;
  weekNumber: number;
  raceWeekNumber: number; // countdown to race
  createdAt: string;
  strengthDays: WeekDay[];
  legDay: WeekDay | null; // primary leg day (first in legDays) — for backward compat
  legDays: WeekDay[]; // all leg days
  availableDays: WeekDay[];
  preferredLongRunDay: WeekDay;
  timeConstraints: string | null;
  energyLevel: EnergyLevel;
  soreness: SorenessLevel;
  injuryStatus: string | null;
  sleepQuality: SleepQualityLevel;
  notes: string | null;
}

export interface TrainingPhaseInfo {
  phase: PhaseName;
  weekNumber: number;
  targetWeeklyMiles: number;
  weeksUntilRace: number;
}

export interface GeneratedWorkout {
  day: WeekDay;
  date: string;
  type: string;
  distanceMiles: number;
  description: string;
  targetPaceZone: string;
  hrZone: string;
  notes: string | null;
}

export interface GeneratedWeek {
  weekNumber: number;
  phase: PhaseName;
  totalPlannedMiles: number;
  rationale: string;
  workouts: GeneratedWorkout[];
}

export interface WeekGeneration {
  id: string;
  weekNumber: number;
  checkinId: string;
  phase: PhaseName;
  generatedAt: string;
  promptSummary: string | null;
  aiResponse: string | null;
  accepted: boolean;
  rejectedReason: string | null;
}

export interface PreviousWeekSummary {
  weekNumber: number;
  plannedMiles: number;
  actualMiles: number;
  completedRuns: number;
  totalRuns: number;
  runs: {
    date: string;
    type: string;
    distanceMiles: number;
    paceSecPerMile: number | null;
    avgHR: number | null;
    status: string;
  }[];
  recoveryScoreAvg: number | null;
  garminVO2max: number | null;
  garminTrainingStatus: string | null;
  garminACWR: number | null;
}

// ─── Health / Recovery ───────────────────────────────────────

export interface RestingHRResult {
  value: number;
  date: string;
}

export interface HRVResult {
  value: number;
  date: string;
}

export interface SleepStages {
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
}

export interface SleepResult {
  totalMinutes: number;
  date: string;
  bedStart: string;
  bedEnd: string;
  stages: SleepStages | null;
  isLikelyIncomplete: boolean;
}

export interface WeightResult {
  value: number;
  date: string;
}

export interface VO2MaxResult {
  value: number;
  date: string;
}

export interface RespiratoryRateResult {
  value: number;
  date: string;
}

export interface SpO2Result {
  value: number;
  date: string;
}

export interface HealthSnapshot {
  date: string;
  restingHR: number | null;
  hrvRMSSD: number | null;
  sleepHours: number | null;
  restingHRTrend: RestingHRResult[];
  hrvTrend: HRVResult[];
  sleepTrend: SleepResult[];
  weight: WeightResult | null;
  vo2max: VO2MaxResult | null;
  respiratoryRate: number | null;
  respiratoryRateTrend: RespiratoryRateResult[];
  spo2: number | null;
  spo2Trend: SpO2Result[];
  steps: number | null;
  stepsTrend: { date: string; steps: number }[];
  restingHRAge: number | null;  // hours since last reading
  sleepAge: number | null;      // hours since last reading
  signalCount: number;
  cachedAt: string;
}

export interface RecoverySignal {
  type: 'resting_hr' | 'hrv' | 'sleep' | 'respiratory_rate' | 'body_battery' | 'garmin_hrv';
  value: number | null;
  baseline: number | null;
  status: 'good' | 'fair' | 'poor';
  score: number;
  detail: string;
  source?: 'garmin';
}

export interface RecoveryStatus {
  score: number;
  signalCount: number;
  level: 'ready' | 'moderate' | 'fatigued' | 'rest' | 'unknown';
  signals: RecoverySignal[];
  recommendation: string;
  sleepPending: boolean;  // true when last night's sleep hasn't synced yet (morning window)
  sleepMissing: boolean;  // true after 10am when sleep still absent (likely didn't wear watch)
}

// ─── Cross-Training ──────────────────────────────────────────

export type CrossTrainingType =
  | 'leg_day'
  | 'upper_body'
  | 'full_body'
  | 'cycling'
  | 'swimming'
  | 'yoga_mobility'
  | 'other';

export type CrossTrainingImpact = 'high' | 'moderate' | 'low' | 'positive';

export interface CrossTraining {
  id: string;
  date: string;
  type: CrossTrainingType;
  impact: CrossTrainingImpact;
  notes: string | null;
  createdAt: string;
}

export const CROSS_TRAINING_IMPACT: Record<CrossTrainingType, CrossTrainingImpact> = {
  leg_day: 'high',
  full_body: 'moderate',
  upper_body: 'low',
  cycling: 'moderate',
  swimming: 'moderate',
  yoga_mobility: 'positive',
  other: 'low',
};

export const CROSS_TRAINING_LABELS: Record<CrossTrainingType, string> = {
  leg_day: 'Leg Day (Heavy)',
  upper_body: 'Upper Body',
  full_body: 'Full Body',
  cycling: 'Cycling',
  swimming: 'Swimming',
  yoga_mobility: 'Yoga / Mobility',
  other: 'Other',
};

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

// ─── Training Load (PMC) ─────────────────────────────────────

export type TRIMPMethod = 'hr' | 'pace' | 'simple' | 'rest';

export interface TRIMPInput {
  durationMinutes: number;
  distanceMiles: number;
  avgHR: number | null;
  maxHR: number | null;        // athlete's max HR
  restHR: number | null;       // athlete's resting HR
  gender: 'male' | 'female';
  avgPaceSecPerMile: number | null;
  paceZones: PaceZones | null;
}

export interface TRIMPResult {
  score: number;               // the training stress value
  method: TRIMPMethod;         // which calculation method was used
  intensity: number;           // 0-1 normalized intensity
}

export interface DailyTrainingLoad {
  date: string;
  trimp: number;
  method: TRIMPMethod;
  workoutCount: number;
  workoutTypes: string[];      // e.g. ['easy', 'threshold']
}

export interface PMCDayData {
  date: string;
  trimp: number;
  ctl: number;                 // Chronic Training Load (fitness)
  atl: number;                 // Acute Training Load (fatigue)
  tsb: number;                 // Training Stress Balance (form)
  workoutCount: number;
  workoutTypes: string[];
  method: TRIMPMethod;
  isProjected: boolean;        // true for future dates
}

export type PMCDataQuality = 'high' | 'moderate' | 'low';

export interface PMCData {
  daily: PMCDayData[];
  currentCTL: number;
  currentATL: number;
  currentTSB: number;
  peakCTL: number;
  peakCTLDate: string | null;
  raceDayTSB: number | null;
  raceDayProjectedCTL: number | null;
  dataQuality: PMCDataQuality;
  hrMethodPercent: number;     // % of days using HR-based TRIMP
  totalDays: number;
  projectedDays: number;
}

// ─── Garmin Connect Health Data ──────────────────────────────

export interface GarminHealthData {
  date: string;
  hrvLastNightAvg: number | null;    // RMSSD ms
  hrvWeeklyAvg: number | null;
  hrvBaselineLow: number | null;
  hrvBaselineHigh: number | null;
  hrvStatus: string | null;          // BALANCED, UNBALANCED, LOW, POOR
  vo2max: number | null;             // ml/kg/min
  bodyBatteryMorning: number | null; // 0-100
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  stressAvg: number | null;          // 1-100
  stressHigh: number | null;
  respiratoryRate: number | null;    // breaths/min
  spo2Avg: number | null;            // %
  trainingReadiness: number | null;  // 0-100
  trainingStatus: string | null;     // Productive, Maintaining, etc.
  trainingLoad7day: number | null;
  acwr: number | null;
  acwrStatus: string | null;         // LOW, OPTIMAL, HIGH
  sleepScore: number | null;         // 0-100
  intensityMinutesVigorous: number | null;
  intensityMinutesModerate: number | null;
  restingHr: number | null;          // bpm
  // NEW: Tier 1 fields
  readinessFeedbackShort: string | null;  // RESTED_AND_READY, WELL_RECOVERED, etc.
  readinessFeedbackLong: string | null;
  recoveryTimeHours: number | null;       // hours until fully recovered
  predictedMarathonSec: number | null;    // race prediction in seconds
  predicted5kSec: number | null;
  predicted10kSec: number | null;
  predictedHalfSec: number | null;
  sleepSubscores: { remPercentage?: number; lightPercentage?: number; deepPercentage?: number; [key: string]: number | undefined } | null;
  sleepNeedMinutes: number | null;        // baseline sleep need
  sleepDebtMinutes: number | null;        // sleep deficit
  // Tier 2 fields
  enduranceScore: number | null;          // Garmin endurance score
  enduranceClassification: number | null; // classification level
  skinTempDeviationC: number | null;      // °C deviation from baseline (illness indicator)
  // Tier 3 fields
  maxHrDaily: number | null;              // daily max heart rate
  minHrDaily: number | null;              // daily min heart rate
  rhr7dayAvg: number | null;              // 7-day resting HR average
  stressQualifier: string | null;         // LOW, MEDIUM, HIGH, STRESSFUL
  bbAtWake: number | null;                // Body Battery at wake time
  hrv5minHigh: number | null;             // HRV 5-minute peak overnight
  hrvFeedback: string | null;             // HRV_BALANCED_5, etc.
  minSpo2: number | null;                 // lowest SpO2 during sleep
  sleepAwakeCount: number | null;         // number of awakenings
  avgSleepStress: number | null;          // stress level during sleep
  hillScore: number | null;               // terrain readiness
  hillEndurance: number | null;
  hillStrength: number | null;
  lactateThresholdHr: number | null;      // LT heart rate (bpm)
  lactateThresholdSpeed: number | null;   // LT speed (m/s)
  vo2maxFitnessAge: number | null;        // fitness age from VO2max
  floorsClimbed: number | null;           // daily floors
  sleepDurationSec: number | null;       // actual sleep time in seconds
  sleepDeepSec: number | null;           // deep sleep seconds
  sleepLightSec: number | null;          // light sleep seconds
  sleepRemSec: number | null;            // REM sleep seconds
  sleepAwakeSec: number | null;          // awake time seconds
  sleepStart: string | null;             // bed start time (local ISO)
  sleepEnd: string | null;               // wake time (local ISO)
  fetchedAt: string;
}

// ─── Personal Records ────────────────────────────────────────

export interface PersonalRecord {
  distance: string;        // "1 mile", "5K", etc.
  timeSeconds: number;     // fastest moving_time
  date: string;            // YYYY-MM-DD
  activityId: number | null; // strava_activity_id
}

export interface NewPRNotification {
  prs: { distance: string; time: number; previousTime: number | null; previousDate: string | null }[];
  activityId: number | null;
  activityDate: string;
}
