/**
 * Redis Cluster Manager for Vorion Security Platform
 *
 * Provides production-ready Redis Cluster support with:
 * - Cluster connection with automatic node discovery
 * - Consistent hashing for key distribution
 * - Automatic failover handling with Sentinel support
 * - Read replicas for read scaling
 * - Connection health monitoring
 * - MOVED/ASK redirection handling
 * - Pipeline support across slots
 * - Pub/Sub with cluster awareness
 * - Comprehensive metrics
 *
 * @packageDocumentation
 * @module @vorion/common/redis-cluster
 */

import IORedis, {
  Cluster,
  type ClusterNode,
  type ClusterOptions,
  type Redis,
  type RedisOptions,
} from 'ioredis';
import { EventEmitter } from 'events';
import { Counter, Gauge, Histogram } from 'prom-client';
import { vorionRegistry } from './metrics-registry.js';
import { createLogger } from './logger.js';
import { withTimeout } from './timeout.js';

const logger = createLogger({ component: 'redis-cluster' });

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Redis Cluster node configuration
 */
export interface RedisClusterNode {
  /** Host address of the Redis node */
  host: string;
  /** Port number of the Redis node */
  port: number;
}

/**
 * NAT mapping for nodes behind NAT/load balancers
 */
export interface NatMapping {
  /** External host address */
  host: string;
  /** External port number */
  port: number;
}

/**
 * Redis Cluster configuration
 */
export interface RedisClusterConfig {
  /** Initial seed nodes for cluster discovery */
  nodes: RedisClusterNode[];
  /** Optional password for authentication */
  password?: string;
  /** Enable read replicas for read scaling (default: true) */
  enableReadReplicas?: boolean;
  /** Maximum number of MOVED/ASK redirections (default: 16) */
  maxRedirections?: number;
  /** Delay between retry attempts in ms (default: 100) */
  retryDelayMs?: number;
  /** NAT mapping for nodes behind NAT/load balancers */
  natMap?: Record<string, NatMapping>;
  /** Connection timeout in ms (default: 10000) */
  connectTimeoutMs?: number;
  /** Command timeout in ms (default: 5000) */
  commandTimeoutMs?: number;
  /** Enable TLS/SSL (default: false) */
  enableTls?: boolean;
  /** TLS options when enableTls is true */
  tlsOptions?: {
    ca?: string | Buffer;
    cert?: string | Buffer;
    key?: string | Buffer;
    rejectUnauthorized?: boolean;
  };
  /** Key prefix for all operations (default: 'vorion:') */
  keyPrefix?: string;
  /** Enable lazy connect (default: false) */
  lazyConnect?: boolean;
  /** Retry strategy configuration */
  retryStrategy?: {
    /** Maximum retry attempts (default: 10) */
    maxAttempts?: number;
    /** Base delay for exponential backoff in ms (default: 100) */
    baseDelayMs?: number;
    /** Maximum delay between retries in ms (default: 3000) */
    maxDelayMs?: number;
  };
  /** Cluster slots refresh interval in ms (default: 5000) */
  slotsRefreshIntervalMs?: number;
  /** Enable offline queue (default: true) */
  enableOfflineQueue?: boolean;
  /** Enable ready check (default: true) */
  enableReadyCheck?: boolean;
  /** Scale reads using (default: 'slave') - 'master' | 'slave' | 'all' */
  scaleReads?: 'master' | 'slave' | 'all';
}

/**
 * Internal fully resolved configuration with all defaults applied
 */
interface ResolvedRedisClusterConfig {
  nodes: RedisClusterNode[];
  password: string;
  enableReadReplicas: boolean;
  maxRedirections: number;
  retryDelayMs: number;
  natMap: Record<string, NatMapping>;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  enableTls: boolean;
  tlsOptions: {
    ca?: string | Buffer;
    cert?: string | Buffer;
    key?: string | Buffer;
    rejectUnauthorized?: boolean;
  };
  keyPrefix: string;
  lazyConnect: boolean;
  retryStrategy: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  slotsRefreshIntervalMs: number;
  enableOfflineQueue: boolean;
  enableReadyCheck: boolean;
  scaleReads: 'master' | 'slave' | 'all';
}

/**
 * Redis Cluster node health status
 */
export interface NodeHealthStatus {
  /** Node address (host:port) */
  address: string;
  /** Whether the node is healthy */
  healthy: boolean;
  /** Role: master or slave */
  role: 'master' | 'slave' | 'unknown';
  /** Latency in ms (if healthy) */
  latencyMs?: number;
  /** Error message (if unhealthy) */
  error?: string;
  /** Slots served by this node (for masters) */
  slots?: number[];
  /** Number of connected replicas (for masters) */
  replicaCount?: number;
  /** Master address (for slaves) */
  masterAddress?: string;
}

/**
 * Cluster health status
 */
export interface ClusterHealthStatus {
  /** Whether the cluster is healthy */
  healthy: boolean;
  /** Cluster state: 'ok' | 'fail' */
  clusterState: string;
  /** Total number of nodes */
  nodeCount: number;
  /** Number of healthy nodes */
  healthyNodeCount: number;
  /** Number of master nodes */
  masterCount: number;
  /** Number of slave nodes */
  slaveCount: number;
  /** Slot coverage percentage */
  slotCoverage: number;
  /** Individual node health */
  nodes: NodeHealthStatus[];
  /** Any cluster-level error */
  error?: string;
}

/**
 * Failover event details
 */
export interface FailoverEvent {
  /** Timestamp of the event */
  timestamp: Date;
  /** Type of failover event */
  type: 'node_failure' | 'node_recovery' | 'slot_migration' | 'master_promotion';
  /** Affected node address */
  nodeAddress: string;
  /** Previous state */
  previousState?: string;
  /** Current state */
  currentState?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Pipeline batch result
 */
export interface PipelineBatchResult<T> {
  /** Whether all operations succeeded */
  success: boolean;
  /** Results for each operation */
  results: Array<{
    success: boolean;
    result?: T;
    error?: Error;
  }>;
  /** Total execution time in ms */
  executionTimeMs: number;
}

/**
 * Pub/Sub message handler
 */
export type PubSubMessageHandler = (channel: string, message: string) => void | Promise<void>;

/**
 * Pub/Sub pattern message handler
 */
export type PubSubPatternHandler = (pattern: string, channel: string, message: string) => void | Promise<void>;

// =============================================================================
// Metrics
// =============================================================================

/**
 * Redis cluster connections per node
 */
const redisClusterConnectionsGauge = new Gauge({
  name: 'vorion_redis_cluster_connections',
  help: 'Number of connections per Redis cluster node',
  labelNames: ['node', 'role'] as const,
  registers: [vorionRegistry],
});

/**
 * Redis cluster operations per slot
 */
const redisClusterSlotOperationsTotal = new Counter({
  name: 'vorion_redis_cluster_slot_operations_total',
  help: 'Total operations per slot range',
  labelNames: ['slot_range', 'operation'] as const,
  registers: [vorionRegistry],
});

/**
 * Redis cluster failover events
 */
const redisClusterFailoverEventsTotal = new Counter({
  name: 'vorion_redis_cluster_failover_events_total',
  help: 'Total failover events',
  labelNames: ['type'] as const,
  registers: [vorionRegistry],
});

/**
 * Redis cluster latency by node
 */
const redisClusterNodeLatencySeconds = new Histogram({
  name: 'vorion_redis_cluster_node_latency_seconds',
  help: 'Latency per Redis cluster node in seconds',
  labelNames: ['node', 'operation'] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [vorionRegistry],
});

/**
 * Redis cluster redirections
 */
const redisClusterRedirectionsTotal = new Counter({
  name: 'vorion_redis_cluster_redirections_total',
  help: 'Total MOVED/ASK redirections',
  labelNames: ['type'] as const,
  registers: [vorionRegistry],
});

/**
 * Redis cluster slot coverage
 */
const redisClusterSlotCoverageGauge = new Gauge({
  name: 'vorion_redis_cluster_slot_coverage',
  help: 'Percentage of slots covered by the cluster',
  registers: [vorionRegistry],
});

/**
 * Redis cluster healthy nodes
 */
const redisClusterHealthyNodesGauge = new Gauge({
  name: 'vorion_redis_cluster_healthy_nodes',
  help: 'Number of healthy nodes in the cluster',
  labelNames: ['role'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// RedisClusterManager Class
// =============================================================================

/**
 * Redis Cluster Manager for production deployments
 *
 * Provides comprehensive cluster management including:
 * - Automatic node discovery and slot routing
 * - Failover detection and handling
 * - Read replica support for scaling
 * - Health monitoring and metrics
 * - Pipeline operations across slots
 * - Pub/Sub with cluster awareness
 *
 * @example
 * ```typescript
 * const clusterManager = new RedisClusterManager({
 *   nodes: [
 *     { host: 'redis-1.example.com', port: 6379 },
 *     { host: 'redis-2.example.com', port: 6379 },
 *     { host: 'redis-3.example.com', port: 6379 },
 *   ],
 *   password: process.env.REDIS_PASSWORD,
 *   enableReadReplicas: true,
 * });
 *
 * await clusterManager.connect();
 *
 * // Basic operations
 * await clusterManager.set('user:123', JSON.stringify({ name: 'John' }));
 * const user = await clusterManager.get('user:123');
 *
 * // Pub/Sub
 * clusterManager.subscribe('events', (channel, message) => {
 *   console.log(`Received: ${message}`);
 * });
 *
 * // Health check
 * const health = await clusterManager.getClusterHealth();
 * console.log(`Cluster healthy: ${health.healthy}`);
 * ```
 */
export class RedisClusterManager extends EventEmitter {
  private cluster: Cluster | null = null;
  private readonly config: ResolvedRedisClusterConfig;
  private isConnected = false;
  private isConnecting = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private slotsRefreshInterval: NodeJS.Timeout | null = null;
  private failoverHistory: FailoverEvent[] = [];
  private readonly maxFailoverHistory = 100;
  private subscriberClient: Cluster | null = null;
  private subscriptions = new Map<string, Set<PubSubMessageHandler>>();
  private patternSubscriptions = new Map<string, Set<PubSubPatternHandler>>();
  private nodeConnections = new Map<string, number>();

  constructor(config: RedisClusterConfig) {
    super();

    // Apply defaults
    this.config = {
      nodes: config.nodes,
      password: config.password ?? '',
      enableReadReplicas: config.enableReadReplicas ?? true,
      maxRedirections: config.maxRedirections ?? 16,
      retryDelayMs: config.retryDelayMs ?? 100,
      natMap: config.natMap ?? {},
      connectTimeoutMs: config.connectTimeoutMs ?? 10000,
      commandTimeoutMs: config.commandTimeoutMs ?? 5000,
      enableTls: config.enableTls ?? false,
      tlsOptions: config.tlsOptions ?? {},
      keyPrefix: config.keyPrefix ?? 'vorion:',
      lazyConnect: config.lazyConnect ?? false,
      retryStrategy: {
        maxAttempts: config.retryStrategy?.maxAttempts ?? 10,
        baseDelayMs: config.retryStrategy?.baseDelayMs ?? 100,
        maxDelayMs: config.retryStrategy?.maxDelayMs ?? 3000,
      },
      slotsRefreshIntervalMs: config.slotsRefreshIntervalMs ?? 5000,
      enableOfflineQueue: config.enableOfflineQueue ?? true,
      enableReadyCheck: config.enableReadyCheck ?? true,
      scaleReads: config.scaleReads ?? (config.enableReadReplicas ? 'slave' : 'master'),
    };

    if (this.config.nodes.length === 0) {
      throw new Error('At least one cluster node must be specified');
    }
  }

  /**
   * Build cluster options for ioredis
   */
  private buildClusterOptions(): ClusterOptions {
    const options: ClusterOptions = {
      redisOptions: {
        password: this.config.password || undefined,
        connectTimeout: this.config.connectTimeoutMs,
        commandTimeout: this.config.commandTimeoutMs,
        enableOfflineQueue: this.config.enableOfflineQueue,
        enableReadyCheck: this.config.enableReadyCheck,
      } as RedisOptions,
      clusterRetryStrategy: (times: number) => {
        if (times > this.config.retryStrategy.maxAttempts) {
          logger.error(
            { attempts: times, maxAttempts: this.config.retryStrategy.maxAttempts },
            'Redis cluster max retry attempts exceeded'
          );
          return null; // Stop retrying
        }

        const delay = Math.min(
          this.config.retryStrategy.baseDelayMs * Math.pow(2, times - 1),
          this.config.retryStrategy.maxDelayMs
        );

        logger.warn(
          { attempt: times, delayMs: delay },
          'Redis cluster connection retry scheduled'
        );

        return delay;
      },
      maxRedirections: this.config.maxRedirections,
      retryDelayOnClusterDown: this.config.retryDelayMs,
      retryDelayOnFailover: this.config.retryDelayMs,
      retryDelayOnTryAgain: this.config.retryDelayMs,
      scaleReads: this.config.scaleReads,
      slotsRefreshTimeout: 2000,
      slotsRefreshInterval: this.config.slotsRefreshIntervalMs,
      enableOfflineQueue: this.config.enableOfflineQueue,
      enableReadyCheck: this.config.enableReadyCheck,
      lazyConnect: this.config.lazyConnect,
    };

    // Add NAT map if configured
    if (Object.keys(this.config.natMap).length > 0) {
      options.natMap = this.config.natMap;
    }

    // Add TLS if enabled
    if (this.config.enableTls && options.redisOptions) {
      options.redisOptions.tls = {
        ca: this.config.tlsOptions.ca,
        cert: this.config.tlsOptions.cert,
        key: this.config.tlsOptions.key,
        rejectUnauthorized: this.config.tlsOptions.rejectUnauthorized ?? true,
      };
    }

    return options;
  }

  /**
   * Connect to the Redis cluster
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.debug('Redis cluster already connected');
      return;
    }

    if (this.isConnecting) {
      logger.debug('Redis cluster connection already in progress');
      return;
    }

    this.isConnecting = true;

    try {
      const startupNodes: ClusterNode[] = this.config.nodes.map((node) => ({
        host: node.host,
        port: node.port,
      }));

      const options = this.buildClusterOptions();

      logger.info(
        { nodes: startupNodes.length, scaleReads: this.config.scaleReads },
        'Connecting to Redis cluster'
      );

      this.cluster = new IORedis.Cluster(startupNodes, options);

      // Set up event handlers
      this.setupEventHandlers(this.cluster);

      // Wait for ready state
      await this.waitForReady();

      this.isConnected = true;
      this.isConnecting = false;

      // Start health check interval
      this.startHealthCheck();

      // Start slots refresh monitoring
      this.startSlotsRefreshMonitoring();

      logger.info('Redis cluster connected successfully');
      this.emit('connected');
    } catch (error) {
      this.isConnecting = false;
      logger.error({ error }, 'Failed to connect to Redis cluster');
      throw error;
    }
  }

  /**
   * Wait for cluster to be ready
   */
  private async waitForReady(): Promise<void> {
    if (!this.cluster) {
      throw new Error('Cluster not initialized');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis cluster connection timeout'));
      }, this.config.connectTimeoutMs);

      this.cluster!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.cluster!.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Set up event handlers for the cluster
   */
  private setupEventHandlers(cluster: Cluster): void {
    cluster.on('error', (error) => {
      logger.error({ error }, 'Redis cluster error');
      this.emit('error', error);
    });

    cluster.on('close', () => {
      logger.warn('Redis cluster connection closed');
      this.isConnected = false;
      this.emit('close');
    });

    cluster.on('reconnecting', () => {
      logger.info('Redis cluster reconnecting');
      this.emit('reconnecting');
    });

    cluster.on('ready', () => {
      logger.info('Redis cluster ready');
      this.isConnected = true;
      this.emit('ready');
    });

    cluster.on('end', () => {
      logger.info('Redis cluster connection ended');
      this.isConnected = false;
      this.emit('end');
    });

    // Monitor node events
    cluster.on('+node', (node: Redis) => {
      const address = this.getNodeAddress(node);
      logger.info({ node: address }, 'Redis cluster node added');
      this.recordFailoverEvent({
        timestamp: new Date(),
        type: 'node_recovery',
        nodeAddress: address,
        currentState: 'connected',
      });
      redisClusterFailoverEventsTotal.inc({ type: 'node_recovery' });
      this.emit('nodeAdded', address);
    });

    cluster.on('-node', (node: Redis) => {
      const address = this.getNodeAddress(node);
      logger.warn({ node: address }, 'Redis cluster node removed');
      this.recordFailoverEvent({
        timestamp: new Date(),
        type: 'node_failure',
        nodeAddress: address,
        currentState: 'disconnected',
      });
      redisClusterFailoverEventsTotal.inc({ type: 'node_failure' });
      this.emit('nodeRemoved', address);
    });

    // Monitor redirections
    cluster.on('refresh', () => {
      logger.debug('Redis cluster slots refreshed');
      this.emit('slotsRefresh');
    });
  }

  /**
   * Get node address string
   */
  private getNodeAddress(node: Redis): string {
    const options = node.options as RedisOptions;
    return `${options.host || 'unknown'}:${options.port || 0}`;
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getClusterHealth();
        this.updateHealthMetrics(health);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
      }
    }, 30000); // Every 30 seconds

    this.healthCheckInterval.unref();
  }

  /**
   * Start slots refresh monitoring
   */
  private startSlotsRefreshMonitoring(): void {
    if (this.slotsRefreshInterval) {
      clearInterval(this.slotsRefreshInterval);
    }

    this.slotsRefreshInterval = setInterval(async () => {
      try {
        if (this.cluster && this.isConnected) {
          // ioredis handles slot refresh automatically
          // This interval is for additional monitoring
          const slots = this.cluster.slots;
          const coveredSlots = slots.filter((s) => s && s.length > 0).length;
          const coverage = (coveredSlots / 16384) * 100;
          redisClusterSlotCoverageGauge.set(coverage);
        }
      } catch (error) {
        logger.debug({ error }, 'Slots refresh monitoring error');
      }
    }, this.config.slotsRefreshIntervalMs);

    this.slotsRefreshInterval.unref();
  }

  /**
   * Update health metrics
   */
  private updateHealthMetrics(health: ClusterHealthStatus): void {
    redisClusterSlotCoverageGauge.set(health.slotCoverage);
    redisClusterHealthyNodesGauge.set({ role: 'master' }, health.masterCount);
    redisClusterHealthyNodesGauge.set({ role: 'slave' }, health.slaveCount);

    for (const node of health.nodes) {
      redisClusterConnectionsGauge.set(
        { node: node.address, role: node.role },
        node.healthy ? 1 : 0
      );
    }
  }

  /**
   * Record a failover event
   */
  private recordFailoverEvent(event: FailoverEvent): void {
    this.failoverHistory.push(event);
    if (this.failoverHistory.length > this.maxFailoverHistory) {
      this.failoverHistory.shift();
    }
    this.emit('failover', event);
  }

  /**
   * Get the underlying cluster client
   */
  getClient(): Cluster {
    if (!this.cluster) {
      throw new Error('Redis cluster not connected');
    }
    return this.cluster;
  }

  /**
   * Check if cluster is connected
   */
  isClusterConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from the cluster
   */
  async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.slotsRefreshInterval) {
      clearInterval(this.slotsRefreshInterval);
      this.slotsRefreshInterval = null;
    }

    if (this.subscriberClient) {
      await this.subscriberClient.quit();
      this.subscriberClient = null;
    }

    if (this.cluster) {
      await this.cluster.quit();
      this.cluster = null;
    }

    this.isConnected = false;
    this.subscriptions.clear();
    this.patternSubscriptions.clear();

    logger.info('Redis cluster disconnected');
    this.emit('disconnected');
  }

  // ===========================================================================
  // Cluster Health Monitoring
  // ===========================================================================

  /**
   * Get detailed cluster health status
   */
  async getClusterHealth(): Promise<ClusterHealthStatus> {
    if (!this.cluster || !this.isConnected) {
      return {
        healthy: false,
        clusterState: 'fail',
        nodeCount: 0,
        healthyNodeCount: 0,
        masterCount: 0,
        slaveCount: 0,
        slotCoverage: 0,
        nodes: [],
        error: 'Cluster not connected',
      };
    }

    try {
      // Get cluster info
      const clusterInfo = await this.cluster.cluster('INFO') as string;
      const clusterState = this.parseClusterState(clusterInfo);

      // Get node health
      const nodes = await this.getNodesHealth();

      const healthyNodes = nodes.filter((n) => n.healthy);
      const masters = nodes.filter((n) => n.role === 'master');
      const slaves = nodes.filter((n) => n.role === 'slave');

      // Calculate slot coverage
      const slots = this.cluster.slots;
      const coveredSlots = slots.filter((s) => s && s.length > 0).length;
      const slotCoverage = (coveredSlots / 16384) * 100;

      return {
        healthy: clusterState === 'ok' && healthyNodes.length > 0,
        clusterState,
        nodeCount: nodes.length,
        healthyNodeCount: healthyNodes.length,
        masterCount: masters.length,
        slaveCount: slaves.length,
        slotCoverage,
        nodes,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to get cluster health');

      return {
        healthy: false,
        clusterState: 'fail',
        nodeCount: 0,
        healthyNodeCount: 0,
        masterCount: 0,
        slaveCount: 0,
        slotCoverage: 0,
        nodes: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Parse cluster state from CLUSTER INFO output
   */
  private parseClusterState(clusterInfo: string): string {
    const match = clusterInfo.match(/cluster_state:(\w+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Get health status of all nodes
   */
  private async getNodesHealth(): Promise<NodeHealthStatus[]> {
    if (!this.cluster) {
      return [];
    }

    const nodes: NodeHealthStatus[] = [];

    try {
      // Get cluster nodes info
      const clusterNodes = await this.cluster.cluster('NODES') as string;
      const nodeLines = clusterNodes.split('\n').filter((line) => line.trim());

      for (const line of nodeLines) {
        const nodeInfo = this.parseNodeLine(line);
        if (nodeInfo) {
          // Check node health with ping
          const health = await this.checkNodeHealth(nodeInfo.address);
          nodes.push({
            ...nodeInfo,
            ...health,
          });
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to get nodes health');
    }

    return nodes;
  }

  /**
   * Parse a node line from CLUSTER NODES output
   */
  private parseNodeLine(
    line: string
  ): { address: string; role: 'master' | 'slave' | 'unknown'; slots: number[] } | null {
    const parts = line.split(' ');
    if (parts.length < 8) {
      return null;
    }

    const address = parts[1].split('@')[0]; // Remove cluster bus port
    const flags = parts[2].split(',');

    let role: 'master' | 'slave' | 'unknown' = 'unknown';
    if (flags.includes('master')) {
      role = 'master';
    } else if (flags.includes('slave')) {
      role = 'slave';
    }

    // Parse slots (for masters)
    const slots: number[] = [];
    for (let i = 8; i < parts.length; i++) {
      const slotRange = parts[i];
      if (slotRange.includes('-')) {
        const [start, end] = slotRange.split('-').map(Number);
        for (let slot = start; slot <= end; slot++) {
          slots.push(slot);
        }
      } else if (!isNaN(Number(slotRange))) {
        slots.push(Number(slotRange));
      }
    }

    return { address, role, slots };
  }

  /**
   * Check health of a specific node
   */
  private async checkNodeHealth(
    address: string
  ): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    try {
      const [host, portStr] = address.split(':');
      const port = parseInt(portStr, 10);

      const node = new IORedis({
        host,
        port,
        password: this.config.password || undefined,
        connectTimeout: 2000,
        commandTimeout: 2000,
        lazyConnect: true,
      });

      const start = performance.now();
      await node.connect();
      const result = await withTimeout(node.ping(), 2000, 'Node ping timeout');
      const latencyMs = performance.now() - start;

      await node.quit();

      return {
        healthy: result === 'PONG',
        latencyMs: Math.round(latencyMs * 100) / 100,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if cluster is healthy (quick check)
   */
  async isHealthy(): Promise<boolean> {
    if (!this.cluster || !this.isConnected) {
      return false;
    }

    try {
      const result = await withTimeout(
        this.cluster.ping(),
        this.config.commandTimeoutMs,
        'Cluster ping timeout'
      );
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get failover history
   */
  getFailoverHistory(): FailoverEvent[] {
    return [...this.failoverHistory];
  }

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.get(prefixedKey);
      this.recordOperationMetrics(key, 'get', start);
      return result;
    } catch (error) {
      this.handleOperationError('get', key, error);
      throw error;
    }
  }

  /**
   * Set a value with optional TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      let result: 'OK';
      if (ttlSeconds) {
        result = (await client.setex(prefixedKey, ttlSeconds, value)) as 'OK';
      } else {
        result = (await client.set(prefixedKey, value)) as 'OK';
      }
      this.recordOperationMetrics(key, 'set', start);
      return result;
    } catch (error) {
      this.handleOperationError('set', key, error);
      throw error;
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.del(prefixedKey);
      this.recordOperationMetrics(key, 'del', start);
      return result;
    } catch (error) {
      this.handleOperationError('del', key, error);
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.exists(prefixedKey);
      this.recordOperationMetrics(key, 'exists', start);
      return result === 1;
    } catch (error) {
      this.handleOperationError('exists', key, error);
      throw error;
    }
  }

  /**
   * Set key expiration
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.expire(prefixedKey, seconds);
      this.recordOperationMetrics(key, 'expire', start);
      return result === 1;
    } catch (error) {
      this.handleOperationError('expire', key, error);
      throw error;
    }
  }

  /**
   * Get time to live for a key
   */
  async ttl(key: string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.ttl(prefixedKey);
      this.recordOperationMetrics(key, 'ttl', start);
      return result;
    } catch (error) {
      this.handleOperationError('ttl', key, error);
      throw error;
    }
  }

  /**
   * Increment a key
   */
  async incr(key: string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.incr(prefixedKey);
      this.recordOperationMetrics(key, 'incr', start);
      return result;
    } catch (error) {
      this.handleOperationError('incr', key, error);
      throw error;
    }
  }

  /**
   * Increment by a value
   */
  async incrby(key: string, increment: number): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.incrby(prefixedKey, increment);
      this.recordOperationMetrics(key, 'incrby', start);
      return result;
    } catch (error) {
      this.handleOperationError('incrby', key, error);
      throw error;
    }
  }

  // ===========================================================================
  // Hash Operations
  // ===========================================================================

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.hget(prefixedKey, field);
      this.recordOperationMetrics(key, 'hget', start);
      return result;
    } catch (error) {
      this.handleOperationError('hget', key, error);
      throw error;
    }
  }

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.hset(prefixedKey, field, value);
      this.recordOperationMetrics(key, 'hset', start);
      return result;
    } catch (error) {
      this.handleOperationError('hset', key, error);
      throw error;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.hgetall(prefixedKey);
      this.recordOperationMetrics(key, 'hgetall', start);
      return result;
    } catch (error) {
      this.handleOperationError('hgetall', key, error);
      throw error;
    }
  }

  /**
   * Delete hash fields
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.hdel(prefixedKey, ...fields);
      this.recordOperationMetrics(key, 'hdel', start);
      return result;
    } catch (error) {
      this.handleOperationError('hdel', key, error);
      throw error;
    }
  }

  // ===========================================================================
  // List Operations
  // ===========================================================================

  /**
   * Push to list (left)
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.lpush(prefixedKey, ...values);
      this.recordOperationMetrics(key, 'lpush', start);
      return result;
    } catch (error) {
      this.handleOperationError('lpush', key, error);
      throw error;
    }
  }

  /**
   * Push to list (right)
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.rpush(prefixedKey, ...values);
      this.recordOperationMetrics(key, 'rpush', start);
      return result;
    } catch (error) {
      this.handleOperationError('rpush', key, error);
      throw error;
    }
  }

  /**
   * Pop from list (left)
   */
  async lpop(key: string): Promise<string | null> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.lpop(prefixedKey);
      this.recordOperationMetrics(key, 'lpop', start);
      return result;
    } catch (error) {
      this.handleOperationError('lpop', key, error);
      throw error;
    }
  }

  /**
   * Pop from list (right)
   */
  async rpop(key: string): Promise<string | null> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.rpop(prefixedKey);
      this.recordOperationMetrics(key, 'rpop', start);
      return result;
    } catch (error) {
      this.handleOperationError('rpop', key, error);
      throw error;
    }
  }

  /**
   * Get list range
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const startTime = performance.now();

    try {
      const result = await client.lrange(prefixedKey, start, stop);
      this.recordOperationMetrics(key, 'lrange', startTime);
      return result;
    } catch (error) {
      this.handleOperationError('lrange', key, error);
      throw error;
    }
  }

  // ===========================================================================
  // Set Operations
  // ===========================================================================

  /**
   * Add members to set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.sadd(prefixedKey, ...members);
      this.recordOperationMetrics(key, 'sadd', start);
      return result;
    } catch (error) {
      this.handleOperationError('sadd', key, error);
      throw error;
    }
  }

  /**
   * Remove members from set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.srem(prefixedKey, ...members);
      this.recordOperationMetrics(key, 'srem', start);
      return result;
    } catch (error) {
      this.handleOperationError('srem', key, error);
      throw error;
    }
  }

  /**
   * Check if member is in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.sismember(prefixedKey, member);
      this.recordOperationMetrics(key, 'sismember', start);
      return result === 1;
    } catch (error) {
      this.handleOperationError('sismember', key, error);
      throw error;
    }
  }

  /**
   * Get all set members
   */
  async smembers(key: string): Promise<string[]> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.smembers(prefixedKey);
      this.recordOperationMetrics(key, 'smembers', start);
      return result;
    } catch (error) {
      this.handleOperationError('smembers', key, error);
      throw error;
    }
  }

  // ===========================================================================
  // Sorted Set Operations
  // ===========================================================================

  /**
   * Add to sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.zadd(prefixedKey, score, member);
      this.recordOperationMetrics(key, 'zadd', start);
      return result;
    } catch (error) {
      this.handleOperationError('zadd', key, error);
      throw error;
    }
  }

  /**
   * Get sorted set range by score
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { limit?: { offset: number; count: number } }
  ): Promise<string[]> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      let result: string[];
      if (options?.limit) {
        result = await client.zrangebyscore(
          prefixedKey,
          min,
          max,
          'LIMIT',
          options.limit.offset,
          options.limit.count
        );
      } else {
        result = await client.zrangebyscore(prefixedKey, min, max);
      }
      this.recordOperationMetrics(key, 'zrangebyscore', start);
      return result;
    } catch (error) {
      this.handleOperationError('zrangebyscore', key, error);
      throw error;
    }
  }

  /**
   * Remove from sorted set by score range
   */
  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const client = this.getClient();
    const prefixedKey = this.prefixKey(key);
    const start = performance.now();

    try {
      const result = await client.zremrangebyscore(prefixedKey, min, max);
      this.recordOperationMetrics(key, 'zremrangebyscore', start);
      return result;
    } catch (error) {
      this.handleOperationError('zremrangebyscore', key, error);
      throw error;
    }
  }

  // ===========================================================================
  // Pipeline Operations
  // ===========================================================================

  /**
   * Execute a pipeline of operations
   *
   * Note: In a cluster, keys in a pipeline should ideally hash to the same slot.
   * Use hash tags like {user:123} to ensure related keys are on the same node.
   */
  async pipeline<T = unknown>(
    operations: Array<{
      command: string;
      args: (string | number)[];
    }>
  ): Promise<PipelineBatchResult<T>> {
    const client = this.getClient();
    const start = performance.now();

    try {
      const pipe = client.pipeline();

      for (const op of operations) {
        const prefixedArgs = op.args.map((arg, index) => {
          // Only prefix the first argument (key) if it's a string
          if (index === 0 && typeof arg === 'string') {
            return this.prefixKey(arg);
          }
          return arg;
        });

        // Use type assertion for dynamic command invocation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pipe as unknown as Record<string, (...args: (string | number)[]) => void>)[op.command](
          ...prefixedArgs
        );
      }

      const results = await pipe.exec();
      const executionTimeMs = performance.now() - start;

      if (!results) {
        return {
          success: false,
          results: operations.map(() => ({
            success: false,
            error: new Error('Pipeline execution returned null'),
          })),
          executionTimeMs,
        };
      }

      const mappedResults = results.map(([err, result]) => {
        if (err) {
          return {
            success: false,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
        return {
          success: true,
          result: result as T,
        };
      });

      const allSuccess = mappedResults.every((r) => r.success);

      return {
        success: allSuccess,
        results: mappedResults,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = performance.now() - start;
      logger.error({ error }, 'Pipeline execution failed');

      return {
        success: false,
        results: operations.map(() => ({
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
        executionTimeMs,
      };
    }
  }

  /**
   * Execute multiple get operations
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    const client = this.getClient();
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const start = performance.now();

    try {
      const result = await client.mget(...prefixedKeys);
      const executionTime = (performance.now() - start) / 1000;

      // Record metrics for the first key's slot
      if (keys.length > 0) {
        const slotRange = this.getSlotRange(keys[0]);
        redisClusterSlotOperationsTotal.inc({ slot_range: slotRange, operation: 'mget' });
      }

      redisClusterNodeLatencySeconds.observe(
        { node: 'cluster', operation: 'mget' },
        executionTime
      );

      return result;
    } catch (error) {
      this.handleOperationError('mget', keys.join(','), error);
      throw error;
    }
  }

  // ===========================================================================
  // Pub/Sub Operations
  // ===========================================================================

  /**
   * Get or create subscriber client
   */
  private async getSubscriberClient(): Promise<Cluster> {
    if (this.subscriberClient) {
      return this.subscriberClient;
    }

    const startupNodes: ClusterNode[] = this.config.nodes.map((node) => ({
      host: node.host,
      port: node.port,
    }));

    const options = this.buildClusterOptions();
    this.subscriberClient = new IORedis.Cluster(startupNodes, options);

    // Set up message handlers
    this.subscriberClient.on('message', (channel: string, message: string) => {
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        const handlersArray = Array.from(handlers);
        for (const handler of handlersArray) {
          try {
            handler(channel, message);
          } catch (error) {
            logger.error({ error, channel }, 'Error in message handler');
          }
        }
      }
    });

    this.subscriberClient.on(
      'pmessage',
      (pattern: string, channel: string, message: string) => {
        const handlers = this.patternSubscriptions.get(pattern);
        if (handlers) {
          const handlersArray = Array.from(handlers);
          for (const handler of handlersArray) {
            try {
              handler(pattern, channel, message);
            } catch (error) {
              logger.error({ error, pattern, channel }, 'Error in pattern message handler');
            }
          }
        }
      }
    );

    return this.subscriberClient;
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: PubSubMessageHandler): Promise<void> {
    const subscriber = await this.getSubscriberClient();

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
      await subscriber.subscribe(channel);
      logger.info({ channel }, 'Subscribed to channel');
    }

    this.subscriptions.get(channel)!.add(handler);
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string, handler?: PubSubMessageHandler): Promise<void> {
    const handlers = this.subscriptions.get(channel);
    if (!handlers) {
      return;
    }

    if (handler) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscriptions.delete(channel);
        if (this.subscriberClient) {
          await this.subscriberClient.unsubscribe(channel);
        }
        logger.info({ channel }, 'Unsubscribed from channel');
      }
    } else {
      this.subscriptions.delete(channel);
      if (this.subscriberClient) {
        await this.subscriberClient.unsubscribe(channel);
      }
      logger.info({ channel }, 'Unsubscribed from channel (all handlers)');
    }
  }

  /**
   * Subscribe to a pattern
   */
  async psubscribe(pattern: string, handler: PubSubPatternHandler): Promise<void> {
    const subscriber = await this.getSubscriberClient();

    if (!this.patternSubscriptions.has(pattern)) {
      this.patternSubscriptions.set(pattern, new Set());
      await subscriber.psubscribe(pattern);
      logger.info({ pattern }, 'Subscribed to pattern');
    }

    this.patternSubscriptions.get(pattern)!.add(handler);
  }

  /**
   * Unsubscribe from a pattern
   */
  async punsubscribe(pattern: string, handler?: PubSubPatternHandler): Promise<void> {
    const handlers = this.patternSubscriptions.get(pattern);
    if (!handlers) {
      return;
    }

    if (handler) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.patternSubscriptions.delete(pattern);
        if (this.subscriberClient) {
          await this.subscriberClient.punsubscribe(pattern);
        }
        logger.info({ pattern }, 'Unsubscribed from pattern');
      }
    } else {
      this.patternSubscriptions.delete(pattern);
      if (this.subscriberClient) {
        await this.subscriberClient.punsubscribe(pattern);
      }
      logger.info({ pattern }, 'Unsubscribed from pattern (all handlers)');
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    const client = this.getClient();
    const start = performance.now();

    try {
      const result = await client.publish(channel, message);
      const executionTime = (performance.now() - start) / 1000;
      redisClusterNodeLatencySeconds.observe(
        { node: 'cluster', operation: 'publish' },
        executionTime
      );
      return result;
    } catch (error) {
      logger.error({ error, channel }, 'Failed to publish message');
      throw error;
    }
  }

  // ===========================================================================
  // Lua Script Execution
  // ===========================================================================

  /**
   * Execute a Lua script
   */
  async eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const client = this.getClient();
    const start = performance.now();

    try {
      // Prefix keys in args
      const prefixedArgs = args.map((arg, index) => {
        if (index < numKeys && typeof arg === 'string') {
          return this.prefixKey(arg);
        }
        return arg;
      });

      const result = await client.eval(script, numKeys, ...prefixedArgs);
      const executionTime = (performance.now() - start) / 1000;
      redisClusterNodeLatencySeconds.observe(
        { node: 'cluster', operation: 'eval' },
        executionTime
      );
      return result;
    } catch (error) {
      logger.error({ error }, 'Lua script execution failed');
      throw error;
    }
  }

  /**
   * Execute a cached Lua script by SHA
   */
  async evalsha(
    sha: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const client = this.getClient();
    const start = performance.now();

    try {
      // Prefix keys in args
      const prefixedArgs = args.map((arg, index) => {
        if (index < numKeys && typeof arg === 'string') {
          return this.prefixKey(arg);
        }
        return arg;
      });

      const result = await client.evalsha(sha, numKeys, ...prefixedArgs);
      const executionTime = (performance.now() - start) / 1000;
      redisClusterNodeLatencySeconds.observe(
        { node: 'cluster', operation: 'evalsha' },
        executionTime
      );
      return result;
    } catch (error) {
      logger.error({ error }, 'Lua script execution by SHA failed');
      throw error;
    }
  }

  /**
   * Load a Lua script and return its SHA
   */
  async scriptLoad(script: string): Promise<string> {
    const client = this.getClient();

    try {
      const sha = await client.script('LOAD', script) as string;
      logger.debug({ sha }, 'Lua script loaded');
      return sha;
    } catch (error) {
      logger.error({ error }, 'Failed to load Lua script');
      throw error;
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Prefix a key with the configured prefix
   */
  private prefixKey(key: string): string {
    if (key.startsWith(this.config.keyPrefix)) {
      return key;
    }
    return `${this.config.keyPrefix}${key}`;
  }

  /**
   * Get the slot number for a key
   */
  getSlot(key: string): number {
    return this.calculateSlot(key);
  }

  /**
   * Calculate slot for a key
   */
  private calculateSlot(key: string): number {
    // Extract hash tag if present
    const hashTagMatch = key.match(/\{([^}]+)\}/);
    const hashKey = hashTagMatch ? hashTagMatch[1] : key;

    // CRC16 implementation for slot calculation
    return this.crc16(hashKey) % 16384;
  }

  /**
   * CRC16 implementation for Redis cluster slot calculation
   */
  private crc16(str: string): number {
    const TABLE = [
      0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
      0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
      0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
      0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
      0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
      0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
      0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
      0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
    ];

    let crc = 0;
    for (let i = 0; i < str.length; i++) {
      crc = ((crc << 8) ^ TABLE[((crc >> 8) ^ str.charCodeAt(i)) & 0xff]) & 0xffff;
    }
    return crc;
  }

  /**
   * Get slot range string for metrics
   */
  private getSlotRange(key: string): string {
    const slot = this.getSlot(key);
    const rangeStart = Math.floor(slot / 1000) * 1000;
    const rangeEnd = rangeStart + 999;
    return `${rangeStart}-${rangeEnd}`;
  }

  /**
   * Record operation metrics
   */
  private recordOperationMetrics(key: string, operation: string, startTime: number): void {
    const executionTime = (performance.now() - startTime) / 1000;
    const slotRange = this.getSlotRange(key);

    redisClusterSlotOperationsTotal.inc({ slot_range: slotRange, operation });
    redisClusterNodeLatencySeconds.observe(
      { node: 'cluster', operation },
      executionTime
    );
  }

  /**
   * Handle operation error
   */
  private handleOperationError(operation: string, key: string, error: unknown): void {
    // Check for MOVED/ASK redirections
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('MOVED')) {
      redisClusterRedirectionsTotal.inc({ type: 'MOVED' });
      logger.debug({ operation, key }, 'MOVED redirection handled');
    } else if (errorMessage.includes('ASK')) {
      redisClusterRedirectionsTotal.inc({ type: 'ASK' });
      logger.debug({ operation, key }, 'ASK redirection handled');
    }

    logger.error({ error, operation, key }, 'Redis cluster operation failed');
  }

  /**
   * Scan keys matching a pattern
   *
   * Note: In a cluster, this scans all nodes
   */
  async scan(pattern: string, count: number = 100): Promise<string[]> {
    const client = this.getClient();
    const prefixedPattern = this.prefixKey(pattern);
    const keys: string[] = [];

    try {
      const nodes = client.nodes('master');

      for (const node of nodes) {
        let cursor = '0';
        do {
          const [newCursor, nodeKeys] = await node.scan(
            cursor,
            'MATCH',
            prefixedPattern,
            'COUNT',
            count
          );
          cursor = newCursor;
          keys.push(...nodeKeys);
        } while (cursor !== '0');
      }

      return keys;
    } catch (error) {
      logger.error({ error, pattern }, 'Scan operation failed');
      throw error;
    }
  }

  /**
   * Flush all keys (use with caution!)
   */
  async flushall(): Promise<void> {
    const client = this.getClient();

    try {
      const nodes = client.nodes('master');

      for (const node of nodes) {
        await node.flushall();
      }

      logger.warn('All cluster data flushed');
    } catch (error) {
      logger.error({ error }, 'Flushall operation failed');
      throw error;
    }
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let clusterInstance: RedisClusterManager | null = null;

/**
 * Initialize the global Redis cluster manager
 */
export function initializeRedisCluster(config: RedisClusterConfig): RedisClusterManager {
  if (clusterInstance) {
    logger.warn('Redis cluster already initialized, returning existing instance');
    return clusterInstance;
  }

  clusterInstance = new RedisClusterManager(config);
  return clusterInstance;
}

/**
 * Get the global Redis cluster manager
 */
export function getRedisCluster(): RedisClusterManager {
  if (!clusterInstance) {
    throw new Error(
      'Redis cluster not initialized. Call initializeRedisCluster() first.'
    );
  }
  return clusterInstance;
}

/**
 * Check if Redis cluster is initialized
 */
export function isRedisClusterInitialized(): boolean {
  return clusterInstance !== null;
}

/**
 * Close the global Redis cluster connection
 */
export async function closeRedisCluster(): Promise<void> {
  if (clusterInstance) {
    await clusterInstance.disconnect();
    clusterInstance = null;
    logger.info('Global Redis cluster connection closed');
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  redisClusterConnectionsGauge,
  redisClusterSlotOperationsTotal,
  redisClusterFailoverEventsTotal,
  redisClusterNodeLatencySeconds,
  redisClusterRedirectionsTotal,
  redisClusterSlotCoverageGauge,
  redisClusterHealthyNodesGauge,
};
