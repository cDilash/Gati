import React, { useEffect, useCallback, useState } from 'react';
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

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

function RecoveryBadge({ recovery }: { recovery: RecoveryStatus }) {
  const router = useRouter();
  const color = recovery.score >= 80 ? '#34C759'
    : recovery.score >= 60 ? '#FF9500'
    : recovery.score >= 40 ? '#FF9500'
    : '#FF3B30';
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
      <MaterialCommunityIcons name="chevron-right" size={18} color="#666666" />
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
    markWorkoutSkipped(todaysWorkout.id);
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
      refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={onRefresh} tintColor="#FF6B35" />}
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
          <MaterialCommunityIcons name="check-circle-outline" size={14} color="#34C759" />
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
                color={proactiveSuggestion.ctSuggestion?.severity === 'strong' ? '#FF3B30' : '#FF9500'} />
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

      {/* Header */}
      <YStack marginBottom="$5">
        <H color="$color" fontSize={24} letterSpacing={1} textTransform="uppercase">
          Week {currentWeekNumber} of {totalWeeks} — {currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1)} Phase
        </H>
        <M color="$accent" fontSize={15} fontWeight="600" marginTop="$1">
          {daysUntilRace > 0 ? `${daysUntilRace} day${daysUntilRace !== 1 ? 's' : ''} to race`
            : daysUntilRace === 0 ? 'Race day!' : 'Post-race'}
        </M>
      </YStack>

      {/* Recovery Badge */}
      {recoveryStatus && recoveryStatus.level !== 'unknown' && recoveryStatus.signalCount >= 2 && (
        <RecoveryBadge recovery={recoveryStatus} />
      )}

      {/* Race Week Strategy */}
      {isRaceWeek && raceStrategy && (
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
              <MaterialCommunityIcons name={getWorkoutIcon(todaysWorkout.workout_type) as any} size={14} color="#FF6B35" style={{ marginRight: 4 }} />
              <H color="$accent" fontSize={12} letterSpacing={1}>
                {WORKOUT_TYPE_LABELS[todaysWorkout.workout_type] ?? todaysWorkout.workout_type}
              </H>
            </XStack>
            {todaysWorkout.target_distance_miles != null && (
              <XStack alignItems="center" gap="$1">
                <MaterialCommunityIcons name="map-marker-distance" size={16} color="#FFFFFF" />
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
            backgroundColor={todayCrossTraining.impact === 'high' ? '#FF3B3022' : todayCrossTraining.impact === 'moderate' ? '#FF950022' : todayCrossTraining.impact === 'positive' ? '#34C75922' : '#66666622'}>
            <MaterialCommunityIcons name="dumbbell" size={16}
              color={todayCrossTraining.impact === 'high' ? '#FF3B30' : todayCrossTraining.impact === 'moderate' ? '#FF9500' : todayCrossTraining.impact === 'positive' ? '#34C759' : '#666666'} />
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
            <MaterialCommunityIcons name="dumbbell" size={16} color="#A0A0A0" />
          </View>
          <B color="$textSecondary" fontSize={13} fontWeight="500">Log Cross-Training</B>
        </XStack>
      )}

      {/* Cross-Training Modal */}
      {showCTModal && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', zIndex: 100 }}>
          <View style={{ backgroundColor: '#1E1E1E', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            {/* Drag handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginBottom: 16 }} />
            <XStack justifyContent="space-between" alignItems="center" marginBottom="$4">
              <H color="$color" fontSize={18} letterSpacing={1}>LOG CROSS-TRAINING</H>
              <B color="$textTertiary" fontSize={18} onPress={() => { setShowCTModal(false); setCTNotes(''); }}>✕</B>
            </XStack>

            {/* Options grid */}
            {([
              { type: 'leg_day' as CrossTrainingType, icon: 'weight-lifter', color: '#FF3B30' },
              { type: 'upper_body' as CrossTrainingType, icon: 'arm-flex', color: '#666666' },
              { type: 'full_body' as CrossTrainingType, icon: 'dumbbell', color: '#FF9500' },
              { type: 'cycling' as CrossTrainingType, icon: 'bicycle', color: '#FF9500' },
              { type: 'swimming' as CrossTrainingType, icon: 'swim', color: '#FF9500' },
              { type: 'yoga_mobility' as CrossTrainingType, icon: 'meditation', color: '#34C759' },
              { type: 'other' as CrossTrainingType, icon: 'pencil', color: '#666666' },
            ] as const).map(({ type, icon, color }) => (
              <XStack key={type} backgroundColor="#2A2A2A" borderRadius={12} padding="$3" marginBottom="$2" alignItems="center"
                pressStyle={{ opacity: 0.7, backgroundColor: '#333' }}
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
