import { useLocalSearchParams } from 'expo-router';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate } from '../../src/utils/dateUtils';
import { displayDistance, distanceLabel, distanceLabelFull, formatPaceWithUnit, formatPaceRangeWithUnit, paceLabel } from '../../src/utils/units';

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { allWorkouts, paceZones } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const dl = distanceLabel(units);
  const workout = allWorkouts.find(w => w.id === id);

  if (!workout) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Workout not found</Text>
      </View>
    );
  }

  const zone = workout.target_pace_zone;
  const paceRange = paceZones ? paceZones[zone] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.dateText}>{formatDate(workout.date)}</Text>
        <View style={[styles.statusBadge, { backgroundColor: workout.status === 'completed' ? COLORS.success : workout.status === 'skipped' ? COLORS.danger : COLORS.surfaceLight }]}>
          <Text style={styles.statusText}>{workout.status.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.typeLabel}>{WORKOUT_TYPE_LABELS[workout.workout_type]}</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{displayDistance(workout.distance_miles, units).toFixed(1)}</Text>
          <Text style={styles.statLabel}>{distanceLabelFull(units)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{zone}</Text>
          <Text style={styles.statLabel}>zone</Text>
        </View>
        {paceRange && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, styles.mono]}>{formatPaceWithUnit(paceRange.min, units)}-{formatPaceWithUnit(paceRange.max, units)}</Text>
            <Text style={styles.statLabel}>{paceLabel(units)}</Text>
          </View>
        )}
      </View>

      {workout.intervals && workout.intervals.length > 0 && (
        <View style={styles.intervalsSection}>
          <Text style={styles.sectionTitle}>Workout Structure</Text>
          {workout.intervals.map((step, idx) => (
            <View key={idx} style={[styles.intervalRow, step.type === 'work' && styles.workRow]}>
              <Text style={styles.intervalType}>{step.type.toUpperCase()}</Text>
              <Text style={styles.intervalDistance}>{displayDistance(step.distance_miles, units).toFixed(2)}{dl}</Text>
              <Text style={styles.intervalZone}>@ {step.pace_zone}</Text>
              <Text style={styles.intervalDesc}>{step.description}</Text>
            </View>
          ))}
        </View>
      )}

      {workout.adjustment_reason && (
        <View style={styles.adaptiveSection}>
          <Text style={styles.adaptiveTitle}>Adaptive Adjustment</Text>
          {workout.original_distance_miles && (
            <Text style={styles.adaptiveOriginal}>Original: {displayDistance(workout.original_distance_miles, units).toFixed(1)}{dl}</Text>
          )}
          <Text style={styles.adaptiveReason}>{workout.adjustment_reason}</Text>
        </View>
      )}

      {workout.notes ? (
        <View style={styles.notesSection}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.notesText}>{workout.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dateText: { color: COLORS.textSecondary, fontSize: 16 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  typeLabel: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 24 },
  stat: { alignItems: 'center' },
  statValue: { color: COLORS.accent, fontSize: 24, fontWeight: '700' },
  statLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  mono: { fontFamily: 'Courier' },
  intervalsSection: { marginTop: 8 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 12 },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4, backgroundColor: COLORS.surface },
  workRow: { backgroundColor: COLORS.surfaceLight },
  intervalType: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', width: 72 },
  intervalDistance: { color: COLORS.text, fontSize: 15, fontWeight: '600', width: 48 },
  intervalZone: { color: COLORS.accent, fontSize: 15, fontWeight: '600', width: 32 },
  intervalDesc: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  notesSection: { marginTop: 24 },
  notesText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  adaptiveSection: { marginTop: 16, backgroundColor: 'rgba(255, 149, 0, 0.08)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 149, 0, 0.2)' },
  adaptiveTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  adaptiveOriginal: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  adaptiveReason: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  errorText: { color: COLORS.danger, fontSize: 16, textAlign: 'center', marginTop: 40 },
});
