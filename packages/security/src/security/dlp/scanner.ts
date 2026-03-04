/**
 * Data Loss Prevention (DLP) Content Scanner
 *
 * Comprehensive sensitive data detection and protection:
 * - Credit card numbers (Visa, Mastercard, Amex, Discover)
 * - Social Security Numbers (US SSN)
 * - API keys (AWS, GCP, Azure, Stripe, GitHub)
 * - Private keys (RSA, EC, PGP)
 * - Passwords in URLs/JSON
 * - Email addresses (PII)
 * - Phone numbers (US, international)
 * - IP addresses
 * - JWT tokens
 * - Health data keywords
 *
 * Provides request/response scanning, redaction, and Fastify middleware integration.
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
  preHandlerHookHandler,
  onSendHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';

const logger = createLogger({ component: 'dlp-scanner' });

// =============================================================================
// Constants
// =============================================================================

/** Maximum content size to scan (1MB default) */
const DEFAULT_MAX_SCAN_SIZE = 1024 * 1024;

/** Maximum scan timeout (100ms default) */
const DEFAULT_SCAN_TIMEOUT_MS = 100;

// =============================================================================
// Enums and Types
// =============================================================================

/**
 * Types of sensitive data that can be detected
 */
export enum DataType {
  /** Credit card numbers */
  CREDIT_CARD = 'CREDIT_CARD',
  /** US Social Security Numbers */
  SSN = 'SSN',
  /** API keys (AWS, GCP, Azure, Stripe, GitHub, etc.) */
  API_KEY = 'API_KEY',
  /** Private keys (RSA, EC, PGP) */
  PRIVATE_KEY = 'PRIVATE_KEY',
  /** Passwords in URLs or JSON */
  PASSWORD = 'PASSWORD',
  /** Email addresses */
  EMAIL = 'EMAIL',
  /** Phone numbers */
  PHONE = 'PHONE',
  /** IP addresses */
  IP_ADDRESS = 'IP_ADDRESS',
  /** JWT tokens */
  JWT = 'JWT',
  /** Health data keywords */
  HEALTH_DATA = 'HEALTH_DATA',
}

/**
 * Risk level assessment
 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Scanning mode
 */
export type ScanMode = 'detect' | 'redact' | 'block';

/**
 * Individual sensitive data finding
 */
export interface DLPFinding {
  /** Type of sensitive data detected */
  type: DataType;
  /** Masked value (e.g., "****1234") */
  value: string;
  /** Location in content (JSON path or field name) */
  location: string;
  /** Detection confidence (0-100) */
  confidence: number;
  /** Surrounding text for context */
  context: string;
}

/**
 * DLP scan result
 */
export interface DLPScanResult {
  /** Whether sensitive data was detected */
  hasSensitiveData: boolean;
  /** List of findings */
  findings: DLPFinding[];
  /** Overall risk level */
  riskLevel: RiskLevel;
  /** Time taken to scan in milliseconds */
  scanTimeMs: number;
}

/**
 * DLP scanner configuration
 */
export interface DLPScannerConfig {
  /** Data types to detect (default: all) */
  enabledTypes: DataType[];
  /** Maximum content size to scan in bytes (default: 1MB) */
  maxScanSize: number;
  /** Maximum scan timeout in milliseconds (default: 100ms) */
  scanTimeoutMs: number;
  /** Custom patterns to detect (maps pattern name to regex) */
  customPatterns: Map<string, RegExp>;
  /** Field names to skip scanning */
  skipFields: string[];
  /** Whether to log findings */
  logFindings: boolean;
  /** Context length for findings (characters before/after) */
  contextLength: number;
}

/**
 * Zod schema for DLP scanner configuration
 */
export const dlpScannerConfigSchema = z.object({
  enabledTypes: z.array(z.nativeEnum(DataType)).default(Object.values(DataType) as DataType[]),
  maxScanSize: z.number().int().positive().default(DEFAULT_MAX_SCAN_SIZE),
  scanTimeoutMs: z.number().int().positive().default(DEFAULT_SCAN_TIMEOUT_MS),
  customPatterns: z.map(z.string(), z.instanceof(RegExp)).optional(),
  skipFields: z.array(z.string()).default([]),
  logFindings: z.boolean().default(true),
  contextLength: z.number().int().min(0).max(100).default(20),
});

// =============================================================================
// Compiled Regex Patterns (initialized once for performance)
// =============================================================================

/**
 * Credit card patterns by brand
 */
const CREDIT_CARD_PATTERNS = {
  /** Visa: starts with 4 */
  VISA: /\b4[0-9]{12}(?:[0-9]{3})?\b/g,
  /** Mastercard: starts with 51-55 or 2221-2720 */
  MASTERCARD: /\b(?:5[1-5][0-9]{2}|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)[0-9]{12}\b/g,
  /** American Express: starts with 34 or 37 */
  AMEX: /\b3[47][0-9]{13}\b/g,
  /** Discover: starts with 6011, 65, 644-649 */
  DISCOVER: /\b(?:6011|65[0-9]{2}|64[4-9][0-9])[0-9]{12}\b/g,
};

/**
 * US Social Security Number pattern
 * Format: XXX-XX-XXXX or XXXXXXXXX (with valid area numbers)
 */
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g;

/**
 * API key patterns by provider
 */
const API_KEY_PATTERNS = {
  /** AWS Access Key ID */
  AWS_ACCESS_KEY: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
  /** AWS Secret Access Key */
  AWS_SECRET_KEY: /\b[A-Za-z0-9/+=]{40}\b/g,
  /** Google Cloud API Key */
  GCP_API_KEY: /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /** Google Cloud Service Account */
  GCP_SERVICE_ACCOUNT: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/g,
  /** Azure Storage Key */
  AZURE_STORAGE_KEY: /\b[A-Za-z0-9+/]{86}==\b/g,
  /** Azure Connection String */
  AZURE_CONNECTION_STRING: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]+/gi,
  /** Stripe API Key (live/test) */
  STRIPE_KEY: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /** GitHub Personal Access Token */
  GITHUB_PAT: /\bghp_[A-Za-z0-9]{36}\b/g,
  /** GitHub OAuth Token */
  GITHUB_OAUTH: /\bgho_[A-Za-z0-9]{36}\b/g,
  /** GitHub App Token */
  GITHUB_APP: /\bghu_[A-Za-z0-9]{36}\b/g,
  /** GitHub Refresh Token */
  GITHUB_REFRESH: /\bghr_[A-Za-z0-9]{36}\b/g,
  /** Slack Token */
  SLACK_TOKEN: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /** Generic API Key pattern */
  GENERIC_API_KEY: /\b(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)[=:]\s*["']?([A-Za-z0-9\-_]{16,})["']?/gi,
};

/**
 * Private key patterns
 */
const PRIVATE_KEY_PATTERNS = {
  /** RSA Private Key */
  RSA: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g,
  /** EC Private Key */
  EC: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
  /** PGP Private Key */
  PGP: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  /** OpenSSH Private Key */
  OPENSSH: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
  /** Encrypted Private Key */
  ENCRYPTED: /-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]*?-----END ENCRYPTED PRIVATE KEY-----/g,
};

/**
 * Password patterns in URLs and JSON
 */
const PASSWORD_PATTERNS = {
  /** Password in URL query parameter */
  URL_PASSWORD: /[?&](?:password|passwd|pwd|pass|secret|api_key|apikey|token|auth|credential)[=]([^&\s]+)/gi,
  /** Password in JSON */
  JSON_PASSWORD: /["'](?:password|passwd|pwd|pass|secret|api_key|apikey|token|auth|credential)["']\s*:\s*["']([^"']+)["']/gi,
  /** Basic Auth in URL */
  BASIC_AUTH_URL: /https?:\/\/[^:]+:[^@]+@/gi,
};

/**
 * Email pattern (RFC 5322 simplified)
 */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Phone number patterns
 */
const PHONE_PATTERNS = {
  /** US phone number */
  US: /\b(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /** International phone number (E.164 format) */
  INTERNATIONAL: /\b\+[1-9]\d{1,14}\b/g,
};

/**
 * IP address patterns
 */
const IP_PATTERNS = {
  /** IPv4 address */
  IPV4: /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  /** IPv6 address */
  IPV6: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b|\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b/g,
};

/**
 * JWT pattern
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/**
 * Health data keywords (HIPAA concerns)
 */
const HEALTH_DATA_KEYWORDS = [
  'diagnosis',
  'prescription',
  'medication',
  'treatment',
  'medical record',
  'patient',
  'health condition',
  'medical history',
  'insurance claim',
  'healthcare',
  'hipaa',
  'phi',
  'protected health information',
  'mental health',
  'substance abuse',
  'hiv',
  'aids',
  'cancer',
  'diabetes',
  'blood type',
  'genetic',
  'dna',
  'laboratory results',
  'test results',
  'radiology',
  'mri',
  'ct scan',
  'x-ray',
];

// =============================================================================
// Metrics
// =============================================================================

const dlpScansTotal = new Counter({
  name: 'vorion_dlp_scans_total',
  help: 'Total DLP scans performed',
  labelNames: ['result', 'source'] as const,
  registers: [vorionRegistry],
});

const dlpFindingsTotal = new Counter({
  name: 'vorion_dlp_findings_total',
  help: 'Total DLP findings by type',
  labelNames: ['type', 'risk_level'] as const,
  registers: [vorionRegistry],
});

const dlpScanDuration = new Histogram({
  name: 'vorion_dlp_scan_duration_seconds',
  help: 'Duration of DLP scans',
  labelNames: ['source'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base DLP error class
 */
export class DLPError extends VorionError {
  override code = 'DLP_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'DLPError';
  }
}

/**
 * Error thrown when sensitive data is detected and blocking is enabled
 */
export class SensitiveDataBlockedError extends VorionError {
  override code = 'SENSITIVE_DATA_BLOCKED';
  override statusCode = 400;

  constructor(
    message: string,
    public readonly findings: DLPFinding[],
    public readonly riskLevel: RiskLevel
  ) {
    super(message, { findingCount: findings.length, riskLevel });
    this.name = 'SensitiveDataBlockedError';
  }
}

/**
 * Error thrown when scan timeout is exceeded
 */
export class DLPScanTimeoutError extends DLPError {
  override code = 'DLP_SCAN_TIMEOUT';

  constructor(timeoutMs: number) {
    super(`DLP scan timeout exceeded (${timeoutMs}ms)`);
    this.name = 'DLPScanTimeoutError';
  }
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default DLP scanner configuration
 */
export const DEFAULT_DLP_CONFIG: DLPScannerConfig = {
  enabledTypes: Object.values(DataType) as DataType[],
  maxScanSize: DEFAULT_MAX_SCAN_SIZE,
  scanTimeoutMs: DEFAULT_SCAN_TIMEOUT_MS,
  customPatterns: new Map(),
  skipFields: ['nonce', 'csrf', 'csrfToken', 'xsrfToken'],
  logFindings: true,
  contextLength: 20,
};

// =============================================================================
// DLP Scanner Class
// =============================================================================

/**
 * Data Loss Prevention Scanner
 *
 * Detects sensitive data in content and provides redaction capabilities.
 *
 * @example
 * ```typescript
 * const scanner = new DLPScanner({
 *   enabledTypes: [DataType.CREDIT_CARD, DataType.SSN],
 *   logFindings: true,
 * });
 *
 * const result = await scanner.scan('My card is 4111111111111111');
 * if (result.hasSensitiveData) {
 *   console.log('Sensitive data detected:', result.findings);
 * }
 * ```
 */
export class DLPScanner {
  private readonly config: DLPScannerConfig;
  private readonly enabledTypesSet: Set<DataType>;
  private readonly skipFieldsSet: Set<string>;
  private readonly healthKeywordsPattern: RegExp;

  /**
   * Create a new DLPScanner instance
   *
   * @param config - Scanner configuration options
   */
  constructor(config: Partial<DLPScannerConfig> = {}) {
    this.config = { ...DEFAULT_DLP_CONFIG, ...config };
    this.enabledTypesSet = new Set(this.config.enabledTypes);
    this.skipFieldsSet = new Set(this.config.skipFields.map((f) => f.toLowerCase()));

    // Build health keywords regex (case insensitive, word boundaries)
    this.healthKeywordsPattern = new RegExp(
      `\\b(${HEALTH_DATA_KEYWORDS.join('|')})\\b`,
      'gi'
    );
  }

  /**
   * Scan content for sensitive data
   *
   * @param content - String or object to scan
   * @returns Scan result with findings
   */
  async scan(content: string | object): Promise<DLPScanResult> {
    const startTime = performance.now();

    try {
      // Convert to string if object
      const contentString = typeof content === 'string'
        ? content
        : JSON.stringify(content);

      // Check size limit
      if (contentString.length > this.config.maxScanSize) {
        logger.warn(
          { contentLength: contentString.length, maxSize: this.config.maxScanSize },
          'Content exceeds max scan size, truncating'
        );
      }

      const scanContent = contentString.slice(0, this.config.maxScanSize);

      // Perform scan with timeout protection
      const findings = await this.scanWithTimeout(scanContent);

      const scanTimeMs = performance.now() - startTime;
      const riskLevel = this.calculateRiskLevel(findings);
      const hasSensitiveData = findings.length > 0;

      // Log findings if configured
      if (hasSensitiveData && this.config.logFindings) {
        logger.warn(
          {
            findingCount: findings.length,
            types: Array.from(new Set(findings.map((f) => f.type))),
            riskLevel,
            scanTimeMs,
          },
          'DLP sensitive data detected'
        );
      }

      // Update metrics
      dlpScansTotal.inc({
        result: hasSensitiveData ? 'detected' : 'clean',
        source: 'scan',
      });
      dlpScanDuration.observe({ source: 'scan' }, scanTimeMs / 1000);

      if (hasSensitiveData) {
        for (const finding of findings) {
          dlpFindingsTotal.inc({ type: finding.type, risk_level: riskLevel });
        }
      }

      return {
        hasSensitiveData,
        findings,
        riskLevel,
        scanTimeMs,
      };
    } catch (error) {
      const scanTimeMs = performance.now() - startTime;
      dlpScansTotal.inc({ result: 'error', source: 'scan' });
      dlpScanDuration.observe({ source: 'scan' }, scanTimeMs / 1000);
      throw error;
    }
  }

  /**
   * Scan a Fastify request body
   *
   * @param request - Fastify request
   * @returns Scan result
   */
  async scanRequest(request: FastifyRequest): Promise<DLPScanResult> {
    const startTime = performance.now();

    try {
      const body = request.body;
      if (!body) {
        return {
          hasSensitiveData: false,
          findings: [],
          riskLevel: 'none',
          scanTimeMs: performance.now() - startTime,
        };
      }

      const content = typeof body === 'string' ? body : body as object;
      const result = await this.scan(content);

      dlpScansTotal.inc({
        result: result.hasSensitiveData ? 'detected' : 'clean',
        source: 'request',
      });

      return result;
    } catch (error) {
      dlpScansTotal.inc({ result: 'error', source: 'request' });
      throw error;
    }
  }

  /**
   * Scan a response body
   *
   * @param response - Response body (string or object)
   * @returns Scan result
   */
  async scanResponse(response: unknown): Promise<DLPScanResult> {
    const startTime = performance.now();

    try {
      if (!response) {
        return {
          hasSensitiveData: false,
          findings: [],
          riskLevel: 'none',
          scanTimeMs: performance.now() - startTime,
        };
      }

      const content = typeof response === 'string'
        ? response
        : (response as object);
      const result = await this.scan(content);

      dlpScansTotal.inc({
        result: result.hasSensitiveData ? 'detected' : 'clean',
        source: 'response',
      });

      return result;
    } catch (error) {
      dlpScansTotal.inc({ result: 'error', source: 'response' });
      throw error;
    }
  }

  /**
   * Redact sensitive data from content
   *
   * @param content - Content to redact
   * @param findings - Findings to redact
   * @returns Redacted content
   */
  redact(content: string, findings: DLPFinding[]): string {
    if (findings.length === 0) {
      return content;
    }

    let redacted = content;

    // Sort findings by location length (longer first) to avoid offset issues
    const sortedFindings = [...findings].sort(
      (a, b) => b.location.length - a.location.length
    );

    for (const finding of sortedFindings) {
      // Find and replace the actual value (not the masked one)
      const patterns = this.getPatternsForType(finding.type);
      for (const pattern of patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        redacted = redacted.replace(pattern, (match) => this.createMask(match, finding.type));
      }
    }

    return redacted;
  }

  /**
   * Scan content with timeout protection
   */
  private async scanWithTimeout(content: string): Promise<DLPFinding[]> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new DLPScanTimeoutError(this.config.scanTimeoutMs));
      }, this.config.scanTimeoutMs);

      try {
        const findings = this.scanContent(content);
        clearTimeout(timeoutId);
        resolve(findings);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Perform the actual content scanning
   */
  private scanContent(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    // Scan for each enabled type
    if (this.enabledTypesSet.has(DataType.CREDIT_CARD)) {
      findings.push(...this.scanCreditCards(content));
    }

    if (this.enabledTypesSet.has(DataType.SSN)) {
      findings.push(...this.scanSSN(content));
    }

    if (this.enabledTypesSet.has(DataType.API_KEY)) {
      findings.push(...this.scanAPIKeys(content));
    }

    if (this.enabledTypesSet.has(DataType.PRIVATE_KEY)) {
      findings.push(...this.scanPrivateKeys(content));
    }

    if (this.enabledTypesSet.has(DataType.PASSWORD)) {
      findings.push(...this.scanPasswords(content));
    }

    if (this.enabledTypesSet.has(DataType.EMAIL)) {
      findings.push(...this.scanEmails(content));
    }

    if (this.enabledTypesSet.has(DataType.PHONE)) {
      findings.push(...this.scanPhoneNumbers(content));
    }

    if (this.enabledTypesSet.has(DataType.IP_ADDRESS)) {
      findings.push(...this.scanIPAddresses(content));
    }

    if (this.enabledTypesSet.has(DataType.JWT)) {
      findings.push(...this.scanJWTs(content));
    }

    if (this.enabledTypesSet.has(DataType.HEALTH_DATA)) {
      findings.push(...this.scanHealthData(content));
    }

    // Scan custom patterns
    this.config.customPatterns.forEach((pattern, name) => {
      findings.push(...this.scanCustomPattern(content, name, pattern));
    });

    return findings;
  }

  /**
   * Scan for credit card numbers
   */
  private scanCreditCards(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [brand, pattern] of Object.entries(CREDIT_CARD_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const value = match[0];

        // Validate with Luhn algorithm
        if (this.isValidLuhn(value)) {
          findings.push({
            type: DataType.CREDIT_CARD,
            value: this.maskCreditCard(value),
            location: `card:${brand}`,
            confidence: 95,
            context: this.extractContext(content, match.index, value.length),
          });
        }
      }
    }

    return findings;
  }

  /**
   * Scan for SSNs
   */
  private scanSSN(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];
    SSN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = SSN_PATTERN.exec(content)) !== null) {
      const value = match[0];
      findings.push({
        type: DataType.SSN,
        value: this.maskSSN(value),
        location: 'ssn',
        confidence: 90,
        context: this.extractContext(content, match.index, value.length),
      });
    }

    return findings;
  }

  /**
   * Scan for API keys
   */
  private scanAPIKeys(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [provider, pattern] of Object.entries(API_KEY_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const value = match[1] || match[0]; // Some patterns capture the key in group 1
        findings.push({
          type: DataType.API_KEY,
          value: this.maskAPIKey(value),
          location: `api_key:${provider}`,
          confidence: this.getAPIKeyConfidence(provider),
          context: this.extractContext(content, match.index, match[0].length),
        });
      }
    }

    return findings;
  }

  /**
   * Scan for private keys
   */
  private scanPrivateKeys(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [keyType, pattern] of Object.entries(PRIVATE_KEY_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        findings.push({
          type: DataType.PRIVATE_KEY,
          value: `[${keyType} PRIVATE KEY REDACTED]`,
          location: `private_key:${keyType}`,
          confidence: 99,
          context: this.extractContext(content, match.index, 50),
        });
      }
    }

    return findings;
  }

  /**
   * Scan for passwords
   */
  private scanPasswords(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [location, pattern] of Object.entries(PASSWORD_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const value = match[1] || match[0];
        findings.push({
          type: DataType.PASSWORD,
          value: '********',
          location: `password:${location}`,
          confidence: 85,
          context: this.extractContext(content, match.index, match[0].length),
        });
      }
    }

    return findings;
  }

  /**
   * Scan for email addresses
   */
  private scanEmails(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];
    EMAIL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = EMAIL_PATTERN.exec(content)) !== null) {
      const email = match[0];
      findings.push({
        type: DataType.EMAIL,
        value: this.maskEmail(email),
        location: 'email',
        confidence: 95,
        context: this.extractContext(content, match.index, email.length),
      });
    }

    return findings;
  }

  /**
   * Scan for phone numbers
   */
  private scanPhoneNumbers(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [format, pattern] of Object.entries(PHONE_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const phone = match[0];
        findings.push({
          type: DataType.PHONE,
          value: this.maskPhone(phone),
          location: `phone:${format}`,
          confidence: 80,
          context: this.extractContext(content, match.index, phone.length),
        });
      }
    }

    return findings;
  }

  /**
   * Scan for IP addresses
   */
  private scanIPAddresses(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];

    for (const [version, pattern] of Object.entries(IP_PATTERNS)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const ip = match[0];

        // Skip private/local IPs for lower concern
        const isPrivate = this.isPrivateIP(ip);

        findings.push({
          type: DataType.IP_ADDRESS,
          value: this.maskIP(ip),
          location: `ip:${version}`,
          confidence: isPrivate ? 60 : 75,
          context: this.extractContext(content, match.index, ip.length),
        });
      }
    }

    return findings;
  }

  /**
   * Scan for JWTs
   */
  private scanJWTs(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];
    JWT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = JWT_PATTERN.exec(content)) !== null) {
      const jwt = match[0];
      findings.push({
        type: DataType.JWT,
        value: this.maskJWT(jwt),
        location: 'jwt',
        confidence: 98,
        context: this.extractContext(content, match.index, 50),
      });
    }

    return findings;
  }

  /**
   * Scan for health data keywords
   */
  private scanHealthData(content: string): DLPFinding[] {
    const findings: DLPFinding[] = [];
    this.healthKeywordsPattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    // Track unique keywords to avoid duplicates
    const seenKeywords = new Set<string>();

    while ((match = this.healthKeywordsPattern.exec(content)) !== null) {
      const keyword = match[0].toLowerCase();

      if (!seenKeywords.has(keyword)) {
        seenKeywords.add(keyword);
        findings.push({
          type: DataType.HEALTH_DATA,
          value: `[HEALTH: ${keyword}]`,
          location: 'health_data',
          confidence: 70,
          context: this.extractContext(content, match.index, match[0].length),
        });
      }
    }

    return findings;
  }

  /**
   * Scan with custom pattern
   */
  private scanCustomPattern(
    content: string,
    name: string,
    pattern: RegExp
  ): DLPFinding[] {
    const findings: DLPFinding[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      findings.push({
        type: DataType.API_KEY, // Custom patterns are treated as API keys
        value: this.maskGeneric(match[0]),
        location: `custom:${name}`,
        confidence: 80,
        context: this.extractContext(content, match.index, match[0].length),
      });
    }

    return findings;
  }

  /**
   * Calculate overall risk level from findings
   */
  private calculateRiskLevel(findings: DLPFinding[]): RiskLevel {
    if (findings.length === 0) {
      return 'none';
    }

    // Check for critical types
    const criticalTypes = new Set([
      DataType.PRIVATE_KEY,
      DataType.SSN,
      DataType.HEALTH_DATA,
    ]);

    const highTypes = new Set([
      DataType.CREDIT_CARD,
      DataType.API_KEY,
      DataType.PASSWORD,
    ]);

    const hasCritical = findings.some((f) => criticalTypes.has(f.type));
    const hasHigh = findings.some((f) => highTypes.has(f.type));
    const hasHighConfidence = findings.some((f) => f.confidence >= 90);

    if (hasCritical) {
      return 'critical';
    }

    if (hasHigh && hasHighConfidence) {
      return 'high';
    }

    if (hasHigh || findings.length >= 3) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Extract context around a match
   */
  private extractContext(
    content: string,
    matchIndex: number,
    matchLength: number
  ): string {
    const contextLength = this.config.contextLength;
    const start = Math.max(0, matchIndex - contextLength);
    const end = Math.min(content.length, matchIndex + matchLength + contextLength);

    let context = content.slice(start, end);

    // Add ellipsis if truncated
    if (start > 0) {
      context = '...' + context;
    }
    if (end < content.length) {
      context = context + '...';
    }

    // Mask the actual sensitive value in context
    return context.replace(/[\n\r\t]/g, ' ');
  }

  /**
   * Validate credit card number with Luhn algorithm
   */
  private isValidLuhn(number: string): boolean {
    const digits = number.replace(/\D/g, '');
    let sum = 0;
    let isEven = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Check if IP is private
   */
  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4) return false;

    // 10.x.x.x
    if (parts[0] === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.x.x.x (loopback)
    if (parts[0] === 127) return true;

    return false;
  }

  /**
   * Get API key confidence based on provider
   */
  private getAPIKeyConfidence(provider: string): number {
    const highConfidence = ['AWS_ACCESS_KEY', 'GCP_API_KEY', 'STRIPE_KEY', 'GITHUB_PAT'];
    return highConfidence.includes(provider) ? 95 : 80;
  }

  /**
   * Get patterns for a data type (for redaction)
   */
  private getPatternsForType(type: DataType): RegExp[] {
    switch (type) {
      case DataType.CREDIT_CARD:
        return Object.values(CREDIT_CARD_PATTERNS);
      case DataType.SSN:
        return [SSN_PATTERN];
      case DataType.API_KEY:
        return Object.values(API_KEY_PATTERNS);
      case DataType.PRIVATE_KEY:
        return Object.values(PRIVATE_KEY_PATTERNS);
      case DataType.PASSWORD:
        return Object.values(PASSWORD_PATTERNS);
      case DataType.EMAIL:
        return [EMAIL_PATTERN];
      case DataType.PHONE:
        return Object.values(PHONE_PATTERNS);
      case DataType.IP_ADDRESS:
        return Object.values(IP_PATTERNS);
      case DataType.JWT:
        return [JWT_PATTERN];
      case DataType.HEALTH_DATA:
        return [this.healthKeywordsPattern];
      default:
        return [];
    }
  }

  /**
   * Create a mask based on data type
   */
  private createMask(value: string, type: DataType): string {
    switch (type) {
      case DataType.CREDIT_CARD:
        return this.maskCreditCard(value);
      case DataType.SSN:
        return this.maskSSN(value);
      case DataType.API_KEY:
        return this.maskAPIKey(value);
      case DataType.EMAIL:
        return this.maskEmail(value);
      case DataType.PHONE:
        return this.maskPhone(value);
      case DataType.IP_ADDRESS:
        return this.maskIP(value);
      case DataType.JWT:
        return this.maskJWT(value);
      default:
        return this.maskGeneric(value);
    }
  }

  // Masking helpers
  private maskCreditCard(card: string): string {
    const digits = card.replace(/\D/g, '');
    return `****${digits.slice(-4)}`;
  }

  private maskSSN(ssn: string): string {
    const digits = ssn.replace(/\D/g, '');
    return `***-**-${digits.slice(-4)}`;
  }

  private maskAPIKey(key: string): string {
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    const maskedLocal = local.length > 2
      ? `${local[0]}***${local[local.length - 1]}`
      : '***';
    return `${maskedLocal}@${domain}`;
  }

  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return `***-***-${digits.slice(-4)}`;
  }

  private maskIP(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.***.***.*`;
    }
    return '****:****:****:****';
  }

  private maskJWT(jwt: string): string {
    return 'eyJ***...***';
  }

  private maskGeneric(value: string): string {
    if (value.length <= 8) return '********';
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }

  /**
   * Get the current configuration
   */
  getConfig(): DLPScannerConfig {
    return { ...this.config };
  }

  /**
   * Add a custom pattern at runtime
   */
  addCustomPattern(name: string, pattern: RegExp): void {
    this.config.customPatterns.set(name, pattern);
    logger.debug({ patternName: name }, 'Added custom DLP pattern');
  }
}

// =============================================================================
// Fastify Middleware
// =============================================================================

/**
 * Options for DLP request scanner middleware
 */
export interface DLPRequestScannerOptions {
  /** Scanner configuration */
  config?: Partial<DLPScannerConfig>;
  /** Scanning mode */
  mode: ScanMode;
  /** Paths to skip scanning */
  skipPaths?: string[];
  /** HTTP methods to skip */
  skipMethods?: string[];
  /** Data types to detect (overrides config) */
  detectTypes?: DataType[];
  /** Custom error response */
  errorResponse?: {
    statusCode: number;
    code: string;
    message: string;
  };
}

/**
 * Options for DLP response scanner middleware
 */
export interface DLPResponseScannerOptions {
  /** Scanner configuration */
  config?: Partial<DLPScannerConfig>;
  /** Scanning mode */
  mode: ScanMode;
  /** Paths to skip scanning */
  skipPaths?: string[];
  /** Data types to detect */
  detectTypes?: DataType[];
  /** Whether to redact before sending */
  redactResponse?: boolean;
}

/**
 * Create a DLP request scanner middleware (preHandler)
 *
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * fastify.addHook('preHandler', dlpRequestScanner({
 *   mode: 'block',
 *   detectTypes: [DataType.CREDIT_CARD, DataType.SSN],
 *   skipPaths: ['/health'],
 * }));
 * ```
 */
export function dlpRequestScanner(
  options: DLPRequestScannerOptions
): preHandlerHookHandler {
  const scanner = new DLPScanner({
    ...options.config,
    enabledTypes: options.detectTypes ?? options.config?.enabledTypes,
  });

  const skipPaths = new Set(options.skipPaths ?? []);
  const skipMethods = new Set((options.skipMethods ?? ['GET', 'HEAD', 'OPTIONS']).map((m) => m.toUpperCase()));

  const errorResponse = options.errorResponse ?? {
    statusCode: 400,
    code: 'SENSITIVE_DATA_DETECTED',
    message: 'Request contains sensitive data that cannot be processed',
  };

  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    // Skip configured paths
    const routeUrl = request.routeOptions?.url;
    if (skipPaths.has(request.url) || (routeUrl && skipPaths.has(routeUrl))) {
      return;
    }

    // Skip configured methods
    if (skipMethods.has(request.method)) {
      return;
    }

    // Skip if no body
    if (!request.body) {
      return;
    }

    try {
      const result = await scanner.scanRequest(request);

      if (!result.hasSensitiveData) {
        return;
      }

      // Handle based on mode
      switch (options.mode) {
        case 'detect':
          // Just log, allow request to proceed
          logger.warn(
            {
              requestId: request.id,
              url: request.url,
              findingCount: result.findings.length,
              riskLevel: result.riskLevel,
            },
            'DLP: Sensitive data detected in request'
          );
          break;

        case 'redact':
          // Redact sensitive data in body
          if (typeof request.body === 'string') {
            (request as { body: unknown }).body = scanner.redact(request.body, result.findings);
          } else if (typeof request.body === 'object') {
            const redacted = scanner.redact(
              JSON.stringify(request.body),
              result.findings
            );
            (request as { body: unknown }).body = JSON.parse(redacted);
          }
          logger.info(
            {
              requestId: request.id,
              url: request.url,
              redactedCount: result.findings.length,
            },
            'DLP: Redacted sensitive data in request'
          );
          break;

        case 'block':
          // Block the request
          logger.warn(
            {
              requestId: request.id,
              url: request.url,
              findingCount: result.findings.length,
              riskLevel: result.riskLevel,
            },
            'DLP: Blocked request with sensitive data'
          );
          return reply.status(errorResponse.statusCode).send({
            error: {
              code: errorResponse.code,
              message: errorResponse.message,
              details: {
                findingCount: result.findings.length,
                riskLevel: result.riskLevel,
              },
            },
          });
      }
    } catch (error) {
      // Log error but allow request to proceed (fail open)
      logger.error(
        { error, requestId: request.id },
        'DLP: Error scanning request'
      );
    }
  };
}

/**
 * Create a DLP response scanner middleware (onSend)
 *
 * @param options - Middleware options
 * @returns Fastify onSend hook
 *
 * @example
 * ```typescript
 * fastify.addHook('onSend', dlpResponseScanner({
 *   mode: 'redact',
 *   detectTypes: [DataType.CREDIT_CARD, DataType.SSN],
 *   redactResponse: true,
 * }));
 * ```
 */
export function dlpResponseScanner(
  options: DLPResponseScannerOptions
): onSendHookHandler {
  const scanner = new DLPScanner({
    ...options.config,
    enabledTypes: options.detectTypes ?? options.config?.enabledTypes,
  });

  const skipPaths = new Set(options.skipPaths ?? []);

  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown
  ): Promise<unknown> => {
    // Skip configured paths
    const routeUrl = request.routeOptions?.url;
    if (skipPaths.has(request.url) || (routeUrl && skipPaths.has(routeUrl))) {
      return payload;
    }

    // Skip if no payload or not a string
    if (!payload || typeof payload !== 'string') {
      return payload;
    }

    try {
      const result = await scanner.scanResponse(payload);

      if (!result.hasSensitiveData) {
        return payload;
      }

      // Handle based on mode
      switch (options.mode) {
        case 'detect':
          // Just log
          logger.warn(
            {
              requestId: request.id,
              url: request.url,
              findingCount: result.findings.length,
              riskLevel: result.riskLevel,
            },
            'DLP: Sensitive data detected in response'
          );
          return payload;

        case 'redact':
          // Redact sensitive data
          const redacted = scanner.redact(payload, result.findings);
          logger.info(
            {
              requestId: request.id,
              url: request.url,
              redactedCount: result.findings.length,
            },
            'DLP: Redacted sensitive data in response'
          );
          return redacted;

        case 'block':
          // For responses, we can't really block - log critical error instead
          logger.error(
            {
              requestId: request.id,
              url: request.url,
              findingCount: result.findings.length,
              riskLevel: result.riskLevel,
            },
            'DLP: CRITICAL - Response contains sensitive data'
          );
          // Redact as fallback
          return options.redactResponse !== false
            ? scanner.redact(payload, result.findings)
            : payload;

        default:
          return payload;
      }
    } catch (error) {
      // Log error but return original payload (fail open)
      logger.error(
        { error, requestId: request.id },
        'DLP: Error scanning response'
      );
      return payload;
    }
  };
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * DLP plugin options
 */
export interface DLPPluginOptions {
  /** Scanner configuration */
  config?: Partial<DLPScannerConfig>;
  /** Request scanning options */
  requestScanning?: {
    enabled: boolean;
    mode: ScanMode;
    skipPaths?: string[];
    skipMethods?: string[];
    detectTypes?: DataType[];
  };
  /** Response scanning options */
  responseScanning?: {
    enabled: boolean;
    mode: ScanMode;
    skipPaths?: string[];
    detectTypes?: DataType[];
    redactResponse?: boolean;
  };
}

/**
 * Fastify plugin for DLP scanning
 */
const dlpPluginCallback: FastifyPluginCallback<DLPPluginOptions> = (
  fastify: FastifyInstance,
  options: DLPPluginOptions,
  done: (err?: Error) => void
) => {
  try {
    // Create scanner instance for the plugin
    const scanner = new DLPScanner(options.config);

    // Decorate fastify with scanner
    fastify.decorate('dlpScanner', scanner);

    // Register request scanner if enabled
    if (options.requestScanning?.enabled !== false) {
      fastify.addHook(
        'preHandler',
        dlpRequestScanner({
          config: options.config,
          mode: options.requestScanning?.mode ?? 'detect',
          skipPaths: options.requestScanning?.skipPaths,
          skipMethods: options.requestScanning?.skipMethods,
          detectTypes: options.requestScanning?.detectTypes,
        })
      );
    }

    // Register response scanner if enabled
    if (options.responseScanning?.enabled) {
      fastify.addHook(
        'onSend',
        dlpResponseScanner({
          config: options.config,
          mode: options.responseScanning.mode,
          skipPaths: options.responseScanning.skipPaths,
          detectTypes: options.responseScanning.detectTypes,
          redactResponse: options.responseScanning.redactResponse,
        }) as onSendHookHandler
      );
    }

    logger.info(
      {
        requestScanning: options.requestScanning?.enabled !== false,
        responseScanning: options.responseScanning?.enabled ?? false,
        requestMode: options.requestScanning?.mode ?? 'detect',
        responseMode: options.responseScanning?.mode,
      },
      'DLP plugin registered'
    );

    done();
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * DLP Fastify plugin
 *
 * @example
 * ```typescript
 * await fastify.register(dlpPlugin, {
 *   config: {
 *     enabledTypes: [DataType.CREDIT_CARD, DataType.SSN, DataType.API_KEY],
 *   },
 *   requestScanning: {
 *     enabled: true,
 *     mode: 'block',
 *     skipPaths: ['/health', '/metrics'],
 *   },
 *   responseScanning: {
 *     enabled: true,
 *     mode: 'redact',
 *   },
 * });
 * ```
 */
export const dlpPlugin = fp(dlpPluginCallback, {
  name: 'vorion-dlp',
  fastify: '5.x',
});

// Declare Fastify decorator
declare module 'fastify' {
  interface FastifyInstance {
    dlpScanner?: DLPScanner;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

/** Singleton instance */
let dlpScannerInstance: DLPScanner | null = null;

/**
 * Get or create the singleton DLPScanner instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton DLPScanner instance
 */
export function getDLPScanner(config?: Partial<DLPScannerConfig>): DLPScanner {
  if (!dlpScannerInstance) {
    dlpScannerInstance = new DLPScanner(config);
  }
  return dlpScannerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetDLPScanner(): void {
  dlpScannerInstance = null;
  logger.debug('DLP scanner singleton reset');
}

/**
 * Create a new DLPScanner instance
 *
 * @param config - Configuration options
 * @returns New DLPScanner instance
 */
export function createDLPScanner(config?: Partial<DLPScannerConfig>): DLPScanner {
  return new DLPScanner(config);
}
