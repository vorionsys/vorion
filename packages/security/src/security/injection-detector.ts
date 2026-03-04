/**
 * Injection Detection System
 *
 * Comprehensive detection and prevention of injection attacks including:
 * - SQL Injection
 * - Cross-Site Scripting (XSS)
 * - Command Injection
 * - Template Injection
 * - Path Traversal
 * - LDAP Injection
 * - XML Injection (XXE)
 * - NoSQL Injection
 *
 * Provides configurable detection, allowlisting, and Fastify middleware integration.
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../common/logger.js';
import { ValidationError } from '../common/validation.js';

const logger = createLogger({ component: 'injection-detector' });

// =============================================================================
// Enums and Constants
// =============================================================================

/**
 * Types of injection attacks that can be detected
 */
export enum InjectionType {
  /** SQL Injection - attacks targeting SQL databases */
  SQL = 'SQL',
  /** Cross-Site Scripting - malicious script injection */
  XSS = 'XSS',
  /** Command Injection - OS command execution */
  COMMAND = 'COMMAND',
  /** Template Injection - server-side template manipulation */
  TEMPLATE = 'TEMPLATE',
  /** Path Traversal - unauthorized file system access */
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  /** LDAP Injection - directory service attacks */
  LDAP = 'LDAP',
  /** XML Injection - XML External Entity attacks */
  XML = 'XML',
  /** NoSQL Injection - attacks targeting NoSQL databases */
  NOSQL = 'NOSQL',
}

/**
 * Comprehensive regex patterns for detecting various injection attacks.
 * Patterns are designed to minimize false positives while catching common attack vectors.
 */
export const INJECTION_PATTERNS: Record<InjectionType, RegExp[]> = {
  [InjectionType.SQL]: [
    // Basic SQL keywords with word boundaries
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE)\s+/i,
    // UNION-based injection
    /\bUNION\s+(ALL\s+)?SELECT\b/i,
    // Boolean-based blind injection
    /\bOR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bAND\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bOR\s+['"][^'"]+['"]\s*=\s*['"][^'"]+['"]/i,
    // Classic OR 1=1 patterns
    /'\s*OR\s*'?\d+'?\s*=\s*'?\d+/i,
    /"\s*OR\s*"?\d+"?\s*=\s*"?\d+/i,
    // SQL comment injection
    /--\s*$/m,
    /\/\*[\s\S]*?\*\//,
    /#\s*$/m,
    // Stacked queries
    /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i,
    // EXEC/EXECUTE for stored procedures
    /\bEXEC(UTE)?\s+/i,
    // System table access
    /\b(INFORMATION_SCHEMA|SYS\.|SYSOBJECTS|SYSCOLUMNS)\b/i,
    // Time-based blind injection
    /\bWAITFOR\s+DELAY\b/i,
    /\bSLEEP\s*\(/i,
    /\bBENCHMARK\s*\(/i,
    // Database specific functions
    /\b(LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i,
    // Hex encoding bypass
    /0x[0-9a-fA-F]+/,
    // CHAR function bypass
    /\bCHAR\s*\(\s*\d+/i,
    // Database version detection
    /@@(VERSION|SERVERNAME|LANGUAGE)/i,
  ],

  [InjectionType.XSS]: [
    // Script tags
    /<script[^>]*>[\s\S]*?<\/script>/i,
    /<script[^>]*>/i,
    // Event handlers
    /\bon\w+\s*=/i,
    // JavaScript protocol
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text\/html/i,
    // HTML injection
    /<\s*(iframe|frame|frameset|embed|object|applet|meta|link|style|base|form|input|button|textarea|img)[^>]*>/i,
    // SVG-based XSS
    /<\s*svg[^>]*\s+on\w+\s*=/i,
    /<\s*svg[^>]*>[\s\S]*?<\s*script/i,
    // Expression injection (IE)
    /expression\s*\(/i,
    // URL-based XSS
    /url\s*\(\s*['"]?\s*javascript/i,
    // CDATA injection
    /<!\[CDATA\[/i,
    // HTML entity encoded script
    /&#x?[0-9a-fA-F]+;/,
    // Backslash escaping
    /\\x[0-9a-fA-F]{2}/,
    /\\u[0-9a-fA-F]{4}/,
    // DOM manipulation
    /document\s*\.\s*(cookie|domain|write|location)/i,
    /window\s*\.\s*(location|open|eval)/i,
    // innerHTML/outerHTML
    /\.\s*(innerHTML|outerHTML|insertAdjacentHTML)\s*=/i,
    // eval and similar
    /\b(eval|setTimeout|setInterval|Function)\s*\(/i,
    // Template literal injection
    /\$\{[^}]*document[^}]*\}/i,
  ],

  [InjectionType.COMMAND]: [
    // Command separators
    /[;&|`]/,
    // Backtick command substitution
    /`[^`]+`/,
    // $() command substitution
    /\$\([^)]+\)/,
    // Redirection operators
    /[<>]\s*[<>]?/,
    // Pipe operator
    /\|/,
    // Newline injection
    /[\r\n]/,
    // Common dangerous commands
    /\b(rm|mv|cp|chmod|chown|kill|pkill|wget|curl|nc|netcat|bash|sh|zsh|perl|python|ruby|php|node)\b/i,
    // Environment variable injection
    /\$\{?[A-Z_][A-Z0-9_]*\}?/,
    // Path to shell
    /\/bin\/(ba)?sh/,
    /\/usr\/bin\/(ba)?sh/,
    // Null byte injection (for path truncation)
    /\x00/,
    /%00/,
    // Windows command separators
    /&\s*&/,
    /\|\s*\|/,
  ],

  [InjectionType.TEMPLATE]: [
    // Jinja2/Twig/Django
    /\{\{[\s\S]*?\}\}/,
    /\{%[\s\S]*?%\}/,
    // EJS/ERB
    /<%[\s\S]*?%>/,
    // JavaScript template literals with expressions
    /\$\{[^}]+\}/,
    // Pug/Jade
    /!\{[\s\S]*?\}/,
    /#{[^}]+}/,
    // Freemarker
    /\$\{[^}]+\}/,
    /<#[\s\S]*?>/,
    // Thymeleaf
    /th:[a-z]+\s*=/i,
    // Velocity
    /#(set|if|foreach|include|parse)\s*\(/i,
    /\$[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*/,
    // Smarty
    /\{\$[^}]+\}/,
    // Mustache/Handlebars
    /\{\{\{[\s\S]*?\}\}\}/,
    /\{\{#[\s\S]*?\}\}/,
    /\{\{>[\s\S]*?\}\}/,
    // SSTI common payloads
    /\{\{.*__(class|mro|subclasses|init|globals|builtins)__.*\}\}/i,
    /\{\{.*config.*\}\}/i,
    /\{\{.*request.*\}\}/i,
  ],

  [InjectionType.PATH_TRAVERSAL]: [
    // Basic traversal patterns
    /\.\.\//,
    /\.\.\\/,
    // URL encoded
    /%2e%2e[%2f%5c]/i,
    /%252e%252e[%252f%255c]/i,
    // Double URL encoded
    /\.\.%2f/i,
    /\.\.%5c/i,
    // Unicode/overlong UTF-8 encoding
    /%c0%ae%c0%ae[%c0%af%5c]/i,
    /%c0%2e%c0%2e[%c0%af%5c]/i,
    // Null byte injection
    /%00/,
    /\x00/,
    // Absolute path references
    /^\/etc\//,
    /^\/proc\//,
    /^\/var\//,
    /^c:\\/i,
    /^[a-z]:\\/i,
    // Common sensitive files
    /(passwd|shadow|hosts|\.htaccess|web\.config|\.env|\.git)/i,
    // Windows specific
    /\.\.[\\\/]+windows[\\\/]+/i,
    /\.\.[\\\/]+system32[\\\/]+/i,
  ],

  [InjectionType.LDAP]: [
    // Parentheses (LDAP filter syntax)
    /[()]/,
    // Asterisk wildcard
    /\*/,
    // Backslash (escape character)
    /\\/,
    // Null byte
    /\x00/,
    /%00/,
    // NUL character variations
    /\\00/,
    // LDAP operators
    /[|&!]/,
    // Common LDAP injection patterns
    /\)\s*\(/,
    /\(\|/,
    /\(&/,
    /\(!/,
    // LDAP special characters
    /[<>=~]/,
    // DN injection
    /\bou\s*=/i,
    /\bdc\s*=/i,
    /\bcn\s*=/i,
    /\buid\s*=/i,
  ],

  [InjectionType.XML]: [
    // DOCTYPE declaration (XXE vector)
    /<!DOCTYPE\s+/i,
    // ENTITY declaration (XXE)
    /<!ENTITY\s+/i,
    // SYSTEM keyword (XXE)
    /\bSYSTEM\s+["']/i,
    // PUBLIC keyword
    /\bPUBLIC\s+["']/i,
    // Parameter entity
    /%\s*[a-zA-Z_][a-zA-Z0-9_]*\s*;/,
    // CDATA sections
    /<!\[CDATA\[/i,
    // XML declaration with encoding
    /<\?xml[^>]*encoding\s*=/i,
    // Comment injection
    /<!--[\s\S]*?-->/,
    // Processing instructions
    /<\?[^>]+\?>/,
    // NOTATION declaration
    /<!NOTATION\s+/i,
    // ATTLIST declaration
    /<!ATTLIST\s+/i,
    // ELEMENT declaration
    /<!ELEMENT\s+/i,
    // External DTD reference
    /file:\/\//i,
    /php:\/\//i,
    /expect:\/\//i,
    /data:\/\//i,
  ],

  [InjectionType.NOSQL]: [
    // MongoDB operators
    /\$where\b/i,
    /\$regex\b/i,
    /\$gt\b/i,
    /\$gte\b/i,
    /\$lt\b/i,
    /\$lte\b/i,
    /\$ne\b/i,
    /\$nin\b/i,
    /\$in\b/i,
    /\$or\b/i,
    /\$and\b/i,
    /\$not\b/i,
    /\$nor\b/i,
    /\$exists\b/i,
    /\$type\b/i,
    /\$mod\b/i,
    /\$text\b/i,
    /\$search\b/i,
    /\$all\b/i,
    /\$elemMatch\b/i,
    /\$size\b/i,
    /\$slice\b/i,
    /\$comment\b/i,
    // MongoDB mapReduce
    /mapReduce\s*:/i,
    /\$function\b/i,
    // CouchDB
    /_all_docs\b/i,
    /_design\//i,
    // JavaScript execution
    /function\s*\(/i,
    // Object notation injection
    /\[\s*['"][^'"]+['"]\s*\]/,
    // Prototype pollution
    /__proto__\b/,
    /constructor\s*\[/,
    /prototype\s*\[/,
  ],
};

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Configuration options for the injection detector
 */
export interface InjectionDetectorConfig {
  /** Enable SQL injection detection */
  enableSQLDetection: boolean;
  /** Enable XSS detection */
  enableXSSDetection: boolean;
  /** Enable command injection detection */
  enableCommandDetection: boolean;
  /** Enable template injection detection */
  enableTemplateDetection: boolean;
  /** Enable path traversal detection */
  enablePathTraversalDetection: boolean;
  /** Enable LDAP injection detection */
  enableLDAPDetection: boolean;
  /** Enable XML/XXE injection detection */
  enableXMLDetection: boolean;
  /** Enable NoSQL injection detection */
  enableNoSQLDetection: boolean;
  /** Custom regex patterns to check */
  customPatterns: RegExp[];
  /** Known safe patterns to allowlist (bypass detection) */
  allowlist: string[];
  /** Whether to log detection events */
  logDetections: boolean;
  /** Whether to block requests on detection (vs just logging) */
  blockOnDetection: boolean;
}

/**
 * Result of injection detection analysis
 */
export interface InjectionDetectionResult {
  /** Whether any injection was detected */
  detected: boolean;
  /** Types of injections detected */
  types: InjectionType[];
  /** String representations of patterns that matched */
  patterns: string[];
  /** Sanitized version of input if sanitization was applied */
  sanitized?: string;
  /** Original input for reference */
  originalInput?: string;
  /** Timestamp of detection */
  detectedAt?: string;
}

/**
 * Options for the injection detection middleware
 */
export interface InjectionDetectionMiddlewareOptions {
  /** Injection detector configuration */
  config?: Partial<InjectionDetectorConfig>;
  /** Paths to skip detection for */
  skipPaths?: string[];
  /** HTTP methods to skip */
  skipMethods?: string[];
  /** Whether to check query parameters */
  checkQuery?: boolean;
  /** Whether to check request body */
  checkBody?: boolean;
  /** Whether to check headers */
  checkHeaders?: boolean;
  /** Headers to skip checking */
  skipHeaders?: string[];
  /** Custom error response */
  errorResponse?: {
    statusCode: number;
    code: string;
    message: string;
  };
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default injection detector configuration with all detections enabled
 */
export const DEFAULT_INJECTION_DETECTOR_CONFIG: InjectionDetectorConfig = {
  enableSQLDetection: true,
  enableXSSDetection: true,
  enableCommandDetection: true,
  enableTemplateDetection: true,
  enablePathTraversalDetection: true,
  enableLDAPDetection: true,
  enableXMLDetection: true,
  enableNoSQLDetection: true,
  customPatterns: [],
  allowlist: [],
  logDetections: true,
  blockOnDetection: true,
};

// =============================================================================
// InjectionDetector Class
// =============================================================================

/**
 * Injection attack detector with comprehensive pattern matching
 *
 * Provides detection, sanitization, and allowlisting capabilities for
 * protecting against various injection attack vectors.
 *
 * @example
 * ```typescript
 * const detector = new InjectionDetector({
 *   enableSQLDetection: true,
 *   enableXSSDetection: true,
 *   logDetections: true,
 * });
 *
 * const result = detector.detect("SELECT * FROM users WHERE id = '1' OR '1'='1'");
 * if (result.detected) {
 *   console.log('Injection detected:', result.types);
 * }
 * ```
 */
export class InjectionDetector {
  private config: InjectionDetectorConfig;
  private allowlistPatterns: RegExp[];

  /**
   * Create a new InjectionDetector instance
   *
   * @param config - Configuration options (merged with defaults)
   */
  constructor(config: Partial<InjectionDetectorConfig> = {}) {
    this.config = { ...DEFAULT_INJECTION_DETECTOR_CONFIG, ...config };
    // Compile allowlist patterns for efficient matching
    this.allowlistPatterns = this.config.allowlist.map((pattern) => {
      // Escape special regex characters and create exact match pattern
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${escaped}$`, 'i');
    });
  }

  /**
   * Detect injection attacks in an input string
   *
   * Checks the input against all enabled detection patterns and returns
   * detailed information about any matches found.
   *
   * @param input - The string to analyze for injection patterns
   * @returns Detection result with matched types and patterns
   *
   * @example
   * ```typescript
   * const result = detector.detect("<script>alert('xss')</script>");
   * // result.detected === true
   * // result.types includes InjectionType.XSS
   * ```
   */
  detect(input: string): InjectionDetectionResult {
    // Check if input is allowlisted
    if (this.isAllowlisted(input)) {
      return {
        detected: false,
        types: [],
        patterns: [],
      };
    }

    const detectedTypes: InjectionType[] = [];
    const matchedPatterns: string[] = [];

    // Check each enabled detection type
    const detectionChecks: Array<{
      enabled: boolean;
      type: InjectionType;
      patterns: RegExp[];
    }> = [
      {
        enabled: this.config.enableSQLDetection,
        type: InjectionType.SQL,
        patterns: INJECTION_PATTERNS[InjectionType.SQL],
      },
      {
        enabled: this.config.enableXSSDetection,
        type: InjectionType.XSS,
        patterns: INJECTION_PATTERNS[InjectionType.XSS],
      },
      {
        enabled: this.config.enableCommandDetection,
        type: InjectionType.COMMAND,
        patterns: INJECTION_PATTERNS[InjectionType.COMMAND],
      },
      {
        enabled: this.config.enableTemplateDetection,
        type: InjectionType.TEMPLATE,
        patterns: INJECTION_PATTERNS[InjectionType.TEMPLATE],
      },
      {
        enabled: this.config.enablePathTraversalDetection,
        type: InjectionType.PATH_TRAVERSAL,
        patterns: INJECTION_PATTERNS[InjectionType.PATH_TRAVERSAL],
      },
      {
        enabled: this.config.enableLDAPDetection,
        type: InjectionType.LDAP,
        patterns: INJECTION_PATTERNS[InjectionType.LDAP],
      },
      {
        enabled: this.config.enableXMLDetection,
        type: InjectionType.XML,
        patterns: INJECTION_PATTERNS[InjectionType.XML],
      },
      {
        enabled: this.config.enableNoSQLDetection,
        type: InjectionType.NOSQL,
        patterns: INJECTION_PATTERNS[InjectionType.NOSQL],
      },
    ];

    for (const check of detectionChecks) {
      if (!check.enabled) continue;

      for (const pattern of check.patterns) {
        if (pattern.test(input)) {
          if (!detectedTypes.includes(check.type)) {
            detectedTypes.push(check.type);
          }
          matchedPatterns.push(pattern.toString());
          break; // One match per type is enough
        }
      }
    }

    // Check custom patterns
    for (const pattern of this.config.customPatterns) {
      if (pattern.test(input)) {
        matchedPatterns.push(`custom:${pattern.toString()}`);
      }
    }

    const detected = detectedTypes.length > 0 || matchedPatterns.length > detectedTypes.length;

    const result: InjectionDetectionResult = {
      detected,
      types: detectedTypes,
      patterns: matchedPatterns,
    };

    if (detected) {
      result.originalInput = input;
      result.detectedAt = new Date().toISOString();

      if (this.config.logDetections) {
        logger.warn(
          {
            types: detectedTypes,
            patternCount: matchedPatterns.length,
            inputLength: input.length,
            inputPreview: input.substring(0, 100),
          },
          'Injection attack detected'
        );
      }
    }

    return result;
  }

  /**
   * Detect injection attacks in all string values of an object
   *
   * Recursively traverses an object and checks all string values for
   * injection patterns. Returns a map of field paths to detection results.
   *
   * @param obj - The object to analyze
   * @param prefix - Internal prefix for tracking nested paths
   * @returns Map of field paths to their detection results
   *
   * @example
   * ```typescript
   * const results = detector.detectInObject({
   *   username: "admin",
   *   query: "SELECT * FROM users",
   *   nested: { field: "<script>xss</script>" }
   * });
   *
   * for (const [field, result] of results) {
   *   if (result.detected) {
   *     console.log(`Injection in ${field}:`, result.types);
   *   }
   * }
   * ```
   */
  detectInObject(
    obj: Record<string, unknown>,
    prefix = ''
  ): Map<string, InjectionDetectionResult> {
    const results = new Map<string, InjectionDetectionResult>();

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        const result = this.detect(value);
        if (result.detected) {
          results.set(fieldPath, result);
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'string') {
            const result = this.detect(item);
            if (result.detected) {
              results.set(`${fieldPath}[${index}]`, result);
            }
          } else if (typeof item === 'object' && item !== null) {
            const nestedResults = this.detectInObject(
              item as Record<string, unknown>,
              `${fieldPath}[${index}]`
            );
            for (const [nestedPath, nestedResult] of nestedResults) {
              results.set(nestedPath, nestedResult);
            }
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        const nestedResults = this.detectInObject(
          value as Record<string, unknown>,
          fieldPath
        );
        for (const [nestedPath, nestedResult] of nestedResults) {
          results.set(nestedPath, nestedResult);
        }
      }
    }

    return results;
  }

  /**
   * Sanitize an input string by removing or escaping dangerous patterns
   *
   * Applies multiple sanitization techniques to neutralize potential
   * injection attacks while preserving legitimate content where possible.
   *
   * @param input - The string to sanitize
   * @returns Sanitized string
   *
   * @example
   * ```typescript
   * const sanitized = detector.sanitize("<script>alert('xss')</script>Hello");
   * // sanitized === "&lt;script&gt;alert('xss')&lt;/script&gt;Hello"
   * ```
   */
  sanitize(input: string): string {
    let sanitized = input;

    // Remove null bytes
    sanitized = sanitized.replace(/\x00/g, '');
    sanitized = sanitized.replace(/%00/g, '');

    // Remove control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // HTML entity encode special characters (XSS prevention)
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    // Remove SQL comments
    sanitized = sanitized.replace(/--/g, '');
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove backticks (command injection)
    sanitized = sanitized.replace(/`/g, '');

    // Remove shell metacharacters
    sanitized = sanitized.replace(/[;&|]/g, '');

    // Normalize path separators and remove traversal patterns
    sanitized = sanitized.replace(/\.\.\//g, '');
    sanitized = sanitized.replace(/\.\.\\/g, '');

    // Remove template syntax
    sanitized = sanitized.replace(/\{\{/g, '{ {');
    sanitized = sanitized.replace(/\}\}/g, '} }');
    sanitized = sanitized.replace(/<%/g, '&lt;%');
    sanitized = sanitized.replace(/%>/g, '%&gt;');

    // Remove LDAP special characters
    sanitized = sanitized.replace(/[()\\*]/g, '');

    // Normalize unicode to NFC form
    sanitized = sanitized.normalize('NFC');

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  /**
   * Check if an input string is in the allowlist
   *
   * Allowlisted strings bypass injection detection entirely.
   * Use sparingly for known-safe patterns.
   *
   * @param input - The string to check
   * @returns True if the string is allowlisted
   *
   * @example
   * ```typescript
   * const detector = new InjectionDetector({
   *   allowlist: ['SELECT count(*) FROM users']
   * });
   *
   * detector.isAllowlisted('SELECT count(*) FROM users'); // true
   * detector.isAllowlisted('SELECT * FROM users');        // false
   * ```
   */
  isAllowlisted(input: string): boolean {
    return this.allowlistPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Add a pattern to the allowlist at runtime
   *
   * @param pattern - The pattern string to allowlist
   */
  addToAllowlist(pattern: string): void {
    this.config.allowlist.push(pattern);
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.allowlistPatterns.push(new RegExp(`^${escaped}$`, 'i'));
    logger.debug({ pattern }, 'Added pattern to allowlist');
  }

  /**
   * Add a custom detection pattern at runtime
   *
   * @param pattern - The regex pattern to add
   */
  addCustomPattern(pattern: RegExp): void {
    this.config.customPatterns.push(pattern);
    logger.debug({ pattern: pattern.toString() }, 'Added custom detection pattern');
  }

  /**
   * Get the current configuration
   *
   * @returns Current detector configuration
   */
  getConfig(): InjectionDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   *
   * @param updates - Partial configuration updates
   */
  updateConfig(updates: Partial<InjectionDetectorConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.allowlist) {
      this.allowlistPatterns = this.config.allowlist.map((pattern) => {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escaped}$`, 'i');
      });
    }
    logger.debug({ updates: Object.keys(updates) }, 'Updated injection detector config');
  }
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when an injection attack is detected
 */
export class InjectionDetectedError extends ValidationError {
  /** Types of injections detected */
  injectionTypes: InjectionType[];
  /** Detection result details */
  detectionResult: InjectionDetectionResult;

  constructor(
    message: string,
    detectionResult: InjectionDetectionResult,
    field?: string
  ) {
    super(message, 'INJECTION_DETECTED', field);
    this.name = 'InjectionDetectedError';
    this.injectionTypes = detectionResult.types;
    this.detectionResult = detectionResult;
  }
}

// =============================================================================
// Fastify Middleware
// =============================================================================

/**
 * Fastify middleware type
 */
export type FastifyMiddleware = preHandlerHookHandler;

/**
 * Create a Fastify middleware for injection detection
 *
 * Automatically checks request query parameters, body, and headers
 * for injection attacks based on configuration.
 *
 * @param options - Middleware configuration options
 * @returns Fastify preHandler hook function
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createInjectionDetectionMiddleware } from './injection-detector.js';
 *
 * const fastify = Fastify();
 *
 * fastify.addHook('preHandler', createInjectionDetectionMiddleware({
 *   config: {
 *     enableSQLDetection: true,
 *     enableXSSDetection: true,
 *     logDetections: true,
 *     blockOnDetection: true,
 *   },
 *   skipPaths: ['/health', '/metrics'],
 *   checkQuery: true,
 *   checkBody: true,
 *   checkHeaders: false,
 * }));
 * ```
 */
export function createInjectionDetectionMiddleware(
  options: InjectionDetectionMiddlewareOptions = {}
): FastifyMiddleware {
  const detector = new InjectionDetector(options.config);
  const skipPaths = new Set(options.skipPaths ?? []);
  const skipMethods = new Set((options.skipMethods ?? []).map((m) => m.toUpperCase()));
  const skipHeaders = new Set(
    (options.skipHeaders ?? [
      'host',
      'connection',
      'content-length',
      'content-type',
      'accept',
      'accept-encoding',
      'accept-language',
      'user-agent',
      'authorization',
      'cookie',
      'cache-control',
      'pragma',
      'origin',
      'referer',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
    ]).map((h) => h.toLowerCase())
  );

  const checkQuery = options.checkQuery ?? true;
  const checkBody = options.checkBody ?? true;
  const checkHeaders = options.checkHeaders ?? false;

  const errorResponse = options.errorResponse ?? {
    statusCode: 400,
    code: 'INJECTION_DETECTED',
    message: 'Potentially malicious input detected',
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

    const detections: Array<{
      location: string;
      field: string;
      result: InjectionDetectionResult;
    }> = [];

    // Check query parameters
    if (checkQuery && request.query) {
      const queryObj = request.query as Record<string, unknown>;
      const queryResults = detector.detectInObject(queryObj);
      for (const [field, result] of queryResults) {
        detections.push({ location: 'query', field, result });
      }
    }

    // Check request body
    if (checkBody && request.body) {
      if (typeof request.body === 'string') {
        const result = detector.detect(request.body);
        if (result.detected) {
          detections.push({ location: 'body', field: 'body', result });
        }
      } else if (typeof request.body === 'object' && request.body !== null) {
        const bodyResults = detector.detectInObject(
          request.body as Record<string, unknown>
        );
        for (const [field, result] of bodyResults) {
          detections.push({ location: 'body', field, result });
        }
      }
    }

    // Check headers
    if (checkHeaders && request.headers) {
      for (const [headerName, headerValue] of Object.entries(request.headers)) {
        if (skipHeaders.has(headerName.toLowerCase())) {
          continue;
        }

        const values = Array.isArray(headerValue)
          ? headerValue
          : [headerValue];

        for (const value of values) {
          if (typeof value === 'string') {
            const result = detector.detect(value);
            if (result.detected) {
              detections.push({
                location: 'header',
                field: headerName,
                result,
              });
            }
          }
        }
      }
    }

    // Handle detections
    if (detections.length > 0) {
      const config = detector.getConfig();

      if (config.logDetections) {
        logger.warn(
          {
            requestId: request.id,
            method: request.method,
            url: request.url,
            detectionCount: detections.length,
            detections: detections.map((d) => ({
              location: d.location,
              field: d.field,
              types: d.result.types,
            })),
          },
          'Injection attack detected in request'
        );
      }

      if (config.blockOnDetection) {
        return reply.status(errorResponse.statusCode).send({
          error: {
            code: errorResponse.code,
            message: errorResponse.message,
            details: detections.map((d) => ({
              location: d.location,
              field: d.field,
              types: d.result.types,
            })),
          },
        });
      }
    }
  };
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * Fastify plugin options
 */
export interface InjectionDetectionPluginOptions
  extends InjectionDetectionMiddlewareOptions {
  /** Register the detector as a request decorator */
  decorateRequest?: boolean;
}

/**
 * Fastify plugin callback for injection detection
 */
const injectionDetectionPluginCallback: FastifyPluginCallback<
  InjectionDetectionPluginOptions
> = (
  fastify: FastifyInstance,
  options: InjectionDetectionPluginOptions,
  done: (err?: Error) => void
) => {
  try {
    // Create detector instance
    const detector = new InjectionDetector(options.config);

    // Optionally decorate fastify instance with detector
    if (options.decorateRequest !== false) {
      fastify.decorate('injectionDetector', detector);
    }

    // Register the middleware
    fastify.addHook('preHandler', createInjectionDetectionMiddleware(options));

    logger.info(
      {
        skipPaths: options.skipPaths?.length ?? 0,
        checkQuery: options.checkQuery ?? true,
        checkBody: options.checkBody ?? true,
        checkHeaders: options.checkHeaders ?? false,
        blockOnDetection: options.config?.blockOnDetection ?? true,
      },
      'Injection detection plugin registered'
    );

    done();
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Fastify plugin for comprehensive injection detection
 *
 * Provides automatic injection detection on all routes with
 * configurable options.
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { injectionDetectionPlugin } from './injection-detector.js';
 *
 * const fastify = Fastify();
 *
 * await fastify.register(injectionDetectionPlugin, {
 *   config: {
 *     enableSQLDetection: true,
 *     enableXSSDetection: true,
 *     blockOnDetection: true,
 *   },
 *   skipPaths: ['/health', '/metrics'],
 * });
 * ```
 */
export const injectionDetectionPlugin = fp(injectionDetectionPluginCallback, {
  name: 'vorion-injection-detection',
  fastify: '5.x',
});

// Declare Fastify decorator
declare module 'fastify' {
  interface FastifyInstance {
    injectionDetector?: InjectionDetector;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a pre-configured detector for SQL-only detection
 *
 * @returns InjectionDetector configured for SQL injection only
 */
export function createSQLInjectionDetector(): InjectionDetector {
  return new InjectionDetector({
    enableSQLDetection: true,
    enableXSSDetection: false,
    enableCommandDetection: false,
    enableTemplateDetection: false,
    enablePathTraversalDetection: false,
    enableLDAPDetection: false,
    enableXMLDetection: false,
    enableNoSQLDetection: false,
  });
}

/**
 * Create a pre-configured detector for XSS-only detection
 *
 * @returns InjectionDetector configured for XSS detection only
 */
export function createXSSDetector(): InjectionDetector {
  return new InjectionDetector({
    enableSQLDetection: false,
    enableXSSDetection: true,
    enableCommandDetection: false,
    enableTemplateDetection: false,
    enablePathTraversalDetection: false,
    enableLDAPDetection: false,
    enableXMLDetection: false,
    enableNoSQLDetection: false,
  });
}

/**
 * Create a pre-configured detector for API security (SQL, NoSQL, Command)
 *
 * @returns InjectionDetector configured for common API attack vectors
 */
export function createAPISecurityDetector(): InjectionDetector {
  return new InjectionDetector({
    enableSQLDetection: true,
    enableXSSDetection: false,
    enableCommandDetection: true,
    enableTemplateDetection: true,
    enablePathTraversalDetection: true,
    enableLDAPDetection: false,
    enableXMLDetection: true,
    enableNoSQLDetection: true,
  });
}

/**
 * Quick check function for ad-hoc injection detection
 *
 * @param input - String to check
 * @param types - Specific injection types to check (default: all)
 * @returns True if any injection patterns are detected
 *
 * @example
 * ```typescript
 * if (hasInjection(userInput, [InjectionType.SQL, InjectionType.XSS])) {
 *   throw new Error('Invalid input');
 * }
 * ```
 */
export function hasInjection(
  input: string,
  types?: InjectionType[]
): boolean {
  const typesToCheck = types ?? Object.values(InjectionType);

  for (const type of typesToCheck) {
    const patterns = INJECTION_PATTERNS[type];
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Quick sanitize function for ad-hoc input sanitization
 *
 * @param input - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeInput(input: string): string {
  const detector = new InjectionDetector();
  return detector.sanitize(input);
}
