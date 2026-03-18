import { getHealthKit } from "./availability";

export interface RespiratoryRateResult {
  value: number; // breaths per minute
  date: string;
}

export async function getRespiratoryRate(daysBack: number = 14): Promise<RespiratoryRateResult[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  if (typeof AppleHealthKit.getRespiratoryRateSamples !== 'function') {
    console.log("[HealthKit] Respiratory rate method not available");
    return [];
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    try {
      AppleHealthKit.getRespiratoryRateSamples(
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
            console.log("[HealthKit] Respiratory rate error:", error);
            resolve([]);
            return;
          }
          const mapped = (data || []).map((r: any) => ({
            value: Math.round(r.value * 10) / 10,
            date: r.startDate?.split("T")[0] || "",
          }));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] Respiratory rate call failed:", e);
      resolve([]);
    }
  });
}
