/**
 * Weekly Planning — data layer for the week-by-week adaptive system.
 * CRUD for check-ins, phase calculation, previous week summary builder.
 */

import * as Crypto from 'expo-crypto';
import {
  WeeklyCheckin, WeekDay, TrainingPhaseInfo, PhaseName,
  WeekGeneration, PreviousWeekSummary,
} from '../types';

// ─── Phase Calculation ──────────────────────────────────────

export function calculatePhase(raceDate: string, currentDate: string, peakWeeklyMiles: number = 25): TrainingPhaseInfo {
  const race = new Date(raceDate + 'T00:00:00');
  const now = new Date(currentDate + 'T00:00:00');
  const weeksUntilRace = Math.ceil((race.getTime() - now.getTime()) / (7 * 86400000));
  const totalWeeks = Math.max(8, weeksUntilRace);
  const weekNumber = Math.max(1, totalWeeks - weeksUntilRace + 1);

  let phase: PhaseName;
  let targetWeeklyMiles: number;

  if (weeksUntilRace <= 0) {
    phase = 'race_week';
    targetWeeklyMiles = peakWeeklyMiles * 0.3;
  } else if (weeksUntilRace <= 2) {
    phase = 'taper';
    const taperWeek = 3 - weeksUntilRace; // 1 or 2
    targetWeeklyMiles = peakWeeklyMiles * (taperWeek === 1 ? 0.65 : 0.4);
  } else if (weeksUntilRace <= 5) {
    phase = 'peak';
    targetWeeklyMiles = peakWeeklyMiles;
  } else if (weeksUntilRace <= Math.ceil(totalWeeks * 0.6)) {
    phase = 'build';
    const buildProgress = 1 - (weeksUntilRace - 5) / (totalWeeks * 0.6 - 5);
    targetWeeklyMiles = peakWeeklyMiles * (0.65 + buildProgress * 0.35);
  } else {
    phase = 'base';
    const baseProgress = weekNumber / Math.floor(totalWeeks * 0.4);
    targetWeeklyMiles = peakWeeklyMiles * (0.5 + Math.min(baseProgress, 1) * 0.15);
  }

  return {
    phase,
    weekNumber,
    targetWeeklyMiles: Math.round(targetWeeklyMiles * 10) / 10,
    weeksUntilRace,
  };
}

// ─── Check-in CRUD ──────────────────────────────────────────

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase();
}

export function saveWeeklyCheckin(checkin: WeeklyCheckin): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO weekly_checkin
     (id, week_number, race_week_number, created_at, strength_days, leg_day,
      available_days, preferred_long_run_day, time_constraints,
      energy_level, soreness, injury_status, sleep_quality, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    checkin.id,
    checkin.weekNumber,
    checkin.raceWeekNumber,
    checkin.createdAt,
    JSON.stringify(checkin.strengthDays),
    checkin.legDays?.length > 0 ? JSON.stringify(checkin.legDays) : checkin.legDay,
    JSON.stringify(checkin.availableDays),
    checkin.preferredLongRunDay,
    checkin.timeConstraints,
    checkin.energyLevel,
    checkin.soreness,
    checkin.injuryStatus,
    checkin.sleepQuality,
    checkin.notes,
  );
}

function mapCheckinRow(row: any): WeeklyCheckin {
  return {
    id: row.id,
    weekNumber: row.week_number,
    raceWeekNumber: row.race_week_number,
    createdAt: row.created_at,
    strengthDays: row.strength_days ? JSON.parse(row.strength_days) : [],
    legDay: row.leg_day?.startsWith('[') ? JSON.parse(row.leg_day)[0] ?? null : row.leg_day,
    legDays: row.leg_day?.startsWith('[') ? JSON.parse(row.leg_day) : (row.leg_day ? [row.leg_day] : []),
    availableDays: row.available_days ? JSON.parse(row.available_days) : [],
    preferredLongRunDay: row.preferred_long_run_day ?? 'saturday',
    timeConstraints: row.time_constraints,
    energyLevel: row.energy_level ?? 'moderate',
    soreness: row.soreness ?? 'none',
    injuryStatus: row.injury_status,
    sleepQuality: row.sleep_quality ?? 'ok',
    notes: row.notes,
  };
}

export function getLatestCheckin(): WeeklyCheckin | null {
  const db = getDb();
  const row = db.getFirstSync('SELECT * FROM weekly_checkin ORDER BY created_at DESC LIMIT 1');
  return row ? mapCheckinRow(row) : null;
}

export function getCheckinForWeek(weekNumber: number): WeeklyCheckin | null {
  const db = getDb();
  const row = db.getFirstSync('SELECT * FROM weekly_checkin WHERE week_number = ? ORDER BY created_at DESC LIMIT 1', weekNumber);
  return row ? mapCheckinRow(row) : null;
}

// ─── Week Generation CRUD ───────────────────────────────────

export function saveWeekGeneration(gen: WeekGeneration): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO week_generation
     (id, week_number, checkin_id, phase, generated_at, prompt_summary, ai_response, accepted, rejected_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    gen.id,
    gen.weekNumber,
    gen.checkinId,
    gen.phase,
    gen.generatedAt,
    gen.promptSummary,
    gen.aiResponse,
    gen.accepted ? 1 : 0,
    gen.rejectedReason,
  );
}

export function markWeekGenerationAccepted(generationId: string): void {
  const db = getDb();
  db.runSync('UPDATE week_generation SET accepted = 1 WHERE id = ?', generationId);
}

// ─── Training Phase CRUD ────────────────────────────────────

export function getCurrentPhase(): TrainingPhaseInfo | null {
  const db = getDb();
  const row = db.getFirstSync('SELECT * FROM training_phase ORDER BY week_number DESC LIMIT 1') as any;
  if (!row) return null;
  return {
    phase: row.phase,
    weekNumber: row.week_number,
    targetWeeklyMiles: row.target_weekly_miles,
    weeksUntilRace: 0, // caller should recalculate from race date
  };
}

export function setCurrentPhase(phase: TrainingPhaseInfo): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO training_phase (id, phase, started_at, week_number, target_weekly_miles)
     VALUES (?, ?, ?, ?, ?)`,
    Crypto.randomUUID(),
    phase.phase,
    new Date().toISOString(),
    phase.weekNumber,
    phase.targetWeeklyMiles,
  );
}

// ─── Previous Week Summary Builder ──────────────────────────

export function buildPreviousWeekSummary(weekNumber: number): PreviousWeekSummary | null {
  try {
    const db = getDb();
    const { getToday, addDays } = require('../utils/dateUtils');

    // Get last 7 days of data
    const today = getToday();
    const weekAgo = addDays(today, -7);

    const metrics: any[] = db.getAllSync(
      `SELECT pm.*, w.workout_type, w.status as workout_status, w.target_distance_miles
       FROM performance_metric pm
       LEFT JOIN workout w ON w.id = pm.workout_id
       WHERE pm.date >= ? AND pm.date <= ?
       ORDER BY pm.date`,
      weekAgo, today,
    );

    const workouts: any[] = db.getAllSync(
      `SELECT * FROM workout
       WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       AND scheduled_date >= ? AND scheduled_date <= ?
       ORDER BY scheduled_date`,
      weekAgo, today,
    );

    const totalRuns = workouts.filter((w: any) => w.workout_type !== 'rest').length;
    const completedRuns = workouts.filter((w: any) => w.status === 'completed' || w.status === 'partial').length;
    const plannedMiles = workouts.reduce((s: number, w: any) => s + (w.target_distance_miles ?? 0), 0);
    const actualMiles = metrics.reduce((s: number, m: any) => s + (m.distance_miles ?? 0), 0);

    const runs = metrics.map((m: any) => ({
      date: m.date,
      type: m.workout_type ?? 'easy',
      distanceMiles: m.distance_miles,
      paceSecPerMile: m.avg_pace_sec_per_mile,
      avgHR: m.avg_hr,
      status: m.workout_status ?? 'completed',
    }));

    return {
      weekNumber,
      plannedMiles: Math.round(plannedMiles * 10) / 10,
      actualMiles: Math.round(actualMiles * 10) / 10,
      completedRuns,
      totalRuns,
      runs,
      recoveryScoreAvg: null, // filled by caller from health data
      garminVO2max: null,
      garminTrainingStatus: null,
      garminACWR: null,
    };
  } catch {
    return null;
  }
}

// ─── Weekly Plan Prompt Detection ────────────────────────────

/**
 * Should we nudge the user to plan their next week?
 * True on Sunday or Monday if next week has no workouts.
 */
export function shouldPromptWeeklyPlan(): boolean {
  try {
    const { getToday, addDays } = require('../utils/dateUtils');
    const today = getToday();
    const d = new Date(today + 'T00:00:00');
    const dow = d.getDay(); // 0=Sun, 1=Mon, ...

    // Only suggest on Sunday (0) or Monday (1)
    if (dow !== 0 && dow !== 1) return false;

    // Check if next week already has workouts
    const nextMon = getNextMonday();
    const nextSun = addDays(nextMon, 6);

    const db = getDb();
    const count = db.getFirstSync(
      `SELECT count(*) as cnt FROM workout
       WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       AND scheduled_date >= ? AND scheduled_date <= ?
       AND workout_type != 'rest'`,
      nextMon, nextSun,
    ) as { cnt: number } | null;

    if (count && count.cnt > 0) return false; // Already planned

    return true;
  } catch {
    return false;
  }
}

/**
 * Does the CURRENT week need planning? (mid-week, no workouts remaining)
 */
export function shouldPromptCurrentWeek(): boolean {
  try {
    const { getToday, addDays } = require('../utils/dateUtils');
    const today = getToday();
    const monday = getCurrentMonday();
    const sunday = addDays(monday, 6);

    const db = getDb();
    const count = db.getFirstSync(
      `SELECT count(*) as cnt FROM workout
       WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       AND scheduled_date >= ? AND scheduled_date <= ?
       AND workout_type != 'rest'`,
      today, sunday,
    ) as { cnt: number } | null;

    return !count || count.cnt === 0;
  } catch {
    return false;
  }
}

// ─── Utility: Get next Monday ───────────────────────────────

export function getNextMonday(): string {
  const { getToday, addDays } = require('../utils/dateUtils');
  const today = getToday();
  const d = new Date(today + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  return addDays(today, daysUntilMonday);
}

export function getCurrentMonday(): string {
  const { getToday, addDays } = require('../utils/dateUtils');
  const today = getToday();
  const d = new Date(today + 'T00:00:00');
  const dow = d.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return addDays(today, -daysSinceMonday);
}

// ─── Transition: Old Plan → Week-by-Week ────────────────────

export interface TransitionResult {
  deletedUpcoming: number;
  deletedFutureWeeks: number;
  preservedCompleted: number;
  preservedSkipped: number;
  currentPhase: TrainingPhaseInfo;
}

/**
 * Transition from a full 18-week plan to week-by-week adaptive planning.
 * - PRESERVES all completed/skipped/partial workouts (history)
 * - DELETES upcoming workouts from future dates (will be regenerated week by week)
 * - KEEPS training_week rows for past weeks (volume history)
 * - DELETES training_week rows for future weeks (no actual data)
 * - SETS app_settings 'planning_mode' = 'weekly'
 */
export function transitionToWeeklyPlanning(): TransitionResult {
  const db = getDb();
  const { getToday } = require('../utils/dateUtils');
  const { setSetting } = require('../db/database');
  const today = getToday();

  // Get active plan
  const plan = db.getFirstSync("SELECT id FROM training_plan WHERE status = 'active' LIMIT 1") as { id: string } | null;
  if (!plan) {
    throw new Error('No active plan to transition');
  }

  // Count what we're preserving
  const completed = (db.getFirstSync(
    `SELECT count(*) as cnt FROM workout WHERE plan_id = ? AND status IN ('completed', 'partial')`, [plan.id]
  ) as any)?.cnt ?? 0;
  const skipped = (db.getFirstSync(
    `SELECT count(*) as cnt FROM workout WHERE plan_id = ? AND status = 'skipped'`, [plan.id]
  ) as any)?.cnt ?? 0;

  // Delete UPCOMING workouts from today onwards (preserve completed/skipped/partial)
  // Also unlink any metrics first (FK safety)
  db.runSync(
    `UPDATE performance_metric SET workout_id = NULL
     WHERE workout_id IN (
       SELECT id FROM workout WHERE plan_id = ? AND status = 'upcoming' AND scheduled_date >= ?
     )`,
    [plan.id, today]
  );
  const deletedWorkouts = db.runSync(
    `DELETE FROM workout WHERE plan_id = ? AND status = 'upcoming' AND scheduled_date >= ?`,
    [plan.id, today]
  );

  // Find the last completed week number
  const lastCompletedWeek = (db.getFirstSync(
    `SELECT MAX(week_number) as wn FROM workout WHERE plan_id = ? AND status IN ('completed', 'partial', 'skipped')`,
    [plan.id]
  ) as any)?.wn ?? 0;

  // Delete training_week rows for future weeks (keep completed weeks for history)
  const deletedWeeks = db.runSync(
    `DELETE FROM training_week WHERE plan_id = ? AND week_number > ?`,
    [plan.id, lastCompletedWeek + 1] // keep current week + 1 buffer
  );

  // Set planning mode
  setSetting('planning_mode', 'weekly');

  // Calculate current phase
  const profile = db.getFirstSync('SELECT race_date FROM user_profile LIMIT 1') as { race_date: string } | null;
  const phase = calculatePhase(profile?.race_date ?? today, today);

  // Save the current phase
  setCurrentPhase(phase);

  const result: TransitionResult = {
    deletedUpcoming: (deletedWorkouts as any)?.changes ?? 0,
    deletedFutureWeeks: (deletedWeeks as any)?.changes ?? 0,
    preservedCompleted: completed,
    preservedSkipped: skipped,
    currentPhase: phase,
  };

  console.log(`[Transition] Done: deleted ${result.deletedUpcoming} upcoming workouts, ${result.deletedFutureWeeks} future weeks`);
  console.log(`[Transition] Preserved: ${result.preservedCompleted} completed, ${result.preservedSkipped} skipped`);
  console.log(`[Transition] Phase: ${phase.phase}, week ${phase.weekNumber}, ${phase.weeksUntilRace} weeks to race`);

  return result;
}

/**
 * Check if the app is in weekly planning mode.
 */
export function isWeeklyPlanningMode(): boolean {
  try {
    const { getSetting } = require('../db/database');
    return getSetting('planning_mode') === 'weekly';
  } catch {
    return false;
  }
}

/**
 * Get a summary of the training history for display on the Plan screen.
 */
export function getCompletedWeeksSummary(): { weekNumber: number; actualMiles: number; phase: string; completedRuns: number; totalRuns: number }[] {
  try {
    const db = getDb();
    const weeks = db.getAllSync(
      `SELECT tw.week_number, tw.actual_volume, tw.phase,
        (SELECT count(*) FROM workout w WHERE w.plan_id = tw.plan_id AND w.week_number = tw.week_number AND w.status IN ('completed', 'partial')) as completed,
        (SELECT count(*) FROM workout w WHERE w.plan_id = tw.plan_id AND w.week_number = tw.week_number AND w.workout_type != 'rest') as total
       FROM training_week tw
       WHERE tw.plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       ORDER BY tw.week_number`
    ) as any[];

    return weeks.map((w: any) => ({
      weekNumber: w.week_number,
      actualMiles: w.actual_volume ?? 0,
      phase: w.phase,
      completedRuns: w.completed ?? 0,
      totalRuns: w.total ?? 0,
    }));
  } catch {
    return [];
  }
}

// ─── Auto-Generation (missed check-in fallback) ─────────────

/**
 * Should we auto-generate a plan? True if:
 * - It's Monday or later
 * - Weekly planning mode is active
 * - Current week has no workouts
 * - No check-in exists for this week
 */
export function shouldAutoGenerate(): boolean {
  try {
    if (!isWeeklyPlanningMode()) return false;

    const { getToday, addDays } = require('../utils/dateUtils');
    const today = getToday();
    const d = new Date(today + 'T00:00:00');
    const dow = d.getDay();

    // Only auto-generate Monday (1) or later in the week
    if (dow === 0) return false; // Sunday = still time for manual check-in

    const monday = getCurrentMonday();
    const sunday = addDays(monday, 6);

    const db = getDb();
    const count = (db.getFirstSync(
      `SELECT count(*) as cnt FROM workout
       WHERE plan_id IN (SELECT id FROM training_plan WHERE status = 'active')
       AND scheduled_date >= ? AND scheduled_date <= ?
       AND workout_type != 'rest'`,
      monday, sunday,
    ) as any)?.cnt ?? 0;

    return count === 0; // No workouts for current week
  } catch {
    return false;
  }
}

/**
 * Determine focus from training phase.
 */
function determineFocusFromPhase(phase: PhaseName): string {
  switch (phase) {
    case 'base': return 'Build Endurance';
    case 'build': return 'Speed Work';
    case 'peak': return 'Race Prep';
    case 'taper': return 'Recovery';
    case 'race_week': return 'Race Prep';
    default: return 'Maintain';
  }
}

/**
 * Infer available run days from last week's actual runs.
 */
function inferAvailableDaysFromMetrics(metrics: any[]): WeekDay[] {
  const dayNames: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const daysRan = new Set<WeekDay>();
  for (const m of metrics) {
    const d = new Date(m.date + 'T00:00:00');
    daysRan.add(dayNames[d.getDay()]);
  }
  return daysRan.size >= 3 ? Array.from(daysRan) : ['tuesday', 'thursday', 'saturday', 'sunday'];
}

/**
 * Build a default check-in from profile + last week's data.
 * Used when user misses the Sunday check-in deadline.
 */
export function buildDefaultCheckin(profile: any, phase: TrainingPhaseInfo): WeeklyCheckin {
  const lastCheckin = getLatestCheckin();

  // Get last week's actual runs for availability inference
  let inferredDays: WeekDay[] = ['tuesday', 'thursday', 'saturday', 'sunday'];
  try {
    const db = getDb();
    const { getToday, addDays } = require('../utils/dateUtils');
    const weekAgo = addDays(getToday(), -7);
    const metrics = db.getAllSync(
      `SELECT date FROM performance_metric WHERE date >= ? ORDER BY date`,
      weekAgo,
    ) as any[];
    if (metrics.length >= 2) {
      inferredDays = inferAvailableDaysFromMetrics(metrics);
    }
  } catch {}

  return {
    id: require('expo-crypto').randomUUID(),
    weekNumber: phase.weekNumber,
    raceWeekNumber: phase.weeksUntilRace,
    createdAt: new Date().toISOString(),
    strengthDays: lastCheckin?.strengthDays ?? [],
    legDay: lastCheckin?.legDay ?? null,
    legDays: lastCheckin?.legDays ?? [],
    availableDays: lastCheckin?.availableDays ?? inferredDays,
    preferredLongRunDay: lastCheckin?.preferredLongRunDay ?? 'saturday',
    timeConstraints: null,
    energyLevel: 'moderate', // safe default
    soreness: 'none',
    injuryStatus: null,
    sleepQuality: 'ok',
    notes: 'Auto-generated — check-in was not completed',
  };
}

/**
 * Auto-generate a week plan using smart defaults.
 * Called when user misses the Sunday check-in.
 */
export async function autoGenerateWeek(): Promise<boolean> {
  try {
    const db = getDb();
    const { setSetting } = require('../db/database');
    const { getToday, addDays } = require('../utils/dateUtils');
    const { generateWeekPlan } = require('../ai/weekGenerator');

    const profile = db.getFirstSync('SELECT * FROM user_profile LIMIT 1') as any;
    if (!profile) return false;

    const today = getToday();
    const phase = calculatePhase(profile.race_date ?? today, today);
    const defaultCheckin = buildDefaultCheckin(profile, phase);

    // Save the default checkin
    saveWeeklyCheckin(defaultCheckin);

    // Build previous week summary
    const prevWeek = buildPreviousWeekSummary(phase.weekNumber - 1);

    // Get pace zones
    const { calculatePaceZones } = require('../engine/paceZones');
    const paceZones = calculatePaceZones(profile.vdot_score);

    // Recovery + Garmin (best effort)
    let recoveryStatus = null;
    let garminData = null;
    try {
      recoveryStatus = require('../store').useAppStore?.getState()?.recoveryStatus ?? null;
      garminData = require('../store').useAppStore?.getState()?.garminHealth ?? null;
    } catch {}

    const monday = getCurrentMonday();
    const sunday = addDays(monday, 6);

    const generatedWeek = await generateWeekPlan(
      defaultCheckin, prevWeek, profile, paceZones, phase,
      recoveryStatus, garminData, { monday, sunday },
    );

    // Save workouts directly (auto-accept)
    const plan = db.getFirstSync("SELECT id FROM training_plan WHERE status = 'active' LIMIT 1") as { id: string } | null;
    if (!plan) return false;

    const Crypto = require('expo-crypto');
    const { recalculateWeeklyVolumes } = require('../db/database');
    const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    // Training week
    db.runSync(
      `INSERT OR REPLACE INTO training_week (id, plan_id, week_number, phase, target_volume, is_cutback, ai_notes)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      Crypto.randomUUID(), plan.id, generatedWeek.weekNumber, generatedWeek.phase,
      generatedWeek.totalPlannedMiles, generatedWeek.rationale,
    );

    // Delete existing upcoming workouts for this week
    db.runSync(
      `DELETE FROM workout WHERE plan_id = ? AND week_number = ? AND status = 'upcoming'`,
      [plan.id, generatedWeek.weekNumber],
    );

    // Insert workouts
    for (const w of generatedWeek.workouts) {
      db.runSync(
        `INSERT INTO workout (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
          description, target_distance_miles, target_pace_zone, intervals_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'upcoming')`,
        Crypto.randomUUID(), plan.id, generatedWeek.weekNumber,
        allDays.indexOf(w.day), w.date, w.type,
        `${w.type.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`,
        w.description + (w.notes ? `\n${w.notes}` : ''),
        w.distanceMiles, w.targetPaceZone,
      );
    }

    // Add rest days
    const workoutDays = new Set(generatedWeek.workouts.map((w: any) => w.day));
    for (let i = 0; i < 7; i++) {
      if (!workoutDays.has(allDays[i] as WeekDay)) {
        const restDate = addDays(monday, i);
        const existing = db.getFirstSync(
          `SELECT id FROM workout WHERE plan_id = ? AND scheduled_date = ?`, [plan.id, restDate]
        );
        if (!existing) {
          db.runSync(
            `INSERT INTO workout (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
              description, target_distance_miles, target_pace_zone, intervals_json, status)
             VALUES (?, ?, ?, ?, ?, 'rest', 'Rest Day', 'Recovery day', 0, NULL, NULL, 'upcoming')`,
            Crypto.randomUUID(), plan.id, generatedWeek.weekNumber, i, restDate,
          );
        }
      }
    }

    // Save generation record
    saveWeekGeneration({
      id: Crypto.randomUUID(),
      weekNumber: generatedWeek.weekNumber,
      checkinId: defaultCheckin.id,
      phase: generatedWeek.phase,
      generatedAt: new Date().toISOString(),
      promptSummary: 'Auto-generated (missed check-in)',
      aiResponse: JSON.stringify(generatedWeek),
      accepted: true,
      rejectedReason: null,
    });

    recalculateWeeklyVolumes();
    setSetting('plan_last_updated', new Date().toISOString());
    setSetting('plan_update_source', 'auto_generated');
    setSetting('last_week_auto_generated', 'true');

    console.log(`[AutoPlan] Generated: ${generatedWeek.workouts.length} workouts, ${generatedWeek.totalPlannedMiles}mi`);
    return true;
  } catch (e: any) {
    console.error('[AutoPlan] Failed:', e?.message ?? e);
    return false;
  }
}
