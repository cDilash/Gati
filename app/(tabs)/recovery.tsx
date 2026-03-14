import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS } from '../../src/utils/constants';
import { getToday, toLocalDateString } from '../../src/utils/dateUtils';
import { getRecentMetrics, getHealthSnapshot } from '../../src/db/client';
import { displayDistance, distanceLabel, paceLabel } from '../../src/utils/units';
import { formatPace } from '../../src/engine/vdot';
import { PerformanceMetric, RecoverySignal } from '../../src/types';

export default function RecoveryScreen() {
  const { recoveryStatus, currentACWR, syncHealthData } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const dl = distanceLabel(units);

  useEffect(() => {
    syncHealthData();
  }, []);

  const today = getToday();
  const snapshot = useMemo(() => getHealthSnapshot(today), [today]);

  // Last 7 days of run metrics
  const weekMetrics = useMemo(() => getRecentMetrics(7), []);
  // Last 28 days for trends
  const monthMetrics = useMemo(() => getRecentMetrics(28), []);

  // Compute weekly stats
  const weekStats = useMemo(() => {
    const totalDist = weekMetrics.reduce((s, m) => s + m.distance_miles, 0);
    const totalTime = weekMetrics.reduce((s, m) => s + m.duration_seconds, 0);
    const avgPace = totalDist > 0 ? Math.round(totalTime / totalDist) : 0;
    const avgHr = weekMetrics.filter(m => m.avg_hr).reduce((s, m, _, a) => s + (m.avg_hr || 0) / a.length, 0);
    const runCount = weekMetrics.length;
    return { totalDist, totalTime, avgPace, avgHr: Math.round(avgHr), runCount };
  }, [weekMetrics]);

  // Weekly volume for last 4 weeks
  const weeklyVolumes = useMemo(() => {
    const weeks: { label: string; miles: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekEnd = new Date(Date.now() - i * 7 * 86400000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);
      const startStr = toLocalDateString(weekStart);
      const endStr = toLocalDateString(weekEnd);
      const weekRuns = monthMetrics.filter(m => m.date >= startStr && m.date <= endStr);
      const miles = weekRuns.reduce((s, m) => s + m.distance_miles, 0);
      weeks.push({
        label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i}w ago`,
        miles,
      });
    }
    return weeks;
  }, [monthMetrics]);

  const maxVolume = Math.max(...weeklyVolumes.map(w => w.miles), 1);

  // Recovery score color
  const scoreColor = !recoveryStatus ? COLORS.textTertiary
    : recoveryStatus.score >= 80 ? COLORS.success
    : recoveryStatus.score >= 60 ? '#FF9500'
    : recoveryStatus.score >= 40 ? '#FF9500'
    : COLORS.danger;

  const recommendationLabel: Record<string, string> = {
    full_send: 'Ready for hard efforts',
    normal: 'Normal training load',
    easy_only: 'Keep it easy today',
    rest: 'Rest recommended',
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Recovery Score */}
      <View style={styles.scoreCard}>
        <Text style={styles.scoreTitle}>Recovery Score</Text>
        {recoveryStatus ? (
          <>
            <Text style={[styles.scoreValue, { color: scoreColor }]}>{recoveryStatus.score}</Text>
            <Text style={styles.scoreRecommendation}>
              {recommendationLabel[recoveryStatus.recommendation] || recoveryStatus.recommendation}
            </Text>
            <View style={styles.signalList}>
              {recoveryStatus.signals.map((signal, i) => (
                <SignalRow key={i} signal={signal} />
              ))}
            </View>
          </>
        ) : (
          <View style={styles.noDataBox}>
            <Text style={styles.noDataText}>Insufficient data for recovery score</Text>
            <Text style={styles.noDataSub}>Needs at least 2 signals: resting HR, HRV, sleep, or 3+ runs in 7 days</Text>
          </View>
        )}
      </View>

      {/* ACWR */}
      <View style={styles.acwrCard}>
        <View style={styles.acwrHeader}>
          <Text style={styles.cardTitle}>Training Load (ACWR)</Text>
          <Text style={[styles.acwrValue, { color: acwrColor(currentACWR) }]}>{currentACWR.toFixed(2)}</Text>
        </View>
        <View style={styles.acwrBar}>
          <View style={styles.acwrBarTrack}>
            <View style={[styles.acwrZone, { left: '0%', width: '53%', backgroundColor: 'rgba(175, 82, 222, 0.3)' }]} />
            <View style={[styles.acwrZone, { left: '53%', width: '34%', backgroundColor: 'rgba(52, 199, 89, 0.3)' }]} />
            <View style={[styles.acwrZone, { left: '87%', width: '13%', backgroundColor: 'rgba(255, 59, 48, 0.3)' }]} />
            <View style={[styles.acwrMarker, { left: `${Math.min(Math.max(currentACWR / 2 * 100, 0), 100)}%` }]} />
          </View>
          <View style={styles.acwrLabels}>
            <Text style={styles.acwrLabel}>Detraining</Text>
            <Text style={styles.acwrLabel}>Sweet Spot</Text>
            <Text style={styles.acwrLabel}>Danger</Text>
          </View>
        </View>
        <Text style={styles.acwrDesc}>
          {currentACWR < 0.8 ? 'Below optimal — your recent load is lower than your chronic baseline.'
            : currentACWR <= 1.3 ? 'In the sweet spot — good balance of stress and recovery.'
            : currentACWR <= 1.5 ? 'Elevated — be cautious with hard sessions.'
            : 'High injury risk — consider reducing training load.'}
        </Text>
      </View>

      {/* Health Vitals */}
      <View style={styles.vitalsCard}>
        <Text style={styles.cardTitle}>Health Vitals</Text>
        <View style={styles.vitalsGrid}>
          <VitalItem label="Resting HR" value={snapshot?.resting_hr ? `${snapshot.resting_hr}` : '—'} unit="bpm" />
          <VitalItem label="HRV" value={snapshot?.hrv_sdnn ? `${snapshot.hrv_sdnn}` : '—'} unit="ms" />
          <VitalItem label="Sleep" value={snapshot?.sleep_hours ? `${snapshot.sleep_hours}` : '—'} unit="hours" quality={snapshot?.sleep_quality} />
          <VitalItem label="Weight" value={snapshot?.weight_lbs ? `${snapshot.weight_lbs}` : '—'} unit="lbs" />
          <VitalItem label="Steps" value={snapshot?.steps ? `${snapshot.steps.toLocaleString()}` : '—'} unit="" />
        </View>
        {!snapshot && (
          <Text style={styles.vitalsNote}>HealthKit data unavailable — connect Apple Health for vitals</Text>
        )}
      </View>

      {/* Weekly Volume Chart */}
      <View style={styles.volumeCard}>
        <Text style={styles.cardTitle}>Weekly Volume</Text>
        <View style={styles.volumeBars}>
          {weeklyVolumes.map((week, i) => (
            <View key={i} style={styles.volumeBarCol}>
              <Text style={styles.volumeBarValue}>
                {displayDistance(week.miles, units).toFixed(1)}
              </Text>
              <View style={styles.volumeBarTrack}>
                <View
                  style={[
                    styles.volumeBarFill,
                    {
                      height: `${(week.miles / maxVolume) * 100}%`,
                      backgroundColor: i === weeklyVolumes.length - 1 ? COLORS.accent : COLORS.textTertiary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.volumeBarLabel}>{week.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 7-Day Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.cardTitle}>Last 7 Days</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{weekStats.runCount}</Text>
            <Text style={styles.summaryLabel}>runs</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{displayDistance(weekStats.totalDist, units).toFixed(1)}</Text>
            <Text style={styles.summaryLabel}>{dl} total</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, styles.mono]}>{weekStats.avgPace > 0 ? formatPace(weekStats.avgPace) : '—'}</Text>
            <Text style={styles.summaryLabel}>avg pace</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{weekStats.avgHr > 0 ? weekStats.avgHr : '—'}</Text>
            <Text style={styles.summaryLabel}>avg HR</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function SignalRow({ signal }: { signal: RecoverySignal }) {
  const labels: Record<string, string> = {
    resting_hr: 'Resting HR',
    hrv: 'HRV',
    sleep: 'Sleep',
    volume_trend: 'Volume Trend',
  };
  const units: Record<string, string> = {
    resting_hr: 'bpm',
    hrv: 'ms',
    sleep: 'hrs',
    volume_trend: 'ratio',
  };
  const statusColor = signal.status === 'good' ? COLORS.success
    : signal.status === 'fair' ? '#FF9500'
    : COLORS.danger;

  return (
    <View style={styles.signalRow}>
      <View style={[styles.signalDot, { backgroundColor: statusColor }]} />
      <Text style={styles.signalName}>{labels[signal.type] || signal.type}</Text>
      <Text style={styles.signalValue}>
        {typeof signal.value === 'number' ? signal.value.toFixed(signal.type === 'volume_trend' ? 2 : 0) : signal.value}
        <Text style={styles.signalUnit}> {units[signal.type]}</Text>
      </Text>
      <Text style={[styles.signalStatus, { color: statusColor }]}>{signal.status}</Text>
    </View>
  );
}

function VitalItem({ label, value, unit, quality }: { label: string; value: string; unit: string; quality?: string | null }) {
  return (
    <View style={styles.vitalItem}>
      <Text style={styles.vitalLabel}>{label}</Text>
      <Text style={styles.vitalValue}>{value}</Text>
      {unit ? <Text style={styles.vitalUnit}>{unit}</Text> : null}
      {quality && (
        <Text style={[styles.vitalQuality, {
          color: quality === 'good' ? COLORS.success : quality === 'fair' ? '#FF9500' : COLORS.danger
        }]}>{quality}</Text>
      )}
    </View>
  );
}

function acwrColor(acwr: number): string {
  if (acwr > 1.5) return COLORS.danger;
  if (acwr > 1.3) return '#FF9500';
  if (acwr < 0.8) return '#AF52DE';
  return COLORS.success;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16 },
  cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },

  // Recovery Score
  scoreCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  scoreTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  scoreValue: { fontSize: 64, fontWeight: '800', fontFamily: 'Courier', textAlign: 'center', marginVertical: 4 },
  scoreRecommendation: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  signalList: { borderTopWidth: 0.5, borderTopColor: COLORS.border, paddingTop: 12 },
  signalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  signalDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  signalName: { color: COLORS.text, fontSize: 14, flex: 1 },
  signalValue: { color: COLORS.textSecondary, fontSize: 14, fontFamily: 'Courier', marginRight: 12 },
  signalUnit: { fontSize: 11, color: COLORS.textTertiary },
  signalStatus: { fontSize: 12, fontWeight: '600', width: 40, textAlign: 'right' },
  noDataBox: { paddingVertical: 20, alignItems: 'center' },
  noDataText: { color: COLORS.textSecondary, fontSize: 16, marginBottom: 6 },
  noDataSub: { color: COLORS.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  // ACWR
  acwrCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  acwrHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  acwrValue: { fontSize: 28, fontWeight: '800', fontFamily: 'Courier' },
  acwrBar: { marginBottom: 12 },
  acwrBarTrack: { height: 12, borderRadius: 6, backgroundColor: COLORS.background, overflow: 'hidden', position: 'relative' },
  acwrZone: { position: 'absolute', top: 0, bottom: 0, borderRadius: 6 },
  acwrMarker: { position: 'absolute', top: -4, width: 4, height: 20, borderRadius: 2, backgroundColor: COLORS.text },
  acwrLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  acwrLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: '500' },
  acwrDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },

  // Vitals
  vitalsCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  vitalItem: { width: '30%', alignItems: 'center', paddingVertical: 10 },
  vitalLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '500', marginBottom: 4 },
  vitalValue: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  vitalUnit: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  vitalQuality: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  vitalsNote: { color: COLORS.textTertiary, fontSize: 12, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },

  // Volume Chart
  volumeCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  volumeBars: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 140 },
  volumeBarCol: { alignItems: 'center', flex: 1 },
  volumeBarValue: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  volumeBarTrack: { width: 28, height: 100, backgroundColor: COLORS.background, borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
  volumeBarFill: { width: '100%', borderRadius: 6, minHeight: 2 },
  volumeBarLabel: { color: COLORS.textTertiary, fontSize: 10, marginTop: 6 },

  // 7-Day Summary
  summaryCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  summaryStat: { alignItems: 'center' },
  summaryValue: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  mono: { fontFamily: 'Courier' },
});
