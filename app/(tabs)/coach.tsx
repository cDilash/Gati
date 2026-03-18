/**
 * Coach Chat Screen — AI running coach with rich message formatting.
 * Markdown rendering, coach avatar, themed quick actions, typing indicator.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Alert, ScrollView as RNScrollView, Animated } from 'react-native';
import { YStack, XStack, Text, View, Input, Spinner } from 'tamagui';
import { useAppStore } from '../../src/store';
import { CoachMessage } from '../../src/types';
import { colors } from '../../src/theme/colors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GradientBorder } from '../../src/theme/GradientBorder';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Quick actions with icons ────────────────────────────────

const QUICK_ACTIONS: { label: string; icon: string; borderColor: string }[] = [
  { label: 'How was my run?', icon: 'run-fast', borderColor: colors.cyanDim },
  { label: 'I feel tired', icon: 'emoticon-sad-outline', borderColor: colors.orangeDim },
  { label: 'Weekly summary', icon: 'chart-line', borderColor: colors.cyanDim },
  { label: 'Adjust my plan', icon: 'calendar-edit', borderColor: colors.orangeDim },
  { label: 'Am I on track?', icon: 'flag-checkered', borderColor: colors.cyanDim },
];

// ─── Markdown-lite renderer ──────────────────────────────────

function RichText({ text, isUser }: { text: string; isUser: boolean }) {
  if (isUser) {
    return <B color={colors.textPrimary} fontSize={14} lineHeight={21}>{text}</B>;
  }

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/);

  return (
    <YStack gap={12}>
      {paragraphs.map((para, pi) => {
        // Check if paragraph is a bullet list
        const lines = para.split('\n');
        const isList = lines.every(l => /^\s*[-•*]\s/.test(l) || l.trim() === '');

        if (isList) {
          return (
            <YStack key={pi} gap={4}>
              {lines.filter(l => l.trim()).map((line, li) => {
                const content = line.replace(/^\s*[-•*]\s*/, '');
                return (
                  <XStack key={li} gap={8} alignItems="flex-start">
                    <View width={5} height={5} borderRadius={2.5} backgroundColor={colors.cyan} marginTop={7} />
                    <YStack flex={1}>
                      <RichLine text={content} />
                    </YStack>
                  </XStack>
                );
              })}
            </YStack>
          );
        }

        // Regular paragraph — handle line breaks within
        return (
          <YStack key={pi}>
            {lines.map((line, li) => (
              <RichLine key={li} text={line} />
            ))}
          </YStack>
        );
      })}
    </YStack>
  );
}

function RichLine({ text }: { text: string }) {
  // Parse inline formatting: **bold**, *italic*, pace, HR, distance
  const parts: { text: string; style: 'normal' | 'bold' | 'italic' | 'pace' | 'hr' | 'distance' }[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic: *text* (not preceded by *)
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+?)\*(?!\*)/);
    // Pace: 9:20/mi or 10:05/mi
    const paceMatch = remaining.match(/\d{1,2}:\d{2}\/mi/);
    // HR: 123 bpm or Zone 1-5
    const hrMatch = remaining.match(/\d+ bpm|Zone \d/);
    // Distance: 6.4 mi or 10 mi
    const distMatch = remaining.match(/\d+(\.\d+)?\s*mi\b/);

    // Find earliest match
    const matches = [
      boldMatch ? { idx: remaining.indexOf(boldMatch[0]), len: boldMatch[0].length, content: boldMatch[1], style: 'bold' as const } : null,
      italicMatch ? { idx: remaining.indexOf(italicMatch[0]), len: italicMatch[0].length, content: italicMatch[1], style: 'italic' as const } : null,
      paceMatch ? { idx: remaining.indexOf(paceMatch[0]), len: paceMatch[0].length, content: paceMatch[0], style: 'pace' as const } : null,
      hrMatch ? { idx: remaining.indexOf(hrMatch[0]), len: hrMatch[0].length, content: hrMatch[0], style: 'hr' as const } : null,
      distMatch ? { idx: remaining.indexOf(distMatch[0]), len: distMatch[0].length, content: distMatch[0], style: 'distance' as const } : null,
    ].filter(Boolean).sort((a, b) => a!.idx - b!.idx);

    if (matches.length === 0 || matches[0]!.idx < 0) {
      parts.push({ text: remaining, style: 'normal' });
      break;
    }

    const m = matches[0]!;
    if (m.idx > 0) {
      parts.push({ text: remaining.slice(0, m.idx), style: 'normal' });
    }
    parts.push({ text: m.content, style: m.style });
    remaining = remaining.slice(m.idx + m.len);
  }

  return (
    <B fontSize={14} lineHeight={21} color={colors.textSecondary}>
      {parts.map((p, i) => {
        switch (p.style) {
          case 'bold': return <B key={i} fontWeight="700" color={colors.textPrimary}>{p.text}</B>;
          case 'italic': return <B key={i} fontStyle="italic" color={colors.textSecondary}>{p.text}</B>;
          case 'pace': return <M key={i} fontSize={14} fontWeight="600" color={colors.cyan}>{p.text}</M>;
          case 'hr': return <M key={i} fontSize={14} fontWeight="600" color={colors.orange}>{p.text}</M>;
          case 'distance': return <M key={i} fontSize={14} fontWeight="600" color={colors.cyan}>{p.text}</M>;
          default: return <B key={i} color={colors.textSecondary}>{p.text}</B>;
        }
      })}
    </B>
  );
}

// ─── Typing Indicator ────────────────────────────────────────

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <XStack alignItems="center" paddingLeft={16} paddingVertical={8} gap={4}>
      <View width={36} height={36} borderRadius={18} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginRight={8}>
        <MaterialCommunityIcons name="robot-outline" size={18} color={colors.cyan} />
      </View>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.cyan, opacity: dot }} />
      ))}
    </XStack>
  );
}

// ─── Plan Change Card ────────────────────────────────────────

interface PlanChangeMetadata { reason?: string; [key: string]: unknown }

function PlanChangeSuggestion({ metadata, onApply, onDismiss }: { metadata: PlanChangeMetadata; onApply: () => void; onDismiss: () => void }) {
  return (
    <GradientBorder borderWidth={1.5} borderRadius={14} style={{ marginTop: 12 }}>
      <YStack padding={14}>
        <XStack alignItems="center" gap={8} marginBottom={8}>
          <View width={28} height={28} borderRadius={14} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center">
            <MaterialCommunityIcons name="calendar-edit" size={15} color={colors.cyan} />
          </View>
          <H color={colors.textSecondary} fontSize={11} letterSpacing={1.5} textTransform="uppercase">Plan Suggestion</H>
        </XStack>
        {metadata.reason && <B color={colors.textSecondary} fontSize={13} lineHeight={19} marginBottom={12}>{metadata.reason}</B>}
        <YStack gap={8}>
          <YStack backgroundColor={colors.cyan} borderRadius={10} paddingVertical={10} alignItems="center"
            pressStyle={{ opacity: 0.8 }} onPress={onApply}>
            <B color={colors.background} fontSize={14} fontWeight="700">Apply Change</B>
          </YStack>
          <YStack borderWidth={1} borderColor={colors.border} borderRadius={10} paddingVertical={10} alignItems="center"
            pressStyle={{ opacity: 0.8 }} onPress={onDismiss}>
            <B color={colors.textSecondary} fontSize={13} fontWeight="600">Keep as Planned</B>
          </YStack>
        </YStack>
      </YStack>
    </GradientBorder>
  );
}

// ─── Message Bubble ──────────────────────────────────────────

function MessageBubble({ message, onApplyChange }: { message: CoachMessage; onApplyChange: (reason: string) => void }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isPlanChange = message.message_type === 'plan_change';
  const isAnalysis = message.message_type === 'analysis';

  let metadata: PlanChangeMetadata | null = null;
  if (isPlanChange && message.metadata_json) { try { metadata = JSON.parse(message.metadata_json); } catch {} }

  if (isSystem) {
    return (
      <YStack marginBottom={12} alignItems="center">
        <YStack backgroundColor={colors.surfaceHover} borderRadius={12} paddingHorizontal={14} paddingVertical={10} maxWidth="90%">
          <B color={colors.textTertiary} fontSize={12} lineHeight={18}>{message.content}</B>
        </YStack>
        <B color={colors.textTertiary} fontSize={10} marginTop={4}>{formatTimestamp(message.created_at)}</B>
      </YStack>
    );
  }

  if (isUser) {
    return (
      <YStack marginBottom={12} alignSelf="flex-end" marginLeft={60} marginRight={16}>
        <YStack backgroundColor={colors.orangeGhost} borderRadius={16} borderBottomRightRadius={4}
          paddingHorizontal={14} paddingVertical={10} borderRightWidth={3} borderRightColor={colors.orange}>
          <RichText text={message.content} isUser />
        </YStack>
        <B color={colors.textTertiary} fontSize={10} marginTop={3} textAlign="right">{formatTimestamp(message.created_at)}</B>
      </YStack>
    );
  }

  // AI coach message
  return (
    <XStack marginBottom={12} marginRight={24} marginLeft={8} alignItems="flex-start">
      {/* Coach avatar */}
      <View width={36} height={36} borderRadius={18} backgroundColor={colors.cyanGhost}
        alignItems="center" justifyContent="center" marginRight={8} marginTop={2}>
        <MaterialCommunityIcons name="robot-outline" size={18} color={colors.cyan} />
      </View>

      <YStack flex={1}>
        {/* Analysis badge */}
        {isAnalysis && (
          <View alignSelf="flex-start" paddingHorizontal={8} paddingVertical={2} borderRadius={6}
            backgroundColor={colors.cyanGhost} borderWidth={0.5} borderColor={colors.cyanDim} marginBottom={6}>
            <H fontSize={9} color={colors.cyan} letterSpacing={1}>ANALYSIS</H>
          </View>
        )}

        <YStack backgroundColor={colors.surface} borderRadius={16} borderTopLeftRadius={4}
          paddingHorizontal={14} paddingVertical={10} borderLeftWidth={3}
          borderLeftColor={isAnalysis ? colors.cyan : colors.cyanDim}>
          <RichText text={message.content} isUser={false} />

          {/* Plan change card */}
          {isPlanChange && metadata && (
            <PlanChangeSuggestion
              metadata={metadata}
              onApply={() => onApplyChange(metadata?.reason ?? 'Plan adaptation requested')}
              onDismiss={() => {}}
            />
          )}
        </YStack>

        <B color={colors.textTertiary} fontSize={10} marginTop={3}>{formatTimestamp(message.created_at)}</B>
      </YStack>
    </XStack>
  );
}

// ─── Timestamp formatter ─────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const h = d.getHours() % 12 || 12;
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const time = `${h}:${mins} ${ampm}`;
  if (isToday) return time;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${time}`;
}

// ─── Main Screen ─────────────────────────────────────────────

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
    Alert.alert('Apply Plan Change', `${reason}\n\nThis will adapt your training plan.`, [
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
        <View width={56} height={56} borderRadius={28} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom={16}>
          <MaterialCommunityIcons name="robot-outline" size={28} color={colors.cyan} />
        </View>
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom="$2">Set Up Profile First</H>
        <B color="$textSecondary" fontSize={14} textAlign="center" lineHeight={20}>Complete your profile in Settings to start chatting with your coach.</B>
      </YStack>
    );
  }

  const canSend = inputText.trim().length > 0 && !isCoachThinking;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>

      {/* Empty state */}
      {coachMessages.length === 0 ? (
        <YStack flex={1} justifyContent="center" alignItems="center" padding={32}>
          <View width={64} height={64} borderRadius={32} backgroundColor={colors.cyanGhost} alignItems="center" justifyContent="center" marginBottom={20}>
            <MaterialCommunityIcons name="robot-outline" size={32} color={colors.cyan} />
          </View>
          <H color={colors.textPrimary} fontSize={24} letterSpacing={1.5} marginBottom={8}>Your AI Coach</H>
          <B color={colors.textSecondary} fontSize={14} textAlign="center" lineHeight={20} marginBottom={24}>
            Ask me anything about your training, recovery, pacing, nutrition, or race strategy. I have full context on your plan and your runs.
          </B>
          <YStack gap={8} width="100%">
            {['How should I pace my long run?', 'Am I on track for my goal?', 'I did leg day, adjust tomorrow?'].map(q => (
              <YStack key={q} backgroundColor={colors.surface} borderRadius={12} paddingHorizontal={16} paddingVertical={12}
                borderWidth={0.5} borderColor={colors.border}
                pressStyle={{ opacity: 0.8, backgroundColor: colors.surfaceHover }}
                onPress={() => handleSend(q)}>
                <B color={colors.textSecondary} fontSize={13}>{q}</B>
              </YStack>
            ))}
          </YStack>
        </YStack>
      ) : (
        <FlatList
          ref={flatListRef}
          data={coachMessages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
          onContentSizeChange={scrollToBottom}
        />
      )}

      {/* Typing indicator */}
      {isCoachThinking && <TypingDots />}

      {/* Quick action chips */}
      <YStack borderTopWidth={0.5} borderTopColor={colors.border} paddingVertical={6}>
        <RNScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
          {QUICK_ACTIONS.map(({ label, icon, borderColor }) => (
            <XStack key={label} alignItems="center" gap={6}
              backgroundColor={colors.surface} borderRadius={16} paddingHorizontal={12} paddingVertical={7}
              borderWidth={1} borderColor={borderColor}
              opacity={isCoachThinking ? 0.4 : 1}
              pressStyle={{ opacity: 0.7 }}
              onPress={isCoachThinking ? undefined : () => handleSend(label)}>
              <MaterialCommunityIcons name={icon as any} size={14} color={colors.textSecondary} />
              <B color={colors.textPrimary} fontSize={12} fontWeight="500">{label}</B>
            </XStack>
          ))}
        </RNScrollView>
      </YStack>

      {/* Input bar */}
      <XStack alignItems="flex-end" paddingHorizontal={12} paddingVertical={8} paddingBottom={12}
        borderTopWidth={0.5} borderTopColor={colors.border} backgroundColor={colors.background} gap={8}>
        <Input
          flex={1} backgroundColor={colors.surface} borderRadius={20} paddingHorizontal={14} paddingVertical={10}
          color={colors.textPrimary} fontSize={16} fontFamily="$body" maxHeight={100} minHeight={44}
          borderWidth={1} borderColor={inputText ? colors.cyanDim : colors.border}
          placeholderTextColor="$textTertiary"
          placeholder="Ask your coach..." multiline
          value={inputText} onChangeText={setInputText}
          disabled={isCoachThinking}
        />
        <YStack width={40} height={40} borderRadius={20}
          backgroundColor={canSend ? colors.cyan : colors.surfaceHover}
          justifyContent="center" alignItems="center"
          pressStyle={{ opacity: canSend ? 0.8 : 1 }}
          onPress={canSend ? () => handleSend() : undefined}>
          <MaterialCommunityIcons name="send" size={18} color={canSend ? colors.background : colors.textTertiary} />
        </YStack>
      </XStack>
    </KeyboardAvoidingView>
  );
}
