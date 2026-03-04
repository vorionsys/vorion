/**
 * PIV/CAC Fastify Middleware
 *
 * Fastify middleware and plugin for PIV/CAC smart card authentication.
 *
 * Features:
 * - Certificate extraction from headers
 * - Certificate validation
 * - User identity mapping
 * - Session binding
 * - Card removal monitoring
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
import { Counter, Histogram } from 'prom-client';
import { createLogger } from '../../common/logger.js';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type PIVCACConfig,
  type PIVAuthContext,
  type PIVMiddlewareOptions,
  type MappedUserIdentity,
  type CardSessionBinding,
  CertificateValidationStatus,
  RevocationCheckMethod,
  PIVErrorCode,
  DEFAULT_PIVCAC_CONFIG,
} from './types.js';
import {
  CertificateAuthService,
  parseCertificate,
  parseCertificateChain,
  getCertificateAuthService,
} from './certificate-auth.js';
import { OCSPValidator, getOCSPValidator } from './ocsp-validator.js';
import { CRLValidator, getCRLValidator } from './crl-validator.js';
import { CertificateMapper, getCertificateMapper } from './certificate-mapper.js';
import { CardRemovalHandler, getCardRemovalHandler, SessionState } from './card-removal-handler.js';

const logger = createLogger({ component: 'piv-middleware' });

// =============================================================================
// Metrics
// =============================================================================

const pivAuthAttempts = new Counter({
  name: 'vorion_piv_auth_attempts_total',
  help: 'Total PIV/CAC authentication attempts',
  labelNames: ['status', 'error_code'] as const,
  registers: [vorionRegistry],
});

const pivAuthDuration = new Histogram({
  name: 'vorion_piv_auth_duration_seconds',
  help: 'Duration of PIV/CAC authentication',
  labelNames: ['status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [vorionRegistry],
});

const certificateValidation = new Counter({
  name: 'vorion_piv_certificate_validation_total',
  help: 'Certificate validation results',
  labelNames: ['status', 'revocation_method'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * PIV authentication service bundle
 */
export interface PIVAuthServices {
  certAuth: CertificateAuthService;
  ocspValidator: OCSPValidator;
  crlValidator: CRLValidator;
  certificateMapper: CertificateMapper;
  cardRemovalHandler: CardRemovalHandler;
}

/**
 * PIV plugin options
 */
export interface PIVPluginOptions extends PIVMiddlewareOptions {
  /** PIV/CAC configuration */
  config?: Partial<PIVCACConfig>;
  /** Pre-initialized services */
  services?: Partial<PIVAuthServices>;
  /** Enable metrics */
  enableMetrics?: boolean;
}

// =============================================================================
// Fastify Declaration
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    pivAuth?: PIVAuthContext;
  }

  interface FastifyInstance {
    pivAuthServices?: PIVAuthServices;
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create PIV authentication middleware
 */
export function pivAuthMiddleware(
  services: PIVAuthServices,
  config: PIVCACConfig,
  options: PIVMiddlewareOptions = {}
): preHandlerHookHandler {
  const skipPaths = new Set(options.skipPaths ?? []);
  const requiredPaths = new Set(options.requiredPaths ?? []);
  const certHeader = options.certificateHeader ?? 'x-client-certificate';
  const chainHeader = options.certificateChainHeader ?? 'x-client-certificate-chain';

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    const path = request.routeOptions.url ?? request.url;

    // Initialize context
    request.pivAuth = {
      isPIVAuthenticated: false,
    };

    // Skip if path is in skip list
    if (skipPaths.has(path)) {
      return;
    }

    // Check if PIV is required for this path
    const isRequired = requiredPaths.size === 0 || requiredPaths.has(path);

    try {
      // Extract certificate from headers
      const certPem = extractCertificateFromRequest(request, certHeader);
      const chainPem = request.headers[chainHeader] as string | undefined;

      if (!certPem) {
        if (isRequired) {
          pivAuthAttempts.inc({ status: 'missing', error_code: 'CERTIFICATE_MISSING' });

          return reply.status(401).send({
            error: {
              code: PIVErrorCode.CERTIFICATE_MISSING,
              message: 'Client certificate required',
            },
          });
        }
        return;
      }

      // Parse certificate
      const certificate = parseCertificate(certPem);
      const chain = chainPem ? parseCertificateChain(chainPem) : [];

      // Validate certificate
      const validation = await services.certAuth.validateCertificate(certificate, chain);

      // Check revocation status if validation passed
      if (validation.isValid) {
        await checkRevocationStatus(services, config, certificate, chain, validation);
      }

      // Update metrics
      certificateValidation.inc({
        status: validation.status,
        revocation_method: config.revocationMethod,
      });

      if (!validation.isValid) {
        pivAuthAttempts.inc({
          status: 'invalid',
          error_code: validation.status,
        });

        if (isRequired) {
          const errorResponse = createValidationErrorResponse(validation);

          if (options.onFailure) {
            await options.onFailure(
              new Error(validation.errors[0] || 'Certificate validation failed'),
              request,
              reply
            );
            return;
          }

          return reply.status(401).send(errorResponse);
        }

        // Not required, continue with partial context
        request.pivAuth = {
          isPIVAuthenticated: false,
          certificate,
          validation,
        };
        return;
      }

      // Map certificate to user identity
      let user: MappedUserIdentity;
      try {
        user = services.certificateMapper.mapCertificate(certificate);

        // Custom user lookup if provided
        if (options.userLookup) {
          const userData = await options.userLookup(user);
          if (!userData) {
            throw new Error('User not found');
          }
          // Merge additional user data
          user.attributes = { ...user.attributes, ...userData } as Record<string, string>;
        }
      } catch (error) {
        pivAuthAttempts.inc({ status: 'mapping_failed', error_code: 'USER_MAPPING_FAILED' });

        if (isRequired) {
          if (options.onFailure) {
            await options.onFailure(
              error instanceof Error ? error : new Error('User mapping failed'),
              request,
              reply
            );
            return;
          }

          return reply.status(401).send({
            error: {
              code: PIVErrorCode.USER_MAPPING_FAILED,
              message: 'Failed to map certificate to user identity',
            },
          });
        }

        request.pivAuth = {
          isPIVAuthenticated: false,
          certificate,
          validation,
        };
        return;
      }

      // Check for existing session binding
      const sessionId = request.headers['x-piv-session-id'] as string | undefined;
      let sessionBinding: CardSessionBinding | undefined;

      if (sessionId) {
        try {
          services.cardRemovalHandler.validateSession(sessionId);
          sessionBinding = services.cardRemovalHandler.getSessionBinding(sessionId);
          services.cardRemovalHandler.updateSessionActivity(sessionId);
        } catch (error) {
          // Session invalid, will create new one if needed
          logger.debug({ sessionId, error }, 'PIV session validation failed');
        }
      }

      // Build auth context
      request.pivAuth = {
        isPIVAuthenticated: true,
        user,
        certificate,
        validation,
        sessionBinding,
      };

      // Call success handler if provided
      if (options.onSuccess) {
        await options.onSuccess(request.pivAuth, request);
      }

      pivAuthAttempts.inc({ status: 'success', error_code: 'none' });

      const duration = (Date.now() - startTime) / 1000;
      pivAuthDuration.observe({ status: 'success' }, duration);

      logger.info(
        {
          userId: user.userId,
          fingerprint: certificate.fingerprint.substring(0, 16),
          sessionId,
        },
        'PIV authentication successful'
      );
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      pivAuthDuration.observe({ status: 'error' }, duration);

      pivAuthAttempts.inc({
        status: 'error',
        error_code: 'INTERNAL_ERROR',
      });

      logger.error({ error }, 'PIV authentication error');

      if (options.onFailure) {
        await options.onFailure(
          error instanceof Error ? error : new Error(String(error)),
          request,
          reply
        );
        return;
      }

      if (isRequired) {
        return reply.status(500).send({
          error: {
            code: PIVErrorCode.INTERNAL_ERROR,
            message: 'Authentication processing error',
          },
        });
      }
    }
  };
}

/**
 * Check revocation status using OCSP and/or CRL
 */
async function checkRevocationStatus(
  services: PIVAuthServices,
  config: PIVCACConfig,
  certificate: ReturnType<typeof parseCertificate>,
  chain: ReturnType<typeof parseCertificateChain>,
  validation: { isValid: boolean; status: CertificateValidationStatus; errors: string[]; warnings: string[] }
): Promise<void> {
  // Find issuer certificate
  const issuer = chain.find((c) => c.subject.full === certificate.issuer.full);
  if (!issuer) {
    validation.warnings.push('Issuer certificate not in chain, skipping revocation check');
    return;
  }

  switch (config.revocationMethod) {
    case RevocationCheckMethod.OCSP:
      await checkOCSP(services.ocspValidator, certificate, issuer, validation);
      break;

    case RevocationCheckMethod.CRL:
      await checkCRL(services.crlValidator, certificate, issuer, validation);
      break;

    case RevocationCheckMethod.BOTH:
      await Promise.all([
        checkOCSP(services.ocspValidator, certificate, issuer, validation),
        checkCRL(services.crlValidator, certificate, issuer, validation),
      ]);
      break;

    case RevocationCheckMethod.OCSP_WITH_CRL_FALLBACK:
      try {
        await checkOCSP(services.ocspValidator, certificate, issuer, validation);
      } catch (error) {
        logger.warn({ error }, 'OCSP check failed, falling back to CRL');
        await checkCRL(services.crlValidator, certificate, issuer, validation);
      }
      break;

    case RevocationCheckMethod.NONE:
      validation.warnings.push('Revocation checking is disabled');
      break;
  }
}

/**
 * Check OCSP revocation status
 */
async function checkOCSP(
  validator: OCSPValidator,
  certificate: ReturnType<typeof parseCertificate>,
  issuer: ReturnType<typeof parseCertificate>,
  validation: { isValid: boolean; status: CertificateValidationStatus; errors: string[] }
): Promise<void> {
  try {
    const ocspResponse = await validator.checkRevocationStatus(certificate, issuer);

    if (ocspResponse.status === 'revoked') {
      validation.isValid = false;
      validation.status = CertificateValidationStatus.REVOKED;
      validation.errors.push(
        `Certificate revoked via OCSP: ${ocspResponse.revocationReason || 'unknown reason'}`
      );
    }
  } catch (error) {
    if (!validator.getConfig().softFail) {
      throw error;
    }
    logger.warn({ error }, 'OCSP check failed (soft-fail mode)');
  }
}

/**
 * Check CRL revocation status
 */
async function checkCRL(
  validator: CRLValidator,
  certificate: ReturnType<typeof parseCertificate>,
  issuer: ReturnType<typeof parseCertificate>,
  validation: { isValid: boolean; status: CertificateValidationStatus; errors: string[] }
): Promise<void> {
  try {
    const result = await validator.checkRevocationStatus(certificate, issuer);

    if (result.revoked) {
      validation.isValid = false;
      validation.status = CertificateValidationStatus.REVOKED;
      validation.errors.push(
        `Certificate revoked via CRL: ${result.entry?.reason || 'unknown reason'}`
      );
    }
  } catch (error) {
    if (!validator.getConfig().softFail) {
      throw error;
    }
    logger.warn({ error }, 'CRL check failed (soft-fail mode)');
  }
}

/**
 * Extract certificate from request
 */
function extractCertificateFromRequest(
  request: FastifyRequest,
  headerName: string
): string | undefined {
  // Check header
  let certValue = request.headers[headerName.toLowerCase()] as string | undefined;

  if (!certValue) {
    // Check TLS connection for client certificate
    const tlsSocket = request.raw?.socket as import('tls').TLSSocket | undefined;
    if (tlsSocket?.getPeerCertificate) {
      const peerCert = tlsSocket.getPeerCertificate(true);
      if (peerCert?.raw) {
        certValue = `-----BEGIN CERTIFICATE-----\n${peerCert.raw.toString('base64')}\n-----END CERTIFICATE-----`;
      }
    }
  }

  if (!certValue) {
    return undefined;
  }

  // URL decode if necessary
  if (certValue.includes('%')) {
    certValue = decodeURIComponent(certValue);
  }

  return certValue;
}

/**
 * Create error response for validation failure
 */
function createValidationErrorResponse(validation: {
  status: CertificateValidationStatus;
  errors: string[];
}): { error: { code: string; message: string; details?: string[] } } {
  const errorCode = mapValidationStatusToErrorCode(validation.status);

  return {
    error: {
      code: errorCode,
      message: getValidationErrorMessage(validation.status),
      details: validation.errors.length > 0 ? validation.errors : undefined,
    },
  };
}

/**
 * Map validation status to error code
 */
function mapValidationStatusToErrorCode(status: CertificateValidationStatus): PIVErrorCode {
  switch (status) {
    case CertificateValidationStatus.EXPIRED:
      return PIVErrorCode.CERTIFICATE_EXPIRED;
    case CertificateValidationStatus.NOT_YET_VALID:
      return PIVErrorCode.CERTIFICATE_NOT_YET_VALID;
    case CertificateValidationStatus.REVOKED:
      return PIVErrorCode.CERTIFICATE_REVOKED;
    case CertificateValidationStatus.CHAIN_INVALID:
      return PIVErrorCode.CERTIFICATE_CHAIN_INVALID;
    case CertificateValidationStatus.SIGNATURE_INVALID:
      return PIVErrorCode.CERTIFICATE_SIGNATURE_INVALID;
    default:
      return PIVErrorCode.INTERNAL_ERROR;
  }
}

/**
 * Get user-friendly error message
 */
function getValidationErrorMessage(status: CertificateValidationStatus): string {
  switch (status) {
    case CertificateValidationStatus.EXPIRED:
      return 'Certificate has expired';
    case CertificateValidationStatus.NOT_YET_VALID:
      return 'Certificate is not yet valid';
    case CertificateValidationStatus.REVOKED:
      return 'Certificate has been revoked';
    case CertificateValidationStatus.CHAIN_INVALID:
      return 'Certificate chain validation failed';
    case CertificateValidationStatus.SIGNATURE_INVALID:
      return 'Certificate signature is invalid';
    default:
      return 'Certificate validation failed';
  }
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * PIV authentication Fastify plugin
 */
const pivAuthPluginCallback: FastifyPluginCallback<PIVPluginOptions> = (
  fastify: FastifyInstance,
  options: PIVPluginOptions,
  done: (err?: Error) => void
) => {
  try {
    // Merge configuration
    const config: PIVCACConfig = {
      ...DEFAULT_PIVCAC_CONFIG,
      ...options.config,
    };

    // Initialize services
    const services: PIVAuthServices = {
      certAuth: options.services?.certAuth ?? getCertificateAuthService(config),
      ocspValidator: options.services?.ocspValidator ?? getOCSPValidator(config.ocsp),
      crlValidator: options.services?.crlValidator ?? getCRLValidator(config.crl),
      certificateMapper:
        options.services?.certificateMapper ?? getCertificateMapper(config.mappingRules),
      cardRemovalHandler:
        options.services?.cardRemovalHandler ?? getCardRemovalHandler(config.cardRemovalPolicy),
    };

    // Decorate fastify with services
    fastify.decorate('pivAuthServices', services);

    // Add pre-handler hook
    if (config.enabled) {
      fastify.addHook('preHandler', pivAuthMiddleware(services, config, options));
    }

    logger.info(
      {
        enabled: config.enabled,
        revocationMethod: config.revocationMethod,
        dodPkiCompatibility: config.dodPkiCompatibility,
      },
      'PIV authentication plugin registered'
    );

    done();
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * PIV authentication Fastify plugin
 */
export const pivAuthPlugin = fp(pivAuthPluginCallback, {
  name: 'vorion-piv-auth',
  fastify: '5.x',
});

// =============================================================================
// Helper Middleware
// =============================================================================

/**
 * Require PIV authentication middleware
 */
export function requirePIVAuth(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.pivAuth?.isPIVAuthenticated) {
      return reply.status(401).send({
        error: {
          code: PIVErrorCode.CERTIFICATE_MISSING,
          message: 'PIV/CAC authentication required',
        },
      });
    }
  };
}

/**
 * Require specific certificate attribute middleware
 */
export function requireCertificateAttribute(
  attribute: string,
  pattern?: RegExp
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.pivAuth?.isPIVAuthenticated) {
      return reply.status(401).send({
        error: {
          code: PIVErrorCode.CERTIFICATE_MISSING,
          message: 'PIV/CAC authentication required',
        },
      });
    }

    const value = request.pivAuth.user?.attributes[attribute];

    if (!value) {
      return reply.status(403).send({
        error: {
          code: 'MISSING_ATTRIBUTE',
          message: `Required certificate attribute "${attribute}" not found`,
        },
      });
    }

    if (pattern && !pattern.test(value)) {
      return reply.status(403).send({
        error: {
          code: 'INVALID_ATTRIBUTE',
          message: `Certificate attribute "${attribute}" does not match required pattern`,
        },
      });
    }
  };
}

/**
 * Require EDIPI (DoD ID) middleware
 */
export function requireEDIPI(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.pivAuth?.isPIVAuthenticated) {
      return reply.status(401).send({
        error: {
          code: PIVErrorCode.CERTIFICATE_MISSING,
          message: 'PIV/CAC authentication required',
        },
      });
    }

    if (!request.pivAuth.user?.edipi) {
      return reply.status(403).send({
        error: {
          code: 'EDIPI_REQUIRED',
          message: 'DoD EDIPI (Electronic Data Interchange Personal Identifier) required',
        },
      });
    }
  };
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Get PIV auth context from request
 */
export function getPIVAuth(request: FastifyRequest): PIVAuthContext | undefined {
  return request.pivAuth;
}

/**
 * Check if request has PIV authentication
 */
export function hasPIVAuth(request: FastifyRequest): boolean {
  return request.pivAuth?.isPIVAuthenticated ?? false;
}

/**
 * Get PIV user from request
 */
export function getPIVUser(request: FastifyRequest): MappedUserIdentity | undefined {
  return request.pivAuth?.user;
}

/**
 * Get PIV user ID from request
 */
export function getPIVUserId(request: FastifyRequest): string | undefined {
  return request.pivAuth?.user?.userId;
}

/**
 * Get certificate fingerprint from request
 */
export function getCertificateFingerprint(request: FastifyRequest): string | undefined {
  return request.pivAuth?.certificate?.fingerprint;
}

/**
 * Get EDIPI from request
 */
export function getEDIPI(request: FastifyRequest): string | undefined {
  return request.pivAuth?.user?.edipi;
}
