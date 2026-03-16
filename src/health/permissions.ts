import { getHealthKit, getHealthKitConstants } from "./availability";

export async function requestHealthKitPermissions(): Promise<boolean> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) {
    console.log("[HealthKit] Not available");
    return false;
  }

  const Constants = getHealthKitConstants();
  if (!Constants?.Permissions) {
    console.log("[HealthKit] Constants not available");
    return false;
  }

  // The ONLY permissions we request — all READ, zero WRITE
  const permissions = {
    permissions: {
      read: [
        Constants.Permissions.RestingHeartRate,
        Constants.Permissions.HeartRateVariability,
        Constants.Permissions.SleepAnalysis,
      ],
      write: [] as any[],
    },
  };

  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(permissions, (error: string) => {
      if (error) {
        console.log("[HealthKit] Permission error:", error);
        resolve(false);
        return;
      }
      console.log("[HealthKit] Permissions granted");
      resolve(true);
    });
  });
}
