/**
 * Friction Feedback System
 *
 * Provides clear explanations, actionable next steps, and decision options
 * when AI actions are denied or escalated. Implements FR119-FR122.
 *
 * Part of Epic 3: Friction Feedback System
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { intentRegistry } from '../intent/metrics.js';
import type { ID, TrustLevel, TrustScore, ControlAction } from '../common/types.js';
import type { Decision } from '../common/types.js';

const logger = createLogger({ component: 'friction-feedback' });

// =============================================================================
// Types
// =============================================================================

/**
 * Denial reason categories for clear messaging
 */
export const DenialReasonCategory = {
  TRUST_INSUFFICIENT: 'trust_insufficient',
  POLICY_VIOLATION: 'policy_violation',
  CAPABILITY_RESTRICTED: 'capability_restricted',
  RATE_LIMITED: 'rate_limited',
  RESOURCE_UNAVAILABLE: 'resource_unavailable',
  ESCALATION_REQUIRED: 'escalation_required',
  CONTEXT_INVALID: 'context_invalid',
  PERMISSION_DENIED: 'permission_denied',
} as const;

export type DenialReasonCategory = (typeof DenialReasonCategory)[keyof typeof DenialReasonCategory];

/**
 * Severity level of the denial
 */
export const DenialSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type DenialSeverity = (typeof DenialSeverity)[keyof typeof DenialSeverity];

/**
 * Action type for next steps
 */
export const NextStepAction = {
  REQUEST_ESCALATION: 'request_escalation',
  MODIFY_PARAMETERS: 'modify_parameters',
  WAIT_RETRY: 'wait_retry',
  CONTACT_ADMIN: 'contact_admin',
  INCREASE_TRUST: 'increase_trust',
  REQUEST_CAPABILITY: 'request_capability',
  PROVIDE_CONTEXT: 'provide_context',
  ACKNOWLEDGE: 'acknowledge',
} as const;

export type NextStepAction = (typeof NextStepAction)[keyof typeof NextStepAction];

/**
 * Human-readable denial explanation
 */
export interface DenialExplanation {
  /** Short, clear summary of why the action was denied */
  summary: string;
  /** Detailed explanation with context */
  details: string;
  /** Category of denial for routing */
  category: DenialReasonCategory;
  /** Severity level */
  severity: DenialSeverity;
  /** The specific policy or rule that triggered denial */
  triggeringRule?: {
    id: string;
    name: string;
    description?: string;
  };
  /** Trust context if relevant */
  trustContext?: {
    currentScore: TrustScore;
    currentLevel: TrustLevel;
    requiredLevel?: TrustLevel;
    requiredScore?: TrustScore;
    gap?: number;
  };
  /** Timestamp of denial */
  occurredAt: string;
  /** Unique identifier for this explanation */
  explanationId: string;
}

/**
 * Actionable next step
 */
export interface NextStep {
  /** Action identifier */
  action: NextStepAction;
  /** Human-readable label */
  label: string;
  /** Detailed description of what this action does */
  description: string;
  /** Is this step recommended? */
  recommended: boolean;
  /** Priority (1 = highest) */
  priority: number;
  /** Estimated time to complete (human-readable) */
  estimatedTime?: string;
  /** Prerequisites or conditions */
  prerequisites?: string[];
  /** Link or route to take action (for UI) */
  actionUrl?: string;
  /** Additional parameters for the action */
  parameters?: Record<string, unknown>;
}

/**
 * Decision option for human reviewers
 */
export interface DecisionOption {
  /** Decision identifier */
  id: string;
  /** Action type */
  action: 'approve' | 'reject' | 'escalate' | 'request_info' | 'defer';
  /** Display label */
  label: string;
  /** Description of consequences */
  consequence: string;
  /** Severity/impact indicator */
  impact: 'low' | 'medium' | 'high';
  /** Is this the default/recommended option? */
  isDefault: boolean;
  /** Require confirmation before executing? */
  requiresConfirmation: boolean;
  /** Required fields for this decision */
  requiredFields?: string[];
}

/**
 * Complete friction feedback response
 */
export interface FrictionFeedback {
  /** Unique feedback identifier */
  feedbackId: string;
  /** Related intent ID */
  intentId: ID;
  /** Related agent ID */
  agentId: ID;
  /** Denial explanation */
  explanation: DenialExplanation;
  /** Available next steps */
  nextSteps: NextStep[];
  /** Decision options (for escalations) */
  decisionOptions?: DecisionOption[];
  /** Generated at timestamp */
  generatedAt: string;
  /** Feedback version for evolution tracking */
  version: string;
}

/**
 * Agent understanding signal
 */
export interface AgentUnderstandingSignal {
  /** Signal identifier */
  signalId: string;
  /** Agent ID */
  agentId: ID;
  /** Related feedback ID */
  feedbackId: string;
  /** Signal type */
  type: 'acknowledged' | 'confused' | 'retried_same' | 'retried_modified' | 'escalated' | 'abandoned';
  /** Timestamp */
  timestamp: string;
  /** Time since denial (ms) */
  responseTimeMs: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Friction feedback generation context
 */
export interface FrictionContext {
  intentId: ID;
  agentId: ID;
  tenantId: ID;
  decision: Decision;
  action: string;
  category?: string;
  parameters?: Record<string, unknown>;
}

// =============================================================================
// Metrics
// =============================================================================

const frictionFeedbackGenerated = new Counter({
  name: 'vorion_friction_feedback_generated_total',
  help: 'Total friction feedback messages generated',
  labelNames: ['category', 'severity'] as const,
  registers: [intentRegistry],
});

const frictionNextStepsProvided = new Counter({
  name: 'vorion_friction_next_steps_total',
  help: 'Total next steps provided in friction feedback',
  labelNames: ['action'] as const,
  registers: [intentRegistry],
});

const agentUnderstandingSignals = new Counter({
  name: 'vorion_agent_understanding_signals_total',
  help: 'Agent understanding signals captured',
  labelNames: ['type'] as const,
  registers: [intentRegistry],
});

const feedbackResponseTime = new Histogram({
  name: 'vorion_friction_feedback_response_time_seconds',
  help: 'Time agents take to respond to friction feedback',
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [intentRegistry],
});

// =============================================================================
// Explanation Templates
// =============================================================================

const EXPLANATION_TEMPLATES: Record<DenialReasonCategory, {
  summary: (ctx: FrictionContext) => string;
  details: (ctx: FrictionContext) => string;
}> = {
  trust_insufficient: {
    summary: (ctx) =>
      `Your current trust level (${ctx.decision.trustLevel}) doesn't meet the requirement for this action.`,
    details: (ctx) => {
      const requiredLevel = findRequiredLevel(ctx.decision);
      return `The action "${ctx.action}" requires a minimum trust level of ${requiredLevel ?? 'higher than current'}. ` +
        `Your agent has a trust score of ${ctx.decision.trustScore} (Level ${ctx.decision.trustLevel}). ` +
        `To increase your trust level, complete more tasks successfully and maintain policy compliance.`;
    },
  },
  policy_violation: {
    summary: () => `This action violates an active governance policy.`,
    details: (ctx) => {
      const rule = ctx.decision.constraintsEvaluated?.find(c => !c.passed);
      return rule
        ? `The policy "${rule.constraintId}" was triggered: ${rule.reason ?? 'Policy requirements not met'}. ` +
          `Review the policy requirements and modify your request to comply.`
        : `An active governance policy prevents this action. Please review your organization's policies.`;
    },
  },
  capability_restricted: {
    summary: () => `Your agent doesn't have the capability for this action.`,
    details: (ctx) =>
      `The action "${ctx.action}" requires capabilities that are not currently assigned to your agent. ` +
      `Request additional capabilities from your administrator or choose an alternative approach.`,
  },
  rate_limited: {
    summary: () => `You've exceeded the rate limit for this action.`,
    details: () =>
      `Your agent has made too many requests in a short period. ` +
      `Please wait before retrying. This limit protects system stability and ensures fair resource allocation.`,
  },
  resource_unavailable: {
    summary: () => `The requested resource is currently unavailable.`,
    details: (ctx) =>
      `The action "${ctx.action}" cannot be completed because a required resource is unavailable. ` +
      `This may be temporary. Try again later or contact support if the issue persists.`,
  },
  escalation_required: {
    summary: () => `This action requires human approval before proceeding.`,
    details: (ctx) =>
      `The action "${ctx.action}" has been flagged for human review based on its risk level or policy requirements. ` +
      `A designated reviewer will evaluate your request. You'll be notified when a decision is made.`,
  },
  context_invalid: {
    summary: () => `The provided context doesn't meet validation requirements.`,
    details: (ctx) =>
      `The action "${ctx.action}" was denied because the provided context or parameters are invalid. ` +
      `Review the required format and ensure all mandatory fields are correctly specified.`,
  },
  permission_denied: {
    summary: () => `You don't have permission to perform this action.`,
    details: (ctx) =>
      `The action "${ctx.action}" requires permissions that are not assigned to your agent. ` +
      `Contact your administrator to request the necessary permissions.`,
  },
};

// =============================================================================
// Next Steps Generator
// =============================================================================

const NEXT_STEPS_BY_CATEGORY: Record<DenialReasonCategory, NextStep[]> = {
  trust_insufficient: [
    {
      action: NextStepAction.REQUEST_ESCALATION,
      label: 'Request Human Override',
      description: 'Ask a human reviewer to approve this action despite the trust level requirement.',
      recommended: true,
      priority: 1,
      estimatedTime: '5-30 minutes',
    },
    {
      action: NextStepAction.INCREASE_TRUST,
      label: 'Build Trust First',
      description: 'Complete lower-risk tasks successfully to increase your trust score over time.',
      recommended: false,
      priority: 2,
      estimatedTime: 'Days to weeks',
    },
    {
      action: NextStepAction.MODIFY_PARAMETERS,
      label: 'Reduce Scope',
      description: 'Try a smaller or less risky version of this action that fits your current trust level.',
      recommended: false,
      priority: 3,
    },
  ],
  policy_violation: [
    {
      action: NextStepAction.MODIFY_PARAMETERS,
      label: 'Modify Request',
      description: 'Adjust your request parameters to comply with the policy requirements.',
      recommended: true,
      priority: 1,
    },
    {
      action: NextStepAction.REQUEST_ESCALATION,
      label: 'Request Exception',
      description: 'Ask for a policy exception if you have a valid business reason.',
      recommended: false,
      priority: 2,
      estimatedTime: '1-24 hours',
    },
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Contact Governance Team',
      description: 'Discuss the policy with your governance team if you believe it should be updated.',
      recommended: false,
      priority: 3,
    },
  ],
  capability_restricted: [
    {
      action: NextStepAction.REQUEST_CAPABILITY,
      label: 'Request Capability',
      description: 'Submit a request to add this capability to your agent profile.',
      recommended: true,
      priority: 1,
      estimatedTime: '24-72 hours',
    },
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Contact Administrator',
      description: 'Speak with your administrator about capability requirements.',
      recommended: false,
      priority: 2,
    },
  ],
  rate_limited: [
    {
      action: NextStepAction.WAIT_RETRY,
      label: 'Wait and Retry',
      description: 'Wait for the rate limit window to reset, then try again.',
      recommended: true,
      priority: 1,
      estimatedTime: '1-60 minutes',
    },
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Request Higher Limits',
      description: 'Contact your administrator to request higher rate limits if needed.',
      recommended: false,
      priority: 2,
    },
  ],
  resource_unavailable: [
    {
      action: NextStepAction.WAIT_RETRY,
      label: 'Retry Later',
      description: 'The resource may become available. Try again in a few minutes.',
      recommended: true,
      priority: 1,
      estimatedTime: '5-30 minutes',
    },
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Report Issue',
      description: 'Report the unavailable resource to your support team.',
      recommended: false,
      priority: 2,
    },
  ],
  escalation_required: [
    {
      action: NextStepAction.ACKNOWLEDGE,
      label: 'Acknowledge & Wait',
      description: 'Your request is pending human review. You\'ll be notified of the decision.',
      recommended: true,
      priority: 1,
    },
    {
      action: NextStepAction.PROVIDE_CONTEXT,
      label: 'Add Justification',
      description: 'Provide additional context or justification to help the reviewer decide.',
      recommended: false,
      priority: 2,
    },
  ],
  context_invalid: [
    {
      action: NextStepAction.MODIFY_PARAMETERS,
      label: 'Fix Request Format',
      description: 'Review the required parameters and submit a corrected request.',
      recommended: true,
      priority: 1,
    },
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Get Documentation',
      description: 'Request documentation on the correct format for this action.',
      recommended: false,
      priority: 2,
    },
  ],
  permission_denied: [
    {
      action: NextStepAction.CONTACT_ADMIN,
      label: 'Request Permissions',
      description: 'Contact your administrator to request the required permissions.',
      recommended: true,
      priority: 1,
      estimatedTime: '24-72 hours',
    },
    {
      action: NextStepAction.REQUEST_ESCALATION,
      label: 'Request Override',
      description: 'Ask for a one-time override from a human reviewer.',
      recommended: false,
      priority: 2,
    },
  ],
};

// =============================================================================
// Decision Options for Reviewers
// =============================================================================

export const REVIEWER_DECISION_OPTIONS: DecisionOption[] = [
  {
    id: 'approve',
    action: 'approve',
    label: 'Approve',
    consequence: 'The agent will proceed with the requested action immediately.',
    impact: 'medium',
    isDefault: false,
    requiresConfirmation: false,
    requiredFields: [],
  },
  {
    id: 'approve_with_conditions',
    action: 'approve',
    label: 'Approve with Conditions',
    consequence: 'The agent can proceed, but must adhere to specified constraints.',
    impact: 'low',
    isDefault: true,
    requiresConfirmation: false,
    requiredFields: ['conditions'],
  },
  {
    id: 'reject',
    action: 'reject',
    label: 'Reject',
    consequence: 'The action will be permanently denied. The agent will be notified with the reason.',
    impact: 'high',
    isDefault: false,
    requiresConfirmation: true,
    requiredFields: ['reason'],
  },
  {
    id: 'request_info',
    action: 'request_info',
    label: 'Request More Information',
    consequence: 'The agent will be asked to provide additional context before a decision is made.',
    impact: 'low',
    isDefault: false,
    requiresConfirmation: false,
    requiredFields: ['questions'],
  },
  {
    id: 'escalate_further',
    action: 'escalate',
    label: 'Escalate to Higher Authority',
    consequence: 'This will be forwarded to a senior reviewer or governance council.',
    impact: 'medium',
    isDefault: false,
    requiresConfirmation: true,
    requiredFields: ['escalation_reason'],
  },
  {
    id: 'defer',
    action: 'defer',
    label: 'Defer Decision',
    consequence: 'The decision will be postponed. Specify when to revisit.',
    impact: 'low',
    isDefault: false,
    requiresConfirmation: false,
    requiredFields: ['defer_until', 'defer_reason'],
  },
];

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Friction Feedback Service
 *
 * Generates clear, actionable feedback when AI actions are denied or escalated.
 */
export class FrictionFeedbackService {
  private understandingSignals: Map<string, AgentUnderstandingSignal[]> = new Map();

  /**
   * Generate friction feedback for a denied action
   */
  generateFeedback(context: FrictionContext): FrictionFeedback {
    const category = this.determineCategory(context);
    const severity = this.determineSeverity(context);
    const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const explanation = this.generateExplanation(context, category, severity, feedbackId);
    const nextSteps = this.generateNextSteps(category, context);
    const decisionOptions = context.decision.action === 'escalate'
      ? this.generateDecisionOptions(context)
      : undefined;

    const feedback: FrictionFeedback = {
      feedbackId,
      intentId: context.intentId,
      agentId: context.agentId,
      explanation,
      nextSteps,
      decisionOptions,
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    };

    // Record metrics
    frictionFeedbackGenerated.inc({ category, severity });
    nextSteps.forEach(step => {
      frictionNextStepsProvided.inc({ action: step.action });
    });

    logger.debug({ feedbackId, category, severity, intentId: context.intentId }, 'Friction feedback generated');

    return feedback;
  }

  /**
   * Generate explanation for denial
   */
  private generateExplanation(
    context: FrictionContext,
    category: DenialReasonCategory,
    severity: DenialSeverity,
    feedbackId: string
  ): DenialExplanation {
    const template = EXPLANATION_TEMPLATES[category];
    const failedConstraint = context.decision.constraintsEvaluated?.find(c => !c.passed);

    const explanation: DenialExplanation = {
      summary: template.summary(context),
      details: template.details(context),
      category,
      severity,
      occurredAt: new Date().toISOString(),
      explanationId: feedbackId,
    };

    // Add triggering rule if available
    if (failedConstraint) {
      explanation.triggeringRule = {
        id: failedConstraint.constraintId,
        name: failedConstraint.constraintId,
        description: failedConstraint.reason,
      };
    }

    // Add trust context if relevant
    if (category === DenialReasonCategory.TRUST_INSUFFICIENT) {
      const requiredLevel = findRequiredLevel(context.decision);
      explanation.trustContext = {
        currentScore: context.decision.trustScore,
        currentLevel: context.decision.trustLevel,
        requiredLevel,
        gap: requiredLevel ? (requiredLevel - context.decision.trustLevel) : undefined,
      };
    }

    return explanation;
  }

  /**
   * Generate next steps based on category
   */
  private generateNextSteps(category: DenialReasonCategory, context: FrictionContext): NextStep[] {
    const baseSteps = NEXT_STEPS_BY_CATEGORY[category] || [];

    // Customize steps based on context
    return baseSteps.map(step => {
      const customized = { ...step };

      // Add action URLs for UI integration
      switch (step.action) {
        case NextStepAction.REQUEST_ESCALATION:
          customized.actionUrl = `/escalations/create?intentId=${context.intentId}`;
          customized.parameters = { intentId: context.intentId, agentId: context.agentId };
          break;
        case NextStepAction.CONTACT_ADMIN:
          customized.actionUrl = `/support/contact?context=friction&intentId=${context.intentId}`;
          break;
        case NextStepAction.INCREASE_TRUST:
          customized.actionUrl = `/agents/${context.agentId}/trust-building`;
          break;
      }

      return customized;
    });
  }

  /**
   * Generate decision options for reviewers
   */
  private generateDecisionOptions(context: FrictionContext): DecisionOption[] {
    // Return standard options with context-specific customization
    return REVIEWER_DECISION_OPTIONS.map(option => ({
      ...option,
      // Add context-specific action URLs
    }));
  }

  /**
   * Determine denial category from decision
   */
  private determineCategory(context: FrictionContext): DenialReasonCategory {
    const { decision } = context;

    // Check for explicit escalation
    if (decision.action === 'escalate') {
      return DenialReasonCategory.ESCALATION_REQUIRED;
    }

    // Check constraints for clues
    const failedConstraint = decision.constraintsEvaluated?.find(c => !c.passed);
    if (failedConstraint) {
      const reason = failedConstraint.reason?.toLowerCase() ?? '';

      if (reason.includes('trust') || reason.includes('score')) {
        return DenialReasonCategory.TRUST_INSUFFICIENT;
      }
      if (reason.includes('policy') || reason.includes('rule')) {
        return DenialReasonCategory.POLICY_VIOLATION;
      }
      if (reason.includes('capability') || reason.includes('feature')) {
        return DenialReasonCategory.CAPABILITY_RESTRICTED;
      }
      if (reason.includes('rate') || reason.includes('limit')) {
        return DenialReasonCategory.RATE_LIMITED;
      }
      if (reason.includes('permission') || reason.includes('unauthorized')) {
        return DenialReasonCategory.PERMISSION_DENIED;
      }
    }

    // Default based on trust level check
    const requiredLevel = findRequiredLevel(decision);
    if (requiredLevel && decision.trustLevel < requiredLevel) {
      return DenialReasonCategory.TRUST_INSUFFICIENT;
    }

    return DenialReasonCategory.POLICY_VIOLATION;
  }

  /**
   * Determine severity based on context
   */
  private determineSeverity(context: FrictionContext): DenialSeverity {
    const { decision, category } = context;

    // High risk categories
    const highRiskCategories = ['financial', 'pii', 'admin', 'delete', 'security'];
    if (category && highRiskCategories.some(hr => category.toLowerCase().includes(hr))) {
      return DenialSeverity.HIGH;
    }

    // Critical if trust level is very low
    if (decision.trustLevel <= 1) {
      return DenialSeverity.CRITICAL;
    }

    // Medium for most policy violations
    if (decision.action === 'deny') {
      return DenialSeverity.MEDIUM;
    }

    // Low for escalations (not a denial, just needs approval)
    if (decision.action === 'escalate') {
      return DenialSeverity.LOW;
    }

    return DenialSeverity.MEDIUM;
  }

  /**
   * Record agent understanding signal (FR122)
   */
  recordUnderstandingSignal(
    agentId: ID,
    feedbackId: string,
    type: AgentUnderstandingSignal['type'],
    responseTimeMs: number,
    context?: Record<string, unknown>
  ): AgentUnderstandingSignal {
    const signal: AgentUnderstandingSignal = {
      signalId: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      agentId,
      feedbackId,
      type,
      timestamp: new Date().toISOString(),
      responseTimeMs,
      context,
    };

    // Store signal for analysis
    const agentSignals = this.understandingSignals.get(agentId) || [];
    agentSignals.push(signal);
    this.understandingSignals.set(agentId, agentSignals);

    // Record metrics
    agentUnderstandingSignals.inc({ type });
    feedbackResponseTime.observe(responseTimeMs / 1000);

    logger.debug({ signalId: signal.signalId, agentId, type, responseTimeMs }, 'Understanding signal recorded');

    return signal;
  }

  /**
   * Get understanding signals for an agent
   */
  getUnderstandingSignals(agentId: ID): AgentUnderstandingSignal[] {
    return this.understandingSignals.get(agentId) || [];
  }

  /**
   * Analyze understanding patterns for an agent
   */
  analyzeUnderstandingPatterns(agentId: ID): {
    totalSignals: number;
    acknowledgedRate: number;
    confusionRate: number;
    retryRate: number;
    abandonmentRate: number;
    avgResponseTimeMs: number;
    recommendations: string[];
  } {
    const signals = this.getUnderstandingSignals(agentId);
    if (signals.length === 0) {
      return {
        totalSignals: 0,
        acknowledgedRate: 0,
        confusionRate: 0,
        retryRate: 0,
        abandonmentRate: 0,
        avgResponseTimeMs: 0,
        recommendations: [],
      };
    }

    const counts: Record<string, number> = {
      acknowledged: 0,
      confused: 0,
      retried_same: 0,
      retried_modified: 0,
      escalated: 0,
      abandoned: 0,
    };

    let totalResponseTime = 0;

    for (const signal of signals) {
      counts[signal.type] = (counts[signal.type] || 0) + 1;
      totalResponseTime += signal.responseTimeMs;
    }

    const total = signals.length;
    const acknowledgedRate = counts.acknowledged / total;
    const confusionRate = counts.confused / total;
    const retryRate = (counts.retried_same + counts.retried_modified) / total;
    const abandonmentRate = counts.abandoned / total;
    const avgResponseTimeMs = totalResponseTime / total;

    // Generate recommendations
    const recommendations: string[] = [];

    if (confusionRate > 0.3) {
      recommendations.push('High confusion rate detected. Consider simplifying denial messages for this agent.');
    }
    if (counts.retried_same > counts.retried_modified) {
      recommendations.push('Agent often retries without modification. Clearer next steps may help.');
    }
    if (abandonmentRate > 0.2) {
      recommendations.push('High abandonment rate. Consider offering easier alternatives.');
    }
    if (avgResponseTimeMs > 60000) {
      recommendations.push('Slow response times. Agent may need more immediate guidance.');
    }

    return {
      totalSignals: total,
      acknowledgedRate,
      confusionRate,
      retryRate,
      abandonmentRate,
      avgResponseTimeMs,
      recommendations,
    };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find required trust level from decision constraints
 */
function findRequiredLevel(decision: Decision): TrustLevel | undefined {
  for (const constraint of decision.constraintsEvaluated ?? []) {
    if (!constraint.passed && constraint.details) {
      const details = constraint.details as Record<string, unknown>;
      if (typeof details.requiredLevel === 'number') {
        return details.requiredLevel as TrustLevel;
      }
    }
  }
  return undefined;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new friction feedback service
 */
export function createFrictionFeedbackService(): FrictionFeedbackService {
  return new FrictionFeedbackService();
}
