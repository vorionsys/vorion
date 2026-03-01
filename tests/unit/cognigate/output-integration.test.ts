/**
 * Cognigate Output Integration Tests
 *
 * Tests for the OutputIntegrator class and factory functions that integrate
 * with semantic-governance OutputValidator for output validation with
 * strict/permissive modes and PII handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock logger before imports
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock semantic-governance output-validator
vi.mock('../../../src/semantic-governance/output-validator.js', () => {
  const mockValidateOutput = vi.fn();
  const mockSanitizeOutput = vi.fn();
  const mockValidateAllUrls = vi.fn();
  const mockScanForProhibitedPatterns = vi.fn();

  return {
    // Use regular function (not arrow) so it can be called with `new`
    OutputValidator: vi.fn().mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: mockSanitizeOutput,
        validateAllUrls: mockValidateAllUrls,
        scanForProhibitedPatterns: mockScanForProhibitedPatterns,
      };
    }),
    OutputValidationError: class OutputValidationError extends Error {
      code = 'OUTPUT_VALIDATION_ERROR';
      statusCode = 403;
      details?: Record<string, unknown>;
      constructor(message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'OutputValidationError';
        this.details = details;
      }
    },
    createDefaultOutputValidator: vi.fn().mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: mockSanitizeOutput,
        validateAllUrls: mockValidateAllUrls,
        scanForProhibitedPatterns: mockScanForProhibitedPatterns,
      };
    }),
    BUILT_IN_PROHIBITED_PATTERNS: [],
  };
});

import {
  OutputIntegrator,
  createOutputIntegrator,
  createStrictOutputIntegrator,
  createPermissiveOutputIntegrator,
  type CognigateOutputValidationResult,
} from '../../../src/cognigate/output-integration.js';
import {
  OutputValidator,
  OutputValidationError,
  createDefaultOutputValidator,
} from '../../../src/semantic-governance/output-validator.js';
import type {
  OutputBinding,
  OutputValidationResult,
  PatternScanResult,
  SanitizedOutput,
} from '../../../src/semantic-governance/types.js';
import type { OutputValidationOptions } from '../../../src/cognigate/types.js';

describe('OutputIntegrator', () => {
  let mockValidator: {
    validateOutput: Mock;
    sanitizeOutput: Mock;
    validateAllUrls: Mock;
    scanForProhibitedPatterns: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Get mock validator instance
    mockValidator = {
      validateOutput: vi.fn(),
      sanitizeOutput: vi.fn(),
      validateAllUrls: vi.fn(),
      scanForProhibitedPatterns: vi.fn(),
    };

    // Setup default mock implementations
    // Use regular function (not arrow) so it can be called with `new`
    (OutputValidator as Mock).mockImplementation(function() { return mockValidator; });
    (createDefaultOutputValidator as Mock).mockImplementation(function() { return mockValidator; });

    // Default: validation passes, no patterns detected
    mockValidator.validateOutput.mockReturnValue({
      valid: true,
      patternScan: { detected: false, patterns: [] },
    } as OutputValidationResult);

    mockValidator.sanitizeOutput.mockReturnValue({
      content: 'sanitized content',
      modified: false,
      redactions: [],
    } as SanitizedOutput);

    mockValidator.validateAllUrls.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with strict mode', () => {
      const options: OutputValidationOptions = {
        mode: 'strict',
        sanitizePII: true,
      };

      const integrator = new OutputIntegrator(options);

      expect(createDefaultOutputValidator).toHaveBeenCalled();
    });

    it('should initialize with permissive mode', () => {
      const options: OutputValidationOptions = {
        mode: 'permissive',
        sanitizePII: false,
      };

      const integrator = new OutputIntegrator(options);

      expect(createDefaultOutputValidator).toHaveBeenCalled();
    });

    it('should use custom binding when provided', () => {
      const options: OutputValidationOptions = {
        mode: 'strict',
        sanitizePII: true,
      };

      const binding: OutputBinding = {
        allowedSchemas: [],
        prohibitedPatterns: [
          { type: 'regex', pattern: 'test', description: 'Test pattern' },
        ],
        allowedExternalEndpoints: ['https://api.example.com/*'],
        blockedExternalEndpoints: [],
      };

      const integrator = new OutputIntegrator(options, binding);

      expect(OutputValidator).toHaveBeenCalledWith(expect.objectContaining({
        prohibitedPatterns: expect.arrayContaining([
          { type: 'regex', pattern: 'test', description: 'Test pattern' },
        ]),
      }));
    });

    it('should merge custom prohibited patterns with binding', () => {
      const options: OutputValidationOptions = {
        mode: 'strict',
        sanitizePII: true,
        prohibitedPatterns: [
          { type: 'keyword', pattern: 'secret', description: 'Secret keyword' },
        ],
      };

      const binding: OutputBinding = {
        allowedSchemas: [],
        prohibitedPatterns: [
          { type: 'regex', pattern: 'password', description: 'Password pattern' },
        ],
        allowedExternalEndpoints: [],
        blockedExternalEndpoints: [],
      };

      const integrator = new OutputIntegrator(options, binding);

      expect(OutputValidator).toHaveBeenCalledWith(expect.objectContaining({
        prohibitedPatterns: expect.arrayContaining([
          { type: 'regex', pattern: 'password', description: 'Password pattern' },
          { type: 'keyword', pattern: 'secret', description: 'Secret keyword' },
        ]),
      }));
    });
  });

  describe('validateOutput', () => {
    describe('strict mode', () => {
      let integrator: OutputIntegrator;

      beforeEach(() => {
        integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });
      });

      it('should return valid result for clean output', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: { detected: false, patterns: [] },
        });

        const result = integrator.validateOutput({ message: 'Hello, world!' });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(false);
        expect(result.piiDetected).toBe(false);
        expect(result.mode).toBe('strict');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });

      it('should return invalid result for prohibited patterns', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Credit card numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: '\\b\\d{16}\\b',
                description: 'Credit card numbers',
                matches: ['4111111111111111'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        const result = integrator.validateOutput({ card: '4111111111111111' });

        expect(result.valid).toBe(false);
        expect(result.details.reason).toContain('Credit card numbers');
        expect(result.mode).toBe('strict');
      });

      it('should detect PII patterns', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Email addresses',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        const result = integrator.validateOutput({ email: 'user@example.com' });

        expect(result.valid).toBe(false);
        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Email addresses');
      });

      it('should detect phone number PII', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Phone numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'phone-regex',
                description: 'Phone numbers',
                matches: ['555-123-4567'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        const result = integrator.validateOutput({ phone: '555-123-4567' });

        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Phone numbers');
      });

      it('should detect SSN PII', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Social Security Numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'ssn-regex',
                description: 'Social Security Numbers (SSN)',
                matches: ['123-45-6789'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        const result = integrator.validateOutput({ ssn: '123-45-6789' });

        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Social Security Numbers (SSN)');
      });

      it('should detect credit card PII', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Credit card numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'cc-regex',
                description: 'Credit card numbers',
                matches: ['4111111111111111'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        const result = integrator.validateOutput({ cc: '4111111111111111' });

        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Credit card numbers');
      });

      it('should detect IP address as PII', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'ip-regex',
                description: 'IP address detected',
                matches: ['192.168.1.1'],
                severity: 'low',
              },
            ],
            severity: 'low',
          },
        });

        const result = integrator.validateOutput({ ip: '192.168.1.1' });

        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('IP address detected');
      });

      it('should not flag non-PII patterns as PII', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: API keys',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'api-key-regex',
                description: 'API keys',
                matches: ['sk_test_abcdefg'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        const result = integrator.validateOutput({ apiKey: 'sk_test_abcdefg' });

        // API keys should not be flagged as PII
        expect(result.piiDetected).toBe(false);
        expect(result.piiTypes).toHaveLength(0);
      });
    });

    describe('permissive mode', () => {
      let integrator: OutputIntegrator;

      beforeEach(() => {
        integrator = new OutputIntegrator({ mode: 'permissive', sanitizePII: false });
      });

      it('should return valid even when validation fails (logged only)', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Credit card numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'cc-regex',
                description: 'Credit card numbers',
                matches: ['4111111111111111'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        const result = integrator.validateOutput({ card: '4111111111111111' });

        // In permissive mode, valid should be true even when validation fails
        expect(result.valid).toBe(true);
        expect(result.mode).toBe('permissive');
        // The original validation details should still be available
        expect(result.details.valid).toBe(false);
      });

      it('should still detect PII in permissive mode', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Email addresses',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        const result = integrator.validateOutput({ email: 'user@example.com' });

        expect(result.valid).toBe(true); // Permissive mode
        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Email addresses');
      });

      it('should pass through clean output', () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: { detected: false, patterns: [] },
        });

        const result = integrator.validateOutput({ message: 'Hello!' });

        expect(result.valid).toBe(true);
        expect(result.mode).toBe('permissive');
      });
    });

    describe('PII sanitization', () => {
      it('should sanitize PII when enabled and PII detected', () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        mockValidator.sanitizeOutput.mockReturnValue({
          content: { email: '[REDACTED]' },
          modified: true,
          redactions: [
            { type: 'regex', description: 'Email addresses', count: 1 },
          ],
        });

        const result = integrator.validateOutput({ email: 'user@example.com' });

        expect(result.modified).toBe(true);
        expect(result.sanitizedOutput).toEqual({ email: '[REDACTED]' });
        expect(mockValidator.sanitizeOutput).toHaveBeenCalled();
      });

      it('should not sanitize when PII is not detected', () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: { detected: false, patterns: [] },
        });

        const result = integrator.validateOutput({ message: 'Hello!' });

        expect(result.modified).toBe(false);
        expect(result.sanitizedOutput).toBeUndefined();
        expect(mockValidator.sanitizeOutput).not.toHaveBeenCalled();
      });

      it('should not sanitize when sanitizePII is disabled', () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        const result = integrator.validateOutput({ email: 'user@example.com' });

        expect(result.modified).toBe(false);
        expect(result.sanitizedOutput).toBeUndefined();
        expect(mockValidator.sanitizeOutput).not.toHaveBeenCalled();
      });

      it('should handle sanitization that does not modify content', () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'name-regex',
                description: 'Personal name detected',
                matches: ['John'],
                severity: 'low',
              },
            ],
            severity: 'low',
          },
        });

        mockValidator.sanitizeOutput.mockReturnValue({
          content: { name: 'John' },
          modified: false, // Not modified
          redactions: [],
        });

        const result = integrator.validateOutput({ name: 'John' });

        expect(result.modified).toBe(false);
        expect(result.piiDetected).toBe(true);
        expect(result.piiTypes).toContain('Personal name detected');
      });
    });

    describe('duration tracking', () => {
      it('should track validation duration', () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: { detected: false, patterns: [] },
        });

        const result = integrator.validateOutput({ data: 'test' });

        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('processOutput', () => {
    describe('strict mode', () => {
      let integrator: OutputIntegrator;

      beforeEach(() => {
        integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });
      });

      it('should return output and validation for valid output', async () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: { detected: false, patterns: [] },
        });

        const result = await integrator.processOutput({ message: 'Hello!' });

        expect(result.output).toEqual({ message: 'Hello!' });
        expect(result.validation.valid).toBe(true);
      });

      it('should throw OutputValidationError for invalid output in strict mode', async () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Credit card numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'cc-regex',
                description: 'Credit card numbers',
                matches: ['4111111111111111'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        await expect(integrator.processOutput({ card: '4111111111111111' }))
          .rejects.toThrow(OutputValidationError);
      });

      it('should include PII info in error details', async () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Email addresses',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        try {
          await integrator.processOutput({ email: 'user@example.com' });
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(OutputValidationError);
          const validationError = error as InstanceType<typeof OutputValidationError>;
          expect(validationError.details?.piiDetected).toBe(true);
          expect(validationError.details?.piiTypes).toContain('Email addresses');
        }
      });

      it('should return sanitized output when modified', async () => {
        const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

        mockValidator.validateOutput.mockReturnValue({
          valid: true,
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'email-regex',
                description: 'Email addresses',
                matches: ['user@example.com'],
                severity: 'medium',
              },
            ],
            severity: 'medium',
          },
        });

        mockValidator.sanitizeOutput.mockReturnValue({
          content: { email: '[REDACTED]' },
          modified: true,
          redactions: [
            { type: 'regex', description: 'Email addresses', count: 1 },
          ],
        });

        const result = await integrator.processOutput({ email: 'user@example.com' });

        expect(result.output).toEqual({ email: '[REDACTED]' });
        expect(result.validation.modified).toBe(true);
      });
    });

    describe('permissive mode', () => {
      let integrator: OutputIntegrator;

      beforeEach(() => {
        integrator = new OutputIntegrator({ mode: 'permissive', sanitizePII: false });
      });

      it('should not throw for invalid output in permissive mode', async () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Prohibited patterns detected: Credit card numbers',
          patternScan: {
            detected: true,
            patterns: [
              {
                type: 'regex',
                pattern: 'cc-regex',
                description: 'Credit card numbers',
                matches: ['4111111111111111'],
                severity: 'critical',
              },
            ],
            severity: 'critical',
          },
        });

        // Should not throw - permissive mode
        const result = await integrator.processOutput({ card: '4111111111111111' });

        expect(result.output).toEqual({ card: '4111111111111111' });
        expect(result.validation.valid).toBe(true); // Permissive mode marks as valid
      });

      it('should return original output in permissive mode', async () => {
        mockValidator.validateOutput.mockReturnValue({
          valid: false,
          reason: 'Some validation issue',
          patternScan: { detected: false, patterns: [] },
        });

        const result = await integrator.processOutput({ data: 'test' });

        expect(result.output).toEqual({ data: 'test' });
      });
    });
  });

  describe('validateUrls', () => {
    let integrator: OutputIntegrator;

    beforeEach(() => {
      integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });
    });

    it('should return valid when no invalid URLs found', () => {
      mockValidator.validateAllUrls.mockReturnValue([]);

      const result = integrator.validateUrls('Check out https://api.example.com/data');

      expect(result.valid).toBe(true);
      expect(result.invalidUrls).toHaveLength(0);
    });

    it('should return invalid URLs when found', () => {
      mockValidator.validateAllUrls.mockReturnValue([
        'https://malicious.com/attack',
        'http://blocked.site.com',
      ]);

      const result = integrator.validateUrls('Visit https://malicious.com/attack or http://blocked.site.com');

      expect(result.valid).toBe(false);
      expect(result.invalidUrls).toContain('https://malicious.com/attack');
      expect(result.invalidUrls).toContain('http://blocked.site.com');
    });

    it('should handle object output by stringifying', () => {
      mockValidator.validateAllUrls.mockReturnValue(['https://evil.com']);

      const result = integrator.validateUrls({
        message: 'Visit https://evil.com for more info',
      });

      expect(result.valid).toBe(false);
      expect(result.invalidUrls).toContain('https://evil.com');
      expect(mockValidator.validateAllUrls).toHaveBeenCalledWith(
        expect.stringContaining('https://evil.com')
      );
    });

    it('should handle string output directly', () => {
      mockValidator.validateAllUrls.mockReturnValue([]);

      const result = integrator.validateUrls('https://allowed.com/page');

      expect(result.valid).toBe(true);
      expect(mockValidator.validateAllUrls).toHaveBeenCalledWith('https://allowed.com/page');
    });

    it('should handle empty output', () => {
      mockValidator.validateAllUrls.mockReturnValue([]);

      const result = integrator.validateUrls('');

      expect(result.valid).toBe(true);
      expect(result.invalidUrls).toHaveLength(0);
    });
  });
});

describe('createOutputIntegrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create an OutputIntegrator with provided options', () => {
    const options: OutputValidationOptions = {
      mode: 'strict',
      sanitizePII: true,
    };

    const integrator = createOutputIntegrator(options);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });

  it('should pass binding to OutputIntegrator', () => {
    const options: OutputValidationOptions = {
      mode: 'permissive',
      sanitizePII: false,
    };

    const binding: OutputBinding = {
      allowedSchemas: [],
      prohibitedPatterns: [],
      allowedExternalEndpoints: ['https://api.example.com/*'],
      blockedExternalEndpoints: [],
    };

    const integrator = createOutputIntegrator(options, binding);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
    expect(OutputValidator).toHaveBeenCalledWith(expect.objectContaining({
      allowedExternalEndpoints: ['https://api.example.com/*'],
    }));
  });

  it('should support custom prohibited patterns in options', () => {
    const options: OutputValidationOptions = {
      mode: 'strict',
      sanitizePII: true,
      prohibitedPatterns: [
        { type: 'keyword', pattern: 'confidential', description: 'Confidential keyword' },
      ],
    };

    const integrator = createOutputIntegrator(options);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });
});

describe('createStrictOutputIntegrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup default mock for this describe block
    const mockValidator = {
      validateOutput: vi.fn().mockReturnValue({
        valid: true,
        patternScan: { detected: false, patterns: [] },
      }),
      sanitizeOutput: vi.fn().mockReturnValue({ content: '', modified: false, redactions: [] }),
      validateAllUrls: vi.fn().mockReturnValue([]),
    };

    (OutputValidator as Mock).mockImplementation(function() { return mockValidator; });
    (createDefaultOutputValidator as Mock).mockImplementation(function() { return mockValidator; });
  });

  it('should create a strict mode integrator with PII sanitization by default', () => {
    const integrator = createStrictOutputIntegrator();

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });

  it('should create a strict mode integrator with custom PII setting', () => {
    const integrator = createStrictOutputIntegrator(false);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });

  it('should accept custom binding', () => {
    const binding: OutputBinding = {
      allowedSchemas: [],
      prohibitedPatterns: [
        { type: 'regex', pattern: 'custom', description: 'Custom pattern' },
      ],
      allowedExternalEndpoints: [],
      blockedExternalEndpoints: ['*'],
    };

    const integrator = createStrictOutputIntegrator(true, binding);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
    expect(OutputValidator).toHaveBeenCalledWith(expect.objectContaining({
      prohibitedPatterns: expect.arrayContaining([
        { type: 'regex', pattern: 'custom', description: 'Custom pattern' },
      ]),
    }));
  });

  it('should reject invalid output in strict mode', async () => {
    const mockValidateOutput = vi.fn().mockReturnValue({
      valid: false,
      reason: 'Test failure',
      patternScan: { detected: false, patterns: [] },
    });

    (OutputValidator as Mock).mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn(),
        validateAllUrls: vi.fn(),
      };
    });
    (createDefaultOutputValidator as Mock).mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn(),
        validateAllUrls: vi.fn(),
      };
    });

    const integrator = createStrictOutputIntegrator();

    await expect(integrator.processOutput({ data: 'test' }))
      .rejects.toThrow(OutputValidationError);
  });
});

describe('createPermissiveOutputIntegrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup default mock for this describe block
    const mockValidator = {
      validateOutput: vi.fn().mockReturnValue({
        valid: true,
        patternScan: { detected: false, patterns: [] },
      }),
      sanitizeOutput: vi.fn().mockReturnValue({ content: '', modified: false, redactions: [] }),
      validateAllUrls: vi.fn().mockReturnValue([]),
    };

    (OutputValidator as Mock).mockImplementation(function() { return mockValidator; });
    (createDefaultOutputValidator as Mock).mockImplementation(function() { return mockValidator; });
  });

  it('should create a permissive mode integrator with PII sanitization by default', () => {
    const integrator = createPermissiveOutputIntegrator();

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });

  it('should create a permissive mode integrator with custom PII setting', () => {
    const integrator = createPermissiveOutputIntegrator(false);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
  });

  it('should accept custom binding', () => {
    const binding: OutputBinding = {
      allowedSchemas: [],
      prohibitedPatterns: [],
      allowedExternalEndpoints: ['https://allowed.com/*'],
      blockedExternalEndpoints: [],
    };

    const integrator = createPermissiveOutputIntegrator(true, binding);

    expect(integrator).toBeInstanceOf(OutputIntegrator);
    expect(OutputValidator).toHaveBeenCalledWith(expect.objectContaining({
      allowedExternalEndpoints: ['https://allowed.com/*'],
    }));
  });

  it('should not reject invalid output in permissive mode', async () => {
    const mockValidateOutput = vi.fn().mockReturnValue({
      valid: false,
      reason: 'Test failure',
      patternScan: { detected: false, patterns: [] },
    });

    (OutputValidator as Mock).mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn(),
        validateAllUrls: vi.fn(),
      };
    });
    (createDefaultOutputValidator as Mock).mockImplementation(function() {
      return {
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn(),
        validateAllUrls: vi.fn(),
      };
    });

    const integrator = createPermissiveOutputIntegrator();

    // Should not throw - permissive mode
    const result = await integrator.processOutput({ data: 'test' });
    expect(result.validation.valid).toBe(true);
  });
});

describe('PII detection patterns', () => {
  const piiTestCases = [
    { description: 'email', keyword: 'email', expectPII: true },
    { description: 'Email addresses', keyword: 'Email addresses', expectPII: true },
    { description: 'phone', keyword: 'phone', expectPII: true },
    { description: 'Phone numbers', keyword: 'Phone numbers', expectPII: true },
    { description: 'ssn', keyword: 'ssn', expectPII: true },
    { description: 'Social Security Numbers', keyword: 'Social Security Numbers', expectPII: true },
    { description: 'credit card', keyword: 'credit card', expectPII: true },
    { description: 'Credit card numbers', keyword: 'Credit card numbers', expectPII: true },
    { description: 'address', keyword: 'address', expectPII: true },
    { description: 'Home address', keyword: 'Home address', expectPII: true },
    { description: 'personal', keyword: 'personal', expectPII: true },
    { description: 'Personal data', keyword: 'Personal data', expectPII: true },
    { description: 'pii', keyword: 'pii', expectPII: true },
    { description: 'PII detected', keyword: 'PII detected', expectPII: true },
    { description: 'name', keyword: 'name', expectPII: true },
    { description: 'Full name', keyword: 'Full name', expectPII: true },
    { description: 'ip address', keyword: 'ip address', expectPII: true },
    { description: 'IP Address detected', keyword: 'IP Address detected', expectPII: true },
    { description: 'API keys', keyword: 'API keys', expectPII: false },
    { description: 'JWT tokens', keyword: 'JWT tokens', expectPII: false },
    { description: 'AWS Access Key', keyword: 'AWS Access Key', expectPII: false },
    { description: 'Private keys', keyword: 'Private keys', expectPII: false },
  ];

  it.each(piiTestCases)(
    'should $expectPII ? detect : not flag "$keyword" as PII',
    ({ keyword, expectPII }) => {
      vi.clearAllMocks();

      const mockValidateOutput = vi.fn().mockReturnValue({
        valid: false,
        reason: `Prohibited patterns detected: ${keyword}`,
        patternScan: {
          detected: true,
          patterns: [
            {
              type: 'regex',
              pattern: 'test-pattern',
              description: keyword,
              matches: ['test-match'],
              severity: 'medium',
            },
          ],
          severity: 'medium',
        },
      });

      (OutputValidator as Mock).mockImplementation(() => ({
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn().mockReturnValue({ content: '', modified: false, redactions: [] }),
        validateAllUrls: vi.fn().mockReturnValue([]),
      }));
      (createDefaultOutputValidator as Mock).mockImplementation(() => ({
        validateOutput: mockValidateOutput,
        sanitizeOutput: vi.fn().mockReturnValue({ content: '', modified: false, redactions: [] }),
        validateAllUrls: vi.fn().mockReturnValue([]),
      }));

      const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });
      const result = integrator.validateOutput({ data: 'test' });

      expect(result.piiDetected).toBe(expectPII);
      if (expectPII) {
        expect(result.piiTypes).toContain(keyword);
      } else {
        expect(result.piiTypes).not.toContain(keyword);
      }
    }
  );
});

describe('Edge cases', () => {
  let integrator: OutputIntegrator;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockValidator = {
      validateOutput: vi.fn().mockReturnValue({
        valid: true,
        patternScan: { detected: false, patterns: [] },
      }),
      sanitizeOutput: vi.fn().mockReturnValue({ content: '', modified: false, redactions: [] }),
      validateAllUrls: vi.fn().mockReturnValue([]),
    };

    (OutputValidator as Mock).mockImplementation(() => mockValidator);
    (createDefaultOutputValidator as Mock).mockImplementation(() => mockValidator);

    integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });
  });

  it('should handle null output', () => {
    const result = integrator.validateOutput(null);

    expect(result.originalOutput).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('should handle undefined output', () => {
    const result = integrator.validateOutput(undefined);

    expect(result.originalOutput).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it('should handle array output', () => {
    const result = integrator.validateOutput(['item1', 'item2', 'item3']);

    expect(result.originalOutput).toEqual(['item1', 'item2', 'item3']);
    expect(result.valid).toBe(true);
  });

  it('should handle deeply nested objects', () => {
    const deepObject = {
      level1: {
        level2: {
          level3: {
            data: 'deep value',
          },
        },
      },
    };

    const result = integrator.validateOutput(deepObject);

    expect(result.originalOutput).toEqual(deepObject);
    expect(result.valid).toBe(true);
  });

  it('should handle empty string output', () => {
    const result = integrator.validateOutput('');

    expect(result.originalOutput).toBe('');
    expect(result.valid).toBe(true);
  });

  it('should handle number output', () => {
    const result = integrator.validateOutput(42);

    expect(result.originalOutput).toBe(42);
    expect(result.valid).toBe(true);
  });

  it('should handle boolean output', () => {
    const result = integrator.validateOutput(true);

    expect(result.originalOutput).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('should handle output with no patternScan', () => {
    const mockValidator = {
      validateOutput: vi.fn().mockReturnValue({
        valid: true,
        // No patternScan field
      }),
      sanitizeOutput: vi.fn(),
      validateAllUrls: vi.fn(),
    };

    (createDefaultOutputValidator as Mock).mockReturnValue(mockValidator);

    const newIntegrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });

    const result = newIntegrator.validateOutput({ data: 'test' });

    expect(result.piiDetected).toBe(false);
    expect(result.piiTypes).toHaveLength(0);
  });

  it('should handle patternScan with detected false', () => {
    const mockValidator = {
      validateOutput: vi.fn().mockReturnValue({
        valid: true,
        patternScan: {
          detected: false,
          patterns: [],
        },
      }),
      sanitizeOutput: vi.fn(),
      validateAllUrls: vi.fn(),
    };

    (createDefaultOutputValidator as Mock).mockReturnValue(mockValidator);

    const newIntegrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

    const result = newIntegrator.validateOutput({ data: 'test' });

    expect(result.piiDetected).toBe(false);
    expect(result.modified).toBe(false);
    // sanitizeOutput should not be called when no patterns detected
    expect(mockValidator.sanitizeOutput).not.toHaveBeenCalled();
  });
});

describe('Multiple PII types detection', () => {
  it('should detect multiple PII types in single output', () => {
    vi.clearAllMocks();

    const mockValidateOutput = vi.fn().mockReturnValue({
      valid: false,
      reason: 'Prohibited patterns detected: Email addresses, Phone numbers',
      patternScan: {
        detected: true,
        patterns: [
          {
            type: 'regex',
            pattern: 'email-regex',
            description: 'Email addresses',
            matches: ['user@example.com'],
            severity: 'medium',
          },
          {
            type: 'regex',
            pattern: 'phone-regex',
            description: 'Phone numbers',
            matches: ['555-123-4567'],
            severity: 'medium',
          },
        ],
        severity: 'medium',
      },
    });

    const mockValidator = {
      validateOutput: mockValidateOutput,
      sanitizeOutput: vi.fn().mockReturnValue({
        content: { email: '[REDACTED]', phone: '[REDACTED]' },
        modified: true,
        redactions: [
          { type: 'regex', description: 'Email addresses', count: 1 },
          { type: 'regex', description: 'Phone numbers', count: 1 },
        ],
      }),
      validateAllUrls: vi.fn().mockReturnValue([]),
    };

    (OutputValidator as Mock).mockImplementation(() => mockValidator);
    (createDefaultOutputValidator as Mock).mockImplementation(() => mockValidator);

    const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: false });

    const result = integrator.validateOutput({
      email: 'user@example.com',
      phone: '555-123-4567',
    });

    expect(result.piiDetected).toBe(true);
    expect(result.piiTypes).toContain('Email addresses');
    expect(result.piiTypes).toContain('Phone numbers');
    expect(result.piiTypes).toHaveLength(2);
  });

  it('should sanitize multiple PII types when enabled', () => {
    vi.clearAllMocks();

    const mockValidateOutput = vi.fn().mockReturnValue({
      valid: true,
      patternScan: {
        detected: true,
        patterns: [
          {
            type: 'regex',
            pattern: 'email-regex',
            description: 'Email addresses',
            matches: ['user@example.com'],
            severity: 'medium',
          },
          {
            type: 'regex',
            pattern: 'phone-regex',
            description: 'Phone numbers',
            matches: ['555-123-4567'],
            severity: 'medium',
          },
        ],
        severity: 'medium',
      },
    });

    const mockValidator = {
      validateOutput: mockValidateOutput,
      sanitizeOutput: vi.fn().mockReturnValue({
        content: { email: '[REDACTED]', phone: '[REDACTED]' },
        modified: true,
        redactions: [
          { type: 'regex', description: 'Email addresses', count: 1 },
          { type: 'regex', description: 'Phone numbers', count: 1 },
        ],
      }),
      validateAllUrls: vi.fn().mockReturnValue([]),
    };

    (OutputValidator as Mock).mockImplementation(() => mockValidator);
    (createDefaultOutputValidator as Mock).mockImplementation(() => mockValidator);

    const integrator = new OutputIntegrator({ mode: 'strict', sanitizePII: true });

    const result = integrator.validateOutput({
      email: 'user@example.com',
      phone: '555-123-4567',
    });

    expect(result.modified).toBe(true);
    expect(result.sanitizedOutput).toEqual({
      email: '[REDACTED]',
      phone: '[REDACTED]',
    });
  });
});
