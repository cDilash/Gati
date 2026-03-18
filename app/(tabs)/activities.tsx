/**
 * Runs Screen — visually rich activity feed with icon-heavy stat cards.
 * Each run feels distinct with colored route, stat pills, and type badges.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, ScrollView as RNScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useAppStore } from '../../src/store';
import { formatDate } from '../../src/utils/dateUtils';
import { formatPace, formatTime } from '../../src/engine/vdot';
import { PerformanceMetric } from '../../src/types';
import { PolylineThumbnail } from '../../src/components/PolylineThumbnail';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Filter config ──────────────────────────────────────────

const FILTER_ICONS: Record<string, string> = {
  All: 'format-list-bulleted',
  Outdoor: 'earth',
  Trail: 'pine-tree',
  Treadmill: 'run',
  'Long Run': 'road-variant',
  Workout: 'lightning-bolt',
  Race: 'trophy',
};

// ─── Run type colors ────────────────────────────────────────

function runTypeColor(type: string): string {
  switch (type) {
    case 'Race': return colors.orange;
    case 'Trail': return colors.cyan;
    case 'Treadmill': return colors.textTertiary;
    case 'Long Run': return colors.cyan;
    case 'Workout': return colors.orange;
    default: return colors.cyan;
  }
}

function runTypeBg(type: string): string {
  switch (type) {
    case 'Race': return colors.orangeGhost;
    case 'Trail': return colors.cyanGhost;
    case 'Treadmill': return colors.surfaceHover;
    case 'Long Run': return colors.cyanGhost;
    case 'Workout': return colors.orangeGhost;
    default: return colors.surfaceHover;
  }
}

// ─── Component ──────────────────────────────────────────────

export default function ActivitiesScreen() {
  const router = useRouter();
  const workouts = useAppStore(s => s.workouts);
  const isStravaConnected = useAppStore(s => s.isStravaConnected);
  const syncStrava = useAppStore(s => s.syncStrava);
  const paceZones = useAppStore(s => s.paceZones);

  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [polylines, setPolylines] = useState<Record<string, string | null>>({});
  const [activityNames, setActivityNames] = useState<Record<string, string | null>>({});
  const [runTypes, setRunTypes] = useState<Record<string, string>>({});
  const [elevations, setElevations] = useState<Record<string, number | null>>({});
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadMetrics = useCallback(() => {
    try {
      const { getAllMetrics, getDatabase } = require('../../src/db/database');
      const mets: PerformanceMetric[] = getAllMetrics(200);
      setMetrics(mets);

      const db = getDatabase();
      const polyMap: Record<string, string | null> = {};
      const nameMap: Record<string, string | null> = {};
      const typeMap: Record<string, string> = {};
      const elevMap: Record<string, number | null> = {};

      for (const m of mets) {
        let row: any = null;
        if (m.strava_activity_id) {
          row = db.getFirstSync(
            'SELECT summary_polyline_encoded, polyline_encoded, activity_name, strava_workout_type, activity_type, elevation_gain_ft FROM strava_activity_detail WHERE strava_activity_id = ?',
            m.strava_activity_id,
          ) as any;
        }
        if (!row) {
          row = db.getFirstSync(
            'SELECT summary_polyline_encoded, polyline_encoded, activity_name, strava_workout_type, activity_type, elevation_gain_ft FROM strava_activity_detail WHERE performance_metric_id = ?',
            m.id,
          ) as any;
        }
        polyMap[m.id] = row?.summary_polyline_encoded || row?.polyline_encoded || null;
        nameMap[m.id] = row?.activity_name || null;
        elevMap[m.id] = row?.elevation_gain_ft ?? null;

        const wType = row?.strava_workout_type ?? m.strava_workout_type;
        const aType = row?.activity_type ?? 'Run';
        const hasRoute = !!polyMap[m.id];
        if (aType === 'TrailRun') typeMap[m.id] = 'Trail';
        else if (aType === 'VirtualRun' || (!hasRoute && aType === 'Run')) typeMap[m.id] = 'Treadmill';
        else if (wType === 1) typeMap[m.id] = 'Race';
        else if (wType === 2) typeMap[m.id] = 'Long Run';
        else if (wType === 3) typeMap[m.id] = 'Workout';
        else typeMap[m.id] = 'Outdoor';
      }

      setPolylines(polyMap);
      setActivityNames(nameMap);
      setRunTypes(typeMap);
      setElevations(elevMap);
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

  // Filters
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

  const filteredMetrics = useMemo(() => {
    if (activeFilter === 'All') return metrics;
    return metrics.filter(m => runTypes[m.id] === activeFilter);
  }, [metrics, runTypes, activeFilter]);

  // Group by month
  type ListItem =
    | { type: 'month'; label: string; volume: number; runs: number; totalMinutes: number; year: number; monthIdx: number }
    | { type: 'run'; metric: PerformanceMetric };

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const listData = useMemo(() => {
    const monthGroups = new Map<string, { metrics: PerformanceMetric[]; volume: number; totalMin: number; year: number; monthIdx: number }>();

    for (const m of filteredMetrics) {
      const date = new Date(m.date + 'T00:00:00');
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const group = monthGroups.get(key) ?? { metrics: [], volume: 0, totalMin: 0, year: date.getFullYear(), monthIdx: date.getMonth() };
      group.metrics.push(m);
      group.volume += m.distance_miles;
      group.totalMin += m.duration_minutes ?? 0;
      monthGroups.set(key, group);
    }

    const items: ListItem[] = [];
    for (const [, group] of monthGroups) {
      const now = new Date();
      const isCurrentMonth = group.year === now.getFullYear() && group.monthIdx === now.getMonth();
      const label = isCurrentMonth
        ? 'This Month'
        : `${MONTH_NAMES[group.monthIdx]}${group.year !== now.getFullYear() ? ` ${group.year}` : ''}`;

      items.push({
        type: 'month',
        label,
        volume: Math.round(group.volume * 10) / 10,
        runs: group.metrics.length,
        totalMinutes: Math.round(group.totalMin),
        year: group.year,
        monthIdx: group.monthIdx,
      });
      for (const m of group.metrics) {
        items.push({ type: 'run', metric: m });
      }
    }
    return items;
  }, [filteredMetrics]);

  // Summary stats
  const totalMiles = metrics.reduce((s, m) => s + m.distance_miles, 0);
  const totalMinutes = metrics.reduce((s, m) => s + (m.duration_minutes ?? 0), 0);
  const paceMetrics = metrics.filter(m => m.avg_pace_sec_per_mile && m.avg_pace_sec_per_mile > 0);
  const avgPace = paceMetrics.length > 0
    ? Math.round(paceMetrics.reduce((s, m) => s + m.avg_pace_sec_per_mile!, 0) / paceMetrics.length)
    : totalMiles > 0 && totalMinutes > 0 ? Math.round((totalMinutes * 60) / totalMiles) : null;
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = Math.round(totalMinutes % 60);

  // ─── Loading ──────────────────────────────────────────

  if (isLoading) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center">
        <Spinner size="large" color={colors.cyan} />
      </YStack>
    );
  }

  // ─── Empty state ──────────────────────────────────────

  if (metrics.length === 0) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding={32}>
        <View width={64} height={64} borderRadius={32} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom={16}>
          <MaterialCommunityIcons name="run-fast" size={32} color={colors.cyan} />
        </View>
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom={8}>No Runs Yet</H>
        <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20} marginBottom={20}>
          {isStravaConnected ? 'Pull to refresh to sync your Strava runs.' : 'Connect Strava or complete a workout to see your runs here.'}
        </B>
        {isStravaConnected && (
          <YStack backgroundColor={colors.cyan} paddingHorizontal={28} paddingVertical={12} borderRadius={10}
            pressStyle={{ opacity: 0.8 }} onPress={handleSync} opacity={isSyncing ? 0.6 : 1}>
            <B color="white" fontSize={15} fontWeight="700">{isSyncing ? 'Syncing...' : 'Sync Now'}</B>
          </YStack>
        )}
      </YStack>
    );
  }

  // ─── Main screen ──────────────────────────────────────

  return (
    <YStack flex={1} backgroundColor="$background">
      {/* Hero Stats */}
      <XStack paddingHorizontal={16} paddingVertical={12} gap={8}>
        <HeroStat icon="run-fast" value={String(metrics.length)} label="runs" />
        <HeroStat icon="map-marker-distance" value={Math.round(totalMiles).toString()} label="total mi" />
        <HeroStat icon="speedometer" value={avgPace ? formatPace(avgPace) : '--'} label="avg pace" />
        <HeroStat icon="clock-outline" value={`${totalHours}:${String(totalMins).padStart(2, '0')}`} label="total hrs" />
      </XStack>

      {/* Filter pills */}
      {filterOptions.length > 1 && (
        <RNScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ overflow: 'visible' }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          {filterOptions.map(opt => {
            const active = activeFilter === opt;
            const icon = FILTER_ICONS[opt] ?? 'run';
            const count = opt !== 'All' ? metrics.filter(m => runTypes[m.id] === opt).length : 0;
            const textColor = active ? colors.background : colors.textSecondary;
            return (
              <XStack key={opt} height={36} alignItems="center" justifyContent="center"
                paddingHorizontal={16} borderRadius={18}
                backgroundColor={active ? colors.cyan : colors.surface}
                borderWidth={1} borderColor={active ? colors.cyan : colors.border}
                pressStyle={{ opacity: 0.8 }} onPress={() => setActiveFilter(opt)}>
                <MaterialCommunityIcons name={icon as any} size={14} color={textColor} style={{ marginRight: 6 }} />
                <B fontSize={13} fontWeight="500" color={textColor}>
                  {opt}{count > 0 ? ` ${count}` : ''}
                </B>
              </XStack>
            );
          })}
        </RNScrollView>
      )}

      {/* Run list */}
      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.type === 'month' ? `m-${i}` : `r-${(item as any).metric.id}`}
        renderItem={({ item }) => {
          if (item.type === 'month') {
            const totalHrs = Math.floor(item.totalMinutes / 60);
            const totalMn = Math.round(item.totalMinutes % 60);
            return (
              <YStack paddingTop={20} paddingBottom={10}>
                <H color="$color" fontSize={20} letterSpacing={1} marginBottom={4}>{item.label}</H>
                <XStack gap={12} alignItems="center">
                  <M color={colors.cyan} fontSize={13} fontWeight="600">{item.volume} mi</M>
                  <B color="$textTertiary" fontSize={12}>{item.runs} runs</B>
                  {item.totalMinutes > 0 && <B color="$textTertiary" fontSize={12}>{totalHrs}h {totalMn}m</B>}
                </XStack>
              </YStack>
            );
          }

          return <RunCard metric={item.metric} />;
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        windowSize={7}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        initialNumToRender={12}
        refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={handleSync} tintColor={colors.cyan} />}
      />
    </YStack>
  );

  // ─── Run Card (inner component for closure access) ────

  function RunCard({ metric: m }: { metric: PerformanceMetric }) {
    const matched = m.workout_id ? workouts.find(w => w.id === m.workout_id) : null;
    const poly = polylines[m.id];
    const stravaName = activityNames[m.id];
    const runType = runTypes[m.id] ?? 'Outdoor';
    const elev = elevations[m.id];
    const isTreadmill = runType === 'Treadmill';

    // Compute pace
    let pace: number | null = m.avg_pace_sec_per_mile && m.avg_pace_sec_per_mile > 0
      ? m.avg_pace_sec_per_mile
      : (m.duration_minutes > 0 && m.distance_miles > 0 ? Math.round((m.duration_minutes * 60) / m.distance_miles) : null);

    // Determine left border color based on type
    const borderColor = runType === 'Race' ? colors.orange
      : runType === 'Workout' ? colors.orange
      : runType === 'Long Run' ? colors.cyan
      : runType === 'Trail' ? colors.cyan
      : colors.border;

    // Clean display name — strip "Week X — " prefix
    let displayName = stravaName || matched?.title || 'Run';
    displayName = displayName.replace(/^Week \d+\s*[—–-]\s*/i, '');

    // Duration formatting
    const durMin = Math.round(m.duration_minutes ?? 0);
    const durH = Math.floor(durMin / 60);
    const durM = durMin % 60;
    const durStr = durH > 0 ? `${durH}h${durM > 0 ? ` ${durM}m` : ''}` : `${durMin}m`;

    return (
      <XStack
        backgroundColor="$surface" borderRadius={14} padding={12} marginBottom={8}
        borderWidth={0.5} borderColor="$border"
        borderLeftWidth={3} borderLeftColor={borderColor}
        pressStyle={{ opacity: 0.8 }} onPress={() => router.push(`/activity/${m.id}`)}
      >
        {/* Left: route thumbnail or treadmill icon */}
        <View marginRight={12} width={56}>
          {poly && !isTreadmill ? (
            <PolylineThumbnail polyline={poly} width={56} height={56} strokeWidth={2.5} gradientId={`rt-${m.id.slice(0, 8)}`} />
          ) : (
            <YStack width={56} height={56} borderRadius={10} backgroundColor={colors.surfaceHover}
              justifyContent="center" alignItems="center">
              <MaterialCommunityIcons
                name={isTreadmill ? 'run' : 'map-marker-path'}
                size={24} color={colors.textTertiary}
              />
            </YStack>
          )}
        </View>

        {/* Right: info */}
        <YStack flex={1}>
          {/* Row 1: Date + Name + Type badge */}
          <B color="$textTertiary" fontSize={11}>{formatDate(m.date)}</B>
          <XStack alignItems="center" gap={6} marginTop={1} marginBottom={4}>
            <B color="$color" fontSize={14} fontWeight="600" flexShrink={1} numberOfLines={1}>{displayName}</B>
            {runType !== 'Outdoor' && (
              <View paddingHorizontal={6} paddingVertical={1} borderRadius={4} backgroundColor={runTypeBg(runType)}>
                <H fontSize={9} color={runTypeColor(runType)} textTransform="uppercase" letterSpacing={0.8}>{runType}</H>
              </View>
            )}
          </XStack>

          {/* Row 2: Stat pills */}
          <XStack gap={10} flexWrap="wrap" marginBottom={2}>
            <XStack alignItems="center" gap={3}>
              <MaterialCommunityIcons name="map-marker-distance" size={13} color={colors.cyan} />
              <M color="$color" fontSize={13} fontWeight="700">{m.distance_miles.toFixed(1)}</M>
              <M color="$textTertiary" fontSize={10}>mi</M>
            </XStack>
            {durMin > 0 && (
              <XStack alignItems="center" gap={3}>
                <MaterialCommunityIcons name="timer-outline" size={13} color={colors.textSecondary} />
                <M color="$textSecondary" fontSize={12}>{durStr}</M>
              </XStack>
            )}
            {m.avg_hr ? (
              <XStack alignItems="center" gap={3}>
                <MaterialCommunityIcons name="heart-pulse" size={13} color={colors.orange} />
                <M color={colors.orange} fontSize={12} fontWeight="600">{m.avg_hr}</M>
              </XStack>
            ) : null}
            {elev && elev > 50 ? (
              <XStack alignItems="center" gap={3}>
                <MaterialCommunityIcons name="trending-up" size={13} color={colors.textSecondary} />
                <M color="$textSecondary" fontSize={12}>+{Math.round(elev)}'</M>
              </XStack>
            ) : null}
          </XStack>

          {/* Matched workout indicator */}
          {matched && (
            <B color="$textTertiary" fontSize={10} marginTop={1}>
              Plan: {matched.title}{matched.target_distance_miles ? ` · ${matched.target_distance_miles.toFixed(1)}mi` : ''}
            </B>
          )}
        </YStack>

        {/* Far right: pace */}
        <YStack alignItems="flex-end" justifyContent="center" marginLeft={6}>
          {pace ? (
            <>
              <M color={colors.cyan} fontSize={18} fontWeight="800">{formatPace(pace)}</M>
              <M color="$textTertiary" fontSize={10}>/mi</M>
            </>
          ) : (
            <M color="$textTertiary" fontSize={18} fontWeight="800">--</M>
          )}
        </YStack>
      </XStack>
    );
  }
}

// ─── Hero Stat Card ─────────────────────────────────────────

function HeroStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <YStack flex={1} backgroundColor={colors.surface} borderRadius={12} padding={10} alignItems="center"
      borderWidth={0.5} borderColor={colors.border}>
      <View width={28} height={28} borderRadius={14} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom={6}>
        <MaterialCommunityIcons name={icon as any} size={15} color={colors.cyan} />
      </View>
      <M color={colors.textPrimary} fontSize={17} fontWeight="800">{value}</M>
      <H color={colors.textTertiary} fontSize={9} textTransform="uppercase" letterSpacing={1} marginTop={2}>{label}</H>
    </YStack>
  );
}
