import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { TamaguiProvider } from 'tamagui';
import { PortalProvider } from '@tamagui/portal';
import { useFonts } from 'expo-font';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import {
  Exo2_300Light, Exo2_400Regular, Exo2_500Medium,
  Exo2_600SemiBold, Exo2_700Bold, Exo2_800ExtraBold,
} from '@expo-google-fonts/exo-2';
import {
  JetBrainsMono_400Regular, JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold, JetBrainsMono_700Bold, JetBrainsMono_800ExtraBold,
} from '@expo-google-fonts/jetbrains-mono';
import config from '../tamagui.config';
import { useAppStore } from '../src/store';

const COLORS = {
  background: '#121212',
  accent: '#FF6B35',
  text: '#FFFFFF',
};

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { initializeApp, isLoading, userProfile, activePlan, isStravaConnected } = useAppStore();

  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    Exo2_300Light, Exo2_400Regular, Exo2_500Medium,
    Exo2_600SemiBold, Exo2_700Bold, Exo2_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold, JetBrainsMono_700Bold, JetBrainsMono_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) initializeApp();
  }, [fontsLoaded]);

  // Background tasks after app loaded
  useEffect(() => {
    if (isLoading || !userProfile) return;
    const store = useAppStore.getState();

    if (isStravaConnected) {
      (async () => {
        try {
          console.log('[Layout] Starting Strava sync...');
          const result = await store.syncStrava();
          console.log(`[Layout] Strava sync done: ${result.newActivities} new, ${result.matched} matched`);
        } catch (e) {
          console.warn('[Layout] Strava sync failed:', e);
        }
      })();
    }

    if (activePlan) {
      (async () => { try { await store.checkWeeklyReview(); } catch {} })();
    }
  }, [isLoading, userProfile?.id, activePlan?.id, isStravaConnected]);

  // Navigation guard
  useEffect(() => {
    if (!fontsLoaded || isLoading) return;
    const inSetup = segments[0] === 'setup';
    if (!userProfile && !inSetup) router.replace('/setup');
    else if (userProfile && inSetup) router.replace('/(tabs)');
  }, [fontsLoaded, isLoading, userProfile, segments]);

  // Loading state — fonts or app data
  if (!fontsLoaded || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
        <ActivityIndicator size="large" color="#FF6B35" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <PortalProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#121212' },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: { fontFamily: 'Exo2_600SemiBold' },
            contentStyle: { backgroundColor: '#121212' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="workout/[id]" options={{ title: 'Workout Details', presentation: 'modal' }} />
          <Stack.Screen name="activity/[id]" options={{ title: 'Activity', presentation: 'modal' }} />
          <Stack.Screen name="profile" options={{ title: 'Profile', presentation: 'modal' }} />
        </Stack>
      </PortalProvider>
    </TamaguiProvider>
  );
}
