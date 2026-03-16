import { useState, useCallback, useRef } from 'react';
import { Alert, Pressable, LayoutChangeEvent, PanResponder, GestureResponderEvent } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, Rect as SvgRect } from 'react-native-svg';
import { useAppStore } from '../../src/store';
import {
  ZONE_DESCRIPTIONS, ZONE_RPE, formatPaceRange, calculateHRZones,
} from '../../src/engine/paceZones';
import {
  predict5KTime, predict10KTime, predictHalfMarathonTime, predictMarathonTime, formatTime,
} from '../../src/engine/vdot';
import { PaceZoneName, PaceZones, HRZones, Shoe, RecoveryStatus, HealthSnapshot, SleepResult, RestingHRResult } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const ZONE_NAMES: PaceZoneName[] = ['E', 'M', 'T', 'I', 'R'];
const ZONE_FULL_NAMES: Record<PaceZoneName, string> = { E: 'Easy', M: 'Marathon', T: 'Threshold', I: 'Interval', R: 'Repetition' };
const ZONE_COLORS: Record<PaceZoneName, string> = { E: '#34C759', M: '#007AFF', T: '#FF9500', I: '#FF3B30', R: '#AF52DE' };

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

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

function RecoveryHero({ recovery, snapshot }: { recovery: RecoveryStatus | null; snapshot: HealthSnapshot | null }) {
  const syncHealth = useAppStore(s => s.syncHealth);
  const [connecting, setConnecting] = useState(false);

  if (!recovery || recovery.level === 'unknown') {
    // No HealthKit data — show connect prompt
    const handleConnect = async () => {
      setConnecting(true);
      try {
        const { isHealthKitAvailable } = require('../../src/health/availability');
        if (!isHealthKitAvailable()) {
          Alert.alert('Not Available', 'Apple Health is not available on this device.');
          setConnecting(false);
          return;
        }
        const { requestHealthKitPermissions } = require('../../src/health/permissions');
        const granted = await requestHealthKitPermissions();
        if (granted) {
          await syncHealth();
        } else {
          Alert.alert('Denied', 'Enable in Settings → Privacy → Health.');
        }
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Failed');
      }
      setConnecting(false);
    };

    return (
      <YStack backgroundColor="$surface" borderRadius="$6" padding="$6" alignItems="center">
        <MaterialCommunityIcons name="heart-pulse" size={40} color="#666666" />
        <H color="$color" fontSize={20} letterSpacing={1} marginTop="$3">Recovery Tracking</H>
        <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20} marginTop="$2" marginBottom="$4">
          Connect Apple Health to track resting heart rate, HRV, and sleep for daily recovery scoring.
        </B>
        <YStack backgroundColor="$accent" borderRadius="$5" paddingHorizontal="$8" paddingVertical="$3"
          pressStyle={{ opacity: 0.8 }} onPress={handleConnect}>
          {connecting ? <Spinner size="small" color="white" /> : <B color="white" fontSize={16} fontWeight="700">Connect Apple Health</B>}
        </YStack>
      </YStack>
    );
  }

  const color = recovery.score >= 80 ? '#34C759'
    : recovery.score >= 60 ? '#FF9500'
    : recovery.score >= 40 ? '#FF9500'
    : '#FF3B30';
  const label = recovery.level.charAt(0).toUpperCase() + recovery.level.slice(1);

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$6" alignItems="center">
      {/* Score Circle */}
      <View width={100} height={100} borderRadius={50} borderWidth={4} borderColor={color}
        backgroundColor={color + '15'} alignItems="center" justifyContent="center">
        <M color={color} fontSize={36} fontWeight="800">{recovery.score}</M>
      </View>
      <H color={color} fontSize={22} letterSpacing={1.5} marginTop="$3" textTransform="uppercase">{label}</H>
      <B color="$textSecondary" fontSize={13} marginTop="$1">Based on {recovery.signalCount}/3 signals</B>
    </YStack>
  );
}

// ─── Graph Scrubber Hook ─────────────────────────────────────

function useGraphScrubber(pointXs: number[]) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  const pointsRef = useRef<number[]>(pointXs);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with latest point positions
  pointsRef.current = pointXs;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => pointsRef.current.length > 0,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
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

function RestingHRCard({ signal, trendData }: {
  signal: { type: string; value: number | null; baseline: number | null; status: string; score: number; detail: string };
  trendData: RestingHRResult[];
}) {
  const [width, setWidth] = useState(0);
  const statusColor = signal.status === 'good' ? '#34C759' : signal.status === 'fair' ? '#FF9500' : '#FF3B30';

  const data = trendData.slice(0, 14).reverse(); // oldest → newest
  const values = data.map(d => d.value);
  const baseline = signal.baseline ?? (values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0);
  const dangerThreshold = baseline + 5;

  const graphH = 140;
  const padT = 30;
  const padB = 24;
  const chartH = graphH - padT - padB;
  const chartW = width;

  const yMin = Math.min(...values, baseline) - 3;
  const yMax = Math.max(...values, dangerThreshold) + 3;
  const yRange = yMax - yMin || 1;

  const toY = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;
  const toX = (i: number) => data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2;

  const points = data.map((d, i) => ({ x: toX(i), y: toY(d.value) }));
  const baselineY = toY(baseline);
  const dangerY = toY(dangerThreshold);

  const { activeIdx, panResponder } = useGraphScrubber(points.map(p => p.x));

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor={statusColor}>
      {/* Header */}
      <XStack alignItems="center" justifyContent="space-between" marginBottom="$2">
        <XStack alignItems="center" gap="$2">
          <MaterialCommunityIcons name="heart-pulse" size={18} color={statusColor} />
          <B color="$color" fontSize={14} fontWeight="600">Resting Heart Rate</B>
        </XStack>
        <XStack alignItems="center" gap="$2">
          {signal.value !== null && <M color="$color" fontSize={18} fontWeight="800">{signal.value}</M>}
          <B color="$textTertiary" fontSize={12}>bpm</B>
        </XStack>
      </XStack>

      {/* Line Graph with drag scrubber */}
      {data.length >= 3 && (
        <View style={{ height: graphH, marginBottom: 4 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          {...(width > 0 ? panResponder.panHandlers : {})}>
          {width > 0 && (
            <>
              <Svg width={width} height={graphH}>
                <Defs>
                  <LinearGradient id="rhrFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={statusColor} stopOpacity="0.25" />
                    <Stop offset="1" stopColor={statusColor} stopOpacity="0.02" />
                  </LinearGradient>
                  <LinearGradient id="rhrDanger" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#FF3B30" stopOpacity="0.12" />
                    <Stop offset="1" stopColor="#FF3B30" stopOpacity="0.03" />
                  </LinearGradient>
                </Defs>

                {/* Danger zone */}
                {dangerY < baselineY && (
                  <SvgRect x={0} y={dangerY} width={chartW} height={baselineY - dangerY} fill="url(#rhrDanger)" />
                )}

                {/* Gradient fill */}
                <Path d={buildFillPath(points, padT + chartH)} fill="url(#rhrFill)" />

                {/* Baseline dashed */}
                <Line x1={0} y1={baselineY} x2={chartW} y2={baselineY}
                  stroke="#666666" strokeWidth={1} strokeDasharray="4,4" />

                {/* Scrubber vertical line */}
                {activeIdx !== null && points[activeIdx] && (
                  <Line x1={points[activeIdx].x} y1={padT} x2={points[activeIdx].x} y2={padT + chartH}
                    stroke="#FFFFFF" strokeWidth={1} strokeOpacity={0.4} />
                )}

                {/* Main line */}
                <Path d={buildSmoothPath(points)} fill="none" stroke={statusColor} strokeWidth={2} />

                {/* Dots */}
                {points.map((p, i) => {
                  const v = data[i].value;
                  const dotColor = v >= dangerThreshold ? '#FF3B30' : v > baseline + 2 ? '#FF9500' : statusColor;
                  const isActive = activeIdx === i;
                  const isLast = i === points.length - 1 && activeIdx === null;
                  const r = isActive ? 7 : isLast ? 4 : 2.5;
                  return (
                    <Circle key={i} cx={p.x} cy={p.y} r={r}
                      fill={isActive || isLast ? dotColor : dotColor + '66'}
                      stroke={isActive ? '#FFFFFF' : isLast ? '#1E1E1E' : 'none'}
                      strokeWidth={isActive ? 2 : isLast ? 2 : 0} />
                  );
                })}
              </Svg>

              {/* Tooltip follows scrubber */}
              {activeIdx !== null && points[activeIdx] && (
                <View style={{
                  position: 'absolute',
                  left: Math.max(0, Math.min(points[activeIdx].x - 44, width - 88)),
                  top: 0,
                  backgroundColor: '#2A2A2A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                  borderWidth: 0.5, borderColor: '#555',
                }}>
                  <XStack alignItems="center" gap={6}>
                    <M color="$color" fontSize={15} fontWeight="800">{data[activeIdx].value} bpm</M>
                    <B color="$textTertiary" fontSize={11}>
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
        <XStack justifyContent="space-between" marginTop={-20}>
          {data.map((d, i) => {
            if (data.length > 7 && i % 2 !== 0 && i !== data.length - 1) return <View key={i} flex={1} />;
            const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
            return (
              <B key={i} color="$textTertiary" fontSize={9} textAlign="center" flex={1}>{dayLabel}</B>
            );
          })}
        </XStack>
      )}

      {/* Baseline label */}
      {signal.baseline !== null && (
        <XStack marginTop="$1">
          <B color="$textTertiary" fontSize={10}>avg: {signal.baseline} bpm</B>
        </XStack>
      )}

      {/* Summary */}
      <XStack marginTop="$2" justifyContent="space-between" alignItems="center">
        <B color="$textTertiary" fontSize={12}>{signal.detail}</B>
        <M color={statusColor} fontSize={12} fontWeight="700">{signal.score}/33</M>
      </XStack>
    </YStack>
  );
}

// ─── Generic Signal Card (for HRV) ──────────────────────────

function SignalCard({ signal, trendData }: {
  signal: { type: string; value: number | null; baseline: number | null; status: string; score: number; detail: string };
  trendData: number[];
}) {
  const statusColor = signal.status === 'good' ? '#34C759' : signal.status === 'fair' ? '#FF9500' : '#FF3B30';
  const typeLabels: Record<string, string> = { hrv: 'Heart Rate Variability' };
  const typeUnits: Record<string, string> = { hrv: 'ms' };
  const typeIcons: Record<string, string> = { hrv: 'wave' };

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor={statusColor}>
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap="$2">
          <MaterialCommunityIcons name={typeIcons[signal.type] as any} size={18} color={statusColor} />
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
        <B color="$textTertiary" fontSize={12}>{signal.detail}</B>
        <M color={statusColor} fontSize={12} fontWeight="700">{signal.score}/33</M>
      </XStack>
    </YStack>
  );
}

function SignalNotAvailable({ type }: { type: string }) {
  const labels: Record<string, string> = { resting_hr: 'Resting Heart Rate', hrv: 'Heart Rate Variability', sleep: 'Sleep' };
  const icons: Record<string, string> = { resting_hr: 'heart-pulse', hrv: 'wave', sleep: 'sleep' };
  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor="$border" opacity={0.6}>
      <XStack alignItems="center" gap="$2">
        <MaterialCommunityIcons name={icons[type] as any} size={18} color="#666666" />
        <B color="$textSecondary" fontSize={14} fontWeight="600">{labels[type]}</B>
        <B color="$textTertiary" fontSize={12} flex={1} textAlign="right">Not available from your device</B>
      </XStack>
    </YStack>
  );
}

// ─── Sleep Card (dedicated, rich layout) ─────────────────────

function formatTime12h(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
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

const STAGE_COLORS = {
  deep: '#1A3A8F',     // dark blue
  light: '#5B9BD5',    // light blue
  rem: '#9B59B6',      // purple
  awake: '#666666',    // gray
};

function SleepCard({ signal, sleepTrend }: {
  signal: { value: number | null; status: string; score: number; detail: string };
  sleepTrend: SleepResult[];
}) {
  const [sleepGraphW, setSleepGraphW] = useState(0);
  const statusColor = signal.status === 'good' ? '#34C759' : signal.status === 'fair' ? '#FF9500' : '#FF3B30';
  const latest = sleepTrend.length > 0 ? sleepTrend[0] : null; // newest first
  const recentNights = sleepTrend.slice(0, 7).reverse(); // oldest→newest

  const sleepHoursColor = (hrs: number) => hrs >= 7 ? '#34C759' : hrs >= 6 ? '#FF9500' : '#FF3B30';

  // Sleep line graph dimensions
  const sGraphH = 120;
  const sPadT = 28; // room for tooltip
  const sPadB = 4;
  const sChartH = sGraphH - sPadT - sPadB;
  const sChartW = sleepGraphW;

  const sleepHours = recentNights.map(n => n.totalMinutes / 60);
  const sYMin = Math.min(...sleepHours, 5) - 0.5;
  const sYMax = Math.max(...sleepHours, 8) + 0.5;
  const sYRange = sYMax - sYMin || 1;
  const goodThreshold = 7;

  const sToY = (v: number) => sPadT + sChartH - ((v - sYMin) / sYRange) * sChartH;
  const sToX = (i: number) => recentNights.length > 1 ? (i / (recentNights.length - 1)) * sChartW : sChartW / 2;

  const sleepPoints = sleepHours.map((h, i) => ({ x: sToX(i), y: sToY(h) }));
  const goodLineY = sToY(goodThreshold);
  const sleepScrubber = useGraphScrubber(sleepPoints.map(p => p.x));
  const sleepSelIdx = sleepScrubber.activeIdx;

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" borderLeftWidth={3} borderLeftColor={statusColor}>
      {/* Header */}
      <XStack alignItems="center" justifyContent="space-between" marginBottom="$3">
        <XStack alignItems="center" gap="$2">
          <MaterialCommunityIcons name="sleep" size={18} color={statusColor} />
          <B color="$color" fontSize={14} fontWeight="600">Sleep</B>
          {latest && <B color="$textTertiary" fontSize={12}>— {formatNightLabel(latest.date)}</B>}
        </XStack>
        <M color={statusColor} fontSize={12} fontWeight="700">{signal.score}/33</M>
      </XStack>

      {/* Main stats row */}
      {latest && (
        <XStack justifyContent="space-between" alignItems="baseline" marginBottom="$3">
          <M color="$color" fontSize={28} fontWeight="800">{(latest.totalMinutes / 60).toFixed(1)} hrs</M>
          <B color="$textSecondary" fontSize={13}>
            {formatTime12h(latest.bedStart)} → {formatTime12h(latest.bedEnd)}
          </B>
        </XStack>
      )}

      {/* Sleep stage bar + breakdown */}
      {latest?.stages && (
        <YStack marginBottom="$3">
          <XStack height={12} borderRadius={6} overflow="hidden" marginBottom="$2">
            {(() => {
              const { deepMinutes, lightMinutes, remMinutes, awakeMinutes } = latest.stages;
              const total = deepMinutes + lightMinutes + remMinutes + awakeMinutes;
              if (total === 0) return null;
              return (
                <>
                  {deepMinutes > 0 && <View flex={deepMinutes / total} backgroundColor={STAGE_COLORS.deep} />}
                  {lightMinutes > 0 && <View flex={lightMinutes / total} backgroundColor={STAGE_COLORS.light} />}
                  {remMinutes > 0 && <View flex={remMinutes / total} backgroundColor={STAGE_COLORS.rem} />}
                  {awakeMinutes > 0 && <View flex={awakeMinutes / total} backgroundColor={STAGE_COLORS.awake} />}
                </>
              );
            })()}
          </XStack>
          <XStack flexWrap="wrap" gap="$3">
            {latest.stages.deepMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.deep} />
                <B color="$textSecondary" fontSize={11}>Deep</B>
                <M color="$color" fontSize={11} fontWeight="600">{(latest.stages.deepMinutes / 60).toFixed(1)}h</M>
              </XStack>
            )}
            {latest.stages.lightMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.light} />
                <B color="$textSecondary" fontSize={11}>Light</B>
                <M color="$color" fontSize={11} fontWeight="600">{(latest.stages.lightMinutes / 60).toFixed(1)}h</M>
              </XStack>
            )}
            {latest.stages.remMinutes > 0 && (
              <XStack alignItems="center" gap={4}>
                <View width={8} height={8} borderRadius={4} backgroundColor={STAGE_COLORS.rem} />
                <B color="$textSecondary" fontSize={11}>REM</B>
                <M color="$color" fontSize={11} fontWeight="600">{(latest.stages.remMinutes / 60).toFixed(1)}h</M>
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

      {/* Sleep line graph */}
      {recentNights.length >= 3 && (
        <YStack marginTop="$2" paddingTop="$3" borderTopWidth={1} borderTopColor="$border">
          <B color="$textTertiary" fontSize={11} marginBottom="$2">Last {recentNights.length} nights</B>

          <View style={{ height: sGraphH }} onLayout={(e) => setSleepGraphW(e.nativeEvent.layout.width)}
            {...(sleepGraphW > 0 ? sleepScrubber.panResponder.panHandlers : {})}>
            {sleepGraphW > 0 && (
              <>
                <Svg width={sleepGraphW} height={sGraphH}>
                  <Defs>
                    <LinearGradient id="sleepFill" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={statusColor} stopOpacity="0.2" />
                      <Stop offset="1" stopColor={statusColor} stopOpacity="0.02" />
                    </LinearGradient>
                  </Defs>

                  {/* Good sleep threshold */}
                  <Line x1={0} y1={goodLineY} x2={sChartW} y2={goodLineY}
                    stroke="#34C759" strokeWidth={1} strokeDasharray="4,4" strokeOpacity={0.4} />

                  {/* Scrubber vertical line */}
                  {sleepSelIdx !== null && sleepPoints[sleepSelIdx] && (
                    <Line x1={sleepPoints[sleepSelIdx].x} y1={sPadT} x2={sleepPoints[sleepSelIdx].x} y2={sPadT + sChartH}
                      stroke="#FFFFFF" strokeWidth={1} strokeOpacity={0.4} />
                  )}

                  {/* Fill + line */}
                  <Path d={buildFillPath(sleepPoints, sPadT + sChartH)} fill="url(#sleepFill)" />
                  <Path d={buildSmoothPath(sleepPoints)} fill="none" stroke={statusColor} strokeWidth={2} />

                  {/* Dots */}
                  {sleepPoints.map((p, i) => {
                    const hrs = sleepHours[i];
                    const dotColor = sleepHoursColor(hrs);
                    const isActive = sleepSelIdx === i;
                    const isLast = i === sleepPoints.length - 1 && sleepSelIdx === null;
                    const r = isActive ? 7 : isLast ? 4 : 2.5;
                    return (
                      <Circle key={i} cx={p.x} cy={p.y} r={r}
                        fill={isActive || isLast ? dotColor : dotColor + '66'}
                        stroke={isActive ? '#FFFFFF' : isLast ? '#1E1E1E' : 'none'}
                        strokeWidth={isActive ? 2 : isLast ? 2 : 0} />
                    );
                  })}
                </Svg>

                {/* Tooltip follows scrubber */}
                {sleepSelIdx !== null && sleepPoints[sleepSelIdx] && (
                  <View style={{
                    position: 'absolute',
                    left: Math.max(0, Math.min(sleepPoints[sleepSelIdx].x - 50, sleepGraphW - 100)),
                    top: 0,
                    backgroundColor: '#2A2A2A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                    borderWidth: 0.5, borderColor: '#555',
                  }}>
                    <XStack alignItems="center" gap={6}>
                      <M color="$color" fontSize={15} fontWeight="800">{sleepHours[sleepSelIdx].toFixed(1)} hrs</M>
                      <B color="$textTertiary" fontSize={11}>
                        {formatNightLabel(recentNights[sleepSelIdx].date)}
                      </B>
                    </XStack>
                    {recentNights[sleepSelIdx].bedStart && (
                      <B color="$textTertiary" fontSize={10}>
                        {formatTime12h(recentNights[sleepSelIdx].bedStart)} → {formatTime12h(recentNights[sleepSelIdx].bedEnd)}
                      </B>
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          {/* Day labels below graph */}
          <XStack justifyContent="space-between" marginTop={4}>
            {recentNights.map((night, i) => (
              <YStack key={i} alignItems="center" flex={1}>
                <B color="$textTertiary" fontSize={9}>{formatDayLabel(night.date)}</B>
              </YStack>
            ))}
          </XStack>

          {/* 7hr threshold label */}
          <XStack marginTop="$1">
            <B color="$textTertiary" fontSize={10}>— 7 hrs (good sleep threshold)</B>
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

// ─── Pace / HR / Fitness / Shoes (from old Zones screen) ────

function PaceZoneRow({ zone, paceZones }: { zone: PaceZoneName; paceZones: PaceZones }) {
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
        <M color="$accent" fontSize={15} fontWeight="700" marginLeft={28} marginBottom={2}>
          {formatPaceRange(range)} /mi
        </M>
        <B color="$textSecondary" fontSize={12} marginLeft={28} lineHeight={16}>{desc}</B>
      </YStack>
    </XStack>
  );
}

function HRZoneRow({ label, name, min, max, index }: { label: string; name: string; min: number; max: number; index: number }) {
  const hrColors = ['#34C759', '#007AFF', '#FF9500', '#FF3B30', '#AF52DE'];
  return (
    <XStack alignItems="center" paddingVertical={11} paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
      <View width={4} height={28} borderRadius={2} marginRight="$3" backgroundColor={hrColors[index]} />
      <YStack flex={1}>
        <B color="$color" fontSize={14} fontWeight="600">{label}</B>
        <B color="$textSecondary" fontSize={12}>{name}</B>
      </YStack>
      <M color="$accent" fontSize={14} fontWeight="600">{min} - {max} bpm</M>
    </XStack>
  );
}

function ShoeCard({ shoe }: { shoe: Shoe }) {
  const percent = shoe.maxMiles > 0 ? shoe.totalMiles / shoe.maxMiles : 0;
  const clampedPercent = Math.min(percent, 1);
  const isWarning = percent >= 0.8;
  const isCritical = percent >= 1.0;
  const barColor = isCritical ? '#FF3B30' : isWarning ? '#FF9500' : '#34C759';

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
        <M color={isWarning ? barColor : '$color'} fontSize={14} fontWeight="700">{shoe.totalMiles.toFixed(0)} mi</M>
        <M color="$textTertiary" fontSize={12}>/ {shoe.maxMiles} mi</M>
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
  const userProfile = useAppStore(s => s.userProfile);
  const paceZones = useAppStore(s => s.paceZones);
  const shoes = useAppStore(s => s.shoes);
  const recoveryStatus = useAppStore(s => s.recoveryStatus);
  const healthSnapshot = useAppStore(s => s.healthSnapshot);
  const todaysWorkout = useAppStore(s => s.todaysWorkout);

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

  const vdot = userProfile.vdot_score;
  const hasHR = userProfile.max_hr != null && userProfile.rest_hr != null;
  const hrZones: HRZones | null = hasHR ? calculateHRZones(userProfile.max_hr!, userProfile.rest_hr!) : null;
  const hrLabels = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'] as const;
  const hrKeys = ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'] as const;

  // Build signal presence map
  const hasRHR = recoveryStatus?.signals.some(s => s.type === 'resting_hr') ?? false;
  const hasHRV = recoveryStatus?.signals.some(s => s.type === 'hrv') ?? false;
  const hasSleep = recoveryStatus?.signals.some(s => s.type === 'sleep') ?? false;

  // Build trend arrays
  const rhrTrendFull = healthSnapshot?.restingHRTrend ?? []; // newest first from HealthKit
  const hrvTrend = healthSnapshot?.hrvTrend?.map(r => r.value).reverse() ?? [];

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>

      {/* SECTION 1: Recovery Score Hero */}
      <RecoveryHero recovery={recoveryStatus} snapshot={healthSnapshot} />

      {/* SECTION 2: Recovery Signals */}
      {recoveryStatus && recoveryStatus.level !== 'unknown' && (
        <YStack marginTop="$4" gap="$3">
          {hasRHR ? (
            <RestingHRCard signal={recoveryStatus.signals.find(s => s.type === 'resting_hr')!} trendData={rhrTrendFull} />
          ) : (
            <SignalNotAvailable type="resting_hr" />
          )}
          {hasHRV ? (
            <SignalCard signal={recoveryStatus.signals.find(s => s.type === 'hrv')!} trendData={hrvTrend} />
          ) : (
            <SignalNotAvailable type="hrv" />
          )}
          {hasSleep ? (
            <SleepCard
              signal={recoveryStatus.signals.find(s => s.type === 'sleep')!}
              sleepTrend={healthSnapshot?.sleepTrend ?? []}
            />
          ) : (
            <SignalNotAvailable type="sleep" />
          )}
        </YStack>
      )}

      {/* SECTION 3: Today's Recommendation */}
      {recoveryStatus && recoveryStatus.level !== 'unknown' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginTop="$4" borderLeftWidth={3}
          borderLeftColor={recoveryStatus.score >= 80 ? '#34C759' : recoveryStatus.score >= 60 ? '#FF9500' : '#FF3B30'}>
          <H color="$textSecondary" fontSize={12} textTransform="uppercase" letterSpacing={1.5} marginBottom="$2">
            Today's Recommendation
          </H>
          <B color="$color" fontSize={14} lineHeight={21}>{recoveryStatus.recommendation}</B>
          {todaysWorkout && todaysWorkout.workout_type !== 'rest' && (
            <B color="$textTertiary" fontSize={12} marginTop="$2">
              Scheduled: {todaysWorkout.title} — {todaysWorkout.target_distance_miles?.toFixed(1)} mi
            </B>
          )}
        </YStack>
      )}

      {/* SECTION 4: Pace Zones (collapsible) */}
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

      {/* SECTION 6: Fitness Profile (collapsible) */}
      <CollapsibleSection title="Fitness Profile">
        <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
          <XStack justifyContent="center" alignItems="center" paddingVertical="$4" borderBottomWidth={0.5} borderBottomColor="$border">
            <YStack alignItems="center">
              <H color="$textSecondary" fontSize={12} textTransform="uppercase" letterSpacing={1}>VDOT</H>
              <M color="$accent" fontSize={42} fontWeight="800" lineHeight={48}>{vdot.toFixed(1)}</M>
            </YStack>
          </XStack>
          {[
            { label: '5K', time: formatTime(predict5KTime(vdot)) },
            { label: '10K', time: formatTime(predict10KTime(vdot)) },
            { label: 'Half Marathon', time: formatTime(predictHalfMarathonTime(vdot)) },
            { label: 'Marathon', time: formatTime(predictMarathonTime(vdot)) },
          ].map(p => (
            <XStack key={p.label} justifyContent="space-between" alignItems="center" paddingVertical="$3" paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
              <B color="$color" fontSize={15} fontWeight="600">{p.label}</B>
              <M color="$accent" fontSize={17} fontWeight="800">{p.time}</M>
            </XStack>
          ))}
        </YStack>
      </CollapsibleSection>

      {/* SECTION 7: Shoes (collapsible) */}
      {shoes.length > 0 && (
        <CollapsibleSection title="Shoes">
          {shoes.map(shoe => <ShoeCard key={shoe.id} shoe={shoe} />)}
        </CollapsibleSection>
      )}

      <YStack height={32} />
    </ScrollView>
  );
}
