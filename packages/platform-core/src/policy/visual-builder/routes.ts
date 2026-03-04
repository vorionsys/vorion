/**
 * Visual Policy Builder API Routes
 *
 * REST endpoints for the visual policy builder.
 * Implements FR144-150 API surface.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { createVisualPolicyBuilder, type VisualPolicyBlock, type VisualRuleBlock } from './index.js';
import { createPolicySimulator, type HistoricalIntent, type SimulationOptions } from './simulator.js';
import { createPolicyTemplateService, TemplateCategory } from './templates.js';
import { createPolicyInheritanceService, type PolicyInheritance } from './inheritance.js';
import { createPolicyPropagationService, type PropagationOptions } from './propagation.js';

const logger = createLogger({ component: 'visual-policy-routes' });

const builder = createVisualPolicyBuilder();
const simulator = createPolicySimulator();
const templateService = createPolicyTemplateService();
const inheritanceService = createPolicyInheritanceService();
const propagationService = createPolicyPropagationService();

// =============================================================================
// Request Schemas
// =============================================================================

const buildPolicySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  target: z.object({
    intentTypes: z.array(z.string()).optional(),
    entityTypes: z.array(z.string()).optional(),
    trustLevels: z.array(z.number().int().min(0).max(7)).optional(),
    namespaces: z.array(z.string()).optional(),
  }).optional(),
  rules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(10000),
    enabled: z.boolean(),
    condition: z.any(), // Complex nested structure
    action: z.object({
      action: z.enum(['allow', 'deny', 'escalate', 'constrain']),
      reason: z.string().optional(),
      escalateTo: z.string().optional(),
      escalationTimeout: z.string().optional(),
      requireJustification: z.boolean().optional(),
      constraints: z.record(z.unknown()).optional(),
    }),
  })),
  defaultAction: z.enum(['allow', 'deny', 'escalate', 'constrain']),
  defaultReason: z.string().optional(),
  parentPolicyId: z.string().uuid().optional(),
  templateId: z.string().optional(),
});

const simulatePolicySchema = z.object({
  policy: buildPolicySchema,
  daysBack: z.number().int().min(1).max(90).optional(),
  maxIntents: z.number().int().min(100).max(50000).optional(),
  includeDetails: z.boolean().optional(),
});

const instantiateTemplateSchema = z.object({
  templateId: z.string(),
  variables: z.record(z.unknown()),
});

const setInheritanceSchema = z.object({
  policyId: z.string().uuid(),
  parentPolicyId: z.string().uuid(),
  inheritTarget: z.boolean().optional(),
  inheritDefaultAction: z.boolean().optional(),
  excludedRuleIds: z.array(z.string()).optional(),
  priorityOffset: z.number().int().optional(),
});

const propagatePolicySchema = z.object({
  policyId: z.string().uuid(),
  policyName: z.string(),
  version: z.number().int().positive(),
  action: z.enum(['created', 'updated', 'activated', 'deactivated', 'deleted']),
  checksum: z.string(),
  includeDefinition: z.boolean().optional(),
  targetAgentIds: z.array(z.string().uuid()).optional(),
  targetNamespaces: z.array(z.string()).optional(),
  ackTimeoutMs: z.number().int().positive().optional(),
  minAckPercentage: z.number().min(0).max(100).optional(),
});

const acknowledgeSchema = z.object({
  agentId: z.string().uuid(),
  policyId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['received', 'applied', 'error']),
  errorMessage: z.string().optional(),
});

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register visual policy builder routes
 */
export async function registerVisualPolicyBuilderRoutes(app: FastifyInstance): Promise<void> {
  // =========================================================================
  // Field Registry
  // =========================================================================

  /**
   * GET /api/v1/policy-builder/fields
   *
   * Get all available fields for dropdown selection.
   */
  app.get('/api/v1/policy-builder/fields', async (_request, reply) => {
    const fields = builder.getFields();
    const categories = ['intent', 'entity', 'trust', 'time', 'custom'] as const;

    return reply.status(200).send({
      fields,
      byCategory: Object.fromEntries(
        categories.map(cat => [cat, fields.filter(f => f.category === cat)])
      ),
      totalFields: fields.length,
    });
  });

  /**
   * GET /api/v1/policy-builder/operators
   *
   * Get all available operators.
   */
  app.get('/api/v1/policy-builder/operators', async (_request, reply) => {
    const operators = builder.getAllOperators();

    return reply.status(200).send({
      operators,
      totalOperators: operators.length,
    });
  });

  /**
   * GET /api/v1/policy-builder/operators/:fieldPath
   *
   * Get operators compatible with a specific field.
   */
  app.get<{
    Params: { fieldPath: string };
  }>('/api/v1/policy-builder/operators/:fieldPath', async (request, reply) => {
    const operators = builder.getOperatorsForField(request.params.fieldPath);

    return reply.status(200).send({
      fieldPath: request.params.fieldPath,
      operators,
    });
  });

  // =========================================================================
  // Policy Building
  // =========================================================================

  /**
   * POST /api/v1/policy-builder/build
   *
   * Build a PolicyDefinition from visual blocks.
   */
  app.post<{
    Body: z.infer<typeof buildPolicySchema>;
  }>('/api/v1/policy-builder/build', async (request, reply) => {
    try {
      const visual = buildPolicySchema.parse(request.body) as VisualPolicyBlock;
      const { policy, validation } = builder.buildPolicy(visual);

      if (!validation.valid) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Policy has validation errors',
          validation,
        });
      }

      return reply.status(200).send({
        policy,
        validation,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  /**
   * POST /api/v1/policy-builder/validate
   *
   * Validate a visual policy without building.
   */
  app.post<{
    Body: z.infer<typeof buildPolicySchema>;
  }>('/api/v1/policy-builder/validate', async (request, reply) => {
    try {
      const visual = buildPolicySchema.parse(request.body) as VisualPolicyBlock;
      const validation = builder.validateVisualPolicy(visual);

      return reply.status(200).send(validation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  /**
   * GET /api/v1/policy-builder/empty-rule
   *
   * Get an empty rule block template.
   */
  app.get('/api/v1/policy-builder/empty-rule', async (_request, reply) => {
    const rule = builder.createEmptyRule();
    return reply.status(200).send(rule);
  });

  // =========================================================================
  // Simulation
  // =========================================================================

  /**
   * POST /api/v1/policy-builder/simulate
   *
   * Simulate a policy against historical data.
   */
  app.post<{
    Body: z.infer<typeof simulatePolicySchema>;
  }>('/api/v1/policy-builder/simulate', async (request, reply) => {
    try {
      const params = simulatePolicySchema.parse(request.body);
      const tenantId = (request.user as { tenantId?: string })?.tenantId;

      if (!tenantId) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Tenant ID required' });
      }

      // Build the policy first
      const { policy, validation } = builder.buildPolicy(params.policy as VisualPolicyBlock);

      if (!validation.valid) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Policy has validation errors',
          validation,
        });
      }

      // In production, fetch historical intents from database
      // For now, return a simulated response
      const mockHistoricalData: HistoricalIntent[] = [];

      const options: SimulationOptions = {
        policy,
        policyName: params.policy.name,
        tenantId,
        daysBack: params.daysBack,
        maxIntents: params.maxIntents,
        includeDetails: params.includeDetails,
      };

      const report = await simulator.simulate(options, mockHistoricalData);
      const impact = simulator.analyzeImpact(report);

      return reply.status(200).send({
        report,
        impact,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // =========================================================================
  // Templates
  // =========================================================================

  /**
   * GET /api/v1/policy-builder/templates
   *
   * Get all available policy templates.
   */
  app.get('/api/v1/policy-builder/templates', async (_request, reply) => {
    const templates = templateService.getTemplates();
    const categories = templateService.getCategories();

    return reply.status(200).send({
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        tags: t.tags,
        useCases: t.useCases,
        version: t.version,
        author: t.author,
        variableCount: t.variables.length,
      })),
      categories,
      totalTemplates: templates.length,
    });
  });

  /**
   * GET /api/v1/policy-builder/templates/:templateId
   *
   * Get a specific template with full details.
   */
  app.get<{
    Params: { templateId: string };
  }>('/api/v1/policy-builder/templates/:templateId', async (request, reply) => {
    const template = templateService.getTemplate(request.params.templateId);

    if (!template) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Template not found: ${request.params.templateId}`,
      });
    }

    return reply.status(200).send(template);
  });

  /**
   * GET /api/v1/policy-builder/templates/category/:category
   *
   * Get templates by category.
   */
  app.get<{
    Params: { category: string };
  }>('/api/v1/policy-builder/templates/category/:category', async (request, reply) => {
    const category = request.params.category as TemplateCategory;
    const templates = templateService.getTemplatesByCategory(category);

    return reply.status(200).send({
      category,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        tags: t.tags,
      })),
      count: templates.length,
    });
  });

  /**
   * GET /api/v1/policy-builder/templates/search
   *
   * Search templates.
   */
  app.get<{
    Querystring: { q: string };
  }>('/api/v1/policy-builder/templates/search', async (request, reply) => {
    const query = request.query.q;
    const templates = templateService.searchTemplates(query);

    return reply.status(200).send({
      query,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        tags: t.tags,
      })),
      count: templates.length,
    });
  });

  /**
   * POST /api/v1/policy-builder/templates/instantiate
   *
   * Instantiate a template with variable substitution.
   */
  app.post<{
    Body: z.infer<typeof instantiateTemplateSchema>;
  }>('/api/v1/policy-builder/templates/instantiate', async (request, reply) => {
    try {
      const params = instantiateTemplateSchema.parse(request.body);
      const { policy, errors } = templateService.instantiate(params.templateId, params.variables);

      if (errors.length > 0) {
        return reply.status(400).send({
          error: 'Instantiation Error',
          message: 'Failed to instantiate template',
          errors,
        });
      }

      return reply.status(200).send({
        policy,
        templateId: params.templateId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // =========================================================================
  // Inheritance
  // =========================================================================

  /**
   * POST /api/v1/policy-builder/inheritance
   *
   * Set policy inheritance relationship.
   */
  app.post<{
    Body: z.infer<typeof setInheritanceSchema>;
  }>('/api/v1/policy-builder/inheritance', async (request, reply) => {
    try {
      const params = setInheritanceSchema.parse(request.body);

      const inheritance: PolicyInheritance = {
        policyId: params.policyId,
        parentPolicyId: params.parentPolicyId,
        inheritTarget: params.inheritTarget ?? true,
        inheritDefaultAction: params.inheritDefaultAction ?? true,
        excludedRuleIds: params.excludedRuleIds ?? [],
        priorityOffset: params.priorityOffset ?? 0,
      };

      inheritanceService.setInheritance(inheritance);

      // Validate the inheritance chain
      const validation = inheritanceService.validateInheritance(params.policyId);

      return reply.status(200).send({
        inheritance,
        validation,
        chain: inheritanceService.getInheritanceChain(params.policyId),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  /**
   * DELETE /api/v1/policy-builder/inheritance/:policyId
   *
   * Remove policy inheritance.
   */
  app.delete<{
    Params: { policyId: string };
  }>('/api/v1/policy-builder/inheritance/:policyId', async (request, reply) => {
    const removed = inheritanceService.removeInheritance(request.params.policyId);

    return reply.status(200).send({
      removed,
      policyId: request.params.policyId,
    });
  });

  /**
   * GET /api/v1/policy-builder/inheritance/:policyId/chain
   *
   * Get the inheritance chain for a policy.
   */
  app.get<{
    Params: { policyId: string };
  }>('/api/v1/policy-builder/inheritance/:policyId/chain', async (request, reply) => {
    const chain = inheritanceService.getInheritanceChain(request.params.policyId);
    const validation = inheritanceService.validateInheritance(request.params.policyId);

    return reply.status(200).send({
      policyId: request.params.policyId,
      chain,
      depth: chain.length,
      validation,
    });
  });

  // =========================================================================
  // Propagation
  // =========================================================================

  /**
   * POST /api/v1/policy-builder/propagate
   *
   * Propagate a policy update to agents.
   */
  app.post<{
    Body: z.infer<typeof propagatePolicySchema>;
  }>('/api/v1/policy-builder/propagate', async (request, reply) => {
    try {
      const params = propagatePolicySchema.parse(request.body);

      const event = propagationService.createEvent(
        params.policyId,
        params.policyName,
        params.version,
        params.action,
        params.checksum
      );

      const options: PropagationOptions = {
        targetAgentIds: params.targetAgentIds,
        targetNamespaces: params.targetNamespaces,
        includeDefinition: params.includeDefinition,
        ackTimeoutMs: params.ackTimeoutMs,
        minAckPercentage: params.minAckPercentage,
      };

      const status = await propagationService.propagate(event, options);

      return reply.status(200).send(status);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  /**
   * POST /api/v1/policy-builder/propagate/acknowledge
   *
   * Record a policy acknowledgment from an agent.
   */
  app.post<{
    Body: z.infer<typeof acknowledgeSchema>;
  }>('/api/v1/policy-builder/propagate/acknowledge', async (request, reply) => {
    try {
      const params = acknowledgeSchema.parse(request.body);

      propagationService.recordAcknowledgment({
        agentId: params.agentId,
        policyId: params.policyId,
        version: params.version,
        acknowledgedAt: new Date().toISOString(),
        latencyMs: Date.now(), // Calculate from propagation start
        status: params.status,
        errorMessage: params.errorMessage,
      });

      return reply.status(200).send({
        acknowledged: true,
        agentId: params.agentId,
        policyId: params.policyId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  /**
   * GET /api/v1/policy-builder/propagate/:eventId
   *
   * Get propagation status.
   */
  app.get<{
    Params: { eventId: string };
  }>('/api/v1/policy-builder/propagate/:eventId', async (request, reply) => {
    const status = propagationService.getStatus(request.params.eventId);

    if (!status) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Propagation not found: ${request.params.eventId}`,
      });
    }

    return reply.status(200).send(status);
  });

  /**
   * GET /api/v1/policy-builder/propagate/recent
   *
   * Get recent propagations.
   */
  app.get<{
    Querystring: { limit?: number };
  }>('/api/v1/policy-builder/propagate/recent', async (request, reply) => {
    const limit = request.query.limit ?? 10;
    const propagations = propagationService.getRecentPropagations(limit);

    return reply.status(200).send({
      propagations,
      count: propagations.length,
    });
  });

  logger.info('Visual policy builder routes registered');
}
