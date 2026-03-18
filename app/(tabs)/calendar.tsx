/**
 * Plan Screen — training journey view with phase grouping, volume arc, and rich week cards.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { RefreshControl, Pressable, FlatList, LayoutChangeEvent } from 'react-native';
import { YStack, XStack, Text, View, Spinner } from 'tamagui';
import Svg, { Rect as SvgRect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate, isToday } from '../../src/utils/dateUtils';
import { Workout, CrossTraining, CROSS_TRAINING_LABELS, PerformanceMetric, TrainingWeek, Phase } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getWorkoutIcon } from '../../src/utils/workoutIcons';
import { colors, phaseColors } from '../../src/theme/colors';
import { formatPace } from '../../src/engine/vdot';
import { GradientBorder } from '../../src/theme/GradientBorder';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M_ = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Status icon helper ─────────────────────────────────────

function workoutStatusIcon(workout: Workout, isTodayW: boolean): { name: string; color: string } {
  if (workout.workout_type === 'rest') return { name: 'moon-waning-crescent', color: colors.textTertiary };
  switch (workout.status) {
    case 'completed': return { name: 'check-circle', color: (workout as any).execution_quality === 'on_target' || !(workout as any).execution_quality ? colors.success : colors.orange };
    case 'skipped': return { name: 'close-circle', color: colors.error };
    case 'partial': return { name: 'circle-half-full', color: colors.orange };
    default: return isTodayW ? { name: 'circle-double', color: colors.cyan } : { name: 'circle-outline', color: colors.textTertiary };
  }
}

function workoutNameColor(type: string): string {
  if (type === 'rest' || type === 'recovery') return colors.textTertiary;
  if (['threshold', 'tempo', 'interval', 'intervals', 'marathon_pace'].includes(type)) return colors.orange;
  if (type === 'long_run' || type === 'long') return colors.textPrimary;
  return colors.cyan;
}

// ─── Component ──────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const isLoading = useAppStore(s => s.isLoading);
  const activePlan = useAppStore(s => s.activePlan);
  const userProfile = useAppStore(s => s.userProfile);
  const weeks = useAppStore(s => s.weeks);
  const workouts = useAppStore(s => s.workouts);
  const currentWeekNumber = useAppStore(s => s.currentWeekNumber);
  const daysUntilRace = useAppStore(s => s.daysUntilRace);
  const weeklyDigest = useAppStore(s => s.weeklyDigest);
  const refreshState = useAppStore(s => s.refreshState);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => new Set(currentWeekNumber > 0 ? [currentWeekNumber] : []));
  const [digestDismissed, setDigestDismissed] = useState(false);
  const [arcWidth, setArcWidth] = useState(0);
  const flatListRef = useRef<FlatList>(null);

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

  const crossTrainingByDate = useMemo(() => {
    const map = new Map<string, CrossTraining>();
    try {
      const { getCrossTrainingHistory } = require('../../src/db/database');
      for (const ct of getCrossTrainingHistory(120)) map.set(ct.date, ct);
    } catch {}
    return map;
  }, [workouts]);

  const metricsByWorkout = useMemo(() => {
    const map = new Map<string, PerformanceMetric>();
    try {
      const { getDatabase } = require('../../src/db/database');
      const rows = getDatabase().getAllSync('SELECT * FROM performance_metric WHERE workout_id IS NOT NULL ORDER BY date DESC');
      for (const r of rows) if (r.workout_id && !map.has(r.workout_id)) map.set(r.workout_id, r as PerformanceMetric);
    } catch {}
    return map;
  }, [workouts]);

  const toggleWeek = useCallback((n: number) => {
    setExpandedWeeks(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }, []);

  // Group weeks by phase
  const phaseGroups = useMemo(() => {
    const groups: { phase: Phase; weeks: TrainingWeek[] }[] = [];
    for (const w of weeks) {
      const last = groups[groups.length - 1];
      if (last && last.phase === w.phase) { last.weeks.push(w); }
      else { groups.push({ phase: w.phase, weeks: [w] }); }
    }
    return groups;
  }, [weeks]);

  // Build flat list data: phase headers + week cards
  type ListItem =
    | { type: 'header' }
    | { type: 'arc' }
    | { type: 'digest' }
    | { type: 'phaseHeader'; phase: Phase; startWeek: number; endWeek: number }
    | { type: 'week'; week: TrainingWeek };

  const listData = useMemo(() => {
    const items: ListItem[] = [{ type: 'header' }, { type: 'arc' }];
    if (weeklyDigest && !digestDismissed) items.push({ type: 'digest' });
    for (const g of phaseGroups) {
      items.push({ type: 'phaseHeader', phase: g.phase, startWeek: g.weeks[0].week_number, endWeek: g.weeks[g.weeks.length - 1].week_number });
      for (const w of g.weeks) items.push({ type: 'week', week: w });
    }
    return items;
  }, [phaseGroups, weeklyDigest, digestDismissed]);

  // Scroll to current week on mount
  useEffect(() => {
    if (currentWeekNumber <= 0 || listData.length === 0) return;
    const idx = listData.findIndex(item => item.type === 'week' && (item as any).week.week_number === currentWeekNumber);
    if (idx > 0) setTimeout(() => flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewOffset: 60 }), 300);
  }, []);

  if (isLoading) {
    return <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center"><Spinner size="large" color={colors.cyan} /></YStack>;
  }

  if (!activePlan) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding={32}>
        <View width={56} height={56} borderRadius={28} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom={16}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={28} color={colors.cyan} />
        </View>
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom={8}>No Training Plan</H>
        <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20}>Generate a plan from Settings to see your schedule here.</B>
      </YStack>
    );
  }

  const progressPct = weeks.length > 0 ? Math.round((currentWeekNumber / weeks.length) * 100) : 0;
  const maxVolume = Math.max(...weeks.map(w => Math.max(w.target_volume, w.actual_volume)), 1);

  return (
    <FlatList
      ref={flatListRef}
      data={listData}
      keyExtractor={(item, i) => `${item.type}-${i}`}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refreshState} tintColor={colors.cyan} />}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item }) => {
        // ─── Header ─────────────────────────────────
        if (item.type === 'header') {
          return (
            <YStack backgroundColor={colors.surface} borderRadius={14} padding={16} marginBottom={12}>
              {userProfile?.race_name && (
                <H color={colors.textPrimary} fontSize={20} letterSpacing={1} marginBottom={2}>{userProfile.race_name}</H>
              )}
              {userProfile?.race_date && (
                <B color={colors.textSecondary} fontSize={13} marginBottom={10}>
                  {new Date(userProfile.race_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  {daysUntilRace > 0 ? ` · ${daysUntilRace} days away` : daysUntilRace === 0 ? ' · Today!' : ''}
                </B>
              )}
              <XStack alignItems="center" marginBottom={8}>
                <B color={colors.cyan} fontSize={13} fontWeight="600">
                  Week {currentWeekNumber} of {weeks.length}
                </B>
                {weeks.find(w => w.week_number === currentWeekNumber) && (
                  <B color={colors.textTertiary} fontSize={13}> · {weeks.find(w => w.week_number === currentWeekNumber)!.phase} phase</B>
                )}
              </XStack>
              <View height={6} borderRadius={3} backgroundColor={colors.surfaceHover} overflow="hidden">
                <View height={6} borderRadius={3} backgroundColor={colors.cyan} width={`${progressPct}%` as any} />
              </View>
              <M_ color={colors.textTertiary} fontSize={11} fontWeight="600" marginTop={4} textAlign="right">{progressPct}%</M_>
            </YStack>
          );
        }

        // ─── Volume Arc ─────────────────────────────
        if (item.type === 'arc') {
          return (
            <YStack marginBottom={12} onLayout={(e: LayoutChangeEvent) => setArcWidth(e.nativeEvent.layout.width)}>
              <H color={colors.textSecondary} fontSize={11} letterSpacing={1.5} textTransform="uppercase" marginBottom={8}>Volume Arc</H>
              {arcWidth > 0 && (
                <View height={100} borderRadius={10} backgroundColor={colors.surface} overflow="hidden" padding={8}>
                  <Svg width={arcWidth - 16} height={84}>
                    <Defs>
                      <LinearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                        <Stop offset="0" stopColor={colors.cyan} />
                        <Stop offset="1" stopColor={colors.orange} />
                      </LinearGradient>
                    </Defs>
                    {weeks.map((w, i) => {
                      const barW = Math.max(((arcWidth - 16) / weeks.length) - 2, 3);
                      const x = i * ((arcWidth - 16) / weeks.length) + 1;
                      const targetH = (w.target_volume / maxVolume) * 70;
                      const actualH = (w.actual_volume / maxVolume) * 70;
                      const isCurr = w.week_number === currentWeekNumber;
                      const isPast = w.week_number < currentWeekNumber;
                      return (
                        <React.Fragment key={w.id}>
                          {/* Target outline */}
                          <SvgRect x={x} y={84 - targetH} width={barW} height={targetH}
                            fill="none" stroke={colors.border} strokeWidth={0.5} rx={1.5} />
                          {/* Actual fill */}
                          {isPast && actualH > 0 && (
                            <SvgRect x={x} y={84 - actualH} width={barW} height={actualH}
                              fill={actualH >= targetH * 0.8 ? colors.cyan : colors.orange} rx={1.5} opacity={0.7} />
                          )}
                          {isCurr && (
                            <SvgRect x={x} y={84 - Math.max(actualH, 2)} width={barW} height={Math.max(actualH, 2)}
                              fill="url(#barGrad)" rx={1.5} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </Svg>
                </View>
              )}
              {/* Phase labels */}
              <XStack marginTop={4} gap={4}>
                {phaseGroups.map((g, i) => (
                  <View key={i} flex={g.weeks.length} height={3} borderRadius={1.5}
                    backgroundColor={(phaseColors as any)[g.phase] ?? colors.textTertiary} opacity={0.5} />
                ))}
              </XStack>
            </YStack>
          );
        }

        // ─── Weekly Digest ──────────────────────────
        if (item.type === 'digest' && weeklyDigest) {
          return (
            <YStack backgroundColor={colors.surface} borderRadius={14} padding={14} marginBottom={12} borderLeftWidth={3} borderLeftColor={colors.cyan}>
              <XStack justifyContent="space-between" alignItems="center" marginBottom={8}>
                <H color={colors.cyan} fontSize={11} letterSpacing={1.5} textTransform="uppercase">Weekly Review</H>
                <B color={colors.textTertiary} fontSize={12} onPress={() => setDigestDismissed(true)}>Dismiss</B>
              </XStack>
              <B color={colors.textSecondary} fontSize={13} lineHeight={19}>{weeklyDigest.summary}</B>
              {weeklyDigest.nextWeekPreview && <B color={colors.textTertiary} fontSize={12} fontStyle="italic" marginTop={6}>{weeklyDigest.nextWeekPreview}</B>}
            </YStack>
          );
        }

        // ─── Phase Header ───────────────────────────
        if (item.type === 'phaseHeader') {
          const { phase, startWeek, endWeek } = item as { type: 'phaseHeader'; phase: Phase; startWeek: number; endWeek: number };
          const pColor = (phaseColors as any)[phase] ?? colors.textTertiary;
          return (
            <XStack alignItems="center" marginTop={16} marginBottom={8} gap={8}>
              <View height={1} flex={1} backgroundColor={pColor} opacity={0.3} />
              <H color={pColor} fontSize={12} letterSpacing={1.5} textTransform="uppercase">
                {phase} {startWeek === endWeek ? `(Week ${startWeek})` : `(Weeks ${startWeek}-${endWeek})`}
              </H>
              <View height={1} flex={1} backgroundColor={pColor} opacity={0.3} />
            </XStack>
          );
        }

        // ─── Week Card ──────────────────────────────
        if (item.type === 'week') {
          const week = (item as { type: 'week'; week: TrainingWeek }).week;
          const isExpanded = expandedWeeks.has(week.week_number);
          const isCurrent = week.week_number === currentWeekNumber;
          const isPast = week.week_number < currentWeekNumber;
          const isFuture = week.week_number > currentWeekNumber;
          const weekWorkouts = workoutsByWeek.get(week.week_number) ?? [];
          const volPct = week.target_volume > 0 ? Math.round((week.actual_volume / week.target_volume) * 100) : 0;
          const completedRuns = weekWorkouts.filter(w => w.status === 'completed' || w.status === 'partial').length;
          const totalRuns = weekWorkouts.filter(w => w.workout_type !== 'rest').length;

          // Future collapsed card
          if (isFuture && !isExpanded) {
            return (
              <Pressable onPress={() => toggleWeek(week.week_number)}>
                <XStack backgroundColor={colors.surface} borderRadius={10} paddingHorizontal={14} paddingVertical={10} marginBottom={6}
                  alignItems="center" justifyContent="space-between" opacity={0.7}>
                  <XStack alignItems="center" gap={8}>
                    <H color={colors.textSecondary} fontSize={13} letterSpacing={0.5}>Week {week.week_number}</H>
                    {week.is_cutback && <B color={colors.textTertiary} fontSize={10}>CUTBACK</B>}
                  </XStack>
                  <XStack alignItems="center" gap={6}>
                    <M_ color={colors.textTertiary} fontSize={12}>{week.target_volume.toFixed(0)} mi</M_>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textTertiary} />
                  </XStack>
                </XStack>
              </Pressable>
            );
          }

          const weekCard = (
            <YStack backgroundColor={colors.surface} borderRadius={14} marginBottom={8} overflow="hidden"
              borderLeftWidth={isCurrent ? 3 : 0} borderLeftColor={isCurrent ? colors.cyan : 'transparent'}>
              {/* Week header */}
              <Pressable onPress={() => toggleWeek(week.week_number)}>
                <YStack padding={14}>
                  <XStack justifyContent="space-between" alignItems="center">
                    <XStack alignItems="center" gap={8}>
                      <H color={isCurrent ? colors.cyan : colors.textPrimary} fontSize={14} letterSpacing={0.5}>Week {week.week_number}</H>
                      {week.is_cutback && (
                        <View paddingHorizontal={6} paddingVertical={2} borderRadius={4} backgroundColor={colors.surfaceHover}>
                          <H fontSize={9} color={colors.textTertiary} letterSpacing={1}>CUTBACK</H>
                        </View>
                      )}
                    </XStack>
                    <XStack alignItems="center" gap={6}>
                      {isPast && completedRuns > 0 && (
                        <MaterialCommunityIcons name={volPct >= 80 ? 'check-circle' : 'alert-circle'} size={14}
                          color={volPct >= 80 ? colors.success : colors.orange} />
                      )}
                      <M_ color={week.actual_volume > 0 ? (volPct >= 80 ? colors.cyan : colors.orange) : colors.textSecondary} fontSize={12} fontWeight="700">
                        {week.actual_volume > 0 ? `${week.actual_volume.toFixed(0)}/${week.target_volume.toFixed(0)} mi` : `${week.target_volume.toFixed(0)} mi`}
                      </M_>
                      <MaterialCommunityIcons name={isExpanded ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textTertiary} />
                    </XStack>
                  </XStack>
                  {/* Volume bar */}
                  {(isPast || isCurrent) && week.actual_volume > 0 && (
                    <View height={4} borderRadius={2} backgroundColor={colors.surfaceHover} marginTop={8} overflow="hidden">
                      <View height={4} borderRadius={2} backgroundColor={volPct >= 80 ? colors.cyan : colors.orange}
                        width={`${Math.min(volPct, 100)}%` as any} />
                    </View>
                  )}
                  {/* Past week summary */}
                  {isPast && !isExpanded && completedRuns > 0 && (
                    <B color={colors.textTertiary} fontSize={11} marginTop={4}>
                      {completedRuns}/{totalRuns} runs · {volPct}%
                    </B>
                  )}
                </YStack>
              </Pressable>

              {/* Expanded workouts */}
              {isExpanded && (
                <YStack paddingHorizontal={14} paddingBottom={12} borderTopWidth={0.5} borderTopColor={colors.border}>
                  {weekWorkouts.map(workout => {
                    const isTodayW = isToday(workout.scheduled_date);
                    const { name: iconName, color: iconColor } = workoutStatusIcon(workout, isTodayW);
                    const dayCT = crossTrainingByDate.get(workout.scheduled_date);
                    const metric = (workout.status === 'completed' || workout.status === 'partial') ? metricsByWorkout.get(workout.id) : null;
                    const isSkipped = workout.status === 'skipped';
                    const nameColor = isSkipped ? colors.textTertiary : workoutNameColor(workout.workout_type);

                    return (
                      <YStack key={workout.id} opacity={isSkipped ? 0.5 : 1}>
                        <Pressable onPress={workout.workout_type !== 'rest' ? () => router.push(`/workout/${workout.id}`) : undefined}>
                          <YStack paddingVertical={10} borderBottomWidth={0.5} borderBottomColor={colors.border}
                            backgroundColor={isTodayW ? colors.cyanGhost : 'transparent'}
                            marginHorizontal={isTodayW ? -14 : 0} paddingHorizontal={isTodayW ? 14 : 0}
                            borderRadius={isTodayW ? 8 : 0}>
                            <XStack alignItems="center">
                              <View width={20} marginRight={8} alignItems="center">
                                <MaterialCommunityIcons name={iconName as any} size={16} color={iconColor} />
                              </View>
                              <YStack flex={1}>
                                <B color={colors.textTertiary} fontSize={10}>{formatDate(workout.scheduled_date)}{isTodayW ? ' (Today)' : ''}</B>
                                <B color={nameColor} fontSize={13} fontWeight="600"
                                  textDecorationLine={isSkipped ? 'line-through' : 'none'}>
                                  {workout.workout_type === 'rest' ? 'Rest Day' : workout.title}
                                </B>
                              </YStack>
                              {workout.workout_type !== 'rest' && (
                                <M_ color={isSkipped ? colors.textTertiary : colors.textPrimary} fontSize={12} fontWeight="700"
                                  textDecorationLine={isSkipped ? 'line-through' : 'none'}>
                                  {metric ? `${metric.distance_miles.toFixed(1)} mi` : workout.target_distance_miles != null ? `${workout.target_distance_miles.toFixed(1)} mi` : ''}
                                </M_>
                              )}
                            </XStack>
                            {metric && (
                              <XStack marginLeft={28} marginTop={3} gap={8}>
                                {metric.avg_pace_sec_per_mile ? <M_ color={colors.textSecondary} fontSize={11}>{formatPace(metric.avg_pace_sec_per_mile)}/mi</M_> : null}
                                {metric.avg_hr ? <M_ color={colors.orange} fontSize={11}>{metric.avg_hr} bpm</M_> : null}
                              </XStack>
                            )}
                          </YStack>
                        </Pressable>
                        {dayCT && (
                          <XStack alignItems="center" paddingVertical={4} paddingLeft={28}>
                            <MaterialCommunityIcons name="dumbbell" size={11}
                              color={dayCT.impact === 'high' ? colors.orange : dayCT.impact === 'positive' ? colors.cyan : colors.textTertiary}
                              style={{ marginRight: 6 }} />
                            <B color={colors.textTertiary} fontSize={11}>{CROSS_TRAINING_LABELS[dayCT.type]}</B>
                          </XStack>
                        )}
                      </YStack>
                    );
                  })}
                  {week.ai_notes && (
                    <B color={colors.textTertiary} fontSize={11} fontStyle="italic" lineHeight={16} marginTop={8}>{week.ai_notes}</B>
                  )}
                </YStack>
              )}
            </YStack>
          );

          if (isCurrent) {
            return weekCard;
          }
          return weekCard;
        }

        return null;
      }}
    />
  );
}

// Need React import for Fragment
import React from 'react';
