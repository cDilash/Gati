/**
 * Supabase Edge Function: garmin-sync
 *
 * Replaces the Python garmin_fetch.py script.
 * Fetches health data from Garmin Connect API and upserts to garmin_health table.
 * Runs every 15 minutes via pg_cron.
 *
 * Auth flow:
 *   1. Read OAuth1 + OAuth2 tokens from garmin_auth table
 *   2. If OAuth2 expired → OAuth1 exchange → new OAuth2 → save back
 *   3. Bearer token for all Garmin API calls
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ─────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USER_ID = Deno.env.get("GARMIN_USER_ID") || "fb78e3b6-178e-4574-bfbd-50a65f1424b4";

const GARMIN_API_BASE = "https://connectapi.garmin.com";
const GARMIN_USER_AGENT = "com.garmin.android.apps.connectmobile";
const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const OAUTH_EXCHANGE_PATH = "/oauth-service/oauth/exchange/user/2.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Timezone-aware date helper ─────────────────────────────────
// Edge Function runs in UTC — convert to user's local date (America/Los_Angeles)
function getLocalDate(offsetDays: number = 0): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  local.setDate(local.getDate() + offsetDays);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

// ─── OAuth1 Signing ─────────────────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  oauthToken: string,
  oauthTokenSecret: string,
  extraParams: Record<string, string> = {}
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: oauthToken,
    oauth_version: "1.0",
  };

  // Combine oauth params + body params for signature base
  const allParams = { ...oauthParams, ...extraParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(oauthTokenSecret)}`;

  const signature = await hmacSha1(signingKey, signatureBase);
  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ─── Token Management ───────────────────────────────────────────

interface GarminTokens {
  oauth1_token: string;
  oauth1_token_secret: string;
  mfa_token: string | null;
  domain: string;
  oauth2_access_token: string;
  oauth2_refresh_token: string;
  oauth2_expires_at: number;
  oauth2_refresh_token_expires_at: number;
  oauth2_scope: string | null;
  oauth2_jti: string | null;
  oauth2_token_type: string;
}

async function loadTokens(): Promise<GarminTokens> {
  const { data, error } = await supabase
    .from("garmin_auth")
    .select("*")
    .eq("id", "default")
    .single();

  if (error || !data) {
    throw new Error(`Failed to load Garmin tokens: ${error?.message || "no data"}`);
  }

  return data as GarminTokens;
}

async function refreshOAuth2(tokens: GarminTokens): Promise<GarminTokens> {
  console.log("OAuth2 token expired, refreshing via OAuth1 exchange...");

  // Fetch consumer credentials
  const consumerResp = await fetch(OAUTH_CONSUMER_URL);
  if (!consumerResp.ok) {
    throw new Error(`Failed to fetch OAuth consumer: ${consumerResp.status}`);
  }
  const consumer = await consumerResp.json();
  const consumerKey = consumer.consumer_key;
  const consumerSecret = consumer.consumer_secret;

  const exchangeUrl = `${GARMIN_API_BASE}${OAUTH_EXCHANGE_PATH}`;

  // Build body params (mfa_token if available)
  const bodyParams: Record<string, string> = {};
  if (tokens.mfa_token) {
    bodyParams["mfa_token"] = tokens.mfa_token;
  }

  const authHeader = await buildOAuth1Header(
    "POST",
    exchangeUrl,
    consumerKey,
    consumerSecret,
    tokens.oauth1_token,
    tokens.oauth1_token_secret,
    bodyParams
  );

  const body = tokens.mfa_token
    ? `mfa_token=${encodeURIComponent(tokens.mfa_token)}`
    : "";

  const resp = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": GARMIN_USER_AGENT,
    },
    body: body || undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth2 refresh failed (${resp.status}): ${text}`);
  }

  const newToken = await resp.json();
  const now = Math.floor(Date.now() / 1000);

  const updatedTokens: GarminTokens = {
    ...tokens,
    oauth2_access_token: newToken.access_token,
    oauth2_refresh_token: newToken.refresh_token,
    oauth2_expires_at: now + (newToken.expires_in || 3600),
    oauth2_refresh_token_expires_at: now + (newToken.refresh_token_expires_in || 7776000),
    oauth2_scope: newToken.scope || tokens.oauth2_scope,
    oauth2_jti: newToken.jti || tokens.oauth2_jti,
  };

  // Save refreshed tokens back to DB
  const { error } = await supabase.from("garmin_auth").upsert({
    id: "default",
    ...updatedTokens,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Failed to save refreshed tokens:", error.message);
  } else {
    console.log("OAuth2 token refreshed and saved.");
  }

  return updatedTokens;
}

async function getValidTokens(): Promise<GarminTokens> {
  let tokens = await loadTokens();
  const now = Math.floor(Date.now() / 1000);

  if (tokens.oauth2_expires_at < now) {
    tokens = await refreshOAuth2(tokens);
  }

  return tokens;
}

// ─── Garmin API Client ──────────────────────────────────────────

let _displayName: string | null = null;

async function garminGet(
  tokens: GarminTokens,
  path: string,
  params?: Record<string, string>
): Promise<any> {
  let url = `${GARMIN_API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.oauth2_access_token}`,
      "User-Agent": GARMIN_USER_AGENT,
    },
  });

  if (resp.status === 204) return null;
  if (resp.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!resp.ok) {
    throw new Error(`Garmin API ${resp.status}: ${await resp.text()}`);
  }

  return resp.json();
}

async function getDisplayName(tokens: GarminTokens): Promise<string> {
  if (_displayName) return _displayName;
  try {
    const profile = await garminGet(tokens, "/userprofile-service/socialProfile");
    _displayName = profile?.displayName || "";
  } catch {
    _displayName = "";
  }
  return _displayName!;
}

// ─── Data Fetchers (mirror garmin_fetch.py) ─────────────────────

async function fetchEndpoint(
  tokens: GarminTokens,
  name: string,
  path: string,
  params?: Record<string, string>
): Promise<any> {
  try {
    return await garminGet(tokens, path, params);
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.error(`  x ${name}: ${e.message}`);
    return null;
  }
}

// ─── Race Predictions — try multiple Garmin endpoints ────────

interface RacePredResult {
  predicted5k: number | null;
  predicted10k: number | null;
  predictedHalf: number | null;
  predictedMarathon: number | null;
}

function parseRacePredArray(preds: any[]): RacePredResult {
  const result: RacePredResult = { predicted5k: null, predicted10k: null, predictedHalf: null, predictedMarathon: null };
  for (const pred of preds) {
    const distObj = pred.raceDistance;
    const dist = typeof distObj === "object" ? (distObj?.key ?? distObj?.label ?? "") : String(distObj ?? "");
    const distLower = dist.toLowerCase();
    const timeSec = pred.racePredictionInSeconds ?? pred.predictedTime ?? pred.predictionInSeconds;
    if (!timeSec) continue;
    const t = Math.round(Number(timeSec));
    if (t <= 0 || t > 100000) continue; // sanity check

    const distMeters = pred.raceDistanceInMeters ?? pred.distance ?? null;

    if (distMeters) {
      // Match by distance in meters (most reliable)
      if (distMeters >= 4900 && distMeters <= 5200) result.predicted5k = t;
      else if (distMeters >= 9800 && distMeters <= 10400) result.predicted10k = t;
      else if (distMeters >= 21000 && distMeters <= 21300) result.predictedHalf = t;
      else if (distMeters >= 42000 && distMeters <= 42400) result.predictedMarathon = t;
    } else {
      // Fall back to string matching
      if ((distLower.includes("5") && !distLower.includes("10") && !distLower.includes("half")) || dist === "5000") {
        result.predicted5k = t;
      } else if ((distLower.includes("10") && !distLower.includes("half")) || dist === "10000") {
        result.predicted10k = t;
      } else if (distLower.includes("half") || dist.includes("21") || dist === "21097") {
        result.predictedHalf = t;
      } else if (distLower.includes("marathon") || dist.includes("42") || dist === "42195") {
        result.predictedMarathon = t;
      }
    }
  }
  return result;
}

async function fetchRacePredictions(tokens: GarminTokens): Promise<RacePredResult> {
  const result: RacePredResult = { predicted5k: null, predicted10k: null, predictedHalf: null, predictedMarathon: null };

  // Endpoint 1: /metrics-service/metrics/racepredictions
  try {
    const resp = await garminGet(tokens, "/metrics-service/metrics/racepredictions");
    console.log(`  [RacePred] Endpoint 1 response: ${JSON.stringify(resp)?.substring(0, 500)}`);
    if (resp) {
      const preds = Array.isArray(resp) ? resp : (resp.racePredictions ?? resp.predictions ?? []);
      if (Array.isArray(preds) && preds.length > 0) {
        const parsed = parseRacePredArray(preds);
        if (parsed.predicted5k) return parsed;
      }
    }
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.log(`  [RacePred] Endpoint 1 failed: ${e.message}`);
  }

  // Endpoint 2: /fitnessstats-service/activity
  try {
    const resp = await garminGet(tokens, "/fitnessstats-service/activity");
    console.log(`  [RacePred] Endpoint 2 response: ${JSON.stringify(resp)?.substring(0, 500)}`);
    if (resp?.racePredictions && Array.isArray(resp.racePredictions)) {
      const parsed = parseRacePredArray(resp.racePredictions);
      if (parsed.predicted5k) return parsed;
    }
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.log(`  [RacePred] Endpoint 2 failed: ${e.message}`);
  }

  // Endpoint 3: /metrics-service/metrics/maxmet/racepredictions
  try {
    const resp = await garminGet(tokens, "/metrics-service/metrics/maxmet/racepredictions");
    console.log(`  [RacePred] Endpoint 3 response: ${JSON.stringify(resp)?.substring(0, 500)}`);
    if (resp) {
      const preds = Array.isArray(resp) ? resp : (resp.racePredictions ?? resp.predictions ?? []);
      if (Array.isArray(preds) && preds.length > 0) {
        const parsed = parseRacePredArray(preds);
        if (parsed.predicted5k) return parsed;
      }
    }
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.log(`  [RacePred] Endpoint 3 failed: ${e.message}`);
  }

  // Endpoint 4: Check VO2max response for embedded predictions
  try {
    const today = getLocalDate();
    const resp = await garminGet(tokens, `/metrics-service/metrics/maxmet/latest/${today}`);
    if (resp?.generic?.racePredictions && Array.isArray(resp.generic.racePredictions)) {
      console.log(`  [RacePred] Found in VO2max response: ${JSON.stringify(resp.generic.racePredictions).substring(0, 300)}`);
      const parsed = parseRacePredArray(resp.generic.racePredictions);
      if (parsed.predicted5k) return parsed;
    }
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
  }

  console.log("  [RacePred] No race predictions found from any endpoint");
  return result;
}

async function fetchAllHealthData(
  tokens: GarminTokens,
  dateStr: string
): Promise<Record<string, any>> {
  console.log(`\nFetching data for ${dateStr}...`);

  const displayName = await getDisplayName(tokens);

  // Fetch all endpoints in parallel for speed
  // BLOCKED endpoints removed (confirmed 404/405 on 2026-03-25):
  // - Race Predictions: /metrics-service/metrics/racepredictions (all 3 variants)
  // - Lactate Threshold: /metrics-service/metrics/lactatethreshold (404), /biometric-service (405)
  // - Fitness Age: /fitnessstats-service/fitnessAge (404)
  // These are watch-computed via Firstbeat and not exposed through REST API.

  const [hrv, daily, bb, readiness, training, sleep, stress, resp, spo2, vo2, endurance, hillScore, weightData] =
    await Promise.all([
      fetchEndpoint(tokens, "HRV", `/hrv-service/hrv/${dateStr}`),
      fetchEndpoint(tokens, "Daily", `/usersummary-service/usersummary/daily/${displayName}`, { calendarDate: dateStr }),
      fetchEndpoint(tokens, "BodyBattery", "/wellness-service/wellness/bodyBattery/reports/daily", { startDate: dateStr, endDate: dateStr }),
      fetchEndpoint(tokens, "Readiness", `/metrics-service/metrics/trainingreadiness/${dateStr}`),
      fetchEndpoint(tokens, "TrainingStatus", `/metrics-service/metrics/trainingstatus/aggregated/${dateStr}`),
      fetchEndpoint(tokens, "Sleep", `/wellness-service/wellness/dailySleepData/${displayName}`, { date: dateStr, nonSleepBufferMinutes: "60" }),
      fetchEndpoint(tokens, "Stress", `/wellness-service/wellness/dailyStress/${dateStr}`),
      fetchEndpoint(tokens, "Respiration", `/wellness-service/wellness/daily/respiration/${dateStr}`),
      fetchEndpoint(tokens, "SpO2", `/wellness-service/wellness/daily/spo2/${dateStr}`),
      fetchEndpoint(tokens, "VO2max", `/metrics-service/metrics/maxmet/latest/${dateStr}`),
      fetchEndpoint(tokens, "Endurance", "/metrics-service/metrics/endurancescore"),
      fetchEndpoint(tokens, "HillScore", "/metrics-service/metrics/hillscore"),
      fetchEndpoint(tokens, "Weight", `/weight-service/weight/dateRange`, { startDate: dateStr, endDate: dateStr }),
    ]);

  // ─── Parse HRV ───
  const hrvSummary = hrv?.hrvSummary || {};
  const hrvBaseline = hrvSummary?.baseline || {};

  // ─── Parse Daily Summary ───
  const d = daily || {};

  // ─── Parse Body Battery ───
  let bbMorning = null, bbHigh = null, bbLow = null, bbCharged = null, bbDrained = null;
  if (Array.isArray(bb) && bb.length > 0) {
    const entry = bb[0];
    bbCharged = entry?.charged ?? null;
    bbDrained = entry?.drained ?? null;
    const valsArr = entry?.bodyBatteryValuesArray || [];
    if (valsArr.length > 0) {
      const values = valsArr
        .filter((v: any) => Array.isArray(v) && v.length >= 2 && v[1] != null)
        .map((v: any) => v[1]);
      if (values.length > 0) {
        bbHigh = Math.max(...values);
        bbLow = Math.min(...values);
        bbMorning = values.length <= 3 ? values[values.length - 1] : Math.max(...values.slice(0, 4));
      }
    }
  }

  // ─── Parse Training Readiness ───
  let trScore = null, readinessFeedbackShort = null, readinessFeedbackLong = null, recoveryTimeHours = null;
  const readinessEntry = Array.isArray(readiness) ? readiness[0] : readiness;
  if (readinessEntry) {
    trScore = readinessEntry.score ?? null;
    readinessFeedbackShort = readinessEntry.feedbackShort ?? null;
    readinessFeedbackLong = readinessEntry.feedbackLong ?? null;
    const recoveryMin = readinessEntry.recoveryTime;
    if (recoveryMin != null && typeof recoveryMin === "number") {
      recoveryTimeHours = Math.round((recoveryMin / 60) * 10) / 10;
    }
  }

  // ─── Parse Training Status ───
  let trainingStatusText = null, trainingLoad7day = null, acwrValue = null, acwrStatus = null;
  const tsData = training?.mostRecentTrainingStatus?.latestTrainingStatusData;
  if (tsData && typeof tsData === "object") {
    const statusMap: Record<number, string> = {
      0: "No Status", 1: "Detraining", 2: "Recovery", 3: "Unproductive",
      4: "Maintaining", 5: "Productive", 6: "Peaking", 7: "Overreaching",
    };
    for (const deviceId of Object.keys(tsData)) {
      const data = tsData[deviceId];
      trainingStatusText = statusMap[data?.trainingStatus] || `Unknown (${data?.trainingStatus})`;
      const acwrDto = data?.acuteTrainingLoadDTO || {};
      trainingLoad7day = acwrDto.dailyTrainingLoadAcute ?? null;
      acwrValue = acwrDto.dailyAcuteChronicWorkloadRatio ?? null;
      acwrStatus = acwrDto.acwrStatus ?? null;
      break; // Use primary device
    }
  }

  // ─── Parse VO2max ───
  const generic = vo2?.generic || {};
  const vo2maxRunning = generic.vo2MaxPreciseValue ?? generic.vo2MaxValue ?? null;
  const vo2maxFitnessAge = generic.fitnessAge ?? null;

  // ─── Parse Sleep ───
  const sleepDto = sleep?.dailySleepDTO || {};
  let respiratoryRate = sleepDto.averageRespirationValue ?? null;
  let spo2Avg = sleepDto.averageSpO2Value ?? null;
  const sleepScores = sleepDto.sleepScores || {};
  const sleepScore = sleepScores.overall?.value ?? null;
  const sleepSubscores: Record<string, number> = {};
  for (const key of ["totalDuration", "stress", "awakeCount", "remPercentage", "restlessness", "lightPercentage", "deepPercentage", "quality"]) {
    const sub = sleepScores[key];
    if (sub?.value != null) {
      sleepSubscores[key] = sub.value;
    }
  }

  // Sleep duration + stages (actual seconds from Garmin)
  const sleepDurationSec = sleepDto.sleepTimeSeconds ?? null;
  const sleepDeepSec = sleepDto.deepSleepSeconds ?? null;
  const sleepLightSec = sleepDto.lightSleepSeconds ?? null;
  const sleepRemSec = sleepDto.remSleepSeconds ?? null;
  const sleepAwakeSec = sleepDto.awakeSleepSeconds ?? null;
  const sleepStart = sleepDto.sleepStartTimestampLocal ?? null;
  const sleepEnd = sleepDto.sleepEndTimestampLocal ?? null;

  // Sleep need/debt
  let sleepNeedMinutes = null, sleepDebtMinutes = null;
  const sleepNeedObj = sleepDto.sleepNeed || {};
  const baseline = sleepNeedObj.baseline;
  if (baseline != null && typeof baseline === "number") {
    sleepNeedMinutes = baseline > 1000 ? Math.round(baseline / 60000) : Math.round(baseline);
    if (sleepDurationSec && sleepNeedMinutes) {
      const actualMin = Math.round(sleepDurationSec / 60);
      sleepDebtMinutes = Math.max(0, sleepNeedMinutes - actualMin);
    }
  }

  // Skin temp
  let skinTempDev = sleepDto.averageSkinTempDeviationC ?? sleepDto.avgSkinTempDeviationC ?? null;
  if (skinTempDev != null) skinTempDev = Math.round(skinTempDev * 10) / 10;

  const minSpo2 = sleepDto.lowestSpO2Value ?? sleepDto.lowestSpo2 ?? null;
  const sleepAwakeCount = sleepDto.awakeCount ?? null;
  const avgSleepStress = sleepDto.avgSleepStress ?? null;

  // ─── Parse Endurance Score ───
  let enduranceScore = null, enduranceClassification = null;
  if (endurance && typeof endurance === "object" && !Array.isArray(endurance)) {
    enduranceScore = endurance.overallScore ?? endurance.enduranceScore ?? null;
    enduranceClassification = endurance.enduranceClassification ?? endurance.classification ?? null;
  } else if (Array.isArray(endurance) && endurance.length > 0) {
    enduranceScore = endurance[0].overallScore ?? endurance[0].enduranceScore ?? null;
    enduranceClassification = endurance[0].enduranceClassification ?? null;
  }

  // ─── Parse Hill Score ───
  let hillScoreVal = null, hillEndurance = null, hillStrength = null;
  if (hillScore && typeof hillScore === "object" && !Array.isArray(hillScore)) {
    hillScoreVal = hillScore.overallScore ?? hillScore.hillScore ?? null;
    hillEndurance = hillScore.enduranceScore ?? null;
    hillStrength = hillScore.strengthScore ?? null;
  } else if (Array.isArray(hillScore) && hillScore.length > 0) {
    hillScoreVal = hillScore[0].overallScore ?? null;
    hillEndurance = hillScore[0].enduranceScore ?? null;
    hillStrength = hillScore[0].strengthScore ?? null;
  }

  // ─── Lactate Threshold — BLOCKED by Garmin API (confirmed 2026-03-25) ───
  const lactateThresholdHr = null;
  const lactateThresholdSpeed = null;

  // ─── Parse Weight / Body Composition (Garmin Index Scale) ───
  let weightKg = null, bodyFatPct = null, muscleMassKg = null, boneMassKg = null, bodyWaterPct = null, bmiVal = null;
  if (weightData?.dateWeightList && Array.isArray(weightData.dateWeightList) && weightData.dateWeightList.length > 0) {
    const w = weightData.dateWeightList[0];
    weightKg = w.weight != null ? Math.round((w.weight / 1000) * 10) / 10 : null; // grams → kg
    bodyFatPct = w.bodyFat ?? null;
    muscleMassKg = w.muscleMass != null ? Math.round((w.muscleMass / 1000) * 10) / 10 : null;
    boneMassKg = w.boneMass != null ? Math.round((w.boneMass / 1000) * 10) / 10 : null;
    bodyWaterPct = w.bodyWater ?? null;
    bmiVal = w.bmi != null ? Math.round(w.bmi * 10) / 10 : null;
    if (weightKg) console.log(`  Weight: ${weightKg}kg, Fat: ${bodyFatPct}%, Muscle: ${muscleMassKg}kg, BMI: ${bmiVal}`);
  }

  // ─── SpO2 fallback ───
  if (!spo2Avg && spo2) {
    spo2Avg = spo2.averageSPO2 ?? spo2.averageSpO2 ?? null;
  }

  // ─── Respiration fallback ───
  if (!respiratoryRate && resp) {
    respiratoryRate = resp.avgSleepRespiration ?? resp.avgWakingRespiration ?? null;
  }

  // ─── Race Predictions — BLOCKED by Garmin API (confirmed 2026-03-25) ───
  // App uses VDOT fallback from Garmin PRs instead
  const predicted5k = null, predicted10k = null, predictedHalf = null, predictedMarathon = null;

  // ─── Build row ───
  const floorsClimbed = d.floorsAscended != null ? Math.round(d.floorsAscended) : null;

  const row: Record<string, any> = {
    date: dateStr,
    user_id: USER_ID,
    // HRV
    hrv_last_night_avg: hrvSummary.lastNightAvg ?? null,
    hrv_weekly_avg: hrvSummary.weeklyAvg ?? null,
    hrv_baseline_low: hrvBaseline.balancedLow ?? hrvBaseline.lowUpper ?? null,
    hrv_baseline_high: hrvBaseline.balancedUpper ?? null,
    hrv_status: hrvSummary.status ?? null,
    hrv_5min_high: hrvSummary.lastNight5MinHigh ?? null,
    hrv_feedback: hrvSummary.feedbackPhrase ?? null,
    // VO2max
    vo2max: vo2maxRunning,
    vo2max_fitness_age: vo2maxFitnessAge,
    // Body Battery
    body_battery_morning: bbMorning,
    body_battery_high: bbHigh,
    body_battery_low: bbLow,
    body_battery_charged: bbCharged,
    body_battery_drained: bbDrained,
    bb_at_wake: d.bodyBatteryAtWakeTime ?? null,
    // Stress
    stress_avg: d.averageStressLevel ?? null,
    stress_high: d.maxStressLevel ?? null,
    stress_qualifier: d.stressQualifier ?? null,
    // Vitals
    respiratory_rate: respiratoryRate,
    spo2_avg: spo2Avg,
    min_spo2: minSpo2,
    resting_hr: d.restingHeartRate ?? null,
    max_hr_daily: d.maxHeartRate ?? null,
    min_hr_daily: d.minHeartRate ?? null,
    rhr_7day_avg: d.lastSevenDaysAvgRestingHeartRate ?? null,
    // Training
    training_readiness: trScore,
    readiness_feedback_short: readinessFeedbackShort,
    readiness_feedback_long: readinessFeedbackLong,
    recovery_time_hours: recoveryTimeHours,
    training_status: trainingStatusText,
    training_load_7day: trainingLoad7day,
    acwr: acwrValue,
    acwr_status: acwrStatus,
    // Sleep
    sleep_score: sleepScore,
    sleep_subscores_json: Object.keys(sleepSubscores).length > 0 ? JSON.stringify(sleepSubscores) : null,
    sleep_need_minutes: sleepNeedMinutes,
    sleep_debt_minutes: sleepDebtMinutes,
    sleep_awake_count: sleepAwakeCount,
    avg_sleep_stress: avgSleepStress,
    sleep_duration_sec: sleepDurationSec,
    sleep_deep_sec: sleepDeepSec,
    sleep_light_sec: sleepLightSec,
    sleep_rem_sec: sleepRemSec,
    sleep_awake_sec: sleepAwakeSec,
    sleep_start: sleepStart,
    sleep_end: sleepEnd,
    // Skin temp
    skin_temp_deviation_c: skinTempDev,
    // Intensity
    intensity_minutes_vigorous: d.vigorousIntensityMinutes ?? null,
    intensity_minutes_moderate: d.moderateIntensityMinutes ?? null,
    floors_climbed: floorsClimbed,
    // Endurance
    endurance_score: enduranceScore,
    endurance_classification: enduranceClassification,
    // Hill
    hill_score: hillScoreVal,
    hill_endurance: hillEndurance,
    hill_strength: hillStrength,
    // Lactate threshold
    lactate_threshold_hr: lactateThresholdHr,
    lactate_threshold_speed: lactateThresholdSpeed,
    // Weight / Body Composition
    weight_kg: weightKg,
    body_fat_pct: bodyFatPct,
    muscle_mass_kg: muscleMassKg,
    bone_mass_kg: boneMassKg,
    body_water_pct: bodyWaterPct,
    bmi: bmiVal,
    // Race predictions
    predicted_5k_sec: predicted5k,
    predicted_10k_sec: predicted10k,
    predicted_half_sec: predictedHalf,
    predicted_marathon_sec: predictedMarathon,
    // Meta
    fetched_at: new Date().toISOString(),
  };

  // Remove null values to avoid overwriting existing data
  const cleanRow: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined) {
      cleanRow[k] = v;
    }
  }

  const fieldCount = Object.keys(cleanRow).length - 3; // subtract date, user_id, fetched_at
  console.log(`  Got ${fieldCount} fields for ${dateStr}`);

  return cleanRow;
}

// ─── Per-Activity Data ──────────────────────────────────────────

async function fetchActivityData(
  tokens: GarminTokens,
  daysBack: number
): Promise<number> {
  console.log("\nFetching per-activity data...");

  try {
    const activities = await garminGet(tokens, "/activitylist-service/activities/search/activities", {
      start: "0",
      limit: String(Math.min(daysBack * 2, 20)),
    });

    if (!Array.isArray(activities)) return 0;

    const runningActivities = activities.filter(
      (a: any) => a?.activityType?.typeKey === "running"
    );
    console.log(`  Found ${runningActivities.length} running activities`);

    let count = 0;
    for (const act of runningActivities) {
      const actId = act.activityId;
      if (!actId) continue;

      try {
        const detail = await fetchEndpoint(tokens, `Activity ${actId}`, `/activity-service/activity/${actId}`);
        if (!detail?.summaryDTO) continue;
        const summary = detail.summaryDTO;

        const startLocal = summary.startTimeLocal || "";
        const actDate = startLocal.includes("T") ? startLocal.split("T")[0] : "";

        const row: Record<string, any> = {
          user_id: USER_ID,
          activity_date: actDate,
          garmin_activity_id: String(actId),
          aerobic_training_effect: summary.trainingEffect != null ? Math.round(summary.trainingEffect * 10) / 10 : null,
          aerobic_te_message: summary.aerobicTrainingEffectMessage ?? null,
          anaerobic_training_effect: summary.anaerobicTrainingEffect != null ? Math.round(summary.anaerobicTrainingEffect * 10) / 10 : null,
          anaerobic_te_message: summary.anaerobicTrainingEffectMessage ?? null,
          stamina_start: summary.beginPotentialStamina != null ? Math.round(summary.beginPotentialStamina) : null,
          stamina_end: (summary.endPotentialStamina ?? summary.minAvailableStamina) != null ? Math.round(summary.endPotentialStamina ?? summary.minAvailableStamina) : null,
          activity_training_load: summary.activityTrainingLoad != null ? Math.round(summary.activityTrainingLoad * 10) / 10 : null,
          temperature_avg_c: summary.averageTemperature != null ? Math.round(summary.averageTemperature * 10) / 10 : null,
          grade_adjusted_speed: summary.avgGradeAdjustedSpeed != null ? Math.round(summary.avgGradeAdjustedSpeed * 10000) / 10000 : null,
          ground_contact_time_ms: summary.groundContactTime != null ? Math.round(summary.groundContactTime * 10) / 10 : null,
          vertical_oscillation_cm: summary.verticalOscillation != null ? Math.round(summary.verticalOscillation * 10) / 10 : null,
          stride_length_cm: summary.strideLength != null ? Math.round(summary.strideLength * 10) / 10 : null,
          vertical_ratio: summary.verticalRatio != null ? Math.round(summary.verticalRatio * 100) / 100 : null,
          avg_power_watts: summary.averagePower != null ? Math.round(summary.averagePower) : null,
          max_power_watts: summary.maxPower != null ? Math.round(summary.maxPower) : null,
          normalized_power_watts: summary.normalizedPower != null ? Math.round(summary.normalizedPower) : null,
          performance_condition: detail.performanceCondition ?? summary.performanceCondition ?? null,
          fetched_at: new Date().toISOString(),
        };

        // Remove nulls
        const cleanRow: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined) {
            cleanRow[k] = v;
          }
        }

        const { error } = await supabase
          .from("garmin_activity_data")
          .upsert(cleanRow, { onConflict: "user_id,garmin_activity_id" });

        if (error) {
          console.error(`  x Activity upsert failed: ${error.message}`);
        } else {
          count++;
          const te = cleanRow.aerobic_training_effect || "?";
          const load = cleanRow.activity_training_load || "?";
          console.log(`  Activity ${actDate}: TE ${te}, Load ${load}`);
        }
      } catch (e: any) {
        if (e.message === "AUTH_EXPIRED") throw e;
        console.error(`  x Activity ${actId}: ${e.message}`);
      }
    }

    return count;
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.error(`  x Activity fetch failed: ${e.message}`);
    return 0;
  }
}

// ─── Personal Records ───────────────────────────────────────────

const PR_TYPE_MAP: Record<number, string> = {
  1: '1K', 2: '1 Mile', 3: '5K', 4: '10K', 5: 'Half Marathon',
  6: 'Marathon', 7: 'Longest Run',
};

async function fetchPersonalRecords(tokens: GarminTokens): Promise<number> {
  console.log("\nFetching personal records...");
  try {
    const displayName = await getDisplayName(tokens);
    const records = await garminGet(tokens, `/personalrecord-service/personalrecord/prs/${displayName}`);
    if (!Array.isArray(records) || records.length === 0) {
      console.log("  No personal records found");
      return 0;
    }

    let count = 0;
    for (const rec of records) {
      const typeId = rec.typeId;
      const label = PR_TYPE_MAP[typeId];
      if (!label) continue; // skip non-running types (cycling, etc.)
      // Only store time-based records (typeId 1-6)
      if (typeId > 6) continue;

      const timeSec = rec.value;
      if (!timeSec || timeSec <= 0) continue;

      const dateStr = rec.actStartDateTimeInGMTFormatted?.substring(0, 10) ?? null;

      const row: Record<string, any> = {
        user_id: USER_ID,
        type_id: typeId,
        distance_label: label,
        time_seconds: Math.round(timeSec * 10) / 10,
        activity_id: rec.activityId ? String(rec.activityId) : null,
        activity_name: rec.activityName ?? null,
        activity_type: rec.activityType ?? null,
        activity_date: dateStr,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("garmin_personal_records")
        .upsert(row, { onConflict: "user_id,type_id" });

      if (error) {
        console.error(`  x PR upsert failed (${label}): ${error.message}`);
      } else {
        const mins = Math.floor(timeSec / 60);
        const secs = Math.round(timeSec % 60);
        const hrs = Math.floor(mins / 60);
        const timeStr = hrs > 0 ? `${hrs}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${mins}:${String(secs).padStart(2, '0')}`;
        console.log(`  PR ${label}: ${timeStr} (${dateStr ?? '?'})`);
        count++;
      }
    }
    return count;
  } catch (e: any) {
    if (e.message === "AUTH_EXPIRED") throw e;
    console.error(`  x Personal records failed: ${e.message}`);
    return 0;
  }
}

// ─── Main Handler ───────────────────────────────────────────────

Deno.serve(async (req) => {
  const startTime = Date.now();
  let tokenRefreshed = false;

  try {
    // Parse request body for optional date/daysBack
    let daysBack = 2;
    let specificDate: string | null = null;

    try {
      const body = await req.json();
      if (body.date) specificDate = body.date;
      if (body.days_back) daysBack = Math.min(body.days_back, 30);
    } catch {
      // No body or invalid JSON — use defaults
    }

    // Load and validate tokens
    let tokens = await getValidTokens();
    const now = Math.floor(Date.now() / 1000);
    tokenRefreshed = tokens.oauth2_expires_at > now && tokens.oauth2_expires_at - now < 3600;

    // Determine dates to fetch (getLocalDate is module-level)
    const dates: string[] = [];
    if (specificDate) {
      dates.push(specificDate);
    } else {
      for (let i = 0; i < daysBack; i++) {
        dates.push(getLocalDate(-i));
      }
    }

    // Fetch health data for each date
    let totalFields = 0;
    for (const dateStr of dates) {
      try {
        const cleanRow = await fetchAllHealthData(tokens, dateStr);
        const fieldCount = Object.keys(cleanRow).length - 3;

        if (fieldCount > 0) {
          const { error } = await supabase
            .from("garmin_health")
            .upsert(cleanRow, { onConflict: "user_id,date" });

          if (error) {
            console.error(`  x Supabase upsert failed for ${dateStr}: ${error.message}`);
          } else {
            totalFields += fieldCount;
          }
        }
      } catch (e: any) {
        if (e.message === "AUTH_EXPIRED") {
          // Retry with fresh token
          console.log("Got 401 — forcing token refresh...");
          tokens = await refreshOAuth2(tokens);
          tokenRefreshed = true;
          // Retry this date
          const cleanRow = await fetchAllHealthData(tokens, dateStr);
          const fieldCount = Object.keys(cleanRow).length - 3;
          if (fieldCount > 0) {
            await supabase.from("garmin_health").upsert(cleanRow, { onConflict: "user_id,date" });
            totalFields += fieldCount;
          }
        } else {
          console.error(`  x ${dateStr}: ${e.message}`);
        }
      }
    }

    // Fetch per-activity data
    const activitiesUpdated = await fetchActivityData(tokens, daysBack);

    // Fetch personal records (PRs)
    const prsUpdated = await fetchPersonalRecords(tokens);

    const durationMs = Date.now() - startTime;

    // Log success
    await supabase.from("garmin_sync_log").insert({
      success: true,
      fields_updated: totalFields,
      activities_updated: activitiesUpdated,
      duration_ms: durationMs,
      token_refreshed: tokenRefreshed,
    });

    const result = {
      success: true,
      dates: dates,
      fields_updated: totalFields,
      activities_updated: activitiesUpdated,
      duration_ms: durationMs,
      token_refreshed: tokenRefreshed,
    };

    console.log("\nSync complete:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const durationMs = Date.now() - startTime;
    console.error("Sync failed:", e.message);

    // Log failure
    await supabase.from("garmin_sync_log").insert({
      success: false,
      error: e.message?.slice(0, 500),
      duration_ms: durationMs,
      token_refreshed: tokenRefreshed,
    });

    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
