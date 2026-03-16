import { useState, useCallback } from 'react';
import React from 'react';
import { Alert } from 'react-native';
import { ScrollView, YStack, XStack, Text, View, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;

function SectionHeader({ title }: { title: string }) {
  return <H color="$textSecondary" fontSize={14} textTransform="uppercase" letterSpacing={1.5} marginTop="$6" marginBottom="$3" marginLeft="$1">{title}</H>;
}

function SettingsRow({ label, subtitle, onPress, loading, destructive, disabled, rightElement }: {
  label: string; subtitle?: string; onPress?: () => void; loading?: boolean; destructive?: boolean; disabled?: boolean; rightElement?: React.ReactNode;
}) {
  return (
    <XStack alignItems="center" paddingVertical="$3" paddingHorizontal="$4" borderBottomWidth={0.5} borderBottomColor="$border"
      opacity={disabled ? 0.5 : 1} pressStyle={onPress && !disabled ? { backgroundColor: '$surfaceLight' } : undefined}
      onPress={disabled || loading || !onPress ? undefined : onPress}>
      <YStack flex={1}>
        <B color={destructive ? '$danger' : disabled ? '$textTertiary' : '$color'} fontSize={16} fontWeight="500">{label}</B>
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
  const generatePlan = useAppStore(s => s.generatePlan);
  const activePlan = useAppStore(s => s.activePlan);
  const userProfile = useAppStore(s => s.userProfile);
  const isStravaConnected = useAppStore(s => s.isStravaConnected);
  const lastSyncTime = useAppStore(s => s.lastSyncTime);
  const syncStrava = useAppStore(s => s.syncStrava);
  const syncStravaConnection = useAppStore(s => s.syncStravaConnection);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const formatLastSync = useCallback((iso: string | null): string => {
    if (!iso) return 'Never';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }, []);

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
          Alert.alert(r.success ? 'Plan Generated' : 'Failed', r.success ? (r.violations ? `Done.\n\n${r.violations}` : 'Done.') : (r.error ?? 'Error.'));
        } catch (e: any) { Alert.alert('Error', e.message ?? 'Failed.'); }
        finally { setIsGenerating(false); }
      }},
    ]);
  }, [userProfile, generatePlan]);

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
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

      {/* Cloud Backup */}
      <SectionHeader title="Cloud Backup" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow label="Backup to Cloud" subtitle="Save all data to Supabase" onPress={handleBackup} loading={isBackingUp} />
        <SettingsRow label="Restore from Cloud" subtitle="Replace local data with backup" onPress={handleRestore} loading={isRestoring} destructive />
      </YStack>

      {/* Training Plan */}
      <SectionHeader title="Training Plan" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <SettingsRow
          label="Regenerate Plan"
          subtitle={activePlan ? 'Delete current plan and create a new one' : 'Generate your first training plan'}
          onPress={handleRegeneratePlan} loading={isGenerating}
          destructive={!!activePlan} disabled={!userProfile}
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
