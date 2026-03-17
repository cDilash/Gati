/**
 * GradientBorder — wraps children in a gradient-bordered card.
 *
 * Modes:
 * - 'left': only left border is gradient (for content cards)
 * - 'all': full gradient border (for hero elements)
 */

import React from 'react';
import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from './colors';

interface GradientBorderProps {
  children: React.ReactNode;
  side?: 'left' | 'all';
  borderWidth?: number;
  borderRadius?: number;
  style?: ViewStyle;
  gradientColors?: readonly string[];
}

export function GradientBorder({
  children,
  side = 'left',
  borderWidth = 3,
  borderRadius = 14,
  style,
  gradientColors,
}: GradientBorderProps) {
  const c = gradientColors ?? [colors.cyan, colors.orange];

  if (side === 'left') {
    return (
      <View style={[{ flexDirection: 'row', borderRadius, overflow: 'hidden' }, style]}>
        <LinearGradient
          colors={c as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ width: borderWidth }}
        />
        <View style={{ flex: 1, backgroundColor: colors.surface, borderTopRightRadius: borderRadius, borderBottomRightRadius: borderRadius }}>
          {children}
        </View>
      </View>
    );
  }

  // 'all' — full gradient border
  return (
    <LinearGradient
      colors={c as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ padding: borderWidth, borderRadius }, style]}
    >
      <View style={{ backgroundColor: colors.surface, borderRadius: borderRadius - borderWidth, overflow: 'hidden' }}>
        {children}
      </View>
    </LinearGradient>
  );
}
