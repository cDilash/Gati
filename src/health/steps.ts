import { getHealthKit } from "./availability";
import { getHealthKitConstants } from "./availability";

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

  // Use getSamples to fetch raw step samples, then aggregate by day
  // This is more reliable than getStepCount which may ignore date params
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getSamples(
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          type: 'StepCount',
        },
        (error: string, results: any[]) => {
          if (error || !results?.length) {
            console.log("[HealthKit] Step samples error:", error);
            // Fallback to single today value
            getStepCount(new Date()).then(today => {
              if (today) {
                const todayStr = new Date().toISOString().split('T')[0];
                resolve([{ date: todayStr, steps: today }]);
              } else {
                resolve([]);
              }
            });
            return;
          }

          console.log("[HealthKit] Step samples raw:", results.length);

          // Group by day and sum
          const dayMap = new Map<string, number>();
          for (const sample of results) {
            const date = (sample.startDate ?? sample.start ?? '').split('T')[0];
            if (!date) continue;
            const value = Math.round(sample.value ?? sample.quantity ?? 0);
            if (value > 0) {
              dayMap.set(date, (dayMap.get(date) ?? 0) + value);
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
      console.log("[HealthKit] Step samples call failed:", e);
      resolve([]);
    }
  });
}
