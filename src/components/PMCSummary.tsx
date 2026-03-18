/**
 * PMCSummary — three stat cards (Fitness/Fatigue/Form) + data quality + race projection + AI insight.
 *
 * Displays the key PMC numbers with trend arrows, status labels,
 * data quality indicator, and a cached AI analysis.
 */

import { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'tamagui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { PMCData, PMCDayData } from '../types';

// ─── Typography ──────────────────────────────────────────────

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Props ───────────────────────────────────────────────────

interface Props {
  pmcData: PMCData;
  aiInsight?: string | null;
}

// ─── Training phase detection ────────────────────────────────

export type TrainingPhaseLabel =
  | 'tapered'
  | 'recovering'
  | 'overreaching'
  | 'peak'
  | 'building'
  | 'base';

export function detectTrainingPhase(pmc: PMCData): TrainingPhaseLabel {
  const { currentCTL, currentATL, currentTSB, peakCTL } = pmc;
  if (currentTSB > 10) return 'tapered';
  if (currentTSB > 0) return 'recovering';
  // Only flag overreaching if CTL has had time to build (>15) — early training
  // naturally has high ATL/CTL ratio because the 7-day avg responds faster
  if (currentCTL > 15 && currentATL > currentCTL * 1.5) return 'overreaching';
  if (peakCTL > 0 && currentCTL > peakCTL * 0.95) return 'peak';
  if (currentTSB < -10) return 'building';
  return 'base';
}

// ─── Status labels ───────────────────────────────────────────

function getFitnessStatus(ctl: number, delta: number): { label: string; color: string } {
  if (delta > 2) return { label: 'building', color: colors.cyan };
  if (delta < -2) return { label: 'declining', color: colors.orange };
  if (ctl > 0 && Math.abs(delta) <= 2) return { label: 'plateau', color: colors.textSecondary };
  return { label: 'base', color: colors.textTertiary };
}

function getFatigueStatus(atl: number): { label: string; color: string } {
  if (atl > 80) return { label: 'very high', color: colors.error };
  if (atl > 55) return { label: 'high', color: colors.orange };
  if (atl > 30) return { label: 'moderate', color: colors.textSecondary };
  return { label: 'low', color: colors.cyan };
}

export function getACWRStatus(acwr: number): { label: string; color: string } {
  if (acwr > 1.5) return { label: 'HIGH', color: colors.error };
  if (acwr > 1.3) return { label: 'MODERATE', color: colors.orange };
  if (acwr >= 0.8) return { label: 'LOW', color: colors.cyan };
  if (acwr >= 0.6) return { label: 'LOW', color: colors.textSecondary };
  return { label: 'DETRAINING', color: colors.textTertiary };
}

function getFormStatus(tsb: number): { label: string; color: string } {
  if (tsb > 10) return { label: 'fresh', color: colors.cyan };
  if (tsb >= 0) return { label: 'neutral', color: colors.textSecondary };
  if (tsb >= -20) return { label: 'fatigued', color: colors.orange };
  return { label: 'overreaching', color: colors.error };
}

// ─── Component ───────────────────────────────────────────────

export function PMCSummary({ pmcData, aiInsight }: Props) {
  // Find values from 7 days ago for trend
  const historicalDays = pmcData.daily.filter((d) => !d.isProjected);
  const sevenDaysAgo =
    historicalDays.length >= 8
      ? historicalDays[historicalDays.length - 8]
      : historicalDays[0] ?? null;

  const ctlDelta = sevenDaysAgo ? pmcData.currentCTL - sevenDaysAgo.ctl : 0;
  const atlDelta = sevenDaysAgo ? pmcData.currentATL - sevenDaysAgo.atl : 0;
  const tsbDelta = sevenDaysAgo ? pmcData.currentTSB - sevenDaysAgo.tsb : 0;

  const fitnessStatus = getFitnessStatus(pmcData.currentCTL, ctlDelta);
  const fatigueStatus = getFatigueStatus(pmcData.currentATL);
  const formStatus = getFormStatus(pmcData.currentTSB);

  return (
    <View>
      {/* ─── Three stat cards ───────────────────────── */}
      <View style={styles.cardRow}>
        <StatCard
          title="FITNESS"
          value={pmcData.currentCTL.toFixed(0)}
          accentColor={colors.cyan}
          delta={ctlDelta}
          statusLabel={fitnessStatus.label}
          statusColor={fitnessStatus.color}
        />
        <StatCard
          title="FATIGUE"
          value={pmcData.currentATL.toFixed(0)}
          accentColor={colors.orange}
          delta={atlDelta}
          statusLabel={fatigueStatus.label}
          statusColor={fatigueStatus.color}
        />
        <StatCard
          title="FORM"
          value={(pmcData.currentTSB >= 0 ? '+' : '') + pmcData.currentTSB.toFixed(0)}
          accentColor={pmcData.currentTSB >= 0 ? colors.cyan : colors.orange}
          delta={tsbDelta}
          statusLabel={formStatus.label}
          statusColor={formStatus.color}
        />
      </View>

      {/* ─── Data quality indicator ─────────────────── */}
      <View style={styles.qualityRow}>
        <View
          style={[
            styles.qualityBadge,
            {
              backgroundColor:
                pmcData.dataQuality === 'high'
                  ? colors.cyanGhost
                  : pmcData.dataQuality === 'moderate'
                  ? colors.orangeGhost
                  : colors.orangeGhost,
              borderColor:
                pmcData.dataQuality === 'high'
                  ? colors.cyanDim
                  : colors.orangeDim,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={pmcData.dataQuality === 'high' ? 'heart-pulse' : pmcData.dataQuality === 'moderate' ? 'speedometer' : 'map-marker-distance'}
            size={12}
            color={pmcData.dataQuality === 'high' ? colors.cyan : colors.orangeDim}
          />
          <B
            fontSize={11}
            color={pmcData.dataQuality === 'high' ? colors.cyan : colors.orangeDim}
            marginLeft={4}
          >
            {pmcData.dataQuality === 'high'
              ? 'Based on heart rate data'
              : pmcData.dataQuality === 'moderate'
              ? 'Based on pace data'
              : 'Based on distance only'}
          </B>
        </View>
      </View>

      {/* ─── ACWR injury risk badge ────────────────── */}
      {pmcData.currentCTL > 5 && (() => {
        const acwr = pmcData.currentATL / pmcData.currentCTL;
        const acwrStatus = getACWRStatus(acwr);
        return (
          <View style={styles.acwrRow}>
            <MaterialCommunityIcons
              name="shield-alert"
              size={14}
              color={acwrStatus.color}
            />
            <B fontSize={12} color={colors.textSecondary} marginLeft={6}>
              Injury Risk:{' '}
            </B>
            <H fontSize={12} color={acwrStatus.color} letterSpacing={0.5}>
              {acwrStatus.label}
            </H>
            <M fontSize={12} fontWeight="600" color={colors.textTertiary} marginLeft={6}>
              ACWR {acwr.toFixed(2)}
            </M>
          </View>
        );
      })()}

      {/* ─── Race day projection ────────────────────── */}
      {pmcData.raceDayTSB != null && (
        <View style={styles.projectionRow}>
          <MaterialCommunityIcons
            name="flag-checkered"
            size={14}
            color={pmcData.raceDayTSB >= 0 ? colors.cyan : colors.orange}
          />
          <B fontSize={13} color={colors.textSecondary} marginLeft={6}>
            Projected race day form:{' '}
          </B>
          <M
            fontSize={13}
            fontWeight="700"
            color={pmcData.raceDayTSB >= 0 ? colors.cyan : colors.orange}
          >
            {pmcData.raceDayTSB >= 0 ? '+' : ''}
            {pmcData.raceDayTSB.toFixed(1)}
          </M>
          <B
            fontSize={13}
            color={pmcData.raceDayTSB >= 0 ? colors.cyan : colors.orange}
            marginLeft={4}
          >
            ({pmcData.raceDayTSB >= 5 ? 'fresh' : pmcData.raceDayTSB >= 0 ? 'neutral' : 'fatigued'})
          </B>
        </View>
      )}

      {/* Taper warning */}
      {pmcData.raceDayTSB != null && pmcData.raceDayTSB < 0 && (
        <View style={styles.warningRow}>
          <MaterialCommunityIcons name="alert-outline" size={14} color={colors.orange} />
          <B fontSize={12} color={colors.orange} marginLeft={6} flex={1}>
            You may not be fully tapered. Consider reducing volume in the final weeks.
          </B>
        </View>
      )}

      {/* ─── AI insight ─────────────────────────────── */}
      {aiInsight && (
        <View style={styles.insightCard}>
          <View style={styles.insightHeader}>
            <MaterialCommunityIcons name="robot-outline" size={14} color={colors.cyan} />
            <H fontSize={11} color={colors.textTertiary} letterSpacing={1} marginLeft={6}>
              COACH INSIGHT
            </H>
          </View>
          <B fontSize={13} color={colors.textSecondary} lineHeight={19}>
            {aiInsight}
          </B>
        </View>
      )}
    </View>
  );
}

// ─── StatCard ────────────────────────────────────────────────

function StatCard({
  title,
  value,
  accentColor,
  delta,
  statusLabel,
  statusColor,
}: {
  title: string;
  value: string;
  accentColor: string;
  delta: number;
  statusLabel: string;
  statusColor: string;
}) {
  const isUp = delta > 0.5;
  const isDown = delta < -0.5;
  const arrowName = isUp ? 'arrow-up' : isDown ? 'arrow-down' : 'minus';
  const arrowColor = isUp
    ? title === 'FATIGUE' ? colors.orange : colors.cyan // fatigue up = bad
    : isDown
    ? title === 'FATIGUE' ? colors.cyan : colors.orange // fatigue down = good
    : colors.textTertiary;

  return (
    <View style={[styles.statCard, { borderLeftColor: accentColor }]}>
      <H fontSize={10} color={colors.textTertiary} letterSpacing={1.5}>
        {title}
      </H>
      <M fontSize={24} fontWeight="800" color={colors.textPrimary} marginTop={2}>
        {value}
      </M>
      <View style={styles.trendRow}>
        <MaterialCommunityIcons name={arrowName as any} size={12} color={arrowColor} />
        <M fontSize={11} color={arrowColor} marginLeft={2}>
          {Math.abs(delta).toFixed(1)}
        </M>
        <B fontSize={10} color={colors.textTertiary} marginLeft={4}>
          7d
        </B>
      </View>
      <B fontSize={10} color={statusColor} marginTop={3} fontWeight="600">
        {statusLabel}
      </B>
    </View>
  );
}

// ─── Generate PMC Insight ────────────────────────────────────

/**
 * Generate a 2-3 sentence AI analysis of current PMC state.
 * Cached weekly in ai_cache with key "pmc_insight_{weekNumber}".
 */
export async function generatePMCInsight(
  pmcData: PMCData,
  currentWeekNumber: number,
): Promise<string | null> {
  try {
    const { isGeminiAvailable, sendStructuredMessage } = require('../ai/gemini');
    const { getCachedAIContent, setCachedAIContent } = require('../db/database');

    if (!isGeminiAvailable()) return null;

    const cacheKey = `pmc_w${currentWeekNumber}_ctl${Math.round(pmcData.currentCTL)}`;
    const cached = getCachedAIContent('pmc_insight', cacheKey);
    if (cached) return cached;

    const phase = detectTrainingPhase(pmcData);

    const prompt = `You are a running coach analyzing a marathon trainee's Performance Management Chart (PMC). Give a 2-3 sentence insight about their current training load state. Be specific with numbers. Reference what to expect next.

CURRENT STATE:
- Fitness (CTL): ${pmcData.currentCTL.toFixed(1)} ${pmcData.peakCTL > 0 ? `(peak: ${pmcData.peakCTL.toFixed(1)})` : ''}
- Fatigue (ATL): ${pmcData.currentATL.toFixed(1)}
- Form (TSB): ${pmcData.currentTSB.toFixed(1)}
- Training phase: ${phase}
- Data quality: ${pmcData.dataQuality} (${pmcData.hrMethodPercent}% HR-based)
${pmcData.raceDayTSB != null ? `- Projected race day form: ${pmcData.raceDayTSB.toFixed(1)}` : ''}

Respond with ONLY the insight text. No JSON, no formatting.`;

    const text = await sendStructuredMessage(
      'You are a concise running coach analyzing training load data. 2-3 sentences only.',
      prompt,
      'fast',
    );

    const insight = text.trim();
    setCachedAIContent('pmc_insight', cacheKey, insight);
    return insight;
  } catch (error) {
    console.warn('[PMC] Insight generation failed:', error);
    return null;
  }
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  cardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  qualityRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  qualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  acwrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  projectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  insightCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
});
