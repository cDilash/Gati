import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Marathon Coach',
  slug: 'marathon-coach',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'marathon-coach',
  userInterfaceStyle: 'dark',

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.personal.marathoncoach',
    entitlements: {
      'com.apple.developer.healthkit': true,
      'com.apple.developer.healthkit.access': [],
    },
    infoPlist: {
      NSHealthShareUsageDescription: 'Marathon Coach reads your resting heart rate, heart rate variability, and sleep data from Apple Health to calculate your recovery score and personalize your training plan.',
      NSHealthUpdateUsageDescription: 'Marathon Coach does not write any data to Apple Health.',
      NSLocationWhenInUseUsageDescription: 'Marathon Coach uses your location to fetch local weather for workout briefings.',
      UIBackgroundModes: ['health-sharing'],
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-location',
    'react-native-maps',
    'expo-font',
    'react-native-health',
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
        },
      },
    ],
  ],
  extra: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    stravaClientId: process.env.STRAVA_CLIENT_ID || '',
    stravaClientSecret: process.env.STRAVA_CLIENT_SECRET || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    eas: {
      projectId: 'marathon-coach-local',
    },
  },
});
