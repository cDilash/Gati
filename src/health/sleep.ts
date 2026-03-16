import { getHealthKit } from "./availability";

export interface SleepStages {
  deepMinutes: number;
  lightMinutes: number; // "Core" in Apple Health
  remMinutes: number;
  awakeMinutes: number;
}

export interface SleepResult {
  totalMinutes: number;
  date: string; // the night of (YYYY-MM-DD)
  bedStart: string; // ISO timestamp
  bedEnd: string; // ISO timestamp
  stages: SleepStages | null; // null if device doesn't provide stages
}

// Apple Health sleep category values
const STAGE_MAP: Record<string, string> = {
  'INBED': 'inbed',
  'ASLEEP': 'asleep',
  'AWAKE': 'awake',
  'CORE': 'light',
  'DEEP': 'deep',
  'REM': 'rem',
};

const NUMERIC_STAGE_MAP: Record<number, string> = {
  0: 'inbed',
  1: 'asleep',
  2: 'awake',
  3: 'light',
  4: 'deep',
  5: 'rem',
};

export async function getSleepData(daysBack: number = 14): Promise<SleepResult[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    AppleHealthKit.getSleepSamples(
      {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        ascending: false,
        limit: daysBack * 20,
      },
      (error: string, results: any[]) => {
        if (error) {
          console.log("[HealthKit] Sleep error:", error);
          resolve([]);
          return;
        }
        console.log("[HealthKit] Sleep raw count:", results?.length ?? 0);

        // Log unique sample values for debugging
        if (results?.length > 0) {
          const uniqueValues = [...new Set(results.map(r => String(r.value)))];
          console.log("[HealthKit] Sleep sample values:", uniqueValues.join(', '));
        }

        // Group samples by "night" — the night is determined by the START time.
        // For overnight sleep (e.g., 10PM → 6AM), the night date is the evening date.
        // Key insight: use the date of the START, but if start is after midnight (0-12),
        // it's still part of the previous night.
        interface NightData {
          inbedMin: number;
          asleepMin: number;
          deepMin: number;
          lightMin: number;
          remMin: number;
          awakeMin: number;
          start: string;
          end: string;
        }

        const nightMap = new Map<string, NightData>();

        for (const sample of results || []) {
          if (!sample.startDate || !sample.endDate) continue;

          const startMs = new Date(sample.startDate).getTime();
          const endMs = new Date(sample.endDate).getTime();
          const durationMin = (endMs - startMs) / 60000;
          if (durationMin <= 0 || durationMin > 1440) continue; // skip invalid (>24 hrs)

          // Resolve the stage type
          const sleepValue = sample.value;
          let stage: string | undefined;
          if (typeof sleepValue === 'string') {
            stage = STAGE_MAP[sleepValue.toUpperCase()];
          } else if (typeof sleepValue === 'number') {
            stage = NUMERIC_STAGE_MAP[sleepValue];
          }
          if (!stage) continue;

          // Determine "night date" — if the sample starts between midnight and noon,
          // it belongs to the PREVIOUS day's night (e.g., waking up at 6AM on Mar 16
          // is part of the Mar 15 night).
          const startDt = new Date(sample.startDate);
          let nightDate: string;
          if (startDt.getHours() < 12) {
            // Before noon — belongs to previous day's night
            const prev = new Date(startDt);
            prev.setDate(prev.getDate() - 1);
            nightDate = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
          } else {
            nightDate = sample.startDate.split("T")[0];
          }

          const existing = nightMap.get(nightDate);
          if (existing) {
            if (sample.startDate < existing.start) existing.start = sample.startDate;
            if (sample.endDate > existing.end) existing.end = sample.endDate;

            switch (stage) {
              case 'inbed': existing.inbedMin += durationMin; break;
              case 'asleep': existing.asleepMin += durationMin; break;
              case 'deep': existing.deepMin += durationMin; break;
              case 'light': existing.lightMin += durationMin; break;
              case 'rem': existing.remMin += durationMin; break;
              case 'awake': existing.awakeMin += durationMin; break;
            }
          } else {
            const data: NightData = {
              inbedMin: 0, asleepMin: 0, deepMin: 0, lightMin: 0, remMin: 0, awakeMin: 0,
              start: sample.startDate, end: sample.endDate,
            };
            switch (stage) {
              case 'inbed': data.inbedMin = durationMin; break;
              case 'asleep': data.asleepMin = durationMin; break;
              case 'deep': data.deepMin = durationMin; break;
              case 'light': data.lightMin = durationMin; break;
              case 'rem': data.remMin = durationMin; break;
              case 'awake': data.awakeMin = durationMin; break;
            }
            nightMap.set(nightDate, data);
          }
        }

        // Convert night data to SleepResult
        const mapped: SleepResult[] = [];
        nightMap.forEach((val, date) => {
          const hasStages = val.deepMin > 0 || val.lightMin > 0 || val.remMin > 0;

          // Calculate total sleep time:
          // Priority 1: If we have stage data (deep + light + REM), use that sum
          // Priority 2: If we have generic ASLEEP, use that
          // Priority 3: If we only have INBED, use that (minus awake if available)
          let totalSleepMin: number;
          if (hasStages) {
            totalSleepMin = val.deepMin + val.lightMin + val.remMin;
          } else if (val.asleepMin > 0) {
            totalSleepMin = val.asleepMin;
          } else {
            totalSleepMin = Math.max(0, val.inbedMin - val.awakeMin);
          }

          // Sanity check: sleep shouldn't exceed 16 hours
          if (totalSleepMin > 960) {
            console.log(`[HealthKit] Sleep ${date}: ${(totalSleepMin / 60).toFixed(1)}hrs seems too high, capping at 16hrs. inbed=${(val.inbedMin/60).toFixed(1)} asleep=${(val.asleepMin/60).toFixed(1)} deep=${(val.deepMin/60).toFixed(1)} light=${(val.lightMin/60).toFixed(1)} rem=${(val.remMin/60).toFixed(1)}`);
            totalSleepMin = Math.min(totalSleepMin, 960);
          }

          if (totalSleepMin <= 0) return; // skip nights with no sleep data

          mapped.push({
            totalMinutes: Math.round(totalSleepMin),
            date,
            bedStart: val.start,
            bedEnd: val.end,
            stages: hasStages ? {
              deepMinutes: Math.round(val.deepMin),
              lightMinutes: Math.round(val.lightMin),
              remMinutes: Math.round(val.remMin),
              awakeMinutes: Math.round(val.awakeMin),
            } : null,
          });
        });

        mapped.sort((a, b) => b.date.localeCompare(a.date));
        resolve(mapped);
      }
    );
  });
}
