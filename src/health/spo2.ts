import { getHealthKit } from "./availability";

export interface SpO2Result {
  value: number; // percentage 0-100
  date: string;
}

export async function getBloodOxygen(daysBack: number = 14): Promise<SpO2Result[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  if (typeof AppleHealthKit.getOxygenSaturationSamples !== 'function') {
    console.log("[HealthKit] SpO2 method not available");
    return [];
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    try {
      AppleHealthKit.getOxygenSaturationSamples(
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          ascending: false,
          limit: daysBack,
        },
        (error: string, results: any[]) => {
          if (error) {
            console.log("[HealthKit] SpO2 error:", error);
            resolve([]);
            return;
          }
          const mapped = (results || []).map((r: any) => ({
            value: Math.round(r.value * 100), // HealthKit stores as 0-1 decimal
            date: r.startDate?.split("T")[0] || "",
          }));
          resolve(mapped);
        }
      );
    } catch (e) {
      console.log("[HealthKit] SpO2 call failed:", e);
      resolve([]);
    }
  });
}
