import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Alert, Pressable, LayoutChangeEvent, PanResponder, GestureResponderEvent } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, Rect as SvgRect, Text as SvgText } from 'react-native-svg';
import { useAppStore } from '../../src/store';
import {
  ZONE_DESCRIPTIONS, ZONE_RPE, formatPaceRange, calculateHRZones,
} from '../../src/engine/paceZones';
import {
  predict5KTime, predict10KTime, predictHalfMarathonTime, predictMarathonTime, formatTime,
} from '../../src/engine/vdot';
import { PaceZoneName, PaceZones, HRZones, Shoe, RecoveryStatus, HealthSnapshot, SleepResult, RestingHRResult } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, semantic, zoneColors, sleepStageColors } from '../../src/theme/colors';
import { calculateInjuryRisk } from '../../src/health/injuryRisk';
import { GradientText } from '../../src/theme/GradientText';
import { useUnits } from '../../src/hooks/useUnits';
import { GradientBorder } from '../../src/theme/GradientBorder';
import { formatSleepDuration, formatSleepHours } from '../../src/utils/formatTime';
import { PRBadge } from '../../src/components/PRBadge';
import { GarminIcon } from '../../src/components/icons/GarminIcon';
import { PMCChart } from '../../src/components/PMCChart';
import { PMCSummary, generatePMCInsight } from '../../src/components/PMCSummary';

const ZONE_NAMES: PaceZoneName[] = ['E', 'M', 'T', 'I', 'R'];
const ZONE_FULL_NAMES: Record<PaceZoneName, string> = { E: 'Easy', M: 'Marathon', T: 'Threshold', I: 'Interval', R: 'Repetition' };
const ZONE_COLORS: Record<PaceZoneName, string> = { E: zoneColors[0], M: zoneColors[1], T: zoneColors[2], I: zoneColors[3], R: zoneColors[4] };

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Helpers ─────────────────────────────────────────────────

function formatTimeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  } catch { return ''; }
}

function formatDataAge(ageHours: number | null): { label: string; isStale: boolean } {
  if (ageHours === null) return { label: '', isStale: false };
  if (ageHours < 24) return { label: 'today', isStale: false };
  if (ageHours < 48) return { label: 'yesterday', isStale: false };
  const days = Math.floor(ageHours / 24);
  return { label: `${days} days ago`, isStale: true };
}

function NoDataCard({ icon, label, message }: { icon: string; label: string; message: string }) {
  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor={colors.border} opacity={0.6}>
      <XStack alignItems="center" gap="$2" marginBottom="$1">
        <MaterialCommunityIcons name={icon as any} size={18} color={colors.textTertiary} />
        <B color="$textSecondary" fontSize={14} fontWeight="600">{label}</B>
      </XStack>
      <B color="$textTertiary" fontSize={12}>{message}</B>
    </YStack>
  );
}

// ─── Collapsible Section ─────────────────────────────────────

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <YStack marginTop="$4">
      <Pressable onPress={() => setOpen(!open)}>
        <XStack alignItems="center" justifyContent="space-between" marginBottom="$3" marginLeft="$1">
          <H color="$textSecondary" fontSize={14} textTransform="uppercase" letterSpacing={1.5}>{title}</H>
          <B color="$textTertiary" fontSize={14} marginRight="$1">{open ? '▾' : '▸'}</B>
        </XStack>
      </Pressable>
      {open && children}
    </YStack>
  );
}

// ─── Recovery Hero ───────────────────────────────────────────

function RecoveryHero({ recovery, snapshot, recommendation, scheduledWorkout }: {
  recovery: RecoveryStatus | null; snapshot: HealthSnapshot | null;
  recommendation?: string | null; scheduledWorkout?: string | null;
}) {
  const syncHealth = useAppStore(s => s.syncHealth);
  const [refreshing, setRefreshing] = useState(false);

  if (!recovery || recovery.level === 'unknown') {
    const handleRefresh = async () => {
      setRefreshing(true);
      try {
        await syncHealth(true);
      } catch {}
      setRefreshing(false);
    };

    return (
      <YStack backgroundColor="$surface" borderRadius="$6" padding="$6" alignItems="center">
        <MaterialCommunityIcons name="heart-pulse" size={40} color={colors.textTertiary} />
        <H color="$color" fontSize={20} letterSpacing={1} marginTop="$3">Recovery Data</H>
        <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20} marginTop="$2" marginBottom="$4">
          {recovery?.signalCount === 1
            ? 'Only 1 recovery signal available. Need at least 2 of 3 (resting HR, HRV, sleep) for a score. Wear your Garmin watch overnight.'
            : 'Waiting for Garmin health data. Wear your watch overnight and data will sync automatically.'}
        </B>
        <YStack backgroundColor={colors.surfaceHover} borderRadius="$5" paddingHorizontal="$8" paddingVertical="$3"
          pressStyle={{ opacity: 0.8 }} onPress={handleRefresh}>
          {refreshing ? <Spinner size="small" color="white" /> : <B color={colors.cyan} fontSize={14} fontWeight="700">Refresh Health Data</B>}
        </YStack>
      </YStack>
    );
  }

  const color = recovery.score >= 80 ? colors.cyan
    : recovery.score >= 60 ? colors.orange
    : recovery.score >= 40 ? colors.orange
    : colors.error;
  const label = recovery.level.charAt(0).toUpperCase() + recovery.level.slice(1);

  const signalCount = recovery.signals.filter(s => s.score > 0).length;

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding={16} alignItems="center">
      {/* Score + label row */}
      <XStack alignItems="center" gap={14} width="100%">
        <View width={72} height={72} borderRadius={36} borderWidth={3} borderColor={color}
          backgroundColor={color + '15'} alignItems="center" justifyContent="center">
          <GradientText text={String(recovery.score)} style={{ fontSize: 28, fontWeight: '800' }} />
        </View>
        <YStack flex={1}>
          <H color={color} fontSize={18} letterSpacing={1.5} textTransform="uppercase">{label}</H>
          {(() => {
            const garmin = useAppStore.getState().garminHealth;
            const garminAge = garmin?.fetchedAt ? Math.round((Date.now() - new Date(garmin.fetchedAt).getTime()) / 60000) : null;
            const isStale = garminAge != null && garminAge > 120; // >2 hours
            const freshLabel = garmin?.fetchedAt ? formatTimeAgo(garmin.fetchedAt) : null;
            return (
              <XStack alignItems="center" gap={4} marginTop={2}>
                <B color="$textSecondary" fontSize={11}>{signalCount} signal{signalCount !== 1 ? 's' : ''}</B>
                {freshLabel && (
                  <>
                    <B color="$textTertiary" fontSize={11}>·</B>
                    <MaterialCommunityIcons name="watch" size={10} color={isStale ? colors.orange : colors.textTertiary} />
                    <B color={isStale ? colors.orange : '$textTertiary'} fontSize={11}>{freshLabel}</B>
                  </>
                )}
              </XStack>
            );
          })()}
          {recovery.sleepPending && (
            <XStack alignItems="center" gap={3} marginTop={3}>
              <MaterialCommunityIcons name="clock-outline" size={10} color={colors.textTertiary} />
              <B color="$textTertiary" fontSize={10}>Sleep data pending</B>
            </XStack>
          )}
          {recovery.sleepMissing && !recovery.sleepPending && !recovery.signals.some(s => s.type === 'sleep') && (
            <XStack alignItems="center" gap={3} marginTop={3}>
              <MaterialCommunityIcons name="sleep-off" size={10} color={colors.textTertiary} />
              <B color="$textTertiary" fontSize={10}>No sleep data</B>
            </XStack>
          )}
        </YStack>
      </XStack>

      {/* Recommendation — inline */}
      {recommendation && (
        <B color={colors.textTertiary} fontSize={12} lineHeight={17} marginTop={10} textAlign="left" width="100%">
          {recommendation}{scheduledWorkout ? ` · ${scheduledWorkout}` : ''}
        </B>
      )}

      {/* VDOT + VO2max pills */}
      {(() => {
        const profile = useAppStore.getState().userProfile;
        const garmin = useAppStore.getState().garminHealth;
        const vdotVal = profile?.vdot_score;
        const vo2Val = garmin?.vo2max ?? snapshot?.vo2max?.value;
        if (!vdotVal && !vo2Val) return null;
        return (
          <XStack gap={8} marginTop={10} width="100%">
            {vdotVal != null && (
              <XStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={8} paddingVertical={6} paddingHorizontal={10} alignItems="center" justifyContent="center" gap={6}>
                <H color={colors.textTertiary} fontSize={9} letterSpacing={1}>VDOT</H>
                <M color={colors.cyan} fontSize={16} fontWeight="800">{vdotVal.toFixed(1)}</M>
              </XStack>
            )}
            {vo2Val != null && (
              <XStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={8} paddingVertical={6} paddingHorizontal={10} alignItems="center" justifyContent="center" gap={6}>
                <H color={colors.textTertiary} fontSize={9} letterSpacing={1}>VO2</H>
                <M color={colors.orange} fontSize={16} fontWeight="800">{vo2Val}</M>
              </XStack>
            )}
          </XStack>
        );
      })()}
    </YStack>
  );
}

// ─── Graph Scrubber Hook ─────────────────────────────────────

function useGraphScrubber(pointXs: number[]) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const pointsRef = useRef<number[]>(pointXs);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isScrubbingRef = useRef(false);

  // Keep ref in sync with latest point positions
  pointsRef.current = pointXs;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => pointsRef.current.length > 0,
      onMoveShouldSetPanResponder: (_e, gestureState) => {
        // Only capture if horizontal drag > vertical (user is scrubbing, not scrolling)
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 5;
      },
      onPanResponderTerminationRequest: () => !isScrubbingRef.current,
      onPanResponderGrant: (e) => {
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        startXRef.current = e.nativeEvent.locationX;
        startYRef.current = e.nativeEvent.locationY;
        isScrubbingRef.current = true;
        const idx = findNearestIdx(e.nativeEvent.locationX, pointsRef.current);
        activeRef.current = idx;
        setActiveIdx(idx);
      },
      onPanResponderMove: (e) => {
        const idx = findNearestIdx(e.nativeEvent.locationX, pointsRef.current);
        if (idx !== activeRef.current) {
          activeRef.current = idx;
          setActiveIdx(idx);
        }
      },
      onPanResponderRelease: () => {
        isScrubbingRef.current = false;
        dismissTimer.current = setTimeout(() => {
          activeRef.current = null;
          setActiveIdx(null);
        }, 1500);
      },
    })
  ).current;

  return { activeIdx, panResponder };
}

function findNearestIdx(touchX: number, xs: number[]): number {
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const dist = Math.abs(touchX - xs[i]);
    if (dist < minDist) { minDist = dist; closest = i; }
  }
  return closest;
}

// ─── SVG Line Graph Helpers ──────────────────────────────────

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function buildFillPath(points: { x: number; y: number }[], bottom: number): string {
  if (points.length < 2) return '';
  const line = buildSmoothPath(points);
  return `${line} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
}

// ─── Resting HR Card (SVG line graph) ────────────────────────

function RestingHRCard({ signal, trendData, garminRhr }: {
  signal: { type: string; value: number | null; baseline: number | null; status: string; score: number; detail: string };
  trendData: RestingHRResult[];
  garminRhr?: number | null;
}) {
  const [width, setWidth] = useState(0);
  const statusColor = signal.status === 'good' ? colors.cyan : signal.status === 'fair' ? colors.orange : colors.error;

  const data = trendData.slice(0, 14).reverse(); // oldest → newest
  const values = data.map(d => d.value);
  const baseline = signal.baseline ?? (values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0);

  // Delta from baseline
  const delta = signal.value != null ? signal.value - baseline : 0;
  const deltaLabel = delta < 0 ? `↓${Math.abs(delta)} below baseline` : delta === 0 ? '= At baseline' : `↑${delta} above baseline`;
  const deltaContext = delta <= 0 ? 'Well recovered' : delta <= 3 ? 'Normal variation' : delta <= 6 ? 'Slightly elevated' : 'Significantly elevated';
  const deltaColor = delta <= 0 ? colors.cyan : delta <= 3 ? colors.textSecondary : delta <= 6 ? colors.orange : colors.error;

  const graphH = 130;
  const padT = 10;
  const padB = 4;
  const padL = 12; // left padding so first point is touchable
  const padR = 12; // right padding so last point is touchable
  const chartH = graphH - padT - padB;
  const chartW = Math.max(0, width - padL - padR);

  const yMin = Math.min(...values, baseline) - 3;
  const yMax = Math.max(...values, baseline + 5) + 3;
  const yRange = yMax - yMin || 1;

  const toY = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;
  const toX = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2);

  const points = data.map((d, i) => ({ x: toX(i), y: toY(d.value) }));
  const baselineY = toY(baseline);
  const bandTopY = toY(baseline + 2);
  const bandBotY = toY(baseline - 2);

  const { activeIdx, panResponder } = useGraphScrubber(points.map(p => p.x));

  return (
    <YStack backgroundColor={colors.surface} borderRadius={16} padding={16} borderLeftWidth={3} borderLeftColor={colors.orange}>
      {/* Header */}
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap={6}>
          <MaterialCommunityIcons name="heart-pulse" size={18} color={colors.orange} />
          <B color={colors.textPrimary} fontSize={14} fontWeight="600">Resting Heart Rate</B>
        </XStack>
        <M color={colors.orange} fontSize={12} fontWeight="700">{signal.score}/33</M>
      </XStack>

      {/* Hero number */}
      <XStack alignItems="baseline" gap={4} marginTop={8}>
        <M color={colors.orange} fontSize={32} fontWeight="800">{signal.value ?? '--'}</M>
        <B color={colors.textTertiary} fontSize={12}>bpm</B>
      </XStack>
      <B color={colors.textTertiary} fontSize={11} marginTop={2}>Baseline: {baseline} bpm (14-day avg)</B>
      <XStack alignItems="center" gap={8} marginTop={4}>
        <View backgroundColor={deltaColor + '22'} paddingHorizontal={8} paddingVertical={2} borderRadius={6}>
          <B color={deltaColor} fontSize={11} fontWeight="700">{deltaContext}</B>
        </View>
        <B color={colors.textTertiary} fontSize={11}>{deltaLabel}</B>
      </XStack>

      {/* Trend graph */}
      {data.length >= 3 && (
        <View style={{ height: graphH, marginTop: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          {...(width > 0 ? panResponder.panHandlers : {})}>
          {width > 0 && (
            <>
              <Svg width={width} height={graphH}>
                <Defs>
                  <LinearGradient id="rhrFill2" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.cyan} stopOpacity="0.15" />
                    <Stop offset="1" stopColor={colors.cyan} stopOpacity="0.02" />
                  </LinearGradient>
                </Defs>

                {/* Baseline ±2 bpm band */}
                <SvgRect x={0} y={bandTopY} width={chartW} height={Math.max(0, bandBotY - bandTopY)}
                  fill={colors.cyan} opacity={0.08} />

                {/* Gradient fill below line */}
                <Path d={buildFillPath(points, padT + chartH)} fill="url(#rhrFill2)" />

                {/* Baseline dashed line */}
                <Line x1={0} y1={baselineY} x2={chartW} y2={baselineY}
                  stroke={colors.textTertiary} strokeWidth={0.8} strokeDasharray="4,4" opacity={0.5} />

                {/* Scrubber line */}
                {activeIdx !== null && points[activeIdx] && (
                  <Line x1={points[activeIdx].x} y1={padT} x2={points[activeIdx].x} y2={padT + chartH}
                    stroke={colors.textPrimary} strokeWidth={1} strokeOpacity={0.3} />
                )}

                {/* Main line */}
                <Path d={buildSmoothPath(points)} fill="none" stroke={colors.orange} strokeWidth={2} opacity={0.7} />

                {/* Dots — dual color: cyan if at/below baseline, orange if above */}
                {points.map((p, i) => {
                  const v = data[i].value;
                  const dotColor = v <= baseline + 2 ? colors.cyan : v <= baseline + 5 ? colors.orange : colors.error;
                  const isActive = activeIdx === i;
                  const isLast = i === points.length - 1 && activeIdx === null;
                  const r = isActive ? 7 : isLast ? 5 : 3;
                  return (
                    <Circle key={i} cx={p.x} cy={p.y} r={r}
                      fill={isActive || isLast ? dotColor : dotColor + '77'}
                      stroke={isActive ? colors.textPrimary : isLast ? colors.surface : 'none'}
                      strokeWidth={isActive ? 2 : isLast ? 1.5 : 0} />
                  );
                })}

                {/* Baseline label on right */}
                <SvgText x={chartW - 2} y={baselineY - 4} fill={colors.textTertiary} fontSize={9}
                  fontFamily="JetBrainsMono_400Regular" textAnchor="end" opacity={0.6}>{baseline}</SvgText>
              </Svg>

              {/* Tooltip */}
              {activeIdx !== null && points[activeIdx] && (
                <View style={{
                  position: 'absolute',
                  left: Math.max(0, Math.min(points[activeIdx].x - 44, width - 88)),
                  top: 0,
                  backgroundColor: colors.surfaceHover, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
                  borderWidth: 0.5, borderColor: colors.border,
                }}>
                  <XStack alignItems="center" gap={6}>
                    <M color={colors.orange} fontSize={14} fontWeight="800">{data[activeIdx].value} bpm</M>
                    <B color="$textTertiary" fontSize={10}>
                      {new Date(data[activeIdx].date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </B>
                  </XStack>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* X-axis labels */}
      {data.length >= 3 && width > 0 && (
        <XStack justifyContent="space-between" marginTop={2}>
          {data.map((d, i) => {
            if (data.length > 7 && i % 2 !== 0 && i !== data.length - 1) return <View key={i} flex={1} />;
            const isToday = i === data.length - 1;
            const dayLabel = isToday ? 'T' : new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
            return (
              <M key={i} color={isToday ? colors.orange : colors.textTertiary} fontSize={9} textAlign="center" flex={1}
                fontWeight={isToday ? '700' : '400'}>{dayLabel}</M>
            );
          })}
        </XStack>
      )}

      {/* Source + Garmin comparison */}
      <XStack marginTop={8} alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap={4}>
          <B color={colors.textTertiary} fontSize={10}>by</B>
          <GarminIcon size={11} />
        </XStack>
        {garminRhr != null && (
          <B color={colors.textTertiary} fontSize={10}>
            Garmin: {garminRhr} bpm{Math.abs((signal.value ?? 0) - garminRhr) > 5 ? ' ⚠' : ''}
          </B>
        )}
      </XStack>
    </YStack>
  );
}

// ─── Generic Signal Card (for HRV) ──────────────────────────

function SignalCard({ signal, trendData }: {
  signal: { type: string; value: number | null; baseline: number | null; status: string; score: number; detail: string; source?: string };
  trendData: number[];
}) {
  const statusColor = signal.status === 'good' ? colors.cyan : signal.status === 'fair' ? colors.orange : colors.error;
  const typeLabels: Record<string, string> = {
    hrv: 'Heart Rate Variability', garmin_hrv: 'HRV (Garmin)',
    body_battery: 'Body Battery', respiratory_rate: 'Respiratory Rate',
  };
  const typeUnits: Record<string, string> = { hrv: 'ms', garmin_hrv: 'ms', body_battery: '/100', respiratory_rate: 'br/min' };
  const typeIcons: Record<string, string> = { hrv: 'wave', garmin_hrv: 'wave', body_battery: 'battery-heart', respiratory_rate: 'lungs' };

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor={statusColor}>
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap="$2">
          <MaterialCommunityIcons name={(typeIcons[signal.type] ?? 'chart-line') as any} size={18} color={statusColor} />
          <B color="$color" fontSize={14} fontWeight="600">{typeLabels[signal.type] ?? signal.type}</B>
        </XStack>
        <XStack alignItems="center" gap="$2">
          {signal.value !== null && <M color="$color" fontSize={18} fontWeight="800">{signal.value}</M>}
          <B color="$textTertiary" fontSize={12}>{typeUnits[signal.type] ?? ''}</B>
        </XStack>
      </XStack>

      {trendData.length >= 3 && (
        <XStack marginTop="$3" height={32} alignItems="flex-end" gap={2}>
          {(() => {
            const min = Math.min(...trendData);
            const max = Math.max(...trendData);
            const range = max - min || 1;
            return trendData.slice(-14).map((val, i) => {
              const height = Math.max(4, ((val - min) / range) * 28);
              const isLatest = i === trendData.length - 1 || i === Math.min(13, trendData.length - 1);
              return (
                <View key={i} flex={1} height={height} borderRadius={2}
                  backgroundColor={isLatest ? statusColor : statusColor + '44'} />
              );
            });
          })()}
        </XStack>
      )}

      <XStack marginTop="$2" justifyContent="space-between" alignItems="center">
        <B color="$textTertiary" fontSize={12} flex={1}>{signal.detail}</B>
        {signal.score > 0 && (
          <M color={statusColor} fontSize={12} fontWeight="700">{signal.score}/33</M>
        )}
      </XStack>
    </YStack>
  );
}

function SignalNotAvailable({ type }: { type: string }) {
  const labels: Record<string, string> = { resting_hr: 'Resting Heart Rate', hrv: 'Heart Rate Variability', sleep: 'Sleep', respiratory_rate: 'Respiratory Rate' };
  const icons: Record<string, string> = { resting_hr: 'heart-pulse', hrv: 'wave', sleep: 'sleep', respiratory_rate: 'lungs' };
  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor="$border" opacity={0.6}>
      <XStack alignItems="center" gap="$2">
        <MaterialCommunityIcons name={icons[type] as any} size={18} color={colors.textTertiary} />
        <B color="$textSecondary" fontSize={14} fontWeight="600">{labels[type]}</B>
        <B color="$textTertiary" fontSize={12} flex={1} textAlign="right">Not available from your device</B>
      </XStack>
    </YStack>
  );
}

// ─── Sleep Card (dedicated, rich layout) ─────────────────────

function formatTime12h(timestamp: string): string {
  try {
    if (!timestamp) return '';
    // Handle epoch milliseconds (Garmin returns "1774304665000") or ISO strings
    const num = Number(timestamp);
    const d = !isNaN(num) && num > 1e12 ? new Date(num) : new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch { return ''; }
}

function formatDayLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } catch { return ''; }
}

function formatNightLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

const STAGE_COLORS = sleepStageColors;

function SleepCard({ signal, sleepTrend, garmin }: {
  signal: { value: number | null; status: string; score: number; detail: string };
  sleepTrend: SleepResult[];
  garmin?: import('../../src/types').GarminHealthData | null;
}) {
  const [sleepGraphW, setSleepGraphW] = useState(0);
  const statusColor = signal.status === 'good' ? colors.cyan : signal.status === 'fair' ? colors.orange : colors.error;
  const latest = sleepTrend.length > 0 ? sleepTrend[0] : null; // newest first
  const recentNights = sleepTrend.slice(0, 7).reverse(); // oldest→newest

  const sleepHoursColor = (hrs: number) => hrs >= 7 ? colors.cyan : hrs >= 6 ? colors.orange : colors.error;

  // Sleep line graph dimensions
  const sGraphH = 120;
  const sPadT = 28; // room for tooltip
  const sPadB = 4;
  const sPadL = 12;
  const sPadR = 12;
  const sChartH = sGraphH - sPadT - sPadB;
  const sChartW = Math.max(0, sleepGraphW - sPadL - sPadR);

  const sleepHours = recentNights.map(n => n.totalMinutes / 60);
  const sYMin = Math.min(...sleepHours, 5) - 0.5;
  const sYMax = Math.max(...sleepHours, 8) + 0.5;
  const sYRange = sYMax - sYMin || 1;
  const goodThreshold = 7;

  const sToY = (v: number) => sPadT + sChartH - ((v - sYMin) / sYRange) * sChartH;
  const sToX = (i: number) => sPadL + (recentNights.length > 1 ? (i / (recentNights.length - 1)) * sChartW : sChartW / 2);

  const sleepPoints = sleepHours.map((h, i) => ({ x: sToX(i), y: sToY(h) }));
  const goodLineY = sToY(goodThreshold);
  const sleepScrubber = useGraphScrubber(sleepPoints.map(p => p.x));
  const sleepSelIdx = sleepScrubber.activeIdx;

  return (
    <YStack backgroundColor={colors.surface} borderRadius={16} padding={16} borderLeftWidth={3} borderLeftColor={statusColor}>
      {/* Header */}
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap={6}>
          <MaterialCommunityIcons name="sleep" size={18} color={statusColor} />
          <B color={colors.textPrimary} fontSize={14} fontWeight="600">Sleep</B>
          {latest && <B color={colors.textTertiary} fontSize={12}>— {formatNightLabel(latest.date)}</B>}
        </XStack>
        <M color={colors.orange} fontSize={12} fontWeight="700">{signal.score}/33</M>
      </XStack>

      {/* Hero value + bed times */}
      {latest && (
        <XStack justifyContent="space-between" alignItems="baseline" marginTop={8}>
          <M color={colors.textPrimary} fontSize={32} fontWeight="800">{formatSleepDuration(latest.totalMinutes)}</M>
          <B color={colors.textTertiary} fontSize={12}>
            {formatTime12h(latest.bedStart)} → {formatTime12h(latest.bedEnd)}
          </B>
        </XStack>
      )}

      {/* Status pill */}
      {(() => {
        const hrs = latest ? latest.totalMinutes / 60 : 0;
        const sleepLabel = hrs >= 7.5 ? 'Great Sleep' : hrs >= 7 ? 'Good Sleep' : hrs >= 6 ? 'Fair' : 'Poor Sleep';
        const pillColor = hrs >= 7 ? colors.cyan : hrs >= 6 ? colors.textSecondary : colors.orange;
        return (
          <View alignSelf="flex-start" backgroundColor={pillColor + '22'} paddingHorizontal={8} paddingVertical={2} borderRadius={6} marginTop={4} marginBottom={8}>
            <B color={pillColor} fontSize={11} fontWeight="700">{sleepLabel}</B>
          </View>
        );
      })()}

      {/* Garmin sleep insights — merged inline */}
      {garmin && (garmin.sleepNeedMinutes != null || garmin.sleepSubscores || garmin.sleepScore != null) && (
        <YStack marginBottom={8} paddingTop={8} borderTopWidth={0.5} borderTopColor={colors.border}>
          {/* Score · Need · Debt · Awakenings — compact single row */}
          <XStack gap={12} alignItems="center" flexWrap="wrap" marginBottom={garmin.sleepSubscores ? 8 : 0}>
            {garmin.sleepScore != null && (
              <XStack alignItems="baseline" gap={2}>
                <GarminIcon size={8} />
                <M color={garmin.sleepScore >= 80 ? colors.cyan : garmin.sleepScore >= 60 ? colors.textPrimary : colors.orange}
                  fontSize={13} fontWeight="800">{garmin.sleepScore}</M>
              </XStack>
            )}
            {garmin.sleepNeedMinutes != null && (
              <B color={colors.textTertiary} fontSize={10}>Need {Math.floor(garmin.sleepNeedMinutes / 60)}h {garmin.sleepNeedMinutes % 60}m</B>
            )}
            {garmin.sleepDebtMinutes != null && garmin.sleepDebtMinutes > 0 && (
              <B color={colors.orange} fontSize={10}>Debt {garmin.sleepDebtMinutes}m</B>
            )}
            {garmin.sleepAwakeCount != null && (
              <B color={garmin.sleepAwakeCount > 3 ? colors.orange : colors.textTertiary} fontSize={10}>
                {garmin.sleepAwakeCount} awakening{garmin.sleepAwakeCount !== 1 ? 's' : ''}
              </B>
            )}
          </XStack>

          {/* Need vs Got progress bar */}
          {garmin.sleepNeedMinutes != null && latest && (
            <View height={4} borderRadius={2} backgroundColor={colors.surfaceHover} marginBottom={garmin.sleepSubscores ? 8 : 0} overflow="hidden">
              <View height={4} borderRadius={2}
                backgroundColor={garmin.sleepDebtMinutes && garmin.sleepDebtMinutes > 30 ? colors.orange : colors.cyan}
                width={`${Math.min((latest.totalMinutes / garmin.sleepNeedMinutes) * 100, 100)}%` as any} />
            </View>
          )}

          {/* Stacked stage bar — single horizontal bar with colored segments */}
          {(garmin.sleepDeepSec != null || garmin.sleepLightSec != null || garmin.sleepRemSec != null) && (() => {
            const stages = [
              { label: 'Deep', sec: garmin.sleepDeepSec ?? 0, color: '#6366F1' },
              { label: 'Light', sec: garmin.sleepLightSec ?? 0, color: '#818CF8' },
              { label: 'REM', sec: garmin.sleepRemSec ?? 0, color: colors.cyan },
              { label: 'Awake', sec: garmin.sleepAwakeSec ?? 0, color: colors.orange },
            ];
            const totalSec = stages.reduce((s, st) => s + st.sec, 0) || 1;
            const fmtDur = (sec: number) => { const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60); return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`; };
            return (
              <YStack marginBottom={garmin.sleepSubscores ? 8 : 0}>
                {/* Stacked bar */}
                <XStack height={10} borderRadius={5} overflow="hidden">
                  {stages.filter(s => s.sec > 0).map(stage => (
                    <View key={stage.label} height={10} backgroundColor={stage.color}
                      width={`${Math.max((stage.sec / totalSec) * 100, 1)}%` as any} />
                  ))}
                </XStack>
                {/* Legend row below */}
                <XStack justifyContent="space-between" marginTop={6}>
                  {stages.filter(s => s.sec > 0).map(stage => (
                    <XStack key={stage.label} alignItems="center" gap={4}>
                      <View width={6} height={6} borderRadius={3} backgroundColor={stage.color} />
                      <B color={colors.textTertiary} fontSize={9}>{stage.label}</B>
                      <M color={colors.textSecondary} fontSize={9} fontWeight="700">{fmtDur(stage.sec)}</M>
                    </XStack>
                  ))}
                </XStack>
              </YStack>
            );
          })()}

          {/* Sub-scores grid — no % sign, they're 0-100 scores */}
          {garmin.sleepSubscores && (
            <XStack gap={4} flexWrap="wrap">
              {Object.entries(garmin.sleepSubscores).filter(([, v]) => v != null).map(([key, val]) => {
                const label = key.replace('Percentage', '').replace(/([A-Z])/g, ' $1').trim().toUpperCase();
                const numVal = val as number;
                const scoreColor = numVal >= 80 ? colors.cyan : numVal >= 60 ? colors.textPrimary : colors.orange;
                return (
                  <YStack key={key} backgroundColor={colors.surfaceHover} borderRadius={6}
                    paddingHorizontal={8} paddingVertical={4} alignItems="center" minWidth={48}>
                    <M color={scoreColor} fontSize={14} fontWeight="700">{numVal}</M>
                    <H color={colors.textTertiary} fontSize={7} letterSpacing={0.5}>{label}</H>
                  </YStack>
                );
              })}
            </XStack>
          )}
        </YStack>
      )}

      {/* Sleep stage bar + breakdown */}
      {latest?.stages && (
        <YStack marginBottom="$3">
          <XStack height={12} borderRadius={6} overflow="hidden" marginBottom="$2">
            {(() => {
              const { deepMinutes, lightMinutes, remMinutes, awakeMinutes } = latest.stages;
              const bedTotal = deepMinutes + lightMinutes + remMinutes + awakeMinutes;
              if (bedTotal === 0) return null;
              return (
                <>
                  {deepMinutes > 0 && <View flex={deepMinutes / bedTotal} backgroundColor={STAGE_COLORS.deep} />}
                  {lightMinutes > 0 && <View flex={lightMinutes / bedTotal} backgroundColor={STAGE_COLORS.light} />}
                  {remMinutes > 0 && <View flex={remMinutes / bedTotal} backgroundColor={STAGE_COLORS.rem} />}
                  {awakeMinutes > 0 && <View flex={awakeMinutes / bedTotal} backgroundColor={STAGE_COLORS.awake} />}
                </>
              );
            })()}
          </XStack>
          <XStack flexWrap="wrap" gap="$3">
            {latest.stages.deepMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.deep} />
                <B color="$textSecondary" fontSize={11}>Deep</B>
                <M color="$color" fontSize={11} fontWeight="600">{formatSleepDuration(latest.stages.deepMinutes)}</M>
              </XStack>
            )}
            {latest.stages.lightMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.light} />
                <B color="$textSecondary" fontSize={11}>Light</B>
                <M color="$color" fontSize={11} fontWeight="600">{formatSleepDuration(latest.stages.lightMinutes)}</M>
              </XStack>
            )}
            {latest.stages.remMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.rem} />
                <B color="$textSecondary" fontSize={11}>REM</B>
                <M color="$color" fontSize={11} fontWeight="600">{formatSleepDuration(latest.stages.remMinutes)}</M>
              </XStack>
            )}
            {latest.stages.awakeMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.awake} />
                <B color="$textSecondary" fontSize={11}>Awake</B>
                <M color="$color" fontSize={11} fontWeight="600">{latest.stages.awakeMinutes}m</M>
              </XStack>
            )}
          </XStack>
        </YStack>
      )}

      {/* Sleep stacked bar chart */}
      {recentNights.length >= 3 && (() => {
        const barGraphH = 140;
        const barPadT = 30; // tooltip room
        const barPadB = 4;
        const barChartH = barGraphH - barPadT - barPadB;
        const maxHrs = Math.max(...sleepHours, 8) + 0.5;
        const barGap = 12;
        const barPadL = 12;
        const barPadR = 12;
        const usableW = Math.max(0, sleepGraphW - barPadL - barPadR);
        const barW = usableW > 0 ? (usableW - (recentNights.length - 1) * barGap) / recentNights.length : 28;
        const barStartX = barPadL;

        // Build bar x positions for scrubber
        const barCenters = recentNights.map((_, i) => barStartX + i * (barW + barGap) + barW / 2);
        const barScrubber = useGraphScrubber(barCenters);
        const barSelIdx = barScrubber.activeIdx;

        const thresholdY = barPadT + barChartH - (7 / maxHrs) * barChartH;

        return (
          <YStack marginTop="$2" paddingTop="$3" borderTopWidth={1} borderTopColor="$border">
            <B color="$textTertiary" fontSize={11} marginBottom="$2">Last {recentNights.length} nights</B>

            <View style={{ height: barGraphH }} onLayout={(e) => setSleepGraphW(e.nativeEvent.layout.width)}
              {...(sleepGraphW > 0 ? barScrubber.panResponder.panHandlers : {})}>
              {sleepGraphW > 0 && (
                <>
                  <Svg width={sleepGraphW} height={barGraphH}>
                    {/* 7hr threshold line */}
                    <Line x1={0} y1={thresholdY} x2={sleepGraphW} y2={thresholdY}
                      stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="4,4" strokeOpacity={0.3} />

                    {/* Stacked bars */}
                    {recentNights.map((night, i) => {
                      const x = barStartX + i * (barW + barGap);
                      const totalHrs = night.totalMinutes / 60;
                      const totalBarH = (totalHrs / maxHrs) * barChartH;
                      const barBottom = barPadT + barChartH;
                      const hasStages = night.stages && (night.stages.deepMinutes + night.stages.lightMinutes + night.stages.remMinutes) > 0;
                      const isActive = barSelIdx === i;
                      const isLast = i === recentNights.length - 1 && barSelIdx === null;

                      if (!hasStages) {
                        // Single cyan bar (no stage data)
                        return (
                          <SvgRect key={i} x={x} y={barBottom - totalBarH} width={barW} height={totalBarH}
                            rx={4} fill={colors.cyan} opacity={isActive || isLast ? 1 : 0.6} />
                        );
                      }

                      const { deepMinutes, lightMinutes, remMinutes, awakeMinutes } = night.stages!;
                      const bedTotal = deepMinutes + lightMinutes + remMinutes + awakeMinutes;
                      if (bedTotal === 0) return null;

                      // Heights proportional to total bar height
                      const deepH = (deepMinutes / bedTotal) * totalBarH;
                      const lightH = (lightMinutes / bedTotal) * totalBarH;
                      const remH = (remMinutes / bedTotal) * totalBarH;
                      const awakeH = (awakeMinutes / bedTotal) * totalBarH;

                      const opacity = isActive || isLast ? 1 : 0.7;

                      // Stack bottom→top: deep, light, rem, awake
                      let y = barBottom;
                      return (
                        <React.Fragment key={i}>
                          {deepH > 0 && <SvgRect x={x} y={y - deepH} width={barW} height={deepH} fill={sleepStageColors.deep} opacity={opacity} />}
                          {(() => { y -= deepH; return null; })()}
                          {lightH > 0 && <SvgRect x={x} y={y - lightH} width={barW} height={lightH} fill={sleepStageColors.light} opacity={opacity} />}
                          {(() => { y -= lightH; return null; })()}
                          {remH > 0 && <SvgRect x={x} y={y - remH} width={barW} height={remH} fill={sleepStageColors.rem} opacity={opacity} />}
                          {(() => { y -= remH; return null; })()}
                          {awakeH > 0 && <SvgRect x={x} y={y - awakeH} width={barW} height={awakeH} fill={colors.orange} opacity={opacity * 0.7} rx={4} />}
                          {/* Top rounded cap */}
                          <SvgRect x={x} y={barBottom - totalBarH} width={barW} height={Math.min(4, totalBarH)} rx={4} fill="transparent" />
                        </React.Fragment>
                      );
                    })}
                  </Svg>

                  {/* Tooltip */}
                  {barSelIdx !== null && recentNights[barSelIdx] && (
                    <View style={{
                      position: 'absolute',
                      left: Math.max(0, Math.min(barCenters[barSelIdx] - 55, sleepGraphW - 110)),
                      top: 0,
                      backgroundColor: colors.surfaceHover, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                      borderWidth: 0.5, borderColor: colors.border,
                    }}>
                      <XStack alignItems="center" gap={6}>
                        <M color="$color" fontSize={14} fontWeight="800">{formatSleepDuration(recentNights[barSelIdx].totalMinutes)}</M>
                        <B color="$textTertiary" fontSize={10}>{formatNightLabel(recentNights[barSelIdx].date)}</B>
                      </XStack>
                      {recentNights[barSelIdx].stages && (
                        <XStack gap={6} marginTop={2}>
                          <M color={sleepStageColors.deep} fontSize={10}>{formatSleepDuration(recentNights[barSelIdx].stages!.deepMinutes)} deep</M>
                          <M color={sleepStageColors.rem} fontSize={10}>{formatSleepDuration(recentNights[barSelIdx].stages!.remMinutes)} REM</M>
                        </XStack>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>

            {/* Day labels + hours below — positioned to match bar centers */}
            {sleepGraphW > 0 && (
              <View style={{ height: 30, position: 'relative' }}>
                {recentNights.map((night, i) => {
                  const hrs = night.totalMinutes / 60;
                  const cx = barStartX + i * (barW + barGap) + barW / 2;
                  return (
                    <View key={i} style={{ position: 'absolute', left: cx - 20, width: 40, alignItems: 'center', top: 4 }}>
                      <B color="$textTertiary" fontSize={9}>{formatDayLabel(night.date)}</B>
                      <M color={sleepHoursColor(hrs)} fontSize={10} fontWeight="600">{formatSleepDuration(night.totalMinutes)}</M>
                    </View>
                  );
                })}
              </View>
            )}
          </YStack>
        );
      })()}

      {/* Source */}
      <XStack marginTop={8} alignItems="center" gap={4}>
        <B color={colors.textTertiary} fontSize={10}>by</B>
        <GarminIcon size={11} />
      </XStack>
    </YStack>
  );
}

// ─── Pace / HR / Fitness / Shoes (from old Zones screen) ────

function PaceZoneRow({ zone, paceZones }: { zone: PaceZoneName; paceZones: PaceZones }) {
  const u = useUnits();
  const range = paceZones[zone];
  const desc = ZONE_DESCRIPTIONS[zone].split(' \u2014 ')[1] ?? ZONE_DESCRIPTIONS[zone];
  return (
    <XStack alignItems="center" paddingVertical="$3" paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
      <View width={4} height={40} borderRadius={2} marginRight="$3" backgroundColor={ZONE_COLORS[zone]} />
      <YStack flex={1}>
        <XStack alignItems="center" gap="$2" marginBottom={2}>
          <H color="$color" fontSize={17} letterSpacing={1} width={20}>{zone}</H>
          <B color="$color" fontSize={15} fontWeight="600" flex={1}>{ZONE_FULL_NAMES[zone]}</B>
          <B color="$textTertiary" fontSize={12}>{ZONE_RPE[zone]}</B>
        </XStack>
        <M color={colors.cyan} fontSize={15} fontWeight="700" marginLeft={28} marginBottom={2}>
          {formatPaceRange(range)} {u.paceSuffix}
        </M>
        <B color="$textSecondary" fontSize={12} marginLeft={28} lineHeight={16}>{desc}</B>
      </YStack>
    </XStack>
  );
}

function HRZoneRow({ label, name, min, max, index }: { label: string; name: string; min: number; max: number; index: number }) {
  const hrColors = [zoneColors[0], zoneColors[1], zoneColors[2], zoneColors[3], zoneColors[4]];
  return (
    <XStack alignItems="center" paddingVertical={11} paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
      <View width={4} height={28} borderRadius={2} marginRight="$3" backgroundColor={hrColors[index]} />
      <YStack flex={1}>
        <B color="$color" fontSize={14} fontWeight="600">{label}</B>
        <B color="$textSecondary" fontSize={12}>{name}</B>
      </YStack>
      <M color={hrColors[index]} fontSize={14} fontWeight="600">{min} - {max} bpm</M>
    </XStack>
  );
}

function ShoeCard({ shoe }: { shoe: Shoe }) {
  const u = useUnits();
  const percent = shoe.maxMiles > 0 ? shoe.totalMiles / shoe.maxMiles : 0;
  const clampedPercent = Math.min(percent, 1);
  const isWarning = percent >= 0.8;
  const isCritical = percent >= 1.0;
  const barColor = isCritical ? colors.error : isWarning ? colors.orange : colors.cyan;

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$3" opacity={shoe.retired ? 0.6 : 1}>
      <XStack justifyContent="space-between" alignItems="center" marginBottom={2}>
        <B color={shoe.retired ? '$textSecondary' : '$color'} fontSize={15} fontWeight="600" flex={1}>{shoe.name}</B>
        {shoe.retired && (
          <H color="$textTertiary" fontSize={11} letterSpacing={1} backgroundColor="$surfaceLight" paddingHorizontal="$2" paddingVertical={2} borderRadius="$2" overflow="hidden">
            Retired
          </H>
        )}
      </XStack>
      {shoe.brand && <B color="$textTertiary" fontSize={12} marginBottom="$2">{shoe.brand}</B>}
      <YStack height={6} backgroundColor="$surfaceLight" borderRadius={3} overflow="hidden" marginBottom="$2">
        <View height="100%" width={`${clampedPercent * 100}%` as any} borderRadius={3} backgroundColor={barColor} />
      </YStack>
      <XStack alignItems="baseline" gap="$1">
        <M color={isWarning ? barColor : '$color'} fontSize={14} fontWeight="700">{u.dist(shoe.totalMiles, 0)}</M>
        <M color="$textTertiary" fontSize={12}>/ {u.dist(shoe.maxMiles, 0)}</M>
      </XStack>
      {isWarning && !shoe.retired && (
        <B color={barColor} fontSize={12} fontWeight="600" marginTop="$1">
          {isCritical ? 'Replace soon!' : 'Getting worn'}
        </B>
      )}
    </YStack>
  );
}

// ─── Main Screen ─────────────────────────────────────────────

export default function RecoveryScreen() {
  const u = useUnits();
  const userProfile = useAppStore(s => s.userProfile);
  const paceZones = useAppStore(s => s.paceZones);
  const shoes = useAppStore(s => s.shoes);
  const recoveryStatus = useAppStore(s => s.recoveryStatus);
  const healthSnapshot = useAppStore(s => s.healthSnapshot);
  const garminHealth = useAppStore(s => s.garminHealth);
  const todaysWorkout = useAppStore(s => s.todaysWorkout);
  const weeks = useAppStore(s => s.weeks);
  const workouts = useAppStore(s => s.workouts);
  const pmcData = useAppStore(s => s.pmcData);
  const [pmcInsight, setPmcInsight] = useState<string | null>(null);

  if (!userProfile || !paceZones) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding="$8">
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom="$2">No Profile</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22}>
          Complete your profile setup to see recovery data and pace zones.
        </B>
      </YStack>
    );
  }

  // Fetch PMC insight (fire-and-forget, cached weekly)
  const currentWeekNum = useAppStore(s => s.currentWeekNumber);
  useEffect(() => {
    if (!pmcData || pmcData.totalDays < 7) return;
    generatePMCInsight(pmcData, currentWeekNum).then(setPmcInsight).catch(() => {});
  }, [pmcData?.currentCTL, currentWeekNum]);

  const vdot = userProfile.vdot_score;
  const hasHR = userProfile.max_hr != null && userProfile.rest_hr != null;
  const hrZones: HRZones | null = hasHR ? calculateHRZones(userProfile.max_hr!, userProfile.rest_hr!) : null;
  const hrLabels = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'] as const;
  const hrKeys = ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'] as const;

  // Build signal presence map
  const hasRHR = recoveryStatus?.signals.some(s => s.type === 'resting_hr') ?? false;
  const hasHRV = recoveryStatus?.signals.some(s => s.type === 'hrv') ?? false;
  const hasSleep = recoveryStatus?.signals.some(s => s.type === 'sleep') ?? false;
  const hasResp = recoveryStatus?.signals.some(s => s.type === 'respiratory_rate') ?? false;

  // Build trend arrays
  const rhrTrendFull = healthSnapshot?.restingHRTrend ?? [];
  const hrvTrend = healthSnapshot?.hrvTrend?.map(r => r.value).reverse() ?? [];

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>

      {/* SECTION 1: Recovery Score Hero */}
      <RecoveryHero recovery={recoveryStatus} snapshot={healthSnapshot}
        recommendation={recoveryStatus?.recommendation}
        scheduledWorkout={todaysWorkout && todaysWorkout.workout_type !== 'rest' && todaysWorkout.target_distance_miles
          ? `Scheduled: ${todaysWorkout.title} — ${u.dist(todaysWorkout.target_distance_miles)}`
          : null}
      />

      {/* SECTION 2: Scored Recovery Signals */}
      {recoveryStatus && recoveryStatus.level !== 'unknown' && (
        <YStack marginTop="$4" gap="$3">
          {/* Resting HR */}
          {hasRHR ? (
            <RestingHRCard signal={recoveryStatus.signals.find(s => s.type === 'resting_hr')!} trendData={rhrTrendFull} garminRhr={garminHealth?.restingHr} />
          ) : (
            <NoDataCard icon="heart-pulse" label="Resting Heart Rate" message="No recent data — wear your watch overnight" />
          )}

          {/* HRV — enhanced with baseline range bar */}
          {(() => {
            const hrvSignal = recoveryStatus.signals.find(s => s.type === 'garmin_hrv') ?? (hasHRV ? recoveryStatus.signals.find(s => s.type === 'hrv') : null);
            if (!hrvSignal) return null;
            const isGarmin = hrvSignal.type === 'garmin_hrv';
            const statusColor = hrvSignal.status === 'good' ? colors.cyan : hrvSignal.status === 'fair' ? colors.orange : colors.error;
            const baseLow = garminHealth?.hrvBaselineLow ?? null;
            const baseHigh = garminHealth?.hrvBaselineHigh ?? null;
            const weeklyAvg = garminHealth?.hrvWeeklyAvg ?? null;
            const hrvStatus = garminHealth?.hrvStatus ?? null;

            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16} borderLeftWidth={3} borderLeftColor={colors.cyan}>
                {/* Header */}
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap={6}>
                    <MaterialCommunityIcons name="wave" size={18} color={colors.cyan} />
                    <B color={colors.textPrimary} fontSize={14} fontWeight="600">{isGarmin ? 'HRV' : 'Heart Rate Variability'}</B>
                  </XStack>
                  <M color={colors.orange} fontSize={12} fontWeight="700">{hrvSignal.score}/33</M>
                </XStack>

                {/* Hero value */}
                <XStack alignItems="baseline" gap={4} marginTop={8}>
                  <M color={colors.cyan} fontSize={32} fontWeight="800">{hrvSignal.value}</M>
                  <B color={colors.textTertiary} fontSize={12}>ms</B>
                </XStack>

                {/* Context + status pill */}
                {baseLow != null && baseHigh != null && (
                  <B color={colors.textTertiary} fontSize={12} marginTop={2}>
                    {hrvSignal.value != null && hrvSignal.value >= baseLow ? `Within baseline (${baseLow}–${baseHigh})` : `Below baseline (${baseLow}–${baseHigh})`}
                  </B>
                )}
                {hrvStatus && (
                  <View alignSelf="flex-start" backgroundColor={statusColor + '22'} paddingHorizontal={8} paddingVertical={2} borderRadius={6} marginTop={4}>
                    <B color={statusColor} fontSize={11} fontWeight="700">{hrvStatus}</B>
                  </View>
                )}

                {/* 3-zone baseline range bar */}
                {baseLow != null && baseHigh != null && hrvSignal.value != null && (
                  <YStack marginTop={12}>
                    <B color={colors.textTertiary} fontSize={10} marginBottom={4}>BASELINE RANGE</B>
                    <View height={12} borderRadius={6} backgroundColor={colors.surfaceHover} overflow="hidden">
                      {(() => {
                        const pad = 15;
                        const rangeMin = Math.min(baseLow - pad, hrvSignal.value - 5);
                        const rangeMax = Math.max(baseHigh + pad, hrvSignal.value + 5);
                        const span = rangeMax - rangeMin;
                        const zoneLeft = ((baseLow - rangeMin) / span) * 100;
                        const zoneWidth = ((baseHigh - baseLow) / span) * 100;
                        const markerPos = ((hrvSignal.value - rangeMin) / span) * 100;
                        const markerColor = hrvSignal.value >= baseLow ? colors.cyan : hrvSignal.value >= baseLow * 0.9 ? colors.orange : colors.error;
                        return (
                          <>
                            {/* Balanced zone */}
                            <View style={{ position: 'absolute', left: `${zoneLeft}%` as any, width: `${zoneWidth}%` as any, height: 12, backgroundColor: colors.cyan + '30', borderRadius: 6 }} />
                            {/* Marker dot */}
                            <View style={{ position: 'absolute', left: `${Math.max(1, Math.min(markerPos - 2.5, 96))}%` as any, width: 12, height: 12, borderRadius: 6, backgroundColor: markerColor, borderWidth: 2, borderColor: colors.surface }} />
                          </>
                        );
                      })()}
                    </View>
                    <XStack justifyContent="space-between" marginTop={3}>
                      <M color={colors.textTertiary} fontSize={9}>{baseLow}</M>
                      <B color={colors.textTertiary} fontSize={8}>balanced</B>
                      <M color={colors.textTertiary} fontSize={9}>{baseHigh}</M>
                    </XStack>
                  </YStack>
                )}

                {/* 7-night trend */}
                {hrvTrend.length >= 3 && (() => {
                  const trendData = hrvTrend.slice(-7);
                  const min = Math.min(...trendData) - 5;
                  const max = Math.max(...trendData) + 5;
                  const range = max - min || 1;
                  const trendH = 60;
                  return (
                    <YStack marginTop={12}>
                      <B color={colors.textTertiary} fontSize={10} marginBottom={4}>7-NIGHT TREND</B>
                      <XStack height={trendH} alignItems="flex-end" gap={3}>
                        {trendData.map((val, i) => {
                          const barH = Math.max(4, ((val - min) / range) * (trendH - 8));
                          const isLast = i === trendData.length - 1;
                          return (
                            <YStack key={i} flex={1} alignItems="center">
                              <View height={barH} width="100%" borderRadius={3}
                                backgroundColor={isLast ? colors.cyan : colors.cyan + '55'} />
                              <M color={isLast ? colors.cyan : colors.textTertiary} fontSize={8} marginTop={2}>{val}</M>
                            </YStack>
                          );
                        })}
                      </XStack>
                    </YStack>
                  );
                })()}

                {/* Weekly avg + source */}
                <XStack marginTop={10} alignItems="center" justifyContent="space-between">
                  {weeklyAvg != null && <B color={colors.textTertiary} fontSize={11}>Weekly avg: {weeklyAvg} ms</B>}
                  <XStack alignItems="center" gap={4}>
                    <B color={colors.textTertiary} fontSize={10}>by</B>
                    <GarminIcon size={11} />
                  </XStack>
                </XStack>
              </YStack>
            );
          })()}

          {/* Sleep */}
          {hasSleep ? (
            <SleepCard
              signal={recoveryStatus.signals.find(s => s.type === 'sleep')!}
              sleepTrend={healthSnapshot?.sleepTrend ?? []}
              garmin={garminHealth}
            />
          ) : healthSnapshot?.sleepTrend?.[0]?.isLikelyIncomplete ? (
            <NoDataCard icon="sleep" label="Sleep" message="Incomplete data — watch may have disconnected during the night" />
          ) : (
            <NoDataCard icon="sleep" label="Sleep" message="No sleep data last night — wear your watch to bed" />
          )}
        </YStack>
      )}

      {/* GARMIN INSIGHTS — display only, not scored */}
      {garminHealth && (
        <YStack marginTop="$4" gap="$3">
          <XStack alignItems="center" gap={8}>
            <View height={0.5} flex={1} backgroundColor={colors.border} />
            <H color={colors.textTertiary} fontSize={10} letterSpacing={1.5}>GARMIN INSIGHTS</H>
            <View height={0.5} flex={1} backgroundColor={colors.border} />
          </XStack>

          {/* Body Battery */}
          {garminHealth.bodyBatteryMorning != null && (() => {
            const bb = garminHealth.bodyBatteryMorning!;
            const fillColor = bb >= 80 ? colors.cyan : bb >= 60 ? colors.cyan + 'CC' : bb >= 40 ? colors.orange : colors.error;
            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap={6}>
                    <MaterialCommunityIcons name="battery-heart" size={18} color={fillColor} />
                    <B color={colors.textPrimary} fontSize={14} fontWeight="600">Body Battery</B>
                  </XStack>
                  {null}
                </XStack>
                <XStack alignItems="baseline" gap={4} marginTop={8}>
                  <M color={colors.textPrimary} fontSize={28} fontWeight="800">{bb}</M>
                  <B color={colors.textTertiary} fontSize={12}>/100</B>
                </XStack>
                {/* Fill bar */}
                <View height={8} borderRadius={4} backgroundColor={colors.surfaceHover} marginTop={8} overflow="hidden">
                  <View height={8} borderRadius={4} backgroundColor={fillColor} width={`${bb}%` as any} />
                </View>
                {/* Charged / Drained stats */}
                <XStack marginTop={8} gap={16}>
                  {garminHealth.bodyBatteryHigh != null && (
                    <XStack alignItems="center" gap={4}>
                      <MaterialCommunityIcons name="arrow-up" size={12} color={colors.cyan} />
                      <B color={colors.textTertiary} fontSize={11}>High: {garminHealth.bodyBatteryHigh}</B>
                    </XStack>
                  )}
                  {garminHealth.bodyBatteryLow != null && (
                    <XStack alignItems="center" gap={4}>
                      <MaterialCommunityIcons name="arrow-down" size={12} color={colors.orange} />
                      <B color={colors.textTertiary} fontSize={11}>Low: {garminHealth.bodyBatteryLow}</B>
                    </XStack>
                  )}
                  {garminHealth.bodyBatteryCharged != null && (
                    <B color={colors.textTertiary} fontSize={11}>+{garminHealth.bodyBatteryCharged} charged</B>
                  )}
                </XStack>
              </YStack>
            );
          })()}

          {/* Training Readiness */}
          {garminHealth.trainingReadiness != null && (() => {
            const tr = garminHealth.trainingReadiness!;
            const trColor = tr >= 70 ? colors.cyan : tr >= 40 ? colors.orange : colors.error;
            const trLabel = tr >= 70 ? 'HIGH' : tr >= 40 ? 'MODERATE' : 'LOW';
            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap={6}>
                    <MaterialCommunityIcons name="shield-check" size={18} color={trColor} />
                    <B color={colors.textPrimary} fontSize={14} fontWeight="600">Training Readiness</B>
                  </XStack>
                  {null}
                </XStack>
                <XStack alignItems="baseline" gap={6} marginTop={8}>
                  <M color={trColor} fontSize={28} fontWeight="800">{tr}</M>
                  <View backgroundColor={trColor + '22'} paddingHorizontal={8} paddingVertical={2} borderRadius={4}>
                    <H color={trColor} fontSize={10} letterSpacing={1}>{trLabel}</H>
                  </View>
                  {garminHealth.recoveryTimeHours != null && (
                    <XStack alignItems="center" gap={4} marginLeft={8}>
                      <MaterialCommunityIcons name="timer-outline" size={12} color={colors.textTertiary} />
                      <M color={colors.textTertiary} fontSize={11}>
                        {garminHealth.recoveryTimeHours <= 0 ? 'Recovered' : `${garminHealth.recoveryTimeHours}h to recover`}
                      </M>
                    </XStack>
                  )}
                </XStack>
                {garminHealth.readinessFeedbackShort && (
                  <B color={colors.textTertiary} fontSize={12} marginTop={6}>
                    {garminHealth.readinessFeedbackShort.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </B>
                )}
              </YStack>
            );
          })()}

          {/* Training Status + Load + ACWR */}
          {garminHealth.trainingStatus && (() => {
            const statusColors: Record<string, string> = {
              Productive: colors.cyan, Recovery: colors.cyan, Peaking: colors.cyan,
              Maintaining: colors.textSecondary, 'No Status': colors.textTertiary,
              Unproductive: colors.orange, Detraining: colors.orange,
              Overreaching: colors.error,
            };
            const sColor = statusColors[garminHealth.trainingStatus] ?? colors.textSecondary;
            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" justifyContent="space-between" marginBottom={8}>
                  <XStack alignItems="center" gap={6}>
                    <MaterialCommunityIcons name="chart-timeline-variant" size={18} color={sColor} />
                    <B color={colors.textPrimary} fontSize={14} fontWeight="600">Training Status</B>
                  </XStack>
                  {null}
                </XStack>
                <H color={sColor} fontSize={20} letterSpacing={1.5}>{garminHealth.trainingStatus.toUpperCase()}</H>

                {/* Load bar */}
                {garminHealth.trainingLoad7day != null && (
                  <YStack marginTop={10}>
                    <B color={colors.textTertiary} fontSize={11} marginBottom={3}>7-day load: {garminHealth.trainingLoad7day}</B>
                    <View height={4} borderRadius={2} backgroundColor={colors.surfaceHover} overflow="hidden">
                      <View height={4} borderRadius={2} backgroundColor={sColor}
                        width={`${Math.min((garminHealth.trainingLoad7day / 500) * 100, 100)}%` as any} />
                    </View>
                  </YStack>
                )}

                {/* ACWR bar */}
                {garminHealth.acwr != null && (
                  <YStack marginTop={8}>
                    <XStack alignItems="center" gap={4}>
                      <B color={colors.textTertiary} fontSize={11}>ACWR: </B>
                      <M color={garminHealth.acwrStatus === 'OPTIMAL' ? colors.cyan : garminHealth.acwrStatus === 'HIGH' ? colors.error : colors.orange}
                        fontSize={12} fontWeight="700">{garminHealth.acwr.toFixed(1)}</M>
                      <B color={colors.textTertiary} fontSize={10}>({garminHealth.acwrStatus})</B>
                    </XStack>
                    <View height={4} borderRadius={2} backgroundColor={colors.surfaceHover} marginTop={3} overflow="hidden">
                      {/* Sweet spot zone 0.8-1.3 highlighted */}
                      <View style={{ position: 'absolute', left: '40%' as any, width: '25%' as any, height: 4, backgroundColor: colors.cyan + '22' }} />
                      <View height={4} borderRadius={2}
                        backgroundColor={garminHealth.acwrStatus === 'OPTIMAL' ? colors.cyan : colors.orange}
                        width={`${Math.min((garminHealth.acwr / 2) * 100, 100)}%` as any} />
                    </View>
                    <XStack justifyContent="space-between" marginTop={2}>
                      <M color={colors.textTertiary} fontSize={8}>0</M>
                      <B color={colors.textTertiary} fontSize={8}>sweet spot</B>
                      <M color={colors.textTertiary} fontSize={8}>2.0</M>
                    </XStack>
                  </YStack>
                )}
              </YStack>
            );
          })()}

          {/* VO2max */}
          {garminHealth.vo2max != null && (
            <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
              <XStack alignItems="center" justifyContent="space-between">
                <XStack alignItems="center" gap={6}>
                  <MaterialCommunityIcons name="lungs" size={18} color={colors.cyan} />
                  <B color={colors.textPrimary} fontSize={14} fontWeight="600">VO2max</B>
                </XStack>
                {null}
              </XStack>
              <XStack alignItems="baseline" gap={4} marginTop={8}>
                <M color={colors.textPrimary} fontSize={28} fontWeight="800">{garminHealth.vo2max}</M>
                <B color={colors.textTertiary} fontSize={12}>ml/kg/min</B>
              </XStack>
              {userProfile?.vdot_score && (
                <YStack marginTop={10} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10}>
                  <XStack justifyContent="space-between">
                    <YStack alignItems="center" flex={1}>
                      <GarminIcon size={12} />
                      <M color={colors.cyan} fontSize={16} fontWeight="800">{garminHealth.vo2max}</M>
                    </YStack>
                    <View width={0.5} backgroundColor={colors.border} />
                    <YStack alignItems="center" flex={1}>
                      <B color={colors.textTertiary} fontSize={10}>YOUR VDOT</B>
                      <M color={colors.orange} fontSize={16} fontWeight="800">{userProfile.vdot_score.toFixed(1)}</M>
                    </YStack>
                  </XStack>
                  {garminHealth.vo2max > userProfile.vdot_score + 5 && (
                    <B color={colors.textTertiary} fontSize={10} textAlign="center" marginTop={6}>
                      Gap suggests untapped aerobic potential
                    </B>
                  )}
                </YStack>
              )}
            </YStack>
          )}

          {/* Race Predictions — Garmin or VDOT fallback */}
          {(() => {
            const fmt = (s: number) => {
              const h = Math.floor(s / 3600);
              const m = Math.floor((s % 3600) / 60);
              const sec = s % 60;
              return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
            };

            // Try Garmin predictions first, fall back to VDOT
            let pred5k = garminHealth.predicted5kSec;
            let pred10k = garminHealth.predicted10kSec;
            let predHalf = garminHealth.predictedHalfSec;
            let predMarathon = garminHealth.predictedMarathonSec;
            let predSource: 'garmin' | 'vdot' = 'garmin';

            if (!predMarathon && userProfile?.vdot_score) {
              // VDOT fallback
              try {
                const { predict5KTime, predict10KTime, predictHalfMarathonTime, predictMarathonTime } = require('../../src/engine/vdot');
                pred5k = Math.round(predict5KTime(userProfile.vdot_score));
                pred10k = Math.round(predict10KTime(userProfile.vdot_score));
                predHalf = Math.round(predictHalfMarathonTime(userProfile.vdot_score));
                predMarathon = Math.round(predictMarathonTime(userProfile.vdot_score));
                predSource = 'vdot';
              } catch {}
            }

            if (!predMarathon) return null;

            const goalSec = userProfile?.target_finish_time_sec ?? 0;
            const isAhead = goalSec > 0 && predMarathon <= goalSec;
            const gapSec = Math.abs(predMarathon - goalSec);

            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" gap={6} marginBottom={12}>
                  <MaterialCommunityIcons name="flag-checkered" size={16} color={colors.cyan} />
                  <B color={colors.textPrimary} fontSize={14} fontWeight="600">Race Predictions</B>
                  <View flex={1} />
                  {predSource === 'garmin' ? <GarminIcon size={10} /> : (
                    <B color={colors.textTertiary} fontSize={9}>VDOT {userProfile?.vdot_score}</B>
                  )}
                </XStack>

                {/* Marathon hero */}
                <YStack alignItems="center" marginBottom={12}>
                  <H color={colors.textTertiary} fontSize={10} letterSpacing={1.5} marginBottom={4}>MARATHON</H>
                  <GradientText text={fmt(predMarathon)} style={{ fontSize: 32, fontWeight: '800' }} />
                  {goalSec > 0 && (
                    <YStack alignItems="center" marginTop={8} width="100%">
                      <XStack justifyContent="space-between" width="100%" marginBottom={4}>
                        <B color={colors.textTertiary} fontSize={10}>Predicted</B>
                        <B color={colors.textTertiary} fontSize={10}>Goal: {fmt(goalSec)}</B>
                      </XStack>
                      <View height={6} borderRadius={3} backgroundColor={colors.surfaceHover} width="100%" overflow="hidden">
                        {(() => {
                          const maxTime = Math.max(predMarathon, goalSec) * 1.1;
                          const predPct = Math.max(5, 100 - (predMarathon / maxTime) * 100);
                          const goalPct = Math.max(5, 100 - (goalSec / maxTime) * 100);
                          return (
                            <>
                              <View height={6} borderRadius={3} backgroundColor={isAhead ? colors.cyan : colors.orange}
                                width={`${Math.min(predPct, 100)}%` as any} />
                              <View style={{ position: 'absolute', left: `${goalPct}%` as any, top: -2, width: 2, height: 10, backgroundColor: colors.textSecondary, borderRadius: 1 }} />
                            </>
                          );
                        })()}
                      </View>
                      <XStack alignItems="center" gap={4} marginTop={6}>
                        <MaterialCommunityIcons name={isAhead ? 'check-circle' : 'alert-circle'} size={14} color={isAhead ? colors.cyan : colors.orange} />
                        <B color={isAhead ? colors.cyan : colors.orange} fontSize={12} fontWeight="700">
                          {isAhead ? `${fmt(gapSec)} ahead of goal` : `${fmt(gapSec)} to close`}
                        </B>
                      </XStack>
                    </YStack>
                  )}
                </YStack>

                {/* Other distances — compact row */}
                <XStack justifyContent="space-around" paddingTop={10} borderTopWidth={0.5} borderTopColor={colors.border}>
                  {[
                    { label: '5K', sec: pred5k },
                    { label: '10K', sec: pred10k },
                    { label: 'HALF', sec: predHalf },
                  ].map(r => (
                    <YStack key={r.label} alignItems="center">
                      <H color={colors.textTertiary} fontSize={8} letterSpacing={1}>{r.label}</H>
                      <M color={colors.textPrimary} fontSize={13} fontWeight="700" marginTop={2}>{r.sec ? fmt(r.sec) : '--'}</M>
                    </YStack>
                  ))}
                </XStack>

                {/* Source label for VDOT fallback */}
                {predSource === 'vdot' && (
                  <B color={colors.textTertiary} fontSize={10} textAlign="center" marginTop={8}>
                    Based on VDOT {userProfile?.vdot_score} (best effort). Run more to get Garmin predictions.
                  </B>
                )}
              </YStack>
            );
          })()}

          {/* Fitness Scores — Endurance + Hill */}
          {(garminHealth.enduranceScore != null || garminHealth.hillScore != null) && (() => {
            const endLabel = (v: number) => v >= 8000 ? 'Excellent' : v >= 5000 ? 'Good' : v >= 2000 ? 'Moderate' : 'Low';
            const endColor = (v: number) => v >= 8000 ? colors.cyan : v >= 5000 ? colors.cyan : v >= 2000 ? colors.textSecondary : colors.orange;
            const hillLabel = (v: number) => v >= 75 ? 'Excellent' : v >= 50 ? 'Good' : v >= 25 ? 'Moderate' : 'Low';
            const hillColor = (v: number) => v >= 75 ? colors.cyan : v >= 50 ? colors.cyan : v >= 25 ? colors.textSecondary : colors.orange;

            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" gap={6} marginBottom={12}>
                  <MaterialCommunityIcons name="chart-bar" size={16} color={colors.cyan} />
                  <B color={colors.textPrimary} fontSize={14} fontWeight="600">Fitness Scores</B>
                  <View flex={1} />
                  <GarminIcon size={10} />
                </XStack>

                <XStack gap={16}>
                  {garminHealth.enduranceScore != null && (
                    <YStack flex={1}>
                      <H color={colors.textTertiary} fontSize={9} letterSpacing={1} marginBottom={4}>ENDURANCE</H>
                      <M color={colors.textPrimary} fontSize={22} fontWeight="800">{garminHealth.enduranceScore.toLocaleString()}</M>
                      <View height={5} borderRadius={2.5} backgroundColor={colors.surfaceHover} marginTop={6} overflow="hidden">
                        <View height={5} borderRadius={2.5}
                          backgroundColor={endColor(garminHealth.enduranceScore)}
                          width={`${Math.min((garminHealth.enduranceScore / 10000) * 100, 100)}%` as any} />
                      </View>
                      <B color={endColor(garminHealth.enduranceScore)} fontSize={10} fontWeight="600" marginTop={3}>
                        {endLabel(garminHealth.enduranceScore)}
                      </B>
                    </YStack>
                  )}

                  {garminHealth.hillScore != null && (
                    <YStack flex={1}>
                      <H color={colors.textTertiary} fontSize={9} letterSpacing={1} marginBottom={4}>HILL SCORE</H>
                      <M color={colors.textPrimary} fontSize={22} fontWeight="800">{garminHealth.hillScore}</M>
                      <View height={5} borderRadius={2.5} backgroundColor={colors.surfaceHover} marginTop={6} overflow="hidden">
                        <View height={5} borderRadius={2.5}
                          backgroundColor={hillColor(garminHealth.hillScore)}
                          width={`${Math.min(garminHealth.hillScore, 100)}%` as any} />
                      </View>
                      <B color={hillColor(garminHealth.hillScore)} fontSize={10} fontWeight="600" marginTop={3}>
                        {hillLabel(garminHealth.hillScore)}
                      </B>
                      {garminHealth.hillEndurance != null && (
                        <B color={colors.textTertiary} fontSize={9} marginTop={2}>Endurance: {garminHealth.hillEndurance} · Strength: {garminHealth.hillStrength}</B>
                      )}
                    </YStack>
                  )}
                </XStack>

                {garminHealth.hillScore != null && garminHealth.hillScore < 50 && (
                  <XStack alignItems="center" gap={6} marginTop={10} paddingTop={10} borderTopWidth={0.5} borderTopColor={colors.border}>
                    <MaterialCommunityIcons name="lightbulb-outline" size={14} color={colors.orange} />
                    <B color={colors.orange} fontSize={11} flex={1}>SF Marathon is hilly — add hill repeats or incline treadmill to build your score</B>
                  </XStack>
                )}
              </YStack>
            );
          })()}

          {/* Sleep Details merged into SleepCard above */}

          {/* Skin Temp Warning */}
          {garminHealth.skinTempDeviationC != null && Math.abs(garminHealth.skinTempDeviationC) > 0.5 && (
            <XStack backgroundColor={colors.orangeGhost} borderRadius={12} padding={12} alignItems="center" gap={8}
              borderWidth={1} borderColor={colors.orangeDim}>
              <MaterialCommunityIcons name="thermometer-alert" size={16} color={colors.orange} />
              <B color={colors.orange} fontSize={12} flex={1}>
                Skin temp {garminHealth.skinTempDeviationC > 0 ? '+' : ''}{garminHealth.skinTempDeviationC}°C from baseline — possible illness or overtraining
              </B>
            </XStack>
          )}

          {/* Respiratory Rate (display only) */}
          {hasResp && (() => {
            const respSignal = recoveryStatus?.signals.find(s => s.type === 'respiratory_rate');
            if (!respSignal) return null;
            const respColor = respSignal.status === 'good' ? colors.cyan : colors.orange;
            return (
              <YStack backgroundColor={colors.surface} borderRadius={16} padding={16}>
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap={6}>
                    <MaterialCommunityIcons name="lungs" size={16} color={respColor} />
                    <B color={colors.textPrimary} fontSize={14} fontWeight="600">Respiratory Rate</B>
                  </XStack>
                  {null}
                </XStack>
                <XStack alignItems="baseline" gap={4} marginTop={4}>
                  <M color={colors.textPrimary} fontSize={18} fontWeight="800">{respSignal.value}</M>
                  <B color={colors.textTertiary} fontSize={11}>br/min</B>
                </XStack>
                <B color={colors.textTertiary} fontSize={11} marginTop={2}>{respSignal.detail}</B>
              </YStack>
            );
          })()}
        </YStack>
      )}

      {/* Injury Risk Score */}
      {weeks.length >= 3 && (
        (() => {
          const risk = calculateInjuryRisk(
            weeks, workouts, useAppStore.getState().currentWeekNumber,
            recoveryStatus, healthSnapshot?.sleepHours ?? null, healthSnapshot?.sleepTrend ?? [],
          );
          if (risk.factors.length === 0) return null;
          const riskColor = risk.level === 'high' ? colors.error : risk.level === 'moderate' ? colors.orange : colors.cyan;
          return (
            <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginTop="$3" borderLeftWidth={3} borderLeftColor={riskColor}>
              <XStack justifyContent="space-between" alignItems="center" marginBottom="$2">
                <XStack alignItems="center" gap="$2">
                  <MaterialCommunityIcons name="shield-alert" size={16} color={riskColor} />
                  <H color="$textSecondary" fontSize={12} letterSpacing={1.5} textTransform="uppercase">Injury Risk</H>
                </XStack>
                <H color={riskColor} fontSize={14} letterSpacing={1}>{risk.level.toUpperCase()}</H>
              </XStack>
              {risk.factors.filter(f => f.status !== 'ok').map((f, i) => (
                <XStack key={i} alignItems="center" gap="$2" marginBottom={4}>
                  <View width={6} height={6} borderRadius={3} backgroundColor={f.status === 'danger' ? colors.error : colors.orange} />
                  <B color="$textSecondary" fontSize={12}>{f.name}: {f.detail}</B>
                </XStack>
              ))}
              {risk.factors.every(f => f.status === 'ok') && (
                <B color="$textTertiary" fontSize={12}>All factors in safe range</B>
              )}
              {risk.level !== 'low' && (
                <B color={riskColor} fontSize={12} fontStyle="italic" marginTop="$2">{risk.recommendation}</B>
              )}
            </YStack>
          );
        })()
      )}

      {/* Additional Health Context (non-scoring) */}
      {healthSnapshot && (healthSnapshot.spo2 !== null || healthSnapshot.steps !== null) && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginTop="$3" gap="$2">
          {healthSnapshot.spo2 !== null && (
            <XStack alignItems="center" justifyContent="space-between">
              <XStack alignItems="center" gap="$2">
                <MaterialCommunityIcons name="water-percent" size={16} color={healthSnapshot.spo2 < 94 ? colors.error : colors.textSecondary} />
                <B color="$textSecondary" fontSize={13}>Blood Oxygen (SpO2)</B>
              </XStack>
              <M color={healthSnapshot.spo2 < 94 ? '$danger' : '$color'} fontSize={15} fontWeight="700">{healthSnapshot.spo2}%</M>
            </XStack>
          )}
          {healthSnapshot.steps !== null && (
            <YStack>
              <XStack alignItems="center" justifyContent="space-between">
                <XStack alignItems="center" gap="$2">
                  <MaterialCommunityIcons name="shoe-print" size={16} color={colors.textSecondary} />
                  <B color="$textSecondary" fontSize={13}>Steps Today</B>
                </XStack>
                <M color="$color" fontSize={15} fontWeight="700">{healthSnapshot.steps.toLocaleString()}</M>
              </XStack>
              {/* 7-day steps bar chart */}
              {healthSnapshot.stepsTrend && healthSnapshot.stepsTrend.length >= 3 && (
                <YStack marginTop="$3" paddingTop="$3" borderTopWidth={0.5} borderTopColor={colors.border}>
                  <View height={60}>
                    {/* 8K target reference line */}
                    {(() => {
                      const trend = healthSnapshot.stepsTrend;
                      const maxSteps = Math.max(...trend.map(d => d.steps), 8000);
                      const targetY = 60 - (8000 / maxSteps) * 52;
                      return (
                        <View style={{ position: 'absolute', top: targetY, left: 0, right: 0, height: 1, borderStyle: 'dashed', borderTopWidth: 1, borderTopColor: colors.textTertiary, opacity: 0.3 }} />
                      );
                    })()}
                    <XStack height={60} alignItems="flex-end" gap={4}>
                      {(() => {
                        const trend = healthSnapshot.stepsTrend;
                        const maxSteps = Math.max(...trend.map(d => d.steps), 8000);
                        return trend.map((d, i) => {
                          const height = Math.max(4, (d.steps / maxSteps) * 52);
                          const isToday = i === trend.length - 1;
                          return (
                            <YStack key={i} flex={1} alignItems="center">
                              <View width="100%" height={height} borderRadius={3}
                                backgroundColor={isToday ? colors.cyan + 'AA' : colors.cyan + '55'}
                                borderWidth={isToday ? 1 : 0} borderColor={colors.cyan} borderStyle="dashed" />
                            </YStack>
                          );
                        });
                      })()}
                    </XStack>
                  </View>
                  <XStack gap={4} marginTop={4}>
                    {healthSnapshot.stepsTrend.map((d, i) => {
                      const isToday = i === healthSnapshot.stepsTrend.length - 1;
                      return (
                        <YStack key={i} flex={1} alignItems="center">
                          <M color={isToday ? colors.cyan : colors.textTertiary} fontSize={8} fontWeight="600">
                            {d.steps >= 1000 ? `${(d.steps / 1000).toFixed(1)}k` : d.steps}
                          </M>
                          <B color={colors.textTertiary} fontSize={8}>
                            {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}
                          </B>
                        </YStack>
                      );
                    })}
                  </XStack>
                </YStack>
              )}
            </YStack>
          )}
        </YStack>
      )}

      {/* Today's Recommendation is now merged into RecoveryHero above */}

      {/* SECTION 4: Training Load (PMC) */}
      {pmcData && pmcData.totalDays >= 7 && (
        <YStack marginTop="$4">
          <H color="$textSecondary" fontSize={14} letterSpacing={1.5} textTransform="uppercase" marginBottom="$3">
            Training Load
          </H>
          <PMCSummary pmcData={pmcData} aiInsight={pmcInsight} />
          <YStack marginTop="$3">
            <PMCChart data={pmcData.daily} raceDateStr={userProfile?.race_date} height={260} />
          </YStack>
        </YStack>
      )}

      {/* SECTION 5: Pace Zones (collapsible) */}
      <CollapsibleSection title="Pace Zones">
        <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
          {ZONE_NAMES.map(zone => <PaceZoneRow key={zone} zone={zone} paceZones={paceZones} />)}
        </YStack>
      </CollapsibleSection>

      {/* SECTION 5: HR Zones (collapsible) */}
      {hrZones && (
        <CollapsibleSection title="Heart Rate Zones">
          <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
            {hrKeys.map((key, i) => (
              <HRZoneRow key={key} label={hrLabels[i]} name={hrZones[key].name} min={hrZones[key].min} max={hrZones[key].max} index={i} />
            ))}
          </YStack>
        </CollapsibleSection>
      )}

      {/* Fitness Profile removed — VDOT + VO2max shown in RecoveryHero, race predictions in dedicated card */}

      {/* SECTION 7: Personal Records — Trophy Case */}
      {(() => {
        const prs = useAppStore.getState().personalRecords;
        if (prs.length === 0) return null;
        const { getDisplayPRs, formatPRTime } = require('../../src/utils/personalRecords');
        const { LinearGradient: ExpoGrad } = require('expo-linear-gradient');
        const displayPRs = getDisplayPRs(prs);
        const router = require('expo-router').useRouter();
        const latestDate = prs.length > 0 ? prs.reduce((a: any, b: any) => a.date > b.date ? a : b).date : null;
        const prCount = prs.length;

        return (
          <YStack marginTop={16}>
            {/* Hero header — gradient background strip */}
            <ExpoGrad
              colors={[colors.cyan + '15', colors.orange + '08', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <XStack alignItems="center" justifyContent="space-between">
                <XStack alignItems="center" gap={10}>
                  <View width={36} height={36} borderRadius={18} alignItems="center" justifyContent="center">
                    <ExpoGrad
                      colors={[colors.cyan, colors.orange]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialCommunityIcons name="trophy" size={18} color="#fff" />
                    </ExpoGrad>
                  </View>
                  <YStack>
                    <GradientText text="PERSONAL RECORDS" style={{ fontSize: 14, fontWeight: '800', letterSpacing: 1.5 }} />
                    <B color={colors.textTertiary} fontSize={10} marginTop={1}>Your fastest times</B>
                  </YStack>
                </XStack>
                <View />
              </XStack>
            </ExpoGrad>

            {/* PR Cards */}
            <YStack gap={8}>
              {displayPRs.map((pr: any, i: number) => {
                const hasTime = pr.timeSeconds != null;
                const isLatest = hasTime && pr.date === latestDate;

                if (!hasTime) {
                  return (
                    <YStack key={pr.distance} backgroundColor={colors.surface} borderRadius={12}
                      paddingVertical={14} paddingHorizontal={16} opacity={0.35}
                      borderWidth={1} borderColor={colors.border}>
                      <XStack alignItems="center" justifyContent="space-between">
                        <XStack alignItems="center" gap={8}>
                          <MaterialCommunityIcons name="lock-outline" size={14} color={colors.textTertiary} />
                          <B color={colors.textTertiary} fontSize={14}>{pr.distance}</B>
                        </XStack>
                        <B color={colors.textTertiary} fontSize={11} fontStyle="italic">Awaiting your first</B>
                      </XStack>
                    </YStack>
                  );
                }

                return (
                  <Pressable key={pr.distance}
                    onPress={pr.activityId ? () => router.push(`/activity/${pr.activityId}`) : undefined}>
                    {isLatest ? (
                      <GradientBorder side="all" borderWidth={1.5} borderRadius={14}>
                        <ExpoGrad
                          colors={[colors.cyan + '12', colors.orange + '06', colors.surface]}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                          style={{ borderRadius: 13, paddingVertical: 16, paddingHorizontal: 16, opacity: 1 }}>
                          <XStack alignItems="center" justifyContent="space-between">
                            <YStack flex={1}>
                              <XStack alignItems="center" gap={8}>
                                <MaterialCommunityIcons name="star-four-points" size={14} color={colors.cyan} />
                                <B color={colors.textPrimary} fontSize={16} fontWeight="700">{pr.distance}</B>
                                <PRBadge rank={1} size="sm" />
                              </XStack>
                              <B color={colors.textTertiary} fontSize={11} marginTop={3} marginLeft={22}>
                                {new Date(pr.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              </B>
                            </YStack>
                            <XStack alignItems="center" gap={8}>
                              <GradientText text={formatPRTime(pr.timeSeconds)} style={{ fontSize: 26, fontWeight: '800' }} />
                              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textTertiary} />
                            </XStack>
                          </XStack>
                        </ExpoGrad>
                      </GradientBorder>
                    ) : (
                      <YStack backgroundColor={colors.surface} borderRadius={12}
                        paddingVertical={14} paddingHorizontal={16}
                        borderLeftWidth={2} borderLeftColor={colors.cyanDim}>
                        <XStack alignItems="center" justifyContent="space-between">
                          <YStack flex={1}>
                            <XStack alignItems="center" gap={8}>
                              <MaterialCommunityIcons name="medal-outline" size={14} color={colors.textTertiary} />
                              <B color={colors.textSecondary} fontSize={14} fontWeight="600">{pr.distance}</B>
                            </XStack>
                            <B color={colors.textTertiary} fontSize={10} marginTop={2} marginLeft={22}>
                              {new Date(pr.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </B>
                          </YStack>
                          <XStack alignItems="center" gap={8}>
                            <M color={colors.textPrimary} fontSize={22} fontWeight="800">
                              {formatPRTime(pr.timeSeconds)}
                            </M>
                            <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textTertiary} />
                          </XStack>
                        </XStack>
                      </YStack>
                    )}
                  </Pressable>
                );
              })}
            </YStack>
          </YStack>
        );
      })()}

      {/* SECTION 8: Shoes (collapsible) */}
      {shoes.length > 0 && (
        <CollapsibleSection title="Shoes">
          {shoes.map(shoe => <ShoeCard key={shoe.id} shoe={shoe} />)}
        </CollapsibleSection>
      )}

      <YStack height={32} />
    </ScrollView>
  );
}
