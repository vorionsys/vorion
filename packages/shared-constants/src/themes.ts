/**
 * Unified Theme System for the Vorion Ecosystem
 *
 * Controls the visual identity across all three sites:
 * - cognigate.dev (Developer Engine)
 * - agentanchorai.com (Enterprise Platform)
 * - vorion.org (Community / Standard)
 *
 * QUICK SWAP: Change ACTIVE_THEME to switch all sites at once.
 */

// =============================================================================
// ACTIVE THEME — CHANGE THIS ONE LINE TO SWAP ALL SITES
// =============================================================================

export const ACTIVE_THEME: ThemeId = 'midnight_cyan';

// =============================================================================
// THEME DEFINITIONS
// =============================================================================

export type ThemeId =
  | 'midnight_cyan'
  | 'indigo_authority'
  | 'obsidian_amber'
  | 'arctic_glass';

export interface ThemeTokens {
  /** Theme display name */
  name: string;
  /** Short description for team review */
  description: string;

  // ── Backgrounds ──────────────────────────────────────────────
  /** Page background */
  bgPrimary: string;
  /** Card / surface background */
  bgSurface: string;
  /** Input / recessed background */
  bgInput: string;
  /** Nav background */
  bgNav: string;
  /** Code block background */
  bgCode: string;

  // ── Accent Colors ────────────────────────────────────────────
  /** Primary accent (buttons, links, active states) */
  accent: string;
  /** Accent hover state */
  accentHover: string;
  /** Accent at 10% opacity (badges, subtle fills) */
  accentMuted: string;
  /** Accent at 3% opacity (table row hover) */
  accentSubtle: string;

  // ── Text Colors ──────────────────────────────────────────────
  /** Primary body text */
  textPrimary: string;
  /** Headings */
  textHeading: string;
  /** Secondary/muted text */
  textSecondary: string;
  /** Tertiary/subtle text */
  textTertiary: string;

  // ── Borders ──────────────────────────────────────────────────
  /** Card/section borders */
  border: string;
  /** Input borders */
  borderInput: string;
  /** Hover border for interactive cards */
  borderHover: string;
  /** Nav/section divider border (Tailwind opacity format) */
  borderDivider: string;

  // ── Gradients ────────────────────────────────────────────────
  /** Hero text gradient start */
  gradientFrom: string;
  /** Hero text gradient end */
  gradientTo: string;

  // ── Scrollbar ────────────────────────────────────────────────
  scrollTrack: string;
  scrollThumb: string;
  scrollThumbHover: string;

  // ── Selection ────────────────────────────────────────────────
  selectionBg: string;

  // ── Semantic (unchanged across themes) ───────────────────────
  /** Kept consistent for meaning — these don't change with theme */
  success: string;
  error: string;
  warning: string;
  info: string;

  // ── Layer Colors (BASIS stack identity — consistent) ─────────
  layerBasis: string;
  layerIntent: string;
  layerEnforce: string;
  layerProof: string;

  // ── Font ─────────────────────────────────────────────────────
  fontFamily: string;
  /** Tailwind-compatible font class for Next.js sites */
  fontImport: string;

  // ── Card Effects ─────────────────────────────────────────────
  /** Whether to apply backdrop-blur to cards */
  cardBlur: boolean;
  /** Button text color (on accent background) */
  buttonText: string;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  // ═══════════════════════════════════════════════════════════════
  // OPTION 1: MIDNIGHT CYAN — Current look, standardized
  // ═══════════════════════════════════════════════════════════════
  midnight_cyan: {
    name: 'Midnight Cyan',
    description: 'Developer-native. Terminal-adjacent. The current look, unified.',

    bgPrimary: '#0a0a0f',
    bgSurface: '#111118',
    bgInput: '#0d0d14',
    bgNav: '#111118',
    bgCode: '#0d0d14',

    accent: '#06b6d4',
    accentHover: '#22d3ee',
    accentMuted: 'rgba(6, 182, 212, 0.1)',
    accentSubtle: 'rgba(6, 182, 212, 0.03)',

    textPrimary: '#e0e0e6',
    textHeading: '#ffffff',
    textSecondary: '#888888',
    textTertiary: '#666666',

    border: '#1e1e2e',
    borderInput: '#2a2a3a',
    borderHover: 'rgba(6, 182, 212, 0.4)',
    borderDivider: 'rgba(255, 255, 255, 0.05)',

    gradientFrom: '#06b6d4',
    gradientTo: '#2dd4bf',

    scrollTrack: '#0a0a0f',
    scrollThumb: '#333340',
    scrollThumbHover: '#06b6d4',

    selectionBg: 'rgba(6, 182, 212, 0.3)',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f97316',
    info: '#3b82f6',

    layerBasis: '#fbbf24',
    layerIntent: '#60a5fa',
    layerEnforce: '#818cf8',
    layerProof: '#34d399',

    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontImport: 'Inter',
    cardBlur: false,
    buttonText: '#000000',
  },

  // ═══════════════════════════════════════════════════════════════
  // OPTION 2: INDIGO AUTHORITY — Governance-forward, institutional
  // ═══════════════════════════════════════════════════════════════
  indigo_authority: {
    name: 'Indigo Authority',
    description: 'Institutional. Authoritative. Governance-forward.',

    bgPrimary: '#07070d',
    bgSurface: '#12121f',
    bgInput: '#0c0c18',
    bgNav: '#12121f',
    bgCode: '#0c0c18',

    accent: '#818cf8',
    accentHover: '#a5b4fc',
    accentMuted: 'rgba(129, 140, 248, 0.1)',
    accentSubtle: 'rgba(129, 140, 248, 0.03)',

    textPrimary: '#dcdce6',
    textHeading: '#ffffff',
    textSecondary: '#8888a0',
    textTertiary: '#666680',

    border: '#1e1e30',
    borderInput: '#2a2a40',
    borderHover: 'rgba(129, 140, 248, 0.4)',
    borderDivider: 'rgba(255, 255, 255, 0.05)',

    gradientFrom: '#818cf8',
    gradientTo: '#c084fc',

    scrollTrack: '#07070d',
    scrollThumb: '#2a2a40',
    scrollThumbHover: '#818cf8',

    selectionBg: 'rgba(129, 140, 248, 0.3)',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f97316',
    info: '#3b82f6',

    layerBasis: '#fbbf24',
    layerIntent: '#60a5fa',
    layerEnforce: '#818cf8',
    layerProof: '#34d399',

    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontImport: 'Inter',
    cardBlur: false,
    buttonText: '#000000',
  },

  // ═══════════════════════════════════════════════════════════════
  // OPTION 3: OBSIDIAN AMBER — Warm, premium, "gold standard"
  // ═══════════════════════════════════════════════════════════════
  obsidian_amber: {
    name: 'Obsidian Amber',
    description: 'Premium. Warm. The gold standard of AI governance.',

    bgPrimary: '#0a0a08',
    bgSurface: '#141410',
    bgInput: '#0d0d0a',
    bgNav: '#141410',
    bgCode: '#0d0d0a',

    accent: '#f59e0b',
    accentHover: '#fbbf24',
    accentMuted: 'rgba(245, 158, 11, 0.1)',
    accentSubtle: 'rgba(245, 158, 11, 0.03)',

    textPrimary: '#e6e0d6',
    textHeading: '#ffffff',
    textSecondary: '#8a8478',
    textTertiary: '#666058',

    border: '#2a2820',
    borderInput: '#3a3830',
    borderHover: 'rgba(245, 158, 11, 0.4)',
    borderDivider: 'rgba(255, 255, 255, 0.05)',

    gradientFrom: '#f59e0b',
    gradientTo: '#f97316',

    scrollTrack: '#0a0a08',
    scrollThumb: '#3a3830',
    scrollThumbHover: '#f59e0b',

    selectionBg: 'rgba(245, 158, 11, 0.3)',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f97316',
    info: '#3b82f6',

    layerBasis: '#fbbf24',
    layerIntent: '#60a5fa',
    layerEnforce: '#818cf8',
    layerProof: '#34d399',

    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontImport: 'Inter',
    cardBlur: false,
    buttonText: '#000000',
  },

  // ═══════════════════════════════════════════════════════════════
  // OPTION 4: ARCTIC GLASS — Modern SaaS, frosted glass
  // ═══════════════════════════════════════════════════════════════
  arctic_glass: {
    name: 'Arctic Glass',
    description: 'Modern SaaS. Clean. Frosted glass depth.',

    bgPrimary: '#0c0c14',
    bgSurface: 'rgba(255, 255, 255, 0.04)',
    bgInput: 'rgba(0, 0, 0, 0.3)',
    bgNav: 'rgba(12, 12, 20, 0.8)',
    bgCode: 'rgba(0, 0, 0, 0.3)',

    accent: '#38bdf8',
    accentHover: '#7dd3fc',
    accentMuted: 'rgba(56, 189, 248, 0.1)',
    accentSubtle: 'rgba(56, 189, 248, 0.03)',

    textPrimary: '#e2e8f0',
    textHeading: '#f8fafc',
    textSecondary: '#94a3b8',
    textTertiary: '#64748b',

    border: 'rgba(255, 255, 255, 0.08)',
    borderInput: 'rgba(255, 255, 255, 0.12)',
    borderHover: 'rgba(56, 189, 248, 0.4)',
    borderDivider: 'rgba(255, 255, 255, 0.05)',

    gradientFrom: '#38bdf8',
    gradientTo: '#06b6d4',

    scrollTrack: '#0c0c14',
    scrollThumb: 'rgba(255, 255, 255, 0.1)',
    scrollThumbHover: '#38bdf8',

    selectionBg: 'rgba(56, 189, 248, 0.3)',

    success: '#22c55e',
    error: '#ef4444',
    warning: '#f97316',
    info: '#3b82f6',

    layerBasis: '#fbbf24',
    layerIntent: '#60a5fa',
    layerEnforce: '#818cf8',
    layerProof: '#34d399',

    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontImport: 'Geist',
    cardBlur: true,
    buttonText: '#000000',
  },
};

// =============================================================================
// HELPERS
// =============================================================================

/** Get the currently active theme tokens */
export function getActiveTheme(): ThemeTokens {
  return THEMES[ACTIVE_THEME];
}

/** Get all theme IDs */
export function getAllThemeIds(): ThemeId[] {
  return Object.keys(THEMES) as ThemeId[];
}

/** Generate CSS custom properties string from a theme */
export function themeToCssVars(themeId: ThemeId = ACTIVE_THEME): string {
  const t = THEMES[themeId];
  return `
    --bg-primary: ${t.bgPrimary};
    --bg-surface: ${t.bgSurface};
    --bg-input: ${t.bgInput};
    --bg-nav: ${t.bgNav};
    --bg-code: ${t.bgCode};
    --accent: ${t.accent};
    --accent-hover: ${t.accentHover};
    --accent-muted: ${t.accentMuted};
    --accent-subtle: ${t.accentSubtle};
    --text-primary: ${t.textPrimary};
    --text-heading: ${t.textHeading};
    --text-secondary: ${t.textSecondary};
    --text-tertiary: ${t.textTertiary};
    --border: ${t.border};
    --border-input: ${t.borderInput};
    --border-hover: ${t.borderHover};
    --border-divider: ${t.borderDivider};
    --gradient-from: ${t.gradientFrom};
    --gradient-to: ${t.gradientTo};
    --scroll-track: ${t.scrollTrack};
    --scroll-thumb: ${t.scrollThumb};
    --scroll-thumb-hover: ${t.scrollThumbHover};
    --selection-bg: ${t.selectionBg};
    --success: ${t.success};
    --error: ${t.error};
    --warning: ${t.warning};
    --info: ${t.info};
    --layer-basis: ${t.layerBasis};
    --layer-intent: ${t.layerIntent};
    --layer-enforce: ${t.layerEnforce};
    --layer-proof: ${t.layerProof};
    --btn-text: ${t.buttonText};
  `.trim();
}
