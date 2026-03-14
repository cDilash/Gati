import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Medal } from 'phosphor-react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate } from '../../src/utils/dateUtils';
import {
  displayDistance,
  distanceLabel,
  distanceLabelFull,
  formatPaceWithUnit,
  paceLabel,
} from '../../src/utils/units';
import { getStravaDetailForWorkout, getStravaDetailForMetric, getMetricsForWorkout, getMetricById } from '../../src/db/client';
import { formatPace } from '../../src/engine/vdot';
import { RouteMap } from '../../src/components/RouteMap';

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { allWorkouts, paceZones, hrZones } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const dl = distanceLabel(units);
  const workout = allWorkouts.find(w => w.id === id);

  // Support two modes:
  // 1. id = workout ID → fetch metric via workout
  // 2. id = metric ID → fetch metric directly (unmatched Strava runs)
  const metric = useMemo(() => {
    if (!id) return null;
    if (workout && workout.status === 'completed') {
      const metrics = getMetricsForWorkout(id);
      return metrics.length > 0 ? metrics[0] : null;
    }
    // Try as metric ID (unmatched run from Recent Runs)
    if (!workout) return getMetricById(id);
    return null;
  }, [id, workout?.status]);

  const stravaDetail = useMemo(() => {
    if (!id) return null;
    if (workout && workout.status === 'completed') return getStravaDetailForWorkout(id);
    // Try by metric ID
    if (!workout && metric) return getStravaDetailForMetric(metric.id);
    return null;
  }, [id, workout?.status, metric?.id]);

  const bestEfforts = useMemo(() => {
    if (!stravaDetail?.best_efforts_json) return [];
    try {
      return JSON.parse(stravaDetail.best_efforts_json) as Array<{
        name: string;
        movingTime: number;
        prRank: number | null;
      }>;
    } catch {
      return [];
    }
  }, [stravaDetail?.best_efforts_json]);

  // If no workout AND no metric, nothing to show
  if (!workout && !metric) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Workout not found</Text>
      </View>
    );
  }

  const zone = workout?.target_pace_zone || 'E';
  const paceRange = paceZones ? paceZones[zone] : null;

  const hasMap = !!(stravaDetail?.polylineEncoded);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.dateText}>{formatDate(workout?.date || metric?.date || '')}</Text>
        {workout ? (
          <View style={[
            styles.statusBadge,
            { backgroundColor: workout.status === 'completed' ? COLORS.success : workout.status === 'skipped' ? COLORS.danger : COLORS.surfaceLight },
          ]}>
            <Text style={styles.statusText}>{workout.status.toUpperCase()}</Text>
          </View>
        ) : (
          <View style={[styles.statusBadge, { backgroundColor: COLORS.primary }]}>
            <Text style={styles.statusText}>{(metric?.source || 'strava').toUpperCase()}</Text>
          </View>
        )}
      </View>

      {workout ? (
        <>
          <Text style={styles.typeLabel}>{WORKOUT_TYPE_LABELS[workout.workout_type]}</Text>

          {/* ── Planned Stats ──────────────────────────────── */}
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
                <Text style={[styles.statValue, styles.mono]}>
                  {formatPaceWithUnit(paceRange.min, units)}–{formatPaceWithUnit(paceRange.max, units)}
                </Text>
                <Text style={styles.statLabel}>{paceLabel(units)}</Text>
              </View>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.typeLabel}>Strava Run</Text>
      )}

      {/* ── Route Map ──────────────────────────────────── */}
      {hasMap && paceZones && hrZones && (
        <RouteMap
          polylineEncoded={stravaDetail!.polylineEncoded}
          paceStream={stravaDetail!.paceStream}
          hrStream={stravaDetail!.hrStream}
          elevationStream={stravaDetail!.elevationStream}
          distanceStream={stravaDetail!.distanceStream}
          paceZones={paceZones}
          hrZones={hrZones}
        />
      )}

      {/* ── Workout Structure (intervals) ──────────────── */}
      {workout?.intervals && workout.intervals.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workout Structure</Text>
          {workout.intervals.map((step, idx) => (
            <View key={idx} style={[styles.intervalRow, step.type === 'work' && styles.workRow]}>
              <Text style={styles.intervalType}>{step.type.toUpperCase()}</Text>
              <Text style={styles.intervalDistance}>
                {displayDistance(step.distance_miles, units).toFixed(2)}{dl}
              </Text>
              <Text style={styles.intervalZone}>@ {step.pace_zone}</Text>
              <Text style={styles.intervalDesc}>{step.description}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Actual Performance ─────────────────────────── */}
      {metric && (
        <View style={styles.actualSection}>
          <Text style={styles.sectionTitle}>Actual Performance</Text>
          <View style={styles.actualStatsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{displayDistance(metric.distance_miles, units).toFixed(1)}</Text>
              <Text style={styles.statLabel}>{dl} run</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, styles.mono]}>{formatPace(metric.avg_pace_per_mile)}</Text>
              <Text style={styles.statLabel}>avg pace</Text>
            </View>
            {metric.avg_hr && (
              <View style={styles.stat}>
                <Text style={styles.statValue}>{metric.avg_hr}</Text>
                <Text style={styles.statLabel}>avg HR</Text>
              </View>
            )}
            <View style={styles.stat}>
              <Text style={styles.statValue}>{Math.floor(metric.duration_seconds / 60)}</Text>
              <Text style={styles.statLabel}>minutes</Text>
            </View>
          </View>

          {/* RPE indicator */}
          {metric.rpe_score != null && (
            <View style={styles.rpeRow}>
              <Text style={styles.rpeLabel}>Effort (RPE)</Text>
              <View style={styles.rpeDots}>
                {Array.from({ length: 10 }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.rpeDot,
                      i < metric.rpe_score!
                        ? { backgroundColor: metric.rpe_score! >= 8 ? COLORS.danger : metric.rpe_score! >= 6 ? COLORS.warning : COLORS.success }
                        : styles.rpeDotEmpty,
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.rpeValue}>{metric.rpe_score}/10</Text>
            </View>
          )}

          {/* Source + gear */}
          <View style={styles.sourceRow}>
            <Text style={styles.sourceTag}>
              {metric.source === 'strava' ? 'Strava' : metric.source === 'healthkit' ? 'HealthKit' : 'Manual'}
            </Text>
            {stravaDetail?.gear_name && (
              <Text style={styles.gearTag}>· {stravaDetail.gear_name}</Text>
            )}
          </View>
        </View>
      )}

      {/* ── Mile Splits ────────────────────────────────── */}
      {stravaDetail?.splits && stravaDetail.splits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mile Splits</Text>
          <View style={styles.splitsHeader}>
            <Text style={styles.splitHeaderCell}>Mile</Text>
            <Text style={[styles.splitHeaderCell, { flex: 1 }]}>Pace</Text>
            <Text style={styles.splitHeaderCell}>HR</Text>
          </View>
          {stravaDetail.splits.map((s: any, i: number) => {
            const paceSec = s.movingTime > 0 && s.distance > 0
              ? Math.round((s.movingTime / s.distance) * 1609.344)
              : 0;
            const isInZone = paceRange ? paceSec >= paceRange.max && paceSec <= paceRange.min : true;
            return (
              <View key={i} style={[styles.splitRow, i % 2 === 0 && styles.splitRowAlt]}>
                <Text style={styles.splitMile}>{s.split}</Text>
                <Text style={[styles.splitPace, !isInZone && styles.splitPaceOff]}>
                  {formatPace(paceSec)}
                </Text>
                <Text style={styles.splitHr}>
                  {s.averageHeartrate ? Math.round(s.averageHeartrate) : '—'}
                </Text>
              </View>
            );
          })}

          {/* Extra stats chips */}
          <View style={styles.extraChips}>
            {stravaDetail.elevation_gain_ft > 0 && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{Math.round(stravaDetail.elevation_gain_ft)} ft gain</Text>
              </View>
            )}
            {stravaDetail.cadence_avg > 0 && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{Math.round(stravaDetail.cadence_avg * 2)} spm</Text>
              </View>
            )}
            {stravaDetail.suffer_score > 0 && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>Effort: {stravaDetail.suffer_score}</Text>
              </View>
            )}
            {stravaDetail.calories > 0 && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{stravaDetail.calories} cal</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Best Efforts ───────────────────────────────── */}
      {bestEfforts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Efforts</Text>
          {bestEfforts.map((effort, i) => (
            <View key={i} style={styles.effortRow}>
              <View style={styles.effortLeft}>
                {effort.prRank === 1 && (
                  <Medal size={14} color="#FFD700" weight="fill" style={styles.medalIcon} />
                )}
                <Text style={[styles.effortName, effort.prRank === 1 && styles.prName]}>
                  {effort.name}
                </Text>
              </View>
              <Text style={[styles.effortTime, styles.mono]}>
                {formatPace(effort.movingTime)}
              </Text>
              {effort.prRank === 1 && (
                <View style={styles.prBadge}>
                  <Text style={styles.prBadgeText}>PR</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* ── Adaptive Adjustment ────────────────────────── */}
      {workout?.adjustment_reason && (
        <View style={styles.adaptiveSection}>
          <Text style={styles.adaptiveTitle}>Adaptive Adjustment</Text>
          {workout.original_distance_miles && (
            <Text style={styles.adaptiveOriginal}>
              Original: {displayDistance(workout.original_distance_miles, units).toFixed(1)}{dl}
            </Text>
          )}
          <Text style={styles.adaptiveReason}>{workout.adjustment_reason}</Text>
        </View>
      )}

      {/* ── Notes ──────────────────────────────────────── */}
      {workout?.notes ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.notesText}>{workout.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  errorText: { color: COLORS.danger, fontSize: 16, textAlign: 'center', marginTop: 40 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dateText: { color: COLORS.textSecondary, fontSize: 16 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  typeLabel: { color: COLORS.text, fontSize: 28, fontWeight: '700', marginBottom: 20 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 4 },
  stat: { alignItems: 'center' },
  statValue: { color: COLORS.accent, fontSize: 22, fontWeight: '700' },
  statLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  mono: { fontFamily: 'Courier' },

  // Section
  section: { marginTop: 20 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 12 },

  // Intervals
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4, backgroundColor: COLORS.surface },
  workRow: { backgroundColor: COLORS.surfaceLight },
  intervalType: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', width: 72 },
  intervalDistance: { color: COLORS.text, fontSize: 15, fontWeight: '600', width: 48 },
  intervalZone: { color: COLORS.accent, fontSize: 15, fontWeight: '600', width: 32 },
  intervalDesc: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },

  // Actual Performance
  actualSection: { marginTop: 20, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16 },
  actualStatsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 },

  // RPE
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  rpeLabel: { color: COLORS.textSecondary, fontSize: 13, width: 72 },
  rpeDots: { flexDirection: 'row', gap: 4, flex: 1 },
  rpeDot: { width: 10, height: 10, borderRadius: 5 },
  rpeDotEmpty: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.surfaceLight },
  rpeValue: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Courier', width: 32, textAlign: 'right' },

  // Source / gear
  sourceRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  sourceTag: { color: COLORS.textTertiary, fontSize: 11 },
  gearTag: { color: COLORS.textTertiary, fontSize: 11 },

  // Splits
  splitsHeader: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  splitHeaderCell: { color: COLORS.textTertiary, fontSize: 12, fontWeight: '600', width: 48, textAlign: 'center' },
  splitRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  splitRowAlt: { backgroundColor: COLORS.surface },
  splitMile: { color: COLORS.textSecondary, fontSize: 14, width: 48, textAlign: 'center' },
  splitPace: { color: COLORS.text, fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center', fontFamily: 'Courier' },
  splitPaceOff: { color: COLORS.warning },
  splitHr: { color: COLORS.textSecondary, fontSize: 14, width: 48, textAlign: 'center' },

  // Extra chips
  extraChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '500' },

  // Best Efforts
  effortRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  effortLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  medalIcon: { marginBottom: 1 },
  effortName: { color: COLORS.text, fontSize: 14 },
  prName: { fontWeight: '600' },
  effortTime: { color: COLORS.textSecondary, fontSize: 14, marginRight: 10 },
  prBadge: { backgroundColor: 'rgba(255,215,0,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)' },
  prBadgeText: { color: '#FFD700', fontSize: 11, fontWeight: '700' },

  // Adaptive
  adaptiveSection: { marginTop: 16, backgroundColor: 'rgba(255, 149, 0, 0.08)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 149, 0, 0.2)' },
  adaptiveTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  adaptiveOriginal: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  adaptiveReason: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },

  // Notes
  notesText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
});
