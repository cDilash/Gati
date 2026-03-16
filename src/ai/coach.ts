/**
 * AI Coach Chat — conversational coaching powered by Gemini.
 *
 * Every message includes fresh training context. The coach can suggest
 * plan modifications returned as structured JSON alongside the text response.
 */

import { sendChatMessage, extractJSON, isGeminiAvailable } from './gemini';
import {
  UserProfile,
  PaceZones,
  Workout,
  TrainingWeek,
  PerformanceMetric,
  CoachMessage,
  Shoe,
  RecoveryStatus,
  HealthSnapshot,
} from '../types';
import { formatPace, formatTime, predictMarathonTime } from '../engine/vdot';
import { formatPaceRange } from '../engine/paceZones';

// ─── Types ──────────────────────────────────────────────────

export interface CoachResponse {
  message: string;
  planChange: PlanChangeRequest | null;
}

export interface PlanChangeRequest {
  type: 'adapt_plan' | 'modify_workout' | 'skip_workout';
  description: string;
  reason: string;
  workoutId?: string;
  changes?: Record<string, any>;
}

// ─── System Prompt Builder ──────────────────────────────────

export function buildCoachSystemPrompt(
  profile: UserProfile,
  paceZones: PaceZones,
  currentWeek: TrainingWeek | null,
  weekWorkouts: Workout[],
  todaysWorkout: Workout | null,
  recentMetrics: PerformanceMetric[],
  weeks: TrainingWeek[],
  allWorkouts: Workout[],
  shoes: Shoe[],
  daysUntilRace: number,
  isRaceWeek: boolean,
  recoveryStatus?: RecoveryStatus | null,
  healthSnapshot?: HealthSnapshot | null,
): string {
  const parts: string[] = [];

  parts.push(`You are an expert marathon running coach guiding this athlete through their training.
You follow Jack Daniels' methodology and the 80/20 polarized training approach.
Be concise, direct, encouraging, and specific. Reference actual data, not generic advice.
Keep responses to 2-4 paragraphs max unless the athlete asks for detailed analysis.`);
  parts.push('');

  // Profile
  parts.push('ATHLETE PROFILE:');
  parts.push(`- Age: ${profile.age}, Gender: ${profile.gender}, VDOT: ${profile.vdot_score}`);
  if (profile.height_cm && profile.weight_kg) {
    const heightM = profile.height_cm / 100;
    const bmi = Math.round((profile.weight_kg / (heightM * heightM)) * 10) / 10;
    parts.push(`- Height: ${profile.height_cm}cm, Weight: ${profile.weight_kg}kg, BMI: ${bmi}`);
    if (bmi > 30) parts.push(`- NOTE: Elevated BMI — favor time-based long run targets, add extra recovery, be conservative with volume`);
  } else if (profile.weight_kg) {
    parts.push(`- Weight: ${profile.weight_kg}kg`);
  }
  parts.push(`- Experience: ${profile.experience_level}`);
  parts.push(`- Race: ${profile.race_name || 'Marathon'} on ${profile.race_date} (${daysUntilRace} days away)`);
  if (profile.race_course_profile !== 'unknown') parts.push(`- Course: ${profile.race_course_profile}`);
  if (profile.target_finish_time_sec) parts.push(`- Goal time: ${formatTime(profile.target_finish_time_sec)}`);
  parts.push(`- Predicted marathon: ${formatTime(predictMarathonTime(profile.vdot_score))}`);
  // Check for flagged weight change
  try {
    const { getSetting, setSetting } = require('../db/database');
    const weightFlag = getSetting('weight_change_flag');
    if (weightFlag) {
      parts.push(`- ⚠️ WEIGHT CHANGE THIS WEEK: ${weightFlag}kg. Ask if this is accurate. Rapid changes affect performance.`);
      setSetting('weight_change_flag', ''); // Clear after surfacing
    }
  } catch {}
  if (profile.injury_history.length > 0) parts.push(`- Injury history: ${profile.injury_history.join(', ')}`);
  if (profile.known_weaknesses.length > 0) parts.push(`- Weaknesses: ${profile.known_weaknesses.join(', ')}`);
  parts.push('');

  // Pace zones
  parts.push('PACE ZONES (min/mile):');
  parts.push(`  E: ${formatPaceRange(paceZones.E)} | M: ${formatPaceRange(paceZones.M)} | T: ${formatPaceRange(paceZones.T)} | I: ${formatPaceRange(paceZones.I)}`);
  parts.push('');

  // Current week
  if (currentWeek) {
    parts.push(`CURRENT WEEK: ${currentWeek.week_number} — ${currentWeek.phase} phase${currentWeek.is_cutback ? ' (cutback)' : ''}`);
    parts.push(`Volume: ${currentWeek.actual_volume.toFixed(1)} of ${currentWeek.target_volume}mi completed`);

    const scheduled = weekWorkouts.filter(w => w.workout_type !== 'rest');
    for (const w of scheduled) {
      const status = w.status === 'completed' ? 'DONE' : w.status === 'skipped' ? 'SKIP' : 'TODO';
      parts.push(`  [${status}] ${w.scheduled_date}: ${w.title} — ${w.target_distance_miles}mi`);
    }
    parts.push('');
  }

  // Today
  if (todaysWorkout) {
    if (todaysWorkout.workout_type === 'rest') {
      parts.push('TODAY: Rest day');
    } else {
      parts.push(`TODAY: ${todaysWorkout.title} — ${todaysWorkout.target_distance_miles}mi at ${todaysWorkout.target_pace_zone || todaysWorkout.workout_type} pace`);
      parts.push(`  ${todaysWorkout.description}`);
    }
    parts.push('');
  }

  // Recent performance (last 7 days)
  if (recentMetrics.length > 0) {
    parts.push('RECENT RUNS (last 7 days):');
    for (const m of recentMetrics.slice(0, 7)) {
      const pace = m.avg_pace_sec_per_mile ? formatPace(m.avg_pace_sec_per_mile) : '?';
      const hr = m.avg_hr ? ` HR:${m.avg_hr}` : '';
      const rpe = m.perceived_exertion ? ` RPE:${m.perceived_exertion}` : '';
      parts.push(`  ${m.date}: ${m.distance_miles.toFixed(1)}mi @ ${pace}/mi${hr}${rpe}`);
    }
    parts.push('');
  }

  // Volume trend (last 4 weeks)
  if (weeks.length > 0) {
    const recentWeeks = weeks.slice(-4);
    parts.push('VOLUME TREND:');
    for (const w of recentWeeks) {
      const pct = w.target_volume > 0 ? Math.round((w.actual_volume / w.target_volume) * 100) : 0;
      parts.push(`  Week ${w.week_number}: ${w.actual_volume.toFixed(1)}/${w.target_volume}mi (${pct}%)${w.is_cutback ? ' CB' : ''}`);
    }
    const adherence = recentWeeks.reduce((sum, w) => {
      const completed = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.status === 'completed').length;
      const total = allWorkouts.filter(wo => wo.week_number === w.week_number && wo.workout_type !== 'rest').length;
      return sum + (total > 0 ? completed / total : 1);
    }, 0) / recentWeeks.length;
    parts.push(`  Adherence: ${Math.round(adherence * 100)}%`);
    parts.push('');
  }

  // Shoe warnings
  const wornShoes = shoes.filter(s => s.totalMiles > s.maxMiles * 0.8);
  if (wornShoes.length > 0) {
    parts.push('SHOE ALERTS:');
    for (const s of wornShoes) {
      parts.push(`  ${s.name}: ${s.totalMiles.toFixed(0)}/${s.maxMiles}mi (${Math.round(s.totalMiles / s.maxMiles * 100)}%)`);
    }
    parts.push('');
  }

  // Recovery status
  if (recoveryStatus && recoveryStatus.level !== 'unknown') {
    parts.push('RECOVERY STATUS:');
    parts.push(`Score: ${recoveryStatus.score}/100 (${recoveryStatus.level}) — ${recoveryStatus.signalCount}/3 signals`);
    for (const s of recoveryStatus.signals) {
      const icon = s.status === 'good' ? '✓' : s.status === 'fair' ? '~' : '✗';
      parts.push(`  ${icon} ${s.type}: ${s.detail}`);
    }
    parts.push(`Recommendation: ${recoveryStatus.recommendation}`);
    parts.push('');
  } else {
    parts.push('Recovery data: not available (HealthKit not connected)');
    parts.push('');
  }

  // Additional health signals
  if (healthSnapshot) {
    const extras: string[] = [];
    if (healthSnapshot.weight) {
      extras.push(`Weight: ${healthSnapshot.weight.value} kg (from Apple Health, ${healthSnapshot.weight.date})`);
    }
    if (healthSnapshot.vo2max) {
      extras.push(`Garmin VO2max: ${healthSnapshot.vo2max.value} mL/kg/min (${healthSnapshot.vo2max.date})`);
    }
    if (healthSnapshot.respiratoryRate !== null) {
      extras.push(`Respiratory rate: ${healthSnapshot.respiratoryRate} breaths/min`);
    }
    if (healthSnapshot.spo2 !== null) {
      const spo2Warning = healthSnapshot.spo2 < 94 ? ' ⚠️ LOW' : '';
      extras.push(`SpO2: ${healthSnapshot.spo2}%${spo2Warning}`);
    }
    if (healthSnapshot.steps !== null) {
      extras.push(`Steps today: ${healthSnapshot.steps.toLocaleString()}`);
    }
    if (extras.length > 0) {
      parts.push('ADDITIONAL HEALTH DATA:');
      extras.forEach(e => parts.push(`  ${e}`));
      parts.push('');
    }
  }

  // Race week mode
  if (isRaceWeek) {
    parts.push('** RACE WEEK ** Focus on taper psychology, logistics, and positive visualization.');
    parts.push('');
  }

  // Plan change instructions
  parts.push(`PLAN CHANGES:
If you suggest modifying the training plan, include this JSON block at the END of your message:
\`\`\`json
{"planChange": {"type": "adapt_plan", "description": "what to change", "reason": "why"}}
\`\`\`
Types: "adapt_plan" (replan future weeks), "modify_workout" (change a specific workout), "skip_workout" (skip a workout).
Only suggest changes when clearly warranted. Don't force changes.`);

  return parts.join('\n');
}

// ─── Send Message ───────────────────────────────────────────

export async function sendCoachMessage(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: CoachMessage[],
): Promise<CoachResponse> {
  if (!isGeminiAvailable()) {
    return {
      message: "I'm currently unavailable — check your Gemini API key. Your training plan is still running as scheduled.",
      planChange: null,
    };
  }

  // Convert to chat format (last 20 messages for context efficiency)
  const history = conversationHistory
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const responseText = await sendChatMessage(systemPrompt, history, userMessage);

  // Parse plan change if present
  const planChange = parsePlanChange(responseText);

  // Clean the response text (remove the JSON block if present)
  let cleanMessage = responseText;
  const jsonBlockMatch = responseText.match(/```json\s*\{[\s\S]*?"planChange"[\s\S]*?\}\s*```/);
  if (jsonBlockMatch) {
    cleanMessage = responseText.replace(jsonBlockMatch[0], '').trim();
  }

  return {
    message: cleanMessage,
    planChange,
  };
}

// ─── Plan Change Parser ─────────────────────────────────────

function parsePlanChange(responseText: string): PlanChangeRequest | null {
  try {
    const jsonBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonBlockMatch) return null;

    const parsed = JSON.parse(jsonBlockMatch[1]);
    const pc = parsed.planChange || parsed;

    if (!pc || !pc.type || !pc.description) return null;

    const validTypes = ['adapt_plan', 'modify_workout', 'skip_workout'];
    if (!validTypes.includes(pc.type)) return null;

    return {
      type: pc.type,
      description: pc.description,
      reason: pc.reason || '',
      workoutId: pc.workoutId,
      changes: pc.changes,
    };
  } catch {
    return null;
  }
}
