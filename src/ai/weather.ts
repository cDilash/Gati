import * as Location from 'expo-location';
import { WeatherData } from '../types';

// WMO weather code → human condition string
const WMO_CODES: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow',
  80: 'light showers', 81: 'showers', 82: 'heavy showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

let _cachedLocation: { lat: number; lon: number; timestamp: number } | null = null;
const LOCATION_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getLocation(): Promise<{ lat: number; lon: number } | null> {
  // Return cached location if fresh
  if (_cachedLocation && Date.now() - _cachedLocation.timestamp < LOCATION_CACHE_MS) {
    return { lat: _cachedLocation.lat, lon: _cachedLocation.lon };
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low, // coarse is fine for weather
    });

    _cachedLocation = {
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      timestamp: Date.now(),
    };

    return { lat: _cachedLocation.lat, lon: _cachedLocation.lon };
  } catch {
    return null;
  }
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

export async function getWeather(): Promise<WeatherData | null> {
  try {
    const loc = await getLocation();
    if (!loc) return null;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,weather_code`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const current = data.current;

    return {
      temp: celsiusToFahrenheit(current.temperature_2m),
      humidity: Math.round(current.relative_humidity_2m),
      condition: WMO_CODES[current.weather_code] || 'unknown',
    };
  } catch {
    return null;
  }
}
