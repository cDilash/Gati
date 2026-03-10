import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS } from '../../src/utils/constants';
import { formatTime, predict5KTime, predict10KTime, predictHalfMarathonTime, predictMarathonTime } from '../../src/engine/vdot';
import { ZONE_DESCRIPTIONS, ZONE_RPE } from '../../src/engine/paceZones';
import { PaceZoneName } from '../../src/types';
import { formatPaceRangeWithUnit, paceLabel } from '../../src/utils/units';

const ZONE_ORDER: PaceZoneName[] = ['E', 'M', 'T', 'I', 'R'];
const ZONE_COLORS: Record<PaceZoneName, string> = {
  E: '#34C759',
  M: '#007AFF',
  T: '#FF9500',
  I: '#FF3B30',
  R: '#AF52DE',
};

export default function ZonesScreen() {
  const { userProfile, paceZones, hrZones, recoveryStatus } = useAppStore();
  const units = useSettingsStore(s => s.units);

  if (!userProfile || !paceZones || !hrZones) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Complete setup to see your training zones.</Text>
      </View>
    );
  }

  const vdot = userProfile.vdot;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Recovery */}
      {recoveryStatus && recoveryStatus.signalCount >= 2 && (
        <View style={styles.recoveryCard}>
          <View style={styles.recoveryHeader}>
            <Text style={styles.recoverySectionTitle}>Recovery</Text>
            <View style={[styles.recoveryScoreBadge, {
              backgroundColor: recoveryStatus.score >= 80 ? COLORS.success
                : recoveryStatus.score >= 60 ? COLORS.warning
                : recoveryStatus.score >= 40 ? '#FF9500'
                : COLORS.danger
            }]}>
              <Text style={styles.recoveryScoreText}>{recoveryStatus.score}</Text>
            </View>
          </View>
          <Text style={styles.recoveryRecommendation}>
            {recoveryStatus.recommendation === 'full_send' ? 'Fully recovered — go for it'
              : recoveryStatus.recommendation === 'normal' ? 'Normal recovery — train as planned'
              : recoveryStatus.recommendation === 'easy_only' ? 'Moderate fatigue — easy effort only'
              : 'High fatigue — consider rest'}
          </Text>
          {recoveryStatus.signals.map((sig, idx) => (
            <View key={idx} style={styles.signalRow}>
              <View style={[styles.signalDot, {
                backgroundColor: sig.status === 'good' ? COLORS.success : sig.status === 'fair' ? COLORS.warning : COLORS.danger
              }]} />
              <Text style={styles.signalType}>
                {sig.type === 'resting_hr' ? 'Resting HR' : sig.type === 'hrv' ? 'HRV' : sig.type === 'sleep' ? 'Sleep' : 'Volume'}
              </Text>
              <Text style={styles.signalValue}>
                {sig.type === 'resting_hr' ? `${sig.value} bpm`
                  : sig.type === 'hrv' ? `${sig.value} ms`
                  : sig.type === 'sleep' ? `${sig.value}h`
                  : `${sig.value}x avg`}
              </Text>
              <Text style={styles.signalStatus}>{sig.status.toUpperCase()}</Text>
            </View>
          ))}
          <Text style={styles.signalCountNote}>{recoveryStatus.signalCount}/4 signals</Text>
        </View>
      )}

      {/* VDOT Card */}
      <View style={styles.vdotCard}>
        <Text style={styles.vdotLabel}>YOUR VDOT</Text>
        <Text style={styles.vdotValue}>{vdot.toFixed(1)}</Text>
        <Text style={styles.vdotSubtext}>Based on your recent race performance</Text>
      </View>

      {/* Race Predictions */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Race Predictions</Text>
      </View>
      <View style={styles.predictionsGrid}>
        {[
          { label: '5K', time: predict5KTime(vdot) },
          { label: '10K', time: predict10KTime(vdot) },
          { label: 'Half', time: predictHalfMarathonTime(vdot) },
          { label: 'Marathon', time: predictMarathonTime(vdot) },
        ].map(({ label, time }) => (
          <View key={label} style={styles.predictionBox}>
            <Text style={styles.predictionLabel}>{label}</Text>
            <Text style={styles.predictionTime}>{formatTime(time)}</Text>
          </View>
        ))}
      </View>

      {/* Pace Zones */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Pace Zones</Text>
        <Text style={styles.sectionSubtitle}>Daniels Running Formula · {paceLabel(units)}</Text>
      </View>
      {ZONE_ORDER.map(zone => (
        <View key={zone} style={styles.zoneCard}>
          <View style={styles.zoneHeader}>
            <View style={[styles.zoneBadge, { backgroundColor: ZONE_COLORS[zone] }]}>
              <Text style={styles.zoneBadgeText}>{zone}</Text>
            </View>
            <View style={styles.zoneInfo}>
              <Text style={styles.zoneName}>{ZONE_DESCRIPTIONS[zone].split(' — ')[0]}</Text>
              <Text style={styles.zoneDesc}>{ZONE_DESCRIPTIONS[zone].split(' — ')[1]}</Text>
            </View>
          </View>
          <View style={styles.zoneData}>
            <Text style={styles.zonePace}>{formatPaceRangeWithUnit(paceZones[zone], units)}</Text>
            <Text style={styles.zoneRpe}>{ZONE_RPE[zone]}</Text>
          </View>
        </View>
      ))}

      {/* HR Zones */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Heart Rate Zones</Text>
        <Text style={styles.sectionSubtitle}>Karvonen Formula (Max: {userProfile.max_hr} / Rest: {userProfile.resting_hr})</Text>
      </View>
      {[hrZones.zone1, hrZones.zone2, hrZones.zone3, hrZones.zone4, hrZones.zone5].map((zone, idx) => (
        <View key={idx} style={styles.hrRow}>
          <Text style={styles.hrZoneNum}>Z{idx + 1}</Text>
          <Text style={styles.hrZoneName}>{zone.name}</Text>
          <Text style={styles.hrRange}>{zone.min} - {zone.max} bpm</Text>
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16 },
  emptyText: { color: COLORS.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 60 },
  vdotCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 24, borderWidth: 0.5, borderColor: COLORS.border },
  vdotLabel: { color: COLORS.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  vdotValue: { color: COLORS.accent, fontSize: 56, fontWeight: '800', fontFamily: 'Courier' },
  vdotSubtext: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  sectionHeader: { marginTop: 8, marginBottom: 12 },
  sectionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  sectionSubtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  predictionsGrid: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  predictionBox: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center' },
  predictionLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  predictionTime: { color: COLORS.text, fontSize: 16, fontWeight: '700', fontFamily: 'Courier' },
  zoneCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border },
  zoneHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  zoneBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  zoneBadgeText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  zoneInfo: { flex: 1 },
  zoneName: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  zoneDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  zoneData: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  zonePace: { color: COLORS.accent, fontSize: 18, fontWeight: '700', fontFamily: 'Courier' },
  zoneRpe: { color: COLORS.textTertiary, fontSize: 13 },
  hrRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 6 },
  hrZoneNum: { color: COLORS.accent, fontSize: 16, fontWeight: '700', width: 32 },
  hrZoneName: { color: COLORS.text, fontSize: 15, flex: 1 },
  hrRange: { color: COLORS.textSecondary, fontSize: 15, fontFamily: 'Courier' },
  recoveryCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  recoveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  recoverySectionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  recoveryScoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  recoveryScoreText: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'Courier' },
  recoveryRecommendation: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 },
  signalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  signalDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  signalType: { color: COLORS.text, fontSize: 14, flex: 1 },
  signalValue: { color: COLORS.textSecondary, fontSize: 14, fontFamily: 'Courier', marginRight: 12 },
  signalStatus: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', width: 40 },
  signalCountNote: { color: COLORS.textTertiary, fontSize: 11, marginTop: 8, textAlign: 'right' },
});
