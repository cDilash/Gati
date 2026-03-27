/**
 * Week Review — shows AI-generated week for user approval.
 * Accept → saves workouts to DB. Regenerate → calls AI again.
 */

import { useState, useCallback } from 'react';
import { ScrollView as RNScrollView, Pressable, Platform, StatusBar, Alert } from 'react-native';
import { YStack, XStack, Text, View, Input, Spinner } from 'tamagui';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppStore } from '../src/store';
import { GeneratedWeek, GeneratedWorkout, PhaseName } from '../src/types';
import { colors } from '../src/theme/colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GradientText } from '../src/theme/GradientText';
import { GradientButton } from '../src/theme/GradientButton';
import { GradientBorder } from '../src/theme/GradientBorder';
import { useUnits } from '../src/hooks/useUnits';
import * as Crypto from 'expo-crypto';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;

const DAY_LABELS: Record<string, string> = {
  monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU',
  friday: 'FRI', saturday: 'SAT', sunday: 'SUN',
};

const TYPE_COLORS: Record<string, string> = {
  easy: colors.cyan, recovery: colors.cyan,
  long_run: colors.cyan, long: colors.cyan,
  threshold: colors.orange, interval: colors.orange, tempo: colors.orange,
  marathon_pace: colors.orange,
  race: '#FFD700',
  rest: colors.textTertiary,
};

const TYPE_ICONS: Record<string, string> = {
  easy: 'run', recovery: 'walk', long_run: 'routes', long: 'routes',
  threshold: 'run-fast', interval: 'run-fast', tempo: 'run-fast',
  marathon_pace: 'run-fast', race: 'flag-checkered', rest: 'sleep',
};

// ─── Workout Card ───────────────────────────────────────────

function WorkoutCard({ workout }: { workout: GeneratedWorkout }) {
  const u = useUnits();
  const typeColor = TYPE_COLORS[workout.type] ?? colors.cyan;
  const typeIcon = TYPE_ICONS[workout.type] ?? 'run';
  const isRace = workout.type === 'race';

  return (
    <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden"
      borderLeftWidth={3} borderLeftColor={typeColor}>
      <YStack padding={14} gap={6}>
        {/* Day + Type header */}
        <XStack alignItems="center" justifyContent="space-between">
          <XStack alignItems="center" gap={8}>
            <H color={typeColor} fontSize={14} letterSpacing={1.5}>{DAY_LABELS[workout.day] ?? workout.day.toUpperCase()}</H>
            <View paddingHorizontal={8} paddingVertical={2} borderRadius={6}
              backgroundColor={typeColor + '22'} borderWidth={0.5} borderColor={typeColor + '44'}>
              <XStack alignItems="center" gap={4}>
                <MaterialCommunityIcons name={typeIcon as any} size={12} color={typeColor} />
                <B color={typeColor} fontSize={11} fontWeight="700">{workout.type.replace('_', ' ')}</B>
              </XStack>
            </View>
            {isRace && <MaterialCommunityIcons name="trophy" size={14} color="#FFD700" />}
          </XStack>
          <M color={colors.textPrimary} fontSize={18} fontWeight="800">
            {u.dist(workout.distanceMiles)}
          </M>
        </XStack>

        {/* Description */}
        <B color={colors.textSecondary} fontSize={13} lineHeight={18}>{workout.description}</B>

        {/* Pace + HR zone */}
        <XStack gap={12}>
          {workout.targetPaceZone && (
            <XStack alignItems="center" gap={4}>
              <MaterialCommunityIcons name="speedometer" size={12} color={colors.textTertiary} />
              <M color={colors.textTertiary} fontSize={11}>{workout.targetPaceZone}</M>
            </XStack>
          )}
          {workout.hrZone && (
            <XStack alignItems="center" gap={4}>
              <MaterialCommunityIcons name="heart-pulse" size={12} color={colors.orange} />
              <M color={colors.textTertiary} fontSize={11}>{workout.hrZone}</M>
            </XStack>
          )}
        </XStack>

        {/* Notes */}
        {workout.notes && (
          <XStack alignItems="flex-start" gap={4} marginTop={2}>
            <MaterialCommunityIcons name="information-outline" size={12} color={colors.orange} style={{ marginTop: 1 }} />
            <B color={colors.orange} fontSize={11} lineHeight={15}>{workout.notes}</B>
          </XStack>
        )}
      </YStack>
    </YStack>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function WeekReviewScreen() {
  const router = useRouter();
  const u = useUnits();
  const params = useLocalSearchParams<{ weekJson?: string; checkinId?: string }>();

  const [week, setWeek] = useState<GeneratedWeek | null>(() => {
    try { return params.weekJson ? JSON.parse(params.weekJson) : null; } catch { return null; }
  });
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [changeRequest, setChangeRequest] = useState('');

  if (!week) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <B color={colors.textSecondary} fontSize={16}>No week data to review.</B>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <B color={colors.cyan} fontSize={14} fontWeight="700">Go Back</B>
        </Pressable>
      </View>
    );
  }

  // Rest days = days NOT in workouts
  const workoutDays = new Set(week.workouts.map(w => w.day));
  const allDays: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const restDays = allDays.filter(d => !workoutDays.has(d as any));

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const { getLatestCheckin, buildPreviousWeekSummary, calculatePhase, calculatePeakWeeklyMiles, getCurrentMonday } = require('../src/engine/weeklyPlanning');
      const { generateWeekPlan } = require('../src/ai/weekGenerator');
      const { addDays, getToday } = require('../src/utils/dateUtils');

      const checkin = getLatestCheckin();
      if (!checkin) throw new Error('No check-in found');

      const userProfile = useAppStore.getState().userProfile;
      const paceZones = useAppStore.getState().paceZones;
      const recoveryStatus = useAppStore.getState().recoveryStatus;
      const garminHealth = useAppStore.getState().garminHealth;
      const peakMiles = calculatePeakWeeklyMiles(
        userProfile?.target_finish_time_sec ?? null,
        userProfile?.current_weekly_miles ?? 15,
      );
      const phase = calculatePhase(userProfile?.race_date ?? getToday(), getToday(), peakMiles);
      const prevWeek = buildPreviousWeekSummary(phase.weekNumber - 1);
      const { getNextMonday } = require('../src/engine/weeklyPlanning');
      const dow = new Date().getDay();
      const monday = dow === 0 ? getNextMonday() : getCurrentMonday();
      const sunday = addDays(monday, 6);

      const newWeek = await generateWeekPlan(
        checkin, prevWeek, userProfile, paceZones, phase,
        recoveryStatus, garminHealth, { monday, sunday },
      );
      setWeek(newWeek);
    } catch (e: any) {
      Alert.alert('Regeneration Failed', e?.message ?? 'Try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      const { getDatabase, recalculateWeeklyVolumes } = require('../src/db/database');
      const { saveWeekGeneration, markWeekGenerationAccepted } = require('../src/engine/weeklyPlanning');
      const { setSetting } = require('../src/db/database');
      const db = getDatabase();

      // Get or create the active plan
      let plan = db.getFirstSync("SELECT id FROM training_plan WHERE status = 'active' LIMIT 1") as { id: string } | null;
      if (!plan) {
        const planId = Crypto.randomUUID();
        db.runSync(
          `INSERT INTO training_plan (id, plan_json, coaching_notes, key_principles, warnings, vdot_at_generation, status)
           VALUES (?, ?, NULL, NULL, NULL, ?, 'active')`,
          planId, JSON.stringify(week), useAppStore.getState().userProfile?.vdot_score ?? 30,
        );
        plan = { id: planId };
      } else {
        // Update plan_json with new week data merged
        try {
          const existing = db.getFirstSync('SELECT plan_json FROM training_plan WHERE id = ?', [plan.id]) as { plan_json: string } | null;
          if (existing?.plan_json) {
            const parsed = JSON.parse(existing.plan_json);
            // Replace or add this week in the weeks array
            const filtered = (parsed.weeks ?? []).filter((w: any) => w.weekNumber !== week.weekNumber);
            parsed.weeks = [...filtered, { weekNumber: week.weekNumber, phase: week.phase, targetVolume: week.totalPlannedMiles, workouts: week.workouts }];
            db.runSync('UPDATE training_plan SET plan_json = ? WHERE id = ?', [JSON.stringify(parsed), plan.id]);
          }
        } catch {}
      }

      const planId = plan.id;

      // Determine the correct week_number based on the workout dates
      // Find the plan's first workout date to calculate relative week number
      const firstWorkoutDate = db.getFirstSync(
        'SELECT MIN(scheduled_date) as d FROM workout WHERE plan_id = ?', [planId]
      ) as { d: string } | null;
      const targetMonday = week.workouts.length > 0 ? week.workouts[0].date : require('../src/engine/weeklyPlanning').getCurrentMonday();
      let weekNum = week.weekNumber;
      if (firstWorkoutDate?.d) {
        const planStart = new Date(firstWorkoutDate.d + 'T00:00:00');
        const weekStart = new Date(targetMonday + 'T00:00:00');
        weekNum = Math.max(1, Math.floor((weekStart.getTime() - planStart.getTime()) / (7 * 86400000)) + 1);
      }

      // Delete any existing upcoming workouts for the DATE RANGE (not by week_number — more reliable)
      if (week.workouts.length > 0) {
        const firstDate = week.workouts[0].date;
        const lastDate = week.workouts[week.workouts.length - 1].date;
        // Unlink metrics first (FK safety)
        db.runSync(
          `UPDATE performance_metric SET workout_id = NULL
           WHERE workout_id IN (SELECT id FROM workout WHERE plan_id = ? AND scheduled_date >= ? AND scheduled_date <= ? AND status = 'upcoming')`,
          [planId, firstDate, lastDate],
        );
        db.runSync(
          `DELETE FROM workout WHERE plan_id = ? AND scheduled_date >= ? AND scheduled_date <= ? AND status = 'upcoming'`,
          [planId, firstDate, lastDate],
        );
      }

      // Ensure training_week row exists
      db.runSync(
        `INSERT OR REPLACE INTO training_week (id, plan_id, week_number, phase, target_volume, is_cutback, ai_notes)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        Crypto.randomUUID(), planId, weekNum, week.phase, week.totalPlannedMiles, week.rationale,
      );

      // Insert new workouts
      for (const w of week.workouts) {
        db.runSync(
          `INSERT INTO workout
           (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
            description, target_distance_miles, target_pace_zone, intervals_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'upcoming')`,
          Crypto.randomUUID(), planId, weekNum,
          allDays.indexOf(w.day), w.date, w.type,
          `${w.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${u.dist(w.distanceMiles)}`,
          w.description + (w.notes ? `\n${w.notes}` : ''),
          w.distanceMiles, w.targetPaceZone,
        );
      }

      // Add rest days as rest workouts
      for (const restDay of restDays) {
        const dayIdx = allDays.indexOf(restDay);
        const { addDays } = require('../src/utils/dateUtils');
        const mondayDate = week.workouts.length > 0
          ? (() => { const firstW = week.workouts[0]; const firstDayIdx = allDays.indexOf(firstW.day); const d = new Date(firstW.date + 'T00:00:00'); d.setDate(d.getDate() - firstDayIdx); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()
          : require('../src/engine/weeklyPlanning').getCurrentMonday();
        const restDate = addDays(mondayDate, dayIdx);

        // Don't overwrite completed/skipped
        const existing = db.getFirstSync(
          `SELECT id FROM workout WHERE plan_id = ? AND scheduled_date = ? AND status != 'upcoming'`,
          [planId, restDate],
        );
        if (!existing) {
          db.runSync(
            `INSERT OR IGNORE INTO workout
             (id, plan_id, week_number, day_of_week, scheduled_date, workout_type, title,
              description, target_distance_miles, target_pace_zone, intervals_json, status)
             VALUES (?, ?, ?, ?, ?, 'rest', 'Rest Day', 'Recovery day — no running', 0, NULL, NULL, 'upcoming')`,
            Crypto.randomUUID(), planId, weekNum, dayIdx, restDate,
          );
        }
      }

      // Save generation record
      const genId = Crypto.randomUUID();
      saveWeekGeneration({
        id: genId,
        weekNumber: week.weekNumber,
        checkinId: params.checkinId ?? '',
        phase: week.phase,
        generatedAt: new Date().toISOString(),
        promptSummary: null,
        aiResponse: JSON.stringify(week),
        accepted: true,
        rejectedReason: null,
      });

      // Update plan timestamp
      try { setSetting('plan_last_updated', new Date().toISOString()); setSetting('plan_update_source', 'weekly_checkin'); } catch {}

      // Recalculate volumes
      recalculateWeeklyVolumes();

      // Refresh store
      useAppStore.getState().refreshState();

      console.log('[WeekReview] Accepted — saved', week.workouts.length, 'workouts for week', week.weekNumber);

      // Navigate to plan screen
      router.dismissAll();
    } catch (e: any) {
      console.error('[WeekReview] Accept failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to save workouts.');
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: SAFE_TOP }}>
      {/* Drag handle */}
      <YStack alignItems="center" paddingTop={8} paddingBottom={12}>
        <View width={36} height={4} borderRadius={2} backgroundColor={colors.textTertiary} opacity={0.5} />
      </YStack>

      {/* Header */}
      <XStack paddingHorizontal={16} marginBottom={16} justifyContent="space-between" alignItems="center">
        <YStack>
          <GradientText text={`WEEK ${week.weekNumber}`} style={{ fontSize: 20, fontWeight: '800', letterSpacing: 1.5 }} />
          <B color={colors.textTertiary} fontSize={12}>{week.phase} phase · {u.dist(week.totalPlannedMiles, 0)} planned</B>
        </YStack>
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </XStack>

      <RNScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}>

        {/* Rationale */}
        <YStack backgroundColor={colors.surface} borderRadius={12} padding={14} marginBottom={16}
          borderLeftWidth={3} borderLeftColor={colors.cyanDim}>
          <B color={colors.textSecondary} fontSize={13} lineHeight={19} fontStyle="italic">
            {week.rationale}
          </B>
        </YStack>

        {/* Workout Cards */}
        <YStack gap={10}>
          {week.workouts.map((w, i) => (
            <WorkoutCard key={i} workout={w} />
          ))}
        </YStack>

        {/* Rest days */}
        {restDays.length > 0 && (
          <XStack marginTop={12} gap={4} alignItems="center" justifyContent="center" flexWrap="wrap">
            <MaterialCommunityIcons name="sleep" size={14} color={colors.textTertiary} />
            <B color={colors.textTertiary} fontSize={12}>
              Rest: {restDays.map(d => DAY_LABELS[d]).join(', ')}
            </B>
          </XStack>
        )}
      </RNScrollView>

      {/* Bottom CTAs */}
      <YStack position="absolute" bottom={0} left={0} right={0}
        paddingHorizontal={16} paddingBottom={Platform.OS === 'ios' ? 34 : 16} paddingTop={12}
        backgroundColor={colors.background} borderTopWidth={0.5} borderTopColor={colors.border}>
        <XStack gap={10}>
          <YStack flex={1} borderRadius={12} borderWidth={1} borderColor={colors.border}
            paddingVertical={14} alignItems="center"
            opacity={isRegenerating ? 0.5 : 1}
            pressStyle={{ opacity: 0.7 }}
            onPress={isRegenerating ? undefined : handleRegenerate}>
            {isRegenerating ? (
              <XStack alignItems="center" gap={6}>
                <Spinner size="small" color={colors.textSecondary} />
                <B color={colors.textSecondary} fontSize={14}>Regenerating...</B>
              </XStack>
            ) : (
              <B color={colors.textSecondary} fontSize={14} fontWeight="600">Regenerate</B>
            )}
          </YStack>
          <YStack flex={2}>
            <GradientButton
              label={isAccepting ? 'Saving...' : 'Accept Plan'}
              onPress={handleAccept}
              disabled={isAccepting || isRegenerating}
              size="lg"
            />
          </YStack>
        </XStack>
      </YStack>
    </View>
  );
}
