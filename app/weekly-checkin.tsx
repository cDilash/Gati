/**
 * Weekly Check-in — 5-step questionnaire that feeds the AI week generator.
 * Collects: strength schedule, run availability, body status, weekly focus.
 */

import { useState, useCallback, useRef } from 'react';
import { ScrollView as RNScrollView, Pressable, Platform, StatusBar, Alert, Dimensions } from 'react-native';
import { YStack, XStack, Text, View, Input, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store';
import { WeekDay, EnergyLevel, SorenessLevel, SleepQualityLevel } from '../src/types';
import { colors } from '../src/theme/colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GradientText } from '../src/theme/GradientText';
import { GradientButton } from '../src/theme/GradientButton';
import { GradientBorder } from '../src/theme/GradientBorder';
import * as Crypto from 'expo-crypto';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const DAYS: { key: WeekDay; label: string; short: string }[] = [
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
];

const TOTAL_STEPS = 5;
const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;

// ─── Day Toggle Grid ────────────────────────────────────────

function DayToggle({ selected, onToggle, minRequired }: { selected: WeekDay[]; onToggle: (day: WeekDay) => void; minRequired?: number }) {
  return (
    <XStack gap={6} flexWrap="wrap" justifyContent="center">
      {DAYS.map(d => {
        const active = selected.includes(d.key);
        return (
          <Pressable key={d.key} onPress={() => onToggle(d.key)}>
            <YStack width={44} height={44} borderRadius={12} alignItems="center" justifyContent="center"
              backgroundColor={active ? colors.cyan : colors.surface}
              borderWidth={1} borderColor={active ? colors.cyan : colors.border}>
              <B color={active ? colors.background : colors.textSecondary} fontSize={12} fontWeight={active ? '700' : '500'}>
                {d.short}
              </B>
            </YStack>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── Pill Selector ──────────────────────────────────────────

function PillSelect<T extends string>({ options, selected, onSelect, colorMap }: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
  colorMap?: Record<string, string>;
}) {
  return (
    <XStack gap={6} flexWrap="wrap">
      {options.map(o => {
        const active = selected === o.value;
        const activeColor = colorMap?.[o.value] ?? colors.cyan;
        return (
          <Pressable key={o.value} onPress={() => onSelect(o.value)}>
            <YStack paddingHorizontal={14} paddingVertical={8} borderRadius={10}
              backgroundColor={active ? activeColor + '22' : colors.surface}
              borderWidth={1} borderColor={active ? activeColor : colors.border}>
              <B color={active ? activeColor : colors.textSecondary} fontSize={13} fontWeight={active ? '700' : '500'}>
                {o.label}
              </B>
            </YStack>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── Progress Dots ──────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <XStack gap={6} justifyContent="center" marginBottom={20}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} width={i === current - 1 ? 20 : 8} height={8} borderRadius={4}
          backgroundColor={i < current ? colors.cyan : colors.border} />
      ))}
    </XStack>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function WeeklyCheckinScreen() {
  const router = useRouter();
  const userProfile = useAppStore(s => s.userProfile);
  const [step, setStep] = useState(1);

  // State for all checkin fields
  const [strengthDays, setStrengthDays] = useState<WeekDay[]>(['monday', 'wednesday', 'friday']);
  const [legDay, setLegDay] = useState<WeekDay | null>('monday');
  const [availableDays, setAvailableDays] = useState<WeekDay[]>(['tuesday', 'thursday', 'saturday', 'sunday']);
  const [preferredLongRunDay, setPreferredLongRunDay] = useState<WeekDay>('saturday');
  const [timeConstraints, setTimeConstraints] = useState('');
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel>('moderate');
  const [soreness, setSoreness] = useState<SorenessLevel>('none');
  const [injuryStatus, setInjuryStatus] = useState('');
  const [sleepQuality, setSleepQuality] = useState<SleepQualityLevel>('ok');
  const [focus, setFocus] = useState('Build Endurance');
  const [notes, setNotes] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleDay = (list: WeekDay[], day: WeekDay): WeekDay[] =>
    list.includes(day) ? list.filter(d => d !== day) : [...list, day];

  const handleNext = () => { if (step < TOTAL_STEPS) setStep(step + 1); };
  const handleBack = () => { if (step > 1) setStep(step - 1); };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { saveWeeklyCheckin, calculatePhase } = require('../src/engine/weeklyPlanning');
      const { getToday } = require('../src/utils/dateUtils');

      const today = getToday();
      const phase = calculatePhase(userProfile?.race_date ?? today, today);

      const checkin = {
        id: Crypto.randomUUID(),
        weekNumber: phase.weekNumber,
        raceWeekNumber: phase.weeksUntilRace,
        createdAt: new Date().toISOString(),
        strengthDays,
        legDay: strengthDays.length > 0 ? legDay : null,
        availableDays,
        preferredLongRunDay,
        timeConstraints: timeConstraints.trim() || null,
        energyLevel,
        soreness,
        injuryStatus: injuryStatus.trim() || null,
        sleepQuality,
        focus,
        notes: notes.trim() || null,
      };

      saveWeeklyCheckin(checkin);
      console.log('[Checkin] Saved week', phase.weekNumber, 'checkin');

      // Generate the week plan
      const { generateWeekPlan } = require('../src/ai/weekGenerator');
      const { buildPreviousWeekSummary, getCurrentMonday } = require('../src/engine/weeklyPlanning');
      const { addDays } = require('../src/utils/dateUtils');

      const prevWeek = buildPreviousWeekSummary(phase.weekNumber - 1);
      const paceZones = useAppStore.getState().paceZones;
      const recoveryStatus = useAppStore.getState().recoveryStatus;
      const garminHealth = useAppStore.getState().garminHealth;

      // Calculate the target week dates (next Monday–Sunday, or current if mid-week)
      const monday = getCurrentMonday();
      const sunday = addDays(monday, 6);

      const generatedWeek = await generateWeekPlan(
        checkin, prevWeek, userProfile, paceZones, phase,
        recoveryStatus, garminHealth,
        { monday, sunday },
      );

      console.log('[Checkin] Week generated:', generatedWeek.workouts.length, 'workouts');

      // Navigate to review screen with generated data
      router.replace({
        pathname: '/week-review',
        params: { weekJson: JSON.stringify(generatedWeek), checkinId: checkin.id },
      });
    } catch (e: any) {
      console.error('[Checkin] Error:', e);
      Alert.alert('Error', e?.message ?? 'Failed to save check-in.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── STEP RENDERERS ─────────────────────────────────────────

  const renderStep1 = () => (
    <YStack gap={24}>
      <YStack alignItems="center" gap={4}>
        <MaterialCommunityIcons name="dumbbell" size={32} color={colors.cyan} />
        <H color={colors.textPrimary} fontSize={22} letterSpacing={1}>STRENGTH TRAINING</H>
        <B color={colors.textSecondary} fontSize={14} textAlign="center">Which days are you lifting this week?</B>
      </YStack>

      <DayToggle selected={strengthDays} onToggle={d => setStrengthDays(toggleDay(strengthDays, d))} />

      {strengthDays.length > 0 && (
        <YStack gap={8}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Which day is leg day?</B>
          <XStack gap={6} flexWrap="wrap">
            {strengthDays.map(d => {
              const dayInfo = DAYS.find(x => x.key === d)!;
              const active = legDay === d;
              return (
                <Pressable key={d} onPress={() => setLegDay(d)}>
                  <YStack paddingHorizontal={14} paddingVertical={8} borderRadius={10}
                    backgroundColor={active ? colors.orange + '22' : colors.surface}
                    borderWidth={1} borderColor={active ? colors.orange : colors.border}>
                    <B color={active ? colors.orange : colors.textSecondary} fontSize={13} fontWeight={active ? '700' : '500'}>
                      {dayInfo.short}
                    </B>
                  </YStack>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setLegDay(null)}>
              <YStack paddingHorizontal={14} paddingVertical={8} borderRadius={10}
                backgroundColor={legDay === null ? colors.surfaceHover : colors.surface}
                borderWidth={1} borderColor={legDay === null ? colors.textTertiary : colors.border}>
                <B color={legDay === null ? colors.textPrimary : colors.textTertiary} fontSize={13}>None</B>
              </YStack>
            </Pressable>
          </XStack>
        </YStack>
      )}

      {strengthDays.length === 0 && (
        <B color={colors.textTertiary} fontSize={13} textAlign="center" fontStyle="italic">
          No lifting this week — that's fine, more recovery for running
        </B>
      )}
    </YStack>
  );

  const renderStep2 = () => (
    <YStack gap={24}>
      <YStack alignItems="center" gap={4}>
        <MaterialCommunityIcons name="run-fast" size={32} color={colors.cyan} />
        <H color={colors.textPrimary} fontSize={22} letterSpacing={1}>AVAILABILITY</H>
        <B color={colors.textSecondary} fontSize={14} textAlign="center">Which days can you run?</B>
      </YStack>

      <DayToggle selected={availableDays} onToggle={d => setAvailableDays(toggleDay(availableDays, d))} />

      {availableDays.length < 3 && (
        <B color={colors.orange} fontSize={12} textAlign="center">Select at least 3 days for a proper training week</B>
      )}

      {availableDays.length >= 2 && (
        <YStack gap={8}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Preferred long run day?</B>
          <XStack gap={6}>
            {availableDays.filter(d => d === 'saturday' || d === 'sunday').length > 0 ? (
              availableDays.filter(d => d === 'saturday' || d === 'sunday').map(d => {
                const active = preferredLongRunDay === d;
                const dayInfo = DAYS.find(x => x.key === d)!;
                return (
                  <Pressable key={d} onPress={() => setPreferredLongRunDay(d)}>
                    <YStack paddingHorizontal={16} paddingVertical={10} borderRadius={10}
                      backgroundColor={active ? colors.cyan + '22' : colors.surface}
                      borderWidth={1} borderColor={active ? colors.cyan : colors.border}>
                      <B color={active ? colors.cyan : colors.textSecondary} fontSize={14} fontWeight={active ? '700' : '500'}>
                        {dayInfo.label}
                      </B>
                    </YStack>
                  </Pressable>
                );
              })
            ) : (
              availableDays.map(d => {
                const active = preferredLongRunDay === d;
                const dayInfo = DAYS.find(x => x.key === d)!;
                return (
                  <Pressable key={d} onPress={() => setPreferredLongRunDay(d)}>
                    <YStack paddingHorizontal={14} paddingVertical={8} borderRadius={10}
                      backgroundColor={active ? colors.cyan + '22' : colors.surface}
                      borderWidth={1} borderColor={active ? colors.cyan : colors.border}>
                      <B color={active ? colors.cyan : colors.textSecondary} fontSize={13} fontWeight={active ? '700' : '500'}>
                        {dayInfo.short}
                      </B>
                    </YStack>
                  </Pressable>
                );
              })
            )}
          </XStack>
        </YStack>
      )}

      <YStack gap={4}>
        <B color={colors.textSecondary} fontSize={13} fontWeight="600">Time constraints? <B color={colors.textTertiary} fontSize={11}>(optional)</B></B>
        <Input backgroundColor={colors.surface} borderRadius={10} borderWidth={1} borderColor={colors.border}
          color={colors.textPrimary} fontSize={14} fontFamily="$body" paddingHorizontal={14} paddingVertical={10}
          placeholder="e.g., mornings only on weekdays" placeholderTextColor="$textTertiary"
          value={timeConstraints} onChangeText={setTimeConstraints} />
      </YStack>
    </YStack>
  );

  const renderStep3 = () => (
    <YStack gap={24}>
      <YStack alignItems="center" gap={4}>
        <MaterialCommunityIcons name="heart-pulse" size={32} color={colors.orange} />
        <H color={colors.textPrimary} fontSize={22} letterSpacing={1}>HOW DO YOU FEEL?</H>
        <B color={colors.textSecondary} fontSize={14} textAlign="center">Honest check — this shapes your week</B>
      </YStack>

      <YStack gap={16}>
        <YStack gap={6}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Energy level</B>
          <PillSelect
            options={[
              { value: 'high' as EnergyLevel, label: 'High' },
              { value: 'moderate' as EnergyLevel, label: 'Moderate' },
              { value: 'low' as EnergyLevel, label: 'Low' },
              { value: 'exhausted' as EnergyLevel, label: 'Exhausted' },
            ]}
            selected={energyLevel}
            onSelect={setEnergyLevel}
            colorMap={{ high: colors.cyan, moderate: colors.cyan, low: colors.orange, exhausted: colors.error }}
          />
        </YStack>

        <YStack gap={6}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Muscle soreness</B>
          <PillSelect
            options={[
              { value: 'none' as SorenessLevel, label: 'None' },
              { value: 'mild' as SorenessLevel, label: 'Mild' },
              { value: 'moderate' as SorenessLevel, label: 'Moderate' },
              { value: 'severe' as SorenessLevel, label: 'Severe' },
            ]}
            selected={soreness}
            onSelect={setSoreness}
            colorMap={{ none: colors.cyan, mild: colors.cyan, moderate: colors.orange, severe: colors.error }}
          />
        </YStack>

        <YStack gap={6}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Sleep quality</B>
          <PillSelect
            options={[
              { value: 'great' as SleepQualityLevel, label: 'Great' },
              { value: 'ok' as SleepQualityLevel, label: 'OK' },
              { value: 'poor' as SleepQualityLevel, label: 'Poor' },
              { value: 'terrible' as SleepQualityLevel, label: 'Terrible' },
            ]}
            selected={sleepQuality}
            onSelect={setSleepQuality}
            colorMap={{ great: colors.cyan, ok: colors.cyan, poor: colors.orange, terrible: colors.error }}
          />
        </YStack>

        <YStack gap={4}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Any injuries or niggles? <B color={colors.textTertiary} fontSize={11}>(optional)</B></B>
          <Input backgroundColor={colors.surface} borderRadius={10} borderWidth={1} borderColor={colors.border}
            color={colors.textPrimary} fontSize={14} fontFamily="$body" paddingHorizontal={14} paddingVertical={10}
            placeholder="e.g., left knee tight after Tuesday" placeholderTextColor="$textTertiary"
            value={injuryStatus} onChangeText={setInjuryStatus} />
        </YStack>
      </YStack>
    </YStack>
  );

  const renderStep4 = () => {
    const focusOptions = ['Build Endurance', 'Speed Work', 'Recovery', 'Maintain', 'Race Prep'];
    return (
      <YStack gap={24}>
        <YStack alignItems="center" gap={4}>
          <MaterialCommunityIcons name="target" size={32} color={colors.cyan} />
          <H color={colors.textPrimary} fontSize={22} letterSpacing={1}>WEEKLY FOCUS</H>
          <B color={colors.textSecondary} fontSize={14} textAlign="center">What's the priority this week?</B>
        </YStack>

        <YStack gap={8}>
          {focusOptions.map(f => {
            const active = focus === f;
            return (
              <Pressable key={f} onPress={() => setFocus(f)}>
                {active ? (
                  <GradientBorder side="left" borderWidth={3} borderRadius={12}>
                    <YStack paddingVertical={14} paddingHorizontal={16}>
                      <B color={colors.textPrimary} fontSize={15} fontWeight="700">{f}</B>
                    </YStack>
                  </GradientBorder>
                ) : (
                  <YStack paddingVertical={14} paddingHorizontal={16} borderRadius={12}
                    backgroundColor={colors.surface} borderWidth={1} borderColor={colors.border}>
                    <B color={colors.textSecondary} fontSize={15}>{f}</B>
                  </YStack>
                )}
              </Pressable>
            );
          })}
        </YStack>

        <YStack gap={4}>
          <B color={colors.textSecondary} fontSize={13} fontWeight="600">Anything else? <B color={colors.textTertiary} fontSize={11}>(optional)</B></B>
          <Input backgroundColor={colors.surface} borderRadius={10} borderWidth={1} borderColor={colors.border}
            color={colors.textPrimary} fontSize={14} fontFamily="$body" paddingHorizontal={14} paddingVertical={10}
            placeholder="e.g., traveling Thursday, 5K race Sunday" placeholderTextColor="$textTertiary"
            value={notes} onChangeText={setNotes} multiline maxHeight={80} />
        </YStack>
      </YStack>
    );
  };

  const renderStep5 = () => {
    const phase = (() => {
      try {
        const { calculatePhase } = require('../src/engine/weeklyPlanning');
        const { getToday } = require('../src/utils/dateUtils');
        return calculatePhase(userProfile?.race_date ?? getToday(), getToday());
      } catch { return null; }
    })();

    return (
      <YStack gap={20}>
        <YStack alignItems="center" gap={4}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={32} color={colors.cyan} />
          <H color={colors.textPrimary} fontSize={22} letterSpacing={1}>REVIEW</H>
          <B color={colors.textSecondary} fontSize={14}>Confirm your check-in</B>
        </YStack>

        <GradientBorder side="all" borderWidth={1.5} borderRadius={14}>
          <YStack backgroundColor={colors.surface} borderRadius={14} padding={16} gap={12}>
            <XStack justifyContent="space-between" alignItems="center">
              <H color={colors.cyan} fontSize={13} letterSpacing={1.5}>
                WEEK {phase?.weekNumber ?? '?'} CHECK-IN
              </H>
              <B color={colors.textTertiary} fontSize={11}>{phase?.phase ?? '?'} phase</B>
            </XStack>

            <View height={0.5} backgroundColor={colors.border} />

            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="dumbbell" size={14} color={colors.textTertiary} />
              <B color={colors.textSecondary} fontSize={13}>
                Lifting: {strengthDays.length > 0 ? strengthDays.map(d => DAYS.find(x => x.key === d)!.short).join(', ') : 'None'}
                {legDay ? ` (Leg: ${DAYS.find(x => x.key === legDay)!.short})` : ''}
              </B>
            </XStack>

            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="run-fast" size={14} color={colors.cyan} />
              <B color={colors.textSecondary} fontSize={13}>
                Running: {availableDays.map(d => DAYS.find(x => x.key === d)!.short).join(', ')}
              </B>
            </XStack>

            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="map-marker-distance" size={14} color={colors.cyan} />
              <B color={colors.textSecondary} fontSize={13}>
                Long run: {DAYS.find(x => x.key === preferredLongRunDay)!.label}
              </B>
            </XStack>

            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="lightning-bolt" size={14} color={
                energyLevel === 'high' || energyLevel === 'moderate' ? colors.cyan : colors.orange
              } />
              <B color={colors.textSecondary} fontSize={13}>
                Energy: {energyLevel} · Soreness: {soreness} · Sleep: {sleepQuality}
              </B>
            </XStack>

            {injuryStatus.trim() && (
              <XStack alignItems="center" gap={8}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.orange} />
                <B color={colors.orange} fontSize={13}>{injuryStatus}</B>
              </XStack>
            )}

            <XStack alignItems="center" gap={8}>
              <MaterialCommunityIcons name="target" size={14} color={colors.cyan} />
              <B color={colors.textSecondary} fontSize={13}>Focus: {focus}</B>
            </XStack>

            {notes.trim() && (
              <XStack alignItems="center" gap={8}>
                <MaterialCommunityIcons name="note-text-outline" size={14} color={colors.textTertiary} />
                <B color={colors.textTertiary} fontSize={13} fontStyle="italic">"{notes}"</B>
              </XStack>
            )}
          </YStack>
        </GradientBorder>
      </YStack>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────

  const canNext = step === 2 ? availableDays.length >= 3 : true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: SAFE_TOP }}>
      {/* Drag handle */}
      <YStack alignItems="center" paddingTop={8} paddingBottom={12}>
        <View width={36} height={4} borderRadius={2} backgroundColor={colors.textTertiary} opacity={0.5} />
      </YStack>

      {/* Header */}
      <XStack paddingHorizontal={16} marginBottom={8} justifyContent="space-between" alignItems="center">
        {step > 1 ? (
          <Pressable onPress={handleBack} hitSlop={12}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : <View width={24} />}
        <ProgressDots current={step} total={TOTAL_STEPS} />
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </XStack>

      {/* Content */}
      <RNScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </RNScrollView>

      {/* Bottom CTA */}
      <YStack position="absolute" bottom={0} left={0} right={0}
        paddingHorizontal={24} paddingBottom={Platform.OS === 'ios' ? 34 : 16} paddingTop={12}
        backgroundColor={colors.background} borderTopWidth={0.5} borderTopColor={colors.border}>
        {step < TOTAL_STEPS ? (
          <GradientButton
            label={step === 1 ? 'Next: Availability' : step === 2 ? 'Next: How You Feel' : step === 3 ? 'Next: Weekly Focus' : 'Review'}
            onPress={handleNext}
            disabled={!canNext}
            size="lg"
          />
        ) : (
          <GradientButton
            label={isGenerating ? 'Saving...' : 'Generate My Week'}
            onPress={handleGenerate}
            disabled={isGenerating}
            size="lg"
          />
        )}
      </YStack>
    </View>
  );
}
