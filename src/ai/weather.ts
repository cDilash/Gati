/**
 * Weather-aware running advice using Open-Meteo API (free, no key required).
 * Fetches current conditions and generates pace adjustment recommendations.
 */

import * as Location from 'expo-location';

export interface WeatherConditions {
  temperature: number;     // °F
  feelsLike: number;       // °F (apparent temperature)
  humidity: number;        // %
  windSpeed: number;       // mph
  precipitation: number;   // mm
  weatherCode: number;     // WMO code
  description: string;     // Human-readable
  paceAdjustment: number;  // seconds/mile to add (positive = slower)
  advice: string;          // One-line coaching advice
}

// WMO weather codes → descriptions
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail',
};

/**
 * Calculate pace adjustment based on weather conditions.
 * Based on sports science research on heat/cold/wind impact.
 */
function calculatePaceAdjustment(tempF: number, humidity: number, windMph: number): { adjustment: number; advice: string } {
  let adjustment = 0;
  const adviceParts: string[] = [];

  // Heat impact (above 60°F, performance degrades)
  if (tempF >= 85) {
    adjustment += 30;
    adviceParts.push(`It's ${Math.round(tempF)}°F — slow down 30+ sec/mile and hydrate every 20 minutes`);
  } else if (tempF >= 75) {
    adjustment += 20;
    adviceParts.push(`Warm at ${Math.round(tempF)}°F — slow easy pace by 15-20 sec/mile`);
  } else if (tempF >= 65) {
    adjustment += 10;
    adviceParts.push(`${Math.round(tempF)}°F — good running weather, slight pace adjustment`);
  } else if (tempF >= 50) {
    // Ideal running temp
    adviceParts.push(`${Math.round(tempF)}°F — ideal running conditions`);
  } else if (tempF >= 35) {
    adjustment += 5;
    adviceParts.push(`Cool at ${Math.round(tempF)}°F — warm up well before quality work`);
  } else {
    adjustment += 15;
    adviceParts.push(`Cold at ${Math.round(tempF)}°F — dress in layers, extend warm-up`);
  }

  // Humidity impact (above 60%, compounds heat)
  if (humidity > 80 && tempF > 70) {
    adjustment += 15;
    adviceParts.push(`${humidity}% humidity — sweat won't evaporate, take it easy`);
  } else if (humidity > 70 && tempF > 65) {
    adjustment += 5;
    adviceParts.push(`Humid at ${humidity}%`);
  }

  // Wind impact
  if (windMph > 20) {
    adjustment += 10;
    adviceParts.push(`Strong wind at ${Math.round(windMph)} mph — expect headwind resistance`);
  } else if (windMph > 12) {
    adjustment += 5;
    adviceParts.push(`Breezy at ${Math.round(windMph)} mph`);
  }

  const advice = adviceParts[0] || `${Math.round(tempF)}°F — good conditions`;
  return { adjustment, advice };
}

/**
 * Fetch current weather for the user's location using Open-Meteo (free API).
 */
export async function getWeatherForRun(): Promise<WeatherConditions | null> {
  try {
    // Get location permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('[Weather] Location permission denied');
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low, // Low accuracy is fine for weather
    });
    const { latitude, longitude } = location.coords;

    // Open-Meteo API — free, no key required
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) {
      console.log('[Weather] API error:', response.status);
      return null;
    }

    const data = await response.json();
    const current = data.current;

    const tempF = current.temperature_2m;
    const feelsLike = current.apparent_temperature;
    const humidity = current.relative_humidity_2m;
    const windSpeed = current.wind_speed_10m;
    const precipitation = current.precipitation;
    const weatherCode = current.weather_code;

    const { adjustment, advice } = calculatePaceAdjustment(tempF, humidity, windSpeed);
    const description = WEATHER_CODES[weatherCode] ?? 'Unknown';

    console.log(`[Weather] ${Math.round(tempF)}°F (feels ${Math.round(feelsLike)}°F), ${humidity}% humidity, ${Math.round(windSpeed)} mph wind, ${description}`);

    return {
      temperature: Math.round(tempF),
      feelsLike: Math.round(feelsLike),
      humidity: Math.round(humidity),
      windSpeed: Math.round(windSpeed),
      precipitation,
      weatherCode,
      description,
      paceAdjustment: adjustment,
      advice,
    };
  } catch (e: any) {
    console.log('[Weather] Failed:', e.message);
    return null;
  }
}
