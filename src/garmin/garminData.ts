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
    stressAvg: row.stress_avg ?? null,
    respiratoryRate: row.respiratory_rate ?? null,
    spo2Avg: row.spo2_avg ?? null,
    trainingReadiness: row.training_readiness ?? null,
    restingHr: row.resting_hr ?? null,
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
