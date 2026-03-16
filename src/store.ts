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

  // Sync state
  isSyncing: boolean;
  lastSyncResult: { strava: string | null; health: string | null } | null;

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
  isSyncing: false,
  lastSyncResult: null,
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
      });
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
              set({ userProfile: updated, paceZones: newZones });
            }
          }
        }
      } catch (e) { console.warn('[Store] Profile update failed:', e); }

      get().refreshState();
      get().syncStravaConnection();
      get().refreshShoes();
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
    const matchedId = matchable.length === 1 ? matchable[0].id : null;

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
                get().refreshState();
              } catch (e) {
                console.log('[Store] Weight auto-update failed:', e);
              }
            }
          }
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

    const results: { strava: string | null; health: string | null } = { strava: null, health: null };

    const stravaPromise = state.isStravaConnected
      ? (async () => {
          try {
            const r = await state.syncStrava();
            results.strava = `${r.newActivities} new, ${r.matched} matched`;
            // Refresh state after Strava sync brings new data
            if (r.newActivities > 0 || r.matched > 0) {
              get().refreshState();
              // Refresh briefing if new data might affect it
              get().fetchBriefing();
            }
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

    set({ isSyncing: false, lastSyncResult: results });
    console.log(`[SyncAll] Done — Strava: ${results.strava ?? 'skipped'}, Health: ${results.health ?? 'skipped'}`);
  },
}));
