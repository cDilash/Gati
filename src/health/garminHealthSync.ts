/**
 * Garmin Health Sync — reads ALL health data from Supabase garmin_health table.
 * Single source of truth for all health/recovery data.
 * No native modules needed. Works on simulator.
 * Single source of truth: Garmin → Supabase Edge Function → this module → app.
 */

import { HealthSnapshot, GarminHealthData } from '../types';

function mapRow(row: any): GarminHealthData {
  return {
    date: row.date,
    hrvLastNightAvg: row.hrv_last_night_avg ?? null,
    hrvWeeklyAvg: row.hrv_weekly_avg ?? null,
    hrvBaselineLow: row.hrv_baseline_low ?? null,
    hrvBaselineHigh: row.hrv_baseline_high ?? null,
    hrvStatus: row.hrv_status ?? null,
    vo2max: row.vo2max ?? null,
    bodyBatteryMorning: row.body_battery_morning ?? null,
    bodyBatteryHigh: row.body_battery_high ?? null,
    bodyBatteryLow: row.body_battery_low ?? null,
    bodyBatteryCharged: row.body_battery_charged ?? null,
    bodyBatteryDrained: row.body_battery_drained ?? null,
    stressAvg: row.stress_avg ?? null,
    stressHigh: row.stress_high ?? null,
    respiratoryRate: row.respiratory_rate ?? null,
    spo2Avg: row.spo2_avg ?? null,
    trainingReadiness: row.training_readiness ?? null,
    trainingStatus: row.training_status ?? null,
    trainingLoad7day: row.training_load_7day ?? null,
    acwr: row.acwr ?? null,
    acwrStatus: row.acwr_status ?? null,
    sleepScore: row.sleep_score ?? null,
    intensityMinutesVigorous: row.intensity_minutes_vigorous ?? null,
    intensityMinutesModerate: row.intensity_minutes_moderate ?? null,
    restingHr: row.resting_hr ?? null,
    readinessFeedbackShort: row.readiness_feedback_short ?? null,
    readinessFeedbackLong: row.readiness_feedback_long ?? null,
    recoveryTimeHours: row.recovery_time_hours ?? null,
    predictedMarathonSec: row.predicted_marathon_sec ?? null,
    predicted5kSec: row.predicted_5k_sec ?? null,
    predicted10kSec: row.predicted_10k_sec ?? null,
    predictedHalfSec: row.predicted_half_sec ?? null,
    sleepSubscores: row.sleep_subscores_json
      ? (typeof row.sleep_subscores_json === 'string' ? JSON.parse(row.sleep_subscores_json) : row.sleep_subscores_json)
      : null,
    sleepNeedMinutes: row.sleep_need_minutes ?? null,
    sleepDebtMinutes: row.sleep_debt_minutes ?? null,
    enduranceScore: row.endurance_score ?? null,
    enduranceClassification: row.endurance_classification ?? null,
    skinTempDeviationC: row.skin_temp_deviation_c ?? null,
    maxHrDaily: row.max_hr_daily ?? null,
    minHrDaily: row.min_hr_daily ?? null,
    rhr7dayAvg: row.rhr_7day_avg ?? null,
    stressQualifier: row.stress_qualifier ?? null,
    bbAtWake: row.bb_at_wake ?? null,
    hrv5minHigh: row.hrv_5min_high ?? null,
    hrvFeedback: row.hrv_feedback ?? null,
    minSpo2: row.min_spo2 ?? null,
    sleepAwakeCount: row.sleep_awake_count ?? null,
    avgSleepStress: row.avg_sleep_stress ?? null,
    hillScore: row.hill_score ?? null,
    hillEndurance: row.hill_endurance ?? null,
    hillStrength: row.hill_strength ?? null,
    lactateThresholdHr: row.lactate_threshold_hr ?? null,
    lactateThresholdSpeed: row.lactate_threshold_speed ?? null,
    vo2maxFitnessAge: row.vo2max_fitness_age ?? null,
    floorsClimbed: row.floors_climbed ?? null,
    sleepDurationSec: row.sleep_duration_sec ?? null,
    sleepDeepSec: row.sleep_deep_sec ?? null,
    sleepLightSec: row.sleep_light_sec ?? null,
    sleepRemSec: row.sleep_rem_sec ?? null,
    sleepAwakeSec: row.sleep_awake_sec ?? null,
    sleepStart: row.sleep_start ?? null,
    sleepEnd: row.sleep_end ?? null,
    fetchedAt: row.fetched_at ?? '',
  };
}

/**
 * Query Supabase with a 5-second timeout.
 */
async function supabaseQuery(fn: (sb: any) => Promise<any>): Promise<any> {
  const { supabase } = require('../backup/supabase');
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Supabase query timeout (5s)')), 5000)
  );
  return Promise.race([fn(supabase), timeout]);
}

/**
 * Fetch today's Garmin health data from Supabase.
 * Falls back to yesterday if today's data isn't available yet.
 */
export async function syncGarminHealthData(): Promise<{
  snapshot: HealthSnapshot;
  garmin: GarminHealthData;
  trend: GarminHealthData[];
} | null> {
  try {
    const { getToday } = require('../utils/dateUtils');
    const today = getToday();

    // Fetch today + yesterday in one query (fallback if today not synced yet)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabaseQuery((sb: any) =>
      sb
        .from('garmin_health')
        .select('*')
        .in('date', [today, yesterdayStr])
        .order('date', { ascending: false })
    );

    if (error || !data || data.length === 0) {
      console.log('[Garmin] No health data available in Supabase');
      return null;
    }

    // Use today's data if available, otherwise yesterday's
    const todayRow = data.find((r: any) => r.date === today);
    const primaryRow = todayRow || data[0];
    const garmin = mapRow(primaryRow);

    console.log(`[Garmin] Using data for ${primaryRow.date}${!todayRow ? ' (today not yet available)' : ''}`);

    // Fetch 14-day trend for charts
    const trend = await fetchGarminTrend(14);

    // Build HealthSnapshot from Garmin data (backward-compatible with UI)
    const snapshot = buildHealthSnapshot(garmin, trend, today);

    console.log(`[Garmin] Synced — RHR=${garmin.restingHr ?? 'N/A'}, HRV=${garmin.hrvLastNightAvg ?? 'N/A'}ms, Sleep=${garmin.sleepScore ?? 'N/A'}/100, BB=${garmin.bodyBatteryMorning ?? 'N/A'}, TR=${garmin.trainingReadiness ?? 'N/A'}`);

    // Cache Garmin personal records to local SQLite for synchronous access by profileUpdater
    try {
      const { data: prs } = await supabaseQuery((sb: any) =>
        sb.from('garmin_personal_records').select('distance_label, time_seconds, activity_date').order('type_id')
      );
      if (prs && prs.length > 0) {
        const { getDatabase } = require('../db/database');
        const db = getDatabase();
        db.runSync(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('garmin_personal_records', ?)",
          [JSON.stringify(prs)]
        );
        console.log(`[Garmin] Cached ${prs.length} personal records to SQLite`);
      }
    } catch (e: any) {
      console.log('[Garmin] PR cache failed:', e.message);
    }

    return { snapshot, garmin, trend };
  } catch (e: any) {
    console.log('[Garmin] Health sync error:', e.message || e);
    return null;
  }
}

/**
 * Fetch N days of Garmin health data for trend charts.
 */
export async function fetchGarminTrend(daysBack: number = 14): Promise<GarminHealthData[]> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabaseQuery((sb: any) =>
      sb
        .from('garmin_health')
        .select('*')
        .gte('date', startStr)
        .order('date', { ascending: false })
    );

    if (error || !data) return [];
    return data.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * Build a HealthSnapshot from Garmin data.
 * Maps Garmin fields into the HealthSnapshot shape that the UI expects.
 * This enables zero UI changes — same field names, just different source.
 */
function buildHealthSnapshot(
  garmin: GarminHealthData,
  trend: GarminHealthData[],
  today: string,
): HealthSnapshot {
  // Build trend arrays in the format UI expects: { value, date }
  const restingHRTrend = trend
    .filter(d => d.restingHr != null)
    .map(d => ({ value: d.restingHr!, date: d.date }));

  const hrvTrend = trend
    .filter(d => d.hrvLastNightAvg != null)
    .map(d => ({ value: d.hrvLastNightAvg!, date: d.date }));

  // Sleep trend: map Garmin sleep data into SleepResult-compatible shape
  const sleepTrend = trend
    .filter(d => d.sleepScore != null || d.sleepDurationSec != null)
    .map(d => {
      // Use actual duration if available, fall back to need - debt estimate
      let totalMinutes: number;
      if (d.sleepDurationSec != null) {
        totalMinutes = Math.round(d.sleepDurationSec / 60);
      } else {
        const needMin = d.sleepNeedMinutes ?? 480;
        const debtMin = d.sleepDebtMinutes ?? 0;
        totalMinutes = needMin - debtMin;
      }
      return {
        totalMinutes: Math.max(0, totalMinutes),
        date: d.date,
        bedStart: d.sleepStart ?? '',
        bedEnd: d.sleepEnd ?? '',
        stages: null,
        isLikelyIncomplete: false,
      };
    });

  const respiratoryRateTrend = trend
    .filter(d => d.respiratoryRate != null)
    .map(d => ({ value: d.respiratoryRate!, date: d.date }));

  const spo2Trend = trend
    .filter(d => d.spo2Avg != null)
    .map(d => ({ value: d.spo2Avg!, date: d.date }));

  // Sleep hours: use actual duration from Garmin, fall back to need - debt estimate
  let sleepHours: number | null = null;
  if (garmin.sleepDurationSec != null) {
    sleepHours = Math.round((garmin.sleepDurationSec / 3600) * 10) / 10;
  } else if (garmin.sleepNeedMinutes != null) {
    const needMin = garmin.sleepNeedMinutes;
    const debtMin = garmin.sleepDebtMinutes ?? 0;
    sleepHours = Math.round((needMin - debtMin) / 6) / 10;
  }

  // Count scored signals (RHR, HRV, Sleep)
  let signalCount = 0;
  if (garmin.restingHr != null) signalCount++;
  if (garmin.hrvLastNightAvg != null) signalCount++;
  if (sleepHours != null || garmin.sleepScore != null) signalCount++;
  if (garmin.respiratoryRate != null) signalCount++;

  return {
    date: today,
    restingHR: garmin.restingHr,
    hrvRMSSD: garmin.hrvLastNightAvg,
    sleepHours,
    restingHRTrend,
    hrvTrend,
    sleepTrend,
    weight: null, // Garmin scale data not in this table yet
    vo2max: garmin.vo2max != null ? { value: garmin.vo2max, date: garmin.date } : null,
    respiratoryRate: garmin.respiratoryRate,
    respiratoryRateTrend,
    spo2: garmin.spo2Avg,
    spo2Trend,
    steps: null, // Steps not in garmin_health table (daily summary only)
    stepsTrend: [],
    restingHRAge: 0, // Garmin data is always fresh (synced every 15 min)
    sleepAge: 0,
    signalCount,
    cachedAt: new Date().toISOString(),
  };
}
