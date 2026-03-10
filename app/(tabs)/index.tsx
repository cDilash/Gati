import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDateLong, getToday, addDays } from '../../src/utils/dateUtils';
import { formatPace } from '../../src/engine/vdot';
import { getWorkoutByDate } from '../../src/db/client';
import { displayDistance, distanceLabelFull, distanceLabel, formatPaceWithUnit, paceLabel } from '../../src/utils/units';
import { RecoveryStatus } from '../../src/types';

export default function TodayScreen() {
  const { todaysWorkout, currentWeek, activePlan, paceZones, markWorkoutComplete, markWorkoutSkipped, refreshTodaysWorkout, allWorkouts, currentACWR, lastVDOTUpdate, adaptiveLogs, acknowledgeAdaptiveLog, recoveryStatus } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const router = useRouter();
  const [showIntervals, setShowIntervals] = useState(false);

  useEffect(() => {
    refreshTodaysWorkout();
    // Sync HealthKit workout data whenever Today tab is focused
    useAppStore.getState().syncWorkoutFromHealthKit();
  }, []);

  const today = getToday();
  const formattedDate = formatDateLong(today);

  const tomorrowDate = addDays(today, 1);
  const tomorrowWorkout = allWorkouts.find(w => w.date === tomorrowDate);

  const handleComplete = () => {
    if (!todaysWorkout) return;
    Alert.alert('Complete Workout', 'Mark this workout as completed?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: () => markWorkoutComplete(todaysWorkout.id) },
    ]);
  };

  const handleSkip = () => {
    if (!todaysWorkout) return;
    Alert.alert('Skip Workout', 'Mark this workout as skipped?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Skip', style: 'destructive', onPress: () => markWorkoutSkipped(todaysWorkout.id) },
    ]);
  };

  if (!activePlan) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Training Plan</Text>
          <Text style={styles.emptySubtitle}>Complete setup to generate your marathon training plan.</Text>
        </View>
      </View>
    );
  }

  const phaseColor = currentWeek ? PHASE_COLORS[currentWeek.phase] : COLORS.textSecondary;
  const isRest = !todaysWorkout || todaysWorkout.workout_type === 'rest';
  const zone = todaysWorkout?.target_pace_zone || 'E';
  const paceRange = paceZones ? paceZones[zone] : null;
  const dl = distanceLabel(units);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.dateHeader}>{formattedDate}</Text>
      {currentWeek && (
        <View style={styles.weekBadgeRow}>
          <View style={[styles.phaseBadge, { backgroundColor: phaseColor }]}>
            <Text style={styles.phaseBadgeText}>{currentWeek.phase.toUpperCase()}</Text>
          </View>
          <ACWRBadge acwr={currentACWR} />
          <RecoveryBadge recovery={recoveryStatus} />
          <Text style={styles.weekText}>
            Week {currentWeek.week_number} of {activePlan.total_weeks}
            {currentWeek.is_cutback ? ' · Cutback' : ''}
          </Text>
        </View>
      )}

      {lastVDOTUpdate && (
        <View style={styles.vdotBanner}>
          <Text style={styles.vdotBannerText}>
            VDOT updated to {lastVDOTUpdate.newVDOT.toFixed(1)}
            {lastVDOTUpdate.confidenceLevel === 'high'
              ? ' based on pace and heart rate data'
              : ' based on pace data (connect your Garmin for more accurate tracking)'}
          </Text>
        </View>
      )}

      {recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40 && todaysWorkout && !isRest && ['tempo', 'interval', 'marathon_pace'].includes(todaysWorkout.workout_type) && todaysWorkout.status === 'scheduled' && (
        <Pressable style={styles.recoveryWarning} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.recoveryWarningText}>Low recovery detected — ask coach about today's workout?</Text>
        </Pressable>
      )}

      {isRest ? (
        <View style={styles.card}>
          <Text style={styles.restTitle}>Rest Day</Text>
          <Text style={styles.restMessage}>Recovery is when adaptation happens. Enjoy your rest.</Text>
          {tomorrowWorkout && tomorrowWorkout.workout_type !== 'rest' && (
            <View style={styles.previewSection}>
              <Text style={styles.previewLabel}>TOMORROW</Text>
              <Text style={styles.previewText}>
                {WORKOUT_TYPE_LABELS[tomorrowWorkout.workout_type]} · {displayDistance(tomorrowWorkout.distance_miles, units).toFixed(1)}{dl} · {tomorrowWorkout.target_pace_zone} pace
              </Text>
            </View>
          )}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.workoutType}>{WORKOUT_TYPE_LABELS[todaysWorkout!.workout_type]}</Text>
              {todaysWorkout!.status !== 'scheduled' && (
                <View style={[styles.statusBadge, { backgroundColor: todaysWorkout!.status === 'completed' ? COLORS.success : COLORS.danger }]}>
                  <Text style={styles.statusText}>{todaysWorkout!.status.toUpperCase()}</Text>
                </View>
              )}
            </View>

            {todaysWorkout!.adjustment_reason && (
              <View style={styles.adjustmentBanner}>
                <Text style={styles.adjustmentText}>
                  Adjusted{todaysWorkout!.original_distance_miles ? `: ${displayDistance(todaysWorkout!.original_distance_miles, units).toFixed(1)}${dl}` : ''} → {displayDistance(todaysWorkout!.distance_miles, units).toFixed(1)}{dl}
                </Text>
                <Text style={styles.adjustmentReason}>{todaysWorkout!.adjustment_reason}</Text>
              </View>
            )}

            <View style={styles.mainStats}>
              <View style={styles.distanceBlock}>
                <Text style={styles.distanceValue}>{displayDistance(todaysWorkout!.distance_miles, units).toFixed(1)}</Text>
                <Text style={styles.distanceUnit}>{distanceLabelFull(units)}</Text>
              </View>
              <View style={styles.paceBlock}>
                <Text style={styles.zoneLabel}>{zone} Zone</Text>
                {paceRange && (
                  <Text style={styles.paceValue}>{formatPaceWithUnit(paceRange.min, units)} - {formatPaceWithUnit(paceRange.max, units)}</Text>
                )}
                <Text style={styles.paceUnit}>{paceLabel(units)}</Text>
              </View>
            </View>

            {todaysWorkout!.intervals && todaysWorkout!.intervals.length > 0 && (
              <>
                <Pressable onPress={() => setShowIntervals(!showIntervals)} style={styles.intervalToggle}>
                  <Text style={styles.intervalToggleText}>
                    {showIntervals ? 'Hide' : 'Show'} Workout Structure ({todaysWorkout!.intervals.length} steps)
                  </Text>
                </Pressable>
                {showIntervals && (
                  <View style={styles.intervalList}>
                    {todaysWorkout!.intervals.map((step, idx) => (
                      <View key={idx} style={[styles.intervalRow, step.type === 'work' && styles.workRow]}>
                        <Text style={styles.intervalType}>{step.type.toUpperCase()}</Text>
                        <Text style={styles.intervalDist}>{displayDistance(step.distance_miles, units).toFixed(2)}{dl}</Text>
                        <Text style={styles.intervalZone}>@ {step.pace_zone}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>

          {todaysWorkout!.status === 'scheduled' && (
            <View style={styles.buttonRow}>
              <Pressable style={[styles.button, styles.completeButton]} onPress={handleComplete}>
                <Text style={styles.buttonText}>Mark Complete</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.skipButton]} onPress={handleSkip}>
                <Text style={[styles.buttonText, { color: COLORS.danger }]}>Skip</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function RecoveryBadge({ recovery }: { recovery: RecoveryStatus | null }) {
  if (!recovery || recovery.signalCount < 2) {
    return (
      <View style={styles.recoveryBadge}>
        <Text style={styles.recoveryBadgeText}>—</Text>
      </View>
    );
  }

  const color = recovery.score >= 80 ? COLORS.success
    : recovery.score >= 60 ? COLORS.warning
    : recovery.score >= 40 ? '#FF9500'
    : COLORS.danger;

  return (
    <View style={[styles.recoveryBadge, { backgroundColor: color }]}>
      <Text style={styles.recoveryBadgeText}>{recovery.score}</Text>
    </View>
  );
}

function ACWRBadge({ acwr }: { acwr: number }) {
  const color = acwr > 1.5 ? COLORS.danger : acwr > 1.3 ? COLORS.warning : acwr < 0.8 ? '#AF52DE' : COLORS.success;
  return (
    <View style={[styles.acwrBadge, { backgroundColor: color }]}>
      <Text style={styles.acwrBadgeText}>{acwr.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  dateHeader: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  weekBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  phaseBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  phaseBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  weekText: { color: COLORS.textSecondary, fontSize: 14 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  workoutType: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  mainStats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  distanceBlock: { alignItems: 'center' },
  distanceValue: { color: COLORS.accent, fontSize: 48, fontWeight: '800', fontFamily: 'Courier' },
  distanceUnit: { color: COLORS.textSecondary, fontSize: 14, marginTop: -4 },
  paceBlock: { alignItems: 'center' },
  zoneLabel: { color: COLORS.accent, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  paceValue: { color: COLORS.text, fontSize: 20, fontWeight: '600', fontFamily: 'Courier' },
  paceUnit: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  intervalToggle: { paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  intervalToggleText: { color: COLORS.accent, fontSize: 14, fontWeight: '500' },
  intervalList: { marginTop: 8 },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, marginBottom: 2, backgroundColor: COLORS.background },
  workRow: { backgroundColor: COLORS.surfaceLight },
  intervalType: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', width: 72 },
  intervalDist: { color: COLORS.text, fontSize: 14, fontWeight: '600', width: 56 },
  intervalZone: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  restTitle: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  restMessage: { color: COLORS.textSecondary, fontSize: 16, lineHeight: 24 },
  previewSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  previewLabel: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  previewText: { color: COLORS.text, fontSize: 15 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  completeButton: { backgroundColor: COLORS.success },
  skipButton: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.danger },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: 16, textAlign: 'center' },
  acwrBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  acwrBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Courier' },
  vdotBanner: { backgroundColor: 'rgba(0, 122, 255, 0.12)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(0, 122, 255, 0.3)' },
  vdotBannerText: { color: COLORS.accent, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  adjustmentBanner: { backgroundColor: 'rgba(255, 149, 0, 0.12)', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255, 149, 0, 0.3)' },
  adjustmentText: { color: COLORS.warning, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  adjustmentReason: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  recoveryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: COLORS.textTertiary },
  recoveryBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Courier' },
  recoveryWarning: { backgroundColor: 'rgba(255, 59, 48, 0.12)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.3)' },
  recoveryWarningText: { color: COLORS.danger, fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
