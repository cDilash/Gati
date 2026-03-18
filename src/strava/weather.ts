/**
 * Historical weather fetching for Strava activities.
 * Uses Open-Meteo Archive API (free, no key required).
 * Fetches once per activity and caches in strava_activity_detail.
 */

// WMO weather codes → human-readable conditions
const WMO_CODES: Record<number, string> = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
  45: 'Foggy', 48: 'Fog', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  56: 'Freezing Drizzle', 57: 'Freezing Drizzle', 61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Freezing Rain', 71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  77: 'Snow Grains', 80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

/**
 * Fetch and store historical weather for activities that don't have it yet.
 * Call after Strava sync to backfill weather data.
 */
export async function fetchWeatherForActivities(): Promise<number> {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();

    // Find activities with coordinates but no weather
    const rows = db.getAllSync(
      `SELECT id, start_lat, start_lng, strava_activity_id FROM strava_activity_detail
       WHERE start_lat IS NOT NULL AND start_lng IS NOT NULL
       AND (weather_fetched IS NULL OR weather_fetched = 0)
       LIMIT 5`
    );

    if (rows.length === 0) return 0;

    let fetched = 0;
    for (const row of rows) {
      try {
        // Get the activity date
        const metricRow = db.getFirstSync(
          'SELECT date FROM performance_metric WHERE strava_activity_id = ?',
          row.strava_activity_id,
        );
        if (!metricRow) {
          db.runSync('UPDATE strava_activity_detail SET weather_fetched = 1 WHERE id = ?', row.id);
          continue;
        }

        const weather = await fetchHistoricalWeather(row.start_lat, row.start_lng, metricRow.date);
        if (weather) {
          db.runSync(
            `UPDATE strava_activity_detail SET
             weather_temp_f = ?, weather_humidity = ?, weather_wind_mph = ?,
             weather_condition = ?, weather_fetched = 1
             WHERE id = ?`,
            weather.tempF, weather.humidity, weather.windMph, weather.condition, row.id,
          );
          fetched++;
        } else {
          // Mark as fetched even on failure so we don't retry
          db.runSync('UPDATE strava_activity_detail SET weather_fetched = 1 WHERE id = ?', row.id);
        }
      } catch {
        // Mark failed so we don't retry
        try {
          db.runSync('UPDATE strava_activity_detail SET weather_fetched = 1 WHERE id = ?', row.id);
        } catch {}
      }
    }

    return fetched;
  } catch (e) {
    console.warn('[Weather] Batch fetch failed:', e);
    return 0;
  }
}

interface HistoricalWeather {
  tempF: number;
  humidity: number;
  windMph: number;
  condition: string;
}

async function fetchHistoricalWeather(
  lat: number, lng: number, date: string,
): Promise<HistoricalWeather | null> {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`;

    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    const hourly = data.hourly;
    if (!hourly?.temperature_2m?.length) return null;

    // Use midday values (index 12 for noon) as representative
    const idx = Math.min(12, hourly.temperature_2m.length - 1);
    const tempC = hourly.temperature_2m[idx];
    const humidity = hourly.relative_humidity_2m?.[idx] ?? null;
    const windKmh = hourly.wind_speed_10m?.[idx] ?? 0;
    const weatherCode = hourly.weather_code?.[idx] ?? 0;

    return {
      tempF: Math.round(tempC * 9 / 5 + 32),
      humidity: humidity ?? 0,
      windMph: Math.round(windKmh * 0.621),
      condition: WMO_CODES[weatherCode] ?? 'Unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Backfill location data for existing activities that were synced before location capture.
 * Re-fetches activity detail from Strava to get start_latlng, location_city, etc.
 * Runs in batches of 5 to avoid rate limiting.
 */
export async function backfillLocationData(): Promise<number> {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();

    // Find activities with Strava ID but no coordinates
    const rows = db.getAllSync(
      `SELECT id, strava_activity_id FROM strava_activity_detail
       WHERE strava_activity_id IS NOT NULL
       AND start_lat IS NULL
       LIMIT 5`
    ) as { id: string; strava_activity_id: number }[];

    if (rows.length === 0) return 0;

    const { getActivityDetail } = require('./api');
    let updated = 0;

    for (const row of rows) {
      try {
        const detail = await getActivityDetail(row.strava_activity_id);
        if (detail) {
          db.runSync(
            `UPDATE strava_activity_detail SET
             location_city = ?, location_state = ?, location_country = ?,
             start_lat = ?, start_lng = ?
             WHERE id = ?`,
            detail.locationCity ?? null,
            detail.locationState ?? null,
            detail.locationCountry ?? null,
            detail.startLat ?? null,
            detail.startLng ?? null,
            row.id,
          );
          updated++;
        }
      } catch (e) {
        console.warn(`[Weather] Backfill failed for activity ${row.strava_activity_id}:`, e);
      }
    }

    console.log(`[Weather] Backfilled location for ${updated}/${rows.length} activities`);
    return updated;
  } catch (e) {
    console.warn('[Weather] Backfill failed:', e);
    return 0;
  }
}
