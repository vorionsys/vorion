/**
 * Cognigate Types - Resource Limiting and Output Validation
 *
 * Type definitions for the Cognigate execution gateway's resource
 * limiting and output validation capabilities.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/types
 */

import type { ID } from '../common/types.js';

/**
 * Resource limits for execution
 */
export interface ResourceLimits {
  /** Maximum memory usage in MB */
  maxMemoryMb: number;
  /** Maximum CPU usage percentage */
  maxCpuPercent: number;
  /** Execution timeout in milliseconds */
  timeoutMs: number;
  /** Maximum number of network requests (optional) */
  maxNetworkRequests?: number;
  /** Maximum number of file system operations (optional) */
  maxFileSystemOps?: number;
}

/**
 * Resource usage metrics collected during execution
 */
export interface ResourceUsage {
  /** Peak memory usage in MB */
  memoryPeakMb: number;
  /** CPU time consumed in milliseconds */
  cpuTimeMs: number;
  /** Wall clock time in milliseconds */
  wallTimeMs: number;
  /** Number of network requests made */
  networkRequests: number;
  /** Number of file system operations performed */
  fileSystemOps: number;
}

/**
 * Resource state provider interface for distributed resource tracking.
 * Implementations use Redis for atomic operations across instances.
 */
export interface ResourceStateProvider {
  /**
   * Initialize execution tracking with limits and TTL
   * @param executionId - Unique execution identifier
   * @param limits - Resource limits to enforce
   * @param ttlMs - Time-to-live for the execution record in milliseconds
   */
  initExecution(executionId: ID, limits: ResourceLimits, ttlMs: number): Promise<void>;

  /**
   * Record memory usage sample, updating peak if higher
   * @param executionId - Unique execution identifier
   * @param memoryMb - Current memory usage in MB
   */
  recordMemoryUsage(executionId: ID, memoryMb: number): Promise<void>;

  /**
   * Get peak memory usage for an execution
   * @param executionId - Unique execution identifier
   * @returns Peak memory in MB
   */
  getPeakMemory(executionId: ID): Promise<number>;

  /**
   * Atomically increment CPU time and return new total
   * @param executionId - Unique execution identifier
   * @param deltaMs - CPU time delta in milliseconds
   * @returns New total CPU time in milliseconds
   */
  incrementCpuTime(executionId: ID, deltaMs: number): Promise<number>;

  /**
   * Get total CPU time for an execution
   * @param executionId - Unique execution identifier
   * @returns Total CPU time in milliseconds
   */
  getCpuTimeMs(executionId: ID): Promise<number>;

  /**
   * Atomically increment network request count and check limit
   * @param executionId - Unique execution identifier
   * @param limit - Maximum allowed requests
   * @returns Object with allowed flag and current count
   */
  incrementNetworkRequests(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }>;

  /**
   * Get current network request count
   * @param executionId - Unique execution identifier
   * @returns Current network request count
   */
  getNetworkRequestCount(executionId: ID): Promise<number>;

  /**
   * Atomically increment file system operation count and check limit
   * @param executionId - Unique execution identifier
   * @param limit - Maximum allowed operations
   * @returns Object with allowed flag and current count
   */
  incrementFileSystemOps(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }>;

  /**
   * Get current file system operation count
   * @param executionId - Unique execution identifier
   * @returns Current file system operation count
   */
  getFileSystemOpCount(executionId: ID): Promise<number>;

  /**
   * Check if execution should be terminated based on resource limits
   * @param executionId - Unique execution identifier
   * @param limits - Resource limits to check against
   * @returns Termination decision with reason if applicable
   */
  shouldTerminate(
    executionId: ID,
    limits: ResourceLimits
  ): Promise<{ terminate: boolean; reason?: string; violation?: string }>;

  /**
   * Clean up execution tracking and return final usage metrics
   * @param executionId - Unique execution identifier
   * @returns Final resource usage metrics
   */
  cleanupExecution(executionId: ID): Promise<ResourceUsage>;
}

/**
 * Output validation mode
 */
export type OutputValidationMode = 'strict' | 'permissive';

/**
 * Output validation options
 */
export interface OutputValidationOptions {
  /** Validation mode: strict (reject invalid) or permissive (log only) */
  mode: OutputValidationMode;
  /** Whether to sanitize PII from output */
  sanitizePII: boolean;
  /** Custom prohibited patterns */
  prohibitedPatterns?: Array<{
    type: 'regex' | 'keyword' | 'semantic';
    pattern: string;
    description: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

/**
 * Resource violation types
 */
export type ResourceViolationType =
  | 'memory_exceeded'
  | 'cpu_exceeded'
  | 'timeout_exceeded'
  | 'network_limit_exceeded'
  | 'filesystem_limit_exceeded';

/**
 * Termination reason
 */
export interface TerminationReason {
  /** Type of violation that caused termination */
  violation: ResourceViolationType;
  /** Human-readable reason */
  reason: string;
  /** Current value that exceeded limit */
  currentValue: number;
  /** Limit that was exceeded */
  limit: number;
  /** Timestamp when termination was triggered */
  terminatedAt: string;
}

/**
 * Execution state for tracking in-flight executions
 */
export interface ExecutionState {
  /** Execution identifier */
  executionId: ID;
  /** Intent identifier */
  intentId: ID;
  /** Start time in ISO format */
  startedAt: string;
  /** Resource limits for this execution */
  limits: ResourceLimits;
  /** Whether execution has been terminated */
  terminated: boolean;
  /** Termination reason if terminated */
  terminationReason?: TerminationReason;
}

/**
 * Resource snapshot for atomic limit checking
 */
export interface ResourceSnapshot {
  /** Peak memory usage in MB */
  memoryPeakMb: number;
  /** Total CPU time in milliseconds */
  cpuTimeMs: number;
  /** Wall clock time in milliseconds */
  wallTimeMs: number;
  /** Network request count */
  networkRequests: number;
  /** File system operation count */
  fileSystemOps: number;
}
