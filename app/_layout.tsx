import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { TamaguiProvider } from 'tamagui';
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
import { X, ChevronLeft } from '@tamagui/lucide-icons';
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
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#121212' },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: { fontFamily: 'Exo2_600SemiBold' },
            contentStyle: { backgroundColor: '#121212' },
            headerBackVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen
            name="workout/[id]"
            options={({ navigation }) => ({
              title: 'Workout Details',
              presentation: 'modal',
              gestureEnabled: true,
              headerLeft: () => null,
              headerRight: () => (
                <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={{ marginRight: 8 }}>
                  <X size={22} color="#A0A0A0" />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="activity/[id]"
            options={({ navigation }) => ({
              title: 'Activity',
              presentation: 'modal',
              gestureEnabled: true,
              headerLeft: () => null,
              headerRight: () => (
                <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={{ marginRight: 8 }}>
                  <X size={22} color="#A0A0A0" />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="profile"
            options={({ navigation }) => ({
              title: 'Profile',
              headerLeft: () => (
                <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={{ marginLeft: 4 }}>
                  <ChevronLeft size={24} color="#FFFFFF" />
                </Pressable>
              ),
            })}
          />
        </Stack>
    </TamaguiProvider>
  );
}
