/**
 * Rule Evaluator
 *
 * Evaluates policy rules and determines enforcement actions.
 * Supports all rule types: MFA, approval, block, rate-limit, encryption, audit, etc.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type {
  PolicyRule,
  PolicyContext,
  RuleEvaluationResult,
  MFARule,
  ApprovalRule,
  BlockAccessRule,
  RateLimitRule,
  EncryptionRule,
  AuditLogRule,
  StepUpAuthRule,
  DataMaskingRule,
  SessionTimeoutRule,
  GeoRestrictionRule,
  CustomRule,
} from './types.js';

const logger = createLogger({ component: 'rule-evaluator' });

/**
 * Rate limiter interface
 */
export interface RateLimiter {
  check(key: string, limit: number, window: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
  increment(key: string, window: number): Promise<void>;
}

/**
 * Geo location provider interface
 */
export interface GeoLocationProvider {
  lookup(ip: string): Promise<{ country?: string; region?: string; city?: string } | null>;
}

/**
 * Custom rule handler type
 */
export type CustomRuleHandler = (
  rule: CustomRule,
  context: PolicyContext
) => Promise<RuleEvaluationResult>;

/**
 * Rule evaluator options
 */
export interface RuleEvaluatorOptions {
  /** Rate limiter implementation */
  rateLimiter?: RateLimiter;
  /** Geo location provider */
  geoLocationProvider?: GeoLocationProvider;
  /** Custom rule handlers */
  customHandlers?: Map<string, CustomRuleHandler>;
  /** Default MFA timeout in seconds */
  defaultMfaTimeout?: number;
  /** Default approval timeout in seconds */
  defaultApprovalTimeout?: number;
  /** Default session idle timeout in seconds */
  defaultSessionIdleTimeout?: number;
}

/**
 * RuleEvaluator class
 */
export class RuleEvaluator {
  private rateLimiter?: RateLimiter;
  private geoLocationProvider?: GeoLocationProvider;
  private customHandlers: Map<string, CustomRuleHandler>;
  private defaultMfaTimeout: number;
  private defaultApprovalTimeout: number;
  private defaultSessionIdleTimeout: number;

  constructor(options: RuleEvaluatorOptions = {}) {
    this.rateLimiter = options.rateLimiter;
    this.geoLocationProvider = options.geoLocationProvider;
    this.customHandlers = options.customHandlers ?? new Map();
    this.defaultMfaTimeout = options.defaultMfaTimeout ?? 300;
    this.defaultApprovalTimeout = options.defaultApprovalTimeout ?? 3600;
    this.defaultSessionIdleTimeout = options.defaultSessionIdleTimeout ?? 1800;
  }

  /**
   * Evaluate a rule against the context
   */
  async evaluate(rule: PolicyRule, context: PolicyContext): Promise<RuleEvaluationResult> {
    try {
      if (!rule.enforced) {
        return {
          ruleType: rule.type,
          enforced: false,
          passed: true,
          reason: 'Rule is not enforced',
        };
      }

      switch (rule.type) {
        case 'require_mfa':
          return this.evaluateMFA(rule, context);
        case 'require_approval':
          return this.evaluateApproval(rule, context);
        case 'block_access':
          return this.evaluateBlockAccess(rule, context);
        case 'rate_limit':
          return this.evaluateRateLimit(rule, context);
        case 'require_encryption':
          return this.evaluateEncryption(rule, context);
        case 'audit_log':
          return this.evaluateAuditLog(rule, context);
        case 'step_up_auth':
          return this.evaluateStepUpAuth(rule, context);
        case 'data_masking':
          return this.evaluateDataMasking(rule, context);
        case 'session_timeout':
          return this.evaluateSessionTimeout(rule, context);
        case 'geo_restriction':
          return this.evaluateGeoRestriction(rule, context);
        case 'custom':
          return this.evaluateCustom(rule, context);
        default:
          return {
            ruleType: (rule as PolicyRule).type,
            enforced: true,
            passed: false,
            reason: `Unknown rule type: ${(rule as PolicyRule).type}`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ rule, error: message }, 'Rule evaluation failed');
      return {
        ruleType: rule.type,
        enforced: true,
        passed: false,
        reason: `Evaluation error: ${message}`,
      };
    }
  }

  /**
   * Evaluate all rules and return results
   */
  async evaluateAll(
    rules: PolicyRule[],
    context: PolicyContext
  ): Promise<RuleEvaluationResult[]> {
    const results: RuleEvaluationResult[] = [];

    for (const rule of rules) {
      const result = await this.evaluate(rule, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluate MFA requirement
   */
  private evaluateMFA(rule: MFARule, context: PolicyContext): RuleEvaluationResult {
    const user = context.user;

    // Check if MFA has been verified
    if (!user?.mfaVerified) {
      return {
        ruleType: 'require_mfa',
        enforced: true,
        passed: false,
        reason: 'MFA verification required',
        metadata: {
          methods: rule.methods,
          timeout: rule.timeout ?? this.defaultMfaTimeout,
        },
      };
    }

    // Check if MFA is still valid (within timeout)
    if (rule.timeout && user.lastMfaAt) {
      const lastMfaTime = new Date(user.lastMfaAt).getTime();
      const now = Date.now();
      const timeoutMs = (rule.timeout ?? this.defaultMfaTimeout) * 1000;

      if (now - lastMfaTime > timeoutMs) {
        return {
          ruleType: 'require_mfa',
          enforced: true,
          passed: false,
          reason: 'MFA verification expired',
          metadata: {
            expiredAt: new Date(lastMfaTime + timeoutMs).toISOString(),
          },
        };
      }
    }

    return {
      ruleType: 'require_mfa',
      enforced: true,
      passed: true,
      reason: 'MFA verification passed',
    };
  }

  /**
   * Evaluate approval requirement
   */
  private evaluateApproval(rule: ApprovalRule, context: PolicyContext): RuleEvaluationResult {
    // Check if approval has been granted (would be in custom context)
    const approved = context.custom?.approvalGranted === true;
    const approvalId = context.custom?.approvalId as string | undefined;

    if (approved && approvalId) {
      return {
        ruleType: 'require_approval',
        enforced: true,
        passed: true,
        reason: 'Approval granted',
        metadata: { approvalId },
      };
    }

    return {
      ruleType: 'require_approval',
      enforced: true,
      passed: false,
      reason: 'Approval required',
      metadata: {
        approvers: rule.approvers,
        approverRoles: rule.approverRoles,
        timeout: rule.approvalTimeout ?? this.defaultApprovalTimeout,
        minApprovers: rule.minApprovers ?? 1,
        requireJustification: rule.requireJustification ?? false,
      },
    };
  }

  /**
   * Evaluate block access rule
   */
  private evaluateBlockAccess(rule: BlockAccessRule, context: PolicyContext): RuleEvaluationResult {
    // Block access rules always fail when enforced
    return {
      ruleType: 'block_access',
      enforced: true,
      passed: false,
      reason: rule.reason ?? 'Access blocked by policy',
      metadata: {
        errorCode: rule.errorCode,
        redirectUrl: rule.redirectUrl,
      },
    };
  }

  /**
   * Evaluate rate limit rule
   */
  private async evaluateRateLimit(rule: RateLimitRule, context: PolicyContext): Promise<RuleEvaluationResult> {
    if (!this.rateLimiter) {
      logger.warn('Rate limiter not configured, skipping rate limit rule');
      return {
        ruleType: 'rate_limit',
        enforced: true,
        passed: true,
        reason: 'Rate limiter not configured',
      };
    }

    // Build rate limit key
    const keyParts: string[] = ['policy-rl'];

    const keyBy = rule.keyBy ?? ['user'];
    for (const keyType of keyBy) {
      switch (keyType) {
        case 'user':
          if (context.user?.id) keyParts.push(`u:${context.user.id}`);
          break;
        case 'ip':
          keyParts.push(`ip:${context.request.ip}`);
          break;
        case 'tenant':
          if (context.user?.tenant) keyParts.push(`t:${context.user.tenant}`);
          break;
        case 'api_key':
          const apiKey = context.request.headers?.['x-api-key'];
          if (typeof apiKey === 'string') keyParts.push(`ak:${apiKey.slice(0, 8)}`);
          break;
        case 'custom':
          if (rule.customKey) {
            const customValue = this.getNestedValue(context, rule.customKey);
            if (customValue) keyParts.push(`c:${String(customValue)}`);
          }
          break;
      }
    }

    const key = keyParts.join(':');

    // Calculate window in seconds
    const windowMultiplier = {
      second: 1,
      minute: 60,
      hour: 3600,
      day: 86400,
    };
    const windowSeconds = rule.window * (windowMultiplier[rule.windowUnit ?? 'second'] ?? 1);

    try {
      const result = await this.rateLimiter.check(key, rule.limit, windowSeconds);

      if (!result.allowed) {
        return {
          ruleType: 'rate_limit',
          enforced: true,
          passed: false,
          reason: 'Rate limit exceeded',
          metadata: {
            limit: rule.limit,
            remaining: result.remaining,
            resetAt: result.resetAt,
            retryAfter: rule.retryAfter ?? Math.ceil((result.resetAt - Date.now()) / 1000),
          },
        };
      }

      return {
        ruleType: 'rate_limit',
        enforced: true,
        passed: true,
        reason: 'Within rate limit',
        metadata: {
          limit: rule.limit,
          remaining: result.remaining,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message, key }, 'Rate limit check failed');
      // Fail open or closed based on configuration
      return {
        ruleType: 'rate_limit',
        enforced: true,
        passed: true,
        reason: `Rate limit check failed: ${message}`,
      };
    }
  }

  /**
   * Evaluate encryption requirement
   */
  private evaluateEncryption(rule: EncryptionRule, context: PolicyContext): RuleEvaluationResult {
    // Check if connection is encrypted (HTTPS)
    const isSecure = context.request.url.startsWith('https://') ||
      context.request.headers?.['x-forwarded-proto'] === 'https';

    if (!isSecure) {
      return {
        ruleType: 'require_encryption',
        enforced: true,
        passed: false,
        reason: 'Encrypted connection required',
        metadata: {
          fields: rule.fields,
          algorithm: rule.algorithm,
        },
      };
    }

    // If specific fields need encryption, that would be handled by the application
    return {
      ruleType: 'require_encryption',
      enforced: true,
      passed: true,
      reason: 'Encryption requirements met',
      metadata: {
        fields: rule.fields,
        algorithm: rule.algorithm,
      },
    };
  }

  /**
   * Evaluate audit log rule
   */
  private evaluateAuditLog(rule: AuditLogRule, context: PolicyContext): RuleEvaluationResult {
    // Audit rules always pass - they're informational
    return {
      ruleType: 'audit_log',
      enforced: true,
      passed: true,
      reason: 'Audit logging enabled',
      metadata: {
        level: rule.level ?? 'basic',
        includeRequest: rule.includeRequest ?? false,
        includeResponse: rule.includeResponse ?? false,
        destination: rule.destination,
      },
    };
  }

  /**
   * Evaluate step-up authentication rule
   */
  private evaluateStepUpAuth(rule: StepUpAuthRule, context: PolicyContext): RuleEvaluationResult {
    // Check current authentication level from context
    const currentLevel = (context.custom?.authLevel as number) ?? 0;

    if (currentLevel < rule.requiredLevel) {
      return {
        ruleType: 'step_up_auth',
        enforced: true,
        passed: false,
        reason: 'Step-up authentication required',
        metadata: {
          currentLevel,
          requiredLevel: rule.requiredLevel,
          method: rule.method,
          timeout: rule.timeout,
        },
      };
    }

    return {
      ruleType: 'step_up_auth',
      enforced: true,
      passed: true,
      reason: 'Authentication level sufficient',
      metadata: {
        currentLevel,
        requiredLevel: rule.requiredLevel,
      },
    };
  }

  /**
   * Evaluate data masking rule
   */
  private evaluateDataMasking(rule: DataMaskingRule, context: PolicyContext): RuleEvaluationResult {
    // Data masking is applied on response - this just indicates it should be applied
    return {
      ruleType: 'data_masking',
      enforced: true,
      passed: true,
      reason: 'Data masking will be applied',
      metadata: {
        fields: rule.fields,
        maskType: rule.maskType ?? 'partial',
        partialMaskPattern: rule.partialMaskPattern,
      },
    };
  }

  /**
   * Evaluate session timeout rule
   */
  private evaluateSessionTimeout(rule: SessionTimeoutRule, context: PolicyContext): RuleEvaluationResult {
    const user = context.user;

    if (!user?.sessionStartedAt) {
      return {
        ruleType: 'session_timeout',
        enforced: true,
        passed: true,
        reason: 'No session information available',
      };
    }

    const sessionStartTime = new Date(user.sessionStartedAt).getTime();
    const now = Date.now();

    // Check max session duration
    if (rule.maxDuration) {
      const maxDurationMs = rule.maxDuration * 1000;
      if (now - sessionStartTime > maxDurationMs) {
        return {
          ruleType: 'session_timeout',
          enforced: true,
          passed: false,
          reason: 'Session duration exceeded',
          metadata: {
            maxDuration: rule.maxDuration,
            sessionAge: Math.floor((now - sessionStartTime) / 1000),
            requireReauth: rule.requireReauth ?? true,
          },
        };
      }
    }

    // Idle timeout would need last activity tracking in context
    const lastActivity = (context.custom?.lastActivityAt as string) ?? user.sessionStartedAt;
    const lastActivityTime = new Date(lastActivity).getTime();
    const idleTimeout = rule.idleTimeout ?? this.defaultSessionIdleTimeout;
    const idleTimeoutMs = idleTimeout * 1000;

    if (now - lastActivityTime > idleTimeoutMs) {
      return {
        ruleType: 'session_timeout',
        enforced: true,
        passed: false,
        reason: 'Session idle timeout exceeded',
        metadata: {
          idleTimeout,
          idleDuration: Math.floor((now - lastActivityTime) / 1000),
          requireReauth: rule.requireReauth ?? true,
        },
      };
    }

    return {
      ruleType: 'session_timeout',
      enforced: true,
      passed: true,
      reason: 'Session is valid',
      metadata: {
        sessionAge: Math.floor((now - sessionStartTime) / 1000),
        idleDuration: Math.floor((now - lastActivityTime) / 1000),
      },
    };
  }

  /**
   * Evaluate geo restriction rule
   */
  private async evaluateGeoRestriction(rule: GeoRestrictionRule, context: PolicyContext): Promise<RuleEvaluationResult> {
    let geoInfo = context.environment?.geoLocation;

    // Try to look up geo info if not provided
    if (!geoInfo && this.geoLocationProvider) {
      try {
        geoInfo = await this.geoLocationProvider.lookup(context.request.ip) ?? undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.warn({ error: message, ip: context.request.ip }, 'Geo lookup failed');
      }
    }

    if (!geoInfo?.country) {
      // If we can't determine location, fail closed
      return {
        ruleType: 'geo_restriction',
        enforced: true,
        passed: false,
        reason: 'Unable to determine geo location',
      };
    }

    const country = geoInfo.country.toUpperCase();
    const region = geoInfo.region?.toUpperCase();

    // Check blocked countries
    if (rule.blockedCountries?.length) {
      const blockedCountries = rule.blockedCountries.map(c => c.toUpperCase());
      if (blockedCountries.includes(country)) {
        return {
          ruleType: 'geo_restriction',
          enforced: true,
          passed: false,
          reason: `Access blocked from country: ${country}`,
          metadata: { country, region },
        };
      }
    }

    // Check allowed countries
    if (rule.allowedCountries?.length) {
      const allowedCountries = rule.allowedCountries.map(c => c.toUpperCase());
      if (!allowedCountries.includes(country)) {
        return {
          ruleType: 'geo_restriction',
          enforced: true,
          passed: false,
          reason: `Access not allowed from country: ${country}`,
          metadata: { country, region },
        };
      }
    }

    // Check blocked regions
    if (rule.blockedRegions?.length && region) {
      const blockedRegions = rule.blockedRegions.map(r => r.toUpperCase());
      if (blockedRegions.includes(region) || blockedRegions.includes(`${country}-${region}`)) {
        return {
          ruleType: 'geo_restriction',
          enforced: true,
          passed: false,
          reason: `Access blocked from region: ${region}`,
          metadata: { country, region },
        };
      }
    }

    // Check allowed regions
    if (rule.allowedRegions?.length && region) {
      const allowedRegions = rule.allowedRegions.map(r => r.toUpperCase());
      if (!allowedRegions.includes(region) && !allowedRegions.includes(`${country}-${region}`)) {
        return {
          ruleType: 'geo_restriction',
          enforced: true,
          passed: false,
          reason: `Access not allowed from region: ${region}`,
          metadata: { country, region },
        };
      }
    }

    return {
      ruleType: 'geo_restriction',
      enforced: true,
      passed: true,
      reason: 'Geo restriction passed',
      metadata: { country, region },
    };
  }

  /**
   * Evaluate custom rule
   */
  private async evaluateCustom(rule: CustomRule, context: PolicyContext): Promise<RuleEvaluationResult> {
    const handler = this.customHandlers.get(rule.handler);

    if (!handler) {
      return {
        ruleType: 'custom',
        enforced: true,
        passed: false,
        reason: `No handler registered for: ${rule.handler}`,
      };
    }

    try {
      return await handler(rule, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        ruleType: 'custom',
        enforced: true,
        passed: false,
        reason: `Custom handler error: ${message}`,
      };
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined) return undefined;

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Register a custom rule handler
   */
  registerCustomHandler(name: string, handler: CustomRuleHandler): void {
    this.customHandlers.set(name, handler);
  }

  /**
   * Unregister a custom rule handler
   */
  unregisterCustomHandler(name: string): boolean {
    return this.customHandlers.delete(name);
  }

  /**
   * Set rate limiter
   */
  setRateLimiter(rateLimiter: RateLimiter): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Set geo location provider
   */
  setGeoLocationProvider(provider: GeoLocationProvider): void {
    this.geoLocationProvider = provider;
  }
}

/**
 * Create a rule evaluator instance
 */
export function createRuleEvaluator(options?: RuleEvaluatorOptions): RuleEvaluator {
  return new RuleEvaluator(options);
}
