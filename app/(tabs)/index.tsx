import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { RefreshControl } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner, Button } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDateLong, getToday } from '../../src/utils/dateUtils';
import { formatPace } from '../../src/engine/vdot';
import { IntervalStep, CrossTrainingType, CROSS_TRAINING_LABELS, CROSS_TRAINING_IMPACT } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getWorkoutIcon } from '../../src/utils/workoutIcons';
import { WeightCheckin } from '../../src/components/WeightCheckin';
import { RecoveryStatus } from '../../src/types';
import { colors, semantic } from '../../src/theme/colors';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

function RecoveryBadge({ recovery }: { recovery: RecoveryStatus }) {
  const router = useRouter();
  const color = recovery.score >= 80 ? colors.cyan
    : recovery.score >= 60 ? colors.orange
    : recovery.score >= 40 ? colors.orange
    : colors.error;
  const label = recovery.level.charAt(0).toUpperCase() + recovery.level.slice(1);

  return (
    <XStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$4" alignItems="center"
      pressStyle={{ opacity: 0.8 }} onPress={() => router.push('/(tabs)/zones')}>
      <View width={40} height={40} borderRadius={20} backgroundColor={color + '22'} alignItems="center" justifyContent="center" marginRight="$3">
        <M color={color} fontSize={16} fontWeight="800">{recovery.score}</M>
      </View>
      <YStack flex={1}>
        <H color={color} fontSize={13} letterSpacing={1} textTransform="uppercase">{label}</H>
        <B color="$textSecondary" fontSize={12}>{recovery.recommendation}</B>
      </YStack>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textTertiary} />
    </XStack>
  );
}

export default function TodayScreen() {
  const router = useRouter();

  const isLoading = useAppStore(s => s.isLoading);
  const activePlan = useAppStore(s => s.activePlan);
  const todaysWorkout = useAppStore(s => s.todaysWorkout);
  const currentWeekNumber = useAppStore(s => s.currentWeekNumber);
  const currentPhase = useAppStore(s => s.currentPhase);
  const daysUntilRace = useAppStore(s => s.daysUntilRace);
  const isRaceWeek = useAppStore(s => s.isRaceWeek);
  const weeks = useAppStore(s => s.weeks);
  const workouts = useAppStore(s => s.workouts);
  const paceZones = useAppStore(s => s.paceZones);
  const preWorkoutBriefing = useAppStore(s => s.preWorkoutBriefing);
  const postRunAnalysis = useAppStore(s => s.postRunAnalysis);
  const raceStrategy = useAppStore(s => s.raceStrategy);
  const recoveryStatus = useAppStore(s => s.recoveryStatus);

  const isSyncing = useAppStore(s => s.isSyncing);
  const vdotNotification = useAppStore(s => s.vdotNotification);
  const proactiveSuggestion = useAppStore(s => s.proactiveSuggestion);
  const todayCrossTraining = useAppStore(s => s.todayCrossTraining);
  const logCrossTraining = useAppStore(s => s.logCrossTraining);
  const deleteCrossTrainingEntry = useAppStore(s => s.deleteCrossTrainingEntry);
  const fetchBriefing = useAppStore(s => s.fetchBriefing);
  const fetchPostRunAnalysis = useAppStore(s => s.fetchPostRunAnalysis);
  const fetchRaceStrategy = useAppStore(s => s.fetchRaceStrategy);
  const markWorkoutComplete = useAppStore(s => s.markWorkoutComplete);
  const markWorkoutSkipped = useAppStore(s => s.markWorkoutSkipped);
  const syncAll = useAppStore(s => s.syncAll);

  // Get actual metric for today's workout if completed
  const todaysMetric = useMemo(() => {
    if (!todaysWorkout || todaysWorkout.status !== 'completed') return null;
    try {
      const { getMetricsForWorkout } = require('../../src/db/database');
      const metrics = getMetricsForWorkout(todaysWorkout.id);
      return metrics.length > 0 ? metrics[0] : null;
    } catch { return null; }
  }, [todaysWorkout?.id, todaysWorkout?.status]);

  const totalWeeks = weeks.length;

  useEffect(() => {
    if (activePlan && todaysWorkout) fetchBriefing();
    if (isRaceWeek) fetchRaceStrategy();
  }, [activePlan?.id, todaysWorkout?.id, isRaceWeek]);

  const handleComplete = useCallback(() => {
    if (!todaysWorkout) return;
    markWorkoutComplete(todaysWorkout.id);
    fetchPostRunAnalysis(todaysWorkout.id);
  }, [todaysWorkout?.id]);

  const handleSkip = useCallback(() => {
    if (!todaysWorkout) return;
    const { Alert } = require('react-native');
    Alert.alert(
      'Skip today\'s workout?',
      `This will mark ${todaysWorkout.title} (${todaysWorkout.target_distance_miles?.toFixed(1) ?? '?'} mi) as skipped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip Workout', style: 'destructive', onPress: () => markWorkoutSkipped(todaysWorkout.id) },
      ]
    );
  }, [todaysWorkout?.id]);

  const onRefresh = useCallback(() => {
    syncAll();
  }, []);

  // ─── Cross-training modal ────────────────────────────────
  const [showCTModal, setShowCTModal] = useState(false);
  const [ctNotes, setCTNotes] = useState('');

  // ─── Sync complete flash ─────────────────────────────────
  const [showSyncDone, setShowSyncDone] = useState(false);
  const prevSyncing = React.useRef(isSyncing);
  useEffect(() => {
    if (prevSyncing.current && !isSyncing) {
      setShowSyncDone(true);
      const t = setTimeout(() => setShowSyncDone(false), 2000);
      return () => clearTimeout(t);
    }
    prevSyncing.current = isSyncing;
  }, [isSyncing]);

  // ─── Weight check-in + Height prompt ─────────────────────
  const [showWeightCheckin, setShowWeightCheckin] = useState(false);
  const userProfile = useAppStore(s => s.userProfile);

  useEffect(() => {
    if (!userProfile || !activePlan) return;
    if (daysUntilRace <= 7 && daysUntilRace >= 0) return;

    try {
      const { getSetting } = require('../../src/db/database');
      const today = getToday();

      // Skip popup if HealthKit is keeping weight current
      const weightSource = userProfile?.weight_source;
      const weightUpdated = userProfile?.weight_updated_at;
      if (weightSource === 'healthkit' && weightUpdated) {
        const daysSinceHK = Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(weightUpdated + 'T00:00:00').getTime()) / 86400000);
        if (daysSinceHK < 7) return; // HealthKit keeping it current
      }

      const lastCheckin = getSetting('last_weight_checkin_date');
      if (lastCheckin) {
        const daysSince = Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(lastCheckin + 'T00:00:00').getTime()) / 86400000);
        if (daysSince < 7) return;
      }
      // Show after a short delay so it doesn't block the screen
      setTimeout(() => setShowWeightCheckin(true), 2000);
    } catch {}
  }, [userProfile?.id, activePlan?.id]);

  const handleWeightUpdate = useCallback((weightKg: number) => {
    try {
      const { updateWeight, getSetting, setSetting } = require('../../src/db/database');
      const oldWeight = userProfile?.weight_kg;
      updateWeight(weightKg);
      setSetting('last_weight_checkin_date', getToday());
      setShowWeightCheckin(false);
      useAppStore.getState().refreshState();
      // Auto-backup
      (async () => { try { const { autoBackup } = require('../../src/backup/backup'); await autoBackup(); } catch {} })();
      // Flag large change for coach
      if (oldWeight && Math.abs(weightKg - oldWeight) > 2) {
        setSetting('weight_change_flag', `${oldWeight}→${weightKg}`);
      }
    } catch {}
  }, [userProfile?.weight_kg]);

  const handleWeightNoChange = useCallback(() => {
    try { const { setSetting } = require('../../src/db/database'); setSetting('last_weight_checkin_date', getToday()); } catch {}
    setShowWeightCheckin(false);
  }, []);

  const getTomorrowWorkout = () => {
    const today = getToday();
    const tomorrow = new Date(today + 'T00:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const s = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    return workouts.find(w => w.scheduled_date === s);
  };

  // Loading
  if (isLoading) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center">
        <Spinner size="large" color="$accent" />
      </YStack>
    );
  }

  // No plan
  if (!activePlan) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding="$8">
        <B fontSize={48} marginBottom="$4">🏃</B>
        <H color="$color" fontSize={28} letterSpacing={1} marginBottom="$2">No Training Plan</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22} marginBottom="$6">
          Set up your profile and generate a plan to get started.
        </B>
        <YStack backgroundColor="$accent" borderRadius="$5" paddingHorizontal="$8" paddingVertical="$3"
          pressStyle={{ opacity: 0.8 }} onPress={() => router.push('/setup')}>
          <B color="white" fontSize={16} fontWeight="700">Get Started</B>
        </YStack>
      </YStack>
    );
  }

  const isRestDay = !todaysWorkout || todaysWorkout.workout_type === 'rest';
  const tomorrowWorkout = isRestDay ? getTomorrowWorkout() : null;

  let intervals: IntervalStep[] | null = null;
  if (todaysWorkout?.intervals_json) {
    try { intervals = JSON.parse(todaysWorkout.intervals_json); } catch {}
  }

  return (
    <ScrollView
      flex={1} backgroundColor="$background"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={onRefresh} tintColor={colors.cyan} />}
    >
      {/* Sync Indicator */}
      {isSyncing && (
        <XStack alignItems="center" justifyContent="center" gap="$2" marginBottom="$2">
          <Spinner size="small" color="$textTertiary" />
          <B color="$textTertiary" fontSize={12}>Syncing...</B>
        </XStack>
      )}
      {!isSyncing && showSyncDone && (
        <XStack alignItems="center" justifyContent="center" gap="$2" marginBottom="$2">
          <MaterialCommunityIcons name="check-circle-outline" size={14} color={colors.cyan} />
          <B color="$textTertiary" fontSize={12}>Updated</B>
        </XStack>
      )}

      {/* VDOT Change Notification */}
      {vdotNotification && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3}
          borderLeftColor={vdotNotification.newVDOT > vdotNotification.oldVDOT ? '$success' : '$warning'}>
          <XStack justifyContent="space-between" alignItems="flex-start">
            <YStack flex={1}>
              <H color={vdotNotification.newVDOT > vdotNotification.oldVDOT ? '$success' : '$warning'} fontSize={13} letterSpacing={1} textTransform="uppercase" marginBottom="$1">
                {vdotNotification.newVDOT > vdotNotification.oldVDOT ? 'Fitness Improved!' : 'VDOT Updated'}
              </H>
              <B color="$color" fontSize={14} lineHeight={20}>
                VDOT updated from <M color="$color" fontSize={14} fontWeight="700">{vdotNotification.oldVDOT}</M> → <M color="$color" fontSize={14} fontWeight="700">{vdotNotification.newVDOT}</M> based on your {vdotNotification.source}. Pace zones recalculated.
              </B>
              {Math.abs(vdotNotification.newVDOT - vdotNotification.oldVDOT) >= 2 && (
                <YStack backgroundColor="$accent" borderRadius="$4" paddingVertical="$2" paddingHorizontal="$4" marginTop="$3" alignSelf="flex-start"
                  pressStyle={{ opacity: 0.8 }} onPress={() => router.push('/(tabs)/settings')}>
                  <B color="white" fontSize={13} fontWeight="700">Regenerate Plan</B>
                </YStack>
              )}
            </YStack>
            <B color="$textTertiary" fontSize={18} marginLeft="$2"
              onPress={() => { useAppStore.setState({ vdotNotification: null }); try { const { setSetting } = require('../../src/db/database'); setSetting('pending_vdot_notification', ''); } catch {} }}>✕</B>
          </XStack>
        </YStack>
      )}

      {/* Proactive Coach Suggestion */}
      {proactiveSuggestion && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3}
          borderLeftColor={proactiveSuggestion.ctSuggestion?.severity === 'strong' ? '$danger' : '$warning'}>
          <XStack justifyContent="space-between" alignItems="flex-start">
            <XStack alignItems="center" gap="$2" marginBottom="$2">
              <MaterialCommunityIcons name="lightbulb-outline" size={18}
                color={proactiveSuggestion.ctSuggestion?.severity === 'strong' ? colors.error : colors.orange} />
              <H color={proactiveSuggestion.ctSuggestion?.severity === 'strong' ? '$danger' : '$warning'}
                fontSize={13} letterSpacing={1} textTransform="uppercase">Coach Suggestion</H>
            </XStack>
            <B color="$textTertiary" fontSize={18} onPress={() => { useAppStore.setState({ proactiveSuggestion: null }); try { const { setSetting } = require('../../src/db/database'); setSetting('pending_proactive_suggestion', ''); } catch {} }}>✕</B>
          </XStack>
          <B color="$color" fontSize={14} lineHeight={20} marginBottom="$3">{proactiveSuggestion.message}</B>
          <YStack gap="$2">
            {(proactiveSuggestion.ctSuggestion?.options ?? [
              { label: 'Swap to Easy', action: 'swap_to_easy', description: '' },
              { label: 'Keep as Planned', action: 'keep', description: '' },
            ]).map((opt, i) => (
              <YStack key={i}
                backgroundColor={opt.action === 'keep' ? '$surfaceLight' : i === 0 ? '$warning' : '$surfaceLight'}
                paddingVertical="$2" paddingHorizontal="$4" borderRadius="$4"
                pressStyle={{ opacity: 0.8 }}
                onPress={() => {
                  try {
                    const { getDatabase } = require('../../src/db/database');
                    const db = getDatabase();
                    const wId = proactiveSuggestion.workoutId;
                    if (opt.action === 'swap_to_easy') {
                      db.runSync(
                        `UPDATE workout SET workout_type = 'easy', target_pace_zone = 'E',
                         modification_reason = ?, status = 'modified' WHERE id = ? AND status = 'upcoming'`,
                        [`Swapped from ${proactiveSuggestion.workoutTitle} — cross-training impact`, wId]
                      );
                    } else if (opt.action === 'reduce_distance') {
                      db.runSync(
                        `UPDATE workout SET target_distance_miles = target_distance_miles * 0.75,
                         modification_reason = ?, status = 'modified' WHERE id = ? AND status = 'upcoming'`,
                        [`Reduced 25% from ${proactiveSuggestion.workoutTitle} — cross-training impact`, wId]
                      );
                    }
                    // 'keep' = no DB change
                  } catch {}
                  useAppStore.setState({ proactiveSuggestion: null });
                  try { const { setSetting } = require('../../src/db/database'); setSetting('pending_proactive_suggestion', ''); } catch {}
                  useAppStore.getState().refreshState();
                }}>
                <XStack alignItems="center" justifyContent="space-between">
                  <B color={opt.action === 'keep' ? '$textSecondary' : 'white'} fontSize={13} fontWeight="700">{opt.label}</B>
                  {opt.description ? <B color={opt.action === 'keep' ? '$textTertiary' : 'rgba(255,255,255,0.7)'} fontSize={11}>{opt.description}</B> : null}
                </XStack>
              </YStack>
            ))}
          </YStack>
        </YStack>
      )}

      {/* Race Countdown + Readiness */}
      <YStack marginBottom="$4">
        {/* Race countdown */}
        {userProfile?.race_name && daysUntilRace > 0 && (
          <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$3">
            <XStack alignItems="center" justifyContent="space-between">
              <YStack flex={1}>
                <M color={colors.cyan} fontSize={32} fontWeight="800">{daysUntilRace}</M>
                <B color="$textSecondary" fontSize={12}>days to {userProfile.race_name}</B>
              </YStack>
              <YStack alignItems="flex-end">
                <H color="$color" fontSize={14} letterSpacing={1} textTransform="uppercase">
                  Week {currentWeekNumber}/{totalWeeks}
                </H>
                <H color={colors.cyan} fontSize={11} letterSpacing={1} textTransform="uppercase" marginTop={2}>
                  {currentPhase} phase
                </H>
              </YStack>
            </XStack>
            {/* Readiness indicator */}
            {(() => {
              // Calculate readiness from recent weeks
              const recentWeeks = weeks.slice(Math.max(0, weeks.findIndex(w => w.week_number === currentWeekNumber) - 2));
              const pastWorkouts = workouts.filter(w => w.workout_type !== 'rest' && (w.status === 'completed' || w.status === 'skipped' || w.status === 'partial'));
              const completedCount = pastWorkouts.filter(w => w.status === 'completed' || w.status === 'partial').length;
              const adherence = pastWorkouts.length > 0 ? completedCount / pastWorkouts.length : 1;

              const volumeOnTrack = recentWeeks.length > 0 && recentWeeks.every(w => w.actual_volume >= w.target_volume * 0.7);

              let readiness: 'on_track' | 'attention' | 'behind';
              let label: string;
              let readinessColor: string;

              if (adherence >= 0.8 && volumeOnTrack) {
                readiness = 'on_track';
                label = 'You\'re on track';
                readinessColor = colors.cyan;
              } else if (adherence >= 0.6) {
                readiness = 'attention';
                label = 'Needs attention';
                readinessColor = colors.orange;
              } else {
                readiness = 'behind';
                label = 'You\'re behind';
                readinessColor = colors.error;
              }

              return (
                <XStack marginTop="$3" paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border" alignItems="center" gap="$2">
                  <View width={10} height={10} borderRadius={5} backgroundColor={readinessColor} />
                  <B color={readinessColor} fontSize={13} fontWeight="600">{label}</B>
                  <B color="$textTertiary" fontSize={11}> · {Math.round(adherence * 100)}% adherence</B>
                </XStack>
              );
            })()}
            {/* Streak tracker */}
            {(() => {
              // Count consecutive weeks with 80%+ workout completion (most recent first)
              let streak = 0;
              const sortedWeeks = [...weeks].sort((a, b) => b.week_number - a.week_number);
              for (const w of sortedWeeks) {
                if (w.week_number > currentWeekNumber) continue; // skip future
                if (w.week_number === currentWeekNumber) continue; // skip current (incomplete)
                const weekWO = workouts.filter(wo => wo.week_number === w.week_number && wo.workout_type !== 'rest');
                if (weekWO.length === 0) break;
                const completed = weekWO.filter(wo => wo.status === 'completed' || wo.status === 'partial').length;
                if (completed / weekWO.length >= 0.8) {
                  streak++;
                } else {
                  break;
                }
              }
              if (streak < 2) return null;
              return (
                <XStack marginTop="$2" alignItems="center" gap="$2">
                  <MaterialCommunityIcons name="fire" size={14} color={streak >= 8 ? colors.orange : colors.cyan} />
                  <M color={streak >= 8 ? colors.orange : colors.cyan} fontSize={13} fontWeight="700">{streak}</M>
                  <B color="$textTertiary" fontSize={11}>week streak of consistent training</B>
                </XStack>
              );
            })()}
          </YStack>
        )}

        {/* Cumulative Mileage */}
        {weeks.length >= 3 && (
          <YStack backgroundColor="$surface" borderRadius="$6" padding="$4">
            {(() => {
              const totalPlanned = weeks.reduce((s, w) => s + w.target_volume, 0);
              const totalActual = weeks.reduce((s, w) => s + w.actual_volume, 0);
              const pct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;

              // Build cumulative data points
              const cumPlanned: number[] = [];
              const cumActual: number[] = [];
              let runPlanned = 0, runActual = 0;
              for (const w of weeks) {
                runPlanned += w.target_volume;
                runActual += w.actual_volume;
                cumPlanned.push(runPlanned);
                cumActual.push(runActual);
              }

              const maxVal = Math.max(totalPlanned, totalActual, 1);
              const chartW = 280; // approximate, will flex
              const chartH = 60;
              const toX = (i: number) => (i / Math.max(weeks.length - 1, 1)) * chartW;
              const toY = (v: number) => chartH - (v / maxVal) * chartH;

              // Build SVG path for planned (dashed reference line)
              let plannedPath = `M 0 ${toY(cumPlanned[0])}`;
              for (let i = 1; i < cumPlanned.length; i++) {
                plannedPath += ` L ${toX(i)} ${toY(cumPlanned[i])}`;
              }

              // Build SVG path for actual (filled area)
              let actualPath = `M 0 ${toY(cumActual[0])}`;
              for (let i = 1; i < cumActual.length; i++) {
                actualPath += ` L ${toX(i)} ${toY(cumActual[i])}`;
              }
              const actualFill = `${actualPath} L ${toX(cumActual.length - 1)} ${chartH} L 0 ${chartH} Z`;

              return (
                <YStack>
                  <XStack justifyContent="space-between" alignItems="baseline" marginBottom="$3">
                    <YStack>
                      <M color="$color" fontSize={20} fontWeight="800">{Math.round(totalActual)} mi</M>
                      <B color="$textTertiary" fontSize={11}>of {Math.round(totalPlanned)} mi planned</B>
                    </YStack>
                    <M color={pct >= 90 ? colors.cyan : pct >= 70 ? '$color' : colors.orange} fontSize={14} fontWeight="700">{pct}%</M>
                  </XStack>
                  <View style={{ height: chartH }}>
                    {(() => {
                      try {
                        const Svg = require('react-native-svg').default;
                        const { Path: SvgPath, Defs, LinearGradient: SvgGrad, Stop } = require('react-native-svg');
                        return (
                          <Svg width="100%" height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
                            <Defs>
                              <SvgGrad id="cumFill" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0" stopColor={colors.cyan} stopOpacity="0.3" />
                                <Stop offset="1" stopColor={colors.cyan} stopOpacity="0.05" />
                              </SvgGrad>
                            </Defs>
                            <SvgPath d={actualFill} fill="url(#cumFill)" />
                            <SvgPath d={actualPath} fill="none" stroke={colors.cyan} strokeWidth={2} />
                            <SvgPath d={plannedPath} fill="none" stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="4,4" />
                          </Svg>
                        );
                      } catch { return null; }
                    })()}
                  </View>
                  <XStack justifyContent="space-between" marginTop={4}>
                    <B color="$textTertiary" fontSize={10}>Week 1</B>
                    <B color="$textTertiary" fontSize={10}>Week {weeks.length}</B>
                  </XStack>
                </YStack>
              );
            })()}
          </YStack>
        )}

        {/* Fallback header when no race name */}
        {(!userProfile?.race_name || daysUntilRace <= 0) && (
          <YStack marginBottom="$2">
            <H color="$color" fontSize={24} letterSpacing={1} textTransform="uppercase">
              Week {currentWeekNumber} of {totalWeeks} — {currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1)} Phase
            </H>
            {daysUntilRace === 0 && <M color={colors.orange} fontSize={18} fontWeight="800" marginTop="$1">Race Day!</M>}
            {daysUntilRace < 0 && <B color="$textSecondary" fontSize={14} marginTop="$1">Post-race</B>}
          </YStack>
        )}
      </YStack>

      {/* Recovery Badge */}
      {recoveryStatus && recoveryStatus.level !== 'unknown' && recoveryStatus.signalCount >= 2 && (
        <RecoveryBadge recovery={recoveryStatus} />
      )}

      {/* Taper Experience (last 21 days before race) */}
      {daysUntilRace <= 21 && daysUntilRace > 0 && currentPhase === 'taper' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3}
          borderLeftColor={daysUntilRace <= 7 ? colors.orange : colors.cyan}>
          <H color={daysUntilRace <= 7 ? colors.orange : colors.cyan} fontSize={13} letterSpacing={1.5} textTransform="uppercase" marginBottom="$3">
            {daysUntilRace <= 7 ? 'Race Week' : daysUntilRace <= 14 ? 'Taper — 2 Weeks Out' : 'Taper — 3 Weeks Out'}
          </H>

          {/* Daily taper tip */}
          <B color="$color" fontSize={14} lineHeight={21} marginBottom="$3">
            {daysUntilRace <= 1 ? "Tomorrow is race day. Trust your training. You're ready."
            : daysUntilRace <= 3 ? "Don't try anything new — no new shoes, food, or gear on race day. Stick to what you've trained with."
            : daysUntilRace <= 5 ? "Volume is low this week and that's by design. Feeling restless is normal — it means you're rested."
            : daysUntilRace <= 7 ? "This week is about freshness, not fitness. Short easy runs, lots of sleep, and trust the process."
            : daysUntilRace <= 10 ? "Your body is absorbing weeks of training. Sleep 8+ hours, eat clean, minimize stress."
            : daysUntilRace <= 14 ? "Volume drops but intensity stays. One short quality session keeps the engine sharp without adding fatigue."
            : "Taper has begun. Mileage is coming down — this feels weird but it's working. Your race fitness is building."}
          </B>

          {/* Gear checklist — show in race week */}
          {daysUntilRace <= 7 && (
            <YStack backgroundColor="$surfaceLight" borderRadius="$4" padding="$3" marginBottom="$3">
              <H color="$textSecondary" fontSize={11} letterSpacing={1} textTransform="uppercase" marginBottom="$2">Race Day Kit</H>
              {[
                { item: 'Race shoes (broken in)', icon: 'shoe-sneaker' },
                { item: 'Bib + safety pins', icon: 'card-account-details' },
                { item: 'Gels / nutrition', icon: 'food-apple' },
                { item: 'Body glide / anti-chafe', icon: 'shield-check' },
                { item: 'Watch (charged)', icon: 'watch' },
                { item: 'Weather-appropriate gear', icon: 'weather-partly-cloudy' },
              ].map(({ item, icon }, i) => (
                <XStack key={i} alignItems="center" gap="$2" paddingVertical={4}>
                  <MaterialCommunityIcons name={icon as any} size={14} color={colors.textTertiary} />
                  <B color="$textSecondary" fontSize={13}>{item}</B>
                </XStack>
              ))}
            </YStack>
          )}

          {/* Race morning timeline — show 2 days before */}
          {daysUntilRace <= 2 && daysUntilRace >= 1 && (
            <YStack backgroundColor="$surfaceLight" borderRadius="$4" padding="$3" marginBottom="$3">
              <H color="$textSecondary" fontSize={11} letterSpacing={1} textTransform="uppercase" marginBottom="$2">Race Morning Timeline</H>
              {[
                { time: '3 hrs before start', task: 'Wake up, light movement' },
                { time: '2.5 hrs before', task: 'Eat breakfast (what you practiced)' },
                { time: '1.5 hrs before', task: 'Begin hydrating (16 oz water/sports drink)' },
                { time: '1 hr before', task: 'Arrive at venue, pick up bib if needed' },
                { time: '30 min before', task: 'Warm-up jog, dynamic stretches' },
                { time: '10 min before', task: 'Line up, take a gel, deep breaths' },
              ].map(({ time, task }, i) => (
                <XStack key={i} paddingVertical={4} gap="$3">
                  <M color={colors.cyan} fontSize={11} fontWeight="600" width={90}>{time}</M>
                  <B color="$textSecondary" fontSize={12} flex={1}>{task}</B>
                </XStack>
              ))}
            </YStack>
          )}

          {/* Race strategy (AI-generated) */}
          {isRaceWeek && raceStrategy && (
            <YStack marginTop="$1">
              <H color="$textSecondary" fontSize={11} letterSpacing={1} textTransform="uppercase" marginBottom="$2">Pacing Strategy</H>
              <B color="$textSecondary" fontSize={14} lineHeight={21}>{raceStrategy}</B>
            </YStack>
          )}
        </YStack>
      )}

      {/* Race Week Strategy (fallback for non-taper detection) */}
      {isRaceWeek && raceStrategy && currentPhase !== 'taper' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3} borderLeftColor="$warning">
          <H color="$warning" fontSize={14} textTransform="uppercase" letterSpacing={1.5} marginBottom="$3">Race Week Strategy</H>
          <B color="$textSecondary" fontSize={14} lineHeight={21}>{raceStrategy}</B>
        </YStack>
      )}

      {/* Briefing */}
      {!isRestDay && preWorkoutBriefing && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3} borderLeftColor="$accent">
          <XStack alignItems="center" marginBottom="$3">
            <View width={8} height={8} borderRadius={4} backgroundColor="$accent" marginRight="$2" />
            <H color="$accent" fontSize={14} textTransform="uppercase" letterSpacing={1.5}>Coach Briefing</H>
          </XStack>
          <B color="$textSecondary" fontSize={14} lineHeight={21}>{preWorkoutBriefing}</B>
        </YStack>
      )}

      {/* Rest Day */}
      {isRestDay && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$6" alignItems="center" marginBottom="$4">
          <B fontSize={40} marginBottom="$3">😴</B>
          <H color="$color" fontSize={28} letterSpacing={1} marginBottom="$1">Rest Day</H>
          <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20}>
            Recovery is where the gains happen. Take it easy today.
          </B>
          {tomorrowWorkout && (
            <YStack marginTop="$5" paddingTop="$4" borderTopWidth={1} borderTopColor="$border" width="100%">
              <H color="$textTertiary" fontSize={13} textTransform="uppercase" letterSpacing={1.5} marginBottom="$1">Tomorrow</H>
              <B color="$color" fontSize={16} fontWeight="600">{tomorrowWorkout.title}</B>
              <M color="$textSecondary" fontSize={13} marginTop={2}>
                {WORKOUT_TYPE_LABELS[tomorrowWorkout.workout_type] ?? tomorrowWorkout.workout_type}
                {tomorrowWorkout.target_distance_miles ? ` · ${tomorrowWorkout.target_distance_miles.toFixed(1)} mi` : ''}
              </M>
            </YStack>
          )}
        </YStack>
      )}

      {/* Today's Workout */}
      {!isRestDay && todaysWorkout && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$5" marginBottom="$4" borderWidth={1} borderColor="$border">
          <B color="$textTertiary" fontSize={12} fontWeight="600" textTransform="uppercase" letterSpacing={0.5} marginBottom="$1">
            {formatDateLong(todaysWorkout.scheduled_date)}
          </B>
          <H color="$color" fontSize={26} letterSpacing={0.8} marginBottom="$3">{todaysWorkout.title}</H>

          {/* Meta row */}
          <XStack alignItems="center" marginBottom="$3" gap="$3">
            <XStack alignItems="center" backgroundColor="$surfaceLight" paddingHorizontal="$3" paddingVertical="$1" borderRadius="$2">
              <MaterialCommunityIcons name={getWorkoutIcon(todaysWorkout.workout_type) as any} size={14} color={colors.cyan} style={{ marginRight: 4 }} />
              <H color="$accent" fontSize={12} letterSpacing={1}>
                {WORKOUT_TYPE_LABELS[todaysWorkout.workout_type] ?? todaysWorkout.workout_type}
              </H>
            </XStack>
            {todaysWorkout.target_distance_miles != null && (
              <XStack alignItems="center" gap="$1">
                <MaterialCommunityIcons name="map-marker-distance" size={16} color={colors.textPrimary} />
                <M color="$color" fontSize={20} fontWeight="700">{todaysWorkout.target_distance_miles.toFixed(1)} mi</M>
              </XStack>
            )}
          </XStack>

          {/* Description */}
          {todaysWorkout.description ? (
            <B color="$textSecondary" fontSize={14} lineHeight={21} marginBottom="$3">{todaysWorkout.description}</B>
          ) : null}

          {/* Pace Zone */}
          {todaysWorkout.target_pace_zone && paceZones && (
            <XStack justifyContent="space-between" alignItems="center" backgroundColor="$surfaceLight" borderRadius="$4" padding="$3" marginBottom="$3">
              <B color="$textSecondary" fontSize={13} fontWeight="600">Target Zone: {todaysWorkout.target_pace_zone}</B>
              <M color="$accent" fontSize={16} fontWeight="700">
                {formatPace(paceZones[todaysWorkout.target_pace_zone as keyof typeof paceZones]?.min ?? 0)}
                {' - '}
                {formatPace(paceZones[todaysWorkout.target_pace_zone as keyof typeof paceZones]?.max ?? 0)}
                {' /mi'}
              </M>
            </XStack>
          )}

          {/* Intervals */}
          {intervals && intervals.length > 0 && (
            <YStack marginBottom="$3" paddingTop="$3" borderTopWidth={1} borderTopColor="$border">
              <H color="$textTertiary" fontSize={13} textTransform="uppercase" letterSpacing={1.5} marginBottom="$3">
                Workout Structure
              </H>
              {intervals.map((step, idx) => (
                <XStack key={idx} alignItems="flex-start" marginBottom="$2">
                  <View
                    width={10} height={10} borderRadius={5} marginTop={4} marginRight="$3"
                    backgroundColor={step.type === 'work' ? '$accent' : step.type === 'recovery' ? '$success' : '$textTertiary'}
                  />
                  <YStack flex={1}>
                    <B color="$color" fontSize={14} fontWeight="500">{step.description}</B>
                    <M color="$textTertiary" fontSize={12} marginTop={2}>
                      {step.distance_miles.toFixed(2)} mi @ {step.pace_zone} zone
                      {paceZones && paceZones[step.pace_zone as keyof typeof paceZones]
                        ? ` (${formatPace(paceZones[step.pace_zone as keyof typeof paceZones].min)}-${formatPace(paceZones[step.pace_zone as keyof typeof paceZones].max)}/mi)`
                        : ''}
                    </M>
                  </YStack>
                </XStack>
              ))}
            </YStack>
          )}

          {/* Modification */}
          {todaysWorkout.status === 'modified' && todaysWorkout.modification_reason && (
            <YStack backgroundColor="$surfaceLight" borderRadius="$3" padding="$3" marginBottom="$3" borderLeftWidth={2} borderLeftColor="$warning">
              <B color="$warning" fontSize={13} fontStyle="italic">Modified: {todaysWorkout.modification_reason}</B>
            </YStack>
          )}

          {/* Action Buttons */}
          {todaysWorkout.status === 'upcoming' && (
            <XStack gap="$3" marginTop="$1">
              <YStack flex={1} backgroundColor="$success" paddingVertical="$3" borderRadius="$5" alignItems="center"
                pressStyle={{ opacity: 0.8 }} onPress={handleComplete}>
                <B color="white" fontSize={16} fontWeight="700">Mark Complete</B>
              </YStack>
              <YStack flex={1} backgroundColor="$surfaceLight" paddingVertical="$3" borderRadius="$5" alignItems="center"
                pressStyle={{ opacity: 0.8 }} onPress={handleSkip}>
                <B color="$textSecondary" fontSize={16} fontWeight="600">Mark Skipped</B>
              </YStack>
            </XStack>
          )}

          {/* Status badges */}
          {todaysWorkout.status === 'completed' && (
            <YStack backgroundColor="$successMuted" paddingVertical="$3" borderRadius="$4" alignItems="center" marginTop="$1">
              <B color="$color" fontSize={14} fontWeight="600">Completed</B>
            </YStack>
          )}

          {/* Actual run data from Strava */}
          {todaysWorkout.status === 'completed' && todaysMetric && (
            <YStack marginTop="$3" paddingTop="$3" borderTopWidth={1} borderTopColor="$border">
              <H color={colors.cyan} fontSize={11} textTransform="uppercase" letterSpacing={1.5} marginBottom="$2">Actual Performance</H>
              <XStack gap="$4" flexWrap="wrap">
                <YStack>
                  <M color="$color" fontSize={18} fontWeight="800">{todaysMetric.distance_miles.toFixed(1)} mi</M>
                  <B color="$textTertiary" fontSize={10}>Distance</B>
                </YStack>
                {todaysMetric.avg_pace_sec_per_mile && (
                  <YStack>
                    <M color="$color" fontSize={18} fontWeight="800">{formatPace(todaysMetric.avg_pace_sec_per_mile)}</M>
                    <B color="$textTertiary" fontSize={10}>Avg Pace</B>
                  </YStack>
                )}
                {todaysMetric.duration_minutes && (
                  <YStack>
                    <M color="$color" fontSize={18} fontWeight="800">{Math.floor(todaysMetric.duration_minutes)}:{String(Math.round((todaysMetric.duration_minutes % 1) * 60)).padStart(2, '0')}</M>
                    <B color="$textTertiary" fontSize={10}>Duration</B>
                  </YStack>
                )}
                {todaysMetric.avg_hr && (
                  <YStack>
                    <M color={colors.orange} fontSize={18} fontWeight="800">{todaysMetric.avg_hr}</M>
                    <B color="$textTertiary" fontSize={10}>Avg HR</B>
                  </YStack>
                )}
              </XStack>
              {todaysWorkout.target_distance_miles && Math.abs(todaysMetric.distance_miles - todaysWorkout.target_distance_miles) > 0.2 && (
                <B color="$textTertiary" fontSize={11} marginTop="$2">
                  Target was {todaysWorkout.target_distance_miles.toFixed(1)} mi — ran {Math.round((todaysMetric.distance_miles / todaysWorkout.target_distance_miles) * 100)}% of target
                </B>
              )}
              {(todaysWorkout as any).execution_quality && (todaysWorkout as any).execution_quality !== 'on_target' && (
                <XStack marginTop="$2">
                  <B color={colors.orange} fontSize={10} fontWeight="700" backgroundColor={colors.orange + '22'} paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                    {(todaysWorkout as any).execution_quality === 'missed_pace' ? 'Pace ↓ — slower than target zone' : (todaysWorkout as any).execution_quality === 'exceeded_pace' ? 'Pace ↑ — faster than easy zone' : 'Modified workout'}
                  </B>
                </XStack>
              )}
            </YStack>
          )}
          {todaysWorkout.status === 'skipped' && (
            <YStack backgroundColor="$dangerMuted" paddingVertical="$3" borderRadius="$4" alignItems="center" marginTop="$1">
              <B color="$color" fontSize={14} fontWeight="600">Skipped</B>
            </YStack>
          )}
        </YStack>
      )}

      {/* Post-Run Analysis */}
      {postRunAnalysis && todaysWorkout?.status === 'completed' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3} borderLeftColor="$success">
          <XStack alignItems="center" marginBottom="$3">
            <View width={8} height={8} borderRadius={4} backgroundColor="$success" marginRight="$2" />
            <H color="$success" fontSize={14} textTransform="uppercase" letterSpacing={1.5}>Post-Run Analysis</H>
          </XStack>
          <B color="$textSecondary" fontSize={14} lineHeight={21}>{postRunAnalysis}</B>
        </YStack>
      )}
      {/* Cross-Training (hidden in race week) */}
      {isRaceWeek ? null : todayCrossTraining ? (
        <XStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$4" alignItems="center"
          pressStyle={{ opacity: 0.8 }} onPress={() => {
            const { Alert } = require('react-native');
            Alert.alert('Cross-Training', `${CROSS_TRAINING_LABELS[todayCrossTraining.type]}${todayCrossTraining.notes ? `\n${todayCrossTraining.notes}` : ''}`, [
              { text: 'Delete', style: 'destructive', onPress: () => deleteCrossTrainingEntry(todayCrossTraining.id) },
              { text: 'OK' },
            ]);
          }}>
          <View width={32} height={32} borderRadius={16} alignItems="center" justifyContent="center" marginRight="$3"
            backgroundColor={todayCrossTraining.impact === 'high' ? colors.error + '22' : todayCrossTraining.impact === 'moderate' ? colors.orange + '22' : todayCrossTraining.impact === 'positive' ? colors.cyan + '22' : colors.textTertiary + '22'}>
            <MaterialCommunityIcons name="dumbbell" size={16}
              color={todayCrossTraining.impact === 'high' ? colors.error : todayCrossTraining.impact === 'moderate' ? colors.orange : todayCrossTraining.impact === 'positive' ? colors.cyan : colors.textTertiary} />
          </View>
          <YStack flex={1}>
            <B color="$color" fontSize={13} fontWeight="600">{CROSS_TRAINING_LABELS[todayCrossTraining.type]}</B>
            <B color="$textTertiary" fontSize={11}>{todayCrossTraining.impact} impact · tap to manage</B>
          </YStack>
        </XStack>
      ) : (
        <XStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$4" alignItems="center"
          pressStyle={{ opacity: 0.8 }} onPress={() => setShowCTModal(true)}>
          <View width={32} height={32} borderRadius={16} backgroundColor="$surfaceLight" alignItems="center" justifyContent="center" marginRight="$3">
            <MaterialCommunityIcons name="dumbbell" size={16} color={colors.textSecondary} />
          </View>
          <B color="$textSecondary" fontSize={13} fontWeight="500">Log Cross-Training</B>
        </XStack>
      )}

      {/* Cross-Training Modal */}
      {showCTModal && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', zIndex: 100 }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            {/* Drag handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <XStack justifyContent="space-between" alignItems="center" marginBottom="$4">
              <H color="$color" fontSize={18} letterSpacing={1}>LOG CROSS-TRAINING</H>
              <B color="$textTertiary" fontSize={18} onPress={() => { setShowCTModal(false); setCTNotes(''); }}>✕</B>
            </XStack>

            {/* Options grid */}
            {([
              { type: 'leg_day' as CrossTrainingType, icon: 'weight-lifter', color: colors.error },
              { type: 'upper_body' as CrossTrainingType, icon: 'arm-flex', color: colors.textTertiary },
              { type: 'full_body' as CrossTrainingType, icon: 'dumbbell', color: colors.orange },
              { type: 'cycling' as CrossTrainingType, icon: 'bicycle', color: colors.orange },
              { type: 'swimming' as CrossTrainingType, icon: 'swim', color: colors.orange },
              { type: 'yoga_mobility' as CrossTrainingType, icon: 'meditation', color: colors.cyan },
              { type: 'other' as CrossTrainingType, icon: 'pencil', color: colors.textTertiary },
            ] as const).map(({ type, icon, color }) => (
              <XStack key={type} backgroundColor={colors.surfaceHover} borderRadius={12} padding="$3" marginBottom="$2" alignItems="center"
                pressStyle={{ opacity: 0.7, backgroundColor: colors.border }}
                onPress={() => {
                  logCrossTraining(type, ctNotes);
                  setShowCTModal(false);
                  setCTNotes('');
                }}>
                <View width={36} height={36} borderRadius={18} backgroundColor={color + '22'} alignItems="center" justifyContent="center" marginRight="$3">
                  <MaterialCommunityIcons name={icon as any} size={18} color={color} />
                </View>
                <YStack flex={1}>
                  <B color="$color" fontSize={14} fontWeight="600">{CROSS_TRAINING_LABELS[type]}</B>
                  <B color="$textTertiary" fontSize={11}>{CROSS_TRAINING_IMPACT[type]} impact</B>
                </YStack>
              </XStack>
            ))}
          </View>
        </View>
      )}

      {/* Modals */}
      <WeightCheckin
        visible={showWeightCheckin}
        currentWeight={userProfile?.weight_kg ?? null}
        onUpdate={handleWeightUpdate}
        onNoChange={handleWeightNoChange}
        onSkip={() => setShowWeightCheckin(false)}
      />
    </ScrollView>
  );
}
