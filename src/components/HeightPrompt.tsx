/**
 * HeightPrompt — one-time height input prompt.
 * Shows once for existing users who don't have height set.
 */

import { useState } from 'react';
import { Modal, Alert } from 'react-native';
import { YStack, XStack, Text, Input } from 'tamagui';
import { X } from '@tamagui/lucide-icons';

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
        <YStack backgroundColor="#1E1E1E" borderRadius={20} padding={24} width="100%" maxWidth={340}>
          {/* Close */}
          <XStack justifyContent="flex-end">
            <YStack pressStyle={{ opacity: 0.7 }} onPress={onSkip} padding={4}>
              <X size={20} color="#666666" />
            </YStack>
          </XStack>

          <H color="white" fontSize={22} textAlign="center" letterSpacing={1} marginBottom={8}>
            What's Your Height?
          </H>
          <B color="#A0A0A0" fontSize={14} textAlign="center" lineHeight={20} marginBottom={20}>
            Helps calculate BMI for better training recommendations.
          </B>

          {/* Toggle cm / ft */}
          <XStack backgroundColor="#2A2A2A" borderRadius={10} overflow="hidden" marginBottom={16}>
            <YStack flex={1} paddingVertical={10} alignItems="center"
              backgroundColor={mode === 'cm' ? '#FF6B35' : 'transparent'}
              pressStyle={{ opacity: 0.8 }} onPress={() => setMode('cm')}>
              <B color={mode === 'cm' ? 'white' : '#A0A0A0'} fontSize={14} fontWeight={mode === 'cm' ? '700' : '500'}>cm</B>
            </YStack>
            <YStack flex={1} paddingVertical={10} alignItems="center"
              backgroundColor={mode === 'ft' ? '#FF6B35' : 'transparent'}
              pressStyle={{ opacity: 0.8 }} onPress={() => setMode('ft')}>
              <B color={mode === 'ft' ? 'white' : '#A0A0A0'} fontSize={14} fontWeight={mode === 'ft' ? '700' : '500'}>ft / in</B>
            </YStack>
          </XStack>

          {/* Input */}
          {mode === 'cm' ? (
            <Input
              backgroundColor="#2A2A2A" borderColor="#333333" color="white" fontSize={18}
              fontFamily="$mono" textAlign="center" placeholder="e.g. 175"
              placeholderTextColor="$textTertiary" keyboardType="number-pad"
              value={cm} onChangeText={setCm}
            />
          ) : (
            <XStack gap={12}>
              <YStack flex={1}>
                <B color="#666666" fontSize={12} marginBottom={4} textAlign="center">Feet</B>
                <Input
                  backgroundColor="#2A2A2A" borderColor="#333333" color="white" fontSize={18}
                  fontFamily="$mono" textAlign="center" placeholder="5"
                  placeholderTextColor="$textTertiary" keyboardType="number-pad"
                  value={feet} onChangeText={setFeet}
                />
              </YStack>
              <YStack flex={1}>
                <B color="#666666" fontSize={12} marginBottom={4} textAlign="center">Inches</B>
                <Input
                  backgroundColor="#2A2A2A" borderColor="#333333" color="white" fontSize={18}
                  fontFamily="$mono" textAlign="center" placeholder="9"
                  placeholderTextColor="$textTertiary" keyboardType="number-pad"
                  value={inches} onChangeText={setInches}
                />
              </YStack>
            </XStack>
          )}

          {/* Submit */}
          <YStack backgroundColor="#FF6B35" borderRadius={12} paddingVertical={14} alignItems="center" marginTop={16}
            pressStyle={{ opacity: 0.8 }} onPress={handleSubmit}>
            <B color="white" fontSize={16} fontWeight="700">Save Height</B>
          </YStack>

          <YStack padding={12} alignItems="center" marginTop={4}
            pressStyle={{ opacity: 0.7 }} onPress={onSkip}>
            <B color="#666666" fontSize={14}>Skip</B>
          </YStack>
        </YStack>
      </YStack>
    </Modal>
  );
}
