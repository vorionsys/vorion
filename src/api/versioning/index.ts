/**
 * API Versioning Module
 *
 * Provides URL-based API versioning with fallback to Accept header negotiation.
 * Supports deprecation warnings and version-specific error responses.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';

const versionLogger = createLogger({ component: 'api-versioning' });

/**
 * Supported API versions
 */
export const API_VERSIONS = ['v1'] as const;
export type ApiVersion = (typeof API_VERSIONS)[number];

/**
 * Current (latest) API version
 */
export const CURRENT_VERSION: ApiVersion = 'v1';

/**
 * Deprecated API versions with sunset dates
 */
export const DEPRECATED_VERSIONS: Record<string, { sunsetDate: string; message: string }> = {
  // Example: 'v0': { sunsetDate: '2025-06-01', message: 'Please migrate to v1' }
};

/**
 * Version extraction result
 */
export interface VersionInfo {
  version: ApiVersion;
  source: 'url' | 'header' | 'default';
  isDeprecated: boolean;
  deprecationMessage?: string;
  sunsetDate?: string;
}

/**
 * Versioning plugin options
 */
export interface VersioningOptions {
  /** Default version when none specified (defaults to CURRENT_VERSION) */
  defaultVersion?: ApiVersion;
  /** Whether to add deprecation warning headers (defaults to true) */
  includeDeprecationHeaders?: boolean;
  /** Custom header name for version negotiation (defaults to Accept) */
  versionHeader?: string;
  /** Base path prefix (defaults to /api) */
  basePath?: string;
}

/**
 * Extract API version from request URL path
 *
 * Looks for /api/v{N}/ pattern in the URL
 */
export function extractVersionFromUrl(url: string): ApiVersion | null {
  const match = url.match(/\/api\/(v\d+)\//);
  if (match && API_VERSIONS.includes(match[1] as ApiVersion)) {
    return match[1] as ApiVersion;
  }
  return null;
}

/**
 * Extract API version from Accept header
 *
 * Supports formats:
 * - application/vnd.vorion.v1+json
 * - application/json; version=v1
 */
export function extractVersionFromAcceptHeader(acceptHeader: string | undefined): ApiVersion | null {
  if (!acceptHeader) return null;

  // Check for vendor-specific media type: application/vnd.vorion.v1+json
  const vendorMatch = acceptHeader.match(/application\/vnd\.vorion\.(v\d+)\+json/);
  if (vendorMatch && API_VERSIONS.includes(vendorMatch[1] as ApiVersion)) {
    return vendorMatch[1] as ApiVersion;
  }

  // Check for version parameter: application/json; version=v1
  const paramMatch = acceptHeader.match(/version=(v\d+)/);
  if (paramMatch && API_VERSIONS.includes(paramMatch[1] as ApiVersion)) {
    return paramMatch[1] as ApiVersion;
  }

  return null;
}

/**
 * Extract version from request using URL-first, then Accept header fallback
 */
export function extractVersion(
  request: FastifyRequest,
  defaultVersion: ApiVersion = CURRENT_VERSION
): VersionInfo {
  // 1. Try URL-based version (most explicit)
  const urlVersion = extractVersionFromUrl(request.url);
  if (urlVersion) {
    return createVersionInfo(urlVersion, 'url');
  }

  // 2. Try Accept header (fallback for version negotiation)
  const headerVersion = extractVersionFromAcceptHeader(request.headers.accept);
  if (headerVersion) {
    return createVersionInfo(headerVersion, 'header');
  }

  // 3. Default to latest version (with deprecation warning recommended)
  return createVersionInfo(defaultVersion, 'default');
}

/**
 * Create version info object with deprecation details
 */
function createVersionInfo(version: ApiVersion, source: 'url' | 'header' | 'default'): VersionInfo {
  const deprecation = DEPRECATED_VERSIONS[version];
  return {
    version,
    source,
    isDeprecated: !!deprecation,
    deprecationMessage: deprecation?.message,
    sunsetDate: deprecation?.sunsetDate,
  };
}

/**
 * Check if a version is supported
 */
export function isVersionSupported(version: string): version is ApiVersion {
  return API_VERSIONS.includes(version as ApiVersion);
}

/**
 * Get deprecation warning message for default version usage
 */
export function getDefaultVersionWarning(): string {
  return `API version not specified. Defaulting to ${CURRENT_VERSION}. ` +
    'For stability, explicitly specify the API version in the URL path (e.g., /api/v1/...) ' +
    'or via Accept header (application/vnd.vorion.v1+json).';
}

// Extend FastifyRequest to include version info
declare module 'fastify' {
  interface FastifyRequest {
    apiVersion?: VersionInfo;
  }
}

/**
 * API Versioning Plugin
 *
 * Adds version extraction and deprecation headers to all requests.
 * Registers version info on request object for route handlers.
 */
const versioningPluginAsync: FastifyPluginAsync<VersioningOptions> = async (
  fastify: FastifyInstance,
  opts: VersioningOptions
) => {
  const {
    defaultVersion = CURRENT_VERSION,
    includeDeprecationHeaders = true,
    basePath = '/api',
  } = opts;

  // Decorate request with apiVersion property
  fastify.decorateRequest('apiVersion', null);

  // Add version extraction hook
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip non-API routes (health checks, metrics, etc.)
    if (!request.url.startsWith(basePath)) {
      return;
    }

    const versionInfo = extractVersion(request, defaultVersion);
    request.apiVersion = versionInfo;

    // Add version to response headers
    reply.header('X-API-Version', versionInfo.version);

    // Add deprecation headers if applicable
    if (includeDeprecationHeaders) {
      if (versionInfo.isDeprecated) {
        reply.header('Deprecation', 'true');
        if (versionInfo.sunsetDate) {
          reply.header('Sunset', versionInfo.sunsetDate);
        }
        reply.header('X-Deprecation-Notice', versionInfo.deprecationMessage ?? 'This API version is deprecated');

        versionLogger.warn(
          {
            version: versionInfo.version,
            source: versionInfo.source,
            url: request.url,
            sunsetDate: versionInfo.sunsetDate,
          },
          'Deprecated API version used'
        );
      }

      // Warn when no version specified (using default)
      if (versionInfo.source === 'default') {
        reply.header('Warning', `299 - "${getDefaultVersionWarning()}"`);

        versionLogger.debug(
          {
            defaultVersion: versionInfo.version,
            url: request.url,
          },
          'Request using default API version'
        );
      }
    }
  });
};

/**
 * API Versioning Plugin (wrapped with fastify-plugin for proper encapsulation)
 */
export const versioningPlugin = fp(versioningPluginAsync, {
  name: 'api-versioning',
  fastify: '4.x',
});

/**
 * Version-specific error response generator
 */
export interface VersionedError {
  error: {
    code: string;
    message: string;
    version?: string;
    deprecationNotice?: string;
  };
}

/**
 * Create a version-specific error response
 */
export function createVersionedError(
  code: string,
  message: string,
  versionInfo?: VersionInfo
): VersionedError {
  const error: VersionedError = {
    error: {
      code,
      message,
    },
  };

  if (versionInfo) {
    error.error.version = versionInfo.version;
    if (versionInfo.isDeprecated) {
      error.error.deprecationNotice = versionInfo.deprecationMessage;
    }
  }

  return error;
}

/**
 * Create unsupported version error response
 */
export function createUnsupportedVersionError(requestedVersion: string): VersionedError {
  return {
    error: {
      code: 'UNSUPPORTED_API_VERSION',
      message: `API version '${requestedVersion}' is not supported. Supported versions: ${API_VERSIONS.join(', ')}`,
    },
  };
}

/**
 * Route prefix generator for versioned routes
 */
export function getVersionedPrefix(version: ApiVersion): string {
  return `/api/${version}`;
}

/**
 * Check if request is for versioned API
 */
export function isVersionedRequest(request: FastifyRequest): boolean {
  return !!request.apiVersion;
}

export default versioningPlugin;
