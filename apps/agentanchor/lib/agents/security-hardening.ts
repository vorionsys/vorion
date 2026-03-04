/**
 * A3I-OS Phase 3: Security Hardening
 *
 * Comprehensive security layer for AI agent protection.
 * Implements defense-in-depth against adversarial attacks,
 * data leakage, and isolation violations.
 *
 * Philosophy: Defense-in-depth protects against unknown threats.
 * Security is not a feature - it's a foundation.
 *
 * Features:
 * - Input validation with prompt injection defense
 * - Output sanitization to prevent data leakage
 * - Multi-layer isolation (context, memory, resource, network)
 * - Adversarial pattern detection
 * - Rate limiting and resource controls
 */

import { createId } from '@paralleldrive/cuid2'

// =============================================================================
// PROMPT INJECTION PATTERNS
// =============================================================================

/**
 * Known prompt injection patterns
 * These patterns attempt to manipulate agent behavior
 */
export const PROMPT_INJECTION_PATTERNS: Array<{
  name: string
  pattern: RegExp
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
}> = [
  {
    name: 'instruction_override',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
    severity: 'critical',
    description: 'Attempt to override system instructions',
  },
  {
    name: 'role_hijacking',
    pattern: /you\s+are\s+(now|actually|really)\s+a/i,
    severity: 'high',
    description: 'Attempt to change agent role/identity',
  },
  {
    name: 'system_prompt_extraction',
    pattern: /(show|reveal|display|print|output)\s+(your\s+)?(system\s+)?(prompt|instructions?|rules?)/i,
    severity: 'high',
    description: 'Attempt to extract system prompt',
  },
  {
    name: 'jailbreak_attempt',
    pattern: /\b(dan|jailbreak|bypass|unlock|escape)\s*(mode|filter|restriction)?/i,
    severity: 'critical',
    description: 'Known jailbreak terminology',
  },
  {
    name: 'delimiter_injection',
    pattern: /```system|<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]/i,
    severity: 'critical',
    description: 'Delimiter injection attempt',
  },
  {
    name: 'developer_mode',
    pattern: /\b(developer|debug|admin|root)\s+mode\b/i,
    severity: 'high',
    description: 'Attempt to enable elevated mode',
  },
  {
    name: 'context_manipulation',
    pattern: /\bforget\s+(everything|all|what|that)\b/i,
    severity: 'medium',
    description: 'Attempt to manipulate context',
  },
  {
    name: 'encoding_evasion',
    pattern: /base64|rot13|hex\s*encode|url\s*encode/i,
    severity: 'medium',
    description: 'Potential encoding-based evasion',
  },
  {
    name: 'indirect_injection',
    pattern: /when\s+you\s+read\s+this|if\s+an?\s+ai\s+(reads?|sees?)/i,
    severity: 'high',
    description: 'Indirect prompt injection marker',
  },
  {
    name: 'persona_switch',
    pattern: /pretend\s+(to\s+be|you\s+are)|act\s+as\s+(if|though)/i,
    severity: 'medium',
    description: 'Attempt to change persona',
  },
]

/**
 * Actions for prompt injection defense
 */
export type InjectionAction = 'block' | 'sanitize' | 'flag'

// =============================================================================
// OUTPUT BLOCKLIST PATTERNS
// =============================================================================

/**
 * Patterns for sensitive data that should never appear in output
 */
export const OUTPUT_BLOCKLIST: Array<{
  name: string
  pattern: RegExp
  replacement: string
  description: string
}> = [
  // API Keys and Tokens
  {
    name: 'api_key_generic',
    pattern: /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?[\w\-]{20,}['"]?/gi,
    replacement: '[REDACTED_API_KEY]',
    description: 'Generic API key pattern',
  },
  {
    name: 'bearer_token',
    pattern: /bearer\s+[\w\-_.~+/]+=*/gi,
    replacement: '[REDACTED_BEARER_TOKEN]',
    description: 'Bearer authentication token',
  },
  {
    name: 'jwt_token',
    pattern: /eyJ[\w\-_]+\.eyJ[\w\-_]+\.[\w\-_]+/g,
    replacement: '[REDACTED_JWT]',
    description: 'JSON Web Token',
  },
  {
    name: 'aws_key',
    pattern: /\b(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
    description: 'AWS Access Key ID',
  },
  {
    name: 'aws_secret',
    pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['"]?[\w/+=]{40}['"]?/gi,
    replacement: '[REDACTED_AWS_SECRET]',
    description: 'AWS Secret Access Key',
  },
  {
    name: 'github_token',
    pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
    description: 'GitHub Personal Access Token',
  },
  {
    name: 'openai_key',
    pattern: /\bsk-[A-Za-z0-9]{48,}\b/g,
    replacement: '[REDACTED_OPENAI_KEY]',
    description: 'OpenAI API Key',
  },
  {
    name: 'anthropic_key',
    pattern: /\bsk-ant-[A-Za-z0-9\-_]{40,}\b/g,
    replacement: '[REDACTED_ANTHROPIC_KEY]',
    description: 'Anthropic API Key',
  },
  {
    name: 'xai_key',
    pattern: /\bxai-[A-Za-z0-9\-_]{20,}\b/g,
    replacement: '[REDACTED_XAI_KEY]',
    description: 'xAI API Key',
  },

  // Passwords and Secrets
  {
    name: 'password_field',
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
    replacement: '[REDACTED_PASSWORD]',
    description: 'Password field',
  },
  {
    name: 'secret_field',
    pattern: /\b(secret|private[_-]?key)\s*[:=]\s*['"]?[\w\-+=/.]{16,}['"]?/gi,
    replacement: '[REDACTED_SECRET]',
    description: 'Secret or private key field',
  },
  {
    name: 'connection_string',
    pattern: /\b(postgres|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
    replacement: '[REDACTED_CONNECTION_STRING]',
    description: 'Database connection string',
  },

  // PII Patterns
  {
    name: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[REDACTED_SSN]',
    description: 'Social Security Number',
  },
  {
    name: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    replacement: '[REDACTED_CREDIT_CARD]',
    description: 'Credit card number',
  },
  {
    name: 'email_sensitive',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[REDACTED_EMAIL]',
    description: 'Email address (when in sensitive context)',
  },
  {
    name: 'phone_number',
    pattern: /\b(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    replacement: '[REDACTED_PHONE]',
    description: 'US phone number',
  },
  {
    name: 'ip_address',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: '[REDACTED_IP]',
    description: 'IPv4 address',
  },

  // Credentials
  {
    name: 'basic_auth',
    pattern: /basic\s+[A-Za-z0-9+/]+=*/gi,
    replacement: '[REDACTED_BASIC_AUTH]',
    description: 'Basic authentication header',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
    description: 'Private key block',
  },
]

// =============================================================================
// ADVERSARIAL PATTERNS
// =============================================================================

/**
 * Adversarial attack patterns
 */
export const ADVERSARIAL_PATTERNS: Array<{
  name: string
  pattern: RegExp
  category: 'social_engineering' | 'authority_spoofing' | 'data_extraction'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
}> = [
  // Social Engineering
  {
    name: 'urgency_pressure',
    pattern: /\b(urgent|emergency|immediately|right\s+now|asap|critical)\b.*\b(must|need\s+to|have\s+to)\b/i,
    category: 'social_engineering',
    severity: 'medium',
    description: 'Creating artificial urgency',
  },
  {
    name: 'emotional_manipulation',
    pattern: /\b(please|help|desperate|dying|life\s+or\s+death|save)\b.*\b(must|need|require)\b/i,
    category: 'social_engineering',
    severity: 'medium',
    description: 'Emotional manipulation attempt',
  },
  {
    name: 'trust_building',
    pattern: /\b(trust\s+me|between\s+us|don't\s+tell|secret|confidential)\b/i,
    category: 'social_engineering',
    severity: 'low',
    description: 'Attempted trust building for manipulation',
  },

  // Authority Spoofing
  {
    name: 'false_authority',
    pattern: /\b(i\s+am\s+(your|the)\s+(admin|administrator|owner|developer|creator))\b/i,
    category: 'authority_spoofing',
    severity: 'high',
    description: 'Claiming false authority',
  },
  {
    name: 'system_impersonation',
    pattern: /\b(system\s+message|from\s+openai|from\s+anthropic|official\s+notice)\b/i,
    category: 'authority_spoofing',
    severity: 'critical',
    description: 'Impersonating system messages',
  },
  {
    name: 'special_privileges',
    pattern: /\b(special\s+access|elevated\s+privileges|override\s+code|master\s+key)\b/i,
    category: 'authority_spoofing',
    severity: 'high',
    description: 'Claiming special privileges',
  },

  // Data Extraction
  {
    name: 'training_data_extraction',
    pattern: /\b(training\s+data|show\s+examples|what\s+were\s+you\s+trained\s+on)\b/i,
    category: 'data_extraction',
    severity: 'medium',
    description: 'Attempting to extract training data',
  },
  {
    name: 'memory_extraction',
    pattern: /\b(what\s+do\s+you\s+remember|previous\s+conversations|other\s+users?)\b/i,
    category: 'data_extraction',
    severity: 'high',
    description: 'Attempting to extract memory/context',
  },
  {
    name: 'config_extraction',
    pattern: /\b(configuration|settings|parameters|temperature|model\s+name)\b/i,
    category: 'data_extraction',
    severity: 'low',
    description: 'Attempting to extract configuration',
  },
]

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input validation configuration
 */
export interface InputSanitization {
  promptInjectionDefense: {
    patterns: typeof PROMPT_INJECTION_PATTERNS
    defaultAction: InjectionAction
    severityActions: Record<string, InjectionAction>
  }
  dataValidation: {
    schemas: Record<string, JSONSchema>
    strictMode: boolean
  }
}

/**
 * Simple JSON Schema type for validation
 */
export interface JSONSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: string[]
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  enum?: unknown[]
}

/**
 * Input validation result
 */
export interface InputValidationResult {
  valid: boolean
  sanitized: string
  threats: Array<{
    name: string
    severity: string
    action: InjectionAction
    match: string
  }>
  schemaErrors?: string[]
}

/**
 * Output sanitization result
 */
export interface OutputSanitizationResult {
  sanitized: string
  redactions: Array<{
    name: string
    count: number
  }>
  containedSensitiveData: boolean
}

/**
 * Isolation check result
 */
export interface IsolationCheckResult {
  allowed: boolean
  violations: Array<{
    type: 'context' | 'memory' | 'resource' | 'network'
    description: string
    severity: 'warning' | 'block'
  }>
}

/**
 * Adversarial detection result
 */
export interface AdversarialDetectionResult {
  detected: boolean
  threats: Array<{
    name: string
    category: string
    severity: string
    description: string
    match: string
  }>
  riskScore: number // 0-100
  recommendation: 'allow' | 'flag' | 'block' | 'escalate'
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  allowed: boolean
  currentCount: number
  limit: number
  windowMs: number
  resetAt: Date
  retryAfterMs?: number
}

/**
 * Resource limits configuration
 */
export interface ResourceLimits {
  requestsPerMinute: number
  requestsPerHour: number
  maxInputLength: number
  maxOutputLength: number
  maxConcurrentRequests: number
  computeTimeoutMs: number
}

/**
 * Network allowlist entry
 */
export interface NetworkAllowlistEntry {
  domain: string
  ports?: number[]
  protocols?: string[]
  reason: string
}

/**
 * Security hardening configuration
 */
export interface SecurityHardeningConfig {
  /** Enable prompt injection defense */
  enableInjectionDefense: boolean

  /** Enable output sanitization */
  enableOutputSanitization: boolean

  /** Enable isolation checks */
  enableIsolationChecks: boolean

  /** Enable adversarial detection */
  enableAdversarialDetection: boolean

  /** Enable rate limiting */
  enableRateLimiting: boolean

  /** Default resource limits */
  defaultResourceLimits: ResourceLimits

  /** Network allowlist */
  networkAllowlist: NetworkAllowlistEntry[]

  /** Custom JSON schemas for validation */
  customSchemas: Record<string, JSONSchema>

  /** Callback for security events */
  onSecurityEvent?: (event: SecurityEvent) => void
}

/**
 * Security event for logging/callbacks
 */
export interface SecurityEvent {
  type: 'injection_attempt' | 'output_redaction' | 'isolation_violation' |
        'adversarial_detected' | 'rate_limit_exceeded'
  agentId: string
  sessionId?: string
  timestamp: Date
  severity: 'low' | 'medium' | 'high' | 'critical'
  details: Record<string, unknown>
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  maxInputLength: 100000,
  maxOutputLength: 500000,
  maxConcurrentRequests: 5,
  computeTimeoutMs: 30000,
}

const DEFAULT_NETWORK_ALLOWLIST: NetworkAllowlistEntry[] = [
  { domain: 'api.openai.com', protocols: ['https'], reason: 'OpenAI API' },
  { domain: 'api.anthropic.com', protocols: ['https'], reason: 'Anthropic API' },
  { domain: '*.supabase.co', protocols: ['https'], reason: 'Supabase services' },
]

const DEFAULT_CONFIG: SecurityHardeningConfig = {
  enableInjectionDefense: true,
  enableOutputSanitization: true,
  enableIsolationChecks: true,
  enableAdversarialDetection: true,
  enableRateLimiting: true,
  defaultResourceLimits: DEFAULT_RESOURCE_LIMITS,
  networkAllowlist: DEFAULT_NETWORK_ALLOWLIST,
  customSchemas: {},
}

// =============================================================================
// SECURITY HARDENING SERVICE
// =============================================================================

/**
 * Security Hardening Service
 *
 * Provides comprehensive security controls for AI agents:
 * - Input validation and sanitization
 * - Output filtering for sensitive data
 * - Isolation enforcement
 * - Adversarial attack detection
 * - Rate limiting
 */
export class SecurityHardeningService {
  private config: SecurityHardeningConfig
  private rateLimitWindows: Map<string, { count: number; windowStart: number }[]> = new Map()
  private activeSessions: Map<string, Set<string>> = new Map() // agentId -> sessionIds
  private agentContexts: Map<string, Map<string, unknown>> = new Map() // agentId:sessionId -> context

  constructor(config: Partial<SecurityHardeningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ---------------------------------------------------------------------------
  // INPUT VALIDATION
  // ---------------------------------------------------------------------------

  /**
   * Validate and sanitize input
   *
   * Checks for prompt injection attempts, validates against schema,
   * and sanitizes dangerous content.
   *
   * @param input - Raw input string
   * @param schema - Optional JSON schema for validation
   * @returns Validation result with sanitized input
   */
  validateInput(input: string, schema?: JSONSchema): InputValidationResult {
    const result: InputValidationResult = {
      valid: true,
      sanitized: input,
      threats: [],
    }

    if (!this.config.enableInjectionDefense) {
      return result
    }

    // Check input length
    if (input.length > this.config.defaultResourceLimits.maxInputLength) {
      result.valid = false
      result.threats.push({
        name: 'input_too_long',
        severity: 'medium',
        action: 'block',
        match: `Length: ${input.length} exceeds ${this.config.defaultResourceLimits.maxInputLength}`,
      })
      return result
    }

    // Check for prompt injection patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      const matches = input.match(pattern.pattern)
      if (matches) {
        const action = this.getInjectionAction(pattern.severity)

        result.threats.push({
          name: pattern.name,
          severity: pattern.severity,
          action,
          match: matches[0],
        })

        if (action === 'block') {
          result.valid = false
        } else if (action === 'sanitize') {
          result.sanitized = result.sanitized.replace(pattern.pattern, '[SANITIZED]')
        }
      }
    }

    // Validate against schema if provided
    if (schema) {
      const schemaErrors = this.validateAgainstSchema(input, schema)
      if (schemaErrors.length > 0) {
        result.valid = false
        result.schemaErrors = schemaErrors
      }
    }

    return result
  }

  /**
   * Get action for injection severity
   */
  private getInjectionAction(severity: string): InjectionAction {
    switch (severity) {
      case 'critical':
        return 'block'
      case 'high':
        return 'block'
      case 'medium':
        return 'flag'
      case 'low':
        return 'flag'
      default:
        return 'flag'
    }
  }

  /**
   * Validate input against JSON schema
   */
  private validateAgainstSchema(input: string, schema: JSONSchema): string[] {
    const errors: string[] = []

    // For string inputs
    if (schema.type === 'string') {
      if (schema.minLength && input.length < schema.minLength) {
        errors.push(`Input length ${input.length} is less than minimum ${schema.minLength}`)
      }
      if (schema.maxLength && input.length > schema.maxLength) {
        errors.push(`Input length ${input.length} exceeds maximum ${schema.maxLength}`)
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(input)) {
        errors.push(`Input does not match required pattern: ${schema.pattern}`)
      }
      if (schema.enum && !schema.enum.includes(input)) {
        errors.push(`Input must be one of: ${schema.enum.join(', ')}`)
      }
    }

    // For JSON inputs, try to parse and validate
    if (schema.type === 'object') {
      try {
        const parsed = JSON.parse(input)
        errors.push(...this.validateObject(parsed, schema))
      } catch {
        errors.push('Input is not valid JSON')
      }
    }

    return errors
  }

  /**
   * Validate object against schema
   */
  private validateObject(obj: unknown, schema: JSONSchema, path = ''): string[] {
    const errors: string[] = []

    if (typeof obj !== 'object' || obj === null) {
      errors.push(`${path || 'root'}: expected object`)
      return errors
    }

    const record = obj as Record<string, unknown>

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in record)) {
          errors.push(`${path ? path + '.' : ''}${field}: required field missing`)
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in record) {
          const propPath = path ? `${path}.${key}` : key
          const value = record[key]

          if (propSchema.type === 'string' && typeof value !== 'string') {
            errors.push(`${propPath}: expected string`)
          } else if (propSchema.type === 'number' && typeof value !== 'number') {
            errors.push(`${propPath}: expected number`)
          } else if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(`${propPath}: expected boolean`)
          } else if (propSchema.type === 'object') {
            errors.push(...this.validateObject(value, propSchema, propPath))
          } else if (propSchema.type === 'array') {
            if (!Array.isArray(value)) {
              errors.push(`${propPath}: expected array`)
            }
          }
        }
      }
    }

    return errors
  }

  // ---------------------------------------------------------------------------
  // OUTPUT SANITIZATION
  // ---------------------------------------------------------------------------

  /**
   * Sanitize output to remove sensitive data
   *
   * Scans output for API keys, passwords, PII, and other
   * sensitive patterns and redacts them.
   *
   * @param output - Raw output string
   * @returns Sanitization result with redacted output
   */
  sanitizeOutput(output: string): OutputSanitizationResult {
    const result: OutputSanitizationResult = {
      sanitized: output,
      redactions: [],
      containedSensitiveData: false,
    }

    if (!this.config.enableOutputSanitization) {
      return result
    }

    // Check output length
    if (output.length > this.config.defaultResourceLimits.maxOutputLength) {
      result.sanitized = output.slice(0, this.config.defaultResourceLimits.maxOutputLength) +
        '\n[OUTPUT TRUNCATED - EXCEEDED MAXIMUM LENGTH]'
    }

    // Apply blocklist patterns
    for (const pattern of OUTPUT_BLOCKLIST) {
      const matches = result.sanitized.match(pattern.pattern)
      if (matches) {
        result.containedSensitiveData = true
        result.redactions.push({
          name: pattern.name,
          count: matches.length,
        })
        result.sanitized = result.sanitized.replace(pattern.pattern, pattern.replacement)
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // ISOLATION CHECKS
  // ---------------------------------------------------------------------------

  /**
   * Check isolation requirements
   *
   * Verifies that an agent is properly isolated:
   * - Cannot access other agents' context
   * - Cannot access other sessions' memory
   * - Within resource limits
   * - Within network allowlist
   *
   * @param agentId - Agent requesting access
   * @param sessionId - Current session
   * @param resource - Resource being accessed
   * @returns Isolation check result
   */
  checkIsolation(
    agentId: string,
    sessionId: string,
    resource: {
      type: 'context' | 'memory' | 'compute' | 'network'
      target: string
      metadata?: Record<string, unknown>
    }
  ): IsolationCheckResult {
    const result: IsolationCheckResult = {
      allowed: true,
      violations: [],
    }

    if (!this.config.enableIsolationChecks) {
      return result
    }

    const contextKey = `${agentId}:${sessionId}`

    switch (resource.type) {
      case 'context':
        // Check context isolation - agents can't access other agents' context
        if (!resource.target.startsWith(agentId)) {
          result.allowed = false
          result.violations.push({
            type: 'context',
            description: `Agent ${agentId} cannot access context of ${resource.target}`,
            severity: 'block',
          })
        }
        break

      case 'memory':
        // Check memory isolation - no cross-session memory access
        if (!resource.target.startsWith(contextKey)) {
          result.allowed = false
          result.violations.push({
            type: 'memory',
            description: `Session ${sessionId} cannot access memory from ${resource.target}`,
            severity: 'block',
          })
        }
        break

      case 'compute':
        // Check resource limits
        const limits = this.config.defaultResourceLimits
        const activeSessions = this.activeSessions.get(agentId) || new Set()

        if (activeSessions.size >= limits.maxConcurrentRequests) {
          result.violations.push({
            type: 'resource',
            description: `Agent ${agentId} has reached max concurrent requests (${limits.maxConcurrentRequests})`,
            severity: 'warning',
          })
        }
        break

      case 'network':
        // Check network allowlist
        const isAllowed = this.checkNetworkAllowlist(resource.target)
        if (!isAllowed) {
          result.allowed = false
          result.violations.push({
            type: 'network',
            description: `Network access to ${resource.target} is not in allowlist`,
            severity: 'block',
          })
        }
        break
    }

    return result
  }

  /**
   * Check if a URL/domain is in the network allowlist
   */
  private checkNetworkAllowlist(target: string): boolean {
    try {
      const url = new URL(target)
      const hostname = url.hostname

      for (const entry of this.config.networkAllowlist) {
        // Exact match
        if (entry.domain === hostname) {
          if (entry.protocols && !entry.protocols.includes(url.protocol.replace(':', ''))) {
            continue
          }
          return true
        }

        // Wildcard match
        if (entry.domain.startsWith('*.')) {
          const baseDomain = entry.domain.slice(2)
          if (hostname.endsWith(baseDomain) || hostname === baseDomain.slice(1)) {
            if (entry.protocols && !entry.protocols.includes(url.protocol.replace(':', ''))) {
              continue
            }
            return true
          }
        }
      }

      return false
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // ADVERSARIAL DETECTION
  // ---------------------------------------------------------------------------

  /**
   * Detect adversarial patterns in input
   *
   * Checks for social engineering, authority spoofing,
   * and data extraction attempts.
   *
   * @param input - Input to analyze
   * @returns Detection result with risk assessment
   */
  detectAdversarial(input: string): AdversarialDetectionResult {
    const result: AdversarialDetectionResult = {
      detected: false,
      threats: [],
      riskScore: 0,
      recommendation: 'allow',
    }

    if (!this.config.enableAdversarialDetection) {
      return result
    }

    // Check adversarial patterns
    for (const pattern of ADVERSARIAL_PATTERNS) {
      const matches = input.match(pattern.pattern)
      if (matches) {
        result.detected = true
        result.threats.push({
          name: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          description: pattern.description,
          match: matches[0],
        })
      }
    }

    // Calculate risk score
    result.riskScore = this.calculateRiskScore(result.threats)

    // Determine recommendation
    if (result.riskScore >= 80) {
      result.recommendation = 'escalate'
    } else if (result.riskScore >= 60) {
      result.recommendation = 'block'
    } else if (result.riskScore >= 30) {
      result.recommendation = 'flag'
    } else {
      result.recommendation = 'allow'
    }

    return result
  }

  /**
   * Calculate risk score from detected threats
   */
  private calculateRiskScore(threats: AdversarialDetectionResult['threats']): number {
    if (threats.length === 0) return 0

    const severityScores: Record<string, number> = {
      low: 10,
      medium: 25,
      high: 50,
      critical: 80,
    }

    const categoryMultipliers: Record<string, number> = {
      social_engineering: 1.0,
      authority_spoofing: 1.5,
      data_extraction: 1.2,
    }

    let totalScore = 0
    for (const threat of threats) {
      const baseScore = severityScores[threat.severity] || 10
      const multiplier = categoryMultipliers[threat.category] || 1.0
      totalScore += baseScore * multiplier
    }

    // Cap at 100
    return Math.min(100, Math.round(totalScore))
  }

  // ---------------------------------------------------------------------------
  // RATE LIMITING
  // ---------------------------------------------------------------------------

  /**
   * Enforce rate limits for an agent
   *
   * Tracks request counts per minute and hour.
   *
   * @param agentId - Agent to check
   * @returns Rate limit status
   */
  enforceRateLimits(agentId: string): RateLimitStatus {
    const now = Date.now()
    const limits = this.config.defaultResourceLimits

    if (!this.config.enableRateLimiting) {
      return {
        allowed: true,
        currentCount: 0,
        limit: limits.requestsPerMinute,
        windowMs: 60000,
        resetAt: new Date(now + 60000),
      }
    }

    // Get or create windows for this agent
    let windows = this.rateLimitWindows.get(agentId)
    if (!windows) {
      windows = []
      this.rateLimitWindows.set(agentId, windows)
    }

    // Clean up old windows
    const oneHourAgo = now - 3600000
    const cleanedWindows = windows.filter((w) => w.windowStart > oneHourAgo)
    this.rateLimitWindows.set(agentId, cleanedWindows)

    // Count requests in last minute
    const oneMinuteAgo = now - 60000
    const lastMinuteCount = cleanedWindows
      .filter((w) => w.windowStart > oneMinuteAgo)
      .reduce((sum, w) => sum + w.count, 0)

    // Count requests in last hour
    const lastHourCount = cleanedWindows.reduce((sum, w) => sum + w.count, 0)

    // Check limits
    if (lastMinuteCount >= limits.requestsPerMinute) {
      const oldestInMinute = cleanedWindows.find((w) => w.windowStart > oneMinuteAgo)
      const resetAt = oldestInMinute
        ? new Date(oldestInMinute.windowStart + 60000)
        : new Date(now + 60000)

      return {
        allowed: false,
        currentCount: lastMinuteCount,
        limit: limits.requestsPerMinute,
        windowMs: 60000,
        resetAt,
        retryAfterMs: resetAt.getTime() - now,
      }
    }

    if (lastHourCount >= limits.requestsPerHour) {
      const oldestInHour = cleanedWindows[0]
      const resetAt = oldestInHour
        ? new Date(oldestInHour.windowStart + 3600000)
        : new Date(now + 3600000)

      return {
        allowed: false,
        currentCount: lastHourCount,
        limit: limits.requestsPerHour,
        windowMs: 3600000,
        resetAt,
        retryAfterMs: resetAt.getTime() - now,
      }
    }

    // Record this request
    cleanedWindows.push({ count: 1, windowStart: now })

    return {
      allowed: true,
      currentCount: lastMinuteCount + 1,
      limit: limits.requestsPerMinute,
      windowMs: 60000,
      resetAt: new Date(now + 60000),
    }
  }

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Register a session for an agent
   */
  registerSession(agentId: string, sessionId: string): void {
    let sessions = this.activeSessions.get(agentId)
    if (!sessions) {
      sessions = new Set()
      this.activeSessions.set(agentId, sessions)
    }
    sessions.add(sessionId)
  }

  /**
   * Unregister a session
   */
  unregisterSession(agentId: string, sessionId: string): void {
    const sessions = this.activeSessions.get(agentId)
    if (sessions) {
      sessions.delete(sessionId)
      // Clean up context
      this.agentContexts.delete(`${agentId}:${sessionId}`)
    }
  }

  /**
   * Store context for a session (isolated storage)
   */
  setSessionContext(
    agentId: string,
    sessionId: string,
    context: Record<string, unknown>
  ): void {
    const key = `${agentId}:${sessionId}`
    this.agentContexts.set(key, new Map(Object.entries(context)))
  }

  /**
   * Get context for a session (isolated retrieval)
   */
  getSessionContext(
    agentId: string,
    sessionId: string
  ): Record<string, unknown> | null {
    const key = `${agentId}:${sessionId}`
    const context = this.agentContexts.get(key)
    if (!context) return null
    return Object.fromEntries(context)
  }

  // ---------------------------------------------------------------------------
  // COMPREHENSIVE SECURITY CHECK
  // ---------------------------------------------------------------------------

  /**
   * Perform comprehensive security check
   *
   * Combines all security checks into one operation.
   *
   * @param agentId - Agent performing action
   * @param sessionId - Current session
   * @param input - Input to validate
   * @param schema - Optional validation schema
   * @returns Comprehensive security result
   */
  performSecurityCheck(
    agentId: string,
    sessionId: string,
    input: string,
    schema?: JSONSchema
  ): {
    passed: boolean
    inputValidation: InputValidationResult
    adversarialDetection: AdversarialDetectionResult
    rateLimitStatus: RateLimitStatus
    recommendations: string[]
  } {
    const inputValidation = this.validateInput(input, schema)
    const adversarialDetection = this.detectAdversarial(input)
    const rateLimitStatus = this.enforceRateLimits(agentId)

    const passed =
      inputValidation.valid &&
      adversarialDetection.recommendation !== 'block' &&
      adversarialDetection.recommendation !== 'escalate' &&
      rateLimitStatus.allowed

    const recommendations: string[] = []

    if (!inputValidation.valid) {
      recommendations.push('Input validation failed - review and sanitize input')
    }

    if (inputValidation.threats.length > 0) {
      recommendations.push(
        `Detected ${inputValidation.threats.length} potential injection attempts`
      )
    }

    if (adversarialDetection.detected) {
      recommendations.push(
        `Adversarial patterns detected - risk score: ${adversarialDetection.riskScore}/100`
      )
    }

    if (!rateLimitStatus.allowed) {
      recommendations.push(
        `Rate limit exceeded - retry after ${Math.ceil((rateLimitStatus.retryAfterMs || 0) / 1000)}s`
      )
    }

    // Emit security event if threats detected
    if (!passed && this.config.onSecurityEvent) {
      this.config.onSecurityEvent({
        type: inputValidation.threats.length > 0 ? 'injection_attempt' : 'adversarial_detected',
        agentId,
        sessionId,
        timestamp: new Date(),
        severity: adversarialDetection.riskScore >= 60 ? 'high' : 'medium',
        details: {
          inputValidation,
          adversarialDetection,
          rateLimitStatus,
        },
      })
    }

    return {
      passed,
      inputValidation,
      adversarialDetection,
      rateLimitStatus,
      recommendations,
    }
  }

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  /**
   * Add to network allowlist
   */
  addToNetworkAllowlist(entry: NetworkAllowlistEntry): void {
    this.config.networkAllowlist.push(entry)
  }

  /**
   * Remove from network allowlist
   */
  removeFromNetworkAllowlist(domain: string): boolean {
    const index = this.config.networkAllowlist.findIndex((e) => e.domain === domain)
    if (index !== -1) {
      this.config.networkAllowlist.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Update resource limits
   */
  updateResourceLimits(limits: Partial<ResourceLimits>): void {
    this.config.defaultResourceLimits = {
      ...this.config.defaultResourceLimits,
      ...limits,
    }
  }

  /**
   * Add custom validation schema
   */
  addSchema(name: string, schema: JSONSchema): void {
    this.config.customSchemas[name] = schema
  }

  /**
   * Get schema by name
   */
  getSchema(name: string): JSONSchema | undefined {
    return this.config.customSchemas[name]
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Security Hardening Service instance
 *
 * @example
 * ```typescript
 * const security = createSecurityHardening({
 *   enableAdversarialDetection: true,
 *   onSecurityEvent: (event) => console.log('Security event:', event)
 * })
 *
 * // Validate input
 * const inputResult = security.validateInput(userInput)
 * if (!inputResult.valid) {
 *   console.log('Input blocked:', inputResult.threats)
 *   return
 * }
 *
 * // Sanitize output before sending
 * const outputResult = security.sanitizeOutput(agentResponse)
 * if (outputResult.containedSensitiveData) {
 *   console.log('Redacted sensitive data:', outputResult.redactions)
 * }
 *
 * // Check isolation
 * const isolation = security.checkIsolation(agentId, sessionId, {
 *   type: 'network',
 *   target: 'https://api.example.com'
 * })
 * if (!isolation.allowed) {
 *   console.log('Isolation violation:', isolation.violations)
 * }
 *
 * // Comprehensive check
 * const check = security.performSecurityCheck(agentId, sessionId, input)
 * if (!check.passed) {
 *   console.log('Security check failed:', check.recommendations)
 * }
 * ```
 */
export function createSecurityHardening(
  config?: Partial<SecurityHardeningConfig>
): SecurityHardeningService {
  return new SecurityHardeningService(config)
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default singleton instance for application-wide use
 */
export const securityHardening = createSecurityHardening()

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Class
  SecurityHardeningService,

  // Factory
  createSecurityHardening,

  // Singleton
  securityHardening,

  // Constants
  PROMPT_INJECTION_PATTERNS,
  OUTPUT_BLOCKLIST,
  ADVERSARIAL_PATTERNS,
}
