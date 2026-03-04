/**
 * Deprecation Tracking
 *
 * Tracks deprecated features with sunset dates and replacement guidance.
 * Provides warnings and compatibility checking.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { parseVersion, gte, type Version } from './semver.js';

const logger = createLogger({ component: 'deprecation' });

// ============================================================================
// Types
// ============================================================================

export interface Deprecation {
  /** Feature identifier */
  feature: string;
  /** Version when deprecated */
  deprecatedIn: string;
  /** Version when removed (if known) */
  removedIn?: string;
  /** Replacement feature/approach */
  replacement?: string;
  /** Deprecation message */
  message: string;
  /** Documentation link */
  link?: string;
  /** Whether warnings have been logged */
  warned?: boolean;
}

export interface DeprecationRegistry {
  /** Register a deprecation */
  register(deprecation: Deprecation): void;
  /** Check if a feature is deprecated */
  isDeprecated(feature: string, currentVersion?: string): boolean;
  /** Check if a feature is removed */
  isRemoved(feature: string, currentVersion?: string): boolean;
  /** Get deprecation info */
  get(feature: string): Deprecation | undefined;
  /** Get all deprecations */
  getAll(): Deprecation[];
  /** Warn about a deprecated feature (logs once) */
  warn(feature: string): void;
  /** Check feature and throw if removed */
  check(feature: string, currentVersion?: string): void;
}

// ============================================================================
// Deprecation Registry Implementation
// ============================================================================

class DeprecationRegistryImpl implements DeprecationRegistry {
  private deprecations: Map<string, Deprecation> = new Map();
  private currentVersion: Version;

  constructor(currentVersion: string) {
    this.currentVersion = parseVersion(currentVersion);
  }

  register(deprecation: Deprecation): void {
    this.deprecations.set(deprecation.feature, { ...deprecation, warned: false });
    logger.debug({ feature: deprecation.feature, deprecatedIn: deprecation.deprecatedIn }, 'Deprecation registered');
  }

  isDeprecated(feature: string, currentVersion?: string): boolean {
    const deprecation = this.deprecations.get(feature);
    if (!deprecation) return false;

    const version = currentVersion ? parseVersion(currentVersion) : this.currentVersion;
    const deprecatedIn = parseVersion(deprecation.deprecatedIn);

    return gte(version, deprecatedIn);
  }

  isRemoved(feature: string, currentVersion?: string): boolean {
    const deprecation = this.deprecations.get(feature);
    if (!deprecation || !deprecation.removedIn) return false;

    const version = currentVersion ? parseVersion(currentVersion) : this.currentVersion;
    const removedIn = parseVersion(deprecation.removedIn);

    return gte(version, removedIn);
  }

  get(feature: string): Deprecation | undefined {
    return this.deprecations.get(feature);
  }

  getAll(): Deprecation[] {
    return Array.from(this.deprecations.values());
  }

  warn(feature: string): void {
    const deprecation = this.deprecations.get(feature);
    if (!deprecation) return;

    if (deprecation.warned) return;
    deprecation.warned = true;

    const context: Record<string, unknown> = {
      feature,
      deprecatedIn: deprecation.deprecatedIn,
    };

    if (deprecation.removedIn) {
      context.removedIn = deprecation.removedIn;
    }
    if (deprecation.replacement) {
      context.replacement = deprecation.replacement;
    }
    if (deprecation.link) {
      context.link = deprecation.link;
    }

    logger.warn(context, `Deprecated: ${deprecation.message}`);
  }

  check(feature: string, currentVersion?: string): void {
    if (this.isRemoved(feature, currentVersion)) {
      const deprecation = this.deprecations.get(feature)!;
      throw new Error(
        `Feature '${feature}' was removed in version ${deprecation.removedIn}. ` +
        (deprecation.replacement ? `Use '${deprecation.replacement}' instead.` : '')
      );
    }

    if (this.isDeprecated(feature, currentVersion)) {
      this.warn(feature);
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let registry: DeprecationRegistry | null = null;

export function createDeprecationRegistry(currentVersion: string): DeprecationRegistry {
  registry = new DeprecationRegistryImpl(currentVersion);
  return registry;
}

export function getDeprecationRegistry(): DeprecationRegistry {
  if (!registry) {
    throw new Error('DeprecationRegistry not initialized');
  }
  return registry;
}

// ============================================================================
// Decorator for Deprecated Functions
// ============================================================================

/**
 * Decorator to mark a function as deprecated
 */
export function deprecated(options: {
  message: string;
  replacement?: string;
  since?: string;
  until?: string;
}): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    let warned = false;

    descriptor.value = function (...args: unknown[]) {
      if (!warned) {
        warned = true;
        logger.warn(
          {
            method: String(propertyKey),
            since: options.since,
            until: options.until,
            replacement: options.replacement,
          },
          `Deprecated: ${options.message}`
        );
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

// ============================================================================
// Pre-defined Deprecations
// ============================================================================

export const VORION_DEPRECATIONS: Deprecation[] = [
  // API Deprecations
  {
    feature: 'api.v1.legacy_aci_format',
    deprecatedIn: '1.0.0',
    removedIn: '2.0.0',
    replacement: 'Standard CAR format (a3i.org.class:domains-level@version)',
    message: 'Legacy CAR format with embedded trust tier is deprecated',
    link: 'https://docs.vorion.dev/car#migration',
  },
  {
    feature: 'api.v1.trust_score_in_response',
    deprecatedIn: '1.1.0',
    replacement: 'GET /v1/agents/{carId}/trust',
    message: 'Trust score in agent response is deprecated; use dedicated endpoint',
  },

  // SDK Deprecations
  {
    feature: 'sdk.getTrustLevel',
    deprecatedIn: '1.0.0',
    removedIn: '2.0.0',
    replacement: 'getTrustScore()',
    message: 'getTrustLevel() is deprecated; use getTrustScore() for numeric scores',
  },

  // Protocol Deprecations
  {
    feature: 'a2a.v0.message_format',
    deprecatedIn: '1.0.0',
    removedIn: '1.5.0',
    replacement: 'A2A v1.0 message format',
    message: 'A2A v0 message format is deprecated',
  },
];

/**
 * Initialize deprecation registry with pre-defined deprecations
 */
export function initDeprecations(currentVersion: string): DeprecationRegistry {
  const reg = createDeprecationRegistry(currentVersion);

  for (const deprecation of VORION_DEPRECATIONS) {
    reg.register(deprecation);
  }

  return reg;
}

// ============================================================================
// Compatibility Helpers
// ============================================================================

/**
 * Check API version compatibility
 */
export function checkApiCompatibility(
  clientVersion: string,
  serverVersion: string,
  deprecations: DeprecationRegistry
): {
  compatible: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const client = parseVersion(clientVersion);
  const server = parseVersion(serverVersion);

  // Major version mismatch = incompatible
  if (client.major !== server.major) {
    errors.push(`Major version mismatch: client ${clientVersion}, server ${serverVersion}`);
    return { compatible: false, warnings, errors };
  }

  // Client newer than server = potential issues
  if (client.minor > server.minor) {
    warnings.push(`Client version ${clientVersion} may use features not available on server ${serverVersion}`);
  }

  // Check for deprecated features
  const allDeprecations = deprecations.getAll();
  for (const dep of allDeprecations) {
    if (deprecations.isDeprecated(dep.feature, clientVersion)) {
      if (deprecations.isRemoved(dep.feature, serverVersion)) {
        errors.push(`Feature '${dep.feature}' used by client was removed in server version`);
      } else {
        warnings.push(`Feature '${dep.feature}' is deprecated: ${dep.message}`);
      }
    }
  }

  return { compatible: errors.length === 0, warnings, errors };
}
