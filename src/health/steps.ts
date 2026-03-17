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

  // Use getDailyStepCountSamples — this returns Apple's deduplicated daily totals
  // Unlike getSamples which returns raw overlapping samples from multiple sources
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getDailyStepCountSamples(
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
        },
        (error: string, results: any[]) => {
          if (error || !results?.length) {
            console.log("[HealthKit] getDailyStepCountSamples error:", error, "— trying fallback");
            // Fallback: just use today's step count
            getStepCount(new Date()).then(today => {
              if (today) {
                resolve([{ date: new Date().toISOString().split('T')[0], steps: today }]);
              } else {
                resolve([]);
              }
            });
            return;
          }

          console.log("[HealthKit] Daily steps:", results.length, "entries");

          // getDailyStepCountSamples returns objects with { startDate, value }
          // Group by date (in case multiple entries per day) and take MAX (not sum — already deduplicated)
          const dayMap = new Map<string, number>();
          for (const r of results) {
            const date = (r.startDate ?? r.date ?? '').split('T')[0];
            if (!date) continue;
            const value = Math.round(r.value ?? r.quantity ?? 0);
            if (value > 0) {
              // Take the MAX per day (getDailyStepCountSamples may return partial day entries)
              const existing = dayMap.get(date) ?? 0;
              dayMap.set(date, Math.max(existing, value));
            }
          }

          const mapped: DailySteps[] = [];
          dayMap.forEach((steps, date) => {
            mapped.push({ date, steps });
          });

          mapped.sort((a, b) => a.date.localeCompare(b.date));
          console.log("[HealthKit] Step history:", mapped.map(d => `${d.date}:${d.steps}`).join(', '));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] getDailyStepCountSamples failed:", e);
      // Fallback to today only
      getStepCount(new Date()).then(today => {
        if (today) {
          resolve([{ date: new Date().toISOString().split('T')[0], steps: today }]);
        } else {
          resolve([]);
        }
      });
    }
  });
}
