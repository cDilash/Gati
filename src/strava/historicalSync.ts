/**
 * Historical Strava sync for initial baseline.
 * When a user first connects Strava, we pull ~8 weeks of past activities
 * to establish ACWR baseline and populate training history.
 */

import { syncStravaActivities } from './sync';

export interface HistoricalSyncProgress {
  phase: 'syncing' | 'complete';
  activitiesImported: number;
  matched: number;
}

export type ProgressCallback = (progress: HistoricalSyncProgress) => void;

/**
 * Fetch and import historical Strava activities going back ~8 weeks.
 * Uses the existing sync pipeline which handles dedup, matching, and storage.
 *
 * Called once after initial Strava connection.
 * Subsequent syncs use the incremental `syncStravaActivities()`.
 */
export async function syncHistoricalActivities(
  onProgress?: ProgressCallback,
): Promise<{ imported: number; matched: number }> {
  // 8 weeks ago as Unix timestamp
  const eightWeeksAgo = Math.floor((Date.now() - 56 * 86400000) / 1000);

  onProgress?.({
    phase: 'syncing',
    activitiesImported: 0,
    matched: 0,
  });

  // Call sync with historical window — fetches up to 200 activities from 8 weeks ago
  const result = await syncStravaActivities({
    afterTimestamp: eightWeeksAgo,
    perPage: 200,
  });

  onProgress?.({
    phase: 'complete',
    activitiesImported: result.newActivities,
    matched: result.matched,
  });

  return {
    imported: result.newActivities,
    matched: result.matched,
  };
}
