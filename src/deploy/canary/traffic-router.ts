/**
 * Vorion Security Platform - Canary Traffic Router
 * Handles traffic splitting between baseline and canary deployments
 */

import {
  TrafficRoute,
  HeaderMatch,
  CookieMatch,
  RoutingDecision,
  LoadBalancerConfig,
  LoadBalancerCredentials,
  Logger,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface TrafficRouterConfig {
  /** Load balancer configuration */
  loadBalancer?: LoadBalancerConfig;
  /** Enable sticky sessions */
  enableStickySessions?: boolean;
  /** Sticky session duration in seconds */
  stickySessionDuration?: number;
  /** Cookie name for sticky sessions */
  stickySessionCookie?: string;
  /** Header name for canary routing */
  canaryHeader?: string;
  /** Logger instance */
  logger?: Logger;
}

export interface RoutingContext {
  /** Request headers */
  headers: Record<string, string>;
  /** Request cookies */
  cookies: Record<string, string>;
  /** Client IP address */
  clientIp?: string;
  /** Session ID if available */
  sessionId?: string;
  /** Request path */
  path?: string;
  /** Request method */
  method?: string;
}

export interface TrafficSplit {
  /** Baseline weight (0-100) */
  baseline: number;
  /** Canary weight (0-100) */
  canary: number;
}

export interface LoadBalancerUpdate {
  /** Upstream name */
  upstream: string;
  /** Baseline backend */
  baselineBackend: string;
  /** Canary backend */
  canaryBackend: string;
  /** Traffic split */
  split: TrafficSplit;
}

// ============================================================================
// Sticky Session Manager
// ============================================================================

class StickySessionManager {
  private sessions: Map<string, { target: 'baseline' | 'canary'; expires: number }> = new Map();
  private readonly duration: number;

  constructor(durationSeconds: number = 3600) {
    this.duration = durationSeconds * 1000;
  }

  /**
   * Get sticky session target if exists and not expired
   */
  getSession(sessionId: string): 'baseline' | 'canary' | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expires) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session.target;
  }

  /**
   * Set sticky session
   */
  setSession(sessionId: string, target: 'baseline' | 'canary'): void {
    this.sessions.set(sessionId, {
      target,
      expires: Date.now() + this.duration,
    });
  }

  /**
   * Remove expired sessions
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expires) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    this.cleanup();
    return this.sessions.size;
  }
}

// ============================================================================
// Load Balancer Adapters
// ============================================================================

interface LoadBalancerAdapter {
  updateWeights(update: LoadBalancerUpdate): Promise<void>;
  getWeights(upstream: string): Promise<TrafficSplit>;
  healthCheck(): Promise<boolean>;
}

/**
 * Nginx load balancer adapter
 */
class NginxAdapter implements LoadBalancerAdapter {
  private readonly endpoint: string;
  private readonly credentials?: LoadBalancerCredentials;

  constructor(endpoint: string, credentials?: LoadBalancerCredentials) {
    this.endpoint = endpoint;
    this.credentials = credentials;
  }

  async updateWeights(update: LoadBalancerUpdate): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.credentials?.token) {
      headers['Authorization'] = `Bearer ${this.credentials.token}`;
    }

    const response = await fetch(`${this.endpoint}/api/upstreams/${update.upstream}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        servers: [
          { address: update.baselineBackend, weight: update.split.baseline },
          { address: update.canaryBackend, weight: update.split.canary },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Nginx API error: ${response.status} ${response.statusText}`);
    }
  }

  async getWeights(upstream: string): Promise<TrafficSplit> {
    const headers: Record<string, string> = {};
    if (this.credentials?.token) {
      headers['Authorization'] = `Bearer ${this.credentials.token}`;
    }

    const response = await fetch(`${this.endpoint}/api/upstreams/${upstream}`, { headers });
    if (!response.ok) {
      throw new Error(`Nginx API error: ${response.status}`);
    }

    const data = await response.json();
    const servers = data.servers || [];

    return {
      baseline: servers[0]?.weight || 100,
      canary: servers[1]?.weight || 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/status`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Envoy load balancer adapter
 */
class EnvoyAdapter implements LoadBalancerAdapter {
  private readonly endpoint: string;
  private readonly credentials?: LoadBalancerCredentials;

  constructor(endpoint: string, credentials?: LoadBalancerCredentials) {
    this.endpoint = endpoint;
    this.credentials = credentials;
  }

  async updateWeights(update: LoadBalancerUpdate): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.credentials?.token) {
      headers['Authorization'] = `Bearer ${this.credentials.token}`;
    }

    // Envoy xDS API for updating cluster weights
    const response = await fetch(`${this.endpoint}/v3/discovery:endpoints`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cluster: update.upstream,
        endpoints: [
          {
            lb_endpoints: [
              {
                endpoint: { address: { socket_address: { address: update.baselineBackend } } },
                load_balancing_weight: { value: update.split.baseline },
              },
              {
                endpoint: { address: { socket_address: { address: update.canaryBackend } } },
                load_balancing_weight: { value: update.split.canary },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Envoy API error: ${response.status} ${response.statusText}`);
    }
  }

  async getWeights(upstream: string): Promise<TrafficSplit> {
    const headers: Record<string, string> = {};
    if (this.credentials?.token) {
      headers['Authorization'] = `Bearer ${this.credentials.token}`;
    }

    const response = await fetch(`${this.endpoint}/clusters/${upstream}`, { headers });
    if (!response.ok) {
      throw new Error(`Envoy API error: ${response.status}`);
    }

    const data = await response.json();
    // Parse Envoy cluster data
    return {
      baseline: data.baseline_weight || 100,
      canary: data.canary_weight || 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/ready`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * AWS ALB load balancer adapter
 */
class AWSALBAdapter implements LoadBalancerAdapter {
  private readonly endpoint: string;
  private readonly region: string;

  constructor(endpoint: string, credentials?: LoadBalancerCredentials) {
    this.endpoint = endpoint;
    this.region = credentials?.region || 'us-east-1';
  }

  async updateWeights(update: LoadBalancerUpdate): Promise<void> {
    // AWS ALB uses target group weights via modify-listener action
    // This would use AWS SDK in production
    const command = {
      ListenerArn: update.upstream,
      DefaultActions: [
        {
          Type: 'forward',
          ForwardConfig: {
            TargetGroups: [
              { TargetGroupArn: update.baselineBackend, Weight: update.split.baseline },
              { TargetGroupArn: update.canaryBackend, Weight: update.split.canary },
            ],
          },
        },
      ],
    };

    // In production, use AWS SDK:
    // const client = new ElasticLoadBalancingV2Client({ region: this.region });
    // await client.send(new ModifyListenerCommand(command));

    console.log('AWS ALB update:', JSON.stringify(command, null, 2));
  }

  async getWeights(upstream: string): Promise<TrafficSplit> {
    // In production, use AWS SDK to describe listener
    return { baseline: 100, canary: 0 };
  }

  async healthCheck(): Promise<boolean> {
    // In production, check AWS ALB status
    return true;
  }
}

/**
 * HAProxy load balancer adapter
 */
class HAProxyAdapter implements LoadBalancerAdapter {
  private readonly endpoint: string;
  private readonly credentials?: LoadBalancerCredentials;

  constructor(endpoint: string, credentials?: LoadBalancerCredentials) {
    this.endpoint = endpoint;
    this.credentials = credentials;
  }

  async updateWeights(update: LoadBalancerUpdate): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.credentials?.username && this.credentials?.password) {
      const auth = Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    // HAProxy Runtime API
    const commands = [
      `set server ${update.upstream}/${update.baselineBackend} weight ${update.split.baseline}`,
      `set server ${update.upstream}/${update.canaryBackend} weight ${update.split.canary}`,
    ];

    for (const cmd of commands) {
      const response = await fetch(`${this.endpoint}/v2/services/haproxy/runtime/commands`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command: cmd }),
      });

      if (!response.ok) {
        throw new Error(`HAProxy API error: ${response.status}`);
      }
    }
  }

  async getWeights(upstream: string): Promise<TrafficSplit> {
    const headers: Record<string, string> = {};
    if (this.credentials?.username && this.credentials?.password) {
      const auth = Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(`${this.endpoint}/v2/services/haproxy/stats/native`, { headers });
    if (!response.ok) {
      throw new Error(`HAProxy API error: ${response.status}`);
    }

    const data = await response.json();
    // Parse HAProxy stats
    return {
      baseline: data.baseline?.weight || 100,
      canary: data.canary?.weight || 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/v2/services/haproxy/stats`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Create load balancer adapter based on type
 */
function createLoadBalancerAdapter(config: LoadBalancerConfig): LoadBalancerAdapter {
  switch (config.type) {
    case 'nginx':
      return new NginxAdapter(config.endpoint, config.credentials);
    case 'envoy':
      return new EnvoyAdapter(config.endpoint, config.credentials);
    case 'aws_alb':
      return new AWSALBAdapter(config.endpoint, config.credentials);
    case 'haproxy':
      return new HAProxyAdapter(config.endpoint, config.credentials);
    default:
      throw new Error(`Unsupported load balancer type: ${config.type}`);
  }
}

// ============================================================================
// Traffic Router Class
// ============================================================================

export class TrafficRouter {
  private readonly enableStickySessions: boolean;
  private readonly stickySessionCookie: string;
  private readonly canaryHeader: string;
  private readonly stickySessionManager: StickySessionManager;
  private readonly loadBalancerAdapter?: LoadBalancerAdapter;
  private readonly logger?: Logger;

  private currentSplit: TrafficSplit = { baseline: 100, canary: 0 };
  private routes: TrafficRoute[] = [];

  constructor(config: TrafficRouterConfig = {}) {
    this.enableStickySessions = config.enableStickySessions ?? true;
    this.stickySessionCookie = config.stickySessionCookie ?? 'vorion_canary_session';
    this.canaryHeader = config.canaryHeader ?? 'X-Canary-Version';
    this.stickySessionManager = new StickySessionManager(config.stickySessionDuration ?? 3600);
    this.logger = config.logger;

    if (config.loadBalancer) {
      this.loadBalancerAdapter = createLoadBalancerAdapter(config.loadBalancer);
    }
  }

  /**
   * Set traffic split between baseline and canary
   */
  async setTrafficSplit(canaryPercentage: number): Promise<void> {
    if (canaryPercentage < 0 || canaryPercentage > 100) {
      throw new Error('Canary percentage must be between 0 and 100');
    }

    this.currentSplit = {
      baseline: 100 - canaryPercentage,
      canary: canaryPercentage,
    };

    this.logger?.info(`Traffic split updated: baseline=${this.currentSplit.baseline}%, canary=${this.currentSplit.canary}%`);

    // Update load balancer if configured
    if (this.loadBalancerAdapter) {
      // Note: In production, these values would come from configuration
      await this.loadBalancerAdapter.updateWeights({
        upstream: 'default',
        baselineBackend: 'baseline-service',
        canaryBackend: 'canary-service',
        split: this.currentSplit,
      });
    }
  }

  /**
   * Get current traffic split
   */
  getTrafficSplit(): TrafficSplit {
    return { ...this.currentSplit };
  }

  /**
   * Route a request to baseline or canary
   */
  route(context: RoutingContext): RoutingDecision {
    // 1. Check for forced routing via header
    const forcedTarget = this.checkForcedRouting(context);
    if (forcedTarget) {
      this.logger?.debug(`Forced routing to ${forcedTarget} via header`);
      return {
        target: forcedTarget,
        reason: 'header',
        metadata: { header: this.canaryHeader },
      };
    }

    // 2. Check for header-based routing rules
    for (const route of this.routes) {
      if (route.headerMatches && this.matchHeaders(context.headers, route.headerMatches)) {
        this.logger?.debug(`Header match routing to ${route.target}`);
        return {
          target: route.target,
          reason: 'header',
          metadata: { matchedRoute: route.id },
        };
      }
    }

    // 3. Check for cookie-based routing rules
    for (const route of this.routes) {
      if (route.cookieMatches && this.matchCookies(context.cookies, route.cookieMatches)) {
        this.logger?.debug(`Cookie match routing to ${route.target}`);
        return {
          target: route.target,
          reason: 'cookie',
          metadata: { matchedRoute: route.id },
        };
      }
    }

    // 4. Check sticky session
    if (this.enableStickySessions && context.sessionId) {
      const stickyTarget = this.stickySessionManager.getSession(context.sessionId);
      if (stickyTarget) {
        this.logger?.debug(`Sticky session routing to ${stickyTarget}`);
        return {
          target: stickyTarget,
          reason: 'sticky',
          sessionId: context.sessionId,
        };
      }
    }

    // 5. Weighted random selection
    const target = this.selectByWeight();

    // Create sticky session if enabled
    if (this.enableStickySessions) {
      const sessionId = context.sessionId || this.generateSessionId();
      this.stickySessionManager.setSession(sessionId, target);

      this.logger?.debug(`Weighted selection: ${target}, session: ${sessionId}`);
      return {
        target,
        reason: 'weight',
        sessionId,
      };
    }

    this.logger?.debug(`Weighted selection: ${target}`);
    return {
      target,
      reason: 'weight',
    };
  }

  /**
   * Add a routing rule
   */
  addRoute(route: TrafficRoute): void {
    this.routes.push(route);
    this.logger?.info(`Added routing rule: ${route.id}`);
  }

  /**
   * Remove a routing rule
   */
  removeRoute(routeId: string): boolean {
    const index = this.routes.findIndex(r => r.id === routeId);
    if (index !== -1) {
      this.routes.splice(index, 1);
      this.logger?.info(`Removed routing rule: ${routeId}`);
      return true;
    }
    return false;
  }

  /**
   * Get all routing rules
   */
  getRoutes(): TrafficRoute[] {
    return [...this.routes];
  }

  /**
   * Clear all routing rules
   */
  clearRoutes(): void {
    this.routes = [];
    this.logger?.info('Cleared all routing rules');
  }

  /**
   * Clear all sticky sessions
   */
  clearStickySessions(): void {
    this.stickySessionManager.clear();
    this.logger?.info('Cleared all sticky sessions');
  }

  /**
   * Get sticky session count
   */
  getStickySessionCount(): number {
    return this.stickySessionManager.getActiveCount();
  }

  /**
   * Check load balancer health
   */
  async checkLoadBalancerHealth(): Promise<boolean> {
    if (!this.loadBalancerAdapter) {
      return true; // No load balancer configured
    }
    return this.loadBalancerAdapter.healthCheck();
  }

  /**
   * Check for forced routing via header
   */
  private checkForcedRouting(context: RoutingContext): 'baseline' | 'canary' | null {
    const headerValue = context.headers[this.canaryHeader.toLowerCase()];
    if (!headerValue) return null;

    if (headerValue === 'canary' || headerValue === 'true' || headerValue === '1') {
      return 'canary';
    }
    if (headerValue === 'baseline' || headerValue === 'false' || headerValue === '0') {
      return 'baseline';
    }

    return null;
  }

  /**
   * Match headers against rules
   */
  private matchHeaders(headers: Record<string, string>, matches: HeaderMatch[]): boolean {
    for (const match of matches) {
      const headerValue = headers[match.name.toLowerCase()];
      if (!headerValue) return false;

      switch (match.matchType) {
        case 'exact':
          if (headerValue !== match.value) return false;
          break;
        case 'prefix':
          if (!headerValue.startsWith(match.value)) return false;
          break;
        case 'regex':
          if (!new RegExp(match.value).test(headerValue)) return false;
          break;
      }
    }
    return true;
  }

  /**
   * Match cookies against rules
   */
  private matchCookies(cookies: Record<string, string>, matches: CookieMatch[]): boolean {
    for (const match of matches) {
      const cookieValue = cookies[match.name];

      if (match.required && !cookieValue) return false;
      if (match.value && cookieValue !== match.value) return false;
    }
    return true;
  }

  /**
   * Select target based on weighted random
   */
  private selectByWeight(): 'baseline' | 'canary' {
    const random = Math.random() * 100;
    return random < this.currentSplit.canary ? 'canary' : 'baseline';
  }

  /**
   * Generate a session ID
   */
  private generateSessionId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new traffic router instance
 */
export function createTrafficRouter(config?: TrafficRouterConfig): TrafficRouter {
  return new TrafficRouter(config);
}

/**
 * Create routing context from HTTP request-like object
 */
export function createRoutingContext(request: {
  headers?: Record<string, string | string[]>;
  cookies?: Record<string, string>;
  ip?: string;
  path?: string;
  method?: string;
}): RoutingContext {
  // Normalize headers to lowercase single values
  const headers: Record<string, string> = {};
  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }
  }

  // Extract session ID from cookies
  const cookies = request.cookies || {};
  const sessionId = cookies['vorion_canary_session'] || cookies['session_id'];

  return {
    headers,
    cookies,
    clientIp: request.ip,
    sessionId,
    path: request.path,
    method: request.method,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a header-based routing rule
 */
export function createHeaderRoute(
  id: string,
  target: 'baseline' | 'canary',
  headerName: string,
  headerValue: string,
  matchType: 'exact' | 'prefix' | 'regex' = 'exact'
): TrafficRoute {
  return {
    id,
    target,
    weight: target === 'canary' ? 100 : 0,
    headerMatches: [{ name: headerName, matchType, value: headerValue }],
  };
}

/**
 * Create a cookie-based routing rule
 */
export function createCookieRoute(
  id: string,
  target: 'baseline' | 'canary',
  cookieName: string,
  cookieValue?: string
): TrafficRoute {
  return {
    id,
    target,
    weight: target === 'canary' ? 100 : 0,
    cookieMatches: [{ name: cookieName, value: cookieValue, required: true }],
  };
}

/**
 * Validate traffic split configuration
 */
export function validateTrafficSplit(split: TrafficSplit): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (split.baseline < 0 || split.baseline > 100) {
    errors.push('Baseline weight must be between 0 and 100');
  }
  if (split.canary < 0 || split.canary > 100) {
    errors.push('Canary weight must be between 0 and 100');
  }
  if (Math.abs(split.baseline + split.canary - 100) > 0.01) {
    errors.push('Weights must sum to 100');
  }

  return { valid: errors.length === 0, errors };
}
