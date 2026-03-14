import * as Crypto from 'expo-crypto';
import { getDatabase } from '../db/client';
import { BriefingType } from '../types';

export function generateContextHash(data: Record<string, any>): string {
  const str = JSON.stringify(data, Object.keys(data).sort());
  // Simple hash: use first 16 chars of UUID seeded by content
  // Since expo-crypto doesn't have a hash function, use a basic string hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function getCachedBriefing(type: BriefingType, date: string, contextHash: string): string | null {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<any>(
      'SELECT content FROM ai_briefing_cache WHERE type = ? AND date = ? AND context_hash = ?',
      type, date, contextHash
    );
    return row?.content ?? null;
  } catch {
    return null;
  }
}

export function setCachedBriefing(type: BriefingType, date: string, contextHash: string, content: string): void {
  try {
    const db = getDatabase();
    const id = Crypto.randomUUID();
    db.runSync(
      `INSERT OR REPLACE INTO ai_briefing_cache (id, type, date, context_hash, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id, type, date, contextHash, content, new Date().toISOString()
    );
  } catch {
    // Cache write failure is non-critical
  }
}
