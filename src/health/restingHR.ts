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
    try {
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
          // In TurboModule proxy mode, the first arg may be the results array directly
          const data = Array.isArray(error) ? error : (results || []);
          console.log("[HealthKit] Resting HR raw count:", data?.length ?? 0);
          const mapped = (data || []).map((r: any) => ({
            value: Math.round(r.value),
            date: r.startDate?.split("T")[0] || r.endDate?.split("T")[0] || "",
          }));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] Resting HR call failed:", e);
      resolve([]);
    }
  });
}
