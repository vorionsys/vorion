/**
 * Secure HTTP Client Wrapper
 *
 * Provides SSRF (Server-Side Request Forgery) protection for all external HTTP requests.
 * This module should be used instead of direct fetch() calls when making requests to
 * user-provided or configurable URLs.
 *
 * Security features:
 * - URL scheme validation (HTTPS only in production)
 * - Private IP range blocking (RFC 1918, RFC 5737, RFC 6598)
 * - Link-local address blocking (169.254.x.x)
 * - Localhost and internal DNS pattern blocking
 * - URL allowlist for known external services
 * - Request timeout limits
 * - DNS resolution validation at request time
 * - Comprehensive audit logging
 */

import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import { createLogger } from './logger.js';
import { getConfig } from './config.js';

const logger = createLogger({ component: 'secure-fetch' });

const dnsLookup = promisify(lookup);

// =============================================================================
// Configuration Types
// =============================================================================

export interface SecureFetchConfig {
  /**
   * Allow HTTP in addition to HTTPS.
   * Should only be true in development environments.
   * Default: false (HTTPS only)
   */
  allowHttp?: boolean;

  /**
   * Request timeout in milliseconds.
   * Default: 10000 (10 seconds)
   */
  timeoutMs?: number;

  /**
   * List of allowed domains for this request.
   * If provided, only these domains are allowed.
   * If empty/undefined, allowlist is not enforced.
   */
  allowedDomains?: string[];

  /**
   * Additional blocked domains (beyond the default internal patterns).
   */
  blockedDomains?: string[];

  /**
   * Skip DNS resolution check (use with caution).
   * Only set this if you've already validated the URL.
   * Default: false
   */
  skipDnsCheck?: boolean;

  /**
   * Expected resolved IP from prior validation (DNS pinning).
   * If provided, the request will fail if DNS resolves to a different IP.
   */
  pinnedIp?: string;

  /**
   * Custom headers to include in the request.
   */
  headers?: Record<string, string>;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

export interface SecureFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

// =============================================================================
// IP Address Validation
// =============================================================================

/**
 * IPv4 private and reserved address ranges to block.
 *
 * Covers:
 * - RFC 1918: Private networks (10.x, 172.16-31.x, 192.168.x)
 * - RFC 5737: Documentation ranges (192.0.2.x, 198.51.100.x, 203.0.113.x)
 * - RFC 6598: Shared address space / CGNAT (100.64-127.x)
 * - Loopback (127.x)
 * - Link-local (169.254.x)
 * - Current network (0.x)
 * - Multicast (224.x)
 * - Reserved (240.x)
 * - Broadcast (255.255.255.255)
 * - IETF Protocol Assignments (192.0.0.x)
 */
const IPV4_PRIVATE_RANGES: RegExp[] = [
  // Loopback (127.0.0.0/8)
  /^127\./,

  // RFC 1918 Private Networks
  /^10\./, // 10.0.0.0/8 (Class A private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (Class B private)
  /^192\.168\./, // 192.168.0.0/16 (Class C private)

  // Link-local (169.254.0.0/16)
  /^169\.254\./,

  // Current network (0.0.0.0/8)
  /^0\./,

  // RFC 6598 Shared Address Space / CGNAT (100.64.0.0/10)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,

  // IETF Protocol Assignments (192.0.0.0/24)
  /^192\.0\.0\./,

  // RFC 5737 Documentation ranges
  /^192\.0\.2\./, // TEST-NET-1 (192.0.2.0/24)
  /^198\.51\.100\./, // TEST-NET-2 (198.51.100.0/24)
  /^203\.0\.113\./, // TEST-NET-3 (203.0.113.0/24)

  // Benchmark testing (198.18.0.0/15)
  /^198\.1[8-9]\./,

  // Multicast (224.0.0.0/4)
  /^22[4-9]\./,
  /^23[0-9]\./,

  // Reserved for future use (240.0.0.0/4)
  /^24[0-9]\./,
  /^25[0-4]\./,

  // Broadcast
  /^255\.255\.255\.255$/,
];

/**
 * IPv6 private and reserved address ranges to block.
 */
const IPV6_PRIVATE_RANGES: RegExp[] = [
  // Loopback (::1)
  /^::1$/,

  // IPv4-mapped loopback (::ffff:127.x.x.x)
  /^::ffff:127\./i,

  // IPv4-mapped private ranges
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./i,

  // Link-local (fe80::/10)
  /^fe[89ab][0-9a-f]:/i,

  // Unique local address (fc00::/7)
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,

  // Multicast (ff00::/8)
  /^ff[0-9a-f]{2}:/i,

  // Unspecified address
  /^::$/,

  // Documentation prefix (2001:db8::/32)
  /^2001:db8:/i,
];

/**
 * Check if an IP address is in a private/internal range.
 *
 * @param ip - The IP address to check (IPv4 or IPv6)
 * @returns true if the IP is private/internal, false otherwise
 */
export function isPrivateIP(ip: string): boolean {
  // Normalize the IP address
  const normalizedIp = ip.trim().toLowerCase();

  // Check IPv4 ranges
  for (const range of IPV4_PRIVATE_RANGES) {
    if (range.test(normalizedIp)) {
      return true;
    }
  }

  // Check IPv6 ranges
  for (const range of IPV6_PRIVATE_RANGES) {
    if (range.test(normalizedIp)) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// Hostname Validation
// =============================================================================

/**
 * Blocked hostnames that could be used for SSRF attacks.
 */
const BLOCKED_HOSTNAMES: Set<string> = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',

  // Cloud provider metadata endpoints
  'metadata.google.internal',
  'metadata.internal',
  '169.254.169.254',
  'metadata',

  // AWS
  'instance-data',
  '169.254.170.2', // ECS task metadata

  // Kubernetes
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster',
  'kubernetes.default.svc.cluster.local',
]);

/**
 * Domain patterns that indicate internal/private networks.
 */
const BLOCKED_DOMAIN_PATTERNS: RegExp[] = [
  /\.internal$/i,
  /\.local$/i,
  /\.localhost$/i,
  /\.localdomain$/i,
  /\.svc$/i,
  /\.svc\.cluster\.local$/i,
  /\.cluster\.local$/i,
  /\.corp$/i,
  /\.lan$/i,
  /\.home$/i,
  /\.private$/i,
  /\.intra$/i,
  /\.intranet$/i,

  // Cloud provider internal domains
  /\.compute\.internal$/i, // AWS
  /\.ec2\.internal$/i, // AWS
  /\.c\..*\.internal$/i, // GCP
  /\.internal\.cloudapp\.net$/i, // Azure
];

/**
 * Check if a hostname matches internal/private patterns.
 *
 * @param hostname - The hostname to check
 * @returns true if the hostname is internal, false otherwise
 */
export function isInternalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();

  // Check exact matches
  if (BLOCKED_HOSTNAMES.has(normalizedHostname)) {
    return true;
  }

  // Check domain patterns
  for (const pattern of BLOCKED_DOMAIN_PATTERNS) {
    if (pattern.test(normalizedHostname)) {
      return true;
    }
  }

  // Check if hostname is an IP address in private range
  const ipv4Match = normalizedHostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match && isPrivateIP(normalizedHostname)) {
    return true;
  }

  // Check for bracketed IPv6
  const ipv6Match = normalizedHostname.match(/^\[([^\]]+)\]$/);
  if (ipv6Match && isPrivateIP(ipv6Match[1])) {
    return true;
  }

  return false;
}

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Ports commonly used for internal services that should be blocked.
 */
const BLOCKED_PORTS: Set<string> = new Set([
  '22', // SSH
  '23', // Telnet
  '25', // SMTP
  '3306', // MySQL
  '5432', // PostgreSQL
  '6379', // Redis
  '27017', // MongoDB
  '9200', // Elasticsearch
  '9300', // Elasticsearch
  '11211', // Memcached
  '2181', // ZooKeeper
  '2379', // etcd
  '2380', // etcd
  '8500', // Consul
  '8300', // Consul
]);

/**
 * Check if running in production environment.
 */
function isProduction(): boolean {
  const env = process.env['VORION_ENV'] || process.env['NODE_ENV'] || 'development';
  return env === 'production';
}

/**
 * Check if running in development environment.
 */
function isDevelopment(): boolean {
  const env = process.env['VORION_ENV'] || process.env['NODE_ENV'] || 'development';
  return env === 'development';
}

/**
 * Validate a URL for external requests.
 *
 * Performs comprehensive validation including:
 * - URL scheme (HTTPS required in production)
 * - Hostname blocking (localhost, internal patterns)
 * - IP address validation (private ranges)
 * - Port blocking (internal service ports)
 * - Domain allowlist (if configured)
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns Validation result with reason if invalid
 */
export function validateExternalUrl(
  url: string,
  options: { allowHttp?: boolean; allowedDomains?: string[]; blockedDomains?: string[] } = {}
): UrlValidationResult {
  try {
    const parsed = new URL(url);

    // Scheme validation
    const allowHttp = options.allowHttp ?? isDevelopment();
    if (parsed.protocol !== 'https:') {
      if (parsed.protocol === 'http:') {
        if (!allowHttp) {
          return {
            valid: false,
            reason: 'URL must use HTTPS in production. HTTP is only allowed in development.',
          };
        }
        // In development, allow HTTP only for localhost
        if (isProduction()) {
          return {
            valid: false,
            reason: 'HTTP protocol is not allowed in production.',
          };
        }
      } else {
        return {
          valid: false,
          reason: `Invalid URL scheme: ${parsed.protocol}. Only HTTPS is allowed.`,
        };
      }
    }

    // Hostname validation
    const hostname = parsed.hostname.toLowerCase();

    // Check internal hostnames (includes localhost check)
    if (isInternalHostname(hostname)) {
      // Allow localhost in development
      if (isDevelopment() && (hostname === 'localhost' || hostname === '127.0.0.1')) {
        // Continue validation
      } else {
        return {
          valid: false,
          reason: `Hostname "${hostname}" is blocked. Internal/private hostnames are not allowed.`,
        };
      }
    }

    // Check custom blocked domains
    if (options.blockedDomains && options.blockedDomains.length > 0) {
      for (const blocked of options.blockedDomains) {
        const normalizedBlocked = blocked.toLowerCase();
        if (hostname === normalizedBlocked || hostname.endsWith(`.${normalizedBlocked}`)) {
          return {
            valid: false,
            reason: `Domain "${hostname}" is explicitly blocked.`,
          };
        }
      }
    }

    // Check domain allowlist
    if (options.allowedDomains && options.allowedDomains.length > 0) {
      let allowed = false;
      for (const allowedDomain of options.allowedDomains) {
        const normalizedAllowed = allowedDomain.toLowerCase();
        if (hostname === normalizedAllowed || hostname.endsWith(`.${normalizedAllowed}`)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return {
          valid: false,
          reason: `Domain "${hostname}" is not in the allowlist.`,
        };
      }
    }

    // Port validation
    if (parsed.port && BLOCKED_PORTS.has(parsed.port)) {
      return {
        valid: false,
        reason: `Port ${parsed.port} is blocked. This port is commonly used for internal services.`,
      };
    }

    // Check if hostname is a direct IP address
    const ipv4Match = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    if (ipv4Match) {
      if (isPrivateIP(hostname)) {
        // Allow localhost in development
        if (isDevelopment() && hostname === '127.0.0.1') {
          // Continue
        } else {
          return {
            valid: false,
            reason: `IP address "${hostname}" is in a private/reserved range and is blocked.`,
          };
        }
      }
      return { valid: true, resolvedIp: hostname };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate URL at runtime with DNS resolution.
 *
 * This performs actual DNS resolution to detect:
 * - DNS rebinding attacks (hostname resolves to private IP)
 * - DNS resolution failures
 * - IP pinning violations (if pinnedIp is provided)
 *
 * @param url - The URL to validate
 * @param options - Validation options including optional pinned IP
 * @returns Validation result with resolved IP
 */
export async function validateUrlWithDns(
  url: string,
  options: {
    allowHttp?: boolean;
    allowedDomains?: string[];
    blockedDomains?: string[];
    pinnedIp?: string;
  } = {}
): Promise<UrlValidationResult> {
  // First, perform static validation
  const staticResult = validateExternalUrl(url, options);
  if (!staticResult.valid) {
    return staticResult;
  }

  // If we already have a resolved IP (from IP address in URL), return it
  if (staticResult.resolvedIp) {
    // Check pinned IP if provided
    if (options.pinnedIp && staticResult.resolvedIp !== options.pinnedIp) {
      return {
        valid: false,
        reason: `IP address mismatch. Expected ${options.pinnedIp}, got ${staticResult.resolvedIp}`,
        resolvedIp: staticResult.resolvedIp,
      };
    }
    return staticResult;
  }

  try {
    const { hostname } = new URL(url);

    // Perform DNS resolution
    const result = await dnsLookup(hostname);
    const resolvedIp = result.address;

    // Check if resolved IP is private
    if (isPrivateIP(resolvedIp)) {
      logger.warn(
        { url, hostname, resolvedIp },
        'SSRF attempt detected: URL resolves to private IP address'
      );
      return {
        valid: false,
        reason: `URL resolves to private IP address "${resolvedIp}". This could indicate a DNS rebinding attack.`,
        resolvedIp,
      };
    }

    // Check pinned IP if provided
    if (options.pinnedIp && resolvedIp !== options.pinnedIp) {
      logger.warn(
        { url, hostname, resolvedIp, pinnedIp: options.pinnedIp },
        'DNS rebinding detected: resolved IP does not match pinned IP'
      );
      return {
        valid: false,
        reason: `DNS rebinding detected. Expected IP ${options.pinnedIp}, resolved to ${resolvedIp}`,
        resolvedIp,
      };
    }

    return { valid: true, resolvedIp };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ url, error: errorMessage }, 'Failed to resolve URL hostname');
    return {
      valid: false,
      reason: `Failed to resolve hostname: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Secure Fetch Implementation
// =============================================================================

/**
 * Default timeout for requests in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Make a secure HTTP request with SSRF protection.
 *
 * This function should be used instead of direct fetch() calls when making
 * requests to user-provided or configurable URLs.
 *
 * Features:
 * - URL scheme validation (HTTPS required in production)
 * - Private IP blocking (RFC 1918, RFC 5737, RFC 6598)
 * - Internal hostname blocking
 * - DNS resolution validation
 * - DNS pinning support
 * - Request timeout
 * - Comprehensive audit logging
 *
 * @param url - The URL to fetch
 * @param options - Fetch options and security configuration
 * @returns Response object
 * @throws Error if URL validation fails or request times out
 */
export async function secureFetch(
  url: string,
  options: RequestInit & SecureFetchConfig = {}
): Promise<Response> {
  const {
    allowHttp,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowedDomains,
    blockedDomains,
    skipDnsCheck = false,
    pinnedIp,
    headers: configHeaders,
    ...fetchOptions
  } = options;

  const startTime = Date.now();

  // Validate URL
  let validationResult: UrlValidationResult;
  if (skipDnsCheck) {
    validationResult = validateExternalUrl(url, { allowHttp, allowedDomains, blockedDomains });
  } else {
    validationResult = await validateUrlWithDns(url, {
      allowHttp,
      allowedDomains,
      blockedDomains,
      pinnedIp,
    });
  }

  if (!validationResult.valid) {
    logger.warn(
      {
        url,
        reason: validationResult.reason,
        resolvedIp: validationResult.resolvedIp,
      },
      'Secure fetch blocked: URL validation failed'
    );
    throw new SecureFetchError(
      `Request blocked: ${validationResult.reason}`,
      'VALIDATION_FAILED',
      { url, reason: validationResult.reason }
    );
  }

  // Build headers from the extracted configHeaders
  const headers: Record<string, string> = {};

  // Add headers from options (configHeaders is the extracted headers property)
  if (configHeaders) {
    if (configHeaders instanceof Headers) {
      configHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(configHeaders)) {
      for (const [key, value] of configHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, configHeaders);
    }
  }

  // Set up timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Log the outgoing request for audit
    logger.info(
      {
        url,
        method: fetchOptions.method || 'GET',
        resolvedIp: validationResult.resolvedIp,
        hasBody: !!fetchOptions.body,
      },
      'Secure fetch: outgoing request'
    );

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    const duration = Date.now() - startTime;

    // Log the response for audit
    logger.info(
      {
        url,
        method: fetchOptions.method || 'GET',
        status: response.status,
        statusText: response.statusText,
        durationMs: duration,
      },
      'Secure fetch: response received'
    );

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn(
        { url, timeoutMs, durationMs: duration },
        'Secure fetch: request timed out'
      );
      throw new SecureFetchError(
        `Request timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        { url, timeoutMs }
      );
    }

    logger.error(
      {
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: duration,
      },
      'Secure fetch: request failed'
    );

    throw new SecureFetchError(
      `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'REQUEST_FAILED',
      { url, originalError: error }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Convenience function for secure JSON requests.
 *
 * Makes a secure fetch request and parses the response as JSON.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options and security configuration
 * @returns Parsed JSON response
 */
export async function secureFetchJson<T = unknown>(
  url: string,
  options: RequestInit & SecureFetchConfig = {}
): Promise<T> {
  const response = await secureFetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    throw new SecureFetchError(
      `HTTP ${response.status}: ${response.statusText}`,
      'HTTP_ERROR',
      { url, status: response.status, statusText: response.statusText }
    );
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// Error Types
// =============================================================================

export type SecureFetchErrorCode =
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'REQUEST_FAILED'
  | 'HTTP_ERROR'
  | 'DNS_REBINDING';

/**
 * Error thrown by secure fetch operations.
 */
export class SecureFetchError extends Error {
  public readonly code: SecureFetchErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(message: string, code: SecureFetchErrorCode, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SecureFetchError';
    this.code = code;
    this.details = details;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SecureFetchError);
    }
  }
}

// =============================================================================
// Configuration Helpers
// =============================================================================

/**
 * Get default secure fetch configuration from global config.
 */
export function getSecureFetchDefaults(): Partial<SecureFetchConfig> {
  try {
    const config = getConfig();
    return {
      allowHttp: isDevelopment(),
      timeoutMs: config.webhook?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  } catch {
    return {
      allowHttp: isDevelopment(),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }
}

/**
 * Create a pre-configured secure fetch function with default options.
 *
 * @param defaultOptions - Default options to apply to all requests
 * @returns Configured secure fetch function
 */
export function createSecureFetcher(
  defaultOptions: Partial<SecureFetchConfig> = {}
): (url: string, options?: RequestInit & SecureFetchConfig) => Promise<Response> {
  const defaults = {
    ...getSecureFetchDefaults(),
    ...defaultOptions,
  };

  return (url: string, options: RequestInit & SecureFetchConfig = {}) => {
    return secureFetch(url, { ...defaults, ...options });
  };
}

// =============================================================================
// Allowlist Management
// =============================================================================

/**
 * Default allowed domains for external services.
 * These are well-known external services that are typically safe to contact.
 */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  // Security rating services
  'api.bitsighttech.com',
  'api.securityscorecard.io',
  'api.riskrecon.com',

  // Breach databases
  'haveibeenpwned.com',

  // Certificate transparency
  'crt.sh',

  // Sanctions lists
  'sanctionslist.ofac.treas.gov',
  'webgate.ec.europa.eu',
  'scsanctions.un.org',

  // Common webhook destinations
  'hooks.slack.com',
  'discord.com',
  'api.pagerduty.com',
  'events.pagerduty.com',
  'api.opsgenie.com',

  // General APIs
  'api.github.com',
  'api.stripe.com',
];

/**
 * Get allowed domains from configuration.
 * Falls back to default allowed domains if not configured.
 */
export function getAllowedDomains(): string[] {
  try {
    const config = getConfig();
    // Check if there's a secureFetch config section
    const customDomains = (config as Record<string, unknown>)['secureFetch'] as
      | { allowedDomains?: string[] }
      | undefined;
    if (customDomains?.allowedDomains && customDomains.allowedDomains.length > 0) {
      return customDomains.allowedDomains;
    }
  } catch {
    // Config not available, use defaults
  }
  return [...DEFAULT_ALLOWED_DOMAINS];
}
