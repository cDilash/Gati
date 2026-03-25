/**
 * Profile Screen — view and edit all profile data entered during onboarding.
 * Opens as a modal from Settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, YStack, XStack, ScrollView, Spinner, View, Input } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store';
import { useSettingsStore } from '../src/stores/settingsStore';
import { useUnits } from '../src/hooks/useUnits';
import { distanceLabel, weightLabel } from '../src/utils/units';
import { colors } from '../src/theme/colors';
import { formatPace } from '../src/engine/vdot';
import { formatPaceRange, calculateHRZones } from '../src/engine/paceZones';
import { predictMarathonTime, formatTime } from '../src/engine/vdot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GradientText } from '../src/theme/GradientText';
import { GradientButton } from '../src/theme/GradientButton';
import { UserAvatar } from '../src/components/UserAvatar';
import { StravaIcon } from '../src/components/icons/StravaIcon';
import { GarminIcon } from '../src/components/icons/GarminIcon';
import { formatRelativeTime, isStale } from '../src/utils/formatTime';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GENDERS = ['Male', 'Female'] as const;
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
const COURSES = ['Flat', 'Rolling', 'Hilly', 'Unknown'] as const;
const GOALS = ['finish', 'time_goal', 'bq', 'pr'] as const;
const GOAL_LABELS: Record<string, string> = { finish: 'Just Finish', time_goal: 'Time Goal', bq: 'BQ', pr: 'PR' };

export default function ProfileScreen() {
  const router = useRouter();
  const { userProfile, paceZones, saveProfile, lastSyncTime } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const isMetric = units === 'metric';
  const u = useUnits();
  const [editing, setEditing] = useState(false);

  // Account state
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    (async () => { try { const { getCurrentUser } = require('../src/backup/auth'); const u = await getCurrentUser(); setAccountEmail(u?.email ?? null); } catch {} })();
  }, []);

  // Editable fields
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('male');
  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weeklyMiles, setWeeklyMiles] = useState('');
  const [longestRun, setLongestRun] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [courseProfile, setCourseProfile] = useState('unknown');
  const [goalType, setGoalType] = useState('finish');
  const [targetTime, setTargetTime] = useState('');
  const [injuries, setInjuries] = useState<string[]>([]);
  const [weaknesses, setWeaknesses] = useState<string[]>([]);
  const [schedulingNotes, setSchedulingNotes] = useState('');
  const [availableDays, setAvailableDays] = useState<number[]>([]);
  const [longRunDay, setLongRunDay] = useState(0);

  // Load from profile
  useEffect(() => {
    if (!userProfile) return;
    setName(userProfile.name || '');
    setAge(String(userProfile.age));
    setGender(userProfile.gender);
    setWeightKg(userProfile.weight_kg ? String(userProfile.weight_kg) : '');
    setHeightCm(userProfile.height_cm ? String(userProfile.height_cm) : '');
    setWeeklyMiles(String(u.rawDist(userProfile.current_weekly_miles).toFixed(1)));
    setLongestRun(String(u.rawDist(userProfile.longest_recent_run).toFixed(1)));
    setLevel(userProfile.experience_level);
    setRaceName(userProfile.race_name || '');
    setRaceDate(userProfile.race_date);
    setCourseProfile(userProfile.race_course_profile);
    setGoalType(userProfile.race_goal_type);
    setTargetTime(userProfile.target_finish_time_sec ? formatTime(userProfile.target_finish_time_sec) : '');
    setInjuries(userProfile.injury_history || []);
    setWeaknesses(userProfile.known_weaknesses || []);
    setSchedulingNotes(userProfile.scheduling_notes || '');
    setAvailableDays(userProfile.available_days || []);
    setLongRunDay(userProfile.long_run_day);
  }, [userProfile]);

  const handleSave = useCallback(() => {
    if (!userProfile) return;

    let targetSec: number | null = null;
    if (targetTime.trim()) {
      const parts = targetTime.trim().split(':').map(Number);
      if (parts.length === 3) targetSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) targetSec = parts[0] * 60 + parts[1];
    }

    saveProfile({
      name: name.trim() || null,
      age: Number(age) || userProfile.age,
      gender: gender as any,
      weight_kg: weightKg ? Number(weightKg) : null,
      height_cm: heightCm ? Number(heightCm) : userProfile.height_cm,
      vdot_score: userProfile.vdot_score,
      max_hr: userProfile.max_hr,
      rest_hr: userProfile.rest_hr,
      current_weekly_miles: weeklyMiles ? (isMetric ? Number(weeklyMiles) * 0.621371 : Number(weeklyMiles)) : userProfile.current_weekly_miles,
      longest_recent_run: longestRun ? (isMetric ? Number(longestRun) * 0.621371 : Number(longestRun)) : userProfile.longest_recent_run,
      experience_level: level as any,
      race_date: raceDate || userProfile.race_date,
      race_name: raceName.trim() || null,
      race_course_profile: courseProfile as any,
      race_goal_type: goalType as any,
      target_finish_time_sec: targetSec,
      injury_history: injuries,
      known_weaknesses: weaknesses,
      scheduling_notes: schedulingNotes.trim() || null,
      available_days: availableDays,
      long_run_day: longRunDay,
      weight_source: 'manual',
      weight_updated_at: new Date().toISOString().split('T')[0],
      vdot_updated_at: userProfile.vdot_updated_at ?? null,
      vdot_source: userProfile.vdot_source ?? null,
      vdot_confidence: userProfile.vdot_confidence ?? null,
      avatar_base64: userProfile.avatar_base64 ?? null,
    });

    setEditing(false);
    Alert.alert('Saved', 'Profile updated successfully.');
  }, [userProfile, name, age, gender, weightKg, heightCm, weeklyMiles, longestRun, level, raceName, raceDate, courseProfile, goalType, targetTime, injuries, weaknesses, schedulingNotes, availableDays, longRunDay, saveProfile]);

  if (!userProfile) {
    return (
      <YStack flex={1} backgroundColor={colors.background} justifyContent="center" alignItems="center">
        <B color={colors.textSecondary} fontSize={16}>No profile set up yet.</B>
      </YStack>
    );
  }

  const predicted = predictMarathonTime(userProfile.vdot_score);

  // ─── View Mode ────────────────────────────────────────────

  const daysUntilRace = useAppStore(s => s.daysUntilRace);
  const weeks = useAppStore(s => s.weeks);
  const currentWeekNumber = useAppStore(s => s.currentWeekNumber);
  const progressPct = weeks.length > 0 ? Math.round((currentWeekNumber / weeks.length) * 100) : 0;

  const weightDisplay = userProfile.weight_kg
    ? u.wt(userProfile.weight_kg)
    : null;
  const heightDisplay = userProfile.height_cm
    ? u.ht(userProfile.height_cm)
    : null;

  if (!editing) {
    return (
      <ScrollView flex={1} backgroundColor={colors.background} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ─── Hero ─────────────────────────────────────── */}
        <YStack alignItems="center" marginBottom={20} marginTop={8}>
          <View marginBottom={12}>
            <UserAvatar
              size={80}
              name={userProfile.name}
              avatarBase64={userProfile.avatar_base64 ?? null}
              editable
              onAvatarChanged={(base64) => {
                try {
                  const db = require('../src/db/database').getDatabase();
                  db.runSync('UPDATE user_profile SET avatar_base64 = ? WHERE id = 1', [base64]);
                  useAppStore.getState().refreshState();
                } catch {}
              }}
            />
          </View>
          <B color={colors.textPrimary} fontSize={20} fontWeight="700">{userProfile.name ?? 'Athlete'}</B>
          <B color={colors.textTertiary} fontSize={13} marginTop={2}>
            {userProfile.experience_level.charAt(0).toUpperCase() + userProfile.experience_level.slice(1)} · {userProfile.age} yrs · {userProfile.gender === 'male' ? 'Male' : 'Female'}
          </B>
        </YStack>

        {/* ─── Body ──────────────────────────────────────── */}
        {(heightDisplay || weightDisplay) && (
          <>
            <SectionTitle title="Body" />
            <XStack gap={8} marginBottom={16}>
              {heightDisplay && <MiniStat value={heightDisplay.split(' ')[0]} label={heightDisplay.split(' ')[1] ?? ''} />}
              {weightDisplay && <MiniStat value={weightDisplay.split(' ')[0]} label={weightDisplay.split(' ')[1] ?? ''} source={userProfile.weight_source === 'strava' ? 'Strava' : userProfile.weight_source === 'garmin' ? 'Garmin' : undefined} updatedAt={userProfile.weight_updated_at} />}
              {heightDisplay && weightDisplay && userProfile.height_cm && userProfile.weight_kg && (
                <MiniStat value={String((userProfile.weight_kg / ((userProfile.height_cm / 100) ** 2)).toFixed(1))} label="BMI" />
              )}
            </XStack>
          </>
        )}

        {/* ─── Fitness ──────────────────────────────────── */}
        <SectionTitle title="Fitness" />
        <XStack gap={8} marginBottom={16}>
          <YStack flex={1} backgroundColor={colors.surface} borderRadius={10} padding={10} alignItems="center" borderWidth={0.5} borderColor={colors.border}>
            <GradientText text={String(userProfile.vdot_score)} style={{ fontSize: 16, fontWeight: '700' }} />
            <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>VDOT</H>
            {userProfile.vdot_updated_at && (
              <XStack alignItems="center" gap={3} marginTop={2}>
                {userProfile.vdot_source?.includes('strava') && <StravaIcon size={8} />}
                <B color={isStale(userProfile.vdot_updated_at, 56) ? colors.orange : colors.textTertiary} fontSize={7}>
                  {formatRelativeTime(userProfile.vdot_updated_at)}
                </B>
              </XStack>
            )}
            {!userProfile.vdot_updated_at && userProfile.vdot_source && (
              <XStack alignItems="center" gap={3} marginTop={2}>
                {userProfile.vdot_source.includes('strava') && <StravaIcon size={8} />}
                <B color={colors.textTertiary} fontSize={7}>{userProfile.vdot_source === 'strava_best_effort' ? 'Strava' : userProfile.vdot_source}</B>
              </XStack>
            )}
          </YStack>
          {userProfile.max_hr && (
            <YStack flex={1} backgroundColor={colors.surface} borderRadius={10} padding={10} alignItems="center" borderWidth={0.5} borderColor={colors.border}>
              <M color={colors.orange} fontSize={16} fontWeight="700">{userProfile.max_hr}</M>
              <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>MAX HR</H>
              <XStack alignItems="center" gap={3} marginTop={2}>
                <StravaIcon size={8} />
                <B color={(userProfile as any).max_hr_updated_at && isStale((userProfile as any).max_hr_updated_at, 84) ? colors.orange : colors.textTertiary} fontSize={7}>
                  {(userProfile as any).max_hr_updated_at ? formatRelativeTime((userProfile as any).max_hr_updated_at) : 'Strava'}
                </B>
              </XStack>
            </YStack>
          )}
          {userProfile.rest_hr && (
            <YStack flex={1} backgroundColor={colors.surface} borderRadius={10} padding={10} alignItems="center" borderWidth={0.5} borderColor={colors.border}>
              <M color={colors.orange} fontSize={16} fontWeight="700">{userProfile.rest_hr}</M>
              <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>REST HR</H>
              <XStack alignItems="center" gap={3} marginTop={2}>
                <GarminIcon size={10} />
                <B color={(userProfile as any).rest_hr_updated_at && isStale((userProfile as any).rest_hr_updated_at, 3) ? colors.orange : colors.textTertiary} fontSize={7}>
                  {(userProfile as any).rest_hr_updated_at ? formatRelativeTime((userProfile as any).rest_hr_updated_at) : 'Garmin'}
                </B>
              </XStack>
            </YStack>
          )}
        </XStack>

        {/* ─── Running Schedule ──────────────────────────── */}
        <SectionTitle title="Running Schedule" />
        <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
          <IconRow icon="road-variant" label="Weekly Mileage" value={u.dist(userProfile.current_weekly_miles)} source="Strava" updatedAt={(userProfile as any).weekly_mileage_updated_at || lastSyncTime || null} />
          <IconRow icon="run-fast" label="Longest Recent Run" value={u.dist(userProfile.longest_recent_run)} source="Strava" updatedAt={(userProfile as any).longest_run_updated_at || lastSyncTime || null} />
          <XStack paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border} alignItems="center">
            <View width={28} height={28} borderRadius={14} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginRight={12}>
              <MaterialCommunityIcons name="calendar-check" size={14} color={colors.cyan} />
            </View>
            <B color={colors.textSecondary} fontSize={14} flex={1}>Available Days</B>
            <XStack gap={4}>
              {[0, 1, 2, 3, 4, 5, 6].map(d => (
                <View key={d} width={20} height={20} borderRadius={10} alignItems="center" justifyContent="center"
                  backgroundColor={userProfile.available_days.includes(d) ? colors.cyan : colors.surfaceHover}>
                  <B color={userProfile.available_days.includes(d) ? colors.background : colors.textTertiary} fontSize={8} fontWeight="700">
                    {DAY_LABELS[d].charAt(0)}
                  </B>
                </View>
              ))}
            </XStack>
          </XStack>
          <IconRow icon="calendar-star" label="Long Run Day" value={DAY_LABELS[userProfile.long_run_day]} />
        </YStack>

        {/* ─── Race ─────────────────────────────────────── */}
        {userProfile.race_name && (
          <>
            <SectionTitle title="Race" />
            <YStack backgroundColor={colors.surface} borderRadius={14} padding={16}>
              <XStack alignItems="center" gap={12} marginBottom={12}>
                <View width={40} height={40} borderRadius={20} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center">
                  <MaterialCommunityIcons name="trophy" size={20} color={colors.cyan} />
                </View>
                <YStack flex={1}>
                  <B color={colors.textPrimary} fontSize={16} fontWeight="600">{userProfile.race_name}</B>
                  <B color={colors.textTertiary} fontSize={12}>
                    {new Date(userProfile.race_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </B>
                </YStack>
              </XStack>
              <XStack gap={8} marginBottom={12}>
                <YStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10} alignItems="center">
                  <B color={colors.textPrimary} fontSize={13} fontWeight="600">{userProfile.race_course_profile !== 'unknown' ? userProfile.race_course_profile.charAt(0).toUpperCase() + userProfile.race_course_profile.slice(1) : 'TBD'}</B>
                  <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>COURSE</H>
                </YStack>
                <YStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10} alignItems="center">
                  <M color={colors.cyan} fontSize={13} fontWeight="700">{userProfile.target_finish_time_sec ? formatTime(userProfile.target_finish_time_sec) : `~${formatTime(predicted)}`}</M>
                  <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>{userProfile.target_finish_time_sec ? 'TARGET' : 'PREDICTED'}</H>
                </YStack>
              </XStack>
              {daysUntilRace > 0 && (
                <YStack>
                  <B color={colors.textTertiary} fontSize={12} marginBottom={4}>{daysUntilRace} days to go</B>
                  <View height={4} borderRadius={2} backgroundColor={colors.surfaceHover} overflow="hidden">
                    <View height={4} borderRadius={2} backgroundColor={colors.cyan} width={`${progressPct}%` as any} />
                  </View>
                </YStack>
              )}
            </YStack>
          </>
        )}

        {/* ─── Coaching Context ──────────────────────────── */}
        <SectionTitle title="Coaching Context" />
        <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
          <XStack paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border} alignItems="flex-start">
            <View width={28} height={28} borderRadius={14} backgroundColor={colors.orangeGhost} alignItems="center" justifyContent="center" marginRight={12} marginTop={2}>
              <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.orange} />
            </View>
            <YStack flex={1}>
              <B color={colors.textSecondary} fontSize={14}>Weaknesses</B>
              {userProfile.known_weaknesses.length > 0 ? (
                <XStack gap={6} marginTop={4} flexWrap="wrap">
                  {userProfile.known_weaknesses.map((w, i) => (
                    <View key={i} paddingHorizontal={8} paddingVertical={3} borderRadius={6} backgroundColor={colors.orangeGhost} borderWidth={0.5} borderColor={colors.orangeDim}>
                      <B color={colors.orange} fontSize={11} fontWeight="600">{w}</B>
                    </View>
                  ))}
                </XStack>
              ) : <B color={colors.textTertiary} fontSize={12} marginTop={2}>None</B>}
            </YStack>
          </XStack>
          <IconRow icon="medical-bag" iconColor={colors.textSecondary} label="Injuries" value={userProfile.injury_history.length > 0 ? userProfile.injury_history.join(', ') : 'None'} />
        </YStack>

        {/* ─── Training Summary ───────────────────────── */}
        <SectionTitle title="Training Summary" />
        {(() => {
          try {
            const { getAllMetrics } = require('../src/db/database');
            const metrics = getAllMetrics(500);
            const totalRuns = metrics.length;
            const totalMiles = metrics.reduce((s: number, m: any) => s + (m.distance_miles ?? 0), 0);
            const totalMin = metrics.reduce((s: number, m: any) => s + (m.duration_minutes ?? 0), 0);
            const totalHrs = Math.floor(totalMin / 60);
            const totalMn = Math.round(totalMin % 60);
            return (
              <YStack backgroundColor={colors.surface} borderRadius={14} padding={16}>
                <XStack gap={8} marginBottom={12}>
                  <YStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10} alignItems="center">
                    <M color={colors.textPrimary} fontSize={18} fontWeight="800">{totalRuns}</M>
                    <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>RUNS</H>
                  </YStack>
                  <YStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10} alignItems="center">
                    <M color={colors.textPrimary} fontSize={18} fontWeight="800">{Math.round(u.rawDist(totalMiles))}</M>
                    <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>TOTAL {u.distLabel.toUpperCase()}</H>
                  </YStack>
                  <YStack flex={1} backgroundColor={colors.surfaceHover} borderRadius={10} padding={10} alignItems="center">
                    <M color={colors.textPrimary} fontSize={18} fontWeight="800">{totalHrs}:{String(totalMn).padStart(2, '0')}</M>
                    <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>HOURS</H>
                  </YStack>
                </XStack>
                <B color={colors.textTertiary} fontSize={12}>
                  Plan progress: Week {currentWeekNumber} of {weeks.length}
                </B>
              </YStack>
            );
          } catch { return null; }
        })()}

        {/* ─── Edit Button ──────────────────────────────── */}
        <YStack marginTop={24} marginBottom={8}>
          <GradientButton label="Edit Profile" onPress={() => setEditing(true)} />
        </YStack>

        <YStack height={40} />
      </ScrollView>
    );
  }

  // ─── Edit Mode ────────────────────────────────────────────

  const WEAKNESS_OPTIONS = ['Hills', 'Endurance', 'Speed', 'Pacing', 'Heat', 'Nutrition', 'Mental'];
  const INJURY_OPTIONS = ['Shin Splints', 'Knee Pain', 'IT Band', 'Plantar Fasciitis', 'Achilles', 'Hip Pain', 'Back Pain'];

  const toggleChip = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header with Cancel / Save */}
      <XStack backgroundColor={colors.background} paddingHorizontal={16} paddingVertical={12} alignItems="center" borderBottomWidth={0.5} borderBottomColor={colors.border}>
        <B color={colors.textSecondary} fontSize={15} pressStyle={{ opacity: 0.7 }} onPress={() => setEditing(false)}>Cancel</B>
        <YStack flex={1} alignItems="center"><H fontSize={18} color={colors.textPrimary} letterSpacing={1}>Edit Profile</H></YStack>
        <B color={colors.cyan} fontSize={15} fontWeight="700" pressStyle={{ opacity: 0.7 }} onPress={handleSave}>Save</B>
      </XStack>

      <ScrollView flex={1} backgroundColor={colors.background} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* Avatar */}
        <YStack alignItems="center" marginBottom={20}>
          <UserAvatar size={80} name={userProfile.name} avatarBase64={userProfile.avatar_base64 ?? null} editable
            onAvatarChanged={(b64) => { try { require('../src/db/database').getDatabase().runSync('UPDATE user_profile SET avatar_base64 = ? WHERE id = 1', [b64]); useAppStore.getState().refreshState(); } catch {} }} />
          <B color={colors.textTertiary} fontSize={11} marginTop={6}>Tap to change photo</B>
        </YStack>

        {/* PERSONAL */}
        <SectionTitle title="Personal" />
        <YStack backgroundColor={colors.surface} borderRadius={14} padding={14} gap={12} marginBottom={16}>
          <FormField icon="account" label="Name"><FInput value={name} onChangeText={setName} /></FormField>
          <XStack gap={10}>
            <YStack flex={1}><FormField icon="cake-variant" label="Age"><FInput value={age} onChangeText={setAge} keyboardType="number-pad" mono /></FormField></YStack>
            <YStack flex={1}><FormField icon="human-male-height" label={`Height (${isMetric ? 'cm' : 'in'})`}><FInput value={heightCm} onChangeText={setHeightCm} keyboardType="number-pad" mono /></FormField></YStack>
            <YStack flex={1}><FormField icon="scale-bathroom" label={`Weight (${weightLabel(u.units)})`}><FInput value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" mono placeholder="—" /></FormField></YStack>
          </XStack>
          <FormField icon="gender-male-female" label="Gender">
            <SegmentedControl options={GENDERS.map(g => g)} selected={gender === 'male' ? 'Male' : 'Female'} onSelect={(v) => setGender(v.toLowerCase())} />
          </FormField>
          <FormField icon="run" label="Experience">
            <SegmentedControl options={LEVELS.map(l => l)} selected={level.charAt(0).toUpperCase() + level.slice(1)} onSelect={(v) => setLevel(v.toLowerCase())} />
          </FormField>
        </YStack>

        {/* RUNNING */}
        <SectionTitle title="Running" />
        <YStack backgroundColor={colors.surface} borderRadius={14} padding={14} gap={12} marginBottom={16}>
          <XStack gap={10}>
            <YStack flex={1}><FormField icon="road-variant" label={`Weekly ${u.distLabel}`}><FInput value={weeklyMiles} onChangeText={setWeeklyMiles} keyboardType="decimal-pad" mono /></FormField></YStack>
            <YStack flex={1}><FormField icon="run-fast" label={`Longest Run (${u.distLabel})`}><FInput value={longestRun} onChangeText={setLongestRun} keyboardType="decimal-pad" mono /></FormField></YStack>
          </XStack>
          <FormField icon="calendar-check" label="Available Days">
            <XStack gap={4} marginTop={4}>
              {[0,1,2,3,4,5,6].map(d => (
                <YStack key={d} width={36} height={36} borderRadius={18} alignItems="center" justifyContent="center"
                  backgroundColor={availableDays.includes(d) ? colors.cyan : colors.surfaceHover}
                  borderWidth={1} borderColor={availableDays.includes(d) ? colors.cyan : colors.border}
                  pressStyle={{ opacity: 0.7 }}
                  onPress={() => setAvailableDays(availableDays.includes(d) ? availableDays.filter(x => x !== d) : [...availableDays, d])}>
                  <B color={availableDays.includes(d) ? colors.background : colors.textSecondary} fontSize={11} fontWeight="700">{DAY_LABELS[d].charAt(0)}</B>
                </YStack>
              ))}
            </XStack>
          </FormField>
          <FormField icon="calendar-star" label="Long Run Day">
            <XStack gap={4} marginTop={4}>
              {[0,1,2,3,4,5,6].map(d => (
                <YStack key={d} width={36} height={36} borderRadius={18} alignItems="center" justifyContent="center"
                  backgroundColor={longRunDay === d ? colors.cyan : colors.surfaceHover}
                  borderWidth={1} borderColor={longRunDay === d ? colors.cyan : colors.border}
                  pressStyle={{ opacity: 0.7 }} onPress={() => setLongRunDay(d)}>
                  <B color={longRunDay === d ? colors.background : colors.textSecondary} fontSize={11} fontWeight="700">{DAY_LABELS[d].charAt(0)}</B>
                </YStack>
              ))}
            </XStack>
          </FormField>
        </YStack>

        {/* RACE */}
        <SectionTitle title="Race" />
        <YStack backgroundColor={colors.surface} borderRadius={14} padding={14} gap={12} marginBottom={16}>
          <FormField icon="trophy" label="Race Name"><FInput value={raceName} onChangeText={setRaceName} placeholder="Optional" /></FormField>
          <XStack gap={10}>
            <YStack flex={1}><FormField icon="calendar" label="Race Date"><FInput value={raceDate} onChangeText={setRaceDate} placeholder="YYYY-MM-DD" mono /></FormField></YStack>
            <YStack flex={1}><FormField icon="timer-outline" label="Target Time"><FInput value={targetTime} onChangeText={setTargetTime} placeholder="H:MM:SS" mono /></FormField></YStack>
          </XStack>
          <FormField icon="terrain" label="Course">
            <SegmentedControl options={['Flat', 'Rolling', 'Hilly']} selected={courseProfile.charAt(0).toUpperCase() + courseProfile.slice(1)} onSelect={(v) => setCourseProfile(v.toLowerCase())} />
          </FormField>
          <FormField icon="flag-checkered" label="Goal">
            <SegmentedControl options={['Time Goal', 'Just Finish', 'BQ', 'PR']} selected={GOAL_LABELS[goalType] ?? goalType} onSelect={(v) => { const m: Record<string, string> = { 'Time Goal': 'time_goal', 'Just Finish': 'finish', 'BQ': 'bq', 'PR': 'pr' }; setGoalType(m[v] ?? 'finish'); }} />
          </FormField>
        </YStack>

        {/* COACHING */}
        <SectionTitle title="Coaching" />
        <YStack backgroundColor={colors.surface} borderRadius={14} padding={14} gap={12} marginBottom={16}>
          <FormField icon="alert-circle-outline" label="Weaknesses">
            <XStack flexWrap="wrap" gap={6} marginTop={4}>
              {WEAKNESS_OPTIONS.map(w => (
                <YStack key={w} paddingHorizontal={12} paddingVertical={6} borderRadius={8}
                  backgroundColor={weaknesses.includes(w) ? colors.cyanGhost : colors.surfaceHover}
                  borderWidth={1} borderColor={weaknesses.includes(w) ? colors.cyanDim : colors.border}
                  pressStyle={{ opacity: 0.7 }} onPress={() => toggleChip(weaknesses, w, setWeaknesses)}>
                  <B color={weaknesses.includes(w) ? colors.cyan : colors.textSecondary} fontSize={12} fontWeight="600">
                    {weaknesses.includes(w) ? `${w} ✓` : w}
                  </B>
                </YStack>
              ))}
            </XStack>
          </FormField>
          <FormField icon="medical-bag" label="Injuries">
            <XStack flexWrap="wrap" gap={6} marginTop={4}>
              {INJURY_OPTIONS.map(inj => (
                <YStack key={inj} paddingHorizontal={12} paddingVertical={6} borderRadius={8}
                  backgroundColor={injuries.includes(inj) ? colors.orangeGhost : colors.surfaceHover}
                  borderWidth={1} borderColor={injuries.includes(inj) ? colors.orangeDim : colors.border}
                  pressStyle={{ opacity: 0.7 }} onPress={() => toggleChip(injuries, inj, setInjuries)}>
                  <B color={injuries.includes(inj) ? colors.orange : colors.textSecondary} fontSize={12} fontWeight="600">
                    {injuries.includes(inj) ? `${inj} ✓` : inj}
                  </B>
                </YStack>
              ))}
            </XStack>
          </FormField>
          <FormField icon="notebook-outline" label="Schedule Notes">
            <FInput value={schedulingNotes} onChangeText={setSchedulingNotes} placeholder="Optional constraints..." multiline />
          </FormField>
        </YStack>

        {/* AUTO-DETECTED (read-only) */}
        {(userProfile.max_hr || userProfile.rest_hr) && (
          <>
            <SectionTitle title="Auto-Detected" />
            <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden" marginBottom={16}>
              {userProfile.max_hr && (
                <XStack paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border} alignItems="center">
                  <View width={24} height={24} borderRadius={12} backgroundColor={colors.orangeGhost} alignItems="center" justifyContent="center" marginRight={10}>
                    <MaterialCommunityIcons name="heart" size={12} color={colors.orange} />
                  </View>
                  <YStack flex={1}>
                    <B color={colors.textSecondary} fontSize={12}>Max HR</B>
                    <XStack alignItems="center" gap={3}><StravaIcon size={10} /><B color={colors.strava} fontSize={10}>Strava</B></XStack>
                  </YStack>
                  <M color={colors.orange} fontSize={15} fontWeight="700">{userProfile.max_hr} bpm</M>
                </XStack>
              )}
              {userProfile.rest_hr && (
                <XStack paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border} alignItems="center">
                  <View width={24} height={24} borderRadius={12} backgroundColor={colors.orangeGhost} alignItems="center" justifyContent="center" marginRight={10}>
                    <MaterialCommunityIcons name="heart-outline" size={12} color={colors.orange} />
                  </View>
                  <YStack flex={1}>
                    <B color={colors.textSecondary} fontSize={12}>Resting HR</B>
                    <B color={colors.textTertiary} fontSize={10}>from Garmin</B>
                  </YStack>
                  <M color={colors.orange} fontSize={15} fontWeight="700">{userProfile.rest_hr} bpm</M>
                </XStack>
              )}
              <XStack paddingVertical={12} paddingHorizontal={14} alignItems="center">
                <View width={24} height={24} borderRadius={12} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginRight={10}>
                  <MaterialCommunityIcons name="speedometer" size={12} color={colors.cyan} />
                </View>
                <YStack flex={1}>
                  <B color={colors.textSecondary} fontSize={12}>VDOT</B>
                  <B color={colors.textTertiary} fontSize={10}>{userProfile.vdot_source ?? 'manual'}</B>
                </YStack>
                <GradientText text={String(userProfile.vdot_score)} style={{ fontSize: 15, fontWeight: '700' }} />
              </XStack>
            </YStack>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return (
    <H
      fontSize={14}
      color={colors.textSecondary}
      textTransform="uppercase"
      letterSpacing={1.5}
      marginTop={20}
      marginBottom={8}
      marginLeft={4}
    >
      {title}
    </H>
  );
}

function FormField({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <YStack>
      <XStack alignItems="center" gap={6} marginBottom={4}>
        <MaterialCommunityIcons name={icon as any} size={14} color={colors.textTertiary} />
        <B color={colors.textTertiary} fontSize={11}>{label}</B>
      </XStack>
      {children}
    </YStack>
  );
}

function FInput({ value, onChangeText, placeholder, keyboardType, mono, multiline }: {
  value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad'; mono?: boolean; multiline?: boolean;
}) {
  return (
    <Input backgroundColor={colors.surfaceHover} borderColor={colors.border} borderRadius={12}
      color={colors.textPrimary} fontSize={16} fontFamily={mono ? '$mono' : '$body'} fontWeight={mono ? '600' : '400'}
      placeholderTextColor="$textTertiary" paddingHorizontal={14} paddingVertical={10}
      height={multiline ? undefined : 44}
      placeholder={placeholder} keyboardType={keyboardType} multiline={multiline}
      minHeight={multiline ? 80 : 44}
      value={value} onChangeText={onChangeText}
    />
  );
}

function SegmentedControl({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (v: string) => void }) {
  return (
    <XStack gap={4} marginTop={4}>
      {options.map(opt => (
        <YStack key={opt} flex={1} height={32} borderRadius={8} alignItems="center" justifyContent="center"
          backgroundColor={selected === opt ? colors.cyan : colors.surfaceHover}
          borderWidth={1} borderColor={selected === opt ? colors.cyan : colors.border}
          pressStyle={{ opacity: 0.7 }} onPress={() => onSelect(opt)}>
          <B color={selected === opt ? colors.background : colors.textSecondary} fontSize={11} fontWeight="600">{opt}</B>
        </YStack>
      ))}
    </XStack>
  );
}

function Label({ text }: { text: string }) {
  return (
    <B fontSize={12} color={colors.textSecondary} marginTop={12} marginBottom={4} fontWeight="600">
      {text}
    </B>
  );
}

function MiniStat({ value, label, source, updatedAt }: { value: string; label: string; source?: string; updatedAt?: string | null }) {
  const stale = source && updatedAt ? isStale(updatedAt, 14) : false;
  return (
    <YStack flex={1} backgroundColor={colors.surface} borderRadius={10} padding={10} alignItems="center" borderWidth={0.5} borderColor={colors.border}>
      <M color={colors.textPrimary} fontSize={16} fontWeight="700">{value}</M>
      <H color={colors.textTertiary} fontSize={8} letterSpacing={1} marginTop={2}>{label.toUpperCase()}</H>
      {source && (
        <XStack alignItems="center" gap={3} marginTop={1}>
          {source === 'Garmin' && <MaterialCommunityIcons name="watch" size={9} color={colors.textTertiary} />}
          {source === 'Strava' && <StravaIcon size={8} />}
          <B color={stale ? colors.orange : colors.textTertiary} fontSize={7}>
            {updatedAt ? formatRelativeTime(updatedAt) : source}
          </B>
        </XStack>
      )}
    </YStack>
  );
}

function IconRow({ icon, iconColor, label, value, source, updatedAt }: { icon: string; iconColor?: string; label: string; value: string; source?: string; updatedAt?: string | null }) {
  const hasTime = updatedAt != null;
  const stale = source === 'Strava' && hasTime && isStale(updatedAt!, 7);
  return (
    <XStack paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border} alignItems="center">
      <View width={28} height={28} borderRadius={14} backgroundColor={(iconColor ?? colors.cyan) + '15'} alignItems="center" justifyContent="center" marginRight={12}>
        <MaterialCommunityIcons name={icon as any} size={14} color={iconColor ?? colors.cyan} />
      </View>
      <YStack flex={1}>
        <B color={colors.textSecondary} fontSize={14}>{label}</B>
        {source && (
          <XStack alignItems="center" gap={4} marginTop={1}>
            {source === 'Strava' && <StravaIcon size={10} />}
            {source === 'Garmin' && <MaterialCommunityIcons name="watch" size={11} color={colors.textTertiary} />}
            <B color={stale ? colors.orange : colors.textTertiary} fontSize={9}>
              {hasTime ? `${source} · ${formatRelativeTime(updatedAt!)}` : `auto · ${source}`}
            </B>
          </XStack>
        )}
      </YStack>
      <M color={colors.textPrimary} fontSize={14} fontWeight="700">{value}</M>
    </XStack>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
      paddingVertical={12}
      paddingHorizontal={16}
      borderBottomWidth={0.5}
      borderBottomColor={colors.border}
    >
      <B fontSize={15} color={colors.textSecondary} flex={1}>{label}</B>
      {accent ? (
        <M fontSize={15} color={colors.cyan} textAlign="right" flex={1} fontWeight="700">{value}</M>
      ) : (
        <B fontSize={15} color={colors.textPrimary} textAlign="right" flex={1} fontWeight="600">{value}</B>
      )}
    </XStack>
  );
}

function LiveInfoRow({ label, value, lastSync }: { label: string; value: string; lastSync?: string | null }) {
  const syncLabel = lastSync ? formatSyncDate(lastSync) : '';
  return (
    <YStack paddingVertical={12} paddingHorizontal={16} borderBottomWidth={0.5} borderBottomColor={colors.border}>
      <XStack justifyContent="space-between" alignItems="center">
        <B fontSize={15} color={colors.textSecondary} flex={1}>{label}</B>
        <M fontSize={15} color={colors.textPrimary} fontWeight="700">{value}</M>
      </XStack>
      <B fontSize={10} color={colors.cyan} marginTop={2}>auto-updated from Strava{syncLabel ? ` · ${syncLabel}` : ''}</B>
    </YStack>
  );
}

function formatSyncDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
