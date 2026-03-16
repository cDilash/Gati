import { getHealthKit } from "./availability";

export interface VO2MaxResult {
  value: number; // mL/kg/min
  date: string;
}

export async function getVO2Max(): Promise<VO2MaxResult | null> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return null;

  // Check if method exists — react-native-health may not support this on all versions
  const methodName = typeof AppleHealthKit.getVo2MaxSamples === 'function' ? 'getVo2MaxSamples' : null;
  if (!methodName) {
    console.log("[HealthKit] VO2max method not available on this library version");
    return null;
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  return new Promise((resolve) => {
    try {
      AppleHealthKit[methodName](
        {
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
          ascending: false,
          limit: 1,
        },
        (error: string, results: any[]) => {
          if (error || !results?.length) {
            console.log("[HealthKit] VO2max error:", error);
            resolve(null);
            return;
          }
          const r = results[0];
          resolve({
            value: Math.round(r.value * 10) / 10,
            date: r.startDate?.split("T")[0] || "",
          });
        }
      );
    } catch (e) {
      console.log("[HealthKit] VO2max call failed:", e);
      resolve(null);
    }
  });
}
