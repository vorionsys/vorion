/**
 * Security Headers Fastify Middleware
 *
 * Comprehensive middleware for applying security headers to HTTP responses.
 * Includes CSP, HSTS, CORS, Permissions Policy, and other security headers.
 *
 * @packageDocumentation
 * @module security/headers/middleware
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginCallback,
} from 'fastify';
import fp from 'fastify-plugin';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import { createLogger } from '../../common/logger.js';
import { isProductionGrade, isDevelopmentMode } from '../../common/security-mode.js';
import type {
  SecurityHeadersConfig,
  CSPViolationReport,
  CORSConfig,
} from './types.js';
import { cspViolationReportSchema, securityHeadersConfigSchema } from './types.js';
import { CSPBuilder, generateNonce } from './csp.js';
import { HSTSManager } from './hsts.js';
import { PermissionsPolicyManager } from './permissions-policy.js';
import { validateSecurityHeaders, assertValidSecurityHeaders } from './validator.js';

const logger = createLogger({ component: 'security-headers-middleware' });

// =============================================================================
// Metrics
// =============================================================================

const headersApplied = new Counter({
  name: 'vorion_security_headers_applied_total',
  help: 'Total security headers applied to responses',
  labelNames: ['header'] as const,
  registers: [vorionRegistry],
});

const cspViolations = new Counter({
  name: 'vorion_csp_violations_total',
  help: 'Total CSP violations reported',
  labelNames: ['directive', 'blocked_uri'] as const,
  registers: [vorionRegistry],
});

const corsRejections = new Counter({
  name: 'vorion_cors_rejections_total',
  help: 'Total CORS requests rejected',
  labelNames: ['reason'] as const,
  registers: [vorionRegistry],
});

const headersDuration = new Histogram({
  name: 'vorion_security_headers_duration_seconds',
  help: 'Duration of security headers middleware execution',
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01],
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Security headers middleware options
 */
export interface SecurityHeadersMiddlewareOptions {
  /** Full configuration (overrides presets) */
  config?: Partial<SecurityHeadersConfig>;
  /** Use preset configuration */
  preset?: 'strict' | 'moderate' | 'relaxed' | 'api';
  /** Generate nonce per request for CSP */
  enableNonce?: boolean;
  /** Validate configuration on startup */
  validateOnStartup?: boolean;
  /** CSP violation report endpoint */
  cspReportEndpoint?: string;
  /** Callback for CSP violations */
  onCSPViolation?: (report: CSPViolationReport, request: FastifyRequest) => void;
  /** CORS origin validator function */
  corsOriginValidator?: (origin: string, request: FastifyRequest) => boolean;
  /** Paths to exclude from security headers */
  excludePaths?: string[];
}

/**
 * Request-specific context for security headers
 */
export interface SecurityHeadersContext {
  /** Generated CSP nonce for this request */
  nonce?: string;
}

// Augment FastifyRequest
declare module 'fastify' {
  interface FastifyRequest {
    securityHeaders?: SecurityHeadersContext;
  }
}

// =============================================================================
// Default Configurations
// =============================================================================

/**
 * Get default configuration based on environment
 */
function getDefaultConfig(mode: 'production' | 'development' | 'testing'): SecurityHeadersConfig {
  const isProd = mode === 'production';

  return {
    mode,
    csp: {
      enabled: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': isProd ? ["'self'", "'strict-dynamic'"] : ["'self'", "'unsafe-inline'"],
        'style-src': isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProd,
      },
      reportOnly: false,
    },
    hsts: {
      enabled: isProd,
      config: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: false,
      },
    },
    cors: {
      enabled: false,
      config: {
        allowedOrigins: [],
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Accept', 'Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: [],
        credentials: false,
        maxAge: 600,
        privateNetworkAccess: false,
      },
    },
    permissionsPolicy: {
      enabled: true,
      config: {
        accelerometer: '()',
        camera: '()',
        geolocation: '()',
        gyroscope: '()',
        magnetometer: '()',
        microphone: '()',
        payment: '(self)',
        usb: '()',
        'interest-cohort': '()',
      },
    },
    coep: {
      enabled: false,
      value: 'unsafe-none',
    },
    coop: {
      enabled: isProd,
      value: 'same-origin-allow-popups',
    },
    corp: {
      enabled: isProd,
      value: 'same-origin',
    },
    referrerPolicy: {
      enabled: true,
      value: 'strict-origin-when-cross-origin',
    },
    xFrameOptions: {
      enabled: true,
      value: 'DENY',
    },
    xContentTypeOptions: {
      enabled: true,
    },
    xXssProtection: {
      enabled: true,
    },
    xDnsPrefetchControl: {
      enabled: true,
      value: 'off',
    },
    xPermittedCrossDomainPolicies: {
      enabled: true,
      value: 'none',
    },
    excludePaths: ['/health', '/metrics', '/ready', '/live'],
  };
}

/**
 * Get preset configuration
 */
function getPresetConfig(preset: 'strict' | 'moderate' | 'relaxed' | 'api'): Partial<SecurityHeadersConfig> {
  switch (preset) {
    case 'strict':
      return getDefaultConfig('production');
    case 'moderate':
      return {
        ...getDefaultConfig('production'),
        csp: {
          enabled: true,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:', 'https:'],
            'font-src': ["'self'", 'https:'],
            'connect-src': ["'self'"],
            'frame-src': ["'self'"],
            'frame-ancestors': ["'self'"],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'form-action': ["'self'"],
            'upgrade-insecure-requests': true,
          },
          reportOnly: false,
        },
      };
    case 'relaxed':
      return getDefaultConfig('development');
    case 'api':
      return {
        ...getDefaultConfig('production'),
        csp: {
          enabled: true,
          directives: {
            'default-src': ["'none'"],
            'frame-ancestors': ["'none'"],
            'base-uri': ["'none'"],
            'form-action': ["'none'"],
          },
          reportOnly: false,
        },
        cors: {
          enabled: false,
          config: {
            allowedOrigins: [],
            allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Accept', 'Content-Type', 'Authorization'],
            exposedHeaders: [],
            credentials: false,
            maxAge: 600,
            privateNetworkAccess: false,
          },
        },
      };
    default:
      return getDefaultConfig('production');
  }
}

// =============================================================================
// CORS Handler
// =============================================================================

/**
 * Handle CORS headers
 */
function handleCORS(
  config: CORSConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  originValidator?: (origin: string, request: FastifyRequest) => boolean
): boolean {
  const origin = request.headers.origin;

  // No origin header = same-origin request, no CORS needed
  if (!origin) {
    return true;
  }

  // Check if origin is allowed
  let isAllowed = false;

  if (config.allowedOrigins.includes('*')) {
    // Wildcard not allowed in production
    if (isProductionGrade()) {
      corsRejections.inc({ reason: 'wildcard_in_production' });
      logger.error({ origin }, 'CORS wildcard rejected in production');
      return false;
    }
    isAllowed = true;
  } else if (originValidator) {
    isAllowed = originValidator(origin, request);
  } else {
    isAllowed = config.allowedOrigins.includes(origin);
  }

  if (!isAllowed) {
    corsRejections.inc({ reason: 'origin_not_allowed' });
    logger.warn({ origin, allowedOrigins: config.allowedOrigins }, 'CORS origin rejected');
    return false;
  }

  // Set CORS headers
  reply.header('Access-Control-Allow-Origin', config.allowedOrigins.includes('*') ? '*' : origin);

  if (config.credentials) {
    reply.header('Access-Control-Allow-Credentials', 'true');
  }

  reply.header('Access-Control-Allow-Methods', config.allowedMethods.join(', '));
  reply.header('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));

  if (config.exposedHeaders.length > 0) {
    reply.header('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
  }

  if (config.maxAge > 0) {
    reply.header('Access-Control-Max-Age', config.maxAge.toString());
  }

  if (config.privateNetworkAccess) {
    reply.header('Access-Control-Allow-Private-Network', 'true');
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    reply.status(204).send();
    return false; // Don't continue processing
  }

  return true;
}

// =============================================================================
// Security Headers Application
// =============================================================================

/**
 * Apply all security headers to a response
 */
function applySecurityHeaders(
  config: SecurityHeadersConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  nonce?: string
): void {
  const startTime = Date.now();

  // CSP
  if (config.csp.enabled) {
    const cspBuilder = new CSPBuilder();
    cspBuilder.merge(config.csp.directives);

    if (nonce) {
      cspBuilder.useNonce(nonce);
    }

    if (config.csp.reporting?.reportTo) {
      cspBuilder.reportTo(config.csp.reporting.reportTo);
    }
    if (config.csp.reporting?.reportUri) {
      cspBuilder.reportUri(...config.csp.reporting.reportUri);
    }

    if (config.csp.reportOnly) {
      cspBuilder.asReportOnly();
    }

    const cspResult = cspBuilder.build();
    reply.header(cspBuilder.getHeaderName(), cspResult.policy);
    headersApplied.inc({ header: 'csp' });
  }

  // HSTS (only on HTTPS or if explicitly enabled)
  if (config.hsts.enabled && (request.protocol === 'https' || !isProductionGrade())) {
    const hstsManager = new HSTSManager(config.hsts.config);
    reply.header('Strict-Transport-Security', hstsManager.buildHeader());
    headersApplied.inc({ header: 'hsts' });
  }

  // Permissions Policy
  if (config.permissionsPolicy.enabled) {
    const ppManager = new PermissionsPolicyManager();
    ppManager.fromConfig(config.permissionsPolicy.config);
    reply.header('Permissions-Policy', ppManager.build());
    headersApplied.inc({ header: 'permissions-policy' });
  }

  // Cross-Origin Policies
  if (config.coep.enabled) {
    reply.header('Cross-Origin-Embedder-Policy', config.coep.value);
    headersApplied.inc({ header: 'coep' });
  }

  if (config.coop.enabled) {
    reply.header('Cross-Origin-Opener-Policy', config.coop.value);
    headersApplied.inc({ header: 'coop' });
  }

  if (config.corp.enabled) {
    reply.header('Cross-Origin-Resource-Policy', config.corp.value);
    headersApplied.inc({ header: 'corp' });
  }

  // Referrer Policy
  if (config.referrerPolicy.enabled) {
    reply.header('Referrer-Policy', config.referrerPolicy.value);
    headersApplied.inc({ header: 'referrer-policy' });
  }

  // X-Frame-Options
  if (config.xFrameOptions.enabled) {
    reply.header('X-Frame-Options', config.xFrameOptions.value);
    headersApplied.inc({ header: 'x-frame-options' });
  }

  // X-Content-Type-Options
  if (config.xContentTypeOptions.enabled) {
    reply.header('X-Content-Type-Options', 'nosniff');
    headersApplied.inc({ header: 'x-content-type-options' });
  }

  // X-XSS-Protection (set to 0 as it's deprecated and can cause issues)
  if (config.xXssProtection.enabled) {
    reply.header('X-XSS-Protection', '0');
    headersApplied.inc({ header: 'x-xss-protection' });
  }

  // X-DNS-Prefetch-Control
  if (config.xDnsPrefetchControl.enabled) {
    reply.header('X-DNS-Prefetch-Control', config.xDnsPrefetchControl.value);
    headersApplied.inc({ header: 'x-dns-prefetch-control' });
  }

  // X-Permitted-Cross-Domain-Policies
  if (config.xPermittedCrossDomainPolicies.enabled) {
    reply.header('X-Permitted-Cross-Domain-Policies', config.xPermittedCrossDomainPolicies.value);
    headersApplied.inc({ header: 'x-permitted-cross-domain-policies' });
  }

  // Record duration
  const duration = (Date.now() - startTime) / 1000;
  headersDuration.observe(duration);
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * Security headers Fastify plugin callback
 */
const securityHeadersPluginCallback: FastifyPluginCallback<SecurityHeadersMiddlewareOptions> = (
  fastify: FastifyInstance,
  options: SecurityHeadersMiddlewareOptions,
  done: (err?: Error) => void
) => {
  try {
    // Determine mode
    const mode = isProductionGrade() ? 'production' : (isDevelopmentMode() ? 'development' : 'testing');

    // Build configuration
    let config: SecurityHeadersConfig;

    if (options.config) {
      // Use provided config merged with defaults
      const defaults = getDefaultConfig(mode);
      config = securityHeadersConfigSchema.parse({
        ...defaults,
        ...options.config,
        mode,
      }) as SecurityHeadersConfig;
    } else if (options.preset) {
      // Use preset
      const presetConfig = getPresetConfig(options.preset);
      config = securityHeadersConfigSchema.parse({
        ...presetConfig,
        mode,
      }) as SecurityHeadersConfig;
    } else {
      // Use defaults for environment
      config = securityHeadersConfigSchema.parse(getDefaultConfig(mode)) as SecurityHeadersConfig;
    }

    // Merge exclude paths
    if (options.excludePaths) {
      config.excludePaths = [
        ...(config.excludePaths ?? []),
        ...options.excludePaths,
      ];
    }

    // Validate configuration on startup
    if (options.validateOnStartup !== false) {
      const validation = validateSecurityHeaders(config);

      if (isProductionGrade() && !validation.valid) {
        assertValidSecurityHeaders(config);
      }

      logger.info(
        {
          grade: validation.grade,
          score: validation.score,
          maxScore: validation.maxScore,
          errors: validation.summary.errors,
          warnings: validation.summary.warnings,
        },
        'Security headers configuration validated'
      );
    }

    const excludePaths = new Set(config.excludePaths ?? []);
    const enableNonce = options.enableNonce ?? false;

    // Register CSP violation report endpoint
    if (options.cspReportEndpoint) {
      fastify.post(options.cspReportEndpoint, async (request, reply) => {
        try {
          const parseResult = cspViolationReportSchema.safeParse(request.body);

          if (!parseResult.success) {
            return reply.status(400).send({ error: 'Invalid CSP report format' });
          }

          const report = parseResult.data as CSPViolationReport;
          const cspReport = report['csp-report'];

          // Increment metrics
          cspViolations.inc({
            directive: cspReport['violated-directive'],
            blocked_uri: cspReport['blocked-uri'].substring(0, 50), // Truncate for label
          });

          // Call user callback if provided
          if (options.onCSPViolation) {
            options.onCSPViolation(report, request);
          }

          logger.warn(
            {
              documentUri: cspReport['document-uri'],
              violatedDirective: cspReport['violated-directive'],
              blockedUri: cspReport['blocked-uri'],
              sourceFile: cspReport['source-file'],
              lineNumber: cspReport['line-number'],
            },
            'CSP violation reported'
          );

          return reply.status(204).send();
        } catch (error) {
          logger.error({ error }, 'Error processing CSP violation report');
          return reply.status(500).send({ error: 'Internal error' });
        }
      });

      // Update CSP reporting config
      if (config.csp.enabled) {
        config.csp.reporting = {
          ...config.csp.reporting,
          reportUri: [options.cspReportEndpoint],
        };
      }
    }

    // Add hook to apply security headers
    fastify.addHook('onRequest', async (request, reply) => {
      // Skip excluded paths
      const path = request.url.split('?')[0];
      if (excludePaths.has(path)) {
        return;
      }

      // Initialize security headers context
      if (enableNonce) {
        request.securityHeaders = {
          nonce: generateNonce(),
        };
      }
    });

    fastify.addHook('onSend', async (request, reply) => {
      // Skip excluded paths
      const path = request.url.split('?')[0];
      if (excludePaths.has(path)) {
        return;
      }

      // Handle CORS first
      if (config.cors.enabled) {
        const shouldContinue = handleCORS(
          config.cors.config,
          request,
          reply,
          options.corsOriginValidator
        );
        if (!shouldContinue) {
          return;
        }
      }

      // Apply security headers
      applySecurityHeaders(
        config,
        request,
        reply,
        request.securityHeaders?.nonce
      );
    });

    // Decorate fastify with config
    fastify.decorate('securityHeadersConfig', config);

    logger.info(
      {
        cspEnabled: config.csp.enabled,
        hstsEnabled: config.hsts.enabled,
        corsEnabled: config.cors.enabled,
        permissionsPolicyEnabled: config.permissionsPolicy.enabled,
        nonceEnabled: enableNonce,
        excludedPaths: config.excludePaths?.length ?? 0,
      },
      'Security headers middleware registered'
    );

    done();
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Security headers Fastify plugin
 */
export const securityHeadersPlugin = fp(securityHeadersPluginCallback, {
  name: 'vorion-security-headers',
  fastify: '5.x',
});

// Augment FastifyInstance
declare module 'fastify' {
  interface FastifyInstance {
    securityHeadersConfig?: SecurityHeadersConfig;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create security headers middleware with strict defaults
 */
export function createStrictSecurityHeaders(): SecurityHeadersMiddlewareOptions {
  return {
    preset: 'strict',
    validateOnStartup: true,
    enableNonce: true,
  };
}

/**
 * Create security headers middleware for API services
 */
export function createAPISecurityHeaders(): SecurityHeadersMiddlewareOptions {
  return {
    preset: 'api',
    validateOnStartup: true,
    enableNonce: false,
  };
}

/**
 * Create security headers middleware for development
 */
export function createDevelopmentSecurityHeaders(): SecurityHeadersMiddlewareOptions {
  if (isProductionGrade()) {
    logger.warn('createDevelopmentSecurityHeaders() called in production - using strict defaults');
    return createStrictSecurityHeaders();
  }

  return {
    preset: 'relaxed',
    validateOnStartup: false,
    enableNonce: false,
  };
}

/**
 * Create security headers middleware with custom configuration
 */
export function createSecurityHeaders(
  config: Partial<SecurityHeadersConfig>,
  options?: Omit<SecurityHeadersMiddlewareOptions, 'config' | 'preset'>
): SecurityHeadersMiddlewareOptions {
  return {
    ...options,
    config,
  };
}
