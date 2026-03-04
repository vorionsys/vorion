/**
 * Webhook Module
 *
 * Re-exports from the refactored webhook submodules for backward compatibility.
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// SSRF Protection
export {
  isPrivateIP,
  validateWebhookUrl,
  validateWebhookUrlAtRuntime,
} from './ssrf-protection.js';

// Signature utilities
export {
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  generateSignature,
  verifyWebhookSignature,
} from './signature.js';

// DNS Pinning
export type { DnsConsistencyResult } from './dns-pinning.js';
export { validateWebhookIpConsistency } from './dns-pinning.js';

// Delivery Repository
export {
  WebhookDeliveryRepository,
  createWebhookDeliveryRepository,
  calculateNextRetryTime,
} from './delivery-repository.js';
