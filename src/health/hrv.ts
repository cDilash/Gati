import { getHealthKit } from "./availability";

export interface HRVResult {
  value: number; // RMSSD in milliseconds
  date: string; // YYYY-MM-DD
}

export async function getHRVSamples(daysBack: number = 14): Promise<HRVResult[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    AppleHealthKit.getHeartRateVariabilitySamples(
      {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        ascending: false,
        limit: daysBack,
      },
      (error: string, results: any[]) => {
        if (error) {
          console.log("[HealthKit] HRV error:", error);
          resolve([]);
          return;
        }
        console.log("[HealthKit] HRV raw count:", results?.length ?? 0);
        const mapped = (results || []).map((r: any) => ({
          value: Math.round(r.value * 10) / 10,
          date: r.startDate?.split("T")[0] || "",
        }));
        resolve(mapped);
      }
    );
  });
}
