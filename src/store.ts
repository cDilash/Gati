import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import {
  UserProfile, TrainingPlan, TrainingWeek, Workout, PaceZones, HRZones,
  PerformanceMetric, GeneratedPlan, PlanGeneratorConfig, TrainingContext,
  Phase, AdaptiveLog, WorkoutAdjustment, PlanReconciliation, VDOTUpdateResult,
  RecoveryStatus, HealthSnapshot,
} from './types';
import {
  getUserProfile, saveUserProfile, getActivePlan, getWeeksForPlan,
  getAllWorkoutsForPlan, getWorkoutByDate, updateWorkoutStatus as dbUpdateWorkoutStatus,
  savePlan, getCurrentWeek, getRecentMetrics, getWeeklyVolumeTrend,
  getWorkoutsForWeek, updateWorkout as dbUpdateWorkout,
  saveAdaptiveLog, getRecentAdaptiveLogs, getUnacknowledgedAdaptiveLogs,
  acknowledgeAdaptiveLog as dbAcknowledgeLog, getMetricsForDateRange,
  getCompletedWorkoutsForDateRange, getFutureWorkouts,
} from './db/client';
import { calculatePaceZones, calculateHRZones } from './engine/paceZones';
import { generatePlan } from './engine/planGenerator';
import {
  calculateACWR, checkACWRSafety, evaluateVDOTUpdate,
  reconcileWeek, triageMissedWorkout,
} from './engine/adaptiveEngine';
import { calculateRecoveryScore } from './engine/recoveryScore';
import { getHealthSnapshot, isHealthSnapshotFresh, saveHealthSnapshot } from './db/client';

// Read/write lastReconciliationWeek from app_settings (same table as settingsStore)
function readSetting(key: string): string | null {
  try {
    const SQLite = require('expo-sqlite');
    const db = SQLite.openDatabaseSync('marathon_coach.db');
    const row = (db as any).getFirstSync('SELECT value FROM app_settings WHERE key = ?', key) as { value: string } | null;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    const SQLite = require('expo-sqlite');
    const db = SQLite.openDatabaseSync('marathon_coach.db');
    db.runSync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', key, value);
  } catch {
    // Silently fail
  }
}

interface AppState {
  // Data
  userProfile: UserProfile | null;
  activePlan: TrainingPlan | null;
  weeks: TrainingWeek[];
  allWorkouts: Workout[];
  currentWeek: TrainingWeek | null;
  todaysWorkout: Workout | null;
  paceZones: PaceZones | null;
  hrZones: HRZones | null;
  isInitialized: boolean;
  isLoading: boolean;

  // Adaptive state
  currentACWR: number;
  adaptiveLogs: AdaptiveLog[];
  lastReconciliation: PlanReconciliation | null;
  lastVDOTUpdate: VDOTUpdateResult | null;
  recoveryStatus: RecoveryStatus | null;

  // Actions
  initializeApp: () => void;
  setUserProfile: (profile: UserProfile) => void;
  generateAndSavePlan: (config: PlanGeneratorConfig) => GeneratedPlan;
  markWorkoutComplete: (workoutId: string) => void;
  markWorkoutSkipped: (workoutId: string) => void;
  refreshTodaysWorkout: () => void;
  refreshPlan: () => void;
  getTrainingContext: () => TrainingContext | null;
  applyWorkoutUpdate: (workoutId: string, changes: Partial<Workout>) => void;
  acknowledgeAdaptiveLog: (logId: string) => void;
  getAdaptiveSummary: () => string;
  syncHealthData: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  userProfile: null,
  activePlan: null,
  weeks: [],
  allWorkouts: [],
  currentWeek: null,
  todaysWorkout: null,
  paceZones: null,
  hrZones: null,
  isInitialized: false,
  isLoading: true,

  // Adaptive state
  currentACWR: 1.0,
  adaptiveLogs: [],
  lastReconciliation: null,
  lastVDOTUpdate: null,
  recoveryStatus: null,

  initializeApp: () => {
    const profile = getUserProfile();
    if (!profile) {
      set({ isInitialized: true, isLoading: false });
      return;
    }

    const paceZones = calculatePaceZones(profile.vdot);
    const hrZones = calculateHRZones(profile.max_hr, profile.resting_hr);
    const plan = getActivePlan();

    let weeks: TrainingWeek[] = [];
    let allWorkouts: Workout[] = [];
    let currentWeek: TrainingWeek | null = null;
    let todaysWorkout: Workout | null = null;
    let currentACWR = 1.0;

    if (plan) {
      weeks = getWeeksForPlan(plan.id);
      allWorkouts = getAllWorkoutsForPlan(plan.id);
      currentWeek = getCurrentWeek(plan.id);
      const today = new Date().toISOString().split('T')[0];
      todaysWorkout = getWorkoutByDate(today);

      // Calculate current ACWR
      const day28Ago = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
      const recentMetrics = getMetricsForDateRange(day28Ago, today);
      currentACWR = calculateACWR(recentMetrics, today);

      // Weekly reconciliation check
      if (currentWeek) {
        const lastReconWeek = parseInt(readSetting('lastReconciliationWeek') || '0', 10);
        const currentWeekNum = currentWeek.week_number;

        if (currentWeekNum > lastReconWeek && lastReconWeek > 0) {
          const gap = currentWeekNum - lastReconWeek;

          // Determine which week to reconcile
          const weekToReconcile = gap >= 2
            ? weeks.find(w => w.week_number === currentWeekNum - 1)
            : weeks.find(w => w.week_number === lastReconWeek);

          if (weekToReconcile) {
            const weekWorkouts = allWorkouts.filter(w => w.week_id === weekToReconcile.id);
            const weekMetrics = getMetricsForDateRange(weekToReconcile.start_date, weekToReconcile.end_date);
            const futureWorkouts = allWorkouts.filter(
              w => w.date > weekToReconcile.end_date && w.status === 'scheduled'
            );

            const reconciliation = reconcileWeek(
              weekToReconcile, weekWorkouts, weekMetrics, futureWorkouts, currentACWR
            );

            // Flag AI analysis for multi-week gaps
            if (gap >= 2) {
              reconciliation.aiAnalysisNeeded = true;
            }

            // Apply adjustments
            const updatedWorkouts = applyAdjustments(allWorkouts, reconciliation.adjustments);
            allWorkouts = updatedWorkouts;

            // Evaluate VDOT update if 2+ quality sessions completed
            const qualityTypes = ['tempo', 'interval', 'marathon_pace'];
            const completedQuality = weekWorkouts.filter(
              w => w.status === 'completed' && qualityTypes.includes(w.workout_type)
            );

            // Look at last 3 weeks for VDOT evidence
            const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
            const recentQualityWorkouts = allWorkouts.filter(
              w => w.status === 'completed' && qualityTypes.includes(w.workout_type) && w.date >= threeWeeksAgo
            );
            const qualityMetrics = getMetricsForDateRange(threeWeeksAgo, today);

            // Build workout-metric pairs
            const workoutMetricPairs = recentQualityWorkouts
              .map(w => {
                const metric = qualityMetrics.find(m => m.workout_id === w.id);
                return metric ? { workout: w, metric } : null;
              })
              .filter((wm): wm is { workout: Workout; metric: PerformanceMetric } => wm !== null);

            let vdotUpdate: VDOTUpdateResult | null = null;
            if (workoutMetricPairs.length >= 2) {
              vdotUpdate = evaluateVDOTUpdate(workoutMetricPairs, profile.vdot, paceZones, hrZones, get().recoveryStatus);
              reconciliation.vdotUpdate = vdotUpdate;

              if (vdotUpdate) {
                // Update profile VDOT
                const updatedProfile = { ...profile, vdot: vdotUpdate.newVDOT, updated_at: new Date().toISOString() };
                saveUserProfile(updatedProfile);
                profile.vdot = vdotUpdate.newVDOT;

                // Recalculate pace zones
                const newPaceZones = calculatePaceZones(vdotUpdate.newVDOT);
                Object.assign(paceZones, newPaceZones);
              }
            }

            // Log reconciliation
            const reconLog: AdaptiveLog = {
              id: Crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: 'weekly_reconciliation',
              summary: `Week ${weekToReconcile.week_number}: ${Math.round(reconciliation.actualVolume)}/${Math.round(reconciliation.plannedVolume)}mi (${Math.round(reconciliation.completionRate * 100)}% completion)${vdotUpdate ? `, VDOT ${vdotUpdate.previousVDOT} → ${vdotUpdate.newVDOT}` : ''}`,
              adjustments: reconciliation.adjustments,
              metadata: {
                weekNumber: weekToReconcile.week_number,
                acwr: currentACWR,
                gap,
                vdotUpdate: vdotUpdate || undefined,
                aiAnalysisNeeded: reconciliation.aiAnalysisNeeded,
              },
            };
            saveAdaptiveLog(reconLog);

            writeSetting('lastReconciliationWeek', String(currentWeekNum));

            set({
              lastReconciliation: reconciliation,
              lastVDOTUpdate: vdotUpdate,
            });
          }
        } else if (lastReconWeek === 0 && currentWeekNum > 1) {
          // First time — just set the marker
          writeSetting('lastReconciliationWeek', String(currentWeekNum));
        }
      }
    }

    const adaptiveLogs = getRecentAdaptiveLogs(7);

    set({
      userProfile: profile,
      activePlan: plan,
      weeks,
      allWorkouts,
      currentWeek,
      todaysWorkout,
      paceZones,
      hrZones,
      currentACWR,
      adaptiveLogs,
      isInitialized: true,
      isLoading: false,
    });
  },

  setUserProfile: (profile: UserProfile) => {
    saveUserProfile(profile);
    const paceZones = calculatePaceZones(profile.vdot);
    const hrZones = calculateHRZones(profile.max_hr, profile.resting_hr);
    set({ userProfile: profile, paceZones, hrZones });
  },

  generateAndSavePlan: (config: PlanGeneratorConfig) => {
    const generated = generatePlan(config);
    savePlan(generated);

    const currentWeek = getCurrentWeek(generated.plan.id);
    const today = new Date().toISOString().split('T')[0];
    const todaysWorkout = generated.workouts.find(w => w.date === today) || null;

    // Initialize reconciliation marker
    writeSetting('lastReconciliationWeek', String(currentWeek?.week_number || 1));

    set({
      activePlan: generated.plan,
      weeks: generated.weeks,
      allWorkouts: generated.workouts,
      currentWeek,
      todaysWorkout,
    });

    return generated;
  },

  markWorkoutComplete: (workoutId: string) => {
    // 1. Update status in SQLite
    dbUpdateWorkoutStatus(workoutId, 'completed');

    const state = get();
    let updatedWorkouts = state.allWorkouts.map(w =>
      w.id === workoutId ? { ...w, status: 'completed' as const } : w
    );
    let todaysWorkout = state.todaysWorkout?.id === workoutId
      ? { ...state.todaysWorkout, status: 'completed' as const }
      : state.todaysWorkout;

    // 2. Calculate ACWR
    const today = new Date().toISOString().split('T')[0];
    const day28Ago = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    const recentMetrics = getMetricsForDateRange(day28Ago, today);
    const acwr = calculateACWR(recentMetrics, today);

    // 3. Check ACWR safety
    let newLogs: AdaptiveLog[] = [];
    if (acwr > 1.3) {
      const futureScheduled = updatedWorkouts.filter(
        w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
      );
      const adjustments = checkACWRSafety(acwr, futureScheduled, today, get().recoveryStatus);

      if (adjustments.length > 0) {
        updatedWorkouts = applyAdjustments(updatedWorkouts, adjustments);

        const log: AdaptiveLog = {
          id: Crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'acwr_adjustment',
          summary: `ACWR ${acwr.toFixed(2)} triggered safety adjustments for ${adjustments.length} workout(s)`,
          adjustments,
          metadata: { acwr, triggerWorkoutId: workoutId },
        };
        saveAdaptiveLog(log);
        newLogs.push(log);
      }
    }

    // Update today's workout if it was adjusted
    const updatedToday = updatedWorkouts.find(w => w.id === todaysWorkout?.id);
    if (updatedToday) todaysWorkout = updatedToday;

    set({
      allWorkouts: updatedWorkouts,
      todaysWorkout,
      currentACWR: acwr,
      adaptiveLogs: [...newLogs, ...state.adaptiveLogs],
    });
  },

  markWorkoutSkipped: (workoutId: string) => {
    // 1. Update status
    dbUpdateWorkoutStatus(workoutId, 'skipped');

    const state = get();
    const skippedWorkout = state.allWorkouts.find(w => w.id === workoutId);
    let updatedWorkouts = state.allWorkouts.map(w =>
      w.id === workoutId ? { ...w, status: 'skipped' as const } : w
    );
    let todaysWorkout = state.todaysWorkout?.id === workoutId
      ? { ...state.todaysWorkout, status: 'skipped' as const }
      : state.todaysWorkout;

    let newLogs: AdaptiveLog[] = [];

    // 2. Triage missed workout
    if (skippedWorkout && skippedWorkout.workout_type !== 'rest') {
      const remainingThisWeek = updatedWorkouts.filter(
        w => w.week_id === skippedWorkout.week_id &&
             w.id !== workoutId &&
             w.status === 'scheduled'
      );

      const triageAdjustments = triageMissedWorkout(skippedWorkout, remainingThisWeek);
      if (triageAdjustments.length > 0) {
        updatedWorkouts = applyAdjustments(updatedWorkouts, triageAdjustments);

        const log: AdaptiveLog = {
          id: Crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'missed_workout_triage',
          summary: `Skipped ${skippedWorkout.workout_type} on ${skippedWorkout.date}: redistributed to ${triageAdjustments.length} workout(s)`,
          adjustments: triageAdjustments,
          metadata: { skippedWorkoutId: workoutId, workoutType: skippedWorkout.workout_type },
        };
        saveAdaptiveLog(log);
        newLogs.push(log);
      }
    }

    // 3. ACWR check
    const today = new Date().toISOString().split('T')[0];
    const day28Ago = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    const recentMetrics = getMetricsForDateRange(day28Ago, today);
    const acwr = calculateACWR(recentMetrics, today);

    if (acwr > 1.3) {
      const futureScheduled = updatedWorkouts.filter(
        w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
      );
      const acwrAdjustments = checkACWRSafety(acwr, futureScheduled, today, get().recoveryStatus);
      if (acwrAdjustments.length > 0) {
        updatedWorkouts = applyAdjustments(updatedWorkouts, acwrAdjustments);

        const log: AdaptiveLog = {
          id: Crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'acwr_adjustment',
          summary: `ACWR ${acwr.toFixed(2)} triggered safety adjustments for ${acwrAdjustments.length} workout(s)`,
          adjustments: acwrAdjustments,
          metadata: { acwr, triggerWorkoutId: workoutId },
        };
        saveAdaptiveLog(log);
        newLogs.push(log);
      }
    }

    const updatedToday = updatedWorkouts.find(w => w.id === todaysWorkout?.id);
    if (updatedToday) todaysWorkout = updatedToday;

    set({
      allWorkouts: updatedWorkouts,
      todaysWorkout,
      currentACWR: acwr,
      adaptiveLogs: [...newLogs, ...state.adaptiveLogs],
    });
  },

  refreshTodaysWorkout: () => {
    const today = new Date().toISOString().split('T')[0];
    const todaysWorkout = getWorkoutByDate(today);
    const { activePlan } = get();
    const currentWeek = activePlan ? getCurrentWeek(activePlan.id) : null;
    set({ todaysWorkout, currentWeek });
  },

  refreshPlan: () => {
    const plan = getActivePlan();
    if (!plan) return;
    const weeks = getWeeksForPlan(plan.id);
    const allWorkouts = getAllWorkoutsForPlan(plan.id);
    const currentWeek = getCurrentWeek(plan.id);
    const today = new Date().toISOString().split('T')[0];
    const todaysWorkout = getWorkoutByDate(today);
    set({ activePlan: plan, weeks, allWorkouts, currentWeek, todaysWorkout });
  },

  applyWorkoutUpdate: (workoutId: string, changes: Partial<Workout>) => {
    dbUpdateWorkout(workoutId, changes);
    set(state => ({
      allWorkouts: state.allWorkouts.map(w =>
        w.id === workoutId ? { ...w, ...changes } : w
      ),
      todaysWorkout: state.todaysWorkout?.id === workoutId
        ? { ...state.todaysWorkout, ...changes }
        : state.todaysWorkout,
    }));
  },

  acknowledgeAdaptiveLog: (logId: string) => {
    dbAcknowledgeLog(logId);
    set(state => ({
      adaptiveLogs: state.adaptiveLogs.map(l =>
        l.id === logId ? { ...l, metadata: { ...l.metadata, acknowledged: true } } : l
      ),
    }));
  },

  getAdaptiveSummary: (): string => {
    const { currentACWR, adaptiveLogs, lastReconciliation, lastVDOTUpdate } = get();
    const lines: string[] = [];

    lines.push(`ACWR: ${currentACWR.toFixed(2)} (${currentACWR > 1.5 ? 'CRITICAL' : currentACWR > 1.3 ? 'ELEVATED' : currentACWR < 0.8 ? 'LOW/DETRAINING' : 'NORMAL'})`);

    if (lastVDOTUpdate) {
      lines.push(`VDOT UPDATE: ${lastVDOTUpdate.previousVDOT} → ${lastVDOTUpdate.newVDOT} (${lastVDOTUpdate.confidenceLevel} confidence — ${lastVDOTUpdate.reason})`);
    }

    if (lastReconciliation) {
      lines.push(`LAST WEEK: ${lastReconciliation.actualVolume}/${lastReconciliation.plannedVolume}mi (${Math.round(lastReconciliation.completionRate * 100)}% completion), ${lastReconciliation.adjustments.length} auto-adjustments`);
    }

    if (adaptiveLogs.length > 0) {
      lines.push(`RECENT ADAPTATIONS (${adaptiveLogs.length} in last 7 days):`);
      for (const log of adaptiveLogs.slice(0, 5)) {
        lines.push(`  - ${log.summary}`);
      }
    }

    return lines.join('\n');
  },

  syncHealthData: async () => {
    const { userProfile } = get();
    if (!userProfile) return;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Check cache first
    if (isHealthSnapshotFresh(todayStr)) {
      const cached = getHealthSnapshot(todayStr);
      if (cached) {
        const recentMetrics = getMetricsForDateRange(
          new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
          todayStr
        );
        const recoveryStatus = calculateRecoveryScore({
          snapshot: cached,
          profile: userProfile,
          recentMetrics,
          today: todayStr,
        });
        set({ recoveryStatus });
        return;
      }
    }

    // Fetch fresh data from HealthKit
    try {
      const { isHealthKitAvailable, initHealthKit, getDailyHealthSnapshot } = require('./health/healthkit');
      if (!isHealthKitAvailable()) return;

      const initialized = await initHealthKit();
      if (!initialized) return;

      const partial = await getDailyHealthSnapshot(today);

      // Count signals
      let signalCount = 0;
      if (partial.resting_hr != null) signalCount++;
      if (partial.hrv_sdnn != null && partial.hrv_trend_7d && partial.hrv_trend_7d.length >= 3) signalCount++;
      if (partial.sleep_hours != null && partial.sleep_quality != null) signalCount++;
      // Volume trend signal is calculated from metrics, always available if we have any
      const day7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const recentMetrics = getMetricsForDateRange(day7Ago, todayStr);
      const hasVolumeSignal = recentMetrics.length >= 3;
      if (hasVolumeSignal) signalCount++;

      const snapshot: HealthSnapshot = {
        id: partial.id || require('expo-crypto').randomUUID(),
        date: todayStr,
        resting_hr: partial.resting_hr ?? null,
        hrv_sdnn: partial.hrv_sdnn ?? null,
        hrv_trend_7d: partial.hrv_trend_7d ?? null,
        sleep_hours: partial.sleep_hours ?? null,
        sleep_quality: partial.sleep_quality ?? null,
        weight_lbs: partial.weight_lbs ?? null,
        steps: partial.steps ?? null,
        recovery_score: null, // calculated below
        signal_count: signalCount,
        cached_at: new Date().toISOString(),
      };

      // Calculate recovery score
      const recoveryStatus = calculateRecoveryScore({
        snapshot,
        profile: userProfile,
        recentMetrics,
        today: todayStr,
      });

      snapshot.recovery_score = recoveryStatus?.score ?? null;
      snapshot.signal_count = signalCount;

      // Save to SQLite cache
      saveHealthSnapshot(snapshot);

      // Update Zustand
      set({ recoveryStatus });
    } catch (e) {
      console.warn('Health sync failed (expected in Expo Go):', e);
    }
  },

  getTrainingContext: () => {
    const { userProfile, paceZones, hrZones, currentWeek, weeks, allWorkouts, todaysWorkout, activePlan, currentACWR, adaptiveLogs, lastVDOTUpdate, lastReconciliation, recoveryStatus } = get();
    if (!userProfile || !paceZones || !hrZones || !activePlan) return null;

    const today = new Date();
    const raceDate = new Date(userProfile.race_date);
    const daysUntilRace = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const thisWeekWorkouts = currentWeek
      ? allWorkouts.filter(w => w.week_id === currentWeek.id)
      : [];

    const recentMetrics = getRecentMetrics(7);
    const weeklyVolumeTrend = getWeeklyVolumeTrend(activePlan.id, 4);

    // Calculate adherence
    const completedWeeks = weeks.filter(w => {
      const weekEnd = new Date(w.end_date);
      return weekEnd < today;
    });
    let totalScheduled = 0;
    let totalCompleted = 0;
    for (const w of completedWeeks) {
      const wWorkouts = allWorkouts.filter(wo => wo.week_id === w.id && wo.workout_type !== 'rest');
      totalScheduled += wWorkouts.length;
      totalCompleted += wWorkouts.filter(wo => wo.status === 'completed').length;
    }
    const adherenceRate = totalScheduled > 0 ? totalCompleted / totalScheduled : 1;

    return {
      profile: userProfile,
      paceZones,
      hrZones,
      currentWeekNumber: currentWeek?.week_number || 1,
      totalWeeks: activePlan.total_weeks,
      currentPhase: (currentWeek?.phase || 'base') as Phase,
      daysUntilRace,
      thisWeekWorkouts,
      recentMetrics,
      weeklyVolumeTrend,
      adherenceRate,
      todaysWorkout: todaysWorkout || undefined,
      // Adaptive context
      currentACWR,
      recentAdaptiveLogs: adaptiveLogs,
      lastVDOTUpdate: lastVDOTUpdate || undefined,
      lastReconciliation: lastReconciliation || undefined,
      recoveryStatus: recoveryStatus || undefined,
    };
  },
}));

// ─── Helper: Apply adjustments to workout array + SQLite ────

function applyAdjustments(workouts: Workout[], adjustments: WorkoutAdjustment[]): Workout[] {
  const adjustMap = new Map(adjustments.map(a => [a.workoutId, a]));
  return workouts.map(w => {
    const adj = adjustMap.get(w.id);
    if (!adj) return w;

    const changes: Partial<Workout> = {
      original_distance_miles: w.original_distance_miles ?? w.distance_miles,
      adjustment_reason: adj.reason,
    };

    if (adj.adjustmentType === 'reduce_distance' || adj.adjustmentType === 'increase_distance') {
      changes.distance_miles = adj.newDistance;
    }
    if (adj.adjustmentType === 'convert_to_easy') {
      changes.workout_type = 'easy';
      changes.target_pace_zone = 'E';
      changes.intervals_json = undefined;
    }
    if (adj.adjustmentType === 'convert_to_rest') {
      changes.workout_type = 'rest';
      changes.distance_miles = 0;
      changes.intervals_json = undefined;
    }
    if (adj.newType !== adj.originalType) {
      changes.workout_type = adj.newType;
      if (adj.newType === 'long') changes.target_pace_zone = 'E';
    }

    // Persist to SQLite
    dbUpdateWorkout(w.id, changes);

    return { ...w, ...changes };
  });
}
