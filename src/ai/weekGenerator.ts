/**
 * WEEKLY PLAN GENERATOR — the ONLY way to create workouts in Gati.
 *
 * Generates exactly ONE week (Mon-Sun) based on:
 * - Weekly check-in answers (availability, energy, soreness)
 * - Previous week's actual performance data
 * - Current training phase (from race date)
 * - Garmin health/fitness data
 * - 5-week mileage trend (from actual runs)
 * - Garmin personal records
 * - All-time longest run
 *
 * NEVER generate more than 7 days of workouts.
 * NEVER create a full multi-week plan.
 * The old 18-week plan system was removed because it caused data loss
 * when adaptation wiped all workouts and created empty weeks.
 */

import {
  WeeklyCheckin, GeneratedWeek, GeneratedWorkout, PreviousWeekSummary,
  TrainingPhaseInfo, UserProfile, PaceZones, RecoveryStatus, WeekDay,
} from '../types';
import { sendStructuredMessage, extractJSON, isGeminiAvailable } from './gemini';
import { getUnits } from '../hooks/useUnits';
import {
  formatDistance, formatPaceWithUnit, paceSuffix, formatWeightKg, formatHeight, paceLabel,
} from '../utils/units';

// ─── Helpers ────────────────────────────────────────────────

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase();
}

function fmtPace(secPerMile: number): string {
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function fmtDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Week Context Builder ───────────────────────────────────

interface WeekContext {
  // Mileage trend
  weeklyTrend: { weekStart: string; miles: number; runs: number }[];
  avgWeeklyMiles: number;
  avgRunsPerWeek: number;

  // Previous week actuals
  prevWeekTotalMiles: number;
  prevWeekRunCount: number;
  prevLongestRun: number;
  prevCompletion: number;

  // Historical bests
  allTimeLongestRun: number;
  allTimeLongestDate: string;

  // Easy run averages (last 14 days)
  avgEasyPace: number | null;
  avgEasyHR: number | null;

  // Garmin PRs
  garminPRs: { distance: string; timeSec: number; date: string }[];

  // Volume targets (pre-calculated)
  adjustedTarget: number;
  longRunTarget: number;
  longRunMin: number;
  longRunMax: number;
  numRuns: number;
  isRecoveryWeek: boolean;
}

function buildWeekContext(
  checkin: WeeklyCheckin,
  prevWeek: PreviousWeekSummary | null,
  phase: TrainingPhaseInfo,
): WeekContext {
  const db = getDb();
  const { getToday, addDays } = require('../utils/dateUtils');
  const today = getToday();

  // ── 5-week mileage trend ──
  const fiveWeeksAgo = addDays(today, -35);
  let weeklyTrend: { weekStart: string; miles: number; runs: number }[] = [];
  try {
    const rows = db.getAllSync(
      `SELECT
         date(date, 'weekday 1', '-7 days') as week_start,
         COALESCE(SUM(distance_miles), 0) as miles,
         COUNT(*) as runs
       FROM performance_metric
       WHERE date >= ?
       GROUP BY week_start
       ORDER BY week_start`,
      [fiveWeeksAgo],
    ) as any[];
    weeklyTrend = rows.map((r: any) => ({
      weekStart: r.week_start,
      miles: Math.round((r.miles ?? 0) * 10) / 10,
      runs: r.runs ?? 0,
    }));
  } catch (e) {
    console.warn('[WeekContext] Weekly trend query failed:', e);
  }

  const avgWeeklyMiles = weeklyTrend.length > 0
    ? Math.round(weeklyTrend.reduce((s, w) => s + w.miles, 0) / weeklyTrend.length * 10) / 10
    : 0;
  const avgRunsPerWeek = weeklyTrend.length > 0
    ? Math.round(weeklyTrend.reduce((s, w) => s + w.runs, 0) / weeklyTrend.length * 10) / 10
    : 0;

  // ── Previous week from PreviousWeekSummary ──
  const prevWeekTotalMiles = prevWeek?.actualMiles ?? 0;
  const prevWeekRunCount = prevWeek?.completedRuns ?? 0;
  const prevLongestRun = prevWeek && prevWeek.runs.length > 0
    ? Math.max(...prevWeek.runs.map(r => r.distanceMiles))
    : 0;
  const prevCompletion = prevWeek && prevWeek.plannedMiles > 0
    ? prevWeek.actualMiles / prevWeek.plannedMiles
    : 1;

  // ── All-time longest run ──
  let allTimeLongestRun = 0;
  let allTimeLongestDate = '';
  try {
    const row = db.getFirstSync(
      'SELECT distance_miles, date FROM performance_metric ORDER BY distance_miles DESC LIMIT 1'
    ) as any;
    if (row) {
      allTimeLongestRun = Math.round((row.distance_miles ?? 0) * 10) / 10;
      allTimeLongestDate = row.date ?? '';
    }
  } catch {}

  // ── Easy run averages (last 14 days) ──
  let avgEasyPace: number | null = null;
  let avgEasyHR: number | null = null;
  try {
    const twoWeeksAgo = addDays(today, -14);
    const easyRuns = db.getAllSync(
      `SELECT pm.avg_pace_sec_per_mile, pm.avg_hr
       FROM performance_metric pm
       LEFT JOIN workout w ON pm.workout_id = w.id
       WHERE pm.date >= ?
       AND (w.workout_type IN ('easy', 'recovery') OR w.workout_type IS NULL)
       AND pm.avg_pace_sec_per_mile IS NOT NULL`,
      [twoWeeksAgo],
    ) as any[];
    if (easyRuns.length > 0) {
      const paces = easyRuns.map((r: any) => r.avg_pace_sec_per_mile).filter(Boolean);
      const hrs = easyRuns.map((r: any) => r.avg_hr).filter(Boolean);
      avgEasyPace = paces.length > 0 ? Math.round(paces.reduce((s: number, p: number) => s + p, 0) / paces.length) : null;
      avgEasyHR = hrs.length > 0 ? Math.round(hrs.reduce((s: number, h: number) => s + h, 0) / hrs.length) : null;
    }
  } catch {}

  // ── Garmin PRs from cache ──
  let garminPRs: { distance: string; timeSec: number; date: string }[] = [];
  try {
    const { getSetting } = require('../db/database');
    const prJson = getSetting('garmin_personal_records');
    if (prJson) {
      const parsed = JSON.parse(prJson);
      garminPRs = (Array.isArray(parsed) ? parsed : []).map((pr: any) => ({
        distance: pr.distance_label ?? pr.distance ?? '?',
        timeSec: pr.time_seconds ?? pr.timeSec ?? 0,
        date: pr.activity_date ?? pr.date ?? '',
      })).filter((pr: any) => pr.timeSec > 0);
    }
  } catch {}

  // ── Volume targets ──
  const isRecoveryWeek = phase.weekNumber > 1 && phase.weekNumber % 4 === 0;

  // Base target from phase calculation (already includes peakWeeklyMiles + recovery week)
  let adjustedTarget = phase.targetWeeklyMiles;

  // Override with actual-data-based progression if we have real data
  if (prevWeekTotalMiles > 0) {
    if (prevCompletion < 0.6) {
      adjustedTarget = Math.min(adjustedTarget, prevWeekTotalMiles * 0.9); // struggled → reduce
    } else if (prevCompletion < 0.8) {
      adjustedTarget = Math.min(adjustedTarget, prevWeekTotalMiles); // incomplete → repeat
    } else {
      adjustedTarget = Math.min(adjustedTarget, prevWeekTotalMiles * 1.10); // good → max 10%
    }
  } else if (avgWeeklyMiles > 0) {
    // No previous week but have trend — use average as baseline
    adjustedTarget = Math.min(adjustedTarget, avgWeeklyMiles * 1.10);
  }
  adjustedTarget = Math.max(adjustedTarget, 8); // floor: 8mi/week

  // Recovery week override (even if progression says more)
  if (isRecoveryWeek) {
    adjustedTarget = Math.min(adjustedTarget, (prevWeekTotalMiles > 0 ? prevWeekTotalMiles : adjustedTarget) * 0.8);
  }

  adjustedTarget = Math.round(adjustedTarget * 10) / 10;

  // Auto-reduce number of runs when volume is too low for the run count
  // Target: minimum ~3mi per easy run to be meaningful training
  let numRuns = checkin.availableDays.length;
  const minMilesPerRun = 3.0;
  if (numRuns > 2 && adjustedTarget / numRuns < minMilesPerRun) {
    const idealRuns = Math.max(2, Math.floor(adjustedTarget / minMilesPerRun));
    if (idealRuns < numRuns) {
      console.log(`[WeekContext] Reducing runs from ${numRuns} to ${idealRuns} (${adjustedTarget}mi ÷ ${numRuns} = ${(adjustedTarget / numRuns).toFixed(1)}mi/run < ${minMilesPerRun}mi minimum)`);
      numRuns = idealRuns;
    }
  }

  // Long run target — use the BEST reference (all-time longest or prev week longest)
  const bestLongestRef = Math.max(prevLongestRun, allTimeLongestRun);
  const longRunTarget = bestLongestRef > 0
    ? Math.min(bestLongestRef + 1, adjustedTarget * 0.35) // +1mi from best reference, capped at 35%
    : Math.max(4, adjustedTarget * 0.33); // first week: 33%, min 4mi
  const longRunMin = Math.max(4, Math.round(adjustedTarget * 0.28));
  const longRunMax = Math.min(
    bestLongestRef > 0 ? bestLongestRef + 2 : 20, // max +2mi over best reference
    Math.round(adjustedTarget * 0.40),
  );

  return {
    weeklyTrend, avgWeeklyMiles, avgRunsPerWeek,
    prevWeekTotalMiles, prevWeekRunCount, prevLongestRun, prevCompletion,
    allTimeLongestRun, allTimeLongestDate,
    avgEasyPace, avgEasyHR,
    garminPRs,
    adjustedTarget, longRunTarget, longRunMin, longRunMax, numRuns, isRecoveryWeek,
  };
}

// ─── Prompt Builder ─────────────────────────────────────────

function buildWeekPrompt(
  checkin: WeeklyCheckin,
  prevWeek: PreviousWeekSummary | null,
  profile: UserProfile,
  paceZones: PaceZones,
  phase: TrainingPhaseInfo,
  raceInfo: { name: string; date: string; distance: string; targetTime: string | null },
  recoveryStatus: RecoveryStatus | null,
  garminData: any | null,
  weekDates: { monday: string; sunday: string },
  ctx: WeekContext,
): string {
  const units = getUnits();
  const dLabel = units === 'metric' ? 'km' : 'mi';
  const pLabel = paceLabel(units);
  const { formatPaceRange } = require('../engine/paceZones');

  const parts: string[] = [];
  const legDaysList = checkin.legDays?.length > 0 ? checkin.legDays : (checkin.legDay ? [checkin.legDay] : []);

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: ATHLETE PROFILE & CURRENT FITNESS
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ ATHLETE PROFILE & CURRENT FITNESS ═══');
  parts.push('');
  parts.push(`Name: ${profile.name ?? 'Athlete'}`);
  parts.push(`Age: ${profile.age}${profile.weight_kg ? `, Weight: ${formatWeightKg(profile.weight_kg, units)}` : ''}${profile.height_cm ? `, Height: ${formatHeight(profile.height_cm, units)}` : ''}`);
  parts.push(`Experience: ${profile.experience_level}`);
  parts.push(`Race: ${raceInfo.name}, ${raceInfo.date} (${phase.weeksUntilRace} weeks away)`);
  if (raceInfo.targetTime) parts.push(`Goal: ${raceInfo.targetTime} marathon`);
  parts.push('');

  // Fitness level from real data
  parts.push('CURRENT FITNESS LEVEL:');
  parts.push(`- Weekly mileage (5-week avg): ${formatDistance(ctx.avgWeeklyMiles, units)}/week`);
  parts.push(`- Runs per week (avg): ${ctx.avgRunsPerWeek}`);
  if (ctx.prevLongestRun > 0) {
    parts.push(`- Longest recent run (last week): ${formatDistance(ctx.prevLongestRun, units)}`);
  }
  if (ctx.allTimeLongestRun > 0) {
    parts.push(`- All-time longest: ${formatDistance(ctx.allTimeLongestRun, units)} (${ctx.allTimeLongestDate})`);
  }
  if (ctx.avgEasyPace) {
    parts.push(`- Easy run pace (14-day avg): ${fmtPace(ctx.avgEasyPace)}/${dLabel === 'mi' ? 'mi' : 'km'}${ctx.avgEasyHR ? ` (HR ~${ctx.avgEasyHR})` : ''}`);
  }
  parts.push(`- VDOT: ${profile.vdot_score}${profile.vdot_source ? ` (source: ${profile.vdot_source})` : ''}`);
  parts.push('');

  // Pace zones
  parts.push(`PACE ZONES (${pLabel}):`);
  parts.push(`  E: ${formatPaceRange(paceZones.E)} | M: ${formatPaceRange(paceZones.M)} | T: ${formatPaceRange(paceZones.T)} | I: ${formatPaceRange(paceZones.I)} | R: ${formatPaceRange(paceZones.R)}`);
  parts.push('');

  // Garmin PRs
  if (ctx.garminPRs.length > 0) {
    parts.push('PERSONAL RECORDS (Garmin):');
    for (const pr of ctx.garminPRs) {
      parts.push(`- ${pr.distance}: ${fmtDuration(pr.timeSec)} (${pr.date})`);
    }
    parts.push('');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: GARMIN HEALTH DATA (today)
  // ═══════════════════════════════════════════════════════════
  if (garminData) {
    parts.push('═══ GARMIN HEALTH (today) ═══');
    parts.push('');
    if (garminData.trainingReadiness != null) {
      const feedback = garminData.readinessFeedbackShort
        ? ` (${garminData.readinessFeedbackShort.replace(/_/g, ' ').toLowerCase()})`
        : '';
      parts.push(`- Training Readiness: ${garminData.trainingReadiness}/100${feedback}`);
    }
    if (garminData.recoveryTimeHours != null) parts.push(`- Recovery time: ${garminData.recoveryTimeHours}h remaining`);
    if (garminData.bodyBatteryMorning != null) {
      parts.push(`- Body Battery: morning ${garminData.bodyBatteryMorning}${garminData.bodyBatteryCurrent != null ? `, current ${garminData.bodyBatteryCurrent}` : ''}`);
    }
    if (garminData.hrvLastNightAvg != null) {
      parts.push(`- HRV: ${garminData.hrvLastNightAvg} ms${garminData.hrvBaseline != null ? ` (baseline ${garminData.hrvBaseline})` : ''}${garminData.hrvStatus ? ` — ${garminData.hrvStatus}` : ''}`);
    }
    if (garminData.sleepDurationSec != null) {
      const sleepH = Math.round(garminData.sleepDurationSec / 360) / 10;
      parts.push(`- Sleep: ${sleepH}h${garminData.sleepScore != null ? ` (score: ${garminData.sleepScore}/100)` : ''}`);
    }
    if (garminData.trainingStatus) {
      parts.push(`- Training Status: ${garminData.trainingStatus}${garminData.trainingLoad7day != null ? `, 7d load: ${garminData.trainingLoad7day}` : ''}${garminData.acwr != null ? `, ACWR: ${garminData.acwr}` : ''}`);
    }
    if (garminData.hillScore != null) {
      parts.push(`- Hill Score: ${garminData.hillScore} (endurance: ${garminData.hillEndurance ?? '?'}, strength: ${garminData.hillStrength ?? '?'})`);
    }
    if (garminData.enduranceScore != null) parts.push(`- Endurance Score: ${garminData.enduranceScore}`);
    if (garminData.vo2max != null) {
      parts.push(`- VO2max: ${garminData.vo2max} ml/kg/min${garminData.vo2maxFitnessAge != null ? ` (fitness age: ${garminData.vo2maxFitnessAge})` : ''}`);
    }
    if (garminData.lactateThresholdHr != null) {
      const ltPace = garminData.lactateThresholdSpeed && garminData.lactateThresholdSpeed > 0
        ? Math.round(1609.344 / garminData.lactateThresholdSpeed)
        : null;
      parts.push(`- Lactate Threshold: ${garminData.lactateThresholdHr} bpm${ltPace ? ` @ ${fmtPace(ltPace)}/mi` : ''}`);
    }
    if (garminData.restingHr != null) parts.push(`- Resting HR: ${garminData.restingHr} bpm`);
    parts.push('');
  }

  // Recovery status
  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    parts.push(`RECOVERY STATUS: ${recoveryStatus.score}/100 (${recoveryStatus.level})`);
    for (const s of recoveryStatus.signals) {
      if (s.score > 0) parts.push(`  ${s.type}: ${s.detail}`);
    }
    parts.push('');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: TRAINING HISTORY
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ TRAINING HISTORY ═══');
  parts.push('');

  // Previous week actual runs
  if (prevWeek && prevWeek.runs.length > 0) {
    parts.push('LAST WEEK\'S ACTUAL TRAINING:');
    for (const run of prevWeek.runs) {
      const pace = run.paceSecPerMile ? fmtPace(run.paceSecPerMile) + `/${dLabel === 'mi' ? 'mi' : 'km'}` : '?';
      parts.push(`- ${run.date}: ${run.type} ${formatDistance(run.distanceMiles, units)} @ ${pace}${run.avgHR ? `, HR ${run.avgHR}` : ''} — ${run.status}`);
    }
    parts.push(`Total: ${formatDistance(ctx.prevWeekTotalMiles, units)} over ${ctx.prevWeekRunCount} runs`);
    parts.push(`Completion: ${Math.round(ctx.prevCompletion * 100)}% of planned`);
    parts.push('');
  } else {
    parts.push('LAST WEEK: No data (first week or no runs recorded)');
    parts.push('');
  }

  // 5-week mileage trend
  if (ctx.weeklyTrend.length > 0) {
    parts.push('WEEKLY MILEAGE TREND (last 5 weeks):');
    for (const w of ctx.weeklyTrend) {
      parts.push(`- Week of ${w.weekStart}: ${formatDistance(w.miles, units)} (${w.runs} runs)`);
    }
    parts.push(`Average: ${formatDistance(ctx.avgWeeklyMiles, units)}/week`);
    parts.push('');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: COACHING FRAMEWORK (science-backed rules)
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ COACHING FRAMEWORK (evidence-based — follow strictly) ═══');
  parts.push('');

  // 4a. 80/20 Intensity Distribution
  const easyMiles = Math.round(ctx.adjustedTarget * 0.8 * 10) / 10;
  const hardMiles = Math.round(ctx.adjustedTarget * 0.2 * 10) / 10;
  parts.push('INTENSITY DISTRIBUTION (80/20 RULE):');
  parts.push(`80% of weekly volume MUST be at easy/conversational pace (Zone 1-2).`);
  parts.push(`Only 20% at moderate/hard intensity (Zone 3+).`);
  parts.push(`For this ${formatDistance(ctx.adjustedTarget, units)} week:`);
  parts.push(`- Easy miles: ~${formatDistance(easyMiles, units)} (easy, recovery, long run at easy pace)`);
  parts.push(`- Hard miles: ~${formatDistance(hardMiles, units)} (tempo + intervals combined)`);
  parts.push(`Maximum 1-2 hard workouts per week. NEVER more than 2.`);
  parts.push(`All other runs MUST be truly EASY — conversational pace.`);
  parts.push('');

  // 4b. HR Zone Targets
  const maxHR = profile.max_hr ?? (garminData?.maxHr ?? 190);
  const restHR = profile.rest_hr ?? (garminData?.restingHr ?? 60);
  const z1Ceil = Math.round(maxHR * 0.6);
  const z2Low = z1Ceil;
  const z2High = Math.round(maxHR * 0.7);
  const z3Low = z2High;
  const z3High = Math.round(maxHR * 0.8);
  const z4Low = z3High;
  const z4High = Math.round(maxHR * 0.9);

  parts.push('HR ZONE TARGETS (use ACTUAL BPM in workout descriptions):');
  parts.push(`Max HR: ${maxHR} bpm, Resting HR: ${restHR} bpm`);
  parts.push(`- Zone 1 (Recovery): < ${z1Ceil} bpm`);
  parts.push(`- Zone 2 (Easy/Aerobic): ${z2Low}-${z2High} bpm ← 80% of runs here`);
  parts.push(`- Zone 3 (Tempo/Marathon): ${z3Low}-${z3High} bpm ← tempo, marathon pace`);
  parts.push(`- Zone 4 (Threshold): ${z4Low}-${z4High} bpm ← intervals`);
  parts.push(`- Zone 5 (VO2max): > ${z4High} bpm ← sprint intervals only`);
  parts.push(`Include ACTUAL BPM targets in each workout description.`);
  parts.push(`Example: "Easy run at Zone 2 (${z2Low}-${z2High} bpm)" not just "Easy run".`);
  parts.push('');

  // 4c. Long Run Rules
  const goalPace = profile.target_finish_time_sec
    ? fmtPace(Math.round(profile.target_finish_time_sec / 26.2))
    : null;
  parts.push('LONG RUN RULES:');
  parts.push(`- Long run ≤ 30% of weekly mileage (≤ ${formatDistance(Math.round(ctx.adjustedTarget * 0.30 * 10) / 10, units)} for this week)`);
  parts.push('- Long run should not exceed ~2.5 hours (diminishing returns after that)');
  parts.push(`- Pacing: Zone 2 (${z2Low}-${z2High} bpm) throughout`);
  if (['build', 'peak'].includes(phase.phase) && goalPace) {
    parts.push(`- In BUILD/PEAK: optional final 2-4 miles at marathon pace (${goalPace}/mi, Zone 3)`);
  }
  if (goalPace && phase.weeksUntilRace >= 8) {
    parts.push(`- Marathon pace practice starts now — include MP segments in long runs`);
  }
  parts.push('');

  // 4d. Workout Type Progression
  parts.push('WORKOUT TYPE PROGRESSION BY PHASE:');
  parts.push('BASE:');
  parts.push('- Mostly easy runs + optional hill strides 1x/week (6×60s uphill)');
  parts.push('- ONE steady tempo per week is allowed (e.g. 3×8min or 20min continuous at Zone 3)');
  parts.push('- NO intervals. NO marathon pace work. Keep the tempo SHORT and controlled.');
  parts.push('');
  parts.push('BUILD:');
  parts.push('- 1 interval session/week: start 6×400m → progress to 4×800m → 3×1200m');
  parts.push('- 1 tempo session/week: start 3×8min → progress to 2×12min → 20min continuous');
  if (goalPace) parts.push(`- Long run: add ${goalPace}/mi pace segments in final miles`);
  parts.push('- Total hard sessions: exactly 2 per week, no more');
  parts.push('');
  parts.push('PEAK:');
  if (goalPace) {
    parts.push(`- Marathon pace is KEY workout: 2×4mi at MP (${goalPace}/mi) → 6mi continuous at MP`);
  } else {
    parts.push('- Marathon pace is KEY workout: 2×4mi at MP → 6mi continuous at MP');
  }
  parts.push('- 1 shorter interval session (4×800m for leg turnover)');
  parts.push('- Long runs 16-18mi with 4-6mi at marathon pace');
  parts.push('- Total hard sessions: 2 per week');
  parts.push('');
  parts.push('TAPER:');
  parts.push('- 1 short tempo (2×10min at MP) + 1 short interval (3×600m)');
  parts.push('- All other runs very easy, long run drops to 8-10mi then 5-6mi');
  parts.push('');

  // 4e. Strength Training Integration
  if (checkin.strengthDays.length > 0 || legDaysList.length > 0) {
    parts.push('STRENGTH TRAINING INTEGRATION:');
    parts.push(`Athlete lifts ${checkin.strengthDays.length}x/week.`);
    if (legDaysList.length > 0) {
      parts.push(`LEG DAYS are ONLY: ${legDaysList.join(', ')}. All other lifting days are upper body — treat them normally.`);
      parts.push('- The day AFTER a LEG DAY: only easy/recovery run (legs are fatigued)');
      parts.push('- The day AFTER an UPPER BODY day: any run type is fine (legs are fresh)');
      parts.push('- NEVER call a day "leg day" unless it is explicitly listed above');
    }
    parts.push('- Hard runs (tempo/intervals) on days with NO heavy leg lifting planned');
    if (['peak', 'taper'].includes(phase.phase)) {
      parts.push('- In PEAK/TAPER: reduce gym to 1-2 lighter sessions');
    }
    parts.push('');
  }

  // 4f. Adaptive Rules (from Garmin data)
  parts.push('ADAPTIVE RULES (apply based on current data):');
  if (garminData?.trainingReadiness != null) {
    if (garminData.trainingReadiness < 30) {
      parts.push(`→ Training Readiness is ${garminData.trainingReadiness}/100 — VERY LOW. Extra rest day. Short easy runs only.`);
    } else if (garminData.trainingReadiness < 50) {
      parts.push(`→ Training Readiness is ${garminData.trainingReadiness}/100 — LOW. No hard workouts. All runs easy.`);
    }
  }
  if (garminData?.bodyBatteryMorning != null && garminData.bodyBatteryMorning < 40) {
    parts.push(`→ Body Battery is ${garminData.bodyBatteryMorning}/100 — easy day regardless of plan.`);
  }
  if (garminData?.acwr != null) {
    if (garminData.acwr > 1.3) {
      parts.push(`→ ACWR is ${garminData.acwr} (HIGH) — reduce this week's volume 15-20%. Injury risk elevated.`);
    } else if (garminData.acwr < 0.8) {
      parts.push(`→ ACWR is ${garminData.acwr} (low) — safe to increase volume.`);
    }
  }
  if (ctx.prevCompletion < 0.6 && ctx.prevWeekTotalMiles > 0) {
    parts.push(`→ Previous week completion was ${Math.round(ctx.prevCompletion * 100)}% — do NOT increase volume. Reduce or repeat.`);
  } else if (ctx.prevCompletion < 0.8 && ctx.prevWeekTotalMiles > 0) {
    parts.push(`→ Previous week completion was ${Math.round(ctx.prevCompletion * 100)}% — do NOT increase volume. Repeat same.`);
  }
  if (checkin.soreness === 'severe') {
    parts.push('→ Soreness is SEVERE — recovery week. Reduce all distances 30%.');
  }
  if (checkin.injuryStatus) {
    parts.push(`→ Injury reported: "${checkin.injuryStatus}" — no running on affected area. Suggest cross-training.`);
  }
  parts.push('');

  // 4g. Missed Workout Policy
  if (prevWeek && ctx.prevCompletion < 1.0 && ctx.prevWeekTotalMiles > 0) {
    parts.push('MISSED WORKOUT POLICY:');
    parts.push('- Do NOT try to "make up" missed workouts from last week');
    parts.push('- Continue with normal progression');
    const missedLongRun = prevWeek.runs.every(r => r.type !== 'long_run' && r.type !== 'long');
    if (missedLongRun && prevWeek.runs.length > 0) {
      parts.push('- Long run was missed last week — make it the PRIORITY this week');
    }
    parts.push('- "When in doubt, do less" — getting to race day healthy > any single workout');
    parts.push('');
  }

  // 4h. Marathon Pace Reference
  if (goalPace && profile.target_finish_time_sec) {
    parts.push('MARATHON PACE REFERENCE:');
    parts.push(`Goal: ${raceInfo.targetTime} marathon = ${goalPace}/mi pace`);
    parts.push(`This pace corresponds to ~${z3Low}-${Math.round(maxHR * 0.85)} bpm for this athlete.`);
    if (phase.weeksUntilRace >= 8) {
      parts.push(`Start practicing marathon pace now — include 2-6 mi at this pace in BUILD/PEAK long runs.`);
    }
    parts.push('');
  }

  // 4i. SF Marathon Course Specifics
  if (raceInfo.name?.toLowerCase().includes('sf') || raceInfo.name?.toLowerCase().includes('san francisco')) {
    const hillScore = garminData?.hillScore ?? null;
    parts.push('SF MARATHON COURSE:');
    parts.push('Course profile: hills in miles 3-8, mostly flat/downhill 8-20, rolling 20-26.');
    if (hillScore != null) {
      parts.push(`Athlete Hill Score: ${hillScore} (${hillScore < 50 ? 'LOW — needs improvement' : 'adequate'}).`);
      if (hillScore < 50) {
        parts.push('Include weekly hill repeats (6×60-90s uphill) starting in BASE phase.');
      }
    }
    parts.push('Include hilly routes for long runs when possible.');
    parts.push('');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 5: PHASE & CHECK-IN
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ PHASE & CHECK-IN ═══');
  parts.push('');

  // Mandatory phase
  const PHASE_DESCRIPTIONS: Record<string, string> = {
    base: 'Focus on easy aerobic running. Build weekly mileage gradually at conversational pace (Zone 1-2). ONE short steady tempo per week is allowed (e.g. 3×8min at Zone 3, ~80% HRmax) to begin raising lactate threshold. NO intervals, NO marathon pace work. Long runs easy throughout.',
    build: 'Introduce ONE quality session per week (tempo or threshold). Maintain mostly easy running. Long runs gradually extend, may include light progression at the end.',
    peak: 'Highest volume and intensity. Up to TWO quality sessions (threshold + intervals). Long runs at maximum planned distance, may include race pace segments.',
    taper: 'Reduce volume 30-50%. Maintain some intensity through short efforts. Prioritize rest and freshness for race day.',
    race_week: 'Very light running Mon-Wed only. Complete rest Thu-Sat. Race Sunday. No intensity.',
  };

  parts.push(`MANDATORY PHASE: ${phase.phase.toUpperCase()} (week ${phase.weekNumber})`);
  parts.push(`You MUST generate a ${phase.phase.toUpperCase()} phase week. The "phase" field MUST be "${phase.phase}".`);
  parts.push(`${phase.phase.toUpperCase()} RULES: ${PHASE_DESCRIPTIONS[phase.phase] ?? 'Follow standard training principles.'}`);
  parts.push('');

  // Check-in — clearly separate leg days from upper body days
  parts.push('ATHLETE CHECK-IN FOR THIS WEEK:');
  if (checkin.strengthDays.length > 0) {
    const upperBodyDays = checkin.strengthDays.filter(d => !legDaysList.includes(d));
    parts.push(`- Strength training: ${checkin.strengthDays.length} days/week`);
    if (legDaysList.length > 0) {
      parts.push(`  LEG DAYS (heavy lower body): ${legDaysList.join(', ')} ← no hard run the day AFTER these`);
    }
    if (upperBodyDays.length > 0) {
      parts.push(`  Upper body / other lifting: ${upperBodyDays.join(', ')} ← running is fine the day after these`);
    }
  } else {
    parts.push('- Strength training: None');
  }
  parts.push(`- Available to run: ${checkin.availableDays.join(', ')}`);
  parts.push(`- Long run preference: ${checkin.preferredLongRunDay}`);
  if (checkin.timeConstraints) parts.push(`- Time constraints: ${checkin.timeConstraints}`);
  parts.push(`- Energy: ${checkin.energyLevel}, Soreness: ${checkin.soreness}, Sleep: ${checkin.sleepQuality}`);
  if (checkin.injuryStatus) parts.push(`- Injury/niggle: ${checkin.injuryStatus}`);
  if (checkin.notes) parts.push(`- Notes: "${checkin.notes}"`);
  parts.push('');

  // ═══════════════════════════════════════════════════════════
  // SECTION 6: VOLUME RULES (MANDATORY)
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ VOLUME RULES FOR THIS WEEK (MANDATORY) ═══');
  parts.push('');

  parts.push(`Target weekly volume: ${formatDistance(ctx.adjustedTarget, units)}`);
  if (ctx.prevWeekTotalMiles > 0) {
    const progression = Math.round((ctx.adjustedTarget / ctx.prevWeekTotalMiles - 1) * 100);
    parts.push(`(Based on: last week ${formatDistance(ctx.prevWeekTotalMiles, units)} → this week ${progression >= 0 ? '+' : ''}${progression}%)`);
  } else if (ctx.avgWeeklyMiles > 0) {
    parts.push(`(Based on: 5-week avg ${formatDistance(ctx.avgWeeklyMiles, units)})`);
  }
  if (ctx.isRecoveryWeek) {
    parts.push('*** THIS IS A RECOVERY WEEK (every 4th week) — volume reduced 20%, all runs EASY, no quality sessions ***');
  }
  parts.push('');

  const restDays = 7 - ctx.numRuns;
  parts.push(`Number of RUNS this week: EXACTLY ${ctx.numRuns}. Number of REST days: ${restDays}.`);
  parts.push(`Generate exactly ${ctx.numRuns} run workouts + ${restDays} rest day entries = 7 total.`);
  if (ctx.numRuns < checkin.availableDays.length) {
    parts.push(`(Reduced from ${checkin.availableDays.length} available days because ${formatDistance(ctx.adjustedTarget, units)} ÷ ${checkin.availableDays.length} runs would make each run too short)`);
  }
  parts.push('');

  parts.push('Volume distribution:');
  parts.push(`- Long run: ${formatDistance(ctx.longRunTarget, units)} (target ${Math.round(ctx.longRunTarget / ctx.adjustedTarget * 100)}% of weekly)`);
  if (ctx.prevLongestRun > 0) {
    parts.push(`  Previous longest: ${formatDistance(ctx.prevLongestRun, units)} → this week: +0.5 to +1.0 ${dLabel}`);
  }
  if (ctx.numRuns > 1) {
    const remainingMiles = ctx.adjustedTarget - ctx.longRunTarget;
    const perRun = Math.round(remainingMiles / (ctx.numRuns - 1) * 10) / 10;
    parts.push(`- Remaining ${ctx.numRuns - 1} runs: ~${formatDistance(perRun, units)} each (split evenly)`);
  }
  parts.push('');

  parts.push('MINIMUM distances:');
  parts.push(`- Long run: ${formatDistance(ctx.longRunMin, units)} (MUST be the longest run of the week)`);
  parts.push(`- Easy/recovery: ${formatDistance(2.5, units)} minimum`);
  parts.push(`- Threshold/tempo: ${formatDistance(3.0, units)} minimum`);
  parts.push(`- No workout under ${formatDistance(2.5, units)}`);
  parts.push('');

  parts.push('MAXIMUM distances:');
  parts.push(`- Long run: ${formatDistance(ctx.longRunMax, units)} (no more than +2 ${dLabel} from last week's longest)`);
  parts.push(`- Total volume: ${formatDistance(Math.round(ctx.adjustedTarget * 1.10 * 10) / 10, units)} (max 10% over target)`);
  parts.push('');

  parts.push('The long run MUST be longer than every other run this week. If they are equal, you FAILED.');
  parts.push('');

  // ═══════════════════════════════════════════════════════════
  // SECTION 7: CRITICAL CONTEXT & COACHING DECISIONS
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ CRITICAL CONTEXT FOR THIS ATHLETE ═══');
  parts.push('');

  parts.push(`1. Currently averaging ${formatDistance(ctx.avgWeeklyMiles, units)}/week with ${ctx.avgRunsPerWeek} runs — this is the BASELINE`);

  const peakTarget = phase.targetWeeklyMiles; // from calculatePhase with peakWeeklyMiles
  if (ctx.avgWeeklyMiles > 0 && peakTarget > ctx.avgWeeklyMiles) {
    parts.push(`2. Must build to ~${formatDistance(peakTarget, units)}/week by peak phase — ${(peakTarget / ctx.avgWeeklyMiles).toFixed(1)}x increase over ${phase.weeksUntilRace} weeks`);
  }
  parts.push(`3. Increase volume no more than 10% per week, with a recovery week every 4th week`);
  parts.push(`4. Currently running ${ctx.avgRunsPerWeek}x/week — add runs gradually (max +1 run per 2 weeks)`);
  if (checkin.strengthDays.length > 0) {
    if (legDaysList.length > 0) {
      parts.push(`5. Lifts ${checkin.strengthDays.length}x/week — LEG DAY is ONLY ${legDaysList.join(', ')}. Schedule easy run the day after leg day. Other lifting days (upper body) don't affect run scheduling.`);
    } else {
      parts.push(`5. Lifts ${checkin.strengthDays.length}x/week — no specific leg day reported, so running schedule is flexible.`);
    }
  }

  // Garmin-driven coaching decisions
  if (garminData) {
    if (garminData.hillScore != null && garminData.hillScore < 50 && ['build', 'peak'].includes(phase.phase)) {
      parts.push(`6. Hill Score is LOW (${garminData.hillScore}) and race course is hilly — include hill repeats or hilly long run in BUILD/PEAK`);
    }
    if (garminData.trainingReadiness != null && garminData.trainingReadiness < 50) {
      parts.push(`⚠️ Training Readiness is LOW (${garminData.trainingReadiness}/100) — this should be a RECOVERY-focused week, reduce intensity`);
    }
    if (garminData.bodyBatteryMorning != null && garminData.bodyBatteryMorning < 30) {
      parts.push(`⚠️ Body Battery is LOW (${garminData.bodyBatteryMorning}/100) — recovery focus, no quality sessions today`);
    }
    if (garminData.acwr != null && garminData.acwr > 1.3) {
      parts.push(`⚠️ ACWR is HIGH (${garminData.acwr}) — injury risk elevated, reduce volume this week`);
    }
  }

  if (checkin.soreness === 'moderate' || checkin.soreness === 'severe') {
    parts.push(`⚠️ Soreness: ${checkin.soreness} — reduce volume 20-30%, skip quality sessions`);
  }
  if (checkin.energyLevel === 'low' || checkin.energyLevel === 'exhausted') {
    parts.push(`⚠️ Energy: ${checkin.energyLevel} — reduce intensity, keep all runs easy`);
  }
  if (checkin.injuryStatus) {
    parts.push(`⚠️ Injury: ${checkin.injuryStatus} — reduce intensity, avoid aggravating movements`);
  }
  parts.push('');

  // ═══════════════════════════════════════════════════════════
  // SECTION 8: SCHEDULING RULES
  // ═══════════════════════════════════════════════════════════
  parts.push('═══ SCHEDULING RULES ═══');
  parts.push('');
  parts.push('1. ONLY schedule runs on available days from the check-in');
  parts.push('2. NEVER schedule a quality run the day after leg day — use easy/recovery instead');
  parts.push('3. Long run on the preferred day');
  parts.push('4. At least 1 rest day between quality sessions');
  parts.push('5. All non-run days are "rest" type with distanceMiles: 0');
  parts.push('');

  // Example distribution — must match numRuns exactly
  parts.push(`EXAMPLE for ${formatDistance(ctx.adjustedTarget, units)} over EXACTLY ${ctx.numRuns} runs (rest days fill remaining days):`);
  if (ctx.numRuns >= 5) {
    const lr = Math.round(ctx.adjustedTarget * 0.30 * 10) / 10;
    const easy1 = Math.round(ctx.adjustedTarget * 0.20 * 10) / 10;
    const easy2 = Math.round(ctx.adjustedTarget * 0.18 * 10) / 10;
    const easy3 = Math.round(ctx.adjustedTarget * 0.17 * 10) / 10;
    const rec = Math.round(ctx.adjustedTarget * 0.15 * 10) / 10;
    parts.push(`  Long: ${formatDistance(lr, units)}, Easy: ${formatDistance(easy1, units)}, Easy: ${formatDistance(easy2, units)}, Easy: ${formatDistance(easy3, units)}, Recovery: ${formatDistance(rec, units)}`);
  } else if (ctx.numRuns >= 4) {
    const lr = Math.round(ctx.adjustedTarget * 0.33 * 10) / 10;
    const easy = Math.round(ctx.adjustedTarget * 0.23 * 10) / 10;
    const rec = Math.round(ctx.adjustedTarget * 0.18 * 10) / 10;
    parts.push(`  Long: ${formatDistance(lr, units)}, Easy: ${formatDistance(easy, units)}, Easy: ${formatDistance(easy, units)}, Recovery: ${formatDistance(rec, units)}`);
  } else if (ctx.numRuns >= 3) {
    const lr = Math.round(ctx.adjustedTarget * 0.37 * 10) / 10;
    const easy = Math.round(ctx.adjustedTarget * 0.33 * 10) / 10;
    const easy2 = Math.round(ctx.adjustedTarget * 0.30 * 10) / 10;
    parts.push(`  Long: ${formatDistance(lr, units)}, Easy: ${formatDistance(easy, units)}, Easy: ${formatDistance(easy2, units)}`);
  } else if (ctx.numRuns >= 2) {
    const lr = Math.round(ctx.adjustedTarget * 0.55 * 10) / 10;
    const easy = Math.round(ctx.adjustedTarget * 0.45 * 10) / 10;
    parts.push(`  Long: ${formatDistance(lr, units)}, Easy: ${formatDistance(easy, units)}`);
  }
  parts.push('');

  // Week dates
  parts.push(`GENERATE WORKOUTS FOR: ${weekDates.monday} (Monday) through ${weekDates.sunday} (Sunday)`);
  parts.push(`Use miles for distances in the JSON (distanceMiles field).`);

  return parts.join('\n');
}

// ─── Response JSON Schema ───────────────────────────────────

const RESPONSE_FORMAT = `RESPOND WITH ONLY THIS JSON (no markdown fences, no explanation):
{
  "weekNumber": <number>,
  "phase": "<base|build|peak|taper|race_week>",
  "totalPlannedMiles": <number>,
  "rationale": "<2-3 sentences explaining why this week looks the way it does>",
  "workouts": [
    {
      "day": "<monday|tuesday|...|sunday>",
      "date": "<YYYY-MM-DD>",
      "type": "<easy|long_run|threshold|interval|tempo|marathon_pace|recovery|race|rest>",
      "distanceMiles": <number>,
      "description": "<1-2 sentences with BPM target, e.g. 'Easy run at Zone 2 (114-133 bpm)'>",
      "targetPaceZone": "<pace range string>",
      "hrZone": "<Zone 1-2, Zone 2, Zone 3-4, etc.>",
      "notes": "<optional coaching note or null>"
    }
  ]
}`;

// ─── Validation ─────────────────────────────────────────────

function validateWeek(
  week: any,
  checkin: WeeklyCheckin,
  mondayDate: string,
  sundayDate: string,
  targetVolume: number,
  isRecoveryWeek: boolean,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!week.workouts || !Array.isArray(week.workouts)) {
    errors.push('Missing workouts array');
    return { errors, warnings };
  }

  const runs = week.workouts.filter((w: any) => w.type !== 'rest');
  const totalMiles = runs.reduce((s: number, w: any) => s + (w.distanceMiles ?? 0), 0);

  for (const w of week.workouts) {
    if (!w.day || !w.date || !w.type) {
      errors.push(`Workout missing required fields: ${JSON.stringify(w).substring(0, 100)}`);
      continue;
    }

    // Check date is within the target week
    if (w.date < mondayDate || w.date > sundayDate) {
      errors.push(`Workout date ${w.date} is outside the target week ${mondayDate}–${sundayDate}`);
    }

    // Check runs are only on available days (skip rest days)
    if (w.type !== 'rest') {
      if (!checkin.availableDays.includes(w.day as WeekDay)) {
        warnings.push(`Run scheduled on ${w.day} but athlete is only available: ${checkin.availableDays.join(', ')}`);
      }
    }

    // Check no quality session day after ANY leg day
    const allLegDays = checkin.legDays?.length > 0 ? checkin.legDays : (checkin.legDay ? [checkin.legDay] : []);
    if (allLegDays.length > 0 && ['threshold', 'interval', 'tempo', 'marathon_pace'].includes(w.type)) {
      const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayIndex = dayOrder.indexOf(w.day);
      for (const ld of allLegDays) {
        const legDayIndex = dayOrder.indexOf(ld);
        if (dayIndex === legDayIndex + 1 || (legDayIndex === 6 && dayIndex === 0)) {
          warnings.push(`Quality session on ${w.day} is the day after leg day (${ld})`);
        }
      }
    }
  }

  // Phase-specific rules
  const qualityTypes = ['threshold', 'interval', 'tempo', 'marathon_pace'];
  const hardTypes = ['interval', 'marathon_pace']; // these are never allowed in base
  const qualityCount = runs.filter((w: any) => qualityTypes.includes(w.type)).length;
  const tempoCount = runs.filter((w: any) => w.type === 'tempo' || w.type === 'threshold').length;
  const hardCount = runs.filter((w: any) => hardTypes.includes(w.type)).length;

  if (isRecoveryWeek && qualityCount > 0) {
    errors.push(`RECOVERY WEEK must have NO quality sessions, but AI scheduled ${qualityCount}`);
  } else if (week.phase === 'base') {
    // Base allows exactly 1 tempo/threshold, but NO intervals or marathon pace
    if (hardCount > 0) {
      errors.push(`BASE phase: intervals and marathon pace are NOT allowed, but AI scheduled ${hardCount}`);
    }
    if (tempoCount > 1) {
      errors.push(`BASE phase: max 1 tempo per week, but AI scheduled ${tempoCount}`);
    }
  }

  // 80/20 rule: max 2 quality sessions in any phase
  if (qualityCount > 2) {
    errors.push(`80/20 rule violated: max 2 hard sessions per week, but AI scheduled ${qualityCount}`);
  }

  // 80/20 volume check: quality miles should be ≤ 25% of total (with margin)
  if (totalMiles > 0) {
    const qualityMiles = runs
      .filter((w: any) => qualityTypes.includes(w.type))
      .reduce((s: number, w: any) => s + (w.distanceMiles ?? 0), 0);
    if (qualityMiles / totalMiles > 0.30) {
      warnings.push(`80/20 warning: quality miles (${qualityMiles.toFixed(1)}mi) are ${Math.round(qualityMiles / totalMiles * 100)}% of total — should be ≤20%`);
    }
  }

  // Volume checks — CRITICAL errors that trigger retry
  if (totalMiles > 60) errors.push(`Total volume ${totalMiles.toFixed(1)}mi is unreasonably high`);
  if (totalMiles < 5 && week.phase !== 'taper' && week.phase !== 'race_week') {
    errors.push(`Total volume ${totalMiles.toFixed(1)}mi is too low for ${week.phase} phase`);
  }

  // Check volume is within range of target
  if (targetVolume > 0 && week.phase !== 'race_week') {
    const ratio = totalMiles / targetVolume;
    if (ratio < 0.5) {
      errors.push(`Total volume ${totalMiles.toFixed(1)}mi is less than half the target ${targetVolume.toFixed(1)}mi`);
    } else if (ratio > 1.5) {
      errors.push(`Total volume ${totalMiles.toFixed(1)}mi exceeds target ${targetVolume.toFixed(1)}mi by >50%`);
    }
  }

  // Long run must be longest — CRITICAL check
  const longRun = runs.find((w: any) => w.type === 'long_run' || w.type === 'long');
  const otherRuns = runs.filter((w: any) => w.type !== 'long_run' && w.type !== 'long');
  if (longRun && otherRuns.length > 0) {
    const maxOther = Math.max(...otherRuns.map((w: any) => w.distanceMiles ?? 0));
    if (longRun.distanceMiles <= maxOther) {
      errors.push(`Long run (${longRun.distanceMiles}mi) must be longer than other runs (max other: ${maxOther}mi)`);
    }
  }

  // No run under 2.5mi (must be meaningful training)
  for (const w of runs) {
    if ((w.distanceMiles ?? 0) > 0 && (w.distanceMiles ?? 0) < 2.5) {
      errors.push(`${w.type} on ${w.date} is ${w.distanceMiles}mi — minimum is 2.5mi`);
    }
  }

  return { errors, warnings };
}

/**
 * Post-generation safety clamping — fixes minor issues without re-calling AI.
 * Only adjusts distances, never adds/removes/reorders workouts.
 */
function clampWorkoutDistances(workouts: any[], targetVolume: number): any[] {
  const runs = workouts.filter((w: any) => w.type !== 'rest');
  if (runs.length === 0) return workouts;

  // Ensure no run is under 2.5mi (meaningful training distance)
  for (const w of runs) {
    if ((w.distanceMiles ?? 0) > 0 && (w.distanceMiles ?? 0) < 2.5) {
      w.distanceMiles = 2.5;
    }
  }

  // Ensure long run is the longest
  const longRun = runs.find((w: any) => w.type === 'long_run' || w.type === 'long');
  if (longRun) {
    const maxOther = Math.max(...runs.filter((w: any) => w !== longRun).map((w: any) => w.distanceMiles ?? 0));
    if (longRun.distanceMiles <= maxOther) {
      longRun.distanceMiles = Math.round((maxOther + 1.5) * 10) / 10;
    }
    // Long run minimum: 28% of target or 4mi, whichever is greater
    const longRunMin = Math.max(4, targetVolume * 0.28);
    if (longRun.distanceMiles < longRunMin) {
      longRun.distanceMiles = Math.round(longRunMin * 10) / 10;
    }
  }

  return workouts;
}

// ─── Main Function ──────────────────────────────────────────

export async function generateWeekPlan(
  checkin: WeeklyCheckin,
  prevWeek: PreviousWeekSummary | null,
  profile: UserProfile,
  paceZones: PaceZones,
  phase: TrainingPhaseInfo,
  recoveryStatus: RecoveryStatus | null,
  garminData: any | null,
  weekDates: { monday: string; sunday: string },
): Promise<GeneratedWeek> {
  if (!isGeminiAvailable()) {
    throw new Error('Gemini API not available — check your API key');
  }

  // Build fresh context from real data
  const ctx = buildWeekContext(checkin, prevWeek, phase);

  const raceInfo = {
    name: profile.race_name ?? 'Marathon',
    date: profile.race_date,
    distance: 'Marathon (26.2 mi)',
    targetTime: profile.target_finish_time_sec
      ? `${Math.floor(profile.target_finish_time_sec / 3600)}:${String(Math.floor((profile.target_finish_time_sec % 3600) / 60)).padStart(2, '0')}:${String(profile.target_finish_time_sec % 60).padStart(2, '0')}`
      : null,
  };

  const prompt = buildWeekPrompt(
    checkin, prevWeek, profile, paceZones, phase,
    raceInfo, recoveryStatus, garminData, weekDates, ctx,
  );

  const systemInstruction = `You are an expert marathon running coach following Jack Daniels' methodology. Generate exactly ONE week of training. The athlete's REAL data is provided — use it to make informed decisions. Follow volume rules strictly. Return ONLY valid JSON.`;

  const userMessage = `${prompt}\n\n${RESPONSE_FORMAT}`;

  console.log(`[WeekGen] Context: avg ${ctx.avgWeeklyMiles}mi/wk, prev ${ctx.prevWeekTotalMiles}mi, target ${ctx.adjustedTarget}mi, LR target ${ctx.longRunTarget}mi${ctx.isRecoveryWeek ? ' (RECOVERY)' : ''}`);

  const MAX_RETRIES = 2;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let currentPrompt = userMessage;

    // On retry, feed validation errors back to AI
    if (attempt > 0 && lastErrors.length > 0) {
      currentPrompt = `${userMessage}\n\nIMPORTANT — YOUR PREVIOUS RESPONSE HAD THESE ERRORS (fix them):\n${lastErrors.map(e => `- ${e}`).join('\n')}\n\nGenerate a corrected plan that fixes ALL the above issues.`;
      console.log(`[WeekGen] Retry ${attempt}/${MAX_RETRIES} with ${lastErrors.length} error(s) fed back`);
    }

    console.log(`[WeekGen] Generating week ${phase.weekNumber} (${phase.phase}), attempt ${attempt + 1}, prompt: ${currentPrompt.length} chars`);

    // Call heavy model — this is plan generation
    const responseText = await sendStructuredMessage(systemInstruction, currentPrompt, 'heavy');
    console.log(`[WeekGen] Gemini responded: ${responseText.length} chars`);

    // Parse JSON
    let parsed: any;
    try {
      parsed = extractJSON(responseText);
      if (!parsed) throw new Error('No JSON found in response');
    } catch (e: any) {
      console.error('[WeekGen] JSON parse failed:', e.message);
      console.error('[WeekGen] Raw response:', responseText.substring(0, 500));
      if (attempt < MAX_RETRIES) {
        lastErrors = ['Response was not valid JSON — return ONLY a JSON object, no markdown'];
        continue;
      }
      throw new Error('AI returned invalid JSON — please try again');
    }

    // Validate
    const { errors, warnings } = validateWeek(
      parsed, checkin, weekDates.monday, weekDates.sunday,
      ctx.adjustedTarget, ctx.isRecoveryWeek,
    );
    if (warnings.length > 0) {
      console.warn('[WeekGen] Validation warnings:', warnings);
    }

    if (errors.length > 0) {
      console.warn('[WeekGen] Validation errors:', errors);
      if (attempt < MAX_RETRIES) {
        lastErrors = errors;
        continue; // Retry with errors fed back
      }
      // Final attempt — apply safety clamping and proceed
      console.warn('[WeekGen] Max retries reached — applying safety clamping');
    }

    if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
      if (attempt < MAX_RETRIES) {
        lastErrors = ['Response must contain a "workouts" array'];
        continue;
      }
      throw new Error('AI response missing workouts array');
    }

    // Apply post-generation safety clamping
    const clampedWorkouts = clampWorkoutDistances(parsed.workouts, ctx.adjustedTarget);

    // Map to GeneratedWeek type — FORCE the phase from calculatePhase, never trust Gemini's
    const week: GeneratedWeek = {
      weekNumber: parsed.weekNumber ?? phase.weekNumber,
      phase: phase.phase, // ALWAYS use calculated phase, not AI's
      totalPlannedMiles: clampedWorkouts
        .filter((w: any) => w.type !== 'rest')
        .reduce((s: number, w: any) => s + (w.distanceMiles ?? 0), 0),
      rationale: parsed.rationale ?? '',
      workouts: clampedWorkouts.map((w: any) => ({
        day: w.day,
        date: w.date,
        type: w.type,
        distanceMiles: w.distanceMiles ?? 0,
        description: w.description ?? '',
        targetPaceZone: w.targetPaceZone ?? '',
        hrZone: w.hrZone ?? '',
        notes: w.notes ?? null,
      })),
    };

    console.log(`[WeekGen] Generated: ${week.workouts.length} workouts, ${week.totalPlannedMiles.toFixed(1)}mi total (target: ${ctx.adjustedTarget}mi), phase=${week.phase}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);

    return week;
  }

  throw new Error('Failed to generate valid week plan after retries');
}
