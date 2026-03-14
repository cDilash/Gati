import { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Lightning, Sparkle, X } from 'phosphor-react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS, DAY_NAMES } from '../../src/utils/constants';
import { formatDate, isToday, isPast } from '../../src/utils/dateUtils';
import { displayDistance, distanceLabel } from '../../src/utils/units';

export default function CalendarScreen() {
  const { activePlan, weeks, allWorkouts, currentWeek, weeklyDigest, hasUnreadDigest, dismissWeeklyDigest } = useAppStore();
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

      {hasUnreadDigest && weeklyDigest && (
        <View style={styles.digestCard}>
          <View style={styles.digestHeader}>
            <View style={styles.digestHeaderLeft}>
              <Sparkle size={16} color={COLORS.accent} weight="fill" />
              <Text style={styles.digestLabel}>WEEKLY DIGEST</Text>
            </View>
            <Pressable onPress={dismissWeeklyDigest} hitSlop={12}>
              <X size={18} color={COLORS.textTertiary} />
            </Pressable>
          </View>
          <Text style={styles.digestHeadline}>{weeklyDigest.headline}</Text>
          <Text style={styles.digestVolume}>{weeklyDigest.volumeSummary}</Text>

          {weeklyDigest.highlights.length > 0 && (
            <View style={styles.digestSection}>
              {weeklyDigest.highlights.map((h, i) => (
                <View key={i} style={styles.digestBulletRow}>
                  <View style={[styles.digestDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.digestBulletText}>{h}</Text>
                </View>
              ))}
            </View>
          )}

          {weeklyDigest.concerns.length > 0 && (
            <View style={styles.digestSection}>
              {weeklyDigest.concerns.map((c, i) => (
                <View key={i} style={styles.digestBulletRow}>
                  <View style={[styles.digestDot, { backgroundColor: COLORS.warning }]} />
                  <Text style={styles.digestBulletText}>{c}</Text>
                </View>
              ))}
            </View>
          )}

          {weeklyDigest.recoveryTrend ? (
            <Text style={styles.digestRecovery}>{weeklyDigest.recoveryTrend}</Text>
          ) : null}

          {weeklyDigest.nextWeekPreview ? (
            <View style={styles.digestNextWeek}>
              <Text style={styles.digestNextWeekLabel}>NEXT WEEK</Text>
              <Text style={styles.digestNextWeekText}>{weeklyDigest.nextWeekPreview}</Text>
            </View>
          ) : null}

          {weeklyDigest.coachNote ? (
            <Text style={styles.digestCoachNote}>{weeklyDigest.coachNote}</Text>
          ) : null}

          <Pressable style={styles.digestDiscussButton} onPress={() => router.push('/(tabs)/coach')}>
            <Text style={styles.digestDiscussText}>Discuss with Coach</Text>
          </Pressable>
        </View>
      )}

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
                        <Pressable
                          onPress={() => Alert.alert(
                            'AI Adjustment',
                            `Original: ${workout.original_distance_miles?.toFixed(1) || '?'}mi → Now: ${workout.distance_miles.toFixed(1)}mi\n\n${workout.adjustment_reason}`
                          )}
                          style={{ marginLeft: 4, padding: 4 }}
                        >
                          <Lightning size={14} color="#FF9500" weight="fill" />
                        </Pressable>
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
  digestCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(0, 122, 255, 0.25)' },
  digestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  digestHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  digestLabel: { color: COLORS.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  digestHeadline: { color: COLORS.text, fontSize: 17, fontWeight: '700', lineHeight: 24, marginBottom: 4 },
  digestVolume: { color: COLORS.textSecondary, fontSize: 14, fontFamily: 'Courier', marginBottom: 12 },
  digestSection: { marginBottom: 8 },
  digestBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  digestDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  digestBulletText: { color: COLORS.text, fontSize: 13, lineHeight: 19, flex: 1 },
  digestRecovery: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  digestNextWeek: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, marginBottom: 8 },
  digestNextWeekLabel: { color: COLORS.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  digestNextWeekText: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
  digestCoachNote: { color: COLORS.accent, fontSize: 13, fontWeight: '600', lineHeight: 18, fontStyle: 'italic', marginBottom: 12 },
  digestDiscussButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(0, 122, 255, 0.12)' },
  digestDiscussText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
});
