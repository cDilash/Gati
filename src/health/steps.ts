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
        },
        (error: string, result: any) => {
          if (error || !result) {
            console.log("[HealthKit] Steps error:", error);
            resolve(null);
            return;
          }
          resolve(Math.round(result.value));
        }
      );
    } catch (e) {
      console.log("[HealthKit] Steps call failed:", e);
      resolve(null);
    }
  });
}

export async function getStepHistory(daysBack: number = 7): Promise<DailySteps[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  startDate.setHours(0, 0, 0, 0);

  // Try getDailyStepCountSamples first (returns per-day breakdown)
  return new Promise((resolve) => {
    try {
      const fn = AppleHealthKit.getDailyStepCountSamples ?? AppleHealthKit.getStepCountSamples;
      if (typeof fn !== 'function') {
        console.log("[HealthKit] No daily step count method available, falling back to individual queries");
        resolve(getStepHistoryFallback(daysBack));
        return;
      }

      fn.call(AppleHealthKit,
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          period: 1440, // 1440 minutes = 1 day
        },
        (error: string, results: any[]) => {
          if (error || !results?.length) {
            console.log("[HealthKit] Daily steps error:", error, "— falling back");
            resolve(getStepHistoryFallback(daysBack));
            return;
          }

          console.log("[HealthKit] Daily steps raw:", results.length, "days");

          // Group by date and sum (in case multiple entries per day)
          const dayMap = new Map<string, number>();
          for (const r of results) {
            const date = (r.startDate ?? r.date ?? '').split('T')[0];
            if (!date) continue;
            dayMap.set(date, (dayMap.get(date) ?? 0) + Math.round(r.value ?? r.quantity ?? 0));
          }

          const mapped: DailySteps[] = [];
          dayMap.forEach((steps, date) => {
            if (steps > 0) mapped.push({ date, steps });
          });

          mapped.sort((a, b) => a.date.localeCompare(b.date));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] Daily steps call failed:", e);
      resolve(getStepHistoryFallback(daysBack));
    }
  });
}

// Fallback: query each day individually (slower but reliable)
async function getStepHistoryFallback(daysBack: number): Promise<DailySteps[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const results: DailySteps[] = [];

  for (let i = daysBack - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const steps = await new Promise<number | null>((resolve) => {
      try {
        AppleHealthKit.getStepCount(
          {
            startDate: startOfDay.toISOString(),
            endDate: endOfDay.toISOString(),
            includeManuallyAdded: false,
          },
          (error: string, result: any) => {
            if (error || !result) { resolve(null); return; }
            resolve(Math.round(result.value));
          }
        );
      } catch { resolve(null); }
    });

    if (steps !== null && steps > 0) {
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      results.push({ date: dateStr, steps });
    }
  }

  return results;
}
