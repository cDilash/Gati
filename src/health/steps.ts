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
            resolve(null);
            return;
          }
          resolve(Math.round(result.value));
        }
      );
    } catch {
      resolve(null);
    }
  });
}

export async function getStepHistory(daysBack: number = 7): Promise<DailySteps[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  // Use getStepCount for each day individually with strict date boundaries
  // This is the most reliable approach — getDailyStepCountSamples may not exist
  const results: DailySteps[] = [];

  for (let i = daysBack - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    day.setHours(12, 0, 0, 0); // noon to avoid timezone edge cases

    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);

    const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

    const steps = await new Promise<number | null>((resolve) => {
      try {
        AppleHealthKit.getStepCount(
          {
            startDate: startOfDay.toISOString(),
            endDate: endOfDay.toISOString(),
            includeManuallyAdded: false,
          },
          (error: string, result: any) => {
            if (error || !result) {
              console.log(`[HealthKit] Steps ${dateStr} error:`, error);
              resolve(null);
              return;
            }
            console.log(`[HealthKit] Steps ${dateStr}: ${Math.round(result.value)}`);
            resolve(Math.round(result.value));
          }
        );
      } catch {
        resolve(null);
      }
    });

    if (steps !== null && steps > 0) {
      results.push({ date: dateStr, steps });
    }
  }

  console.log(`[HealthKit] Step history: ${results.length} days fetched`);
  return results;
}
