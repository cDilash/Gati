/**
 * Gradient configurations for expo-linear-gradient.
 *
 * Direction: ALWAYS cyan→orange, left→right or top→bottom. Never reversed.
 */

import { colors } from './colors';

export const gradients = {
  // Primary gradient (hero elements, buttons)
  primary: {
    colors: [colors.cyan, colors.orange] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },

  // Vertical primary
  primaryVertical: {
    colors: [colors.cyan, colors.orange] as const,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
  },

  // Subtle (card backgrounds, tints)
  subtle: {
    colors: [colors.cyanGhost, colors.orangeGhost] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },

  // Intensity spectrum (zones, difficulty)
  intensity: {
    colors: [colors.cyan, '#00D4AA', '#88AA44', colors.orange] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },

  // Divider line (very subtle)
  divider: {
    colors: [colors.cyanGlow, colors.orangeGlow] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
} as const;
