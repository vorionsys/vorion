/**
 * Webhook Signature Utilities
 *
 * HMAC-SHA256 signature generation and verification for webhook payloads.
 * Includes timestamp validation to prevent replay attacks.
 *
 * @packageDocumentation
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header name for the HMAC signature
 * Format: v1=<hmac-sha256-hex>
 */
export const SIGNATURE_HEADER = 'X-Vorion-Signature';

/**
 * Header name for the signature timestamp (Unix seconds)
 * Used to prevent replay attacks
 */
export const SIGNATURE_TIMESTAMP_HEADER = 'X-Vorion-Timestamp';

/**
 * Current signature version
 * Allows for future signature algorithm upgrades
 */
const SIGNATURE_VERSION = 'v1';

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 *
 * The signature is computed over a signed payload that combines the timestamp
 * and the JSON payload body to prevent replay attacks.
 *
 * @param payload - The JSON payload string to sign
 * @param secret - The webhook secret shared with the recipient
 * @param timestamp - Unix timestamp in seconds when the request was generated
 * @returns Versioned signature string in format "v1=<hmac-hex>"
 */
export function generateSignature(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `${SIGNATURE_VERSION}=${hmac}`;
}

/**
 * Verify webhook signature for incoming requests.
 *
 * Security Features:
 * 1. Timestamp validation to prevent replay attacks
 * 2. Timing-safe comparison to prevent timing attacks
 * 3. Signed payload covers both timestamp and content
 *
 * @param payload - The raw JSON payload string from the request body
 * @param signature - The signature from the X-Vorion-Signature header
 * @param secret - The webhook secret configured for this endpoint
 * @param timestamp - The timestamp from the X-Vorion-Timestamp header (Unix seconds)
 * @param toleranceSeconds - Maximum age of the request in seconds (default: 300 = 5 minutes)
 * @returns true if the signature is valid and timestamp is within tolerance
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: number,
  toleranceSeconds = 300
): boolean {
  // Validate inputs
  if (!payload || !signature || !secret || !timestamp) {
    return false;
  }

  // Check timestamp is within tolerance (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  // Generate expected signature
  const expectedSignature = generateSignature(payload, secret, timestamp);

  // Convert to buffers for timing-safe comparison
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  // Signatures must be same length for timing-safe comparison
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
