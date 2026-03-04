/**
 * Vorion Security SDK - Decorators
 * TypeScript decorators for declarative security
 */

// Import decorators for use in this file
import { Secured } from './secured.js';
import { RateLimit } from './rate-limit.js';
import { AuditLog } from './audit-log.js';
import { RequirePermission } from './require-permission.js';
import { BreakGlass } from './break-glass.js';

// Secured decorator
export {
  Secured,
  setSecurityContextProvider,
  getSecurityContext,
  setSecurityEvaluator,
  SecurityError,
  ChallengeRequiredError,
  isSecured,
  getSecurityOptions,
  createSecurityContext,
  type SecurityEvaluator,
} from './secured.js';

// Rate limit decorator
export {
  RateLimit,
  setRateLimiter,
  getRateLimiter,
  setRateLimitExceededHandler,
  parseWindow,
  getRateLimitInfo,
  getRateLimitStatus,
  resetRateLimit,
  createRateLimitMiddleware,
  RateLimitExceededError,
  RateLimitDegradedError,
  InMemoryRateLimiter,
  RedisRateLimiter,
  type RateLimiter,
  type RedisClient,
  type RateLimitExceededHandler,
} from './rate-limit.js';

// Audit log decorator
export {
  AuditLog,
  setAuditLogger,
  getAuditLogger,
  getAuditLogOptions,
  queryAuditLogs,
  flushAuditLogs,
  audit,
  ConsoleAuditLogger,
  BufferedAuditLogger,
  SIEMAuditLogger,
  type AuditLogger,
  type AuditQueryOptions,
  type SIEMConfig,
} from './audit-log.js';

// Require permission decorator
export {
  RequirePermission,
  setPermissionChecker,
  getPermissionChecker,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getCurrentPermissions,
  getRequiredPermission,
  permission,
  Permissions,
  PermissionDeniedError,
  DefaultPermissionChecker,
  RBACPermissionChecker,
  ABACPermissionChecker,
  type PermissionChecker,
  type RBACConfig,
  type ABACPolicy,
} from './require-permission.js';

// Break glass decorator
export {
  BreakGlass,
  setBreakGlassManager,
  getBreakGlassManager,
  setBreakGlassNotifier,
  requestBreakGlassAccess,
  getBreakGlassOptions,
  getPendingBreakGlassRequests,
  approveBreakGlassRequest,
  denyBreakGlassRequest,
  getBreakGlassRequestStatus,
  getBreakGlassAuditTrail,
  BreakGlassRequiredError,
  InMemoryBreakGlassManager,
  ConsoleBreakGlassNotifier,
  type BreakGlassManager,
  type BreakGlassNotifier,
  type BreakGlassRequest,
  type BreakGlassApproval,
  type BreakGlassDenial,
  type BreakGlassAuditEntry,
  type BreakGlassRequirements,
} from './break-glass.js';

// ============================================================================
// Decorator Composition Utilities
// ============================================================================

/**
 * Compose multiple method decorators
 *
 * @example
 * class Controller {
 *   @compose(
 *     Secured({ roles: ['admin'] }),
 *     RateLimit({ requests: 10, window: '1m' }),
 *     AuditLog({ level: 'detailed' })
 *   )
 *   async sensitiveOperation() {}
 * }
 */
export function compose(...decorators: MethodDecorator[]): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    // Apply decorators in reverse order (innermost first)
    return decorators.reduceRight(
      (desc, decorator) => decorator(target, propertyKey, desc) || desc,
      descriptor
    );
  };
}

/**
 * Create a reusable security profile
 *
 * @example
 * const AdminOnly = createSecurityProfile({
 *   secured: { roles: ['admin'], mfa: true },
 *   rateLimit: { requests: 100, window: '1m' },
 *   auditLog: { level: 'detailed' }
 * });
 *
 * class AdminController {
 *   @AdminOnly
 *   async adminOperation() {}
 * }
 */
export function createSecurityProfile(options: {
  secured?: Parameters<typeof Secured>[0];
  rateLimit?: Parameters<typeof RateLimit>[0];
  auditLog?: Parameters<typeof AuditLog>[0];
  requirePermission?: string | Parameters<typeof RequirePermission>[0];
  breakGlass?: Parameters<typeof BreakGlass>[0];
}): MethodDecorator {
  const decorators: MethodDecorator[] = [];

  if (options.secured) {
    decorators.push(Secured(options.secured));
  }

  if (options.rateLimit) {
    decorators.push(RateLimit(options.rateLimit));
  }

  if (options.auditLog) {
    decorators.push(AuditLog(options.auditLog));
  }

  if (options.requirePermission) {
    decorators.push(RequirePermission(options.requirePermission));
  }

  if (options.breakGlass) {
    decorators.push(BreakGlass(options.breakGlass));
  }

  return compose(...decorators);
}

// ============================================================================
// Common Security Profiles
// ============================================================================

/**
 * Public endpoint - minimal security
 */
export const Public = createSecurityProfile({
  auditLog: { level: 'minimal' },
});

/**
 * Authenticated endpoint - requires valid session
 */
export const Authenticated = createSecurityProfile({
  secured: {},
  auditLog: { level: 'standard' },
});

/**
 * Admin endpoint - requires admin role and MFA
 */
export const AdminOnly = createSecurityProfile({
  secured: { roles: ['admin'], mfa: true },
  rateLimit: { requests: 100, window: '1m' },
  auditLog: { level: 'detailed' },
});

/**
 * Sensitive operation - high security requirements
 */
export const Sensitive = createSecurityProfile({
  secured: { mfa: true },
  rateLimit: { requests: 10, window: '1m' },
  auditLog: { level: 'full', includeRequest: true, includeResponse: true },
});

/**
 * Critical operation - requires break glass approval
 */
export function Critical(approvers: string[]): MethodDecorator {
  return createSecurityProfile({
    secured: { mfa: true },
    auditLog: { level: 'full', includeRequest: true, includeResponse: true },
    breakGlass: {
      approvers,
      minApprovals: 1,
      expiresIn: '1h',
      requireReason: true,
      auditLevel: 'critical',
    },
  });
}
