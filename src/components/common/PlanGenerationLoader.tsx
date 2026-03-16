/**
 * PlanGenerationLoader — full-screen loading state for AI plan generation.
 *
 * Shows fake-streaming progress steps while Gemini works (~60-120 seconds).
 * Each step appears after a delay, giving the user a sense of progress.
 */

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { COLORS } from '../../utils/constants';

const PROGRESS_STEPS = [
  { label: 'Analyzing your fitness level...', delay: 0 },
  { label: 'Reviewing injury history and weaknesses...', delay: 3500 },
  { label: 'Calculating pace zones and volume targets...', delay: 7000 },
  { label: 'Designing weekly progression...', delay: 12000 },
  { label: 'Adding quality sessions and long runs...', delay: 18000 },
  { label: 'Personalizing for your race course...', delay: 25000 },
  { label: 'Scheduling cutback and recovery weeks...', delay: 33000 },
  { label: 'Building taper strategy...', delay: 42000 },
  { label: 'Writing coaching notes for each workout...', delay: 52000 },
  { label: 'Running safety checks...', delay: 65000 },
  { label: 'Finalizing your personalized plan...', delay: 80000 },
];

interface Props {
  isActive: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function PlanGenerationLoader({ isActive, error }: Props) {
  const [visibleSteps, setVisibleSteps] = useState(0);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const fadeAnims = useRef(PROGRESS_STEPS.map(() => new Animated.Value(0))).current;

  // Spinner rotation
  useEffect(() => {
    if (!isActive) return;
    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [isActive]);

  // Progressive step reveal
  useEffect(() => {
    if (!isActive) {
      setVisibleSteps(0);
      fadeAnims.forEach(a => a.setValue(0));
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    PROGRESS_STEPS.forEach((step, i) => {
      const timer = setTimeout(() => {
        setVisibleSteps(prev => Math.max(prev, i + 1));
        Animated.timing(fadeAnims[i], {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      }, step.delay);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorTitle}>Plan Generation Failed</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <Text style={styles.errorHint}>Check your internet connection and try again.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Spinner */}
      <Animated.View style={[styles.spinner, { transform: [{ rotate: spinInterpolate }] }]}>
        <View style={styles.spinnerArc} />
      </Animated.View>

      <Text style={styles.title}>Your coach is building your plan</Text>
      <Text style={styles.subtitle}>
        This takes 1–2 minutes — designing {'\n'}20 weeks of personalized training
      </Text>

      {/* Progress steps */}
      <View style={styles.stepsContainer}>
        {PROGRESS_STEPS.slice(0, visibleSteps).map((step, i) => (
          <Animated.View key={i} style={[styles.stepRow, { opacity: fadeAnims[i] }]}>
            <Text style={[styles.stepCheck, i === visibleSteps - 1 && styles.stepCheckActive]}>
              {i < visibleSteps - 1 ? '✓' : '●'}
            </Text>
            <Text style={[styles.stepLabel, i === visibleSteps - 1 && styles.stepLabelActive]}>
              {step.label}
            </Text>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  spinner: {
    width: 56,
    height: 56,
    marginBottom: 24,
  },
  spinnerArc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: COLORS.accent,
    borderRightColor: COLORS.accent,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 40,
  },
  stepsContainer: {
    alignSelf: 'stretch',
    paddingHorizontal: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 12,
  },
  stepCheck: {
    fontSize: 14,
    color: COLORS.success,
    width: 20,
    textAlign: 'center',
  },
  stepCheckActive: {
    color: COLORS.accent,
  },
  stepLabel: {
    fontSize: 15,
    color: COLORS.textSecondary,
    flex: 1,
  },
  stepLabelActive: {
    color: COLORS.text,
    fontWeight: '500',
  },
  errorIcon: {
    fontSize: 40,
    fontWeight: '800',
    color: COLORS.danger,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: COLORS.danger,
    textAlign: 'center',
    lineHeight: 52,
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  errorHint: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
