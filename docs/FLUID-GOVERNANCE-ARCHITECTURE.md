# Fluid Governance Architecture

**Version:** 1.0.0
**Date:** January 31, 2026
**Status:** Architectural Proposal
**Scope:** Vorion Platform System-Wide Improvements

---

## Executive Summary

The current Vorion governance model excels at security but can feel rigid. This document proposes architectural changes to enable **fluid adaptability** while maintaining the "wrapped agent" security model.

**Core Principle:** Security constraints should feel like guardrails, not prison walls.

---

## The Tension: Security vs. Fluidity

### Current Model: Strict Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    CURRENT MODEL                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  INTENT ────► ENFORCE ────► PROOF ────► CHAIN          │
│     │            │            │                         │
│     │         BLOCK          LOG                        │
│     │         or ALLOW       (immutable)               │
│     │            │                                      │
│     └────────────┴──────────────────────────────────┐  │
│                                                      │  │
│     If blocked: FULL RESET, re-submit intent        │  │
│     No iteration, no refinement, no learning        │  │
│                                                      │  │
└─────────────────────────────────────────────────────────┘
```

**Pain Points:**
- Minor policy violations require complete restart
- Agents can't learn from near-misses
- Developers experience "compliance fatigue"
- Innovation is throttled by bureaucratic friction

### Proposed Model: Fluid Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    FLUID MODEL                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  INTENT ◄───► ENFORCE ◄───► PROOF ────► CHAIN          │
│     │            │            │                         │
│     │    ┌───────┴───────┐   │                         │
│     │    │   Decision    │   │                         │
│     │    │   Engine      │   │                         │
│     │    └───────┬───────┘   │                         │
│     │            │           │                         │
│     ▼            ▼           ▼                         │
│  ┌─────┐    ┌─────────┐  ┌──────┐                      │
│  │ALLOW│    │ REFINE  │  │BLOCK │                      │
│  │     │    │(iterate)│  │(hard)│                      │
│  └─────┘    └─────────┘  └──────┘                      │
│                 │                                       │
│                 ▼                                       │
│         Agent adjusts intent                           │
│         without full reset                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Key Insight:** Most governance decisions aren't binary ALLOW/BLOCK—they're "almost okay, but..."

---

## Part 1: The Three-Tier Decision Model

### Replace Binary Decisions with Graduated Responses

```typescript
// packages/a3i/src/enforce/decision-engine.ts

export enum DecisionOutcome {
  // GREEN - Proceed normally
  ALLOW = 'ALLOW',

  // YELLOW - Proceed with modifications
  REFINE = 'REFINE',           // Suggest intent modification
  CONSTRAIN = 'CONSTRAIN',     // Allow with reduced scope
  DEFER = 'DEFER',             // Queue for better timing
  SHADOW = 'SHADOW',           // Execute in shadow mode

  // RED - Hard stop
  BLOCK = 'BLOCK',             // Policy violation
  ESCALATE = 'ESCALATE',       // Requires HITL
  HALT = 'HALT',               // Critical boundary crossed
}

export interface FluidDecision {
  outcome: DecisionOutcome;
  confidence: number;         // 0-1, how certain is this decision?

  // For REFINE outcomes
  refinements?: IntentRefinement[];

  // For CONSTRAIN outcomes
  constraints?: Constraint[];

  // For any non-ALLOW outcome
  reasoning: string;
  suggestedActions: string[];

  // Metadata
  evaluatedAt: Date;
  policyVersion: string;
  canRetry: boolean;
  retryAfterMs?: number;
}

export interface IntentRefinement {
  field: string;              // Which part of intent to modify
  currentValue: any;
  suggestedValue: any;
  reason: string;
  impact: 'minor' | 'moderate' | 'significant';
}
```

### Decision Flow Implementation

```typescript
export class FluidEnforcementEngine {
  /**
   * Evaluate intent with fluid decision-making.
   * Returns graduated response instead of binary allow/block.
   */
  async evaluate(intent: Intent, context: EvaluationContext): Promise<FluidDecision> {
    // 1. Check hard boundaries first (always binary)
    const hardCheck = await this.checkHardBoundaries(intent, context);
    if (hardCheck.violated) {
      return {
        outcome: hardCheck.critical ? DecisionOutcome.HALT : DecisionOutcome.BLOCK,
        confidence: 1.0,
        reasoning: hardCheck.reason,
        suggestedActions: [],
        canRetry: false,
      };
    }

    // 2. Evaluate soft policies (can be refined)
    const softCheck = await this.evaluateSoftPolicies(intent, context);

    if (softCheck.passed) {
      return {
        outcome: DecisionOutcome.ALLOW,
        confidence: softCheck.confidence,
        reasoning: 'All policies satisfied',
        suggestedActions: [],
        canRetry: true,
      };
    }

    // 3. Attempt to find refinements that would pass
    const refinements = await this.findRefinements(intent, softCheck.violations);

    if (refinements.length > 0) {
      return {
        outcome: DecisionOutcome.REFINE,
        confidence: softCheck.confidence,
        refinements,
        reasoning: 'Intent can succeed with modifications',
        suggestedActions: refinements.map(r => r.reason),
        canRetry: true,
      };
    }

    // 4. Check if constraints could help
    const constraints = await this.findConstraints(intent, softCheck.violations);

    if (constraints.length > 0) {
      return {
        outcome: DecisionOutcome.CONSTRAIN,
        confidence: softCheck.confidence,
        constraints,
        reasoning: 'Intent can proceed with reduced scope',
        suggestedActions: constraints.map(c => c.description),
        canRetry: true,
      };
    }

    // 5. No path forward - block or escalate
    return {
      outcome: context.trustLevel >= TrustLevel.T4
        ? DecisionOutcome.ESCALATE  // High-trust agents get HITL review
        : DecisionOutcome.BLOCK,     // Low-trust agents are blocked
      confidence: softCheck.confidence,
      reasoning: softCheck.violations.map(v => v.message).join('; '),
      suggestedActions: ['Request HITL review', 'Modify intent significantly'],
      canRetry: true,
    };
  }

  /**
   * Hard boundaries that NEVER allow refinement.
   */
  private async checkHardBoundaries(
    intent: Intent,
    context: EvaluationContext
  ): Promise<HardBoundaryCheck> {
    const HARD_BOUNDARIES = [
      // Security boundaries
      { check: () => this.isPrivilegeEscalation(intent), reason: 'Privilege escalation attempt' },
      { check: () => this.crossesTenantBoundary(intent, context), reason: 'Cross-tenant access' },
      { check: () => this.isSystemCompromise(intent), reason: 'System integrity threat' },

      // Trust boundaries
      { check: () => this.exceedsTrustCapabilities(intent, context), reason: 'Exceeds trust capabilities' },
      { check: () => this.violatesKillSwitch(intent, context), reason: 'Kill switch active' },

      // Compliance boundaries
      { check: () => this.violatesRegulation(intent, context), reason: 'Regulatory violation' },
    ];

    for (const boundary of HARD_BOUNDARIES) {
      if (await boundary.check()) {
        return {
          violated: true,
          critical: true,
          reason: boundary.reason,
        };
      }
    }

    return { violated: false, critical: false, reason: '' };
  }
}
```

---

## Part 2: Brownfield-First Onboarding

### The Problem

Current onboarding requires:
1. Define all agents upfront
2. Configure all policies
3. Establish baselines from scratch
4. Wait for trust to build (days/weeks)

### The Solution: Discover → Infer → Validate

```typescript
// packages/a3i/src/onboarding/brownfield-onboarding.ts

export interface BrownfieldOnboardingConfig {
  /** Path to existing project/system */
  projectPath: string;

  /** Duration to observe before inferring baselines */
  observationPeriodHours: number;

  /** Minimum interactions before establishing baseline */
  minInteractions: number;

  /** Auto-approve inferred policies below this risk level */
  autoApproveRiskThreshold: number;

  /** Require HITL for agents with these capabilities */
  requireHitlFor: string[];
}

export class BrownfieldOnboardingService {
  /**
   * Initialize governance for an existing system.
   *
   * Phase 1: Discover - Find existing agents, endpoints, patterns
   * Phase 2: Observe - Passively monitor without blocking
   * Phase 3: Infer - Generate suggested policies from observations
   * Phase 4: Validate - HITL review of suggested policies
   * Phase 5: Activate - Enable enforcement gradually
   */
  async onboard(config: BrownfieldOnboardingConfig): Promise<OnboardingResult> {
    const result: OnboardingResult = {
      phases: [],
      discoveredAgents: [],
      inferredPolicies: [],
      suggestedTiers: [],
    };

    // Phase 1: Discovery (minutes)
    this.emitProgress('discovery', 'Scanning for existing agents and patterns...');
    const discovery = await this.discoverExistingSystem(config.projectPath);
    result.phases.push({ name: 'discovery', duration: discovery.duration, success: true });

    // Phase 2: Observation (configurable, default 24h)
    this.emitProgress('observation', `Observing for ${config.observationPeriodHours}h...`);
    const observations = await this.observeSystem(
      discovery.agents,
      config.observationPeriodHours
    );
    result.phases.push({ name: 'observation', duration: observations.duration, success: true });

    // Phase 3: Inference (automatic)
    this.emitProgress('inference', 'Inferring policies from observations...');
    const inferences = await this.inferPolicies(observations);
    result.inferredPolicies = inferences.policies;
    result.suggestedTiers = inferences.tiers;

    // Phase 4: Validation (HITL required)
    this.emitProgress('validation', 'Awaiting HITL validation...');
    const validatedPolicies = await this.validateWithHitl(inferences);

    // Phase 5: Gradual Activation
    this.emitProgress('activation', 'Activating governance gradually...');
    await this.activateGradually(validatedPolicies);

    return result;
  }

  /**
   * Discover existing agents from various sources.
   */
  private async discoverExistingSystem(projectPath: string): Promise<SystemDiscovery> {
    const sources = [
      // Code analysis
      () => this.discoverFromCode(projectPath),
      // API logs
      () => this.discoverFromLogs(projectPath),
      // Database
      () => this.discoverFromDatabase(projectPath),
      // Configuration files
      () => this.discoverFromConfig(projectPath),
      // Environment variables
      () => this.discoverFromEnv(projectPath),
    ];

    const results = await Promise.all(sources.map(s => s()));

    return this.mergeDiscoveries(results);
  }

  /**
   * Infer policies from observed behavior.
   */
  private async inferPolicies(observations: SystemObservations): Promise<PolicyInferences> {
    const policies: InferredPolicy[] = [];
    const tiers: SuggestedTier[] = [];

    for (const agent of observations.agents) {
      // Infer capabilities from observed actions
      const capabilities = this.inferCapabilities(agent.observedActions);

      // Infer resource access patterns
      const resources = this.inferResourcePatterns(agent.observedAccess);

      // Infer timing patterns
      const timing = this.inferTimingPatterns(agent.observedTimestamps);

      // Generate policy
      policies.push({
        agentId: agent.id,
        inferred: {
          capabilities,
          resources,
          timing,
          rateLimit: this.inferRateLimit(agent.requestCounts),
        },
        confidence: this.calculateConfidence(agent.totalObservations),
        requiresHitl: capabilities.some(c => this.isHighRisk(c)),
      });

      // Suggest trust tier based on behavior
      tiers.push({
        agentId: agent.id,
        suggestedTier: this.suggestTier(agent),
        reasoning: this.explainTierSuggestion(agent),
        confidence: this.calculateTierConfidence(agent),
      });
    }

    return { policies, tiers };
  }

  /**
   * Activate governance gradually to avoid disruption.
   */
  private async activateGradually(policies: ValidatedPolicy[]): Promise<void> {
    // Week 1: Shadow mode only (log, don't block)
    await this.activatePhase('shadow', policies, {
      mode: 'shadow',
      duration: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Week 2: Warn mode (log + notify, don't block)
    await this.activatePhase('warn', policies, {
      mode: 'warn',
      duration: 7 * 24 * 60 * 60 * 1000,
    });

    // Week 3: Soft enforce (block non-critical, escalate critical)
    await this.activatePhase('soft', policies, {
      mode: 'soft_enforce',
      duration: 7 * 24 * 60 * 60 * 1000,
    });

    // Week 4+: Full enforcement
    await this.activatePhase('full', policies, {
      mode: 'enforce',
      duration: null, // permanent
    });
  }
}
```

---

## Part 3: Token-Efficient Context Hygiene

### The Problem

Current evaluation loads full context:
- Complete policy set
- Full agent history
- All related intents
- Entire audit trail

This causes:
- High token costs
- Slow evaluation
- Context overflow in complex scenarios

### The Solution: Delta-Based Evaluation

```typescript
// packages/a3i/src/context/delta-context.ts

export interface ContextDelta {
  /** Reference to base state */
  baseCheckpoint: string;

  /** Changes since checkpoint */
  policyChanges: PolicyDelta[];
  trustChanges: TrustDelta[];
  intentHistory: IntentDelta[];

  /** Compressed context for evaluation */
  compressedContext: CompressedContext;
}

export class DeltaContextManager {
  /**
   * Get minimal context needed for evaluation.
   * Instead of loading everything, load only:
   * 1. Current state snapshot
   * 2. Deltas since last relevant checkpoint
   * 3. Directly related context
   */
  async getEvaluationContext(
    intent: Intent,
    agentId: string
  ): Promise<EvaluationContext> {
    // Get or create checkpoint
    const checkpoint = await this.getLatestCheckpoint(agentId);

    // Load only what changed
    const deltas = await this.getDeltasSince(agentId, checkpoint.timestamp);

    // Get directly related context (not everything)
    const related = await this.getRelatedContext(intent, {
      maxPolicies: 10,      // Only policies that might apply
      maxHistory: 5,        // Only recent relevant intents
      maxAudit: 20,         // Only recent audit entries
    });

    // Compress into evaluation-ready format
    return {
      checkpoint,
      deltas,
      related,
      tokenEstimate: this.estimateTokens(checkpoint, deltas, related),
    };
  }

  /**
   * Create periodic checkpoints to limit delta accumulation.
   */
  async createCheckpoint(agentId: string): Promise<Checkpoint> {
    const currentState = await this.getCurrentState(agentId);

    const checkpoint: Checkpoint = {
      id: uuid(),
      agentId,
      timestamp: new Date(),
      trustScore: currentState.trustScore,
      trustTier: currentState.trustTier,
      activePolicies: currentState.policies.map(p => p.id),
      behavioralBaseline: await this.snapshotBaseline(agentId),
    };

    await this.storeCheckpoint(checkpoint);

    // Prune old deltas
    await this.pruneOldDeltas(agentId, checkpoint.timestamp);

    return checkpoint;
  }

  /**
   * Determine what context is actually needed for this intent.
   */
  private async getRelatedContext(
    intent: Intent,
    limits: ContextLimits
  ): Promise<RelatedContext> {
    // Find policies that could apply to this action type
    const relevantPolicies = await this.findRelevantPolicies(
      intent.actionType,
      intent.resourceScope,
      limits.maxPolicies
    );

    // Find similar recent intents (for precedent)
    const similarIntents = await this.findSimilarIntents(
      intent,
      limits.maxHistory
    );

    // Get audit entries for this correlation chain only
    const relatedAudit = await this.getCorrelationAudit(
      intent.correlationId,
      limits.maxAudit
    );

    return {
      policies: relevantPolicies,
      precedents: similarIntents,
      auditContext: relatedAudit,
    };
  }
}
```

### RAG Integration for Policy Retrieval

```typescript
// packages/a3i/src/context/policy-rag.ts

export class PolicyRAG {
  /**
   * Retrieve only policies relevant to the current intent.
   * Uses semantic search instead of loading all policies.
   */
  async retrieveRelevantPolicies(
    intent: Intent,
    options: RetrievalOptions = {}
  ): Promise<RelevantPolicy[]> {
    const { maxPolicies = 10, minRelevance = 0.7 } = options;

    // Create embedding for intent
    const intentEmbedding = await this.embedIntent(intent);

    // Search policy embeddings
    const matches = await this.vectorStore.search(intentEmbedding, {
      limit: maxPolicies * 2, // Retrieve extra, filter later
      filter: {
        active: true,
        appliesToTier: { $lte: intent.agentTier },
      },
    });

    // Filter by relevance threshold
    const relevant = matches
      .filter(m => m.score >= minRelevance)
      .slice(0, maxPolicies);

    // Load full policy content for matches
    return Promise.all(
      relevant.map(async m => ({
        policy: await this.policyStore.get(m.id),
        relevanceScore: m.score,
        matchReason: m.explanation,
      }))
    );
  }

  /**
   * Create intent embedding for semantic search.
   */
  private async embedIntent(intent: Intent): Promise<number[]> {
    const intentText = [
      `Action: ${intent.actionType}`,
      `Resource: ${intent.resourceScope}`,
      `Agent Tier: ${intent.agentTier}`,
      `Context: ${JSON.stringify(intent.context)}`,
    ].join('\n');

    return this.embedder.embed(intentText);
  }
}
```

---

## Part 4: Fluid Action-Based Workflows

### The Problem

Current workflow is linear:
```
INTENT → ENFORCE → EXECUTE → PROOF
   ↓        ↓         ↓        ↓
(locked) (locked)  (locked) (locked)

If anything fails: START OVER
```

### The Solution: Iterative Refinement Loops

```typescript
// packages/a3i/src/workflow/fluid-workflow.ts

export class FluidWorkflowEngine {
  /**
   * Execute intent with iterative refinement capability.
   *
   * Key insight: Most failures are "almost succeeded" scenarios.
   * Instead of restarting, allow refinement within bounds.
   */
  async executeFluid(
    intent: Intent,
    options: FluidExecutionOptions = {}
  ): Promise<FluidExecutionResult> {
    const maxRefinements = options.maxRefinements ?? 3;
    const refinementHistory: RefinementAttempt[] = [];

    let currentIntent = intent;
    let attempt = 0;

    while (attempt <= maxRefinements) {
      // Evaluate current intent
      const decision = await this.enforcer.evaluate(currentIntent);

      // GREEN: Proceed to execution
      if (decision.outcome === DecisionOutcome.ALLOW) {
        const execution = await this.execute(currentIntent);
        return {
          success: true,
          finalIntent: currentIntent,
          refinementHistory,
          execution,
          decision,
        };
      }

      // RED (hard): Cannot proceed
      if (this.isHardStop(decision.outcome)) {
        return {
          success: false,
          finalIntent: currentIntent,
          refinementHistory,
          execution: null,
          decision,
          failureReason: decision.reasoning,
        };
      }

      // YELLOW: Attempt refinement
      if (decision.outcome === DecisionOutcome.REFINE && decision.refinements) {
        const refined = await this.applyRefinements(
          currentIntent,
          decision.refinements,
          options.autoApplyMinorRefinements ?? true
        );

        if (refined.applied) {
          refinementHistory.push({
            attempt,
            originalIntent: currentIntent,
            refinedIntent: refined.intent,
            refinements: decision.refinements,
            autoApplied: refined.autoApplied,
          });

          currentIntent = refined.intent;
          attempt++;
          continue;
        }
      }

      // YELLOW (constrain): Execute with constraints
      if (decision.outcome === DecisionOutcome.CONSTRAIN && decision.constraints) {
        const constrained = await this.executeConstrained(
          currentIntent,
          decision.constraints
        );

        return {
          success: constrained.success,
          finalIntent: currentIntent,
          refinementHistory,
          execution: constrained,
          decision,
          appliedConstraints: decision.constraints,
        };
      }

      // No path forward
      break;
    }

    // Exhausted refinements
    return {
      success: false,
      finalIntent: currentIntent,
      refinementHistory,
      execution: null,
      decision: await this.enforcer.evaluate(currentIntent),
      failureReason: 'Exhausted refinement attempts',
    };
  }

  /**
   * Apply refinements to intent, auto-applying minor ones.
   */
  private async applyRefinements(
    intent: Intent,
    refinements: IntentRefinement[],
    autoApplyMinor: boolean
  ): Promise<RefinementResult> {
    const applied: IntentRefinement[] = [];
    const needsApproval: IntentRefinement[] = [];

    let refined = { ...intent };

    for (const ref of refinements) {
      if (autoApplyMinor && ref.impact === 'minor') {
        // Auto-apply minor refinements
        refined = this.applyRefinement(refined, ref);
        applied.push(ref);
      } else {
        // Queue for approval
        needsApproval.push(ref);
      }
    }

    // If significant refinements need approval, check agent's trust level
    if (needsApproval.length > 0) {
      const trustLevel = await this.getTrustLevel(intent.agentId);

      if (trustLevel >= TrustLevel.T5) {
        // High-trust agents can self-approve moderate refinements
        for (const ref of needsApproval) {
          if (ref.impact !== 'significant') {
            refined = this.applyRefinement(refined, ref);
            applied.push(ref);
          }
        }
      }
    }

    return {
      applied: applied.length > 0,
      intent: refined,
      appliedRefinements: applied,
      pendingRefinements: needsApproval.filter(r => !applied.includes(r)),
      autoApplied: applied.filter(r => r.impact === 'minor').length,
    };
  }
}
```

### Workflow State Machine

```typescript
// packages/a3i/src/workflow/workflow-state.ts

export enum WorkflowState {
  // Initial states
  INTENT_RECEIVED = 'intent_received',
  EVALUATING = 'evaluating',

  // Decision states
  APPROVED = 'approved',
  REFINING = 'refining',
  CONSTRAINED = 'constrained',
  ESCALATED = 'escalated',
  BLOCKED = 'blocked',

  // Execution states
  EXECUTING = 'executing',
  SHADOWING = 'shadowing',

  // Terminal states
  COMPLETED = 'completed',
  FAILED = 'failed',
  HALTED = 'halted',
}

export const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  // From INTENT_RECEIVED
  [WorkflowState.INTENT_RECEIVED]: [
    WorkflowState.EVALUATING,
  ],

  // From EVALUATING
  [WorkflowState.EVALUATING]: [
    WorkflowState.APPROVED,
    WorkflowState.REFINING,
    WorkflowState.CONSTRAINED,
    WorkflowState.ESCALATED,
    WorkflowState.BLOCKED,
    WorkflowState.HALTED,
  ],

  // From REFINING (can iterate!)
  [WorkflowState.REFINING]: [
    WorkflowState.EVALUATING,  // Re-evaluate after refinement
    WorkflowState.BLOCKED,     // Refinement rejected
    WorkflowState.ESCALATED,   // Needs HITL for refinement
  ],

  // From APPROVED
  [WorkflowState.APPROVED]: [
    WorkflowState.EXECUTING,
    WorkflowState.SHADOWING,
  ],

  // From CONSTRAINED
  [WorkflowState.CONSTRAINED]: [
    WorkflowState.EXECUTING,
  ],

  // From ESCALATED
  [WorkflowState.ESCALATED]: [
    WorkflowState.APPROVED,    // HITL approved
    WorkflowState.REFINING,    // HITL suggested refinement
    WorkflowState.BLOCKED,     // HITL rejected
  ],

  // From EXECUTING
  [WorkflowState.EXECUTING]: [
    WorkflowState.COMPLETED,
    WorkflowState.FAILED,
    WorkflowState.REFINING,    // Execution revealed need for refinement
  ],

  // From SHADOWING
  [WorkflowState.SHADOWING]: [
    WorkflowState.COMPLETED,
    WorkflowState.FAILED,
  ],

  // Terminal states (no transitions out)
  [WorkflowState.COMPLETED]: [],
  [WorkflowState.FAILED]: [],
  [WorkflowState.HALTED]: [],
  [WorkflowState.BLOCKED]: [],
};
```

---

## Part 5: Native IDE Integration

### Slash Commands for Vorion

```typescript
// packages/vorion-ide/src/slash-commands.ts

export const VORION_SLASH_COMMANDS = {
  // Status and Info
  '/vorion:status': {
    description: 'Show current agent trust status',
    handler: 'getAgentStatus',
    args: ['agentId?'],
  },
  '/vorion:score': {
    description: 'Show detailed trust score breakdown',
    handler: 'getTrustScore',
    args: ['agentId?'],
  },
  '/vorion:policies': {
    description: 'List policies affecting current context',
    handler: 'getRelevantPolicies',
    args: ['action?', 'resource?'],
  },

  // Pre-flight Checks
  '/vorion:check': {
    description: 'Check if action would be allowed',
    handler: 'preflightCheck',
    args: ['action', 'resource?'],
  },
  '/vorion:simulate': {
    description: 'Simulate intent without executing',
    handler: 'simulateIntent',
    args: ['intentJson'],
  },

  // Workflow Actions
  '/vorion:escalate': {
    description: 'Request HITL review for current action',
    handler: 'requestEscalation',
    args: ['reason'],
  },
  '/vorion:refine': {
    description: 'Refine current intent based on suggestions',
    handler: 'applyRefinement',
    args: ['refinementId'],
  },
  '/vorion:optimize': {
    description: 'Declare optimization intent',
    handler: 'declareOptimization',
    args: ['type', 'duration'],
  },

  // Audit and History
  '/vorion:audit': {
    description: 'Show recent audit entries',
    handler: 'getAuditHistory',
    args: ['limit?', 'agentId?'],
  },
  '/vorion:trace': {
    description: 'Trace a correlation ID through the system',
    handler: 'traceCorrelation',
    args: ['correlationId'],
  },

  // Quick Actions
  '/vorion:approve': {
    description: 'Quick-approve pending escalation (if authorized)',
    handler: 'quickApprove',
    args: ['escalationId'],
  },
  '/vorion:reject': {
    description: 'Quick-reject pending escalation (if authorized)',
    handler: 'quickReject',
    args: ['escalationId', 'reason'],
  },
};

export class VorionIDEExtension {
  /**
   * Handle slash command from IDE.
   */
  async handleCommand(command: string, args: string[]): Promise<CommandResult> {
    const config = VORION_SLASH_COMMANDS[command];
    if (!config) {
      return { error: `Unknown command: ${command}` };
    }

    const handler = this[config.handler as keyof this];
    if (typeof handler !== 'function') {
      return { error: `Handler not implemented: ${config.handler}` };
    }

    try {
      return await handler.call(this, ...args);
    } catch (error) {
      return { error: `Command failed: ${error.message}` };
    }
  }

  /**
   * /vorion:status [agentId]
   */
  async getAgentStatus(agentId?: string): Promise<CommandResult> {
    const id = agentId || await this.getCurrentAgentId();
    const status = await this.api.getAgentStatus(id);

    return {
      output: `
╭─────────────────────────────────────────╮
│         VORION AGENT STATUS             │
├─────────────────────────────────────────┤
│ Agent: ${id.slice(0, 8)}...              │
│ Trust: ${status.score} (${status.tier})  │
│ Mode:  ${status.shadowMode ? '🌑 Shadow' : '☀️ Production'} │
│ State: ${status.state}                   │
├─────────────────────────────────────────┤
│ Recent Actions: ${status.recentActions}  │
│ Pending Escalations: ${status.pendingEscalations} │
│ Last Activity: ${status.lastActivity}    │
╰─────────────────────────────────────────╯
      `.trim(),
    };
  }

  /**
   * /vorion:check <action> [resource]
   */
  async preflightCheck(action: string, resource?: string): Promise<CommandResult> {
    const result = await this.api.preflightCheck({
      actionType: action,
      resourceScope: resource || '*',
      agentId: await this.getCurrentAgentId(),
    });

    const icon = result.allowed ? '✅' : result.canRefine ? '⚠️' : '❌';
    const status = result.allowed ? 'ALLOWED' : result.canRefine ? 'REFINABLE' : 'BLOCKED';

    let output = `${icon} ${action} → ${status}\n`;

    if (result.refinements?.length > 0) {
      output += '\nSuggested refinements:\n';
      for (const ref of result.refinements) {
        output += `  • ${ref.reason}\n`;
        output += `    /vorion:refine ${ref.id}\n`;
      }
    }

    if (result.constraints?.length > 0) {
      output += '\nWould apply constraints:\n';
      for (const con of result.constraints) {
        output += `  • ${con.description}\n`;
      }
    }

    return { output };
  }

  /**
   * /vorion:optimize <type> <duration>
   */
  async declareOptimization(type: string, duration: string): Promise<CommandResult> {
    const result = await this.api.declareOptimization({
      agentId: await this.getCurrentAgentId(),
      optimizationType: type,
      duration: this.parseDuration(duration),
    });

    if (result.requiresApproval) {
      return {
        output: `⏳ Optimization window created (pending approval)\n` +
                `   Window ID: ${result.windowId}\n` +
                `   Run /vorion:status to check approval status`,
      };
    }

    return {
      output: `✅ Optimization window active\n` +
              `   Type: ${type}\n` +
              `   Duration: ${duration}\n` +
              `   Window ID: ${result.windowId}\n` +
              `   Anomaly detection relaxed for declared improvements`,
    };
  }
}
```

---

## Part 6: Living Documentation from Audit Trail

### Auto-Sync Truth Chain to Documentation

```typescript
// packages/proof-plane/src/docs/living-docs.ts

export class LivingDocumentationService {
  /**
   * Generate/update documentation from audit trail.
   * Bridges the gap between manual docs and cryptographic truth.
   */
  async syncDocumentation(
    agentId: string,
    targetPath: string,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    // Get audit trail
    const auditTrail = await this.proofPlane.getAgentHistory(agentId, {
      limit: options.maxEntries ?? 1000,
    });

    // Analyze for documentation patterns
    const analysis = await this.analyzeForDocs(auditTrail);

    // Generate documentation sections
    const sections = await this.generateSections(analysis);

    // Read existing doc if present
    const existingDoc = await this.readExisting(targetPath);

    // Merge: Keep human-written sections, update audit-derived sections
    const merged = this.mergeDocumentation(existingDoc, sections);

    // Write result
    await this.writeDocumentation(targetPath, merged);

    // Log sync to audit trail (meta!)
    await this.proofPlane.logEvent(
      ProofEventType.COMPONENT_UPDATED,
      auditTrail[0]?.correlationId || uuid(),
      {
        type: 'documentation_sync',
        targetPath,
        sectionsUpdated: sections.map(s => s.title),
        lastAuditEntry: auditTrail[0]?.eventId,
      },
      agentId
    );

    return {
      path: targetPath,
      sectionsUpdated: sections.length,
      humanSectionsPreserved: existingDoc?.humanSections?.length ?? 0,
    };
  }

  /**
   * Analyze audit trail for documentation-worthy patterns.
   */
  private async analyzeForDocs(trail: ProofEvent[]): Promise<DocAnalysis> {
    return {
      // Capability summary
      capabilities: this.extractCapabilities(trail),

      // Access patterns
      accessPatterns: this.extractAccessPatterns(trail),

      // Trust history
      trustHistory: this.extractTrustHistory(trail),

      // Decision patterns
      decisionPatterns: this.extractDecisionPatterns(trail),

      // Error patterns
      errorPatterns: this.extractErrorPatterns(trail),

      // Timeline
      timeline: this.extractTimeline(trail),
    };
  }

  /**
   * Generate markdown sections from analysis.
   */
  private async generateSections(analysis: DocAnalysis): Promise<DocSection[]> {
    return [
      {
        title: 'Capabilities',
        generated: true,
        content: this.formatCapabilities(analysis.capabilities),
      },
      {
        title: 'Access Patterns',
        generated: true,
        content: this.formatAccessPatterns(analysis.accessPatterns),
      },
      {
        title: 'Trust History',
        generated: true,
        content: this.formatTrustHistory(analysis.trustHistory),
      },
      {
        title: 'Decision Patterns',
        generated: true,
        content: this.formatDecisionPatterns(analysis.decisionPatterns),
      },
      {
        title: 'Recent Activity Timeline',
        generated: true,
        content: this.formatTimeline(analysis.timeline),
      },
    ];
  }

  /**
   * Merge generated content with existing human-written content.
   */
  private mergeDocumentation(
    existing: ExistingDoc | null,
    generated: DocSection[]
  ): string {
    const GENERATED_MARKER = '<!-- VORION:AUTO-GENERATED -->';
    const HUMAN_MARKER = '<!-- VORION:HUMAN-WRITTEN -->';

    let output = `# Agent Documentation\n\n`;
    output += `*Last synced: ${new Date().toISOString()}*\n\n`;

    // Add human-written sections first (preserved)
    if (existing?.humanSections) {
      for (const section of existing.humanSections) {
        output += `${HUMAN_MARKER}\n`;
        output += `## ${section.title}\n\n`;
        output += `${section.content}\n\n`;
      }
    }

    // Add generated sections
    output += `---\n\n`;
    output += `${GENERATED_MARKER}\n`;
    output += `*The following sections are auto-generated from the audit trail.*\n\n`;

    for (const section of generated) {
      output += `## ${section.title}\n\n`;
      output += `${section.content}\n\n`;
    }

    // Add verification footer
    output += `---\n\n`;
    output += `*Verified by Vorion Truth Chain*\n`;

    return output;
  }
}
```

---

## Part 7: User-Side Risk Aversion & Control Levels

### The Problem

Current governance is platform-centric:
- Platform defines policies
- Platform controls thresholds
- Users are passive recipients

But users have different risk tolerances:
- Enterprise users want maximum security
- Startup users prioritize velocity
- Research users need experimentation freedom
- Individual developers have personal preferences

### The Solution: User Risk Profiles

```typescript
// packages/a3i/src/user/risk-profile.ts

export enum RiskTolerance {
  /** Maximum caution - prefer false negatives (block more) */
  PARANOID = 'paranoid',

  /** High security - err on side of caution */
  CONSERVATIVE = 'conservative',

  /** Balanced approach - default platform behavior */
  BALANCED = 'balanced',

  /** Higher velocity - accept more risk for speed */
  PERMISSIVE = 'permissive',

  /** Research mode - maximum freedom, accept consequences */
  EXPERIMENTAL = 'experimental',
}

export enum UserControlLevel {
  /** Full control: User approves every significant decision */
  FULL = 'full',

  /** High control: User approves moderate+ impact decisions */
  HIGH = 'high',

  /** Standard: User approves significant decisions only */
  STANDARD = 'standard',

  /** Delegated: User trusts agent for most decisions */
  DELEGATED = 'delegated',

  /** Autonomous: Agent operates within boundaries without approval */
  AUTONOMOUS = 'autonomous',
}

export interface UserRiskProfile {
  userId: string;

  /** How risk-averse is this user? Affects decision thresholds */
  riskTolerance: RiskTolerance;

  /** How much control does user want over decisions? */
  controlLevel: UserControlLevel;

  /** Custom overrides for specific action types */
  actionOverrides: ActionOverride[];

  /** Resource-specific risk settings */
  resourceRiskLevels: Map<string, RiskTolerance>;

  /** Time-based risk adjustments */
  temporalRiskAdjustments: TemporalRiskAdjustment[];

  /** Maximum auto-approval cost/impact threshold */
  maxAutoApprovalImpact: number;

  /** Notification preferences */
  notificationPreferences: NotificationConfig;
}

export interface ActionOverride {
  actionPattern: string;     // e.g., "database:*", "api:external:*"
  riskTolerance: RiskTolerance;
  controlLevel: UserControlLevel;
  requireApproval: boolean;
}

export interface TemporalRiskAdjustment {
  /** "business_hours", "off_hours", "weekends", etc. */
  period: string;
  riskTolerance: RiskTolerance;
  controlLevel: UserControlLevel;
}
```

### How Risk Aversion Affects Decisions

```typescript
// packages/a3i/src/enforce/risk-aware-decision.ts

export class RiskAwareDecisionEngine extends FluidEnforcementEngine {
  /**
   * Evaluate with user risk profile applied.
   * Risk tolerance shifts decision thresholds.
   */
  async evaluateWithRiskProfile(
    intent: Intent,
    context: EvaluationContext,
    userProfile: UserRiskProfile
  ): Promise<FluidDecision> {
    // Get base decision
    const baseDecision = await this.evaluate(intent, context);

    // Apply risk tolerance adjustments
    const adjustedDecision = this.applyRiskTolerance(
      baseDecision,
      userProfile.riskTolerance
    );

    // Apply control level requirements
    const finalDecision = this.applyControlLevel(
      adjustedDecision,
      userProfile.controlLevel,
      intent
    );

    return finalDecision;
  }

  /**
   * Risk tolerance shifts decision thresholds.
   *
   * PARANOID:      REFINE → ESCALATE, CONSTRAIN → BLOCK
   * CONSERVATIVE:  Lower confidence threshold for ESCALATE
   * BALANCED:      Default behavior
   * PERMISSIVE:    Higher threshold before ESCALATE, auto-apply more refinements
   * EXPERIMENTAL:  REFINE → AUTO_APPLY, CONSTRAIN → ALLOW_WITH_LOG
   */
  private applyRiskTolerance(
    decision: FluidDecision,
    tolerance: RiskTolerance
  ): FluidDecision {
    const thresholds = RISK_THRESHOLDS[tolerance];

    switch (tolerance) {
      case RiskTolerance.PARANOID:
        // More aggressive blocking
        if (decision.outcome === DecisionOutcome.REFINE) {
          return {
            ...decision,
            outcome: DecisionOutcome.ESCALATE,
            reasoning: `[Risk: Paranoid] ${decision.reasoning}`,
          };
        }
        if (decision.outcome === DecisionOutcome.CONSTRAIN) {
          return {
            ...decision,
            outcome: DecisionOutcome.BLOCK,
            reasoning: `[Risk: Paranoid] Constraints not sufficient - ${decision.reasoning}`,
          };
        }
        break;

      case RiskTolerance.CONSERVATIVE:
        // Lower confidence threshold for escalation
        if (decision.confidence < thresholds.escalateThreshold) {
          return {
            ...decision,
            outcome: DecisionOutcome.ESCALATE,
            reasoning: `[Risk: Conservative] Low confidence (${decision.confidence}) - ${decision.reasoning}`,
          };
        }
        break;

      case RiskTolerance.PERMISSIVE:
        // Auto-apply minor refinements without asking
        if (decision.outcome === DecisionOutcome.REFINE) {
          const minorRefinements = decision.refinements?.filter(r => r.impact === 'minor');
          if (minorRefinements?.length === decision.refinements?.length) {
            return {
              ...decision,
              outcome: DecisionOutcome.ALLOW,
              reasoning: `[Risk: Permissive] Auto-applying minor refinements`,
              suggestedActions: ['Refinements auto-applied'],
            };
          }
        }
        break;

      case RiskTolerance.EXPERIMENTAL:
        // Maximum leniency, log everything but block little
        if (decision.outcome === DecisionOutcome.REFINE ||
            decision.outcome === DecisionOutcome.CONSTRAIN) {
          return {
            ...decision,
            outcome: DecisionOutcome.SHADOW,  // Execute but shadow
            reasoning: `[Risk: Experimental] Proceeding in shadow mode - ${decision.reasoning}`,
          };
        }
        break;
    }

    return decision;
  }

  /**
   * Control level determines what requires user approval.
   */
  private applyControlLevel(
    decision: FluidDecision,
    controlLevel: UserControlLevel,
    intent: Intent
  ): FluidDecision {
    const requiresApproval = this.checkApprovalRequired(
      decision,
      controlLevel,
      intent
    );

    if (requiresApproval && decision.outcome === DecisionOutcome.ALLOW) {
      return {
        ...decision,
        outcome: DecisionOutcome.ESCALATE,
        reasoning: `[Control: ${controlLevel}] User approval required for this action`,
        suggestedActions: ['Awaiting user approval'],
      };
    }

    return decision;
  }

  /**
   * Determine if user approval is required based on control level.
   */
  private checkApprovalRequired(
    decision: FluidDecision,
    controlLevel: UserControlLevel,
    intent: Intent
  ): boolean {
    const impactLevel = this.assessImpactLevel(intent);

    switch (controlLevel) {
      case UserControlLevel.FULL:
        // Everything needs approval
        return impactLevel > ImpactLevel.TRIVIAL;

      case UserControlLevel.HIGH:
        // Moderate and above needs approval
        return impactLevel >= ImpactLevel.MODERATE;

      case UserControlLevel.STANDARD:
        // Significant and above needs approval
        return impactLevel >= ImpactLevel.SIGNIFICANT;

      case UserControlLevel.DELEGATED:
        // Only critical needs approval
        return impactLevel >= ImpactLevel.CRITICAL;

      case UserControlLevel.AUTONOMOUS:
        // Only hard boundary violations need approval
        return impactLevel >= ImpactLevel.CATASTROPHIC;
    }
  }
}

const RISK_THRESHOLDS: Record<RiskTolerance, ThresholdConfig> = {
  [RiskTolerance.PARANOID]: {
    escalateThreshold: 0.95,  // Escalate if confidence < 95%
    autoApplyRefinements: false,
    blockOnUncertainty: true,
  },
  [RiskTolerance.CONSERVATIVE]: {
    escalateThreshold: 0.85,
    autoApplyRefinements: false,
    blockOnUncertainty: false,
  },
  [RiskTolerance.BALANCED]: {
    escalateThreshold: 0.70,
    autoApplyRefinements: true,  // Minor only
    blockOnUncertainty: false,
  },
  [RiskTolerance.PERMISSIVE]: {
    escalateThreshold: 0.50,
    autoApplyRefinements: true,  // Minor + moderate
    blockOnUncertainty: false,
  },
  [RiskTolerance.EXPERIMENTAL]: {
    escalateThreshold: 0.30,
    autoApplyRefinements: true,  // All
    blockOnUncertainty: false,
  },
};
```

### User Control Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      USER CONTROL vs AGENT TRUST MATRIX                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User Control    T0-T2 (Low Trust)    T3-T4 (Medium)    T5-T7 (High Trust)  │
│  ─────────────   ─────────────────    ──────────────    ─────────────────   │
│                                                                              │
│  FULL            All escalated        All escalated      Significant+ esc.  │
│  HIGH            All escalated        Moderate+ esc.     Significant+ esc.  │
│  STANDARD        All escalated        Significant+ esc.  Critical+ esc.     │
│  DELEGATED       Significant+ esc.    Critical+ esc.     Hard boundary only │
│  AUTONOMOUS      Critical+ esc.       Hard boundary only Hard boundary only │
│                                                                              │
│  Legend: "esc." = escalated to user for approval                            │
│                                                                              │
│  Key Insight: User control and agent trust work TOGETHER                    │
│  - Low trust + High control = Maximum oversight                             │
│  - High trust + Low control = Maximum autonomy                              │
│  - The intersection determines actual behavior                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Risk Profile Configuration UI

```typescript
// apps/agentanchor/lib/risk-profile/risk-profile-service.ts

export class RiskProfileService {
  /**
   * Get user's current risk profile.
   */
  async getRiskProfile(userId: string): Promise<UserRiskProfile> {
    const profile = await this.db.query.userRiskProfiles.findFirst({
      where: eq(userRiskProfiles.userId, userId),
    });

    return profile || this.getDefaultProfile(userId);
  }

  /**
   * Update risk profile with validation.
   */
  async updateRiskProfile(
    userId: string,
    updates: Partial<UserRiskProfile>
  ): Promise<UpdateResult> {
    // Validate: Can't have EXPERIMENTAL risk with FULL control (contradictory)
    if (updates.riskTolerance === RiskTolerance.EXPERIMENTAL &&
        updates.controlLevel === UserControlLevel.FULL) {
      return {
        success: false,
        error: 'Experimental risk tolerance requires delegated or autonomous control',
        suggestion: 'Consider PERMISSIVE risk with FULL control, or EXPERIMENTAL with DELEGATED control',
      };
    }

    // Validate: Can't have PARANOID with AUTONOMOUS (also contradictory)
    if (updates.riskTolerance === RiskTolerance.PARANOID &&
        updates.controlLevel === UserControlLevel.AUTONOMOUS) {
      return {
        success: false,
        error: 'Paranoid risk tolerance requires higher control levels',
        suggestion: 'Consider PARANOID with FULL or HIGH control',
      };
    }

    // Apply update
    await this.db
      .update(userRiskProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userRiskProfiles.userId, userId));

    // Log the change
    await this.auditLogger.logEvent(
      userId,
      AuditEventType.RISK_PROFILE_UPDATED,
      {
        previousProfile: await this.getRiskProfile(userId),
        newSettings: updates,
      }
    );

    return { success: true };
  }

  /**
   * Get recommended profile based on use case.
   */
  getRecommendedProfile(useCase: string): UserRiskProfile {
    const recommendations: Record<string, Partial<UserRiskProfile>> = {
      'enterprise-production': {
        riskTolerance: RiskTolerance.CONSERVATIVE,
        controlLevel: UserControlLevel.HIGH,
        maxAutoApprovalImpact: 100,
      },
      'enterprise-staging': {
        riskTolerance: RiskTolerance.BALANCED,
        controlLevel: UserControlLevel.STANDARD,
        maxAutoApprovalImpact: 500,
      },
      'startup-mvp': {
        riskTolerance: RiskTolerance.PERMISSIVE,
        controlLevel: UserControlLevel.DELEGATED,
        maxAutoApprovalImpact: 1000,
      },
      'research-sandbox': {
        riskTolerance: RiskTolerance.EXPERIMENTAL,
        controlLevel: UserControlLevel.AUTONOMOUS,
        maxAutoApprovalImpact: Infinity,
      },
      'personal-learning': {
        riskTolerance: RiskTolerance.BALANCED,
        controlLevel: UserControlLevel.STANDARD,
        maxAutoApprovalImpact: 250,
      },
    };

    return {
      userId: '',
      ...recommendations[useCase] || recommendations['personal-learning'],
      actionOverrides: [],
      resourceRiskLevels: new Map(),
      temporalRiskAdjustments: [],
      notificationPreferences: this.getDefaultNotifications(),
    };
  }
}
```

### IDE Integration for Risk Settings

```typescript
// Additional slash commands for risk profile management

const RISK_PROFILE_COMMANDS = {
  '/vorion:risk': {
    description: 'Show or set risk tolerance',
    handler: 'getRiskProfile',
    args: ['tolerance?'],
  },
  '/vorion:control': {
    description: 'Show or set control level',
    handler: 'getControlLevel',
    args: ['level?'],
  },
  '/vorion:profile': {
    description: 'Show full risk profile',
    handler: 'showFullProfile',
    args: [],
  },
  '/vorion:recommend': {
    description: 'Get recommended profile for use case',
    handler: 'getRecommendation',
    args: ['useCase'],
  },
};

// Example output
// /vorion:profile
`
╭───────────────────────────────────────────────╮
│            YOUR RISK PROFILE                  │
├───────────────────────────────────────────────┤
│ Risk Tolerance:  ⚖️  BALANCED                 │
│ Control Level:   🎚️  STANDARD                 │
│ Auto-Approval:   ≤500 impact units            │
├───────────────────────────────────────────────┤
│ WHAT THIS MEANS:                              │
│ • Minor actions: Auto-approved                │
│ • Moderate actions: Refinements suggested     │
│ • Significant actions: You'll be asked        │
│ • Critical actions: Always escalated          │
├───────────────────────────────────────────────┤
│ OVERRIDES:                                    │
│ • database:* → CONSERVATIVE                   │
│ • api:internal:* → PERMISSIVE                 │
╰───────────────────────────────────────────────╯
`
```

### The Relationship Visualized

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HOW USER SETTINGS AFFECT GOVERNANCE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                     Platform Policy (Foundation)                             │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    HARD BOUNDARIES (Immutable)                         │ │
│  │  These NEVER change regardless of user settings:                       │ │
│  │  • Security violations • Cross-tenant access • Kill switch active      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    SOFT POLICIES (User-Adjustable)                     │ │
│  │                                                                        │ │
│  │  User Risk Tolerance ──────────► Adjusts THRESHOLDS                    │ │
│  │  • PARANOID: Stricter, block more                                      │ │
│  │  • BALANCED: Platform defaults                                         │ │
│  │  • EXPERIMENTAL: Looser, allow more                                    │ │
│  │                                                                        │ │
│  │  User Control Level ──────────► Adjusts APPROVAL REQUIREMENTS          │ │
│  │  • FULL: Approve everything                                            │ │
│  │  • STANDARD: Approve significant                                       │ │
│  │  • AUTONOMOUS: Approve only critical                                   │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    FINAL DECISION                                      │ │
│  │  = Platform Policy × Agent Trust × User Risk × User Control            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  KEY INSIGHT: Users can loosen soft policies but NEVER bypass hard ones.    │
│  Even with EXPERIMENTAL + AUTONOMOUS, security boundaries are enforced.     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary: The Fluid Governance Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUID GOVERNANCE STACK                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              IDE INTEGRATION LAYER                   │   │
│  │  /vorion:status  /vorion:check  /vorion:risk        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           USER RISK PROFILE LAYER                    │   │
│  │  RiskTolerance × ControlLevel → Decision Tuning     │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            FLUID WORKFLOW ENGINE                     │   │
│  │  Intent → Evaluate → [Refine|Constrain|Allow|Block] │   │
│  │           ↑____________________↓ (iterate)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          DELTA CONTEXT MANAGER                       │   │
│  │  Checkpoints → Deltas → RAG Retrieval → Minimal Ctx │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          THREE-TIER DECISION ENGINE                  │   │
│  │  GREEN (Allow) | YELLOW (Refine) | RED (Block)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          HARD BOUNDARY LAYER (unchanged)             │   │
│  │  Security | Trust | Compliance | Kill Switch        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          PROOF PLANE (immutable audit)               │   │
│  │  Events → Hash Chain → Living Documentation         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

| Principle | Implementation |
|-----------|----------------|
| **Guardrails, not walls** | Three-tier decisions allow refinement |
| **Security at the core** | Hard boundaries remain inviolable |
| **Meet developers where they are** | IDE integration, slash commands |
| **Context efficiency** | Delta-based evaluation, RAG retrieval |
| **Self-documenting system** | Audit trail generates living docs |
| **Gradual onboarding** | Brownfield discovery, progressive enforcement |
| **User-centric control** | Risk profiles let users tune governance |

---

## Implementation Roadmap

### Phase 1: Foundation (Sprint B)
- [ ] Three-tier decision engine
- [ ] Fluid workflow state machine
- [ ] Basic refinement support

### Phase 2: Context Optimization (Sprint C)
- [ ] Delta context manager
- [ ] Checkpoint system
- [ ] Policy RAG integration

### Phase 3: Developer Experience (Sprint D)
- [ ] IDE slash commands
- [ ] /vorion:status, /vorion:check
- [ ] Pre-flight checking

### Phase 4: User Risk Profiles (Sprint E)
- [ ] Risk profile data model and storage
- [ ] Risk-aware decision engine integration
- [ ] Control level approval routing
- [ ] /vorion:risk, /vorion:control, /vorion:profile commands

### Phase 5: Onboarding & Docs (Sprint F)
- [ ] Brownfield onboarding service
- [ ] Living documentation sync
- [ ] Gradual activation system
- [ ] Risk profile recommendations by use case

---

*Document Version: 1.1.0*
*Last Updated: January 31, 2026*
*Authors: Vorion Architecture Team*
