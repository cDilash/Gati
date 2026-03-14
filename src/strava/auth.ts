import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { Alert, AppState } from 'react-native';
import { StravaTokens } from '../types';

const CLIENT_ID = Constants.expoConfig?.extra?.stravaClientId || '';
const CLIENT_SECRET = Constants.expoConfig?.extra?.stravaClientSecret || '';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';

// ─── SQLite helpers (direct access, same pattern as rateLimiter) ───

function getDb() {
  const SQLite = require('expo-sqlite');
  return SQLite.openDatabaseSync('marathon_coach.db');
}

// ─── Token Storage ─────────────────────────────────────────

export function getStoredTokens(): StravaTokens | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT access_token, refresh_token, expires_at, athlete_id, athlete_name FROM strava_tokens WHERE id = 1'
    ) as any;
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      athleteId: row.athlete_id,
      athleteName: row.athlete_name,
    };
  } catch {
    return null;
  }
}

function storeTokens(tokens: StravaTokens): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO strava_tokens (id, access_token, refresh_token, expires_at, athlete_id, athlete_name, connected_at)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresAt,
    tokens.athleteId,
    tokens.athleteName,
  );
}

function updateTokensOnly(accessToken: string, refreshToken: string, expiresAt: number): void {
  const db = getDb();
  db.runSync(
    'UPDATE strava_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 1',
    accessToken,
    refreshToken,
    expiresAt,
  );
}

function deleteTokens(): void {
  const db = getDb();
  db.runSync('DELETE FROM strava_tokens WHERE id = 1');
}

// ─── Connection Status ─────────────────────────────────────

export function isStravaConnected(): boolean {
  return getStoredTokens() !== null;
}

/** Returns the last sync time as an ISO string, or null if never synced. */
export function getLastSyncTime(): string | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT last_sync_at FROM strava_tokens WHERE id = 1'
    ) as { last_sync_at: string | null } | null;
    return row?.last_sync_at ?? null;
  } catch {
    return null;
  }
}

// ─── Token Refresh ─────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
} | null> {
  try {
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Returns a valid access token, refreshing if expired.
 * This is the main entry point for all Strava API calls.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);

  // Token is still valid (with 60s buffer)
  if (tokens.expiresAt > now + 60) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  if (!refreshed) {
    // Refresh failed — don't delete tokens, just return null.
    // Will retry next time.
    return null;
  }

  // Save the new tokens
  updateTokensOnly(refreshed.access_token, refreshed.refresh_token, refreshed.expires_at);
  return refreshed.access_token;
}

// ─── OAuth2 Authorization Flow ─────────────────────────────

/**
 * Extracts Strava auth code from a URL string.
 * Handles both full URLs and partial/malformed inputs.
 */
function extractCodeFromUrl(input: string): string | null {
  const trimmed = input.trim();
  // Try URL parsing first
  try {
    const url = new URL(trimmed);
    return url.searchParams.get('code');
  } catch {
    // Fallback: regex extraction for partial URLs
    const match = trimmed.match(/[?&]code=([^&\s]+)/);
    return match ? match[1] : null;
  }
}

/**
 * Initiates the Strava OAuth2 flow.
 *
 * Because Strava only accepts http/https redirect URIs and iOS cannot
 * intercept http://localhost redirects, we use a manual-paste flow:
 *
 * 1. Open Strava auth in Safari
 * 2. User authorizes → Strava redirects to http://localhost/...?code=XXX
 * 3. Safari shows "cannot connect" but the URL bar contains the code
 * 4. User returns to app → prompted to paste the URL
 * 5. App extracts the code and exchanges it for tokens
 */
export async function connectStrava(): Promise<StravaTokens | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('Strava client credentials not configured');
    return null;
  }

  const redirectUri = 'http://localhost/oauth/callback';

  const authUrl =
    `${STRAVA_AUTH_URL}?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=read,activity:read_all` +
    `&approval_prompt=auto`;

  console.log('[Strava] Opening auth URL in Safari');

  // Open in Safari (not in-app browser — gives user access to URL bar)
  await Linking.openURL(authUrl);

  // Wait for user to return to the app, then prompt for the URL
  return new Promise<StravaTokens | null>((resolve) => {
    let resolved = false;

    const handleAppState = (state: string) => {
      if (state !== 'active' || resolved) return;
      resolved = true;
      subscription.remove();

      // Small delay to let the app fully foreground
      setTimeout(() => {
        Alert.prompt(
          'Paste Strava URL',
          'After authorizing on Strava, Safari showed "cannot connect".\n\n' +
          'Tap Safari\'s address bar, copy the full URL, then paste it here.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
            {
              text: 'Connect',
              onPress: async (pastedUrl?: string) => {
                if (!pastedUrl) { resolve(null); return; }
                const code = extractCodeFromUrl(pastedUrl);
                if (code) {
                  console.log('[Strava] Got code from pasted URL');
                  const tokens = await exchangeCodeForTokens(code);
                  resolve(tokens);
                } else {
                  Alert.alert('Invalid URL', 'Could not find an authorization code in that URL. Make sure you copied the full URL from Safari.');
                  resolve(null);
                }
              },
            },
          ],
          'plain-text',
          '',
          'url',
        );
      }, 500);
    };

    const subscription = AppState.addEventListener('change', handleAppState);
  });
}

async function exchangeCodeForTokens(code: string): Promise<StravaTokens | null> {
  try {
    const tokenResponse = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.warn('[Strava] Token exchange failed:', tokenResponse.status);
      return null;
    }

    const data = await tokenResponse.json();

    const tokens: StravaTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      athleteId: data.athlete?.id ?? 0,
      athleteName: data.athlete?.firstname
        ? `${data.athlete.firstname} ${data.athlete.lastname || ''}`.trim()
        : null,
    };

    storeTokens(tokens);
    return tokens;
  } catch {
    return null;
  }
}

// ─── Disconnect ────────────────────────────────────────────

/**
 * Revokes Strava access and deletes local tokens.
 * Per Strava API guidelines, we call deauthorize endpoint.
 */
export async function disconnectStrava(): Promise<void> {
  const tokens = getStoredTokens();

  if (tokens) {
    // Best-effort deauthorization — don't block on failure
    try {
      await fetch(STRAVA_DEAUTH_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Strava might be down — still delete local tokens
    }
  }

  deleteTokens();
}
