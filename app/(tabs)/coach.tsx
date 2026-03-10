import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useAppStore } from '../../src/store';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { COLORS } from '../../src/utils/constants';
import { sendCoachMessage } from '../../src/ai/gemini';
import { saveCoachMessage, getCoachMessages, getLatestConversationId } from '../../src/db/client';
import { CoachMessage, PlanMutation } from '../../src/types';

const QUICK_ACTIONS = [
  'How was my run?',
  'I feel tired',
  'Weekly summary',
  'Race strategy',
];

export default function CoachScreen() {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [pendingMutation, setPendingMutation] = useState<{ mutation: PlanMutation; messageId: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { getTrainingContext, applyWorkoutUpdate, refreshPlan } = useAppStore();
  const units = useSettingsStore(s => s.units);

  useEffect(() => {
    const existingId = getLatestConversationId();
    const convId = existingId || Crypto.randomUUID();
    setConversationId(convId);
    if (existingId) {
      const existing = getCoachMessages(convId);
      setMessages(existing);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput('');

    const userMessage: CoachMessage = {
      id: Crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      action_applied: false,
      created_at: new Date().toISOString(),
      conversation_id: conversationId,
    };

    saveCoachMessage(userMessage);
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const context = getTrainingContext();
      if (!context) {
        throw new Error('Training context not available. Complete setup first.');
      }

      const { response, mutation } = await sendCoachMessage(updatedMessages, context, units);

      const assistantMessage: CoachMessage = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        content: response,
        structured_action_json: mutation ? JSON.stringify(mutation) : undefined,
        action_applied: false,
        created_at: new Date().toISOString(),
        conversation_id: conversationId,
      };

      saveCoachMessage(assistantMessage);
      setMessages(prev => [...prev, assistantMessage]);

      if (mutation) {
        setPendingMutation({ mutation, messageId: assistantMessage.id });
      }
    } catch (error: any) {
      const errorMessage: CoachMessage = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I couldn't process that. ${error.message || 'Please try again.'}`,
        action_applied: false,
        created_at: new Date().toISOString(),
        conversation_id: conversationId,
      };
      saveCoachMessage(errorMessage);
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyMutation = () => {
    if (!pendingMutation) return;
    Alert.alert(
      'Apply Change',
      pendingMutation.mutation.description,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () => {
            for (const workoutId of pendingMutation.mutation.affected_workout_ids) {
              if (pendingMutation.mutation.changes) {
                applyWorkoutUpdate(workoutId, pendingMutation.mutation.changes);
              }
            }
            refreshPlan();
            setPendingMutation(null);
            Alert.alert('Done', 'Plan updated successfully.');
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scrollRef} style={styles.messageList} contentContainerStyle={styles.messageContent}>
        {messages.length === 0 && (
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>Marathon Coach</Text>
            <Text style={styles.welcomeSubtitle}>Ask me anything about your training. I have full context of your plan, recent runs, and upcoming workouts.</Text>
          </View>
        )}
        {messages.map(msg => (
          <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.bubbleText, msg.role === 'user' && styles.userBubbleText]}>{msg.content}</Text>
          </View>
        ))}
        {isLoading && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <ActivityIndicator size="small" color={COLORS.accent} />
          </View>
        )}
        {pendingMutation && (
          <View style={styles.mutationCard}>
            <Text style={styles.mutationTitle}>Suggested Plan Change</Text>
            <Text style={styles.mutationDesc}>{pendingMutation.mutation.description}</Text>
            <View style={styles.mutationButtons}>
              <Pressable style={styles.applyButton} onPress={handleApplyMutation}>
                <Text style={styles.applyButtonText}>Apply Change</Text>
              </Pressable>
              <Pressable style={styles.dismissButton} onPress={() => setPendingMutation(null)}>
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Quick Actions */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickActions} contentContainerStyle={styles.quickActionsContent}>
        {QUICK_ACTIONS.map(action => (
          <Pressable key={action} style={styles.quickActionButton} onPress={() => sendMessage(action)}>
            <Text style={styles.quickActionText}>{action}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Ask your coach..."
          placeholderTextColor={COLORS.textTertiary}
          multiline
          maxLength={500}
          onSubmitEditing={() => sendMessage(input)}
          returnKeyType="send"
        />
        <Pressable style={[styles.sendButton, (!input.trim() || isLoading) && styles.sendButtonDisabled]} onPress={() => sendMessage(input)} disabled={!input.trim() || isLoading}>
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 8 },
  welcomeCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, marginBottom: 16, alignItems: 'center' },
  welcomeTitle: { color: COLORS.accent, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  welcomeSubtitle: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  bubble: { maxWidth: '80%', padding: 14, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: COLORS.accent, borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleText: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  userBubbleText: { color: '#fff' },
  mutationCard: { backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: COLORS.warning },
  mutationTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  mutationDesc: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  mutationButtons: { flexDirection: 'row', gap: 10 },
  applyButton: { flex: 1, backgroundColor: COLORS.success, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  applyButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dismissButton: { flex: 1, borderWidth: 1, borderColor: COLORS.textTertiary, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  dismissButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  quickActions: { maxHeight: 44, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  quickActionsContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' },
  quickActionButton: { backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 0.5, borderColor: COLORS.border },
  quickActionText: { color: COLORS.accent, fontSize: 13, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 10, borderTopWidth: 0.5, borderTopColor: COLORS.border, backgroundColor: COLORS.background },
  textInput: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: COLORS.text, fontSize: 15, maxHeight: 100 },
  sendButton: { backgroundColor: COLORS.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
