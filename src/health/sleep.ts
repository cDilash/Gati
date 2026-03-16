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
// react-native-health reports these as string values
const STAGE_MAP: Record<string, keyof SleepStages | 'skip'> = {
  'INBED': 'skip',       // total in-bed time, not a stage
  'ASLEEP': 'skip',      // generic asleep (used when no stage data)
  'AWAKE': 'awakeMinutes',
  'CORE': 'lightMinutes', // Apple calls light sleep "Core"
  'DEEP': 'deepMinutes',
  'REM': 'remMinutes',
};

// Numeric values (some library versions use numbers)
const NUMERIC_STAGE_MAP: Record<number, keyof SleepStages | 'skip'> = {
  0: 'skip',              // InBed
  1: 'skip',              // Asleep (generic)
  2: 'awakeMinutes',      // Awake
  3: 'lightMinutes',      // Core/Light
  4: 'deepMinutes',       // Deep
  5: 'remMinutes',        // REM
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
        limit: daysBack * 20, // more samples to capture all stages
      },
      (error: string, results: any[]) => {
        if (error) {
          console.log("[HealthKit] Sleep error:", error);
          resolve([]);
          return;
        }
        console.log("[HealthKit] Sleep raw count:", results?.length ?? 0);

        // Log first few samples to understand the data shape
        if (results?.length > 0) {
          console.log("[HealthKit] Sleep sample values:",
            [...new Set((results || []).map(r => r.value))].join(', ')
          );
        }

        interface NightData {
          totalMin: number;
          start: string;
          end: string;
          stages: SleepStages;
          hasStageData: boolean;
        }

        const nightMap = new Map<string, NightData>();

        for (const sample of results || []) {
          // Use the start date to determine the night
          // For overnight sleep, use the date of when they went to bed
          const nightDate = sample.startDate?.split("T")[0] || "";
          if (!nightDate) continue;

          const startMs = new Date(sample.startDate).getTime();
          const endMs = new Date(sample.endDate).getTime();
          const durationMin = (endMs - startMs) / 60000;
          if (durationMin <= 0) continue;

          const sleepValue = sample.value;

          // Resolve stage from string or numeric value
          let stageKey: keyof SleepStages | 'skip' | undefined;
          if (typeof sleepValue === 'string') {
            stageKey = STAGE_MAP[sleepValue.toUpperCase()];
          } else if (typeof sleepValue === 'number') {
            stageKey = NUMERIC_STAGE_MAP[sleepValue];
          }

          // Skip unrecognized values
          if (!stageKey) continue;

          const isAwake = stageKey === 'awakeMinutes';
          const isSleepStage = stageKey !== 'skip' && !isAwake; // CORE, DEEP, REM

          const existing = nightMap.get(nightDate);
          if (existing) {
            // Always track bed start/end from earliest start to latest end
            if (sample.startDate < existing.start) existing.start = sample.startDate;
            if (sample.endDate > existing.end) existing.end = sample.endDate;

            if (stageKey === 'skip') {
              // Generic ASLEEP/INBED — only add to total if we DON'T have stage data
              // (to avoid double-counting when both generic + stages exist)
              if (!existing.hasStageData) {
                existing.totalMin += durationMin;
              }
            } else if (isAwake) {
              // Awake — track in stages but NOT in sleep total
              existing.stages.awakeMinutes += durationMin;
              existing.hasStageData = true;
            } else {
              // Real sleep stage (CORE/DEEP/REM) — add to stages AND total
              existing.stages[stageKey] += durationMin;
              existing.totalMin += durationMin;
              existing.hasStageData = true;
            }
          } else {
            const stages: SleepStages = { deepMinutes: 0, lightMinutes: 0, remMinutes: 0, awakeMinutes: 0 };
            let hasStageData = false;
            let totalMin = 0;

            if (stageKey === 'skip') {
              totalMin = durationMin;
            } else if (isAwake) {
              stages.awakeMinutes = durationMin;
              hasStageData = true;
            } else {
              stages[stageKey] = durationMin;
              totalMin = durationMin;
              hasStageData = true;
            }

            nightMap.set(nightDate, {
              totalMin,
              start: sample.startDate,
              end: sample.endDate,
              stages,
              hasStageData,
            });
          }
        }

        const mapped: SleepResult[] = [];
        nightMap.forEach((val, date) => {
          // totalMin already excludes awake time (only real sleep stages or generic ASLEEP)
          mapped.push({
            totalMinutes: Math.round(val.totalMin),
            date,
            bedStart: val.start,
            bedEnd: val.end,
            stages: val.hasStageData ? {
              deepMinutes: Math.round(val.stages.deepMinutes),
              lightMinutes: Math.round(val.stages.lightMinutes),
              remMinutes: Math.round(val.stages.remMinutes),
              awakeMinutes: Math.round(val.stages.awakeMinutes),
            } : null,
          });
        });

        mapped.sort((a, b) => b.date.localeCompare(a.date));
        resolve(mapped);
      }
    );
  });
}
