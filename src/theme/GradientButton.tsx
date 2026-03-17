/**
 * GradientButton — primary action button with cyan→orange gradient background.
 */

import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from './colors';

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}

const SIZES = {
  sm: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 13, borderRadius: 8 },
  md: { paddingVertical: 12, paddingHorizontal: 24, fontSize: 15, borderRadius: 12 },
  lg: { paddingVertical: 16, paddingHorizontal: 32, fontSize: 17, borderRadius: 14 },
};

export function GradientButton({ label, onPress, disabled, size = 'md', style }: GradientButtonProps) {
  const s = SIZES[size];

  const gradientColors: [string, string] = disabled
    ? [colors.textTertiary, colors.textTertiary]
    : [colors.cyan, colors.orange];

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        { opacity: pressed && !disabled ? 0.8 : disabled ? 0.5 : 1 },
        style,
      ]}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          borderRadius: s.borderRadius,
          alignItems: 'center',
        }}
      >
        <Text style={{
          fontFamily: 'Exo2_700Bold',
          fontSize: s.fontSize,
          color: colors.white,
          letterSpacing: 0.5,
        }}>
          {label}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}
