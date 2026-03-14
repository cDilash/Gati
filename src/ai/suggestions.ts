import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import { TrainingWeek, Workout, PaceZones } from '../types';
import { formatPace } from '../engine/vdot';
import { generateContextHash, getCachedBriefing, setCachedBriefing } from './cacheHelper';
import { canMakeAPICall, incrementAPICallCount } from './rateLimiter';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

// Session-level rate limit: max 3 suggestion calls per app open
let sessionSuggestionCount = 0;
const MAX_SESSION_SUGGESTIONS = 3;

export type SuggestionContext = 'plan_week' | 'zones_update' | 'rest_day';

export async function generateContextualSuggestion(
  context: SuggestionContext,
  data: Record<string, any>,
): Promise<string | null> {
  // Session rate limit
  if (sessionSuggestionCount >= MAX_SESSION_SUGGESTIONS) return null;

  // Daily rate limit
  if (!canMakeAPICall()) return null;

  const contextHash = generateContextHash({ context, ...data });
  const cached = getCachedBriefing('suggestion', context, contextHash);
  if (cached) return cached;

  try {
    sessionSuggestionCount++;
    incrementAPICallCount();

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `You are a concise marathon running coach. Respond with exactly 1-2 sentences of specific, actionable insight. No greetings, no fluff. If there's nothing insightful to say, respond with exactly "null".`,
    });

    let prompt = '';

    switch (context) {
      case 'plan_week':
        prompt = buildPlanWeekPrompt(data);
        break;
      case 'zones_update':
        prompt = buildZonesUpdatePrompt(data);
        break;
      case 'rest_day':
        prompt = buildRestDayPrompt(data);
        break;
    }

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (text === 'null' || text.length < 10) return null;

    setCachedBriefing('suggestion', context, contextHash, text);
    return text;
  } catch {
    return null;
  }
}

function buildPlanWeekPrompt(data: Record<string, any>): string {
  const lines = [
    `The athlete is viewing Week ${data.weekNumber} of their training plan.`,
    `Phase: ${data.phase}${data.isCutback ? ' (cutback week)' : ''}`,
    `Target volume: ${data.targetVolume?.toFixed(1)} miles`,
    `Current week: ${data.currentWeekNumber}`,
  ];
  if (data.workoutTypes) {
    lines.push(`Workouts this week: ${data.workoutTypes}`);
  }
  lines.push('Give a brief, specific insight about what to focus on during this week of training.');
  return lines.join('\n');
}

function buildZonesUpdatePrompt(data: Record<string, any>): string {
  return [
    `The athlete's VDOT just updated from ${data.previousVDOT?.toFixed(1)} to ${data.newVDOT?.toFixed(1)}.`,
    `Marathon pace zone changed from ${data.oldMarathonPace || 'unknown'} to ${data.newMarathonPace || 'unknown'}/mi.`,
    `Explain in plain language what this VDOT change means for their training and race pace.`,
  ].join('\n');
}

function buildRestDayPrompt(data: Record<string, any>): string {
  const lines = [
    `Today is a rest day.`,
    `Week ${data.weekNumber}, ${data.phase} phase.`,
  ];
  if (data.yesterdayWorkout) {
    lines.push(`Yesterday: ${data.yesterdayWorkout}`);
  }
  if (data.tomorrowWorkout) {
    lines.push(`Tomorrow: ${data.tomorrowWorkout}`);
  }
  if (data.weeklyVolume) {
    lines.push(`Weekly volume so far: ${data.weeklyVolume} miles`);
  }
  lines.push('Give a brief rest-day-specific coaching tip based on their current training context.');
  return lines.join('\n');
}
