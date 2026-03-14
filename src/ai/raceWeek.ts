import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import { UserProfile, PaceZones, WeatherData } from '../types';
import { formatPace } from '../engine/vdot';
import { generateContextHash, getCachedBriefing, setCachedBriefing } from './cacheHelper';
import { canMakeAPICall, incrementAPICallCount } from './rateLimiter';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export interface PacingPlan {
  strategy: string;
  splits: { mile: number; targetPace: string; note: string }[];
  fuelingPlan: string[];
}

export interface RaceWeekBriefing {
  dayLabel: string;
  briefing: string;
  checklist: string[] | null;
  pacingPlan: PacingPlan | null;
}

const FALLBACK: RaceWeekBriefing = {
  dayLabel: 'Race Week',
  briefing: 'Unable to generate race week briefing',
  checklist: null,
  pacingPlan: null,
};

function getSystemPrompt(daysUntilRace: number): string {
  const base = `You are a marathon running coach. The athlete's race is in ${daysUntilRace} day(s). Respond ONLY in valid JSON (no markdown, no code fences) matching this structure:
{"dayLabel":"string","briefing":"string","checklist":["string"] or null,"pacingPlan":{"strategy":"string","splits":[{"mile":1,"targetPace":"M:SS","note":"string"}],"fuelingPlan":["string"]} or null}`;

  if (daysUntilRace >= 4) {
    return `${base}

Focus on:
- Taper psychology — trust the training, reduced volume is by design
- Sleep hygiene and nutrition basics
- Easy shakeout runs only (if any)
- No new gear, no new foods, no experiments
- checklist: null for days 7-4
- pacingPlan: null for days 7-4
- briefing: 2-3 specific sentences referencing their training stats`;
  }

  if (daysUntilRace >= 2) {
    return `${base}

Focus on:
- Logistics: race bib pickup, gear layout, nutrition prep
- 2-3 mile shakeout run with strides (if scheduled)
- Carb loading strategy (increase carbs to 8-10g/kg)
- Race morning routine planning
- checklist: 5-8 specific items for race prep
- pacingPlan: null for days 3-2
- briefing: 2-3 specific sentences`;
  }

  if (daysUntilRace === 1) {
    return `${base}

This is RACE EVE. Focus on:
- Generate a FULL pacing plan with mile-by-mile splits based on the athlete's VDOT/marathon pace zone
- Include pacing strategy: negative split (first half conservative, second half faster)
- Include fueling plan: when to take gels/water
- checklist: 5-8 items for race morning (lay out clothes, charge watch, set alarm, etc.)
- Miles 1-5: 10-15 sec/mi slower than goal pace (settling in)
- Miles 6-13: goal marathon pace
- Miles 14-20: goal pace or slightly faster if feeling good
- Miles 21-26.2: effort-based, push if energy allows
- pacingPlan MUST have splits for all 26 miles + 0.2
- briefing: 2-3 sentences about race eve relaxation and confidence`;
  }

  // Race day (daysUntilRace === 0)
  return `${base}

This is RACE DAY. Keep it simple and focused:
- briefing: 2-3 clean, confident sentences. Reference their pace and trust their training. This is their moment.
- checklist: null (too late for checklists)
- pacingPlan: null (they should already have their plan)
- Do NOT overthink. Do NOT add last-minute advice. Keep it calm.`;
}

function buildUserMessage(
  daysUntilRace: number,
  profile: UserProfile,
  paceZones: PaceZones,
  trainingStats: { totalMilesLogged: number; longestRun: number; weeksTrained: number },
  weather: WeatherData | null,
): string {
  const lines: string[] = [];

  lines.push(`Race: ${profile.race_distance} in ${daysUntilRace} day(s)`);
  lines.push(`VDOT: ${profile.vdot.toFixed(1)}`);
  lines.push(`Marathon pace zone: ${formatPace(paceZones.M.max)}-${formatPace(paceZones.M.min)}/mi`);
  lines.push(`Goal time: ${profile.goal_marathon_time_seconds ? formatPace(Math.round(profile.goal_marathon_time_seconds / 26.2)) + '/mi avg' : 'based on VDOT'}`);
  lines.push(`Training: ${trainingStats.weeksTrained} weeks, ${trainingStats.totalMilesLogged.toFixed(0)} total miles, longest run ${trainingStats.longestRun.toFixed(1)} mi`);

  if (weather) {
    lines.push(`Race day weather: ${weather.temp}°F, ${weather.humidity}% humidity, ${weather.condition}`);
    if (weather.temp > 75) lines.push('WARNING: Hot conditions — consider slowing pace 10-20 sec/mi');
    if (weather.humidity > 80) lines.push('WARNING: High humidity — hydration critical');
  }

  return lines.join('\n');
}

export async function generateRaceWeekBriefing(
  daysUntilRace: number,
  userProfile: UserProfile,
  paceZones: PaceZones,
  trainingStats: { totalMilesLogged: number; longestRun: number; weeksTrained: number },
  weather: WeatherData | null,
): Promise<RaceWeekBriefing> {
  const contextHash = generateContextHash({
    daysUntilRace,
    vdot: userProfile.vdot,
    weatherTemp: weather?.temp ?? null,
  });

  const cacheKey = `race-day-${daysUntilRace}`;
  const cached = getCachedBriefing('race_week', cacheKey, contextHash);
  if (cached) {
    try {
      return JSON.parse(cached) as RaceWeekBriefing;
    } catch {
      // Corrupted cache — regenerate
    }
  }

  if (!canMakeAPICall()) return FALLBACK;

  try {
    incrementAPICallCount();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: getSystemPrompt(daysUntilRace),
    });

    const userMessage = buildUserMessage(daysUntilRace, userProfile, paceZones, trainingStats, weather);
    const result = await model.generateContent(userMessage);
    let text = result.response.text().trim();

    // Strip markdown code fences
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const briefing = JSON.parse(text) as RaceWeekBriefing;

    if (!briefing.dayLabel || !briefing.briefing) {
      return FALLBACK;
    }

    setCachedBriefing('race_week', cacheKey, contextHash, JSON.stringify(briefing));
    return briefing;
  } catch {
    return FALLBACK;
  }
}
