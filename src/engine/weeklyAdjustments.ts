/**
 * Weekly Adjustments — modify THIS WEEK's workouts only.
 * Used by AI coach in weekly planning mode instead of full plan adaptation.
 *
 * Rules:
 * - Never touch completed or skipped workouts
 * - Never create training_week rows
 * - Never modify workouts outside current week (Mon-Sun)
 * - All changes are simple SQLite UPDATEs
 */

import * as Crypto from 'expo-crypto';
import { getToday, addDays } from '../utils/dateUtils';

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase();
}

function getCurrentWeekMonday(): string {
  const today = getToday();
  const d = new Date(today + 'T00:00:00');
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(today, mondayOffset);
}

function getActivePlanId(): string | null {
  const db = getDb();
  const row = db.getFirstSync('SELECT id FROM training_plan WHERE status = ?', ['active']) as { id: string } | null;
  return row?.id ?? null;
}

function isWithinCurrentWeek(date: string): boolean {
  const monday = getCurrentWeekMonday();
  const sunday = addDays(monday, 6);
  return date >= monday && date <= sunday;
}

/**
 * Resolve a partial workout ID (8-char prefix from coach prompt) to the full UUID.
 * The coach sees IDs like "ID:749b8b8d" but SQLite stores full UUIDs.
 */
function resolveWorkoutId(partialId: string): string | null {
  const db = getDb();
  // Try exact match first
  const exact = db.getFirstSync("SELECT id FROM workout WHERE id = ?", [partialId]) as { id: string } | null;
  if (exact) return exact.id;
  // Try prefix match (8-char from coach prompt)
  const prefix = db.getFirstSync("SELECT id FROM workout WHERE id LIKE ?", [partialId + '%']) as { id: string } | null;
  return prefix?.id ?? null;
}

// ─── SWAP: Move a workout to a different day ─────────────────

export function swapWorkoutDay(
  workoutId: string,
  newDate: string,
): { success: boolean; message: string } {
  const db = getDb();
  const resolvedId = resolveWorkoutId(workoutId);

  if (!isWithinCurrentWeek(newDate)) {
    return { success: false, message: 'Can only swap within the current week (Mon-Sun)' };
  }

  const workout = db.getFirstSync(
    "SELECT * FROM workout WHERE id = ? AND status = 'upcoming'",
    [resolvedId ?? workoutId]
  ) as any;
  if (!workout) {
    return { success: false, message: 'Workout not found or already completed/skipped' };
  }

  // Check if there's a workout on the target date
  const existing = db.getFirstSync(
    "SELECT * FROM workout WHERE scheduled_date = ? AND plan_id = ? AND status = 'upcoming'",
    [newDate, workout.plan_id]
  ) as any;

  if (existing) {
    // Swap both dates
    db.runSync('UPDATE workout SET scheduled_date = ? WHERE id = ?', [newDate, workout.id]);
    db.runSync('UPDATE workout SET scheduled_date = ? WHERE id = ?', [workout.scheduled_date, existing.id]);
    return { success: true, message: `Swapped ${workout.workout_type} (${workout.scheduled_date}) with ${existing.workout_type} (${newDate})` };
  } else {
    // Just move
    db.runSync('UPDATE workout SET scheduled_date = ? WHERE id = ?', [newDate, workout.id]);
    return { success: true, message: `Moved ${workout.workout_type} from ${workout.scheduled_date} to ${newDate}` };
  }
}

// ─── MODIFY: Change workout properties ───────────────────────

export function modifyWorkout(
  workoutId: string,
  changes: {
    targetDistanceMiles?: number;
    workoutType?: string;
    description?: string;
    targetPaceZone?: string;
    title?: string;
  }
): { success: boolean; message: string } {
  const db = getDb();
  const resolvedId = resolveWorkoutId(workoutId);

  const workout = db.getFirstSync(
    "SELECT * FROM workout WHERE id = ? AND status = 'upcoming'",
    [resolvedId ?? workoutId]
  ) as any;
  if (!workout) {
    return { success: false, message: 'Workout not found or already completed/skipped' };
  }

  // Validate workout is within current week
  if (!isWithinCurrentWeek(workout.scheduled_date)) {
    return { success: false, message: 'Can only modify workouts in the current week (Mon-Sun)' };
  }

  const sets: string[] = [];
  const vals: any[] = [];

  if (changes.targetDistanceMiles !== undefined) {
    sets.push('target_distance_miles = ?');
    vals.push(changes.targetDistanceMiles);
  }
  if (changes.workoutType !== undefined) {
    sets.push('workout_type = ?');
    vals.push(changes.workoutType);
  }
  if (changes.description !== undefined) {
    sets.push('description = ?');
    vals.push(changes.description);
  }
  if (changes.targetPaceZone !== undefined) {
    sets.push('target_pace_zone = ?');
    vals.push(changes.targetPaceZone);
  }
  if (changes.title !== undefined) {
    sets.push('title = ?');
    vals.push(changes.title);
  }

  if (sets.length === 0) {
    return { success: false, message: 'No changes specified' };
  }

  // Mark as modified
  sets.push("status = 'modified'");
  vals.push(workout.id);
  db.runSync(`UPDATE workout SET ${sets.join(', ')} WHERE id = ?`, vals);

  const changedFields = Object.keys(changes).join(', ');
  return { success: true, message: `Modified ${workout.workout_type} on ${workout.scheduled_date}: ${changedFields}` };
}

// ─── SKIP: Mark a workout as skipped ─────────────────────────

export function skipWorkout(
  workoutId: string,
  reason: string,
): { success: boolean; message: string } {
  const db = getDb();
  const resolvedId = resolveWorkoutId(workoutId);

  const workout = db.getFirstSync(
    "SELECT * FROM workout WHERE id = ? AND status IN ('upcoming', 'modified')",
    [resolvedId ?? workoutId]
  ) as any;
  if (!workout) {
    return { success: false, message: 'Workout not found or already completed/skipped' };
  }

  db.runSync(
    "UPDATE workout SET status = 'skipped' WHERE id = ?",
    [workout.id]
  );

  return { success: true, message: `Skipped ${workout.workout_type} on ${workout.scheduled_date}: ${reason}` };
}

// ─── RESCHEDULE: Rearrange remaining workouts around unavailable days ──

export function rescheduleRemainingWorkouts(
  unavailableDates: string[],
  preferredLongRunDate?: string,
): { success: boolean; changes: string[] } {
  const db = getDb();
  const planId = getActivePlanId();
  if (!planId) return { success: false, changes: ['No active plan'] };

  const today = getToday();
  const monday = getCurrentWeekMonday();
  const sunday = addDays(monday, 6);
  const changes: string[] = [];

  // Get all upcoming workouts this week from today onward
  const workouts = db.getAllSync(
    `SELECT * FROM workout
     WHERE plan_id = ? AND scheduled_date >= ? AND scheduled_date <= ?
     AND status IN ('upcoming', 'modified')
     ORDER BY scheduled_date`,
    [planId, today, sunday]
  ) as any[];

  // Find workouts on unavailable dates
  const toMove = workouts.filter((w: any) => unavailableDates.includes(w.scheduled_date));
  const staying = workouts.filter((w: any) => !unavailableDates.includes(w.scheduled_date));

  // Find available dates (not unavailable, not occupied by staying workouts, not in past)
  const occupiedDates = new Set(staying.map((w: any) => w.scheduled_date));
  const availableDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d >= today && !unavailableDates.includes(d) && !occupiedDates.has(d)) {
      availableDates.push(d);
    }
  }

  // Sort: prioritize long runs, then by original order
  const sortedToMove = [...toMove].sort((a: any, b: any) => {
    const aIsLong = a.workout_type === 'long_run' || a.workout_type === 'long' ? -1 : 0;
    const bIsLong = b.workout_type === 'long_run' || b.workout_type === 'long' ? -1 : 0;
    return aIsLong - bIsLong;
  });

  for (const workout of sortedToMove) {
    if (availableDates.length === 0) {
      // No room — skip
      db.runSync("UPDATE workout SET status = 'skipped' WHERE id = ?", [workout.id]);
      changes.push(`Skipped ${workout.workout_type} on ${workout.scheduled_date} (no available day)`);
    } else {
      // Move to best available date
      let targetDate: string;
      const isLongRun = workout.workout_type === 'long_run' || workout.workout_type === 'long';

      if (isLongRun && preferredLongRunDate && availableDates.includes(preferredLongRunDate)) {
        targetDate = preferredLongRunDate;
      } else {
        targetDate = availableDates[0]; // earliest available
      }

      db.runSync('UPDATE workout SET scheduled_date = ? WHERE id = ?', [targetDate, workout.id]);
      changes.push(`Moved ${workout.workout_type} from ${workout.scheduled_date} to ${targetDate}`);
      availableDates.splice(availableDates.indexOf(targetDate), 1);
    }
  }

  // Also mark rest days on unavailable dates as completed (they're "resting" by traveling)
  const restDays = db.getAllSync(
    `SELECT * FROM workout WHERE plan_id = ? AND scheduled_date IN (${unavailableDates.map(() => '?').join(',')})
     AND workout_type = 'rest' AND status = 'upcoming'`,
    [planId, ...unavailableDates]
  ) as any[];
  for (const rd of restDays) {
    db.runSync("UPDATE workout SET status = 'completed' WHERE id = ?", [rd.id]);
  }

  return { success: true, changes };
}

// ─── Lookup helpers for the coach ────────────────────────────

// ─── ADD: Insert a workout on a rest/empty day ──────────────

export function addWorkout(
  date: string,
  workout: {
    workoutType: string;
    targetDistanceMiles: number;
    description: string;
    targetPaceZone?: string;
  }
): { success: boolean; message: string } {
  const db = getDb();
  const Crypto = require('expo-crypto');

  if (!isWithinCurrentWeek(date)) {
    return { success: false, message: 'Can only add workouts within the current week' };
  }

  const planId = getActivePlanId();
  if (!planId) return { success: false, message: 'No active plan' };

  // Check if there's already a non-rest upcoming workout
  const existing = db.getFirstSync(
    "SELECT * FROM workout WHERE scheduled_date = ? AND plan_id = ? AND workout_type != 'rest' AND status = 'upcoming'",
    [date, planId]
  ) as any;
  if (existing) return { success: false, message: `Already a ${existing.workout_type} on ${date}` };

  // Calculate week_number from plan start date
  let weekNumber = 1;
  try {
    const firstDate = db.getFirstSync(
      'SELECT MIN(scheduled_date) as d FROM workout WHERE plan_id = ?', [planId]
    ) as { d: string } | null;
    if (firstDate?.d) {
      const planStart = new Date(firstDate.d + 'T00:00:00');
      const workoutDate = new Date(date + 'T00:00:00');
      weekNumber = Math.max(1, Math.floor((workoutDate.getTime() - planStart.getTime()) / (7 * 86400000)) + 1);
    }
  } catch {}

  const id = Crypto.randomUUID();
  db.runSync(
    `INSERT INTO workout (id, plan_id, scheduled_date, workout_type, target_distance_miles,
     description, target_pace_zone, status, week_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`,
    [id, planId, date, workout.workoutType, workout.targetDistanceMiles,
     workout.description, workout.targetPaceZone || '', weekNumber]
  );

  return { success: true, message: `Added ${workout.workoutType} ${workout.targetDistanceMiles}mi on ${date}` };
}

/**
 * Get all upcoming workouts for the current week.
 * Used by the coach to know what can be adjusted.
 */
export function getCurrentWeekWorkouts(): { id: string; date: string; type: string; distance: number; status: string; title: string }[] {
  const db = getDb();
  const planId = getActivePlanId();
  if (!planId) return [];

  const monday = getCurrentWeekMonday();
  const sunday = addDays(monday, 6);

  const rows = db.getAllSync(
    `SELECT id, scheduled_date, workout_type, target_distance_miles, status, title
     FROM workout WHERE plan_id = ? AND scheduled_date >= ? AND scheduled_date <= ?
     ORDER BY scheduled_date`,
    [planId, monday, sunday]
  ) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    date: r.scheduled_date,
    type: r.workout_type,
    distance: r.target_distance_miles ?? 0,
    status: r.status,
    title: r.title ?? '',
  }));
}
