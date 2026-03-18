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
  isLikelyIncomplete: boolean;
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

// ─── Interval merging to prevent overlap double-counting ─────

interface TimeInterval {
  startMs: number;
  endMs: number;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: TimeInterval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].startMs <= last.endMs) {
      // Overlapping — extend the end
      last.endMs = Math.max(last.endMs, sorted[i].endMs);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

function totalMinutesFromIntervals(intervals: TimeInterval[]): number {
  const merged = mergeIntervals(intervals);
  return merged.reduce((sum, iv) => sum + (iv.endMs - iv.startMs) / 60000, 0);
}

// ─── Main fetch function ─────────────────────────────────────

export async function getSleepData(daysBack: number = 14): Promise<SleepResult[]> {
  const AppleHealthKit = getHealthKit();
  if (!AppleHealthKit) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return new Promise((resolve) => {
    try {
    AppleHealthKit.getSleepSamples(
      {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        ascending: false,
        limit: daysBack * 20,
      },
      (error: string, results: any[]) => {
        // TurboModule proxy may pass results as first arg
        const data = Array.isArray(error) ? error : (results || []);
        if (error && !Array.isArray(error)) {
          console.log("[HealthKit] Sleep error:", error);
          resolve([]);
          return;
        }
        console.log("[HealthKit] Sleep raw count:", data?.length ?? 0);
        // Reassign for downstream code
        results = data;

        if (results?.length > 0) {
          const uniqueValues = [...new Set(results.map(r => String(r.value)))];
          console.log("[HealthKit] Sleep sample values:", uniqueValues.join(', '));
        }

        // Track raw intervals per night per stage type
        interface NightIntervals {
          inbed: TimeInterval[];
          asleep: TimeInterval[];
          deep: TimeInterval[];
          light: TimeInterval[];
          rem: TimeInterval[];
          awake: TimeInterval[];
          earliestStart: string;
          latestEnd: string;
        }

        const nightMap = new Map<string, NightIntervals>();

        for (const sample of results || []) {
          if (!sample.startDate || !sample.endDate) continue;

          const startMs = new Date(sample.startDate).getTime();
          const endMs = new Date(sample.endDate).getTime();
          if (endMs <= startMs || (endMs - startMs) > 86400000) continue; // skip invalid

          const sleepValue = sample.value;
          let stage: string | undefined;
          if (typeof sleepValue === 'string') {
            stage = STAGE_MAP[sleepValue.toUpperCase()];
          } else if (typeof sleepValue === 'number') {
            stage = NUMERIC_STAGE_MAP[sleepValue];
          }
          if (!stage) continue;

          // Night date: before noon → previous day
          const startDt = new Date(sample.startDate);
          let nightDate: string;
          if (startDt.getHours() < 12) {
            const prev = new Date(startDt);
            prev.setDate(prev.getDate() - 1);
            nightDate = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
          } else {
            nightDate = sample.startDate.split("T")[0];
          }

          const interval: TimeInterval = { startMs, endMs };

          let existing = nightMap.get(nightDate);
          if (!existing) {
            existing = {
              inbed: [], asleep: [], deep: [], light: [], rem: [], awake: [],
              earliestStart: sample.startDate,
              latestEnd: sample.endDate,
            };
            nightMap.set(nightDate, existing);
          }

          if (sample.startDate < existing.earliestStart) existing.earliestStart = sample.startDate;
          if (sample.endDate > existing.latestEnd) existing.latestEnd = sample.endDate;

          // Push interval to the correct bucket
          switch (stage) {
            case 'inbed': existing.inbed.push(interval); break;
            case 'asleep': existing.asleep.push(interval); break;
            case 'deep': existing.deep.push(interval); break;
            case 'light': existing.light.push(interval); break;
            case 'rem': existing.rem.push(interval); break;
            case 'awake': existing.awake.push(interval); break;
          }
        }

        // Convert to SleepResult with merged intervals
        const mapped: SleepResult[] = [];
        nightMap.forEach((val, date) => {
          const deepMin = totalMinutesFromIntervals(val.deep);
          const lightMin = totalMinutesFromIntervals(val.light);
          const remMin = totalMinutesFromIntervals(val.rem);
          const awakeMin = totalMinutesFromIntervals(val.awake);
          const asleepMin = totalMinutesFromIntervals(val.asleep);
          const inbedMin = totalMinutesFromIntervals(val.inbed);

          const hasStages = deepMin > 0 || lightMin > 0 || remMin > 0;

          // Priority: stages > asleep > inbed-awake
          let totalSleepMin: number;
          if (hasStages) {
            totalSleepMin = deepMin + lightMin + remMin;
          } else if (asleepMin > 0) {
            totalSleepMin = asleepMin;
          } else {
            totalSleepMin = Math.max(0, inbedMin - awakeMin);
          }

          // Hard cap at 14 hours (even merged, >14 is suspicious)
          if (totalSleepMin > 840) {
            console.log(`[HealthKit] Sleep ${date}: ${(totalSleepMin / 60).toFixed(1)}hrs after merge, capping at 14hrs. inbed=${(inbedMin/60).toFixed(1)} asleep=${(asleepMin/60).toFixed(1)} deep=${(deepMin/60).toFixed(1)} light=${(lightMin/60).toFixed(1)} rem=${(remMin/60).toFixed(1)}`);
            totalSleepMin = 840;
          }

          if (totalSleepMin <= 0) return;

          // Flag potentially incomplete: < 3 hours AND few stage blocks
          const stageBlockCount = [val.deep.length, val.light.length, val.rem.length, val.awake.length].filter(n => n > 0).length;
          const isLikelyIncomplete = totalSleepMin > 0 && totalSleepMin < 180 && stageBlockCount <= 1;

          mapped.push({
            totalMinutes: Math.round(totalSleepMin),
            date,
            bedStart: val.earliestStart,
            bedEnd: val.latestEnd,
            stages: hasStages ? {
              deepMinutes: Math.round(deepMin),
              lightMinutes: Math.round(lightMin),
              remMinutes: Math.round(remMin),
              awakeMinutes: Math.round(awakeMin),
            } : null,
            isLikelyIncomplete,
          });
        });

        mapped.sort((a, b) => b.date.localeCompare(a.date));
        resolve(mapped);
      }
    );
    } catch (e) {
      console.log("[HealthKit] Sleep call failed:", e);
      resolve([]);
    }
  });
}
