import { getHealthKit } from "./availability";

export interface DailySteps {
  date: string; // YYYY-MM-DD
  steps: number;
}

export async function getStepCount(date: Date): Promise<number | null> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return null;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return new Promise((resolve) => {
    try {
      AppleHealthKit.getStepCount(
        {
          startDate: startOfDay.toISOString(),
          endDate: endOfDay.toISOString(),
          includeManuallyAdded: true,
        },
        (error: string, result: any) => {
          // TurboModule proxy may pass result as first arg
          if (error && typeof error === 'object' && error !== null && 'value' in error) {
            result = error;
            error = '' as any;
          }
          if (error || !result) { resolve(null); return; }
          resolve(Math.round(result.value));
        }
      );
    } catch { resolve(null); }
  });
}

export async function getStepHistory(daysBack: number = 7): Promise<DailySteps[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  startDate.setHours(0, 0, 0, 0);

  // Use getDailyStepCountSamples with period=1440 (24 hours = daily aggregation)
  // This returns Apple Health's deduplicated daily totals
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getDailyStepCountSamples(
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          period: 1440, // 1440 minutes = 1 day — returns DAILY totals, not hourly
          includeManuallyAdded: true,
        },
        (error: string, results: any[]) => {
          // TurboModule fix
          const data = Array.isArray(error) ? error : (results || []);
          if (error && !Array.isArray(error)) {
            console.log("[HealthKit] getDailyStepCountSamples error:", error);
            // Fallback: query each day individually
            fallbackStepHistory(daysBack).then(resolve);
            return;
          }

          if (!data || data.length === 0) {
            fallbackStepHistory(daysBack).then(resolve);
            return;
          }

          console.log("[HealthKit] Daily steps:", data.length, "entries");

          // With period=1440, each entry is a full day's aggregated total
          // Group by date and SUM (in case there are still multiple entries per day)
          const dayMap = new Map<string, number>();
          for (const r of data) {
            const date = (r.startDate ?? r.date ?? '').split('T')[0];
            if (!date) continue;
            const value = Math.round(r.value ?? r.quantity ?? 0);
            if (value > 0) {
              const existing = dayMap.get(date) ?? 0;
              dayMap.set(date, existing + value); // SUM not MAX
            }
          }

          const mapped: DailySteps[] = [];
          dayMap.forEach((steps, date) => mapped.push({ date, steps }));
          mapped.sort((a, b) => a.date.localeCompare(b.date));

          console.log("[HealthKit] Step history:", mapped.map(d => `${d.date}:${d.steps}`).join(', '));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] getDailyStepCountSamples failed:", e);
      fallbackStepHistory(daysBack).then(resolve);
    }
  });
}

// Fallback: query each day individually using getStepCount (always returns correct aggregated total)
async function fallbackStepHistory(daysBack: number): Promise<DailySteps[]> {
  const results: DailySteps[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const steps = await getStepCount(d);
    if (steps != null && steps > 0) {
      results.push({ date: d.toISOString().split('T')[0], steps });
    }
  }
  return results;
}
