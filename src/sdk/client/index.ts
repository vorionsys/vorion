/**
 * Vorion Security SDK - API Client
 * Client for interacting with Vorion security platform
 */

import {
  VorionClientConfig,
  PolicyDefinition,
  PolicyListOptions,
  PolicyListResponse,
  SimulationRequest,
  SimulationResponse,
  AuditLogQuery,
  AuditLogResponse,
  PolicyCompareResponse,
  ApiResponse,
  WebSocketEvent,
  WebSocketEventType,
  PolicyChangeEvent,
  EvaluationEvent,
  AlertEvent,
} from '../types';

// ============================================================================
// HTTP Client
// ============================================================================

interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

class HttpClient {
  private baseUrl: string;
  private apiKey?: string;
  private apiSecret?: string;
  private timeout: number;
  private retries: number;

  constructor(config: VorionClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }

  async request<T>(options: HttpRequestOptions): Promise<ApiResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const headers = this.buildHeaders(options.headers);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await response.json() as ApiResponse<T>;

        if (!response.ok) {
          throw new VorionApiError(
            data.error?.message || 'Request failed',
            data.error?.code || 'UNKNOWN_ERROR',
            response.status
          );
        }

        return data;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof VorionApiError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Wait before retrying
        if (attempt < this.retries) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this.baseUrl);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Client-Version': '1.0.0',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    if (this.apiSecret) {
      headers['X-API-Secret'] = this.apiSecret;
    }

    if (extra) {
      Object.assign(headers, extra);
    }

    return headers;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// WebSocket Client
// ============================================================================

type EventHandler<T> = (event: WebSocketEvent<T>) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private handlers: Map<WebSocketEventType, Set<EventHandler<unknown>>> = new Map();
  private isConnected: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: VorionClientConfig) {
    const wsUrl = config.baseUrl.replace(/^http/, 'ws');
    this.url = `${wsUrl}/ws`;
    this.reconnect = config.websocket?.reconnect ?? true;
    this.reconnectInterval = config.websocket?.reconnectInterval ?? 5000;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WebSocketEvent;
            this.emit(data.type, data);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          if (this.reconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          if (!this.isConnected) {
            reject(error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.reconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on<T>(eventType: WebSocketEventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler<unknown>);
    };
  }

  off(eventType: WebSocketEventType, handler?: EventHandler<unknown>): void {
    if (handler) {
      this.handlers.get(eventType)?.delete(handler);
    } else {
      this.handlers.delete(eventType);
    }
  }

  private emit(eventType: WebSocketEventType, event: WebSocketEvent): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, this.reconnectInterval);
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

// ============================================================================
// Errors
// ============================================================================

export class VorionApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'VorionApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Vorion Client
// ============================================================================

/**
 * Main Vorion SDK client
 *
 * @example
 * const client = new VorionClient({
 *   baseUrl: 'https://api.vorion.io',
 *   apiKey: 'your-api-key',
 * });
 *
 * // List policies
 * const policies = await client.policies.list();
 *
 * // Create a policy
 * const policy = await client.policies.create(myPolicy);
 *
 * // Simulate a policy
 * const result = await client.simulation.run({
 *   policyId: 'admin-access',
 *   context: { user: { role: 'admin' } }
 * });
 *
 * // Subscribe to real-time updates
 * await client.realtime.connect();
 * client.realtime.on('policy:updated', (event) => {
 *   console.log('Policy updated:', event.data);
 * });
 */
export class VorionClient {
  private http: HttpClient;
  private wsClient: WebSocketClient | null;

  public readonly policies: PolicyClient;
  public readonly simulation: SimulationClient;
  public readonly audit: AuditClient;
  public readonly realtime: RealtimeClient;

  constructor(config: VorionClientConfig) {
    this.http = new HttpClient(config);
    this.wsClient = config.websocket?.enabled ? new WebSocketClient(config) : null;

    this.policies = new PolicyClient(this.http);
    this.simulation = new SimulationClient(this.http);
    this.audit = new AuditClient(this.http);
    this.realtime = new RealtimeClient(this.wsClient);
  }

  /**
   * Check API health
   */
  async health(): Promise<{ status: 'ok' | 'degraded' | 'down'; version: string }> {
    const response = await this.http.request<{ status: 'ok' | 'degraded' | 'down'; version: string }>({
      method: 'GET',
      path: '/health',
    });

    return response.data!;
  }
}

// ============================================================================
// Policy Client
// ============================================================================

class PolicyClient {
  constructor(private http: HttpClient) {}

  /**
   * List all policies
   */
  async list(options?: PolicyListOptions): Promise<PolicyListResponse> {
    const response = await this.http.request<PolicyListResponse>({
      method: 'GET',
      path: '/api/v1/policies',
      query: {
        page: options?.page,
        limit: options?.limit,
        enabled: options?.filter?.enabled,
        tags: options?.filter?.tags?.join(','),
        search: options?.filter?.search,
        sortField: options?.sort?.field,
        sortOrder: options?.sort?.order,
      },
    });

    return response.data!;
  }

  /**
   * Get a policy by ID
   */
  async get(id: string): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'GET',
      path: `/api/v1/policies/${id}`,
    });

    return response.data!;
  }

  /**
   * Get a specific version of a policy
   */
  async getVersion(id: string, version: string): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'GET',
      path: `/api/v1/policies/${id}/versions/${version}`,
    });

    return response.data!;
  }

  /**
   * Create a new policy
   */
  async create(policy: Omit<PolicyDefinition, 'createdAt' | 'updatedAt'>): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'POST',
      path: '/api/v1/policies',
      body: policy,
    });

    return response.data!;
  }

  /**
   * Update an existing policy
   */
  async update(id: string, updates: Partial<PolicyDefinition>): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'PATCH',
      path: `/api/v1/policies/${id}`,
      body: updates,
    });

    return response.data!;
  }

  /**
   * Delete a policy
   */
  async delete(id: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: `/api/v1/policies/${id}`,
    });
  }

  /**
   * Enable a policy
   */
  async enable(id: string): Promise<PolicyDefinition> {
    return this.update(id, { enabled: true });
  }

  /**
   * Disable a policy
   */
  async disable(id: string): Promise<PolicyDefinition> {
    return this.update(id, { enabled: false });
  }

  /**
   * Compare policies between environments
   */
  async compare(id: string, env1: string, env2: string): Promise<PolicyCompareResponse> {
    const response = await this.http.request<PolicyCompareResponse>({
      method: 'GET',
      path: `/api/v1/policies/${id}/compare`,
      query: { env1, env2 },
    });

    return response.data!;
  }

  /**
   * Get policy version history
   */
  async versions(id: string): Promise<PolicyDefinition[]> {
    const response = await this.http.request<PolicyDefinition[]>({
      method: 'GET',
      path: `/api/v1/policies/${id}/versions`,
    });

    return response.data!;
  }

  /**
   * Rollback to a previous version
   */
  async rollback(id: string, version: string): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'POST',
      path: `/api/v1/policies/${id}/rollback`,
      body: { version },
    });

    return response.data!;
  }

  /**
   * Clone a policy
   */
  async clone(id: string, newId: string, options?: { name?: string }): Promise<PolicyDefinition> {
    const response = await this.http.request<PolicyDefinition>({
      method: 'POST',
      path: `/api/v1/policies/${id}/clone`,
      body: { newId, ...options },
    });

    return response.data!;
  }
}

// ============================================================================
// Simulation Client
// ============================================================================

class SimulationClient {
  constructor(private http: HttpClient) {}

  /**
   * Run a policy simulation
   */
  async run(request: SimulationRequest): Promise<SimulationResponse> {
    const response = await this.http.request<SimulationResponse>({
      method: 'POST',
      path: '/api/v1/simulate',
      body: request,
    });

    return response.data!;
  }

  /**
   * Run batch simulations
   */
  async runBatch(
    requests: SimulationRequest[]
  ): Promise<SimulationResponse[]> {
    const response = await this.http.request<SimulationResponse[]>({
      method: 'POST',
      path: '/api/v1/simulate/batch',
      body: { requests },
    });

    return response.data!;
  }

  /**
   * Explain a policy decision
   */
  async explain(request: SimulationRequest): Promise<SimulationResponse> {
    const response = await this.http.request<SimulationResponse>({
      method: 'POST',
      path: '/api/v1/simulate',
      body: { ...request, options: { ...request.options, trace: true, explain: true } },
    });

    return response.data!;
  }
}

// ============================================================================
// Audit Client
// ============================================================================

class AuditClient {
  constructor(private http: HttpClient) {}

  /**
   * Query audit logs
   */
  async query(options?: AuditLogQuery): Promise<AuditLogResponse> {
    const response = await this.http.request<AuditLogResponse>({
      method: 'GET',
      path: '/api/v1/audit',
      query: {
        startTime: options?.startTime?.toISOString(),
        endTime: options?.endTime?.toISOString(),
        policyId: options?.policyId,
        userId: options?.userId,
        outcome: options?.outcome,
        limit: options?.limit,
        cursor: options?.cursor,
      },
    });

    return response.data!;
  }

  /**
   * Get audit entry by ID
   */
  async get(id: string): Promise<AuditLogResponse['entries'][0]> {
    const response = await this.http.request<AuditLogResponse['entries'][0]>({
      method: 'GET',
      path: `/api/v1/audit/${id}`,
    });

    return response.data!;
  }

  /**
   * Export audit logs
   */
  async export(
    options: AuditLogQuery & { format: 'json' | 'csv' }
  ): Promise<string> {
    const response = await this.http.request<{ url: string }>({
      method: 'POST',
      path: '/api/v1/audit/export',
      body: options,
    });

    return response.data!.url;
  }

  /**
   * Get audit statistics
   */
  async stats(options?: {
    startTime?: Date;
    endTime?: Date;
    groupBy?: 'policy' | 'user' | 'outcome' | 'hour' | 'day';
  }): Promise<Record<string, number>> {
    const response = await this.http.request<Record<string, number>>({
      method: 'GET',
      path: '/api/v1/audit/stats',
      query: {
        startTime: options?.startTime?.toISOString(),
        endTime: options?.endTime?.toISOString(),
        groupBy: options?.groupBy,
      },
    });

    return response.data!;
  }
}

// ============================================================================
// Realtime Client
// ============================================================================

class RealtimeClient {
  constructor(private wsClient: WebSocketClient | null) {}

  /**
   * Connect to real-time updates
   */
  async connect(): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket not enabled. Enable it in client config.');
    }
    await this.wsClient.connect();
  }

  /**
   * Disconnect from real-time updates
   */
  disconnect(): void {
    this.wsClient?.disconnect();
  }

  /**
   * Check connection status
   */
  get connected(): boolean {
    return this.wsClient?.connected ?? false;
  }

  /**
   * Subscribe to policy change events
   */
  onPolicyChange(handler: (event: WebSocketEvent<PolicyChangeEvent>) => void): () => void {
    if (!this.wsClient) {
      throw new Error('WebSocket not enabled');
    }
    const unsub1 = this.wsClient.on('policy:created', handler);
    const unsub2 = this.wsClient.on('policy:updated', handler);
    const unsub3 = this.wsClient.on('policy:deleted', handler);

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }

  /**
   * Subscribe to evaluation events
   */
  onEvaluation(handler: (event: WebSocketEvent<EvaluationEvent>) => void): () => void {
    if (!this.wsClient) {
      throw new Error('WebSocket not enabled');
    }
    return this.wsClient.on('evaluation:completed', handler);
  }

  /**
   * Subscribe to alert events
   */
  onAlert(handler: (event: WebSocketEvent<AlertEvent>) => void): () => void {
    if (!this.wsClient) {
      throw new Error('WebSocket not enabled');
    }
    return this.wsClient.on('alert:triggered', handler);
  }

  /**
   * Subscribe to any event type
   */
  on<T>(eventType: WebSocketEventType, handler: (event: WebSocketEvent<T>) => void): () => void {
    if (!this.wsClient) {
      throw new Error('WebSocket not enabled');
    }
    return this.wsClient.on(eventType, handler);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Vorion client
 */
export function createClient(config: VorionClientConfig): VorionClient {
  return new VorionClient(config);
}

/**
 * Create a client from environment variables
 */
export function createClientFromEnv(): VorionClient {
  const baseUrl = process.env.VORION_API_URL;
  const apiKey = process.env.VORION_API_KEY;
  const apiSecret = process.env.VORION_API_SECRET;

  if (!baseUrl) {
    throw new Error('VORION_API_URL environment variable is required');
  }

  return createClient({
    baseUrl,
    apiKey,
    apiSecret,
    websocket: {
      enabled: process.env.VORION_WEBSOCKET_ENABLED === 'true',
    },
  });
}
