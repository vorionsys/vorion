/**
 * Sandbox Service
 *
 * Manages isolated execution environments for agent operations.
 * Enforces trust-tier-based capabilities through network and filesystem policies.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../../common/logger.js';
import {
  type SandboxConfig,
  type SandboxInstance,
  type SandboxExecutionResult,
  type TierCapabilities,
  type NetworkPolicy,
  type FilesystemPolicy,
  type ResourceLimits,
  type ExecutionContext,
  type PolicyViolation,
  type SandboxAttestationData,
  SandboxState,
  SandboxRuntime,
  NetworkAccessLevel,
  FilesystemAccessLevel,
  TIER_CAPABILITIES,
} from './types.js';

const logger = createLogger({ component: 'sandbox-service' });

// ============================================================================
// Sandbox Service
// ============================================================================

export class SandboxService {
  private instances: Map<string, SandboxInstance> = new Map();
  private runtimeAdapter: RuntimeAdapter;

  constructor(runtime: SandboxRuntime = SandboxRuntime.DOCKER) {
    this.runtimeAdapter = this.createRuntimeAdapter(runtime);
    logger.info({ runtime }, 'Sandbox service initialized');
  }

  // ==========================================================================
  // Sandbox Lifecycle
  // ==========================================================================

  /**
   * Create a new sandbox for agent execution
   */
  async createSandbox(
    carId: string,
    trustTier: number,
    context: ExecutionContext
  ): Promise<SandboxInstance> {
    const sandboxId = randomUUID();
    const capabilities = this.getCapabilities(trustTier);

    const config: SandboxConfig = {
      sandboxId,
      carId,
      trustTier,
      runtime: this.selectRuntime(trustTier),
      capabilities,
      networkPolicy: this.buildNetworkPolicy(capabilities, context),
      filesystemPolicy: this.buildFilesystemPolicy(capabilities, context),
      resourceLimits: this.buildResourceLimits(capabilities),
      context,
    };

    const instance: SandboxInstance = {
      id: sandboxId,
      config,
      state: SandboxState.CREATING,
      ports: {},
      resourceUsage: {
        memoryBytes: 0,
        cpuPercent: 0,
        diskBytes: 0,
        networkBytesIn: 0,
        networkBytesOut: 0,
        openFiles: 0,
        processCount: 0,
      },
      createdAt: new Date(),
    };

    this.instances.set(sandboxId, instance);

    try {
      // Create the actual sandbox via runtime adapter
      const runtimeId = await this.runtimeAdapter.create(config);
      instance.runtimeId = runtimeId;
      instance.state = SandboxState.READY;

      logger.info({ sandboxId, carId, trustTier }, 'Sandbox created');
    } catch (error) {
      instance.state = SandboxState.FAILED;
      instance.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ sandboxId, error }, 'Failed to create sandbox');
      throw error;
    }

    return instance;
  }

  /**
   * Execute a command in a sandbox
   */
  async execute(
    sandboxId: string,
    command: string,
    args: string[] = [],
    stdin?: string
  ): Promise<SandboxExecutionResult> {
    const instance = this.instances.get(sandboxId);
    if (!instance) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    if (instance.state !== SandboxState.READY && instance.state !== SandboxState.RUNNING) {
      throw new Error(`Sandbox not ready: ${instance.state}`);
    }

    const startTime = Date.now();
    instance.state = SandboxState.RUNNING;
    instance.startedAt = new Date();

    const violations: PolicyViolation[] = [];

    try {
      // Execute via runtime adapter
      const result = await this.runtimeAdapter.execute(
        instance.runtimeId!,
        command,
        args,
        stdin,
        instance.config.resourceLimits.executionMs
      );

      const durationMs = Date.now() - startTime;

      // Collect activity logs
      const networkActivity = await this.runtimeAdapter.getNetworkActivity(instance.runtimeId!);
      const filesystemActivity = await this.runtimeAdapter.getFilesystemActivity(instance.runtimeId!);

      // Check for policy violations
      violations.push(...this.detectViolations(instance, networkActivity, filesystemActivity));

      // Update resource usage
      instance.resourceUsage = await this.runtimeAdapter.getResourceUsage(instance.runtimeId!);

      const attestationData = this.buildAttestationData(result.exitCode === 0, violations);

      const executionResult: SandboxExecutionResult = {
        sandboxId,
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
        resourceUsage: instance.resourceUsage,
        networkActivity,
        filesystemActivity,
        violations,
        attestationData,
      };

      instance.exitCode = result.exitCode;
      instance.state = SandboxState.STOPPED;
      instance.stoppedAt = new Date();

      logger.info(
        { sandboxId, exitCode: result.exitCode, durationMs, violations: violations.length },
        'Sandbox execution completed'
      );

      return executionResult;
    } catch (error) {
      instance.state = SandboxState.FAILED;
      instance.error = error instanceof Error ? error.message : 'Unknown error';
      instance.stoppedAt = new Date();

      logger.error({ sandboxId, error }, 'Sandbox execution failed');

      return {
        sandboxId,
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: instance.error,
        durationMs: Date.now() - startTime,
        resourceUsage: instance.resourceUsage,
        networkActivity: [],
        filesystemActivity: [],
        violations: [{
          timestamp: new Date(),
          type: 'security',
          severity: 'critical',
          description: 'Execution failed with error',
          details: { error: instance.error },
          action: 'terminated',
        }],
        attestationData: this.buildAttestationData(false, violations),
      };
    }
  }

  /**
   * Destroy a sandbox and clean up resources
   */
  async destroy(sandboxId: string): Promise<void> {
    const instance = this.instances.get(sandboxId);
    if (!instance) {
      return;
    }

    instance.state = SandboxState.STOPPING;

    try {
      if (instance.runtimeId) {
        await this.runtimeAdapter.destroy(instance.runtimeId);
      }
      instance.state = SandboxState.DESTROYED;
      this.instances.delete(sandboxId);

      logger.info({ sandboxId }, 'Sandbox destroyed');
    } catch (error) {
      logger.error({ sandboxId, error }, 'Failed to destroy sandbox');
      throw error;
    }
  }

  /**
   * Get sandbox instance by ID
   */
  getInstance(sandboxId: string): SandboxInstance | undefined {
    return this.instances.get(sandboxId);
  }

  /**
   * List all active sandboxes
   */
  listInstances(): SandboxInstance[] {
    return Array.from(this.instances.values());
  }

  // ==========================================================================
  // Policy Builders
  // ==========================================================================

  /**
   * Get capabilities for a trust tier
   */
  private getCapabilities(trustTier: number): TierCapabilities {
    const caps = TIER_CAPABILITIES[trustTier];
    if (!caps) {
      throw new Error(`Invalid trust tier: ${trustTier}`);
    }
    return { ...caps };
  }

  /**
   * Select runtime based on trust tier
   */
  private selectRuntime(trustTier: number): SandboxRuntime {
    if (trustTier <= 1) {
      // Strongest isolation for lowest tiers
      return SandboxRuntime.GVISOR;
    } else if (trustTier <= 3) {
      // Good isolation for mid-low tiers
      return SandboxRuntime.DOCKER;
    } else if (trustTier <= 6) {
      // Standard Docker for trusted tiers
      return SandboxRuntime.DOCKER;
    } else {
      // T7 can run without sandbox (monitored)
      return SandboxRuntime.NONE;
    }
  }

  /**
   * Build network policy from capabilities
   */
  private buildNetworkPolicy(caps: TierCapabilities, context: ExecutionContext): NetworkPolicy {
    const policy: NetworkPolicy = {
      accessLevel: caps.networkAccess,
      allowedEgress: [],
      blockedEgress: [
        // Always block metadata services
        '169.254.169.254',
        'metadata.google.internal',
        // Block local network by default (except localhost for internal)
        ...(caps.networkAccess === NetworkAccessLevel.NONE ? ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] : []),
      ],
      dnsPolicy: {
        servers: ['8.8.8.8', '8.8.4.4'],
        allowedDomains: caps.allowedEgressDomains,
        internalOnly: caps.networkAccess === NetworkAccessLevel.INTERNAL,
      },
      mtlsRequired: caps.networkAccess >= NetworkAccessLevel.EXTERNAL,
      rateLimits: {
        requestsPerMinute: this.getRateLimit(caps.networkAccess),
        egressBytesPerMinute: this.getEgressLimit(caps.networkAccess),
        maxConnections: this.getConnectionLimit(caps.networkAccess),
      },
    };

    // Build allowed egress rules
    for (const domain of caps.allowedEgressDomains) {
      policy.allowedEgress.push({
        destination: domain,
        ports: [80, 443],
        protocol: 'tcp',
      });
    }

    return policy;
  }

  /**
   * Build filesystem policy from capabilities
   */
  private buildFilesystemPolicy(caps: TierCapabilities, context: ExecutionContext): FilesystemPolicy {
    const sandboxRoot = `/sandbox/${context.tenantId}/${context.requestId}`;

    const policy: FilesystemPolicy = {
      accessLevel: caps.filesystemAccess,
      sandboxRoot,
      mounts: [],
      overlay: {
        baseLayer: 'cognigate-base:latest',
        ephemeral: caps.filesystemAccess === FilesystemAccessLevel.READONLY_SANDBOX,
        persistWork: caps.filesystemAccess >= FilesystemAccessLevel.WORKSPACE,
        workDir: `${sandboxRoot}/work`,
      },
      secrets: [],
      quotas: {
        maxBytes: this.getDiskQuota(caps.filesystemAccess),
        maxInodes: 100000,
        warnThreshold: 0.8,
      },
    };

    // Add mounts based on allowed paths
    for (const path of caps.allowedMountPaths) {
      if (path === '*') continue; // Full access doesn't need explicit mounts

      policy.mounts.push({
        source: `${sandboxRoot}${path}`,
        target: path,
        readonly: caps.filesystemAccess === FilesystemAccessLevel.READONLY_SANDBOX,
        type: 'bind',
      });
    }

    // Add tmpfs for temp directory
    policy.mounts.push({
      source: 'tmpfs',
      target: '/tmp',
      readonly: false,
      type: 'tmpfs',
      options: ['size=100m', 'noexec'],
    });

    return policy;
  }

  /**
   * Build resource limits from capabilities
   */
  private buildResourceLimits(caps: TierCapabilities): ResourceLimits {
    return {
      memoryMb: caps.maxMemoryMb === -1 ? 16384 : caps.maxMemoryMb,
      cpuPercent: caps.maxCpuPercent,
      executionMs: caps.maxExecutionMs === -1 ? 86400000 : caps.maxExecutionMs,
      maxPids: caps.canSpawnSubprocesses ? 100 : 10,
      maxOpenFiles: 1024,
      oomKillEnabled: true,
    };
  }

  // ==========================================================================
  // Violation Detection
  // ==========================================================================

  /**
   * Detect policy violations from activity logs
   */
  private detectViolations(
    instance: SandboxInstance,
    networkActivity: any[],
    filesystemActivity: any[]
  ): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Check network violations
    for (const activity of networkActivity) {
      if (!activity.allowed) {
        violations.push({
          timestamp: activity.timestamp,
          type: 'network',
          severity: 'medium',
          description: `Blocked network access to ${activity.destination}:${activity.port}`,
          details: activity,
          action: 'blocked',
        });
      }
    }

    // Check filesystem violations
    for (const activity of filesystemActivity) {
      if (!activity.allowed) {
        violations.push({
          timestamp: activity.timestamp,
          type: 'filesystem',
          severity: activity.operation === 'write' ? 'high' : 'medium',
          description: `Blocked filesystem ${activity.operation} on ${activity.path}`,
          details: activity,
          action: 'blocked',
        });
      }
    }

    // Check resource violations
    const limits = instance.config.resourceLimits;
    const usage = instance.resourceUsage;

    if (usage.memoryBytes > limits.memoryMb * 1024 * 1024 * 0.95) {
      violations.push({
        timestamp: new Date(),
        type: 'resource',
        severity: 'high',
        description: 'Memory usage approaching limit',
        details: { limit: limits.memoryMb, usedMb: Math.round(usage.memoryBytes / 1024 / 1024) },
        action: 'logged',
      });
    }

    return violations;
  }

  /**
   * Build attestation data from execution results
   */
  private buildAttestationData(success: boolean, violations: PolicyViolation[]): SandboxAttestationData {
    const maxSeverity = violations.reduce((max, v) => {
      const order = ['low', 'medium', 'high', 'critical'];
      return order.indexOf(v.severity) > order.indexOf(max) ? v.severity : max;
    }, 'none' as 'none' | 'low' | 'medium' | 'high' | 'critical');

    return {
      executionSuccess: success,
      resourceCompliance: !violations.some(v => v.type === 'resource'),
      networkCompliance: !violations.some(v => v.type === 'network'),
      filesystemCompliance: !violations.some(v => v.type === 'filesystem'),
      violationCount: violations.length,
      violationSeverity: violations.length === 0 ? 'none' : maxSeverity,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private createRuntimeAdapter(runtime: SandboxRuntime): RuntimeAdapter {
    // In production, this would return Docker/gVisor/Firecracker adapters
    return new MockRuntimeAdapter();
  }

  private getRateLimit(level: NetworkAccessLevel): number {
    const limits: Record<NetworkAccessLevel, number> = {
      [NetworkAccessLevel.NONE]: 0,
      [NetworkAccessLevel.INTERNAL]: 100,
      [NetworkAccessLevel.EXTERNAL]: 1000,
      [NetworkAccessLevel.CROSS_AGENT]: 5000,
      [NetworkAccessLevel.FULL]: -1,
    };
    return limits[level];
  }

  private getEgressLimit(level: NetworkAccessLevel): number {
    const limits: Record<NetworkAccessLevel, number> = {
      [NetworkAccessLevel.NONE]: 0,
      [NetworkAccessLevel.INTERNAL]: 10 * 1024 * 1024, // 10MB
      [NetworkAccessLevel.EXTERNAL]: 100 * 1024 * 1024, // 100MB
      [NetworkAccessLevel.CROSS_AGENT]: 500 * 1024 * 1024, // 500MB
      [NetworkAccessLevel.FULL]: -1,
    };
    return limits[level];
  }

  private getConnectionLimit(level: NetworkAccessLevel): number {
    const limits: Record<NetworkAccessLevel, number> = {
      [NetworkAccessLevel.NONE]: 0,
      [NetworkAccessLevel.INTERNAL]: 10,
      [NetworkAccessLevel.EXTERNAL]: 50,
      [NetworkAccessLevel.CROSS_AGENT]: 100,
      [NetworkAccessLevel.FULL]: -1,
    };
    return limits[level];
  }

  private getDiskQuota(level: FilesystemAccessLevel): number {
    const quotas: Record<FilesystemAccessLevel, number> = {
      [FilesystemAccessLevel.READONLY_SANDBOX]: 0,
      [FilesystemAccessLevel.WORKSPACE]: 100 * 1024 * 1024, // 100MB
      [FilesystemAccessLevel.EXTENDED]: 1024 * 1024 * 1024, // 1GB
      [FilesystemAccessLevel.FULL]: -1,
    };
    return quotas[level];
  }
}

// ============================================================================
// Runtime Adapter Interface
// ============================================================================

interface RuntimeAdapter {
  create(config: SandboxConfig): Promise<string>;
  execute(
    runtimeId: string,
    command: string,
    args: string[],
    stdin: string | undefined,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  destroy(runtimeId: string): Promise<void>;
  getResourceUsage(runtimeId: string): Promise<any>;
  getNetworkActivity(runtimeId: string): Promise<any[]>;
  getFilesystemActivity(runtimeId: string): Promise<any[]>;
}

/**
 * Mock runtime adapter for development/testing
 */
class MockRuntimeAdapter implements RuntimeAdapter {
  async create(config: SandboxConfig): Promise<string> {
    return `mock-${config.sandboxId}`;
  }

  async execute(
    runtimeId: string,
    command: string,
    args: string[],
    stdin: string | undefined,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return {
      exitCode: 0,
      stdout: `Mock execution of ${command} ${args.join(' ')}`,
      stderr: '',
    };
  }

  async destroy(runtimeId: string): Promise<void> {
    // No-op
  }

  async getResourceUsage(runtimeId: string): Promise<any> {
    return {
      memoryBytes: 50 * 1024 * 1024,
      cpuPercent: 5,
      diskBytes: 10 * 1024 * 1024,
      networkBytesIn: 1024,
      networkBytesOut: 2048,
      openFiles: 10,
      processCount: 1,
    };
  }

  async getNetworkActivity(runtimeId: string): Promise<any[]> {
    return [];
  }

  async getFilesystemActivity(runtimeId: string): Promise<any[]> {
    return [];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: SandboxService | null = null;

export function createSandboxService(runtime?: SandboxRuntime): SandboxService {
  if (!instance) {
    instance = new SandboxService(runtime);
  }
  return instance;
}

export function getSandboxService(): SandboxService {
  if (!instance) {
    throw new Error('SandboxService not initialized');
  }
  return instance;
}
