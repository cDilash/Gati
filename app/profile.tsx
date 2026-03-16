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
import { COLORS } from '../src/utils/constants';
import { formatPace } from '../src/engine/vdot';
import { formatPaceRange, calculateHRZones } from '../src/engine/paceZones';
import { predictMarathonTime, formatTime } from '../src/engine/vdot';

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
  const { userProfile, paceZones, saveProfile } = useAppStore();
  const units = useSettingsStore(s => s.units);
  const isMetric = units === 'metric';
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
    setWeeklyMiles(String(userProfile.current_weekly_miles));
    setLongestRun(String(userProfile.longest_recent_run));
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
      current_weekly_miles: Number(weeklyMiles) || userProfile.current_weekly_miles,
      longest_recent_run: Number(longestRun) || userProfile.longest_recent_run,
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
    });

    setEditing(false);
    Alert.alert('Saved', 'Profile updated successfully.');
  }, [userProfile, name, age, gender, weightKg, heightCm, weeklyMiles, longestRun, level, raceName, raceDate, courseProfile, goalType, targetTime, injuries, weaknesses, schedulingNotes, availableDays, longRunDay, saveProfile]);

  if (!userProfile) {
    return (
      <YStack flex={1} backgroundColor={COLORS.background} justifyContent="center" alignItems="center">
        <B color={COLORS.textSecondary} fontSize={16}>No profile set up yet.</B>
      </YStack>
    );
  }

  const predicted = predictMarathonTime(userProfile.vdot_score);

  // ─── View Mode ────────────────────────────────────────────

  if (!editing) {
    return (
      <ScrollView flex={1} backgroundColor={COLORS.background} contentContainerStyle={{ padding: 16 }}>
        {/* Personal */}
        <SectionTitle title="Personal" />
        <YStack backgroundColor={COLORS.surface} borderRadius={14} overflow="hidden">
          <InfoRow label="Name" value={userProfile.name || '—'} />
          <InfoRow label="Age" value={String(userProfile.age)} />
          <InfoRow label="Gender" value={userProfile.gender === 'male' ? 'Male' : 'Female'} />
          <InfoRow label="Height" value={
            userProfile.height_cm
              ? isMetric ? `${userProfile.height_cm} cm` : `${Math.floor(userProfile.height_cm / 30.48)}'${Math.round((userProfile.height_cm % 30.48) / 2.54)}"`
              : 'Not set'
          } />
          <InfoRow label="Weight" value={
            userProfile.weight_kg
              ? isMetric ? `${userProfile.weight_kg} kg` : `${Math.round(userProfile.weight_kg * 2.20462)} lbs`
              : 'Not set'
          } />
          <InfoRow label="Experience" value={userProfile.experience_level} />
        </YStack>

        {/* Running */}
        <SectionTitle title="Running" />
        <YStack backgroundColor={COLORS.surface} borderRadius={14} overflow="hidden">
          <LiveInfoRow label="Weekly Mileage" value={
            isMetric ? `${(userProfile.current_weekly_miles * 1.60934).toFixed(1)} km` : `${userProfile.current_weekly_miles} mi`
          } />
          <LiveInfoRow label="Longest Recent Run" value={
            isMetric ? `${(userProfile.longest_recent_run * 1.60934).toFixed(1)} km` : `${userProfile.longest_recent_run} mi`
          } />
          <InfoRow label="Available Days" value={userProfile.available_days.map(d => DAY_LABELS[d]).join(', ')} />
          <InfoRow label="Long Run Day" value={DAY_LABELS[userProfile.long_run_day]} />
        </YStack>

        {/* Race */}
        <SectionTitle title="Race" />
        <YStack backgroundColor={COLORS.surface} borderRadius={14} overflow="hidden">
          {userProfile.race_name && <InfoRow label="Race" value={userProfile.race_name} />}
          <InfoRow label="Date" value={userProfile.race_date} />
          <InfoRow label="Course" value={userProfile.race_course_profile} />
          <InfoRow label="Goal" value={GOAL_LABELS[userProfile.race_goal_type] || userProfile.race_goal_type} />
          {userProfile.target_finish_time_sec && <InfoRow label="Target Time" value={formatTime(userProfile.target_finish_time_sec)} />}
        </YStack>

        {/* Coaching Context */}
        {(userProfile.injury_history.length > 0 || userProfile.known_weaknesses.length > 0 || userProfile.scheduling_notes) && (
          <>
            <SectionTitle title="Coaching Context" />
            <YStack backgroundColor={COLORS.surface} borderRadius={14} overflow="hidden">
              {userProfile.injury_history.length > 0 && <InfoRow label="Injuries" value={userProfile.injury_history.join(', ')} />}
              {userProfile.known_weaknesses.length > 0 && <InfoRow label="Weaknesses" value={userProfile.known_weaknesses.join(', ')} />}
              {userProfile.scheduling_notes && <InfoRow label="Schedule Notes" value={userProfile.scheduling_notes} />}
            </YStack>
          </>
        )}

        {/* Edit button */}
        <YStack backgroundColor={COLORS.accent} borderRadius={12} paddingVertical={14} alignItems="center" marginTop={24}
          pressStyle={{ opacity: 0.8 }} onPress={() => setEditing(true)}>
          <B color="#fff" fontSize={16} fontWeight="700">Edit Profile</B>
        </YStack>

        {/* Account */}
        <SectionTitle title="Account" />
        <YStack backgroundColor={COLORS.surface} borderRadius={14} overflow="hidden">
          {accountEmail ? (
            <>
              <InfoRow label={accountEmail} value="Signed in" accent />
              <XStack paddingVertical={12} paddingHorizontal={16}
                pressStyle={{ opacity: 0.7 }} onPress={() => {
                  Alert.alert('Sign Out', 'Your local data will remain.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign Out', style: 'destructive', onPress: async () => {
                      setIsSigningOut(true);
                      try { const { signOut } = require('../src/backup/auth'); await signOut(); setAccountEmail(null); }
                      catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
                      finally { setIsSigningOut(false); }
                    }},
                  ]);
                }}>
                <B color="$danger" fontSize={15} fontWeight="500">{isSigningOut ? 'Signing out...' : 'Sign Out'}</B>
              </XStack>
            </>
          ) : (
            <XStack paddingVertical={12} paddingHorizontal={16} pressStyle={{ opacity: 0.7 }} onPress={() => router.push('/setup')}>
              <B color="$color" fontSize={15} fontWeight="500" flex={1}>Sign In</B>
              <B color="$textTertiary" fontSize={13}>Enable cloud backup</B>
            </XStack>
          )}
        </YStack>

        <YStack height={40} />
      </ScrollView>
    );
  }

  // ─── Edit Mode ────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView flex={1} backgroundColor={COLORS.background} contentContainerStyle={{ padding: 16 }}>
        <H fontSize={28} color={COLORS.text} marginBottom={20} letterSpacing={1}>Edit Profile</H>

        <Label text="Name" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholderTextColor="$textTertiary" value={name} onChangeText={setName} />

        <Label text="Age" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholderTextColor="$textTertiary" keyboardType="number-pad" value={age} onChangeText={setAge} />

        <Label text="Height (cm)" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. 175" placeholderTextColor="$textTertiary" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />

        <Label text="Weight (kg)" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Optional" placeholderTextColor="$textTertiary" keyboardType="decimal-pad" value={weightKg} onChangeText={setWeightKg} />

        <Label text="Weekly Mileage" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholderTextColor="$textTertiary" keyboardType="decimal-pad" value={weeklyMiles} onChangeText={setWeeklyMiles} />

        <Label text="Longest Recent Run (mi)" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholderTextColor="$textTertiary" keyboardType="decimal-pad" value={longestRun} onChangeText={setLongestRun} />

        <Label text="Race Name" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Optional" placeholderTextColor="$textTertiary" value={raceName} onChangeText={setRaceName} />

        <Label text="Race Date (YYYY-MM-DD)" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholderTextColor="$textTertiary" value={raceDate} onChangeText={setRaceDate} />

        <Label text="Target Finish Time (H:MM:SS)" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Optional" placeholderTextColor="$textTertiary" value={targetTime} onChangeText={setTargetTime} />

        <Label text="Scheduling Notes" />
        <Input size="$5" backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Optional" placeholderTextColor="$textTertiary" multiline numberOfLines={3} minHeight={60} value={schedulingNotes} onChangeText={setSchedulingNotes} />

        {/* Save / Cancel */}
        <YStack marginTop={24} gap={10}>
          <YStack
            backgroundColor={COLORS.accent}
            borderRadius={12}
            paddingVertical={14}
            alignItems="center"
            pressStyle={{ opacity: 0.8 }}
            onPress={handleSave}
          >
            <B color="#fff" fontSize={16} fontWeight="700">Save Changes</B>
          </YStack>
          <YStack
            backgroundColor={COLORS.surface}
            borderRadius={12}
            paddingVertical={12}
            alignItems="center"
            borderWidth={1}
            borderColor={COLORS.border}
            pressStyle={{ opacity: 0.7 }}
            onPress={() => setEditing(false)}
          >
            <B color={COLORS.textSecondary} fontSize={15} fontWeight="600">Cancel</B>
          </YStack>
        </YStack>

        <YStack height={40} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return (
    <H
      fontSize={14}
      color={COLORS.textSecondary}
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

function Label({ text }: { text: string }) {
  return (
    <B fontSize={14} color={COLORS.textSecondary} marginTop={14} marginBottom={6} fontWeight="600">
      {text}
    </B>
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
      borderBottomColor={COLORS.border}
    >
      <B fontSize={15} color={COLORS.textSecondary} flex={1}>{label}</B>
      {accent ? (
        <M fontSize={15} color={COLORS.accent} textAlign="right" flex={1} fontWeight="700">{value}</M>
      ) : (
        <B fontSize={15} color={COLORS.text} textAlign="right" flex={1} fontWeight="600">{value}</B>
      )}
    </XStack>
  );
}

function LiveInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <YStack paddingVertical={12} paddingHorizontal={16} borderBottomWidth={0.5} borderBottomColor={COLORS.border}>
      <XStack justifyContent="space-between" alignItems="center">
        <B fontSize={15} color={COLORS.textSecondary} flex={1}>{label}</B>
        <M fontSize={15} color={COLORS.text} fontWeight="700">{value}</M>
      </XStack>
      <B fontSize={10} color={COLORS.accent} marginTop={2}>auto-updated from Strava</B>
    </YStack>
  );
}
