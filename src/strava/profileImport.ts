/**
 * profileImport.ts — Extract profile data from Strava for setup pre-fill.
 *
 * Fetches athlete profile + recent activities to derive:
 * - Name, gender, weight
 * - Current weekly mileage (avg of last 4 weeks)
 * - Longest recent run (last 8 weeks)
 * - Best race effort → VDOT calculation
 * - Experience level estimate
 */

import { getAthleteProfile, getRecentActivities, getActivityDetail } from './api';
import { metersToMiles, mpsToSecondsPerMile } from './convert';
import {
  calculateVDOTFrom5K,
  calculateVDOTFrom10K,
  calculateVDOTFromHalf,
  formatTime,
} from '../engine/vdot';

export interface StravaProfileData {
  // Direct from athlete profile
  name: string | null;
  gender: 'Male' | 'Female' | null;
  weightKg: number | null;

  // Derived from recent activities
  currentWeeklyMiles: number | null;
  longestRecentRun: number | null;
  experienceLevel: 'Beginner' | 'Intermediate' | 'Advanced' | null;

  // Best effort → VDOT
  bestEffortDistance: '5K' | '10K' | 'Half Marathon' | null;
  bestEffortTime: string | null;       // formatted "MM:SS" or "H:MM:SS"
  bestEffortSeconds: number | null;
  calculatedVDOT: number | null;

  // Raw data for reference
  totalActivities: number;
  memberSinceYear: number | null;
  recentWeeklyVolumes: number[];       // last 4-8 weeks
}

export async function importStravaProfile(
  onProgress?: (status: string) => void,
): Promise<StravaProfileData> {
  const result: StravaProfileData = {
    name: null,
    gender: null,
    weightKg: null,
    currentWeeklyMiles: null,
    longestRecentRun: null,
    experienceLevel: null,
    bestEffortDistance: null,
    bestEffortTime: null,
    bestEffortSeconds: null,
    calculatedVDOT: null,
    totalActivities: 0,
    memberSinceYear: null,
    recentWeeklyVolumes: [],
  };

  // ── Step 1: Fetch athlete profile ──
  onProgress?.('Fetching your Strava profile...');
  const athlete = await getAthleteProfile();
  if (!athlete) return result;

  result.name = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || null;
  result.gender = athlete.sex === 'M' ? 'Male' : athlete.sex === 'F' ? 'Female' : null;
  result.weightKg = athlete.weight ?? null;
  result.memberSinceYear = athlete.created_at ? new Date(athlete.created_at).getFullYear() : null;

  // ── Step 2: Fetch recent activities (last 8 weeks) ──
  onProgress?.('Analyzing your recent runs...');
  const eightWeeksAgo = Math.floor((Date.now() - 56 * 86400000) / 1000);
  const activities = await getRecentActivities(eightWeeksAgo, 200);
  result.totalActivities = activities.length;

  if (activities.length === 0) {
    // No recent activities — estimate from Strava membership length
    if (result.memberSinceYear) {
      const years = new Date().getFullYear() - result.memberSinceYear;
      result.experienceLevel = years >= 3 ? 'Advanced' : years >= 1 ? 'Intermediate' : 'Beginner';
    }
    return result;
  }

  // ── Step 3: Calculate weekly volumes ──
  onProgress?.('Calculating your weekly mileage...');
  const weekMap = new Map<string, number>();
  let longestRun = 0;

  for (const a of activities) {
    const miles = metersToMiles(a.distance);
    if (miles > longestRun) longestRun = miles;

    // Group by ISO week
    const date = new Date(a.startDate);
    const weekStart = new Date(date);
    const dow = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1)); // Monday
    const weekKey = weekStart.toISOString().split('T')[0];
    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + miles);
  }

  result.longestRecentRun = Math.round(longestRun * 10) / 10;

  // Weekly volumes sorted by date (most recent first)
  const weeklyVolumes = Array.from(weekMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, vol]) => Math.round(vol * 10) / 10);

  result.recentWeeklyVolumes = weeklyVolumes;

  // Average of last 4 complete weeks (skip current partial week)
  const completeWeeks = weeklyVolumes.slice(1, 5); // skip most recent (likely partial)
  if (completeWeeks.length > 0) {
    result.currentWeeklyMiles = Math.round(
      completeWeeks.reduce((s, v) => s + v, 0) / completeWeeks.length * 10
    ) / 10;
  }

  // ── Step 4: Experience level estimate ──
  const avgWeekly = result.currentWeeklyMiles ?? 0;
  const runsPerWeek = activities.length / 8;
  if (avgWeekly >= 40 || runsPerWeek >= 5) {
    result.experienceLevel = 'Advanced';
  } else if (avgWeekly >= 15 || runsPerWeek >= 3) {
    result.experienceLevel = 'Intermediate';
  } else {
    result.experienceLevel = 'Beginner';
  }

  // ── Step 5: Find best effort for VDOT ──
  onProgress?.('Finding your best race efforts...');

  // Check best efforts from activity details (sample up to 5 recent activities)
  const recentForEfforts = activities.slice(0, 5);
  let bestVDOT = 0;
  let bestDistance: '5K' | '10K' | 'Half Marathon' | null = null;
  let bestTime = 0;

  for (const a of recentForEfforts) {
    try {
      const detail = await getActivityDetail(a.id);
      if (!detail?.bestEfforts) continue;

      for (const effort of detail.bestEfforts) {
        let vdot = 0;
        let dist: '5K' | '10K' | 'Half Marathon' | null = null;

        if (effort.name === '5K' || effort.distance >= 4900 && effort.distance <= 5200) {
          vdot = calculateVDOTFrom5K(effort.movingTime);
          dist = '5K';
        } else if (effort.name === '10K' || effort.distance >= 9800 && effort.distance <= 10400) {
          vdot = calculateVDOTFrom10K(effort.movingTime);
          dist = '10K';
        } else if (effort.name === 'Half-Marathon' || effort.distance >= 21000 && effort.distance <= 21300) {
          vdot = calculateVDOTFromHalf(effort.movingTime);
          dist = 'Half Marathon';
        }

        if (vdot > bestVDOT && dist) {
          bestVDOT = vdot;
          bestDistance = dist;
          bestTime = effort.movingTime;
        }
      }
    } catch {
      // Skip activity if detail fetch fails
    }
  }

  if (bestVDOT > 0 && bestDistance && bestTime > 0) {
    result.bestEffortDistance = bestDistance;
    result.bestEffortSeconds = bestTime;
    result.bestEffortTime = formatTime(bestTime);
    result.calculatedVDOT = bestVDOT;
  }

  onProgress?.('Import complete!');
  return result;
}
