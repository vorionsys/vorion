/**
 * Output Filtering
 * Filters AI model outputs for PII, sensitive data, and validation
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  OutputFilterResult,
  PIIDetection,
  PIIType,
  SensitiveDataMatch,
  HallucinationIndicator,
  ValidationError,
} from './types';

/**
 * Output filter configuration
 */
export interface OutputFilterConfig {
  enabled: boolean;
  piiDetection: boolean;
  piiRedaction: boolean;
  sensitiveDataPatterns: SensitiveDataPattern[];
  hallucinationDetection: boolean;
  confidenceThreshold: number;
  customValidationRules: ValidationRule[];
  redactionReplacement: string;
  preserveFormatting: boolean;
  logFilteredContent: boolean;
}

/**
 * Sensitive data pattern definition
 */
export interface SensitiveDataPattern {
  id: string;
  name: string;
  category: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  redact: boolean;
  enabled: boolean;
}

/**
 * Validation rule definition
 */
export interface ValidationRule {
  id: string;
  name: string;
  check: (output: string) => boolean;
  severity: 'warning' | 'error';
  message: string;
  field?: string;
  enabled: boolean;
}

/**
 * PII detection pattern
 */
interface PIIPattern {
  type: PIIType;
  pattern: RegExp;
  confidence: number;
  redactionFormat: (match: string) => string;
}

/**
 * Default PII patterns
 */
const DEFAULT_PII_PATTERNS: PIIPattern[] = [
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: 0.95,
    redactionFormat: () => '[EMAIL REDACTED]',
  },
  {
    type: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?(?:\([0-9]{3}\)|[0-9]{3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    confidence: 0.90,
    redactionFormat: () => '[PHONE REDACTED]',
  },
  {
    type: 'ssn',
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
    confidence: 0.85,
    redactionFormat: () => '[SSN REDACTED]',
  },
  {
    type: 'credit-card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    confidence: 0.95,
    redactionFormat: (match) => `[CARD *${match.slice(-4)}]`,
  },
  {
    type: 'ip-address',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.90,
    redactionFormat: () => '[IP REDACTED]',
  },
  {
    type: 'address',
    pattern: /\b\d{1,5}\s+(?:[A-Za-z]+\s*)+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Circle|Cir|Place|Pl)\.?\s*(?:#?\s*\d+)?\s*,?\s*(?:[A-Za-z]+\s*)+,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\b/gi,
    confidence: 0.80,
    redactionFormat: () => '[ADDRESS REDACTED]',
  },
  {
    type: 'dob',
    pattern: /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12][0-9]|3[01])[-\/](?:19|20)\d{2}\b/g,
    confidence: 0.75,
    redactionFormat: () => '[DOB REDACTED]',
  },
  {
    type: 'passport',
    pattern: /\b[A-Z]{1,2}[0-9]{6,9}\b/g,
    confidence: 0.70,
    redactionFormat: () => '[PASSPORT REDACTED]',
  },
  {
    type: 'driver-license',
    pattern: /\b[A-Z][0-9]{7,14}\b/g,
    confidence: 0.65,
    redactionFormat: () => '[DL REDACTED]',
  },
  {
    type: 'bank-account',
    pattern: /\b[0-9]{8,17}\b/g,
    confidence: 0.60,
    redactionFormat: (match) => `[ACCOUNT *${match.slice(-4)}]`,
  },
];

/**
 * Default sensitive data patterns
 */
const DEFAULT_SENSITIVE_PATTERNS: SensitiveDataPattern[] = [
  {
    id: 'api-key',
    name: 'API Key',
    category: 'credentials',
    pattern: /\b(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/gi,
    severity: 'critical',
    redact: true,
    enabled: true,
  },
  {
    id: 'aws-key',
    name: 'AWS Access Key',
    category: 'credentials',
    pattern: /\b(?:AKIA|ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[A-Z0-9]{16}\b/g,
    severity: 'critical',
    redact: true,
    enabled: true,
  },
  {
    id: 'password',
    name: 'Password',
    category: 'credentials',
    pattern: /\b(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi,
    severity: 'critical',
    redact: true,
    enabled: true,
  },
  {
    id: 'private-key',
    name: 'Private Key',
    category: 'credentials',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    severity: 'critical',
    redact: true,
    enabled: true,
  },
  {
    id: 'jwt-token',
    name: 'JWT Token',
    category: 'credentials',
    pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    severity: 'high',
    redact: true,
    enabled: true,
  },
  {
    id: 'internal-url',
    name: 'Internal URL',
    category: 'infrastructure',
    pattern: /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})[^\s]*/gi,
    severity: 'medium',
    redact: true,
    enabled: true,
  },
  {
    id: 'connection-string',
    name: 'Database Connection String',
    category: 'credentials',
    pattern: /\b(?:mongodb|mysql|postgresql|redis|amqp):\/\/[^\s]+/gi,
    severity: 'critical',
    redact: true,
    enabled: true,
  },
];

/**
 * Hallucination detection indicators
 */
const HALLUCINATION_INDICATORS = [
  {
    type: 'temporal-error' as const,
    patterns: [
      /\b(?:in|by|since)\s+20(?:2[5-9]|[3-9][0-9])\b/gi, // Future dates
      /\b(?:recently|just|new)\s+(?:announced|released|launched)\s+(?:in|on)\s+\d{4}\b/gi,
    ],
    description: 'Potential temporal inconsistency detected',
  },
  {
    type: 'factual-inconsistency' as const,
    patterns: [
      /\baccording\s+to\s+(?:some|various|multiple)\s+(?:sources|reports)\b/gi,
      /\bit\s+is\s+(?:widely\s+)?(?:believed|known|said|reported)\s+that\b/gi,
    ],
    description: 'Vague attribution may indicate uncertainty',
  },
  {
    type: 'unsupported-claim' as const,
    patterns: [
      /\b(?:studies|research|scientists)\s+(?:have\s+)?(?:shown|proven|demonstrated|confirmed)\b/gi,
      /\bstatistically\b.*\b\d+%\b/gi,
    ],
    description: 'Unverifiable statistical or scientific claim',
  },
  {
    type: 'confidence-mismatch' as const,
    patterns: [
      /\b(?:definitely|certainly|absolutely|undoubtedly|without\s+(?:a\s+)?doubt)\b/gi,
      /\b(?:always|never|every|none|all)\b/gi,
    ],
    description: 'Overconfident language may indicate unreliability',
  },
];

/**
 * Output Filter
 * Filters and validates AI model outputs
 */
export class OutputFilter extends EventEmitter {
  private config: OutputFilterConfig;
  private piiPatterns: PIIPattern[];
  private sensitivePatterns: SensitiveDataPattern[];
  private validationRules: ValidationRule[];

  constructor(config?: Partial<OutputFilterConfig>) {
    super();
    this.config = {
      enabled: true,
      piiDetection: true,
      piiRedaction: true,
      sensitiveDataPatterns: [],
      hallucinationDetection: true,
      confidenceThreshold: 0.7,
      customValidationRules: [],
      redactionReplacement: '[REDACTED]',
      preserveFormatting: true,
      logFilteredContent: false,
      ...config,
    };
    this.piiPatterns = [...DEFAULT_PII_PATTERNS];
    this.sensitivePatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...this.config.sensitiveDataPatterns];
    this.validationRules = [...this.config.customValidationRules];
  }

  /**
   * Filter output
   */
  async filterOutput(output: string): Promise<OutputFilterResult> {
    if (!this.config.enabled) {
      return this.createPassthroughResult(output);
    }

    const piiDetected: PIIDetection[] = [];
    const sensitiveDataDetected: SensitiveDataMatch[] = [];
    const hallucinationIndicators: HallucinationIndicator[] = [];
    const validationErrors: ValidationError[] = [];

    let filteredOutput = output;
    let redactionCount = 0;

    // Detect and redact PII
    if (this.config.piiDetection) {
      const piiResults = this.detectPII(output);
      piiDetected.push(...piiResults);

      if (this.config.piiRedaction) {
        const redactionResult = this.redactPII(filteredOutput, piiResults);
        filteredOutput = redactionResult.output;
        redactionCount += redactionResult.count;
      }
    }

    // Detect and redact sensitive data
    const sensitiveResults = this.detectSensitiveData(filteredOutput);
    sensitiveDataDetected.push(...sensitiveResults);

    for (const match of sensitiveResults) {
      if (match.redacted) {
        redactionCount++;
      }
    }
    filteredOutput = this.redactSensitiveData(filteredOutput, sensitiveResults);

    // Detect hallucination indicators
    if (this.config.hallucinationDetection) {
      const hallucinationResults = this.detectHallucinationIndicators(filteredOutput);
      hallucinationIndicators.push(...hallucinationResults);
    }

    // Run validation rules
    const validationResults = this.runValidationRules(filteredOutput);
    validationErrors.push(...validationResults);

    // Calculate confidence score
    const confidenceScore = this.calculateConfidenceScore(
      piiDetected,
      sensitiveDataDetected,
      hallucinationIndicators,
      validationErrors
    );

    // Determine if output should be blocked
    const blocked = this.shouldBlockOutput(
      piiDetected,
      sensitiveDataDetected,
      validationErrors,
      confidenceScore
    );

    const result: OutputFilterResult = {
      originalOutput: output,
      filteredOutput: blocked ? this.config.redactionReplacement : filteredOutput,
      wasFiltered: filteredOutput !== output || blocked,
      piiDetected,
      sensitiveDataDetected,
      hallucinationIndicators,
      confidenceScore,
      validationErrors,
      blocked,
      redactionCount,
    };

    if (result.wasFiltered) {
      this.emit('output:filtered', result);
    }

    return result;
  }

  /**
   * Detect PII in output
   */
  private detectPII(output: string): PIIDetection[] {
    const detections: PIIDetection[] = [];

    for (const pattern of this.piiPatterns) {
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match;

      while ((match = regex.exec(output)) !== null) {
        detections.push({
          type: pattern.type,
          value: match[0],
          redactedValue: pattern.redactionFormat(match[0]),
          location: {
            start: match.index,
            end: match.index + match[0].length,
          },
          confidence: pattern.confidence,
        });
      }
    }

    // Remove duplicates and overlapping detections
    return this.deduplicateDetections(detections);
  }

  /**
   * Redact PII from output
   */
  private redactPII(
    output: string,
    detections: PIIDetection[]
  ): { output: string; count: number } {
    let result = output;
    let count = 0;

    // Sort by location descending to avoid index shifting
    const sorted = [...detections].sort((a, b) => b.location.start - a.location.start);

    for (const detection of sorted) {
      if (detection.confidence >= this.config.confidenceThreshold) {
        const before = result.substring(0, detection.location.start);
        const after = result.substring(detection.location.end);
        result = before + detection.redactedValue + after;
        count++;
      }
    }

    return { output: result, count };
  }

  /**
   * Detect sensitive data patterns
   */
  private detectSensitiveData(output: string): SensitiveDataMatch[] {
    const matches: SensitiveDataMatch[] = [];

    for (const pattern of this.sensitivePatterns) {
      if (!pattern.enabled) continue;

      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match;

      while ((match = regex.exec(output)) !== null) {
        matches.push({
          category: pattern.category,
          pattern: pattern.name,
          value: match[0],
          severity: pattern.severity,
          redacted: pattern.redact,
        });
      }
    }

    return matches;
  }

  /**
   * Redact sensitive data from output
   */
  private redactSensitiveData(output: string, matches: SensitiveDataMatch[]): string {
    let result = output;

    for (const match of matches) {
      if (match.redacted) {
        result = result.replace(match.value, `[${match.category.toUpperCase()} REDACTED]`);
      }
    }

    return result;
  }

  /**
   * Detect hallucination indicators
   */
  private detectHallucinationIndicators(output: string): HallucinationIndicator[] {
    const indicators: HallucinationIndicator[] = [];

    for (const indicator of HALLUCINATION_INDICATORS) {
      for (const pattern of indicator.patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;

        while ((match = regex.exec(output)) !== null) {
          indicators.push({
            type: indicator.type,
            description: indicator.description,
            confidence: 0.6, // Base confidence for pattern match
            location: {
              start: match.index,
              end: match.index + match[0].length,
            },
          });
        }
      }
    }

    return indicators;
  }

  /**
   * Run validation rules
   */
  private runValidationRules(output: string): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of this.validationRules) {
      if (!rule.enabled) continue;

      if (!rule.check(output)) {
        errors.push({
          rule: rule.id,
          message: rule.message,
          severity: rule.severity,
          field: rule.field,
        });
      }
    }

    return errors;
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidenceScore(
    piiDetected: PIIDetection[],
    sensitiveData: SensitiveDataMatch[],
    hallucinations: HallucinationIndicator[],
    validationErrors: ValidationError[]
  ): number {
    let score = 1.0;

    // Reduce score for PII detections
    score -= piiDetected.length * 0.05;

    // Reduce score for sensitive data
    for (const match of sensitiveData) {
      const severityPenalty = {
        low: 0.02,
        medium: 0.05,
        high: 0.10,
        critical: 0.20,
      }[match.severity];
      score -= severityPenalty;
    }

    // Reduce score for hallucination indicators
    score -= hallucinations.length * 0.08;

    // Reduce score for validation errors
    for (const error of validationErrors) {
      score -= error.severity === 'error' ? 0.15 : 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Determine if output should be blocked
   */
  private shouldBlockOutput(
    piiDetected: PIIDetection[],
    sensitiveData: SensitiveDataMatch[],
    validationErrors: ValidationError[],
    confidenceScore: number
  ): boolean {
    // Block if critical sensitive data detected
    if (sensitiveData.some((s) => s.severity === 'critical')) {
      return true;
    }

    // Block if critical validation errors
    if (validationErrors.some((e) => e.severity === 'error')) {
      return true;
    }

    // Block if too much PII detected
    if (piiDetected.length > 5) {
      return true;
    }

    // Block if confidence is too low
    if (confidenceScore < 0.3) {
      return true;
    }

    return false;
  }

  /**
   * Remove duplicate and overlapping detections
   */
  private deduplicateDetections(detections: PIIDetection[]): PIIDetection[] {
    const sorted = [...detections].sort((a, b) => a.location.start - b.location.start);
    const result: PIIDetection[] = [];

    for (const detection of sorted) {
      const overlapping = result.find(
        (d) =>
          (detection.location.start >= d.location.start &&
            detection.location.start < d.location.end) ||
          (detection.location.end > d.location.start && detection.location.end <= d.location.end)
      );

      if (!overlapping) {
        result.push(detection);
      } else if (detection.confidence > overlapping.confidence) {
        // Replace with higher confidence detection
        const index = result.indexOf(overlapping);
        result[index] = detection;
      }
    }

    return result;
  }

  /**
   * Create passthrough result when filtering is disabled
   */
  private createPassthroughResult(output: string): OutputFilterResult {
    return {
      originalOutput: output,
      filteredOutput: output,
      wasFiltered: false,
      piiDetected: [],
      sensitiveDataDetected: [],
      hallucinationIndicators: [],
      confidenceScore: 1.0,
      validationErrors: [],
      blocked: false,
      redactionCount: 0,
    };
  }

  /**
   * Add a custom PII pattern
   */
  addPIIPattern(pattern: PIIPattern): void {
    this.piiPatterns.push(pattern);
  }

  /**
   * Add a custom sensitive data pattern
   */
  addSensitivePattern(pattern: SensitiveDataPattern): void {
    this.sensitivePatterns.push(pattern);
  }

  /**
   * Add a custom validation rule
   */
  addValidationRule(rule: ValidationRule): void {
    this.validationRules.push(rule);
  }

  /**
   * Remove a pattern or rule by ID
   */
  removePattern(id: string): boolean {
    let removed = false;

    const sensitiveIndex = this.sensitivePatterns.findIndex((p) => p.id === id);
    if (sensitiveIndex >= 0) {
      this.sensitivePatterns.splice(sensitiveIndex, 1);
      removed = true;
    }

    const ruleIndex = this.validationRules.findIndex((r) => r.id === id);
    if (ruleIndex >= 0) {
      this.validationRules.splice(ruleIndex, 1);
      removed = true;
    }

    return removed;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<OutputFilterConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.sensitiveDataPatterns) {
      this.sensitivePatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...updates.sensitiveDataPatterns];
    }
    if (updates.customValidationRules) {
      this.validationRules = [...updates.customValidationRules];
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OutputFilterConfig {
    return { ...this.config };
  }

  /**
   * Test output against specific pattern types
   */
  async testForPIIType(output: string, type: PIIType): Promise<PIIDetection[]> {
    const pattern = this.piiPatterns.find((p) => p.type === type);
    if (!pattern) return [];

    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    const detections: PIIDetection[] = [];
    let match;

    while ((match = regex.exec(output)) !== null) {
      detections.push({
        type: pattern.type,
        value: match[0],
        redactedValue: pattern.redactionFormat(match[0]),
        location: {
          start: match.index,
          end: match.index + match[0].length,
        },
        confidence: pattern.confidence,
      });
    }

    return detections;
  }

  /**
   * Get filter statistics
   */
  getStatistics(): {
    piiPatterns: number;
    sensitivePatterns: number;
    validationRules: number;
    enabledSensitivePatterns: number;
    enabledValidationRules: number;
  } {
    return {
      piiPatterns: this.piiPatterns.length,
      sensitivePatterns: this.sensitivePatterns.length,
      validationRules: this.validationRules.length,
      enabledSensitivePatterns: this.sensitivePatterns.filter((p) => p.enabled).length,
      enabledValidationRules: this.validationRules.filter((r) => r.enabled).length,
    };
  }
}

export default OutputFilter;
