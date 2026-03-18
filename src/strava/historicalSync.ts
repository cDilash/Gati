/**
 * Historical Strava sync for initial baseline.
 * When a user first connects Strava, we pull ~6 months of past activities
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
  // 6 months ago as Unix timestamp
  const sixMonthsAgo = Math.floor((Date.now() - 180 * 86400000) / 1000);

  onProgress?.({
    phase: 'syncing',
    activitiesImported: 0,
    matched: 0,
  });

  // Call sync with historical window — fetches up to 200 activities from 6 months ago
  const result = await syncStravaActivities({
    afterTimestamp: sixMonthsAgo,
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
