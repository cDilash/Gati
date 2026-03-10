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
      'com.apple.developer.healthkit.access': ['health-records'],
    },
    infoPlist: {
      NSHealthShareUsageDescription: 'Marathon Coach reads your running workouts from Apple Health to track training progress and provide coaching insights.',
      NSHealthUpdateUsageDescription: 'Marathon Coach does not write any health data.',
      UIBackgroundModes: ['health-sharing'],
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
  ],
  extra: {
    geminiApiKey: 'REDACTED',
    eas: {
      projectId: 'marathon-coach-local',
    },
  },
});
