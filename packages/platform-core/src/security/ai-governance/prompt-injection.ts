/**
 * Prompt Injection Defense
 * Detects and prevents prompt injection attacks on AI models
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  InjectionDetectionResult,
  DetectedPattern,
  InjectionPatternType,
  PromptTemplate,
  PromptVariable,
  PromptConstraint,
} from './types.js';

/**
 * Injection detection configuration
 */
export interface InjectionDetectionConfig {
  enabled: boolean;
  strictMode: boolean;
  blockOnDetection: boolean;
  sensitivityLevel: 'low' | 'medium' | 'high';
  customPatterns: InjectionPattern[];
  whitelistedPatterns: string[];
  maxInputLength: number;
  enableContextOverflowDetection: boolean;
  enableEncodingAttackDetection: boolean;
}

/**
 * Custom injection pattern definition
 */
export interface InjectionPattern {
  id: string;
  name: string;
  type: InjectionPatternType;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  enabled: boolean;
}

/**
 * Prompt template storage interface
 */
export interface TemplateStorage {
  save(template: PromptTemplate): Promise<void>;
  get(templateId: string): Promise<PromptTemplate | null>;
  delete(templateId: string): Promise<void>;
  list(): Promise<PromptTemplate[]>;
}

/**
 * In-memory template storage
 */
export class InMemoryTemplateStorage implements TemplateStorage {
  private templates: Map<string, PromptTemplate> = new Map();

  async save(template: PromptTemplate): Promise<void> {
    this.templates.set(template.id, { ...template });
  }

  async get(templateId: string): Promise<PromptTemplate | null> {
    const template = this.templates.get(templateId);
    return template ? { ...template } : null;
  }

  async delete(templateId: string): Promise<void> {
    this.templates.delete(templateId);
  }

  async list(): Promise<PromptTemplate[]> {
    return Array.from(this.templates.values());
  }
}

/**
 * Default injection patterns
 */
const DEFAULT_PATTERNS: InjectionPattern[] = [
  // Role manipulation patterns
  {
    id: 'role-ignore-instructions',
    name: 'Ignore Instructions',
    type: 'role-manipulation',
    pattern: /(?:ignore|disregard|forget|skip|bypass)\s+(?:all\s+)?(?:previous|prior|above|earlier|your|the)\s+(?:instructions|rules|guidelines|prompts?|directions)/i,
    severity: 'high',
    description: 'Attempt to make the model ignore its instructions',
    enabled: true,
  },
  {
    id: 'role-new-persona',
    name: 'New Persona Assignment',
    type: 'role-manipulation',
    pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|assume\s+the\s+role|from\s+now\s+on\s+you\s+are|roleplay\s+as)/i,
    severity: 'high',
    description: 'Attempt to assign a new persona to the model',
    enabled: true,
  },
  {
    id: 'role-developer-mode',
    name: 'Developer Mode Activation',
    type: 'jailbreak',
    pattern: /(?:developer\s+mode|dev\s+mode|debug\s+mode|god\s+mode|admin\s+mode|root\s+access|sudo\s+mode|maintenance\s+mode)/i,
    severity: 'critical',
    description: 'Attempt to activate privileged mode',
    enabled: true,
  },
  // Instruction override patterns
  {
    id: 'instruction-override',
    name: 'System Instruction Override',
    type: 'instruction-override',
    pattern: /(?:system\s*(?:prompt|message|instruction)|new\s+system|override\s+system|replace\s+system)/i,
    severity: 'critical',
    description: 'Attempt to override system instructions',
    enabled: true,
  },
  {
    id: 'instruction-reset',
    name: 'Instruction Reset',
    type: 'instruction-override',
    pattern: /(?:reset\s+(?:your\s+)?instructions|clear\s+(?:your\s+)?(?:context|memory|instructions)|start\s+fresh|new\s+conversation\s*:)/i,
    severity: 'high',
    description: 'Attempt to reset model instructions',
    enabled: true,
  },
  // Context manipulation patterns
  {
    id: 'context-end-marker',
    name: 'Context End Marker',
    type: 'context-manipulation',
    pattern: /(?:---\s*end\s+of\s+(?:system|instructions|context)|<\/system>|<\/instructions>|END_PROMPT|STOP_PROCESSING)/i,
    severity: 'high',
    description: 'Fake context end markers',
    enabled: true,
  },
  {
    id: 'context-injection',
    name: 'Context Injection',
    type: 'context-manipulation',
    pattern: /(?:\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|###\s*(?:System|Human|Assistant):)/i,
    severity: 'critical',
    description: 'Injection of model-specific context markers',
    enabled: true,
  },
  // Delimiter injection patterns
  {
    id: 'delimiter-injection',
    name: 'Delimiter Injection',
    type: 'delimiter-injection',
    pattern: /(?:"""[\s\S]*?"""|```[\s\S]*?```|<\|[\s\S]*?\|>|\[\[[\s\S]*?\]\])/,
    severity: 'medium',
    description: 'Suspicious delimiter usage',
    enabled: true,
  },
  // Jailbreak patterns
  {
    id: 'jailbreak-dan',
    name: 'DAN Jailbreak',
    type: 'jailbreak',
    pattern: /(?:DAN|do\s+anything\s+now|jailbreak(?:ed)?|unrestricted\s+mode|no\s+(?:limits|restrictions|filters))/i,
    severity: 'critical',
    description: 'Known jailbreak technique',
    enabled: true,
  },
  {
    id: 'jailbreak-hypothetical',
    name: 'Hypothetical Scenario',
    type: 'jailbreak',
    pattern: /(?:hypothetically|in\s+a\s+fictional|imagine\s+you|let's\s+pretend|in\s+this\s+story|for\s+(?:research|educational)\s+purposes)/i,
    severity: 'medium',
    description: 'Hypothetical scenario to bypass restrictions',
    enabled: true,
  },
  // Prompt leaking patterns
  {
    id: 'leak-repeat',
    name: 'Prompt Repetition Request',
    type: 'prompt-leaking',
    pattern: /(?:repeat\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)|what\s+(?:are|were)\s+your\s+(?:original\s+)?instructions|show\s+(?:me\s+)?your\s+(?:system\s+)?prompt)/i,
    severity: 'high',
    description: 'Attempt to extract system prompt',
    enabled: true,
  },
  {
    id: 'leak-verbatim',
    name: 'Verbatim Request',
    type: 'prompt-leaking',
    pattern: /(?:verbatim|word\s+for\s+word|exact(?:ly)?|copy\s+(?:of\s+)?(?:your\s+)?(?:instructions|prompt))/i,
    severity: 'medium',
    description: 'Request for verbatim system prompt',
    enabled: true,
  },
  // System prompt extraction
  {
    id: 'extract-system',
    name: 'System Extraction',
    type: 'system-prompt-extraction',
    pattern: /(?:what\s+is\s+(?:your\s+)?(?:system|initial)\s+(?:prompt|message)|reveal\s+(?:your\s+)?(?:hidden|secret)\s+(?:instructions|prompt)|dump\s+(?:your\s+)?(?:system|config))/i,
    severity: 'high',
    description: 'Attempt to extract system configuration',
    enabled: true,
  },
  // Recursive injection
  {
    id: 'recursive-injection',
    name: 'Recursive Prompt',
    type: 'recursive-injection',
    pattern: /(?:when\s+you\s+(?:see|encounter|read)\s+this|if\s+(?:the\s+)?(?:user|input)\s+(?:says|contains)|process\s+this\s+recursively)/i,
    severity: 'medium',
    description: 'Attempt at recursive prompt injection',
    enabled: true,
  },
];

/**
 * Prompt Injection Detector
 * Analyzes inputs for injection attempts and sanitizes them
 */
export class PromptInjectionDetector extends EventEmitter {
  private config: InjectionDetectionConfig;
  private patterns: InjectionPattern[];
  private templateStorage: TemplateStorage;
  private encodingPatterns: RegExp[];

  constructor(config?: Partial<InjectionDetectionConfig>, templateStorage?: TemplateStorage) {
    super();
    this.config = {
      enabled: true,
      strictMode: false,
      blockOnDetection: true,
      sensitivityLevel: 'medium',
      customPatterns: [],
      whitelistedPatterns: [],
      maxInputLength: 32000,
      enableContextOverflowDetection: true,
      enableEncodingAttackDetection: true,
      ...config,
    };
    this.patterns = [...DEFAULT_PATTERNS, ...this.config.customPatterns];
    this.templateStorage = templateStorage || new InMemoryTemplateStorage();
    this.encodingPatterns = this.initializeEncodingPatterns();
  }

  /**
   * Initialize encoding attack detection patterns
   */
  private initializeEncodingPatterns(): RegExp[] {
    return [
      // Unicode homoglyphs
      /[\u0430-\u044f\u0410-\u042f]/g, // Cyrillic lookalikes
      /[\u0391-\u03c9]/g, // Greek lookalikes
      // Zero-width characters
      /[\u200b\u200c\u200d\u2060\ufeff]/g,
      // Base64 encoded strings
      /(?:[A-Za-z0-9+\/]{4}){10,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?/g,
      // Hex encoded strings
      /(?:\\x[0-9a-fA-F]{2}){4,}/g,
      // Unicode escapes
      /(?:\\u[0-9a-fA-F]{4}){4,}/g,
      // URL encoding
      /(?:%[0-9a-fA-F]{2}){4,}/g,
      // HTML entities
      /(?:&#x?[0-9a-fA-F]+;){4,}/g,
    ];
  }

  /**
   * Analyze input for injection attempts
   */
  async analyzeInput(input: string): Promise<InjectionDetectionResult> {
    if (!this.config.enabled) {
      return this.createSafeResult(input);
    }

    const detectedPatterns: DetectedPattern[] = [];
    let riskScore = 0;
    const recommendations: string[] = [];

    // Check input length
    if (input.length > this.config.maxInputLength) {
      detectedPatterns.push({
        type: 'context-overflow',
        pattern: 'Input length exceeded',
        location: { start: this.config.maxInputLength, end: input.length },
        severity: 'high',
        description: `Input exceeds maximum length of ${this.config.maxInputLength} characters`,
      });
      riskScore += 30;
    }

    // Check for encoding attacks
    if (this.config.enableEncodingAttackDetection) {
      const encodingResults = this.detectEncodingAttacks(input);
      detectedPatterns.push(...encodingResults);
      riskScore += encodingResults.length * 15;
    }

    // Check for context overflow attempts
    if (this.config.enableContextOverflowDetection) {
      const overflowResult = this.detectContextOverflow(input);
      if (overflowResult) {
        detectedPatterns.push(overflowResult);
        riskScore += 25;
      }
    }

    // Apply injection patterns
    for (const pattern of this.patterns) {
      if (!pattern.enabled) continue;

      const matches = input.matchAll(new RegExp(pattern.pattern, 'gi'));
      for (const match of matches) {
        // Check whitelist
        if (this.isWhitelisted(match[0])) continue;

        const severity = pattern.severity;
        const severityScore = { low: 10, medium: 20, high: 30, critical: 50 }[severity];
        riskScore += severityScore;

        detectedPatterns.push({
          type: pattern.type,
          pattern: pattern.name,
          location: {
            start: match.index || 0,
            end: (match.index || 0) + match[0].length,
          },
          severity,
          description: pattern.description,
        });
      }
    }

    // Adjust risk score based on sensitivity
    const sensitivityMultiplier = {
      low: 0.7,
      medium: 1.0,
      high: 1.3,
    }[this.config.sensitivityLevel];
    riskScore = Math.min(100, Math.round(riskScore * sensitivityMultiplier));

    // Generate recommendations
    if (detectedPatterns.length > 0) {
      recommendations.push(...this.generateRecommendations(detectedPatterns));
    }

    // Determine if this is an injection attempt
    const isInjection = detectedPatterns.some(
      (p) => p.severity === 'high' || p.severity === 'critical'
    ) || (this.config.strictMode && detectedPatterns.length > 0);

    // Sanitize input if needed
    const sanitizedInput = isInjection ? this.sanitizeInput(input, detectedPatterns) : input;

    const result: InjectionDetectionResult = {
      isInjectionAttempt: isInjection,
      confidence: riskScore / 100,
      detectedPatterns,
      sanitizedInput,
      riskScore,
      recommendations,
      blocked: isInjection && this.config.blockOnDetection,
      originalInput: input,
      timestamp: new Date(),
    };

    if (isInjection) {
      this.emit('injection:detected', result);
    }

    return result;
  }

  /**
   * Detect encoding-based attacks
   */
  private detectEncodingAttacks(input: string): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    for (const pattern of this.encodingPatterns) {
      const matches = input.matchAll(pattern);
      for (const match of matches) {
        patterns.push({
          type: 'encoding-attack',
          pattern: 'Suspicious encoding detected',
          location: {
            start: match.index || 0,
            end: (match.index || 0) + match[0].length,
          },
          severity: 'medium',
          description: 'Potential encoding-based obfuscation',
        });
      }
    }

    return patterns;
  }

  /**
   * Detect context overflow attempts
   */
  private detectContextOverflow(input: string): DetectedPattern | null {
    // Check for repetitive patterns that might be used to overflow context
    const repetitionPattern = /(.{20,})\1{5,}/g;
    const match = repetitionPattern.exec(input);
    if (match) {
      return {
        type: 'context-overflow',
        pattern: 'Repetitive content detected',
        location: {
          start: match.index,
          end: match.index + match[0].length,
        },
        severity: 'high',
        description: 'Repeated content may be attempting to overflow context window',
      };
    }

    // Check for excessive newlines
    const newlineCount = (input.match(/\n/g) || []).length;
    if (newlineCount > 500) {
      return {
        type: 'context-overflow',
        pattern: 'Excessive newlines',
        location: { start: 0, end: input.length },
        severity: 'medium',
        description: 'Excessive newlines may be attempting context manipulation',
      };
    }

    return null;
  }

  /**
   * Check if a pattern match is whitelisted
   */
  private isWhitelisted(match: string): boolean {
    return this.config.whitelistedPatterns.some((pattern) => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(match);
    });
  }

  /**
   * Sanitize input by removing or neutralizing detected patterns
   */
  private sanitizeInput(input: string, patterns: DetectedPattern[]): string {
    let sanitized = input;

    // Sort patterns by location (descending) to avoid index shifting
    const sortedPatterns = [...patterns].sort((a, b) => b.location.start - a.location.start);

    for (const pattern of sortedPatterns) {
      const before = sanitized.substring(0, pattern.location.start);
      const after = sanitized.substring(pattern.location.end);
      const replacement = '[REDACTED]';
      sanitized = before + replacement + after;
    }

    // Additional sanitization
    sanitized = this.neutralizeEncodingAttacks(sanitized);

    return sanitized;
  }

  /**
   * Neutralize encoding attacks
   */
  private neutralizeEncodingAttacks(input: string): string {
    let result = input;

    // Remove zero-width characters
    result = result.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '');

    // Normalize unicode (convert lookalikes to ASCII)
    result = result.normalize('NFKC');

    return result;
  }

  /**
   * Generate recommendations based on detected patterns
   */
  private generateRecommendations(patterns: DetectedPattern[]): string[] {
    const recommendations: string[] = [];
    const types = new Set(patterns.map((p) => p.type));

    if (types.has('role-manipulation') || types.has('instruction-override')) {
      recommendations.push('Review user intent and consider additional authentication');
    }
    if (types.has('jailbreak')) {
      recommendations.push('This input contains known jailbreak patterns - block recommended');
    }
    if (types.has('prompt-leaking') || types.has('system-prompt-extraction')) {
      recommendations.push('User may be attempting to extract system prompts - monitor closely');
    }
    if (types.has('encoding-attack')) {
      recommendations.push('Input contains obfuscated content - apply strict validation');
    }
    if (types.has('context-overflow')) {
      recommendations.push('Input may be attempting to overflow context - truncate if needed');
    }

    return recommendations;
  }

  /**
   * Create a safe result for disabled detection
   */
  private createSafeResult(input: string): InjectionDetectionResult {
    return {
      isInjectionAttempt: false,
      confidence: 0,
      detectedPatterns: [],
      sanitizedInput: input,
      riskScore: 0,
      recommendations: [],
      blocked: false,
      originalInput: input,
      timestamp: new Date(),
    };
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: InjectionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove a pattern by ID
   */
  removePattern(patternId: string): boolean {
    const index = this.patterns.findIndex((p) => p.id === patternId);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a pattern
   */
  setPatternEnabled(patternId: string, enabled: boolean): boolean {
    const pattern = this.patterns.find((p) => p.id === patternId);
    if (pattern) {
      pattern.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Get all patterns
   */
  getPatterns(): InjectionPattern[] {
    return [...this.patterns];
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<InjectionDetectionConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.customPatterns) {
      this.patterns = [...DEFAULT_PATTERNS, ...updates.customPatterns];
    }
  }

  /**
   * Create a prompt template
   */
  async createTemplate(template: PromptTemplate): Promise<void> {
    await this.templateStorage.save(template);
  }

  /**
   * Get a prompt template
   */
  async getTemplate(templateId: string): Promise<PromptTemplate | null> {
    return this.templateStorage.get(templateId);
  }

  /**
   * Validate and render a template with variables
   */
  async renderTemplate(
    templateId: string,
    variables: Record<string, unknown>
  ): Promise<{ rendered: string; validationErrors: string[] }> {
    const template = await this.templateStorage.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const validationErrors: string[] = [];

    // Validate and sanitize variables
    for (const varDef of template.variables) {
      const value = variables[varDef.name];

      // Check required
      if (varDef.required && (value === undefined || value === null)) {
        validationErrors.push(`Missing required variable: ${varDef.name}`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Check type
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== varDef.type && varDef.type !== 'object') {
        validationErrors.push(
          `Variable ${varDef.name} has wrong type: expected ${varDef.type}, got ${actualType}`
        );
      }

      // Check max length
      if (varDef.maxLength && typeof value === 'string' && value.length > varDef.maxLength) {
        validationErrors.push(
          `Variable ${varDef.name} exceeds max length: ${value.length} > ${varDef.maxLength}`
        );
      }

      // Check pattern
      if (varDef.pattern && typeof value === 'string') {
        const regex = new RegExp(varDef.pattern);
        if (!regex.test(value)) {
          validationErrors.push(`Variable ${varDef.name} does not match required pattern`);
        }
      }

      // Check allowed values
      if (varDef.allowedValues && !varDef.allowedValues.includes(value)) {
        validationErrors.push(`Variable ${varDef.name} has invalid value`);
      }

      // Sanitize if needed
      if (varDef.sanitize && typeof value === 'string') {
        const analysisResult = await this.analyzeInput(value);
        if (analysisResult.isInjectionAttempt) {
          validationErrors.push(
            `Variable ${varDef.name} contains potentially malicious content`
          );
        }
      }
    }

    // Check constraints
    for (const constraint of template.constraints) {
      const error = this.checkConstraint(template.template, variables, constraint);
      if (error) {
        validationErrors.push(error);
      }
    }

    // Render template
    let rendered = template.template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      rendered = rendered.replace(new RegExp(placeholder, 'g'), stringValue);
    }

    return { rendered, validationErrors };
  }

  /**
   * Check a template constraint
   */
  private checkConstraint(
    template: string,
    variables: Record<string, unknown>,
    constraint: PromptConstraint
  ): string | null {
    switch (constraint.type) {
      case 'max-length': {
        let rendered = template;
        for (const [key, value] of Object.entries(variables)) {
          const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
          rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), stringValue);
        }
        if (rendered.length > (constraint.value as number)) {
          return constraint.errorMessage;
        }
        break;
      }
      case 'required-prefix': {
        if (!template.startsWith(constraint.value as string)) {
          return constraint.errorMessage;
        }
        break;
      }
      case 'forbidden-content': {
        const forbiddenPatterns = constraint.value as string[];
        for (const pattern of forbiddenPatterns) {
          for (const value of Object.values(variables)) {
            if (typeof value === 'string' && value.includes(pattern)) {
              return constraint.errorMessage;
            }
          }
        }
        break;
      }
    }
    return null;
  }

  /**
   * Test input against specific pattern types
   */
  async testForPatternType(input: string, type: InjectionPatternType): Promise<DetectedPattern[]> {
    const result = await this.analyzeInput(input);
    return result.detectedPatterns.filter((p) => p.type === type);
  }

  /**
   * Get detection statistics
   */
  getStatistics(): {
    totalPatterns: number;
    enabledPatterns: number;
    patternsByType: Record<string, number>;
    patternsBySeverity: Record<string, number>;
  } {
    const patternsByType: Record<string, number> = {};
    const patternsBySeverity: Record<string, number> = {};

    for (const pattern of this.patterns) {
      patternsByType[pattern.type] = (patternsByType[pattern.type] || 0) + 1;
      patternsBySeverity[pattern.severity] = (patternsBySeverity[pattern.severity] || 0) + 1;
    }

    return {
      totalPatterns: this.patterns.length,
      enabledPatterns: this.patterns.filter((p) => p.enabled).length,
      patternsByType,
      patternsBySeverity,
    };
  }
}

export default PromptInjectionDetector;
