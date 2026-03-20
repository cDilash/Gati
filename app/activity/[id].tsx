/**
 * Activity Detail Screen — premium run review with rich data visualization.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Pressable, PanResponder, GestureResponderEvent } from 'react-native';
import { Text, YStack, XStack, ScrollView, Spinner, View, } from 'tamagui';
import Svg, { Rect as SvgRect, Line as SvgLine, Circle as SvgCircle, Path as SvgPath, Defs, LinearGradient as SvgGrad, Stop as SvgStop, Text as SvgText } from 'react-native-svg';
import { Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatPace, formatTime } from '../../src/engine/vdot';
import { PerformanceMetric, Workout } from '../../src/types';
import { RouteMap } from '../../src/components/RouteMap';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';
import { useAppStore } from '../../src/store';
import { StravaIcon } from '../../src/components/icons/StravaIcon';
import { GarminIcon } from '../../src/components/icons/GarminIcon';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M_ = (props: any) => <Text fontFamily="$mono" {...props} />;

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
  strava_activity_id: number | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  start_lat: number | null;
  start_lng: number | null;
  weather_temp_f: number | null;
  weather_humidity: number | null;
  weather_wind_mph: number | null;
  weather_condition: string | null;
  weather_fetched: number | null;
}

interface Split { split: number; distance: number; movingTime: number; averageSpeed: number; averageHeartrate: number | null; }
interface Lap { name: string; distance: number; movingTime: number; averageSpeed: number; averageHeartrate: number | null; maxHeartrate: number | null; lapIndex: number; }
interface BestEffort { name: string; distance: number; movingTime: number; prRank: number | null; }
interface SegmentEffort { name: string; distance: number; movingTime: number; elapsedTime: number; prRank: number | null; komRank: number | null; averageHeartrate: number | null; maxHeartrate: number | null; }

function safeParseJSON(json: string | null | undefined): any[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

/** Reusable drag scrubber for charts. Returns active index based on touch x position. */
function useChartScrubber(count: number, padL: number, drawW: number) {
  const [activeIdx, setActiveIdx] = React.useState<number | null>(null);
  const layoutRef = React.useRef({ x: 0, width: 0 });

  const findIdx = (pageX: number) => {
    const relX = pageX - layoutRef.current.x - padL;
    if (relX < 0 || relX > drawW || count < 2) return null;
    return Math.min(Math.max(0, Math.round((relX / drawW) * (count - 1))), count - 1);
  };

  const panResponder = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5,
    onPanResponderGrant: (e) => setActiveIdx(findIdx(e.nativeEvent.pageX)),
    onPanResponderMove: (e) => setActiveIdx(findIdx(e.nativeEvent.pageX)),
    onPanResponderRelease: () => setTimeout(() => setActiveIdx(null), 1500),
    onPanResponderTerminate: () => setActiveIdx(null),
  })).current;

  const onLayout = (e: any) => {
    e.target?.measureInWindow?.((x: number) => { layoutRef.current.x = x; });
    layoutRef.current.width = e.nativeEvent.layout.width;
  };

  return { activeIdx, panResponder, onLayout };
}

// ─── Component ──────────────────────────────────────────────

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const paceZones = useAppStore(s => s.paceZones);
  const shoes = useAppStore(s => s.shoes);

  const [metric, setMetric] = useState<PerformanceMetric | null>(null);
  const [detail, setDetail] = useState<StravaDetail | null>(null);
  const [matchedWorkout, setMatchedWorkout] = useState<Workout | null>(null);
  const [showLaps, setShowLaps] = useState(false);
  const [garminActivity, setGarminActivity] = useState<any>(null);
  const [paceScrubIdx, setPaceScrubIdx] = useState<number | null>(null);
  const [hrScrubIdx, setHrScrubIdx] = useState<number | null>(null);
  const [elevScrubIdx, setElevScrubIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    try {
      const db = require('../../src/db/database');
      const database = db.getDatabase();
      let m = database.getFirstSync('SELECT * FROM performance_metric WHERE id = ?', id) as PerformanceMetric | null;
      if (!m) m = database.getFirstSync('SELECT * FROM performance_metric WHERE strava_activity_id = ?', Number(id)) as PerformanceMetric | null;
      if (m) {
        setMetric(m);
        let d = db.getStravaDetailForMetric(m.id);
        if (!d && m.strava_activity_id) d = db.getStravaDetailByActivityId(m.strava_activity_id);
        setDetail(d);
        if (m.workout_id) {
          const w = database.getFirstSync('SELECT * FROM workout WHERE id = ?', m.workout_id) as Workout | null;
          if (w) setMatchedWorkout(w);
        }
      }
    } catch (e) { console.warn('[ActivityDetail] Load failed:', e); }

  }, [id]);

  // Fetch Garmin per-activity data when metric loads
  useEffect(() => {
    if (!metric) return;
    (async () => {
      try {
        const { supabase } = require('../../src/backup/supabase');
        const { data: ga } = await supabase
          .from('garmin_activity_data')
          .select('*')
          .eq('activity_date', metric.date)
          .limit(1)
          .single();
        if (ga) setGarminActivity(ga);
      } catch {}
    })();
  }, [metric?.date]);

  if (!metric) {
    return (
      <YStack flex={1} backgroundColor={colors.background} justifyContent="center" alignItems="center">
        <Spinner size="large" color={colors.cyan} />
      </YStack>
    );
  }

  const polyline = detail?.polyline_encoded || detail?.summary_polyline_encoded;
  const splits: Split[] = safeParseJSON(detail?.splits_json);
  const laps: Lap[] = safeParseJSON(detail?.laps_json);
  const bestEfforts: BestEffort[] = safeParseJSON(detail?.best_efforts_json);
  const segmentEfforts: SegmentEffort[] = safeParseJSON(detail?.segment_efforts_json);

  // Pace computation
  const pace = metric.avg_pace_sec_per_mile && metric.avg_pace_sec_per_mile > 0
    ? metric.avg_pace_sec_per_mile
    : (metric.duration_minutes > 0 && metric.distance_miles > 0 ? Math.round((metric.duration_minutes * 60) / metric.distance_miles) : null);

  // Split pace analysis
  const splitPaces = splits.map(s => s.averageSpeed > 0 ? Math.round(1609.344 / s.averageSpeed) : 0).filter(p => p > 0);
  const fastestSplitPace = splitPaces.length > 0 ? Math.min(...splitPaces) : 0;
  const slowestSplitPace = splitPaces.length > 0 ? Math.max(...splitPaces) : 0;

  // Is pace in easy zone?
  const isEasyPace = pace && paceZones ? pace >= paceZones.E.max : true;
  const paceColor = isEasyPace ? colors.cyan : colors.orange;

  // Shoe data
  const shoeData = shoes.find(s => s.name === (metric.gear_name || detail?.gear_name));

  // Strava link
  const stravaId = metric.strava_activity_id || (detail as any)?.strava_activity_id;

  return (
    <ScrollView flex={1} backgroundColor={colors.background} contentContainerStyle={{ paddingBottom: 50 }}>

      {/* ─── Header ──────────────────────────────────────── */}
      <YStack paddingHorizontal={16} paddingTop={16} paddingBottom={8}>
        <H fontSize={24} letterSpacing={1} color={colors.textPrimary}>
          {detail?.activity_name || matchedWorkout?.title || 'Run'}
        </H>
        <B fontSize={13} color={colors.textSecondary} marginTop={4}>
          {new Date(metric.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </B>
        {matchedWorkout && (
          <View alignSelf="flex-start" paddingHorizontal={8} paddingVertical={3} borderRadius={6} backgroundColor={colors.surfaceHover} borderWidth={0.5} borderColor={colors.border} marginTop={6}>
            <B fontSize={11} color={colors.textTertiary}>
              Week {matchedWorkout.week_number} · {matchedWorkout.workout_type}
            </B>
          </View>
        )}
      </YStack>

      {/* ─── Location + Weather ────────────────────────────── */}
      {(detail?.location_city || detail?.start_lat != null || detail?.weather_temp_f != null || detail?.timezone) && (
        <YStack marginHorizontal={16} marginBottom={12} gap={4}>
          {/* Location: city/state if available, else timezone-derived */}
          {(detail?.location_city || detail?.timezone) && (
            <XStack alignItems="center" gap={6}>
              <MaterialCommunityIcons name="map-marker-outline" size={15} color={colors.cyan} />
              <B fontSize={13} color={colors.textSecondary}>
                {detail.location_city
                  ? `${detail.location_city}${detail.location_state ? `, ${detail.location_state}` : ''}`
                  : detail.timezone ? detail.timezone.replace(/_/g, ' ').split('/').pop() ?? '' : ''}
              </B>
            </XStack>
          )}
          {detail?.weather_temp_f != null && (
            <XStack alignItems="center" gap={6}>
              <MaterialCommunityIcons
                name={weatherIcon(detail.weather_condition, detail.weather_temp_f) as any}
                size={15}
                color={weatherIconColor(detail.weather_condition, detail.weather_temp_f, detail.weather_wind_mph)}
              />
              <M_ fontSize={13} fontWeight="600"
                color={detail.weather_temp_f > 80 ? colors.orange : detail.weather_temp_f < 40 ? colors.cyan : colors.textPrimary}>
                {detail.weather_temp_f}°F
              </M_>
              {detail.weather_humidity != null && (
                <B fontSize={12} color={colors.textTertiary}>· {detail.weather_humidity}% humidity</B>
              )}
              {detail.weather_wind_mph != null && detail.weather_wind_mph > 0 && (
                <B fontSize={12} color={detail.weather_wind_mph > 15 ? colors.orange : colors.textTertiary}>
                  · {detail.weather_wind_mph} mph wind
                </B>
              )}
              {detail.weather_condition && (
                <B fontSize={12} color={colors.textTertiary}>· {detail.weather_condition}</B>
              )}
            </XStack>
          )}
          {/* Weather impact note for notable conditions */}
          {detail?.weather_temp_f != null && (
            detail.weather_temp_f > 75 || (detail.weather_wind_mph ?? 0) > 12 ||
            detail.weather_condition === 'Rain' || detail.weather_condition === 'Heavy Rain'
          ) && (
            <XStack alignItems="center" gap={6} marginTop={2}>
              <MaterialCommunityIcons name="alert-circle-outline" size={13} color={colors.orange} />
              <B fontSize={11} color={colors.orange}>
                {detail.weather_temp_f! > 80 ? 'Hot conditions likely slowed your pace by 15-20 sec/mile'
                  : detail.weather_temp_f! > 75 ? 'Warm conditions may have affected effort'
                  : (detail.weather_wind_mph ?? 0) > 15 ? 'Strong wind likely affected your splits'
                  : 'Rain may have impacted footing and pace'}
              </B>
            </XStack>
          )}
        </YStack>
      )}

      {/* ─── Strava Description (quote card) ─────────────── */}
      {detail?.description && (
        <YStack marginHorizontal={16} marginBottom={12} backgroundColor={colors.surface} borderRadius={12} padding={14} borderLeftWidth={3} borderLeftColor={colors.border}>
          <XStack gap={8}>
            <MaterialCommunityIcons name="format-quote-open" size={16} color={colors.textTertiary} style={{ marginTop: 2 }} />
            <YStack flex={1}>
              <B fontSize={13} color={colors.textSecondary} lineHeight={19} fontStyle="italic">{detail.description}</B>
              <XStack alignItems="center" gap={4} marginTop={4} alignSelf="flex-end">
                <B fontSize={10} color={colors.textTertiary}>by</B>
                <StravaIcon size={12} />
              </XStack>
            </YStack>
          </XStack>
        </YStack>
      )}

      {/* ─── Route Map ───────────────────────────────────── */}
      {polyline && (
        <YStack marginHorizontal={16} marginBottom={12} borderRadius={14} overflow="hidden">
          <RouteMap
            polyline={polyline} height={280} strokeWidth={4}
            showGradient showMarkers showReplay
            totalDistanceMiles={metric.distance_miles}
            totalDurationSec={metric.duration_minutes ? metric.duration_minutes * 60 : undefined}
            hrStream={detail?.hr_stream_json ? safeParseJSON(detail.hr_stream_json) : undefined}
            paceStream={detail?.pace_stream_json ? safeParseJSON(detail.pace_stream_json) : undefined}
            elevationStream={detail?.elevation_stream_json ? safeParseJSON(detail.elevation_stream_json) : undefined}
          />
        </YStack>
      )}

      {/* ─── Hero Stats ──────────────────────────────────── */}
      <XStack marginHorizontal={16} marginBottom={12} backgroundColor={colors.surface} borderRadius={14} borderWidth={0.5} borderColor={colors.border}>
        <HeroStat icon="map-marker-distance" iconColor={colors.cyan} value={metric.distance_miles.toFixed(2)} unit="mi" label="Distance" />
        <View width={0.5} backgroundColor={colors.border} marginVertical={12} />
        <HeroStat icon="timer-outline" iconColor={colors.textSecondary}
          value={metric.duration_minutes > 0 ? formatTime(metric.duration_minutes * 60) : (detail?.moving_time_sec ? formatTime(detail.moving_time_sec) : '--')}
          unit="" label="Duration" />
        <View width={0.5} backgroundColor={colors.border} marginVertical={12} />
        <HeroStat icon="speedometer" iconColor={paceColor}
          value={pace ? formatPace(pace) : '--'} unit="/mi" label="Avg Pace" />
      </XStack>

      {/* ─── Plan Comparison ─────────────────────────────── */}
      {matchedWorkout && matchedWorkout.target_distance_miles && (
        <YStack marginHorizontal={16} marginBottom={12} backgroundColor={colors.surface} borderRadius={12} padding={14}>
          <H fontSize={11} color={colors.textTertiary} letterSpacing={1.5} textTransform="uppercase" marginBottom={10}>vs Plan</H>
          <XStack justifyContent="space-between" alignItems="center" marginBottom={4}>
            <B fontSize={12} color={colors.textTertiary}>Distance</B>
            <XStack alignItems="baseline" gap={6}>
              <M_ fontSize={14} fontWeight="700" color={colors.textPrimary}>{metric.distance_miles.toFixed(1)}</M_>
              <B fontSize={11} color={colors.textTertiary}>/</B>
              <M_ fontSize={13} color={colors.textSecondary}>{matchedWorkout.target_distance_miles.toFixed(1)} mi</M_>
              {(() => {
                const pct = Math.round(((metric.distance_miles - matchedWorkout.target_distance_miles!) / matchedWorkout.target_distance_miles!) * 100);
                return <M_ fontSize={11} fontWeight="600" color={Math.abs(pct) <= 10 ? colors.cyan : colors.orange}>{pct >= 0 ? '+' : ''}{pct}%</M_>;
              })()}
            </XStack>
          </XStack>
          {matchedWorkout.target_pace_zone && paceZones && pace && (
            <XStack justifyContent="space-between" alignItems="center" marginBottom={4}>
              <B fontSize={12} color={colors.textTertiary}>Pace Zone</B>
              <XStack alignItems="baseline" gap={6}>
                <M_ fontSize={14} fontWeight="700" color={paceColor}>{formatPace(pace)}</M_>
                <B fontSize={11} color={colors.textTertiary}>/</B>
                <M_ fontSize={13} color={colors.textSecondary}>
                  {formatPace((paceZones as any)[matchedWorkout.target_pace_zone]?.min ?? 0)}-{formatPace((paceZones as any)[matchedWorkout.target_pace_zone]?.max ?? 0)}
                </M_>
              </XStack>
            </XStack>
          )}
          {(matchedWorkout as any).execution_quality && (
            <XStack alignItems="center" gap={6} marginTop={4}>
              <View width={8} height={8} borderRadius={4}
                backgroundColor={(matchedWorkout as any).execution_quality === 'on_target' ? colors.cyan : colors.orange} />
              <B fontSize={12} color={(matchedWorkout as any).execution_quality === 'on_target' ? colors.cyan : colors.orange} fontWeight="600">
                {(matchedWorkout as any).execution_quality === 'on_target' ? 'On Target'
                  : (matchedWorkout as any).execution_quality === 'missed_pace' ? 'Pace Below Target'
                  : (matchedWorkout as any).execution_quality === 'exceeded_pace' ? 'Pace Above Target'
                  : 'Modified'}
              </B>
            </XStack>
          )}
        </YStack>
      )}

      {/* ─── Secondary Stats Grid (2 columns) ──────────────── */}
      {(() => {
        const stats: { icon: string; iconColor: string; value: string; unit: string; label: string; isHR?: boolean }[] = [];
        if (metric.avg_hr != null) stats.push({ icon: 'heart-pulse', iconColor: colors.orange, value: `${Math.round(metric.avg_hr)}`, unit: 'bpm', label: 'Avg HR', isHR: true });
        if (metric.max_hr != null) stats.push({ icon: 'heart-pulse', iconColor: colors.orange, value: `${Math.round(metric.max_hr)}`, unit: 'bpm', label: 'Max HR', isHR: true });
        if (detail?.elevation_gain_ft != null) stats.push({ icon: 'trending-up', iconColor: colors.cyan, value: `${Math.round(detail.elevation_gain_ft)}`, unit: 'ft', label: 'Elevation' });
        if (detail?.calories != null) stats.push({ icon: 'fire', iconColor: colors.cyan, value: `${detail.calories}`, unit: '', label: 'Calories' });
        if (detail?.cadence_avg != null) stats.push({ icon: 'metronome', iconColor: colors.cyan, value: `${Math.round(detail.cadence_avg * 2)}`, unit: 'spm', label: 'Cadence' });
        if (detail?.moving_time_sec != null) stats.push({ icon: 'timer-outline', iconColor: colors.cyan, value: formatTime(detail.moving_time_sec), unit: '', label: 'Moving' });
        if (detail?.suffer_score != null) stats.push({ icon: 'lightning-bolt', iconColor: colors.cyan, value: `${detail.suffer_score}`, unit: '', label: 'Rel. Effort' });
        if (metric.perceived_exertion != null) stats.push({ icon: 'gauge', iconColor: colors.cyan, value: `${metric.perceived_exertion}`, unit: '/10', label: 'RPE' });
        if (stats.length === 0) return null;

        // Group into rows of 3
        const rows: typeof stats[] = [];
        for (let i = 0; i < stats.length; i += 3) {
          rows.push(stats.slice(i, i + 3));
        }

        return (
          <YStack marginHorizontal={16} marginBottom={12} gap={8}>
            {rows.map((row, ri) => (
              <XStack key={ri} gap={8}>
                {row.map((s, si) => (
                  <View key={si} flex={1}>
                    <SecStat icon={s.icon} iconColor={s.iconColor} value={s.value} unit={s.unit} label={s.label} isHR={s.isHR} />
                  </View>
                ))}
                {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => <View key={`empty-${i}`} flex={1} />)}
              </XStack>
            ))}
          </YStack>
        );
      })()}

      {/* ─── Gear ────────────────────────────────────────── */}
      {(metric.gear_name || detail?.gear_name || detail?.device_name) && (
        <YStack marginHorizontal={16} marginBottom={12} backgroundColor={colors.surface} borderRadius={12} padding={14} gap={8}>
          {(metric.gear_name || detail?.gear_name) && (
            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="shoe-sneaker" size={16} color={colors.cyan} />
              <YStack flex={1}>
                <B fontSize={13} color={colors.textPrimary} fontWeight="600">{metric.gear_name || detail?.gear_name}</B>
                {shoeData && (
                  <XStack alignItems="center" gap={6} marginTop={2}>
                    <M_ fontSize={11} color={shoeData.totalMiles > shoeData.maxMiles * 0.8 ? colors.orange : colors.textTertiary}>
                      {Math.round(shoeData.totalMiles)} mi
                    </M_>
                    <View flex={1} height={3} borderRadius={1.5} backgroundColor={colors.surfaceHover} maxWidth={80}>
                      <View height={3} borderRadius={1.5}
                        backgroundColor={shoeData.totalMiles > shoeData.maxMiles * 0.8 ? colors.orange : colors.cyan}
                        width={`${Math.min(Math.round((shoeData.totalMiles / shoeData.maxMiles) * 100), 100)}%` as any} />
                    </View>
                    <M_ fontSize={10} color={colors.textTertiary}>{Math.round((shoeData.totalMiles / shoeData.maxMiles) * 100)}%</M_>
                  </XStack>
                )}
              </YStack>
            </XStack>
          )}
          {detail?.device_name && (
            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="watch" size={16} color={colors.textSecondary} />
              <B fontSize={13} color={colors.textSecondary}>{detail.device_name}</B>
            </XStack>
          )}
        </YStack>
      )}

      {/* ─── Training Impact (Garmin) ─────────────────────── */}
      {garminActivity && (
        <YStack marginHorizontal={16} marginBottom={12}>
          <XStack alignItems="center" justifyContent="space-between" marginBottom={8}>
            <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase">Training Impact</H>
            <XStack alignItems="center" gap={4}>
              <B color={colors.textTertiary} fontSize={10}>by</B>
              <GarminIcon size={11} />
            </XStack>
          </XStack>
          <YStack backgroundColor={colors.surface} borderRadius={12} padding={14} gap={12}>
            {/* Training Effect bars */}
            {garminActivity.aerobic_training_effect != null && (
              <XStack gap={16}>
                {/* Aerobic */}
                <YStack flex={1}>
                  <B color={colors.textTertiary} fontSize={10} marginBottom={3}>Aerobic Effect</B>
                  <View height={8} borderRadius={4} backgroundColor={colors.surfaceHover} overflow="hidden">
                    <View height={8} borderRadius={4}
                      width={`${Math.min((garminActivity.aerobic_training_effect / 5) * 100, 100)}%` as any}
                      backgroundColor={garminActivity.aerobic_training_effect >= 4 ? colors.error : garminActivity.aerobic_training_effect >= 3 ? colors.orange : colors.cyan} />
                  </View>
                  <XStack marginTop={2} justifyContent="space-between">
                    <M_ color={colors.textPrimary} fontSize={13} fontWeight="700">{garminActivity.aerobic_training_effect}</M_>
                    <B color={colors.textTertiary} fontSize={9}>
                      {(garminActivity.aerobic_te_message || '').replace(/_\d+$/, '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}
                    </B>
                  </XStack>
                </YStack>
                {/* Anaerobic */}
                {garminActivity.anaerobic_training_effect != null && garminActivity.anaerobic_training_effect > 0 && (
                  <YStack flex={1}>
                    <B color={colors.textTertiary} fontSize={10} marginBottom={3}>Anaerobic</B>
                    <View height={8} borderRadius={4} backgroundColor={colors.surfaceHover} overflow="hidden">
                      <View height={8} borderRadius={4}
                        width={`${Math.min((garminActivity.anaerobic_training_effect / 5) * 100, 100)}%` as any}
                        backgroundColor={colors.orange} />
                    </View>
                    <M_ color={colors.textSecondary} fontSize={13} fontWeight="600" marginTop={2}>{garminActivity.anaerobic_training_effect}</M_>
                  </YStack>
                )}
              </XStack>
            )}

            {/* Stamina + Load row */}
            <XStack gap={16}>
              {garminActivity.stamina_start != null && garminActivity.stamina_end != null && (
                <YStack flex={1}>
                  <B color={colors.textTertiary} fontSize={10} marginBottom={3}>Stamina</B>
                  <View height={8} borderRadius={4} backgroundColor={colors.orangeGhost} overflow="hidden">
                    <View height={8} borderRadius={4} backgroundColor={colors.cyan}
                      width={`${garminActivity.stamina_end}%` as any} />
                  </View>
                  <XStack marginTop={2} justifyContent="space-between">
                    <M_ color={colors.textPrimary} fontSize={12} fontWeight="700">
                      {garminActivity.stamina_start}% → {garminActivity.stamina_end}%
                    </M_>
                    <B color={garminActivity.stamina_end < 50 ? colors.orange : colors.textTertiary} fontSize={9}>
                      ↓{garminActivity.stamina_start - garminActivity.stamina_end}% drain
                    </B>
                  </XStack>
                  {garminActivity.stamina_end < 50 && (
                    <B color={colors.orange} fontSize={9} marginTop={2}>High fatigue — prioritize recovery</B>
                  )}
                </YStack>
              )}
              {garminActivity.activity_training_load != null && (
                <YStack width={70} alignItems="center">
                  <B color={colors.textTertiary} fontSize={10} marginBottom={3}>Load</B>
                  <M_ color={colors.textPrimary} fontSize={18} fontWeight="800">{garminActivity.activity_training_load}</M_>
                </YStack>
              )}
            </XStack>

            {/* Temperature + GAP */}
            <XStack gap={16}>
              {garminActivity.temperature_avg_c != null && (
                <XStack alignItems="center" gap={4}>
                  <MaterialCommunityIcons name="thermometer" size={14} color={colors.textTertiary} />
                  <M_ color={colors.textSecondary} fontSize={12} fontWeight="600">
                    {garminActivity.temperature_avg_c}°C ({Math.round(garminActivity.temperature_avg_c * 9 / 5 + 32)}°F)
                  </M_>
                </XStack>
              )}
              {garminActivity.grade_adjusted_speed != null && garminActivity.grade_adjusted_speed > 0 && (
                <XStack alignItems="center" gap={4}>
                  <MaterialCommunityIcons name="terrain" size={14} color={colors.textTertiary} />
                  <B color={colors.textTertiary} fontSize={10}>GAP:</B>
                  <M_ color={colors.cyan} fontSize={12} fontWeight="700">
                    {formatPace(Math.round(1609.344 / garminActivity.grade_adjusted_speed))}/mi
                  </M_>
                </XStack>
              )}
            </XStack>
          </YStack>
        </YStack>
      )}

      {/* ─── Pace Chart ──────────────────────────────────── */}
      {splits.length >= 2 && (() => {
        const chartW = Dimensions.get('window').width - 32 - 24; // margins + padding
        const chartH = 140;
        const padL = 38; // y-axis labels
        const padR = 8;
        const padT = 8;
        const padB = 24; // x-axis labels
        const drawW = chartW - padL - padR;
        const drawH = chartH - padT - padB;

        const paces = splits.map(s => s.averageSpeed > 0 ? 1609.344 / s.averageSpeed : 0);
        const validPaces = paces.filter(p => p > 0);
        if (validPaces.length < 2) return null;

        // Y-axis: pace in seconds (slower = higher value = top)
        const yMin = Math.min(...validPaces) - 15;
        const yMax = Math.max(...validPaces) + 15;
        const yRange = yMax - yMin || 1;
        const barW = Math.min(drawW / splits.length - 4, 32);
        const barGap = (drawW - barW * splits.length) / (splits.length + 1);

        // Target pace from matched workout
        const targetMin = matchedWorkout?.target_pace_zone && paceZones ? paceZones[matchedWorkout.target_pace_zone as keyof typeof paceZones]?.min : null;
        const targetMax = matchedWorkout?.target_pace_zone && paceZones ? paceZones[matchedWorkout.target_pace_zone as keyof typeof paceZones]?.max : null;

        const paceBarCenters = splits.map((_, i) => padL + barGap + i * (barW + barGap) + barW / 2);
        const findPaceIdx = (pageX: number, layoutX: number) => {
          const relX = pageX - layoutX;
          let best = 0; let bestDist = Infinity;
          paceBarCenters.forEach((cx, i) => { const d = Math.abs(relX - cx); if (d < bestDist) { bestDist = d; best = i; } });
          return bestDist < barW * 2 ? best : null;
        };
        const paceLayoutRef = { x: 0 };

        return (
          <YStack marginHorizontal={16} marginBottom={12}>
            <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Pace Per Split</H>
            <View backgroundColor={colors.surface} borderRadius={12} padding={12}
              onLayout={(e: any) => { e.target?.measureInWindow?.((x: number) => { paceLayoutRef.x = x; }); }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e: any) => setPaceScrubIdx(findPaceIdx(e.nativeEvent.pageX, paceLayoutRef.x))}
              onResponderMove={(e: any) => setPaceScrubIdx(findPaceIdx(e.nativeEvent.pageX, paceLayoutRef.x))}
              onResponderRelease={() => setTimeout(() => setPaceScrubIdx(null), 1500)}>

              {/* Tooltip */}
              {paceScrubIdx != null && paces[paceScrubIdx] > 0 && (
                <View style={{
                  position: 'absolute', zIndex: 10, top: 0,
                  left: Math.max(12, Math.min(paceBarCenters[paceScrubIdx] - 50, chartW - 112)),
                  backgroundColor: colors.surfaceHover, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                  borderWidth: 0.5, borderColor: colors.border,
                }}>
                  <XStack alignItems="center" gap={6}>
                    <M_ color={colors.textPrimary} fontSize={14} fontWeight="800">{formatPace(Math.round(paces[paceScrubIdx]))}</M_>
                    <B color={colors.textTertiary} fontSize={10}>Mile {paceScrubIdx + 1}</B>
                    {splits[paceScrubIdx].averageHeartrate && (
                      <M_ color={colors.orange} fontSize={11}>{Math.round(splits[paceScrubIdx].averageHeartrate!)} bpm</M_>
                    )}
                  </XStack>
                </View>
              )}

              <Svg width={chartW} height={chartH}>
                {/* Target pace zone band */}
                {targetMin != null && targetMax != null && (
                  <SvgRect x={padL} y={padT + ((yMax - targetMax) / yRange) * drawH}
                    width={drawW} height={((targetMax - targetMin) / yRange) * drawH}
                    fill={colors.cyan} opacity={0.08} />
                )}
                {targetMax != null && (
                  <SvgLine x1={padL} y1={padT + ((yMax - targetMax) / yRange) * drawH}
                    x2={padL + drawW} y2={padT + ((yMax - targetMax) / yRange) * drawH}
                    stroke={colors.textTertiary} strokeWidth={0.8} strokeDasharray="4,4" opacity={0.5} />
                )}

                {/* Scrubber highlight line */}
                {paceScrubIdx != null && (
                  <SvgLine x1={paceBarCenters[paceScrubIdx]} y1={padT} x2={paceBarCenters[paceScrubIdx]} y2={padT + drawH}
                    stroke={colors.textPrimary} strokeWidth={1} strokeOpacity={0.3} />
                )}

                {/* Bars */}
                {splits.map((s, i) => {
                  const p = paces[i];
                  if (p <= 0) return null;
                  const x = padL + barGap + i * (barW + barGap);
                  const barH = ((p - yMin) / yRange) * drawH;
                  const y = padT + drawH - barH;
                  const inZone = targetMin != null && targetMax != null ? p >= targetMin && p <= targetMax : true;
                  const barColor = inZone ? colors.cyan : colors.orange;
                  const dist = s.distance / 1609.344;
                  const isPartial = dist < 0.9;
                  const isActive = paceScrubIdx === i;
                  return (
                    <React.Fragment key={i}>
                      <SvgRect x={x} y={y} width={isPartial ? barW * 0.6 : barW} height={barH}
                        rx={3} fill={barColor} opacity={isActive ? 1 : 0.75} />
                      <SvgText x={x + (isPartial ? barW * 0.3 : barW / 2)} y={padT + drawH + 12}
                        fontSize={9} fill={isActive ? colors.textPrimary : colors.textTertiary} textAnchor="middle" fontFamily="JetBrainsMono_400Regular">
                        {isPartial ? dist.toFixed(1) : String(i + 1)}
                      </SvgText>
                      {s.averageHeartrate && !isActive && (
                        <SvgText x={x + barW / 2} y={padT + drawH + 22}
                          fontSize={8} fill={colors.orange} textAnchor="middle" fontFamily="JetBrainsMono_400Regular" opacity={0.7}>
                          {Math.round(s.averageHeartrate)}
                        </SvgText>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Y-axis */}
                {[yMin + yRange * 0.2, yMin + yRange * 0.5, yMin + yRange * 0.8].map((p, i) => (
                  <SvgText key={i} x={padL - 4} y={padT + drawH - ((p - yMin) / yRange) * drawH + 3}
                    fontSize={9} fill={colors.textTertiary} textAnchor="end" fontFamily="JetBrainsMono_400Regular">
                    {formatPace(Math.round(p))}
                  </SvgText>
                ))}
              </Svg>
            </View>
          </YStack>
        );
      })()}

      {/* ─── HR Chart ──────────────────────────────────────── */}
      {(() => {
        const hrStream: number[] = detail?.hr_stream_json ? safeParseJSON(detail.hr_stream_json) : [];
        const splitHRs = splits.map(s => s.averageHeartrate).filter((h): h is number => h != null && h > 0);
        const hrData = hrStream.length >= 10 ? hrStream : splitHRs;
        if (hrData.length < 3) return null;

        const chartW = Dimensions.get('window').width - 32 - 24;
        const chartH = 130;
        const padL = 34;
        const padR = 8;
        const padT = 8;
        const padB = 20;
        const drawW = chartW - padL - padR;
        const drawH = chartH - padT - padB;

        const hrMin = Math.min(...hrData) - 5;
        const hrMax = Math.max(...hrData) + 5;
        const hrRange = hrMax - hrMin || 1;
        const avgHR = metric.avg_hr ?? (hrData.reduce((s, v) => s + v, 0) / hrData.length);

        const toX = (i: number) => padL + (i / (hrData.length - 1)) * drawW;
        const toY = (v: number) => padT + drawH - ((v - hrMin) / hrRange) * drawH;

        const pathD = hrData.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
        const fillD = pathD + ` L${toX(hrData.length - 1).toFixed(1)},${padT + drawH} L${toX(0).toFixed(1)},${padT + drawH} Z`;

        const hrLayoutRef = { x: 0 };
        const findHrIdx = (pageX: number) => {
          const relX = pageX - hrLayoutRef.x - padL;
          if (relX < 0 || relX > drawW) return null;
          return Math.min(Math.max(0, Math.round((relX / drawW) * (hrData.length - 1))), hrData.length - 1);
        };

        return (
          <YStack marginHorizontal={16} marginBottom={12}>
            <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Heart Rate</H>
            <View backgroundColor={colors.surface} borderRadius={12} padding={12}
              onLayout={(e: any) => { e.target?.measureInWindow?.((x: number) => { hrLayoutRef.x = x; }); }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e: any) => setHrScrubIdx(findHrIdx(e.nativeEvent.pageX))}
              onResponderMove={(e: any) => setHrScrubIdx(findHrIdx(e.nativeEvent.pageX))}
              onResponderRelease={() => setTimeout(() => setHrScrubIdx(null), 1500)}>

              {/* Tooltip */}
              {hrScrubIdx != null && (
                <View style={{
                  position: 'absolute', zIndex: 10, top: 0,
                  left: Math.max(12, Math.min(toX(hrScrubIdx) - 40, chartW - 92)),
                  backgroundColor: colors.surfaceHover, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
                  borderWidth: 0.5, borderColor: colors.border,
                }}>
                  <M_ color={colors.orange} fontSize={14} fontWeight="800">{Math.round(hrData[hrScrubIdx])} bpm</M_>
                </View>
              )}

              <Svg width={chartW} height={chartH}>
                <Defs>
                  <SvgGrad id="hrFill" x1="0" y1="0" x2="0" y2="1">
                    <SvgStop offset="0" stopColor={colors.orange} stopOpacity="0.25" />
                    <SvgStop offset="1" stopColor={colors.orange} stopOpacity="0.02" />
                  </SvgGrad>
                </Defs>

                <SvgPath d={fillD} fill="url(#hrFill)" />

                <SvgLine x1={padL} y1={toY(avgHR)} x2={padL + drawW} y2={toY(avgHR)}
                  stroke={colors.textTertiary} strokeWidth={0.8} strokeDasharray="4,4" opacity={0.5} />
                <SvgText x={padL + drawW + 2} y={toY(avgHR) + 3}
                  fontSize={8} fill={colors.textTertiary} fontFamily="JetBrainsMono_400Regular">{Math.round(avgHR)}</SvgText>

                <SvgPath d={pathD} fill="none" stroke={colors.orange} strokeWidth={2} opacity={0.8} />

                {/* Scrubber vertical line + dot */}
                {hrScrubIdx != null && (
                  <>
                    <SvgLine x1={toX(hrScrubIdx)} y1={padT} x2={toX(hrScrubIdx)} y2={padT + drawH}
                      stroke={colors.textPrimary} strokeWidth={1} strokeOpacity={0.3} />
                    <SvgCircle cx={toX(hrScrubIdx)} cy={toY(hrData[hrScrubIdx])} r={5}
                      fill={colors.orange} stroke={colors.surface} strokeWidth={2} />
                  </>
                )}

                {/* Max HR dot */}
                {hrScrubIdx == null && (() => {
                  const maxIdx = hrData.indexOf(Math.max(...hrData));
                  return (
                    <SvgCircle cx={toX(maxIdx)} cy={toY(hrData[maxIdx])} r={3}
                      fill={colors.error} stroke={colors.surface} strokeWidth={1} />
                  );
                })()}

                {/* Y-axis */}
                {[hrMin + hrRange * 0.25, hrMin + hrRange * 0.5, hrMin + hrRange * 0.75].map((v, i) => (
                  <SvgText key={i} x={padL - 4} y={toY(v) + 3}
                    fontSize={9} fill={colors.textTertiary} textAnchor="end" fontFamily="JetBrainsMono_400Regular">
                    {Math.round(v)}
                  </SvgText>
                ))}
              </Svg>
              {/* Stats row below */}
              <XStack marginTop={4} gap={12} justifyContent="center">
                <XStack alignItems="center" gap={3}>
                  <M_ color={colors.orange} fontSize={11} fontWeight="700">avg {Math.round(avgHR)}</M_>
                  <B color={colors.textTertiary} fontSize={10}>bpm</B>
                </XStack>
                {metric.max_hr && (
                  <XStack alignItems="center" gap={3}>
                    <M_ color={colors.error} fontSize={11} fontWeight="700">max {Math.round(metric.max_hr)}</M_>
                    <B color={colors.textTertiary} fontSize={10}>bpm</B>
                  </XStack>
                )}
              </XStack>
            </View>
          </YStack>
        );
      })()}

      {/* ─── Elevation Chart ──────────────────────────────── */}
      {(() => {
        const elevData: number[] = detail?.elevation_stream_json ? safeParseJSON(detail.elevation_stream_json) : [];
        if (elevData.length < 10 || !detail?.elevation_gain_ft) return null;

        const chartW = Dimensions.get('window').width - 32 - 24;
        const chartH = 100;
        const padL = 30;
        const padR = 8;
        const padT = 4;
        const padB = 4;
        const drawW = chartW - padL - padR;
        const drawH = chartH - padT - padB;

        // Convert meters to feet, subsample for performance
        const step = Math.max(1, Math.floor(elevData.length / 80));
        const sampled = elevData.filter((_, i) => i % step === 0).map(e => e * 3.28084);
        const eMin = Math.min(...sampled) - 5;
        const eMax = Math.max(...sampled) + 5;
        const eRange = eMax - eMin || 1;

        const toX = (i: number) => padL + (i / (sampled.length - 1)) * drawW;
        const toY = (v: number) => padT + drawH - ((v - eMin) / eRange) * drawH;

        const pathD = sampled.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
        const fillD = pathD + ` L${toX(sampled.length - 1).toFixed(1)},${padT + drawH} L${toX(0).toFixed(1)},${padT + drawH} Z`;

        const elevLayoutRef = { x: 0 };
        const findElevIdx = (pageX: number) => {
          const relX = pageX - elevLayoutRef.x - padL;
          if (relX < 0 || relX > drawW) return null;
          return Math.min(Math.max(0, Math.round((relX / drawW) * (sampled.length - 1))), sampled.length - 1);
        };

        return (
          <YStack marginHorizontal={16} marginBottom={12}>
            <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Elevation</H>
            <View backgroundColor={colors.surface} borderRadius={12} padding={12}
              onLayout={(e: any) => { e.target?.measureInWindow?.((x: number) => { elevLayoutRef.x = x; }); }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e: any) => setElevScrubIdx(findElevIdx(e.nativeEvent.pageX))}
              onResponderMove={(e: any) => setElevScrubIdx(findElevIdx(e.nativeEvent.pageX))}
              onResponderRelease={() => setTimeout(() => setElevScrubIdx(null), 1500)}>

              {/* Tooltip */}
              {elevScrubIdx != null && (
                <View style={{
                  position: 'absolute', zIndex: 10, top: 0,
                  left: Math.max(12, Math.min(toX(elevScrubIdx) - 35, chartW - 82)),
                  backgroundColor: colors.surfaceHover, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
                  borderWidth: 0.5, borderColor: colors.border,
                }}>
                  <M_ color={colors.cyan} fontSize={13} fontWeight="800">{Math.round(sampled[elevScrubIdx])} ft</M_>
                </View>
              )}

              <Svg width={chartW} height={chartH}>
                <Defs>
                  <SvgGrad id="elevFill" x1="0" y1="0" x2="0" y2="1">
                    <SvgStop offset="0" stopColor={colors.cyan} stopOpacity="0.2" />
                    <SvgStop offset="1" stopColor={colors.cyan} stopOpacity="0.03" />
                  </SvgGrad>
                </Defs>
                <SvgPath d={fillD} fill="url(#elevFill)" />
                <SvgPath d={pathD} fill="none" stroke={colors.cyan} strokeWidth={1.5} opacity={0.7} />

                {/* Scrubber */}
                {elevScrubIdx != null && (
                  <>
                    <SvgLine x1={toX(elevScrubIdx)} y1={padT} x2={toX(elevScrubIdx)} y2={padT + drawH}
                      stroke={colors.textPrimary} strokeWidth={1} strokeOpacity={0.3} />
                    <SvgCircle cx={toX(elevScrubIdx)} cy={toY(sampled[elevScrubIdx])} r={4}
                      fill={colors.cyan} stroke={colors.surface} strokeWidth={2} />
                  </>
                )}
              </Svg>
              <XStack marginTop={4} gap={12} justifyContent="center">
                <XStack alignItems="center" gap={3}>
                  <MaterialCommunityIcons name="arrow-up" size={12} color={colors.orange} />
                  <M_ color={colors.textSecondary} fontSize={11} fontWeight="600">{Math.round(detail.elevation_gain_ft)} ft</M_>
                </XStack>
              </XStack>
            </View>
          </YStack>
        );
      })()}

      {/* ─── Cadence Chart ──────────────────────────────── */}
      {detail?.cadence_avg != null && detail.cadence_avg > 0 && splits.length >= 2 && (() => {
        // Strava cadence is half the actual value — double it
        const avgCadence = Math.round(detail.cadence_avg! * 2);
        // Check if splits have per-split cadence (via laps or use avg)
        const chartW = Dimensions.get('window').width - 32 - 24;
        const chartH = 100;
        const padL = 34;
        const padR = 8;
        const padT = 8;
        const padB = 20;
        const drawW = chartW - padL - padR;
        const drawH = chartH - padT - padB;

        const barW = Math.min(drawW / splits.length - 4, 32);
        const barGap = (drawW - barW * splits.length) / (splits.length + 1);
        const idealLow = 170;
        const idealHigh = 180;
        const yMin = Math.min(avgCadence, idealLow) - 10;
        const yMax = Math.max(avgCadence, idealHigh) + 10;
        const yRange = yMax - yMin || 1;

        return (
          <YStack marginHorizontal={16} marginBottom={12}>
            <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Cadence</H>
            <View backgroundColor={colors.surface} borderRadius={12} padding={12}>
              <Svg width={chartW} height={chartH}>
                {/* Ideal zone band 170-180 */}
                <SvgRect x={padL} y={padT + ((yMax - idealHigh) / yRange) * drawH}
                  width={drawW} height={((idealHigh - idealLow) / yRange) * drawH}
                  fill={colors.cyan} opacity={0.08} />

                {/* Single bar at avg cadence (no per-split cadence from Strava splits) */}
                {splits.map((_, i) => {
                  const x = padL + barGap + i * (barW + barGap);
                  const barH = ((avgCadence - yMin) / yRange) * drawH;
                  const y = padT + drawH - barH;
                  const inZone = avgCadence >= idealLow && avgCadence <= idealHigh;
                  return (
                    <SvgRect key={i} x={x} y={y} width={barW} height={barH}
                      rx={3} fill={inZone ? colors.cyan : colors.orange} opacity={0.75} />
                  );
                })}

                {/* Y-axis */}
                {[yMin + yRange * 0.3, yMin + yRange * 0.7].map((v, i) => (
                  <SvgText key={i} x={padL - 4} y={padT + drawH - ((v - yMin) / yRange) * drawH + 3}
                    fontSize={9} fill={colors.textTertiary} textAnchor="end" fontFamily="JetBrainsMono_400Regular">
                    {Math.round(v)}
                  </SvgText>
                ))}
              </Svg>
              <XStack marginTop={4} justifyContent="center" gap={8}>
                <M_ color={colors.textSecondary} fontSize={11} fontWeight="700">avg {avgCadence} spm</M_>
                <B color={colors.textTertiary} fontSize={10}>ideal 170-180</B>
              </XStack>
            </View>
          </YStack>
        );
      })()}

      {/* ─── Splits ──────────────────────────────────────── */}
      {splits.length > 0 && (
        <YStack marginHorizontal={16} marginBottom={12}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Splits</H>
          <YStack backgroundColor={colors.surface} borderRadius={12} overflow="hidden">
            <XStack paddingVertical={6} paddingHorizontal={12} borderBottomWidth={0.5} borderBottomColor={colors.border}>
              <H fontSize={10} color={colors.textTertiary} letterSpacing={1} width={36}>MILE</H>
              <H fontSize={10} color={colors.textTertiary} letterSpacing={1} width={56}>PACE</H>
              <H fontSize={10} color={colors.textTertiary} letterSpacing={1} width={44}>HR</H>
              <View flex={1} />
            </XStack>
            {splits.map((s, i) => {
              const sPace = s.averageSpeed > 0 ? Math.round(1609.344 / s.averageSpeed) : 0;
              const isFastest = sPace > 0 && sPace === fastestSplitPace;
              const isSlowest = sPace > 0 && sPace === slowestSplitPace && splits.length > 2;
              const barPct = sPace > 0 && slowestSplitPace > 0 ? Math.round((1 - (sPace - fastestSplitPace) / Math.max(slowestSplitPace - fastestSplitPace, 1)) * 100) : 50;
              const inEasy = sPace > 0 && paceZones ? sPace >= paceZones.E.max : true;
              const barColor = inEasy ? colors.cyan : colors.orange;
              const rowBg = isFastest ? colors.cyanGhost : isSlowest ? colors.orangeGhost : 'transparent';
              return (
                <XStack key={i} alignItems="center" paddingVertical={7} paddingHorizontal={12}
                  borderBottomWidth={0.5} borderBottomColor={colors.border} backgroundColor={rowBg}>
                  <M_ fontSize={12} color={colors.textTertiary} width={36}>{s.split || i + 1}</M_>
                  <M_ fontSize={13} color={inEasy ? colors.textPrimary : colors.orange} fontWeight="600" width={56}>
                    {sPace > 0 ? formatPace(sPace) : '\u2014'}
                  </M_>
                  <M_ fontSize={12} color={s.averageHeartrate ? colors.orange : colors.textTertiary} width={44}>
                    {s.averageHeartrate ? Math.round(s.averageHeartrate) : '\u2014'}
                  </M_>
                  <View flex={1}>
                    <View height={5} backgroundColor={colors.surfaceHover} borderRadius={2.5} overflow="hidden">
                      <View height="100%" borderRadius={2.5} width={`${Math.max(barPct, 10)}%`} backgroundColor={barColor} />
                    </View>
                  </View>
                </XStack>
              );
            })}
          </YStack>
        </YStack>
      )}

      {/* ─── Laps (collapsible) ──────────────────────────── */}
      {laps.length > 1 && (
        <YStack marginHorizontal={16} marginBottom={12}>
          <Pressable onPress={() => setShowLaps(!showLaps)}>
            <XStack alignItems="center" justifyContent="space-between" marginBottom={showLaps ? 8 : 0}>
              <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase">Laps ({laps.length})</H>
              <MaterialCommunityIcons name={showLaps ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
            </XStack>
          </Pressable>
          {showLaps && (
            <YStack backgroundColor={colors.surface} borderRadius={12} overflow="hidden">
              {laps.map((lap, i) => {
                const dist = (lap.distance / 1609.344).toFixed(2);
                const lPace = lap.averageSpeed > 0 ? Math.round(1609.344 / lap.averageSpeed) : 0;
                return (
                  <XStack key={i} alignItems="center" paddingVertical={8} paddingHorizontal={12} borderBottomWidth={0.5} borderBottomColor={colors.border}>
                    <M_ fontSize={12} color={colors.textTertiary} width={50}>{lap.name || `Lap ${lap.lapIndex}`}</M_>
                    <M_ fontSize={12} color={colors.textSecondary} width={50}>{dist} mi</M_>
                    <M_ fontSize={12} color={colors.textSecondary} width={55}>{formatTime(lap.movingTime)}</M_>
                    <M_ fontSize={13} color={colors.cyan} fontWeight="600" width={50}>{lPace > 0 ? formatPace(lPace) : '\u2014'}</M_>
                    <M_ fontSize={12} color={lap.averageHeartrate ? colors.orange : colors.textTertiary} flex={1} textAlign="right">
                      {lap.averageHeartrate ? `${Math.round(lap.averageHeartrate)} bpm` : ''}
                    </M_>
                  </XStack>
                );
              })}
            </YStack>
          )}
        </YStack>
      )}

      {/* ─── Best Efforts ────────────────────────────────── */}
      {bestEfforts.length > 0 && (
        <YStack marginHorizontal={16} marginBottom={12}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Best Efforts</H>
          <YStack backgroundColor={colors.surface} borderRadius={12} padding={14}>
            {bestEfforts.map((e, i) => {
              const isPR = e.prRank === 1;
              return (
                <XStack key={i} alignItems="center" paddingVertical={5}
                  borderLeftWidth={isPR ? 2 : 0} borderLeftColor={colors.cyan}
                  paddingLeft={isPR ? 8 : 0} marginLeft={isPR ? -4 : 0}>
                  <B fontSize={13} color={colors.textSecondary} flex={1}>{e.name}</B>
                  <M_ fontSize={14} color={colors.cyan} fontWeight="700" marginRight={isPR ? 8 : 0}>{formatTime(e.movingTime)}</M_>
                  {isPR && (
                    <View paddingHorizontal={6} paddingVertical={2} borderRadius={4} backgroundColor={colors.cyanGhost} borderWidth={0.5} borderColor={colors.cyanDim}>
                      <H fontSize={9} color={colors.cyan} letterSpacing={1}>PR</H>
                    </View>
                  )}
                  {e.prRank === 2 && (
                    <View paddingHorizontal={5} paddingVertical={2} borderRadius={4} backgroundColor={colors.surfaceHover}>
                      <H fontSize={9} color={colors.textTertiary} letterSpacing={1}>2nd</H>
                    </View>
                  )}
                  {e.prRank === 3 && (
                    <View paddingHorizontal={5} paddingVertical={2} borderRadius={4} backgroundColor={colors.surfaceHover}>
                      <H fontSize={9} color={colors.textTertiary} letterSpacing={1}>3rd</H>
                    </View>
                  )}
                </XStack>
              );
            })}
          </YStack>
        </YStack>
      )}

      {/* ─── Segments ────────────────────────────────────── */}
      {segmentEfforts.length > 0 && (
        <YStack marginHorizontal={16} marginBottom={12}>
          <H color={colors.textSecondary} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Segments</H>
          {segmentEfforts.map((seg, i) => {
            const dist = (seg.distance / 1609.344).toFixed(2);
            const sPace = seg.distance > 0 && seg.movingTime > 0 ? Math.round((seg.movingTime / seg.distance) * 1609.344) : 0;
            return (
              <YStack key={i} backgroundColor={colors.surface} borderRadius={10} padding={12} marginBottom={6}
                borderLeftWidth={seg.prRank === 1 ? 2 : 0} borderLeftColor={colors.cyan}>
                <XStack alignItems="center" gap={6} flexWrap="wrap">
                  <B fontSize={13} color={colors.textPrimary} fontWeight="600" flexShrink={1} numberOfLines={1}>{seg.name}</B>
                  {seg.prRank === 1 && <View paddingHorizontal={5} paddingVertical={2} borderRadius={4} backgroundColor={colors.cyanGhost}><H fontSize={9} color={colors.cyan} letterSpacing={1}>PR</H></View>}
                  {seg.komRank != null && seg.komRank <= 10 && <View paddingHorizontal={5} paddingVertical={2} borderRadius={4} backgroundColor={'#FFD70022'}><H fontSize={9} color="#FFD700" letterSpacing={1}>KOM #{seg.komRank}</H></View>}
                </XStack>
                <M_ fontSize={12} color={colors.textSecondary} marginTop={3}>
                  {dist} mi · {formatTime(seg.movingTime)}{sPace > 0 ? ` · ${formatPace(sPace)}/mi` : ''}{seg.averageHeartrate ? ` · ${Math.round(seg.averageHeartrate)} bpm` : ''}
                </M_>
              </YStack>
            );
          })}
        </YStack>
      )}

      {/* ─── Strava Link ─────────────────────────────────── */}
      {stravaId && (
        <Pressable onPress={() => Linking.openURL(`https://www.strava.com/activities/${stravaId}`)} style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <XStack backgroundColor={colors.surface} borderRadius={12} padding={14} alignItems="center" justifyContent="center" gap={8}>
            <StravaIcon size={18} />
            <B fontSize={13} color={colors.strava} fontWeight="600">View on Strava</B>
            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.strava} />
          </XStack>
        </Pressable>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function HeroStat({ icon, iconColor, value, unit, label }: { icon: string; iconColor: string; value: string; unit: string; label: string }) {
  return (
    <YStack flex={1} alignItems="center" paddingVertical={20}>
      <H fontSize={9} color={colors.textTertiary} textTransform="uppercase" letterSpacing={2} marginBottom={6}>{label}</H>
      <XStack alignItems="baseline">
        <M_ fontSize={24} color={colors.textPrimary} fontWeight="800">{value}</M_>
        {unit ? <M_ fontSize={12} color={colors.textTertiary} fontWeight="600" marginLeft={2}>{unit}</M_> : null}
      </XStack>
    </YStack>
  );
}

function SecStat({ icon, iconColor, value, unit, label, isHR }: { icon: string; iconColor: string; value: string; unit: string; label: string; isHR?: boolean }) {
  return (
    <YStack backgroundColor={colors.surface} borderRadius={10} paddingVertical={8} paddingHorizontal={10}>
      <XStack alignItems="center" gap={4} marginBottom={3}>
        <MaterialCommunityIcons name={icon as any} size={12} color={iconColor} />
        <H fontSize={8} color={colors.textTertiary} textTransform="uppercase" letterSpacing={1}>{label}</H>
      </XStack>
      <M_ fontSize={15} color={isHR ? colors.orange : colors.textPrimary} fontWeight="700">
        {value}{unit ? <M_ fontSize={10} color={colors.textTertiary}> {unit}</M_> : null}
      </M_>
    </YStack>
  );
}

// ─── Weather helpers ────────────────────────────────────────

function weatherIcon(condition: string | null, temp: number | null): string {
  if (temp != null && temp > 80) return 'thermometer-high';
  if (temp != null && temp < 35) return 'thermometer-low';
  if (!condition) return 'weather-partly-cloudy';
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'weather-rainy';
  if (c.includes('snow')) return 'weather-snowy';
  if (c.includes('thunder')) return 'weather-lightning-rainy';
  if (c.includes('fog')) return 'weather-fog';
  if (c.includes('cloud') || c.includes('partly')) return 'weather-partly-cloudy';
  if (c.includes('clear') || c.includes('sunny')) return 'weather-sunny';
  return 'weather-partly-cloudy';
}

function weatherIconColor(condition: string | null, temp: number | null, wind: number | null): string {
  if (temp != null && temp > 80) return colors.orange;
  if (temp != null && temp < 35) return colors.cyan;
  if (wind != null && wind > 15) return colors.orange;
  if (!condition) return colors.textSecondary;
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('snow') || c.includes('thunder')) return colors.orange;
  if (c.includes('clear') || c.includes('sunny')) return colors.cyan;
  return colors.textSecondary;
}
