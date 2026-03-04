/**
 * Agent Collaboration System Types
 *
 * Type definitions for agent-to-agent collaboration, consensus,
 * proactive actions, and excellence cycles.
 */

import { z } from 'zod';

// ============================================================================
// Canonical Type Definitions (aligned with @vorion/contracts)
// ============================================================================

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'queued' | 'assigned' | 'active' | 'paused' | 'completed' | 'failed' | 'delegated' | 'cancelled';
export type TaskSource = 'system' | 'user' | 'agent' | 'collaboration' | 'proactive' | 'scheduled';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'critical'] as const;
export const TASK_STATUSES: readonly TaskStatus[] = ['queued', 'assigned', 'active', 'paused', 'completed', 'failed', 'delegated', 'cancelled'] as const;
export const TASK_SOURCES: readonly TaskSource[] = ['system', 'user', 'agent', 'collaboration', 'proactive', 'scheduled'] as const;
export const COLLABORATION_MODES: readonly ('DELEGATE' | 'CONSULT' | 'PARALLEL' | 'SEQUENTIAL' | 'CONSENSUS')[] = ['DELEGATE', 'CONSULT', 'PARALLEL', 'SEQUENTIAL', 'CONSENSUS'] as const;

export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const taskStatusSchema = z.enum(['queued', 'assigned', 'active', 'paused', 'completed', 'failed', 'delegated', 'cancelled']);
export const taskSourceSchema = z.enum(['system', 'user', 'agent', 'collaboration', 'proactive', 'scheduled']);
export const collaborationModeSchema = z.enum(['DELEGATE', 'CONSULT', 'PARALLEL', 'SEQUENTIAL', 'CONSENSUS']);

export interface AgentTask {
  id: string;
  agentId: string;
  taskType: string;
  title?: string;
  description: string;
  context: Record<string, unknown>;
  priority: TaskPriority;
  urgency?: 'low' | 'medium' | 'high' | 'critical'; // Legacy field for backwards compatibility
  status: TaskStatus;
  source: TaskSource;
  sourceId?: string;
  assignedBy?: string;
  delegatedTo?: string;
  scheduledFor?: Date | string;
  deadline?: Date | string;
  startedAt?: Date | string;
  completedAt?: Date | string;
  createdAt: Date | string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  result?: Record<string, unknown>; // Legacy field for backwards compatibility
  error?: string;
  metadata?: Record<string, unknown>;
}

export const agentTaskSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  taskType: z.string().min(1),
  title: z.string().optional(),
  description: z.string(),
  context: z.record(z.string(), z.unknown()),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  source: taskSourceSchema,
  sourceId: z.string().optional(),
  assignedBy: z.string().optional(),
  delegatedTo: z.string().optional(),
  scheduledFor: z.union([z.date(), z.string().datetime()]).optional(),
  deadline: z.union([z.date(), z.string().datetime()]).optional(),
  startedAt: z.union([z.date(), z.string().datetime()]).optional(),
  completedAt: z.union([z.date(), z.string().datetime()]).optional(),
  createdAt: z.union([z.date(), z.string().datetime()]),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Backwards compatibility aliases
export type CanonicalAgentTask = AgentTask;
export type CanonicalTaskStatus = TaskStatus;
export type CanonicalTaskSource = TaskSource;
export type CanonicalCollaborationMode = 'DELEGATE' | 'CONSULT' | 'PARALLEL' | 'SEQUENTIAL' | 'CONSENSUS';

// ============================================================================
// COLLABORATION TYPES
// ============================================================================

export type CollaborationMode =
  | 'DELEGATE'    // Hand off entirely
  | 'CONSULT'     // Ask for input, retain ownership
  | 'PARALLEL'    // Work simultaneously
  | 'SEQUENTIAL'  // Chain of agents
  | 'CONSENSUS';  // Multiple agents must agree

export type CollaborationStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Urgency = 'low' | 'medium' | 'high' | 'critical';

export interface AgentCollaboration {
  id: string;
  initiatorId: string;
  targetId?: string;
  participants: string[];
  mode: CollaborationMode;
  taskType: string;
  taskDescription?: string;
  context: Record<string, unknown>;
  urgency: Urgency;
  expectedOutcome?: string;
  status: CollaborationStatus;
  finalOutcome?: string;
  successRate?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  deadline?: Date;
}

export interface CollaborationOutcome {
  id: string;
  collaborationId: string;
  agentId: string;
  contribution: string;
  confidence: number;
  actionItems: ActionItem[];
  timeSpentMs?: number;
  tokensUsed?: number;
  submittedAt: Date;
}

export interface ActionItem {
  id: string;
  description: string;
  priority: Urgency;
  assignedTo?: string;
  status: 'pending' | 'in_progress' | 'completed';
  dueDate?: string;
}

// ============================================================================
// CONSENSUS TYPES
// ============================================================================

export type ConsensusStatus =
  | 'voting'
  | 'consensus_reached'
  | 'no_consensus'
  | 'expired'
  | 'cancelled';

export type VoteChoice = 'approve' | 'reject' | 'abstain';

export interface AgentConsensus {
  id: string;
  initiatorId: string;
  question: string;
  context: Record<string, unknown>;
  participants: string[];
  requiredAgreement: number;
  status: ConsensusStatus;
  finalDecision?: string;
  agreementRate?: number;
  createdAt: Date;
  deadline?: Date;
  resolvedAt?: Date;
}

export interface ConsensusVote {
  id: string;
  consensusId: string;
  agentId: string;
  vote: VoteChoice;
  reasoning?: string;
  confidence: number;
  votedAt: Date;
}

// ============================================================================
// PROACTIVE ACTION TYPES
// ============================================================================

export type ProactiveBehavior =
  | 'ANTICIPATE'
  | 'ANALYZE'
  | 'DELEGATE'
  | 'ESCALATE'
  | 'ITERATE'
  | 'COLLABORATE'
  | 'MONITOR'
  | 'SUGGEST';

export type ProactiveStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ProactiveAction {
  id: string;
  agentId: string;
  behavior: ProactiveBehavior;
  triggerEvent: string;
  analysis?: string;
  recommendation: string;
  actionSteps: ActionStep[];
  delegatedTo?: string;
  collaboratedWith: string[];
  priority: Urgency;
  confidence?: number;
  status: ProactiveStatus;
  outcome?: string;
  success?: boolean;
  createdAt: Date;
  executedAt?: Date;
  completedAt?: Date;
}

export interface ActionStep {
  order: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  result?: string;
}

// ============================================================================
// EXCELLENCE CYCLE TYPES
// ============================================================================

export type ExcellencePhase =
  | 'FIND'
  | 'FIX'
  | 'IMPLEMENT'
  | 'CHANGE'
  | 'ITERATE'
  | 'SUCCEED';

export type CycleStatus = 'active' | 'completed' | 'failed' | 'paused';

export interface ExcellenceCycle {
  id: string;
  agentId: string;
  phase: ExcellencePhase;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  itemsFound: number;
  issuesFixed: number;
  featuresImplemented: number;
  changesApplied: number;
  iterationsCompleted: number;
  successRate?: number;
  status: CycleStatus;
  startedAt: Date;
  completedAt?: Date;
  nextPhase?: ExcellencePhase;
}

// ============================================================================
// TASK QUEUE TYPES (canonical definitions at top of file)
// ============================================================================

// TaskSource, TaskStatus, AgentTask defined in canonical section above

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateCollaborationRequest {
  initiatorId: string;
  targetId?: string;
  participants?: string[];
  mode: CollaborationMode;
  taskType: string;
  taskDescription?: string;
  context?: Record<string, unknown>;
  urgency?: Urgency;
  expectedOutcome?: string;
  deadline?: Date;
}

export interface SubmitOutcomeRequest {
  collaborationId: string;
  agentId: string;
  contribution: string;
  confidence: number;
  actionItems?: ActionItem[];
  timeSpentMs?: number;
  tokensUsed?: number;
}

export interface CreateConsensusRequest {
  initiatorId: string;
  question: string;
  context?: Record<string, unknown>;
  participants: string[];
  requiredAgreement?: number;
  deadline?: Date;
}

export interface SubmitVoteRequest {
  consensusId: string;
  agentId: string;
  vote: VoteChoice;
  reasoning?: string;
  confidence: number;
}

export interface CreateProactiveActionRequest {
  agentId: string;
  behavior: ProactiveBehavior;
  triggerEvent: string;
  analysis?: string;
  recommendation: string;
  actionSteps?: ActionStep[];
  delegatedTo?: string;
  collaboratedWith?: string[];
  priority?: Urgency;
  confidence?: number;
}

export interface QueueTaskRequest {
  agentId: string;
  taskType: string;
  description: string;
  context?: Record<string, unknown>;
  priority?: number;
  urgency?: Urgency;
  scheduledFor?: Date;
  deadline?: Date;
  source?: TaskSource;
  sourceId?: string;
}

export interface StartCycleRequest {
  agentId: string;
  input?: Record<string, unknown>;
}

export interface AdvanceCycleRequest {
  cycleId: string;
  output?: Record<string, unknown>;
  metrics?: {
    itemsFound?: number;
    issuesFixed?: number;
    featuresImplemented?: number;
    changesApplied?: number;
    iterationsCompleted?: number;
  };
}
