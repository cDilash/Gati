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
  source: 'healthkit' | 'manual';
  distance_miles: number;
  duration_seconds: number;
  avg_pace_per_mile: number;
  avg_hr?: number;
  max_hr?: number;
  calories?: number;
  route_json?: string;
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
