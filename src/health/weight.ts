import { getHealthKit } from "./availability";

export interface WeightResult {
  value: number; // kg
  date: string;  // YYYY-MM-DD
}

export async function getWeight(): Promise<WeightResult | null> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return null;

  if (typeof AppleHealthKit.getLatestWeight !== 'function') {
    console.log("[HealthKit] Weight method not available");
    return null;
  }

  return new Promise((resolve) => {
    try {
      AppleHealthKit.getLatestWeight(
        { unit: 'kg' },
        (error: string, result: any) => {
          // TurboModule proxy may pass result as first arg (single object, not array)
          if (error && typeof error === 'object' && error !== null && 'value' in error) {
            result = error;
            error = '' as any;
          }
          if (error || !result) {
            if (error) console.log("[HealthKit] Weight error:", error);
            resolve(null);
            return;
          }
          resolve({
            value: Math.round(result.value * 10) / 10,
            date: result.startDate?.split("T")[0] || result.endDate?.split("T")[0] || "",
          });
        }
      );
    } catch (e) {
      console.log("[HealthKit] Weight call failed:", e);
      resolve(null);
    }
  });
}
