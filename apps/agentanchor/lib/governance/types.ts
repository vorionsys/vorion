/**
 * Governance SDK Types
 */

// =============================================================================
// Trust System - Canonical Types (aligned with @vorion/contracts)
// =============================================================================

/**
 * Canonical TrustBand aligned with @vorion/contracts
 * Uses 8-band T0-T7 system based on 0-1000 score scale
 */
export type TrustBand =
  | 'T0_SANDBOX'        // 0-199: Isolated, observation only
  | 'T1_OBSERVED'       // 200-349: Read-only, sandboxed
  | 'T2_PROVISIONAL'    // 350-499: Basic operations, heavy supervision
  | 'T3_MONITORED'      // 500-649: Standard operations with monitoring
  | 'T4_STANDARD'       // 650-799: External API access, policy-governed
  | 'T5_TRUSTED'        // 800-875: Cross-agent communication
  | 'T6_CERTIFIED'      // 876-950: Admin tasks, minimal oversight
  | 'T7_AUTONOMOUS';    // 951-1000: Full autonomy

/**
 * @deprecated Use TrustBand instead. Legacy tier names for backwards compatibility.
 */
export type TrustTier =
  | 'untrusted'    // 0-199 (legacy 0-1000 scale)
  | 'provisional'  // 200-399
  | 'established'  // 400-599
  | 'trusted'      // 600-799
  | 'verified'     // 800-899
  | 'certified';   // 900-1000

export interface TrustContext {
  /** Current trust score (canonical 0-1000 scale) */
  score: number;
  /** Canonical trust band */
  band: TrustBand;
  /** @deprecated Use band instead */
  tier: TrustTier;
  lastActivity: Date;
  decayApplied: boolean;
  /** Score after decay calculation (canonical 0-1000 scale) */
  effectiveScore: number;
}

/**
 * Canonical trust band thresholds aligned with @vorion/contracts
 * Uses 0-1000 scale per ATSF v2.0
 */
export const TRUST_BAND_THRESHOLDS: Record<TrustBand, { min: number; max: number }> = {
  T0_SANDBOX: { min: 0, max: 199 },
  T1_OBSERVED: { min: 200, max: 349 },
  T2_PROVISIONAL: { min: 350, max: 499 },
  T3_MONITORED: { min: 500, max: 649 },
  T4_STANDARD: { min: 650, max: 799 },
  T5_TRUSTED: { min: 800, max: 875 },
  T6_CERTIFIED: { min: 876, max: 950 },
  T7_AUTONOMOUS: { min: 951, max: 1000 },
};

/**
 * @deprecated Use TRUST_BAND_THRESHOLDS instead. Legacy tier thresholds (0-1000 scale).
 */
export const TRUST_TIER_THRESHOLDS: Record<TrustTier, { min: number; max: number }> = {
  untrusted: { min: 0, max: 199 },
  provisional: { min: 200, max: 399 },
  established: { min: 400, max: 599 },
  trusted: { min: 600, max: 799 },
  verified: { min: 800, max: 899 },
  certified: { min: 900, max: 1000 },
};

/**
 * Maps legacy TrustTier to canonical TrustBand
 */
export const LEGACY_GOVERNANCE_TIER_TO_BAND: Record<TrustTier, TrustBand> = {
  untrusted: 'T0_SANDBOX',
  provisional: 'T1_OBSERVED',
  established: 'T2_PROVISIONAL',
  trusted: 'T3_MONITORED',
  verified: 'T5_TRUSTED',
  certified: 'T7_AUTONOMOUS',
};

// =============================================================================
// Risk Assessment - Canonical Types (aligned with @vorion/contracts)
// =============================================================================

/**
 * Canonical RiskLevel - string union type
 * Aligned with @vorion/contracts governance patterns
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  level: RiskLevel;
  factors: string[];
  requiresApproval: boolean;
  escalateTo: 'council' | 'human' | null;
}

/**
 * Canonical risk autonomy requirements using 0-1000 score scale
 * Aligned with TRUST_BAND_THRESHOLDS
 */
export const RISK_AUTONOMY_REQUIREMENTS: Record<RiskLevel, number> = {
  low: 0,        // Any trust level (T0+)
  medium: 350,   // T2_PROVISIONAL+
  high: 500,     // T3_MONITORED+
  critical: 876, // T6_CERTIFIED+ (with human oversight)
};

/**
 * @deprecated Use RISK_AUTONOMY_REQUIREMENTS instead. Legacy thresholds (0-1000 scale).
 */
export const LEGACY_RISK_AUTONOMY_REQUIREMENTS: Record<RiskLevel, number> = {
  low: 0,
  medium: 400,
  high: 600,
  critical: 900,
};

/**
 * Maps canonical TrustBand to maximum allowed RiskLevel
 */
export const BAND_TO_MAX_RISK: Record<TrustBand, RiskLevel> = {
  T0_SANDBOX: 'low',
  T1_OBSERVED: 'low',
  T2_PROVISIONAL: 'medium',
  T3_MONITORED: 'medium',
  T4_STANDARD: 'high',
  T5_TRUSTED: 'high',
  T6_CERTIFIED: 'critical',
  T7_AUTONOMOUS: 'critical',
};

// =============================================================================
// Persona System
// =============================================================================

export type PersonalityTrait =
  | 'professional'
  | 'friendly'
  | 'formal'
  | 'casual'
  | 'empathetic'
  | 'direct'
  | 'patient'
  | 'enthusiastic'
  | 'analytical'
  | 'creative';

export type Specialization =
  | 'core'
  | 'customer_service'
  | 'technical'
  | 'creative'
  | 'research'
  | 'education';

export interface PersonaConfig {
  name: string;
  description: string;
  specialization: Specialization;
  personalityTraits: PersonalityTrait[];
  systemPromptBase: string;
  toneGuidelines: string[];
  restrictions: string[];
}

// =============================================================================
// Capabilities / Skills
// =============================================================================

export type CapabilityId =
  | 'text_generation'
  | 'code_assistance'
  | 'data_analysis'
  | 'customer_support'
  | 'content_writing'
  | 'translation'
  | 'summarization'
  | 'question_answering'
  | 'creative_writing'
  | 'technical_documentation'
  | 'web_search'
  | 'file_operations'
  | 'api_integration';

export interface Capability {
  id: CapabilityId;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  /** Required canonical trust band */
  requiredTrustBand: TrustBand;
  /** @deprecated Use requiredTrustBand instead */
  requiredTrustTier?: TrustTier;
  toolDefinition?: ToolDefinition;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SkillExecution {
  capabilityId: CapabilityId;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
  executionTime: number;
}

// =============================================================================
// MCP (Model Context Protocol)
// =============================================================================

export type MCPServerType =
  | 'filesystem'
  | 'github'
  | 'database'
  | 'websearch'
  | 'custom';

export interface MCPServerConfig {
  id: string;
  name: string;
  type: MCPServerType;
  endpoint?: string;
  config: Record<string, unknown>;
  permissions: MCPPermissions;
  enabled: boolean;
}

export interface MCPPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  rateLimit?: number; // requests per minute
}

export interface MCPInvocation {
  serverId: string;
  method: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration: number;
}

// =============================================================================
// Roles & Permissions
// =============================================================================

// UserRole includes admin for internal governance checks
// Database may use 'trainer' | 'consumer' | 'both' but SDK supports admin
export type UserRole = 'trainer' | 'consumer' | 'both' | 'admin';

export type AgentStatus =
  | 'draft'
  | 'training'
  | 'examination'
  | 'active'
  | 'suspended'
  | 'retired';

export interface Permission {
  action: string;
  resource: string;
  conditions?: Record<string, unknown>;
}

export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
}

export const ROLE_PERMISSIONS: RolePermissions[] = [
  {
    role: 'consumer',
    permissions: [
      { action: 'read', resource: 'agents' },
      { action: 'use', resource: 'agents', conditions: { status: 'active' } },
      { action: 'read', resource: 'marketplace' },
      { action: 'acquire', resource: 'agents' },
    ],
  },
  {
    role: 'trainer',
    permissions: [
      { action: 'create', resource: 'agents' },
      { action: 'update', resource: 'agents', conditions: { owned: true } },
      { action: 'delete', resource: 'agents', conditions: { owned: true } },
      { action: 'train', resource: 'agents', conditions: { owned: true } },
      { action: 'publish', resource: 'agents', conditions: { owned: true, status: 'active' } },
      { action: 'read', resource: 'academy' },
      { action: 'enroll', resource: 'academy' },
    ],
  },
  {
    role: 'both',
    permissions: [
      // All consumer permissions
      { action: 'read', resource: 'agents' },
      { action: 'use', resource: 'agents', conditions: { status: 'active' } },
      { action: 'read', resource: 'marketplace' },
      { action: 'acquire', resource: 'agents' },
      // All trainer permissions
      { action: 'create', resource: 'agents' },
      { action: 'update', resource: 'agents', conditions: { owned: true } },
      { action: 'delete', resource: 'agents', conditions: { owned: true } },
      { action: 'train', resource: 'agents', conditions: { owned: true } },
      { action: 'publish', resource: 'agents', conditions: { owned: true, status: 'active' } },
      { action: 'read', resource: 'academy' },
      { action: 'enroll', resource: 'academy' },
    ],
  },
  {
    role: 'admin',
    permissions: [
      { action: '*', resource: '*' }, // Full access
    ],
  },
];

// =============================================================================
// Governance Decision
// =============================================================================

export interface GovernanceDecision {
  allowed: boolean;
  requiresApproval: boolean;
  escalateTo: 'council' | 'human' | null;
  reason: string;
  trustImpact: number; // Positive or negative trust score change
  auditRequired: boolean;
}

// =============================================================================
// Agent Runtime Context
// =============================================================================

export interface AgentRuntimeContext {
  agentId: string;
  userId: string;

  // Trust
  trust: TrustContext;

  // Persona
  persona: PersonaConfig;

  // Capabilities
  capabilities: Capability[];
  activeTools: ToolDefinition[];

  // MCP
  mcpServers: MCPServerConfig[];

  // Role
  userRole: UserRole;
  agentStatus: AgentStatus;

  // Environment
  environment: Record<string, string>;

  // Session
  sessionId: string;
  conversationId: string;
  messageCount: number;
}

// =============================================================================
// Audit Event
// =============================================================================

export type AuditEventType =
  | 'action_requested'
  | 'action_approved'
  | 'action_denied'
  | 'action_executed'
  | 'escalation_triggered'
  | 'trust_updated'
  | 'mcp_invoked'
  | 'skill_executed'
  | 'error_occurred';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  agentId: string;
  userId: string;
  sessionId: string;
  action: string;
  details: Record<string, unknown>;
  riskLevel: RiskLevel;
  decision: GovernanceDecision;
  merkleHash?: string; // For Truth Chain anchoring
}
