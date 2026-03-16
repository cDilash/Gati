import { Pressable } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Settings } from '@tamagui/lucide-icons';

const COLORS = {
  accent: '#FF6B35',
  textTertiary: '#666666',
  textSecondary: '#A0A0A0',
  surface: '#1E1E1E',
  border: '#333333',
  background: '#121212',
  text: '#FFFFFF',
};

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 0.5,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontFamily: 'Exo2_600SemiBold',
          fontSize: 10,
        },
        headerStyle: { backgroundColor: COLORS.background },
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, letterSpacing: 1.5 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="run-fast" size={size} color={color} />,
          headerRight: () => (
            <Pressable onPress={() => router.push('/(tabs)/settings')} hitSlop={12} style={{ marginRight: 16 }}>
              <Settings size={22} color={COLORS.textSecondary} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="calendar-month" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="robot" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="zones"
        options={{
          title: 'Zones',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="gauge" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Runs',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="shoe-sneaker" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null }}
      />
    </Tabs>
  );
}
