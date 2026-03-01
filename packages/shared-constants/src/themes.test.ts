import { describe, it, expect } from 'vitest';
import {
  ACTIVE_THEME,
  THEMES,
  getActiveTheme,
  getAllThemeIds,
  themeToCssVars,
} from './themes.js';

describe('THEMES', () => {
  it('has 4 theme variants', () => {
    expect(Object.keys(THEMES)).toHaveLength(4);
  });

  it('includes all expected theme IDs', () => {
    expect(THEMES.midnight_cyan).toBeDefined();
    expect(THEMES.indigo_authority).toBeDefined();
    expect(THEMES.obsidian_amber).toBeDefined();
    expect(THEMES.arctic_glass).toBeDefined();
  });

  it('all themes have required fields', () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.bgPrimary).toBeTruthy();
      expect(theme.bgSurface).toBeTruthy();
      expect(theme.accent).toBeTruthy();
      expect(theme.textPrimary).toBeTruthy();
      expect(theme.textHeading).toBeTruthy();
      expect(theme.border).toBeTruthy();
      expect(theme.fontFamily).toBeTruthy();
      expect(theme.fontImport).toBeTruthy();
      expect(typeof theme.cardBlur).toBe('boolean');
      expect(theme.buttonText).toBeTruthy();
    }
  });

  it('all themes have semantic colors', () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.success).toBeTruthy();
      expect(theme.error).toBeTruthy();
      expect(theme.warning).toBeTruthy();
      expect(theme.info).toBeTruthy();
    }
  });

  it('all themes have layer colors', () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.layerBasis).toBeTruthy();
      expect(theme.layerIntent).toBeTruthy();
      expect(theme.layerEnforce).toBeTruthy();
      expect(theme.layerProof).toBeTruthy();
    }
  });
});

describe('ACTIVE_THEME', () => {
  it('is a valid theme ID', () => {
    expect(THEMES[ACTIVE_THEME]).toBeDefined();
  });
});

describe('getActiveTheme', () => {
  it('returns tokens for the active theme', () => {
    const theme = getActiveTheme();
    expect(theme).toBe(THEMES[ACTIVE_THEME]);
    expect(theme.name).toBeTruthy();
  });
});

describe('getAllThemeIds', () => {
  it('returns all 4 theme IDs', () => {
    const ids = getAllThemeIds();
    expect(ids).toHaveLength(4);
    expect(ids).toContain('midnight_cyan');
    expect(ids).toContain('indigo_authority');
    expect(ids).toContain('obsidian_amber');
    expect(ids).toContain('arctic_glass');
  });
});

describe('themeToCssVars', () => {
  it('generates CSS custom properties', () => {
    const css = themeToCssVars('midnight_cyan');
    expect(css).toContain('--bg-primary:');
    expect(css).toContain('--accent:');
    expect(css).toContain('--text-primary:');
    expect(css).toContain('--border:');
    expect(css).toContain('--btn-text:');
  });

  it('uses active theme when called without argument', () => {
    const css = themeToCssVars();
    expect(css).toContain('--bg-primary:');
  });

  it('different themes produce different CSS', () => {
    const cyan = themeToCssVars('midnight_cyan');
    const amber = themeToCssVars('obsidian_amber');
    expect(cyan).not.toBe(amber);
  });
});
