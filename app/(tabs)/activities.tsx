/**
 * Activities Screen — compact run list with polyline thumbnails.
 * Tap a run to open full detail modal with map + all data.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useAppStore } from '../../src/store';
import { COLORS } from '../../src/utils/constants';
import { formatDate } from '../../src/utils/dateUtils';
import { formatPace, formatTime } from '../../src/engine/vdot';
import { PerformanceMetric } from '../../src/types';
import { RouteMap } from '../../src/components/RouteMap';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

export default function ActivitiesScreen() {
  const router = useRouter();
  const workouts = useAppStore(s => s.workouts);
  const isStravaConnected = useAppStore(s => s.isStravaConnected);
  const syncStrava = useAppStore(s => s.syncStrava);

  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [polylines, setPolylines] = useState<Record<string, string | null>>({});
  const [activityNames, setActivityNames] = useState<Record<string, string | null>>({});
  const [runTypes, setRunTypes] = useState<Record<string, string>>({});  // metric.id → label
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadMetrics = useCallback(() => {
    try {
      const { getAllMetrics, getDatabase } = require('../../src/db/database');
      const mets: PerformanceMetric[] = getAllMetrics(200);
      setMetrics(mets);

      // Debug: check data quality
      const db = getDatabase();
      const detailCount = db.getFirstSync('SELECT COUNT(*) as cnt FROM strava_activity_detail') as any;
      const metricSample = mets[0];
      console.log(`[Runs] ${mets.length} metrics, ${detailCount?.cnt || 0} strava details`);
      if (metricSample) {
        console.log(`[Runs] Sample metric: id=${metricSample.id}, strava_id=${metricSample.strava_activity_id}, dur=${metricSample.duration_minutes}, pace=${metricSample.avg_pace_sec_per_mile}`);
      }

      // Batch-load polylines, names, and run types from strava_activity_detail
      const polyMap: Record<string, string | null> = {};
      const nameMap: Record<string, string | null> = {};
      const typeMap: Record<string, string> = {};

      for (const m of mets) {
        let row: any = null;
        if (m.strava_activity_id) {
          row = db.getFirstSync(
            'SELECT summary_polyline_encoded, polyline_encoded, activity_name, strava_workout_type, activity_type FROM strava_activity_detail WHERE strava_activity_id = ?',
            m.strava_activity_id,
          ) as any;
        }
        if (!row) {
          row = db.getFirstSync(
            'SELECT summary_polyline_encoded, polyline_encoded, activity_name, strava_workout_type, activity_type FROM strava_activity_detail WHERE performance_metric_id = ?',
            m.id,
          ) as any;
        }
        polyMap[m.id] = row?.summary_polyline_encoded || row?.polyline_encoded || null;
        nameMap[m.id] = row?.activity_name || null;

        // Derive run type label from activity_type + workout_type + polyline presence
        const wType = row?.strava_workout_type ?? m.strava_workout_type;
        const aType = row?.activity_type ?? 'Run';
        const hasRoute = !!polyMap[m.id];
        // Environment type
        if (aType === 'TrailRun') typeMap[m.id] = 'Trail';
        else if (aType === 'VirtualRun' || (!hasRoute && aType === 'Run')) typeMap[m.id] = 'Treadmill';
        // Effort type (overrides for specific workout types)
        else if (wType === 1) typeMap[m.id] = 'Race';
        else if (wType === 2) typeMap[m.id] = 'Long Run';
        else if (wType === 3) typeMap[m.id] = 'Workout';
        else typeMap[m.id] = 'Outdoor';
      }

      setPolylines(polyMap);
      setActivityNames(nameMap);
      setRunTypes(typeMap);
    } catch (e) {
      console.warn('[Runs] Load error:', e);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadMetrics(); }, [workouts]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try { await syncStrava(); loadMetrics(); } catch {}
    setIsSyncing(false);
  }, [syncStrava, loadMetrics]);

  // Available filter chips (only show types that exist in data)
  const filterOptions = useMemo(() => {
    const types = new Set(Object.values(runTypes));
    const opts = ['All'];
    if (types.has('Outdoor')) opts.push('Outdoor');
    if (types.has('Trail')) opts.push('Trail');
    if (types.has('Treadmill')) opts.push('Treadmill');
    if (types.has('Long Run')) opts.push('Long Run');
    if (types.has('Workout')) opts.push('Workout');
    if (types.has('Race')) opts.push('Race');
    return opts;
  }, [runTypes]);

  // Filtered metrics
  const filteredMetrics = useMemo(() => {
    if (activeFilter === 'All') return metrics;
    return metrics.filter(m => runTypes[m.id] === activeFilter);
  }, [metrics, runTypes, activeFilter]);

  // Group by month
  type ListItem =
    | { type: 'month'; label: string; volume: number; runs: number; runDays: number[] }
    | { type: 'run'; metric: PerformanceMetric };

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const listData = useMemo(() => {
    // Group metrics by month
    const monthGroups = new Map<string, { metrics: PerformanceMetric[]; volume: number; runDays: Set<number> }>();

    for (const m of filteredMetrics) {
      const date = new Date(m.date + 'T00:00:00');
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const group = monthGroups.get(key) ?? { metrics: [], volume: 0, runDays: new Set() };
      group.metrics.push(m);
      group.volume += m.distance_miles;
      group.runDays.add(date.getDate());
      monthGroups.set(key, group);
    }

    // Build flat list
    const items: ListItem[] = [];
    for (const [key, group] of monthGroups) {
      const [year, monthIdx] = key.split('-').map(Number);
      const now = new Date();
      const isCurrentMonth = year === now.getFullYear() && monthIdx === now.getMonth();
      const label = isCurrentMonth
        ? 'This Month'
        : `${MONTH_NAMES[monthIdx]} ${year !== now.getFullYear() ? year : ''}`.trim();

      items.push({
        type: 'month',
        label,
        volume: Math.round(group.volume * 10) / 10,
        runs: group.metrics.length,
        runDays: Array.from(group.runDays).sort((a, b) => a - b),
      });
      for (const m of group.metrics) {
        items.push({ type: 'run', metric: m });
      }
    }
    return items;
  }, [filteredMetrics]);

  // Summary stats
  const totalMiles = metrics.reduce((s, m) => s + m.distance_miles, 0);
  const paceMetrics = metrics.filter(m => m.avg_pace_sec_per_mile && m.avg_pace_sec_per_mile > 0);
  const avgPace = paceMetrics.length > 0
    ? Math.round(paceMetrics.reduce((s, m) => s + m.avg_pace_sec_per_mile!, 0) / paceMetrics.length)
    : (() => {
        // Fallback: compute from total distance / total duration
        const totalDist = metrics.reduce((s, m) => s + m.distance_miles, 0);
        const totalDur = metrics.reduce((s, m) => s + (m.duration_minutes || 0), 0);
        return totalDist > 0 && totalDur > 0 ? Math.round((totalDur * 60) / totalDist) : null;
      })();

  if (isLoading) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center">
        <Spinner size="large" color="$accent" />
      </YStack>
    );
  }

  if (metrics.length === 0) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding={32}>
        <H color="$color" fontSize={20} letterSpacing={1} marginBottom={8}>No Runs Yet</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22} marginBottom={20}>
          {isStravaConnected ? 'Pull to refresh to sync your Strava runs.' : 'Connect Strava via the gear icon on Today to see runs here.'}
        </B>
        {isStravaConnected && (
          <YStack
            backgroundColor="$accent"
            paddingHorizontal={28}
            paddingVertical={12}
            borderRadius={10}
            pressStyle={{ opacity: 0.8 }}
            onPress={handleSync}
            opacity={isSyncing ? 0.6 : 1}
          >
            <B color={colors.textPrimary} fontSize={15} fontWeight="700">{isSyncing ? 'Syncing...' : 'Sync Now'}</B>
          </YStack>
        )}
      </YStack>
    );
  }

  return (
    <YStack flex={1} backgroundColor="$background">
      {/* Summary */}
      <XStack backgroundColor="$surface" paddingVertical={12} paddingHorizontal={16} borderBottomWidth={0.5} borderBottomColor="$border" alignItems="center">
        <SumItem value={String(metrics.length)} label="Runs" />
        <View width={1} height={22} backgroundColor="$border" />
        <SumItem value={Math.round(totalMiles).toString()} label="Total Mi" />
        <View width={1} height={22} backgroundColor="$border" />
        <SumItem value={avgPace ? formatPace(avgPace) : '--'} label="Avg Pace" />
      </XStack>

      {/* Filter chips */}
      {filterOptions.length > 1 && (
        <XStack flexWrap="wrap" gap={8} paddingHorizontal={16} paddingVertical={10} borderBottomWidth={0.5} borderBottomColor="$border">
          {filterOptions.map(opt => (
            <YStack
              key={opt}
              paddingHorizontal={16}
              paddingVertical={8}
              borderRadius={20}
              backgroundColor={activeFilter === opt ? '$accent' : '$surface'}
              borderWidth={1}
              borderColor={activeFilter === opt ? '$accent' : '$border'}
              pressStyle={{ opacity: 0.8 }}
              onPress={() => setActiveFilter(opt)}
            >
              <B
                fontSize={13}
                fontWeight="600"
                color={activeFilter === opt ? colors.textPrimary : '$textSecondary'}
              >
                {opt}{opt !== 'All' ? ` (${metrics.filter(m => runTypes[m.id] === opt).length})` : ''}
              </B>
            </YStack>
          ))}
        </XStack>
      )}

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.type === 'month' ? `m-${i}-${item.label}` : `r-${item.metric.id}`}
        renderItem={({ item }) => {
          if (item.type === 'month') {
            return (
              <YStack paddingTop={20} paddingBottom={10}>
                <XStack justifyContent="space-between" alignItems="baseline" marginBottom={10}>
                  <H color="$color" fontSize={20} letterSpacing={1}>{item.label}</H>
                  <M color="$textTertiary" fontSize={13} fontWeight="600">{item.volume} mi · {item.runs} runs</M>
                </XStack>
                {/* Mini calendar dots showing which days had runs */}
                <XStack flexWrap="wrap" gap={12}>
                  {item.runDays.map(day => (
                    <YStack key={day} alignItems="center" width={24}>
                      <M color="$textSecondary" fontSize={12} fontWeight="600">{day}</M>
                      <View width={6} height={6} borderRadius={3} backgroundColor="$accent" marginTop={3} />
                    </YStack>
                  ))}
                </XStack>
              </YStack>
            );
          }
          const m = item.metric;
          const matched = m.workout_id ? workouts.find(w => w.id === m.workout_id) : null;
          const poly = polylines[m.id];
          const stravaName = activityNames[m.id];
          const runType = runTypes[m.id];

          return (
            <XStack
              alignItems="center"
              backgroundColor="$surface"
              borderRadius={12}
              padding={10}
              marginBottom={6}
              borderWidth={0.5}
              borderColor="$border"
              pressStyle={{ opacity: 0.8 }}
              onPress={() => router.push(`/activity/${m.id}`)}
            >
              {/* Left: route thumbnail */}
              <View marginRight={12} width={64}>
                {poly ? (
                  <RouteMap polyline={poly} height={52} strokeWidth={2} />
                ) : (
                  <YStack
                    width={64}
                    height={52}
                    borderRadius={8}
                    backgroundColor="$surfaceLight"
                    justifyContent="center"
                    alignItems="center"
                  >
                    <MaterialCommunityIcons name="run" size={24} color={colors.textTertiary} />
                  </YStack>
                )}
              </View>

              {/* Center: info */}
              <YStack flex={1}>
                <B color="$textTertiary" fontSize={11}>{formatDate(m.date)}</B>
                <XStack alignItems="center" gap={6} marginTop={1}>
                  <B color="$color" fontSize={14} fontWeight="600" flexShrink={1} numberOfLines={1}>
                    {stravaName || matched?.title || 'Run'}
                  </B>
                  {runType && runType !== 'Outdoor' && (
                    <View
                      paddingHorizontal={6}
                      paddingVertical={1}
                      borderRadius={4}
                      backgroundColor={
                        runType === 'Race' ? '$dangerMuted'
                        : runType === 'Trail' ? '$successMuted'
                        : runType === 'Treadmill' ? 'rgba(174,174,178,0.15)'
                        : '$accentMuted'
                      }
                    >
                      <H fontSize={10} color="$accent" textTransform="uppercase" letterSpacing={1}>{runType}</H>
                    </View>
                  )}
                </XStack>
                <XStack gap={10} marginTop={3}>
                  <M color="$color" fontSize={13} fontWeight="700">{m.distance_miles.toFixed(1)} mi</M>
                  {m.duration_minutes > 0 && <M color="$textSecondary" fontSize={12}>{Math.round(m.duration_minutes)}m</M>}
                  {m.avg_hr ? <M color="$textTertiary" fontSize={12}>{m.avg_hr} bpm</M> : null}
                </XStack>
              </YStack>

              {/* Right: pace */}
              <YStack alignItems="flex-end" marginLeft={8}>
                {m.avg_pace_sec_per_mile && m.avg_pace_sec_per_mile > 0 ? (
                  <>
                    <M color="$accent" fontSize={17} fontWeight="800">{formatPace(m.avg_pace_sec_per_mile)}</M>
                    <M color="$textTertiary" fontSize={11}>/mi</M>
                  </>
                ) : m.duration_minutes && m.duration_minutes > 0 && m.distance_miles > 0 ? (
                  <>
                    <M color="$accent" fontSize={17} fontWeight="800">{formatPace(Math.round((m.duration_minutes * 60) / m.distance_miles))}</M>
                    <M color="$textTertiary" fontSize={11}>/mi</M>
                  </>
                ) : (
                  <M color="$accent" fontSize={17} fontWeight="800">--</M>
                )}
              </YStack>
            </XStack>
          );
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={handleSync} tintColor={COLORS.accent} />}
      />
    </YStack>
  );
}

function SumItem({ value, label }: { value: string; label: string }) {
  return (
    <YStack flex={1} alignItems="center">
      <M color="$color" fontSize={18} fontWeight="700">{value}</M>
      <H color="$textTertiary" fontSize={10} textTransform="uppercase" letterSpacing={1} marginTop={2}>{label}</H>
    </YStack>
  );
}
