import { useState, useCallback, useMemo } from 'react';
import { RefreshControl } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { PHASE_COLORS, WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate, isToday } from '../../src/utils/dateUtils';
import { Workout } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getWorkoutIcon } from '../../src/utils/workoutIcons';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

export default function CalendarScreen() {
  const router = useRouter();
  const isLoading = useAppStore(s => s.isLoading);
  const activePlan = useAppStore(s => s.activePlan);
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

  const adherence = useMemo(() => {
    const past = workouts.filter(w => w.workout_type !== 'rest' && (w.status === 'completed' || w.status === 'skipped'));
    if (past.length === 0) return null;
    return Math.round((past.filter(w => w.status === 'completed').length / past.length) * 100);
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
              <B color="$warning" fontSize={13}>Adaptation suggested: {weeklyDigest.adaptationReason}</B>
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
            <XStack justifyContent="space-between" alignItems="center" padding="$3"
              pressStyle={{ opacity: 0.8 }} onPress={() => toggleWeek(week.week_number)}>
              <XStack alignItems="center" gap="$2" flexShrink={1}>
                <H color={isCurrent ? '$accent' : '$color'} fontSize={15} letterSpacing={1}>Week {week.week_number}</H>
                <YStack paddingHorizontal="$2" paddingVertical={2} borderRadius="$2" backgroundColor={phaseColor + '22'}>
                  <H color={phaseColor} fontSize={11} textTransform="uppercase" letterSpacing={1}>
                    {week.phase.charAt(0).toUpperCase() + week.phase.slice(1)}
                  </H>
                </YStack>
                {week.is_cutback && (
                  <YStack backgroundColor="rgba(174,174,178,0.15)" paddingHorizontal="$1" paddingVertical={2} borderRadius="$1">
                    <H color="$textTertiary" fontSize={10} textTransform="uppercase" letterSpacing={1}>Cutback</H>
                  </YStack>
                )}
              </XStack>
              <XStack alignItems="center" gap="$2">
                <M color="$textSecondary" fontSize={13} fontWeight="700">
                  {completedVolume > 0 ? `${completedVolume.toFixed(0)}/${week.target_volume.toFixed(0)} mi` : `${week.target_volume.toFixed(0)} mi`}
                </M>
                <B color="$textTertiary" fontSize={14}>{isExpanded ? '▾' : '▸'}</B>
              </XStack>
            </XStack>

            {/* Expanded Body */}
            {isExpanded && (
              <YStack paddingHorizontal="$3" paddingBottom="$3" borderTopWidth={1} borderTopColor="$border">
                {weekWorkouts.map(workout => {
                  const statusColor = workout.status === 'completed' ? '#34C759' : workout.status === 'skipped' ? '#FF3B30' : '#666666';
                  const isWToday = isToday(workout.scheduled_date);

                  return (
                    <XStack key={workout.id} alignItems="center" paddingVertical="$3" borderBottomWidth={0.5} borderBottomColor="$border"
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
