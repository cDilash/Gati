import React from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView } from 'react-native';
import { ArrowsClockwise } from 'phosphor-react-native';

interface ReplanModalProps {
  visible: boolean;
  reason: string;
  summary: string;
  onViewPlan: () => void;
  onDismiss: () => void;
}

export function ReplanModal({ visible, reason, summary, onViewPlan, onDismiss }: ReplanModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.container}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.iconContainer}>
            <ArrowsClockwise size={48} color="#FF9500" weight="bold" />
          </View>
          <Text style={s.title}>Plan Regenerated</Text>
          <View style={s.reasonCard}>
            <Text style={s.reasonLabel}>Reason</Text>
            <Text style={s.reasonText}>{reason}</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>What Changed</Text>
            <Text style={s.summaryText}>{summary}</Text>
          </View>
        </ScrollView>
        <View style={s.buttons}>
          <Pressable style={s.primaryButton} onPress={onViewPlan}>
            <Text style={s.primaryButtonText}>View New Plan</Text>
          </Pressable>
          <Pressable style={s.secondaryButton} onPress={onDismiss}>
            <Text style={s.secondaryButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 24, paddingTop: 60, alignItems: 'center' },
  iconContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginBottom: 24 },
  reasonCard: { backgroundColor: '#1C1C1E', borderRadius: 12, padding: 16, width: '100%', marginBottom: 16 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  reasonText: { fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  summaryCard: { backgroundColor: '#1C1C1E', borderRadius: 12, padding: 16, width: '100%', borderLeftWidth: 3, borderLeftColor: '#FF9500' },
  summaryLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  summaryText: { fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  buttons: { padding: 24, gap: 12 },
  primaryButton: { backgroundColor: '#FF9500', borderRadius: 12, padding: 16, alignItems: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondaryButton: { backgroundColor: '#1C1C1E', borderRadius: 12, padding: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#8E8E93', fontSize: 17 },
});
