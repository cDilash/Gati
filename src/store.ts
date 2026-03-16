/**
 * Marathon Coach v2 — Zustand Store
 *
 * Simplified state management. AI is the coach, store is just the state container.
 * Most logic lives in the AI modules; the store is thin.
 */

import { create } from 'zustand';
import {
  UserProfile,
  TrainingPlan,
  TrainingWeek,
  Workout,
  PaceZones,
  PerformanceMetric,
  CoachMessage,
  AIGeneratedPlan,
  Shoe,
  WeeklyDigest,
  HealthSnapshot,
  RecoveryStatus,
  CrossTraining,
  CrossTrainingType,
  CROSS_TRAINING_IMPACT,
} from './types';
import {
  getUserProfile,
  saveUserProfile as dbSaveUserProfile,
  getActivePlan,
  getWeeksForPlan,
  getAllWorkouts,
  getTodaysWorkout,
  getCurrentWeek,
  updateWorkoutStatus,
  getRecentMetrics,
  saveCoachMessage as dbSaveCoachMessage,
  getCoachMessages,
  getShoes,
  getDatabase,
  initializeDatabase,
  savePlan,
  deleteActivePlan,
  getSetting,
  setSetting,
} from './db/database';
import { calculatePaceZones, calculateHRZones } from './engine/paceZones';
import { getToday, daysBetween } from './utils/dateUtils';
import { generateTrainingPlan } from './ai/planGenerator';
import { validateAndCorrectPlan, getViolationSummary } from './ai/safetyValidator';
import { adaptPlan, AdaptationResult } from './ai/adaptation';
import type { SyncResult } from './strava/sync';
import { generateWeeklyReview, WeeklyReview } from './ai/weeklyReview';
import { sendCoachMessage as aiSendCoachMessage, buildCoachSystemPrompt, CoachResponse } from './ai/coach';
import { generateBriefing, generatePostRunAnalysis, generateRaceStrategy } from './ai/briefing';

// ─── State Interface ────────────────────────────────────────

interface AppState {
  // Core
  isLoading: boolean;
  userProfile: UserProfile | null;
  activePlan: TrainingPlan | null;
  paceZones: PaceZones | null;

  // Today
  todaysWorkout: Workout | null;
  preWorkoutBriefing: string | null;
  postRunAnalysis: string | null;

  // Plan view
  weeks: TrainingWeek[];
  workouts: Workout[];
  currentWeek: TrainingWeek | null;
  weeklyDigest: WeeklyDigest | null;

  // Strava
  isStravaConnected: boolean;
  lastSyncTime: string | null;
  shoes: Shoe[];

  // Coach
  coachMessages: CoachMessage[];
  isCoachThinking: boolean;

  // Health / Recovery
  healthSnapshot: HealthSnapshot | null;
  recoveryStatus: RecoveryStatus | null;

  // Cross-Training
  todayCrossTraining: CrossTraining | null;
  weekCrossTraining: CrossTraining[];

  // Sync state
  isSyncing: boolean;
  lastSyncResult: { strava: string | null; health: string | null } | null;

  // Notifications
  vdotNotification: { oldVDOT: number; newVDOT: number; source: string } | null;
  proactiveSuggestion: {
    message: string;
    workoutId: string;
    action: 'swap_to_easy';
    workoutTitle: string;
    ctSuggestion?: import('./ai/crossTrainingAdvisor').SwapSuggestion;
  } | null;

  // Derived
  currentWeekNumber: number;
  currentPhase: string;
  daysUntilRace: number;
  isRaceWeek: boolean;

  // Actions
  initializeApp: () => Promise<void>;
  refreshState: () => void;
  refreshTodaysWorkout: () => void;
  saveProfile: (profile: Omit<UserProfile, 'id' | 'updated_at'>) => void;
  storePlan: (plan: AIGeneratedPlan, vdot: number, startDate: string) => { planId: string; weekCount: number; workoutCount: number };
  generatePlan: () => Promise<{ success: boolean; error?: string; violations?: string }>;
  markWorkoutComplete: (workoutId: string, stravaActivityId?: number) => void;
  markWorkoutSkipped: (workoutId: string) => void;
  addCoachMessage: (role: 'user' | 'assistant' | 'system', content: string, messageType?: CoachMessage['message_type'], metadata?: string) => void;
  sendToCoach: (message: string) => Promise<void>;
  setCoachThinking: (thinking: boolean) => void;
  fetchBriefing: () => Promise<void>;
  fetchPostRunAnalysis: (workoutId: string) => Promise<void>;
  fetchRaceStrategy: () => Promise<void>;
  setBriefing: (briefing: string | null) => void;
  setPostRunAnalysis: (analysis: string | null) => void;
  setWeeklyDigest: (digest: WeeklyDigest | null) => void;
  raceStrategy: string | null;
  requestPlanAdaptation: (reason: string) => Promise<{ success: boolean; summary?: string; error?: string }>;
  checkWeeklyReview: () => Promise<void>;
  syncStrava: () => Promise<SyncResult>;
  syncStravaConnection: () => void;
  refreshShoes: () => void;
  addManualRun: (date: string, distanceMiles: number, durationMinutes: number, rpe?: number) => void;
  syncHealth: () => Promise<void>;
  syncAll: () => Promise<void>;
  logCrossTraining: (type: CrossTrainingType, notes?: string) => void;
  deleteCrossTrainingEntry: (id: string) => void;
}

// ─── Store ──────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  isLoading: true,
  userProfile: null,
  activePlan: null,
  paceZones: null,
  todaysWorkout: null,
  preWorkoutBriefing: null,
  postRunAnalysis: null,
  weeks: [],
  workouts: [],
  currentWeek: null,
  weeklyDigest: null,
  isStravaConnected: false,
  lastSyncTime: null,
  shoes: [],
  coachMessages: [],
  isCoachThinking: false,
  raceStrategy: null,
  healthSnapshot: null,
  recoveryStatus: null,
  todayCrossTraining: null,
  weekCrossTraining: [],
  isSyncing: false,
  lastSyncResult: null,
  vdotNotification: null,
  proactiveSuggestion: null,
  currentWeekNumber: 0,
  currentPhase: 'base',
  daysUntilRace: 0,
  isRaceWeek: false,

  // ─── Initialize ─────────────────────────────────────────

  initializeApp: async () => {
    try {
      initializeDatabase();

      let profile = getUserProfile();
      let plan = getActivePlan();

      // Auto-restore: if no profile, check if user has a cloud backup
      if (!profile) {
        try {
          const { isLoggedIn } = require('./backup/auth');
          const loggedIn = await isLoggedIn();
          if (loggedIn) {
            console.log('[Store] No local profile but user is logged in — checking cloud backup...');
            const { downloadBackup, restoreDatabase } = require('./backup/backup');
            const backup = await downloadBackup();
            if (backup?.userProfile) {
              console.log('[Store] Cloud backup found — restoring...');
              const result = await restoreDatabase(backup);
              if (result.success) {
                console.log('[Store] Cloud restore successful!');
                profile = getUserProfile();
                plan = getActivePlan();
              } else {
                console.warn('[Store] Cloud restore failed:', result.error);
              }
            } else {
              console.log('[Store] No cloud backup found');
            }
          }
        } catch (e) {
          console.warn('[Store] Auto-restore check failed:', e);
        }
      }

      let paceZones: PaceZones | null = null;
      let weeks: TrainingWeek[] = [];
      let workouts: Workout[] = [];
      let currentWeek: TrainingWeek | null = null;
      let todaysWorkout: Workout | null = null;
      let daysUntilRace = 0;
      let currentWeekNumber = 0;
      let currentPhase = 'base';
      let isRaceWeek = false;

      if (profile) {
        paceZones = calculatePaceZones(profile.vdot_score);
        daysUntilRace = daysBetween(getToday(), profile.race_date);
        isRaceWeek = daysUntilRace <= 7 && daysUntilRace >= 0;
      }

      if (plan) {
        weeks = getWeeksForPlan(plan.id);
        workouts = getAllWorkouts(plan.id);
        currentWeek = getCurrentWeek(plan.id);
        todaysWorkout = getTodaysWorkout();
        if (currentWeek) {
          currentWeekNumber = currentWeek.week_number;
          currentPhase = currentWeek.phase;
        }
      }

      // Check Strava connection
      let isStravaConnected = false;
      let lastSyncTime: string | null = null;
      try {
        const database = getDatabase();
        const stravaRow = database.getFirstSync<any>('SELECT * FROM strava_tokens WHERE id = 1');
        if (stravaRow) {
          isStravaConnected = true;
          lastSyncTime = stravaRow.last_sync_at;
        }
      } catch {}

      const coachMessages = getCoachMessages();
      const shoes = getShoes();

      // Load cross-training for today
      let todayCT: CrossTraining | null = null;
      let weekCT: CrossTraining[] = [];
      try {
        const { getCrossTrainingForDate, getCrossTrainingForWeek } = require('./db/database');
        const today = getToday();
        todayCT = getCrossTrainingForDate(today);
        // Get week range from current week's workouts
        if (currentWeek && workouts.length > 0) {
          const weekWorkouts = workouts.filter(w => w.week_number === currentWeek.week_number);
          if (weekWorkouts.length > 0) {
            const dates = weekWorkouts.map(w => w.scheduled_date).sort();
            weekCT = getCrossTrainingForWeek(dates[0], dates[dates.length - 1]);
          }
        }
      } catch {}

      set({
        isLoading: false,
        userProfile: profile,
        activePlan: plan,
        paceZones,
        weeks,
        workouts,
        currentWeek,
        todaysWorkout,
        daysUntilRace,
        currentWeekNumber,
        currentPhase,
        isRaceWeek,
        isStravaConnected,
        lastSyncTime,
        coachMessages,
        shoes,
        todayCrossTraining: todayCT,
        weekCrossTraining: weekCT,
      });

      // Restore persisted suggestions
      try {
        const vdotNote = getSetting('pending_vdot_notification');
        if (vdotNote) {
          const parsed = JSON.parse(vdotNote);
          set({ vdotNotification: parsed });
        }
        const proNote = getSetting('pending_proactive_suggestion');
        if (proNote) {
          const parsed = JSON.parse(proNote);
          // Only restore if the workout is still upcoming
          if (parsed?.workoutId) {
            const workout = workouts.find((w: any) => w.id === parsed.workoutId);
            if (workout && workout.status === 'upcoming') {
              set({ proactiveSuggestion: parsed });
            } else {
              setSetting('pending_proactive_suggestion', '');
            }
          }
        }
      } catch {}
    } catch (error) {
      console.error('[Store] Failed to initialize:', error);
      set({ isLoading: false });
    }
  },

  // ─── Refresh ────────────────────────────────────────────

  refreshState: () => {
    const profile = getUserProfile();
    const plan = getActivePlan();

    let paceZones: PaceZones | null = null;
    let weeks: TrainingWeek[] = [];
    let workouts: Workout[] = [];
    let currentWeek: TrainingWeek | null = null;
    let todaysWorkout: Workout | null = null;
    let daysUntilRace = 0;
    let currentWeekNumber = 0;
    let currentPhase = 'base';
    let isRaceWeek = false;

    if (profile) {
      paceZones = calculatePaceZones(profile.vdot_score);
      daysUntilRace = daysBetween(getToday(), profile.race_date);
      isRaceWeek = daysUntilRace <= 7 && daysUntilRace >= 0;
    }

    if (plan) {
      weeks = getWeeksForPlan(plan.id);
      workouts = getAllWorkouts(plan.id);
      currentWeek = getCurrentWeek(plan.id);
      todaysWorkout = getTodaysWorkout();
      if (currentWeek) {
        currentWeekNumber = currentWeek.week_number;
        currentPhase = currentWeek.phase;
      }
    }

    set({
      userProfile: profile,
      activePlan: plan,
      paceZones,
      weeks,
      workouts,
      currentWeek,
      todaysWorkout,
      daysUntilRace,
      currentWeekNumber,
      currentPhase,
      isRaceWeek,
    });
  },

  refreshTodaysWorkout: () => {
    const todaysWorkout = getTodaysWorkout();
    set({ todaysWorkout });
  },

  // ─── Profile ────────────────────────────────────────────

  saveProfile: (profile) => {
    dbSaveUserProfile(profile);
    const saved = getUserProfile();
    const paceZones = saved ? calculatePaceZones(saved.vdot_score) : null;
    const daysUntilRace = saved ? daysBetween(getToday(), saved.race_date) : 0;
    set({
      userProfile: saved,
      paceZones,
      daysUntilRace,
      isRaceWeek: daysUntilRace <= 7 && daysUntilRace >= 0,
    });
    // Auto-backup (fire-and-forget)
    (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); } catch {} })();
  },

  // ─── Plan ───────────────────────────────────────────────

  storePlan: (plan, vdot, startDate) => {
    const result = savePlan(plan, vdot, startDate);
    get().refreshState();
    // Auto-backup after plan generation (fire-and-forget)
    (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); } catch {} })();
    return result;
  },

  generatePlan: async () => {
    const { userProfile, paceZones } = get();
    if (!userProfile || !paceZones) {
      return { success: false, error: 'No profile or pace zones available' };
    }

    try {
      // Step 1: AI generates the plan
      console.log('[Store] Generating plan via Gemini...');
      const rawPlan = await generateTrainingPlan(userProfile, paceZones, null);

      // Step 2: Safety validator clamps violations
      console.log('[Store] Running safety validator...');
      const validation = validateAndCorrectPlan(rawPlan, userProfile);
      const violationSummary = getViolationSummary(validation.violations);
      if (violationSummary) {
        console.log('[Store] Safety:', violationSummary);
      }

      // Step 3: Save to SQLite
      const today = getToday();
      const result = savePlan(validation.correctedPlan, userProfile.vdot_score, today);
      console.log(`[Store] Plan saved: ${result.weekCount} weeks, ${result.workoutCount} workouts`);

      // Step 4: Refresh store state
      get().refreshState();

      return {
        success: true,
        violations: violationSummary ?? undefined,
      };
    } catch (error: any) {
      console.error('[Store] Plan generation failed:', error);
      return { success: false, error: error.message || 'Plan generation failed' };
    }
  },

  // ─── Workouts ───────────────────────────────────────────

  markWorkoutComplete: (workoutId, stravaActivityId) => {
    updateWorkoutStatus(workoutId, 'completed', stravaActivityId);
    get().refreshState();
  },

  markWorkoutSkipped: (workoutId) => {
    updateWorkoutStatus(workoutId, 'skipped');
    get().refreshState();
  },

  // ─── Coach ──────────────────────────────────────────────

  addCoachMessage: (role, content, messageType = 'chat', metadata) => {
    const id = require('expo-crypto').randomUUID();
    dbSaveCoachMessage({ id, role, content, message_type: messageType, metadata_json: metadata ?? null });
    set({ coachMessages: getCoachMessages() });
  },

  sendToCoach: async (message) => {
    const Crypto = require('expo-crypto');
    const state = get();
    const { userProfile, paceZones, currentWeek, workouts, todaysWorkout, shoes, weeks, daysUntilRace, isRaceWeek, coachMessages, recoveryStatus } = state;

    if (!userProfile || !paceZones) return;

    // Save user message
    dbSaveCoachMessage({ id: Crypto.randomUUID(), role: 'user', content: message, message_type: 'chat', metadata_json: null });
    set({ coachMessages: getCoachMessages(), isCoachThinking: true });

    try {
      const weekWorkouts = currentWeek
        ? workouts.filter(w => w.week_number === currentWeek.week_number)
        : [];
      const recentMetrics = getRecentMetrics(7);

      const systemPrompt = buildCoachSystemPrompt(
        userProfile, paceZones, currentWeek, weekWorkouts,
        todaysWorkout, recentMetrics, weeks, workouts, shoes,
        daysUntilRace, isRaceWeek, recoveryStatus, get().healthSnapshot,
      );

      const response = await aiSendCoachMessage(message, systemPrompt, coachMessages);

      // Save assistant response
      const metadata = response.planChange ? JSON.stringify(response.planChange) : null;
      dbSaveCoachMessage({
        id: Crypto.randomUUID(),
        role: 'assistant',
        content: response.message,
        message_type: response.planChange ? 'plan_change' : 'chat',
        metadata_json: metadata,
      });

      set({ coachMessages: getCoachMessages(), isCoachThinking: false });
    } catch (error: any) {
      console.error('[Coach] Failed:', error);
      dbSaveCoachMessage({
        id: Crypto.randomUUID(),
        role: 'assistant',
        content: "Sorry, I couldn't process that. Please try again in a moment.",
        message_type: 'chat',
        metadata_json: null,
      });
      set({ coachMessages: getCoachMessages(), isCoachThinking: false });
    }
  },

  setCoachThinking: (thinking) => set({ isCoachThinking: thinking }),

  // ─── AI Briefings ─────────────────────────────────────────

  fetchBriefing: async () => {
    const { todaysWorkout, paceZones, userProfile, currentWeek, daysUntilRace, recoveryStatus } = get();
    if (!todaysWorkout || !paceZones || !userProfile) return;
    if (todaysWorkout.workout_type === 'rest') return;

    try {
      const recentMetrics = getRecentMetrics(7);
      let recoveryInfo: string | null = null;
      if (recoveryStatus && recoveryStatus.level !== 'unknown') {
        const signals = recoveryStatus.signals.map(s => `${s.type}: ${s.detail}`).join(', ');
        recoveryInfo = `RECOVERY: ${recoveryStatus.score}/100 (${recoveryStatus.level}). ${signals}`;
      }
      const briefing = await generateBriefing(
        todaysWorkout, recentMetrics, paceZones,
        userProfile, currentWeek, daysUntilRace, recoveryInfo,
      );
      if (briefing) set({ preWorkoutBriefing: briefing });
    } catch (error) {
      console.warn('[Store] Briefing failed:', error);
    }
  },

  fetchPostRunAnalysis: async (workoutId) => {
    const { workouts, paceZones, userProfile } = get();
    if (!paceZones || !userProfile) return;

    const workout = workouts.find(w => w.id === workoutId);
    if (!workout) return;

    try {
      const metrics = require('./db/database').getMetricsForWorkout(workoutId);
      if (metrics.length === 0) return;

      const analysis = await generatePostRunAnalysis(
        workout, metrics[0], paceZones, userProfile,
      );
      if (analysis) set({ postRunAnalysis: analysis });
    } catch (error) {
      console.warn('[Store] Post-run analysis failed:', error);
    }
  },

  fetchRaceStrategy: async () => {
    const { userProfile, paceZones } = get();
    if (!userProfile || !paceZones) return;

    try {
      const recentMetrics = getRecentMetrics(14);
      const strategy = await generateRaceStrategy(userProfile, paceZones, recentMetrics);
      if (strategy) set({ raceStrategy: strategy });
    } catch (error) {
      console.warn('[Store] Race strategy failed:', error);
    }
  },

  setBriefing: (briefing) => set({ preWorkoutBriefing: briefing }),
  setPostRunAnalysis: (analysis) => set({ postRunAnalysis: analysis }),
  setWeeklyDigest: (digest) => set({ weeklyDigest: digest }),

  // ─── Plan Adaptation ─────────────────────────────────────

  requestPlanAdaptation: async (reason) => {
    const { activePlan, userProfile, paceZones, currentWeekNumber, workouts } = get();
    if (!activePlan || !userProfile || !paceZones) {
      return { success: false, error: 'No active plan or profile' };
    }

    try {
      // Parse the full plan from JSON
      let existingPlan: AIGeneratedPlan;
      try {
        existingPlan = JSON.parse(activePlan.plan_json);
      } catch {
        return { success: false, error: 'Could not parse existing plan' };
      }

      const completedWorkouts = workouts.filter(w => w.status === 'completed');
      const recentMetrics = getRecentMetrics(14);
      const totalWeeks = existingPlan.weeks.length;

      const result = await adaptPlan(
        reason, currentWeekNumber, totalWeeks,
        completedWorkouts, recentMetrics, existingPlan,
        userProfile, paceZones,
      );

      // Save the adapted plan
      const today = getToday();
      savePlan(result.plan, userProfile.vdot_score, today);
      get().refreshState();

      // Log the adaptation as a coach message
      const Crypto = require('expo-crypto');
      dbSaveCoachMessage({
        id: Crypto.randomUUID(),
        role: 'system',
        content: result.changesSummary,
        message_type: 'plan_change',
        metadata_json: JSON.stringify({ reason, violations: result.validation.violations.length }),
      });
      set({ coachMessages: getCoachMessages() });

      // Auto-backup after plan adaptation
      (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); } catch {} })();

      return { success: true, summary: result.changesSummary };
    } catch (error: any) {
      console.error('[Store] Adaptation failed:', error);
      return { success: false, error: error.message || 'Adaptation failed' };
    }
  },

  checkWeeklyReview: async () => {
    const { activePlan, userProfile, paceZones, currentWeekNumber, weeks, workouts } = get();
    if (!activePlan || !userProfile || !paceZones || currentWeekNumber <= 1) return;

    // Check if we already reviewed this week
    const lastReviewedKey = `lastReviewedWeek_${activePlan.id}`;
    const lastReviewed = getSetting(lastReviewedKey);
    if (lastReviewed === String(currentWeekNumber)) return;

    // Review the previous week
    const prevWeek = weeks.find(w => w.week_number === currentWeekNumber - 1);
    if (!prevWeek) return;

    const prevWorkouts = workouts.filter(w => w.week_number === currentWeekNumber - 1);
    const prevMetrics = getRecentMetrics(14);
    const nextWeek = weeks.find(w => w.week_number === currentWeekNumber);
    const nextWorkouts = workouts.filter(w => w.week_number === currentWeekNumber);

    try {
      const review = await generateWeeklyReview(
        prevWeek, prevWorkouts, prevMetrics,
        nextWeek ?? null, nextWorkouts, userProfile, paceZones,
      );

      set({ weeklyDigest: review });
      setSetting(lastReviewedKey, String(currentWeekNumber));

      // Auto-backup at end of week (natural checkpoint)
      (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); } catch {} })();

      // If adaptation needed, auto-trigger
      if (review.adaptationNeeded && review.adaptationReason) {
        console.log('[Store] Weekly review suggests adaptation:', review.adaptationReason);
        // Don't auto-adapt — let the UI show the recommendation
      }
    } catch (error) {
      console.warn('[Store] Weekly review failed:', error);
    }
  },

  // ─── Strava ─────────────────────────────────────────────

  syncStrava: async () => {
    try {
      const { syncStravaActivities } = require('./strava/sync');
      const result: SyncResult = await syncStravaActivities();

      // Sync shoes from athlete profile (fire-and-forget)
      try { const { syncShoes } = require('./strava/shoes'); await syncShoes(); }
      catch (e) { console.warn('[Store] Shoe sync failed:', e); }

      // Auto-update profile from actual training data
      try {
        const { updateProfileFromStrava } = require('./strava/profileUpdater');
        const profileUpdate = updateProfileFromStrava();
        if (profileUpdate.summary) {
          console.log('[Store] Profile auto-updated:', profileUpdate.summary);
          // Recalculate pace zones if VDOT changed
          if (profileUpdate.vdotChanged) {
            const updated = getUserProfile();
            if (updated) {
              const newZones = calculatePaceZones(updated.vdot_score);
              const src = updated.vdot_source === 'strava_race' ? 'race' : 'Strava best effort';
              set({
                userProfile: updated,
                paceZones: newZones,
                vdotNotification: { oldVDOT: profileUpdate.oldVDOT, newVDOT: profileUpdate.newVDOT, source: src },
              });
              try { setSetting('pending_vdot_notification', JSON.stringify({ oldVDOT: profileUpdate.oldVDOT, newVDOT: profileUpdate.newVDOT, source: src })); } catch {}
              // Auto-backup after VDOT change
              (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); } catch {} })();
            }
          }
        }
      } catch (e) { console.warn('[Store] Profile update failed:', e); }

      get().refreshState();
      get().syncStravaConnection();
      get().refreshShoes();

      // Auto-trigger post-run analysis for today's completed workout (fire-and-forget)
      if (result.matched > 0) {
        (async () => {
          try {
            const todayW = get().todaysWorkout;
            if (todayW && (todayW.status === 'completed' || todayW.status === 'partial')) {
              await get().fetchPostRunAnalysis(todayW.id);
            }
          } catch {}
        })();
      }

      return result;
    } catch (e: any) {
      console.error('[Store] syncStrava error:', e.message);
      throw e;
    }
  },

  syncStravaConnection: () => {
    try {
      const database = getDatabase();
      const row = database.getFirstSync<any>('SELECT * FROM strava_tokens WHERE id = 1');
      set({
        isStravaConnected: !!row,
        lastSyncTime: row?.last_sync_at ?? null,
      });
    } catch {
      set({ isStravaConnected: false, lastSyncTime: null });
    }
  },

  refreshShoes: () => {
    set({ shoes: getShoes() });
  },

  // ─── Manual Entry ───────────────────────────────────────

  addManualRun: (date, distanceMiles, durationMinutes, rpe) => {
    const Crypto = require('expo-crypto');
    const avgPace = durationMinutes > 0 && distanceMiles > 0
      ? Math.round((durationMinutes * 60) / distanceMiles)
      : null;

    // Try to match to a scheduled workout
    const { workouts } = get();
    const matchable = workouts.filter(
      w => w.scheduled_date === date && w.workout_type !== 'rest' && w.status === 'upcoming'
    );
    let matchedId: string | null = null;
    if (matchable.length === 1) {
      matchedId = matchable[0].id;
    } else if (matchable.length > 1) {
      // Multiple workouts: match by closest distance
      let bestDiff = Infinity;
      for (const w of matchable) {
        const diff = Math.abs((w.target_distance_miles ?? 0) - distanceMiles);
        if (diff < bestDiff) { bestDiff = diff; matchedId = w.id; }
      }
    }

    const metric: Omit<PerformanceMetric, 'created_at'> = {
      id: Crypto.randomUUID(),
      workout_id: matchedId,
      strava_activity_id: null,
      date,
      distance_miles: distanceMiles,
      duration_minutes: durationMinutes,
      avg_pace_sec_per_mile: avgPace,
      avg_hr: null,
      max_hr: null,
      splits_json: null,
      best_efforts_json: null,
      perceived_exertion: rpe ?? null,
      gear_name: null,
      strava_workout_type: null,
      source: 'manual',
    };

    const { savePerformanceMetric: savePM } = require('./db/database');
    savePM(metric);

    if (matchedId) {
      updateWorkoutStatus(matchedId, 'completed');
    }

    get().refreshState();
  },

  // ─── Health Sync ──────────────────────────────────────────

  syncHealth: async () => {
    try {
      const { syncHealthData } = require('./health/healthSync');
      const { calculateRecoveryScore } = require('./health/recoveryScore');
      const snapshot = await syncHealthData();
      if (snapshot) {
        const profile = get().userProfile;
        const recovery = calculateRecoveryScore(snapshot, {
          restHr: profile?.rest_hr ?? null,
          maxHr: profile?.max_hr ?? null,
        });
        set({ healthSnapshot: snapshot, recoveryStatus: recovery });

        // Auto-update weight from HealthKit if newer
        let needsRefresh = false;
        if (snapshot.weight) {
          const profile = get().userProfile;
          if (profile) {
            const hkDate = snapshot.weight.date;
            const profileDate = profile.weight_updated_at || '';
            if (hkDate > profileDate || !profileDate) {
              // HealthKit weight is newer — update profile
              try {
                const db = require('./db/database').getDatabase();
                db.runSync(
                  'UPDATE user_profile SET weight_kg = ?, weight_source = ?, weight_updated_at = ? WHERE id = 1',
                  [snapshot.weight.value, 'healthkit', hkDate]
                );
                console.log(`[Store] Weight auto-updated from HealthKit: ${snapshot.weight.value}kg (${hkDate})`);
                needsRefresh = true;
              } catch (e) {
                console.log('[Store] Weight auto-update failed:', e);
              }
            }
          }
        }

        // Auto-update resting HR from HealthKit (14-day average, requires 3+ readings)
        if (snapshot.restingHRTrend.length >= 3) {
          const avgRHR = Math.round(snapshot.restingHRTrend.reduce((s: number, r: any) => s + r.value, 0) / snapshot.restingHRTrend.length);
          const currentProfile = get().userProfile;
          if (currentProfile && currentProfile.rest_hr !== avgRHR) {
            try {
              const db = require('./db/database').getDatabase();
              db.runSync(
                'UPDATE user_profile SET rest_hr = ? WHERE id = 1',
                [avgRHR]
              );
              console.log(`[Store] Resting HR auto-updated from HealthKit: ${avgRHR}bpm (${snapshot.restingHRTrend.length}-day avg)`);
              needsRefresh = true;
            } catch (e) {
              console.log('[Store] Resting HR auto-update failed:', e);
            }
          }
        }

        if (needsRefresh) {
          get().refreshState();
        }
      }
    } catch (e) {
      console.log('[Store] Health sync error:', e);
    }
  },

  // ─── Unified Sync (Strava + Health in parallel) ───────────

  syncAll: async () => {
    const state = get();
    if (state.isSyncing) return; // prevent double-sync
    set({ isSyncing: true });

    // Step 1: Sweep past workouts (always, before anything else)
    if (state.activePlan) {
      try {
        const { sweepPastWorkouts } = require('./db/database');
        sweepPastWorkouts();
      } catch {}
    }

    const results: { strava: string | null; health: string | null } = { strava: null, health: null };

    // Step 2: Parallel syncs
    const stravaPromise = state.isStravaConnected
      ? (async () => {
          try {
            const r = await state.syncStrava();
            results.strava = `${r.newActivities} new, ${r.matched} matched`;
          } catch (e) {
            console.log('[SyncAll] Strava failed:', e);
          }
        })()
      : Promise.resolve();

    const healthPromise = (async () => {
      try {
        await state.syncHealth();
        const snap = get().healthSnapshot;
        if (snap) results.health = `${snap.signalCount} signals`;
      } catch (e) {
        console.log('[SyncAll] Health failed:', e);
      }
    })();

    // Also check weekly review
    const reviewPromise = state.activePlan
      ? (async () => { try { await state.checkWeeklyReview(); } catch {} })()
      : Promise.resolve();

    await Promise.allSettled([stravaPromise, healthPromise, reviewPromise]);

    // Step 3: Recalculate volumes after all syncs complete
    if (state.activePlan) {
      try {
        const { recalculateWeeklyVolumes } = require('./db/database');
        recalculateWeeklyVolumes();
      } catch {}
    }

    // Refresh state
    get().refreshState();
    get().fetchBriefing();

    // Step 4: Proactive rest day coaching check
    try {
      const db = require('./db/database').getDatabase();
      const today = require('./utils/dateUtils').getToday();
      const tomorrow = new Date(today + 'T00:00:00');
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      // Check if today is a rest day with an unmatched run
      const restDayRun = db.getFirstSync(
        `SELECT pm.distance_miles FROM performance_metric pm
         JOIN workout w ON w.scheduled_date = pm.date AND w.workout_type = 'rest'
         JOIN training_plan tp ON w.plan_id = tp.id
         WHERE tp.status = 'active' AND pm.date = ? AND pm.workout_id IS NULL`,
        [today]
      ) as { distance_miles: number } | null;

      if (restDayRun && restDayRun.distance_miles >= 4) {
        // Check if tomorrow is a quality session
        const tomorrowWorkout = db.getFirstSync(
          `SELECT id, title, workout_type, target_distance_miles FROM workout
           WHERE scheduled_date = ? AND status = 'upcoming'
           AND workout_type IN ('threshold', 'interval', 'tempo', 'marathon_pace')
           AND plan_id IN (SELECT id FROM training_plan WHERE status = 'active')`,
          [tomorrowStr]
        ) as { id: string; title: string; workout_type: string; target_distance_miles: number } | null;

        if (tomorrowWorkout) {
          const recovery = get().recoveryStatus;
          const lowRecovery = recovery && recovery.score < 60;
          const miles = restDayRun.distance_miles.toFixed(1);

          let message: string;
          if (lowRecovery) {
            message = `You ran ${miles} miles on your rest day and your recovery score is ${recovery!.score}/100. I'd strongly recommend converting tomorrow's ${tomorrowWorkout.title} to an easy run to avoid overtraining.`;
          } else {
            message = `You ran ${miles} miles on your rest day. Tomorrow's ${tomorrowWorkout.title} may be harder than usual since you didn't fully recover. Would you like to swap it to an easy run?`;
          }

          const suggestion = {
            message,
            workoutId: tomorrowWorkout.id,
            action: 'swap_to_easy' as const,
            workoutTitle: tomorrowWorkout.title,
          };
          set({ proactiveSuggestion: suggestion });
          try { setSetting('pending_proactive_suggestion', JSON.stringify(suggestion)); } catch {}
          console.log(`[SyncAll] Proactive suggestion: rest day run + quality tomorrow`);
        }
      }
    } catch (e) {
      console.log('[SyncAll] Proactive check failed:', e);
    }

    set({ isSyncing: false, lastSyncResult: results });
    console.log(`[SyncAll] Done — Strava: ${results.strava ?? 'skipped'}, Health: ${results.health ?? 'skipped'}`);
  },

  // ─── Cross-Training ───────────────────────────────────────

  logCrossTraining: (type, notes) => {
    const Crypto = require('expo-crypto');
    const today = getToday();
    const entry: CrossTraining = {
      id: Crypto.randomUUID(),
      date: today,
      type,
      impact: CROSS_TRAINING_IMPACT[type],
      notes: notes?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    try {
      const { saveCrossTraining } = require('./db/database');
      saveCrossTraining(entry);
      set({ todayCrossTraining: entry });
      console.log(`[Store] Cross-training logged: ${type} (${entry.impact} impact)`);

      // Evaluate impact on tomorrow's workout
      try {
        const { evaluateCrossTrainingImpact } = require('./ai/crossTrainingAdvisor');
        const tomorrow = new Date(today + 'T00:00:00');
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        const tomorrowWorkout = get().workouts.find(w => w.scheduled_date === tomorrowStr && w.status === 'upcoming') ?? null;
        const recoveryScore = get().recoveryStatus?.score ?? null;
        const suggestion = evaluateCrossTrainingImpact(entry, tomorrowWorkout, recoveryScore);
        if (suggestion.shouldSuggest) {
          const ctProactive = {
            message: suggestion.message,
            workoutId: suggestion.tomorrowWorkout!.id,
            action: 'swap_to_easy' as const,
            workoutTitle: suggestion.tomorrowWorkout!.title,
            ctSuggestion: suggestion,
          };
          set({ proactiveSuggestion: ctProactive });
          try { setSetting('pending_proactive_suggestion', JSON.stringify(ctProactive)); } catch {}
          console.log(`[Store] Cross-training suggestion: ${suggestion.severity}`);
        }
      } catch (e) {
        console.log('[Store] CT evaluation failed:', e);
      }
    } catch (e) {
      console.log('[Store] Cross-training save failed:', e);
    }
  },

  deleteCrossTrainingEntry: (id) => {
    try {
      const { deleteCrossTraining, getCrossTrainingForDate } = require('./db/database');
      deleteCrossTraining(id);
      const today = getToday();
      set({ todayCrossTraining: getCrossTrainingForDate(today), proactiveSuggestion: null });
    } catch (e) {
      console.log('[Store] Cross-training delete failed:', e);
    }
  },
}));
