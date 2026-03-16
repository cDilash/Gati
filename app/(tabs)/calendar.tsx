import { useState, useCallback, useMemo } from 'react';
import { RefreshControl, Pressable } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { PHASE_COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate, isToday } from '../../src/utils/dateUtils';
import { Workout, CrossTraining, CROSS_TRAINING_LABELS } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getWorkoutIcon } from '../../src/utils/workoutIcons';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

export default function CalendarScreen() {
  const router = useRouter();
  const isLoading = useAppStore(s => s.isLoading);
  const activePlan = useAppStore(s => s.activePlan);
  const userProfile = useAppStore(s => s.userProfile);
  const weeks = useAppStore(s => s.weeks);
  const workouts = useAppStore(s => s.workouts);
  const currentWeekNumber = useAppStore(s => s.currentWeekNumber);
  const weeklyDigest = useAppStore(s => s.weeklyDigest);
  const refreshState = useAppStore(s => s.refreshState);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => new Set(currentWeekNumber > 0 ? [currentWeekNumber] : []));
  const [digestDismissed, setDigestDismissed] = useState(false);

  const workoutsByWeek = useMemo(() => {
    const map = new Map<number, Workout[]>();
    for (const w of workouts) {
      const list = map.get(w.week_number) ?? [];
      list.push(w);
      map.set(w.week_number, list);
    }
    for (const [, list] of map) list.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    return map;
  }, [workouts]);

  // Cross-training by date for expanded weeks
  const crossTrainingByDate = useMemo(() => {
    const map = new Map<string, CrossTraining>();
    try {
      const { getCrossTrainingHistory } = require('../../src/db/database');
      const history = getCrossTrainingHistory(120); // ~4 months
      for (const ct of history) map.set(ct.date, ct);
    } catch {}
    return map;
  }, [workouts]); // re-derive when workouts change (after sync)

  const adherence = useMemo(() => {
    const past = workouts.filter(w => w.workout_type !== 'rest' && (w.status === 'completed' || w.status === 'skipped' || w.status === 'partial'));
    if (past.length === 0) return null;
    return Math.round((past.filter(w => w.status === 'completed' || w.status === 'partial').length / past.length) * 100);
  }, [workouts]);

  const toggleWeek = useCallback((n: number) => {
    setExpandedWeeks(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }, []);

  if (isLoading) {
    return <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center"><Spinner size="large" color="$accent" /></YStack>;
  }

  if (!activePlan) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding="$8">
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom="$2">No Training Plan</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22}>Generate a plan from Settings to see your schedule here.</B>
      </YStack>
    );
  }

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refreshState} tintColor="#FF6B35" />}>

      {/* Summary Bar */}
      <XStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" alignItems="center">
        <YStack flex={1} alignItems="center">
          <M color="$color" fontSize={22} fontWeight="700">{weeks.length}</M>
          <H color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={1} marginTop={2}>Weeks</H>
        </YStack>
        <View width={1} height={28} backgroundColor="$border" />
        <YStack flex={1} alignItems="center">
          <M color="$color" fontSize={22} fontWeight="700">{currentWeekNumber}</M>
          <H color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={1} marginTop={2}>Current</H>
        </YStack>
        <View width={1} height={28} backgroundColor="$border" />
        <YStack flex={1} alignItems="center">
          <M color="$color" fontSize={22} fontWeight="700">{adherence != null ? `${adherence}%` : '--'}</M>
          <H color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={1} marginTop={2}>Adherence</H>
        </YStack>
      </XStack>

      {/* Plan Info */}
      {activePlan && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$4">
          <XStack justifyContent="space-between" alignItems="center">
            <XStack alignItems="center" gap="$2">
              <MaterialCommunityIcons name="calendar-check" size={14} color="#A0A0A0" />
              <B color="$textTertiary" fontSize={12}>
                Generated {(() => {
                  const d = new Date(activePlan.created_at);
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                })()}
              </B>
            </XStack>
            <XStack alignItems="center" gap="$1">
              <B color="$textTertiary" fontSize={12}>VDOT</B>
              <M color={userProfile && Math.abs(userProfile.vdot_score - activePlan.vdot_at_generation) >= 1 ? '$warning' : '$textSecondary'} fontSize={12} fontWeight="700">
                {activePlan.vdot_at_generation}
              </M>
              {userProfile && Math.abs(userProfile.vdot_score - activePlan.vdot_at_generation) >= 1 && (
                <B color="$warning" fontSize={11}> → now {userProfile.vdot_score}</B>
              )}
            </XStack>
          </XStack>
        </YStack>
      )}

      {/* Weekly Digest */}
      {weeklyDigest && !digestDismissed && (
        <YStack backgroundColor="$surface" borderRadius="$6" padding="$4" marginBottom="$4" borderLeftWidth={3} borderLeftColor="$primary">
          <XStack justifyContent="space-between" alignItems="center" marginBottom="$3">
            <H color="$primary" fontSize={13} textTransform="uppercase" letterSpacing={1}>Weekly Review</H>
            <B color="$textTertiary" fontSize={13} fontWeight="600" onPress={() => setDigestDismissed(true)}>Dismiss</B>
          </XStack>
          <B color="$textSecondary" fontSize={14} lineHeight={21} marginBottom="$2">{weeklyDigest.summary}</B>
          {weeklyDigest.volumeComparison ? <M color="$color" fontSize={13} fontWeight="700" marginBottom="$2">{weeklyDigest.volumeComparison}</M> : null}
          {weeklyDigest.highlights.length > 0 && (
            <YStack marginBottom="$1">
              {weeklyDigest.highlights.map((h, i) => <B key={i} color="$success" fontSize={13} lineHeight={19}>+ {h}</B>)}
            </YStack>
          )}
          {weeklyDigest.concerns.length > 0 && (
            <YStack marginBottom="$1">
              {weeklyDigest.concerns.map((c, i) => <B key={i} color="$warning" fontSize={13} lineHeight={19}>- {c}</B>)}
            </YStack>
          )}
          {weeklyDigest.nextWeekPreview ? <B color="$textTertiary" fontSize={13} fontStyle="italic" marginTop="$1">{weeklyDigest.nextWeekPreview}</B> : null}
          {weeklyDigest.adaptationNeeded && weeklyDigest.adaptationReason && (
            <YStack backgroundColor="$surfaceLight" borderRadius="$3" padding="$3" marginTop="$3" borderLeftWidth={2} borderLeftColor="$warning">
              <B color="$warning" fontSize={13} marginBottom="$2">Adaptation suggested: {weeklyDigest.adaptationReason}</B>
              <XStack gap="$3">
                <YStack flex={1} backgroundColor="$warning" paddingVertical="$2" borderRadius="$4" alignItems="center"
                  pressStyle={{ opacity: 0.8 }} onPress={async () => {
                    const { Alert } = require('react-native');
                    Alert.alert('Adapt Plan', `Reason: ${weeklyDigest.adaptationReason}\n\nThis will modify future workouts based on your recent performance. Continue?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Adapt', style: 'default', onPress: async () => {
                        try {
                          const result = await useAppStore.getState().requestPlanAdaptation(weeklyDigest.adaptationReason!);
                          Alert.alert(result.success ? 'Plan Adapted' : 'Failed', result.summary || result.error || '');
                          setDigestDismissed(true);
                        } catch (e: any) {
                          Alert.alert('Error', e.message ?? 'Failed');
                        }
                      }},
                    ]);
                  }}>
                  <B color="white" fontSize={13} fontWeight="700">Adapt Plan</B>
                </YStack>
                <YStack flex={1} backgroundColor="$surface" paddingVertical="$2" borderRadius="$4" alignItems="center" borderWidth={1} borderColor="$border"
                  pressStyle={{ opacity: 0.8 }} onPress={() => setDigestDismissed(true)}>
                  <B color="$textSecondary" fontSize={13} fontWeight="600">Keep Current</B>
                </YStack>
              </XStack>
            </YStack>
          )}
        </YStack>
      )}

      {/* Week List */}
      {weeks.map(week => {
        const isExpanded = expandedWeeks.has(week.week_number);
        const isCurrent = week.week_number === currentWeekNumber;
        const weekWorkouts = workoutsByWeek.get(week.week_number) ?? [];
        const phaseColor = PHASE_COLORS[week.phase] ?? '#666666';
        const completedVolume = weekWorkouts
          .filter(w => w.status === 'completed' && w.target_distance_miles != null)
          .reduce((sum, w) => sum + (w.target_distance_miles ?? 0), 0);

        return (
          <YStack key={week.id} backgroundColor="$surface" borderRadius="$5" marginBottom="$3" overflow="hidden"
            borderWidth={1} borderColor={isCurrent ? '$accent' : 'transparent'}>

            {/* Week Header */}
            <Pressable onPress={() => toggleWeek(week.week_number)}>
              <XStack justifyContent="space-between" alignItems="center" padding={12}>
                <XStack alignItems="center" gap={8} flexShrink={1}>
                  <H color={isCurrent ? '$accent' : '$color'} fontSize={15} letterSpacing={1}>Week {week.week_number}</H>
                  <YStack paddingHorizontal={8} paddingVertical={2} borderRadius={6} backgroundColor={phaseColor + '22'}>
                    <H color={phaseColor} fontSize={11} textTransform="uppercase" letterSpacing={1}>
                      {week.phase.charAt(0).toUpperCase() + week.phase.slice(1)}
                    </H>
                  </YStack>
                  {week.is_cutback && (
                    <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal={6} paddingVertical={2} borderRadius={4}>
                      <H color="$textTertiary" fontSize={10} textTransform="uppercase" letterSpacing={1}>Cutback</H>
                    </YStack>
                  )}
                </XStack>
                <XStack alignItems="center" gap={8}>
                  <M color="$textSecondary" fontSize={13} fontWeight="700">
                    {completedVolume > 0 ? `${completedVolume.toFixed(0)}/${week.target_volume.toFixed(0)} mi` : `${week.target_volume.toFixed(0)} mi`}
                  </M>
                  <B color="$textTertiary" fontSize={14}>{isExpanded ? '▾' : '▸'}</B>
                </XStack>
              </XStack>
            </Pressable>

            {/* Expanded Body */}
            {isExpanded && (
              <YStack paddingHorizontal="$3" paddingBottom="$3" borderTopWidth={1} borderTopColor="$border">
                {weekWorkouts.map(workout => {
                  const statusColor = workout.status === 'completed' ? '#34C759' : workout.status === 'skipped' ? '#FF3B30' : workout.status === 'partial' ? '#F59E0B' : '#666666';
                  const isWToday = isToday(workout.scheduled_date);
                  const dayCT = crossTrainingByDate.get(workout.scheduled_date);

                  return (
                    <YStack key={workout.id}>
                      <XStack alignItems="center" paddingVertical="$3" borderBottomWidth={0.5} borderBottomColor="$border"
                        backgroundColor={isWToday ? '$surfaceLight' : 'transparent'} marginHorizontal={isWToday ? -14 : 0}
                        paddingHorizontal={isWToday ? 14 : 0} borderRadius={isWToday ? 8 : 0}
                        pressStyle={workout.workout_type !== 'rest' ? { opacity: 0.7 } : undefined}
                        onPress={workout.workout_type !== 'rest' ? () => router.push(`/workout/${workout.id}`) : undefined}>

                        <MaterialCommunityIcons name={getWorkoutIcon(workout.workout_type) as any} size={16} color={statusColor} style={{ marginRight: 8, width: 16 }} />

                        <YStack flex={1}>
                          <B color="$textTertiary" fontSize={11} fontWeight="600" marginBottom={1}>
                            {formatDate(workout.scheduled_date)}{isWToday ? '  (Today)' : ''}
                          </B>
                          <B color="$color" fontSize={14}>{workout.workout_type === 'rest' ? 'Rest Day' : workout.title}</B>
                        </YStack>

                        {workout.workout_type !== 'rest' && workout.target_distance_miles != null && (
                          <M color="$textSecondary" fontSize={13} fontWeight="700" marginLeft="$2">
                            {workout.target_distance_miles.toFixed(1)} mi
                          </M>
                        )}
                      </XStack>
                      {/* Cross-training on this day */}
                      {dayCT && (
                        <XStack alignItems="center" paddingVertical={6} paddingLeft={24} borderBottomWidth={0.5} borderBottomColor="$border">
                          <MaterialCommunityIcons name="dumbbell" size={12}
                            color={dayCT.impact === 'high' ? '#FF3B30' : dayCT.impact === 'moderate' ? '#FF9500' : dayCT.impact === 'positive' ? '#34C759' : '#666666'}
                            style={{ marginRight: 8 }} />
                          <B color="$textTertiary" fontSize={12}>{CROSS_TRAINING_LABELS[dayCT.type] ?? dayCT.type}</B>
                          <B color="$textTertiary" fontSize={10} marginLeft="$2">({dayCT.impact})</B>
                        </XStack>
                      )}
                    </YStack>
                  );
                })}

                {week.ai_notes && (
                  <YStack paddingTop="$2" marginTop="$1">
                    <B color="$textTertiary" fontSize={12} fontStyle="italic" lineHeight={17}>{week.ai_notes}</B>
                  </YStack>
                )}
              </YStack>
            )}
          </YStack>
        );
      })}

      <YStack height={40} />
    </ScrollView>
  );
}
