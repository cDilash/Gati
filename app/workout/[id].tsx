/**
 * Workout Detail Screen — Tamagui migration.
 */
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { ScrollView, YStack, XStack, Text, View } from 'tamagui';
import { useLocalSearchParams } from 'expo-router';
import { useAppStore } from '../../src/store';
import { WORKOUT_TYPE_LABELS, PHASE_COLORS } from '../../src/utils/constants';
import { formatDateLong } from '../../src/utils/dateUtils';
import { formatPace } from '../../src/engine/vdot';
import { PerformanceMetric, IntervalStep } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { METRIC_ICONS } from '../../src/utils/workoutIcons';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const STAT_ICON_MAP: Record<string, string> = { Distance: METRIC_ICONS.distance, Duration: METRIC_ICONS.duration, 'Avg Pace': METRIC_ICONS.pace, 'Avg HR': METRIC_ICONS.hr, 'Max HR': METRIC_ICONS.hr, RPE: METRIC_ICONS.rpe };

function StatBox({ label, value }: { label: string; value: string }) {
  const icon = STAT_ICON_MAP[label];
  return (
    <YStack minWidth={80} backgroundColor="$surfaceLight" borderRadius="$4" padding="$3" alignItems="center">
      {icon && <MaterialCommunityIcons name={icon as any} size={14} color="#FF6B35" style={{ marginBottom: 2 }} />}
      <M color="$color" fontSize={16} fontWeight="700">{value}</M>
      <H color="$textSecondary" fontSize={11} letterSpacing={1} marginTop={2}>{label}</H>
    </YStack>
  );
}

function SplitsCard({ splitsJson }: { splitsJson: string }) {
  let splits: any[] = [];
  try { splits = JSON.parse(splitsJson); } catch { return null; }
  if (!Array.isArray(splits) || splits.length === 0) return null;
  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={0.5} borderColor="$border">
      <B color="$color" fontSize={15} fontWeight="600" marginBottom="$3">Splits</B>
      {splits.map((s: any, i: number) => {
        const pace = s.averageSpeed > 0 ? Math.round(1609.344 / s.averageSpeed) : 0;
        return (
          <XStack key={i} alignItems="center" paddingVertical="$1" borderBottomWidth={0.5} borderBottomColor="$border">
            <M color="$textSecondary" fontSize={13} width={60}>Mile {s.split || i + 1}</M>
            <M color="$color" fontSize={14} fontWeight="600" width={60}>{pace > 0 ? formatPace(pace) : '—'}</M>
            {s.averageHeartrate && <M color="$textTertiary" fontSize={13}>HR {Math.round(s.averageHeartrate)}</M>}
          </XStack>
        );
      })}
    </YStack>
  );
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { workouts, weeks, markWorkoutComplete, markWorkoutSkipped, fetchPostRunAnalysis, postRunAnalysis } = useAppStore();
  const [metric, setMetric] = useState<PerformanceMetric | null>(null);

  const workout = workouts.find(w => w.id === id);
  const week = workout ? weeks.find(w => w.week_number === workout.week_number) : null;

  useEffect(() => {
    if (!workout) return;
    try { const { getMetricsForWorkout } = require('../../src/db/database'); const m = getMetricsForWorkout(workout.id); if (m.length > 0) setMetric(m[0]); } catch {}
  }, [workout?.id, workout?.status]);

  if (!workout) return <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center"><B color="$textSecondary" fontSize={16}>Workout not found</B></YStack>;

  const isRest = workout.workout_type === 'rest';
  const isUpcoming = workout.status === 'upcoming';
  const intervals: IntervalStep[] | null = workout.intervals_json ? JSON.parse(workout.intervals_json) : null;
  const statusColor = workout.status === 'completed' ? '$success' : workout.status === 'skipped' ? '$danger' : workout.status === 'modified' ? '$warning' : '$textTertiary';

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }}>
      {/* Header */}
      <YStack marginBottom="$5">
        {week && (
          <XStack alignItems="center" gap="$1" marginBottom="$1">
            <View width={8} height={8} borderRadius={4} backgroundColor={PHASE_COLORS[week.phase] || '#666'} />
            <B color="$textSecondary" fontSize={13} textTransform="capitalize">Week {week.week_number} — {week.phase}</B>
          </XStack>
        )}
        <B color="$textSecondary" fontSize={14} marginBottom="$1">{formatDateLong(workout.scheduled_date)}</B>
        <H color="$color" fontSize={28} letterSpacing={1} marginBottom="$3">{workout.title}</H>
        <XStack alignItems="center" gap="$3" flexWrap="wrap">
          <H color="$accent" fontSize={13} letterSpacing={1} backgroundColor="$accentMuted" paddingHorizontal="$3" paddingVertical="$1" borderRadius="$3">
            {WORKOUT_TYPE_LABELS[workout.workout_type] || workout.workout_type}
          </H>
          {workout.target_distance_miles != null && workout.target_distance_miles > 0 && (
            <M color="$color" fontSize={15} fontWeight="700">{workout.target_distance_miles} mi</M>
          )}
          {workout.target_pace_zone && <B color="$textSecondary" fontSize={13}>{workout.target_pace_zone} zone</B>}
          <YStack borderWidth={1} borderColor={statusColor} borderRadius="$2" paddingHorizontal="$2" paddingVertical={2}>
            <H color={statusColor} fontSize={11} textTransform="uppercase" letterSpacing={1}>{workout.status}</H>
          </YStack>
        </XStack>
      </YStack>

      {/* Description */}
      {!isRest && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={0.5} borderColor="$border">
          <B color="$color" fontSize={15} fontWeight="600" marginBottom="$3">Workout Details</B>
          <B color="$textSecondary" fontSize={15} lineHeight={22}>{workout.description}</B>
        </YStack>
      )}

      {/* Intervals */}
      {intervals && intervals.length > 0 && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={0.5} borderColor="$border">
          <B color="$color" fontSize={15} fontWeight="600" marginBottom="$3">Intervals</B>
          {intervals.map((step, i) => (
            <YStack key={i} paddingVertical="$2" borderBottomWidth={0.5} borderBottomColor="$border">
              <H color="$accent" fontSize={11} letterSpacing={1} marginBottom={2}>{step.type.toUpperCase()}</H>
              <M color="$color" fontSize={14}>{step.distance_miles > 0 ? `${step.distance_miles}mi` : ''} @ {step.pace_zone}</M>
              {step.description ? <B color="$textSecondary" fontSize={13} marginTop={2}>{step.description}</B> : null}
            </YStack>
          ))}
        </YStack>
      )}

      {/* Performance */}
      {metric && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={0.5} borderColor="$border">
          <B color="$color" fontSize={15} fontWeight="600" marginBottom="$3">Actual Performance</B>
          <XStack flexWrap="wrap" gap="$3">
            <StatBox label="Distance" value={`${metric.distance_miles.toFixed(1)} mi`} />
            <StatBox label="Duration" value={`${(metric.duration_minutes ?? 0).toFixed(0)} min`} />
            <StatBox label="Avg Pace" value={metric.avg_pace_sec_per_mile ? `${formatPace(metric.avg_pace_sec_per_mile)}/mi` : '—'} />
            {metric.avg_hr ? <StatBox label="Avg HR" value={`${metric.avg_hr} bpm`} /> : null}
            {metric.max_hr ? <StatBox label="Max HR" value={`${metric.max_hr} bpm`} /> : null}
            {metric.perceived_exertion ? <StatBox label="RPE" value={`${metric.perceived_exertion}/10`} /> : null}
          </XStack>
          {metric.gear_name && <B color="$textTertiary" fontSize={13} marginTop="$3">Shoes: {metric.gear_name}</B>}
        </YStack>
      )}

      {/* Splits */}
      {metric?.splits_json && <SplitsCard splitsJson={metric.splits_json} />}

      {/* Analysis */}
      {postRunAnalysis && workout.status === 'completed' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={1} borderColor="$accent">
          <B color="$color" fontSize={15} fontWeight="600" marginBottom="$3">Coach Analysis</B>
          <B color="$textSecondary" fontSize={14} lineHeight={21}>{postRunAnalysis}</B>
        </YStack>
      )}

      {/* Modification */}
      {workout.modification_reason && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3" borderWidth={0.5} borderColor="$border">
          <B color="$warning" fontSize={13} fontStyle="italic">Modified: {workout.modification_reason}</B>
          {workout.original_distance_miles != null && <B color="$warning" fontSize={13}>Original: {workout.original_distance_miles} mi</B>}
        </YStack>
      )}

      {/* Actions */}
      {isUpcoming && !isRest && (
        <XStack gap="$3" marginTop="$2">
          <YStack flex={1} backgroundColor="$success" paddingVertical="$3" borderRadius="$5" alignItems="center"
            pressStyle={{ opacity: 0.8 }} onPress={() => Alert.alert('Mark Complete', 'Mark as completed?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Complete', onPress: () => { markWorkoutComplete(workout.id); fetchPostRunAnalysis(workout.id); } },
            ])}>
            <B color="white" fontSize={16} fontWeight="700">Mark Complete</B>
          </YStack>
          <YStack flex={1} backgroundColor="$surfaceLight" paddingVertical="$3" borderRadius="$5" alignItems="center"
            pressStyle={{ opacity: 0.8 }} onPress={() => Alert.alert('Skip', 'Skip this workout?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Skip', style: 'destructive', onPress: () => markWorkoutSkipped(workout.id) },
            ])}>
            <B color="$textSecondary" fontSize={16} fontWeight="600">Skip</B>
          </YStack>
        </XStack>
      )}

      <YStack height={40} />
    </ScrollView>
  );
}
