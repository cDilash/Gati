/**
 * PMCChart — Performance Management Chart.
 *
 * Three lines over time:
 *   CTL (Fitness) — cyan, smooth, 2.5px
 *   ATL (Fatigue) — orange, spikier, 2px
 *   TSB (Form)    — area fill: cyan above zero (fresh), orange below (fatigued)
 *
 * Features:
 *   - Interactive scrubber with tooltip (date + CTL + ATL + TSB + workout)
 *   - Future projection as dashed lines
 *   - Race day marker
 *   - Legend with toggle to show/hide lines
 *   - X-axis week labels, Y-axis auto-scaled with zero line
 *
 * Built with react-native-svg following the zones.tsx chart pattern.
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import Svg, {
  Path,
  Circle,
  Line,
  Defs,
  LinearGradient,
  Stop,
  Rect as SvgRect,
  Text as SvgText,
} from 'react-native-svg';
import { Text } from 'tamagui';
import { colors } from '../theme/colors';
import { PMCDayData } from '../types';

// ─── Typography ──────────────────────────────────────────────

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Props ───────────────────────────────────────────────────

interface Props {
  data: PMCDayData[];
  raceDateStr?: string | null;
  height?: number;
}

// ─── Path builders ───────────────────────────────────────────

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = ((prev.x + curr.x) / 2).toFixed(1);
    d += ` C ${cpx} ${prev.y.toFixed(1)}, ${cpx} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return d;
}

function buildLinearPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  return d;
}

// ─── Subsample for performance ───────────────────────────────

function subsampleData(data: PMCDayData[], maxPoints: number): PMCDayData[] {
  if (data.length <= maxPoints) return data;
  const step = (data.length - 1) / (maxPoints - 1);
  const result: PMCDayData[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)]);
  }
  result.push(data[data.length - 1]);
  return result;
}

// ─── Component ───────────────────────────────────────────────

export function PMCChart({ data, raceDateStr, height = 280 }: Props) {
  const [width, setWidth] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [visibleLines, setVisibleLines] = useState({ ctl: true, atl: true, tsb: true, acwr: false });
  const dismissTimer = useRef<any>(null);

  // Subsample for rendering performance
  const chartData = useMemo(() => subsampleData(data, 500), [data]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // ─── Dimensions ────────────────────────────────────────

  const padT = 10;
  const padB = 24;
  const padL = 36;
  const padR = 8;
  const chartH = height - padT - padB;
  const chartW = width - padL - padR;

  // ─── Scales ────────────────────────────────────────────

  const { yMin, yMax, zeroY, points, raceIdx, todayIdx } = useMemo(() => {
    if (chartData.length < 2 || chartW <= 0) {
      return { yMin: 0, yMax: 100, zeroY: 0, points: { ctl: [], atl: [], tsb: [], acwr: [] }, raceIdx: -1, todayIdx: -1 };
    }

    // Find value range across all three lines
    let minV = 0;
    let maxV = 0;
    for (const d of chartData) {
      if (visibleLines.ctl) { minV = Math.min(minV, d.ctl); maxV = Math.max(maxV, d.ctl); }
      if (visibleLines.atl) { minV = Math.min(minV, d.atl); maxV = Math.max(maxV, d.atl); }
      if (visibleLines.tsb) { minV = Math.min(minV, d.tsb); maxV = Math.max(maxV, d.tsb); }
    }

    // Ensure zero is always visible and add padding
    minV = Math.min(minV, 0) - 5;
    maxV = Math.max(maxV, 0) + 5;
    const range = maxV - minV || 1;

    const toX = (i: number) => padL + (i / (chartData.length - 1)) * chartW;
    const toY = (v: number) => padT + chartH - ((v - minV) / range) * chartH;

    const ctlPts = chartData.map((d, i) => ({ x: toX(i), y: toY(d.ctl) }));
    const atlPts = chartData.map((d, i) => ({ x: toX(i), y: toY(d.atl) }));
    const tsbPts = chartData.map((d, i) => ({ x: toX(i), y: toY(d.tsb) }));

    // ACWR on a secondary axis (0.0 to 2.5 range)
    const acwrMin = 0;
    const acwrMax = 2.5;
    const toAcwrY = (v: number) => padT + chartH - ((v - acwrMin) / (acwrMax - acwrMin)) * chartH;
    const acwrPts = chartData.map((d, i) => {
      const acwr = d.ctl > 0 ? d.atl / d.ctl : 0;
      return { x: toX(i), y: toAcwrY(Math.min(acwr, acwrMax)) };
    });

    // Find race day and today indices
    let rIdx = -1;
    let tIdx = -1;
    for (let i = 0; i < chartData.length; i++) {
      if (raceDateStr && chartData[i].date === raceDateStr) rIdx = i;
      if (i < chartData.length - 1 && !chartData[i].isProjected && chartData[i + 1].isProjected) tIdx = i;
    }
    // If no projection boundary found, today is the last point
    if (tIdx === -1 && chartData.length > 0 && !chartData[chartData.length - 1].isProjected) {
      tIdx = chartData.length - 1;
    }

    return {
      yMin: minV,
      yMax: maxV,
      zeroY: toY(0),
      points: { ctl: ctlPts, atl: atlPts, tsb: tsbPts, acwr: acwrPts },
      raceIdx: rIdx,
      todayIdx: tIdx,
    };
  }, [chartData, chartW, chartH, padL, padR, padT, visibleLines, raceDateStr]);

  // ─── TSB fill paths (split at zero) ────────────────────

  const tsbFillPaths = useMemo(() => {
    if (!visibleLines.tsb || points.tsb.length < 2) return { positive: '', negative: '' };

    // Build fill area above zero (positive TSB = fresh)
    let posPath = '';
    let negPath = '';

    // Simple approach: two closed paths, one above zero, one below
    // Positive fill: TSB line clamped to max(tsb, zero), filled down to zero
    const posPts = points.tsb.map((p, i) => ({
      x: p.x,
      y: Math.min(p.y, zeroY), // clamp to zero or above
    }));
    const negPts = points.tsb.map((p, i) => ({
      x: p.x,
      y: Math.max(p.y, zeroY), // clamp to zero or below
    }));

    // Positive fill path (above zero line)
    const posLine = buildLinearPath(posPts);
    if (posLine) {
      posPath = `${posLine} L ${posPts[posPts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${posPts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
    }

    // Negative fill path (below zero line)
    const negLine = buildLinearPath(negPts);
    if (negLine) {
      negPath = `${negLine} L ${negPts[negPts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${negPts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
    }

    return { positive: posPath, negative: negPath };
  }, [points.tsb, zeroY, visibleLines.tsb]);

  // ─── Historical vs projected split indices ──────────────

  const splitPaths = useMemo(() => {
    if (todayIdx < 0 || todayIdx >= chartData.length - 1) {
      return {
        ctlHist: visibleLines.ctl ? buildSmoothPath(points.ctl) : '',
        atlHist: visibleLines.atl ? buildSmoothPath(points.atl) : '',
        tsbHist: visibleLines.tsb ? buildLinearPath(points.tsb) : '',
        acwrHist: visibleLines.acwr ? buildLinearPath(points.acwr) : '',
        ctlProj: '', atlProj: '', tsbProj: '', acwrProj: '',
      };
    }

    const histEnd = todayIdx + 1;
    return {
      ctlHist: visibleLines.ctl ? buildSmoothPath(points.ctl.slice(0, histEnd)) : '',
      atlHist: visibleLines.atl ? buildSmoothPath(points.atl.slice(0, histEnd)) : '',
      tsbHist: visibleLines.tsb ? buildLinearPath(points.tsb.slice(0, histEnd)) : '',
      acwrHist: visibleLines.acwr ? buildLinearPath(points.acwr.slice(0, histEnd)) : '',
      ctlProj: visibleLines.ctl ? buildSmoothPath(points.ctl.slice(todayIdx)) : '',
      atlProj: visibleLines.atl ? buildSmoothPath(points.atl.slice(todayIdx)) : '',
      tsbProj: visibleLines.tsb ? buildLinearPath(points.tsb.slice(todayIdx)) : '',
      acwrProj: visibleLines.acwr ? buildLinearPath(points.acwr.slice(todayIdx)) : '',
    };
  }, [points, todayIdx, visibleLines, chartData.length]);

  // ─── ACWR safe zone band Y positions ───────────────────
  const acwrBand = useMemo(() => {
    if (!visibleLines.acwr || chartW <= 0) return null;
    const acwrMin = 0;
    const acwrMax = 2.5;
    const toAcwrY = (v: number) => padT + chartH - ((v - acwrMin) / (acwrMax - acwrMin)) * chartH;
    return {
      safeTop: toAcwrY(1.3),
      safeBottom: toAcwrY(0.8),
      dangerTop: toAcwrY(1.5),
    };
  }, [visibleLines.acwr, chartW, chartH, padT]);

  // ─── X-axis labels (every ~2 weeks) ────────────────────

  const xLabels = useMemo(() => {
    if (chartData.length < 7) return [];
    const labels: { x: number; label: string }[] = [];
    const step = Math.max(1, Math.floor(chartData.length / 8));
    const toX = (i: number) => padL + (i / (chartData.length - 1)) * chartW;

    for (let i = 0; i < chartData.length; i += step) {
      const d = chartData[i].date;
      const parts = d.split('-');
      labels.push({ x: toX(i), label: `${parseInt(parts[1])}/${parseInt(parts[2])}` });
    }
    return labels;
  }, [chartData, chartW, padL]);

  // ─── Y-axis labels ─────────────────────────────────────

  const yLabels = useMemo(() => {
    const range = yMax - yMin;
    if (range <= 0) return [];
    // Pick nice tick interval
    const rawStep = range / 4;
    const niceStep = rawStep <= 10 ? 10 : rawStep <= 25 ? 25 : 50;
    const labels: { y: number; label: string }[] = [];
    const toY = (v: number) => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

    const start = Math.ceil(yMin / niceStep) * niceStep;
    for (let v = start; v <= yMax; v += niceStep) {
      labels.push({ y: toY(v), label: String(Math.round(v)) });
    }
    return labels;
  }, [yMin, yMax, chartH, padT]);

  // ─── Scrubber PanResponder ─────────────────────────────

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => handleTouch(evt.nativeEvent.locationX),
        onPanResponderMove: (evt) => handleTouch(evt.nativeEvent.locationX),
        onPanResponderRelease: () => scheduleDismiss(),
      }),
    [chartData.length, chartW, padL],
  );

  function handleTouch(x: number) {
    if (chartData.length < 2 || chartW <= 0) return;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    const idx = Math.round(((x - padL) / chartW) * (chartData.length - 1));
    const clamped = Math.max(0, Math.min(chartData.length - 1, idx));
    setActiveIdx(clamped);
  }

  function scheduleDismiss() {
    dismissTimer.current = setTimeout(() => setActiveIdx(null), 2000);
  }

  // ─── Legend toggle ─────────────────────────────────────

  const toggleLine = useCallback((line: 'ctl' | 'atl' | 'tsb' | 'acwr') => {
    setVisibleLines((prev) => ({ ...prev, [line]: !prev[line] }));
  }, []);

  // ─── Empty state ───────────────────────────────────────

  if (data.length < 7) {
    const msg = data.length === 0
      ? 'Complete some workouts to see your training load.'
      : 'Keep training! The chart needs at least a week of data.';
    return (
      <View style={[styles.container, { height: 120 }]}>
        <B style={styles.emptyText}>{msg}</B>
      </View>
    );
  }

  // ─── Active tooltip data ───────────────────────────────

  const activeDay = activeIdx !== null ? chartData[activeIdx] : null;

  return (
    <View style={styles.container}>
      {/* Legend */}
      <View style={styles.legend}>
        <LegendItem label="Fitness" color={colors.cyan} active={visibleLines.ctl} onPress={() => toggleLine('ctl')} />
        <LegendItem label="Fatigue" color={colors.orange} active={visibleLines.atl} onPress={() => toggleLine('atl')} />
        <LegendItem label="Form" color={colors.textPrimary} active={visibleLines.tsb} onPress={() => toggleLine('tsb')} />
        <LegendItem label="Risk" color={colors.error} active={visibleLines.acwr} onPress={() => toggleLine('acwr')} />
      </View>

      {/* Chart */}
      <View style={{ height }} onLayout={onLayout} {...(width > 0 ? panResponder.panHandlers : {})}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="tsbPosFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.cyan} stopOpacity="0.2" />
                <Stop offset="1" stopColor={colors.cyan} stopOpacity="0.02" />
              </LinearGradient>
              <LinearGradient id="tsbNegFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.orange} stopOpacity="0.02" />
                <Stop offset="1" stopColor={colors.orange} stopOpacity="0.2" />
              </LinearGradient>
            </Defs>

            {/* ACWR safe zone band (0.8-1.3 green tint) */}
            {acwrBand && (
              <>
                <SvgRect
                  x={padL} y={acwrBand.safeTop}
                  width={chartW} height={acwrBand.safeBottom - acwrBand.safeTop}
                  fill={colors.cyan} fillOpacity={0.06}
                />
                {/* Danger threshold line at 1.5 */}
                <Line
                  x1={padL} y1={acwrBand.dangerTop} x2={padL + chartW} y2={acwrBand.dangerTop}
                  stroke={colors.error} strokeWidth={0.5} strokeDasharray="3,3" strokeOpacity={0.4}
                />
              </>
            )}

            {/* Zero reference line */}
            <Line
              x1={padL} y1={zeroY} x2={padL + chartW} y2={zeroY}
              stroke={colors.textTertiary} strokeWidth={1} strokeOpacity={0.5}
            />

            {/* TSB fill areas */}
            {tsbFillPaths.positive && <Path d={tsbFillPaths.positive} fill="url(#tsbPosFill)" />}
            {tsbFillPaths.negative && <Path d={tsbFillPaths.negative} fill="url(#tsbNegFill)" />}

            {/* TSB line — historical (solid) */}
            {splitPaths.tsbHist && (
              <Path d={splitPaths.tsbHist} fill="none" stroke={colors.textSecondary} strokeWidth={1.5} />
            )}
            {/* TSB line — projected (dashed) */}
            {splitPaths.tsbProj && (
              <Path d={splitPaths.tsbProj} fill="none" stroke={colors.textSecondary} strokeWidth={1.5} strokeDasharray="4,4" strokeOpacity={0.5} />
            )}

            {/* ATL (Fatigue) — historical */}
            {splitPaths.atlHist && (
              <Path d={splitPaths.atlHist} fill="none" stroke={colors.orange} strokeWidth={2} />
            )}
            {/* ATL — projected */}
            {splitPaths.atlProj && (
              <Path d={splitPaths.atlProj} fill="none" stroke={colors.orange} strokeWidth={2} strokeDasharray="4,4" strokeOpacity={0.5} />
            )}

            {/* CTL (Fitness) — historical */}
            {splitPaths.ctlHist && (
              <Path d={splitPaths.ctlHist} fill="none" stroke={colors.cyan} strokeWidth={2.5} />
            )}
            {/* CTL — projected */}
            {splitPaths.ctlProj && (
              <Path d={splitPaths.ctlProj} fill="none" stroke={colors.cyan} strokeWidth={2.5} strokeDasharray="4,4" strokeOpacity={0.5} />
            )}

            {/* ACWR (Risk) line — historical */}
            {splitPaths.acwrHist && (
              <Path d={splitPaths.acwrHist} fill="none" stroke={colors.error} strokeWidth={1.5} strokeDasharray="3,2" />
            )}
            {/* ACWR — projected */}
            {splitPaths.acwrProj && (
              <Path d={splitPaths.acwrProj} fill="none" stroke={colors.error} strokeWidth={1.5} strokeDasharray="3,2" strokeOpacity={0.4} />
            )}

            {/* Race day marker */}
            {raceIdx >= 0 && points.ctl[raceIdx] && (
              <>
                <Line
                  x1={points.ctl[raceIdx].x} y1={padT}
                  x2={points.ctl[raceIdx].x} y2={padT + chartH}
                  stroke={colors.orange} strokeWidth={1} strokeDasharray="3,3" strokeOpacity={0.6}
                />
                <SvgText
                  x={points.ctl[raceIdx].x} y={padT - 1}
                  fontSize={9} fill={colors.orange} textAnchor="middle"
                  fontFamily="BebasNeue_400Regular"
                >
                  RACE
                </SvgText>
              </>
            )}

            {/* Today marker */}
            {todayIdx >= 0 && points.ctl[todayIdx] && todayIdx < chartData.length - 1 && (
              <Line
                x1={points.ctl[todayIdx].x} y1={padT}
                x2={points.ctl[todayIdx].x} y2={padT + chartH}
                stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="2,3" strokeOpacity={0.4}
              />
            )}

            {/* Scrubber crosshair */}
            {activeIdx !== null && points.ctl[activeIdx] && (
              <>
                <Line
                  x1={points.ctl[activeIdx].x} y1={padT}
                  x2={points.ctl[activeIdx].x} y2={padT + chartH}
                  stroke={colors.textPrimary} strokeWidth={1} strokeOpacity={0.3}
                />
                {/* CTL dot */}
                {visibleLines.ctl && (
                  <Circle cx={points.ctl[activeIdx].x} cy={points.ctl[activeIdx].y} r={5} fill={colors.cyan} stroke={colors.surface} strokeWidth={2} />
                )}
                {/* ATL dot */}
                {visibleLines.atl && (
                  <Circle cx={points.atl[activeIdx].x} cy={points.atl[activeIdx].y} r={4} fill={colors.orange} stroke={colors.surface} strokeWidth={2} />
                )}
                {/* TSB dot */}
                {visibleLines.tsb && (
                  <Circle cx={points.tsb[activeIdx].x} cy={points.tsb[activeIdx].y} r={3.5} fill={chartData[activeIdx].tsb >= 0 ? colors.cyan : colors.orange} stroke={colors.surface} strokeWidth={1.5} />
                )}
              </>
            )}

            {/* Y-axis labels */}
            {yLabels.map((l, i) => (
              <SvgText key={i} x={padL - 6} y={l.y + 4} fontSize={10} fill={colors.textTertiary} textAnchor="end" fontFamily="JetBrainsMono_400Regular">
                {l.label}
              </SvgText>
            ))}

            {/* X-axis labels */}
            {xLabels.map((l, i) => (
              <SvgText key={i} x={l.x} y={height - 4} fontSize={10} fill={colors.textTertiary} textAnchor="middle" fontFamily="JetBrainsMono_400Regular">
                {l.label}
              </SvgText>
            ))}
          </Svg>
        )}

        {/* Tooltip overlay */}
        {activeDay && width > 0 && points.ctl[activeIdx!] && (
          <View
            style={[
              styles.tooltip,
              { left: Math.max(4, Math.min(points.ctl[activeIdx!].x - 75, width - 154)) },
            ]}
          >
            <B color={colors.textTertiary} fontSize={10}>
              {formatTooltipDate(activeDay.date)}
              {activeDay.isProjected ? ' (projected)' : ''}
            </B>
            <View style={styles.tooltipRow}>
              {visibleLines.ctl && (
                <View style={styles.tooltipStat}>
                  <View style={[styles.tooltipDot, { backgroundColor: colors.cyan }]} />
                  <M color={colors.cyan} fontSize={13} fontWeight="700">{activeDay.ctl.toFixed(0)}</M>
                </View>
              )}
              {visibleLines.atl && (
                <View style={styles.tooltipStat}>
                  <View style={[styles.tooltipDot, { backgroundColor: colors.orange }]} />
                  <M color={colors.orange} fontSize={13} fontWeight="700">{activeDay.atl.toFixed(0)}</M>
                </View>
              )}
              {visibleLines.tsb && (
                <View style={styles.tooltipStat}>
                  <View style={[styles.tooltipDot, { backgroundColor: activeDay.tsb >= 0 ? colors.cyan : colors.orange }]} />
                  <M color={activeDay.tsb >= 0 ? colors.cyan : colors.orange} fontSize={13} fontWeight="700">
                    {activeDay.tsb >= 0 ? '+' : ''}{activeDay.tsb.toFixed(0)}
                  </M>
                </View>
              )}
              {visibleLines.acwr && activeDay.ctl > 0 && (() => {
                const acwr = activeDay.atl / activeDay.ctl;
                const acwrColor = acwr > 1.5 ? colors.error : acwr > 1.3 ? colors.orange : colors.textSecondary;
                return (
                  <View style={styles.tooltipStat}>
                    <View style={[styles.tooltipDot, { backgroundColor: acwrColor }]} />
                    <M color={acwrColor} fontSize={13} fontWeight="700">{acwr.toFixed(2)}</M>
                  </View>
                );
              })()}
            </View>
            {activeDay.trimp > 0 && (
              <B color={colors.textTertiary} fontSize={10} marginTop={1}>
                TRIMP {activeDay.trimp.toFixed(0)} · {activeDay.workoutTypes.join(', ') || 'workout'}
              </B>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Legend Item ──────────────────────────────────────────────

function LegendItem({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={[styles.legendItem, !active && styles.legendItemInactive]}
      onTouchEnd={onPress}
    >
      <View style={[styles.legendDot, { backgroundColor: active ? color : colors.textTertiary }]} />
      <B fontSize={11} color={active ? colors.textSecondary : colors.textTertiary} fontWeight="600">
        {label}
      </B>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    paddingTop: 8,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  legendItemInactive: {
    opacity: 0.5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  tooltip: {
    position: 'absolute',
    top: 4,
    backgroundColor: colors.surfaceHover,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderColor: colors.border,
    minWidth: 150,
  },
  tooltipRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  tooltipStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
