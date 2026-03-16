/**
 * Activity Detail Screen — full Strava activity data with interactive map.
 * Opens as a modal from the Runs tab.
 */

import { useEffect, useState, useMemo } from 'react';
import { Text, YStack, XStack, ScrollView, Spinner, View } from 'tamagui';
import { useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../src/utils/constants';
import { formatPace, formatTime } from '../../src/engine/vdot';
import { PerformanceMetric } from '../../src/types';
import { RouteMap } from '../../src/components/RouteMap';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Types ──────────────────────────────────────────────────

interface StravaDetail {
  polyline_encoded: string | null;
  summary_polyline_encoded: string | null;
  splits_json: string | null;
  laps_json: string | null;
  hr_stream_json: string | null;
  pace_stream_json: string | null;
  elevation_gain_ft: number | null;
  elevation_stream_json: string | null;
  calories: number | null;
  cadence_avg: number | null;
  suffer_score: number | null;
  device_name: string | null;
  best_efforts_json: string | null;
  gear_name: string | null;
  perceived_exertion: number | null;
  activity_name: string | null;
  activity_type: string | null;
  description: string | null;
  segment_efforts_json: string | null;
  timezone: string | null;
  utc_offset: number | null;
  moving_time_sec: number | null;
  elapsed_time_sec: number | null;
}

interface Split {
  split: number;
  distance: number;
  movingTime: number;
  averageSpeed: number;
  averageHeartrate: number | null;
}

interface Lap {
  name: string;
  distance: number;
  movingTime: number;
  averageSpeed: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  lapIndex: number;
}

interface BestEffort {
  name: string;
  distance: number;
  movingTime: number;
  prRank: number | null;
}

interface SegmentEffort {
  name: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  prRank: number | null;
  komRank: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function safeParseJSON(json: string | null | undefined): any[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

const GRID_ICON_MAP: Record<string, string> = {
  'Avg HR': 'heart-pulse',
  'Max HR': 'heart-pulse',
  'Elevation': 'terrain',
  'Calories': 'fire',
  'Cadence': 'shoe-print',
  'Rel. Effort': 'lightning-bolt',
  'RPE': 'gauge',
  'Moving': 'timer-outline',
};

// ─── Sub-components ─────────────────────────────────────────

function PrimaryStat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <YStack flex={1} alignItems="center">
      <XStack alignItems="baseline">
        <M fontSize={24} color={COLORS.text} fontWeight="800">{value}</M>
        {unit ? <M fontSize={14} color={COLORS.textSecondary} fontWeight="600" marginLeft={2}>{unit}</M> : null}
      </XStack>
      <H fontSize={11} color={COLORS.textTertiary} textTransform="uppercase" letterSpacing={1} marginTop={4}>{label}</H>
    </YStack>
  );
}

function GridStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  const icon = GRID_ICON_MAP[label];
  return (
    <YStack backgroundColor={COLORS.surface} borderRadius={10} paddingVertical={10} paddingHorizontal={14} minWidth="30%" flexGrow={1}>
      {icon && <MaterialCommunityIcons name={icon as any} size={13} color={COLORS.accent} style={{ marginBottom: 2 }} />}
      <M fontSize={16} color={COLORS.text} fontWeight="700">
        {value}<M fontSize={12} color={COLORS.textTertiary}> {unit}</M>
      </M>
      <H fontSize={10} color={COLORS.textTertiary} textTransform="uppercase" letterSpacing={1} marginTop={2}>{label}</H>
    </YStack>
  );
}

// ─── Component ──────────────────────────────────────────────

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [metric, setMetric] = useState<PerformanceMetric | null>(null);
  const [detail, setDetail] = useState<StravaDetail | null>(null);
  const [workoutTitle, setWorkoutTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    try {
      const db = require('../../src/db/database');
      // id could be a metric ID or strava activity ID
      const database = db.getDatabase();
      let m = database.getFirstSync('SELECT * FROM performance_metric WHERE id = ?', id) as PerformanceMetric | null;
      if (!m) {
        m = database.getFirstSync('SELECT * FROM performance_metric WHERE strava_activity_id = ?', Number(id)) as PerformanceMetric | null;
      }
      if (m) {
        setMetric(m);
        // Try by metric ID first, then by strava_activity_id
        let d = db.getStravaDetailForMetric(m.id);
        if (!d && m.strava_activity_id) {
          d = db.getStravaDetailByActivityId(m.strava_activity_id);
        }
        console.log(`[ActivityDetail] metric: strava_id=${m.strava_activity_id}, dur=${m.duration_minutes}, pace=${m.avg_pace_sec_per_mile}`);
        console.log(`[ActivityDetail] detail found: ${!!d}, polyline: ${!!d?.polyline_encoded || !!d?.summary_polyline_encoded}, splits: ${!!d?.splits_json}`);
        setDetail(d);
        if (m.workout_id) {
          const w = database.getFirstSync('SELECT title FROM workout WHERE id = ?', m.workout_id) as { title: string } | null;
          if (w) setWorkoutTitle(w.title);
        }
      }
    } catch (e) {
      console.warn('[ActivityDetail] Load failed:', e);
    }
  }, [id]);

  if (!metric) {
    return (
      <YStack flex={1} backgroundColor={COLORS.background} justifyContent="center" alignItems="center">
        <B color={COLORS.textSecondary} fontSize={16}>Activity not found</B>
      </YStack>
    );
  }

  const polyline = detail?.polyline_encoded || detail?.summary_polyline_encoded;
  const splits: Split[] = safeParseJSON(detail?.splits_json);
  const laps: Lap[] = safeParseJSON(detail?.laps_json);
  const bestEfforts: BestEffort[] = safeParseJSON(detail?.best_efforts_json);
  const segmentEfforts: SegmentEffort[] = safeParseJSON(detail?.segment_efforts_json);

  // Compute pace per split for min/max coloring
  const splitPaces = splits.map(s => s.averageSpeed > 0 ? 1609.344 / s.averageSpeed : 0).filter(p => p > 0);
  const minPace = splitPaces.length > 0 ? Math.min(...splitPaces) : 0;
  const maxPace = splitPaces.length > 0 ? Math.max(...splitPaces) : 0;

  return (
    <ScrollView flex={1} backgroundColor={COLORS.background} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <H fontSize={24} letterSpacing={1} color={COLORS.text} paddingHorizontal={16} paddingTop={16}>
        {detail?.activity_name || 'Run'}
      </H>
      <B fontSize={14} color={COLORS.textSecondary} paddingHorizontal={16} marginTop={4}>
        {new Date(metric.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        {detail?.timezone ? `  \u00B7  ${detail.timezone.replace(/_/g, ' ').split(') ').pop()}` : ''}
      </B>
      {workoutTitle && (
        <H fontSize={13} letterSpacing={1} color={COLORS.accent} paddingHorizontal={16} marginTop={6}>
          {workoutTitle}
        </H>
      )}

      {/* User's Strava description */}
      {detail?.description && (
        <B fontSize={14} color={COLORS.textSecondary} paddingHorizontal={16} marginTop={8} lineHeight={20} fontStyle="italic">
          {detail.description}
        </B>
      )}

      {/* Route Map */}
      {polyline && (
        <YStack marginTop={16} marginHorizontal={16}>
          <RouteMap polyline={polyline} height={250} strokeWidth={4} />
        </YStack>
      )}

      {/* Primary Stats */}
      <XStack marginTop={20} marginHorizontal={16} backgroundColor={COLORS.surface} borderRadius={14} padding={16}>
        <PrimaryStat value={`${metric.distance_miles.toFixed(2)}`} unit="mi" label="Distance" />
        <PrimaryStat
          value={metric.duration_minutes && metric.duration_minutes > 0
            ? formatTime(metric.duration_minutes * 60)
            : (detail?.moving_time_sec ? formatTime(detail.moving_time_sec) : '--')}
          unit=""
          label="Duration"
        />
        <PrimaryStat
          value={metric.avg_pace_sec_per_mile && metric.avg_pace_sec_per_mile > 0
            ? formatPace(metric.avg_pace_sec_per_mile)
            : (metric.duration_minutes && metric.distance_miles > 0
              ? formatPace(Math.round((metric.duration_minutes * 60) / metric.distance_miles))
              : '--')}
          unit="/mi"
          label="Avg Pace"
        />
      </XStack>

      {/* Secondary Stats Grid */}
      <XStack flexWrap="wrap" gap={8} marginTop={12} marginHorizontal={16}>
        {metric.avg_hr != null && <GridStat label="Avg HR" value={`${metric.avg_hr}`} unit="bpm" />}
        {metric.max_hr != null && <GridStat label="Max HR" value={`${metric.max_hr}`} unit="bpm" />}
        {detail?.elevation_gain_ft != null && <GridStat label="Elevation" value={`${Math.round(detail.elevation_gain_ft)}`} unit="ft" />}
        {detail?.calories != null && <GridStat label="Calories" value={`${detail.calories}`} unit="" />}
        {detail?.cadence_avg != null && <GridStat label="Cadence" value={`${Math.round(detail.cadence_avg * 2)}`} unit="spm" />}
        {detail?.suffer_score != null && <GridStat label="Rel. Effort" value={`${detail.suffer_score}`} unit="" />}
        {metric.perceived_exertion != null && <GridStat label="RPE" value={`${metric.perceived_exertion}`} unit="/10" />}
        {detail?.moving_time_sec != null && detail?.elapsed_time_sec != null && (
          <GridStat label="Moving" value={formatTime(detail.moving_time_sec)} unit="" />
        )}
      </XStack>

      {/* Gear + Device */}
      {(metric.gear_name || detail?.gear_name || detail?.device_name) && (
        <YStack marginTop={12} marginHorizontal={16} backgroundColor={COLORS.surface} borderRadius={10} padding={12}>
          {(metric.gear_name || detail?.gear_name) && (
            <B color={COLORS.textSecondary} fontSize={13} lineHeight={20}>Shoes: {metric.gear_name || detail?.gear_name}</B>
          )}
          {detail?.device_name && (
            <B color={COLORS.textSecondary} fontSize={13} lineHeight={20}>Device: {detail.device_name}</B>
          )}
        </YStack>
      )}

      {/* Splits */}
      {splits.length > 0 && (
        <YStack marginTop={20} marginHorizontal={16}>
          <H color={COLORS.textSecondary} fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom={10}>Splits</H>
          <YStack backgroundColor={COLORS.surface} borderRadius={12} overflow="hidden">
            {/* Header row */}
            <XStack paddingVertical={8} paddingHorizontal={12} borderBottomWidth={1} borderBottomColor={COLORS.border}>
              <H fontSize={11} letterSpacing={1} color={COLORS.textTertiary} textTransform="uppercase" width={40}>Mile</H>
              <H fontSize={11} letterSpacing={1} color={COLORS.textTertiary} textTransform="uppercase" width={60}>Pace</H>
              <H fontSize={11} letterSpacing={1} color={COLORS.textTertiary} textTransform="uppercase" width={50}>HR</H>
              <H fontSize={11} letterSpacing={1} color={COLORS.textTertiary} textTransform="uppercase" flex={1}>Bar</H>
            </XStack>
            {splits.map((s, i) => {
              const pace = s.averageSpeed > 0 ? 1609.344 / s.averageSpeed : 0;
              const paceNorm = maxPace > minPace && pace > 0 ? 1 - (pace - minPace) / (maxPace - minPace) : 0.5;
              const barColor = paceNorm > 0.6 ? COLORS.success : paceNorm > 0.3 ? COLORS.accent : COLORS.danger;
              return (
                <XStack key={i} alignItems="center" paddingVertical={8} paddingHorizontal={12} borderBottomWidth={0.5} borderBottomColor={COLORS.border}>
                  <M fontSize={13} color={COLORS.textSecondary} width={40}>{s.split || i + 1}</M>
                  <M fontSize={14} color={COLORS.text} fontWeight="600" width={60}>{pace > 0 ? formatPace(Math.round(pace)) : '\u2014'}</M>
                  <M fontSize={13} color={COLORS.textTertiary} width={50}>{s.averageHeartrate ? Math.round(s.averageHeartrate) : '\u2014'}</M>
                  <View flex={1}>
                    <View height={6} backgroundColor={COLORS.surfaceLight} borderRadius={3} overflow="hidden">
                      <View height="100%" borderRadius={3} width={`${Math.round(paceNorm * 100)}%`} backgroundColor={barColor} />
                    </View>
                  </View>
                </XStack>
              );
            })}
          </YStack>
        </YStack>
      )}

      {/* Laps */}
      {laps.length > 1 && (
        <YStack marginTop={20} marginHorizontal={16}>
          <H color={COLORS.textSecondary} fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom={10}>Laps</H>
          {laps.map((lap, i) => {
            const dist = (lap.distance / 1609.344).toFixed(2);
            const pace = lap.averageSpeed > 0 ? Math.round(1609.344 / lap.averageSpeed) : 0;
            return (
              <XStack key={i} justifyContent="space-between" alignItems="center" backgroundColor={COLORS.surface} borderRadius={10} padding={12} marginBottom={6}>
                <YStack flex={1}>
                  <B fontSize={14} color={COLORS.text} fontWeight="600">{lap.name || `Lap ${lap.lapIndex}`}</B>
                  <M fontSize={12} color={COLORS.textSecondary} marginTop={2}>{dist} mi · {formatTime(lap.movingTime)}</M>
                </YStack>
                <YStack alignItems="flex-end">
                  <M fontSize={14} color={COLORS.accent} fontWeight="700">{pace > 0 ? formatPace(pace) : '\u2014'}/mi</M>
                  {lap.averageHeartrate && <M fontSize={12} color={COLORS.textTertiary} marginTop={2}>{Math.round(lap.averageHeartrate)} bpm</M>}
                </YStack>
              </XStack>
            );
          })}
        </YStack>
      )}

      {/* Best Efforts */}
      {bestEfforts.length > 0 && (
        <YStack marginTop={20} marginHorizontal={16}>
          <H color={COLORS.textSecondary} fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom={10}>Best Efforts</H>
          {bestEfforts.map((e, i) => (
            <XStack key={i} justifyContent="space-between" alignItems="center" paddingVertical={8} borderBottomWidth={0.5} borderBottomColor={COLORS.border}>
              <XStack alignItems="center" gap={8}>
                <B fontSize={14} color={COLORS.text} fontWeight="500">{e.name}</B>
                {e.prRank === 1 && (
                  <YStack backgroundColor="rgba(255,149,0,0.2)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                    <H fontSize={11} color={COLORS.warning} letterSpacing={1}>PR</H>
                  </YStack>
                )}
                {e.prRank === 2 && (
                  <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                    <H fontSize={11} color={COLORS.textSecondary} letterSpacing={1}>2nd</H>
                  </YStack>
                )}
                {e.prRank === 3 && (
                  <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                    <H fontSize={11} color={COLORS.textSecondary} letterSpacing={1}>3rd</H>
                  </YStack>
                )}
              </XStack>
              <M fontSize={15} color={COLORS.accent} fontWeight="700">{formatTime(e.movingTime)}</M>
            </XStack>
          ))}
        </YStack>
      )}

      {/* Segment Efforts */}
      {segmentEfforts.length > 0 && (
        <YStack marginTop={20} marginHorizontal={16}>
          <H color={COLORS.textSecondary} fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom={10}>Segments</H>
          {segmentEfforts.map((seg, i) => {
            const dist = (seg.distance / 1609.344).toFixed(2);
            const pace = seg.distance > 0 && seg.movingTime > 0
              ? Math.round((seg.movingTime / seg.distance) * 1609.344)
              : 0;
            return (
              <YStack key={i} paddingVertical={10} borderBottomWidth={0.5} borderBottomColor={COLORS.border}>
                <XStack alignItems="center" gap={6} marginBottom={3} flexWrap="wrap">
                  <B fontSize={14} color={COLORS.text} fontWeight="600" flexShrink={1} numberOfLines={1}>{seg.name}</B>
                  {seg.prRank === 1 && (
                    <YStack backgroundColor="rgba(255,149,0,0.2)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                      <H fontSize={11} color={COLORS.warning} letterSpacing={1}>PR</H>
                    </YStack>
                  )}
                  {seg.prRank === 2 && (
                    <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                      <H fontSize={11} color={COLORS.textSecondary} letterSpacing={1}>2nd</H>
                    </YStack>
                  )}
                  {seg.prRank === 3 && (
                    <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                      <H fontSize={11} color={COLORS.textSecondary} letterSpacing={1}>3rd</H>
                    </YStack>
                  )}
                  {seg.komRank != null && seg.komRank <= 10 && (
                    <YStack backgroundColor="rgba(255, 215, 0, 0.2)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                      <H fontSize={10} color="#FFD700" letterSpacing={1}>KOM #{seg.komRank}</H>
                    </YStack>
                  )}
                </XStack>
                <M fontSize={12} color={COLORS.textSecondary}>
                  {dist} mi · {formatTime(seg.movingTime)}
                  {pace > 0 ? ` · ${formatPace(pace)}/mi` : ''}
                  {seg.averageHeartrate ? ` · ${Math.round(seg.averageHeartrate)} bpm` : ''}
                </M>
              </YStack>
            );
          })}
        </YStack>
      )}

      <YStack height={40} />
    </ScrollView>
  );
}
