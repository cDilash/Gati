/**
 * AI API call rate limiter.
 * Tracks daily Gemini API call count in SQLite to stay within free tier limits.
 * Safety cap: 50 calls/day (typical usage ~16).
 */

const DAILY_CAP = 50;

function getDb() {
  const SQLite = require('expo-sqlite');
  return SQLite.openDatabaseSync('marathon_coach.db');
}

function ensureTable() {
  try {
    const db = getDb();
    db.runSync(
      `CREATE TABLE IF NOT EXISTS ai_usage (
        date TEXT PRIMARY KEY,
        call_count INTEGER DEFAULT 0
      )`
    );
  } catch {
    // Table may already exist
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

let tableEnsured = false;

export function canMakeAPICall(): boolean {
  try {
    if (!tableEnsured) {
      ensureTable();
      tableEnsured = true;
    }
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT call_count FROM ai_usage WHERE date = ?',
      todayKey()
    ) as { call_count: number } | null;
    return (row?.call_count ?? 0) < DAILY_CAP;
  } catch {
    // If we can't check, allow the call (fail open for UX)
    return true;
  }
}

export function incrementAPICallCount(): void {
  try {
    if (!tableEnsured) {
      ensureTable();
      tableEnsured = true;
    }
    const db = getDb();
    db.runSync(
      `INSERT INTO ai_usage (date, call_count) VALUES (?, 1)
       ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1`,
      todayKey()
    );
  } catch {
    // Non-critical — don't break the app over usage tracking
  }
}

export function getDailyCallCount(): number {
  try {
    if (!tableEnsured) {
      ensureTable();
      tableEnsured = true;
    }
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT call_count FROM ai_usage WHERE date = ?',
      todayKey()
    ) as { call_count: number } | null;
    return row?.call_count ?? 0;
  } catch {
    return 0;
  }
}
