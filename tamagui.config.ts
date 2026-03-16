import { createTamagui, createTokens, createFont } from 'tamagui';

// ─── Fonts ──────────────────────────────────────────────────

const headingFont = createFont({
  family: 'BebasNeue',
  size: {
    1: 12, 2: 14, 3: 16, 4: 18, 5: 20, 6: 24, 7: 28, 8: 32, 9: 40, 10: 48, 11: 56, 12: 64,
  },
  weight: { 4: '400' },
  letterSpacing: { 5: 1, 6: 1.2, 7: 1.5 },
  face: {
    400: { normal: 'BebasNeue_400Regular' },
  },
});

const bodyFont = createFont({
  family: 'Exo2',
  size: {
    1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 16, 7: 18, 8: 20, 9: 24, 10: 28,
  },
  weight: {
    3: '300', 4: '400', 5: '500', 6: '600', 7: '700', 8: '800',
  },
  letterSpacing: { 4: 0, 5: 0 },
  face: {
    300: { normal: 'Exo2_300Light' },
    400: { normal: 'Exo2_400Regular' },
    500: { normal: 'Exo2_500Medium' },
    600: { normal: 'Exo2_600SemiBold' },
    700: { normal: 'Exo2_700Bold' },
    800: { normal: 'Exo2_800ExtraBold' },
  },
});

const monoFont = createFont({
  family: 'JetBrainsMono',
  size: {
    1: 10, 2: 11, 3: 12, 4: 13, 5: 14, 6: 15, 7: 16, 8: 18, 9: 20, 10: 24, 11: 28, 12: 36,
  },
  weight: {
    4: '400', 5: '500', 6: '600', 7: '700', 8: '800',
  },
  letterSpacing: { 4: 0 },
  face: {
    400: { normal: 'JetBrainsMono_400Regular' },
    500: { normal: 'JetBrainsMono_500Medium' },
    600: { normal: 'JetBrainsMono_600SemiBold' },
    700: { normal: 'JetBrainsMono_700Bold' },
    800: { normal: 'JetBrainsMono_800ExtraBold' },
  },
});

// ─── Tokens ─────────────────────────────────────────────────

const tokens = createTokens({
  size: {
    0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 40, 10: 48, 11: 56, 12: 64, true: 16,
  },
  space: {
    0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 40, 10: 48, true: 16,
  },
  radius: {
    0: 0, 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 14, 7: 16, 8: 20, 9: 24, 10: 28, true: 12,
  },
  zIndex: {
    0: 0, 1: 100, 2: 200, 3: 300, 4: 400, 5: 500,
  },
  color: {
    // Dark theme palette
    background: '#121212',
    surface: '#1E1E1E',
    surfaceLight: '#2A2A2A',
    surfaceHover: '#333333',
    border: '#333333',
    borderLight: '#444444',

    // Brand
    accent: '#FF6B35',
    accentLight: '#FF8A5C',
    accentMuted: 'rgba(255,107,53,0.15)',
    primary: '#007AFF',
    primaryMuted: 'rgba(0,122,255,0.15)',

    // Status
    success: '#34C759',
    successMuted: 'rgba(52,199,89,0.15)',
    warning: '#FF9500',
    warningMuted: 'rgba(255,149,0,0.15)',
    danger: '#FF3B30',
    dangerMuted: 'rgba(255,59,48,0.15)',

    // Text
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    textTertiary: '#666666',
    textMuted: '#4A4A4A',

    // Phases
    phaseBase: '#007AFF',
    phaseBuild: '#FF9500',
    phasePeak: '#FF3B30',
    phaseTaper: '#34C759',

    // Strava
    strava: '#FC4C02',
    stravaMuted: 'rgba(252,76,2,0.15)',

    // Transparent
    transparent: 'transparent',
    white: '#FFFFFF',
    black: '#000000',
  },
});

// ─── Themes ─────────────────────────────────────────────────

const darkTheme = {
  // Standard Tamagui theme keys
  background: tokens.color.background,
  backgroundHover: tokens.color.surface,
  backgroundPress: tokens.color.surfaceLight,
  backgroundFocus: tokens.color.surface,
  color: tokens.color.text,
  colorHover: tokens.color.text,
  colorPress: tokens.color.textSecondary,
  colorFocus: tokens.color.text,
  borderColor: tokens.color.border,
  borderColorHover: tokens.color.borderLight,
  borderColorPress: tokens.color.border,
  borderColorFocus: tokens.color.accent,
  placeholderColor: tokens.color.textTertiary,
  shadowColor: tokens.color.black,

  // Custom app theme keys
  surface: tokens.color.surface,
  surfaceLight: tokens.color.surfaceLight,
  accent: tokens.color.accent,
  accentLight: tokens.color.accentLight,
  accentMuted: tokens.color.accentMuted,
  primary: tokens.color.primary,
  primaryMuted: tokens.color.primaryMuted,
  success: tokens.color.success,
  successMuted: tokens.color.successMuted,
  warning: tokens.color.warning,
  warningMuted: tokens.color.warningMuted,
  danger: tokens.color.danger,
  dangerMuted: tokens.color.dangerMuted,
  textSecondary: tokens.color.textSecondary,
  textTertiary: tokens.color.textTertiary,
  textMuted: tokens.color.textMuted,
  border: tokens.color.border,
  strava: tokens.color.strava,
  stravaMuted: tokens.color.stravaMuted,
  phaseBase: tokens.color.phaseBase,
  phaseBuild: tokens.color.phaseBuild,
  phasePeak: tokens.color.phasePeak,
  phaseTaper: tokens.color.phaseTaper,
};

// ─── Config ─────────────────────────────────────────────────

const config = createTamagui({
  defaultTheme: 'dark',
  shouldAddPrefersColorThemes: false,
  themeClassNameOnRoot: false,
  tokens,
  themes: {
    dark: darkTheme,
  },
  fonts: {
    heading: headingFont,
    body: bodyFont,
    mono: monoFont,
  },
  media: {
    sm: { maxWidth: 390 },
    md: { maxWidth: 768 },
    lg: { maxWidth: 1024 },
  },
});

export type AppConfig = typeof config;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
