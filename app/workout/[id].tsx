/**
 * Workout Detail Screen — Tamagui migration.
 */
import { useEffect, useState, useMemo } from 'react';
import { Alert, Pressable } from 'react-native';
import { ScrollView, YStack, XStack, Text, View } from 'tamagui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { colors, phaseColors } from '../../src/theme/colors';
import { formatDateLong } from '../../src/utils/dateUtils';
import { formatPace } from '../../src/engine/vdot';
import { PerformanceMetric, IntervalStep } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { METRIC_ICONS } from '../../src/utils/workoutIcons';
import { useUnits } from '../../src/hooks/useUnits';
import { GradientText } from '../../src/theme/GradientText';
import { formatTime } from '../../src/engine/vdot';
import { RouteMap } from '../../src/components/RouteMap';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const STAT_ICON_MAP: Record<string, string> = { Distance: METRIC_ICONS.distance, Duration: METRIC_ICONS.duration, 'Avg Pace': METRIC_ICONS.pace, 'Avg HR': METRIC_ICONS.hr, 'Max HR': METRIC_ICONS.hr, RPE: METRIC_ICONS.rpe };

function StatBox({ label, value }: { label: string; value: string }) {
  const icon = STAT_ICON_MAP[label];
  return (
    <YStack minWidth={80} backgroundColor="$surfaceLight" borderRadius="$4" padding="$3" alignItems="center">
      {icon && <MaterialCommunityIcons name={icon as any} size={14} color={colors.cyan} style={{ marginBottom: 2 }} />}
      <M color="$color" fontSize={16} fontWeight="700">{value}</M>
      <H color="$textSecondary" fontSize={11} letterSpacing={1} marginTop={2}>{label}</H>
    </YStack>
  );
}

function SplitsCard({ splitsJson }: { splitsJson: string }) {
  const u = useUnits();
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
            <M color="$color" fontSize={14} fontWeight="600" width={60}>{pace > 0 ? u.pace(pace) : '—'}</M>
            {s.averageHeartrate && <M color="$textTertiary" fontSize={13}>HR {Math.round(s.averageHeartrate)}</M>}
          </XStack>
        );
      })}
    </YStack>
  );
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const u = useUnits();
  const { workouts, weeks, markWorkoutComplete, markWorkoutSkipped, fetchPostRunAnalysis, postRunAnalysis } = useAppStore();
  const [metric, setMetric] = useState<PerformanceMetric | null>(null);
  const [stravaDetail, setStravaDetail] = useState<any>(null);

  const workout = workouts.find(w => w.id === id);
  const week = workout ? weeks.find(w => w.week_number === workout.week_number) : null;

  useEffect(() => {
    if (!workout) return;
    try {
      const { getMetricsForWorkout, getDatabase } = require('../../src/db/database');
      const m = getMetricsForWorkout(workout.id);
      if (m.length > 0) {
        setMetric(m[0]);
        // Load Strava detail for route map
        const db = getDatabase();
        const d = m[0].strava_activity_id
          ? db.getFirstSync('SELECT polyline_encoded, summary_polyline_encoded, hr_stream_json, pace_stream_json, elevation_stream_json FROM strava_activity_detail WHERE strava_activity_id = ?', [m[0].strava_activity_id])
          : db.getFirstSync('SELECT polyline_encoded, summary_polyline_encoded, hr_stream_json, pace_stream_json, elevation_stream_json FROM strava_activity_detail WHERE performance_metric_id = ?', [m[0].id]);
        if (d) setStravaDetail(d);
      }
    } catch {}
  }, [workout?.id, workout?.status]);

  // Parse streams for RouteMap
  const parsedStreams = useMemo(() => {
    const parse = (json: string | null | undefined): number[] | undefined => {
      if (!json) return undefined;
      try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr : undefined; } catch { return undefined; }
    };
    return {
      hr: parse(stravaDetail?.hr_stream_json),
      pace: parse(stravaDetail?.pace_stream_json),
      elevation: parse(stravaDetail?.elevation_stream_json),
    };
  }, [stravaDetail]);

  const routePolyline = stravaDetail?.polyline_encoded || stravaDetail?.summary_polyline_encoded || null;

  if (!workout) return <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center"><B color="$textSecondary" fontSize={16}>Workout not found</B></YStack>;

  const isRest = workout.workout_type === 'rest';
  const isUpcoming = workout.status === 'upcoming';
  const intervals: IntervalStep[] | null = workout.intervals_json ? JSON.parse(workout.intervals_json) : null;
  const statusColor = workout.status === 'completed' ? '$success' : workout.status === 'skipped' ? '$danger' : workout.status === 'modified' ? '$warning' : '$textTertiary';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, borderTopWidth: 0.5, borderTopColor: colors.border }}>
    {/* Drag handle */}
    <YStack alignItems="center" paddingTop={10} paddingBottom={15}>
      <View width={36} height={4} borderRadius={2} backgroundColor={colors.textTertiary} opacity={0.5} />
    </YStack>
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16, paddingTop: 0 }}>
      {/* ─── Compact Header ────────────────────────────────── */}
      <YStack marginBottom={12} gap={3}>
        {/* Row 1: Title + date + dismiss */}
        <XStack justifyContent="space-between" alignItems="center">
          <H fontSize={22} letterSpacing={0.8} color={colors.textPrimary} flex={1} numberOfLines={1}>
            {workout.title}
          </H>
          <XStack alignItems="center" gap={12}>
            <B fontSize={12} color={colors.textTertiary}>
              {new Date(workout.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </B>
            <Pressable onPress={() => router.back()} hitSlop={12}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </XStack>
        </XStack>

        {/* Row 2: Badges inline */}
        <XStack alignItems="center" gap={6} flexWrap="wrap">
          {week && (
            <View paddingHorizontal={7} paddingVertical={2} borderRadius={5} backgroundColor={colors.surfaceHover} borderWidth={0.5} borderColor={colors.border}>
              <B fontSize={10} color={colors.textTertiary}>Wk {week.week_number} · {week.phase}</B>
            </View>
          )}
          <View paddingHorizontal={7} paddingVertical={2} borderRadius={5} backgroundColor={colors.cyanGhost} borderWidth={0.5} borderColor={colors.cyanDim}>
            <H fontSize={10} color={colors.cyan} letterSpacing={0.5}>{WORKOUT_TYPE_LABELS[workout.workout_type] || workout.workout_type}</H>
          </View>
          {workout.target_distance_miles != null && workout.target_distance_miles > 0 && (
            <M color={colors.textPrimary} fontSize={13} fontWeight="700">{u.dist(workout.target_distance_miles)}</M>
          )}
          {workout.target_pace_zone && <B color={colors.textTertiary} fontSize={11}>{workout.target_pace_zone} zone</B>}
          <View paddingHorizontal={6} paddingVertical={2} borderRadius={5} borderWidth={1} borderColor={statusColor}>
            <H color={statusColor} fontSize={9} textTransform="uppercase" letterSpacing={0.8}>{workout.status}</H>
          </View>
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

      {/* Route Map */}
      {routePolyline && metric && (
        <YStack marginBottom="$3" borderRadius={14} overflow="hidden">
          <RouteMap
            polyline={routePolyline}
            height={200}
            strokeWidth={4}
            showGradient
            showMarkers
            showReplay
            totalDistanceMiles={metric.distance_miles}
            totalDurationSec={metric.duration_minutes ? metric.duration_minutes * 60 : undefined}
            hrStream={parsedStreams.hr}
            paceStream={parsedStreams.pace}
            elevationStream={parsedStreams.elevation}
          />
        </YStack>
      )}

      {/* ─── Hero Stats (exact match: activity detail) ─── */}
      {metric && (
        <XStack marginBottom={12} justifyContent="space-between">
          <YStack flex={1} backgroundColor={colors.surface} borderRadius={12} padding={12} alignItems="center" marginRight={6}>
            <MaterialCommunityIcons name="map-marker-distance" size={16} color={colors.cyan} />
            <GradientText text={String(u.rawDist(metric.distance_miles).toFixed(1))} style={{ fontSize: 28, fontWeight: '800' }} />
            <B color={colors.textTertiary} fontSize={10}>{u.distLabel}</B>
          </YStack>
          <YStack flex={1} backgroundColor={colors.surface} borderRadius={12} padding={12} alignItems="center" marginHorizontal={3}>
            <MaterialCommunityIcons name="timer-outline" size={16} color={colors.textSecondary} />
            <M fontSize={(() => {
              const dur = metric.duration_minutes > 0 ? formatTime(metric.duration_minutes * 60) : '--';
              return dur.length > 5 ? 22 : 28;
            })()} color={colors.textPrimary} fontWeight="800" marginTop={2} numberOfLines={1} adjustsFontSizeToFit>
              {metric.duration_minutes > 0 ? formatTime(metric.duration_minutes * 60) : '--'}
            </M>
            <B color={colors.textTertiary} fontSize={10}>duration</B>
          </YStack>
          <YStack flex={1} backgroundColor={colors.surface} borderRadius={12} padding={12} alignItems="center" marginLeft={6}>
            <MaterialCommunityIcons name="speedometer" size={16} color={colors.cyan} />
            <M fontSize={28} color={colors.cyan} fontWeight="800" marginTop={2}>
              {metric.avg_pace_sec_per_mile ? u.pace(metric.avg_pace_sec_per_mile) : '--'}
            </M>
            <B color={colors.textTertiary} fontSize={10}>{u.paceSuffix}</B>
          </YStack>
        </XStack>
      )}

      {/* ─── Secondary Stats (exact match: activity detail) ─── */}
      {metric && (() => {
        const stats: { icon: string; iconColor: string; value: string; unit: string; label: string; isHR?: boolean }[] = [];
        if (metric.avg_hr != null) stats.push({ icon: 'heart-pulse', iconColor: colors.orange, value: `${Math.round(metric.avg_hr)}`, unit: 'bpm', label: 'Avg HR', isHR: true });
        if (metric.max_hr != null) stats.push({ icon: 'heart-pulse', iconColor: colors.orange, value: `${Math.round(metric.max_hr)}`, unit: 'bpm', label: 'Max HR', isHR: true });
        if (metric.perceived_exertion != null) stats.push({ icon: 'gauge', iconColor: colors.cyan, value: `${metric.perceived_exertion}`, unit: '/10', label: 'RPE' });
        if (stats.length === 0) return null;
        return (
          <XStack gap={6} marginBottom={12} flexWrap="wrap">
            {stats.map((s, i) => (
              <YStack key={i} backgroundColor={colors.surface} borderRadius={10} paddingVertical={8} paddingHorizontal={10} flex={1} minWidth={90}>
                <XStack alignItems="center" gap={4} marginBottom={3}>
                  <MaterialCommunityIcons name={s.icon as any} size={12} color={s.iconColor} />
                  <H fontSize={8} color={colors.textTertiary} textTransform="uppercase" letterSpacing={1}>{s.label}</H>
                </XStack>
                <M fontSize={15} color={s.isHR ? colors.orange : colors.textPrimary} fontWeight="700">
                  {s.value}{s.unit ? <M fontSize={10} color={colors.textTertiary}> {s.unit}</M> : null}
                </M>
              </YStack>
            ))}
          </XStack>
        );
      })()}

      {/* Shoe */}
      {metric?.gear_name && (
        <XStack marginBottom={12} backgroundColor={colors.surface} borderRadius={12} padding={14} alignItems="center" gap={8}>
          <MaterialCommunityIcons name="shoe-sneaker" size={16} color={colors.cyan} />
          <B color={colors.textPrimary} fontSize={13} fontWeight="600">{metric.gear_name}</B>
        </XStack>
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
          {workout.original_distance_miles != null && <B color="$warning" fontSize={13}>Original: {u.dist(workout.original_distance_miles)}</B>}
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
    </View>
  );
}
