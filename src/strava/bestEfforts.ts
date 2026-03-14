/**
 * bestEfforts.ts — VDOT detection from Strava all-time PRs.
 *
 * Strava stores best efforts (5K, 10K, Half-Marathon, etc.) on each
 * detailed activity. When prRank === 1 it's an all-time PR for that
 * athlete. We read these from the local DB (already synced in Phase 9A)
 * and calculate what VDOT that PR implies.
 *
 * This is read-only — no network calls needed.
 */

import {
  calculateVDOTFrom5K,
  calculateVDOTFrom10K,
  calculateVDOTFromHalf,
  formatTime,
} from '../engine/vdot';

export interface VDOTFromPR {
  vdot: number;
  distance: string;      // "5K", "10K", "Half-Marathon"
  prTime: string;        // "MM:SS" or "H:MM:SS"
  movingTimeSec: number;
}

/**
 * Strava best effort name → VDOT calculator mapping.
 * Keys are lowercased Strava effort names.
 */
const EFFORT_CALCULATORS: Record<string, { label: string; calc: (s: number) => number }> = {
  '5k':              { label: '5K',            calc: calculateVDOTFrom5K },
  '10k':             { label: '10K',           calc: calculateVDOTFrom10K },
  'half-marathon':   { label: 'Half-Marathon', calc: calculateVDOTFromHalf },
};

function getDb() {
  const SQLite = require('expo-sqlite');
  return SQLite.openDatabaseSync('marathon_coach.db');
}

/**
 * Scan all stored Strava activity details for all-time PRs (prRank === 1)
 * on supported distances and return the one that implies the highest VDOT.
 *
 * Returns null if no qualifying PR is found.
 */
export function findBestVDOTFromPRs(): VDOTFromPR | null {
  try {
    const db = getDb();
    const rows = db.getAllSync(
      'SELECT best_efforts_json FROM strava_activity_detail WHERE best_efforts_json IS NOT NULL'
    ) as { best_efforts_json: string }[];

    let best: VDOTFromPR | null = null;

    for (const row of rows) {
      try {
        const efforts = JSON.parse(row.best_efforts_json);
        for (const effort of efforts) {
          if (effort.prRank !== 1) continue;

          const key = (effort.name as string)?.toLowerCase();
          const config = EFFORT_CALCULATORS[key];
          if (!config) continue;

          const movingTime: number = effort.movingTime ?? effort.moving_time;
          if (!movingTime || movingTime <= 0) continue;

          const vdot = config.calc(movingTime);

          if (!best || vdot > best.vdot) {
            best = {
              vdot,
              distance: config.label,
              prTime: formatTime(movingTime),
              movingTimeSec: movingTime,
            };
          }
        }
      } catch {
        // Malformed JSON — skip
      }
    }

    return best;
  } catch {
    return null;
  }
}
