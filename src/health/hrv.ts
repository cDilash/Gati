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
    try {
      AppleHealthKit.getHeartRateVariabilitySamples(
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          ascending: false,
          limit: daysBack,
        },
        (error: string, results: any[]) => {
          // TurboModule proxy may pass results as first arg
          const data = Array.isArray(error) ? error : (results || []);
          if (error && !Array.isArray(error)) {
            console.log("[HealthKit] HRV error:", error);
            resolve([]);
            return;
          }
          console.log("[HealthKit] HRV raw count:", data?.length ?? 0);
          const mapped = (data || []).map((r: any) => ({
            value: Math.round(r.value * 10) / 10,
            date: r.startDate?.split("T")[0] || "",
          }));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] HRV call failed:", e);
      resolve([]);
    }
  });
}
