import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Alert } from 'react-native';
import { StravaTokens } from '../types';

const CLIENT_ID = Constants.expoConfig?.extra?.stravaClientId || '';
const CLIENT_SECRET = Constants.expoConfig?.extra?.stravaClientSecret || '';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';

// ─── SQLite helpers ───

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase();
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
    console.log('[Strava] Refreshing access token...');
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

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`[Strava] Token refresh FAILED: ${response.status} — ${body.slice(0, 200)}`);
      return null;
    }
    const data = await response.json();
    console.log(`[Strava] Token refreshed OK — expires ${new Date(data.expires_at * 1000).toISOString()}`);
    return data;
  } catch (e: any) {
    console.log('[Strava] Token refresh error:', e.message);
    return null;
  }
}

/**
 * Returns a valid access token, refreshing if expired.
 * This is the main entry point for all Strava API calls.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens) {
    console.log('[Strava] No stored tokens — not connected');
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expired = tokens.expiresAt <= now + 60;
  console.log(`[Strava] Token expires: ${new Date(tokens.expiresAt * 1000).toISOString()} (${expired ? 'EXPIRED' : 'valid'})`);

  // Token is still valid (with 60s buffer)
  if (!expired) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  if (!refreshed) {
    // Refresh token is invalid — auto-disconnect so user knows to reconnect
    console.log('[Strava] Token refresh failed — disconnecting (refresh token invalid)');
    try { deleteTokens(); } catch {}
    return null;
  }

  // Save the new tokens
  updateTokensOnly(refreshed.access_token, refreshed.refresh_token, refreshed.expires_at);
  console.log('[Strava] New token saved to SQLite');
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
 * Initiates the Strava OAuth2 flow via Supabase redirect.
 *
 * Flow:
 * 1. Open browser → Strava auth page
 * 2. User authorizes → Strava redirects to Supabase Edge Function
 * 3. Edge Function redirects to marathon-coach://strava-callback?code=XXX
 * 4. App intercepts deep link → extracts code → exchanges for tokens
 * 5. Done — seamless, no copy-paste
 */
export async function connectStrava(): Promise<StravaTokens | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('Strava client credentials not configured');
    return null;
  }

  const redirectUri = 'https://dweimilkuzasrxscjgag.supabase.co/functions/v1/strava-callback';
  const appScheme = 'marathon-coach://strava-callback';

  const authUrl =
    `${STRAVA_AUTH_URL}?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=read,activity:read_all` +
    `&approval_prompt=auto`;

  console.log('[Strava] Opening auth via Supabase redirect...');

  return new Promise<StravaTokens | null>(async (resolve) => {
    let resolved = false;

    // Listen for the deep link callback
    const handleUrl = async (event: { url: string }) => {
      if (resolved) return;
      try {
        const url = event.url;
        if (!url.includes('strava-callback')) return;

        const code = extractCodeFromUrl(url);
        if (code) {
          resolved = true;
          subscription.remove();
          try { await WebBrowser.dismissBrowser(); } catch {}

          console.log('[Strava] Got auth code from deep link, exchanging...');
          const tokens = await exchangeCodeForTokens(code);
          resolve(tokens);
        }
      } catch (e: any) {
        console.error('[Strava] Deep link handler error:', e.message);
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    // Check if app was opened with a URL already (cold start edge case)
    try {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl?.includes('strava-callback')) {
        handleUrl({ url: initialUrl });
        return;
      }
    } catch {}

    // Open the browser
    try {
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'cancel',
        presentationStyle: (WebBrowser as any).WebBrowserPresentationStyle?.FULL_SCREEN,
      });
    } catch (e: any) {
      // openBrowserAsync throws if user dismisses — that's OK
      console.log('[Strava] Browser closed:', e.message);
    }

    // If browser closed without a callback after 2s, user cancelled
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.remove();
        console.log('[Strava] Auth timed out or cancelled');
        resolve(null);
      }
    }, 2000);
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
