import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Sparkle, X, Trophy, CaretDown, CaretUp, Sneaker } from 'phosphor-react-native';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDateLong, getToday, addDays } from '../../src/utils/dateUtils';
import { formatPace } from '../../src/engine/vdot';
import { getWorkoutByDate, getMetricsForWorkout, getStravaDetailForWorkout, getRecentMetrics } from '../../src/db/client';
import { displayDistance, distanceLabelFull, distanceLabel, formatPaceWithUnit, paceLabel } from '../../src/utils/units';
import { RecoveryStatus, PerformanceMetric } from '../../src/types';
import { RaceWeekBriefing, PacingPlan } from '../../src/ai/raceWeek';
import { RouteThumbnail } from '../../src/components/RouteThumbnail';
import { AdaptiveToast } from '../../src/components/common/AdaptiveToast';

export default function TodayScreen() {
  const { todaysWorkout, currentWeek, activePlan, paceZones, markWorkoutComplete, markWorkoutSkipped, refreshTodaysWorkout, allWorkouts, currentACWR, lastVDOTUpdate, adaptiveLogs, acknowledgeAdaptiveLog, recoveryStatus, preWorkoutBriefing, isLoadingBriefing, fetchPreWorkoutBriefing, postRunAnalysis, showPostRunAnalysis, dismissPostRunAnalysis, isRaceWeek, raceWeekBriefing, isLoadingRaceWeek, fetchRaceWeekBriefing, restDaySuggestion, fetchRestDaySuggestion, backupInfo, isBackingUp, performBackup, shoeAlerts, pendingVDOTSuggestion, applyVDOTSuggestion, dismissVDOTSuggestion } = useAppStore();
  const lastAdaptiveSummary = useAppStore(s => s.lastAdaptiveSummary);
  const units = useSettingsStore(s => s.units);
  const router = useRouter();
  const [showIntervals, setShowIntervals] = useState(false);
  const [backupReminderDismissed, setBackupReminderDismissed] = useState(false);

  // Show reminder if logged in and last backup was >7 days ago (or never)
  const showBackupReminder = !backupReminderDismissed && (() => {
    if (!backupInfo) return false; // not logged in
    if (!backupInfo.exists) return true; // logged in but no backup yet
    if (!backupInfo.createdAt) return true;
    const daysSince = (Date.now() - new Date(backupInfo.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  })();

  // Fetch actual run data for completed workouts
  const metric = useMemo(() => {
    if (!todaysWorkout || todaysWorkout.status !== 'completed') return null;
    const metrics = getMetricsForWorkout(todaysWorkout.id);
    return metrics.length > 0 ? metrics[0] : null;
  }, [todaysWorkout?.id, todaysWorkout?.status]);

  const stravaDetail = useMemo(() => {
    if (!todaysWorkout || todaysWorkout.status !== 'completed') return null;
    return getStravaDetailForWorkout(todaysWorkout.id);
  }, [todaysWorkout?.id, todaysWorkout?.status]);

  // All recent runs from Strava/HealthKit
  const recentRuns = useMemo(() => {
    const { getStravaDetailForMetric } = require('../../src/db/client');
    const metrics = getRecentMetrics(56); // 8 weeks
    return metrics.map(m => {
      const detail = m.workout_id
        ? getStravaDetailForWorkout(m.workout_id)
        : getStravaDetailForMetric(m.id);
      const matchedWorkout = m.workout_id ? allWorkouts.find(w => w.id === m.workout_id) : null;
      return { metric: m, stravaDetail: detail, workout: matchedWorkout };
    });
  }, [allWorkouts.length]);

  useEffect(() => {
    refreshTodaysWorkout();
    // Sync workout data whenever Today tab is focused
    const store = useAppStore.getState();
    store.syncStravaData();           // Primary: Strava
    store.syncWorkoutFromHealthKit(); // Fallback: HealthKit (skips if Strava connected)

  }, []);

  // Fetch pre-workout briefing, race week briefing, or rest day suggestion
  useEffect(() => {
    if (isRaceWeek) {
      fetchRaceWeekBriefing();
    } else if (todaysWorkout && todaysWorkout.status === 'scheduled' && todaysWorkout.workout_type !== 'rest') {
      fetchPreWorkoutBriefing();
    } else if (todaysWorkout && todaysWorkout.workout_type === 'rest') {
      fetchRestDaySuggestion();
    }
  }, [todaysWorkout?.id, isRaceWeek]);

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
    <View style={styles.container}>
      <AdaptiveToast
        message={lastAdaptiveSummary}
        onDismiss={() => useAppStore.setState({ lastAdaptiveSummary: null })}
      />
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

      {pendingVDOTSuggestion && (
        <View style={styles.prBanner}>
          <Trophy size={18} color="#FF9F0A" weight="fill" style={{ marginRight: 10, flexShrink: 0 }} />
          <View style={styles.prBannerBody}>
            <Text style={styles.prBannerTitle}>New {pendingVDOTSuggestion.distance} PR detected!</Text>
            <Text style={styles.prBannerSub}>{pendingVDOTSuggestion.prTime} → VDOT {pendingVDOTSuggestion.vdot.toFixed(1)} — update your training zones?</Text>
            <View style={styles.prBannerActions}>
              <Pressable style={styles.prBannerApply} onPress={applyVDOTSuggestion}>
                <Text style={styles.prBannerApplyText}>Update Zones</Text>
              </Pressable>
              <Pressable style={styles.prBannerDismiss} onPress={dismissVDOTSuggestion}>
                <Text style={styles.prBannerDismissText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {showBackupReminder && (
        <View style={styles.backupReminderBanner}>
          <View style={styles.backupReminderLeft}>
            <Text style={styles.backupReminderTitle}>
              {backupInfo?.exists ? 'Backup is over 7 days old' : 'No cloud backup yet'}
            </Text>
            <Text style={styles.backupReminderSub}>Back up your training data in Settings.</Text>
          </View>
          <Pressable
            onPress={() => setBackupReminderDismissed(true)}
            hitSlop={12}
            style={styles.backupReminderDismiss}
          >
            <X size={16} color={COLORS.textTertiary} />
          </Pressable>
        </View>
      )}

      {shoeAlerts.length > 0 && (
        <View style={[styles.shoeAlertBanner, shoeAlerts[0].severity === 'critical' && styles.shoeAlertCritical, shoeAlerts[0].severity === 'warning' && styles.shoeAlertWarning]}>
          <Sneaker size={16} color={shoeAlerts[0].severity === 'critical' ? COLORS.danger : shoeAlerts[0].severity === 'warning' ? COLORS.warning : COLORS.accent} weight="fill" style={{ marginRight: 8 }} />
          <Text style={styles.shoeAlertText}>{shoeAlerts[0].message}</Text>
        </View>
      )}

      {recoveryStatus && recoveryStatus.signalCount >= 2 && recoveryStatus.score < 40 && todaysWorkout && !isRest && ['tempo', 'interval', 'marathon_pace'].includes(todaysWorkout.workout_type) && todaysWorkout.status === 'scheduled' && (
        <Pressable style={styles.recoveryWarning} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.recoveryWarningText}>Low recovery detected — ask coach about today's workout?</Text>
        </Pressable>
      )}

      {isRaceWeek && isRest && (
        <RaceWeekCard
          briefing={raceWeekBriefing}
          isLoading={isLoadingRaceWeek}
          onDiscuss={() => router.push('/(tabs)/coach')}
        />
      )}

      {isRest ? (
        <View style={styles.card}>
          <Text style={styles.restTitle}>Rest Day</Text>
          <Text style={styles.restMessage}>Recovery is when adaptation happens. Enjoy your rest.</Text>
          {restDaySuggestion && (
            <View style={styles.restSuggestion}>
              <Sparkle size={14} color={COLORS.accent} weight="fill" />
              <Text style={styles.restSuggestionText}>{restDaySuggestion}</Text>
            </View>
          )}
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

          {todaysWorkout!.status === 'completed' && stravaDetail?.polylineEncoded && (
            <RouteThumbnail
              polylineEncoded={stravaDetail.polylineEncoded}
              height={130}
              onPress={() => router.push(`/workout/${todaysWorkout!.id}`)}
            />
          )}

          {todaysWorkout!.status === 'completed' && metric && (
            <PerformanceCard
              metric={metric}
              stravaDetail={stravaDetail}
              paceRange={paceRange}
              units={units}
            />
          )}

          {todaysWorkout!.status === 'scheduled' && (
            <>
              {isRaceWeek ? (
                <RaceWeekCard
                  briefing={raceWeekBriefing}
                  isLoading={isLoadingRaceWeek}
                  onDiscuss={() => router.push('/(tabs)/coach')}
                />
              ) : (
                <BriefingCard
                  briefing={preWorkoutBriefing}
                  isLoading={isLoadingBriefing}
                  onPress={() => router.push('/(tabs)/coach')}
                />
              )}
              <View style={styles.buttonRow}>
                <Pressable style={[styles.button, styles.completeButton]} onPress={handleComplete}>
                  <Text style={styles.buttonText}>Mark Complete</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.skipButton]} onPress={handleSkip}>
                  <Text style={[styles.buttonText, { color: COLORS.danger }]}>Skip</Text>
                </Pressable>
              </View>
            </>
          )}

          {todaysWorkout!.status === 'completed' && showPostRunAnalysis && postRunAnalysis && (
            <View style={styles.analysisCard}>
              <View style={styles.analysisHeader}>
                <View style={styles.analysisHeaderLeft}>
                  <Sparkle size={16} color="#34C759" weight="fill" />
                  <Text style={styles.analysisLabel}>POST-RUN ANALYSIS</Text>
                </View>
                <Pressable onPress={dismissPostRunAnalysis} hitSlop={12}>
                  <X size={18} color={COLORS.textTertiary} />
                </Pressable>
              </View>
              <Text style={styles.analysisText}>{postRunAnalysis}</Text>
              <Pressable style={styles.discussButton} onPress={() => router.push('/(tabs)/coach')}>
                <Text style={styles.discussButtonText}>Discuss with Coach</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {/* Recent Runs */}
      {recentRuns.length > 0 && (
        <View style={styles.runHistorySection}>
          <Text style={styles.runHistorySectionTitle}>Recent Runs</Text>
          {recentRuns.map((run, idx) => {
            const m = run.metric;
            const dMin = Math.floor(m.duration_seconds / 60);
            const dSec = m.duration_seconds % 60;
            const typeLabel = run.workout ? WORKOUT_TYPE_LABELS[run.workout.workout_type] : null;
            return (
              <Pressable
                key={m.id || idx}
                style={styles.runRow}
                onPress={() => router.push(`/workout/${run.workout ? run.workout.id : m.id}`)}
              >
                <View style={styles.runRowLeft}>
                  <Text style={styles.runDate}>{m.date}</Text>
                  {typeLabel && <Text style={styles.runType}>{typeLabel}</Text>}
                </View>
                <View style={styles.runRowCenter}>
                  <Text style={styles.runDist}>{displayDistance(m.distance_miles, units).toFixed(1)} {dl}</Text>
                  <Text style={[styles.runPace, styles.mono]}>{formatPace(m.avg_pace_per_mile)}</Text>
                </View>
                <View style={styles.runRowRight}>
                  {m.avg_hr ? <Text style={styles.runHr}>{m.avg_hr} bpm</Text> : null}
                  <Text style={styles.runDuration}>{dMin}:{dSec.toString().padStart(2, '0')}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
    </View>
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

function BriefingCard({ briefing, isLoading, onPress }: { briefing: string | null; isLoading: boolean; onPress: () => void }) {
  if (!isLoading && !briefing) return null;

  return (
    <Pressable style={styles.briefingCard} onPress={onPress}>
      <View style={styles.briefingHeader}>
        <Sparkle size={16} color={COLORS.accent} weight="fill" />
        <Text style={styles.briefingLabel}>COACH BRIEFING</Text>
      </View>
      {isLoading ? (
        <View style={styles.briefingLoading}>
          <ActivityIndicator size="small" color={COLORS.textTertiary} />
        </View>
      ) : (
        <Text style={styles.briefingText}>{briefing}</Text>
      )}
    </Pressable>
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

function RaceWeekCard({ briefing, isLoading, onDiscuss }: { briefing: RaceWeekBriefing | null; isLoading: boolean; onDiscuss: () => void }) {
  const [showPacingPlan, setShowPacingPlan] = useState(false);

  if (!isLoading && !briefing) return null;

  return (
    <View style={styles.raceWeekCard}>
      <View style={styles.raceWeekHeader}>
        <Trophy size={18} color="#FF9500" weight="fill" />
        <Text style={styles.raceWeekLabel}>
          {briefing?.dayLabel?.toUpperCase() || 'RACE WEEK'}
        </Text>
      </View>
      {isLoading ? (
        <View style={styles.briefingLoading}>
          <ActivityIndicator size="small" color="#FF9500" />
        </View>
      ) : (
        <>
          <Text style={styles.raceWeekBriefingText}>{briefing!.briefing}</Text>

          {briefing!.checklist && briefing!.checklist.length > 0 && (
            <View style={styles.raceWeekChecklist}>
              <Text style={styles.raceWeekChecklistLabel}>CHECKLIST</Text>
              {briefing!.checklist.map((item, i) => (
                <View key={i} style={styles.checklistRow}>
                  <Text style={styles.checklistBullet}>□</Text>
                  <Text style={styles.checklistText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {briefing!.pacingPlan && (
            <View style={styles.pacingPlanSection}>
              <Pressable
                style={styles.pacingPlanToggle}
                onPress={() => setShowPacingPlan(!showPacingPlan)}
              >
                <Text style={styles.pacingPlanToggleText}>
                  Pacing Plan — {briefing!.pacingPlan.strategy}
                </Text>
                {showPacingPlan ? (
                  <CaretUp size={16} color="#FF9500" />
                ) : (
                  <CaretDown size={16} color="#FF9500" />
                )}
              </Pressable>
              {showPacingPlan && (
                <PacingPlanTable plan={briefing!.pacingPlan} />
              )}
            </View>
          )}

          <Pressable style={styles.raceWeekDiscussButton} onPress={onDiscuss}>
            <Text style={styles.raceWeekDiscussText}>Discuss with Coach</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function PacingPlanTable({ plan }: { plan: PacingPlan }) {
  return (
    <View style={styles.pacingTable}>
      <View style={styles.pacingTableHeader}>
        <Text style={[styles.pacingTableHeaderText, { flex: 0.6 }]}>Mile</Text>
        <Text style={[styles.pacingTableHeaderText, { flex: 0.8 }]}>Pace</Text>
        <Text style={[styles.pacingTableHeaderText, { flex: 2 }]}>Notes</Text>
      </View>
      {plan.splits.map((split, i) => (
        <View key={i} style={[styles.pacingTableRow, i % 2 === 0 && styles.pacingTableRowAlt]}>
          <Text style={[styles.pacingTableMile, { flex: 0.6 }]}>
            {split.mile === 27 ? '26.2' : split.mile}
          </Text>
          <Text style={[styles.pacingTablePace, { flex: 0.8 }]}>{split.targetPace}</Text>
          <Text style={[styles.pacingTableNote, { flex: 2 }]}>{split.note}</Text>
        </View>
      ))}
      {plan.fuelingPlan.length > 0 && (
        <View style={styles.fuelingSection}>
          <Text style={styles.fuelingSectionLabel}>FUELING PLAN</Text>
          {plan.fuelingPlan.map((item, i) => (
            <Text key={i} style={styles.fuelingItem}>• {item}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function PerformanceCard({ metric, stravaDetail, paceRange, units }: {
  metric: PerformanceMetric;
  stravaDetail: any | null;
  paceRange: { min: number; max: number } | null;
  units: string;
}) {
  const dl = distanceLabel(units as any);
  const durationMin = Math.floor(metric.duration_seconds / 60);
  const durationSec = metric.duration_seconds % 60;
  const [showSplits, setShowSplits] = useState(false);
  const splits = stravaDetail?.splits || [];

  return (
    <View style={styles.perfCard}>
      <View style={styles.perfHeader}>
        <Text style={styles.perfLabel}>ACTUAL PERFORMANCE</Text>
        <Text style={styles.perfSource}>
          {metric.source === 'strava' ? 'Strava' : metric.source === 'healthkit' ? 'HealthKit' : 'Manual'}
        </Text>
      </View>

      <View style={styles.perfStatsRow}>
        <View style={styles.perfStat}>
          <Text style={styles.perfStatValue}>{displayDistance(metric.distance_miles, units as any).toFixed(1)}</Text>
          <Text style={styles.perfStatLabel}>{dl}</Text>
        </View>
        <View style={styles.perfStat}>
          <Text style={[styles.perfStatValue, styles.mono]}>{formatPace(metric.avg_pace_per_mile)}</Text>
          <Text style={styles.perfStatLabel}>avg pace</Text>
        </View>
        {metric.avg_hr ? (
          <View style={styles.perfStat}>
            <Text style={styles.perfStatValue}>{metric.avg_hr}</Text>
            <Text style={styles.perfStatLabel}>avg HR</Text>
          </View>
        ) : null}
        <View style={styles.perfStat}>
          <Text style={styles.perfStatValue}>{durationMin}:{durationSec.toString().padStart(2, '0')}</Text>
          <Text style={styles.perfStatLabel}>time</Text>
        </View>
      </View>

      {/* Extra Strava stats */}
      {stravaDetail && (
        <View style={styles.perfExtras}>
          {stravaDetail.elevation_gain_ft > 0 && (
            <View style={styles.perfChip}>
              <Text style={styles.perfChipText}>{Math.round(stravaDetail.elevation_gain_ft)} ft gain</Text>
            </View>
          )}
          {stravaDetail.cadence_avg > 0 && (
            <View style={styles.perfChip}>
              <Text style={styles.perfChipText}>{Math.round(stravaDetail.cadence_avg * 2)} spm</Text>
            </View>
          )}
          {stravaDetail.suffer_score > 0 && (
            <View style={styles.perfChip}>
              <Text style={styles.perfChipText}>Effort: {stravaDetail.suffer_score}</Text>
            </View>
          )}
          {stravaDetail.calories > 0 && (
            <View style={styles.perfChip}>
              <Text style={styles.perfChipText}>{stravaDetail.calories} cal</Text>
            </View>
          )}
        </View>
      )}

      {/* Mile splits toggle */}
      {splits.length > 0 && (
        <>
          <Pressable onPress={() => setShowSplits(!showSplits)} style={styles.perfSplitsToggle}>
            <Text style={styles.perfSplitsToggleText}>
              {showSplits ? 'Hide' : 'Show'} Mile Splits ({splits.length})
            </Text>
            {showSplits ? <CaretUp size={14} color={COLORS.accent} /> : <CaretDown size={14} color={COLORS.accent} />}
          </Pressable>
          {showSplits && (
            <View>
              {splits.map((s: any, i: number) => {
                const paceSec = s.movingTime > 0 && s.distance > 0
                  ? Math.round((s.movingTime / s.distance) * 1609.344)
                  : 0;
                const isInZone = paceRange ? paceSec >= paceRange.max && paceSec <= paceRange.min : true;
                return (
                  <View key={i} style={[styles.perfSplitRow, i % 2 === 0 && styles.perfSplitRowAlt]}>
                    <Text style={styles.perfSplitMile}>{s.split}</Text>
                    <Text style={[styles.perfSplitPace, !isInZone && { color: COLORS.warning }]}>
                      {formatPace(paceSec)}
                    </Text>
                    <Text style={styles.perfSplitHr}>
                      {s.averageHeartrate ? Math.round(s.averageHeartrate) : '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
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
  restSuggestion: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  restSuggestionText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, flex: 1, fontStyle: 'italic' },
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
  briefingCard: { backgroundColor: 'rgba(0, 122, 255, 0.08)', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(0, 122, 255, 0.2)' },
  briefingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  briefingLabel: { color: COLORS.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  briefingText: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  briefingLoading: { paddingVertical: 8, alignItems: 'center' },
  analysisCard: { backgroundColor: 'rgba(52, 199, 89, 0.08)', borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 1, borderColor: 'rgba(52, 199, 89, 0.2)' },
  analysisHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  analysisHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  analysisLabel: { color: COLORS.success, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  analysisText: { color: COLORS.text, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  discussButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(52, 199, 89, 0.15)' },
  discussButtonText: { color: COLORS.success, fontSize: 13, fontWeight: '600' },

  // Race Week Card
  raceWeekCard: { backgroundColor: 'rgba(255, 149, 0, 0.08)', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1.5, borderColor: 'rgba(255, 149, 0, 0.3)' },
  raceWeekHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  raceWeekLabel: { color: '#FF9500', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  raceWeekBriefingText: { color: COLORS.text, fontSize: 15, lineHeight: 23, marginBottom: 14 },
  raceWeekChecklist: { marginBottom: 14 },
  raceWeekChecklistLabel: { color: '#FF9500', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  checklistBullet: { color: COLORS.textSecondary, fontSize: 14, width: 16 },
  checklistText: { color: COLORS.text, fontSize: 13, lineHeight: 19, flex: 1 },
  pacingPlanSection: { marginBottom: 14 },
  pacingPlanToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: 'rgba(255, 149, 0, 0.3)' },
  pacingPlanToggleText: { color: '#FF9500', fontSize: 14, fontWeight: '600', flex: 1 },
  pacingTable: { marginTop: 8 },
  pacingTableHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 149, 0, 0.2)' },
  pacingTableHeaderText: { color: '#FF9500', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  pacingTableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  pacingTableRowAlt: { backgroundColor: 'rgba(255, 149, 0, 0.04)' },
  pacingTableMile: { color: COLORS.text, fontSize: 13, fontWeight: '700', fontFamily: 'Courier' },
  pacingTablePace: { color: COLORS.text, fontSize: 13, fontWeight: '600', fontFamily: 'Courier' },
  pacingTableNote: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  fuelingSection: { marginTop: 12, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: 'rgba(255, 149, 0, 0.2)' },
  fuelingSectionLabel: { color: '#FF9500', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  fuelingItem: { color: COLORS.text, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  raceWeekDiscussButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255, 149, 0, 0.15)' },
  raceWeekDiscussText: { color: '#FF9500', fontSize: 13, fontWeight: '600' },

  // Performance Card
  perfCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(252, 82, 0, 0.25)' },
  perfHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  perfLabel: { color: COLORS.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  perfSource: { color: COLORS.textTertiary, fontSize: 11 },
  perfStatsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  perfStat: { alignItems: 'center' },
  perfStatValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  perfStatLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  mono: { fontFamily: 'Courier' },
  perfExtras: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  perfChip: { backgroundColor: COLORS.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 0.5, borderColor: COLORS.border },
  perfChipText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '500' },
  perfSplitsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  perfSplitsToggleText: { color: COLORS.accent, fontSize: 13, fontWeight: '500' },
  perfSplitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 },
  perfSplitRowAlt: { backgroundColor: COLORS.background, borderRadius: 4 },
  perfSplitMile: { color: COLORS.textSecondary, fontSize: 13, width: 40, textAlign: 'center' },
  perfSplitPace: { color: COLORS.text, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'center', fontFamily: 'Courier' },
  perfSplitHr: { color: COLORS.textSecondary, fontSize: 13, width: 40, textAlign: 'center' },

  // Backup Reminder Banner
  backupReminderBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(175, 82, 222, 0.1)', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(175, 82, 222, 0.25)' },
  backupReminderLeft: { flex: 1 },
  backupReminderTitle: { color: '#AF52DE', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  backupReminderSub: { color: COLORS.textSecondary, fontSize: 12 },
  backupReminderDismiss: { paddingLeft: 8 },

  // PR / VDOT Suggestion Banner
  prBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255, 159, 10, 0.1)', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255, 159, 10, 0.3)' },
  prBannerBody: { flex: 1 },
  prBannerTitle: { color: '#FF9F0A', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  prBannerSub: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  prBannerActions: { flexDirection: 'row', marginTop: 10, gap: 8 },
  prBannerApply: { backgroundColor: '#FF9F0A', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  prBannerApplyText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  prBannerDismiss: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.border },
  prBannerDismissText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },

  // Shoe Alert Banner
  shoeAlertBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 122, 255, 0.08)', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(0, 122, 255, 0.2)' },
  shoeAlertWarning: { backgroundColor: 'rgba(255, 149, 0, 0.1)', borderColor: 'rgba(255, 149, 0, 0.3)' },
  shoeAlertCritical: { backgroundColor: 'rgba(255, 59, 48, 0.1)', borderColor: 'rgba(255, 59, 48, 0.3)' },
  shoeAlertText: { color: COLORS.text, fontSize: 13, flex: 1, lineHeight: 18 },

  // Run History
  runHistorySection: { marginTop: 16 },
  runHistorySectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  runRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border },
  runRowLeft: { flex: 1 },
  runDate: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  runType: { color: COLORS.accent, fontSize: 11, fontWeight: '600', marginTop: 2 },
  runRowCenter: { alignItems: 'center', marginHorizontal: 12 },
  runDist: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  runPace: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  runRowRight: { alignItems: 'flex-end' },
  runHr: { color: COLORS.textSecondary, fontSize: 12 },
  runDuration: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
});
