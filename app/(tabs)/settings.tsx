import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useAppStore } from '../../src/store';
import { COLORS } from '../../src/utils/constants';
import { UnitSystem, formatDistance, formatWeight, paceLabel } from '../../src/utils/units';

const UNIT_OPTIONS: { value: UnitSystem; label: string; examples: string[] }[] = [
  {
    value: 'imperial',
    label: 'Imperial',
    examples: ['Miles (mi)', 'Pounds (lbs)', 'Pace in min/mi'],
  },
  {
    value: 'metric',
    label: 'Metric',
    examples: ['Kilometers (km)', 'Kilograms (kg)', 'Pace in min/km'],
  },
];

export default function SettingsScreen() {
  const { units, setUnits } = useSettingsStore();
  const { userProfile } = useAppStore();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Units</Text>
        <Text style={styles.sectionDesc}>
          All distances, weights, and paces will update throughout the app.
        </Text>

        {UNIT_OPTIONS.map(opt => (
          <Pressable
            key={opt.value}
            style={[styles.unitCard, units === opt.value && styles.unitCardActive]}
            onPress={() => setUnits(opt.value)}
          >
            <View style={styles.unitCardHeader}>
              <Text style={[styles.unitLabel, units === opt.value && styles.unitLabelActive]}>
                {opt.label}
              </Text>
              <View style={[styles.radio, units === opt.value && styles.radioActive]}>
                {units === opt.value && <View style={styles.radioDot} />}
              </View>
            </View>
            <View style={styles.exampleList}>
              {opt.examples.map((ex, i) => (
                <Text key={i} style={styles.exampleText}>{ex}</Text>
              ))}
            </View>
          </Pressable>
        ))}
      </View>

      {/* Live preview of conversion */}
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>Marathon Coach v1.0.0</Text>
          <Text style={styles.aboutSubtext}>
            Training plan powered by Jack Daniels' VDOT system.{'\n'}
            AI coaching by Google Gemini.
          </Text>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
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
  unitCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  unitCardActive: {
    borderColor: COLORS.accent,
  },
  unitCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  unitLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  unitLabelActive: {
    color: COLORS.accent,
  },
  exampleList: {
    gap: 4,
  },
  exampleText: {
    fontSize: 14,
    color: COLORS.textTertiary,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: COLORS.accent,
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.accent,
  },
  previewCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  previewLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  previewValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  aboutCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
  },
  aboutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  aboutSubtext: {
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },
});
