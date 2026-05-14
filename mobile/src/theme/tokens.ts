import { ViewStyle } from 'react-native';

// ── Colours ───────────────────────────────────────────────────────────────────

export const colors = {
  // Backgrounds
  background:   '#F5F0E8',   // warm cream/linen — page background
  surface:      '#FFFFFF',   // card white
  surfaceMuted: '#EDE8DC',   // slightly darker cream — subtle cards

  // Brand greens
  primary:      '#2D4A2D',   // dark forest green — active nav, buttons, badges
  primaryLight: '#4A7C4A',   // lighter green accent

  // Secondary / accents
  secondary:    '#8B6914',   // warm brown/gold — secondary accents

  // Text
  textPrimary:   '#1A1A1A',  // near black
  textSecondary: '#6B6B5A',  // muted olive-grey
  textInverse:   '#FFFFFF',  // white text on dark backgrounds

  // Chrome
  border: '#D8D0BC',         // subtle warm border

  // Semantic
  danger: '#C0392B',         // red — Hall of Shame, over par, destructive actions

  // Ranking podium
  gold:   '#C9A84C',         // 1st place
  silver: '#8A9BA8',         // 2nd place
  bronze: '#8B6914',         // 3rd place (same as secondary)
} as const;

export type ColorKey = keyof typeof colors;

// ── Typography ────────────────────────────────────────────────────────────────

export const fontSize = {
  xs:      11,
  sm:      13,
  base:    15,
  md:      17,
  lg:      20,
  xl:      24,
  xxl:     30,
  display: 38,
} as const;

export type FontSizeKey = keyof typeof fontSize;

// ── Spacing ───────────────────────────────────────────────────────────────────

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export type SpacingKey = keyof typeof spacing;

// ── Border Radius ─────────────────────────────────────────────────────────────

export const radius = {
  sm:   6,
  md:   12,
  lg:   16,
  xl:   24,
  full: 999,
} as const;

export type RadiusKey = keyof typeof radius;

// ── Shadows ───────────────────────────────────────────────────────────────────

export const shadows = {
  card: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius:  4,
    elevation:     2,
  } as ViewStyle,
} as const;
