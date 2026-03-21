/**
 * Post-Run Summary Modal — celebration screen after Strava auto-completes a workout.
 * Shows actual stats, route map, splits, vs-plan comparison, and AI analysis.
 */

import { useEffect, useState, useMemo } from 'react';
import { ScrollView as RNScrollView, Pressable, Dimensions } from 'react-native';
import { YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store';
import { PerformanceMetric, Workout } from '../src/types';
import { formatPace } from '../src/engine/vdot';
import { colors } from '../src/theme/colors';
import { GradientText } from '../src/theme/GradientText';
import { GradientButton } from '../src/theme/GradientButton';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RouteMap } from '../src/components/RouteMap';
import { formatPRTime } from '../src/utils/personalRecords';
import { GradientBorder } from '../src/theme/GradientBorder';
import { PRBadge } from '../src/components/PRBadge';
import { useUnits } from '../src/hooks/useUnits';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const { width: SCREEN_W } = Dimensions.get('window');

export default function PostRunModal() {
  const u = useUnits();
  const router = useRouter();
  const summary = useAppStore(s => s.pendingPostRunSummary);
  const postRunAnalysis = useAppStore(s => s.postRunAnalysis);

  const [workout, setWorkout] = useState<Workout | null>(null);
  const [metric, setMetric] = useState<PerformanceMetric | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [splits, setSplits] = useState<any[]>([]);

  useEffect(() => {
    if (!summary) return;
    try {
      const { getDatabase } = require('../src/db/database');
      const db = getDatabase();

      const w = db.getFirstSync(`SELECT * FROM workout WHERE id = ?`, [summary.workoutId]);
      if (w) setWorkout(w as Workout);

      const m = db.getFirstSync(`SELECT * FROM performance_metric WHERE id = ?`, [summary.metricId]);
      if (m) {
        setMetric(m as PerformanceMetric);
        if (m.splits_json) {
          try { setSplits(JSON.parse(m.splits_json)); } catch {}
        }
      }

      // Get strava detail for extra data (elevation, calories, polyline)
      if (m?.strava_activity_id) {
        const d = db.getFirstSync(`SELECT * FROM strava_activity_detail WHERE strava_activity_id = ?`, [m.strava_activity_id]);
        if (d) setDetail(d);
      }
    } catch {}
  }, [summary?.workoutId]);

  // Save on unmount — covers both button tap AND swipe-to-dismiss
  useEffect(() => {
    return () => {
      if (summary) {
        try {
          const { setSetting } = require('../src/db/database');
          setSetting('last_shown_summary_workout_id', summary.workoutId);
        } catch {}
        useAppStore.setState({ pendingPostRunSummary: null });
      }
    };
  }, [summary?.workoutId]);

  // Parse Strava streams for RouteMap color modes
  const parsedStreams = useMemo(() => {
    const parse = (json: string | null | undefined): number[] | undefined => {
      if (!json) return undefined;
      try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr : undefined; } catch { return undefined; }
    };
    return {
      hr: parse(detail?.hr_stream_json),
      pace: parse(detail?.pace_stream_json),
      elevation: parse(detail?.elevation_stream_json),
    };
  }, [detail]);

  const handleDismiss = () => {
    router.back();
  };

  if (!summary || !metric) {
    return (
      <YStack flex={1} backgroundColor={colors.background} justifyContent="center" alignItems="center">
        <Spinner size="large" color={colors.cyan} />
      </YStack>
    );
  }

  const distance = metric.distance_miles;
  const pace = metric.avg_pace_sec_per_mile ? u.pace(metric.avg_pace_sec_per_mile) : '--';
  const duration = metric.duration_minutes;
  const durationStr = duration ? `${Math.floor(duration)}:${String(Math.round((duration % 1) * 60)).padStart(2, '0')}` : '--';
  const hr = metric.avg_hr;
  const elevation = detail?.elevation_gain_ft;
  const calories = detail?.calories;
  const targetDist = workout?.target_distance_miles;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, borderTopWidth: 0.5, borderTopColor: colors.border }}>
    {/* Drag handle */}
    <YStack alignItems="center" paddingTop={10} paddingBottom={6}>
      <View width={36} height={4} borderRadius={2} backgroundColor={colors.textTertiary} opacity={0.5} />
    </YStack>
    {/* Dismiss button */}
    <Pressable onPress={handleDismiss} hitSlop={12}
      style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name="close" size={16} color={colors.textSecondary} />
    </Pressable>
    <RNScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* Section 1: Hero Stats */}
      <YStack alignItems="center" paddingTop={40} paddingBottom={32} paddingHorizontal={24}>
        <MaterialCommunityIcons name="check-circle" size={48} color={colors.cyan} />
        <H color={colors.cyan} fontSize={16} letterSpacing={2} marginTop={12}>RUN COMPLETE</H>

        {/* Primary stats row */}
        <XStack marginTop={24} gap={24} justifyContent="center">
          <YStack alignItems="center">
            <GradientText text={String(u.rawDist(distance).toFixed(1))} style={{ fontSize: 36, fontWeight: '800' }} />
            <B color={colors.textSecondary} fontSize={11} marginTop={2}>{u.distLabel}</B>
          </YStack>
          <YStack alignItems="center">
            <GradientText text={pace} style={{ fontSize: 36, fontWeight: '800' }} />
            <B color={colors.textSecondary} fontSize={11} marginTop={2}>avg pace</B>
          </YStack>
          <YStack alignItems="center">
            <GradientText text={durationStr} style={{ fontSize: 36, fontWeight: '800' }} />
            <B color={colors.textSecondary} fontSize={11} marginTop={2}>duration</B>
          </YStack>
        </XStack>

        {/* Secondary stats row */}
        <XStack marginTop={20} gap={24} justifyContent="center">
          {hr ? (
            <YStack alignItems="center">
              <M color={colors.orange} fontSize={22} fontWeight="800">{hr}</M>
              <B color={colors.textTertiary} fontSize={10} marginTop={2}>avg HR</B>
            </YStack>
          ) : null}
          {calories ? (
            <YStack alignItems="center">
              <M color={colors.textPrimary} fontSize={22} fontWeight="700">{calories}</M>
              <B color={colors.textTertiary} fontSize={10} marginTop={2}>calories</B>
            </YStack>
          ) : null}
          {elevation ? (
            <YStack alignItems="center">
              <M color={colors.textPrimary} fontSize={22} fontWeight="700">+{u.elev(elevation)}</M>
              <B color={colors.textTertiary} fontSize={10} marginTop={2}>elevation</B>
            </YStack>
          ) : null}
        </XStack>
      </YStack>

      {/* Section 2: Route Map */}
      {detail?.polyline_encoded && (
        <YStack marginHorizontal={16} marginBottom={12} borderRadius={14} overflow="hidden">
          <RouteMap
            polyline={detail.polyline_encoded}
            height={220}
            strokeWidth={4}
            showGradient
            showMarkers
            showReplay
            totalDistanceMiles={metric?.distance_miles}
            totalDurationSec={metric?.duration_minutes ? metric.duration_minutes * 60 : undefined}
            hrStream={parsedStreams.hr}
            paceStream={parsedStreams.pace}
            elevationStream={parsedStreams.elevation}
          />
        </YStack>
      )}

      {/* Section 3: vs Plan Comparison */}
      {workout && targetDist && (
        <YStack backgroundColor={colors.surface} borderRadius={14} marginHorizontal={16} padding={16} marginBottom={12}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} marginBottom={12}>VS PLAN</H>
          <XStack justifyContent="space-between">
            <YStack flex={1}>
              <B color={colors.textTertiary} fontSize={11} marginBottom={4}>PLANNED</B>
              <M color={colors.textSecondary} fontSize={16} fontWeight="700">{u.dist(targetDist)}</M>
              <B color={colors.textTertiary} fontSize={11} marginTop={2}>{workout.title}</B>
            </YStack>
            <YStack width={1} backgroundColor={colors.border} marginHorizontal={12} />
            <YStack flex={1} alignItems="flex-end">
              <B color={colors.textTertiary} fontSize={11} marginBottom={4}>ACTUAL</B>
              <M color={colors.textPrimary} fontSize={16} fontWeight="700">{u.dist(distance)}</M>
              <B color={Math.abs(distance - targetDist) <= 0.3 ? colors.cyan : colors.orange} fontSize={11} marginTop={2}>
                {distance > targetDist ? `+${((distance / targetDist - 1) * 100).toFixed(0)}%` : distance < targetDist ? `${((distance / targetDist - 1) * 100).toFixed(0)}%` : 'on target'}
              </B>
            </YStack>
          </XStack>
        </YStack>
      )}

      {/* Section 3: Splits */}
      {splits.length >= 2 && (
        <YStack backgroundColor={colors.surface} borderRadius={14} marginHorizontal={16} padding={16} marginBottom={12}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} marginBottom={12}>SPLITS</H>
          {splits.map((split: any, i: number) => {
            // Handle both camelCase (from our mapper) and snake_case (raw Strava)
            const avgSpeed = split.averageSpeed ?? split.average_speed ?? 0;
            const movTime = split.movingTime ?? split.moving_time ?? 0;
            const dist = split.distance ?? 0;
            const avgHr = split.averageHeartrate ?? split.average_heartrate ?? null;
            const secPerMile = avgSpeed > 0 ? Math.round(1609.344 / avgSpeed) : movTime && dist ? Math.round((movTime / dist) * 1609.344) : 0;
            const splitPace = secPerMile > 0 ? u.pace(secPerMile) : '--';
            const splitDist = dist ? (dist / 1609.344).toFixed(1) : '--';
            return (
              <XStack key={i} paddingVertical={8} borderBottomWidth={i < splits.length - 1 ? 0.5 : 0} borderBottomColor={colors.border} alignItems="center">
                <M color={colors.textTertiary} fontSize={12} width={50}>{Number(splitDist) >= 0.9 ? `Mile ${i + 1}` : `${splitDist} mi`}</M>
                <M color={colors.textPrimary} fontSize={14} fontWeight="700" flex={1} textAlign="center">{splitPace}</M>
                {avgHr ? (
                  <M color={colors.orange} fontSize={12} width={60} textAlign="right">{Math.round(avgHr)} bpm</M>
                ) : <View width={60} />}
              </XStack>
            );
          })}
        </YStack>
      )}

      {/* Section 4: Best Efforts / PRs */}
      {metric.best_efforts_json && (() => {
        try {
          const efforts = JSON.parse(metric.best_efforts_json);
          const prs = efforts.filter((e: any) => e.prRank === 1);
          if (prs.length === 0) return null;

          // Find previous bests from store
          const allPRs = useAppStore.getState().personalRecords;

          return (
            <GradientBorder side="all" borderRadius={14} borderWidth={1.5} style={{ marginHorizontal: 16, marginBottom: 12 }}>
              <YStack backgroundColor={colors.surface} borderRadius={14} padding={16}>
                <XStack alignItems="center" gap={8} marginBottom={12}>
                  <MaterialCommunityIcons name="trophy" size={18} color={colors.cyan} />
                  <H color={colors.cyan} fontSize={12} letterSpacing={1.5}>NEW PERSONAL RECORDS</H>
                </XStack>
                {prs.map((pr: any, i: number) => {
                  const time = pr.movingTime ?? pr.elapsedTime ?? 0;
                  const prev = allPRs.find((p: any) => p.distance === pr.name && p.timeSeconds > time);
                  return (
                    <YStack key={i} paddingVertical={6}>
                      <XStack alignItems="center" gap={8}>
                        <PRBadge rank={1} />
                        <B color={colors.textPrimary} fontSize={14} fontWeight="600" flex={1}>{pr.name}</B>
                        <M color={colors.cyan} fontSize={17} fontWeight="800">{formatPRTime(time)}</M>
                      </XStack>
                      {prev ? (
                        <B color={colors.textTertiary} fontSize={11} marginTop={2} marginLeft={42}>
                          Previous: {formatPRTime(prev.timeSeconds)}{prev.date ? ` (${new Date(prev.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}
                        </B>
                      ) : (
                        <B color={colors.cyan} fontSize={11} marginTop={2} marginLeft={42}>First recorded {pr.name}!</B>
                      )}
                    </YStack>
                  );
                })}
              </YStack>
            </GradientBorder>
          );
        } catch { return null; }
      })()}

      {/* Section 5: Shoe */}
      {metric.gear_name && (
        <YStack backgroundColor={colors.surface} borderRadius={14} marginHorizontal={16} padding={16} marginBottom={12}>
          <XStack alignItems="center" gap={8}>
            <MaterialCommunityIcons name="shoe-sneaker" size={18} color={colors.textSecondary} />
            <B color={colors.textPrimary} fontSize={14}>{metric.gear_name}</B>
          </XStack>
        </YStack>
      )}

      {/* Section 6: AI Analysis */}
      {postRunAnalysis && (
        <YStack backgroundColor={colors.surface} borderRadius={14} marginHorizontal={16} padding={16} marginBottom={12} borderLeftWidth={3} borderLeftColor={colors.cyan}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} marginBottom={8}>COACH ANALYSIS</H>
          <B color={colors.textPrimary} fontSize={14} lineHeight={21}>{postRunAnalysis}</B>
        </YStack>
      )}

      {/* Done button */}
      <YStack paddingHorizontal={16} marginTop={8} marginBottom={32}>
        <GradientButton label="Done" onPress={handleDismiss} size="lg" />

        {detail?.strava_activity_id && (
          <Pressable style={{ alignItems: 'center', marginTop: 12 }} onPress={() => {
            try {
              const { Linking } = require('react-native');
              Linking.openURL(`https://www.strava.com/activities/${detail.strava_activity_id}`);
            } catch {}
          }}>
            <B color={colors.textTertiary} fontSize={13}>View on Strava →</B>
          </Pressable>
        )}
      </YStack>
    </RNScrollView>
    </View>
  );
}
