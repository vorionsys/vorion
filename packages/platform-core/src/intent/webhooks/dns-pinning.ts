/**
 * DNS Pinning Protection
 *
 * Validates webhook IP consistency to prevent DNS rebinding attacks.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { isPrivateIP } from './ssrf-protection.js';

const logger = createLogger({ component: 'dns-pinning' });

/**
 * DNS Rebinding Attack Detection Result
 */
export interface DnsConsistencyResult {
  valid: boolean;
  reason?: string;
  currentIp?: string;
  storedIp?: string;
}

/**
 * Validate webhook IP consistency (DNS pinning).
 * Compares the currently resolved IP with the IP stored at registration time.
 * This prevents DNS rebinding attacks where an attacker:
 * 1. Registers webhook with attacker.com -> resolves to public IP (passes validation)
 * 2. Changes DNS: attacker.com -> 169.254.169.254 (AWS metadata)
 * 3. Webhook delivery resolves new DNS -> blocked because IP changed
 *
 * @param url The webhook URL to validate
 * @param storedIp The IP address stored at registration time
 * @returns Validation result with current and stored IPs for logging
 */
export async function validateWebhookIpConsistency(
  url: string,
  storedIp: string | undefined
): Promise<DnsConsistencyResult> {
  // If no stored IP (legacy webhook), skip consistency check but log warning
  if (!storedIp) {
    logger.warn(
      { url },
      'Webhook has no stored IP - DNS pinning cannot be enforced. Re-register webhook to enable DNS rebinding protection.'
    );
    return { valid: true, reason: 'No stored IP (legacy webhook)' };
  }

  try {
    const { hostname } = new URL(url);

    // For IP addresses in the URL, compare directly
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      if (hostname !== storedIp) {
        return {
          valid: false,
          reason: 'IP address in URL does not match stored IP',
          currentIp: hostname,
          storedIp,
        };
      }
      return { valid: true, currentIp: hostname, storedIp };
    }

    // Perform DNS lookup
    const dns = await import('node:dns');
    const { promisify } = await import('node:util');
    const lookup = promisify(dns.lookup);

    const result = await lookup(hostname);
    const currentIp = result.address;

    // Check if IP changed since registration
    if (currentIp !== storedIp) {
      logger.warn(
        { url, currentIp, storedIp },
        'DNS rebinding attack detected: webhook IP changed since registration'
      );
      return {
        valid: false,
        reason: 'DNS resolved IP does not match stored IP from registration',
        currentIp,
        storedIp,
      };
    }

    return { valid: true, currentIp, storedIp };
  } catch (error) {
    logger.warn({ url, storedIp, error }, 'Failed to resolve webhook URL for IP consistency check');
    return {
      valid: false,
      reason: 'Failed to resolve webhook URL hostname',
      storedIp,
    };
  }
}
