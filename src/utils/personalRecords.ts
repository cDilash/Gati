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
 * After a Strava sync, check if the most recent activity has any new PRs.
 * Returns a notification if PRs found, null otherwise.
 */
export function detectNewPRs(activityDate: string, activityId: number | null): NewPRNotification | null {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();

    // Get best efforts for this activity
    const row: { best_efforts_json: string } | null = db.getFirstSync(
      `SELECT best_efforts_json FROM performance_metric
       WHERE date = ? AND best_efforts_json IS NOT NULL AND best_efforts_json != '[]'
       ORDER BY date DESC LIMIT 1`,
      activityDate,
    );
    if (!row) return null;

    const efforts: BestEffort[] = JSON.parse(row.best_efforts_json);
    const newPRs = efforts.filter(e => e.prRank === 1);
    if (newPRs.length === 0) return null;

    // For each PR, find the previous best
    const allRows: { best_efforts_json: string; date: string }[] = db.getAllSync(
      `SELECT best_efforts_json, date FROM performance_metric
       WHERE best_efforts_json IS NOT NULL AND best_efforts_json != '[]' AND date < ?
       ORDER BY date DESC`,
      activityDate,
    );

    const prs = newPRs.map(pr => {
      let previousTime: number | null = null;
      let previousDate: string | null = null;

      for (const r of allRows) {
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

    return { prs, activityId, activityDate };
  } catch {
    return null;
  }
}

export function formatPRTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
