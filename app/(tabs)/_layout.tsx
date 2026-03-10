import { Tabs } from 'expo-router';
import { CalendarBlank, ChatCircle, Gauge, GearSix, House } from 'phosphor-react-native';
import { COLORS } from '../../src/utils/constants';

export default function TabLayout() {
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
          title: 'Today',
          tabBarIcon: ({ color, size }) => <House size={size} color={color} weight="fill" />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, size }) => <CalendarBlank size={size} color={color} weight="fill" />,
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
        name="zones"
        options={{
          title: 'Zones',
          tabBarIcon: ({ color, size }) => <Gauge size={size} color={color} weight="fill" />,
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
