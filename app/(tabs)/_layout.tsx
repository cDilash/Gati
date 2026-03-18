import { Pressable, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppStore } from '../../src/store';
import { colors, semantic } from '../../src/theme/colors';
import { GatiTabBar } from '../../src/components/GatiTabBar';
import { UserAvatar } from '../../src/components/UserAvatar';

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
          headerLeft: () => {
            const profile = useAppStore.getState().userProfile;
            return (
              <Pressable onPress={() => router.push('/profile')} style={({ pressed }) => ({ marginLeft: 16, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                {profile?.avatar_base64 ? (
                  <UserAvatar size={36} name={profile.name} avatarBase64={profile.avatar_base64} />
                ) : (
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="account-outline" size={20} color={colors.textSecondary} />
                  </View>
                )}
              </Pressable>
            );
          },
          headerRight: () => (
            <Pressable onPress={() => router.push('/(tabs)/settings')} style={({ pressed }) => ({ marginRight: 16, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="cog-outline" size={20} color={colors.textSecondary} />
              </View>
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
