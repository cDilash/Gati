import { TrainingContext, PaceZoneName } from '../types';
import { formatPace } from '../engine/vdot';
import { formatPaceRange, ZONE_DESCRIPTIONS } from '../engine/paceZones';
import { UnitSystem, formatPaceRangeWithUnit, paceLabel, formatWeight, formatDistance, distanceLabel } from '../utils/units';

export function buildCoachSystemPrompt(context: TrainingContext, units: UnitSystem = 'imperial'): string {
  const { profile, paceZones, hrZones, currentWeekNumber, totalWeeks, currentPhase, daysUntilRace, thisWeekWorkouts, recentMetrics, weeklyVolumeTrend, adherenceRate, todaysWorkout } = context;

  const sections: string[] = [];
  const dl = distanceLabel(units);
  const pl = paceLabel(units);

  sections.push(`You are an expert running coach guiding an athlete through marathon training. You follow Jack Daniels training methodology and the 80/20 polarized training approach.`);

  sections.push(`ATHLETE PROFILE:
- Age: ${profile.age}, Weight: ${formatWeight(profile.weight_lbs, units)}
- VDOT: ${profile.vdot.toFixed(1)}
- Level: ${profile.level}
- Race: ${profile.race_distance} on ${profile.race_date} (${daysUntilRace} days away)
- Current week: ${currentWeekNumber} of ${totalWeeks} (${currentPhase} phase)`);

  sections.push(`PACE ZONES:
- E (Easy): ${formatPaceRangeWithUnit(paceZones.E, units)} ${pl}
- M (Marathon): ${formatPaceRangeWithUnit(paceZones.M, units)} ${pl}
- T (Threshold): ${formatPaceRangeWithUnit(paceZones.T, units)} ${pl}
- I (Interval): ${formatPaceRangeWithUnit(paceZones.I, units)} ${pl}
- R (Repetition): ${formatPaceRangeWithUnit(paceZones.R, units)} ${pl}`);

  sections.push(`HR ZONES:
- Zone 1 (${hrZones.zone1.name}): ${hrZones.zone1.min}-${hrZones.zone1.max} bpm
- Zone 2 (${hrZones.zone2.name}): ${hrZones.zone2.min}-${hrZones.zone2.max} bpm
- Zone 3 (${hrZones.zone3.name}): ${hrZones.zone3.min}-${hrZones.zone3.max} bpm
- Zone 4 (${hrZones.zone4.name}): ${hrZones.zone4.min}-${hrZones.zone4.max} bpm
- Zone 5 (${hrZones.zone5.name}): ${hrZones.zone5.min}-${hrZones.zone5.max} bpm`);

  // This week's workouts
  const workoutLines = thisWeekWorkouts
    .filter(w => w.workout_type !== 'rest')
    .map(w => {
      const status = w.status === 'completed' ? '[DONE]' : w.status === 'skipped' ? '[SKIP]' : '[TODO]';
      return `  ${status} ${w.date}: ${w.workout_type} ${formatDistance(w.distance_miles, units)} @ ${w.target_pace_zone} pace`;
    });
  sections.push(`THIS WEEK'S WORKOUTS:\n${workoutLines.join('\n')}`);

  if (todaysWorkout) {
    sections.push(`TODAY'S WORKOUT: ${todaysWorkout.workout_type} — ${formatDistance(todaysWorkout.distance_miles, units)} at ${todaysWorkout.target_pace_zone} pace`);
  }

  // Recent performance
  if (recentMetrics.length > 0) {
    const metricLines = recentMetrics.slice(0, 7).map(m =>
      `  ${m.date}: ${formatDistance(m.distance_miles, units)} in ${Math.floor(m.duration_seconds / 60)}min, avg pace ${formatPace(m.avg_pace_per_mile)}${m.avg_hr ? `, HR ${m.avg_hr}` : ''}`
    );
    sections.push(`RECENT RUNS (last 7 days):\n${metricLines.join('\n')}`);
  }

  // Volume trend
  if (weeklyVolumeTrend.length > 0) {
    const trendLines = weeklyVolumeTrend.map(t =>
      `  Week ${t.week}: ${formatDistance(t.actual, units)}/${formatDistance(t.target, units)} (${t.target > 0 ? Math.round(t.actual / t.target * 100) : 0}%)`
    );
    sections.push(`VOLUME TREND (last ${weeklyVolumeTrend.length} weeks):\n${trendLines.join('\n')}\nAdherence rate: ${(adherenceRate * 100).toFixed(0)}%`);
  }

  // Adaptive training context
  if (context.currentACWR !== undefined) {
    const acwrStatus = context.currentACWR > 1.5 ? 'CRITICAL — injury risk, workouts auto-reduced'
      : context.currentACWR > 1.3 ? 'ELEVATED — quality sessions auto-converted to easy'
      : context.currentACWR < 0.8 ? 'LOW — detraining risk, athlete may need encouragement'
      : 'NORMAL';
    sections.push(`ACUTE:CHRONIC WORKLOAD RATIO: ${context.currentACWR.toFixed(2)} (${acwrStatus})`);
  }

  if (context.lastVDOTUpdate) {
    const v = context.lastVDOTUpdate;
    sections.push(`RECENT VDOT UPDATE: ${v.previousVDOT} → ${v.newVDOT} (${v.confidenceLevel} confidence — ${v.reason})`);
  }

  if (context.lastReconciliation) {
    const r = context.lastReconciliation;
    sections.push(`LAST WEEK RECONCILIATION: Week ${r.weekNumber} — ${r.actualVolume}/${r.plannedVolume}mi (${Math.round(r.completionRate * 100)}% completion), ${r.adjustments.length} auto-adjustments applied`);
  }

  if (context.recentAdaptiveLogs && context.recentAdaptiveLogs.length > 0) {
    const logLines = context.recentAdaptiveLogs.slice(0, 5).map(l => `  - [${l.type}] ${l.summary}`);
    sections.push(`RECENT AUTO-ADAPTATIONS (last 7 days):\n${logLines.join('\n')}\nNote: These adjustments were already applied automatically by the math engine. Acknowledge them in your advice but do not suggest further reductions unless you see additional evidence.`);
  }

  // Recovery status
  if (context.recoveryStatus && context.recoveryStatus.signalCount >= 2) {
    const rs = context.recoveryStatus;
    const signalLines = rs.signals.map(s => {
      switch (s.type) {
        case 'resting_hr': return `- Resting HR: ${s.value} bpm (baseline ${context.profile.resting_hr}) — ${s.status.toUpperCase()}`;
        case 'hrv': return `- HRV: ${s.value}ms — ${s.status.toUpperCase()}`;
        case 'sleep': return `- Sleep: ${s.value}h — ${s.status.toUpperCase()}`;
        case 'volume_trend': return `- Volume trend: ${s.value}x weekly avg — ${s.status.toUpperCase()}`;
      }
    });
    sections.push(`RECOVERY STATUS:\n- Score: ${rs.score}/100 (${rs.signalCount}/4 signals)\n${signalLines.join('\n')}\n- Recommendation: ${rs.recommendation.toUpperCase().replace('_', ' ')}`);
  }

  sections.push(`COACHING PRINCIPLES:
- Follow 80/20 rule: ~80% easy volume, ~20% quality
- Progressive overload with adequate recovery
- Never increase weekly volume more than 12% week-over-week
- Prioritize consistency over intensity
- Monitor fatigue: if athlete reports tiredness, err on side of recovery
- ACWR: keep acute (1 week) to chronic (4 week) workload ratio between 0.8-1.3

RESPONSE GUIDELINES:
- Be concise, direct, and encouraging
- Reference specific data from their recent runs when relevant
- If suggesting plan changes, include a JSON block in this format:
\`\`\`json
{"mutation": {"type": "reduce_volume|skip_workout|swap_workout|recalculate", "affected_workout_ids": ["id1"], "description": "reason for change"}}
\`\`\`
- Only suggest changes when there's clear evidence (fatigue, injury risk, significant over/under performance)`);

  return sections.join('\n\n');
}
