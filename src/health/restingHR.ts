import { getHealthKit } from "./availability";

export interface RestingHRResult {
  value: number; // bpm
  date: string; // ISO date (YYYY-MM-DD)
}

export async function getRestingHeartRate(
  daysBack: number = 14
): Promise<RestingHRResult[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    AppleHealthKit.getRestingHeartRateSamples(
      {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        ascending: false,
        limit: daysBack,
      },
      (error: string, results: any[]) => {
        if (error) {
          console.log("[HealthKit] Resting HR error:", error);
          resolve([]);
          return;
        }
        console.log("[HealthKit] Resting HR raw count:", results?.length ?? 0);
        const mapped = (results || []).map((r: any) => ({
          value: Math.round(r.value),
          date: r.startDate?.split("T")[0] || r.endDate?.split("T")[0] || "",
        }));
        resolve(mapped);
      }
    );
  });
}
