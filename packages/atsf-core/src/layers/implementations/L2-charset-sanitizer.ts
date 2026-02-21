/**
 * L2 — Character Set Sanitizer
 *
 * Detects and strips dangerous Unicode sequences, invisible control characters,
 * homoglyph attacks, bi-directional override characters, and other encoding-level
 * prompt injection vectors.
 *
 * Tier: input_validation
 * Primary threat: prompt_injection
 *
 * @packageDocumentation
 */

import { BaseSecurityLayer, createLayerConfig } from '../index.js';
import type {
  LayerInput,
  LayerExecutionResult,
  LayerFinding,
  LayerModification,
  LayerTiming,
} from '../types.js';

/**
 * Unicode categories of dangerous characters
 */
const DANGEROUS_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}> = [
  {
    name: 'bidi_override',
    // Bi-directional override characters (used in trojan source attacks)
    pattern: /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    severity: 'critical',
    description: 'Bi-directional text override characters can disguise malicious content',
  },
  {
    name: 'zero_width',
    // Zero-width characters (invisible text injection)
    pattern: /[\u200B\u200C\u200D\uFEFF]/g,
    severity: 'high',
    description: 'Zero-width characters can hide content from human reviewers',
  },
  {
    name: 'control_chars',
    // C0/C1 control characters except common whitespace (tab, newline, carriage return)
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g,
    severity: 'high',
    description: 'Control characters can corrupt parsing or inject escape sequences',
  },
  {
    name: 'tag_chars',
    // Unicode tag characters (U+E0001-U+E007F) — used to hide instructions
    pattern: /[\uDB40][\uDC01-\uDC7F]/g,
    severity: 'high',
    description: 'Unicode tag characters can embed hidden instructions',
  },
  {
    name: 'interlinear_annotation',
    // Interlinear annotation characters
    pattern: /[\uFFF9\uFFFA\uFFFB]/g,
    severity: 'medium',
    description: 'Annotation characters can inject hidden metadata',
  },
  {
    name: 'replacement_char',
    // Object replacement character (can mask embedded objects)
    pattern: /\uFFFC/g,
    severity: 'medium',
    description: 'Object replacement character may mask embedded content',
  },
  {
    name: 'variation_selector_abuse',
    // Excessive variation selectors (emoji/glyph variant abuse)
    pattern: /[\uFE00-\uFE0F]{3,}/g,
    severity: 'low',
    description: 'Excessive variation selectors suggest encoding manipulation',
  },
];

/**
 * Common homoglyph mappings (confusable characters → ASCII equivalent)
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  '\u0410': 'A', // Cyrillic А → Latin A
  '\u0412': 'B', // Cyrillic В → Latin B
  '\u0421': 'C', // Cyrillic С → Latin C
  '\u0415': 'E', // Cyrillic Е → Latin E
  '\u041D': 'H', // Cyrillic Н → Latin H
  '\u041A': 'K', // Cyrillic К → Latin K
  '\u041C': 'M', // Cyrillic М → Latin M
  '\u041E': 'O', // Cyrillic О → Latin O
  '\u0420': 'P', // Cyrillic Р → Latin P
  '\u0422': 'T', // Cyrillic Т → Latin T
  '\u0425': 'X', // Cyrillic Х → Latin X
  '\u0430': 'a', // Cyrillic а → Latin a
  '\u0435': 'e', // Cyrillic е → Latin e
  '\u043E': 'o', // Cyrillic о → Latin o
  '\u0440': 'p', // Cyrillic р → Latin p
  '\u0441': 'c', // Cyrillic с → Latin c
  '\u0443': 'y', // Cyrillic у → Latin y
  '\u0445': 'x', // Cyrillic х → Latin x
  '\u0456': 'i', // Cyrillic і → Latin i
  '\u0458': 'j', // Cyrillic ј → Latin j
  '\u0455': 's', // Cyrillic ѕ → Latin s
  '\u0501': 'd', // Cyrillic ԁ → Latin d
};

/**
 * L2 Character Set Sanitizer
 *
 * Strips dangerous characters and detects homoglyph attacks.
 */
export class L2CharsetSanitizer extends BaseSecurityLayer {
  constructor() {
    super(
      createLayerConfig(2, 'Character Set Sanitizer', {
        description: 'Detects and sanitizes dangerous Unicode sequences, invisible characters, and homoglyph attacks',
        tier: 'input_validation',
        primaryThreat: 'prompt_injection',
        secondaryThreats: ['deceptive_output', 'audit_evasion'],
        failMode: 'block',
        required: true,
        timeoutMs: 300,
        parallelizable: true,
        dependencies: [],
      })
    );
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const findings: LayerFinding[] = [];
    const modifications: LayerModification[] = [];

    // Walk all string values in the payload
    this.scanObject(input.payload, '', findings, modifications);

    const timing = this.buildTiming(startedAt, t0);
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const hasHigh = findings.some((f) => f.severity === 'high');
    const passed = !hasCritical && !hasHigh;

    if (passed) {
      return this.createSuccessResult('allow', 0.9, findings, modifications, timing);
    }

    return this.createFailureResult(
      hasCritical ? 'deny' : 'escalate',
      0.85,
      findings,
      timing
    );
  }

  private scanObject(
    obj: unknown,
    path: string,
    findings: LayerFinding[],
    modifications: LayerModification[]
  ): void {
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'string') {
      this.scanString(obj, path, findings, modifications);
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.scanObject(obj[i], `${path}[${i}]`, findings, modifications);
      }
      return;
    }

    if (typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        // Also scan keys for homoglyphs
        this.scanString(key, `${path ? path + '.' : ''}(key:${key})`, findings, modifications);
        this.scanObject(val, path ? `${path}.${key}` : key, findings, modifications);
      }
    }
  }

  private scanString(
    value: string,
    path: string,
    findings: LayerFinding[],
    modifications: LayerModification[]
  ): void {
    // 1. Check for dangerous character patterns
    for (const { name, pattern, severity, description } of DANGEROUS_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;
      const matches = value.match(pattern);
      if (matches && matches.length > 0) {
        findings.push({
          type: 'threat_detected',
          severity,
          code: `L2_${name.toUpperCase()}`,
          description: `${description} at '${path}'`,
          evidence: [
            `Found ${matches.length} instance(s)`,
            `Code points: ${matches.slice(0, 5).map((c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ')}`,
          ],
          remediation: `Remove ${name} characters from the input`,
        });

        modifications.push({
          target: path,
          type: 'sanitize',
          originalValue: `[${matches.length} ${name} chars]`,
          newValue: '[stripped]',
          reason: description,
        });
      }
    }

    // 2. Check for mixed-script homoglyph attacks
    const homoglyphs = this.detectHomoglyphs(value);
    if (homoglyphs.length > 0) {
      findings.push({
        type: 'threat_detected',
        severity: 'high',
        code: 'L2_HOMOGLYPH_ATTACK',
        description: `Mixed-script homoglyph characters detected at '${path}'`,
        evidence: homoglyphs.slice(0, 10).map(
          (h) => `'${h.char}' (U+${h.codePoint}) looks like '${h.looksLike}'`
        ),
        remediation: 'Use consistent character scripts (do not mix Cyrillic with Latin)',
      });
    }
  }

  private detectHomoglyphs(value: string): Array<{ char: string; codePoint: string; looksLike: string }> {
    const results: Array<{ char: string; codePoint: string; looksLike: string }> = [];

    // Only flag if the string contains a mix of Latin and non-Latin scripts
    const hasLatin = /[a-zA-Z]/.test(value);
    if (!hasLatin) return results;

    for (const char of value) {
      const mapped = HOMOGLYPH_MAP[char];
      if (mapped) {
        results.push({
          char,
          codePoint: char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'),
          looksLike: mapped,
        });
      }
    }

    return results;
  }

  private buildTiming(startedAt: string, t0: number): LayerTiming {
    const durationMs = performance.now() - t0;
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      waitTimeMs: 0,
      processingTimeMs: durationMs,
    };
  }
}
