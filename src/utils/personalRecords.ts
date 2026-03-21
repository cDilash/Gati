/**
 * Personal Records computation.
 * Scans all strava_activity_detail best_efforts_json to find all-time bests per distance.
 */

import { PersonalRecord, NewPRNotification } from '../types';

const PR_DISTANCES = ['400m', '1/2 mile', '1K', '1 mile', '2 mile', '5K', '10K', '15K', '10 mile', 'Half-Marathon', 'Marathon'];
// Display subset (most relevant for marathon training)
const DISPLAY_DISTANCES = ['1 mile', '5K', '10K', 'Half-Marathon', 'Marathon'];

interface BestEffort {
  name: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  prRank: number | null;
  startDate?: string;
}

export function computeAllTimePRs(): PersonalRecord[] {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();

    const rows: { best_efforts_json: string; strava_activity_id: number | null; date: string }[] = db.getAllSync(
      `SELECT pm.best_efforts_json, pm.strava_activity_id, pm.date
       FROM performance_metric pm
       WHERE pm.best_efforts_json IS NOT NULL AND pm.best_efforts_json != '[]'
       ORDER BY pm.date DESC`
    );

    // Collect best time per distance
    const bestByDistance = new Map<string, { time: number; date: string; activityId: number | null }>();

    for (const row of rows) {
      try {
        const efforts: BestEffort[] = JSON.parse(row.best_efforts_json);
        for (const e of efforts) {
          if (!e.name || !e.movingTime || e.movingTime <= 0) continue;
          const existing = bestByDistance.get(e.name);
          if (!existing || e.movingTime < existing.time) {
            bestByDistance.set(e.name, {
              time: e.movingTime,
              date: row.date,
              activityId: row.strava_activity_id,
            });
          }
        }
      } catch {}
    }

    // Return ordered by display preference
    const results: PersonalRecord[] = [];
    for (const dist of PR_DISTANCES) {
      const best = bestByDistance.get(dist);
      if (best) {
        results.push({
          distance: dist,
          timeSeconds: best.time,
          date: best.date,
          activityId: best.activityId,
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

export function getDisplayPRs(allPRs: PersonalRecord[]): (PersonalRecord | { distance: string; timeSeconds: null })[] {
  return DISPLAY_DISTANCES.map(dist => {
    const pr = allPRs.find(p => p.distance === dist);
    return pr ?? { distance: dist, timeSeconds: null };
  });
}

/**
 * After a Strava sync, check recent activities for new PRs.
 * Accepts multiple dates to check (e.g. all newly synced activity dates).
 * Returns a notification if PRs found, null otherwise.
 */
export function detectNewPRs(activityDates: string | string[], activityId: number | null): NewPRNotification | null {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();

    const dates = Array.isArray(activityDates) ? activityDates : [activityDates];
    if (dates.length === 0) return null;

    // Get best efforts for all specified dates
    const placeholders = dates.map(() => '?').join(',');
    const rows: { best_efforts_json: string; date: string; strava_activity_id: number | null }[] = db.getAllSync(
      `SELECT best_efforts_json, date, strava_activity_id FROM performance_metric
       WHERE date IN (${placeholders}) AND best_efforts_json IS NOT NULL AND best_efforts_json != '[]'
       ORDER BY date DESC`,
      ...dates,
    );
    if (rows.length === 0) return null;

    // Collect all PR efforts across all dates
    const allNewPRs: { effort: BestEffort; date: string; actId: number | null }[] = [];
    for (const row of rows) {
      try {
        const efforts: BestEffort[] = JSON.parse(row.best_efforts_json);
        for (const e of efforts) {
          if (e.prRank === 1) allNewPRs.push({ effort: e, date: row.date, actId: row.strava_activity_id });
        }
      } catch {}
    }
    if (allNewPRs.length === 0) return null;

    // For each PR, find the previous best (before the earliest checked date)
    const earliestDate = dates.sort()[0];
    const historyRows: { best_efforts_json: string; date: string }[] = db.getAllSync(
      `SELECT best_efforts_json, date FROM performance_metric
       WHERE best_efforts_json IS NOT NULL AND best_efforts_json != '[]' AND date < ?
       ORDER BY date DESC`,
      earliestDate,
    );

    // Deduplicate by distance — keep the fastest PR if multiple dates had PRs for same distance
    const bestByDist = new Map<string, { effort: BestEffort; date: string; actId: number | null }>();
    for (const p of allNewPRs) {
      const existing = bestByDist.get(p.effort.name);
      if (!existing || p.effort.movingTime < existing.effort.movingTime) {
        bestByDist.set(p.effort.name, p);
      }
    }

    const prs = Array.from(bestByDist.values()).map(({ effort: pr }) => {
      let previousTime: number | null = null;
      let previousDate: string | null = null;

      for (const r of historyRows) {
        try {
          const prevEfforts: BestEffort[] = JSON.parse(r.best_efforts_json);
          const match = prevEfforts.find(e => e.name === pr.name && e.movingTime > 0);
          if (match && (previousTime === null || match.movingTime < previousTime)) {
            previousTime = match.movingTime;
            previousDate = r.date;
          }
        } catch {}
      }

      return {
        distance: pr.name,
        time: pr.movingTime,
        previousTime,
        previousDate,
      };
    });

    // Use most recent date as the notification date
    const latestDate = dates.sort().pop()!;
    return { prs, activityId, activityDate: latestDate };
  } catch {
    return null;
  }
}

export function formatPRTime(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
