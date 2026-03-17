/**
 * GradientText — renders text with a cyan→orange gradient fill.
 *
 * Uses MaskedView + LinearGradient. Falls back to cyan solid if MaskedView fails.
 */

import React from 'react';
import { Text, StyleSheet, TextStyle, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { colors } from './colors';

interface GradientTextProps {
  text: string;
  style?: TextStyle;
  gradientColors?: readonly string[];
}

export function GradientText({ text, style, gradientColors }: GradientTextProps) {
  const textStyle: TextStyle = {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 24,
    ...style,
  };

  const c = gradientColors ?? [colors.cyan, colors.orange];

  try {
    return (
      <MaskedView
        maskElement={
          <Text style={[textStyle, { color: '#000' }]}>{text}</Text>
        }
      >
        <LinearGradient
          colors={c as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={[textStyle, { opacity: 0 }]}>{text}</Text>
        </LinearGradient>
      </MaskedView>
    );
  } catch {
    // Fallback: solid cyan text
    return <Text style={[textStyle, { color: colors.cyan }]}>{text}</Text>;
  }
}
