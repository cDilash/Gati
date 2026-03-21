/**
 * PRBadge — Rank indicator for personal records and best efforts.
 * rank=1: gradient background (cyan→orange) with star + "PR"
 * rank=2: cyan outlined pill with "2nd"
 * rank=3: tertiary outlined pill with "3rd"
 */

import { XStack, Text, View } from 'tamagui';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const B = (props: any) => <Text fontFamily="$body" {...props} />;
const H = (props: any) => <Text fontFamily="$heading" {...props} />;

export function PRBadge({ rank, size = 'md' }: { rank: number; size?: 'sm' | 'md' }) {
  const sm = size === 'sm';

  if (rank === 1) {
    return (
      <LinearGradient
        colors={[colors.cyan, colors.orange]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: sm ? 2 : 3,
          paddingHorizontal: sm ? 5 : 7,
          paddingVertical: sm ? 1 : 2,
          borderRadius: sm ? 4 : 5,
        }}
      >
        <MaterialCommunityIcons name="star" size={sm ? 8 : 10} color="#fff" />
        <B color="#fff" fontSize={sm ? 8 : 10} fontWeight="800" letterSpacing={0.5}>PR</B>
      </LinearGradient>
    );
  }

  if (rank === 2) {
    return (
      <View paddingHorizontal={sm ? 4 : 6} paddingVertical={sm ? 1 : 2} borderRadius={sm ? 4 : 5}
        borderWidth={1} borderColor={colors.cyanDim}>
        <H fontSize={sm ? 8 : 9} color={colors.cyan} letterSpacing={0.5}>2nd</H>
      </View>
    );
  }

  if (rank === 3) {
    return (
      <View paddingHorizontal={sm ? 4 : 6} paddingVertical={sm ? 1 : 2} borderRadius={sm ? 4 : 5}
        borderWidth={1} borderColor={colors.border}>
        <H fontSize={sm ? 8 : 9} color={colors.textTertiary} letterSpacing={0.5}>3rd</H>
      </View>
    );
  }

  return null;
}
