import { ScrollView, YStack, XStack, Text, View } from 'tamagui';
import { useAppStore } from '../../src/store';
import {
  ZONE_DESCRIPTIONS, ZONE_RPE, formatPaceRange, calculateHRZones,
} from '../../src/engine/paceZones';
import {
  predict5KTime, predict10KTime, predictHalfMarathonTime, predictMarathonTime, formatTime,
} from '../../src/engine/vdot';
import { PaceZoneName, PaceZones, HRZones, Shoe } from '../../src/types';

const ZONE_NAMES: PaceZoneName[] = ['E', 'M', 'T', 'I', 'R'];
const ZONE_FULL_NAMES: Record<PaceZoneName, string> = { E: 'Easy', M: 'Marathon', T: 'Threshold', I: 'Interval', R: 'Repetition' };
const ZONE_COLORS: Record<PaceZoneName, string> = { E: '#34C759', M: '#007AFF', T: '#FF9500', I: '#FF3B30', R: '#AF52DE' };

// ─── Shared Text Components ─────────────────────────────────
// Tamagui requires $heading/$body/$mono font tokens, not raw font names

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

function SectionHeader({ title }: { title: string }) {
  return (
    <H color="$textSecondary" fontSize={14} textTransform="uppercase" letterSpacing={1.5}
      marginTop="$6" marginBottom="$3" marginLeft="$1">
      {title}
    </H>
  );
}

function VDOTDisplay({ vdot }: { vdot: number }) {
  return (
    <YStack alignItems="center" backgroundColor="$surface" borderRadius="$6" paddingVertical="$6" marginBottom="$1">
      <H color="$textSecondary" fontSize={14} textTransform="uppercase" letterSpacing={1.5}>VDOT</H>
      <M color="$accent" fontSize={56} fontWeight="800" lineHeight={64}>{vdot.toFixed(1)}</M>
      <B color="$textTertiary" fontSize={13} marginTop={2}>Current fitness level</B>
    </YStack>
  );
}

function PaceZoneRow({ zone, paceZones }: { zone: PaceZoneName; paceZones: PaceZones }) {
  const range = paceZones[zone];
  const desc = ZONE_DESCRIPTIONS[zone].split(' \u2014 ')[1] ?? ZONE_DESCRIPTIONS[zone];
  return (
    <XStack alignItems="center" paddingVertical="$3" paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
      <View width={4} height={40} borderRadius={2} marginRight="$3" backgroundColor={ZONE_COLORS[zone]} />
      <YStack flex={1}>
        <XStack alignItems="center" gap="$2" marginBottom={2}>
          <H color="$color" fontSize={17} letterSpacing={1} width={20}>{zone}</H>
          <B color="$color" fontSize={15} fontWeight="600" flex={1}>{ZONE_FULL_NAMES[zone]}</B>
          <B color="$textTertiary" fontSize={12}>{ZONE_RPE[zone]}</B>
        </XStack>
        <M color="$accent" fontSize={15} fontWeight="700" marginLeft={28} marginBottom={2}>
          {formatPaceRange(range)} /mi
        </M>
        <B color="$textSecondary" fontSize={12} marginLeft={28} lineHeight={16}>{desc}</B>
      </YStack>
    </XStack>
  );
}

function HRZoneRow({ label, name, min, max, index }: { label: string; name: string; min: number; max: number; index: number }) {
  const hrColors = ['#34C759', '#007AFF', '#FF9500', '#FF3B30', '#AF52DE'];
  return (
    <XStack alignItems="center" paddingVertical={11} paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
      <View width={4} height={28} borderRadius={2} marginRight="$3" backgroundColor={hrColors[index]} />
      <YStack flex={1}>
        <B color="$color" fontSize={14} fontWeight="600">{label}</B>
        <B color="$textSecondary" fontSize={12}>{name}</B>
      </YStack>
      <M color="$accent" fontSize={14} fontWeight="600">{min} - {max} bpm</M>
    </XStack>
  );
}

function RacePredictions({ vdot }: { vdot: number }) {
  const predictions = [
    { label: '5K', time: formatTime(predict5KTime(vdot)) },
    { label: '10K', time: formatTime(predict10KTime(vdot)) },
    { label: 'Half Marathon', time: formatTime(predictHalfMarathonTime(vdot)) },
    { label: 'Marathon', time: formatTime(predictMarathonTime(vdot)) },
  ];
  return (
    <YStack padding="$1">
      {predictions.map((p) => (
        <XStack key={p.label} justifyContent="space-between" alignItems="center" paddingVertical="$3" paddingHorizontal="$3" borderBottomWidth={0.5} borderBottomColor="$border">
          <B color="$color" fontSize={15} fontWeight="600">{p.label}</B>
          <M color="$accent" fontSize={17} fontWeight="800">{p.time}</M>
        </XStack>
      ))}
    </YStack>
  );
}

function ShoeCard({ shoe }: { shoe: Shoe }) {
  const percent = shoe.maxMiles > 0 ? shoe.totalMiles / shoe.maxMiles : 0;
  const clampedPercent = Math.min(percent, 1);
  const isWarning = percent >= 0.8;
  const isCritical = percent >= 1.0;
  const barColor = isCritical ? '#FF3B30' : isWarning ? '#FF9500' : '#34C759';

  return (
    <YStack backgroundColor="$surface" borderRadius="$6" padding="$3" marginBottom="$3" opacity={shoe.retired ? 0.6 : 1}>
      <XStack justifyContent="space-between" alignItems="center" marginBottom={2}>
        <B color={shoe.retired ? '$textSecondary' : '$color'} fontSize={15} fontWeight="600" flex={1}>{shoe.name}</B>
        {shoe.retired && (
          <H color="$textTertiary" fontSize={11} letterSpacing={1} backgroundColor="$surfaceLight" paddingHorizontal="$2" paddingVertical={2} borderRadius="$2" overflow="hidden">
            Retired
          </H>
        )}
      </XStack>
      {shoe.brand && <B color="$textTertiary" fontSize={12} marginBottom="$2">{shoe.brand}</B>}
      <YStack height={6} backgroundColor="$surfaceLight" borderRadius={3} overflow="hidden" marginBottom="$2">
        <View height="100%" width={`${clampedPercent * 100}%` as any} borderRadius={3} backgroundColor={barColor} />
      </YStack>
      <XStack alignItems="baseline" gap="$1">
        <M color={isWarning ? barColor : '$color'} fontSize={14} fontWeight="700">{shoe.totalMiles.toFixed(0)} mi</M>
        <M color="$textTertiary" fontSize={12}>/ {shoe.maxMiles} mi</M>
      </XStack>
      {isWarning && !shoe.retired && (
        <B color={barColor} fontSize={12} fontWeight="600" marginTop="$1">
          {isCritical ? 'Replace soon!' : 'Getting worn'}
        </B>
      )}
    </YStack>
  );
}

export default function ZonesScreen() {
  const userProfile = useAppStore((s) => s.userProfile);
  const paceZones = useAppStore((s) => s.paceZones);
  const shoes = useAppStore((s) => s.shoes);

  if (!userProfile || !paceZones) {
    return (
      <YStack flex={1} backgroundColor="$background" justifyContent="center" alignItems="center" padding="$8">
        <H color="$color" fontSize={22} letterSpacing={1} marginBottom="$2">No Profile</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22}>
          Complete your profile setup to see pace zones and predictions.
        </B>
      </YStack>
    );
  }

  const vdot = userProfile.vdot_score;
  const hasHR = userProfile.max_hr != null && userProfile.rest_hr != null;
  const hrZones: HRZones | null = hasHR ? calculateHRZones(userProfile.max_hr!, userProfile.rest_hr!) : null;
  const hrLabels = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'] as const;
  const hrKeys = ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'] as const;

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
      <VDOTDisplay vdot={vdot} />

      <SectionHeader title="Pace Zones" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        {ZONE_NAMES.map((zone) => <PaceZoneRow key={zone} zone={zone} paceZones={paceZones} />)}
      </YStack>

      {hrZones && (
        <>
          <SectionHeader title="Heart Rate Zones" />
          <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
            {hrKeys.map((key, i) => (
              <HRZoneRow key={key} label={hrLabels[i]} name={hrZones[key].name} min={hrZones[key].min} max={hrZones[key].max} index={i} />
            ))}
          </YStack>
        </>
      )}

      <SectionHeader title="Race Predictions" />
      <YStack backgroundColor="$surface" borderRadius="$6" overflow="hidden">
        <RacePredictions vdot={vdot} />
      </YStack>

      {shoes.length > 0 && (
        <>
          <SectionHeader title="Shoes" />
          {shoes.map((shoe) => <ShoeCard key={shoe.id} shoe={shoe} />)}
        </>
      )}

      <YStack height={32} />
    </ScrollView>
  );
}
