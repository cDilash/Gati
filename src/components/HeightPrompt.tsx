/**
 * HeightPrompt — one-time height input prompt.
 * Shows once for existing users who don't have height set.
 */

import { useState } from 'react';
import { Modal, Alert } from 'react-native';
import { YStack, XStack, Text, Input } from 'tamagui';
import { X } from '@tamagui/lucide-icons';
import { colors } from '../theme/colors';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

interface Props {
  visible: boolean;
  onSubmit: (heightCm: number) => void;
  onSkip: () => void;
}

export function HeightPrompt({ visible, onSubmit, onSkip }: Props) {
  const [mode, setMode] = useState<'cm' | 'ft'>('cm');
  const [cm, setCm] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  const handleSubmit = () => {
    let heightCm: number;
    if (mode === 'cm') {
      heightCm = parseFloat(cm);
    } else {
      const ft = parseInt(feet) || 0;
      const inc = parseInt(inches) || 0;
      heightCm = Math.round((ft * 30.48) + (inc * 2.54));
    }
    if (isNaN(heightCm) || heightCm < 100 || heightCm > 250) {
      Alert.alert('Invalid', 'Enter a valid height.');
      return;
    }
    onSubmit(heightCm);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <YStack flex={1} backgroundColor="rgba(0,0,0,0.7)" justifyContent="center" alignItems="center" paddingHorizontal={32}>
        <YStack backgroundColor={colors.surface} borderRadius={20} padding={24} width="100%" maxWidth={340}>
          {/* Close */}
          <XStack justifyContent="flex-end">
            <YStack pressStyle={{ opacity: 0.7 }} onPress={onSkip} padding={4}>
              <X size={20} color={colors.textTertiary} />
            </YStack>
          </XStack>

          <H color="white" fontSize={22} textAlign="center" letterSpacing={1} marginBottom={8}>
            What's Your Height?
          </H>
          <B color={colors.textSecondary} fontSize={14} textAlign="center" lineHeight={20} marginBottom={20}>
            Helps calculate BMI for better training recommendations.
          </B>

          {/* Toggle cm / ft */}
          <XStack backgroundColor={colors.surfaceHover} borderRadius={10} overflow="hidden" marginBottom={16}>
            <YStack flex={1} paddingVertical={10} alignItems="center"
              backgroundColor={mode === 'cm' ? colors.cyan : 'transparent'}
              pressStyle={{ opacity: 0.8 }} onPress={() => setMode('cm')}>
              <B color={mode === 'cm' ? colors.textPrimary : colors.textSecondary} fontSize={14} fontWeight={mode === 'cm' ? '700' : '500'}>cm</B>
            </YStack>
            <YStack flex={1} paddingVertical={10} alignItems="center"
              backgroundColor={mode === 'ft' ? colors.cyan : 'transparent'}
              pressStyle={{ opacity: 0.8 }} onPress={() => setMode('ft')}>
              <B color={mode === 'ft' ? colors.textPrimary : colors.textSecondary} fontSize={14} fontWeight={mode === 'ft' ? '700' : '500'}>ft / in</B>
            </YStack>
          </XStack>

          {/* Input */}
          {mode === 'cm' ? (
            <Input
              backgroundColor={colors.surfaceHover} borderColor={colors.border} color={colors.textPrimary} fontSize={18}
              fontFamily="$mono" textAlign="center" placeholder="e.g. 175"
              placeholderTextColor="$textTertiary" keyboardType="number-pad"
              value={cm} onChangeText={setCm}
            />
          ) : (
            <XStack gap={12}>
              <YStack flex={1}>
                <B color={colors.textTertiary} fontSize={12} marginBottom={4} textAlign="center">Feet</B>
                <Input
                  backgroundColor={colors.surfaceHover} borderColor={colors.border} color={colors.textPrimary} fontSize={18}
                  fontFamily="$mono" textAlign="center" placeholder="5"
                  placeholderTextColor="$textTertiary" keyboardType="number-pad"
                  value={feet} onChangeText={setFeet}
                />
              </YStack>
              <YStack flex={1}>
                <B color={colors.textTertiary} fontSize={12} marginBottom={4} textAlign="center">Inches</B>
                <Input
                  backgroundColor={colors.surfaceHover} borderColor={colors.border} color={colors.textPrimary} fontSize={18}
                  fontFamily="$mono" textAlign="center" placeholder="9"
                  placeholderTextColor="$textTertiary" keyboardType="number-pad"
                  value={inches} onChangeText={setInches}
                />
              </YStack>
            </XStack>
          )}

          {/* Submit */}
          <YStack backgroundColor={colors.cyan} borderRadius={12} paddingVertical={14} alignItems="center" marginTop={16}
            pressStyle={{ opacity: 0.8 }} onPress={handleSubmit}>
            <B color={colors.textPrimary} fontSize={16} fontWeight="700">Save Height</B>
          </YStack>

          <YStack padding={12} alignItems="center" marginTop={4}
            pressStyle={{ opacity: 0.7 }} onPress={onSkip}>
            <B color={colors.textTertiary} fontSize={14}>Skip</B>
          </YStack>
        </YStack>
      </YStack>
    </Modal>
  );
}
