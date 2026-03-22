import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Pressable, AppState } from 'react-native';
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
import { colors } from '../src/theme/colors';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { initializeApp, isLoading, userProfile } = useAppStore();

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

  // Unified sync on app load — Strava + Health + weekly review in parallel
  const lastSyncRef = useRef(0);

  useEffect(() => {
    if (isLoading || !userProfile) return;
    lastSyncRef.current = Date.now();
    useAppStore.getState().syncAll();
  }, [isLoading, userProfile?.id]);

  // Foreground return sync — catch new Strava data after a run
  // Morning window (6-10am): shorter cooldown (60s) to catch sleep data syncing from Garmin
  useEffect(() => {
    if (!userProfile) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const hour = new Date().getHours();
        const isMorning = hour >= 6 && hour < 10;
        const cooldown = isMorning ? 60000 : 120000; // 1 min morning, 2 min otherwise
        if (Date.now() - lastSyncRef.current > cooldown) {
          lastSyncRef.current = Date.now();
          useAppStore.getState().syncAll();
        }
      }
    });
    return () => sub.remove();
  }, [userProfile?.id]);

  // Periodic sync every 5 minutes while app is open
  useEffect(() => {
    if (!userProfile) return;
    const interval = setInterval(() => {
      if (Date.now() - lastSyncRef.current > 120000) {
        lastSyncRef.current = Date.now();
        useAppStore.getState().syncAll();
      }
    }, 300000);
    return () => clearInterval(interval);
  }, [userProfile?.id]);

  // Navigation guard
  useEffect(() => {
    if (!fontsLoaded || isLoading) return;
    const inSetup = segments[0] === 'setup';
    if (!userProfile && !inSetup) router.replace('/setup');
    else if (userProfile && inSetup) router.replace('/(tabs)');
  }, [fontsLoaded, isLoading, userProfile, segments]);

  // Post-run summary modal trigger
  const pendingPostRun = useAppStore(s => s.pendingPostRunSummary);
  useEffect(() => {
    if (pendingPostRun && !isLoading && userProfile) {
      // Small delay to let the main UI settle
      const t = setTimeout(() => router.push('/post-run'), 1500);
      return () => clearTimeout(t);
    }
  }, [pendingPostRun?.workoutId]);

  // Loading state — fonts or app data
  if (!fontsLoaded || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.cyan} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: { fontFamily: 'Exo2_600SemiBold' },
            contentStyle: { backgroundColor: colors.background },
            headerBackVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="post-run" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: true }} />
          <Stack.Screen name="weekly-checkin" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: true }} />
          <Stack.Screen name="week-review" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: true }} />
          <Stack.Screen
            name="workout/[id]"
            options={{
              presentation: 'modal',
              gestureEnabled: true,
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="activity/[id]"
            options={{
              presentation: 'modal',
              gestureEnabled: true,
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="profile"
            options={({ navigation }) => ({
              title: 'Profile',
              headerLeft: () => (
                <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={{ marginLeft: 4 }}>
                  <ChevronLeft size={24} color={colors.textPrimary} />
                </Pressable>
              ),
            })}
          />
        </Stack>
    </TamaguiProvider>
  );
}
