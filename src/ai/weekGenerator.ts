/**
 * WEEKLY PLAN GENERATOR — the ONLY way to create workouts in Gati.
 *
 * Generates exactly ONE week (Mon-Sun) based on:
 * - Weekly check-in answers (availability, energy, soreness)
 * - Previous week's actual performance data
 * - Current training phase (from race date)
 * - Garmin health/fitness data
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
): string {
  const units = getUnits();
  const dLabel = units === 'metric' ? 'km' : 'mi';
  const pLabel = paceLabel(units);
  const { formatPaceRange } = require('../engine/paceZones');

  const parts: string[] = [];

  // Race context
  parts.push(`RACE: ${raceInfo.name}, ${raceInfo.date}, ${raceInfo.distance}`);
  if (raceInfo.targetTime) parts.push(`Target: ${raceInfo.targetTime}`);
  parts.push(`Week ${phase.weekNumber}, ${phase.weeksUntilRace} weeks to race`);
  parts.push(`Target volume this week: ${formatDistance(phase.targetWeeklyMiles, units)}`);
  parts.push('');

  // MANDATORY phase — Gemini cannot override this
  const PHASE_DESCRIPTIONS: Record<string, string> = {
    base: 'Focus on easy aerobic running only. Build weekly mileage gradually while keeping all runs at a conversational pace (Zone 1-2). Avoid threshold, tempo, or interval work. Long runs should remain easy throughout, with the primary goal of developing a strong aerobic foundation and improving endurance.',
    build: 'Introduce one quality session per week, such as a tempo or threshold run, while continuing to increase overall volume. Maintain mostly easy running outside of this session. Long runs should gradually extend in distance and may include light progression toward a moderate effort near the end.',
    peak: 'Reach the highest training volume and intensity of the plan. Include up to two quality sessions per week, such as threshold runs and intervals. Long runs should be at their maximum planned distance and may incorporate segments at race pace. This phase is focused on sharpening fitness and preparing for race demands.',
    taper: 'Reduce overall training volume by 30-50% while maintaining some intensity through short, controlled efforts. Keep runs shorter and prioritize rest and recovery. The goal is to arrive at race day feeling fresh, energized, and fully prepared.',
    race_week: 'Keep running very light early in the week, typically Monday to Wednesday, with short and easy sessions. Take complete rest days later in the week to ensure full recovery. Avoid any intense workouts, and focus entirely on being ready for race day.',
  };

  parts.push(`MANDATORY PHASE: ${phase.phase.toUpperCase()}`);
  parts.push(`You MUST generate a ${phase.phase.toUpperCase()} phase week. Do NOT use a different phase.`);
  parts.push(`The "phase" field in your JSON response MUST be "${phase.phase}".`);
  parts.push('');
  parts.push(`${phase.phase.toUpperCase()} PHASE RULES:`);
  parts.push(PHASE_DESCRIPTIONS[phase.phase] ?? 'Follow standard training principles.');
  parts.push('');

  // Athlete profile
  parts.push(`ATHLETE: Age ${profile.age}, VDOT ${profile.vdot_score}`);
  if (profile.weight_kg) parts.push(`Weight: ${formatWeightKg(profile.weight_kg, units)}`);
  parts.push(`Experience: ${profile.experience_level}`);
  parts.push('');

  // Pace zones
  parts.push(`PACE ZONES (${pLabel}):`);
  parts.push(`  E: ${formatPaceRange(paceZones.E)} | M: ${formatPaceRange(paceZones.M)} | T: ${formatPaceRange(paceZones.T)} | I: ${formatPaceRange(paceZones.I)} | R: ${formatPaceRange(paceZones.R)}`);
  parts.push('');

  // Check-in data
  parts.push('ATHLETE CHECK-IN FOR THIS WEEK:');
  const legDaysList = checkin.legDays?.length > 0 ? checkin.legDays : (checkin.legDay ? [checkin.legDay] : []);
  parts.push(`- Lifting: ${checkin.strengthDays.length > 0 ? checkin.strengthDays.join(', ') : 'None'}${legDaysList.length > 0 ? ` (Leg days: ${legDaysList.join(', ')})` : ''}`);
  parts.push(`- Available to run: ${checkin.availableDays.join(', ')}`);
  parts.push(`- Long run preference: ${checkin.preferredLongRunDay}`);
  if (checkin.timeConstraints) parts.push(`- Time constraints: ${checkin.timeConstraints}`);
  parts.push(`- Energy: ${checkin.energyLevel}`);
  parts.push(`- Soreness: ${checkin.soreness}`);
  if (checkin.injuryStatus) parts.push(`- Injury/niggle: ${checkin.injuryStatus}`);
  parts.push(`- Sleep quality: ${checkin.sleepQuality}`);
  if (checkin.notes) parts.push(`- Notes: "${checkin.notes}"`);
  parts.push('');

  // Previous week
  if (prevWeek) {
    parts.push('PREVIOUS WEEK ACTUAL DATA:');
    parts.push(`Week ${prevWeek.weekNumber}: ${prevWeek.completedRuns}/${prevWeek.totalRuns} runs, ${formatDistance(prevWeek.actualMiles, units)} of ${formatDistance(prevWeek.plannedMiles, units)} (${prevWeek.plannedMiles > 0 ? Math.round((prevWeek.actualMiles / prevWeek.plannedMiles) * 100) : 0}%)`);
    for (const run of prevWeek.runs) {
      const pace = run.paceSecPerMile ? formatPaceWithUnit(run.paceSecPerMile, units) : '?';
      parts.push(`  ${run.date}: ${run.type} ${formatDistance(run.distanceMiles, units)} @ ${pace}${run.avgHR ? ` HR:${run.avgHR}` : ''} — ${run.status}`);
    }
    if (prevWeek.recoveryScoreAvg) parts.push(`Recovery avg: ${prevWeek.recoveryScoreAvg}/100`);
    if (prevWeek.garminVO2max) parts.push(`VO2max ${prevWeek.garminVO2max}, Training Status ${prevWeek.garminTrainingStatus ?? '?'}, ACWR ${prevWeek.garminACWR ?? '?'}`);
    parts.push('');
  } else {
    parts.push('PREVIOUS WEEK: No data (first week of training)');
    parts.push('');
  }

  // Recovery
  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    parts.push(`CURRENT RECOVERY: ${recoveryStatus.score}/100 (${recoveryStatus.level})`);
    for (const s of recoveryStatus.signals) {
      if (s.score > 0) parts.push(`  ${s.type}: ${s.detail}`);
    }
    parts.push('');
  }

  // Garmin fitness & readiness metrics
  if (garminData) {
    const gLines: string[] = [];
    if (garminData.trainingReadiness != null) {
      gLines.push(`Training Readiness: ${garminData.trainingReadiness}/100${garminData.readinessFeedbackShort ? ` (${garminData.readinessFeedbackShort.replace(/_/g, ' ').toLowerCase()})` : ''}`);
    }
    if (garminData.recoveryTimeHours != null) gLines.push(`Recovery time: ${garminData.recoveryTimeHours}h remaining`);
    if (garminData.bodyBatteryMorning != null) gLines.push(`Body Battery: ${garminData.bodyBatteryMorning}/100 morning`);
    if (garminData.trainingStatus) gLines.push(`Training Status: ${garminData.trainingStatus}${garminData.trainingLoad7day != null ? `, 7d load: ${garminData.trainingLoad7day}` : ''}${garminData.acwr != null ? `, ACWR: ${garminData.acwr}` : ''}`);
    if (garminData.enduranceScore != null) gLines.push(`Endurance Score: ${garminData.enduranceScore}`);
    if (garminData.hillScore != null) gLines.push(`Hill Score: ${garminData.hillScore} (endurance: ${garminData.hillEndurance ?? '?'}, strength: ${garminData.hillStrength ?? '?'}) — SF Marathon has hills, add hill work if score is low`);
    if (garminData.lactateThresholdHr != null) {
      const ltPace = garminData.lactateThresholdSpeed && garminData.lactateThresholdSpeed > 0 ? Math.round(1609.344 / garminData.lactateThresholdSpeed) : null;
      gLines.push(`Lactate Threshold: ${garminData.lactateThresholdHr} bpm${ltPace ? ` @ ${Math.floor(ltPace / 60)}:${String(ltPace % 60).padStart(2, '0')}/mi — use for threshold pace instead of VDOT estimate` : ''}`);
    }
    if (garminData.predictedMarathonSec != null) {
      const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      gLines.push(`Race prediction: Marathon ${fmt(garminData.predictedMarathonSec)} (athlete goal: 3:45:00)`);
    }
    if (garminData.vo2max != null) gLines.push(`VO2max: ${garminData.vo2max}${garminData.vo2maxFitnessAge != null ? ` (fitness age: ${garminData.vo2maxFitnessAge})` : ''}`);
    if (gLines.length > 0) {
      parts.push('FITNESS METRICS (Garmin):');
      gLines.forEach(l => parts.push(`  ${l}`));
      parts.push('');
    }
  }

  // Week dates
  parts.push(`GENERATE WORKOUTS FOR: ${weekDates.monday} (Monday) through ${weekDates.sunday} (Sunday)`);
  parts.push(`Use ${dLabel} for distances.`);
  parts.push('');

  // Rules
  parts.push('YOU determine the training focus for this week based on the phase, recovery data, previous week performance, and check-in answers. Do NOT ask the athlete what to focus on.');
  parts.push('');
  parts.push('KEY RULES:');
  parts.push('1. ONLY schedule runs on available days from the check-in');
  parts.push('2. NEVER schedule a quality run (threshold/intervals/tempo) the day after leg day');
  parts.push('3. Schedule easy/recovery the day after leg day');
  parts.push('4. Long run on the preferred day');
  parts.push('5. If athlete notes a race: make it the quality session, taper before it');
  parts.push('6. If soreness > mild OR energy low/exhausted: reduce volume 20-30%, skip quality');
  parts.push('7. If injury noted: avoid aggravating it, reduce intensity');
  parts.push('8. Progressive overload: increase volume 5-10% from previous week actual (not planned)');
  parts.push('9. Max long run: 35% of weekly volume');
  parts.push('10. At least 1 rest day between quality sessions');

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
      "description": "<1-2 sentences>",
      "targetPaceZone": "<pace range string>",
      "hrZone": "<Zone 1-2, Zone 2, Zone 3-4, etc.>",
      "notes": "<optional coaching note or null>"
    }
  ]
}`;

// ─── Validation ─────────────────────────────────────────────

function validateWeek(week: any, checkin: WeeklyCheckin, mondayDate: string, sundayDate: string): string[] {
  const errors: string[] = [];

  if (!week.workouts || !Array.isArray(week.workouts)) {
    errors.push('Missing workouts array');
    return errors;
  }

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
        errors.push(`Run scheduled on ${w.day} but athlete is only available: ${checkin.availableDays.join(', ')}`);
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
          errors.push(`Quality session on ${w.day} is the day after leg day (${ld})`);
        }
      }
    }
  }

  // Check phase-specific rules
  const qualityTypes = ['threshold', 'interval', 'tempo', 'marathon_pace'];
  const qualityCount = week.workouts.filter((w: any) => qualityTypes.includes(w.type)).length;
  if (checkin && week.phase === 'base' && qualityCount > 0) {
    errors.push(`BASE phase should have NO quality sessions, but AI scheduled ${qualityCount}`);
  }

  // Check total distance is reasonable
  const totalMiles = week.workouts.reduce((s: number, w: any) => s + (w.distanceMiles ?? 0), 0);
  if (totalMiles > 60) errors.push(`Total volume ${totalMiles}mi is unreasonably high`);
  if (totalMiles < 3 && week.phase !== 'taper' && week.phase !== 'race_week') {
    errors.push(`Total volume ${totalMiles}mi is too low for ${week.phase} phase`);
  }

  return errors;
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
    raceInfo, recoveryStatus, garminData, weekDates,
  );

  const systemInstruction = `You are an expert marathon running coach. Generate exactly ONE week of training based on the athlete's check-in and data. Follow the rules strictly. Return ONLY valid JSON.`;

  const userMessage = `${prompt}\n\n${RESPONSE_FORMAT}`;

  console.log(`[WeekGen] Generating week ${phase.weekNumber} (${phase.phase}), prompt: ${userMessage.length} chars`);

  // Call heavy model — this is plan generation
  const responseText = await sendStructuredMessage(systemInstruction, userMessage, 'heavy');
  console.log(`[WeekGen] Gemini responded: ${responseText.length} chars`);

  // Parse JSON
  let parsed: any;
  try {
    parsed = extractJSON(responseText);
    if (!parsed) throw new Error('No JSON found in response');
  } catch (e: any) {
    console.error('[WeekGen] JSON parse failed:', e.message);
    console.error('[WeekGen] Raw response:', responseText.substring(0, 500));
    throw new Error('AI returned invalid JSON — please try again');
  }

  // Validate
  const errors = validateWeek(parsed, checkin, weekDates.monday, weekDates.sunday);
  if (errors.length > 0) {
    console.warn('[WeekGen] Validation warnings:', errors);
    // Don't throw — warnings are informational, AI is generally close enough
    // Only throw on critical errors (no workouts array)
    if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
      throw new Error('AI response missing workouts array');
    }
  }

  // Map to GeneratedWeek type — FORCE the phase from calculatePhase, never trust Gemini's
  const week: GeneratedWeek = {
    weekNumber: parsed.weekNumber ?? phase.weekNumber,
    phase: phase.phase, // ALWAYS use calculated phase, not AI's
    totalPlannedMiles: parsed.totalPlannedMiles ?? parsed.workouts.reduce((s: number, w: any) => s + (w.distanceMiles ?? 0), 0),
    rationale: parsed.rationale ?? '',
    workouts: (parsed.workouts as any[]).map((w: any) => ({
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

  console.log(`[WeekGen] Generated: ${week.workouts.length} workouts, ${week.totalPlannedMiles}mi total, phase=${week.phase}`);

  return week;
}
