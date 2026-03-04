/**
 * AgentAnchor API Client
 *
 * Enterprise client for the AgentAnchor certification platform.
 * Handles proof submission, verification, and certificate management.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { sha256 } from '../../common/crypto.js';

const logger = createLogger({ component: 'agent-anchor-client' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * AgentAnchor API configuration
 */
export interface AgentAnchorConfig {
  endpoint: string;
  apiKey: string;
  agentId: string;
  timeout?: number;
  retries?: number;
}

/**
 * Proof submission request
 */
export interface ProofSubmissionRequest {
  agentId: string;
  batchId: string;
  merkleRoot: string;
  proofCount: number;
  startPosition: number;
  endPosition: number;
  chainAnchors: ChainAnchorInfo[];
  metadata?: Record<string, unknown>;
}

/**
 * Chain anchor information
 */
export interface ChainAnchorInfo {
  network: string;
  chainId: number;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  contractAddress?: string;
  timestamp: string;
}

/**
 * Proof submission response
 */
export interface ProofSubmissionResponse {
  submissionId: string;
  status: 'pending' | 'processing' | 'verified' | 'rejected';
  certificateId?: string;
  certificateUrl?: string;
  verificationToken?: string;
  estimatedVerificationTime?: number;
  createdAt: string;
}

/**
 * Certificate details
 */
export interface Certificate {
  certificateId: string;
  agentId: string;
  merkleRoot: string;
  proofCount: number;
  chainAnchors: ChainAnchorInfo[];
  issuedAt: string;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired';
  verificationUrl: string;
  signature: string;
  issuer: {
    name: string;
    publicKey: string;
    endpoint: string;
  };
}

/**
 * Verification request
 */
export interface VerificationRequest {
  proofHash: string;
  merkleProof: string[];
  merkleRoot: string;
  certificateId: string;
}

/**
 * Verification response
 */
export interface VerificationResponse {
  valid: boolean;
  proofHash: string;
  certificateId: string;
  chainAnchors: ChainAnchorInfo[];
  verifiedAt: string;
  details?: {
    merkleVerified: boolean;
    chainVerified: boolean;
    certificateValid: boolean;
    errors?: string[];
  };
}

/**
 * Agent trust status from AgentAnchor
 */
export interface AgentTrustStatus {
  agentId: string;
  trustScore: number;
  trustTier: string;
  totalProofsAnchored: number;
  totalCertificates: number;
  lastAnchorAt?: string;
  stakingStatus?: {
    staked: boolean;
    amount: string;
    slashable: boolean;
  };
  registrationStatus: 'pending' | 'active' | 'suspended' | 'revoked';
}

/**
 * API error response
 */
export interface AgentAnchorError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryAfter?: number;
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half-open';
  nextRetry: Date | null;
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailure: null,
    state: 'closed',
    nextRetry: null,
  };

  constructor(
    private threshold: number = 5,
    private resetTimeMs: number = 60000
  ) {}

  canExecute(): boolean {
    if (this.state.state === 'closed') {
      return true;
    }

    if (this.state.state === 'open') {
      if (this.state.nextRetry && new Date() >= this.state.nextRetry) {
        this.state.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open
    return true;
  }

  recordSuccess(): void {
    this.state = {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      nextRetry: null,
    };
  }

  recordFailure(): void {
    this.state.failures++;
    this.state.lastFailure = new Date();

    if (this.state.failures >= this.threshold) {
      this.state.state = 'open';
      this.state.nextRetry = new Date(Date.now() + this.resetTimeMs);
      logger.warn(
        {
          failures: this.state.failures,
          nextRetry: this.state.nextRetry,
        },
        'Circuit breaker opened'
      );
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

// =============================================================================
// AGENT ANCHOR CLIENT
// =============================================================================

/**
 * AgentAnchor API Client
 *
 * Features:
 * - Proof batch submission
 * - Certificate retrieval and verification
 * - Agent trust status queries
 * - Circuit breaker for resilience
 * - Automatic retry with exponential backoff
 * - Request signing
 */
export class AgentAnchorClient {
  private config: Required<AgentAnchorConfig>;
  private circuitBreaker: CircuitBreaker;

  constructor(config: AgentAnchorConfig) {
    this.config = {
      endpoint: config.endpoint.replace(/\/$/, ''),
      apiKey: config.apiKey,
      agentId: config.agentId,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
    };

    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    retryCount: number = 0
  ): Promise<T> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open - AgentAnchor API unavailable');
    }

    const url = `${this.config.endpoint}${path}`;
    const timestamp = new Date().toISOString();
    const requestId = crypto.randomUUID();

    // Create signature for request authentication
    const signaturePayload = [
      method,
      path,
      timestamp,
      body ? JSON.stringify(body) : '',
    ].join('\n');

    const signature = await sha256(signaturePayload + this.config.apiKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
      'X-Agent-ID': this.config.agentId,
      'X-Timestamp': timestamp,
      'X-Request-ID': requestId,
      'X-Signature': signature,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as AgentAnchorError;

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = errorBody.retryAfter ?? 60;
          logger.warn({ retryAfter }, 'Rate limited by AgentAnchor');

          if (retryCount < this.config.retries) {
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            return this.request<T>(method, path, body, retryCount + 1);
          }
        }

        // Handle server errors with retry
        if (response.status >= 500 && retryCount < this.config.retries) {
          const backoff = Math.pow(2, retryCount) * 1000;
          await new Promise((r) => setTimeout(r, backoff));
          return this.request<T>(method, path, body, retryCount + 1);
        }

        this.circuitBreaker.recordFailure();

        throw new AgentAnchorApiError(
          errorBody.code ?? 'UNKNOWN_ERROR',
          errorBody.message ?? `HTTP ${response.status}`,
          errorBody.details
        );
      }

      const data = await response.json() as T;
      this.circuitBreaker.recordSuccess();

      return data;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.circuitBreaker.recordFailure();
        throw new AgentAnchorApiError('TIMEOUT', 'Request timed out');
      }

      if (error instanceof AgentAnchorApiError) {
        throw error;
      }

      // Network error - retry
      if (retryCount < this.config.retries) {
        const backoff = Math.pow(2, retryCount) * 1000;
        logger.warn(
          { error: (error as Error).message, retryCount, backoff },
          'Network error, retrying'
        );
        await new Promise((r) => setTimeout(r, backoff));
        return this.request<T>(method, path, body, retryCount + 1);
      }

      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Submit proof batch for certification
   */
  async submitProofs(request: ProofSubmissionRequest): Promise<ProofSubmissionResponse> {
    logger.info(
      {
        batchId: request.batchId,
        proofCount: request.proofCount,
        chains: request.chainAnchors.length,
      },
      'Submitting proofs to AgentAnchor'
    );

    const response = await this.request<ProofSubmissionResponse>(
      'POST',
      '/api/v1/proofs/submit',
      request
    );

    logger.info(
      {
        submissionId: response.submissionId,
        status: response.status,
        certificateId: response.certificateId,
      },
      'Proof submission completed'
    );

    return response;
  }

  /**
   * Get submission status
   */
  async getSubmissionStatus(submissionId: string): Promise<ProofSubmissionResponse> {
    return this.request<ProofSubmissionResponse>(
      'GET',
      `/api/v1/proofs/submissions/${submissionId}`
    );
  }

  /**
   * Get certificate details
   */
  async getCertificate(certificateId: string): Promise<Certificate> {
    return this.request<Certificate>(
      'GET',
      `/api/v1/certificates/${certificateId}`
    );
  }

  /**
   * Verify a specific proof
   */
  async verifyProof(request: VerificationRequest): Promise<VerificationResponse> {
    return this.request<VerificationResponse>(
      'POST',
      '/api/v1/proofs/verify',
      request
    );
  }

  /**
   * Get agent trust status
   */
  async getAgentStatus(agentId?: string): Promise<AgentTrustStatus> {
    const id = agentId ?? this.config.agentId;
    return this.request<AgentTrustStatus>(
      'GET',
      `/api/v1/agents/${id}/status`
    );
  }

  /**
   * List certificates for agent
   */
  async listCertificates(options?: {
    limit?: number;
    offset?: number;
    status?: 'active' | 'revoked' | 'expired';
  }): Promise<{
    certificates: Certificate[];
    total: number;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.status) params.set('status', options.status);

    const query = params.toString();
    const path = `/api/v1/agents/${this.config.agentId}/certificates${
      query ? `?${query}` : ''
    }`;

    return this.request(
      'GET',
      path
    );
  }

  /**
   * Poll for submission completion
   */
  async waitForVerification(
    submissionId: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<ProofSubmissionResponse> {
    const timeout = options?.timeoutMs ?? 300000; // 5 minutes
    const pollInterval = options?.pollIntervalMs ?? 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getSubmissionStatus(submissionId);

      if (status.status === 'verified' || status.status === 'rejected') {
        return status;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new AgentAnchorApiError(
      'VERIFICATION_TIMEOUT',
      `Verification timed out after ${timeout}ms`
    );
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    version?: string;
  }> {
    const startTime = Date.now();
    try {
      const response = await this.request<{ version: string }>(
        'GET',
        '/api/v1/health'
      );
      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
        version: response.version,
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
      };
    }
  }
}

/**
 * AgentAnchor API Error
 */
export class AgentAnchorApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentAnchorApiError';
  }
}

/**
 * Create AgentAnchor client from environment
 */
export function createAgentAnchorClient(overrides?: Partial<AgentAnchorConfig>): AgentAnchorClient {
  const config: AgentAnchorConfig = {
    endpoint: overrides?.endpoint ?? process.env['AGENT_ANCHOR_ENDPOINT'] ?? 'https://api.agentanchor.io',
    apiKey: overrides?.apiKey ?? process.env['AGENT_ANCHOR_API_KEY'] ?? '',
    agentId: overrides?.agentId ?? process.env['AGENT_ANCHOR_AGENT_ID'] ?? '',
    timeout: overrides?.timeout ?? parseInt(process.env['AGENT_ANCHOR_TIMEOUT'] ?? '30000', 10),
    retries: overrides?.retries ?? parseInt(process.env['AGENT_ANCHOR_RETRIES'] ?? '3', 10),
  };

  if (!config.apiKey) {
    logger.warn('AgentAnchor API key not configured - submissions will fail');
  }

  if (!config.agentId) {
    logger.warn('AgentAnchor agent ID not configured - submissions will fail');
  }

  return new AgentAnchorClient(config);
}

/**
 * Validate AgentAnchor configuration
 */
export function validateAgentAnchorConfig(config: Partial<AgentAnchorConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.endpoint) {
    errors.push('endpoint is required');
  } else if (!config.endpoint.startsWith('http')) {
    errors.push('endpoint must be a valid URL');
  }

  if (!config.apiKey) {
    errors.push('apiKey is required');
  } else if (config.apiKey.length < 32) {
    errors.push('apiKey appears invalid (too short)');
  }

  if (!config.agentId) {
    errors.push('agentId is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
