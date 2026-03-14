import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Alert,
  ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useAppStore } from '../../src/store';
import { COLORS } from '../../src/utils/constants';
import { UnitSystem, formatDistance, formatWeight, paceLabel } from '../../src/utils/units';
import { isStravaConnected, getStoredTokens, connectStrava, disconnectStrava, getLastSyncTime } from '../../src/strava/auth';
import { syncStravaActivities } from '../../src/strava/sync';
import { syncHistoricalActivities } from '../../src/strava/historicalSync';
import { StravaTokens } from '../../src/types';
import { signUp, signIn, signOut, getCurrentUser, isLoggedIn } from '../../src/backup/auth';
import { User } from '@supabase/supabase-js';

const UNIT_OPTIONS: { value: UnitSystem; label: string; examples: string[] }[] = [
  { value: 'imperial', label: 'Imperial', examples: ['Miles (mi)', 'Pounds (lbs)', 'Pace in min/mi'] },
  { value: 'metric', label: 'Metric', examples: ['Kilometers (km)', 'Kilograms (kg)', 'Pace in min/km'] },
];

export default function SettingsScreen() {
  const { units, setUnits } = useSettingsStore();
  const { userProfile, isBackingUp, backupError, backupInfo, isRestoring, restoreError, performBackup, checkBackupStatus, performRestore } = useAppStore();

  // Strava state
  const [stravaTokens, setStravaTokens] = useState<StravaTokens | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [historySyncResult, setHistorySyncResult] = useState<{ imported: number; matched: number } | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [lastSyncDisplay, setLastSyncDisplay] = useState<string | null>(null);

  // Cloud backup auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [backupSuccess, setBackupSuccess] = useState(false);

  useEffect(() => {
    setStravaTokens(getStoredTokens());
    updateLastSyncDisplay();
    // Check cloud auth status
    checkAuthStatus();
  }, []);

  const checkAuthStatus = useCallback(async () => {
    setCheckingAuth(true);
    const user = await getCurrentUser();
    setCurrentUser(user);
    if (user) {
      await checkBackupStatus();
    }
    setCheckingAuth(false);
  }, [checkBackupStatus]);

  const updateLastSyncDisplay = useCallback(() => {
    const syncTime = getLastSyncTime();
    if (!syncTime) { setLastSyncDisplay(null); return; }
    const date = new Date(syncTime);
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) setLastSyncDisplay('Just now');
    else if (diffMin < 60) setLastSyncDisplay(`${diffMin}m ago`);
    else if (diffMin < 1440) setLastSyncDisplay(`${Math.floor(diffMin / 60)}h ago`);
    else setLastSyncDisplay(date.toLocaleDateString());
  }, []);

  const handleConnectStrava = useCallback(async () => {
    setIsConnecting(true);
    try {
      const tokens = await connectStrava();
      if (tokens) {
        setStravaTokens(tokens);
        setIsSyncingHistory(true);
        try {
          const result = await syncHistoricalActivities();
          setHistorySyncResult(result);
          useAppStore.getState().refreshPlan();
          if (result.imported > 0) {
            Alert.alert('Strava Connected', `Imported ${result.imported} run${result.imported !== 1 ? 's' : ''} from the last 8 weeks.${result.matched > 0 ? ` ${result.matched} matched to scheduled workouts.` : ''}`);
          }
        } catch {
          console.warn('Historical sync failed — will sync incrementally');
        } finally {
          setIsSyncingHistory(false);
        }
      } else {
        Alert.alert('Connection Failed', 'Could not connect to Strava. Check your credentials and try again.');
      }
    } catch {
      Alert.alert('Error', 'An unexpected error occurred while connecting to Strava.');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    setIsSyncingNow(true);
    try {
      const result = await syncStravaActivities();
      updateLastSyncDisplay();
      if (result.newActivities > 0) {
        useAppStore.getState().refreshPlan();
        Alert.alert('Sync Complete', `${result.newActivities} new run${result.newActivities !== 1 ? 's' : ''} imported.`);
      } else {
        Alert.alert('Up to Date', 'No new runs to import.');
      }
    } catch {
      Alert.alert('Sync Failed', 'Could not sync with Strava. Please try again.');
    } finally {
      setIsSyncingNow(false);
    }
  }, [updateLastSyncDisplay]);

  const handleDisconnectStrava = useCallback(() => {
    Alert.alert('Disconnect Strava', "Disconnect from Strava? Your imported run data will be kept, but new runs won't sync.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { await disconnectStrava(); setStravaTokens(null); setHistorySyncResult(null); setLastSyncDisplay(null); } },
    ]);
  }, []);

  const handleAuthSuccess = useCallback(async (user: User) => {
    setCurrentUser(user);
    setShowAuthModal(false);
    await checkBackupStatus();
  }, [checkBackupStatus]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Sign out of cloud backup? Your local data and cloud backup will be kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await signOut();
          setCurrentUser(null);
        },
      },
    ]);
  }, []);

  const handleBackupNow = useCallback(async () => {
    setBackupSuccess(false);
    await performBackup();
    setBackupSuccess(true);
    setTimeout(() => setBackupSuccess(false), 3000);
  }, [performBackup]);

  const handleRestore = useCallback(() => {
    const backupDate = backupInfo?.createdAt
      ? new Date(backupInfo.createdAt).toLocaleString()
      : 'unknown date';
    const deviceName = backupInfo?.deviceName || 'unknown device';

    Alert.alert(
      'Restore from Backup?',
      `This will replace ALL local data with the backup from ${backupDate} (${deviceName}).\n\nThis cannot be undone. Your current local data will be overwritten.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            const result = await performRestore();
            if (result.success) {
              Alert.alert('Restore Complete', 'Your data has been restored. The app is now reloading.');
            } else {
              Alert.alert('Restore Failed', result.error || 'Your local data was not changed.');
            }
          },
        },
      ]
    );
  }, [backupInfo, performRestore]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ─── Cloud Backup Section ─────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cloud Backup</Text>
        <Text style={styles.sectionDesc}>
          Back up your training data to restore on a new device. One tap to save, one tap to restore.
        </Text>

        {checkingAuth ? (
          <ActivityIndicator size="small" color={COLORS.accent} style={{ marginTop: 8 }} />
        ) : currentUser ? (
          <CloudBackupLoggedIn
            user={currentUser}
            backupInfo={backupInfo}
            isBackingUp={isBackingUp}
            backupError={backupError}
            backupSuccess={backupSuccess}
            isRestoring={isRestoring}
            restoreError={restoreError}
            onBackup={handleBackupNow}
            onRestore={handleRestore}
            onSignOut={handleSignOut}
          />
        ) : (
          <View style={styles.cloudCard}>
            <Pressable style={styles.primaryButton} onPress={() => { setAuthMode('signup'); setShowAuthModal(true); }}>
              <Text style={styles.primaryButtonText}>Create Backup Account</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, { marginTop: 10 }]} onPress={() => { setAuthMode('signin'); setShowAuthModal(true); }}>
              <Text style={styles.secondaryButtonText}>Sign In to Restore</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ─── Strava Section ───────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Source</Text>
        <Text style={styles.sectionDesc}>Connect Strava to automatically sync your runs from Garmin.</Text>

        {stravaTokens ? (
          <View style={styles.stravaCard}>
            <View style={styles.stravaConnectedHeader}>
              <View style={styles.stravaStatusDot} />
              <Text style={styles.stravaConnectedText}>Connected to Strava</Text>
            </View>
            {stravaTokens.athleteName && <Text style={styles.stravaAthleteName}>{stravaTokens.athleteName}</Text>}
            {isSyncingHistory && <View style={styles.stravaSyncStatus}><ActivityIndicator size="small" color={COLORS.accent} /><Text style={styles.stravaSyncText}>Importing run history...</Text></View>}
            {historySyncResult && !isSyncingHistory && <Text style={styles.stravaSyncDone}>{historySyncResult.imported > 0 ? `${historySyncResult.imported} run${historySyncResult.imported !== 1 ? 's' : ''} imported` : 'No new runs to import'}</Text>}
            {lastSyncDisplay && !isSyncingHistory && <Text style={styles.stravaLastSync}>Last synced: {lastSyncDisplay}</Text>}
            <View style={styles.stravaActions}>
              <Pressable style={[styles.stravaSyncButton, (isSyncingNow || isSyncingHistory) && { opacity: 0.4 }]} onPress={handleSyncNow} disabled={isSyncingNow || isSyncingHistory}>
                {isSyncingNow ? <ActivityIndicator size="small" color={COLORS.accent} /> : <Text style={styles.stravaSyncButtonText}>Sync Now</Text>}
              </Pressable>
              <Pressable style={[styles.stravaDisconnectButton, (isSyncingHistory || isSyncingNow) && { opacity: 0.4 }]} onPress={handleDisconnectStrava} disabled={isSyncingHistory || isSyncingNow}>
                <Text style={styles.stravaDisconnectText}>Disconnect</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={[styles.stravaConnectButton, isConnecting && styles.stravaConnectButtonDisabled]} onPress={handleConnectStrava} disabled={isConnecting}>
            {isConnecting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.stravaConnectText}>Connect with Strava</Text>}
          </Pressable>
        )}
      </View>

      {/* ─── Units Section ────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Units</Text>
        <Text style={styles.sectionDesc}>All distances, weights, and paces will update throughout the app.</Text>
        {UNIT_OPTIONS.map(opt => (
          <Pressable key={opt.value} style={[styles.unitCard, units === opt.value && styles.unitCardActive]} onPress={() => setUnits(opt.value)}>
            <View style={styles.unitCardHeader}>
              <Text style={[styles.unitLabel, units === opt.value && styles.unitLabelActive]}>{opt.label}</Text>
              <View style={[styles.radio, units === opt.value && styles.radioActive]}>{units === opt.value && <View style={styles.radioDot} />}</View>
            </View>
            <View style={styles.exampleList}>{opt.examples.map((ex, i) => <Text key={i} style={styles.exampleText}>{ex}</Text>)}</View>
          </Pressable>
        ))}
      </View>

      {/* ─── Preview Section ──────────────────────────────── */}
      {userProfile && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preview</Text>
          <Text style={styles.sectionDesc}>How your data looks in the current unit system.</Text>
          <View style={styles.previewCard}>
            <PreviewRow label="Weight" value={formatWeight(userProfile.weight_lbs, units)} />
            <PreviewRow label="Weekly Volume" value={formatDistance(userProfile.current_weekly_mileage, units, 0) + '/week'} />
            <PreviewRow label="Longest Run" value={formatDistance(userProfile.longest_recent_run, units)} />
            <PreviewRow label="Pace Unit" value={paceLabel(units)} />
          </View>
        </View>
      )}

      {/* ─── Training Plan Section ───────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Training Plan</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutSubtext}>Regenerate your plan from today using your current profile settings. All future scheduled workouts will be replaced. Completed runs are not affected.</Text>
          <Pressable
            style={styles.regenerateButton}
            onPress={() => {
              Alert.alert(
                'Regenerate Plan',
                'This will replace all future scheduled workouts with a new plan starting today. Completed runs are kept. Continue?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Regenerate',
                    style: 'destructive',
                    onPress: () => {
                      useAppStore.getState().regeneratePlan();
                      Alert.alert('Done', 'Your training plan has been regenerated.');
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.regenerateButtonText}>Regenerate Plan</Text>
          </Pressable>
        </View>
      </View>

      {/* ─── About Section ────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>Marathon Coach v1.0.0</Text>
          <Text style={styles.aboutSubtext}>Training plan powered by Jack Daniels' VDOT system.{'\n'}AI coaching by Google Gemini.</Text>
        </View>
      </View>

      <View style={{ height: 40 }} />

      {/* ─── Auth Modal ───────────────────────────────────── */}
      <AuthModal
        visible={showAuthModal}
        mode={authMode}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleAuthSuccess}
        onSwitchMode={() => setAuthMode(m => m === 'signin' ? 'signup' : 'signin')}
      />
    </ScrollView>
  );
}

// ─── Cloud Backup Logged In View ──────────────────────────────

function CloudBackupLoggedIn({
  user, backupInfo, isBackingUp, backupError, backupSuccess,
  isRestoring, restoreError, onBackup, onRestore, onSignOut,
}: {
  user: User;
  backupInfo: any;
  isBackingUp: boolean;
  backupError: string | null;
  backupSuccess: boolean;
  isRestoring: boolean;
  restoreError: string | null;
  onBackup: () => void;
  onRestore: () => void;
  onSignOut: () => void;
}) {
  const lastBackupText = backupInfo?.createdAt
    ? (() => {
        const d = new Date(backupInfo.createdAt);
        const device = backupInfo.deviceName || 'this device';
        return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${device}`;
      })()
    : 'No backup yet';

  return (
    <View style={styles.cloudCard}>
      {/* Account */}
      <View style={styles.cloudAccountRow}>
        <View style={styles.cloudStatusDot} />
        <Text style={styles.cloudAccountEmail} numberOfLines={1}>{user.email}</Text>
      </View>

      {/* Backup */}
      <View style={styles.cloudDivider} />
      <Pressable
        style={[styles.primaryButton, (isBackingUp || isRestoring) && { opacity: 0.5 }]}
        onPress={onBackup}
        disabled={isBackingUp || isRestoring}
      >
        {isBackingUp
          ? <View style={styles.buttonRow}><ActivityIndicator size="small" color="#fff" /><Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>Backing up...</Text></View>
          : <Text style={styles.primaryButtonText}>{backupSuccess ? '✓ Backup Complete' : 'Back Up Now'}</Text>
        }
      </Pressable>

      <Text style={[styles.backupMetaText, { marginTop: 8 }]}>Last backup: {lastBackupText}</Text>

      {backupError && <Text style={styles.errorText}>{backupError}</Text>}

      {/* Restore */}
      {backupInfo?.exists && (
        <>
          <View style={styles.cloudDivider} />
          <Pressable
            style={[styles.secondaryButton, (isBackingUp || isRestoring) && { opacity: 0.5 }]}
            onPress={onRestore}
            disabled={isBackingUp || isRestoring}
          >
            {isRestoring
              ? <View style={styles.buttonRow}><ActivityIndicator size="small" color={COLORS.accent} /><Text style={[styles.secondaryButtonText, { marginLeft: 8 }]}>Restoring...</Text></View>
              : <Text style={styles.secondaryButtonText}>Restore from Backup</Text>
            }
          </Pressable>
          {restoreError && <Text style={styles.errorText}>{restoreError}</Text>}
        </>
      )}

      {/* Sign out */}
      <Pressable style={styles.signOutButton} onPress={onSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────

function AuthModal({
  visible, mode, onClose, onSuccess, onSwitchMode,
}: {
  visible: boolean;
  mode: 'signin' | 'signup';
  onClose: () => void;
  onSuccess: (user: User) => void;
  onSwitchMode: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const fn = mode === 'signup' ? signUp : signIn;
    const result = await fn(email.trim().toLowerCase(), password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (result.user) {
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      onSuccess(result.user);
    }
  }, [email, password, confirmPassword, mode, onSuccess]);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={auth.overlay}>
        <View style={auth.sheet}>
          <View style={auth.header}>
            <Pressable onPress={onClose}><Text style={auth.cancelText}>Cancel</Text></Pressable>
            <Text style={auth.title}>{mode === 'signup' ? 'Create Account' : 'Sign In'}</Text>
            <View style={{ width: 60 }} />
          </View>

          <Text style={auth.subtitle}>
            {mode === 'signup'
              ? 'Create an account to back up your training data to the cloud.'
              : 'Sign in to restore your backup on this device.'}
          </Text>

          <Text style={auth.label}>Email</Text>
          <TextInput
            style={auth.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={auth.label}>Password</Text>
          <TextInput
            style={auth.input}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor={COLORS.textTertiary}
            secureTextEntry
          />

          {mode === 'signup' && (
            <>
              <Text style={auth.label}>Confirm Password</Text>
              <TextInput
                style={auth.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repeat password"
                placeholderTextColor={COLORS.textTertiary}
                secureTextEntry
              />
            </>
          )}

          {error && <Text style={auth.errorText}>{error}</Text>}

          <Pressable
            style={[auth.submitButton, loading && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={auth.submitText}>{mode === 'signup' ? 'Create Account' : 'Sign In'}</Text>
            }
          </Pressable>

          <Pressable onPress={onSwitchMode} style={auth.switchRow}>
            <Text style={auth.switchText}>
              {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
              <Text style={{ color: COLORS.accent }}>{mode === 'signup' ? 'Sign In' : 'Create one'}</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16 },
  section: { marginBottom: 28 },
  sectionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16, lineHeight: 20 },

  // Cloud backup
  cloudCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cloudAccountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cloudStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  cloudAccountEmail: { color: COLORS.text, fontSize: 14, fontWeight: '600', flex: 1 },
  cloudDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  backupMetaText: { color: COLORS.textTertiary, fontSize: 12, marginBottom: 4 },
  errorText: { color: COLORS.danger, fontSize: 13, marginTop: 8 },
  buttonRow: { flexDirection: 'row', alignItems: 'center' },
  signOutButton: { alignSelf: 'flex-start', marginTop: 16, paddingVertical: 6 },
  signOutText: { color: COLORS.textTertiary, fontSize: 13 },
  regenerateButton: { marginTop: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.danger, alignItems: 'center' },
  regenerateButtonText: { color: COLORS.danger, fontSize: 15, fontWeight: '600' },

  // Shared buttons
  primaryButton: { backgroundColor: COLORS.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.accent },
  secondaryButtonText: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },

  // Units
  unitCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 2, borderColor: COLORS.border },
  unitCardActive: { borderColor: COLORS.accent },
  unitCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  unitLabel: { fontSize: 18, fontWeight: '700', color: COLORS.textSecondary },
  unitLabelActive: { color: COLORS.accent },
  exampleList: { gap: 4 },
  exampleText: { fontSize: 14, color: COLORS.textTertiary },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: COLORS.accent },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.accent },

  // Preview
  previewCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  previewLabel: { fontSize: 14, color: COLORS.textSecondary },
  previewValue: { fontSize: 15, fontWeight: '600', color: COLORS.text },

  // About
  aboutCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16 },
  aboutText: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  aboutSubtext: { fontSize: 13, color: COLORS.textTertiary, lineHeight: 18 },

  // Strava
  stravaCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(252, 82, 0, 0.3)' },
  stravaConnectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  stravaStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success },
  stravaConnectedText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  stravaAthleteName: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12, marginLeft: 16 },
  stravaDisconnectButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.danger },
  stravaDisconnectText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  stravaSyncStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 4 },
  stravaSyncText: { color: COLORS.textSecondary, fontSize: 13 },
  stravaSyncDone: { color: COLORS.success, fontSize: 13, marginBottom: 8, marginTop: 4 },
  stravaLastSync: { color: COLORS.textTertiary, fontSize: 12, marginBottom: 12 },
  stravaActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  stravaSyncButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.surfaceLight, minWidth: 80, alignItems: 'center' },
  stravaSyncButtonText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  stravaConnectButton: { backgroundColor: '#FC5200', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  stravaConnectButtonDisabled: { opacity: 0.6 },
  stravaConnectText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

const auth = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cancelText: { color: COLORS.textSecondary, fontSize: 16, width: 60 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 20, lineHeight: 20 },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.background, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 15, borderWidth: 1, borderColor: COLORS.border },
  errorText: { color: COLORS.danger, fontSize: 13, marginTop: 10 },
  submitButton: { backgroundColor: COLORS.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchRow: { alignItems: 'center', marginTop: 16 },
  switchText: { color: COLORS.textSecondary, fontSize: 14 },
});
