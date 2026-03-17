/**
 * Theme Colors — Single source of truth for ALL colors in the app.
 *
 * NEVER hardcode hex values in component files.
 * Always import from this file: `import { colors, semantic } from '../theme/colors';`
 *
 * Color meaning:
 * - Cyan (#00D4FF) = calm, speed, recovery, easy effort, "on target"
 * - Orange (#FF6B35) = intensity, fire, effort, warning, "needs attention"
 * - Gradient (cyan→orange) = energy spectrum, hero elements
 * - HR is ALWAYS orange
 */

export const colors = {
  // Primary duo
  cyan: '#00D4FF',
  cyanDim: '#00D4FF80',
  cyanGhost: '#00D4FF10',
  cyanGlow: '#00D4FF40',

  orange: '#FF6B35',
  orangeDim: '#FF6B3580',
  orangeGhost: '#FF6B3510',
  orangeGlow: '#FF6B3540',

  // Backgrounds (blue-tinted, NOT pure gray)
  background: '#0A0A0F',
  surface: '#141420',
  surfaceHover: '#1A1A2E',
  border: '#1E2A3A',
  borderSubtle: '#1E2A3A60',

  // Text (blue-gray, NOT pure gray)
  textPrimary: '#FFFFFF',
  textSecondary: '#8899AA',
  textTertiary: '#556677',

  // Semantic
  success: '#00E676',
  successMuted: 'rgba(0,230,118,0.15)',
  error: '#FF5252',
  errorMuted: 'rgba(255,82,82,0.15)',
  warning: '#FF6B35', // orange = warning

  // External brands
  strava: '#FC4C02',

  // Utility
  transparent: 'transparent',
  white: '#FFFFFF',
  black: '#000000',
} as const;

// Semantic color mappings
export const semantic = {
  // Workout types
  easyWorkout: colors.cyan,
  qualityWorkout: colors.orange,
  longRun: colors.cyan, // starts easy, gets intense
  restDay: colors.cyanDim,

  // Execution quality
  onTarget: colors.cyan,
  missedPace: colors.orange,
  exceededPace: colors.orange,
  partial: colors.orangeDim,

  // Recovery levels
  ready: colors.cyan,
  moderate: colors.orangeDim,
  fatigued: colors.orange,
  rest: colors.error,

  // Cross-training impact
  highImpact: colors.orange,
  moderateImpact: colors.orangeDim,
  lowImpact: colors.textSecondary,
  positiveImpact: colors.cyan,

  // Status
  completed: colors.success,
  skipped: colors.error,
  upcoming: colors.textSecondary,
  active: colors.cyan,
  modified: colors.orange,

  // Tab bar
  tabActive: colors.cyan,
  tabInactive: '#4A5568',
} as const;

// Phase colors (training periodization)
export const phaseColors = {
  base: colors.cyan,
  build: '#FF9500', // blend toward orange
  peak: colors.orange,
  taper: colors.cyan, // recovering back
} as const;

// Pace/HR zone intensity spectrum (Zone 1 → Zone 5)
export const zoneColors = [
  colors.cyan,      // Zone 1 — easy
  '#00D4AA',        // Zone 2 — aerobic
  '#88AA44',        // Zone 3 — threshold
  '#CC8822',        // Zone 4 — interval
  colors.orange,    // Zone 5 — max
] as const;
