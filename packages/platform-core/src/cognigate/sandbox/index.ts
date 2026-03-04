/**
 * Cognigate Sandbox Module
 *
 * Provides tier-based execution isolation for agents including:
 * - Sandbox lifecycle management
 * - Network policy enforcement
 * - Filesystem isolation
 * - Capability brokering
 *
 * @packageDocumentation
 */

// Types
export {
  // Enums
  NetworkAccessLevel,
  FilesystemAccessLevel,
  SandboxRuntime,
  SandboxState,

  // Tier capabilities
  type TierCapabilities,
  TIER_CAPABILITIES,

  // Configuration types
  type SandboxConfig,
  type NetworkPolicy,
  type FilesystemPolicy,
  type ResourceLimits,
  type ExecutionContext,

  // Policy details
  type EgressRule,
  type DnsPolicy,
  type NetworkRateLimits,
  type MountConfig,
  type OverlayConfig,
  type SecretMount,
  type DiskQuotas,

  // Runtime types
  type SandboxInstance,
  type ResourceUsage,
  type SandboxExecutionResult,

  // Activity logging
  type NetworkActivityLog,
  type FilesystemActivityLog,
  type PolicyViolation,
  type SandboxAttestationData,
} from './types.js';

// Sandbox Service
export {
  SandboxService,
  createSandboxService,
  getSandboxService,
} from './sandbox-service.js';

// Network Policy
export {
  NetworkPolicyEnforcer,
  createNetworkPolicyEnforcer,
  getNetworkPolicyEnforcer,
  type NetworkNamespaceConfig,
  type IptablesRule,
  type ConnectionEntry,
} from './network-policy.js';

// Filesystem Policy
export {
  FilesystemPolicyEnforcer,
  createFilesystemPolicyEnforcer,
  getFilesystemPolicyEnforcer,
  type OverlayMount,
  type AccessControlEntry,
  type MountState,
  type ActiveMount,
} from './filesystem-policy.js';

// Capability Broker
export {
  CapabilityBroker,
  createCapabilityBroker,
  getCapabilityBroker,
  type CapabilityRequest,
  type CapabilityType,
  type CapabilityDetails,
  type CapabilityDecision,
  type CapabilityConditions,
  type GrantedCapability,
} from './capability-broker.js';
