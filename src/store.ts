import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import {
  UserProfile, TrainingPlan, TrainingWeek, Workout, PaceZones, HRZones,
  PerformanceMetric, GeneratedPlan, PlanGeneratorConfig, TrainingContext,
  Phase, AdaptiveLog, WorkoutAdjustment, PlanReconciliation, VDOTUpdateResult,
  RecoveryStatus, HealthSnapshot, BackupInfo, Shoe, ShoeAlert,
  BanisterState, AdaptiveEventContext,
} from './types';
import {
  getUserProfile, saveUserProfile, getActivePlan, getWeeksForPlan,
  getAllWorkoutsForPlan, getWorkoutByDate, updateWorkoutStatus as dbUpdateWorkoutStatus,
  savePlan, getCurrentWeek, getRecentMetrics, getWeeklyVolumeTrend,
  getWorkoutsForWeek, updateWorkout as dbUpdateWorkout,
  saveAdaptiveLog, getRecentAdaptiveLogs, getUnacknowledgedAdaptiveLogs,
  acknowledgeAdaptiveLog as dbAcknowledgeLog, getMetricsForDateRange,
  getCompletedWorkoutsForDateRange, getFutureWorkouts,
  savePerformanceMetric, getMetricsForWorkout,
  saveCoachMessage, getLatestConversationId,
  getStravaDetailForWorkout, deleteActivePlan,
} from './db/client';
import { calculatePaceZones, calculateHRZones } from './engine/paceZones';
import { generatePlan } from './engine/planGenerator';
import {
  calculateACWR, checkACWRSafety, evaluateVDOTUpdate,
  reconcileWeek, triageMissedWorkout, assessRPETrend, RPETrend,
} from './engine/adaptiveEngine';
import { calculateRecoveryScore } from './engine/recoveryScore';
import { calculateBanisterState } from './engine/banister';
import { getAdaptiveAIDecision, reviewReplanWithAI } from './ai/adaptiveAI';
import { checkReplanTriggers } from './engine/replanTriggers';
import { replanFromCurrentState } from './engine/planGenerator';
import { getHealthSnapshot, isHealthSnapshotFresh, saveHealthSnapshot, getDatabase, getStravaDetailsForMetrics, deleteScheduledFutureWorkouts, getRecentActualMileage, getWeeklyCompletionHistory } from './db/client';
import { getToday, toLocalDateString } from './utils/dateUtils';

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
  rpeTrend: RPETrend | null;
  banisterState: BanisterState | null;
  pendingAIReview: boolean;
  lastAdaptiveSummary: string | null;
  replanModal: { visible: boolean; reason: string; summary: string } | null;

  // AI briefing state
  preWorkoutBriefing: string | null;
  isLoadingBriefing: boolean;
  postRunAnalysis: string | null;
  showPostRunAnalysis: boolean;
  weeklyDigest: import('./ai/digest').WeeklyDigest | null;
  hasUnreadDigest: boolean;
  isRaceWeek: boolean;
  raceWeekBriefing: import('./ai/raceWeek').RaceWeekBriefing | null;
  isLoadingRaceWeek: boolean;
  restDaySuggestion: string | null;

  // Cloud backup state
  backupInfo: BackupInfo | null;
  isBackingUp: boolean;
  backupError: string | null;
  isRestoring: boolean;
  restoreError: string | null;

  // Shoe tracking
  shoes: Shoe[];
  shoeAlerts: ShoeAlert[];

  // VDOT suggestion from Strava PR
  pendingVDOTSuggestion: { vdot: number; distance: string; prTime: string } | null;

  // Actions
  initializeApp: () => void;
  setUserProfile: (profile: UserProfile) => void;
  generateAndSavePlan: (config: PlanGeneratorConfig) => GeneratedPlan;
  regeneratePlan: () => void;
  markWorkoutComplete: (workoutId: string) => void;
  markWorkoutSkipped: (workoutId: string) => void;
  refreshTodaysWorkout: () => void;
  refreshPlan: () => void;
  getTrainingContext: () => TrainingContext | null;
  applyWorkoutUpdate: (workoutId: string, changes: Partial<Workout>) => void;
  acknowledgeAdaptiveLog: (logId: string) => void;
  getAdaptiveSummary: () => string;
  syncHealthData: () => Promise<void>;
  syncStravaData: () => Promise<void>;
  syncWorkoutFromHealthKit: () => Promise<void>;
  fetchPreWorkoutBriefing: () => Promise<void>;
  dismissPostRunAnalysis: () => void;
  dismissWeeklyDigest: () => void;
  fetchRaceWeekBriefing: () => Promise<void>;
  fetchRestDaySuggestion: () => Promise<void>;

  // Cloud backup actions
  performBackup: () => Promise<void>;
  checkBackupStatus: () => Promise<void>;
  performRestore: () => Promise<{ success: boolean; error?: string }>;

  // Shoe sync
  syncShoes: () => Promise<void>;

  // VDOT from PR
  applyVDOTSuggestion: () => void;
  dismissVDOTSuggestion: () => void;
  triggerReplan: (reason: string) => Promise<void>;
  dismissReplanModal: () => void;
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
  rpeTrend: null,
  banisterState: null,
  pendingAIReview: false,
  lastAdaptiveSummary: null,
  replanModal: null,

  // AI briefing state
  preWorkoutBriefing: null,
  isLoadingBriefing: false,
  postRunAnalysis: null,
  showPostRunAnalysis: false,
  weeklyDigest: null,
  hasUnreadDigest: false,
  isRaceWeek: false,
  raceWeekBriefing: null,
  isLoadingRaceWeek: false,
  restDaySuggestion: null,

  // Cloud backup
  backupInfo: null,
  isBackingUp: false,
  backupError: null,
  isRestoring: false,
  restoreError: null,

  // Shoe tracking
  shoes: [],
  shoeAlerts: [],

  // VDOT suggestion
  pendingVDOTSuggestion: null,

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
      const today = getToday();
      todaysWorkout = getWorkoutByDate(today);

      // Calculate current ACWR
      const day28Ago = toLocalDateString(new Date(Date.now() - 28 * 86400000));
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
            const threeWeeksAgo = toLocalDateString(new Date(Date.now() - 21 * 86400000));
            const recentQualityWorkouts = allWorkouts.filter(
              w => w.status === 'completed' && qualityTypes.includes(w.workout_type) && w.date >= threeWeeksAgo
            );
            const qualityMetrics = getMetricsForDateRange(threeWeeksAgo, today);

            // Build workout-metric pairs, enriched with Strava workout type for RPE-aware VDOT
            const workoutMetricPairs = recentQualityWorkouts
              .map(w => {
                const metric = qualityMetrics.find(m => m.workout_id === w.id);
                if (!metric) return null;
                let stravaWorkoutType: number | null = null;
                try {
                  const detail = getStravaDetailForWorkout(w.id);
                  stravaWorkoutType = detail?.strava_workout_type ?? null;
                } catch { /* Not critical */ }
                return { workout: w, metric, stravaWorkoutType };
              })
              .filter((wm): wm is { workout: Workout; metric: PerformanceMetric; stravaWorkoutType: number | null } => wm !== null);

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

            // Fire-and-forget: generate weekly digest
            (async () => {
              try {
                const { generateWeeklyDigest } = require('./ai/digest');

                // Find upcoming week
                const upcomingWeek = weeks.find(w => w.week_number === weekToReconcile.week_number + 1) || null;
                const upcomingWorkouts = upcomingWeek
                  ? allWorkouts.filter(w => w.week_id === upcomingWeek.id)
                  : [];

                // Gather recovery scores for the week (placeholder — uses snapshot data if available)
                const recoveryScores: number[] = [];

                const digest = await generateWeeklyDigest(
                  weekToReconcile,
                  weekWorkouts,
                  weekMetrics,
                  reconciliation,
                  recoveryScores,
                  upcomingWeek,
                  upcomingWorkouts,
                );

                if (digest.headline && digest.headline !== 'Weekly summary unavailable') {
                  set({ weeklyDigest: digest, hasUnreadDigest: true });
                }
              } catch {
                // Digest generation failed — silently skip
              }
            })();
          }
        } else if (lastReconWeek === 0 && currentWeekNum > 1) {
          // First time — just set the marker
          writeSetting('lastReconciliationWeek', String(currentWeekNum));
        }
      }
    }

    const adaptiveLogs = getRecentAdaptiveLogs(7);

    // Load cached shoes (sync happens separately via syncStravaData)
    let shoes: Shoe[] = [];
    let shoeAlerts: ShoeAlert[] = [];
    try {
      const { getAllShoes, checkShoeMileage } = require('./strava/shoes');
      shoes = getAllShoes();
      shoeAlerts = checkShoeMileage(shoes);
    } catch {
      // Not critical
    }

    // Check if we're in race week
    let isRaceWeek = false;
    if (profile.race_date) {
      const raceDate = new Date(profile.race_date);
      const daysUntilRace = Math.ceil((raceDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      isRaceWeek = daysUntilRace >= 0 && daysUntilRace <= 7;
    }

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
      isRaceWeek,
      isInitialized: true,
      isLoading: false,
      shoes,
      shoeAlerts,
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
    const today = getToday();
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

  regeneratePlan: () => {
    const { userProfile } = get();
    if (!userProfile) return;

    // Build config from current profile
    const config: PlanGeneratorConfig = {
      startDate: getToday(),
      raceDate: userProfile.race_date,
      currentWeeklyMileage: userProfile.current_weekly_mileage,
      vdot: userProfile.vdot,
      level: userProfile.level as any,
      availableDays: userProfile.available_days,
      preferredLongRunDay: userProfile.preferred_long_run_day,
      longestRecentRun: userProfile.longest_recent_run,
    };

    deleteActivePlan();
    get().generateAndSavePlan(config);

    // Re-sync Strava to rematch orphaned metrics to the new plan
    (async () => {
      try { await get().syncStravaData(); } catch {}
    })();
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

    // 2. Adaptive cascade: AI-Gated
    const today = getToday();
    const day28Ago = toLocalDateString(new Date(Date.now() - 28 * 86400000));
    const recentMetrics = getMetricsForDateRange(day28Ago, today);
    const acwr = calculateACWR(recentMetrics, today);
    const profile = state.userProfile!;
    const paceZones = state.paceZones!;

    // Banister readiness
    const banisterState = calculateBanisterState(recentMetrics, profile, paceZones, today);

    // RPE trend
    const day7Ago = toLocalDateString(new Date(Date.now() - 7 * 86400000));
    const recentForRPE = getMetricsForDateRange(day7Ago, today);
    const rpeTrend = assessRPETrend(recentForRPE);
    const recentRPEAvg = rpeTrend.sampleSize >= 3 ? rpeTrend.avgRPE : null;

    // 3. Deterministic proposals
    let proposedAdjustments: WorkoutAdjustment[] = [];
    if (acwr > 1.3 || (recentRPEAvg != null && recentRPEAvg >= 7 && acwr > 1.2)) {
      const futureScheduled = updatedWorkouts.filter(
        w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
      );
      proposedAdjustments = checkACWRSafety(acwr, futureScheduled, today, state.recoveryStatus, recentRPEAvg);
    }

    // Immediate state update (before async AI call)
    set({
      allWorkouts: updatedWorkouts,
      todaysWorkout,
      currentACWR: acwr,
      rpeTrend,
      banisterState,
    });

    // 4. AI-Gated decision (async, non-blocking)
    (async () => {
      try {
        set({ pendingAIReview: true });

        // Get this workout's metric + Strava detail
        const thisMetrics = getMetricsForWorkout(workoutId);
        const thisMetric = thisMetrics.length > 0 ? thisMetrics[0] : null;
        const thisStravaDetail = thisMetric
          ? (getStravaDetailsForMetrics([thisMetric.id])[thisMetric.id] || null)
          : null;

        // Build context for Gemini
        const aiContext: AdaptiveEventContext = {
          eventType: 'workout_completed',
          workout: updatedWorkouts.find(w => w.id === workoutId)!,
          metric: thisMetric,
          stravaDetail: thisStravaDetail,
          profile,
          acwr,
          banisterState,
          recoveryStatus: get().recoveryStatus,
          rpeTrend,
          currentVDOT: profile.vdot,
          paceZones,
          daysUntilRace: Math.max(0, Math.floor((new Date(profile.race_date + 'T00:00:00').getTime() - Date.now()) / 86400000)),
          currentPhase: (state.currentWeek?.phase || 'base') as Phase,
          weekNumber: state.currentWeek?.week_number || 1,
          proposedAdjustments,
          proposedVDOTUpdate: null, // VDOT eval happens in weekly reconciliation
          recentAdaptiveLogs: getRecentAdaptiveLogs(7),
        };

        const aiResponse = await getAdaptiveAIDecision(aiContext);

        if (aiResponse) {
          // Apply AI-approved adjustments
          let aiAdjustments: WorkoutAdjustment[] = [];

          // Process decisions on proposed adjustments
          for (const decision of aiResponse.decisions) {
            if (decision.action === 'approve') {
              const proposed = proposedAdjustments.find(a => a.workoutId === decision.workoutId);
              if (proposed) aiAdjustments.push(proposed);
            } else if (decision.action === 'modify' && decision.adjustedValues) {
              const proposed = proposedAdjustments.find(a => a.workoutId === decision.workoutId);
              if (proposed) {
                aiAdjustments.push({
                  ...proposed,
                  newDistance: decision.adjustedValues.distance_miles ?? proposed.newDistance,
                  newType: (decision.adjustedValues.workout_type ?? proposed.newType) as any,
                  reason: `${proposed.reason} (AI: ${decision.reasoning})`,
                });
              }
            }
            // 'reject' → don't apply
          }

          // Process AI additions (adjustments not in deterministic proposals)
          for (const addition of aiResponse.additions) {
            const targetWorkout = get().allWorkouts.find(w => w.id === addition.workoutId);
            if (targetWorkout) {
              aiAdjustments.push({
                workoutId: addition.workoutId,
                adjustmentType: addition.adjustmentType,
                originalDistance: targetWorkout.distance_miles,
                newDistance: addition.newDistance,
                originalType: targetWorkout.workout_type,
                newType: addition.newType,
                reason: `AI: ${addition.reasoning}`,
                autoApplied: true,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Apply all AI-approved adjustments
          if (aiAdjustments.length > 0) {
            const currentWorkouts = get().allWorkouts;
            const adjusted = applyAdjustments(currentWorkouts, aiAdjustments);
            const updatedToday = adjusted.find(w => w.id === get().todaysWorkout?.id);

            const log: AdaptiveLog = {
              id: Crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: 'acwr_adjustment',
              summary: aiResponse.summary,
              adjustments: aiAdjustments,
              metadata: { aiGated: true, acwr, readiness: banisterState.readiness },
            };
            saveAdaptiveLog(log);

            set({
              allWorkouts: adjusted,
              todaysWorkout: updatedToday || get().todaysWorkout,
              adaptiveLogs: [log, ...get().adaptiveLogs],
              lastAdaptiveSummary: aiResponse.summary,
              pendingAIReview: false,
            });
          } else {
            set({
              pendingAIReview: false,
              lastAdaptiveSummary: aiResponse.summary || null,
            });
          }

          // Check if AI flagged replan
          if (aiResponse.replanNeeded) {
            await get().triggerReplan(aiResponse.replanReason || 'AI recommended replan');
          }
        } else {
          // Fallback: apply deterministic proposals directly
          if (proposedAdjustments.length > 0) {
            const currentWorkouts = get().allWorkouts;
            const adjusted = applyAdjustments(currentWorkouts, proposedAdjustments);
            const updatedToday = adjusted.find(w => w.id === get().todaysWorkout?.id);

            const log: AdaptiveLog = {
              id: Crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: 'acwr_adjustment',
              summary: `Auto-adjusted ${proposedAdjustments.length} workout(s) — ACWR ${acwr.toFixed(2)} (deterministic fallback)`,
              adjustments: proposedAdjustments,
              metadata: { aiGated: false, acwr, readiness: banisterState.readiness },
            };
            saveAdaptiveLog(log);

            set({
              allWorkouts: adjusted,
              todaysWorkout: updatedToday || get().todaysWorkout,
              adaptiveLogs: [log, ...get().adaptiveLogs],
              lastAdaptiveSummary: log.summary,
              pendingAIReview: false,
            });
          } else {
            set({ pendingAIReview: false });
          }
        }

        // Check replan triggers (independent of AI response)
        const { activePlan, weeks: storeWeeks, allWorkouts: storeWorkouts } = get();
        if (activePlan) {
          const triggerResult = checkReplanTriggers(
            storeWeeks, storeWorkouts,
            profile.vdot, activePlan.vdot_at_creation, today
          );
          if (triggerResult.shouldReplan) {
            await get().triggerReplan(triggerResult.reason!);
          }
        }
      } catch (error) {
        console.error('Adaptive AI cascade error:', error);
        set({ pendingAIReview: false });
      }
    })();

    // Fire-and-forget: generate post-run analysis
    const completedWorkout = updatedWorkouts.find(w => w.id === workoutId);
    if (completedWorkout) {
      (async () => {
        try {
          const { generatePostRunAnalysis } = require('./ai/briefing');
          const { paceZones, currentWeek, recoveryStatus } = get();
          if (!paceZones || !currentWeek) return;

          // Get performance metric for this workout
          const metrics = getMetricsForWorkout(workoutId);
          const metric = metrics.length > 0 ? metrics[0] : null;

          // Get Strava split data if available
          const stravaDetail = getStravaDetailForWorkout(workoutId);

          // Build week context
          const weekWorkouts = get().allWorkouts.filter(w => w.week_id === currentWeek.id);
          const completedVolume = weekWorkouts
            .filter(w => w.status === 'completed')
            .reduce((sum, w) => sum + w.distance_miles, 0);
          const remainingWorkouts = weekWorkouts
            .filter(w => w.status === 'scheduled' && w.workout_type !== 'rest')
            .length;

          const analysis = await generatePostRunAnalysis(
            completedWorkout,
            metric,
            recoveryStatus,
            paceZones,
            {
              targetVolume: currentWeek.target_volume_miles,
              completedVolume,
              remainingWorkouts,
            },
            stravaDetail,
          );

          if (analysis && analysis !== 'Unable to generate briefing') {
            set({ postRunAnalysis: analysis, showPostRunAnalysis: true });

            // Save to coach messages so it appears in chat history
            const conversationId = getLatestConversationId() || Crypto.randomUUID();
            saveCoachMessage({
              id: Crypto.randomUUID(),
              role: 'assistant',
              content: analysis,
              structured_action_json: JSON.stringify({ type: 'auto_analysis', workoutId }),
              action_applied: false,
              created_at: new Date().toISOString(),
              conversation_id: conversationId,
            });
          }
        } catch {
          // Analysis generation failed — silently skip
        }
      })();
    }
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

    // 2. Triage missed workout (collect adjustments but don't apply yet)
    let triageAdjustments: WorkoutAdjustment[] = [];
    if (skippedWorkout && skippedWorkout.workout_type !== 'rest') {
      const remainingThisWeek = updatedWorkouts.filter(
        w => w.week_id === skippedWorkout.week_id &&
             w.id !== workoutId &&
             w.status === 'scheduled'
      );
      triageAdjustments = triageMissedWorkout(skippedWorkout, remainingThisWeek);
    }

    // 3. Calculate ACWR + Banister + RPE
    const today = getToday();
    const day28Ago = toLocalDateString(new Date(Date.now() - 28 * 86400000));
    const recentMetrics = getMetricsForDateRange(day28Ago, today);
    const acwr = calculateACWR(recentMetrics, today);
    const profile = state.userProfile!;
    const paceZones = state.paceZones!;

    // Banister readiness
    const banisterState = calculateBanisterState(recentMetrics, profile, paceZones, today);

    // RPE trend
    const day7Ago = toLocalDateString(new Date(Date.now() - 7 * 86400000));
    const recentForRPE = getMetricsForDateRange(day7Ago, today);
    const rpeTrend = assessRPETrend(recentForRPE);
    const recentRPEAvg = rpeTrend.sampleSize >= 3 ? rpeTrend.avgRPE : null;

    // ACWR safety adjustments
    let acwrAdjustments: WorkoutAdjustment[] = [];
    if (acwr > 1.3 || (recentRPEAvg != null && recentRPEAvg >= 7 && acwr > 1.2)) {
      const futureScheduled = updatedWorkouts.filter(
        w => w.date >= today && w.status === 'scheduled' && w.workout_type !== 'rest'
      );
      acwrAdjustments = checkACWRSafety(acwr, futureScheduled, today, state.recoveryStatus, recentRPEAvg);
    }

    // 4. Combine triage + ACWR as proposed adjustments
    const proposedAdjustments = [...triageAdjustments, ...acwrAdjustments];

    // Immediate state update (before async AI call)
    set({
      allWorkouts: updatedWorkouts,
      todaysWorkout,
      currentACWR: acwr,
      rpeTrend,
      banisterState,
    });

    // 5. AI-Gated decision (async, non-blocking)
    (async () => {
      try {
        set({ pendingAIReview: true });

        // Build context for Gemini
        const aiContext: AdaptiveEventContext = {
          eventType: 'workout_skipped',
          workout: updatedWorkouts.find(w => w.id === workoutId)!,
          metric: null,
          stravaDetail: null,
          profile,
          acwr,
          banisterState,
          recoveryStatus: get().recoveryStatus,
          rpeTrend,
          currentVDOT: profile.vdot,
          paceZones,
          daysUntilRace: Math.max(0, Math.floor((new Date(profile.race_date + 'T00:00:00').getTime() - Date.now()) / 86400000)),
          currentPhase: (state.currentWeek?.phase || 'base') as Phase,
          weekNumber: state.currentWeek?.week_number || 1,
          proposedAdjustments,
          proposedVDOTUpdate: null,
          recentAdaptiveLogs: getRecentAdaptiveLogs(7),
        };

        const aiResponse = await getAdaptiveAIDecision(aiContext);

        if (aiResponse) {
          // Apply AI-approved adjustments
          let aiAdjustments: WorkoutAdjustment[] = [];

          for (const decision of aiResponse.decisions) {
            if (decision.action === 'approve') {
              const proposed = proposedAdjustments.find(a => a.workoutId === decision.workoutId);
              if (proposed) aiAdjustments.push(proposed);
            } else if (decision.action === 'modify' && decision.adjustedValues) {
              const proposed = proposedAdjustments.find(a => a.workoutId === decision.workoutId);
              if (proposed) {
                aiAdjustments.push({
                  ...proposed,
                  newDistance: decision.adjustedValues.distance_miles ?? proposed.newDistance,
                  newType: (decision.adjustedValues.workout_type ?? proposed.newType) as any,
                  reason: `${proposed.reason} (AI: ${decision.reasoning})`,
                });
              }
            }
          }

          for (const addition of aiResponse.additions) {
            const targetWorkout = get().allWorkouts.find(w => w.id === addition.workoutId);
            if (targetWorkout) {
              aiAdjustments.push({
                workoutId: addition.workoutId,
                adjustmentType: addition.adjustmentType,
                originalDistance: targetWorkout.distance_miles,
                newDistance: addition.newDistance,
                originalType: targetWorkout.workout_type,
                newType: addition.newType,
                reason: `AI: ${addition.reasoning}`,
                autoApplied: true,
                timestamp: new Date().toISOString(),
              });
            }
          }

          if (aiAdjustments.length > 0) {
            const currentWorkouts = get().allWorkouts;
            const adjusted = applyAdjustments(currentWorkouts, aiAdjustments);
            const updatedToday = adjusted.find(w => w.id === get().todaysWorkout?.id);

            const log: AdaptiveLog = {
              id: Crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: skippedWorkout ? 'missed_workout_triage' : 'acwr_adjustment',
              summary: aiResponse.summary,
              adjustments: aiAdjustments,
              metadata: { aiGated: true, acwr, readiness: banisterState.readiness, skippedWorkoutId: workoutId },
            };
            saveAdaptiveLog(log);

            set({
              allWorkouts: adjusted,
              todaysWorkout: updatedToday || get().todaysWorkout,
              adaptiveLogs: [log, ...get().adaptiveLogs],
              lastAdaptiveSummary: aiResponse.summary,
              pendingAIReview: false,
            });
          } else {
            set({
              pendingAIReview: false,
              lastAdaptiveSummary: aiResponse.summary || null,
            });
          }

          if (aiResponse.replanNeeded) {
            await get().triggerReplan(aiResponse.replanReason || 'AI recommended replan');
          }
        } else {
          // Fallback: apply deterministic proposals directly
          if (proposedAdjustments.length > 0) {
            const currentWorkouts = get().allWorkouts;
            const adjusted = applyAdjustments(currentWorkouts, proposedAdjustments);
            const updatedToday = adjusted.find(w => w.id === get().todaysWorkout?.id);

            const log: AdaptiveLog = {
              id: Crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: skippedWorkout ? 'missed_workout_triage' : 'acwr_adjustment',
              summary: `Auto-adjusted ${proposedAdjustments.length} workout(s) — ACWR ${acwr.toFixed(2)} (deterministic fallback)`,
              adjustments: proposedAdjustments,
              metadata: { aiGated: false, acwr, readiness: banisterState.readiness, skippedWorkoutId: workoutId },
            };
            saveAdaptiveLog(log);

            set({
              allWorkouts: adjusted,
              todaysWorkout: updatedToday || get().todaysWorkout,
              adaptiveLogs: [log, ...get().adaptiveLogs],
              lastAdaptiveSummary: log.summary,
              pendingAIReview: false,
            });
          } else {
            set({ pendingAIReview: false });
          }
        }

        // Check replan triggers
        const { activePlan, weeks: storeWeeks, allWorkouts: storeWorkouts } = get();
        if (activePlan) {
          const triggerResult = checkReplanTriggers(
            storeWeeks, storeWorkouts,
            profile.vdot, activePlan.vdot_at_creation, today
          );
          if (triggerResult.shouldReplan) {
            await get().triggerReplan(triggerResult.reason!);
          }
        }
      } catch (error) {
        console.error('Adaptive AI cascade error:', error);
        set({ pendingAIReview: false });
      }
    })();
  },

  refreshTodaysWorkout: () => {
    const today = getToday();
    let todaysWorkout = getWorkoutByDate(today);
    const { activePlan } = get();
    const currentWeek = activePlan ? getCurrentWeek(activePlan.id) : null;

    // Auto-complete: if a run was recorded today (Strava/HealthKit) but
    // the scheduled workout is still "scheduled", mark it completed and link the metric
    if (todaysWorkout && todaysWorkout.status === 'scheduled' && todaysWorkout.workout_type !== 'rest') {
      // Check by workout_id first, then fall back to checking by date
      let metrics = getMetricsForWorkout(todaysWorkout.id);
      if (metrics.length === 0) {
        // No metric linked — check if there's a metric for today's date (or yesterday's,
        // to handle timezone differences between Strava UTC and local time)
        const recentMetrics = getRecentMetrics(3);
        const todayMetrics = recentMetrics.filter(m => m.date === today || m.date === todaysWorkout!.date);
        console.log(`[AutoComplete] workout date=${todaysWorkout.date}, today=${today}, recent metrics: ${recentMetrics.map(m => m.date).join(', ')}, matched: ${todayMetrics.length}`);
        if (todayMetrics.length > 0) {
          metrics = todayMetrics;
          // Link the metric to this workout
          try {
            const database = getDatabase();
            database.runSync(
              'UPDATE performance_metric SET workout_id = ? WHERE id = ?',
              todaysWorkout.id, todayMetrics[0].id
            );
          } catch {
            // Non-critical
          }
        }
      }
      if (metrics.length > 0) {
        try {
          const database = getDatabase();
          database.runSync(
            "UPDATE workout SET status = 'completed', updated_at = datetime('now') WHERE id = ?",
            todaysWorkout.id
          );
          todaysWorkout = { ...todaysWorkout, status: 'completed' };
        } catch {
          // Non-critical
        }
      }
    }

    set({ todaysWorkout, currentWeek });
  },

  refreshPlan: () => {
    const plan = getActivePlan();
    if (!plan) return;
    const weeks = getWeeksForPlan(plan.id);
    let allWorkouts = getAllWorkoutsForPlan(plan.id);
    const currentWeek = getCurrentWeek(plan.id);
    const today = getToday();
    let todaysWorkout = getWorkoutByDate(today);

    // Auto-complete: if a run was recorded today but workout is still "scheduled"
    if (todaysWorkout && todaysWorkout.status === 'scheduled' && todaysWorkout.workout_type !== 'rest') {
      let metrics = getMetricsForWorkout(todaysWorkout.id);
      if (metrics.length === 0) {
        const todayMetrics = getRecentMetrics(1).filter(m => m.date === today);
        if (todayMetrics.length > 0) {
          metrics = todayMetrics;
          try {
            const database = getDatabase();
            database.runSync(
              'UPDATE performance_metric SET workout_id = ? WHERE id = ?',
              todaysWorkout.id, todayMetrics[0].id
            );
          } catch { /* Non-critical */ }
        }
      }
      if (metrics.length > 0) {
        try {
          const database = getDatabase();
          database.runSync(
            "UPDATE workout SET status = 'completed', updated_at = datetime('now') WHERE id = ?",
            todaysWorkout.id
          );
          todaysWorkout = { ...todaysWorkout, status: 'completed' };
          allWorkouts = allWorkouts.map(w =>
            w.id === todaysWorkout!.id ? { ...w, status: 'completed' as const } : w
          );
        } catch { /* Non-critical */ }
      }
    }

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
    const todayStr = toLocalDateString(today);

    // Check cache first
    if (isHealthSnapshotFresh(todayStr)) {
      const cached = getHealthSnapshot(todayStr);
      if (cached) {
        const recentMetrics = getMetricsForDateRange(
          toLocalDateString(new Date(Date.now() - 7 * 86400000)),
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
      const day7Ago = toLocalDateString(new Date(Date.now() - 7 * 86400000));
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

  syncStravaData: async () => {
    const { activePlan } = get();
    if (!activePlan) return;

    try {
      const { isStravaConnected } = require('./strava/auth');
      if (!isStravaConnected()) return;

      const { syncStravaActivities } = require('./strava/sync');
      const result = await syncStravaActivities();

      // Always refresh plan — historical sync may have marked workouts
      // completed in the DB but the store state might be stale
      get().refreshPlan();

      if (result.newActivities > 0) {
        // Recalculate ACWR with fresh data
        const today = getToday();
        const day28Ago = toLocalDateString(new Date(Date.now() - 28 * 86400000));
        const recentMetrics = getMetricsForDateRange(day28Ago, today);
        const acwr = calculateACWR(recentMetrics, today);
        set({ currentACWR: acwr });

        console.log(`Strava sync: ${result.newActivities} new, ${result.matched} matched, ${result.unmatched} unmatched`);
      }

      // Check if any Strava PRs imply a higher VDOT than the current profile
      try {
        const { findBestVDOTFromPRs } = require('./strava/bestEfforts');
        const pr = findBestVDOTFromPRs();
        const { userProfile } = get();
        if (pr && userProfile && pr.vdot > userProfile.vdot + 0.4) {
          set({ pendingVDOTSuggestion: pr });
        }
      } catch {
        // Non-critical
      }

      // Always sync shoes alongside activities
      await get().syncShoes();
    } catch (e) {
      console.warn('Strava sync failed:', e);
    }
  },

  syncWorkoutFromHealthKit: async () => {
    const { todaysWorkout, activePlan } = get();
    if (!activePlan) return;

    // Skip HealthKit workout sync if Strava is connected (Strava is primary)
    try {
      const { isStravaConnected } = require('./strava/auth');
      if (isStravaConnected()) return;
    } catch {
      // Strava module not available — fall through to HealthKit
    }

    try {
      const { isHealthKitAvailable, initHealthKit, getWorkoutsForDate, matchHealthKitToMetric } = require('./health/healthkit');
      if (!isHealthKitAvailable()) return;

      const initialized = await initHealthKit();
      if (!initialized) return;

      const today = new Date();
      const todayStr = toLocalDateString(today);
      const hkWorkouts = await getWorkoutsForDate(today);

      if (!hkWorkouts || hkWorkouts.length === 0) return;

      // Find the scheduled workout for today (if any and still scheduled)
      const scheduledWorkout = todaysWorkout && todaysWorkout.status === 'scheduled' ? todaysWorkout : null;

      // Check if we already have metrics for today's workout to avoid duplicates
      if (scheduledWorkout) {
        const existingMetrics = getMetricsForWorkout(scheduledWorkout.id);
        if (existingMetrics.length > 0) return; // Already synced
      }

      // Use the longest run if multiple (e.g., warmup jog + main run logged separately)
      const bestRun = hkWorkouts.reduce((best: any, curr: any) =>
        curr.distance > (best?.distance || 0) ? curr : best
      , null);

      if (!bestRun || bestRun.distance < 0.5) return; // Ignore very short activities

      // Save performance metric linked to today's workout
      const metric = matchHealthKitToMetric(bestRun, scheduledWorkout?.id);
      savePerformanceMetric(metric);

      // Auto-complete the workout if it's scheduled
      if (scheduledWorkout) {
        get().markWorkoutComplete(scheduledWorkout.id);
      }

      // Refresh to pick up changes
      get().refreshTodaysWorkout();
    } catch (e) {
      console.warn('HealthKit workout sync failed:', e);
    }
  },

  fetchPreWorkoutBriefing: async () => {
    const { todaysWorkout, paceZones, recoveryStatus } = get();

    // Don't generate briefing for rest days, no workout, or already completed/skipped
    if (!todaysWorkout || !paceZones || todaysWorkout.workout_type === 'rest' || todaysWorkout.status !== 'scheduled') {
      set({ preWorkoutBriefing: null, isLoadingBriefing: false });
      return;
    }

    set({ isLoadingBriefing: true });

    try {
      const { generatePreWorkoutBriefing } = require('./ai/briefing');
      const { getWeather } = require('./ai/weather');

      const recentMetrics = getRecentMetrics(5);

      // Weather is optional — don't block if it fails
      let weather = null;
      try {
        weather = await getWeather();
      } catch {
        // Weather unavailable — continue without it
      }

      const briefing = await generatePreWorkoutBriefing(
        todaysWorkout,
        recoveryStatus,
        recentMetrics,
        weather,
        paceZones,
      );

      // Only set if it's not the fallback message
      set({
        preWorkoutBriefing: briefing !== 'Unable to generate briefing' ? briefing : null,
        isLoadingBriefing: false,
      });
    } catch {
      set({ preWorkoutBriefing: null, isLoadingBriefing: false });
    }
  },

  dismissPostRunAnalysis: () => {
    set({ showPostRunAnalysis: false });
  },

  dismissWeeklyDigest: () => {
    set({ hasUnreadDigest: false });
  },

  fetchRaceWeekBriefing: async () => {
    const { userProfile, paceZones, allWorkouts, isRaceWeek } = get();
    if (!isRaceWeek || !userProfile || !paceZones) return;

    const raceDate = new Date(userProfile.race_date);
    const daysUntilRace = Math.ceil((raceDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilRace < 0 || daysUntilRace > 7) return;

    set({ isLoadingRaceWeek: true });

    try {
      const { generateRaceWeekBriefing } = require('./ai/raceWeek');
      const { getWeather } = require('./ai/weather');

      // Gather training stats
      const completedWorkouts = allWorkouts.filter(w => w.status === 'completed');
      const totalMilesLogged = completedWorkouts.reduce((s, w) => s + w.distance_miles, 0);
      const longestRun = completedWorkouts.reduce((max, w) => Math.max(max, w.distance_miles), 0);
      const weekIds = new Set(completedWorkouts.map(w => w.week_id));
      const weeksTrained = weekIds.size;

      let weather = null;
      try {
        weather = await getWeather();
      } catch {
        // Weather unavailable
      }

      const briefing = await generateRaceWeekBriefing(
        daysUntilRace,
        userProfile,
        paceZones,
        { totalMilesLogged, longestRun, weeksTrained },
        weather,
      );

      if (briefing.briefing && briefing.briefing !== 'Unable to generate race week briefing') {
        set({ raceWeekBriefing: briefing, isLoadingRaceWeek: false });
      } else {
        set({ raceWeekBriefing: null, isLoadingRaceWeek: false });
      }
    } catch {
      set({ raceWeekBriefing: null, isLoadingRaceWeek: false });
    }
  },

  fetchRestDaySuggestion: async () => {
    const { todaysWorkout, currentWeek, allWorkouts } = get();
    if (!todaysWorkout || todaysWorkout.workout_type !== 'rest' || !currentWeek) return;

    try {
      const { generateContextualSuggestion } = require('./ai/suggestions');
      const weekWorkouts = allWorkouts.filter(w => w.week_id === currentWeek.id);
      const completedVolume = weekWorkouts
        .filter(w => w.status === 'completed')
        .reduce((s, w) => s + w.distance_miles, 0);

      const yesterday = weekWorkouts.find(w => {
        const d = new Date(w.date);
        const today = new Date(todaysWorkout.date);
        return d.getTime() === today.getTime() - 86400000;
      });
      const tomorrow = weekWorkouts.find(w => {
        const d = new Date(w.date);
        const today = new Date(todaysWorkout.date);
        return d.getTime() === today.getTime() + 86400000;
      });

      const suggestion = await generateContextualSuggestion('rest_day', {
        weekNumber: currentWeek.week_number,
        phase: currentWeek.phase,
        yesterdayWorkout: yesterday ? `${yesterday.workout_type} ${yesterday.distance_miles}mi` : null,
        tomorrowWorkout: tomorrow ? `${tomorrow.workout_type} ${tomorrow.distance_miles}mi` : null,
        weeklyVolume: completedVolume.toFixed(1),
      });

      if (suggestion) {
        set({ restDaySuggestion: suggestion });
      }
    } catch {
      // Suggestion is optional
    }
  },

  // ─── Cloud Backup Actions ───────────────────────────────────

  performBackup: async () => {
    set({ isBackingUp: true, backupError: null });
    try {
      const { serializeDatabase, uploadBackup, getBackupInfo } = require('./backup/backup');
      const data = serializeDatabase();
      const result = await uploadBackup(data);
      if (!result.success) {
        set({ isBackingUp: false, backupError: result.error || 'Backup failed.' });
        return;
      }
      const info = await getBackupInfo();
      set({ isBackingUp: false, backupError: null, backupInfo: info });
    } catch (e: any) {
      set({ isBackingUp: false, backupError: e?.message || 'Backup failed.' });
    }
  },

  checkBackupStatus: async () => {
    try {
      const { getBackupInfo } = require('./backup/backup');
      const info = await getBackupInfo();
      set({ backupInfo: info });
    } catch {
      // Silently fail — backup status is non-critical
    }
  },

  performRestore: async () => {
    set({ isRestoring: true, restoreError: null });
    try {
      const { downloadBackup, restoreDatabase } = require('./backup/backup');

      const data = await downloadBackup();
      if (!data) {
        set({ isRestoring: false, restoreError: 'No backup found in the cloud.' });
        return { success: false, error: 'No backup found.' };
      }

      const result = await restoreDatabase(data);
      if (!result.success) {
        set({ isRestoring: false, restoreError: result.error });
        return result;
      }

      // Reload all Zustand state from the freshly restored SQLite data
      set({ isRestoring: false, restoreError: null });
      get().initializeApp();

      return { success: true };
    } catch (e: any) {
      const error = e?.message || 'Restore failed.';
      set({ isRestoring: false, restoreError: error });
      return { success: false, error };
    }
  },

  syncShoes: async () => {
    try {
      const { isStravaConnected } = require('./strava/auth');
      if (!isStravaConnected()) return;

      const { syncShoes: stravaSync, getAllShoes, checkShoeMileage } = require('./strava/shoes');
      const synced = await stravaSync();
      const shoes = synced.length > 0 ? synced : getAllShoes();
      const shoeAlerts = checkShoeMileage(shoes);
      set({ shoes, shoeAlerts });
    } catch (e) {
      console.warn('Shoe sync failed:', e);
    }
  },

  applyVDOTSuggestion: () => {
    const { userProfile, pendingVDOTSuggestion } = get();
    if (!userProfile || !pendingVDOTSuggestion) return;

    const updatedProfile = {
      ...userProfile,
      vdot: pendingVDOTSuggestion.vdot,
      updated_at: new Date().toISOString(),
    };
    saveUserProfile(updatedProfile);

    const paceZones = calculatePaceZones(pendingVDOTSuggestion.vdot);
    const hrZones = calculateHRZones(updatedProfile.max_hr, updatedProfile.resting_hr);

    set({
      userProfile: updatedProfile,
      paceZones,
      hrZones,
      pendingVDOTSuggestion: null,
      lastVDOTUpdate: {
        previousVDOT: userProfile.vdot,
        newVDOT: pendingVDOTSuggestion.vdot,
        reason: `All-time ${pendingVDOTSuggestion.distance} PR of ${pendingVDOTSuggestion.prTime} detected on Strava`,
        evidenceWorkouts: [],
        confidenceLevel: 'high',
      },
    });
  },

  dismissVDOTSuggestion: () => {
    set({ pendingVDOTSuggestion: null });
  },

  triggerReplan: async (reason: string) => {
    const { userProfile: profile, activePlan } = get();
    if (!profile || !activePlan) return;

    const today = getToday();
    const actualMileage = getRecentActualMileage(2);

    // Generate new plan from current state
    const newPlan = replanFromCurrentState(profile, profile.vdot, actualMileage, today);
    if (!newPlan) {
      set({
        replanModal: {
          visible: true,
          reason,
          summary: 'Too close to race day to regenerate. Maintaining current schedule.',
        },
      });
      return;
    }

    // Ask Gemini to review — transform plan into summary format
    const planSummary = {
      weeks: newPlan.weeks.map(w => {
        const weekWorkouts = newPlan.workouts.filter(wo => wo.week_id === w.id);
        return {
          weekNumber: w.week_number,
          phase: w.phase,
          isCutback: w.is_cutback,
          targetVolume: w.target_volume_miles,
          workouts: weekWorkouts.map(wo => ({
            type: wo.workout_type,
            distance: wo.distance_miles,
            zone: wo.target_pace_zone,
          })),
        };
      }),
    };
    const completionHistory = getWeeklyCompletionHistory(8).map(c => ({
      week: c.week,
      completionRate: c.rate,
    }));
    const recentLogs = getRecentAdaptiveLogs(14);
    const aiReview = await reviewReplanWithAI(
      planSummary,
      {
        profile,
        currentVDOT: profile.vdot,
        replanReason: reason,
        recentWeeklyMileage: [actualMileage],
        completionHistory,
        adaptiveLogSummary: recentLogs.map(l => `${l.type}: ${l.summary}`).join('; '),
      },
    );

    // Apply: delete old scheduled, insert new plan
    deleteScheduledFutureWorkouts();
    savePlan(newPlan);

    // Log
    saveAdaptiveLog({
      id: Crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'weekly_reconciliation',
      summary: aiReview?.summary || `Plan regenerated: ${reason}`,
      adjustments: [],
      metadata: { replan: true, reason, aiReview: aiReview?.tweaks || null },
    });

    // Reload store
    get().initializeApp();

    // Show modal
    set({
      replanModal: {
        visible: true,
        reason,
        summary: aiReview?.summary || `Plan regenerated. Training recalibrated to match current fitness.`,
      },
    });
  },

  dismissReplanModal: () => {
    set({ replanModal: null });
  },

  getTrainingContext: () => {
    const { userProfile, paceZones, hrZones, currentWeek, weeks, allWorkouts, todaysWorkout, activePlan, currentACWR, adaptiveLogs, lastVDOTUpdate, lastReconciliation, recoveryStatus, rpeTrend } = get();
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
      rpeTrend: rpeTrend || undefined,
      banisterState: get().banisterState || undefined,
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
