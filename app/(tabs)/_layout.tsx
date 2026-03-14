import { Tabs } from 'expo-router';
import { CalendarBlank, ChatCircle, Heartbeat, GearSix, House } from 'phosphor-react-native';
import { COLORS } from '../../src/utils/constants';
import { useAppStore } from '../../src/store';

export default function TabLayout() {
  const hasUnreadDigest = useAppStore(s => s.hasUnreadDigest);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          backgroundColor: COLORS.background,
          borderTopColor: COLORS.border,
          borderTopWidth: 0.5,
        },
        headerStyle: {
          backgroundColor: COLORS.background,
        },
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House size={size} color={color} weight="fill" />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, size }) => <CalendarBlank size={size} color={color} weight="fill" />,
          tabBarBadge: hasUnreadDigest ? ' ' : undefined,
          tabBarBadgeStyle: hasUnreadDigest ? { backgroundColor: COLORS.accent, minWidth: 10, maxHeight: 10, borderRadius: 5, top: 2 } : undefined,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => <ChatCircle size={size} color={color} weight="fill" />,
        }}
      />
      <Tabs.Screen
        name="recovery"
        options={{
          title: 'Recovery',
          tabBarIcon: ({ color, size }) => <Heartbeat size={size} color={color} weight="fill" />,
        }}
      />
      <Tabs.Screen
        name="zones"
        options={{
          href: null, // Hidden from tab bar, still accessible via navigation
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <GearSix size={size} color={color} weight="fill" />,
        }}
      />
    </Tabs>
  );
}
