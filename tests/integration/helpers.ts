/**
 * Test Helpers
 *
 * Common helper functions for integration tests.
 */

import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'fastify';
import { getTestServer, authHeader, TEST_TENANT_ID, TEST_USER_ID } from './setup.js';
import type { Intent, IntentStatus } from '../../src/common/types.js';

// =============================================================================
// REQUEST HELPERS
// =============================================================================

export interface ApiResponse<T = unknown> {
  statusCode: number;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
  raw: unknown;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    auth?: Parameters<typeof authHeader>[0];
    skipAuth?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const server = getTestServer();
  const config = await import('../../src/common/config.js');
  const basePath = config.getConfig().api.basePath;

  const fullUrl = url.startsWith('/') ? `${basePath}${url}` : `${basePath}/${url}`;

  const injectOptions: InjectOptions = {
    method,
    url: fullUrl,
    headers: {
      'Content-Type': 'application/json',
      ...(!options.skipAuth ? authHeader(options.auth) : {}),
      ...options.headers,
    },
  };

  if (options.body !== undefined) {
    injectOptions.payload = options.body;
  }

  const response = await server.inject(injectOptions);

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    parsed = response.body;
  }

  // Handle both envelope and raw responses
  const isEnvelope = typeof parsed === 'object' && parsed !== null &&
    ('data' in parsed || 'error' in parsed);

  return {
    statusCode: response.statusCode,
    data: isEnvelope ? (parsed as { data?: T }).data : parsed as T,
    error: isEnvelope ? (parsed as { error?: ApiResponse['error'] }).error : undefined,
    meta: isEnvelope ? (parsed as { meta?: ApiResponse['meta'] }).meta : undefined,
    raw: parsed,
  };
}

/**
 * Shorthand for GET request
 */
export function get<T = unknown>(
  url: string,
  options?: Omit<Parameters<typeof apiRequest>[2], 'body'>
): Promise<ApiResponse<T>> {
  return apiRequest<T>('GET', url, options);
}

/**
 * Shorthand for POST request
 */
export function post<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<Parameters<typeof apiRequest>[2], 'body'>
): Promise<ApiResponse<T>> {
  return apiRequest<T>('POST', url, { ...options, body });
}

/**
 * Shorthand for PUT request
 */
export function put<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<Parameters<typeof apiRequest>[2], 'body'>
): Promise<ApiResponse<T>> {
  return apiRequest<T>('PUT', url, { ...options, body });
}

/**
 * Shorthand for DELETE request
 */
export function del<T = unknown>(
  url: string,
  options?: Omit<Parameters<typeof apiRequest>[2], 'body'>
): Promise<ApiResponse<T>> {
  return apiRequest<T>('DELETE', url, options);
}

// =============================================================================
// INTENT HELPERS
// =============================================================================

/**
 * Create an intent and return its ID
 */
export async function createIntent(
  submission: {
    entityId: string;
    goal: string;
    context: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    intentType?: string;
    priority?: number;
  },
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Intent> {
  const response = await post<Intent>('/intents', submission, { auth: authOptions });

  if (response.statusCode !== 202) {
    throw new Error(`Failed to create intent: ${response.error?.message ?? 'Unknown error'}`);
  }

  if (!response.data) {
    throw new Error('No data returned from intent creation');
  }

  return response.data;
}

/**
 * Wait for an intent to reach a specific status
 */
export async function waitForIntentStatus(
  intentId: string,
  targetStatus: IntentStatus | IntentStatus[],
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    auth?: Parameters<typeof authHeader>[0];
  } = {}
): Promise<Intent> {
  const { timeoutMs = 10000, pollIntervalMs = 100, auth } = options;
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await get<Intent & { events: unknown[] }>(`/intents/${intentId}`, { auth });

    if (response.statusCode === 200 && response.data) {
      if (statuses.includes(response.data.status)) {
        return response.data;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Intent ${intentId} did not reach status ${statuses.join('|')} within ${timeoutMs}ms`);
}

/**
 * Get intent with full details including events
 */
export async function getIntentWithEvents(
  intentId: string,
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Intent & { events: unknown[]; evaluations: unknown[] }> {
  const response = await get<Intent & { events: unknown[]; evaluations: unknown[] }>(
    `/intents/${intentId}`,
    { auth: authOptions }
  );

  if (response.statusCode !== 200 || !response.data) {
    throw new Error(`Failed to get intent: ${response.error?.message ?? 'Not found'}`);
  }

  return response.data;
}

// =============================================================================
// ESCALATION HELPERS
// =============================================================================

export interface Escalation {
  id: string;
  intentId: string;
  tenantId: string;
  reason: string;
  reasonCategory: string;
  escalatedTo: string;
  status: string;
  timeout: string;
  timeoutAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get escalation for an intent
 */
export async function getIntentEscalation(
  intentId: string,
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Escalation | null> {
  const response = await get<Escalation>(`/intents/${intentId}/escalation`, { auth: authOptions });

  if (response.statusCode === 404) {
    return null;
  }

  if (response.statusCode !== 200 || !response.data) {
    throw new Error(`Failed to get escalation: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

/**
 * Approve an escalation
 */
export async function approveEscalation(
  escalationId: string,
  notes?: string,
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Escalation> {
  const response = await post<Escalation>(
    `/escalations/${escalationId}/approve`,
    notes ? { notes } : {},
    { auth: authOptions }
  );

  if (response.statusCode !== 200 || !response.data) {
    throw new Error(`Failed to approve escalation: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

/**
 * Reject an escalation
 */
export async function rejectEscalation(
  escalationId: string,
  notes?: string,
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Escalation> {
  const response = await post<Escalation>(
    `/escalations/${escalationId}/reject`,
    notes ? { notes } : {},
    { auth: authOptions }
  );

  if (response.statusCode !== 200 || !response.data) {
    throw new Error(`Failed to reject escalation: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

// =============================================================================
// POLICY HELPERS
// =============================================================================

export interface Policy {
  id: string;
  tenantId: string;
  name: string;
  namespace: string;
  description?: string;
  version: number;
  status: string;
  definition: unknown;
  checksum: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

/**
 * Create a policy
 */
export async function createPolicy(
  policyData: {
    name: string;
    namespace?: string;
    description?: string;
    definition: unknown;
    metadata?: Record<string, unknown>;
  },
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Policy> {
  const response = await post<Policy>('/policies', policyData, { auth: authOptions });

  if (response.statusCode !== 201 || !response.data) {
    throw new Error(`Failed to create policy: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

/**
 * Publish a draft policy
 */
export async function publishPolicy(
  policyId: string,
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<Policy> {
  const response = await post<Policy>(`/policies/${policyId}/publish`, {}, { auth: authOptions });

  if (response.statusCode !== 200 || !response.data) {
    throw new Error(`Failed to publish policy: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

// =============================================================================
// WEBHOOK HELPERS
// =============================================================================

export interface Webhook {
  id: string;
  config: {
    url: string;
    events: string[];
    enabled: boolean;
    hasSecret: boolean;
  };
}

/**
 * Register a webhook
 */
export async function registerWebhook(
  webhookData: {
    url: string;
    secret?: string;
    events: string[];
    enabled?: boolean;
  },
  authOptions?: Parameters<typeof authHeader>[0]
): Promise<{ id: string; config: Webhook['config'] }> {
  const response = await post<{ id: string; config: Webhook['config'] }>(
    '/webhooks',
    webhookData,
    { auth: authOptions }
  );

  if (response.statusCode !== 201 || !response.data) {
    throw new Error(`Failed to register webhook: ${response.error?.message ?? 'Unknown error'}`);
  }

  return response.data;
}

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

/**
 * Assert response is successful (2xx)
 */
export function assertSuccess(response: ApiResponse, message?: string): void {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const errMsg = message ?? `Expected success but got ${response.statusCode}`;
    throw new Error(`${errMsg}: ${response.error?.message ?? JSON.stringify(response.raw)}`);
  }
}

/**
 * Assert response has specific status code
 */
export function assertStatus(response: ApiResponse, expectedStatus: number, message?: string): void {
  if (response.statusCode !== expectedStatus) {
    const errMsg = message ?? `Expected status ${expectedStatus} but got ${response.statusCode}`;
    throw new Error(`${errMsg}: ${response.error?.message ?? JSON.stringify(response.raw)}`);
  }
}

/**
 * Assert response is an error with specific code
 */
export function assertErrorCode(response: ApiResponse, expectedCode: string, message?: string): void {
  if (!response.error) {
    throw new Error(message ?? `Expected error with code ${expectedCode} but got success`);
  }
  if (response.error.code !== expectedCode) {
    throw new Error(
      message ?? `Expected error code ${expectedCode} but got ${response.error.code}`
    );
  }
}

/**
 * Assert intent has specific status
 */
export function assertIntentStatus(intent: Intent, expectedStatus: IntentStatus, message?: string): void {
  if (intent.status !== expectedStatus) {
    throw new Error(
      message ?? `Expected intent status ${expectedStatus} but got ${intent.status}`
    );
  }
}

// =============================================================================
// MOCK SERVICE HELPERS
// =============================================================================

/**
 * Create a mock webhook endpoint that captures requests
 */
export class MockWebhookCapture {
  private requests: Array<{
    body: unknown;
    headers: Record<string, string>;
    timestamp: Date;
  }> = [];

  capture(body: unknown, headers: Record<string, string>): void {
    this.requests.push({
      body,
      headers,
      timestamp: new Date(),
    });
  }

  getRequests(): typeof this.requests {
    return [...this.requests];
  }

  getLastRequest(): (typeof this.requests)[0] | undefined {
    return this.requests[this.requests.length - 1];
  }

  clear(): void {
    this.requests = [];
  }

  get count(): number {
    return this.requests.length;
  }
}
