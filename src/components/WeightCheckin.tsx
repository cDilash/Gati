/**
 * WeightCheckin — weekly weight check-in modal.
 * Shows once per week after weekly digest. Not in race week.
 */

import { useState } from 'react';
import { Modal, Alert } from 'react-native';
import { YStack, XStack, Text, Input, View } from 'tamagui';
import { X } from '@tamagui/lucide-icons';
import { colors } from '../theme/colors';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

interface Props {
  visible: boolean;
  currentWeight: number | null;
  onUpdate: (weightKg: number) => void;
  onNoChange: () => void;
  onSkip: () => void;
}

export function WeightCheckin({ visible, currentWeight, onUpdate, onNoChange, onSkip }: Props) {
  const [weight, setWeight] = useState(currentWeight ? String(currentWeight) : '');

  const handleSubmit = () => {
    const val = parseFloat(weight);
    if (isNaN(val) || val <= 0 || val > 300) {
      Alert.alert('Invalid', 'Enter a valid weight.');
      return;
    }
    onUpdate(val);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <YStack flex={1} backgroundColor="rgba(0,0,0,0.7)" justifyContent="center" alignItems="center" paddingHorizontal={32}>
        <YStack backgroundColor={colors.surface} borderRadius={20} padding={24} width="100%" maxWidth={340}>
          {/* Close button */}
          <XStack justifyContent="flex-end">
            <YStack pressStyle={{ opacity: 0.7 }} onPress={onSkip} padding={4}>
              <X size={20} color={colors.textTertiary} />
            </YStack>
          </XStack>

          <H color="white" fontSize={22} textAlign="center" letterSpacing={1} marginBottom={8}>
            Weekly Check-in
          </H>
          <B color={colors.textSecondary} fontSize={14} textAlign="center" lineHeight={20} marginBottom={20}>
            Has your weight changed?
          </B>

          {/* Current weight */}
          {currentWeight && (
            <YStack alignItems="center" marginBottom={16}>
              <B color={colors.textTertiary} fontSize={12}>Current</B>
              <M color={colors.cyan} fontSize={28} fontWeight="800">{currentWeight} kg</M>
            </YStack>
          )}

          {/* Input */}
          <Input
            backgroundColor={colors.surfaceHover} borderColor={colors.border} color={colors.textPrimary} fontSize={18}
            fontFamily="$mono" textAlign="center" placeholder="Weight in kg"
            placeholderTextColor="$textTertiary" keyboardType="decimal-pad"
            value={weight} onChangeText={setWeight}
          />

          {/* Buttons */}
          <YStack backgroundColor={colors.cyan} borderRadius={12} paddingVertical={14} alignItems="center" marginTop={16}
            pressStyle={{ opacity: 0.8 }} onPress={handleSubmit}>
            <B color={colors.textPrimary} fontSize={16} fontWeight="700">Update Weight</B>
          </YStack>

          <YStack backgroundColor={colors.surfaceHover} borderRadius={12} paddingVertical={12} alignItems="center" marginTop={10}
            pressStyle={{ opacity: 0.8 }} onPress={onNoChange}>
            <B color={colors.textSecondary} fontSize={15} fontWeight="600">No Change</B>
          </YStack>
        </YStack>
      </YStack>
    </Modal>
  );
}
