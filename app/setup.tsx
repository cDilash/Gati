import { useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet,
  Animated, KeyboardAvoidingView, Platform, Modal, ActivityIndicator, Alert,
} from 'react-native';
// DateTimePicker native module broken with Old Arch — using JS-based picker instead
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useAppStore } from '../src/store';
import { useSettingsStore } from '../src/stores/settingsStore';
import { signIn } from '../src/backup/auth';
import {
  calculateVDOTFrom10K, calculateVDOTFrom5K,
  parseTimeToSeconds, formatTime, predictMarathonTime,
  predictHalfMarathonTime,
} from '../src/engine/vdot';
import { Level } from '../src/types';
import { COLORS } from '../src/utils/constants';
import { toMiles, toLbs, distanceLabel, weightLabel } from '../src/utils/units';

const TOTAL_STEPS = 5;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEVELS: { value: Level; label: string; emoji: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', emoji: '🌱', description: 'First marathon or less than 1 year running' },
  { value: 'intermediate', label: 'Intermediate', emoji: '🔥', description: '1-3 years running, completed at least one marathon' },
  { value: 'advanced', label: 'Advanced', emoji: '⚡', description: '3+ years, multiple marathons under your belt' },
];

const STEP_TITLES = [
  'Welcome',
  'Fitness Baseline',
  'Your Schedule',
  'Race Goal',
  'Review & Go',
];

// ─── Time Picker Modal ──────────────────────────────────────

function TimePickerModal({
  visible,
  onClose,
  onConfirm,
  title,
  showHours,
  initialMinutes = 0,
  initialSeconds = 0,
  initialHours = 0,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (h: number, m: number, s: number) => void;
  title: string;
  showHours: boolean;
  initialMinutes?: number;
  initialSeconds?: number;
  initialHours?: number;
}) {
  const [hours, setHours] = useState(initialHours);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [seconds, setSeconds] = useState(initialSeconds);

  // Reset when opened
  const prevVisible = useRef(false);
  if (visible && !prevVisible.current) {
    // Can't call setState during render in strict mode, but this pattern
    // works for syncing on open. We use the initialXxx props directly.
  }
  prevVisible.current = visible;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={tp.overlay}>
        <View style={tp.sheet}>
          <View style={tp.header}>
            <Pressable onPress={onClose}>
              <Text style={tp.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={tp.title}>{title}</Text>
            <Pressable onPress={() => onConfirm(hours, minutes, seconds)}>
              <Text style={tp.doneText}>Done</Text>
            </Pressable>
          </View>

          <View style={tp.wheelRow}>
            {showHours && (
              <>
                <WheelColumn
                  values={Array.from({ length: 10 }, (_, i) => i)}
                  selected={hours}
                  onSelect={setHours}
                  label="h"
                />
                <Text style={tp.colon}>:</Text>
              </>
            )}
            <WheelColumn
              values={Array.from({ length: 60 }, (_, i) => i)}
              selected={minutes}
              onSelect={setMinutes}
              label="m"
            />
            <Text style={tp.colon}>:</Text>
            <WheelColumn
              values={Array.from({ length: 60 }, (_, i) => i)}
              selected={seconds}
              onSelect={setSeconds}
              label="s"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function DatePickerModal({
  visible,
  onClose,
  onConfirm,
  initialDate,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate: Date;
}) {
  const [month, setMonth] = useState(initialDate.getMonth());
  const [day, setDay] = useState(initialDate.getDate());
  const [year, setYear] = useState(initialDate.getFullYear());

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear + i);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Clamp day if month changes
  const clampedDay = Math.min(day, daysInMonth);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={tp.overlay}>
        <View style={tp.sheet}>
          <View style={tp.header}>
            <Pressable onPress={onClose}>
              <Text style={tp.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={tp.title}>Race Date</Text>
            <Pressable onPress={() => {
              onConfirm(new Date(year, month, clampedDay));
            }}>
              <Text style={tp.doneText}>Done</Text>
            </Pressable>
          </View>

          <View style={tp.wheelRow}>
            <DateWheelColumn
              values={MONTH_NAMES}
              selected={month}
              onSelect={setMonth}
            />
            <DateWheelColumn
              values={days.map(d => String(d))}
              selected={clampedDay - 1}
              onSelect={(idx) => setDay(idx + 1)}
            />
            <DateWheelColumn
              values={years.map(y => String(y))}
              selected={years.indexOf(year)}
              onSelect={(idx) => setYear(years[idx])}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DateWheelColumn({
  values,
  selected,
  onSelect,
}: {
  values: string[];
  selected: number;
  onSelect: (idx: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const ITEM_HEIGHT = 44;

  return (
    <View style={tp.wheelCol}>
      <View style={tp.wheelWindow}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          onLayout={() => {
            scrollRef.current?.scrollTo({ y: selected * ITEM_HEIGHT, animated: false });
          }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
            const clamped = Math.max(0, Math.min(idx, values.length - 1));
            onSelect(clamped);
          }}
        >
          {values.map((v, i) => (
            <View key={`${v}-${i}`} style={[tp.wheelItem, { height: ITEM_HEIGHT }]}>
              <Text style={[tp.wheelText, i === selected && tp.wheelTextActive]}>
                {v}
              </Text>
            </View>
          ))}
        </ScrollView>
        <View style={tp.wheelHighlight} pointerEvents="none" />
      </View>
    </View>
  );
}

function WheelColumn({
  values,
  selected,
  onSelect,
  label,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  label: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const ITEM_HEIGHT = 44;

  return (
    <View style={tp.wheelCol}>
      <View style={tp.wheelWindow}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
          onLayout={() => {
            scrollRef.current?.scrollTo({ y: selected * ITEM_HEIGHT, animated: false });
          }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
            const clamped = Math.max(0, Math.min(idx, values.length - 1));
            onSelect(values[clamped]);
          }}
        >
          {values.map((v) => (
            <View key={v} style={[tp.wheelItem, { height: ITEM_HEIGHT }]}>
              <Text style={[tp.wheelText, v === selected && tp.wheelTextActive]}>
                {String(v).padStart(2, '0')}
              </Text>
            </View>
          ))}
        </ScrollView>
        <View style={tp.wheelHighlight} pointerEvents="none" />
      </View>
      <Text style={tp.wheelLabel}>{label}</Text>
    </View>
  );
}

const tp = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  cancelText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accent,
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 4,
  },
  colon: {
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  wheelCol: {
    alignItems: 'center',
  },
  wheelWindow: {
    height: 220,
    width: 64,
    overflow: 'hidden',
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelText: {
    fontSize: 24,
    color: COLORS.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  wheelTextActive: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 28,
  },
  wheelHighlight: {
    position: 'absolute',
    top: 88,
    left: 0,
    right: 0,
    height: 44,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 8,
  },
  wheelLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: '600',
    marginTop: 4,
  },
});

// ─── Main Setup Screen ──────────────────────────────────────

export default function SetupScreen() {
  const router = useRouter();
  const { setUserProfile, generateAndSavePlan } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const scrollRef = useRef<ScrollView>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const wl = weightLabel(units).toUpperCase();
  const dl = distanceLabel(units).toUpperCase();

  const [step, setStep] = useState(0);

  // Step 1: Welcome
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [maxHr, setMaxHr] = useState('');

  // Step 2: Fitness Baseline
  const [raceDistance, setRaceDistance] = useState<'5K' | '10K'>('10K');
  const [raceMinutes, setRaceMinutes] = useState(0);
  const [raceSeconds, setRaceSeconds] = useState(0);
  const [weeklyMileage, setWeeklyMileage] = useState('');
  const [longestRun, setLongestRun] = useState('');
  const [level, setLevel] = useState<Level>('intermediate');

  // Step 3: Schedule
  const [availableDays, setAvailableDays] = useState<number[]>([0, 1, 3, 5, 6]);
  const [longRunDay, setLongRunDay] = useState(6);

  // Step 4: Race Goal
  const [raceDateObj, setRaceDateObj] = useState<Date | null>(null);
  const [goalHours, setGoalHours] = useState(0);
  const [goalMinutes, setGoalMinutes] = useState(0);
  const [goalSeconds, setGoalSeconds] = useState(0);
  const [hasGoalTime, setHasGoalTime] = useState(false);

  // Picker visibility
  const [showRaceTimePicker, setShowRaceTimePicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGoalTimePicker, setShowGoalTimePicker] = useState(false);

  const [errors, setErrors] = useState<string[]>([]);

  // Welcome screen mode: login-first, tap "New here?" to show setup form
  const [showNewUserForm, setShowNewUserForm] = useState(false);

  // Restore from backup state
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreEmail, setRestoreEmail] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const { performRestore } = useAppStore();

  const handleRestoreSignIn = useCallback(async () => {
    setRestoreError(null);
    if (!restoreEmail.trim() || !restorePassword.trim()) {
      setRestoreError('Email and password are required.');
      return;
    }
    setRestoreLoading(true);
    const result = await signIn(restoreEmail.trim().toLowerCase(), restorePassword);
    if (result.error) {
      setRestoreLoading(false);
      setRestoreError(result.error);
      return;
    }
    // Signed in — now restore
    const restoreResult = await performRestore();
    setRestoreLoading(false);
    if (restoreResult.success) {
      setShowRestoreModal(false);
      Alert.alert('Welcome Back!', 'Your training data has been restored.');
      // initializeApp was called by performRestore — _layout.tsx will redirect to (tabs)
    } else {
      setRestoreError(restoreResult.error || 'Restore failed. You can set up manually instead.');
    }
  }, [restoreEmail, restorePassword, performRestore]);

  // Derived values
  const estimatedMaxHr = age ? String(220 - parseInt(age, 10)) : '';
  const effectiveMaxHr = maxHr || estimatedMaxHr;
  const raceTimeSeconds = raceMinutes * 60 + raceSeconds;
  const raceTimeDisplay = raceTimeSeconds > 0
    ? `${String(raceMinutes).padStart(2, '0')}:${String(raceSeconds).padStart(2, '0')}`
    : '';
  const previewVDOT = raceTimeSeconds > 0
    ? (raceDistance === '10K' ? calculateVDOTFrom10K(raceTimeSeconds) : calculateVDOTFrom5K(raceTimeSeconds))
    : null;
  const predictedMarathon = previewVDOT ? predictMarathonTime(previewVDOT) : null;
  const predictedHalf = previewVDOT ? predictHalfMarathonTime(previewVDOT) : null;

  const raceDateStr = raceDateObj ? raceDateObj.toISOString().split('T')[0] : '';
  const goalTimeSeconds = hasGoalTime ? goalHours * 3600 + goalMinutes * 60 + goalSeconds : 0;
  const goalTimeDisplay = hasGoalTime && goalTimeSeconds > 0
    ? `${goalHours}:${String(goalMinutes).padStart(2, '0')}:${String(goalSeconds).padStart(2, '0')}`
    : '';

  function animateProgress(toStep: number) {
    Animated.spring(progressAnim, {
      toValue: toStep / (TOTAL_STEPS - 1),
      useNativeDriver: false,
      tension: 50,
      friction: 10,
    }).start();
  }

  function goTo(nextStep: number) {
    setErrors([]);
    setStep(nextStep);
    animateProgress(nextStep);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function next() {
    const stepErrors = validateStep(step);
    if (stepErrors.length > 0) {
      setErrors(stepErrors);
      return;
    }
    if (step < TOTAL_STEPS - 1) goTo(step + 1);
  }

  function back() {
    if (step > 0) goTo(step - 1);
  }

  function toggleDay(day: number) {
    setAvailableDays(prev => {
      if (prev.includes(day)) {
        const filtered = prev.filter(d => d !== day);
        if (longRunDay === day && filtered.length > 0) {
          setLongRunDay(filtered[filtered.length - 1]);
        }
        return filtered;
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  function validateStep(s: number): string[] {
    const errs: string[] = [];
    if (s === 0) {
      if (!name.trim()) errs.push('What should we call you?');
      if (!age || parseInt(age, 10) < 10 || parseInt(age, 10) > 100) errs.push('Enter a valid age (10-100).');
      if (!weight || parseFloat(weight) <= 0) errs.push('Enter your weight.');
      if (!restingHr || parseInt(restingHr, 10) < 30 || parseInt(restingHr, 10) > 120) errs.push('Resting HR should be 30-120 bpm.');
    }
    if (s === 1) {
      if (raceTimeSeconds <= 0) errs.push('Set your recent race time.');
      if (!weeklyMileage || parseFloat(weeklyMileage) <= 0) errs.push('Enter your current weekly volume.');
      if (!longestRun || parseFloat(longestRun) <= 0) errs.push('Enter your longest recent run.');
    }
    if (s === 2) {
      if (availableDays.length < 3) errs.push('Pick at least 3 training days.');
      if (!availableDays.includes(longRunDay)) errs.push('Long run day must be one of your available days.');
    }
    if (s === 3) {
      if (!raceDateObj) {
        errs.push('When is race day?');
      } else if (raceDateObj <= new Date()) {
        errs.push('Race date must be in the future.');
      }
    }
    return errs;
  }

  function handleSubmit() {
    for (let s = 0; s < TOTAL_STEPS - 1; s++) {
      const stepErrors = validateStep(s);
      if (stepErrors.length > 0) {
        setErrors(stepErrors);
        goTo(s);
        return;
      }
    }

    setErrors([]);

    const vdot = raceDistance === '10K'
      ? calculateVDOTFrom10K(raceTimeSeconds)
      : calculateVDOTFrom5K(raceTimeSeconds);

    const now = new Date().toISOString();
    const weightInLbs = toLbs(parseFloat(weight), units);
    const weeklyMileageInMiles = toMiles(parseFloat(weeklyMileage), units);
    const longestRunInMiles = toMiles(parseFloat(longestRun), units);

    const profile = {
      id: Crypto.randomUUID(),
      name: name.trim(),
      age: parseInt(age, 10),
      weight_lbs: weightInLbs,
      resting_hr: parseInt(restingHr, 10),
      max_hr: parseInt(effectiveMaxHr, 10),
      vdot,
      current_weekly_mileage: weeklyMileageInMiles,
      race_date: raceDateStr,
      race_distance: 'marathon' as const,
      recent_race_distance: raceDistance,
      recent_race_time_seconds: raceTimeSeconds,
      level,
      available_days: availableDays,
      preferred_long_run_day: longRunDay,
      longest_recent_run: longestRunInMiles,
      goal_marathon_time_seconds: goalTimeSeconds > 0 ? goalTimeSeconds : undefined,
      created_at: now,
      updated_at: now,
    };

    setUserProfile(profile);

    const today = new Date().toISOString().split('T')[0];
    generateAndSavePlan({
      startDate: today,
      raceDate: raceDateStr,
      currentWeeklyMileage: weeklyMileageInMiles,
      longestRecentRun: longestRunInMiles,
      level,
      vdot,
      availableDays,
      preferredLongRunDay: longRunDay,
    });

    router.replace('/(tabs)');
  }

  // ─── Progress Bar ──────────────────────────────────────────

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // ─── Picker Field (tappable, shows formatted value) ────────

  function PickerField({ label, value, placeholder, onPress }: {
    label: string; value: string; placeholder: string; onPress: () => void;
  }) {
    return (
      <View style={s.field}>
        <Text style={s.label}>{label}</Text>
        <Pressable style={s.pickerField} onPress={onPress}>
          <Text style={value ? s.pickerFieldValue : s.pickerFieldPlaceholder}>
            {value || placeholder}
          </Text>
          <Text style={s.pickerFieldIcon}>▾</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Step Renderers ────────────────────────────────────────

  function renderStepWelcome() {
    // Login-first flow: show sign-in prominently, "New here?" reveals setup form
    if (!showNewUserForm) {
      return (
        <>
          <Text style={s.heroTitle}>Marathon{'\n'}Coach</Text>
          <Text style={s.heroSubtitle}>
            Your personal training plan, built on sports science.
          </Text>

          <View style={s.card}>
            <Text style={s.cardTitle}>Welcome Back</Text>
            <Text style={s.cardDesc}>Sign in to restore your training data from the cloud.</Text>

            <Pressable style={s.signInButton} onPress={() => setShowRestoreModal(true)}>
              <Text style={s.signInButtonText}>Sign In & Restore</Text>
            </Pressable>
          </View>

          <View style={s.restoreDivider}>
            <View style={s.restoreLine} />
            <Text style={s.restoreOrText}>or</Text>
            <View style={s.restoreLine} />
          </View>

          <Pressable style={s.newUserButton} onPress={() => setShowNewUserForm(true)}>
            <Text style={s.newUserButtonText}>New Here? Set Up Your Plan</Text>
          </Pressable>
          <Text style={s.restoreHint}>First time? We'll ask a few questions to build your plan.</Text>
        </>
      );
    }

    // New user form (original profile setup)
    return (
      <>
        <Text style={s.heroTitle}>Marathon{'\n'}Coach</Text>
        <Text style={s.heroSubtitle}>
          Let's get to know you first.
        </Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>About You</Text>

          <View style={s.field}>
            <Text style={s.label}>NAME</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          <View style={s.row}>
            <View style={s.flex1}>
              <Text style={s.label}>AGE</Text>
              <TextInput
                style={s.input}
                value={age}
                onChangeText={setAge}
                placeholder="30"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={s.gap} />
            <View style={s.flex1}>
              <Text style={s.label}>WEIGHT ({wl})</Text>
              <TextInput
                style={s.input}
                value={weight}
                onChangeText={setWeight}
                placeholder="160"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={s.row}>
            <View style={s.flex1}>
              <Text style={s.label}>RESTING HR</Text>
              <TextInput
                style={s.input}
                value={restingHr}
                onChangeText={setRestingHr}
                placeholder="60"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={s.gap} />
            <View style={s.flex1}>
              <Text style={s.label}>MAX HR</Text>
              <TextInput
                style={s.input}
                value={maxHr}
                onChangeText={setMaxHr}
                placeholder={estimatedMaxHr || '190'}
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="number-pad"
              />
              {age && !maxHr ? (
                <Text style={s.hint}>Estimated {estimatedMaxHr} from age</Text>
              ) : null}
            </View>
          </View>
        </View>
      </>
    );
  }

  function renderStepFitness() {
    return (
      <>
        <Text style={s.stepHeading}>Where are you now?</Text>
        <Text style={s.stepDesc}>
          Your recent race time determines your VDOT — the foundation of every pace zone in your plan.
        </Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>Recent Race</Text>

          <View style={s.field}>
            <Text style={s.label}>DISTANCE</Text>
            <View style={s.pillRow}>
              {(['5K', '10K'] as const).map(d => (
                <Pressable
                  key={d}
                  style={[s.pill, raceDistance === d && s.pillActive]}
                  onPress={() => setRaceDistance(d)}
                >
                  <Text style={[s.pillText, raceDistance === d && s.pillTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <PickerField
            label="FINISH TIME"
            value={raceTimeDisplay}
            placeholder={raceDistance === '5K' ? 'Tap to set (e.g. 25:00)' : 'Tap to set (e.g. 52:00)'}
            onPress={() => setShowRaceTimePicker(true)}
          />
        </View>

        {/* VDOT Preview Card */}
        {previewVDOT !== null && predictedMarathon !== null && (
          <View style={s.vdotCard}>
            <View style={s.vdotBadge}>
              <Text style={s.vdotBadgeValue}>{previewVDOT.toFixed(1)}</Text>
              <Text style={s.vdotBadgeLabel}>VDOT</Text>
            </View>
            <View style={s.vdotPredictions}>
              <Text style={s.vdotSectionTitle}>Race Predictions</Text>
              <View style={s.predRow}>
                <Text style={s.predLabel}>Marathon</Text>
                <Text style={s.predValue}>{formatTime(predictedMarathon)}</Text>
              </View>
              {predictedHalf !== null && (
                <View style={s.predRow}>
                  <Text style={s.predLabel}>Half Marathon</Text>
                  <Text style={s.predValue}>{formatTime(predictedHalf)}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>Current Fitness</Text>
          <View style={s.row}>
            <View style={s.flex1}>
              <Text style={s.label}>WEEKLY {dl}</Text>
              <TextInput
                style={s.input}
                value={weeklyMileage}
                onChangeText={setWeeklyMileage}
                placeholder="25"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={s.gap} />
            <View style={s.flex1}>
              <Text style={s.label}>LONGEST RUN ({dl})</Text>
              <TextInput
                style={s.input}
                value={longestRun}
                onChangeText={setLongestRun}
                placeholder="10"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Experience Level</Text>
          {LEVELS.map(l => (
            <Pressable
              key={l.value}
              style={[s.levelOption, level === l.value && s.levelOptionActive]}
              onPress={() => setLevel(l.value)}
            >
              <Text style={s.levelEmoji}>{l.emoji}</Text>
              <View style={s.levelTextWrap}>
                <Text style={[s.levelLabel, level === l.value && s.levelLabelActive]}>{l.label}</Text>
                <Text style={s.levelDescText}>{l.description}</Text>
              </View>
              <View style={[s.radio, level === l.value && s.radioActive]}>
                {level === l.value && <View style={s.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>
      </>
    );
  }

  function renderStepSchedule() {
    return (
      <>
        <Text style={s.stepHeading}>Your week</Text>
        <Text style={s.stepDesc}>
          Which days can you train? We'll build the plan around your schedule.
        </Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>Training Days</Text>
          <Text style={s.cardHint}>Tap to toggle. Pick at least 3.</Text>
          <View style={s.daysGrid}>
            {DAY_LABELS.map((label, index) => (
              <Pressable
                key={index}
                style={[s.dayChip, availableDays.includes(index) && s.dayChipActive]}
                onPress={() => toggleDay(index)}
              >
                <Text style={[s.dayChipText, availableDays.includes(index) && s.dayChipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Long Run Day</Text>
          <Text style={s.cardHint}>Your most important weekly run.</Text>
          <View style={s.pillRow}>
            {availableDays.map(day => (
              <Pressable
                key={day}
                style={[s.pill, longRunDay === day && s.pillActive]}
                onPress={() => setLongRunDay(day)}
              >
                <Text style={[s.pillText, longRunDay === day && s.pillTextActive]}>
                  {DAY_LABELS[day]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.infoCard}>
          <Text style={s.infoTitle}>How the plan works</Text>
          <Text style={s.infoText}>
            Your plan follows Jack Daniels' periodization:{'\n\n'}
            <Text style={s.infoBold}>Base</Text> — Build aerobic foundation{'\n'}
            <Text style={s.infoBold}>Build</Text> — Add tempo & threshold work{'\n'}
            <Text style={s.infoBold}>Peak</Text> — Sharp VO2max intervals{'\n'}
            <Text style={s.infoBold}>Taper</Text> — Fresh legs for race day{'\n\n'}
            Every 4th week is a cutback (20% less volume) for recovery.
          </Text>
        </View>
      </>
    );
  }

  function renderStepRace() {
    const weeksOut = raceDateObj
      ? Math.ceil((raceDateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7))
      : 0;

    const raceDateDisplay = raceDateObj
      ? raceDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      : '';

    return (
      <>
        <Text style={s.stepHeading}>Race day</Text>
        <Text style={s.stepDesc}>
          When's your marathon? We'll work backwards to build the perfect plan.
        </Text>

        <View style={s.card}>
          <PickerField
            label="RACE DATE"
            value={raceDateDisplay}
            placeholder="Tap to pick your race date"
            onPress={() => setShowDatePicker(true)}
          />
          {weeksOut > 0 && (
            <Text style={[s.hint, { marginTop: -8, marginBottom: 8 }]}>{weeksOut} weeks out</Text>
          )}
        </View>

        <View style={s.card}>
          <PickerField
            label="GOAL MARATHON TIME (OPTIONAL)"
            value={goalTimeDisplay}
            placeholder="Tap to set a goal time"
            onPress={() => {
              setHasGoalTime(true);
              setShowGoalTimePicker(true);
            }}
          />
          <Text style={s.hint}>Your paces come from your VDOT, not your goal.</Text>
          {hasGoalTime && goalTimeSeconds > 0 && (
            <Pressable
              style={s.clearBtn}
              onPress={() => {
                setHasGoalTime(false);
                setGoalHours(0);
                setGoalMinutes(0);
                setGoalSeconds(0);
              }}
            >
              <Text style={s.clearBtnText}>Clear goal time</Text>
            </Pressable>
          )}
        </View>

        {previewVDOT !== null && predictedMarathon !== null && (
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>Your predicted marathon</Text>
            <Text style={[s.infoText, { fontSize: 28, fontWeight: '700', color: COLORS.accent }]}>
              {formatTime(predictedMarathon)}
            </Text>
            <Text style={[s.infoText, { marginTop: 8 }]}>
              Based on your {raceDistance} time of {raceTimeDisplay}.{'\n'}
              Paces are set by VDOT ({previewVDOT.toFixed(1)}), not your goal time — this keeps training safe and science-based.
            </Text>
          </View>
        )}
      </>
    );
  }

  function renderStepReview() {
    const weeksOut = raceDateObj
      ? Math.ceil((raceDateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7))
      : 0;

    return (
      <>
        <Text style={s.stepHeading}>Ready to go</Text>
        <Text style={s.stepDesc}>
          Here's your profile. Hit the button to generate your plan.
        </Text>

        <View style={s.reviewCard}>
          <ReviewRow label="Athlete" value={`${name}, ${age}y`} />
          <ReviewRow label="Heart Rate" value={`${restingHr} / ${effectiveMaxHr} bpm`} />
          <ReviewRow label="VDOT" value={previewVDOT?.toFixed(1) ?? '—'} accent />
          <ReviewRow label={`Recent ${raceDistance}`} value={raceTimeDisplay} />
          <ReviewRow label="Current Volume" value={`${weeklyMileage} ${distanceLabel(units)}/week`} />
          <ReviewRow label="Level" value={level.charAt(0).toUpperCase() + level.slice(1)} />
          <ReviewRow label="Training Days" value={availableDays.map(d => DAY_LABELS[d]).join(', ')} />
          <ReviewRow label="Long Run" value={DAY_LABELS[longRunDay]} />
          <ReviewRow label="Race Day" value={`${raceDateStr} (${weeksOut}w)`} />
          {goalTimeDisplay ? <ReviewRow label="Goal" value={goalTimeDisplay} /> : null}
          {predictedMarathon !== null && (
            <ReviewRow label="Predicted Marathon" value={formatTime(predictedMarathon)} accent />
          )}
        </View>
      </>
    );
  }

  function ReviewRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
      <>
        <View style={s.reviewRow}>
          <Text style={s.reviewLabel}>{label}</Text>
          <Text style={[s.reviewValue, accent && { color: COLORS.accent, fontWeight: '700' }]}>{value}</Text>
        </View>
        <View style={s.reviewDivider} />
      </>
    );
  }

  const stepRenderers = [
    renderStepWelcome,
    renderStepFitness,
    renderStepSchedule,
    renderStepRace,
    renderStepReview,
  ];

  const isLast = step === TOTAL_STEPS - 1;

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header with progress — hidden on login-first Welcome screen */}
      {(step > 0 || showNewUserForm) && <View style={s.header}>
        <View style={s.progressTrack}>
          <Animated.View style={[s.progressFill, { width: progressWidth }]} />
        </View>
        <View style={s.stepIndicator}>
          <Text style={s.stepCounter}>
            {step + 1} of {TOTAL_STEPS}
          </Text>
          <Text style={s.stepTitle}>{STEP_TITLES[step]}</Text>
        </View>
      </View>}

      {/* Content */}
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {errors.length > 0 && (
          <View style={s.errorBox}>
            {errors.map((err, i) => (
              <Text key={i} style={s.errorText}>{err}</Text>
            ))}
          </View>
        )}

        {stepRenderers[step]()}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom navigation — hidden on Welcome login screen */}
      {(step > 0 || showNewUserForm) && <View style={s.nav}>
        {step > 0 ? (
          <Pressable style={s.backBtn} onPress={() => { if (step === 0) { setShowNewUserForm(false); } else { back(); } }}>
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        ) : (
          <Pressable style={s.backBtn} onPress={() => setShowNewUserForm(false)}>
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        )}
        <Pressable
          style={[s.nextBtn, isLast && s.submitBtn]}
          onPress={isLast ? handleSubmit : next}
        >
          <Text style={s.nextBtnText}>
            {isLast ? 'Generate Plan' : 'Continue'}
          </Text>
        </Pressable>
      </View>}

      {/* ─── Picker Modals ─── */}

      {/* Race Time Picker */}
      <TimePickerModal
        visible={showRaceTimePicker}
        onClose={() => setShowRaceTimePicker(false)}
        title={`${raceDistance} Finish Time`}
        showHours={false}
        initialMinutes={raceMinutes}
        initialSeconds={raceSeconds}
        onConfirm={(_, m, sec) => {
          setRaceMinutes(m);
          setRaceSeconds(sec);
          setShowRaceTimePicker(false);
        }}
      />

      {/* Goal Time Picker */}
      <TimePickerModal
        visible={showGoalTimePicker}
        onClose={() => setShowGoalTimePicker(false)}
        title="Goal Marathon Time"
        showHours={true}
        initialHours={goalHours}
        initialMinutes={goalMinutes}
        initialSeconds={goalSeconds}
        onConfirm={(h, m, sec) => {
          setGoalHours(h);
          setGoalMinutes(m);
          setGoalSeconds(sec);
          setHasGoalTime(true);
          setShowGoalTimePicker(false);
        }}
      />

      {/* Date Picker — JS-based using WheelColumn */}
      <DatePickerModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        onConfirm={(date) => {
          setRaceDateObj(date);
          setShowDatePicker(false);
        }}
        initialDate={raceDateObj || new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)}
      />

      {/* ─── Restore Auth Modal ─── */}
      <Modal visible={showRestoreModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={restore.overlay}>
          <View style={restore.sheet}>
            <View style={restore.header}>
              <Pressable onPress={() => { setShowRestoreModal(false); setRestoreError(null); }}>
                <Text style={restore.cancelText}>Cancel</Text>
              </Pressable>
              <Text style={restore.title}>Restore Backup</Text>
              <View style={{ width: 60 }} />
            </View>

            <Text style={restore.subtitle}>
              Sign in to download your training data from the cloud.
            </Text>

            <Text style={restore.label}>Email</Text>
            <TextInput
              style={restore.input}
              value={restoreEmail}
              onChangeText={setRestoreEmail}
              placeholder="you@email.com"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={restore.label}>Password</Text>
            <TextInput
              style={restore.input}
              value={restorePassword}
              onChangeText={setRestorePassword}
              placeholder="Your password"
              placeholderTextColor={COLORS.textTertiary}
              secureTextEntry
            />

            {restoreError && <Text style={restore.errorText}>{restoreError}</Text>}

            <Pressable
              style={[restore.submitButton, restoreLoading && { opacity: 0.5 }]}
              onPress={handleRestoreSignIn}
              disabled={restoreLoading}
            >
              {restoreLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={restore.submitText}>Sign In & Restore</Text>
              }
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Restore Modal Styles ────────────────────────────────────

const restore = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cancelText: { color: COLORS.accent, fontSize: 16 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.background, color: COLORS.text, fontSize: 16, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  errorText: { color: COLORS.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  submitButton: { backgroundColor: COLORS.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// ─── Styles ──────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header / Progress
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  progressTrack: {
    height: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  stepCounter: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontWeight: '500',
  },
  stepTitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: 24,
    paddingTop: 16,
  },

  // Hero (Step 1)
  heroTitle: {
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.text,
    lineHeight: 46,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 28,
  },

  // Step heading
  stepHeading: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  stepDesc: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginBottom: 24,
  },

  // Cards
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
  },
  cardHint: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 16,
    marginTop: -8,
  },

  // Fields
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 6,
  },

  // Picker field (tappable)
  pickerField: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerFieldValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  pickerFieldPlaceholder: {
    fontSize: 16,
    color: COLORS.textTertiary,
  },
  pickerFieldIcon: {
    fontSize: 16,
    color: COLORS.textTertiary,
  },

  // Clear button
  clearBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  clearBtnText: {
    fontSize: 13,
    color: COLORS.danger,
    fontWeight: '500',
  },

  // Layout
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  gap: { width: 12 },

  // Pills
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },

  // VDOT Card
  vdotCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.accent,
    gap: 20,
    alignItems: 'center',
  },
  vdotBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vdotBadgeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  vdotBadgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
  },
  vdotPredictions: {
    flex: 1,
  },
  vdotSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  predRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  predLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  predValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },

  // Level selector
  levelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  levelOptionActive: {
    borderColor: COLORS.accent,
  },
  levelEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  levelTextWrap: {
    flex: 1,
  },
  levelLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  levelLabelActive: {
    color: COLORS.accent,
  },
  levelDescText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 16,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radioActive: {
    borderColor: COLORS.accent,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.accent,
  },

  // Days grid
  daysGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  dayChipTextActive: {
    color: '#FFFFFF',
  },

  // Info card
  infoCard: {
    backgroundColor: 'rgba(255, 107, 53, 0.08)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 53, 0.2)',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.accent,
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  infoBold: {
    fontWeight: '700',
    color: COLORS.text,
  },

  // Review card
  reviewCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  reviewDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  reviewLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  reviewValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Errors
  errorBox: {
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  errorText: {
    fontSize: 13,
    color: COLORS.danger,
    marginBottom: 2,
  },

  // Navigation
  nav: {
    flexDirection: 'row',
    padding: 24,
    paddingBottom: 36,
    gap: 12,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
  },
  backBtn: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  nextBtn: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtn: {
    backgroundColor: COLORS.success,
  },
  nextBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Date picker modal
  datePickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  datePickerSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  datePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  datePickerCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  datePickerDone: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accent,
  },

  // Welcome login-first screen
  signInButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cardDesc: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  newUserButton: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  newUserButtonText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },

  // Restore divider
  restoreDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 20,
  },
  restoreLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  restoreOrText: {
    color: COLORS.textTertiary,
    fontSize: 13,
    marginHorizontal: 16,
  },
  restoreHint: {
    color: COLORS.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
