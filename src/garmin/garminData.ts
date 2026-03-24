/**
 * Garmin Connect health data reader.
 * Reads from Supabase garmin_health table (populated by external Python script).
 * Gracefully returns null if no data exists.
 */

import { GarminHealthData } from '../types';

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
    sleepSubscores: row.sleep_subscores_json ? (typeof row.sleep_subscores_json === 'string' ? JSON.parse(row.sleep_subscores_json) : row.sleep_subscores_json) : null,
    sleepNeedMinutes: row.sleep_need_minutes ?? null,
    sleepDebtMinutes: row.sleep_debt_minutes ?? null,
    fetchedAt: row.fetched_at ?? '',
  };
}

export async function getLatestGarminData(): Promise<GarminHealthData | null> {
  try {
    const { supabase } = require('../backup/supabase');
    const { data, error } = await supabase
      .from('garmin_health')
      .select('*')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return mapRow(data);
  } catch {
    return null;
  }
}

export async function fetchGarminHealthData(date: string): Promise<GarminHealthData | null> {
  try {
    const { supabase } = require('../backup/supabase');
    const { data, error } = await supabase
      .from('garmin_health')
      .select('*')
      .eq('date', date)
      .single();

    if (error || !data) return null;
    return mapRow(data);
  } catch {
    return null;
  }
}

export async function fetchGarminHealthTrend(daysBack: number = 14): Promise<GarminHealthData[]> {
  try {
    const { supabase } = require('../backup/supabase');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startStr = startDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('garmin_health')
      .select('*')
      .gte('date', startStr)
      .order('date', { ascending: false });

    if (error || !data) return [];
    return data.map(mapRow);
  } catch {
    return [];
  }
}
