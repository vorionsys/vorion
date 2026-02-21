/**
 * AI Governance Module
 * Comprehensive AI security and governance controls for the Vorion Security Platform
 *
 * This module provides:
 * - Model Registry: AI model inventory, versioning, and risk classification
 * - Access Policy: Role-based access control for AI models
 * - Prompt Injection Defense: Detection and prevention of injection attacks
 * - Output Filtering: PII detection, redaction, and validation
 * - Audit Trail: Comprehensive logging and compliance reporting
 * - Bias Detection: Fairness monitoring and alerts
 * - Rate Limiting: Token, cost, and request-based limits
 * - Middleware: Fastify integration for AI endpoints
 *
 * @module ai-governance
 * @version 1.0.0
 */

// Types
export * from './types';

// Model Registry
export {
  ModelRegistry,
  InMemoryModelRegistryStorage,
  type ModelRegistrationOptions,
  type ModelSearchCriteria,
  type ModelVersionEntry,
  type RiskAssessmentResult,
  type RiskFactor,
  type ModelRegistryStorage,
} from './model-registry';

// Access Policy
export {
  AccessPolicyManager,
  InMemoryPolicyStorage,
  InMemoryUsageTracker,
  type AccessRequestContext,
  type AccessDecision,
  type PolicyViolation,
  type PolicyViolationType,
  type AccessRestriction,
  type PolicyStorage,
  type UsageTracker,
} from './access-policy';

// Prompt Injection Defense
export {
  PromptInjectionDetector,
  InMemoryTemplateStorage,
  type InjectionDetectionConfig,
  type InjectionPattern,
  type TemplateStorage,
} from './prompt-injection';

// Output Filtering
export {
  OutputFilter,
  type OutputFilterConfig,
  type SensitiveDataPattern,
  type ValidationRule,
} from './output-filter';

// Audit Trail
export {
  AuditTrail,
  InMemoryAuditStorage,
  type AuditConfig,
  type AnomalyThresholds,
  type AuditQueryOptions,
  type AuditStorage,
} from './audit-trail';

// Bias Detection
export {
  BiasDetector,
  InMemoryBiasSampleStorage,
  InMemoryBiasAlertStorage,
  type BiasDetectionConfig,
  type BiasThresholds,
  type CustomMetricDefinition,
  type BiasSample,
  type BiasSampleStorage,
  type BiasAlertStorage,
} from './bias-detection';

// Rate Limiting
export {
  AIRateLimiter,
  InMemoryRateLimitStorage,
  type RateLimiterConfig,
  type RateLimitCheckResult,
  type RateLimitStorage,
} from './rate-limiter';

// Middleware
export {
  createAIGovernanceMiddleware,
  aiGovernancePlugin,
  type AIGovernanceMiddlewareOptions,
  type AIGovernanceContext,
  type AIModelResponse,
} from './middleware';

// Convenience factory for creating a complete AI Governance system
export interface AIGovernanceSystemConfig {
  modelRegistry?: {
    // Custom storage can be injected
  };
  accessPolicy?: {
    // Access policy configuration
  };
  injectionDetection?: {
    enabled?: boolean;
    strictMode?: boolean;
    blockOnDetection?: boolean;
    sensitivityLevel?: 'low' | 'medium' | 'high';
  };
  outputFiltering?: {
    enabled?: boolean;
    piiDetection?: boolean;
    piiRedaction?: boolean;
    hallucinationDetection?: boolean;
    confidenceThreshold?: number;
  };
  auditTrail?: {
    enabled?: boolean;
    logQueries?: boolean;
    logResponses?: boolean;
    retentionDays?: number;
  };
  biasDetection?: {
    enabled?: boolean;
    protectedAttributes?: string[];
    minimumSampleSize?: number;
  };
  rateLimiting?: {
    enabled?: boolean;
    defaultTokenLimit?: number;
    defaultRequestLimit?: number;
    defaultCostLimit?: number;
  };
}

/**
 * Create a complete AI Governance system with all components
 */
export function createAIGovernanceSystem(config: AIGovernanceSystemConfig = {}) {
  const { ModelRegistry } = require('./model-registry');
  const { AccessPolicyManager } = require('./access-policy');
  const { PromptInjectionDetector } = require('./prompt-injection');
  const { OutputFilter } = require('./output-filter');
  const { AuditTrail } = require('./audit-trail');
  const { BiasDetector } = require('./bias-detection');
  const { AIRateLimiter } = require('./rate-limiter');

  const modelRegistry = new ModelRegistry();

  const accessPolicyManager = new AccessPolicyManager();

  const injectionDetector = new PromptInjectionDetector({
    enabled: config.injectionDetection?.enabled ?? true,
    strictMode: config.injectionDetection?.strictMode ?? false,
    blockOnDetection: config.injectionDetection?.blockOnDetection ?? true,
    sensitivityLevel: config.injectionDetection?.sensitivityLevel ?? 'medium',
  });

  const outputFilter = new OutputFilter({
    enabled: config.outputFiltering?.enabled ?? true,
    piiDetection: config.outputFiltering?.piiDetection ?? true,
    piiRedaction: config.outputFiltering?.piiRedaction ?? true,
    hallucinationDetection: config.outputFiltering?.hallucinationDetection ?? true,
    confidenceThreshold: config.outputFiltering?.confidenceThreshold ?? 0.7,
  });

  const auditTrail = new AuditTrail({
    enabled: config.auditTrail?.enabled ?? true,
    logQueries: config.auditTrail?.logQueries ?? true,
    logResponses: config.auditTrail?.logResponses ?? true,
    retentionDays: config.auditTrail?.retentionDays ?? 90,
  });

  const biasDetector = new BiasDetector({
    enabled: config.biasDetection?.enabled ?? true,
    protectedAttributes: config.biasDetection?.protectedAttributes ?? [
      'gender',
      'age_group',
      'ethnicity',
      'location',
    ],
    minimumSampleSize: config.biasDetection?.minimumSampleSize ?? 100,
  });

  const rateLimiter = new AIRateLimiter({
    enabled: config.rateLimiting?.enabled ?? true,
    defaultLimits: [
      {
        type: 'request',
        limit: config.rateLimiting?.defaultRequestLimit ?? 100,
        window: 3600,
        scope: 'user',
        action: 'block',
      },
      {
        type: 'token',
        limit: config.rateLimiting?.defaultTokenLimit ?? 100000,
        window: 3600,
        scope: 'user',
        action: 'block',
      },
      {
        type: 'cost',
        limit: config.rateLimiting?.defaultCostLimit ?? 10,
        window: 86400,
        scope: 'user',
        action: 'block',
      },
    ],
  });

  // Wire up events between components
  injectionDetector.on('injection:detected', (result: unknown) => {
    auditTrail.emit('security:injection', result);
  });

  outputFilter.on('output:filtered', (result: unknown) => {
    auditTrail.emit('security:output-filtered', result);
  });

  biasDetector.on('bias:detected', (result: unknown) => {
    auditTrail.emit('fairness:bias-detected', result);
  });

  rateLimiter.on('rate-limit:exceeded', (data: unknown) => {
    auditTrail.emit('security:rate-limit', data);
  });

  return {
    modelRegistry,
    accessPolicyManager,
    injectionDetector,
    outputFilter,
    auditTrail,
    biasDetector,
    rateLimiter,

    /**
     * Register event handlers for all governance events
     */
    onEvent(
      event:
        | 'model:registered'
        | 'model:updated'
        | 'policy:violated'
        | 'injection:detected'
        | 'output:filtered'
        | 'bias:detected'
        | 'rate-limit:exceeded'
        | 'audit:logged',
      handler: (...args: unknown[]) => void
    ) {
      switch (event) {
        case 'model:registered':
        case 'model:updated':
          modelRegistry.on(event, handler);
          break;
        case 'policy:violated':
          accessPolicyManager.on(event, handler);
          break;
        case 'injection:detected':
          injectionDetector.on(event, handler);
          break;
        case 'output:filtered':
          outputFilter.on(event, handler);
          break;
        case 'bias:detected':
          biasDetector.on(event, handler);
          break;
        case 'rate-limit:exceeded':
          rateLimiter.on(event, handler);
          break;
        case 'audit:logged':
          auditTrail.on(event, handler);
          break;
      }
    },

    /**
     * Generate a comprehensive compliance report
     */
    async generateComplianceReport(modelId: string, period: { start: Date; end: Date }) {
      const report = await auditTrail.generateComplianceReport(modelId, 'on-demand', period);
      const biasAnalysis = await biasDetector.analyzeModel(modelId, period);
      const model = await modelRegistry.getModel(modelId);
      const riskAssessments = await modelRegistry.getRiskAssessments(modelId);

      return {
        ...report,
        biasAnalysis,
        modelMetadata: model,
        riskAssessments,
      };
    },

    /**
     * Cleanup old data across all components
     */
    async cleanup() {
      const auditDeleted = await auditTrail.cleanup();
      const biasDeleted = await biasDetector.cleanup();

      return {
        auditEntriesDeleted: auditDeleted,
        biasSamplesDeleted: biasDeleted,
      };
    },
  };
}

// Default export
export default createAIGovernanceSystem;
