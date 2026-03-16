import { getHealthKit } from "./availability";

export async function getStepCount(date: Date): Promise<number | null> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return null;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return new Promise((resolve) => {
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
  });
}
