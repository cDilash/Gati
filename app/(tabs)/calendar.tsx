import { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS, DAY_NAMES } from '../../src/utils/constants';
import { formatDate, isToday, isPast } from '../../src/utils/dateUtils';
import { displayDistance, distanceLabel } from '../../src/utils/units';

export default function CalendarScreen() {
  const { activePlan, weeks, allWorkouts, currentWeek } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set(currentWeek ? [currentWeek.id] : []));
  const router = useRouter();
  const dl = distanceLabel(units);

  const toggleWeek = (weekId: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  const adherence = useMemo(() => {
    const pastWorkouts = allWorkouts.filter(w => w.workout_type !== 'rest' && isPast(w.date));
    if (pastWorkouts.length === 0) return 100;
    const completed = pastWorkouts.filter(w => w.status === 'completed').length;
    return Math.round((completed / pastWorkouts.length) * 100);
  }, [allWorkouts]);

  if (!activePlan) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No training plan generated yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{activePlan.total_weeks}</Text>
          <Text style={styles.statLabel}>Total Weeks</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{currentWeek?.week_number || '-'}</Text>
          <Text style={styles.statLabel}>Current Week</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: adherence >= 80 ? COLORS.success : adherence >= 60 ? COLORS.warning : COLORS.danger }]}>{adherence}%</Text>
          <Text style={styles.statLabel}>Adherence</Text>
        </View>
      </View>

      {weeks.map(week => {
        const isCurrentWeek = currentWeek?.id === week.id;
        const isExpanded = expandedWeeks.has(week.id);
        const weekWorkouts = allWorkouts.filter(w => w.week_id === week.id);
        const phaseColor = PHASE_COLORS[week.phase];

        return (
          <View key={week.id} style={[styles.weekCard, isCurrentWeek && { borderColor: COLORS.accent, borderWidth: 1.5 }]}>
            <Pressable onPress={() => toggleWeek(week.id)} style={styles.weekHeader}>
              <View style={styles.weekLeft}>
                <Text style={styles.weekNumber}>W{week.week_number}</Text>
                <View style={[styles.phaseBadge, { backgroundColor: phaseColor }]}>
                  <Text style={styles.phaseBadgeText}>{week.phase.toUpperCase()}</Text>
                </View>
                {week.is_cutback && (
                  <View style={[styles.phaseBadge, { backgroundColor: COLORS.textTertiary }]}>
                    <Text style={styles.phaseBadgeText}>CUTBACK</Text>
                  </View>
                )}
              </View>
              <View style={styles.weekRight}>
                <Text style={styles.volumeText}>{displayDistance(week.target_volume_miles, units).toFixed(0)} {dl}</Text>
                <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
              </View>
            </Pressable>

            {isExpanded && (
              <View style={styles.workoutList}>
                {weekWorkouts.map(workout => {
                  const today = isToday(workout.date);
                  const borderColor = workout.status === 'completed' ? COLORS.success : workout.status === 'skipped' ? COLORS.danger : today ? COLORS.accent : 'transparent';

                  return (
                    <Pressable
                      key={workout.id}
                      onPress={() => workout.workout_type !== 'rest' && router.push(`/workout/${workout.id}`)}
                      style={[styles.workoutRow, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}
                    >
                      <Text style={[styles.dayName, today && { color: COLORS.accent }]}>
                        {DAY_NAMES[workout.day_of_week]}
                      </Text>
                      <Text style={[styles.workoutLabel, workout.workout_type === 'rest' && { color: COLORS.textTertiary }]}>
                        {WORKOUT_TYPE_LABELS[workout.workout_type]}
                      </Text>
                      {workout.workout_type !== 'rest' && (
                        <Text style={styles.workoutDist}>{displayDistance(workout.distance_miles, units).toFixed(1)}{dl}</Text>
                      )}
                      {workout.adjustment_reason && (
                        <Text style={styles.adaptedIcon}>~</Text>
                      )}
                      <Text style={styles.statusIcon}>
                        {workout.status === 'completed' ? '✓' : workout.status === 'skipped' ? '✕' : workout.workout_type === 'rest' ? '' : '–'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, alignItems: 'center' },
  statValue: { color: COLORS.accent, fontSize: 24, fontWeight: '800', fontFamily: 'Courier' },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4, fontWeight: '500' },
  weekCard: { backgroundColor: COLORS.surface, borderRadius: 12, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border, overflow: 'hidden' },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  weekLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekNumber: { color: COLORS.text, fontSize: 16, fontWeight: '700', width: 32 },
  phaseBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  phaseBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  weekRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', fontFamily: 'Courier' },
  expandIcon: { color: COLORS.textTertiary, fontSize: 12 },
  workoutList: { borderTopWidth: 0.5, borderTopColor: COLORS.border },
  workoutRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  dayName: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', width: 36 },
  workoutLabel: { color: COLORS.text, fontSize: 14, flex: 1 },
  workoutDist: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Courier', marginRight: 8 },
  adaptedIcon: { color: COLORS.warning, fontSize: 12, fontWeight: '700', width: 14, textAlign: 'center' },
  statusIcon: { color: COLORS.textSecondary, fontSize: 14, width: 20, textAlign: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 60 },
});
