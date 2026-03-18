/**
 * Settings Screen — profile, connections, plan management with premium styling.
 */

import { useState, useCallback } from 'react';
import React from 'react';
import { Alert, Pressable, Image } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';
import { GradientText } from '../../src/theme/GradientText';
import { UserAvatar } from '../../src/components/UserAvatar';
import { StravaIcon } from '../../src/components/icons/StravaIcon';
import { HealthIcon } from '../../src/components/icons/HealthIcon';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Reusable components ─────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <H color={colors.textSecondary} fontSize={12} textTransform="uppercase" letterSpacing={1.5} marginTop={24} marginBottom={10} marginLeft={4}>{title}</H>;
}

function SettingsRow({ icon, iconColor, label, subtitle, onPress, loading, destructive, rightElement }: {
  icon?: string; iconColor?: string; label: string; subtitle?: string; onPress?: () => void; loading?: boolean;
  destructive?: boolean; rightElement?: React.ReactNode;
}) {
  return (
    <Pressable onPress={loading || !onPress ? undefined : onPress} style={({ pressed }) => ({ opacity: pressed && onPress ? 0.7 : 1 })}>
      <XStack alignItems="center" paddingVertical={12} paddingHorizontal={14} borderBottomWidth={0.5} borderBottomColor={colors.border}>
        {icon && (
          <View width={28} height={28} borderRadius={14} backgroundColor={(iconColor ?? colors.cyan) + '15'} alignItems="center" justifyContent="center" marginRight={12}>
            <MaterialCommunityIcons name={icon as any} size={14} color={iconColor ?? colors.cyan} />
          </View>
        )}
        <YStack flex={1}>
          <B color={destructive ? colors.orange : colors.textPrimary} fontSize={15} fontWeight="500">{label}</B>
          {subtitle && <B color={colors.textTertiary} fontSize={12} marginTop={1}>{subtitle}</B>}
        </YStack>
        {loading ? <Spinner size="small" color={colors.cyan} /> : rightElement ?? null}
      </XStack>
    </Pressable>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <XStack alignItems="center" gap={6}>
      <View width={8} height={8} borderRadius={4} backgroundColor={on ? colors.success : colors.error} />
      <B color={on ? colors.success : colors.textTertiary} fontSize={12} fontWeight="600">{on ? 'ON' : 'OFF'}</B>
    </XStack>
  );
}

function SmallButton({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <View paddingHorizontal={12} paddingVertical={5} borderRadius={12} borderWidth={1} borderColor={color ?? colors.cyan}>
        <B color={color ?? colors.cyan} fontSize={11} fontWeight="700">{label}</B>
      </View>
    </Pressable>
  );
}

// ─── Main Screen ─────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const generatePlan = useAppStore(s => s.generatePlan);
  const activePlan = useAppStore(s => s.activePlan);
  const userProfile = useAppStore(s => s.userProfile);
  const isStravaConnected = useAppStore(s => s.isStravaConnected);
  const lastSyncTime = useAppStore(s => s.lastSyncTime);
  const syncStrava = useAppStore(s => s.syncStrava);
  const syncStravaConnection = useAppStore(s => s.syncStravaConnection);
  const syncHealth = useAppStore(s => s.syncHealth);
  const healthSnapshot = useAppStore(s => s.healthSnapshot);
  const units = useSettingsStore(s => s.units);
  const setUnits = useSettingsStore(s => s.setUnits);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isHealthSyncing, setIsHealthSyncing] = useState(false);

  const formatLastSync = useCallback((iso: string | null): string => {
    if (!iso) return 'Not synced yet';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }, []);

  // ─── Handlers ─────────────────────────────────────────

  const handleConnectStrava = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { connectStrava } = require('../../src/strava/auth');
      const r = await connectStrava();
      if (r) { syncStravaConnection(); Alert.alert('Connected', `As ${r.athleteName ?? 'athlete'}.`); }
    } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
    finally { setIsConnecting(false); }
  }, [syncStravaConnection]);

  const handleDisconnectStrava = useCallback(() => {
    Alert.alert('Disconnect Strava', 'Your synced data will remain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try { const { disconnectStrava } = require('../../src/strava/auth'); await disconnectStrava(); syncStravaConnection(); }
        catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
      }},
    ]);
  }, [syncStravaConnection]);

  const handleSyncStrava = useCallback(async () => {
    setIsSyncing(true);
    try { const r = await syncStrava(); Alert.alert('Synced', `${r.newActivities ?? 0} new, ${r.matched ?? 0} matched.`); }
    catch (e: any) { Alert.alert('Failed', e.message ?? 'Error.'); }
    finally { setIsSyncing(false); }
  }, [syncStrava]);

  const handleSyncHealth = useCallback(async () => {
    setIsHealthSyncing(true);
    try { await syncHealth(true); } catch {}
    setIsHealthSyncing(false);
  }, [syncHealth]);

  const handleBackup = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const { isLoggedIn } = require('../../src/backup/auth');
      if (!(await isLoggedIn())) { Alert.alert('Login Required', 'Sign in from your Profile first.'); setIsBackingUp(false); return; }
      const { uploadBackup } = require('../../src/backup/backup');
      await uploadBackup();
      Alert.alert('Backup Complete', 'Data backed up to cloud.');
    } catch (e: any) { Alert.alert('Failed', e.message ?? 'Error.'); }
    finally { setIsBackingUp(false); }
  }, []);

  const handleRestore = useCallback(() => {
    Alert.alert('Restore Data', 'Replace all local data with cloud backup? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: async () => {
        setIsRestoring(true);
        try {
          const { isLoggedIn } = require('../../src/backup/auth');
          if (!(await isLoggedIn())) { Alert.alert('Login Required', 'Sign in first.'); setIsRestoring(false); return; }
          const { downloadBackup, restoreDatabase } = require('../../src/backup/backup');
          const data = await downloadBackup();
          if (!data) { Alert.alert('No Backup', 'No backup found.'); setIsRestoring(false); return; }
          await restoreDatabase(data);
          await useAppStore.getState().initializeApp();
          Alert.alert('Restored', 'All data restored successfully.');
        } catch (e: any) { Alert.alert('Failed', e.message ?? 'Error.'); }
        finally { setIsRestoring(false); }
      }},
    ]);
  }, []);

  const handleRegeneratePlan = useCallback(() => {
    if (!userProfile) { Alert.alert('No Profile', 'Set up your profile first.'); return; }
    Alert.alert('Regenerate Plan', 'Delete current plan and create a new one? Workout history will be preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Regenerate', style: 'destructive', onPress: async () => {
        setIsGenerating(true);
        try {
          const r = await generatePlan();
          Alert.alert(r.success ? 'Plan Generated' : 'Failed', r.success ? 'Done.' : (r.error ?? 'Error.'));
        } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
        finally { setIsGenerating(false); }
      }},
    ]);
  }, [userProfile, generatePlan]);

  // ─── HealthKit availability ────────────────────────────
  let hkAvailable = false;
  try { const { isHealthKitAvailable } = require('../../src/health/availability'); hkAvailable = isHealthKitAvailable(); } catch {}

  return (
    <ScrollView flex={1} backgroundColor={colors.background} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

      {/* ─── Compact Profile Card (link to full Profile — NO stats) ── */}
      {userProfile && (
        <Pressable onPress={() => router.push('/profile')} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
          <XStack backgroundColor={colors.surface} borderRadius={14} padding={14} alignItems="center" marginBottom={4}>
            <UserAvatar size={44} name={userProfile.name} avatarBase64={userProfile.avatar_base64 ?? null} />
            <YStack flex={1} marginLeft={12}>
              <B color={colors.textPrimary} fontSize={16} fontWeight="600">{userProfile.name ?? 'Athlete'}</B>
            </YStack>
            <XStack alignItems="center" gap={2}>
              <B color={colors.cyan} fontSize={12} fontWeight="600">View Profile</B>
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.cyan} />
            </XStack>
          </XStack>
        </Pressable>
      )}

      {/* ─── Units ───────────────────────────────────────── */}
      <SectionHeader title="Units" />
      <XStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
        <Pressable style={{ flex: 1 }} onPress={() => setUnits('imperial')}>
          <YStack paddingVertical={12} alignItems="center"
            backgroundColor={units === 'imperial' ? colors.cyan : 'transparent'}>
            <B color={units === 'imperial' ? colors.background : colors.textSecondary} fontSize={14} fontWeight={units === 'imperial' ? '700' : '500'}>Imperial</B>
            <B color={units === 'imperial' ? colors.background : colors.textTertiary} fontSize={10} marginTop={1}>mi, lbs, ft</B>
          </YStack>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => setUnits('metric')}>
          <YStack paddingVertical={12} alignItems="center"
            backgroundColor={units === 'metric' ? colors.cyan : 'transparent'}>
            <B color={units === 'metric' ? colors.background : colors.textSecondary} fontSize={14} fontWeight={units === 'metric' ? '700' : '500'}>Metric</B>
            <B color={units === 'metric' ? colors.background : colors.textTertiary} fontSize={10} marginTop={1}>km, kg, cm</B>
          </YStack>
        </Pressable>
      </XStack>

      {/* ─── Strava ──────────────────────────────────────── */}
      <XStack alignItems="center" gap={6} marginTop={24} marginBottom={10} marginLeft={4}>
        <StravaIcon size={14} />
        <H color={colors.textSecondary} fontSize={12} textTransform="uppercase" letterSpacing={1.5}>Strava</H>
      </XStack>
      <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
        <SettingsRow icon="link-variant" iconColor={colors.strava} label="Connection" rightElement={<StatusDot on={isStravaConnected} />} />
        {isStravaConnected ? (
          <>
            <SettingsRow icon="sync" iconColor={colors.cyan} label="Last Sync" subtitle={formatLastSync(lastSyncTime)}
              rightElement={<SmallButton label="Sync" onPress={handleSyncStrava} />} loading={isSyncing} />
            <SettingsRow icon="link-off" iconColor={colors.orange} label="Disconnect" onPress={handleDisconnectStrava} destructive />
          </>
        ) : (
          <SettingsRow icon="link-variant" iconColor={colors.strava} label="Connect Strava" onPress={handleConnectStrava} loading={isConnecting} />
        )}
      </YStack>

      {/* ─── Apple Health ────────────────────────────────── */}
      {(hkAvailable || healthSnapshot) && (
        <>
          <XStack alignItems="center" gap={6} marginTop={24} marginBottom={10} marginLeft={4}>
            <HealthIcon size={14} />
            <H color={colors.textSecondary} fontSize={12} textTransform="uppercase" letterSpacing={1.5}>Apple Health</H>
          </XStack>
          <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
            <SettingsRow icon="heart-pulse" iconColor={colors.cyan} label="Status"
              rightElement={<StatusDot on={!!healthSnapshot} />} />
            {healthSnapshot && (
              <>
                <SettingsRow icon="pulse" iconColor={colors.cyan} label="Active Signals"
                  subtitle={[
                    healthSnapshot.restingHR != null ? 'RHR' : null,
                    healthSnapshot.hrvRMSSD != null ? 'HRV' : null,
                    healthSnapshot.sleepHours != null ? 'Sleep' : null,
                    healthSnapshot.steps != null ? 'Steps' : null,
                  ].filter(Boolean).join(' · ') || 'None'} />
                <SettingsRow icon="sync" iconColor={colors.cyan} label="Last Sync"
                  subtitle={healthSnapshot.cachedAt ? formatLastSync(healthSnapshot.cachedAt) : 'Not synced yet'}
                  rightElement={<SmallButton label="Sync" onPress={handleSyncHealth} />} loading={isHealthSyncing} />
              </>
            )}
            {!healthSnapshot && (
              <SettingsRow icon="heart-plus" iconColor={colors.cyan} label="Connect Apple Health"
                subtitle="Sync resting HR, HRV, and sleep" onPress={async () => {
                  try {
                    const { requestHealthKitPermissions } = require('../../src/health/permissions');
                    const granted = await requestHealthKitPermissions();
                    if (granted) { await syncHealth(true); Alert.alert('Connected', 'Apple Health synced.'); }
                    else Alert.alert('Denied', 'Enable in Settings → Privacy → Health.');
                  } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
                }} />
            )}
          </YStack>
        </>
      )}

      {/* ─── Cloud Backup ────────────────────────────────── */}
      <SectionHeader title="Cloud Backup" />
      <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
        {(() => {
          const lastBackup = useAppStore.getState().lastBackupTime;
          return lastBackup > 0 ? (
            <SettingsRow icon="clock-outline" iconColor={colors.cyan} label="Last Backup" subtitle={formatLastSync(new Date(lastBackup).toISOString())} />
          ) : null;
        })()}
        <SettingsRow icon="cloud-check-outline" iconColor={colors.cyan} label="Backup to Cloud"
          subtitle="Save all data to Supabase" onPress={handleBackup} loading={isBackingUp} />
        <SettingsRow icon="cloud-download-outline" iconColor={colors.orange} label="Restore from Cloud"
          subtitle="Replace local data with backup" onPress={handleRestore} loading={isRestoring} destructive />
      </YStack>

      {/* ─── Training Plan ───────────────────────────────── */}
      <SectionHeader title="Training Plan" />
      <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
        {activePlan && (
          <SettingsRow icon="calendar-check" iconColor={colors.cyan} label="Current Plan"
            subtitle={`Generated ${new Date(activePlan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · VDOT ${activePlan.vdot_at_generation}`} />
        )}
        <SettingsRow icon="refresh" iconColor={colors.orange} label="Regenerate Plan"
          subtitle={activePlan ? 'Delete current plan and create new' : 'Generate your first plan'}
          onPress={handleRegeneratePlan} loading={isGenerating} destructive={!!activePlan} />
      </YStack>

      {/* ─── Account ──────────────────────────────────────── */}
      <SectionHeader title="Account" />
      <YStack backgroundColor={colors.surface} borderRadius={14} overflow="hidden">
        {(() => {
          const [email, setEmail] = React.useState<string | null>(null);
          const [signingOut, setSigningOut] = React.useState(false);
          React.useEffect(() => {
            (async () => { try { const { getCurrentUser } = require('../../src/backup/auth'); const u = await getCurrentUser(); setEmail(u?.email ?? null); } catch {} })();
          }, []);
          if (email) {
            return (
              <>
                <SettingsRow icon="email-outline" iconColor={colors.cyan} label={email} rightElement={
                  <XStack alignItems="center" gap={4}><View width={6} height={6} borderRadius={3} backgroundColor={colors.success} /><B color={colors.textTertiary} fontSize={11}>Signed in</B></XStack>
                } />
                <SettingsRow icon="logout" iconColor={colors.orange} label="Sign Out" destructive onPress={() => {
                  Alert.alert('Sign Out', 'Your local data will remain.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign Out', style: 'destructive', onPress: async () => {
                      try { const { signOut } = require('../../src/backup/auth'); await signOut(); setEmail(null); } catch {}
                    }},
                  ]);
                }} />
              </>
            );
          }
          return <SettingsRow icon="login" iconColor={colors.cyan} label="Sign In" subtitle="Enable cloud backup" onPress={() => router.push('/setup')} />;
        })()}
      </YStack>

      {/* ─── App Info ────────────────────────────────────── */}
      <YStack alignItems="center" marginTop={32} marginBottom={16}>
        <View width={48} height={48} borderRadius={12} overflow="hidden" marginBottom={8}>
          <Image source={require('../../assets/images/icon.png')} style={{ width: 48, height: 48 }} />
        </View>
        <GradientText text="Gati" style={{ fontSize: 16, fontWeight: '800' }} />
        <B color={colors.textTertiary} fontSize={11} marginTop={1}>Marathon Coach</B>
        <B color={colors.textTertiary} fontSize={10} marginTop={6}>Version 2.0.0</B>
        <B color={colors.textTertiary} fontSize={9} marginTop={2}>Built with AI · Powered by Gemini</B>
      </YStack>
    </ScrollView>
  );
}
