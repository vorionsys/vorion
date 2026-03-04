/**
 * Vorion Security SDK - @Secured Decorator
 * Declarative security enforcement for classes and methods
 */

import 'reflect-metadata';
import {
  SecuredOptions,
  EvaluationContext,
  PolicyResult,
  UserContext,
  RequestContext,
} from '../types';

// ============================================================================
// Security Context
// ============================================================================

/**
 * Global security context provider
 */
let securityContextProvider: (() => Promise<EvaluationContext>) | null = null;

/**
 * Configure the security context provider
 */
export function setSecurityContextProvider(
  provider: () => Promise<EvaluationContext>
): void {
  securityContextProvider = provider;
}

/**
 * Get the current security context
 */
export async function getSecurityContext(): Promise<EvaluationContext> {
  if (!securityContextProvider) {
    throw new Error(
      'Security context provider not configured. Call setSecurityContextProvider() first.'
    );
  }
  return securityContextProvider();
}

// ============================================================================
// Security Evaluator
// ============================================================================

/**
 * Security evaluation interface
 */
export interface SecurityEvaluator {
  evaluate(context: EvaluationContext, options: SecuredOptions): Promise<PolicyResult>;
}

let securityEvaluator: SecurityEvaluator | null = null;

/**
 * Configure the security evaluator
 */
export function setSecurityEvaluator(evaluator: SecurityEvaluator): void {
  securityEvaluator = evaluator;
}

/**
 * Default security evaluator
 */
class DefaultSecurityEvaluator implements SecurityEvaluator {
  async evaluate(
    context: EvaluationContext,
    options: SecuredOptions
  ): Promise<PolicyResult> {
    const result: PolicyResult = {
      outcome: 'allow',
      policyId: 'secured-decorator',
      policyVersion: '1.0.0',
      timestamp: new Date(),
    };

    // Check roles
    if (options.roles && options.roles.length > 0) {
      const userRoles = context.user.roles || (context.user.role ? [context.user.role] : []);
      const hasRole = options.roles.some((role) => userRoles.includes(role));

      if (!hasRole) {
        return {
          ...result,
          outcome: 'deny',
          reason: `User lacks required role. Required: ${options.roles.join(', ')}`,
        };
      }
    }

    // Check permissions
    if (options.permissions && options.permissions.length > 0) {
      const userPermissions = context.user.permissions || [];
      const hasPermission = options.permissions.every((perm) =>
        userPermissions.includes(perm)
      );

      if (!hasPermission) {
        return {
          ...result,
          outcome: 'deny',
          reason: `User lacks required permissions. Required: ${options.permissions.join(', ')}`,
        };
      }
    }

    // Check MFA
    if (options.mfa && !context.user.mfaVerified) {
      return {
        ...result,
        outcome: 'challenge',
        reason: 'MFA verification required',
      };
    }

    // Check IP whitelist
    if (options.ipWhitelist && options.ipWhitelist.length > 0) {
      const clientIp = context.request.ip;
      const isWhitelisted = options.ipWhitelist.some((ip) =>
        isIpInRange(clientIp, ip)
      );

      if (!isWhitelisted) {
        return {
          ...result,
          outcome: 'deny',
          reason: 'IP address not in whitelist',
        };
      }
    }

    // Check time restriction
    if (options.timeRestriction) {
      const now = new Date();
      const { start, end, timezone } = options.timeRestriction;

      if (!isTimeInRange(now, start, end, timezone)) {
        return {
          ...result,
          outcome: 'deny',
          reason: `Access restricted to ${start} - ${end}`,
        };
      }
    }

    return result;
  }
}

function isIpInRange(ip: string, range: string): boolean {
  if (!range.includes('/')) {
    return ip === range;
  }

  const [rangeIp, bits] = range.split('/');
  const mask = parseInt(bits, 10);

  const ipParts = ip.split('.').map(Number);
  const rangeParts = rangeIp.split('.').map(Number);

  const ipNum =
    (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum =
    (rangeParts[0] << 24) |
    (rangeParts[1] << 16) |
    (rangeParts[2] << 8) |
    rangeParts[3];
  const maskNum = ~((1 << (32 - mask)) - 1);

  return (ipNum & maskNum) === (rangeNum & maskNum);
}

function isTimeInRange(
  date: Date,
  start: string,
  end: string,
  _timezone?: string
): boolean {
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

// ============================================================================
// Metadata Storage
// ============================================================================

const SECURED_METADATA_KEY = Symbol('vorion:secured');

interface SecuredMetadata {
  classOptions?: SecuredOptions;
  methodOptions: Map<string, SecuredOptions>;
}

function getSecuredMetadata(target: object): SecuredMetadata {
  let metadata = Reflect.getMetadata(SECURED_METADATA_KEY, target) as
    | SecuredMetadata
    | undefined;

  if (!metadata) {
    metadata = { methodOptions: new Map() };
    Reflect.defineMetadata(SECURED_METADATA_KEY, metadata, target);
  }

  return metadata;
}

// ============================================================================
// @Secured Decorator
// ============================================================================

/**
 * @Secured decorator for classes and methods
 *
 * @example
 * // Class-level security
 * @Secured({ roles: ['admin'], mfa: true })
 * class AdminController {
 *   // All methods require admin role and MFA
 * }
 *
 * @example
 * // Method-level security
 * class UserController {
 *   @Secured({ permissions: ['users:read'] })
 *   async getUser(id: string) {}
 *
 *   @Secured({ roles: ['admin'], permissions: ['users:delete'] })
 *   async deleteUser(id: string) {}
 * }
 */
export function Secured(options: SecuredOptions): ClassDecorator & MethodDecorator {
  return function (
    target: Function | object,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ): void | Function | PropertyDescriptor {
    // Method decorator
    if (propertyKey !== undefined && descriptor !== undefined) {
      const metadata = getSecuredMetadata(target.constructor);
      metadata.methodOptions.set(String(propertyKey), options);

      const originalMethod = descriptor.value;

      descriptor.value = async function (this: unknown, ...args: unknown[]) {
        await enforceSecurityPolicy(options);
        return originalMethod.apply(this, args);
      };

      return descriptor;
    }

    // Class decorator
    const constructor = target as Function;
    const metadata = getSecuredMetadata(constructor);
    metadata.classOptions = options;

    // Wrap all methods
    const prototype = constructor.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const name of propertyNames) {
      if (name === 'constructor') continue;

      const propDescriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (propDescriptor && typeof propDescriptor.value === 'function') {
        const originalMethod = propDescriptor.value;
        const methodOptions = metadata.methodOptions.get(name);

        prototype[name] = async function (this: unknown, ...args: unknown[]) {
          // Merge class and method options
          const effectiveOptions = methodOptions
            ? mergeOptions(options, methodOptions)
            : options;

          await enforceSecurityPolicy(effectiveOptions);
          return originalMethod.apply(this, args);
        };
      }
    }

    return constructor;
  } as ClassDecorator & MethodDecorator;
}

function mergeOptions(
  classOptions: SecuredOptions,
  methodOptions: SecuredOptions
): SecuredOptions {
  return {
    roles: methodOptions.roles || classOptions.roles,
    permissions: [
      ...(classOptions.permissions || []),
      ...(methodOptions.permissions || []),
    ],
    mfa: methodOptions.mfa ?? classOptions.mfa,
    ipWhitelist: methodOptions.ipWhitelist || classOptions.ipWhitelist,
    timeRestriction: methodOptions.timeRestriction || classOptions.timeRestriction,
    customPolicy: methodOptions.customPolicy || classOptions.customPolicy,
  };
}

async function enforceSecurityPolicy(options: SecuredOptions): Promise<void> {
  const context = await getSecurityContext();
  const evaluator = securityEvaluator || new DefaultSecurityEvaluator();

  const result = await evaluator.evaluate(context, options);

  if (result.outcome === 'deny') {
    throw new SecurityError(result.reason || 'Access denied', result);
  }

  if (result.outcome === 'challenge') {
    throw new ChallengeRequiredError(result.reason || 'Additional verification required', result);
  }
}

// ============================================================================
// Errors
// ============================================================================

export class SecurityError extends Error {
  public readonly result: PolicyResult;

  constructor(message: string, result: PolicyResult) {
    super(message);
    this.name = 'SecurityError';
    this.result = result;
  }
}

export class ChallengeRequiredError extends Error {
  public readonly result: PolicyResult;

  constructor(message: string, result: PolicyResult) {
    super(message);
    this.name = 'ChallengeRequiredError';
    this.result = result;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a class or method is secured
 */
export function isSecured(target: object, methodName?: string): boolean {
  const metadata = Reflect.getMetadata(SECURED_METADATA_KEY, target);
  if (!metadata) return false;

  if (methodName) {
    return metadata.methodOptions.has(methodName) || !!metadata.classOptions;
  }

  return !!metadata.classOptions;
}

/**
 * Get security options for a class or method
 */
export function getSecurityOptions(
  target: object,
  methodName?: string
): SecuredOptions | undefined {
  const metadata = Reflect.getMetadata(SECURED_METADATA_KEY, target);
  if (!metadata) return undefined;

  if (methodName) {
    const methodOptions = metadata.methodOptions.get(methodName);
    if (methodOptions && metadata.classOptions) {
      return mergeOptions(metadata.classOptions, methodOptions);
    }
    return methodOptions || metadata.classOptions;
  }

  return metadata.classOptions;
}

/**
 * Create a security context from request
 */
export function createSecurityContext(
  user: Partial<UserContext>,
  request: Partial<RequestContext>
): EvaluationContext {
  return {
    user: {
      id: user.id || 'anonymous',
      ...user,
    },
    request: {
      ip: request.ip || '0.0.0.0',
      ...request,
    },
    time: {
      timestamp: new Date(),
      hour: new Date().getHours(),
      minute: new Date().getMinutes(),
      dayOfWeek: new Date().getDay(),
    },
  };
}
