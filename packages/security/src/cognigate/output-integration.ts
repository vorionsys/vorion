/**
 * Cognigate Output Integration
 *
 * Integrates with OutputValidator from semantic-governance for
 * output validation with strict/permissive modes and PII handling.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/output-integration
 */

import { createLogger } from '../common/logger.js';
import {
  OutputValidator,
  OutputValidationError,
  createDefaultOutputValidator,
} from '../semantic-governance/output-validator.js';
import type {
  OutputBinding,
  OutputValidationResult,
  ProhibitedPattern,
  SanitizedOutput,
} from '../semantic-governance/types.js';
import type { OutputValidationOptions, OutputValidationMode } from './types.js';

const logger = createLogger({ component: 'cognigate-output-integration' });

/**
 * Output validation result with additional metadata
 */
export interface CognigateOutputValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Original output */
  originalOutput: unknown;
  /** Sanitized output (if sanitizePII is enabled) */
  sanitizedOutput?: unknown;
  /** Whether output was modified */
  modified: boolean;
  /** Validation details */
  details: OutputValidationResult;
  /** PII detection results */
  piiDetected: boolean;
  /** Detected PII types */
  piiTypes: string[];
  /** Validation mode used */
  mode: OutputValidationMode;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Output integrator for Cognigate execution gateway.
 *
 * Features:
 * - Integrates with semantic-governance OutputValidator
 * - Supports strict (reject) and permissive (log only) modes
 * - PII detection and optional sanitization
 * - Custom prohibited patterns
 */
export class OutputIntegrator {
  private readonly validator: OutputValidator;
  private readonly mode: OutputValidationMode;
  private readonly sanitizePII: boolean;

  constructor(options: OutputValidationOptions, binding?: OutputBinding) {
    this.mode = options.mode;
    this.sanitizePII = options.sanitizePII;

    // Create validator with custom binding or default
    if (binding) {
      // Merge custom prohibited patterns if provided
      const mergedBinding: OutputBinding = {
        ...binding,
        prohibitedPatterns: [
          ...binding.prohibitedPatterns,
          ...(options.prohibitedPatterns ?? []),
        ],
      };
      this.validator = new OutputValidator(mergedBinding);
    } else {
      this.validator = createDefaultOutputValidator(options.prohibitedPatterns);
    }

    logger.debug(
      { mode: this.mode, sanitizePII: this.sanitizePII },
      'Output integrator initialized'
    );
  }

  /**
   * Validate and optionally sanitize execution output
   */
  validateOutput(output: unknown): CognigateOutputValidationResult {
    const startTime = Date.now();

    // Run validation
    const validationResult = this.validator.validateOutput(output);

    // Check for PII
    const piiTypes: string[] = [];
    if (validationResult.patternScan?.detected) {
      for (const pattern of validationResult.patternScan.patterns) {
        // Identify PII-related patterns
        if (this.isPIIPattern(pattern.description)) {
          piiTypes.push(pattern.description);
        }
      }
    }

    const piiDetected = piiTypes.length > 0;

    // Handle sanitization if needed
    let sanitizedOutput: unknown = undefined;
    let modified = false;

    if (this.sanitizePII && piiDetected) {
      const sanitizeResult = this.validator.sanitizeOutput(output);
      sanitizedOutput = sanitizeResult.content;
      modified = sanitizeResult.modified;

      if (modified) {
        logger.info(
          {
            redactions: sanitizeResult.redactions.length,
            piiTypes,
          },
          'Output sanitized for PII'
        );
      }
    }

    const durationMs = Date.now() - startTime;

    // Build result
    const result: CognigateOutputValidationResult = {
      valid: validationResult.valid,
      originalOutput: output,
      sanitizedOutput,
      modified,
      details: validationResult,
      piiDetected,
      piiTypes,
      mode: this.mode,
      durationMs,
    };

    // Handle based on mode
    if (!validationResult.valid) {
      if (this.mode === 'strict') {
        logger.warn(
          { reason: validationResult.reason, durationMs },
          'Output validation failed (strict mode)'
        );
      } else {
        // Permissive mode - log but don't reject
        logger.warn(
          { reason: validationResult.reason, durationMs },
          'Output validation failed (permissive mode - logged only)'
        );
        // In permissive mode, we still allow the output
        result.valid = true;
      }
    } else {
      logger.debug({ durationMs }, 'Output validation passed');
    }

    return result;
  }

  /**
   * Validate and transform output for return.
   * In strict mode, throws on validation failure.
   * In permissive mode, returns original output with logged warning.
   */
  async processOutput(output: unknown): Promise<{
    output: unknown;
    validation: CognigateOutputValidationResult;
  }> {
    const validation = this.validateOutput(output);

    if (!validation.valid && this.mode === 'strict') {
      throw new OutputValidationError(
        validation.details.reason ?? 'Output validation failed',
        {
          piiDetected: validation.piiDetected,
          piiTypes: validation.piiTypes,
        }
      );
    }

    // Return sanitized output if available and modified, otherwise original
    const finalOutput = validation.modified && validation.sanitizedOutput !== undefined
      ? validation.sanitizedOutput
      : output;

    return {
      output: finalOutput,
      validation,
    };
  }

  /**
   * Check if a pattern description indicates PII
   */
  private isPIIPattern(description: string): boolean {
    const piiIndicators = [
      'email',
      'phone',
      'ssn',
      'social security',
      'credit card',
      'address',
      'name',
      'ip address',
      'personal',
      'pii',
    ];

    const lowerDesc = description.toLowerCase();
    return piiIndicators.some((indicator) => lowerDesc.includes(indicator));
  }

  /**
   * Validate URLs in output against allowed/blocked endpoints
   */
  validateUrls(output: unknown): {
    valid: boolean;
    invalidUrls: string[];
  } {
    const content = typeof output === 'string'
      ? output
      : JSON.stringify(output);

    const invalidUrls = this.validator.validateAllUrls(content);

    if (invalidUrls.length > 0) {
      logger.warn(
        { invalidUrls },
        'Output contains disallowed external URLs'
      );
    }

    return {
      valid: invalidUrls.length === 0,
      invalidUrls,
    };
  }
}

/**
 * Create an output integrator with default settings
 */
export function createOutputIntegrator(
  options: OutputValidationOptions,
  binding?: OutputBinding
): OutputIntegrator {
  return new OutputIntegrator(options, binding);
}

/**
 * Create a strict output integrator that rejects invalid output
 */
export function createStrictOutputIntegrator(
  sanitizePII: boolean = true,
  binding?: OutputBinding
): OutputIntegrator {
  return new OutputIntegrator(
    { mode: 'strict', sanitizePII },
    binding
  );
}

/**
 * Create a permissive output integrator that logs but allows invalid output
 */
export function createPermissiveOutputIntegrator(
  sanitizePII: boolean = true,
  binding?: OutputBinding
): OutputIntegrator {
  return new OutputIntegrator(
    { mode: 'permissive', sanitizePII },
    binding
  );
}
