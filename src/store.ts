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
  recoveryUpdateToast: { oldScore: number; newScore: number; reason: string } | null;

  // Training Load (PMC)
  pmcData: import('./types').PMCData | null;

  // Garmin Connect
  garminHealth: import('./types').GarminHealthData | null;

  // Personal Records
  personalRecords: import('./types').PersonalRecord[];
  newPRNotification: import('./types').NewPRNotification | null;

  // Cross-Training
  todayCrossTraining: CrossTraining | null;
  weekCrossTraining: CrossTraining[];

  // Sync state
  isSyncing: boolean;
  lastSyncResult: { strava: string | null; health: string | null } | null;
  backupDirty: boolean;
  lastBackupTime: number;

  // Notifications
  pendingPostRunSummary: { workoutId: string; metricId: string } | null;
  vdotNotification: { oldVDOT: number; newVDOT: number; source: string } | null;
  proactiveSuggestion: {
    message: string;
    workoutId: string;
    action: 'swap_to_easy' | 'add_rest_day' | 'reduce_workout';
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
  syncHealth: (forceRefresh?: boolean) => Promise<void>;
  syncAll: () => Promise<void>;
  logCrossTraining: (type: CrossTrainingType, notes?: string) => void;
  deleteCrossTrainingEntry: (id: string) => void;
  calculateTrainingLoad: () => void;
  syncGarminHealth: () => Promise<void>;
  deleteActivity: (metricId: string) => import('./db/database').DeletedActivitySnapshot | null;
  undoDeleteActivity: (snapshot: import('./db/database').DeletedActivitySnapshot) => void;
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
  recoveryUpdateToast: null,
  pmcData: null,
  garminHealth: null,
  personalRecords: [],
  newPRNotification: null,
  todayCrossTraining: null,
  weekCrossTraining: [],
  isSyncing: false,
  lastSyncResult: null,
  backupDirty: false,
  lastBackupTime: 0,
  pendingPostRunSummary: null,
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

      // Load Garmin health data from Supabase (non-blocking, fire-and-forget)
      // The actual sync happens in syncAll() after app loads, but we try to get
      // cached data from the last SQLite snapshot for instant display
      let cachedHealthSnapshot: HealthSnapshot | null = null;
      let cachedRecoveryStatus: RecoveryStatus | null = null;
      let cachedGarminHealth: import('./types').GarminHealthData | null = null;
      try {
        const db = getDatabase();
        const row = db.getFirstSync<any>('SELECT * FROM health_snapshot ORDER BY date DESC LIMIT 1');
        if (row) {
          cachedHealthSnapshot = {
            date: row.date,
            restingHR: row.resting_hr,
            hrvRMSSD: row.hrv_rmssd,
            sleepHours: row.sleep_hours,
            restingHRTrend: JSON.parse(row.resting_hr_trend_json || '[]'),
            hrvTrend: JSON.parse(row.hrv_trend_json || '[]'),
            sleepTrend: JSON.parse(row.sleep_trend_json || '[]'),
            weight: row.weight_kg != null ? { value: row.weight_kg, date: row.date } : null,
            vo2max: row.vo2max != null ? { value: row.vo2max, date: row.date } : null,
            respiratoryRate: row.respiratory_rate ?? null,
            respiratoryRateTrend: JSON.parse(row.respiratory_rate_trend_json || '[]'),
            spo2: row.spo2 ?? null,
            spo2Trend: JSON.parse(row.spo2_trend_json || '[]'),
            steps: row.steps ?? null,
            stepsTrend: [],
            restingHRAge: null,
            sleepAge: null,
            signalCount: row.signal_count ?? 0,
            cachedAt: row.cached_at,
          };
          // Try to load Garmin data too (for recovery score with Garmin baseline)
          try {
            const { getLatestGarminData } = require('./garmin/garminData');
            // Fire synchronously from SQLite cache if available, or skip
            // The real Garmin data comes from syncHealth() via Supabase
          } catch {}
          const { calculateRecoveryScore } = require('./health/recoveryScore');
          cachedRecoveryStatus = calculateRecoveryScore(cachedHealthSnapshot, {
            restHr: profile?.rest_hr ?? null,
            maxHr: profile?.max_hr ?? null,
          }, cachedGarminHealth);
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
        healthSnapshot: cachedHealthSnapshot,
        recoveryStatus: cachedRecoveryStatus,
        todayCrossTraining: todayCT,
        weekCrossTraining: weekCT,
      });

      // Calculate training load (fire-and-forget)
      try { get().calculateTrainingLoad(); } catch {}

      // Compute personal records
      try {
        const { computeAllTimePRs } = require('./utils/personalRecords');
        set({ personalRecords: computeAllTimePRs() });
      } catch {}

      // Restore persisted PR notification
      try {
        const prNote = getSetting('pending_pr_notification');
        if (prNote) {
          const parsed = JSON.parse(prNote);
          const dismissed = getSetting('dismissed_pr_notification_date');
          if (parsed?.activityDate && dismissed !== parsed.activityDate) {
            set({ newPRNotification: parsed });
          }
        }
      } catch {}

      // Restore persisted backup time
      try {
        const savedBackupTime = getSetting('last_backup_time');
        if (savedBackupTime) set({ lastBackupTime: parseInt(savedBackupTime, 10) || 0 });
      } catch {}

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
    (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); { const _t = Date.now(); set({ lastBackupTime: _t, backupDirty: false }); try { setSetting('last_backup_time', String(_t)); } catch {} } } catch {} })();
  },

  // ─── Plan ───────────────────────────────────────────────

  storePlan: (plan, vdot, startDate) => {
    const result = savePlan(plan, vdot, startDate);
    get().refreshState();
    try { setSetting('plan_last_updated', new Date().toISOString()); setSetting('plan_update_source', 'generated'); } catch {}
    // Auto-backup after plan generation (fire-and-forget)
    (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); { const _t = Date.now(); set({ lastBackupTime: _t, backupDirty: false }); try { setSetting('last_backup_time', String(_t)); } catch {} } } catch {} })();
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
      try { setSetting('plan_last_updated', new Date().toISOString()); setSetting('plan_update_source', 'generated'); } catch {}

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
    // Recalculate PMC (future projection changes)
    try { get().calculateTrainingLoad(); } catch {}
  },

  markWorkoutSkipped: (workoutId) => {
    updateWorkoutStatus(workoutId, 'skipped');
    get().refreshState();
  },

  // ─── Coach ──────────────────────────────────────────────

  addCoachMessage: (role, content, messageType = 'chat', metadata) => {
    const id = require('expo-crypto').randomUUID();
    dbSaveCoachMessage({ id, role, content, message_type: messageType, metadata_json: metadata ?? null });
    set({ coachMessages: getCoachMessages(), backupDirty: true });
  },

  sendToCoach: async (message) => {
    const Crypto = require('expo-crypto');
    const state = get();
    const { userProfile, paceZones, currentWeek, workouts, todaysWorkout, shoes, weeks, daysUntilRace, isRaceWeek, coachMessages, recoveryStatus } = state;

    console.log('[Coach] 1. Starting sendToCoach, message:', message.substring(0, 50));

    if (!userProfile || !paceZones) {
      console.log('[Coach] ABORT — no userProfile or paceZones');
      return;
    }

    // Save user message
    dbSaveCoachMessage({ id: Crypto.randomUUID(), role: 'user', content: message, message_type: 'chat', metadata_json: null });
    set({ coachMessages: getCoachMessages(), isCoachThinking: true });

    // 30s safety timeout — guarantees isCoachThinking resets
    const safetyTimeout = setTimeout(() => {
      console.log('[Coach] SAFETY TIMEOUT — 30 seconds exceeded, forcing reset');
      if (get().isCoachThinking) {
        dbSaveCoachMessage({
          id: Crypto.randomUUID(),
          role: 'assistant',
          content: 'Response timed out. Try again — sometimes the AI takes a moment.',
          message_type: 'chat',
          metadata_json: null,
        });
        set({ coachMessages: getCoachMessages(), isCoachThinking: false });
      }
    }, 30_000);

    try {
      console.log('[Coach] 2. Building system prompt...');
      const weekWorkouts = currentWeek
        ? workouts.filter(w => w.week_number === currentWeek.week_number)
        : [];
      const recentMetrics = getRecentMetrics(7);

      const systemPrompt = await buildCoachSystemPrompt(
        userProfile, paceZones, currentWeek, weekWorkouts,
        todaysWorkout, recentMetrics, weeks, workouts, shoes,
        daysUntilRace, isRaceWeek, recoveryStatus, get().healthSnapshot,
        get().garminHealth,
      );
      console.log('[Coach] 3. System prompt built, length:', systemPrompt.length, 'chars (~', Math.round(systemPrompt.length / 4), 'tokens)');

      console.log('[Coach] 4. Calling Gemini...');
      const response = await aiSendCoachMessage(message, systemPrompt, coachMessages);
      console.log('[Coach] 5. Gemini responded, message length:', response.message.length, 'planChange:', !!response.planChange);

      clearTimeout(safetyTimeout);

      // Save assistant response
      const metadata = response.planChange ? JSON.stringify(response.planChange) : null;
      const assistantId = Crypto.randomUUID();
      dbSaveCoachMessage({
        id: assistantId,
        role: 'assistant',
        content: response.message,
        message_type: response.planChange ? 'plan_change' : 'chat',
        metadata_json: metadata,
      });

      const updatedMessages = getCoachMessages();
      console.log('[Coach] 6. Messages after save:', updatedMessages.length, 'last role:', updatedMessages[updatedMessages.length - 1]?.role, 'last id:', updatedMessages[updatedMessages.length - 1]?.id);
      console.log('[Coach] 6a. Saved assistant id:', assistantId, 'found in list:', updatedMessages.some(m => m.id === assistantId));
      set({ coachMessages: updatedMessages, isCoachThinking: false });
      console.log('[Coach] 7. State set, coachMessages length:', get().coachMessages.length);
    } catch (error: any) {
      clearTimeout(safetyTimeout);
      console.error('[Coach] ERROR:', error?.message || error);
      console.error('[Coach] ERROR stack:', error?.stack?.substring(0, 300));
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
    const { todaysWorkout, paceZones, userProfile, currentWeek, daysUntilRace, recoveryStatus, workouts } = get();
    if (!paceZones || !userProfile) return;

    // Check if tomorrow is a long run — show prep reminder on rest days / easy days
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const tomorrowWorkout = workouts.find(w => w.scheduled_date === tomorrowStr);
    const tomorrowIsLongRun = tomorrowWorkout && (tomorrowWorkout.workout_type === 'long' || tomorrowWorkout.workout_type === 'long_run' || (tomorrowWorkout.target_distance_miles ?? 0) >= 10);

    if (tomorrowIsLongRun && (!todaysWorkout || todaysWorkout.workout_type === 'rest')) {
      // Show night-before prep briefing
      const dist = tomorrowWorkout!.target_distance_miles?.toFixed(1) ?? '?';
      set({ preWorkoutBriefing: `Tomorrow's long run: ${tomorrowWorkout!.title} (${dist} mi). Tonight, eat a carb-rich dinner — pasta, rice, or potatoes. Hydrate well. Lay out your gear, charge your watch, and get to bed early. You've got this.` });
      return;
    }

    if (!todaysWorkout || todaysWorkout.workout_type === 'rest') return;

    try {
      const recentMetrics = getRecentMetrics(7);
      let recoveryInfo: string | null = null;
      if (recoveryStatus && recoveryStatus.level !== 'unknown') {
        const signals = recoveryStatus.signals.map(s => `${s.type}: ${s.detail}`).join(', ');
        recoveryInfo = `RECOVERY: ${recoveryStatus.score}/100 (${recoveryStatus.level}). ${signals}`;
        // Add Garmin readiness + recovery time for richer briefing context
        const gd = get().garminHealth;
        if (gd?.trainingReadiness != null) {
          recoveryInfo += `. Training Readiness: ${gd.trainingReadiness}/100`;
          if (gd.readinessFeedbackShort) recoveryInfo += ` (${gd.readinessFeedbackShort.replace(/_/g, ' ').toLowerCase()})`;
        }
        if (gd?.recoveryTimeHours != null) {
          recoveryInfo += `. Recovery time: ${gd.recoveryTimeHours}h remaining`;
        }
        if (gd?.bodyBatteryMorning != null) {
          recoveryInfo += `. Body Battery: ${gd.bodyBatteryMorning}/100 morning`;
        }
      }

      // Fetch weather for the briefing (fire-and-forget if it fails)
      let weatherInfo: string | null = null;
      try {
        const { getWeatherForRun } = require('./ai/weather');
        const weather = await getWeatherForRun();
        if (weather) {
          weatherInfo = `WEATHER: ${weather.temperature}°F (feels like ${weather.feelsLike}°F), ${weather.humidity}% humidity, ${weather.windSpeed} mph wind. ${weather.description}. ${weather.advice}${weather.paceAdjustment > 0 ? ` Suggested pace adjustment: +${weather.paceAdjustment} sec/mile.` : ''}`;
        }
      } catch {}

      const briefing = await generateBriefing(
        todaysWorkout, recentMetrics, paceZones,
        userProfile, currentWeek, daysUntilRace, recoveryInfo, weatherInfo,
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
    console.log('[Store] requestPlanAdaptation called, reason:', reason?.substring(0, 100));
    const { activePlan, userProfile, paceZones, currentWeekNumber, workouts } = get();
    if (!activePlan || !userProfile || !paceZones) {
      console.log('[Store] Adaptation ABORT — missing:', !activePlan ? 'plan' : !userProfile ? 'profile' : 'paceZones');
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

      // Apply adaptation IN-PLACE (update existing plan, don't create new one)
      const { applyAdaptation, getDatabase: getDb } = require('./db/database');
      // Get the plan's actual start date from the earliest workout
      const firstWorkout = getDb().getFirstSync(
        'SELECT scheduled_date FROM workout WHERE plan_id = ? ORDER BY scheduled_date ASC LIMIT 1',
        [activePlan.id]
      ) as { scheduled_date: string } | null;
      const planStartDate = firstWorkout?.scheduled_date ?? getToday();
      applyAdaptation(result.plan, activePlan.id, planStartDate);
      get().refreshState();
      try { setSetting('plan_last_updated', new Date().toISOString()); setSetting('plan_update_source', 'adapted'); } catch {}

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
      (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); { const _t = Date.now(); set({ lastBackupTime: _t, backupDirty: false }); try { setSetting('last_backup_time', String(_t)); } catch {} } } catch {} })();

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
      (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); { const _t = Date.now(); set({ lastBackupTime: _t, backupDirty: false }); try { setSetting('last_backup_time', String(_t)); } catch {} } } catch {} })();

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
              const src = updated.vdot_source === 'garmin_personal_record' ? 'Garmin personal record'
                : updated.vdot_source === 'garmin_race_prediction' ? 'Garmin race prediction'
                : updated.vdot_source === 'garmin_vo2max' ? 'Garmin VO2max'
                : updated.vdot_source === 'strava_race' ? 'race'
                : 'Strava best effort';
              set({
                userProfile: updated,
                paceZones: newZones,
                vdotNotification: { oldVDOT: profileUpdate.oldVDOT, newVDOT: profileUpdate.newVDOT, source: src },
              });
              try { setSetting('pending_vdot_notification', JSON.stringify({ oldVDOT: profileUpdate.oldVDOT, newVDOT: profileUpdate.newVDOT, source: src })); } catch {}
              // Auto-backup after VDOT change
              (async () => { try { const { autoBackup } = require('./backup/backup'); await autoBackup(); { const _t = Date.now(); set({ lastBackupTime: _t, backupDirty: false }); try { setSetting('last_backup_time', String(_t)); } catch {} } } catch {} })();
            }
          }
        }
      } catch (e) { console.warn('[Store] Profile update failed:', e); }

      get().refreshState();
      get().syncStravaConnection();
      get().refreshShoes();

      // Log post-sync state for debugging
      const postSyncWorkout = get().todaysWorkout;
      console.log(`[Store] Post-sync: todaysWorkout status=${postSyncWorkout?.status ?? 'null'}, id=${postSyncWorkout?.id ?? 'null'}, matched=${result.matched}`);

      // Auto-trigger post-run analysis + post-run summary modal
      if (result.matched > 0 || (postSyncWorkout && (postSyncWorkout.status === 'completed' || postSyncWorkout.status === 'partial'))) {
        (async () => {
          try {
            const todayW = get().todaysWorkout;
            if (todayW && (todayW.status === 'completed' || todayW.status === 'partial')) {
              await get().fetchPostRunAnalysis(todayW.id);

              // Show post-run summary modal if not already shown for this workout
              const lastShown = getSetting('last_shown_summary_workout_id');
              if (lastShown !== todayW.id) {
                // Find the matched metric
                const db = getDatabase();
                const metricRow = db.getFirstSync<any>(
                  'SELECT id FROM performance_metric WHERE workout_id = ? ORDER BY date DESC LIMIT 1',
                  [todayW.id]
                );
                if (metricRow) {
                  set({ pendingPostRunSummary: { workoutId: todayW.id, metricId: metricRow.id } });
                }
              }
            }
          } catch {}
        })();
      }

      // Recalculate PMC after new Strava data
      try { get().calculateTrainingLoad(); } catch {}

      // Recompute personal records + detect new PRs
      try {
        const { computeAllTimePRs, detectNewPRs } = require('./utils/personalRecords');
        const prs = computeAllTimePRs();
        set({ personalRecords: prs });

        // Check all synced activities for new PRs (not just today)
        if (result.newActivities > 0 && result.syncedDates.length > 0) {
          const dismissed = getSetting('dismissed_pr_notification_date');
          const latestDate = result.syncedDates.sort().pop()!;
          if (dismissed !== latestDate) {
            const notification = detectNewPRs(result.syncedDates, null);
            if (notification) {
              set({ newPRNotification: notification });
              try { setSetting('pending_pr_notification', JSON.stringify(notification)); } catch {}
            }
          }
        }
      } catch {}

      // Fetch historical weather for new activities (fire-and-forget)
      (async () => {
        try {
          const { fetchWeatherForActivities, backfillLocationData } = require('./strava/weather');
          // Backfill location for old activities first
          const backfilled = await backfillLocationData();
          if (backfilled > 0) console.log(`[Sync] Backfilled location for ${backfilled} activities`);
          // Then fetch weather for activities with coordinates
          const count = await fetchWeatherForActivities();
          if (count > 0) console.log(`[Sync] Fetched weather for ${count} activities`);
        } catch {}
      })();

      // ACWR proactive warning (if no existing suggestion)
      try {
        const { pmcData, proactiveSuggestion } = get();
        if (pmcData && !proactiveSuggestion && pmcData.currentCTL > 10) {
          const acwr = pmcData.currentATL / pmcData.currentCTL;
          if (acwr > 1.5) {
            const db = require('./db/database').getDatabase();
            const today = getToday();
            const tomorrow = new Date(today + 'T00:00:00');
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

            const nextWorkout = db.getFirstSync(
              `SELECT id, title, workout_type, target_distance_miles FROM workout
               WHERE scheduled_date = ? AND status = 'upcoming' AND workout_type != 'rest'
               AND plan_id IN (SELECT id FROM training_plan WHERE status = 'active')`,
              [tomorrowStr]
            ) as { id: string; title: string; workout_type: string; target_distance_miles: number } | null;

            if (nextWorkout) {
              const suggestion = {
                message: `Your training load ratio (ACWR) is ${acwr.toFixed(2)} — above the safe range of 0.8-1.3. High spikes in training volume relative to your fitness increase injury risk. Consider an extra rest day or reducing tomorrow's distance by 25%.`,
                workoutId: nextWorkout.id,
                action: 'reduce_workout' as const,
                workoutTitle: nextWorkout.title,
              };
              set({ proactiveSuggestion: suggestion });
              try { setSetting('pending_proactive_suggestion', JSON.stringify(suggestion)); } catch {}
              console.log(`[PMC] ACWR warning: ${acwr.toFixed(2)} — suggested reducing ${nextWorkout.title}`);
            }
          }
        }
      } catch {}

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

  syncHealth: async (_forceRefresh) => {
    try {
      const { syncGarminHealthData } = require('./health/garminHealthSync');
      const { hasSignificantChanges } = require('./health/healthSync');
      const { calculateRecoveryScore } = require('./health/recoveryScore');

      const oldSnapshot = get().healthSnapshot;
      const oldRecovery = get().recoveryStatus;

      // Fetch all health data from Supabase (Garmin via cloud sync)
      const result = await syncGarminHealthData();
      if (result) {
        const { snapshot, garmin } = result;
        const profile = get().userProfile;
        const recovery = calculateRecoveryScore(snapshot, {
          restHr: profile?.rest_hr ?? null,
          maxHr: profile?.max_hr ?? null,
        }, garmin);
        set({ healthSnapshot: snapshot, recoveryStatus: recovery, garminHealth: garmin });

        // Cache snapshot to SQLite for fast hydration on next app launch
        try {
          const { saveSnapshotToCache } = require('./health/healthSync');
          saveSnapshotToCache(snapshot);
        } catch {}

        // Detect significant changes → show recovery update toast
        if (oldSnapshot && oldRecovery && oldRecovery.level !== 'unknown') {
          const { changed, reason } = hasSignificantChanges(oldSnapshot, snapshot);
          if (changed && Math.abs(recovery.score - oldRecovery.score) >= 10) {
            console.log(`[Store] Recovery updated: ${oldRecovery.score} → ${recovery.score} (${reason})`);
            set({ recoveryUpdateToast: { oldScore: oldRecovery.score, newScore: recovery.score, reason } });
          }
        }

        // Auto-update resting HR from Garmin (14-day average, requires 3+ readings)
        let needsRefresh = false;
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
              console.log(`[Store] Resting HR auto-updated from Garmin: ${avgRHR}bpm (${snapshot.restingHRTrend.length}-day avg)`);
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

    const results: { strava: string | null; health: string | null } = { strava: null, health: null };

    // Step 1: Parallel syncs (Strava MUST run BEFORE sweep so new activities are matched first)
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

    // Note: garminHealth is now fetched inside syncHealth() (Garmin-only, no separate call)

    await Promise.allSettled([stravaPromise, healthPromise, reviewPromise]);

    // Step 2: Sweep past workouts AFTER Strava sync (so new activities are matched first)
    if (state.activePlan) {
      try {
        const { deduplicateWorkouts, sweepPastWorkouts } = require('./db/database');
        deduplicateWorkouts();
        sweepPastWorkouts();
      } catch {}

      // Auto-generate weekly plan if user missed check-in
      try {
        const { shouldAutoGenerate, autoGenerateWeek } = require('./engine/weeklyPlanning');
        if (shouldAutoGenerate()) {
          console.log('[SyncAll] Auto-generating weekly plan (missed check-in)');
          (async () => {
            try {
              const success = await autoGenerateWeek();
              if (success) get().refreshState();
            } catch (e) { console.warn('[SyncAll] Auto-generate failed:', e); }
          })();
        }
      } catch {}
    }

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

    // Note: recovery is now calculated inside syncHealth() with Garmin data (single step)

    // Re-check VDOT from Garmin PRs (PRs cached to SQLite during syncHealth, profileUpdater may have missed them)
    try {
      const { updateProfileFromStrava } = require('./strava/profileUpdater');
      const recheck = updateProfileFromStrava();
      if (recheck.vdotChanged) {
        const updated = getUserProfile();
        if (updated) {
          const newZones = calculatePaceZones(updated.vdot_score);
          const src = updated.vdot_source === 'garmin_personal_record' ? 'Garmin personal record'
            : updated.vdot_source === 'garmin_vo2max' ? 'Garmin VO2max'
            : updated.vdot_source === 'strava_race' ? 'race' : 'best effort';
          set({
            userProfile: updated,
            paceZones: newZones,
            vdotNotification: { oldVDOT: recheck.oldVDOT, newVDOT: recheck.newVDOT, source: src },
          });
          console.log(`[SyncAll] VDOT updated from Garmin PRs: ${recheck.oldVDOT} → ${recheck.newVDOT}`);
        }
      }
    } catch {}

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

    // Auto-backup if dirty flag set and last backup was > 10 minutes ago
    if (get().backupDirty && Date.now() - get().lastBackupTime > 600000) {
      (async () => {
        try {
          const { autoBackup } = require('./backup/backup');
          await autoBackup();
          { const _t = Date.now(); set({ backupDirty: false, lastBackupTime: _t }); try { setSetting('last_backup_time', String(_t)); } catch {} }
          console.log('[SyncAll] Auto-backup triggered (dirty flag)');
        } catch {}
      })();
    }
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
      set({ todayCrossTraining: entry, backupDirty: true });
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

  // ─── Training Load (PMC) ──────────────────────────────────

  calculateTrainingLoad: () => {
    try {
      const { userProfile: profile, activePlan: plan, paceZones } = get();
      if (!profile || !plan) return;

      const today = getToday();
      const {
        getMetricsForDateRange,
        getUpcomingWorkouts,
        getPlanStartDate,
        getPMCCache,
        setPMCCache,
        getAllMetrics,
      } = require('./db/database');

      // Get plan start date
      const startDate = getPlanStartDate(plan.id);
      if (!startDate) return;

      // Build cache hash from metrics count + latest date
      const allMetrics: import('./types').PerformanceMetric[] = getAllMetrics(500);
      const dataHash = `${allMetrics.length}_${allMetrics[0]?.date ?? 'none'}_${today}`;

      // Check cache
      const cached = getPMCCache(dataHash);
      if (cached) {
        try {
          const pmcData = JSON.parse(cached);
          set({ pmcData });
          console.log('[PMC] Loaded from cache');
          return;
        } catch {}
      }

      // Calculate fresh
      const { buildFullPMC } = require('./engine/trainingLoad');
      const metrics = getMetricsForDateRange(startDate, today);
      const futureWorkouts = getUpcomingWorkouts(plan.id, today);

      const pmcData = buildFullPMC(
        metrics,
        profile,
        paceZones,
        startDate,
        today,
        profile.race_date,
        futureWorkouts,
      );

      // Cache it
      try { setPMCCache(JSON.stringify(pmcData), dataHash); } catch {}

      set({ pmcData });
      console.log(`[PMC] Calculated: CTL=${pmcData.currentCTL.toFixed(1)} ATL=${pmcData.currentATL.toFixed(1)} TSB=${pmcData.currentTSB.toFixed(1)} (${pmcData.totalDays}d hist, ${pmcData.projectedDays}d proj)`);
    } catch (e) {
      console.warn('[PMC] Calculation failed:', e);
    }
  },

  // ─── Garmin Connect Health ────────────────────────────────

  syncGarminHealth: async () => {
    // Now handled inside syncHealth() — this is a no-op kept for backward compat
    // syncHealth() fetches from Supabase and sets both healthSnapshot and garminHealth
    console.log('[Garmin] syncGarminHealth called — now handled by syncHealth()');
  },

  deleteActivity: (metricId) => {
    const { deleteActivity: dbDelete } = require('./db/database');
    const snapshot = dbDelete(metricId);
    if (!snapshot) return null;

    // Refresh all state
    get().refreshState();

    // Recompute PRs
    try {
      const { computeAllTimePRs } = require('./utils/personalRecords');
      set({ personalRecords: computeAllTimePRs(), newPRNotification: null });
    } catch {}

    // Recompute VDOT from remaining best efforts
    try {
      const { updateProfileFromStrava } = require('./strava/profileUpdater');
      const profileUpdate = updateProfileFromStrava();
      if (profileUpdate.vdotChanged) {
        const { getUserProfile } = require('./db/database');
        const { calculatePaceZones } = require('./engine/paceZones');
        const updated = getUserProfile();
        if (updated) {
          set({ userProfile: updated, paceZones: calculatePaceZones(updated.vdot_score), vdotNotification: null });
        }
      } else {
        set({ vdotNotification: null });
      }
    } catch {}

    // Recompute PMC
    try { get().calculateTrainingLoad(); } catch {}

    return snapshot;
  },

  undoDeleteActivity: (snapshot) => {
    const { restoreActivity } = require('./db/database');
    restoreActivity(snapshot);

    // Refresh all state
    get().refreshState();

    // Recompute PRs
    try {
      const { computeAllTimePRs } = require('./utils/personalRecords');
      set({ personalRecords: computeAllTimePRs() });
    } catch {}

    // Recompute PMC
    try { get().calculateTrainingLoad(); } catch {}
  },
}));
