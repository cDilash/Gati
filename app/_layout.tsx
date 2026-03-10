import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { initializeDatabase } from '../src/db/client';
import { useAppStore } from '../src/store';
import { COLORS } from '../src/utils/constants';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const { initializeApp, isInitialized, userProfile, isLoading } = useAppStore();

  useEffect(() => {
    try {
      initializeDatabase();
      setDbReady(true);
    } catch (error) {
      console.error('DB init error:', error);
    }
  }, []);

  useEffect(() => {
    if (dbReady && !isInitialized) {
      initializeApp();
    }
  }, [dbReady, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      // Fire-and-forget: sync health data + workout data in background
      const store = useAppStore.getState();
      store.syncHealthData();
      store.syncWorkoutFromHealthKit();
    }
  }, [isInitialized]);

  useEffect(() => {
    if (!isInitialized || isLoading) return;

    const inSetup = segments[0] === 'setup';

    if (!userProfile && !inSetup) {
      router.replace('/setup');
    } else if (userProfile && inSetup) {
      router.replace('/(tabs)');
    }
  }, [isInitialized, isLoading, userProfile, segments]);

  if (!dbReady || !isInitialized || isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: COLORS.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="workout/[id]" options={{ title: 'Workout Details', presentation: 'modal' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
