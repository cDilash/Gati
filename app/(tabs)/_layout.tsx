import { Pressable } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Settings, User } from '@tamagui/lucide-icons';
import { useAppStore } from '../../src/store';
import { colors, semantic } from '../../src/theme/colors';
import { GatiTabBar } from '../../src/components/GatiTabBar';

const ICON_SIZE = 24;

export default function TabLayout() {
  const router = useRouter();
  const vdotNotification = useAppStore(s => s.vdotNotification);
  const proactiveSuggestion = useAppStore(s => s.proactiveSuggestion);
  const weeklyDigest = useAppStore(s => s.weeklyDigest);

  return (
    <Tabs
      tabBar={(props) => <GatiTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 1.5 },
      }}
    >
      {/* 1. Today — home, most used */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="run-fast" size={ICON_SIZE} color={color} />,
          tabBarBadge: (vdotNotification || proactiveSuggestion) ? '' : undefined,
          headerLeft: () => (
            <Pressable onPress={() => router.push('/profile')} hitSlop={12} style={{ marginLeft: 16 }}>
              <User size={22} color={colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/(tabs)/settings')} hitSlop={12} style={{ marginRight: 16 }}>
              <Settings size={22} color={colors.textSecondary} />
            </Pressable>
          ),
        }}
      />

      {/* 2. Plan — second most checked */}
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="calendar-text-outline" size={ICON_SIZE} color={color} />,
          tabBarBadge: (weeklyDigest?.adaptationNeeded) ? '' : undefined,
        }}
      />

      {/* 3. Coach — center, primary action */}
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="robot-outline" size={ICON_SIZE} color={color} />,
        }}
      />

      {/* 4. Runs — activity history */}
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Runs',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="shoe-sneaker" size={ICON_SIZE} color={color} />,
        }}
      />

      {/* 5. Recovery — health + zones reference */}
      <Tabs.Screen
        name="zones"
        options={{
          title: 'Recovery',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="heart-pulse" size={ICON_SIZE} color={color} />,
        }}
      />

      {/* Settings — hidden tab, accessed via gear icon */}
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          title: 'Settings',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginLeft: 16 }}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
            </Pressable>
          ),
        }}
      />
    </Tabs>
  );
}
