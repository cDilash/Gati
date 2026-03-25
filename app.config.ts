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
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Marathon Coach uses your location to fetch local weather for workout briefings.',
      NSPhotoLibraryUsageDescription: 'Marathon Coach uses your photo library to set your profile picture.',
      NSCameraUsageDescription: 'Marathon Coach uses the camera to take a profile photo.',
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-location',
    'react-native-maps',
    'expo-font',
    'expo-image-picker',
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
