import { useRef, useState, useEffect, useCallback } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Alert, ScrollView as RNScrollView } from 'react-native';
import { YStack, XStack, Text, View, Input, Spinner } from 'tamagui';
import { useAppStore } from '../../src/store';
import { CoachMessage } from '../../src/types';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const QUICK_ACTIONS = ['How was my run?', 'I feel tired', 'Weekly summary', 'Adjust my plan', 'What should I focus on?', 'Am I on track?'];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const h = d.getHours() % 12 || 12;
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const time = `${h}:${mins} ${ampm}`;
  return isToday ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

interface PlanChangeMetadata { reason?: string; [key: string]: unknown }

function PlanChangeCard({ metadata, onApply }: { metadata: PlanChangeMetadata; onApply: () => void }) {
  return (
    <YStack marginTop="$3" backgroundColor="$background" borderRadius="$4" padding="$3" borderWidth={1} borderColor="$accent">
      <H color="$accent" fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom="$1">Plan Change Suggested</H>
      {metadata.reason && <B color="$textSecondary" fontSize={14} lineHeight={20} marginBottom="$3">{metadata.reason}</B>}
      <YStack backgroundColor="$accent" borderRadius="$3" paddingVertical="$2" paddingHorizontal="$4" alignItems="center"
        pressStyle={{ opacity: 0.8 }} onPress={onApply}>
        <B color="white" fontSize={14} fontWeight="700">Apply Change</B>
      </YStack>
    </YStack>
  );
}

function MessageBubble({ message, onApplyChange }: { message: CoachMessage; onApplyChange: (reason: string) => void }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isPlanChange = message.message_type === 'plan_change';

  let metadata: PlanChangeMetadata | null = null;
  if (isPlanChange && message.metadata_json) { try { metadata = JSON.parse(message.metadata_json); } catch {} }

  if (isSystem) {
    return (
      <YStack marginBottom="$3" alignItems="center">
        <YStack backgroundColor="$surfaceLight" borderRadius="$5" paddingHorizontal="$4" paddingVertical="$3" maxWidth="90%" borderWidth={1} borderColor="$border">
          <H color="$textTertiary" fontSize={11} textTransform="uppercase" letterSpacing={1} marginBottom="$1">System</H>
          <B color="$textSecondary" fontSize={14} lineHeight={20}>{message.content}</B>
          {metadata && <PlanChangeCard metadata={metadata} onApply={() => onApplyChange(metadata?.reason ?? 'Plan adaptation requested')} />}
        </YStack>
        <M color="$textTertiary" fontSize={11} marginTop="$1">{formatTimestamp(message.created_at)}</M>
      </YStack>
    );
  }

  return (
    <YStack marginBottom="$3" maxWidth="82%" alignSelf={isUser ? 'flex-end' : 'flex-start'}>
      <YStack borderRadius={18} paddingHorizontal="$4" paddingVertical="$3"
        backgroundColor={isUser ? '$accent' : '$surface'}
        borderBottomRightRadius={isUser ? 4 : 18}
        borderBottomLeftRadius={isUser ? 18 : 4}>
        <B color={isUser ? 'white' : '$color'} fontSize={15} lineHeight={22}>{message.content}</B>
        {isPlanChange && metadata && !isUser && (
          <PlanChangeCard metadata={metadata} onApply={() => onApplyChange(metadata?.reason ?? 'Plan adaptation requested')} />
        )}
      </YStack>
      <M color="$textTertiary" fontSize={11} marginTop="$1" textAlign={isUser ? 'right' : 'left'}>
        {formatTimestamp(message.created_at)}
      </M>
    </YStack>
  );
}

export default function CoachScreen() {
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState('');

  const coachMessages = useAppStore(s => s.coachMessages);
  const isCoachThinking = useAppStore(s => s.isCoachThinking);
  const sendToCoach = useAppStore(s => s.sendToCoach);
  const requestPlanAdaptation = useAppStore(s => s.requestPlanAdaptation);
  const userProfile = useAppStore(s => s.userProfile);

  const scrollToBottom = useCallback(() => {
    if (coachMessages.length > 0) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [coachMessages.length]);

  useEffect(() => { scrollToBottom(); }, [coachMessages.length]);

  const handleSend = useCallback((text?: string) => {
    const msg = (text ?? inputText).trim();
    if (!msg || isCoachThinking) return;
    setInputText('');
    sendToCoach(msg);
  }, [inputText, isCoachThinking, sendToCoach]);

  const handleApplyChange = useCallback(async (reason: string) => {
    Alert.alert('Apply Plan Change', `Reason: ${reason}\n\nThis will adapt your training plan. Continue?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Apply', onPress: async () => {
        const r = await requestPlanAdaptation(reason);
        Alert.alert(r.success ? 'Plan Updated' : 'Error', r.success ? (r.summary ?? 'Done.') : (r.error ?? 'Failed.'));
      }},
    ]);
  }, [requestPlanAdaptation]);

  const renderMessage = useCallback(({ item }: { item: CoachMessage }) => (
    <MessageBubble message={item} onApplyChange={handleApplyChange} />
  ), [handleApplyChange]);

  if (!userProfile) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding="$8">
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom="$2">Set Up Profile First</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22}>Complete your profile in Settings to start chatting with your coach.</B>
      </YStack>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#121212' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      {coachMessages.length === 0 ? (
        <YStack flex={1} justifyContent="center" alignItems="center" padding="$8">
          <H color="$color" fontSize={32} letterSpacing={1.5} marginBottom="$3">AI Coach</H>
          <B color="$textSecondary" fontSize={16} textAlign="center" lineHeight={24}>Ask about your training, get advice, or request plan adjustments.</B>
        </YStack>
      ) : (
        <FlatList
          ref={flatListRef}
          data={coachMessages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
          onContentSizeChange={scrollToBottom}
        />
      )}

      {/* Thinking indicator */}
      {isCoachThinking && (
        <XStack alignItems="center" justifyContent="center" paddingVertical="$2" gap="$2">
          <Spinner size="small" color="$accent" />
          <B color="$textSecondary" fontSize={13} fontStyle="italic">Coach is thinking...</B>
        </XStack>
      )}

      {/* Quick actions */}
      <YStack borderTopWidth={0.5} borderTopColor="$border" paddingVertical="$2">
        <RNScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
          {QUICK_ACTIONS.map(action => (
            <YStack key={action} backgroundColor="$surface" borderRadius={16} paddingHorizontal="$3" paddingVertical={7}
              borderWidth={1} borderColor="$border" opacity={isCoachThinking ? 0.5 : 1}
              pressStyle={{ backgroundColor: '$surfaceLight' }}
              onPress={isCoachThinking ? undefined : () => handleSend(action)}>
              <B color="$color" fontSize={13} fontWeight="500">{action}</B>
            </YStack>
          ))}
        </RNScrollView>
      </YStack>

      {/* Input */}
      <XStack alignItems="flex-end" paddingHorizontal="$3" paddingVertical="$2" paddingBottom="$3"
        borderTopWidth={0.5} borderTopColor="$border" backgroundColor="$background" gap="$2">
        <Input
          flex={1} backgroundColor="$surface" borderRadius={20} paddingHorizontal="$4" paddingVertical="$3"
          color="$color" fontSize={15} fontFamily="$body" maxHeight={100}
          borderWidth={1} borderColor="$border" placeholderTextColor="$textTertiary"
          placeholder="Ask your coach..." multiline
          value={inputText} onChangeText={setInputText}
          disabled={isCoachThinking}
        />
        <YStack backgroundColor="$accent" borderRadius={20} paddingHorizontal="$4" paddingVertical="$3"
          justifyContent="center" alignItems="center"
          opacity={!inputText.trim() || isCoachThinking ? 0.4 : 1}
          pressStyle={{ opacity: 0.8 }}
          onPress={!inputText.trim() || isCoachThinking ? undefined : () => handleSend()}>
          <B color="white" fontSize={15} fontWeight="700">Send</B>
        </YStack>
      </XStack>
    </KeyboardAvoidingView>
  );
}
