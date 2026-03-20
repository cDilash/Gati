import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { RefreshControl, TextInput, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
import { GradientBorder } from '../../src/theme/GradientBorder';
import { formatPRTime } from '../../src/utils/personalRecords';

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
  const currentWeek = useAppStore(s => s.currentWeek);

  const isSyncing = useAppStore(s => s.isSyncing);
  const vdotNotification = useAppStore(s => s.vdotNotification);
  const proactiveSuggestion = useAppStore(s => s.proactiveSuggestion);
  const todayCrossTraining = useAppStore(s => s.todayCrossTraining);
  const logCrossTraining = useAppStore(s => s.logCrossTraining);
  const isStravaConnected = useAppStore(s => s.isStravaConnected);
  const deleteCrossTrainingEntry = useAppStore(s => s.deleteCrossTrainingEntry);
  const newPRNotification = useAppStore(s => s.newPRNotification);
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

  // Fetch rest day briefing when on a rest day
  useEffect(() => {
    if (!activePlan || !todaysWorkout || todaysWorkout.workout_type !== 'rest') return;
    (async () => {
      try {
        const { generateRestDayBriefing } = require('../../src/ai/briefing');
        const today = getToday();
        const yesterday = new Date(today + 'T00:00:00');
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const yWorkouts = workouts.filter((w: any) => w.scheduled_date === yStr);
        const { getMetricsForDateRange } = require('../../src/db/database');
        const yMetrics = getMetricsForDateRange(yStr, yStr);

        const recoveryInfo = recoveryStatus
          ? `Recovery score: ${recoveryStatus.score}/100 (${recoveryStatus.level})`
          : null;

        const result = await generateRestDayBriefing(
          yWorkouts, yMetrics, paceZones,
          userProfile, currentWeek, recoveryInfo,
        );
        if (result) setRestDayBriefing(result);
      } catch (e) {
        console.warn('[RestDay] Briefing failed:', e);
      }
    })();
  }, [activePlan?.id, todaysWorkout?.id]);

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

  // ─── Manual run entry (fallback when no Strava) ─────────
  const [showManualRun, setShowManualRun] = useState(false);
  const [manualDist, setManualDist] = useState('');
  const [manualDur, setManualDur] = useState('');

  // ─── Rest day briefing ─────────────────────────────────
  const [restDayBriefing, setRestDayBriefing] = useState<{ whyResting: string; tips: { emoji: string; title: string; detail: string }[] } | null>(null);

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
        <View width={64} height={64} borderRadius={32} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom="$4">
          <MaterialCommunityIcons name="run-fast" size={36} color={colors.cyan} />
        </View>
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

  // ─── Computed values for sticky header ──────────────────
  const readiness = useMemo(() => {
    const today = getToday();
    const pastDueWorkouts = workouts.filter(w =>
      w.workout_type !== 'rest' && w.scheduled_date <= today &&
      (w.status === 'completed' || w.status === 'skipped' || w.status === 'partial')
    );
    const completedCount = pastDueWorkouts.filter(w => w.status === 'completed' || w.status === 'partial').length;
    const adherence = pastDueWorkouts.length > 0 ? completedCount / pastDueWorkouts.length : 1;

    let label: string;
    let color: string;
    if (currentWeekNumber <= 1 && pastDueWorkouts.length < 3) {
      label = 'Just getting started'; color = colors.cyan;
    } else if (adherence >= 1.0 && pastDueWorkouts.length >= 10) {
      label = 'Crushing it'; color = colors.cyan;
    } else if (adherence >= 0.8) {
      label = 'On track'; color = colors.cyan;
    } else if (adherence >= 0.6) {
      label = 'Catching up'; color = colors.orange;
    } else {
      label = 'You\'re behind'; color = colors.error;
    }
    return { label, color, adherence, count: pastDueWorkouts.length };
  }, [workouts, currentWeekNumber]);

  const streak = useMemo(() => {
    let count = 0;
    const sortedWeeks = [...weeks].sort((a, b) => b.week_number - a.week_number);
    for (const w of sortedWeeks) {
      if (w.week_number > currentWeekNumber) continue;
      if (w.week_number === currentWeekNumber) continue;
      const weekWO = workouts.filter(wo => wo.week_number === w.week_number && wo.workout_type !== 'rest');
      if (weekWO.length === 0) break;
      const completed = weekWO.filter(wo => wo.status === 'completed' || wo.status === 'partial').length;
      if (completed / weekWO.length >= 0.8) { count++; } else { break; }
    }
    return count;
  }, [weeks, workouts, currentWeekNumber]);

  const weekProgress = useMemo(() => {
    if (!currentWeek) return null;
    const weekVol = currentWeek.actual_volume;
    const weekTarget = currentWeek.target_volume;
    const pct = weekTarget > 0 ? Math.round((weekVol / weekTarget) * 100) : 0;
    const weekRuns = workouts.filter(w => w.week_number === currentWeek.week_number && w.workout_type !== 'rest');
    const completedRuns = weekRuns.filter(w => w.status === 'completed' || w.status === 'partial').length;
    return { weekVol, weekTarget, pct, completedRuns, totalRuns: weekRuns.length };
  }, [currentWeek, workouts]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ═══ STICKY HEADER ═══ */}
      <View style={stickyStyles.header}>
        {/* Race countdown + week/phase */}
        {daysUntilRace === 0 ? (
          <XStack alignItems="center" justifyContent="center" paddingVertical={2}>
            <M color={colors.orange} fontSize={15} fontWeight="800">RACE DAY</M>
            {userProfile?.race_name && <B color="$textTertiary" fontSize={12}> · {userProfile.race_name}</B>}
          </XStack>
        ) : userProfile?.race_name && daysUntilRace > 0 ? (
          <XStack alignItems="center" justifyContent="space-between">
            <XStack alignItems="center" gap={6}>
              <M color={colors.cyan} fontSize={14} fontWeight="800">{daysUntilRace}d</M>
              <B color="$textTertiary" fontSize={12}>to {userProfile.race_name}</B>
            </XStack>
            <B color="$textTertiary" fontSize={12}>W{currentWeekNumber}/{totalWeeks} · {currentPhase}</B>
          </XStack>
        ) : (
          <XStack alignItems="center" justifyContent="space-between">
            <B color="$textTertiary" fontSize={12}>Week {currentWeekNumber}/{totalWeeks} · {currentPhase}</B>
          </XStack>
        )}

        {/* Readiness + streak (inline) */}
        <XStack alignItems="center" gap={6} marginTop={4}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: readiness.color }} />
          <B color={readiness.color} fontSize={12} fontWeight="600">{readiness.label}</B>
          {readiness.count >= 3 && (
            <B color="$textTertiary" fontSize={11}> · {Math.round(readiness.adherence * 100)}%</B>
          )}
          {streak >= 2 && (
            <XStack alignItems="center" gap={3} marginLeft={4}>
              <MaterialCommunityIcons name="fire" size={12} color={streak >= 8 ? colors.orange : colors.cyan} />
              <M color={streak >= 8 ? colors.orange : colors.cyan} fontSize={11} fontWeight="700">{streak}w</M>
            </XStack>
          )}
        </XStack>

        {/* Weekly progress bar */}
        {weekProgress && (
          <YStack marginTop={6}>
            <XStack justifyContent="space-between" alignItems="center" marginBottom={3}>
              <B color="$textTertiary" fontSize={11}>
                {weekProgress.completedRuns}/{weekProgress.totalRuns} runs · {weekProgress.weekVol.toFixed(1)} of {weekProgress.weekTarget.toFixed(0)} mi
              </B>
              <M color={weekProgress.pct >= 80 ? colors.cyan : weekProgress.pct >= 50 ? colors.textSecondary : colors.orange}
                fontSize={11} fontWeight="700">{weekProgress.pct}%</M>
            </XStack>
            <View style={stickyStyles.progressTrack}>
              <View style={[stickyStyles.progressFill, {
                width: `${Math.min(weekProgress.pct, 100)}%` as any,
                backgroundColor: weekProgress.pct >= 80 ? colors.cyan : weekProgress.pct >= 50 ? colors.textSecondary : colors.orange,
              }]} />
            </View>
          </YStack>
        )}

        {/* Sync indicator in header */}
        {isSyncing && (
          <XStack alignItems="center" justifyContent="center" gap={4} marginTop={4}>
            <Spinner size="small" color="$textTertiary" />
            <B color="$textTertiary" fontSize={10}>Syncing...</B>
          </XStack>
        )}
        {!isSyncing && showSyncDone && (
          <XStack alignItems="center" justifyContent="center" gap={4} marginTop={4}>
            <MaterialCommunityIcons name="check-circle-outline" size={12} color={colors.cyan} />
            <B color="$textTertiary" fontSize={10}>Updated</B>
          </XStack>
        )}
      </View>

      {/* Shadow edge */}
      <LinearGradient
        colors={['rgba(10,10,15,0.4)', 'rgba(10,10,15,0)']}
        style={stickyStyles.shadow}
      />

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <ScrollView
        flex={1} backgroundColor="$background"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={onRefresh} tintColor={colors.cyan} />}
      >
      {/* PR Celebration */}
      {newPRNotification && newPRNotification.prs.length > 0 && (
        <YStack marginBottom="$4">
          <GradientBorder side="all" borderRadius={16} borderWidth={2}>
            <YStack backgroundColor="$surface" borderRadius={16} padding={16}>
              <XStack alignItems="center" justifyContent="space-between" marginBottom={8}>
                <XStack alignItems="center" gap={8}>
                  <MaterialCommunityIcons name="trophy" size={22} color={colors.cyan} />
                  <H color={colors.cyan} fontSize={15} letterSpacing={1.5}>NEW PERSONAL RECORD!</H>
                </XStack>
                <B color="$textTertiary" fontSize={16} onPress={() => {
                  useAppStore.setState({ newPRNotification: null });
                  try { const { setSetting } = require('../../src/db/database');
                    setSetting('dismissed_pr_notification_date', newPRNotification.activityDate);
                    setSetting('pending_pr_notification', '');
                  } catch {}
                }}>✕</B>
              </XStack>
              {newPRNotification.prs.map((pr, i) => (
                <YStack key={i} marginBottom={i < newPRNotification.prs.length - 1 ? 8 : 0}>
                  <XStack alignItems="baseline" gap={6}>
                    <B color="$textSecondary" fontSize={13}>{pr.distance}:</B>
                    <M color={colors.cyan} fontSize={20} fontWeight="800">{formatPRTime(pr.time)}</M>
                  </XStack>
                  {pr.previousTime ? (
                    <B color="$textTertiary" fontSize={11} marginTop={2}>
                      Previous: {formatPRTime(pr.previousTime)}{pr.previousDate ? ` (${new Date(pr.previousDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}
                    </B>
                  ) : (
                    <B color={colors.cyan} fontSize={11} marginTop={2}>First recorded {pr.distance}!</B>
                  )}
                </YStack>
              ))}
            </YStack>
          </GradientBorder>
        </YStack>
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
            {(proactiveSuggestion.ctSuggestion?.options ?? (
              proactiveSuggestion.action === 'reduce_workout'
                ? [
                    { label: 'Reduce 25%', action: 'reduce_distance', description: '' },
                    { label: 'Add Rest Day', action: 'add_rest_day', description: '' },
                    { label: 'Noted, Keep Plan', action: 'keep', description: '' },
                  ]
                : [
                    { label: 'Swap to Easy', action: 'swap_to_easy', description: '' },
                    { label: 'Keep as Planned', action: 'keep', description: '' },
                  ]
            )).map((opt, i) => (
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
                        [`Reduced 25% — ${proactiveSuggestion.action === 'reduce_workout' ? 'ACWR elevated' : 'cross-training impact'}`, wId]
                      );
                    } else if (opt.action === 'add_rest_day') {
                      db.runSync(
                        `UPDATE workout SET workout_type = 'rest', target_distance_miles = 0,
                         target_pace_zone = NULL, modification_reason = 'Converted to rest — ACWR elevated',
                         status = 'modified' WHERE id = ? AND status = 'upcoming'`,
                        [wId]
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

      {/* === THE HERO: Workout card FIRST === */}
      {/* Today's Workout */}
      {!isRestDay && todaysWorkout && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$5" marginBottom="$4"
          borderWidth={1} borderColor={todaysWorkout.status === 'completed' ? colors.cyanDim : todaysWorkout.status === 'skipped' ? colors.orangeDim : todaysWorkout.status === 'partial' ? colors.orangeDim : '$border'}
          borderLeftWidth={todaysWorkout.status === 'completed' ? 3 : todaysWorkout.status === 'skipped' || todaysWorkout.status === 'partial' ? 3 : 1}
          borderLeftColor={todaysWorkout.status === 'completed' ? colors.cyan : todaysWorkout.status === 'skipped' ? colors.orange : todaysWorkout.status === 'partial' ? colors.orange : '$border'}>

          {/* ─── COMPLETED LAYOUT ─── */}
          {todaysWorkout.status === 'completed' && todaysMetric ? (
            <YStack>
              {/* Header: title + completed pill */}
              <XStack alignItems="center" justifyContent="space-between" marginBottom="$3">
                <YStack flex={1}>
                  <B color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={0.5} marginBottom={2}>
                    {formatDateLong(todaysWorkout.scheduled_date)}
                  </B>
                  <H color="$color" fontSize={22} letterSpacing={0.8}>{todaysWorkout.title}</H>
                </YStack>
                <XStack alignItems="center" gap={4} backgroundColor={colors.success + '22'} paddingHorizontal={10} paddingVertical={4} borderRadius={12}>
                  <MaterialCommunityIcons name="check-circle" size={14} color={colors.success} />
                  <B color={colors.success} fontSize={12} fontWeight="700">Completed</B>
                </XStack>
              </XStack>

              {/* HERO: Actual performance stats */}
              <XStack gap={16} flexWrap="wrap" marginBottom={12}>
                <YStack>
                  <XStack alignItems="center" gap={4}>
                    <MaterialCommunityIcons name="map-marker-distance" size={14} color={colors.cyan} />
                    <M color="$color" fontSize={20} fontWeight="800">{todaysMetric.distance_miles.toFixed(1)} mi</M>
                  </XStack>
                  <B color="$textTertiary" fontSize={10} marginLeft={18}>Distance</B>
                </YStack>
                {todaysMetric.avg_pace_sec_per_mile ? (
                  <YStack>
                    <XStack alignItems="center" gap={4}>
                      <MaterialCommunityIcons name="speedometer" size={14} color={colors.cyan} />
                      <M color="$color" fontSize={20} fontWeight="800">{formatPace(todaysMetric.avg_pace_sec_per_mile)}</M>
                    </XStack>
                    <B color="$textTertiary" fontSize={10} marginLeft={18}>Avg Pace</B>
                  </YStack>
                ) : null}
                {todaysMetric.duration_minutes ? (
                  <YStack>
                    <XStack alignItems="center" gap={4}>
                      <MaterialCommunityIcons name="timer-outline" size={14} color={colors.cyan} />
                      <M color="$color" fontSize={20} fontWeight="800">{Math.floor(todaysMetric.duration_minutes)}:{String(Math.round((todaysMetric.duration_minutes % 1) * 60)).padStart(2, '0')}</M>
                    </XStack>
                    <B color="$textTertiary" fontSize={10} marginLeft={18}>Duration</B>
                  </YStack>
                ) : null}
                {todaysMetric.avg_hr ? (
                  <YStack>
                    <XStack alignItems="center" gap={4}>
                      <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.orange} />
                      <M color={colors.orange} fontSize={20} fontWeight="800">{Math.round(todaysMetric.avg_hr)}</M>
                    </XStack>
                    <B color="$textTertiary" fontSize={10} marginLeft={18}>Avg HR</B>
                  </YStack>
                ) : null}
              </XStack>

              {/* Execution quality badge */}
              {(todaysWorkout as any).execution_quality && (todaysWorkout as any).execution_quality !== 'on_target' && (
                <XStack marginBottom={8}>
                  <B color={colors.orange} fontSize={10} fontWeight="700" backgroundColor={colors.orange + '22'} paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                    {(todaysWorkout as any).execution_quality === 'missed_pace' ? 'Pace ↓ — slower than target zone' : (todaysWorkout as any).execution_quality === 'exceeded_pace' ? 'Pace ↑ — faster than easy zone' : 'Modified workout'}
                  </B>
                </XStack>
              )}

              {/* VS PLANNED: compact reference */}
              {todaysWorkout.target_distance_miles != null && (
                <YStack paddingTop={10} borderTopWidth={0.5} borderTopColor="$border">
                  <XStack alignItems="center" gap={8} flexWrap="wrap">
                    <B color="$textTertiary" fontSize={11}>Planned:</B>
                    <M color="$textTertiary" fontSize={12} fontWeight="600">{todaysWorkout.target_distance_miles.toFixed(1)} mi</M>
                    {todaysWorkout.target_pace_zone && paceZones && (
                      <M color="$textTertiary" fontSize={12}>
                        @ {todaysWorkout.target_pace_zone} ({formatPace(paceZones[todaysWorkout.target_pace_zone as keyof typeof paceZones]?.min ?? 0)}-{formatPace(paceZones[todaysWorkout.target_pace_zone as keyof typeof paceZones]?.max ?? 0)})
                      </M>
                    )}
                    {Math.abs(todaysMetric.distance_miles - todaysWorkout.target_distance_miles) <= 0.3 ? (
                      <B color={colors.cyan} fontSize={10} fontWeight="700">on target</B>
                    ) : (
                      <B color={colors.orange} fontSize={10} fontWeight="700">
                        {todaysMetric.distance_miles > todaysWorkout.target_distance_miles ? '+' : ''}{((todaysMetric.distance_miles / todaysWorkout.target_distance_miles - 1) * 100).toFixed(0)}%
                      </B>
                    )}
                  </XStack>
                </YStack>
              )}
            </YStack>
          ) : todaysWorkout.status === 'completed' ? (
            /* Completed but no metric (manual complete) */
            <YStack>
              <XStack alignItems="center" justifyContent="space-between">
                <H color="$color" fontSize={22} letterSpacing={0.8}>{todaysWorkout.title}</H>
                <XStack alignItems="center" gap={4} backgroundColor={colors.success + '22'} paddingHorizontal={10} paddingVertical={4} borderRadius={12}>
                  <MaterialCommunityIcons name="check-circle" size={14} color={colors.success} />
                  <B color={colors.success} fontSize={12} fontWeight="700">Completed</B>
                </XStack>
              </XStack>
            </YStack>
          ) : (
            /* ─── UPCOMING / MODIFIED LAYOUT (pre-run) ─── */
            <YStack>
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

              {/* Action Buttons — only show manual buttons when Strava NOT connected */}
              {todaysWorkout.status === 'upcoming' && !isStravaConnected && (
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
              {/* Strava connected — auto-sync note */}
              {todaysWorkout.status === 'upcoming' && isStravaConnected && (
                <YStack marginTop="$2" gap={10}>
                  <XStack alignItems="center" justifyContent="center" gap={6}>
                    <MaterialCommunityIcons name="sync" size={14} color={colors.cyan} />
                    <B color="$textTertiary" fontSize={12}>Syncs automatically from Strava</B>
                  </XStack>
                  <XStack alignSelf="center"
                    borderWidth={1} borderColor={colors.border} borderRadius={20}
                    paddingHorizontal={14} paddingVertical={6} gap={6} alignItems="center"
                    pressStyle={{ opacity: 0.7, borderColor: colors.textTertiary }}
                    onPress={() => setShowManualRun(true)}>
                    <MaterialCommunityIcons name="pencil-plus-outline" size={16} color={colors.textSecondary} />
                    <B color="$textSecondary" fontSize={13} fontWeight="600">Log Run Manually</B>
                  </XStack>
                </YStack>
              )}
            </YStack>
          )}

          {/* PARTIAL status */}
          {todaysWorkout.status === 'partial' && (
            <YStack marginTop="$1">
              <XStack alignItems="center" gap="$2" marginBottom="$2">
                <MaterialCommunityIcons name="circle-half-full" size={16} color={colors.orange} />
                <H color={colors.orange} fontSize={12} letterSpacing={1} textTransform="uppercase">Partial Completion</H>
              </XStack>
              {todaysMetric && todaysWorkout.target_distance_miles && (
                <YStack marginBottom="$2">
                  <XStack justifyContent="space-between" marginBottom={4}>
                    <M color="$color" fontSize={14} fontWeight="700">
                      {todaysMetric.distance_miles.toFixed(1)} of {todaysWorkout.target_distance_miles.toFixed(1)} mi
                    </M>
                    <M color={colors.orange} fontSize={14} fontWeight="700">
                      {Math.round((todaysMetric.distance_miles / todaysWorkout.target_distance_miles) * 100)}%
                    </M>
                  </XStack>
                  <View backgroundColor="$border" borderRadius={2} height={4}>
                    <View backgroundColor={colors.orange} borderRadius={2} height={4}
                      width={`${Math.min(Math.round((todaysMetric.distance_miles / todaysWorkout.target_distance_miles) * 100), 100)}%` as any} />
                  </View>
                </YStack>
              )}
              <YStack backgroundColor={colors.surfaceHover} borderRadius={12} padding="$3">
                <XStack alignItems="flex-start" gap="$2">
                  <MaterialCommunityIcons name="robot-outline" size={16} color={colors.cyan} style={{ marginTop: 2 }} />
                  <B color="$textSecondary" fontSize={13} lineHeight={19} flex={1}>
                    {todaysMetric
                      ? `You still covered ${todaysMetric.distance_miles.toFixed(1)} miles — that's solid work. Falling short on a ${todaysWorkout.workout_type === 'long_run' || todaysWorkout.workout_type === 'long' ? 'long run often comes down to fueling or pacing' : 'hard effort happens — listen to your body'}.`
                      : 'Partial completion is still progress. Listen to your body and focus on recovery.'}
                  </B>
                </XStack>
              </YStack>
            </YStack>
          )}
          {todaysWorkout.status === 'skipped' && (() => {
            // Skip coaching card
            const weekW = workouts.filter((w: any) => w.week_number === todaysWorkout.week_number);
            const weekVolActual = currentWeek?.actual_volume ?? 0;
            const weekVolTarget = currentWeek?.target_volume ?? 0;
            const workoutsLeft = weekW.filter((w: any) => w.status === 'upcoming' && w.workout_type !== 'rest').length;
            const skipsThisWeek = weekW.filter((w: any) => w.status === 'skipped').length;
            const volPct = weekVolTarget > 0 ? Math.round((weekVolActual / weekVolTarget) * 100) : 0;
            const tomorrowW = (() => {
              const today = getToday();
              const tmrw = new Date(today + 'T00:00:00');
              tmrw.setDate(tmrw.getDate() + 1);
              const s = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, '0')}-${String(tmrw.getDate()).padStart(2, '0')}`;
              return workouts.find((w: any) => w.scheduled_date === s);
            })();

            return (
              <YStack marginTop="$3">
                {/* Skip header */}
                <XStack alignItems="center" gap="$2" marginBottom="$3">
                  <MaterialCommunityIcons name="close-circle" size={16} color={colors.orange} />
                  <H color={colors.orange} fontSize={12} letterSpacing={1} textTransform="uppercase">Workout Skipped</H>
                </XStack>
                <B color="$textTertiary" fontSize={13} textDecorationLine="line-through" marginBottom="$3">
                  {todaysWorkout.title} · {todaysWorkout.target_distance_miles?.toFixed(1) ?? '?'} mi
                </B>

                {/* Coach encouragement */}
                <YStack backgroundColor={colors.surfaceHover} borderRadius={12} padding="$3" marginBottom="$3">
                  <XStack alignItems="flex-start" gap="$2">
                    <MaterialCommunityIcons name="robot-outline" size={16} color={colors.cyan} style={{ marginTop: 2 }} />
                    <B color="$textSecondary" fontSize={13} lineHeight={19} flex={1}>
                      {skipsThisWeek >= 2
                        ? `You've skipped ${skipsThisWeek} workouts this week. Consider talking to your coach about adjusting the plan.`
                        : 'One missed day won\'t derail your training. Consistency over perfection — focus on tomorrow.'}
                    </B>
                  </XStack>
                </YStack>

                {/* Volume progress */}
                <YStack marginBottom="$3">
                  <XStack justifyContent="space-between" marginBottom={4}>
                    <B color="$textTertiary" fontSize={11}>This week's volume</B>
                    <M color="$textSecondary" fontSize={11} fontWeight="600">
                      {weekVolActual.toFixed(1)} of {weekVolTarget.toFixed(1)} mi ({volPct}%)
                    </M>
                  </XStack>
                  <View backgroundColor="$border" borderRadius={2} height={4}>
                    <View backgroundColor={volPct >= 80 ? colors.cyan : volPct >= 50 ? colors.orange : colors.textTertiary}
                      borderRadius={2} height={4} width={`${Math.min(volPct, 100)}%` as any} />
                  </View>
                  {workoutsLeft > 0 && (
                    <B color="$textTertiary" fontSize={11} marginTop={4}>{workoutsLeft} workout{workoutsLeft > 1 ? 's' : ''} left this week</B>
                  )}
                </YStack>

                {/* Tomorrow preview */}
                {tomorrowW && tomorrowW.workout_type !== 'rest' && (
                  <YStack paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
                    <H color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={1.5} marginBottom="$1">Tomorrow</H>
                    <B color="$color" fontSize={14} fontWeight="600">{tomorrowW.title}</B>
                    <M color="$textSecondary" fontSize={12} marginTop={2}>
                      {WORKOUT_TYPE_LABELS[tomorrowW.workout_type] ?? tomorrowW.workout_type}
                      {tomorrowW.target_distance_miles ? ` · ${tomorrowW.target_distance_miles.toFixed(1)} mi` : ''}
                    </M>
                  </YStack>
                )}
              </YStack>
            );
          })()}
        </YStack>
      )}

      {/* === SUPPORTING CONTEXT === */}
      {/* Recovery + Briefing (compact combo) */}
      {!isRestDay && todaysWorkout?.status !== 'completed' && todaysWorkout?.status !== 'partial' && todaysWorkout?.status !== 'skipped' && (recoveryStatus?.level !== 'unknown' || preWorkoutBriefing) && (
        <YStack backgroundColor="$surface" borderRadius={12} padding={12} marginBottom={10} borderLeftWidth={3} borderLeftColor={colors.cyan}>
          {/* Recovery score inline + briefing — only before the run */}
          {recoveryStatus && recoveryStatus.level !== 'unknown' && recoveryStatus.signalCount >= 2 && (
            <XStack alignItems="center" gap={8} marginBottom={preWorkoutBriefing ? 8 : 0}
              pressStyle={{ opacity: 0.8 }} onPress={() => router.push('/(tabs)/zones')}>
              <View width={32} height={32} borderRadius={16}
                backgroundColor={recoveryStatus.score >= 80 ? colors.cyanGhost : recoveryStatus.score >= 60 ? colors.orangeGhost : colors.orangeGhost}
                alignItems="center" justifyContent="center">
                <M color={recoveryStatus.score >= 80 ? colors.cyan : colors.orange} fontSize={14} fontWeight="800">{recoveryStatus.score}</M>
              </View>
              <B color={recoveryStatus.score >= 80 ? colors.cyan : colors.orange} fontSize={13} fontWeight="600">
                {recoveryStatus.level.charAt(0).toUpperCase() + recoveryStatus.level.slice(1)}
              </B>
              <B color="$textTertiary" fontSize={11}>· {recoveryStatus.signalCount} signals</B>
            </XStack>
          )}
          {preWorkoutBriefing && (
            <B color="$textSecondary" fontSize={13} lineHeight={19}>{preWorkoutBriefing}</B>
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

      {/* === TAPER / RACE WEEK (when applicable) === */}
      {/* Taper Experience (last 21 days before race) */}
      {daysUntilRace <= 21 && daysUntilRace >= 0 && currentPhase === 'taper' && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3}
          borderLeftColor={daysUntilRace <= 7 ? colors.orange : colors.cyan}>
          <H color={daysUntilRace <= 7 ? colors.orange : colors.cyan} fontSize={13} letterSpacing={1.5} textTransform="uppercase" marginBottom="$3">
            {daysUntilRace === 0 ? 'Race Day' : daysUntilRace <= 7 ? 'Race Week' : daysUntilRace <= 14 ? 'Taper — 2 Weeks Out' : 'Taper — 3 Weeks Out'}
          </H>

          {/* Daily taper tip */}
          <B color="$color" fontSize={14} lineHeight={21} marginBottom="$3">
            {daysUntilRace === 0 ? "Today is the day. Trust your training. You are ready for this."
            : daysUntilRace <= 1 ? "Tomorrow is race day. Trust your training. You're ready."
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

      {/* Race Day Card */}
      {daysUntilRace === 0 && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$5" marginBottom="$4" borderWidth={1} borderColor={colors.cyanDim}>
          {/* Hero */}
          <YStack alignItems="center" marginBottom="$4">
            <View width={64} height={64} borderRadius={32} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom="$3">
              <MaterialCommunityIcons name="trophy" size={34} color={colors.cyan} />
            </View>
            <H color="$color" fontSize={28} letterSpacing={1.5}>RACE DAY</H>
            {userProfile?.race_name && <B color={colors.cyan} fontSize={15} fontWeight="600" marginTop={2}>{userProfile.race_name}</B>}
            <B color="$textTertiary" fontSize={12} marginTop={2}>
              {new Date(getToday() + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </B>
          </YStack>

          {/* Pacing Strategy */}
          {raceStrategy && (
            <YStack paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border" marginBottom="$4">
              <H color={colors.cyan} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom="$2">Your Pacing Strategy</H>
              <B color="$textSecondary" fontSize={14} lineHeight={21}>{raceStrategy}</B>
            </YStack>
          )}

          {/* Final Reminders */}
          <YStack paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border" marginBottom="$4">
            <H color={colors.cyan} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom="$3">Final Reminders</H>
            {[
              { icon: 'run-fast', tip: 'Start slow. The first 3 miles should feel embarrassingly easy.' },
              { icon: 'water-outline', tip: 'Take water at EVERY aid station. Don\'t skip early ones.' },
              { icon: 'food-apple-outline', tip: 'First gel at mile 5, then every 4-5 miles after.' },
              { icon: 'heart-pulse', tip: `If HR goes above ${userProfile?.max_hr ? Math.round(userProfile.max_hr * 0.88) : 170} before mile 15, you're going too fast.` },
              { icon: 'head-outline', tip: 'Miles 18-22 are where it gets hard. Break it into 1-mile chunks.' },
            ].map(({ icon, tip }, i) => (
              <XStack key={i} gap="$3" alignItems="flex-start" marginBottom="$2">
                <View width={28} height={28} borderRadius={14} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center">
                  <MaterialCommunityIcons name={icon as any} size={15} color={colors.cyan} />
                </View>
                <B color="$textSecondary" fontSize={13} lineHeight={19} flex={1}>{tip}</B>
              </XStack>
            ))}
          </YStack>

          {/* Trust Your Training */}
          <YStack paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border" alignItems="center" paddingVertical="$4">
            <H color={colors.cyan} fontSize={14} letterSpacing={1.5} textTransform="uppercase" marginBottom="$2">Trust Your Training</H>
            <B color="$textSecondary" fontSize={14} lineHeight={20} textAlign="center">
              You've put in {currentWeekNumber} weeks and {Math.round(weeks.reduce((s, w) => s + w.actual_volume, 0))} miles.{'\n'}You are ready for this.
            </B>
          </YStack>
        </YStack>
      )}

      {/* === SECONDARY ACTIONS === */}
      {/* Cross-Training — on run days: small outlined pill button */}
      {!isRaceWeek && !isRestDay && (
        todayCrossTraining ? (
          <XStack alignItems="center" justifyContent="center" marginBottom="$4" gap="$2">
            <MaterialCommunityIcons name="check-circle" size={14}
              color={todayCrossTraining.impact === 'high' ? colors.orange : todayCrossTraining.impact === 'positive' ? colors.cyan : colors.textSecondary} />
            <B fontSize={12} fontWeight="600"
              color={todayCrossTraining.impact === 'high' ? colors.orange : todayCrossTraining.impact === 'positive' ? colors.cyan : colors.textSecondary}>
              {CROSS_TRAINING_LABELS[todayCrossTraining.type]} logged
            </B>
            <B color="$textTertiary" fontSize={11} marginLeft="$1"
              onPress={() => deleteCrossTrainingEntry(todayCrossTraining.id)}>
              ✕
            </B>
          </XStack>
        ) : (
          <XStack alignSelf="center" marginBottom="$4"
            borderWidth={1} borderColor="$border" borderRadius={20}
            paddingHorizontal="$4" paddingVertical="$2" gap="$2" alignItems="center"
            pressStyle={{ opacity: 0.7, borderColor: colors.textTertiary }}
            onPress={() => setShowCTModal(true)}>
            <MaterialCommunityIcons name="dumbbell" size={14} color={colors.textTertiary} />
            <B color="$textTertiary" fontSize={12} fontWeight="600">Log Cross-Training</B>
          </XStack>
        )
      )}

      {/* === REST DAY (replaces workout card on rest days) === */}
      {/* Rest Day — personalized coaching card */}
      {isRestDay && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$5" marginBottom="$4">
          {/* Header */}
          <YStack alignItems="center" marginBottom="$3">
            <View width={56} height={56} borderRadius={28} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom="$2">
              <MaterialCommunityIcons name="battery-heart-outline" size={30} color={colors.cyan} />
            </View>
            <H color="$color" fontSize={26} letterSpacing={1}>Rest Day</H>
            <B color="$textTertiary" fontSize={13}>
              {new Date(getToday() + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </B>
          </YStack>

          {/* WHY YOU'RE RESTING — AI generated */}
          {restDayBriefing?.whyResting && (
            <YStack paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
              <H color={colors.cyan} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom="$2">
                Why You're Resting
              </H>
              <B color="$textSecondary" fontSize={13} lineHeight={20}>
                {restDayBriefing.whyResting}
              </B>
            </YStack>
          )}

          {/* RECOVERY PLAN — AI generated tips */}
          {restDayBriefing?.tips && restDayBriefing.tips.length > 0 && (
            <YStack marginTop="$4" paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
              <H color={colors.cyan} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom="$3">
                Today's Recovery Plan
              </H>
              <YStack gap="$3">
                {restDayBriefing.tips.map((tip, i) => {
                  const tipIconMap: Record<string, string> = {
                    'Hydration': 'water-outline', 'Water': 'water-outline',
                    'Nutrition': 'food-apple-outline', 'Food': 'food-apple-outline', 'Fuel': 'food-apple-outline',
                    'Movement': 'yoga', 'Stretching': 'yoga', 'Mobility': 'yoga', 'Walk': 'walk',
                    'Sleep': 'bed-outline', 'Rest': 'bed-outline',
                  };
                  const iconName = tipIconMap[tip.title] ?? 'checkbox-blank-circle-outline';
                  return (
                    <XStack key={i} gap="$3" alignItems="flex-start">
                      <View width={32} height={32} borderRadius={16} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center">
                        <MaterialCommunityIcons name={iconName as any} size={18} color={colors.cyan} />
                      </View>
                      <YStack flex={1}>
                        <B color="$color" fontSize={13} fontWeight="600">{tip.title}</B>
                        <B color="$textSecondary" fontSize={12} lineHeight={18} marginTop={1}>{tip.detail}</B>
                      </YStack>
                    </XStack>
                  );
                })}
              </YStack>
            </YStack>
          )}

          {/* THIS WEEK SO FAR — mini timeline */}
          {currentWeek && (() => {
            const weekWorkouts = workouts
              .filter((w: any) => w.week_number === currentWeek.week_number)
              .sort((a: any, b: any) => a.scheduled_date.localeCompare(b.scheduled_date));
            if (weekWorkouts.length === 0) return null;
            const today = getToday();
            const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            return (
              <YStack marginTop="$4" paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
                <H color={colors.cyan} fontSize={12} letterSpacing={1.5} textTransform="uppercase" marginBottom="$2">
                  This Week
                </H>
                <YStack gap={4}>
                  {weekWorkouts.filter((w: any) => w.workout_type !== 'rest' || w.scheduled_date === today).map((w: any) => {
                    const isToday = w.scheduled_date === today;
                    const isPast = w.scheduled_date < today;
                    const dayName = DAYS[new Date(w.scheduled_date + 'T12:00:00').getDay()];
                    // Softer color for skipped easy/recovery — red only for quality sessions
                    const isQualitySkip = w.status === 'skipped' && ['threshold', 'tempo', 'interval', 'intervals', 'marathon_pace', 'long_run', 'long'].includes(w.workout_type);
                    const skipColor = isQualitySkip ? colors.error : colors.textTertiary;
                    const iconName = w.status === 'completed' ? 'check-circle'
                      : w.status === 'skipped' ? (isQualitySkip ? 'close-circle' : 'minus-circle')
                      : w.status === 'partial' ? 'circle-half-full'
                      : isToday ? 'battery-heart-outline'
                      : 'chevron-right';
                    const iconColor = w.status === 'completed' ? colors.success
                      : w.status === 'skipped' ? skipColor
                      : w.status === 'partial' ? colors.orange
                      : isToday ? colors.cyan
                      : colors.textTertiary;
                    const textColor = w.status === 'completed' ? colors.success
                      : w.status === 'skipped' ? skipColor
                      : isToday ? colors.textPrimary
                      : colors.textSecondary;
                    return (
                      <XStack key={w.id} alignItems="center" gap="$2">
                        <View width={20} alignItems="center">
                          <MaterialCommunityIcons name={iconName as any} size={14} color={iconColor} />
                        </View>
                        <B color={colors.textTertiary} fontSize={12} width={30}>{dayName}</B>
                        <B color={textColor} fontSize={12} fontWeight={isToday ? '700' : '400'} flex={1}>
                          {isToday && w.workout_type === 'rest' ? 'Rest' : w.title}
                          {w.status === 'completed' && w.target_distance_miles ? ` ${w.target_distance_miles.toFixed(1)}mi` : ''}
                          {!isPast && !isToday && w.target_distance_miles ? ` ${w.target_distance_miles.toFixed(1)}mi` : ''}
                        </B>
                      </XStack>
                    );
                  })}
                </YStack>
              </YStack>
            );
          })()}

          {/* Cross-training: quick chips OR logged badge */}
          {!isRaceWeek && (
            <YStack marginTop="$4" paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
              {todayCrossTraining ? (
                <XStack alignItems="center" justifyContent="space-between">
                  <XStack alignItems="center" gap="$2">
                    <View width={22} height={22} borderRadius={11} alignItems="center" justifyContent="center"
                      backgroundColor={todayCrossTraining.impact === 'high' ? colors.orangeGhost : todayCrossTraining.impact === 'positive' ? colors.cyanGhost : colors.surfaceHover}>
                      <MaterialCommunityIcons name="check" size={12}
                        color={todayCrossTraining.impact === 'high' ? colors.orange : todayCrossTraining.impact === 'positive' ? colors.cyan : colors.textSecondary} />
                    </View>
                    <B fontSize={12} fontWeight="600"
                      color={todayCrossTraining.impact === 'high' ? colors.orange : todayCrossTraining.impact === 'positive' ? colors.cyan : colors.textSecondary}>
                      {CROSS_TRAINING_LABELS[todayCrossTraining.type]} logged
                    </B>
                  </XStack>
                  <B color="$textTertiary" fontSize={11} onPress={() => deleteCrossTrainingEntry(todayCrossTraining.id)}>Remove</B>
                </XStack>
              ) : (
                <YStack>
                  <XStack alignItems="center" gap="$2" marginBottom="$2">
                    <MaterialCommunityIcons name="dumbbell" size={13} color={colors.textTertiary} />
                    <B color="$textTertiary" fontSize={12}>Cross-training today?</B>
                  </XStack>
                  <XStack gap="$2" flexWrap="wrap">
                    {([
                      { type: 'leg_day' as CrossTrainingType, label: 'Leg Day' },
                      { type: 'upper_body' as CrossTrainingType, label: 'Upper Body' },
                      { type: 'full_body' as CrossTrainingType, label: 'Gym' },
                    ]).map(({ type, label }) => (
                      <YStack key={type} backgroundColor={colors.surfaceHover}
                        paddingHorizontal="$3" paddingVertical="$2" borderRadius={20}
                        borderWidth={0.5} borderColor="$border"
                        pressStyle={{ opacity: 0.7, backgroundColor: colors.border }}
                        onPress={() => logCrossTraining(type)}>
                        <B color="$textSecondary" fontSize={12} fontWeight="600">{label}</B>
                      </YStack>
                    ))}
                    <YStack backgroundColor={colors.surfaceHover}
                      paddingHorizontal="$3" paddingVertical="$2" borderRadius={20}
                      borderWidth={0.5} borderColor="$border"
                      pressStyle={{ opacity: 0.7, backgroundColor: colors.border }}
                      onPress={() => setShowCTModal(true)}>
                      <B color="$textTertiary" fontSize={12} fontWeight="600">More</B>
                    </YStack>
                  </XStack>
                </YStack>
              )}
            </YStack>
          )}

          {/* Tomorrow preview */}
          {tomorrowWorkout && (
            <YStack marginTop="$4" paddingTop="$3" borderTopWidth={0.5} borderTopColor="$border">
              <H color="$textTertiary" fontSize={12} textTransform="uppercase" letterSpacing={1.5} marginBottom="$1">Tomorrow</H>
              <B color="$color" fontSize={15} fontWeight="600">{tomorrowWorkout.title}</B>
              <M color="$textSecondary" fontSize={12} marginTop={2}>
                {WORKOUT_TYPE_LABELS[tomorrowWorkout.workout_type] ?? tomorrowWorkout.workout_type}
                {tomorrowWorkout.target_distance_miles ? ` · ${tomorrowWorkout.target_distance_miles.toFixed(1)} mi` : ''}
              </M>
            </YStack>
          )}
        </YStack>
      )}

      {/* === MODALS === */}
      {/* Cross-Training Modal — 2-column impact-colored grid */}
      {showCTModal && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', zIndex: 100 }}>
          <Pressable style={{ flex: 1 }} onPress={() => { setShowCTModal(false); setCTNotes(''); }} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            {/* Drag handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <XStack justifyContent="space-between" alignItems="center" marginBottom="$4">
              <H color="$color" fontSize={18} letterSpacing={1}>LOG CROSS-TRAINING</H>
              <B color="$textTertiary" fontSize={18} onPress={() => { setShowCTModal(false); setCTNotes(''); }}>✕</B>
            </XStack>

            {/* 2-column grid */}
            <XStack flexWrap="wrap" gap={10}>
              {([
                { type: 'leg_day' as CrossTrainingType, icon: 'weight-lifter', impact: 'high' as const },
                { type: 'upper_body' as CrossTrainingType, icon: 'arm-flex', impact: 'low' as const },
                { type: 'full_body' as CrossTrainingType, icon: 'dumbbell', impact: 'moderate' as const },
                { type: 'cycling' as CrossTrainingType, icon: 'bicycle', impact: 'moderate' as const },
                { type: 'swimming' as CrossTrainingType, icon: 'swim', impact: 'moderate' as const },
                { type: 'yoga_mobility' as CrossTrainingType, icon: 'meditation', impact: 'positive' as const },
                { type: 'other' as CrossTrainingType, icon: 'pencil', impact: 'low' as const },
              ]).map(({ type, icon, impact }) => {
                const impactColor = impact === 'high' ? colors.orange
                  : impact === 'positive' ? colors.cyan
                  : impact === 'moderate' ? colors.orangeDim
                  : colors.textTertiary;
                const bgColor = impact === 'high' ? colors.orangeGhost
                  : impact === 'positive' ? colors.cyanGhost
                  : colors.surfaceHover;
                const borderColor = impact === 'high' ? colors.orangeDim
                  : impact === 'positive' ? colors.cyanDim
                  : impact === 'moderate' ? colors.orangeGhost
                  : colors.border;
                return (
                  <YStack key={type}
                    width="48%"
                    backgroundColor={bgColor}
                    borderRadius={14} padding="$3"
                    borderWidth={1} borderColor={borderColor}
                    pressStyle={{ opacity: 0.7, scale: 0.97 }}
                    onPress={() => {
                      logCrossTraining(type, ctNotes || undefined);
                      setShowCTModal(false);
                      setCTNotes('');
                    }}>
                    <View width={32} height={32} borderRadius={16}
                      backgroundColor={impactColor + '22'}
                      alignItems="center" justifyContent="center" marginBottom="$2">
                      <MaterialCommunityIcons name={icon as any} size={16} color={impactColor} />
                    </View>
                    <B color="$color" fontSize={13} fontWeight="600">{CROSS_TRAINING_LABELS[type]}</B>
                    <B color={impactColor} fontSize={11} marginTop={2}>{impact} impact</B>
                  </YStack>
                );
              })}
            </XStack>

            {/* Notes input */}
            <YStack marginTop="$4">
              <B color="$textTertiary" fontSize={11} marginBottom="$1">Notes (optional)</B>
              <XStack backgroundColor={colors.surfaceHover} borderRadius={12} paddingHorizontal={14} paddingVertical={10}
                borderWidth={1} borderColor={ctNotes ? colors.cyanDim : colors.border} minHeight={44}>
                <TextInput
                  value={ctNotes}
                  onChangeText={setCTNotes}
                  placeholder='e.g., "heavy squats, 5x5"'
                  placeholderTextColor={colors.textTertiary}
                  style={{ flex: 1, color: colors.textPrimary, fontFamily: 'Exo2_400Regular', fontSize: 16 }}
                />
              </XStack>
            </YStack>
          </View>
        </View>
      )}

      {/* Manual Run Entry Modal */}
      {showManualRun && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', zIndex: 100 }}>
          <Pressable style={{ flex: 1 }} onPress={() => { setShowManualRun(false); setManualDist(''); setManualDur(''); }} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <H color={colors.textPrimary} fontSize={18} letterSpacing={1} marginBottom={16}>Log Run Manually</H>
            <XStack gap={12}>
              <YStack flex={1}>
                <B color={colors.textTertiary} fontSize={12} marginBottom={4}>Distance (mi)</B>
                <TextInput value={manualDist} onChangeText={setManualDist} keyboardType="decimal-pad" placeholder="3.3"
                  placeholderTextColor={colors.textTertiary}
                  style={{ height: 44, backgroundColor: colors.surfaceHover, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 16, paddingHorizontal: 14 }} />
              </YStack>
              <YStack flex={1}>
                <B color={colors.textTertiary} fontSize={12} marginBottom={4}>Duration (min)</B>
                <TextInput value={manualDur} onChangeText={setManualDur} keyboardType="decimal-pad" placeholder="30"
                  placeholderTextColor={colors.textTertiary}
                  style={{ height: 44, backgroundColor: colors.surfaceHover, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 16, paddingHorizontal: 14 }} />
              </YStack>
            </XStack>
            <B color={colors.textTertiary} fontSize={11} marginTop={8} marginBottom={16}>No HR, splits, or route data. Connect Strava for full tracking.</B>
            <YStack backgroundColor={manualDist.trim() ? colors.cyan : colors.surfaceHover} borderRadius={12} paddingVertical={12} alignItems="center"
              pressStyle={manualDist.trim() ? { opacity: 0.8 } : undefined}
              onPress={manualDist.trim() ? () => {
                const dist = parseFloat(manualDist);
                const dur = parseFloat(manualDur) || 0;
                if (dist > 0 && todaysWorkout) {
                  try {
                    const { addManualRun } = useAppStore.getState();
                    addManualRun(getToday(), dist, dur);
                    markWorkoutComplete(todaysWorkout.id);
                  } catch {}
                }
                setShowManualRun(false); setManualDist(''); setManualDur('');
              } : undefined}>
              <B color={manualDist.trim() ? colors.background : colors.textTertiary} fontSize={15} fontWeight="700">Save Run</B>
            </YStack>
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
    </View>
  );
}

const stickyStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  shadow: {
    height: 6,
    zIndex: 9,
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.surfaceHover,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: 3,
    borderRadius: 1.5,
  },
});
