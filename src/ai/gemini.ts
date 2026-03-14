import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';
import { CoachMessage, TrainingContext, PlanMutation } from '../types';
import { buildCoachSystemPrompt, CoachPromptOptions } from './coachPrompt';
import { UnitSystem } from '../utils/units';
import { getStravaDetailForWorkout } from '../db/client';
import { canMakeAPICall, incrementAPICallCount } from './rateLimiter';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error?.status === 429 && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function sendCoachMessage(
  conversationHistory: CoachMessage[],
  context: TrainingContext,
  units: UnitSystem = 'imperial',
  shoesSummary?: string,
): Promise<{ response: string; mutation?: PlanMutation }> {
  if (!canMakeAPICall()) {
    return { response: "I've reached my daily limit for coaching responses. Please try again tomorrow, or check the pre-workout briefing card for today's guidance." };
  }

  incrementAPICallCount();

  // Gather Strava split data for recent completed workouts
  const stravaDetails: CoachPromptOptions['stravaDetails'] = [];
  const recentCompleted = (context.thisWeekWorkouts || [])
    .filter(w => w.status === 'completed' && w.workout_type !== 'rest')
    .slice(0, 5);
  for (const w of recentCompleted) {
    try {
      const detail = getStravaDetailForWorkout(w.id);
      if (detail?.splits?.length) {
        stravaDetails.push({
          workoutDate: w.date,
          workoutType: w.workout_type,
          splits: detail.splits,
          elevationGainFt: detail.elevation_gain_ft,
          cadenceAvg: detail.cadence_avg,
          sufferScore: detail.suffer_score,
        });
      }
    } catch {
      // Strava detail not available for this workout
    }
  }

  const systemPrompt = buildCoachSystemPrompt(context, { units, stravaDetails, shoesSummary });

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  });

  const chatHistory = conversationHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: msg.content }],
  }));

  // The last message in history is the new user message
  const lastMessage = chatHistory.pop();
  if (!lastMessage) throw new Error('No message to send');

  const chat = model.startChat({
    history: chatHistory,
  });

  const result = await withRetry(() => chat.sendMessage(lastMessage.parts[0].text));
  const responseText = result.response.text();

  // Try to parse plan mutation from response
  const mutation = parsePlanMutation(responseText);

  return { response: responseText, mutation };
}

function parsePlanMutation(responseText: string): PlanMutation | undefined {
  try {
    // Look for JSON block in response
    const jsonMatch = responseText.match(/```json\s*(\{[\s\S]*?"mutation"[\s\S]*?\})\s*```/);
    if (!jsonMatch) return undefined;

    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.mutation && parsed.mutation.type && parsed.mutation.description) {
      return {
        type: parsed.mutation.type,
        affected_workout_ids: parsed.mutation.affected_workout_ids || [],
        description: parsed.mutation.description,
        changes: parsed.mutation.changes,
      };
    }
  } catch {
    // Malformed JSON — ignore and return text-only response
  }
  return undefined;
}
