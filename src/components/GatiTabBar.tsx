/**
 * GatiTabBar — custom tab bar with sliding gradient indicator and tap animations.
 *
 * Features:
 * - Cyan→orange gradient bar slides above the active tab
 * - Active icon: cyan with subtle glow
 * - Inactive icon: dark blue-gray
 * - Tap bounce animation on icon
 * - Soft gradient shadow at top (replaces hard border)
 */

import { useCallback, useEffect } from 'react';
import { View, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Text } from 'tamagui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';

const B = (props: any) => <Text fontFamily="$body" {...props} />;

const ACTIVE_COLOR = colors.cyan;
const INACTIVE_COLOR = '#3A4555';
const INDICATOR_WIDTH = 40;

// Tab config — must match the order in _layout.tsx
const TAB_ICONS: Record<string, string> = {
  index: 'run-fast',
  calendar: 'calendar-text-outline',
  coach: 'robot-outline',
  activities: 'shoe-sneaker',
  zones: 'heart-pulse',
};

const TAB_LABELS: Record<string, string> = {
  index: 'Today',
  calendar: 'Plan',
  coach: 'Coach',
  activities: 'Runs',
  zones: 'Recovery',
};

interface GatiTabBarProps {
  state: any;
  descriptors: any;
  navigation: any;
}

export function GatiTabBar({ state, descriptors, navigation }: GatiTabBarProps) {
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;

  // Filter out hidden tabs (settings has href: null)
  const visibleRoutes = state.routes.filter((route: any, i: number) => {
    const options = descriptors[route.key]?.options;
    // Hide if href is null OR if route name is 'settings' (fallback)
    if (options?.href === null) return false;
    if (route.name === 'settings') return false;
    // Only show tabs we have icons for
    if (!TAB_ICONS[route.name]) return false;
    return true;
  });

  const tabCount = visibleRoutes.length;
  const tabWidth = screenWidth / tabCount;

  // Animated indicator position
  const indicatorX = useSharedValue(state.index * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2);

  // Map state.index to visible index
  const visibleIndex = visibleRoutes.findIndex((r: any) => r.key === state.routes[state.index]?.key);

  useEffect(() => {
    const targetX = visibleIndex * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2;
    indicatorX.value = withTiming(targetX, { duration: 250, easing: Easing.inOut(Easing.ease) });
  }, [visibleIndex, tabWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom > 0 ? insets.bottom : 20 }]}>
      {/* Top shadow gradient */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)']}
        style={styles.topShadow}
      />

      {/* Sliding gradient indicator */}
      <Animated.View style={[styles.indicator, indicatorStyle]}>
        <LinearGradient
          colors={[colors.cyan, colors.orange]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.indicatorGradient}
        />
      </Animated.View>

      {/* Tab items */}
      <View style={styles.tabRow}>
        {visibleRoutes.map((route: any, index: number) => {
          const isActive = visibleIndex === index;
          const routeName = route.name;
          const iconName = TAB_ICONS[routeName] ?? 'circle';
          const label = TAB_LABELS[routeName] ?? routeName;
          const options = descriptors[route.key]?.options ?? {};
          const hasBadge = options.tabBarBadge != null && options.tabBarBadge !== undefined;

          return (
            <TabItem
              key={route.key}
              iconName={iconName}
              label={label}
              isActive={isActive}
              hasBadge={hasBadge}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

// ─── Tab Item with bounce animation ─────────────────────────

function TabItem({
  iconName, label, isActive, hasBadge, onPress, onLongPress,
}: {
  iconName: string; label: string; isActive: boolean; hasBadge: boolean;
  onPress: () => void; onLongPress: () => void;
}) {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSpring(1.15, { damping: 10, stiffness: 300 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });
    onPress();
  }, [onPress]);

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable style={styles.tabItem} onPress={handlePress} onLongPress={onLongPress} hitSlop={4}>
      <Animated.View style={[styles.iconContainer, iconAnimStyle]}>
        <MaterialCommunityIcons
          name={iconName as any}
          size={24}
          color={isActive ? ACTIVE_COLOR : INACTIVE_COLOR}
          style={isActive ? styles.activeGlow : undefined}
        />
        {hasBadge && <View style={styles.badge} />}
      </Animated.View>
      <B
        fontSize={10}
        fontWeight="600"
        letterSpacing={0.5}
        color={isActive ? ACTIVE_COLOR : INACTIVE_COLOR}
        marginTop={2}
      >
        {label}
      </B>
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    paddingTop: 8,
  },
  topShadow: {
    position: 'absolute',
    top: -8,
    left: 0,
    right: 0,
    height: 8,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: INDICATOR_WIDTH,
    height: 3,
  },
  indicatorGradient: {
    flex: 1,
    borderRadius: 1.5,
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconContainer: {
    position: 'relative',
  },
  activeGlow: {
    // iOS shadow for glow effect
    shadowColor: colors.cyan,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cyan,
  },
});
