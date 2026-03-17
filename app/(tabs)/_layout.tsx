import { Pressable } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Settings, User } from '@tamagui/lucide-icons';
import { useAppStore } from '../../src/store';
import { colors, semantic } from '../../src/theme/colors';

const ICON_SIZE = 24;

export default function TabLayout() {
  const router = useRouter();
  const vdotNotification = useAppStore(s => s.vdotNotification);
  const proactiveSuggestion = useAppStore(s => s.proactiveSuggestion);
  const weeklyDigest = useAppStore(s => s.weeklyDigest);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: semantic.tabActive,
        tabBarInactiveTintColor: semantic.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: 88,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
        tabBarLabelStyle: {
          fontFamily: 'Exo2_600SemiBold',
          fontSize: 10,
          letterSpacing: 0.5,
        },
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
          tabBarBadgeStyle: { backgroundColor: colors.cyan, minWidth: 8, maxHeight: 8, borderRadius: 4, top: 2 },
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
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="calendar-month-outline" size={ICON_SIZE} color={color} />,
          tabBarBadge: (weeklyDigest?.adaptationNeeded) ? '' : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.orange, minWidth: 8, maxHeight: 8, borderRadius: 4, top: 2 },
        }}
      />

      {/* 3. Coach — center, primary action */}
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="message-text-outline" size={ICON_SIZE} color={color} />,
        }}
      />

      {/* 4. Runs — activity history */}
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Runs',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="chart-timeline-variant" size={ICON_SIZE} color={color} />,
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
