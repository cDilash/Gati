/**
 * profileUpdater.ts — Auto-update profile values from actual Strava data.
 *
 * After each sync, computes real training metrics and updates user_profile
 * if values have changed significantly. Does NOT auto-regenerate the plan.
 */

import { getRecentMetrics, getUserProfile, getDatabase } from '../db/database';
import { getToday } from '../utils/dateUtils';
import { calculateVDOTFrom5K, calculateVDOTFrom10K, calculateVDOTFromHalf } from '../engine/vdot';

export interface ProfileUpdateResult {
  weeklyMileageChanged: boolean;
  longestRunChanged: boolean;
  vdotChanged: boolean;
  oldWeeklyMiles: number;
  newWeeklyMiles: number;
  oldLongestRun: number;
  newLongestRun: number;
  oldVDOT: number;
  newVDOT: number;
  summary: string | null;
}

/**
 * Check actual training data and update profile if values differ significantly.
 * Returns what changed (if anything).
 */
export function updateProfileFromStrava(): ProfileUpdateResult {
  const profile = getUserProfile();
  if (!profile) {
    return { weeklyMileageChanged: false, longestRunChanged: false, vdotChanged: false, oldWeeklyMiles: 0, newWeeklyMiles: 0, oldLongestRun: 0, newLongestRun: 0, oldVDOT: 0, newVDOT: 0, summary: null };
  }

  const db = getDatabase();
  const result: ProfileUpdateResult = {
    weeklyMileageChanged: false,
    longestRunChanged: false,
    vdotChanged: false,
    oldWeeklyMiles: profile.current_weekly_miles,
    newWeeklyMiles: profile.current_weekly_miles,
    oldLongestRun: profile.longest_recent_run,
    newLongestRun: profile.longest_recent_run,
    oldVDOT: profile.vdot_score,
    newVDOT: profile.vdot_score,
    summary: null,
  };

  const changes: string[] = [];

  // ── 1. Compute actual avg weekly mileage (last 4 complete weeks) ──
  const metrics = getRecentMetrics(35); // ~5 weeks to get 4 complete
  if (metrics.length > 0) {
    const weekMap = new Map<string, number>();
    for (const m of metrics) {
      const date = new Date(m.date + 'T00:00:00');
      const dow = date.getDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const monday = new Date(date);
      monday.setDate(monday.getDate() - mondayOffset);
      const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + m.distance_miles);
    }

    // Skip most recent week (likely partial), take next 4
    const weeklyVolumes = Array.from(weekMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, vol]) => vol);

    const completeWeeks = weeklyVolumes.slice(1, 5); // skip current partial
    if (completeWeeks.length >= 2) {
      const avgWeekly = Math.round(completeWeeks.reduce((s, v) => s + v, 0) / completeWeeks.length * 10) / 10;
      const diff = Math.abs(avgWeekly - profile.current_weekly_miles) / Math.max(profile.current_weekly_miles, 1);

      if (diff > 0.2) { // >20% change
        result.weeklyMileageChanged = true;
        result.newWeeklyMiles = avgWeekly;
        changes.push(`Weekly mileage: ${profile.current_weekly_miles}mi → ${avgWeekly}mi`);
      }
    }
  }

  // ── 2. Find longest run (last 8 weeks) ──
  const allRecent = getRecentMetrics(56);
  if (allRecent.length > 0) {
    const longestRun = Math.round(Math.max(...allRecent.map(m => m.distance_miles)) * 10) / 10;
    if (longestRun > profile.longest_recent_run) {
      result.longestRunChanged = true;
      result.newLongestRun = longestRun;
      changes.push(`Longest run: ${profile.longest_recent_run}mi → ${longestRun}mi`);
    }
  }

  // ── 3. Check for VDOT changes from best efforts + races ──
  try {
    const detailRows = db.getAllSync<any>(
      `SELECT d.best_efforts_json, d.strava_workout_type, p.date
       FROM strava_activity_detail d
       JOIN performance_metric p ON p.strava_activity_id = d.strava_activity_id
       WHERE d.best_efforts_json IS NOT NULL
       ORDER BY p.date DESC LIMIT 20`
    );

    let bestVDOT = 0;
    let vdotSource: 'strava_race' | 'strava_best_effort' = 'strava_best_effort';
    for (const row of detailRows) {
      try {
        const efforts = JSON.parse(row.best_efforts_json);
        if (!Array.isArray(efforts)) continue;
        const isRace = row.strava_workout_type === 1;
        for (const e of efforts) {
          if (e.prRank > 3) continue; // Top 3 efforts
          let vdot = 0;
          if ((e.name === '5K' || (e.distance >= 4900 && e.distance <= 5200)) && e.movingTime > 0) {
            vdot = calculateVDOTFrom5K(e.movingTime);
          } else if ((e.name === '10K' || (e.distance >= 9800 && e.distance <= 10400)) && e.movingTime > 0) {
            vdot = calculateVDOTFrom10K(e.movingTime);
          } else if ((e.name === 'Half-Marathon' || (e.distance >= 21000 && e.distance <= 21300)) && e.movingTime > 0) {
            vdot = calculateVDOTFromHalf(e.movingTime);
          }
          if (vdot > bestVDOT) {
            bestVDOT = vdot;
            vdotSource = isRace ? 'strava_race' : 'strava_best_effort';
          }
        }
      } catch {}
    }

    if (bestVDOT > 0 && Math.abs(bestVDOT - profile.vdot_score) >= 1) {
      result.vdotChanged = true;
      result.newVDOT = bestVDOT;
      const confidence = vdotSource === 'strava_race' ? 'high' : 'moderate';
      changes.push(`VDOT: ${profile.vdot_score} → ${bestVDOT} (${vdotSource === 'strava_race' ? 'race' : 'best effort'})`);
      // Store VDOT metadata alongside the value update
      (result as any)._vdotSource = vdotSource;
      (result as any)._vdotConfidence = confidence;
    }
  } catch {}

  // ── 4. Auto-detect max HR from Strava runs ──
  try {
    const maxHRRow = db.getFirstSync<any>(
      'SELECT MAX(max_hr) as peak FROM performance_metric WHERE max_hr IS NOT NULL'
    );
    const detectedMaxHR = maxHRRow?.peak;
    if (detectedMaxHR && detectedMaxHR > 0) {
      const currentMaxHR = profile.max_hr;
      if (!currentMaxHR || detectedMaxHR > currentMaxHR) {
        db.runSync(
          'UPDATE user_profile SET max_hr = ?, max_hr_source = ? WHERE id = 1',
          [detectedMaxHR, 'strava']
        );
        changes.push(`Max HR: ${currentMaxHR ?? 'unknown'} → ${detectedMaxHR}bpm (from Strava)`);
      }
    }
  } catch {}

  // ── 5. Apply changes to user_profile ──
  if (result.weeklyMileageChanged || result.longestRunChanged || result.vdotChanged) {
    const updates: string[] = [];
    const values: any[] = [];

    if (result.weeklyMileageChanged) {
      updates.push('current_weekly_miles = ?');
      values.push(result.newWeeklyMiles);
    }
    if (result.longestRunChanged) {
      updates.push('longest_recent_run = ?');
      values.push(result.newLongestRun);
    }
    if (result.vdotChanged) {
      updates.push('vdot_score = ?');
      values.push(result.newVDOT);
      updates.push('vdot_updated_at = ?');
      values.push(getToday());
      updates.push('vdot_source = ?');
      values.push((result as any)._vdotSource ?? 'strava_best_effort');
      updates.push('vdot_confidence = ?');
      values.push((result as any)._vdotConfidence ?? 'moderate');
    }
    updates.push("updated_at = datetime('now')");

    db.runSync(`UPDATE user_profile SET ${updates.join(', ')} WHERE id = 1`, ...values);

    result.summary = changes.join('. ') + '. Your plan was built with the old values — consider regenerating.';
    console.log(`[ProfileUpdater] Updated: ${changes.join(', ')}`);
  }

  return result;
}
