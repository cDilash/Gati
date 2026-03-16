/**
 * Gemini API client — dual-model routing with retry and fallback.
 *
 * Two models routed by task complexity:
 * - heavy (gemini-3.1-pro-preview): plan generation, adaptation, weekly digest
 * - fast (gemini-3-flash-preview): chat, briefings, analysis
 *
 * Retry with exponential backoff on 429/5xx.
 * Heavy model falls back to fast on failure.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';

const API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export type ModelTier = 'heavy' | 'fast';

const MODELS: Record<ModelTier, string> = {
  heavy: 'gemini-3.1-pro-preview',
  fast: 'gemini-3-flash-preview',
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;

// ─── Core API ───────────────────────────────────────────────

/**
 * Send a single-turn structured message (system + user) and get text back.
 */
export async function sendStructuredMessage(
  systemInstruction: string,
  userMessage: string,
  tier: ModelTier = 'fast',
): Promise<string> {
  if (!API_KEY) throw new Error('Gemini API key not configured');

  const modelName = MODELS[tier];
  console.log(`[Gemini:${tier}] Structured message → ${modelName}`);

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  try {
    const result = await withRetry(() =>
      model.generateContent(userMessage)
    );
    return result.response.text();
  } catch (error: any) {
    // Fallback: if heavy model fails, try fast
    if (tier === 'heavy') {
      console.log(`[Gemini:heavy] Failed (${error.message}), falling back to fast model`);
      const fallbackModel = genAI.getGenerativeModel({
        model: MODELS.fast,
        systemInstruction,
      });
      const result = await withRetry(() =>
        fallbackModel.generateContent(userMessage)
      );
      return result.response.text();
    }
    throw error;
  }
}

/**
 * Send a multi-turn chat message with conversation history.
 */
export async function sendChatMessage(
  systemInstruction: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  tier: ModelTier = 'fast',
): Promise<string> {
  if (!API_KEY) throw new Error('Gemini API key not configured');

  const modelName = MODELS[tier];
  console.log(`[Gemini:${tier}] Chat message → ${modelName}`);

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  // Convert to Gemini format (uses 'model' not 'assistant')
  const geminiHistory = history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history: geminiHistory });

  try {
    const result = await withRetry(() =>
      chat.sendMessage(userMessage)
    );
    return result.response.text();
  } catch (error: any) {
    if (tier === 'heavy') {
      console.log(`[Gemini:heavy] Chat failed (${error.message}), falling back to fast model`);
      const fallbackModel = genAI.getGenerativeModel({
        model: MODELS.fast,
        systemInstruction,
      });
      const fallbackChat = fallbackModel.startChat({ history: geminiHistory });
      const result = await withRetry(() =>
        fallbackChat.sendMessage(userMessage)
      );
      return result.response.text();
    }
    throw error;
  }
}

// ─── JSON Extraction ────────────────────────────────────────

/**
 * Extract JSON from a Gemini response that may contain markdown fences,
 * explanatory text, or other wrapping.
 */
export function extractJSON(text: string): any {
  // Strategy 1: Look for ```json ... ``` blocks
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1]);
  }

  // Strategy 2: Look for ``` ... ``` blocks (no json tag)
  const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]);
  }

  // Strategy 3: Try parsing the whole response as JSON
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  return JSON.parse(trimmed);
}

// ─── Retry Logic ────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status || error?.code;
      const message = error?.message || '';
      const isRateLimit = status === 429 || message.includes('429');
      const isServerError = status >= 500;
      const isRetryable = isRateLimit || isServerError;

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), 30000);
        const jitter = Math.random() * 500;
        console.log(`[Gemini] Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay + jitter)}ms (${isRateLimit ? '429' : status})`);
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Gemini: max retries exceeded');
}

// ─── Utilities ──────────────────────────────────────────────

export function isGeminiAvailable(): boolean {
  return !!API_KEY && API_KEY !== 'YOUR_GEMINI_API_KEY';
}
