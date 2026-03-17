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
  const results: DailySteps[] = [];

  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const steps = await getStepCount(date);
    if (steps !== null) {
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      results.push({ date: dateStr, steps });
    }
  }

  return results.reverse(); // oldest → newest
}
