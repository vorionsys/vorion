/**
 * Webhook Types and Interfaces
 *
 * @packageDocumentation
 */

import type { ID } from '../../common/types.js';
import type { EncryptedEnvelope } from '../../common/encryption.js';

/**
 * Webhook event types
 */
export type WebhookEventType =
  | 'escalation.created'
  | 'escalation.approved'
  | 'escalation.rejected'
  | 'escalation.timeout'
  | 'intent.approved'
  | 'intent.denied'
  | 'intent.completed';

/**
 * Webhook payload structure
 */
export interface WebhookPayload {
  id: string;
  eventType: WebhookEventType;
  timestamp: string;
  tenantId: ID;
  data: Record<string, unknown>;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  url: string;
  secret?: string;
  enabled: boolean;
  events: WebhookEventType[];
  retryAttempts?: number;
  retryDelayMs?: number;
  /**
   * Resolved IP address stored at registration time for DNS pinning.
   * Used to prevent DNS rebinding attacks where an attacker changes DNS
   * after validation to point to internal IPs (e.g., 169.254.169.254).
   */
  resolvedIp?: string;
}

/**
 * Webhook delivery result
 */
export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
  deliveredAt?: string;
  /** True if delivery was skipped due to open circuit breaker */
  skippedByCircuitBreaker?: boolean;
}

/**
 * Circuit breaker states for webhook delivery
 * - closed: Normal operation, deliveries proceed
 * - open: Circuit is tripped, deliveries are skipped
 * - half_open: Testing if webhook is healthy again
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker state stored in Redis
 */
export interface CircuitBreakerData {
  /** Number of consecutive failures */
  failures: number;
  /** Timestamp when circuit was opened (milliseconds since epoch) */
  openedAt: number | null;
  /** Current state of the circuit */
  state: CircuitBreakerState;
}

/**
 * Internal interface for webhook config as stored in Redis.
 * The secret field is encrypted using AES-256-GCM.
 */
export interface StoredWebhookConfig {
  url: string;
  /** Encrypted secret envelope, or undefined if no secret */
  encryptedSecret?: EncryptedEnvelope;
  enabled: boolean;
  events: WebhookEventType[];
  retryAttempts?: number;
  retryDelayMs?: number;
  resolvedIp?: string;
}

/**
 * Webhook delivery status
 */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

/**
 * Webhook delivery record - represents a persistent delivery attempt
 */
export interface WebhookDelivery {
  id: ID;
  webhookId: ID;
  tenantId: ID;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: string;
}

/**
 * Options for creating a new delivery record
 */
export interface CreateDeliveryOptions {
  webhookId: ID;
  tenantId: ID;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Options for updating delivery status
 */
export interface UpdateDeliveryStatusOptions {
  status: WebhookDeliveryStatus;
  attempts?: number;
  lastAttemptAt?: Date;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  deliveredAt?: Date | null;
  responseStatus?: number | null;
  responseBody?: string | null;
}

/**
 * Numeric values for circuit breaker states (for metrics)
 */
export const CIRCUIT_STATE_VALUES: Record<CircuitBreakerState, number> = {
  closed: 0,
  open: 1,
  half_open: 2,
};
