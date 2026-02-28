/**
 * Priority Request Queue
 *
 * Manages AI request queuing with priority levels, rate limiting per tenant,
 * and fair scheduling across priority classes.
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Request priority levels
 */
export type Priority = "critical" | "high" | "medium" | "low" | "background";

/**
 * Priority weights for scheduling
 */
const PRIORITY_WEIGHTS: Record<Priority, number> = {
  critical: 100,
  high: 50,
  medium: 20,
  low: 10,
  background: 1,
};

/**
 * Queued request
 */
export interface QueuedRequest<T = unknown> {
  id: string;
  tenantId: string;
  priority: Priority;
  data: T;
  metadata: {
    enqueuedAt: Date;
    estimatedTokens?: number;
    maxWaitMs?: number;
    retryCount: number;
    tags?: string[];
  };
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  /** Maximum queue size per priority */
  maxSizePerPriority: Record<Priority, number>;
  /** Maximum total queue size */
  maxTotalSize: number;
  /** Default timeout for queued requests (ms) */
  defaultTimeoutMs: number;
  /** Enable fair scheduling between tenants */
  fairScheduling: boolean;
  /** Maximum concurrent requests per tenant */
  maxConcurrentPerTenant: number;
  /** Maximum concurrent requests total */
  maxConcurrentTotal: number;
  /** Enable priority aging (boost old low-priority requests) */
  enablePriorityAging: boolean;
  /** Time after which priority is boosted (ms) */
  agingThresholdMs: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  totalQueued: number;
  byPriority: Record<Priority, number>;
  byTenant: Record<string, number>;
  processingCount: number;
  avgWaitTimeMs: number;
  oldestRequestMs: number;
  droppedCount: number;
  timeoutCount: number;
}

/**
 * Dequeue result
 */
export interface DequeueResult<T> {
  request: QueuedRequest<T>;
  waitTimeMs: number;
  effectivePriority: Priority;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: QueueConfig = {
  maxSizePerPriority: {
    critical: 100,
    high: 500,
    medium: 1000,
    low: 2000,
    background: 5000,
  },
  maxTotalSize: 10000,
  defaultTimeoutMs: 300000, // 5 minutes
  fairScheduling: true,
  maxConcurrentPerTenant: 50,
  maxConcurrentTotal: 200,
  enablePriorityAging: true,
  agingThresholdMs: 60000, // 1 minute
};

// =============================================================================
// PRIORITY QUEUE
// =============================================================================

/**
 * Priority-based request queue with fair scheduling
 *
 * Features:
 * - Multi-level priority queuing
 * - Per-tenant rate limiting
 * - Fair scheduling with weighted priorities
 * - Request timeout handling
 * - Priority aging for starvation prevention
 * - Concurrent request limiting
 */
export class RequestQueue<T = unknown> {
  private config: QueueConfig;
  private queues: Map<Priority, QueuedRequest<T>[]> = new Map();
  private processing: Map<string, Set<string>> = new Map(); // tenantId -> request IDs
  private processingTotal: Set<string> = new Set();
  private tenantRoundRobin: Map<Priority, string[]> = new Map();
  private tenantIndex: Map<Priority, number> = new Map();
  private stats = {
    droppedCount: 0,
    timeoutCount: 0,
    totalWaitTimeMs: 0,
    completedCount: 0,
  };

  constructor(config?: Partial<QueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize queues for each priority
    const priorities: Priority[] = [
      "critical",
      "high",
      "medium",
      "low",
      "background",
    ];
    for (const priority of priorities) {
      this.queues.set(priority, []);
      this.tenantRoundRobin.set(priority, []);
      this.tenantIndex.set(priority, 0);
    }
  }

  /**
   * Generate unique request ID
   */
  private generateId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Enqueue a request
   */
  async enqueue(
    tenantId: string,
    priority: Priority,
    data: T,
    options?: {
      estimatedTokens?: number;
      maxWaitMs?: number;
      tags?: string[];
    },
  ): Promise<unknown> {
    // Check queue limits
    if (!this.canEnqueue(priority, tenantId)) {
      this.stats.droppedCount++;
      throw new Error(
        `Queue limit exceeded for priority ${priority} or tenant ${tenantId}`,
      );
    }

    const id = this.generateId();
    const timeoutMs = options?.maxWaitMs ?? this.config.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id,
        tenantId,
        priority,
        data,
        metadata: {
          enqueuedAt: new Date(),
          estimatedTokens: options?.estimatedTokens,
          maxWaitMs: timeoutMs,
          retryCount: 0,
          tags: options?.tags,
        },
        resolve,
        reject,
      };

      // Set timeout
      request.timeout = setTimeout(() => {
        this.handleTimeout(request);
      }, timeoutMs);

      // Add to queue
      const queue = this.queues.get(priority)!;
      queue.push(request);

      // Update tenant round-robin list
      const tenants = this.tenantRoundRobin.get(priority)!;
      if (!tenants.includes(tenantId)) {
        tenants.push(tenantId);
      }

      console.log(
        `[QUEUE] Enqueued: ${id} (priority: ${priority}, tenant: ${tenantId}, queue size: ${queue.length})`,
      );
    });
  }

  /**
   * Check if request can be enqueued
   */
  private canEnqueue(priority: Priority, tenantId: string): boolean {
    // Check priority queue limit
    const queue = this.queues.get(priority)!;
    if (queue.length >= this.config.maxSizePerPriority[priority]) {
      return false;
    }

    // Check total queue limit
    const totalSize = this.getTotalQueueSize();
    if (totalSize >= this.config.maxTotalSize) {
      return false;
    }

    return true;
  }

  /**
   * Dequeue next request
   */
  dequeue(): DequeueResult<T> | null {
    // Check concurrency limits
    if (this.processingTotal.size >= this.config.maxConcurrentTotal) {
      return null;
    }

    // Try to dequeue by priority (with aging)
    const priorities: Priority[] = [
      "critical",
      "high",
      "medium",
      "low",
      "background",
    ];

    for (const priority of priorities) {
      const result = this.dequeueFromPriority(priority);
      if (result) {
        return result;
      }
    }

    return null;
  }

  /**
   * Dequeue from specific priority
   */
  private dequeueFromPriority(priority: Priority): DequeueResult<T> | null {
    const queue = this.queues.get(priority)!;
    if (queue.length === 0) {
      return null;
    }

    let request: QueuedRequest<T> | null = null;
    let requestIndex = -1;

    if (this.config.fairScheduling) {
      // Fair scheduling: round-robin between tenants
      const result = this.selectFairRequest(priority, queue);
      request = result.request;
      requestIndex = result.index;
    } else {
      // FIFO within priority
      request = queue[0] ?? null;
      requestIndex = 0;
    }

    if (!request) {
      return null;
    }

    // Check per-tenant concurrency limit
    const tenantProcessing = this.processing.get(request.tenantId) ?? new Set();
    if (tenantProcessing.size >= this.config.maxConcurrentPerTenant) {
      // Find another request from different tenant
      return this.findAlternativeRequest(priority, queue, request.tenantId);
    }

    // Remove from queue
    queue.splice(requestIndex, 1);

    // Track as processing
    if (!this.processing.has(request.tenantId)) {
      this.processing.set(request.tenantId, new Set());
    }
    this.processing.get(request.tenantId)!.add(request.id);
    this.processingTotal.add(request.id);

    // Cancel timeout
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    const waitTimeMs = Date.now() - request.metadata.enqueuedAt.getTime();

    // Check for priority aging
    let effectivePriority = priority;
    if (
      this.config.enablePriorityAging &&
      waitTimeMs > this.config.agingThresholdMs
    ) {
      effectivePriority = this.boostPriority(priority);
    }

    return {
      request,
      waitTimeMs,
      effectivePriority,
    };
  }

  /**
   * Select request using fair scheduling
   */
  private selectFairRequest(
    priority: Priority,
    queue: QueuedRequest<T>[],
  ): { request: QueuedRequest<T> | null; index: number } {
    const tenants = this.tenantRoundRobin.get(priority)!;
    if (tenants.length === 0) {
      return { request: null, index: -1 };
    }

    let currentIndex = this.tenantIndex.get(priority) ?? 0;
    const startIndex = currentIndex;

    do {
      const tenantId = tenants[currentIndex % tenants.length]!;
      currentIndex = (currentIndex + 1) % tenants.length;

      // Find first request from this tenant
      const requestIndex = queue.findIndex((r) => r.tenantId === tenantId);
      if (requestIndex >= 0) {
        this.tenantIndex.set(priority, currentIndex);
        return { request: queue[requestIndex]!, index: requestIndex };
      }

      // Remove tenant from round-robin if no requests
      const tenantHasRequests = queue.some((r) => r.tenantId === tenantId);
      if (!tenantHasRequests) {
        const idx = tenants.indexOf(tenantId);
        if (idx >= 0) {
          tenants.splice(idx, 1);
          if (currentIndex > idx) currentIndex--;
        }
      }
    } while (currentIndex !== startIndex && tenants.length > 0);

    // Fallback to first in queue
    if (queue.length > 0) {
      return { request: queue[0]!, index: 0 };
    }

    return { request: null, index: -1 };
  }

  /**
   * Find alternative request from different tenant
   */
  private findAlternativeRequest(
    priority: Priority,
    queue: QueuedRequest<T>[],
    excludeTenantId: string,
  ): DequeueResult<T> | null {
    for (let i = 0; i < queue.length; i++) {
      const request = queue[i]!;
      if (request.tenantId === excludeTenantId) continue;

      const tenantProcessing =
        this.processing.get(request.tenantId) ?? new Set();
      if (tenantProcessing.size < this.config.maxConcurrentPerTenant) {
        // Remove and return this request
        queue.splice(i, 1);

        if (!this.processing.has(request.tenantId)) {
          this.processing.set(request.tenantId, new Set());
        }
        this.processing.get(request.tenantId)!.add(request.id);
        this.processingTotal.add(request.id);

        if (request.timeout) {
          clearTimeout(request.timeout);
        }

        const waitTimeMs = Date.now() - request.metadata.enqueuedAt.getTime();

        return {
          request,
          waitTimeMs,
          effectivePriority: priority,
        };
      }
    }

    return null;
  }

  /**
   * Boost priority for aged requests
   */
  private boostPriority(current: Priority): Priority {
    const order: Priority[] = [
      "background",
      "low",
      "medium",
      "high",
      "critical",
    ];
    const currentIndex = order.indexOf(current);
    if (currentIndex < order.length - 1) {
      return order[currentIndex + 1]!;
    }
    return current;
  }

  /**
   * Mark request as complete
   */
  complete(requestId: string, tenantId: string, result: unknown): void {
    const tenantProcessing = this.processing.get(tenantId);
    if (tenantProcessing) {
      tenantProcessing.delete(requestId);
      if (tenantProcessing.size === 0) {
        this.processing.delete(tenantId);
      }
    }
    this.processingTotal.delete(requestId);

    this.stats.completedCount++;
  }

  /**
   * Mark request as failed
   */
  fail(requestId: string, tenantId: string, error: Error): void {
    const tenantProcessing = this.processing.get(tenantId);
    if (tenantProcessing) {
      tenantProcessing.delete(requestId);
      if (tenantProcessing.size === 0) {
        this.processing.delete(tenantId);
      }
    }
    this.processingTotal.delete(requestId);
  }

  /**
   * Handle request timeout
   */
  private handleTimeout(request: QueuedRequest<T>): void {
    // Remove from queue
    const queue = this.queues.get(request.priority)!;
    const index = queue.findIndex((r) => r.id === request.id);
    if (index >= 0) {
      queue.splice(index, 1);
    }

    this.stats.timeoutCount++;

    request.reject(
      new Error(
        `Request ${request.id} timed out after ${request.metadata.maxWaitMs}ms`,
      ),
    );

    console.log(
      `[QUEUE] Timeout: ${request.id} (priority: ${request.priority}, tenant: ${request.tenantId})`,
    );
  }

  /**
   * Get total queue size
   */
  getTotalQueueSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Get queue size by priority
   */
  getQueueSize(priority: Priority): number {
    return this.queues.get(priority)?.length ?? 0;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const byPriority: Record<Priority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      background: 0,
    };

    const byTenant: Record<string, number> = {};
    let oldestRequestMs = 0;
    let totalWaitTimeMs = 0;
    let totalRequests = 0;

    for (const [priority, queue] of this.queues) {
      byPriority[priority] = queue.length;

      for (const request of queue) {
        const waitTimeMs = Date.now() - request.metadata.enqueuedAt.getTime();
        totalWaitTimeMs += waitTimeMs;
        totalRequests++;

        if (waitTimeMs > oldestRequestMs) {
          oldestRequestMs = waitTimeMs;
        }

        byTenant[request.tenantId] = (byTenant[request.tenantId] ?? 0) + 1;
      }
    }

    return {
      totalQueued: this.getTotalQueueSize(),
      byPriority,
      byTenant,
      processingCount: this.processingTotal.size,
      avgWaitTimeMs: totalRequests > 0 ? totalWaitTimeMs / totalRequests : 0,
      oldestRequestMs,
      droppedCount: this.stats.droppedCount,
      timeoutCount: this.stats.timeoutCount,
    };
  }

  /**
   * Get processing count for tenant
   */
  getProcessingCount(tenantId: string): number {
    return this.processing.get(tenantId)?.size ?? 0;
  }

  /**
   * Clear all queues
   */
  clear(): void {
    for (const [priority, queue] of this.queues) {
      for (const request of queue) {
        if (request.timeout) {
          clearTimeout(request.timeout);
        }
        request.reject(new Error("Queue cleared"));
      }
      queue.length = 0;
    }

    console.log("[QUEUE] All queues cleared");
  }

  /**
   * Peek at next request without dequeuing
   */
  peek(): QueuedRequest<T> | null {
    const priorities: Priority[] = [
      "critical",
      "high",
      "medium",
      "low",
      "background",
    ];

    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue[0]!;
      }
    }

    return null;
  }
}

/**
 * Create request queue instance
 */
export function createRequestQueue<T = unknown>(
  config?: Partial<QueueConfig>,
): RequestQueue<T> {
  return new RequestQueue<T>(config);
}

/**
 * Singleton request queue instance
 */
export const requestQueue = new RequestQueue();
