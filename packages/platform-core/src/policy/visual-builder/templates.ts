/**
 * Policy Templates Library
 *
 * Provides pre-built policy templates for common governance scenarios.
 * Implements FR149 for Epic 4.
 *
 * Features:
 * - Common use case templates
 * - Template customization
 * - Template categories
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import type { ControlAction } from '../../common/types.js';
import type { VisualPolicyBlock, VisualRuleBlock, VisualConditionBlock } from './index.js';

const logger = createLogger({ component: 'policy-templates' });

// =============================================================================
// Types
// =============================================================================

/**
 * Template category
 */
export const TemplateCategory = {
  DATA_PROTECTION: 'data_protection',
  ACCESS_CONTROL: 'access_control',
  FINANCIAL: 'financial',
  COMPLIANCE: 'compliance',
  OPERATIONAL: 'operational',
  SECURITY: 'security',
} as const;

export type TemplateCategory = (typeof TemplateCategory)[keyof typeof TemplateCategory];

/**
 * Template metadata
 */
export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  useCases: string[];
  policy: VisualPolicyBlock;
  /** Variables that can be customized */
  variables: TemplateVariable[];
  /** Version of template */
  version: string;
  /** Author/source */
  author: string;
}

/**
 * Template variable for customization
 */
export interface TemplateVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'enum';
  defaultValue: unknown;
  required: boolean;
  enumValues?: { value: string; label: string }[];
  /** Path in the policy where this variable is used */
  paths: string[];
}

// =============================================================================
// Built-in Templates
// =============================================================================

/**
 * Helper to create a condition block
 */
function condition(
  field: string,
  operator: string,
  value?: unknown,
  type: 'field' | 'trust' | 'time' = 'field'
): VisualConditionBlock {
  return {
    id: randomUUID(),
    type,
    field,
    operator: operator as any,
    value,
  };
}

/**
 * Helper to create a condition group
 */
function group(operator: 'and' | 'or', children: VisualConditionBlock[]): VisualConditionBlock {
  return {
    id: randomUUID(),
    type: 'group',
    operator,
    children,
  };
}

/**
 * Helper to create a rule
 */
function rule(
  name: string,
  priority: number,
  cond: VisualConditionBlock,
  action: ControlAction,
  options?: {
    description?: string;
    reason?: string;
    escalateTo?: string;
    escalationTimeout?: string;
  }
): VisualRuleBlock {
  return {
    id: randomUUID(),
    name,
    description: options?.description,
    priority,
    enabled: true,
    condition: cond,
    action: {
      action,
      reason: options?.reason,
      escalateTo: options?.escalateTo,
      escalationTimeout: options?.escalationTimeout,
    },
  };
}

/**
 * Built-in policy templates
 */
export const POLICY_TEMPLATES: PolicyTemplate[] = [
  // ==========================================================================
  // Data Protection Templates
  // ==========================================================================
  {
    id: 'tpl-pii-protection',
    name: 'PII Data Protection',
    description: 'Prevents unauthorized access to personally identifiable information (PII)',
    category: TemplateCategory.DATA_PROTECTION,
    tags: ['pii', 'privacy', 'gdpr', 'ccpa'],
    useCases: [
      'Block PII access for low-trust agents',
      'Escalate PII modifications to humans',
      'Log all PII access attempts',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'minTrustLevel',
        description: 'Minimum trust level required for PII access',
        type: 'number',
        defaultValue: 4,
        required: true,
        paths: ['rules[0].condition.value'],
      },
      {
        name: 'escalationRole',
        description: 'Role to escalate PII modifications to',
        type: 'string',
        defaultValue: 'data-protection-officer',
        required: true,
        paths: ['rules[1].action.escalateTo'],
      },
    ],
    policy: {
      name: 'PII Data Protection',
      description: 'Protects personally identifiable information with trust-based access control',
      rules: [
        rule(
          'Block PII Access - Low Trust',
          100,
          group('and', [
            condition('intent.resource', 'contains', 'pii'),
            condition('trust.level', 'less_than', 4, 'trust'),
          ]),
          'deny',
          {
            description: 'Deny PII access for agents below trust level 4',
            reason: 'Insufficient trust level for PII access. Minimum level 4 required.',
          }
        ),
        rule(
          'Escalate PII Modifications',
          200,
          group('and', [
            condition('intent.resource', 'contains', 'pii'),
            condition('intent.action', 'in', ['write', 'update', 'delete']),
          ]),
          'escalate',
          {
            description: 'Escalate any modifications to PII data',
            reason: 'PII modification requires human approval',
            escalateTo: 'data-protection-officer',
            escalationTimeout: 'PT4H',
          }
        ),
      ],
      defaultAction: 'allow',
      defaultReason: 'No PII protection rule triggered',
    },
  },

  {
    id: 'tpl-sensitive-data-classification',
    name: 'Sensitive Data Classification',
    description: 'Enforces access controls based on data sensitivity levels',
    category: TemplateCategory.DATA_PROTECTION,
    tags: ['classification', 'sensitivity', 'data-loss-prevention'],
    useCases: [
      'Restrict access based on data classification',
      'Require higher trust for sensitive data',
      'Block confidential data exports',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'confidentialMinTrust',
        description: 'Minimum trust level for confidential data',
        type: 'number',
        defaultValue: 5,
        required: true,
        paths: ['rules[0].condition.children[1].value'],
      },
    ],
    policy: {
      name: 'Sensitive Data Classification',
      description: 'Controls access based on data sensitivity classification',
      rules: [
        rule(
          'Block Confidential Access - Untrusted',
          100,
          group('and', [
            condition('intent.parameters.classification', 'equals', 'confidential'),
            condition('trust.level', 'less_than', 5, 'trust'),
          ]),
          'deny',
          {
            description: 'Block confidential data access for low-trust agents',
            reason: 'Confidential data requires trust level 5 or higher',
          }
        ),
        rule(
          'Constrain Sensitive Data Export',
          200,
          group('and', [
            condition('intent.action', 'equals', 'export'),
            condition('intent.parameters.classification', 'in', ['sensitive', 'confidential']),
          ]),
          'constrain',
          {
            description: 'Apply constraints to sensitive data exports',
            reason: 'Sensitive data exports are logged and monitored',
          }
        ),
      ],
      defaultAction: 'allow',
    },
  },

  // ==========================================================================
  // Access Control Templates
  // ==========================================================================
  {
    id: 'tpl-trust-gate',
    name: 'Trust Level Gate',
    description: 'Requires minimum trust level for specific actions',
    category: TemplateCategory.ACCESS_CONTROL,
    tags: ['trust', 'access-control', 'gate'],
    useCases: [
      'Restrict high-risk actions to trusted agents',
      'Graduated capability access',
      'Trust-based permission tiers',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'minTrustLevel',
        description: 'Minimum trust level required',
        type: 'number',
        defaultValue: 3,
        required: true,
        paths: ['rules[0].condition.value'],
      },
      {
        name: 'protectedActions',
        description: 'Actions that require the trust gate',
        type: 'array',
        defaultValue: ['delete', 'modify', 'execute'],
        required: true,
        paths: ['rules[0].condition.children[0].value'],
      },
    ],
    policy: {
      name: 'Trust Level Gate',
      description: 'Enforces minimum trust level for specific actions',
      rules: [
        rule(
          'Trust Gate',
          100,
          group('and', [
            condition('intent.action', 'in', ['delete', 'modify', 'execute']),
            condition('trust.level', 'less_than', 3, 'trust'),
          ]),
          'deny',
          {
            description: 'Deny protected actions for low-trust agents',
            reason: 'This action requires a minimum trust level of 3. Complete more tasks successfully to increase your trust.',
          }
        ),
      ],
      defaultAction: 'allow',
    },
  },

  {
    id: 'tpl-sandbox-restrictions',
    name: 'Sandbox Restrictions',
    description: 'Restricts sandbox (T0) agents to safe operations only',
    category: TemplateCategory.ACCESS_CONTROL,
    tags: ['sandbox', 't0', 'new-agents', 'onboarding'],
    useCases: [
      'Restrict new agents to read-only operations',
      'Block external communications for sandbox agents',
      'Safe onboarding for untested agents',
    ],
    version: '1.0.0',
    author: 'Vorion',
    policy: {
      name: 'Sandbox Restrictions',
      description: 'Limits sandbox tier agents to safe operations',
      rules: [
        rule(
          'Sandbox - Read Only',
          100,
          group('and', [
            condition('trust.level', 'equals', 0, 'trust'),
            condition('intent.action', 'not_in', ['read', 'list', 'describe']),
          ]),
          'deny',
          {
            description: 'Sandbox agents can only read, not modify',
            reason: 'Sandbox agents are restricted to read-only operations until trust is established',
          }
        ),
        rule(
          'Sandbox - No External',
          150,
          group('and', [
            condition('trust.level', 'equals', 0, 'trust'),
            condition('intent.resource', 'starts_with', 'external:'),
          ]),
          'deny',
          {
            description: 'Block sandbox agents from external resources',
            reason: 'External resource access is not available in sandbox tier',
          }
        ),
      ],
      defaultAction: 'allow',
    },
    variables: [],
  },

  // ==========================================================================
  // Financial Templates
  // ==========================================================================
  {
    id: 'tpl-financial-limits',
    name: 'Financial Transaction Limits',
    description: 'Enforces approval thresholds for financial transactions',
    category: TemplateCategory.FINANCIAL,
    tags: ['financial', 'transactions', 'approval', 'limits'],
    useCases: [
      'Auto-approve small transactions',
      'Escalate medium transactions',
      'Block large transactions without approval',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'autoApproveLimit',
        description: 'Maximum amount for auto-approval',
        type: 'number',
        defaultValue: 1000,
        required: true,
        paths: ['rules[0].condition.children[1].value'],
      },
      {
        name: 'escalationLimit',
        description: 'Amount requiring escalation',
        type: 'number',
        defaultValue: 10000,
        required: true,
        paths: ['rules[1].condition.children[1].value'],
      },
      {
        name: 'blockLimit',
        description: 'Amount that is blocked without pre-approval',
        type: 'number',
        defaultValue: 50000,
        required: true,
        paths: ['rules[2].condition.children[1].value'],
      },
    ],
    policy: {
      name: 'Financial Transaction Limits',
      description: 'Tiered approval for financial transactions',
      target: {
        intentTypes: ['financial', 'payment', 'transfer'],
      },
      rules: [
        rule(
          'Auto-Approve Small Transactions',
          100,
          group('and', [
            condition('intent.category', 'equals', 'financial'),
            condition('intent.parameters.amount', 'less_than_or_equal', 1000),
            condition('trust.level', 'greater_than_or_equal', 3, 'trust'),
          ]),
          'allow',
          {
            description: 'Auto-approve transactions under $1,000 for trusted agents',
            reason: 'Transaction approved - within auto-approval limit',
          }
        ),
        rule(
          'Escalate Medium Transactions',
          200,
          group('and', [
            condition('intent.category', 'equals', 'financial'),
            condition('intent.parameters.amount', 'greater_than', 1000),
            condition('intent.parameters.amount', 'less_than_or_equal', 10000),
          ]),
          'escalate',
          {
            description: 'Escalate transactions $1,000-$10,000',
            reason: 'Transaction amount requires supervisor approval',
            escalateTo: 'finance-supervisor',
            escalationTimeout: 'PT2H',
          }
        ),
        rule(
          'Block Large Transactions',
          300,
          group('and', [
            condition('intent.category', 'equals', 'financial'),
            condition('intent.parameters.amount', 'greater_than', 50000),
          ]),
          'deny',
          {
            description: 'Block transactions over $50,000',
            reason: 'Transaction exceeds maximum automated limit. Submit through formal approval process.',
          }
        ),
      ],
      defaultAction: 'escalate',
      defaultReason: 'Financial transaction requires review',
    },
  },

  // ==========================================================================
  // Compliance Templates
  // ==========================================================================
  {
    id: 'tpl-business-hours',
    name: 'Business Hours Restrictions',
    description: 'Restricts certain actions to business hours only',
    category: TemplateCategory.COMPLIANCE,
    tags: ['time', 'business-hours', 'schedule'],
    useCases: [
      'Block production changes outside business hours',
      'Require escalation for after-hours operations',
      'Audit after-hours activity',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'startHour',
        description: 'Business hours start (24h format)',
        type: 'number',
        defaultValue: 9,
        required: true,
        paths: ['rules[0].condition.children[0].value'],
      },
      {
        name: 'endHour',
        description: 'Business hours end (24h format)',
        type: 'number',
        defaultValue: 17,
        required: true,
        paths: ['rules[0].condition.children[1].value'],
      },
    ],
    policy: {
      name: 'Business Hours Restrictions',
      description: 'Limits production changes to business hours',
      rules: [
        rule(
          'After Hours - Production Changes',
          100,
          group('and', [
            group('or', [
              condition('time.hour', 'less_than', 9, 'time'),
              condition('time.hour', 'greater_than_or_equal', 17, 'time'),
            ]),
            condition('intent.resource', 'starts_with', 'production:'),
            condition('intent.action', 'in', ['deploy', 'modify', 'delete']),
          ]),
          'escalate',
          {
            description: 'Escalate production changes outside business hours',
            reason: 'Production changes outside business hours require on-call approval',
            escalateTo: 'on-call-engineer',
            escalationTimeout: 'PT30M',
          }
        ),
        rule(
          'Weekend - Block Non-Emergency',
          200,
          group('and', [
            condition('time.dayOfWeek', 'in', [0, 6], 'time'),
            condition('intent.parameters.priority', 'not_equals', 'emergency'),
            condition('intent.resource', 'starts_with', 'production:'),
          ]),
          'deny',
          {
            description: 'Block non-emergency production changes on weekends',
            reason: 'Non-emergency production changes are not allowed on weekends',
          }
        ),
      ],
      defaultAction: 'allow',
    },
  },

  // ==========================================================================
  // Security Templates
  // ==========================================================================
  {
    id: 'tpl-admin-actions',
    name: 'Administrative Action Controls',
    description: 'Enforces strict controls on administrative operations',
    category: TemplateCategory.SECURITY,
    tags: ['admin', 'security', 'high-privilege'],
    useCases: [
      'Require highest trust for admin actions',
      'Escalate all admin operations',
      'Block admin actions for non-verified agents',
    ],
    version: '1.0.0',
    author: 'Vorion',
    policy: {
      name: 'Administrative Action Controls',
      description: 'Strict controls for administrative operations',
      rules: [
        rule(
          'Admin - Require Certified Trust',
          100,
          group('and', [
            condition('intent.category', 'equals', 'administrative'),
            condition('trust.level', 'less_than', 6, 'trust'),
          ]),
          'deny',
          {
            description: 'Require certified trust level for admin actions',
            reason: 'Administrative operations require Certified (T6) trust level',
          }
        ),
        rule(
          'Admin - Always Escalate',
          200,
          condition('intent.category', 'equals', 'administrative'),
          'escalate',
          {
            description: 'Escalate all administrative actions for review',
            reason: 'Administrative operations require human approval',
            escalateTo: 'security-admin',
            escalationTimeout: 'PT1H',
          }
        ),
      ],
      defaultAction: 'allow',
    },
    variables: [],
  },

  {
    id: 'tpl-rate-limiting',
    name: 'Action Rate Limiting',
    description: 'Prevents excessive action frequency from any single agent',
    category: TemplateCategory.SECURITY,
    tags: ['rate-limit', 'abuse-prevention', 'throttling'],
    useCases: [
      'Prevent automated abuse',
      'Throttle new agents',
      'Protect resources from overload',
    ],
    version: '1.0.0',
    author: 'Vorion',
    variables: [
      {
        name: 'maxActionsPerHour',
        description: 'Maximum actions per hour per agent',
        type: 'number',
        defaultValue: 100,
        required: true,
        paths: ['rules[0].condition.children[1].value'],
      },
    ],
    policy: {
      name: 'Action Rate Limiting',
      description: 'Limits action frequency to prevent abuse',
      rules: [
        rule(
          'Rate Limit - New Agents',
          100,
          group('and', [
            condition('trust.level', 'less_than', 2, 'trust'),
            condition('entity.attributes.actionsThisHour', 'greater_than', 10),
          ]),
          'deny',
          {
            description: 'Strict rate limit for new agents',
            reason: 'Rate limit exceeded. New agents are limited to 10 actions per hour.',
          }
        ),
        rule(
          'Rate Limit - Standard',
          200,
          condition('entity.attributes.actionsThisHour', 'greater_than', 100),
          'constrain',
          {
            description: 'Apply constraints when approaching rate limit',
            reason: 'High action rate detected. Actions will be throttled.',
          }
        ),
      ],
      defaultAction: 'allow',
    },
  },
];

// =============================================================================
// Template Service
// =============================================================================

/**
 * Policy Template Service
 *
 * Provides access to built-in and custom policy templates.
 */
export class PolicyTemplateService {
  private customTemplates: Map<string, PolicyTemplate> = new Map();

  /**
   * Get all available templates
   */
  getTemplates(): PolicyTemplate[] {
    return [...POLICY_TEMPLATES, ...this.customTemplates.values()];
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: TemplateCategory): PolicyTemplate[] {
    return this.getTemplates().filter(t => t.category === category);
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): PolicyTemplate | undefined {
    return POLICY_TEMPLATES.find(t => t.id === id) ?? this.customTemplates.get(id);
  }

  /**
   * Search templates
   */
  searchTemplates(query: string): PolicyTemplate[] {
    const lowerQuery = query.toLowerCase();
    return this.getTemplates().filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags.some(tag => tag.includes(lowerQuery))
    );
  }

  /**
   * Get all categories with counts
   */
  getCategories(): { category: TemplateCategory; count: number }[] {
    const counts = new Map<TemplateCategory, number>();

    for (const template of this.getTemplates()) {
      counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
  }

  /**
   * Instantiate a template with variable substitution
   */
  instantiate(
    templateId: string,
    variables: Record<string, unknown>
  ): { policy: VisualPolicyBlock; errors: string[] } {
    const template = this.getTemplate(templateId);
    if (!template) {
      return { policy: null as any, errors: [`Template not found: ${templateId}`] };
    }

    const errors: string[] = [];

    // Deep clone the policy
    const policy = JSON.parse(JSON.stringify(template.policy)) as VisualPolicyBlock;

    // Apply variable substitutions
    for (const variable of template.variables) {
      const value = variables[variable.name] ?? variable.defaultValue;

      if (variable.required && (value === undefined || value === null)) {
        errors.push(`Required variable missing: ${variable.name}`);
        continue;
      }

      // Apply to each path
      for (const path of variable.paths) {
        try {
          this.setValueAtPath(policy, path, value);
        } catch (error) {
          errors.push(`Failed to set ${variable.name} at ${path}: ${error}`);
        }
      }
    }

    // Mark as instantiated from template
    policy.templateId = templateId;

    logger.debug({ templateId, variableCount: Object.keys(variables).length }, 'Template instantiated');

    return { policy, errors };
  }

  /**
   * Add a custom template
   */
  addCustomTemplate(template: PolicyTemplate): void {
    this.customTemplates.set(template.id, template);
    logger.info({ templateId: template.id, name: template.name }, 'Custom template added');
  }

  /**
   * Remove a custom template
   */
  removeCustomTemplate(id: string): boolean {
    const removed = this.customTemplates.delete(id);
    if (removed) {
      logger.info({ templateId: id }, 'Custom template removed');
    }
    return removed;
  }

  /**
   * Set value at a path in an object
   */
  private setValueAtPath(obj: any, path: string, value: unknown): void {
    const parts = path.match(/[^.\[\]]+|\[\d+\]/g) ?? [];

    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part.startsWith('[')) {
        const index = parseInt(part.slice(1, -1), 10);
        current = current[index];
      } else {
        current = current[part];
      }

      if (current === undefined) {
        throw new Error(`Path not found: ${path}`);
      }
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart.startsWith('[')) {
      const index = parseInt(lastPart.slice(1, -1), 10);
      current[index] = value;
    } else {
      current[lastPart] = value;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a policy template service instance
 */
export function createPolicyTemplateService(): PolicyTemplateService {
  return new PolicyTemplateService();
}
