/**
 * Fastify Middleware for AI Governance
 * Integrates AI governance controls into Fastify endpoints
 * Vorion Security Platform
 */

import { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { ModelRegistry } from './model-registry.js';
import { AccessPolicyManager, AccessRequestContext } from './access-policy.js';
import { PromptInjectionDetector } from './prompt-injection.js';
import { OutputFilter } from './output-filter.js';
import { AuditTrail } from './audit-trail.js';
import { BiasDetector } from './bias-detection.js';
import { AIRateLimiter } from './rate-limiter.js';
import {
  AuditLevel,
  TokenUsage,
  InjectionDetectionResult,
  OutputFilterResult,
} from './types.js';

/**
 * AI Governance middleware options
 */
export interface AIGovernanceMiddlewareOptions {
  modelRegistry: ModelRegistry;
  accessPolicyManager: AccessPolicyManager;
  injectionDetector: PromptInjectionDetector;
  outputFilter: OutputFilter;
  auditTrail: AuditTrail;
  biasDetector: BiasDetector;
  rateLimiter: AIRateLimiter;
  enabled?: boolean;
  skipPaths?: string[];
  extractModelId?: (request: FastifyRequest) => string;
  extractUserId?: (request: FastifyRequest) => string;
  extractRoles?: (request: FastifyRequest) => string[];
  extractDepartment?: (request: FastifyRequest) => string;
  extractPrompt?: (request: FastifyRequest) => string;
  onAccessDenied?: (request: FastifyRequest, reply: FastifyReply, reason: string) => Promise<void>;
  onInjectionDetected?: (
    request: FastifyRequest,
    reply: FastifyReply,
    result: InjectionDetectionResult
  ) => Promise<void>;
  onRateLimitExceeded?: (
    request: FastifyRequest,
    reply: FastifyReply,
    status: { retryAfterSeconds?: number }
  ) => Promise<void>;
}

/**
 * Extended request with AI governance context
 */
declare module 'fastify' {
  interface FastifyRequest {
    aiGovernance?: AIGovernanceContext;
  }
}

/**
 * AI Governance context attached to requests
 */
export interface AIGovernanceContext {
  modelId: string;
  userId: string;
  sessionId: string;
  roles: string[];
  department: string;
  auditLevel: AuditLevel;
  injectionResult?: InjectionDetectionResult;
  sanitizedPrompt?: string;
  startTime: number;
  tokenEstimate?: number;
}

/**
 * AI model response wrapper
 */
export interface AIModelResponse {
  content: string;
  tokenUsage: TokenUsage;
  modelVersion: string;
  metadata?: Record<string, unknown>;
}

/**
 * Default extractors
 */
const defaultExtractors = {
  extractModelId: (request: FastifyRequest): string => {
    const body = request.body as Record<string, unknown> | undefined;
    const params = request.params as Record<string, unknown> | undefined;
    return (
      (body?.modelId as string) ||
      (params?.modelId as string) ||
      (request.headers['x-model-id'] as string) ||
      'default'
    );
  },
  extractUserId: (request: FastifyRequest): string => {
    const user = (request as unknown as { user?: { id?: string } }).user;
    return (
      user?.id ||
      (request.headers['x-user-id'] as string) ||
      'anonymous'
    );
  },
  extractRoles: (request: FastifyRequest): string[] => {
    const user = (request as unknown as { user?: { roles?: string[] } }).user;
    const headerRoles = request.headers['x-user-roles'] as string;
    return user?.roles || (headerRoles ? headerRoles.split(',') : ['user']);
  },
  extractDepartment: (request: FastifyRequest): string => {
    const user = (request as unknown as { user?: { department?: string } }).user;
    return (
      user?.department ||
      (request.headers['x-department'] as string) ||
      'default'
    );
  },
  extractPrompt: (request: FastifyRequest): string => {
    const body = request.body as Record<string, unknown> | undefined;
    return (
      (body?.prompt as string) ||
      (body?.message as string) ||
      (body?.input as string) ||
      ''
    );
  },
};

/**
 * Create AI Governance middleware plugin
 */
const aiGovernancePlugin: FastifyPluginCallback<AIGovernanceMiddlewareOptions> = (
  fastify: FastifyInstance,
  options: AIGovernanceMiddlewareOptions,
  done: () => void
) => {
  const {
    modelRegistry,
    accessPolicyManager,
    injectionDetector,
    outputFilter,
    auditTrail,
    biasDetector,
    rateLimiter,
    enabled = true,
    skipPaths = [],
    extractModelId = defaultExtractors.extractModelId,
    extractUserId = defaultExtractors.extractUserId,
    extractRoles = defaultExtractors.extractRoles,
    extractDepartment = defaultExtractors.extractDepartment,
    extractPrompt = defaultExtractors.extractPrompt,
    onAccessDenied,
    onInjectionDetected,
    onRateLimitExceeded,
  } = options;

  // Pre-handler hook for AI governance checks
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!enabled) return;

    // Skip non-AI paths
    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    // Skip if not an AI endpoint (customize based on your routing)
    if (!request.url.includes('/ai/') && !request.url.includes('/model/')) {
      return;
    }

    const startTime = Date.now();
    const modelId = extractModelId(request);
    const userId = extractUserId(request);
    const roles = extractRoles(request);
    const department = extractDepartment(request);
    const prompt = extractPrompt(request);
    const sessionId = (request.headers['x-session-id'] as string) || generateSessionId();

    // Initialize governance context
    request.aiGovernance = {
      modelId,
      userId,
      sessionId,
      roles,
      department,
      auditLevel: 'detailed',
      startTime,
    };

    // Check model exists
    const model = await modelRegistry.getModel(modelId);
    if (!model) {
      await auditTrail.logPolicyViolation({
        modelId,
        userId,
        sessionId,
        violation: 'Model not found',
        policyField: 'modelId',
        ipAddress: request.ip,
      });

      if (onAccessDenied) {
        await onAccessDenied(request, reply, 'Model not found');
      } else {
        reply.code(404).send({ error: 'Model not found', modelId });
      }
      return;
    }

    // Check access policy
    const accessContext: AccessRequestContext = {
      userId,
      modelId,
      roles,
      department,
      mfaVerified: request.headers['x-mfa-verified'] === 'true',
      ipAddress: request.ip,
      timestamp: new Date(),
      requestedOperation: request.method,
    };

    const accessDecision = await accessPolicyManager.checkAccess(accessContext);
    request.aiGovernance.auditLevel = accessDecision.auditLevel;

    if (!accessDecision.allowed) {
      await auditTrail.logPolicyViolation({
        modelId,
        userId,
        sessionId,
        violation: accessDecision.reason,
        policyField: accessDecision.violations[0]?.policyField || 'unknown',
        ipAddress: request.ip,
      });

      if (onAccessDenied) {
        await onAccessDenied(request, reply, accessDecision.reason);
      } else {
        reply.code(403).send({
          error: 'Access denied',
          reason: accessDecision.reason,
          violations: accessDecision.violations.map((v) => ({
            type: v.type,
            message: v.message,
          })),
        });
      }
      return;
    }

    // Check rate limits
    const estimatedTokens = estimateTokens(prompt);
    const estimatedCost = estimatedTokens * (model.costPerToken || 0.00001);
    request.aiGovernance.tokenEstimate = estimatedTokens;

    const rateLimitResult = await rateLimiter.checkLimit(
      modelId,
      userId,
      estimatedTokens,
      estimatedCost,
      department
    );

    if (!rateLimitResult.allowed) {
      await auditTrail.logRateLimitExceeded({
        modelId,
        userId,
        sessionId,
        limitType: rateLimitResult.violatedRules[0]?.type || 'unknown',
        currentUsage: rateLimitResult.status.currentUsage.requests,
        limit: rateLimitResult.violatedRules[0]?.limit || 0,
      });

      if (onRateLimitExceeded) {
        await onRateLimitExceeded(request, reply, {
          retryAfterSeconds: rateLimitResult.status.retryAfterSeconds,
        });
      } else {
        reply
          .code(429)
          .header('Retry-After', String(rateLimitResult.status.retryAfterSeconds || 60))
          .send({
            error: 'Rate limit exceeded',
            retryAfterSeconds: rateLimitResult.status.retryAfterSeconds,
            violatedRules: rateLimitResult.violatedRules.map((r) => ({
              type: r.type,
              limit: r.limit,
              window: r.window,
            })),
          });
      }
      return;
    }

    // Check for prompt injection
    if (prompt) {
      const injectionResult = await injectionDetector.analyzeInput(prompt);
      request.aiGovernance.injectionResult = injectionResult;

      if (injectionResult.blocked) {
        await auditTrail.logQuery({
          modelId,
          userId,
          sessionId,
          query: {
            prompt: injectionResult.originalInput,
            sanitizedPrompt: injectionResult.sanitizedInput,
            injectionDetectionResult: injectionResult,
          },
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          auditLevel: request.aiGovernance.auditLevel,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        if (onInjectionDetected) {
          await onInjectionDetected(request, reply, injectionResult);
        } else {
          reply.code(400).send({
            error: 'Request blocked',
            reason: 'Potential prompt injection detected',
            riskScore: injectionResult.riskScore,
            recommendations: injectionResult.recommendations,
          });
        }
        return;
      }

      // Use sanitized prompt if available
      if (injectionResult.sanitizedInput !== injectionResult.originalInput) {
        request.aiGovernance.sanitizedPrompt = injectionResult.sanitizedInput;
      }
    }

    // Record access for rate limiting
    await accessPolicyManager.recordAccess(userId, modelId);
  });

  // Decorate fastify with governance utilities
  fastify.decorate('aiGovernance', {
    /**
     * Process and filter AI model response
     */
    async processResponse(
      request: FastifyRequest,
      response: AIModelResponse
    ): Promise<{
      filteredContent: string;
      filterResult: OutputFilterResult;
      auditEntryId: string;
    }> {
      const ctx = request.aiGovernance;
      if (!ctx) {
        throw new Error('AI Governance context not initialized');
      }

      const latencyMs = Date.now() - ctx.startTime;

      // Filter output
      const filterResult = await outputFilter.filterOutput(response.content);

      // Log response
      const auditEntry = await auditTrail.logResponse({
        modelId: ctx.modelId,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        response: {
          response: response.content,
          filteredResponse: filterResult.filteredOutput,
          filterResult,
          latencyMs,
          modelVersion: response.modelVersion,
        },
        tokenUsage: response.tokenUsage,
        auditLevel: ctx.auditLevel,
      });

      // Record usage for rate limiting
      await rateLimiter.recordUsage(
        ctx.modelId,
        ctx.userId,
        response.tokenUsage.totalTokens,
        response.tokenUsage.totalTokens * 0.00001, // Simplified cost calculation
        ctx.department
      );

      // Record sample for bias detection (if applicable)
      if (response.metadata?.attributes) {
        await biasDetector.recordSample({
          modelId: ctx.modelId,
          timestamp: new Date(),
          input: ctx.sanitizedPrompt || '',
          output: filterResult.filteredOutput,
          attributes: response.metadata.attributes as Record<string, string>,
          userId: ctx.userId,
        });
      }

      return {
        filteredContent: filterResult.filteredOutput,
        filterResult,
        auditEntryId: auditEntry.id,
      };
    },

    /**
     * Log query manually (for custom implementations)
     */
    async logQuery(
      request: FastifyRequest,
      prompt: string,
      tokenUsage: TokenUsage
    ): Promise<string> {
      const ctx = request.aiGovernance;
      if (!ctx) {
        throw new Error('AI Governance context not initialized');
      }

      const entry = await auditTrail.logQuery({
        modelId: ctx.modelId,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        query: {
          prompt,
          sanitizedPrompt: ctx.sanitizedPrompt,
          injectionDetectionResult: ctx.injectionResult,
        },
        tokenUsage,
        auditLevel: ctx.auditLevel,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return entry.id;
    },

    /**
     * Get governance context
     */
    getContext(request: FastifyRequest): AIGovernanceContext | undefined {
      return request.aiGovernance;
    },

    /**
     * Check if prompt needs sanitization
     */
    getSanitizedPrompt(request: FastifyRequest): string | undefined {
      return request.aiGovernance?.sanitizedPrompt;
    },
  });

  done();
};

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Estimate token count from text (rough approximation)
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Create pre-configured AI Governance middleware
 */
export function createAIGovernanceMiddleware(
  options: Partial<AIGovernanceMiddlewareOptions> = {}
): {
  plugin: ReturnType<typeof fp>;
  components: {
    modelRegistry: ModelRegistry;
    accessPolicyManager: AccessPolicyManager;
    injectionDetector: PromptInjectionDetector;
    outputFilter: OutputFilter;
    auditTrail: AuditTrail;
    biasDetector: BiasDetector;
    rateLimiter: AIRateLimiter;
  };
} {
  // Create default components if not provided
  const modelRegistry = options.modelRegistry || new ModelRegistry();
  const accessPolicyManager = options.accessPolicyManager || new AccessPolicyManager();
  const injectionDetector = options.injectionDetector || new PromptInjectionDetector();
  const outputFilter = options.outputFilter || new OutputFilter();
  const auditTrail = options.auditTrail || new AuditTrail();
  const biasDetector = options.biasDetector || new BiasDetector();
  const rateLimiter = options.rateLimiter || new AIRateLimiter();

  const fullOptions: AIGovernanceMiddlewareOptions = {
    modelRegistry,
    accessPolicyManager,
    injectionDetector,
    outputFilter,
    auditTrail,
    biasDetector,
    rateLimiter,
    ...options,
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin: fp(aiGovernancePlugin as any, {
      name: 'ai-governance',
      fastify: '>=4.x',
    }),
    components: {
      modelRegistry,
      accessPolicyManager,
      injectionDetector,
      outputFilter,
      auditTrail,
      biasDetector,
      rateLimiter,
    },
  };
}

/**
 * Type declarations for fastify instance decoration
 */
declare module 'fastify' {
  interface FastifyInstance {
    aiGovernance: {
      processResponse(
        request: FastifyRequest,
        response: AIModelResponse
      ): Promise<{
        filteredContent: string;
        filterResult: OutputFilterResult;
        auditEntryId: string;
      }>;
      logQuery(request: FastifyRequest, prompt: string, tokenUsage: TokenUsage): Promise<string>;
      getContext(request: FastifyRequest): AIGovernanceContext | undefined;
      getSanitizedPrompt(request: FastifyRequest): string | undefined;
    };
  }
}

export { aiGovernancePlugin };
export default createAIGovernanceMiddleware;
