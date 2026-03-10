import { Platform, NativeModules } from 'react-native';
import { PerformanceMetric, HealthSnapshot } from '../types';
import * as Crypto from 'expo-crypto';

// react-native-health only works in dev client or production builds.
// In Expo Go, the native module isn't available — all functions gracefully degrade.
// CRITICAL: We must check NativeModules BEFORE require('react-native-health'),
// because that module's index.js accesses NativeModules.AppleHealthKit at module
// scope, which throws in New Architecture if the native module isn't registered.

let _healthKit: any = null;
let _checked = false;
let _available = false;

/**
 * Check if HealthKit native module is available before loading.
 * Safe to call in Expo Go — returns false without crashing.
 */
export function isHealthKitAvailable(): boolean {
  if (_checked) return _available;
  _checked = true;

  if (Platform.OS !== 'ios') {
    _available = false;
    return false;
  }

  // Check if the native module exists BEFORE requiring react-native-health.
  // react-native-health's index.js does `NativeModules.AppleHealthKit` at module
  // scope, which throws in New Arch if the module isn't registered.
  try {
    const hasNativeModule = NativeModules.AppleHealthKit != null;
    if (!hasNativeModule) {
      console.warn('HealthKit native module not found (expected in Expo Go)');
      _available = false;
      return false;
    }

    const mod = require('react-native-health');
    _healthKit = mod.default || mod;
    _available = true;
  } catch {
    console.warn('react-native-health not available (expected in Expo Go)');
    _available = false;
  }

  return _available;
}

function getHealthKit(): any {
  if (!_checked) isHealthKitAvailable();
  return _available ? _healthKit : null;
}

export function initHealthKit(): Promise<boolean> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) {
      resolve(false);
      return;
    }

    const permissions = {
      permissions: {
        read: [
          hk.Constants.Permissions.DistanceWalkingRunning,
          hk.Constants.Permissions.HeartRate,
          hk.Constants.Permissions.Workout,
          hk.Constants.Permissions.RestingHeartRate,
          hk.Constants.Permissions.HeartRateVariability,
          hk.Constants.Permissions.SleepAnalysis,
          hk.Constants.Permissions.Weight,
          hk.Constants.Permissions.StepCount,
        ],
        write: [],
      },
    };

    hk.initHealthKit(permissions, (error: string) => {
      if (error) {
        console.warn('HealthKit init error:', error);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

export interface HealthKitWorkout {
  startDate: string;
  endDate: string;
  duration: number; // minutes
  distance: number; // miles
  calories: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
}

export function getWorkoutsForDate(date: Date): Promise<HealthKitWorkout[]> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) {
      resolve([]);
      return;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const options = {
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
      type: 'Running',
    };

    hk.getSamples(options, (error: any, results: any[]) => {
      if (error || !results) {
        resolve([]);
        return;
      }

      const workouts: HealthKitWorkout[] = results
        .filter((r: any) => r.activityName === 'Running' || r.activityId === 37)
        .map((r: any) => ({
          startDate: r.start || r.startDate,
          endDate: r.end || r.endDate,
          duration: (r.duration || 0) / 60,
          distance: (r.distance || 0) * 0.000621371, // meters to miles
          calories: r.calories || 0,
          averageHeartRate: r.averageHeartRate,
          maxHeartRate: r.maxHeartRate,
        }));

      resolve(workouts);
    });
  });
}

export function getHeartRateForDateRange(startDate: Date, endDate: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) {
      resolve(null);
      return;
    }

    const options = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    hk.getHeartRateSamples(options, (error: any, results: any[]) => {
      if (error || !results || results.length === 0) {
        resolve(null);
        return;
      }
      const avg = results.reduce((sum: number, r: any) => sum + r.value, 0) / results.length;
      resolve(Math.round(avg));
    });
  });
}

export function matchHealthKitToMetric(hkWorkout: HealthKitWorkout, workoutId?: string): PerformanceMetric {
  const durationSeconds = Math.round(hkWorkout.duration * 60);
  const avgPacePerMile = hkWorkout.distance > 0
    ? Math.round(durationSeconds / hkWorkout.distance)
    : 0;

  return {
    id: Crypto.randomUUID(),
    workout_id: workoutId,
    date: hkWorkout.startDate.split('T')[0],
    source: 'healthkit',
    distance_miles: Math.round(hkWorkout.distance * 100) / 100,
    duration_seconds: durationSeconds,
    avg_pace_per_mile: avgPacePerMile,
    avg_hr: hkWorkout.averageHeartRate ? Math.round(hkWorkout.averageHeartRate) : undefined,
    max_hr: hkWorkout.maxHeartRate ? Math.round(hkWorkout.maxHeartRate) : undefined,
    calories: hkWorkout.calories ? Math.round(hkWorkout.calories) : undefined,
    synced_at: new Date().toISOString(),
  };
}

export function getRestingHeartRate(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getRestingHeartRate(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }
        resolve(Math.round(results[results.length - 1].value));
      }
    );
  });
}

export function getHRVSamples(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getHeartRateVariabilitySamples(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }
        const avg = results.reduce((sum: number, r: any) => sum + r.value, 0) / results.length;
        resolve(Math.round(avg * 10) / 10);
      }
    );
  });
}

export function getHRVTrend7d(date: Date): Promise<number[]> {
  return new Promise(async (resolve) => {
    const trend: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(date);
      d.setDate(d.getDate() - i);
      const val = await getHRVSamples(d);
      if (val !== null) trend.push(val);
    }
    resolve(trend);
  });
}

export function getSleepAnalysis(date: Date): Promise<{ hours: number; quality: 'poor' | 'fair' | 'good' } | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    // Sleep for "last night" — query from 6pm previous day to noon today
    const sleepStart = new Date(date);
    sleepStart.setDate(sleepStart.getDate() - 1);
    sleepStart.setHours(18, 0, 0, 0);
    const sleepEnd = new Date(date);
    sleepEnd.setHours(12, 0, 0, 0);

    hk.getSleepSamples(
      { startDate: sleepStart.toISOString(), endDate: sleepEnd.toISOString() },
      (error: any, results: any[]) => {
        if (error || !results || results.length === 0) { resolve(null); return; }

        // Sum total sleep time (exclude INBED, only count ASLEEP/CORE/DEEP/REM)
        let totalMinutes = 0;
        let deepMinutes = 0;
        let remMinutes = 0;

        for (const sample of results) {
          const value = sample.value;
          const start = new Date(sample.startDate || sample.start).getTime();
          const end = new Date(sample.endDate || sample.end).getTime();
          const mins = (end - start) / 60000;

          if (value === 'ASLEEP' || value === 'CORE' || value === 'DEEP' || value === 'REM') {
            totalMinutes += mins;
          }
          if (value === 'DEEP') deepMinutes += mins;
          if (value === 'REM') remMinutes += mins;
        }

        if (totalMinutes < 30) { resolve(null); return; }

        const hours = Math.round(totalMinutes / 60 * 10) / 10;
        const deepRatio = totalMinutes > 0 ? (deepMinutes + remMinutes) / totalMinutes : 0;

        let quality: 'poor' | 'fair' | 'good';
        if (hours >= 7 && deepRatio >= 0.35) quality = 'good';
        else if (hours >= 6 && deepRatio >= 0.2) quality = 'fair';
        else quality = 'poor';

        resolve({ hours, quality });
      }
    );
  });
}

export function getBodyMass(): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    hk.getLatestWeight(
      { unit: 'pound' },
      (error: any, result: any) => {
        if (error || !result) { resolve(null); return; }
        resolve(Math.round(result.value * 10) / 10);
      }
    );
  });
}

export function getStepCount(date: Date): Promise<number | null> {
  return new Promise((resolve) => {
    const hk = getHealthKit();
    if (!hk) { resolve(null); return; }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    hk.getStepCount(
      { startDate: startOfDay.toISOString(), endDate: endOfDay.toISOString() },
      (error: any, result: any) => {
        if (error || !result) { resolve(null); return; }
        resolve(Math.round(result.value));
      }
    );
  });
}

export async function getDailyHealthSnapshot(date: Date): Promise<Partial<HealthSnapshot>> {
  // Run all fetchers in parallel for speed
  const [restingHR, hrv, hrvTrend, sleep, weight, steps] = await Promise.all([
    getRestingHeartRate(date),
    getHRVSamples(date),
    getHRVTrend7d(date),
    getSleepAnalysis(date),
    getBodyMass(),
    getStepCount(date),
  ]);

  return {
    id: Crypto.randomUUID(),
    date: date.toISOString().split('T')[0],
    resting_hr: restingHR,
    hrv_sdnn: hrv,
    hrv_trend_7d: hrvTrend.length > 0 ? hrvTrend : null,
    sleep_hours: sleep?.hours ?? null,
    sleep_quality: sleep?.quality ?? null,
    weight_lbs: weight,
    steps,
    cached_at: new Date().toISOString(),
  };
}
