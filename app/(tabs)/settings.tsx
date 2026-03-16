import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';

// Font helpers
const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;

function SectionHeader({ title }: { title: string }) {
  return (
    <H color="$textSecondary" fontSize={14} textTransform="uppercase" letterSpacing={1.5}
      marginTop="$6" marginBottom="$3" marginLeft="$1">
      {title}
    </H>
  );
}

function SettingsRow({
  label, subtitle, onPress, loading, destructive, disabled, rightElement,
}: {
  label: string; subtitle?: string; onPress?: () => void; loading?: boolean;
  destructive?: boolean; disabled?: boolean; rightElement?: React.ReactNode;
}) {
  return (
    <XStack
      alignItems="center" paddingVertical="$3" paddingHorizontal="$4"
      borderBottomWidth={0.5} borderBottomColor="$border"
      opacity={disabled ? 0.5 : 1}
      pressStyle={onPress && !disabled ? { backgroundColor: '$surfaceLight' } : undefined}
      onPress={disabled || loading || !onPress ? undefined : onPress}
    >
      <YStack flex={1}>
        <B color={destructive ? '$danger' : disabled ? '$textTertiary' : '$color'} fontSize={16} fontWeight="500">
          {label}
        </B>
        {subtitle && <B color="$textSecondary" fontSize={13} marginTop={2}>{subtitle}</B>}
      </YStack>
      {loading ? <Spinner size="small" color="$accent" /> : rightElement ?? null}
    </XStack>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return <View width={10} height={10} borderRadius={5} backgroundColor={connected ? '$success' : '$danger'} />;
}

export default function SettingsScreen() {
  const router = useRouter();
  const isStravaConnected = useAppStore((s) => s.isStravaConnected);
  const lastSyncTime = useAppStore((s) => s.lastSyncTime);
  const syncStrava = useAppStore((s) => s.syncStrava);
  const syncStravaConnection = useAppStore((s) => s.syncStravaConnection);
  const generatePlan = useAppStore((s) => s.generatePlan);
  const activePlan = useAppStore((s) => s.activePlan);
  const userProfile = useAppStore((s) => s.userProfile);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { getCurrentUser } = require('../../src/backup/auth');
        const user = await getCurrentUser();
        setAccountEmail(user?.email ?? null);
      } catch {}
    })();
  }, []);

  const formatLastSync = useCallback((iso: string | null): string => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
  }, []);

  const handleConnectStrava = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { connectStrava } = require('../../src/strava/auth');
      const result = await connectStrava();
      if (result) { syncStravaConnection(); Alert.alert('Connected', `Connected to Strava as ${result.athleteName ?? 'athlete'}.`); }
      else Alert.alert('Cancelled', 'Strava connection was cancelled.');
    } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed to connect.'); }
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
    try { const r = await syncStrava(); Alert.alert('Sync Complete', `${r.newActivities ?? 0} new, ${r.matched ?? 0} matched.`); }
    catch (e: any) { Alert.alert('Sync Failed', e.message ?? 'Could not sync.'); }
    finally { setIsSyncing(false); }
  }, [syncStrava]);

  const handleBackup = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const { isLoggedIn } = require('../../src/backup/auth');
      if (!(await isLoggedIn())) { Alert.alert('Login Required', 'Sign in first.'); setIsBackingUp(false); return; }
      const { uploadBackup } = require('../../src/backup/backup');
      await uploadBackup();
      Alert.alert('Backup Complete', 'Data backed up to cloud.');
    } catch (e: any) { Alert.alert('Backup Failed', e.message ?? 'Error.'); }
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
          Alert.alert('Restored', 'Restarting...');
          await useAppStore.getState().initializeApp();
        } catch (e: any) { Alert.alert('Failed', e.message ?? 'Error.'); }
        finally { setIsRestoring(false); }
      }},
    ]);
  }, []);

  const handleRegeneratePlan = useCallback(() => {
    if (!userProfile) { Alert.alert('No Profile', 'Set up your profile first.'); return; }
    Alert.alert('Regenerate Plan', 'Delete current plan and create a new one? Workout history preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Regenerate', style: 'destructive', onPress: async () => {
        setIsGenerating(true);
        try {
          const r = await generatePlan();
          if (r.success) Alert.alert('Plan Generated', r.violations ? `Done.\n\n${r.violations}` : 'Done.');
          else Alert.alert('Failed', r.error ?? 'Unknown error.');
        } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
        finally { setIsGenerating(false); }
      }},
    ]);
  }, [userProfile, generatePlan]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Your local data will remain on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        setIsSigningOut(true);
        try { const { signOut } = require('../../src/backup/auth'); await signOut(); setAccountEmail(null); }
        catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
        finally { setIsSigningOut(false); }
      }},
    ]);
  }, []);

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
      {/* Account */}
      <SectionHeader title="Account" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        {accountEmail ? (
          <>
            <SettingsRow label={accountEmail} subtitle="Signed in — cloud backup enabled" rightElement={<StatusDot connected />} />
            <SettingsRow label="Sign Out" onPress={handleSignOut} loading={isSigningOut} destructive />
          </>
        ) : (
          <SettingsRow label="Sign In" subtitle="Enable cloud backup & restore" onPress={() => router.push('/setup')} />
        )}
      </YStack>

      {/* Strava */}
      <SectionHeader title="Strava" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow label="Connection Status" subtitle={isStravaConnected ? 'Connected' : 'Not connected'} rightElement={<StatusDot connected={isStravaConnected} />} />
        {isStravaConnected ? (
          <>
            <SettingsRow label="Last Sync" subtitle={formatLastSync(lastSyncTime)} />
            <SettingsRow label="Sync Now" onPress={handleSyncStrava} loading={isSyncing} />
            <SettingsRow label="Disconnect Strava" onPress={handleDisconnectStrava} destructive />
          </>
        ) : (
          <SettingsRow label="Connect Strava" onPress={handleConnectStrava} loading={isConnecting} />
        )}
      </YStack>

      {/* Backup */}
      <SectionHeader title="Cloud Backup" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow label="Backup to Cloud" subtitle="Save all data to Supabase" onPress={handleBackup} loading={isBackingUp} />
        <SettingsRow label="Restore from Cloud" subtitle="Replace local data with backup" onPress={handleRestore} loading={isRestoring} destructive />
      </YStack>

      {/* Plan */}
      <SectionHeader title="Training Plan" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow
          label="Regenerate Plan"
          subtitle={activePlan ? 'Delete current plan and create a new one' : 'Generate your first training plan'}
          onPress={handleRegeneratePlan} loading={isGenerating}
          destructive={!!activePlan} disabled={!userProfile}
        />
      </YStack>

      {/* Profile */}
      <SectionHeader title="Profile" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow
          label="View & Edit Profile"
          subtitle={userProfile ? `VDOT ${userProfile.vdot_score} | ${userProfile.experience_level}` : 'Not set up'}
          onPress={() => router.push('/profile')}
        />
      </YStack>

      {/* About */}
      <SectionHeader title="About" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow label="Marathon Coach v2.0" />
      </YStack>

      <YStack height={32} />
    </ScrollView>
  );
}
