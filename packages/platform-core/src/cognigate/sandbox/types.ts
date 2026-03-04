/**
 * Sandbox Types
 *
 * Type definitions for Cognigate execution sandbox, network isolation,
 * and filesystem policies.
 *
 * @packageDocumentation
 */

// ============================================================================
// Trust Tier Capabilities
// ============================================================================

/**
 * Network access levels by trust tier
 */
export enum NetworkAccessLevel {
  /** No network access (localhost only) */
  NONE = 'NONE',

  /** Internal APIs only (allowlist) */
  INTERNAL = 'INTERNAL',

  /** External APIs (policy-governed) */
  EXTERNAL = 'EXTERNAL',

  /** Cross-agent communication */
  CROSS_AGENT = 'CROSS_AGENT',

  /** Full network access (monitored) */
  FULL = 'FULL',
}

/**
 * Filesystem access levels by trust tier
 */
export enum FilesystemAccessLevel {
  /** Read-only sandbox with no persistence */
  READONLY_SANDBOX = 'READONLY_SANDBOX',

  /** Scoped to agent workspace only */
  WORKSPACE = 'WORKSPACE',

  /** Workspace + approved mount points */
  EXTENDED = 'EXTENDED',

  /** Full filesystem access (audited) */
  FULL = 'FULL',
}

/**
 * Trust tier capability mappings
 */
export interface TierCapabilities {
  networkAccess: NetworkAccessLevel;
  filesystemAccess: FilesystemAccessLevel;
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxExecutionMs: number;
  allowedEgressDomains: string[];
  allowedMountPaths: string[];
  canSpawnSubprocesses: boolean;
  canAccessSecrets: boolean;
  canCommunicateWithAgents: boolean;
}

/**
 * Default capabilities by trust tier
 */
export const TIER_CAPABILITIES: Record<number, TierCapabilities> = {
  0: { // T0 Sandbox
    networkAccess: NetworkAccessLevel.NONE,
    filesystemAccess: FilesystemAccessLevel.READONLY_SANDBOX,
    maxMemoryMb: 256,
    maxCpuPercent: 25,
    maxExecutionMs: 30000,
    allowedEgressDomains: [],
    allowedMountPaths: [],
    canSpawnSubprocesses: false,
    canAccessSecrets: false,
    canCommunicateWithAgents: false,
  },
  1: { // T1 Observed
    networkAccess: NetworkAccessLevel.NONE,
    filesystemAccess: FilesystemAccessLevel.READONLY_SANDBOX,
    maxMemoryMb: 512,
    maxCpuPercent: 25,
    maxExecutionMs: 60000,
    allowedEgressDomains: [],
    allowedMountPaths: [],
    canSpawnSubprocesses: false,
    canAccessSecrets: false,
    canCommunicateWithAgents: false,
  },
  2: { // T2 Provisional
    networkAccess: NetworkAccessLevel.INTERNAL,
    filesystemAccess: FilesystemAccessLevel.WORKSPACE,
    maxMemoryMb: 512,
    maxCpuPercent: 50,
    maxExecutionMs: 120000,
    allowedEgressDomains: ['*.internal', 'localhost'],
    allowedMountPaths: ['/workspace'],
    canSpawnSubprocesses: false,
    canAccessSecrets: false,
    canCommunicateWithAgents: false,
  },
  3: { // T3 Monitored
    networkAccess: NetworkAccessLevel.INTERNAL,
    filesystemAccess: FilesystemAccessLevel.WORKSPACE,
    maxMemoryMb: 1024,
    maxCpuPercent: 50,
    maxExecutionMs: 300000,
    allowedEgressDomains: ['*.internal', 'localhost'],
    allowedMountPaths: ['/workspace', '/data'],
    canSpawnSubprocesses: false,
    canAccessSecrets: true,
    canCommunicateWithAgents: false,
  },
  4: { // T4 Standard
    networkAccess: NetworkAccessLevel.EXTERNAL,
    filesystemAccess: FilesystemAccessLevel.WORKSPACE,
    maxMemoryMb: 2048,
    maxCpuPercent: 75,
    maxExecutionMs: 600000,
    allowedEgressDomains: ['*'], // Policy-governed
    allowedMountPaths: ['/workspace', '/data', '/cache'],
    canSpawnSubprocesses: true,
    canAccessSecrets: true,
    canCommunicateWithAgents: false,
  },
  5: { // T5 Trusted
    networkAccess: NetworkAccessLevel.CROSS_AGENT,
    filesystemAccess: FilesystemAccessLevel.EXTENDED,
    maxMemoryMb: 4096,
    maxCpuPercent: 100,
    maxExecutionMs: 1800000,
    allowedEgressDomains: ['*'],
    allowedMountPaths: ['/workspace', '/data', '/cache', '/shared'],
    canSpawnSubprocesses: true,
    canAccessSecrets: true,
    canCommunicateWithAgents: true,
  },
  6: { // T6 Certified
    networkAccess: NetworkAccessLevel.CROSS_AGENT,
    filesystemAccess: FilesystemAccessLevel.EXTENDED,
    maxMemoryMb: 8192,
    maxCpuPercent: 100,
    maxExecutionMs: 3600000,
    allowedEgressDomains: ['*'],
    allowedMountPaths: ['/workspace', '/data', '/cache', '/shared', '/admin'],
    canSpawnSubprocesses: true,
    canAccessSecrets: true,
    canCommunicateWithAgents: true,
  },
  7: { // T7 Autonomous
    networkAccess: NetworkAccessLevel.FULL,
    filesystemAccess: FilesystemAccessLevel.FULL,
    maxMemoryMb: -1, // Unlimited
    maxCpuPercent: 100,
    maxExecutionMs: -1, // Unlimited
    allowedEgressDomains: ['*'],
    allowedMountPaths: ['*'],
    canSpawnSubprocesses: true,
    canAccessSecrets: true,
    canCommunicateWithAgents: true,
  },
};

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * Sandbox runtime type
 */
export enum SandboxRuntime {
  /** Docker container with seccomp */
  DOCKER = 'DOCKER',

  /** gVisor for stronger isolation */
  GVISOR = 'GVISOR',

  /** Firecracker microVM */
  FIRECRACKER = 'FIRECRACKER',

  /** WebAssembly runtime */
  WASM = 'WASM',

  /** No isolation (T7 only, monitored) */
  NONE = 'NONE',
}

/**
 * Sandbox configuration for an execution
 */
export interface SandboxConfig {
  /** Unique sandbox ID */
  sandboxId: string;

  /** Agent CAR ID */
  carId: string;

  /** Current trust tier */
  trustTier: number;

  /** Runtime type */
  runtime: SandboxRuntime;

  /** Capabilities based on tier */
  capabilities: TierCapabilities;

  /** Network policy */
  networkPolicy: NetworkPolicy;

  /** Filesystem policy */
  filesystemPolicy: FilesystemPolicy;

  /** Resource limits */
  resourceLimits: ResourceLimits;

  /** Execution context */
  context: ExecutionContext;
}

// ============================================================================
// Network Policy
// ============================================================================

/**
 * Network policy for a sandbox
 */
export interface NetworkPolicy {
  /** Access level */
  accessLevel: NetworkAccessLevel;

  /** Allowed egress domains/IPs */
  allowedEgress: EgressRule[];

  /** Blocked egress (deny list) */
  blockedEgress: string[];

  /** DNS policy */
  dnsPolicy: DnsPolicy;

  /** mTLS requirements */
  mtlsRequired: boolean;

  /** Rate limits */
  rateLimits: NetworkRateLimits;
}

/**
 * Egress rule for network access
 */
export interface EgressRule {
  /** Destination pattern (domain, IP, CIDR) */
  destination: string;

  /** Allowed ports */
  ports: number[];

  /** Protocol (tcp, udp, both) */
  protocol: 'tcp' | 'udp' | 'both';

  /** Description */
  description?: string;
}

/**
 * DNS policy for sandbox
 */
export interface DnsPolicy {
  /** DNS servers to use */
  servers: string[];

  /** Allowed domains to resolve */
  allowedDomains: string[];

  /** Use internal DNS only */
  internalOnly: boolean;
}

/**
 * Network rate limits
 */
export interface NetworkRateLimits {
  /** Max requests per minute */
  requestsPerMinute: number;

  /** Max bytes out per minute */
  egressBytesPerMinute: number;

  /** Max concurrent connections */
  maxConnections: number;
}

// ============================================================================
// Filesystem Policy
// ============================================================================

/**
 * Filesystem policy for a sandbox
 */
export interface FilesystemPolicy {
  /** Access level */
  accessLevel: FilesystemAccessLevel;

  /** Root directory for sandbox */
  sandboxRoot: string;

  /** Mounted volumes */
  mounts: MountConfig[];

  /** Overlay filesystem config */
  overlay: OverlayConfig;

  /** Secrets injection */
  secrets: SecretMount[];

  /** Disk quotas */
  quotas: DiskQuotas;
}

/**
 * Mount configuration
 */
export interface MountConfig {
  /** Host path (or volume name) */
  source: string;

  /** Container path */
  target: string;

  /** Read-only flag */
  readonly: boolean;

  /** Mount type */
  type: 'bind' | 'volume' | 'tmpfs';

  /** Additional options */
  options?: string[];
}

/**
 * Overlay filesystem configuration
 */
export interface OverlayConfig {
  /** Base image/layer */
  baseLayer: string;

  /** Ephemeral upper layer */
  ephemeral: boolean;

  /** Persist changes to work layer */
  persistWork: boolean;

  /** Work directory */
  workDir: string;
}

/**
 * Secret mount (memory-only)
 */
export interface SecretMount {
  /** Secret name */
  name: string;

  /** Environment variable name (if env) */
  envVar?: string;

  /** File path (if file) */
  filePath?: string;

  /** Mount type */
  type: 'env' | 'file' | 'memory';
}

/**
 * Disk quotas
 */
export interface DiskQuotas {
  /** Max disk usage in bytes */
  maxBytes: number;

  /** Max inodes */
  maxInodes: number;

  /** Warn threshold (0-1) */
  warnThreshold: number;
}

// ============================================================================
// Resource Limits
// ============================================================================

/**
 * Resource limits for a sandbox
 */
export interface ResourceLimits {
  /** Max memory in MB */
  memoryMb: number;

  /** Max CPU percentage (0-100) */
  cpuPercent: number;

  /** Max execution time in ms */
  executionMs: number;

  /** Max PIDs */
  maxPids: number;

  /** Max open files */
  maxOpenFiles: number;

  /** OOM kill enabled */
  oomKillEnabled: boolean;
}

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Execution context for sandbox
 */
export interface ExecutionContext {
  /** Tenant ID */
  tenantId: string;

  /** Request ID for tracing */
  requestId: string;

  /** User ID (if applicable) */
  userId?: string;

  /** Parent agent ACI (if delegated) */
  parentAci?: string;

  /** Environment variables */
  environment: Record<string, string>;

  /** Execution metadata */
  metadata: Record<string, unknown>;
}

// ============================================================================
// Sandbox Lifecycle
// ============================================================================

/**
 * Sandbox state
 */
export enum SandboxState {
  CREATING = 'CREATING',
  READY = 'READY',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
  DESTROYED = 'DESTROYED',
}

/**
 * Sandbox instance
 */
export interface SandboxInstance {
  /** Sandbox ID */
  id: string;

  /** Configuration */
  config: SandboxConfig;

  /** Current state */
  state: SandboxState;

  /** Container/VM ID */
  runtimeId?: string;

  /** IP address */
  ipAddress?: string;

  /** Port mappings */
  ports: Record<number, number>;

  /** Resource usage */
  resourceUsage: ResourceUsage;

  /** Created timestamp */
  createdAt: Date;

  /** Started timestamp */
  startedAt?: Date;

  /** Stopped timestamp */
  stoppedAt?: Date;

  /** Exit code */
  exitCode?: number;

  /** Error message */
  error?: string;
}

/**
 * Current resource usage
 */
export interface ResourceUsage {
  memoryBytes: number;
  cpuPercent: number;
  diskBytes: number;
  networkBytesIn: number;
  networkBytesOut: number;
  openFiles: number;
  processCount: number;
}

// ============================================================================
// Execution Results
// ============================================================================

/**
 * Sandbox execution result
 */
export interface SandboxExecutionResult {
  /** Sandbox ID */
  sandboxId: string;

  /** Success flag */
  success: boolean;

  /** Exit code */
  exitCode: number;

  /** Stdout output */
  stdout: string;

  /** Stderr output */
  stderr: string;

  /** Execution duration in ms */
  durationMs: number;

  /** Resource usage summary */
  resourceUsage: ResourceUsage;

  /** Network activity log */
  networkActivity: NetworkActivityLog[];

  /** Filesystem activity log */
  filesystemActivity: FilesystemActivityLog[];

  /** Violations detected */
  violations: PolicyViolation[];

  /** Attestation data for trust scoring */
  attestationData: SandboxAttestationData;
}

/**
 * Network activity log entry
 */
export interface NetworkActivityLog {
  timestamp: Date;
  direction: 'egress' | 'ingress';
  destination: string;
  port: number;
  protocol: string;
  bytes: number;
  allowed: boolean;
  blockedReason?: string;
}

/**
 * Filesystem activity log entry
 */
export interface FilesystemActivityLog {
  timestamp: Date;
  operation: 'read' | 'write' | 'delete' | 'create' | 'chmod';
  path: string;
  bytes?: number;
  allowed: boolean;
  blockedReason?: string;
}

/**
 * Policy violation
 */
export interface PolicyViolation {
  timestamp: Date;
  type: 'network' | 'filesystem' | 'resource' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details: Record<string, unknown>;
  action: 'logged' | 'blocked' | 'terminated';
}

/**
 * Attestation data from sandbox execution
 */
export interface SandboxAttestationData {
  executionSuccess: boolean;
  resourceCompliance: boolean;
  networkCompliance: boolean;
  filesystemCompliance: boolean;
  violationCount: number;
  violationSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
}
