/**
 * Strava REST API client.
 * Handles fetching activities, details, and streams.
 * All responses are mapped to our typed interfaces.
 */

import { getValidAccessToken } from './auth';
import {
  StravaActivity,
  StravaActivityDetail,
  StravaBestEffort,
  StravaStreams,
  StravaSplit,
  StravaLap,
} from '../types';

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const RATE_LIMIT_DELAY = 200; // ms between consecutive calls

/** Small delay to be a good API citizen */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generic Strava API fetch helper.
 * Handles auth, rate limiting, and error responses.
 */
async function stravaFetch<T>(
  endpoint: string,
  params?: Record<string, string>,
): Promise<T | null> {
  const token = await getValidAccessToken();
  if (!token) return null;

  const url = new URL(`${STRAVA_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 429) {
    console.warn('Strava rate limited — backing off');
    return null;
  }

  if (!response.ok) {
    console.warn(`Strava API error: ${response.status} on ${endpoint}`);
    return null;
  }

  return response.json();
}

// ─── Response Mappers ──────────────────────────────────────

/**
 * Maps Strava's snake_case API response to our camelCase interface.
 * Strava returns: start_date, moving_time, total_elevation_gain, etc.
 */
function mapActivity(raw: any): StravaActivity {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    startDate: raw.start_date,
    distance: raw.distance,
    movingTime: raw.moving_time,
    elapsedTime: raw.elapsed_time,
    totalElevationGain: raw.total_elevation_gain,
    averageSpeed: raw.average_speed,
    maxSpeed: raw.max_speed,
    averageHeartrate: raw.average_heartrate ?? null,
    maxHeartrate: raw.max_heartrate ?? null,
    hasHeartrate: raw.has_heartrate ?? false,
    sufferScore: raw.suffer_score ?? null,
  };
}

function mapSplit(raw: any): StravaSplit {
  return {
    distance: raw.distance,
    elapsedTime: raw.elapsed_time,
    movingTime: raw.moving_time,
    averageSpeed: raw.average_speed,
    averageHeartrate: raw.average_heartrate ?? null,
    paceZone: raw.pace_zone ?? 0,
    split: raw.split,
  };
}

function mapLap(raw: any): StravaLap {
  return {
    name: raw.name,
    distance: raw.distance,
    elapsedTime: raw.elapsed_time,
    movingTime: raw.moving_time,
    averageSpeed: raw.average_speed,
    averageHeartrate: raw.average_heartrate ?? null,
    maxHeartrate: raw.max_heartrate ?? null,
    lapIndex: raw.lap_index,
  };
}

function mapBestEffort(raw: any): StravaBestEffort {
  return {
    name: raw.name,
    distance: raw.distance,
    movingTime: raw.moving_time,
    elapsedTime: raw.elapsed_time,
    startDate: raw.start_date,
    prRank: raw.pr_rank ?? null,
  };
}

function mapActivityDetail(raw: any): StravaActivityDetail {
  return {
    ...mapActivity(raw),
    calories: raw.calories ?? 0,
    description: raw.description ?? null,
    splitsStandard: (raw.splits_standard ?? []).map(mapSplit),
    laps: (raw.laps ?? []).map(mapLap),
    averageCadence: raw.average_cadence ?? null,
    deviceName: raw.device_name ?? null,
    bestEfforts: (raw.best_efforts ?? []).map(mapBestEffort),
    gearId: raw.gear_id ?? null,
    gearName: raw.gear?.name ?? null,
    perceivedExertion: raw.perceived_exertion ?? null,
    stravaWorkoutType: raw.workout_type ?? null,
    polylineEncoded: raw.map?.polyline ?? null,
    summaryPolylineEncoded: raw.map?.summary_polyline ?? null,
  };
}

// ─── Public API ────────────────────────────────────────────

/**
 * Fetch recent running activities.
 * @param after - Unix timestamp. Only activities after this time are returned.
 * @param perPage - Number of results per page (max 200).
 */
export async function getRecentActivities(
  after?: number,
  perPage: number = 30,
): Promise<StravaActivity[]> {
  const params: Record<string, string> = {
    per_page: String(perPage),
  };
  if (after) {
    params.after = String(after);
  }

  const raw = await stravaFetch<any[]>('/athlete/activities', params);
  if (!raw) return [];

  // Filter to Run type only — ignore rides, swims, hikes, etc.
  return raw
    .filter((a: any) => a.type === 'Run')
    .map(mapActivity);
}

/**
 * Fetch detailed activity data including splits and laps.
 */
export async function getActivityDetail(
  activityId: number,
): Promise<StravaActivityDetail | null> {
  await delay(RATE_LIMIT_DELAY);
  const raw = await stravaFetch<any>(`/activities/${activityId}`);
  if (!raw) return null;
  return mapActivityDetail(raw);
}

/**
 * Fetch activity streams (granular time-series data).
 * Returns per-second HR, pace, distance, elevation, and cadence.
 */
export async function getActivityStreams(
  activityId: number,
): Promise<StravaStreams | null> {
  await delay(RATE_LIMIT_DELAY);
  const raw = await stravaFetch<any>(
    `/activities/${activityId}/streams`,
    {
      keys: 'heartrate,velocity_smooth,distance,altitude,cadence,time',
      key_by_type: 'true',
    },
  );

  if (!raw) return null;

  // Strava returns streams keyed by type when key_by_type=true
  // But it can also return as an array — handle both formats
  if (Array.isArray(raw)) {
    const streams: StravaStreams = {};
    for (const stream of raw) {
      if (stream.type && stream.data) {
        (streams as any)[stream.type] = { data: stream.data };
      }
    }
    return streams;
  }

  // Already keyed by type
  return raw as StravaStreams;
}

/**
 * Fetch the authenticated athlete's profile.
 * Includes shoe list (gear), weight, and lifetime stats.
 */
export async function getAthleteProfile(): Promise<any | null> {
  await delay(RATE_LIMIT_DELAY);
  return stravaFetch<any>('/athlete');
}

/**
 * Fetch detail for a specific piece of gear (shoe).
 * Returns name, brand, and total distance in meters.
 */
export async function getGearDetail(gearId: string): Promise<any | null> {
  await delay(RATE_LIMIT_DELAY);
  return stravaFetch<any>(`/gear/${gearId}`);
}
