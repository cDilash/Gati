/**
 * Plan Screen — training journey view with phase grouping, volume arc, and rich week cards.
 * Supports two view modes: List (default) and Calendar (7-day grid).
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { RefreshControl, Pressable, FlatList, LayoutChangeEvent, Dimensions, ScrollView as RNScrollView, Alert, ActionSheetIOS, Platform, PanResponder, Animated } from 'react-native';
import { YStack, XStack, Text, View, Spinner } from 'tamagui';
import Svg, { Rect as SvgRect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { WORKOUT_TYPE_LABELS } from '../../src/utils/constants';
import { formatDate, isToday, getToday, addDays } from '../../src/utils/dateUtils';
import { Workout, CrossTraining, CROSS_TRAINING_LABELS, PerformanceMetric, TrainingWeek, Phase } from '../../src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getWorkoutIcon } from '../../src/utils/workoutIcons';
import { colors, phaseColors } from '../../src/theme/colors';
import { GradientBorder } from '../../src/theme/GradientBorder';
import { useUnits } from '../../src/hooks/useUnits';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M_ = (props: any) => <Text fontFamily="$mono" {...props} />;

const SCREEN_W = Dimensions.get('window').width;
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Get the Monday of the week containing the given date string */
function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Status icon helper ─────────────────────────────────────

function workoutStatusIcon(workout: Workout, isTodayW: boolean): { name: string; color: string } {
  if (workout.workout_type === 'rest') return { name: 'battery-heart-outline', color: colors.textTertiary };
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
  const u = useUnits();
  const isLoading = useAppStore(s => s.isLoading);
  const activePlan = useAppStore(s => s.activePlan);
  const userProfile = useAppStore(s => s.userProfile);
  const weeks = useAppStore(s => s.weeks);
  const workouts = useAppStore(s => s.workouts);
  const currentWeekNumber = useAppStore(s => s.currentWeekNumber);
  const daysUntilRace = useAppStore(s => s.daysUntilRace);
  const weeklyDigest = useAppStore(s => s.weeklyDigest);
  const refreshState = useAppStore(s => s.refreshState);
  const syncAll = useAppStore(s => s.syncAll);
  const isSyncing = useAppStore(s => s.isSyncing);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => new Set(currentWeekNumber > 0 ? [currentWeekNumber] : []));
  const [digestDismissed, setDigestDismissed] = useState(false);
  const [arcWidth, setArcWidth] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  // View mode: 'list' or 'calendar'
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>(() => {
    try { const { getSetting } = require('../../src/db/database'); return (getSetting('plan_view_mode') as 'list' | 'calendar') ?? 'list'; } catch { return 'list'; }
  });
  const switchViewMode = useCallback((mode: 'list' | 'calendar') => {
    setViewMode(mode);
    try { const { setSetting } = require('../../src/db/database'); setSetting('plan_view_mode', mode); } catch {}
  }, []);

  // Calendar week navigation
  const [calendarMonday, setCalendarMonday] = useState<string>(() => getMonday(getToday()));
  const [addMenuDate, setAddMenuDate] = useState<string | null>(null);

  // Show action sheet when addMenuDate is set
  useEffect(() => {
    if (!addMenuDate) return;
    const dateLabel = new Date(addMenuDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const ctTypes = ['Leg Day', 'Upper Body', 'Full Body', 'Cycling', 'Swimming', 'Yoga/Mobility'];
    const ctKeys = ['leg_day', 'upper_body', 'full_body', 'cycling', 'swimming', 'yoga_mobility'];
    const targetDate = addMenuDate;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `Add activity · ${dateLabel}`, options: [...ctTypes, 'Cancel'], cancelButtonIndex: ctTypes.length },
        (idx) => {
          if (idx < ctTypes.length) {
            try {
              const { getDatabase } = require('../../src/db/database');
              const Crypto = require('expo-crypto');
              const db = getDatabase();
              const impact = idx === 0 ? 'high' : idx === 5 ? 'positive' : 'moderate';
              db.runSync(
                'INSERT INTO cross_training (id, date, type, impact, notes) VALUES (?, ?, ?, ?, ?)',
                Crypto.randomUUID(), targetDate, ctKeys[idx], impact, null
              );
              refreshState();
            } catch {}
          }
          setAddMenuDate(null);
        }
      );
    } else {
      Alert.alert(`Add activity · ${dateLabel}`, 'Choose cross-training type',
        [...ctTypes.map((label, idx) => ({
          text: label,
          onPress: () => {
            try {
              const { getDatabase } = require('../../src/db/database');
              const Crypto = require('expo-crypto');
              const db = getDatabase();
              const impact = idx === 0 ? 'high' : idx === 5 ? 'positive' : 'moderate';
              db.runSync(
                'INSERT INTO cross_training (id, date, type, impact, notes) VALUES (?, ?, ?, ?, ?)',
                Crypto.randomUUID(), targetDate, ctKeys[idx], impact, null
              );
              refreshState();
            } catch {}
            setAddMenuDate(null);
          },
        })),
        { text: 'Cancel', style: 'cancel', onPress: () => setAddMenuDate(null) },
      ]);
    }
  }, [addMenuDate]);

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

  // ─── Calendar: compute week data ────────────────────────
  const calendarDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(calendarMonday, i));
  }, [calendarMonday]);

  const calendarWeek = useMemo(() => {
    // Find the training week that contains these dates
    for (const w of weeks) {
      const weekWorkouts = workoutsByWeek.get(w.week_number) ?? [];
      if (weekWorkouts.some(wo => calendarDays.includes(wo.scheduled_date))) return w;
    }
    return null;
  }, [calendarDays, weeks, workoutsByWeek]);

  // Plan date range for boundary checks
  const planDateRange = useMemo(() => {
    if (workouts.length === 0) return null;
    const dates = workouts.map(w => w.scheduled_date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [workouts]);

  // Is this a race day date?
  const raceDateStr = userProfile?.race_date ?? null;

  const calendarWeekLabel = useMemo(() => {
    const mon = new Date(calendarMonday + 'T12:00:00');
    const sun = new Date(calendarDays[6] + 'T12:00:00');
    const monStr = `${MONTHS_SHORT[mon.getMonth()]} ${mon.getDate()}`;
    const sunStr = mon.getMonth() === sun.getMonth()
      ? `${sun.getDate()}`
      : `${MONTHS_SHORT[sun.getMonth()]} ${sun.getDate()}`;
    return `${monStr} – ${sunStr}`;
  }, [calendarMonday, calendarDays]);

  // Swipe animation
  const slideAnim = useRef(new Animated.Value(0)).current;

  const navigateWeek = useCallback((dir: -1 | 1) => {
    // Slide out in the swipe direction, then snap in from opposite side
    Animated.timing(slideAnim, { toValue: -dir * SCREEN_W * 0.3, duration: 120, useNativeDriver: true }).start(() => {
      setCalendarMonday(prev => addDays(prev, dir * 7));
      slideAnim.setValue(dir * SCREEN_W * 0.3);
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }).start();
    });
  }, []);

  const goToCurrentWeek = useCallback(() => {
    setCalendarMonday(getMonday(getToday()));
    slideAnim.setValue(0);
  }, []);

  // Swipe gesture for week navigation
  const swipeRef = useRef({ startX: 0 });
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 20 && Math.abs(gs.dy) < 40,
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > 50) navigateWeek(-1);      // swipe right = prev week
      else if (gs.dx < -50) navigateWeek(1);  // swipe left = next week
    },
  })).current;

  // ─── View Mode Toggle ──────────────────────────────────
  const ViewToggle = (
    <XStack alignItems="center" justifyContent="center" marginBottom={12}>
      <XStack backgroundColor={colors.surface} borderRadius={12} padding={3} borderWidth={0.5} borderColor={colors.border}>
        {(['list', 'calendar'] as const).map(mode => {
          const active = viewMode === mode;
          return (
            <Pressable key={mode} onPress={() => switchViewMode(mode)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <XStack alignItems="center" gap={5}
                backgroundColor={active ? colors.surfaceHover : 'transparent'}
                paddingHorizontal={16} paddingVertical={7} borderRadius={9}>
                <MaterialCommunityIcons
                  name={mode === 'list' ? 'format-list-bulleted' : 'calendar-month-outline'}
                  size={14} color={active ? colors.cyan : colors.textTertiary} />
                <B color={active ? colors.textPrimary : colors.textTertiary}
                  fontSize={12} fontWeight={active ? '700' : '400'}>
                  {mode === 'list' ? 'List' : 'Calendar'}
                </B>
              </XStack>
            </Pressable>
          );
        })}
      </XStack>
    </XStack>
  );

  // ─── Calendar View ──────────────────────────────────────
  if (viewMode === 'calendar') {
    const todayStr = getToday();
    const colW = (SCREEN_W - 32 - 12) / 7; // 16px padding each side, 12px total gaps

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <RNScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={syncAll} tintColor={colors.cyan} />}>

          {/* View toggle */}
          {ViewToggle}

          {/* Week navigator */}
          <XStack alignItems="center" justifyContent="space-between" marginBottom={8}>
            <Pressable onPress={() => navigateWeek(-1)} hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
              <View width={34} height={34} borderRadius={17} backgroundColor={colors.surface}
                borderWidth={0.5} borderColor={colors.border} alignItems="center" justifyContent="center">
                <MaterialCommunityIcons name="chevron-left" size={20} color={colors.textSecondary} />
              </View>
            </Pressable>

            <Pressable onPress={goToCurrentWeek}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <YStack alignItems="center">
                <XStack alignItems="center" gap={6}>
                  <H color={colors.textPrimary} fontSize={15} letterSpacing={1.2}>{calendarWeekLabel}</H>
                  {calendarWeek && (
                    <View paddingHorizontal={7} paddingVertical={2} borderRadius={4}
                      backgroundColor={((phaseColors as any)[calendarWeek.phase] ?? colors.textTertiary) + '22'}>
                      <H fontSize={9} letterSpacing={1.2} color={(phaseColors as any)[calendarWeek.phase] ?? colors.textTertiary}>
                        {calendarWeek.phase.toUpperCase()}
                      </H>
                    </View>
                  )}
                </XStack>
                {calendarWeek ? (
                  <XStack alignItems="center" gap={4} marginTop={2}>
                    <B color={colors.textTertiary} fontSize={11}>
                      Week {calendarWeek.week_number} of {weeks.length}
                    </B>
                    {calendarWeek.is_cutback && (
                      <B color={colors.textTertiary} fontSize={9}>· CUTBACK</B>
                    )}
                  </XStack>
                ) : (
                  <B color={colors.textTertiary} fontSize={11} marginTop={2}>Outside plan range</B>
                )}
              </YStack>
            </Pressable>

            <Pressable onPress={() => navigateWeek(1)} hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
              <View width={34} height={34} borderRadius={17} backgroundColor={colors.surface}
                borderWidth={0.5} borderColor={colors.border} alignItems="center" justifyContent="center">
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
              </View>
            </Pressable>
          </XStack>

          {/* "Today" jump button — only when not on current week */}
          {calendarMonday !== getMonday(getToday()) && (
            <XStack justifyContent="center" marginBottom={8}>
              <Pressable onPress={goToCurrentWeek}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                <XStack alignItems="center" gap={5} backgroundColor={colors.cyanGhost}
                  borderWidth={1} borderColor={colors.cyan} borderRadius={16}
                  paddingHorizontal={16} height={32}>
                  <MaterialCommunityIcons name="calendar-today" size={14} color={colors.cyan} />
                  <B color={colors.cyan} fontSize={13} fontWeight="600">Today</B>
                </XStack>
              </Pressable>
            </XStack>
          )}

          {/* Phase color band */}
          {calendarWeek && (
            <View height={2} borderRadius={1} marginBottom={10} overflow="hidden">
              <View height={2} borderRadius={1} width="100%"
                backgroundColor={(phaseColors as any)[calendarWeek.phase] ?? colors.textTertiary} opacity={0.4} />
            </View>
          )}

          {/* Week summary bar */}
          {calendarWeek && (() => {
            const weekWO = workouts.filter(w => calendarDays.includes(w.scheduled_date) && w.workout_type !== 'rest');
            const completedRuns = weekWO.filter(w => w.status === 'completed' || w.status === 'partial').length;
            const totalMi = weekWO.reduce((sum, w) => {
              const metric = (w.status === 'completed' || w.status === 'partial') ? metricsByWorkout.get(w.id) : null;
              return sum + (metric ? metric.distance_miles : (w.target_distance_miles ?? 0));
            }, 0);
            return (
              <XStack alignItems="center" justifyContent="center" gap={8} marginBottom={10}>
                <M_ color={colors.textSecondary} fontSize={11} fontWeight="700">{u.dist(totalMi)}</M_>
                <B color={colors.textTertiary} fontSize={10}>·</B>
                <B color={colors.textTertiary} fontSize={10}>{completedRuns}/{weekWO.length} runs</B>
                {calendarWeek.target_volume > 0 && (
                  <>
                    <B color={colors.textTertiary} fontSize={10}>·</B>
                    <M_ color={calendarWeek.actual_volume >= calendarWeek.target_volume * 0.8 ? colors.cyan : colors.textTertiary}
                      fontSize={10} fontWeight="600">
                      {Math.round((calendarWeek.actual_volume / calendarWeek.target_volume) * 100)}%
                    </M_>
                  </>
                )}
              </XStack>
            );
          })()}

          {/* Swipeable calendar grid */}
          <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX: slideAnim }] }}>

          {/* Day headers + date numbers + activity dots */}
          <XStack justifyContent="space-between" marginBottom={4}>
            {calendarDays.map((dateStr, i) => {
              const d = new Date(dateStr + 'T12:00:00');
              const dayNum = d.getDate();
              const isTodayCol = dateStr === todayStr;

              // Activity dots for this day
              const isRaceDayDot = dateStr === raceDateStr;
              const dayWO = workouts.filter(w => w.scheduled_date === dateStr && w.workout_type !== 'rest');
              const dayCT = crossTrainingByDate.get(dateStr);
              const dots: { color: string }[] = [];
              if (isRaceDayDot) {
                dots.push({ color: colors.cyan }); // race day = single cyan dot
              } else {
                for (const w of dayWO) {
                  if (w.status === 'completed') dots.push({ color: colors.success });
                  else if (w.status === 'skipped') dots.push({ color: colors.error });
                  else if (w.status === 'partial') dots.push({ color: colors.orange });
                  else {
                    const isQuality = ['threshold', 'tempo', 'interval', 'intervals', 'marathon_pace'].includes(w.workout_type);
                    const isLong = w.workout_type === 'long_run' || w.workout_type === 'long';
                    dots.push({ color: isQuality ? colors.orange : isLong ? colors.orange : colors.cyan });
                  }
                }
              }
              if (dayCT) dots.push({ color: '#9B59B6' }); // purple for cross-training

              return (
                <YStack key={dateStr} width={colW} alignItems="center" gap={2}>
                  <H color={isTodayCol ? colors.cyan : colors.textTertiary} fontSize={10} letterSpacing={1}>
                    {DAY_LABELS[i]}
                  </H>
                  <View width={26} height={26} borderRadius={13} alignItems="center" justifyContent="center"
                    backgroundColor={isTodayCol ? colors.cyan : 'transparent'}>
                    <M_ color={isTodayCol ? colors.background : colors.textSecondary} fontSize={13} fontWeight={isTodayCol ? '800' : '500'}>
                      {dayNum}
                    </M_>
                  </View>
                  {/* Activity dots */}
                  <XStack gap={2} height={8} alignItems="center" justifyContent="center">
                    {dots.map((dot, di) => (
                      <View key={di} width={5} height={5} borderRadius={2.5} backgroundColor={dot.color} />
                    ))}
                  </XStack>
                </YStack>
              );
            })}
          </XStack>

          {/* Outside plan range message */}
          {!calendarWeek && planDateRange && (
            <YStack alignItems="center" paddingVertical={24} opacity={0.5}>
              <MaterialCommunityIcons name="calendar-remove-outline" size={24} color={colors.textTertiary} />
              <B color={colors.textTertiary} fontSize={12} marginTop={6}>
                {calendarDays[0] < planDateRange.start ? 'Before plan start' : 'After plan end'}
              </B>
            </YStack>
          )}

          {/* Workout columns */}
          <XStack justifyContent="space-between" marginTop={8}>
            {calendarDays.map((dateStr) => {
              const isTodayCol = dateStr === todayStr;
              const isRaceDay = dateStr === raceDateStr;
              const dayWorkouts = workouts.filter(w => w.scheduled_date === dateStr);
              const runWorkouts = dayWorkouts.filter(w => w.workout_type !== 'rest');
              const isRest = dayWorkouts.length > 0 && runWorkouts.length === 0;
              const dayCT = crossTrainingByDate.get(dateStr);

              return (
                <YStack key={dateStr} width={colW} alignItems="center"
                  backgroundColor={isTodayCol ? colors.cyanGhost : 'transparent'}
                  borderRadius={8} paddingVertical={6} minHeight={90}>

                  {/* Race day special block */}
                  {isRaceDay && (
                    <YStack width={colW - 4} borderRadius={10} padding={6} alignItems="center"
                      borderWidth={1.5} borderColor={colors.cyan}
                      backgroundColor={colors.cyanGhost} marginBottom={4}>
                      <MaterialCommunityIcons name="trophy" size={16} color={colors.cyan} />
                      <H color={colors.cyan} fontSize={8} letterSpacing={1} marginTop={2}>RACE</H>
                      <H color={colors.cyan} fontSize={7} letterSpacing={0.5}>DAY</H>
                    </YStack>
                  )}

                  {/* Run workout blocks */}
                  {!isRaceDay && runWorkouts.map(w => {
                    const metric = (w.status === 'completed' || w.status === 'partial') ? metricsByWorkout.get(w.id) : null;
                    const isCompleted = w.status === 'completed';
                    const isSkipped = w.status === 'skipped';
                    const isPartial = w.status === 'partial';
                    const typeColor = isCompleted ? colors.success
                      : isSkipped ? colors.error
                      : isPartial ? colors.orange
                      : workoutNameColor(w.workout_type);

                    // Short workout type label
                    const shortType = w.workout_type === 'long_run' || w.workout_type === 'long' ? 'Long'
                      : w.workout_type === 'easy' ? 'Easy'
                      : w.workout_type === 'recovery' ? 'Rec'
                      : w.workout_type === 'threshold' || w.workout_type === 'tempo' ? 'Tempo'
                      : w.workout_type === 'interval' || w.workout_type === 'intervals' ? 'Ints'
                      : w.workout_type === 'marathon_pace' ? 'MP'
                      : w.workout_type.slice(0, 4);

                    return (
                      <Pressable key={w.id} onPress={() => router.push(`/workout/${w.id}`)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                        <YStack width={colW - 6}
                          backgroundColor={isSkipped ? 'transparent' : isCompleted ? colors.surface : colors.surface}
                          borderRadius={8} borderLeftWidth={3} borderLeftColor={typeColor}
                          borderWidth={isSkipped ? 0.5 : (isTodayCol && !isCompleted && !isSkipped) ? 1 : 0}
                          borderColor={isSkipped ? colors.border : (isTodayCol && !isCompleted) ? colors.cyanDim : colors.border}
                          padding={5} marginBottom={3} opacity={isSkipped ? 0.45 : 1}>

                          {/* Status icon overlay for completed/skipped */}
                          {(isCompleted || isSkipped) && (
                            <View style={{ position: 'absolute', top: 3, right: 3, zIndex: 1 }}>
                              <MaterialCommunityIcons
                                name={isCompleted ? 'check-circle' : 'close-circle'}
                                size={10}
                                color={isCompleted ? colors.success : colors.error} />
                            </View>
                          )}

                          {/* Workout name */}
                          <B color={isSkipped ? colors.textTertiary : colors.textSecondary} fontSize={8}
                            numberOfLines={1} textDecorationLine={isSkipped ? 'line-through' : 'none'}>
                            {shortType}
                          </B>

                          {/* Distance: actual if completed, target if planned */}
                          {isCompleted && metric ? (
                            <YStack>
                              <M_ color={colors.textPrimary} fontSize={11} fontWeight="800">
                                {u.dist(metric.distance_miles)}
                              </M_>
                              {metric.avg_pace_sec_per_mile ? (
                                <M_ color={colors.textTertiary} fontSize={8}>
                                  {u.pace(metric.avg_pace_sec_per_mile)}
                                </M_>
                              ) : null}
                            </YStack>
                          ) : isPartial && metric ? (
                            <YStack>
                              <M_ color={colors.orange} fontSize={11} fontWeight="800">
                                {u.dist(metric.distance_miles)}
                              </M_>
                              <M_ color={colors.textTertiary} fontSize={7}>
                                of {u.dist(w.target_distance_miles ?? 0)}
                              </M_>
                            </YStack>
                          ) : (
                            <M_ color={isSkipped ? colors.textTertiary : colors.textPrimary} fontSize={11} fontWeight="700"
                              textDecorationLine={isSkipped ? 'line-through' : 'none'}>
                              {w.target_distance_miles != null ? u.dist(w.target_distance_miles) : '–'}
                            </M_>
                          )}
                        </YStack>
                      </Pressable>
                    );
                  })}

                  {/* Cross-training block */}
                  {dayCT && (
                    <YStack width={colW - 6} borderRadius={6} padding={3} marginBottom={2}
                      borderWidth={0.5} borderColor={dayCT.impact === 'high' ? colors.orangeDim : dayCT.impact === 'positive' ? colors.cyanDim : colors.border}
                      borderStyle="dashed">
                      <XStack alignItems="center" gap={2}>
                        <MaterialCommunityIcons name="dumbbell" size={8}
                          color={dayCT.impact === 'high' ? colors.orange : dayCT.impact === 'positive' ? colors.cyan : colors.textTertiary} />
                        <B color={colors.textTertiary} fontSize={7} numberOfLines={1}>
                          {CROSS_TRAINING_LABELS[dayCT.type]?.split(' ')[0] ?? 'XT'}
                        </B>
                      </XStack>
                    </YStack>
                  )}

                  {/* Rest day */}
                  {!isRaceDay && isRest && !dayCT && (
                    <YStack alignItems="center" justifyContent="center" flex={1} marginTop={4}>
                      <MaterialCommunityIcons name="battery-heart-outline" size={12} color={colors.textTertiary} style={{ opacity: 0.4 }} />
                    </YStack>
                  )}

                  {/* Empty day (no plan data) */}
                  {!isRaceDay && dayWorkouts.length === 0 && !dayCT && (
                    <View height={40} />
                  )}

                  {/* "+ Add" button — past/today only, when no upcoming run or after completion */}
                  {dateStr <= todayStr && !dayCT && (
                    runWorkouts.length === 0 || runWorkouts.every(w => w.status === 'completed' || w.status === 'skipped' || w.status === 'partial')
                  ) && (
                    <Pressable onPress={() => setAddMenuDate(dateStr)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.4, marginTop: 2 })}>
                      <View width={22} height={22} borderRadius={11} borderWidth={1} borderColor={colors.border}
                        alignItems="center" justifyContent="center">
                        <MaterialCommunityIcons name="plus" size={12} color={colors.textTertiary} />
                      </View>
                    </Pressable>
                  )}
                </YStack>
              );
            })}
          </XStack>

          </Animated.View>

          {/* Add menu is handled via useEffect below */}

        </RNScrollView>
      </View>
    );
  }

  // ─── List View (existing, unchanged) ────────────────────
  return (
    <FlatList
      ref={flatListRef}
      data={listData}
      keyExtractor={(item, i) => `${item.type}-${i}`}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={isSyncing} onRefresh={syncAll} tintColor={colors.cyan} />}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item }) => {
        // ─── Header ─────────────────────────────────
        if (item.type === 'header') {
          return (
            <YStack>
            {ViewToggle}
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
                    <M_ color={colors.textTertiary} fontSize={12}>{u.dist(week.target_volume, 0)}</M_>
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
                        {week.actual_volume > 0 ? `${u.dist(week.actual_volume, 0)}/${u.dist(week.target_volume, 0)}` : u.dist(week.target_volume, 0)}
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
                                  {metric ? u.dist(metric.distance_miles) : workout.target_distance_miles != null ? u.dist(workout.target_distance_miles) : ''}
                                </M_>
                              )}
                            </XStack>
                            {metric && (
                              <XStack marginLeft={28} marginTop={3} gap={8}>
                                {metric.avg_pace_sec_per_mile ? <M_ color={colors.textSecondary} fontSize={11}>{u.pace(metric.avg_pace_sec_per_mile)}{u.paceSuffix}</M_> : null}
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
