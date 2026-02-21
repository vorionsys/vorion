/**
 * SSRF Protection for Webhooks
 *
 * Provides URL validation and private IP detection to prevent
 * Server-Side Request Forgery attacks on webhook delivery.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'ssrf-protection' });

/**
 * Check if an IP address is in a private/internal range
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  const ipv4PrivateRanges = [
    /^127\./, // Loopback
    /^10\./, // Class A private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
    /^192\.168\./, // Class C private
    /^169\.254\./, // Link-local
    /^0\./, // Current network
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Shared address space (CGNAT)
    /^192\.0\.0\./, // IETF Protocol Assignments
    /^192\.0\.2\./, // TEST-NET-1
    /^198\.51\.100\./, // TEST-NET-2
    /^203\.0\.113\./, // TEST-NET-3
    /^224\./, // Multicast
    /^240\./, // Reserved
    /^255\.255\.255\.255$/, // Broadcast
  ];

  // IPv6 private/special ranges
  const ipv6PrivateRanges = [
    /^::1$/, // Loopback
    /^fe80:/i, // Link-local
    /^fc00:/i, // Unique local address
    /^fd00:/i, // Unique local address
    /^ff00:/i, // Multicast
    /^::ffff:127\./i, // IPv4-mapped loopback
    /^::ffff:10\./i, // IPv4-mapped Class A private
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i, // IPv4-mapped Class B private
    /^::ffff:192\.168\./i, // IPv4-mapped Class C private
  ];

  // Check IPv4
  for (const range of ipv4PrivateRanges) {
    if (range.test(ip)) {
      return true;
    }
  }

  // Check IPv6
  for (const range of ipv6PrivateRanges) {
    if (range.test(ip)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a webhook URL for SSRF protection
 */
export async function validateWebhookUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS (except for localhost in development)
    if (parsed.protocol !== 'https:') {
      // Allow HTTP only for localhost in non-production
      const isDevelopment = process.env['VORION_ENV'] !== 'production';
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

      if (!(isDevelopment && isLocalhost)) {
        return { valid: false, reason: 'Webhook URL must use HTTPS' };
      }
    }

    // Block internal hostnames
    const blockedHostnames = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      'metadata.google.internal', // GCP metadata
      '169.254.169.254', // AWS/Azure/GCP metadata
      'metadata.internal',
      'kubernetes.default',
      'kubernetes.default.svc',
    ];

    if (blockedHostnames.includes(parsed.hostname.toLowerCase())) {
      // Allow localhost only in development
      const isDevelopment = process.env['VORION_ENV'] !== 'production';
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

      if (!(isDevelopment && isLocalhost)) {
        return { valid: false, reason: 'Webhook URL hostname is blocked' };
      }
    }

    // Block internal domains
    const blockedPatterns = [
      /\.internal$/i,
      /\.local$/i,
      /\.localhost$/i,
      /\.svc$/i,
      /\.cluster\.local$/i,
      /\.corp$/i,
      /\.lan$/i,
      /\.home$/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(parsed.hostname)) {
        return { valid: false, reason: 'Webhook URL domain pattern is blocked' };
      }
    }

    // Resolve hostname and check for private IPs
    const ipMatch = parsed.hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    if (ipMatch && isPrivateIP(parsed.hostname)) {
      return { valid: false, reason: 'Webhook URL resolves to private IP address' };
    }

    // Block ports commonly used for internal services
    const blockedPorts = ['22', '23', '25', '3306', '5432', '6379', '27017', '9200', '11211'];
    if (parsed.port && blockedPorts.includes(parsed.port)) {
      return { valid: false, reason: `Webhook URL port ${parsed.port} is blocked` };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid webhook URL format' };
  }
}

/**
 * Validate URL at connection time (DNS resolution check)
 * This performs actual DNS resolution to catch DNS rebinding attacks
 */
export async function validateWebhookUrlAtRuntime(url: string): Promise<{ valid: boolean; reason?: string; resolvedIP?: string }> {
  const basicValidation = await validateWebhookUrl(url);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  try {
    const { hostname } = new URL(url);

    // Skip DNS check for IP addresses (already validated)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return { valid: true, resolvedIP: hostname };
    }

    // Perform DNS lookup
    const dns = await import('node:dns');
    const { promisify } = await import('node:util');
    const lookup = promisify(dns.lookup);

    const result = await lookup(hostname);
    const resolvedIP = result.address;

    if (isPrivateIP(resolvedIP)) {
      logger.warn(
        { url, resolvedIP },
        'SSRF attempt detected: webhook URL resolves to private IP'
      );
      return {
        valid: false,
        reason: 'Webhook URL resolves to private IP address',
        resolvedIP,
      };
    }

    return { valid: true, resolvedIP };
  } catch (error) {
    logger.warn({ url, error }, 'Failed to resolve webhook URL');
    return { valid: false, reason: 'Failed to resolve webhook URL hostname' };
  }
}
