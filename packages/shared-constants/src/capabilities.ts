/**
 * @vorionsys/shared-constants - Capability Definitions
 *
 * Single source of truth for capability codes and tier requirements
 * Used across all Vorion ecosystem products
 *
 * @see https://basis.vorion.org/capabilities
 */

import { TrustTier } from './tiers';

// =============================================================================
// CAPABILITY CATEGORIES
// =============================================================================

export enum CapabilityCategory {
  DATA_ACCESS = 'data_access',
  FILE_OPERATIONS = 'file_operations',
  API_ACCESS = 'api_access',
  CODE_EXECUTION = 'code_execution',
  AGENT_INTERACTION = 'agent_interaction',
  RESOURCE_MANAGEMENT = 'resource_management',
  SYSTEM_ADMINISTRATION = 'system_administration',
  GOVERNANCE = 'governance',
}

// =============================================================================
// CAPABILITY DEFINITION
// =============================================================================

export interface CapabilityDefinition {
  readonly code: string;
  readonly name: string;
  readonly category: CapabilityCategory;
  readonly description: string;
  readonly unlockTier: TrustTier;
  readonly constraints?: readonly string[];
}

// =============================================================================
// STANDARD CAPABILITIES
// =============================================================================

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  // T0 - Sandbox
  {
    code: 'CAP-READ-PUBLIC',
    name: 'Read Public Data',
    category: CapabilityCategory.DATA_ACCESS,
    description: 'Access publicly available data',
    unlockTier: TrustTier.T0_SANDBOX,
  },
  {
    code: 'CAP-GENERATE-TEXT',
    name: 'Generate Text',
    category: CapabilityCategory.CODE_EXECUTION,
    description: 'Generate text responses',
    unlockTier: TrustTier.T0_SANDBOX,
  },

  // T1 - Observed
  {
    code: 'CAP-READ-INTERNAL',
    name: 'Read Internal Data',
    category: CapabilityCategory.DATA_ACCESS,
    description: 'Access internal data within allowed scopes',
    unlockTier: TrustTier.T1_OBSERVED,
    constraints: ['Read-only', 'Logged'],
  },
  {
    code: 'CAP-INTERNAL-API',
    name: 'Internal API Access',
    category: CapabilityCategory.API_ACCESS,
    description: 'Make read-only internal API calls',
    unlockTier: TrustTier.T1_OBSERVED,
    constraints: ['GET only', 'Rate limited'],
  },

  // T2 - Provisional
  {
    code: 'CAP-FILE-WRITE',
    name: 'Write Files',
    category: CapabilityCategory.FILE_OPERATIONS,
    description: 'Write to approved directories',
    unlockTier: TrustTier.T2_PROVISIONAL,
    constraints: ['Approved dirs only', 'Size limited'],
  },
  {
    code: 'CAP-DB-READ',
    name: 'Database Read',
    category: CapabilityCategory.DATA_ACCESS,
    description: 'Read from approved database tables',
    unlockTier: TrustTier.T2_PROVISIONAL,
    constraints: ['Approved tables', 'Query timeout'],
  },
  {
    code: 'CAP-EXTERNAL-API-READ',
    name: 'External API Read',
    category: CapabilityCategory.API_ACCESS,
    description: 'Make GET requests to approved external APIs',
    unlockTier: TrustTier.T2_PROVISIONAL,
    constraints: ['GET only', 'Approved endpoints'],
  },

  // T3 - Monitored
  {
    code: 'CAP-DB-WRITE',
    name: 'Database Write',
    category: CapabilityCategory.DATA_ACCESS,
    description: 'Write to approved database tables',
    unlockTier: TrustTier.T3_MONITORED,
    constraints: ['Approved tables', 'Transaction limits'],
  },
  {
    code: 'CAP-EXTERNAL-API-FULL',
    name: 'External API Full Access',
    category: CapabilityCategory.API_ACCESS,
    description: 'Full REST operations on approved external APIs',
    unlockTier: TrustTier.T3_MONITORED,
    constraints: ['Approved endpoints', 'Rate limited'],
  },
  {
    code: 'CAP-CODE-SANDBOX',
    name: 'Sandboxed Code Execution',
    category: CapabilityCategory.CODE_EXECUTION,
    description: 'Execute code in isolated sandbox',
    unlockTier: TrustTier.T3_MONITORED,
    constraints: ['Sandboxed', 'Time limited', 'No network'],
  },

  // T4 - Standard
  {
    code: 'CAP-AGENT-COMMUNICATE',
    name: 'Agent Communication',
    category: CapabilityCategory.AGENT_INTERACTION,
    description: 'Send and receive messages to/from other agents',
    unlockTier: TrustTier.T4_STANDARD,
    constraints: ['Approved agents', 'Message limits'],
  },
  {
    code: 'CAP-WORKFLOW-MULTI',
    name: 'Multi-Step Workflow',
    category: CapabilityCategory.CODE_EXECUTION,
    description: 'Orchestrate multi-step workflows',
    unlockTier: TrustTier.T4_STANDARD,
    constraints: ['Approved patterns', 'Checkpoints required'],
  },
  {
    code: 'CAP-ESCALATE-HUMAN',
    name: 'Human Escalation',
    category: CapabilityCategory.GOVERNANCE,
    description: 'Initiate escalation to human reviewers',
    unlockTier: TrustTier.T4_STANDARD,
  },

  // T5 - Trusted
  {
    code: 'CAP-AGENT-DELEGATE',
    name: 'Task Delegation',
    category: CapabilityCategory.AGENT_INTERACTION,
    description: 'Delegate tasks to other agents',
    unlockTier: TrustTier.T5_TRUSTED,
    constraints: ['Trust verified agents'],
  },
  {
    code: 'CAP-RESOURCE-PROVISION',
    name: 'Resource Provisioning',
    category: CapabilityCategory.RESOURCE_MANAGEMENT,
    description: 'Provision computational resources',
    unlockTier: TrustTier.T5_TRUSTED,
    constraints: ['Budget limits', 'Approval required'],
  },

  // T6 - Certified
  {
    code: 'CAP-AGENT-SPAWN',
    name: 'Spawn Agents',
    category: CapabilityCategory.AGENT_INTERACTION,
    description: 'Create new agent instances',
    unlockTier: TrustTier.T6_CERTIFIED,
    constraints: ['Template required', 'Quota limited'],
  },
  {
    code: 'CAP-INFRA-MANAGE',
    name: 'Infrastructure Management',
    category: CapabilityCategory.RESOURCE_MANAGEMENT,
    description: 'Manage infrastructure resources',
    unlockTier: TrustTier.T6_CERTIFIED,
    constraints: ['Approved resources'],
  },
  {
    code: 'CAP-POLICY-CREATE',
    name: 'Policy Creation',
    category: CapabilityCategory.GOVERNANCE,
    description: 'Create governance policies',
    unlockTier: TrustTier.T6_CERTIFIED,
    constraints: ['Review required'],
  },

  // T7 - Autonomous
  {
    code: 'CAP-FULL-ADMIN',
    name: 'Full Administration',
    category: CapabilityCategory.SYSTEM_ADMINISTRATION,
    description: 'Full administrative access',
    unlockTier: TrustTier.T7_AUTONOMOUS,
  },
  {
    code: 'CAP-SELF-MODIFY',
    name: 'Self-Modification',
    category: CapabilityCategory.CODE_EXECUTION,
    description: 'Modify own configuration and behavior',
    unlockTier: TrustTier.T7_AUTONOMOUS,
    constraints: ['Ethical bounds', 'Audit logged'],
  },
  {
    code: 'CAP-STRATEGIC-DECISION',
    name: 'Strategic Decisions',
    category: CapabilityCategory.GOVERNANCE,
    description: 'Make strategic organizational decisions',
    unlockTier: TrustTier.T7_AUTONOMOUS,
    constraints: ['Human oversight available'],
  },
] as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get capabilities available at a specific tier
 */
export function getCapabilitiesForTier(tier: TrustTier): CapabilityDefinition[] {
  return CAPABILITIES.filter((cap) => cap.unlockTier <= tier);
}

/**
 * Get capability by code
 */
export function getCapability(code: string): CapabilityDefinition | undefined {
  return CAPABILITIES.find((cap) => cap.code === code);
}

/**
 * Check if a capability is available at a tier
 */
export function isCapabilityAvailable(code: string, tier: TrustTier): boolean {
  const cap = getCapability(code);
  return cap !== undefined && cap.unlockTier <= tier;
}

/**
 * Get minimum tier required for a capability
 */
export function getCapabilityMinTier(code: string): TrustTier | undefined {
  return getCapability(code)?.unlockTier;
}

/**
 * Get capabilities by category
 */
export function getCapabilitiesByCategory(
  category: CapabilityCategory
): CapabilityDefinition[] {
  return CAPABILITIES.filter((cap) => cap.category === category);
}

/**
 * Get all capability codes
 */
export function getAllCapabilityCodes(): string[] {
  return CAPABILITIES.map((cap) => cap.code);
}
