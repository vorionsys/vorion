/**
 * Cognigate TypeScript SDK - Client
 *
 * Main client class for interacting with the Cognigate API
 */

import {
  CognigateConfig,
  TrustStatus,
  GovernanceResult,
  Intent,
  IntentParseResult,
  ProofRecord,
  ProofChainStats,
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  PaginatedResponse,
  TrustTier,
  TIER_THRESHOLDS,
  TrustStatusSchema,
  GovernanceResultSchema,
  ProofRecordSchema,
  AgentSchema,
} from './types.js';

const DEFAULT_BASE_URL = 'https://cognigate.dev/v1';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;

/**
 * Error class for Cognigate API errors.
 *
 * Provides structured error information including a machine-readable
 * error code, HTTP status, and optional detail payload for debugging.
 */
export class CognigateError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., 'MISSING_API_KEY', 'REQUEST_FAILED') */
    public code: string,
    /** HTTP status code from the API response, if applicable */
    public status?: number,
    /** Additional error context or field-level details */
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CognigateError';
  }
}

/**
 * Main Cognigate SDK client for AI agent governance.
 *
 * Provides namespaced sub-clients for agents, trust, governance,
 * and proof operations. Handles authentication, retries with
 * exponential backoff, and response validation via Zod schemas.
 *
 * @example
 * ```typescript
 * const client = new Cognigate({ apiKey: 'cg_live_abc123' });
 *
 * // Manage agents
 * const agent = await client.agents.create({ name: 'My Agent' });
 *
 * // Check trust
 * const status = await client.trust.getStatus(agent.id);
 *
 * // Evaluate governance
 * const { result } = await client.governance.evaluate(agent.id, 'Send email to user');
 *
 * // Query audit trail
 * const stats = await client.proofs.getStats(agent.id);
 * ```
 */
export class Cognigate {
  private readonly config: Required<Omit<CognigateConfig, 'webhookSecret'>> & { webhookSecret?: string };
  /** Sub-client for agent CRUD operations. */
  public readonly agents: AgentsClient;
  /** Sub-client for trust score queries and outcome reporting. */
  public readonly trust: TrustClient;
  /** Sub-client for intent parsing, governance enforcement, and permission checks. */
  public readonly governance: GovernanceClient;
  /** Sub-client for proof record queries and chain integrity verification. */
  public readonly proofs: ProofsClient;

  constructor(config: CognigateConfig) {
    if (!config.apiKey) {
      throw new CognigateError('API key is required', 'MISSING_API_KEY');
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      timeout: config.timeout || DEFAULT_TIMEOUT,
      retries: config.retries || DEFAULT_RETRIES,
      debug: config.debug || false,
      webhookSecret: config.webhookSecret,
    };

    // Initialize sub-clients
    this.agents = new AgentsClient(this);
    this.trust = new TrustClient(this);
    this.governance = new GovernanceClient(this);
    this.proofs = new ProofsClient(this);
  }

  /**
   * Make an authenticated request to the Cognigate API with automatic retry.
   *
   * Retries on server errors (5xx) and network failures with exponential backoff.
   * Client errors (4xx) are thrown immediately without retry.
   *
   * @typeParam T - Expected response type
   * @param method - HTTP method
   * @param path - API path (appended to baseUrl)
   * @param body - Optional request body (serialized as JSON)
   * @returns Parsed response data
   * @throws {CognigateError} On API errors or exhausted retries
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'X-SDK-Version': '1.0.0',
      'X-SDK-Language': 'typescript',
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
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

        if (this.config.debug) {
          console.log(`[Cognigate] ${method} ${path} -> ${response.status}`);
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
          throw new CognigateError(
            (errorData.message as string) || `Request failed with status ${response.status}`,
            (errorData.code as string) || 'REQUEST_FAILED',
            response.status,
            errorData.details as Record<string, unknown> | undefined
          );
        }

        const data = await response.json();
        return data as T;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof CognigateError && error.status && error.status < 500) {
          throw error; // Don't retry client errors
        }

        if (attempt < this.config.retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new CognigateError('Request failed', 'UNKNOWN_ERROR');
  }

  /**
   * Check the Cognigate API health and version.
   *
   * @returns Server health status, API version, and server timestamp
   */
  async health(): Promise<{ status: string; version: string; timestamp: Date }> {
    return this.request('GET', '/health');
  }

  /**
   * Convert a numeric trust score (0-1000) to a TrustTier enum value.
   *
   * @param score - Trust score on the 0-1000 scale
   * @returns The corresponding TrustTier (T0-T7)
   */
  static getTierFromScore(score: number): TrustTier {
    if (score >= 951) return TrustTier.T7_AUTONOMOUS;
    if (score >= 876) return TrustTier.T6_CERTIFIED;
    if (score >= 800) return TrustTier.T5_TRUSTED;
    if (score >= 650) return TrustTier.T4_STANDARD;
    if (score >= 500) return TrustTier.T3_MONITORED;
    if (score >= 350) return TrustTier.T2_PROVISIONAL;
    if (score >= 200) return TrustTier.T1_OBSERVED;
    return TrustTier.T0_SANDBOX;
  }

  /**
   * Get the human-readable name for a trust tier.
   *
   * @param tier - The trust tier enum value
   * @returns Human-readable tier name (e.g., 'Standard', 'Trusted')
   */
  static getTierName(tier: TrustTier): string {
    return TIER_THRESHOLDS[tier].name;
  }

  /**
   * Get the score thresholds and name for a trust tier.
   *
   * @param tier - The trust tier enum value
   * @returns Object with min score, max score, and tier name
   */
  static getTierThresholds(tier: TrustTier): { min: number; max: number; name: string } {
    return TIER_THRESHOLDS[tier];
  }
}

// =============================================================================
// AGENTS CLIENT
// =============================================================================

/**
 * Sub-client for agent lifecycle management (CRUD operations).
 *
 * Accessed via `client.agents`. Handles creating, reading, updating,
 * deleting, pausing, and resuming governed agents.
 */
class AgentsClient {
  constructor(private client: Cognigate) {}

  /**
   * List all agents with optional filtering and pagination.
   *
   * @param params - Optional pagination and status filter
   * @returns Paginated list of agents
   */
  async list(params?: {
    page?: number;
    pageSize?: number;
    status?: 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
  }): Promise<PaginatedResponse<Agent>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.status) query.set('status', params.status);

    const queryString = query.toString();
    const path = `/agents${queryString ? `?${queryString}` : ''}`;

    return this.client.request('GET', path);
  }

  /**
   * Get a specific agent by ID, with Zod schema validation.
   *
   * @param agentId - Unique agent identifier
   * @returns The validated Agent record
   * @throws {CognigateError} If the agent is not found
   */
  async get(agentId: string): Promise<Agent> {
    const response = await this.client.request<Agent>('GET', `/agents/${agentId}`);
    return AgentSchema.parse(response) as Agent;
  }

  /**
   * Create a new governed agent.
   *
   * @param data - Agent creation parameters (name, description, capabilities)
   * @returns The newly created Agent record
   */
  async create(data: CreateAgentRequest): Promise<Agent> {
    const response = await this.client.request<Agent>('POST', '/agents', data);
    return AgentSchema.parse(response) as Agent;
  }

  /**
   * Update an existing agent's properties.
   *
   * @param agentId - Unique agent identifier
   * @param data - Fields to update (only provided fields are changed)
   * @returns The updated Agent record
   */
  async update(agentId: string, data: UpdateAgentRequest): Promise<Agent> {
    const response = await this.client.request<Agent>('PATCH', `/agents/${agentId}`, data);
    return AgentSchema.parse(response) as Agent;
  }

  /**
   * Permanently delete an agent and its associated data.
   *
   * @param agentId - Unique agent identifier
   */
  async delete(agentId: string): Promise<void> {
    await this.client.request('DELETE', `/agents/${agentId}`);
  }

  /**
   * Pause an active agent, suspending its governance operations.
   *
   * @param agentId - Unique agent identifier
   * @returns The updated Agent record with PAUSED status
   */
  async pause(agentId: string): Promise<Agent> {
    return this.update(agentId, { status: 'PAUSED' });
  }

  /**
   * Resume a paused agent, restoring its governance operations.
   *
   * @param agentId - Unique agent identifier
   * @returns The updated Agent record with ACTIVE status
   */
  async resume(agentId: string): Promise<Agent> {
    return this.update(agentId, { status: 'ACTIVE' });
  }
}

// =============================================================================
// TRUST CLIENT
// =============================================================================

/**
 * Sub-client for trust score queries and outcome reporting.
 *
 * Accessed via `client.trust`. Provides methods to query current trust
 * status, view trust history over time, and submit action outcomes
 * that update trust scores.
 */
class TrustClient {
  constructor(private client: Cognigate) {}

  /**
   * Get the current trust status for an entity (agent).
   *
   * Returns the composite trust score, tier, capabilities, factor scores,
   * compliance state, and any active warnings.
   *
   * @param entityId - Unique entity identifier
   * @returns Validated TrustStatus with full trust profile
   */
  async getStatus(entityId: string): Promise<TrustStatus> {
    const response = await this.client.request<TrustStatus>('GET', `/trust/${entityId}`);
    return TrustStatusSchema.parse(response) as TrustStatus;
  }

  /**
   * Get the trust score history for an entity over a time range.
   *
   * @param entityId - Unique entity identifier
   * @param params - Optional time range and result limit
   * @returns Array of trust score snapshots with tier and timestamp
   */
  async getHistory(
    entityId: string,
    params?: { from?: Date; to?: Date; limit?: number }
  ): Promise<Array<{ score: number; tier: TrustTier; timestamp: Date }>> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from.toISOString());
    if (params?.to) query.set('to', params.to.toISOString());
    if (params?.limit) query.set('limit', params.limit.toString());

    const queryString = query.toString();
    const path = `/trust/${entityId}/history${queryString ? `?${queryString}` : ''}`;

    return this.client.request('GET', path);
  }

  /**
   * Submit an action outcome to update an entity's trust score.
   *
   * Positive outcomes increase trust; negative outcomes decrease it.
   * The response includes the updated trust status.
   *
   * @param entityId - Unique entity identifier
   * @param proofId - Proof record ID from the governance evaluation
   * @param outcome - Action outcome with success flag and optional metrics
   * @returns Updated TrustStatus reflecting the score change
   */
  async submitOutcome(
    entityId: string,
    proofId: string,
    outcome: {
      success: boolean;
      metrics?: Record<string, number>;
      notes?: string;
    }
  ): Promise<TrustStatus> {
    const response = await this.client.request<TrustStatus>(
      'POST',
      `/trust/${entityId}/outcome`,
      { proofId, ...outcome }
    );
    return TrustStatusSchema.parse(response) as TrustStatus;
  }
}

// =============================================================================
// GOVERNANCE CLIENT
// =============================================================================

/**
 * Sub-client for governance operations: intent parsing, enforcement, and permission checks.
 *
 * Accessed via `client.governance`. Provides the core governance pipeline:
 * parse raw input into a structured intent, evaluate it against trust
 * policies, and optionally check permissions without creating proof records.
 */
class GovernanceClient {
  constructor(private client: Cognigate) {}

  /**
   * Parse raw user/agent input into a structured Intent.
   *
   * The API uses NLP to extract the intended action, parameters,
   * risk level, and required capabilities from unstructured text.
   *
   * @param entityId - ID of the entity submitting the intent
   * @param rawInput - Unstructured text describing the intended action
   * @returns Parsed intent with confidence score and alternatives
   */
  async parseIntent(entityId: string, rawInput: string): Promise<IntentParseResult> {
    return this.client.request('POST', '/governance/parse', {
      entityId,
      rawInput,
    });
  }

  /**
   * Enforce governance rules on a structured intent.
   *
   * Evaluates the intent against the entity's trust score, capabilities,
   * and active policies. Creates a proof record in the audit trail.
   *
   * @param intent - The structured intent to evaluate
   * @returns Governance decision with capabilities, reasoning, and proof ID
   */
  async enforce(intent: Intent): Promise<GovernanceResult> {
    const response = await this.client.request<GovernanceResult>(
      'POST',
      '/governance/enforce',
      intent
    );
    return GovernanceResultSchema.parse(response) as GovernanceResult;
  }

  /**
   * Parse and enforce governance in a single call.
   *
   * Combines `parseIntent()` and `enforce()` for convenience.
   * First parses raw input into an intent, then evaluates it.
   *
   * @param entityId - ID of the entity performing the action
   * @param rawInput - Unstructured text describing the intended action
   * @returns The parsed intent and its governance evaluation result
   */
  async evaluate(entityId: string, rawInput: string): Promise<{
    intent: Intent;
    result: GovernanceResult;
  }> {
    const parseResult = await this.parseIntent(entityId, rawInput);
    const result = await this.enforce(parseResult.intent);
    return {
      intent: parseResult.intent,
      result,
    };
  }

  /**
   * Check if an action is allowed without creating a proof record.
   *
   * Useful for pre-flight permission checks in UI or planning stages.
   *
   * @param entityId - ID of the entity to check
   * @param action - Action to check permission for
   * @param capabilities - Capabilities required for the action
   * @returns Whether the action would be allowed, with a reason
   */
  async canPerform(
    entityId: string,
    action: string,
    capabilities: string[]
  ): Promise<{ allowed: boolean; reason: string }> {
    return this.client.request('POST', '/governance/check', {
      entityId,
      action,
      capabilities,
    });
  }
}

// =============================================================================
// PROOFS CLIENT
// =============================================================================

/**
 * Sub-client for querying and verifying the immutable proof chain (audit trail).
 *
 * Accessed via `client.proofs`. Provides methods to retrieve individual
 * proof records, list records with filtering, get aggregate statistics,
 * and verify hash chain integrity.
 */
class ProofsClient {
  constructor(private client: Cognigate) {}

  /**
   * Get a specific proof record by ID, with Zod schema validation.
   *
   * @param proofId - Unique proof record identifier
   * @returns The validated ProofRecord
   * @throws {CognigateError} If the proof is not found
   */
  async get(proofId: string): Promise<ProofRecord> {
    const response = await this.client.request<ProofRecord>('GET', `/proofs/${proofId}`);
    return ProofRecordSchema.parse(response) as ProofRecord;
  }

  /**
   * List proof records for an entity with optional filtering and pagination.
   *
   * @param entityId - Entity to list proofs for
   * @param params - Optional pagination, time range, and outcome filters
   * @returns Paginated list of proof records
   */
  async list(
    entityId: string,
    params?: {
      page?: number;
      pageSize?: number;
      from?: Date;
      to?: Date;
      outcome?: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
    }
  ): Promise<PaginatedResponse<ProofRecord>> {
    const query = new URLSearchParams();
    query.set('entityId', entityId);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.from) query.set('from', params.from.toISOString());
    if (params?.to) query.set('to', params.to.toISOString());
    if (params?.outcome) query.set('outcome', params.outcome);

    return this.client.request('GET', `/proofs?${query.toString()}`);
  }

  /**
   * Get aggregate statistics for an entity's proof chain.
   *
   * @param entityId - Entity to get stats for
   * @returns Chain statistics including total records, success rate, and integrity status
   */
  async getStats(entityId: string): Promise<ProofChainStats> {
    return this.client.request('GET', `/proofs/stats/${entityId}`);
  }

  /**
   * Verify the cryptographic integrity of an entity's proof chain.
   *
   * Walks the hash chain and confirms each record's hash matches
   * its contents and links correctly to the previous record.
   *
   * @param entityId - Entity whose proof chain to verify
   * @returns Verification result with validity flag and any errors found
   */
  async verify(entityId: string): Promise<{
    valid: boolean;
    errors: string[];
    lastVerified: Date;
  }> {
    return this.client.request('POST', `/proofs/verify/${entityId}`);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { AgentsClient, TrustClient, GovernanceClient, ProofsClient };
