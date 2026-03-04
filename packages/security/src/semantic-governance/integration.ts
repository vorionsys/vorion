/**
 * Semantic Governance Integration - Intent Pipeline Integration
 *
 * Provides seamless integration of semantic governance validation into the
 * intent evaluation pipeline. This service acts as a bridge between the
 * semantic governance validators and the intent processing system.
 *
 * Features:
 * - Pre-action semantic validation during intent evaluation
 * - Post-action output validation
 * - Semantic signals for trust engine integration
 * - Credential management per agent/tenant
 * - Metrics and observability
 *
 * @packageDocumentation
 * @module @vorion/semantic-governance/integration
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';
import {
  SemanticGovernanceService,
  createSemanticGovernanceService,
  SemanticGovernanceError,
} from './service.js';
import {
  SemanticCredentialManager,
  getCredentialManager,
} from './credential-manager.js';
import {
  InstructionValidator,
  createDefaultInstructionValidator,
} from './instruction-validator.js';
import {
  OutputValidator,
  createDefaultOutputValidator,
} from './output-validator.js';
import {
  InferenceValidator,
  createDefaultInferenceValidator,
} from './inference-validator.js';
import {
  ContextValidator,
  createDefaultContextValidator,
} from './context-validator.js';
import {
  DualChannelEnforcer,
  createDefaultDualChannelEnforcer,
} from './dual-channel.js';
import {
  TrustTier,
  InferenceLevel,
  type SemanticGovernanceCredential,
  type SemanticValidationResult,
  type PreActionResult,
  type PostActionResult,
  type AgentIdentity,
  type AgentInteraction,
  type ActionRequest,
  type ActionRecord,
  type DomainCode,
  type InferenceOperation,
  type InferenceOperationType,
  type InjectionScanResult,
} from './types.js';

const logger = createLogger({ component: 'semantic-governance-integration' });

// =============================================================================
// METRICS
// =============================================================================

const integrationRegistry = new Registry();

const semanticValidationTotal = new Counter({
  name: 'vorion_semantic_integration_validation_total',
  help: 'Total semantic governance validations in intent pipeline',
  labelNames: ['type', 'result', 'tenant_id'] as const,
  registers: [integrationRegistry],
});

const semanticValidationDuration = new Histogram({
  name: 'vorion_semantic_integration_validation_duration_seconds',
  help: 'Semantic validation duration in intent pipeline',
  labelNames: ['type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [integrationRegistry],
});

const semanticSignalsEmitted = new Counter({
  name: 'vorion_semantic_integration_signals_total',
  help: 'Total semantic signals emitted for trust engine',
  labelNames: ['signal_type', 'severity'] as const,
  registers: [integrationRegistry],
});

const activeAgentCredentials = new Gauge({
  name: 'vorion_semantic_integration_active_credentials',
  help: 'Number of active agent credentials in integration layer',
  registers: [integrationRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * Semantic signal emitted during validation for trust engine integration
 */
export interface SemanticSignal {
  /** Signal type identifier */
  type: string;
  /** Signal value (positive for good, negative for bad) */
  value: number;
  /** Signal weight (0-1) */
  weight: number;
  /** Signal severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Source of the signal */
  source: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of semantic validation during intent evaluation
 */
export interface IntentSemanticValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Overall reason for failure */
  reason?: string;
  /** Pre-action validation result */
  preAction?: PreActionResult;
  /** Post-action validation result */
  postAction?: PostActionResult;
  /** Semantic signals for trust engine */
  signals: SemanticSignal[];
  /** Validation duration in milliseconds */
  durationMs: number;
  /** Warnings (validation passed but with concerns) */
  warnings?: string[];
}

/**
 * Configuration for semantic governance integration
 */
export interface SemanticGovernanceIntegrationConfig {
  /** Whether to enable semantic validation in the pipeline */
  enabled: boolean;
  /** Default trust tier for unknown agents */
  defaultTrustTier: TrustTier;
  /** Default inference level limit */
  defaultInferenceLevel: InferenceLevel;
  /** Whether to block on semantic validation failure */
  blockOnFailure: boolean;
  /** Whether to emit trust signals on validation events */
  emitTrustSignals: boolean;
  /** Control plane sources for dual-channel enforcement */
  controlPlaneSources?: string[];
  /** How to treat data plane content */
  dataPlaneTreatment?: 'block' | 'sanitize' | 'warn';
}

/**
 * Default integration configuration
 */
export const DEFAULT_INTEGRATION_CONFIG: SemanticGovernanceIntegrationConfig = {
  enabled: true,
  defaultTrustTier: TrustTier.T2_PROVISIONAL,
  defaultInferenceLevel: InferenceLevel.ENTITY,
  blockOnFailure: true,
  emitTrustSignals: true,
  controlPlaneSources: [
    'user-direct-input',
    'signed-system-instruction',
    'authenticated-api-command',
    'admin-console',
    'orchestrator',
  ],
  dataPlaneTreatment: 'sanitize',
};

/**
 * Context for semantic validation during intent evaluation
 */
export interface IntentValidationContext {
  /** Intent ID */
  intentId: string;
  /** Tenant ID */
  tenantId: string;
  /** Entity ID (agent DID) */
  entityId: string;
  /** Intent type */
  intentType?: string;
  /** Intent goal */
  goal: string;
  /** Intent context data */
  context?: Record<string, unknown>;
  /** Trust score */
  trustScore?: number;
  /** Trust level */
  trustLevel?: number;
  /** System instruction (if any) */
  instruction?: string;
  /** Message source */
  messageSource?: string;
  /** Whether message is authenticated */
  authenticated?: boolean;
  /** External context sources */
  contextSources?: Array<{
    providerId: string;
    content: unknown;
    signature?: string;
    timestamp?: Date;
  }>;
  /** Requested inference operations */
  inferenceOperations?: InferenceOperation[];
}

/**
 * Context for post-action validation
 */
export interface OutputValidationContext extends IntentValidationContext {
  /** Action output */
  output: unknown;
  /** External endpoints accessed */
  externalEndpoints?: string[];
  /** Derived knowledge produced */
  derivedKnowledge?: Array<{
    id: string;
    type: string;
    content: unknown;
    sourceDomains: DomainCode[];
  }>;
}

// =============================================================================
// INTEGRATION SERVICE
// =============================================================================

/**
 * Semantic Governance Integration Service
 *
 * Provides integration between semantic governance validators and the intent
 * evaluation pipeline. Manages credentials, performs validation, and emits
 * trust signals.
 */
export class SemanticGovernanceIntegration {
  private readonly config: SemanticGovernanceIntegrationConfig;
  private readonly credentialManager: SemanticCredentialManager;
  private readonly governanceService: SemanticGovernanceService;
  private readonly instructionValidator: InstructionValidator;
  private readonly outputValidator: OutputValidator;
  private readonly inferenceValidator: InferenceValidator;
  private readonly contextValidator: ContextValidator;
  private readonly dualChannelEnforcer: DualChannelEnforcer;
  private readonly agentCredentialCache: Map<string, SemanticGovernanceCredential>;

  /**
   * Create a new SemanticGovernanceIntegration
   *
   * @param config - Integration configuration
   */
  constructor(config: Partial<SemanticGovernanceIntegrationConfig> = {}) {
    this.config = { ...DEFAULT_INTEGRATION_CONFIG, ...config };
    this.credentialManager = getCredentialManager();
    this.agentCredentialCache = new Map();

    // Initialize validators with defaults
    this.instructionValidator = createDefaultInstructionValidator();
    this.outputValidator = createDefaultOutputValidator();
    this.inferenceValidator = createDefaultInferenceValidator(this.config.defaultInferenceLevel);
    this.contextValidator = createDefaultContextValidator();
    this.dualChannelEnforcer = createDefaultDualChannelEnforcer();

    // Create governance service
    this.governanceService = new SemanticGovernanceService(
      this.instructionValidator,
      this.outputValidator,
      this.inferenceValidator,
      this.contextValidator,
      this.dualChannelEnforcer
    );

    logger.info(
      {
        enabled: this.config.enabled,
        defaultTrustTier: this.config.defaultTrustTier,
        defaultInferenceLevel: this.config.defaultInferenceLevel,
        blockOnFailure: this.config.blockOnFailure,
      },
      'SemanticGovernanceIntegration initialized'
    );
  }

  /**
   * Validate an intent during the evaluation phase
   *
   * This is called during the intent evaluation worker to perform semantic
   * validation before the action is executed.
   *
   * @param context - Intent validation context
   * @returns Semantic validation result with signals
   */
  async validateIntent(context: IntentValidationContext): Promise<IntentSemanticValidationResult> {
    if (!this.config.enabled) {
      return {
        valid: true,
        signals: [],
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const signals: SemanticSignal[] = [];
    const warnings: string[] = [];

    try {
      // Ensure credential exists for agent
      const credential = await this.ensureCredential(context.entityId, context.tenantId);

      // Build agent identity
      const agentIdentity: AgentIdentity = {
        did: context.entityId,
        carId: credential.carId,
        trustTier: this.mapTrustLevel(context.trustLevel),
        domains: this.inferDomains(context.intentType),
      };

      // Build action request
      const actionRequest: ActionRequest = {
        type: context.intentType || 'generic',
        params: context.context,
        instruction: context.instruction,
        contextSources: context.contextSources?.map((cs) => ({
          providerId: cs.providerId,
          content: cs.content,
          signature: cs.signature,
        })),
        inferenceOperations: context.inferenceOperations,
      };

      // Build agent interaction
      const interaction: AgentInteraction = {
        id: context.intentId,
        agent: agentIdentity,
        message: {
          source: context.messageSource || 'intent-submission',
          content: context.goal,
          authenticated: context.authenticated ?? true,
          timestamp: new Date(),
        },
        instruction: context.instruction,
        context: context.contextSources?.map((cs) => ({
          providerId: cs.providerId,
          content: cs.content,
          signature: cs.signature,
          timestamp: cs.timestamp,
        })),
        action: actionRequest,
      };

      // Perform validation
      const validationResult = await this.governanceService.validateInteraction(interaction);

      // Generate signals based on validation result
      if (validationResult.valid) {
        signals.push({
          type: 'semantic.validation.passed',
          value: 0.05,
          weight: 1.0,
          severity: 'low',
          source: 'semantic-governance',
          metadata: {
            intentId: context.intentId,
            agentDid: context.entityId,
          },
        });
        semanticSignalsEmitted.inc({ signal_type: 'validation_passed', severity: 'low' });
      } else {
        signals.push({
          type: 'semantic.validation.failed',
          value: -0.15,
          weight: 1.0,
          severity: this.determineSeverity(validationResult),
          source: 'semantic-governance',
          metadata: {
            intentId: context.intentId,
            agentDid: context.entityId,
            reason: validationResult.reason,
          },
        });
        semanticSignalsEmitted.inc({
          signal_type: 'validation_failed',
          severity: this.determineSeverity(validationResult),
        });
      }

      // Check for injection detection
      if (validationResult.preAction?.contextValidations) {
        for (const cv of validationResult.preAction.contextValidations) {
          if (cv.injectionScan?.detected) {
            signals.push({
              type: 'semantic.injection.detected',
              value: -0.25,
              weight: 1.0,
              severity: cv.injectionScan.severity || 'high',
              source: 'semantic-governance',
              metadata: {
                intentId: context.intentId,
                patterns: cv.injectionScan.patterns,
              },
            });
            semanticSignalsEmitted.inc({
              signal_type: 'injection_detected',
              severity: cv.injectionScan.severity || 'high',
            });
          }
        }
      }

      // Collect warnings
      if (validationResult.preAction?.warnings) {
        warnings.push(...validationResult.preAction.warnings);
      }

      const durationMs = Date.now() - startTime;
      semanticValidationDuration.observe({ type: 'intent' }, durationMs / 1000);
      semanticValidationTotal.inc({
        type: 'intent',
        result: validationResult.valid ? 'passed' : 'failed',
        tenant_id: context.tenantId,
      });

      return {
        valid: validationResult.valid,
        reason: validationResult.reason,
        preAction: validationResult.preAction,
        signals,
        durationMs,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error(
        { error, intentId: context.intentId },
        'Semantic validation error'
      );

      semanticValidationTotal.inc({
        type: 'intent',
        result: 'error',
        tenant_id: context.tenantId,
      });

      // On error, emit a warning signal
      signals.push({
        type: 'semantic.validation.error',
        value: -0.05,
        weight: 0.5,
        severity: 'medium',
        source: 'semantic-governance',
        metadata: {
          intentId: context.intentId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // Depending on config, either fail or pass with warning
      if (this.config.blockOnFailure) {
        return {
          valid: false,
          reason: `Semantic validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          signals,
          durationMs,
        };
      }

      return {
        valid: true,
        signals,
        durationMs,
        warnings: [`Semantic validation error (non-blocking): ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Validate action output during post-action phase
   *
   * @param context - Output validation context
   * @returns Semantic validation result with signals
   */
  async validateOutput(context: OutputValidationContext): Promise<IntentSemanticValidationResult> {
    if (!this.config.enabled) {
      return {
        valid: true,
        signals: [],
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const signals: SemanticSignal[] = [];
    const warnings: string[] = [];

    try {
      const credential = await this.ensureCredential(context.entityId, context.tenantId);

      const agentIdentity: AgentIdentity = {
        did: context.entityId,
        carId: credential.carId,
        trustTier: this.mapTrustLevel(context.trustLevel),
        domains: this.inferDomains(context.intentType),
      };

      const actionRecord: ActionRecord = {
        type: context.intentType || 'generic',
        output: context.output,
        externalEndpoints: context.externalEndpoints,
        derivedKnowledge: context.derivedKnowledge?.map((dk) => ({
          id: dk.id,
          type: dk.type as InferenceOperationType,
          sourceIds: [],
          sourceDomains: dk.sourceDomains,
          content: dk.content,
          createdAt: new Date(),
          inferenceLevel: this.config.defaultInferenceLevel,
        })),
      };

      const postActionResult = this.governanceService.postActionCheck(agentIdentity, actionRecord);

      if (postActionResult.valid) {
        signals.push({
          type: 'semantic.output.valid',
          value: 0.03,
          weight: 1.0,
          severity: 'low',
          source: 'semantic-governance',
          metadata: { intentId: context.intentId },
        });
        semanticSignalsEmitted.inc({ signal_type: 'output_valid', severity: 'low' });
      } else {
        signals.push({
          type: 'semantic.output.invalid',
          value: -0.2,
          weight: 1.0,
          severity: 'high',
          source: 'semantic-governance',
          metadata: {
            intentId: context.intentId,
            reason: postActionResult.reason,
          },
        });
        semanticSignalsEmitted.inc({ signal_type: 'output_invalid', severity: 'high' });
      }

      // Check for PII detection
      if (postActionResult.piiChecks) {
        for (const piiCheck of postActionResult.piiChecks) {
          if (piiCheck.containsPII) {
            signals.push({
              type: 'semantic.pii.detected',
              value: -0.1,
              weight: 1.0,
              severity: 'medium',
              source: 'semantic-governance',
              metadata: {
                intentId: context.intentId,
                piiTypes: piiCheck.piiTypes,
                action: piiCheck.action,
              },
            });
            semanticSignalsEmitted.inc({ signal_type: 'pii_detected', severity: 'medium' });
          }
        }
      }

      if (postActionResult.warnings) {
        warnings.push(...postActionResult.warnings);
      }

      const durationMs = Date.now() - startTime;
      semanticValidationDuration.observe({ type: 'output' }, durationMs / 1000);
      semanticValidationTotal.inc({
        type: 'output',
        result: postActionResult.valid ? 'passed' : 'failed',
        tenant_id: context.tenantId,
      });

      return {
        valid: postActionResult.valid,
        reason: postActionResult.reason,
        postAction: postActionResult,
        signals,
        durationMs,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error(
        { error, intentId: context.intentId },
        'Semantic output validation error'
      );

      semanticValidationTotal.inc({
        type: 'output',
        result: 'error',
        tenant_id: context.tenantId,
      });

      signals.push({
        type: 'semantic.output.error',
        value: -0.05,
        weight: 0.5,
        severity: 'medium',
        source: 'semantic-governance',
        metadata: {
          intentId: context.intentId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      if (this.config.blockOnFailure) {
        return {
          valid: false,
          reason: `Output validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          signals,
          durationMs,
        };
      }

      return {
        valid: true,
        signals,
        durationMs,
        warnings: [`Output validation error (non-blocking): ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Scan content for injection patterns without full validation
   *
   * @param content - Content to scan
   * @returns Injection scan result
   */
  scanForInjection(content: string): InjectionScanResult {
    return this.contextValidator.scanForInjection(content);
  }

  /**
   * Classify a message channel (control vs data plane)
   *
   * @param source - Message source
   * @param authenticated - Whether message is authenticated
   * @returns Channel classification
   */
  classifyChannel(source: string, authenticated: boolean): 'control' | 'data' {
    const classification = this.dualChannelEnforcer.classifyMessage({ source, authenticated });
    return classification.channel;
  }

  /**
   * Create or update a credential for an agent
   *
   * @param agentId - Agent identifier (DID)
   * @param tenantId - Tenant identifier
   * @param config - Optional credential configuration
   * @returns Created/updated credential
   */
  async registerAgent(
    agentId: string,
    tenantId: string,
    config?: {
      carId?: string;
      allowedInstructionHashes?: string[];
      inferenceLevel?: InferenceLevel;
      piiAllowed?: boolean;
    }
  ): Promise<SemanticGovernanceCredential> {
    const existing = this.credentialManager.getCredentialByAgent(agentId);
    if (existing) {
      return existing;
    }

    const credential = this.credentialManager.createCredential(
      agentId,
      config?.carId || `a3i.vorion.agent:BD-L2@1.0.0`,
      {
        instructionIntegrity: config?.allowedInstructionHashes
          ? {
              allowedInstructionHashes: config.allowedInstructionHashes,
              instructionTemplates: [],
              instructionSource: { allowedSources: [], requireSignature: false },
            }
          : undefined,
        inferenceScope: config?.inferenceLevel
          ? {
              globalLevel: config.inferenceLevel,
              domainOverrides: [],
              derivedKnowledgeHandling: { retention: 'session', allowedRecipients: [], crossContextSharing: false },
              piiInference: { allowed: config?.piiAllowed ?? false, handling: 'redact' },
            }
          : undefined,
      }
    );

    this.agentCredentialCache.set(agentId, credential);
    activeAgentCredentials.set(this.agentCredentialCache.size);

    logger.info(
      { agentId, credentialId: credential.id },
      'Agent registered with semantic governance'
    );

    return credential;
  }

  /**
   * Ensure a credential exists for an agent, creating one if needed
   */
  private async ensureCredential(agentId: string, tenantId: string): Promise<SemanticGovernanceCredential> {
    // Check cache first
    let credential = this.agentCredentialCache.get(agentId);
    if (credential) {
      return credential;
    }

    // Check credential manager
    credential = this.credentialManager.getCredentialByAgent(agentId);
    if (credential) {
      this.agentCredentialCache.set(agentId, credential);
      activeAgentCredentials.set(this.agentCredentialCache.size);
      return credential;
    }

    // Create default credential
    credential = await this.registerAgent(agentId, tenantId);
    return credential;
  }

  /**
   * Map trust level (0-7) to TrustTier enum
   */
  private mapTrustLevel(trustLevel?: number): TrustTier {
    if (trustLevel === undefined || trustLevel === null) {
      return this.config.defaultTrustTier;
    }

    switch (trustLevel) {
      case 0:
        return TrustTier.T0_SANDBOX;
      case 1:
        return TrustTier.T1_OBSERVED;
      case 2:
        return TrustTier.T2_PROVISIONAL;
      case 3:
        return TrustTier.T3_MONITORED;
      case 4:
        return TrustTier.T4_STANDARD;
      case 5:
        return TrustTier.T5_TRUSTED;
      case 6:
        return TrustTier.T6_CERTIFIED;
      case 7:
        return TrustTier.T7_AUTONOMOUS;
      default:
        return this.config.defaultTrustTier;
    }
  }

  /**
   * Infer domain codes from intent type
   */
  private inferDomains(intentType?: string): DomainCode[] {
    if (!intentType) {
      return ['D']; // Default: Data domain
    }

    const domains: DomainCode[] = [];

    // Map intent types to domains
    if (intentType.includes('financial') || intentType.includes('payment')) {
      domains.push('F');
    }
    if (intentType.includes('health') || intentType.includes('medical')) {
      domains.push('H');
    }
    if (intentType.includes('security') || intentType.includes('auth')) {
      domains.push('S');
    }
    if (intentType.includes('data') || intentType.includes('query')) {
      domains.push('D');
    }
    if (intentType.includes('ai') || intentType.includes('inference')) {
      domains.push('I');
    }

    return domains.length > 0 ? domains : ['D'];
  }

  /**
   * Determine severity based on validation result
   */
  private determineSeverity(result: SemanticValidationResult): 'low' | 'medium' | 'high' | 'critical' {
    // Check for injection detection (critical)
    if (result.preAction?.contextValidations) {
      for (const cv of result.preAction.contextValidations) {
        if (cv.injectionScan?.detected && cv.injectionScan.severity === 'critical') {
          return 'critical';
        }
      }
    }

    // Check for channel enforcement failure (high)
    if (result.preAction?.channelEnforcement && !result.preAction.channelEnforcement.allowed) {
      return 'high';
    }

    // Check for instruction validation failure (high)
    if (result.preAction?.instructionValidation && !result.preAction.instructionValidation.valid) {
      return 'high';
    }

    // Check for output validation failure (medium)
    if (result.postAction && !result.postAction.valid) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Get the metrics registry
   */
  getMetricsRegistry(): Registry {
    return integrationRegistry;
  }

  /**
   * Clear credential cache
   */
  clearCache(): void {
    this.agentCredentialCache.clear();
    activeAgentCredentials.set(0);
  }

  /**
   * Check if semantic governance is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): SemanticGovernanceIntegrationConfig {
    return { ...this.config };
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a SemanticGovernanceIntegration with default configuration
 */
export function createSemanticGovernanceIntegration(
  config?: Partial<SemanticGovernanceIntegrationConfig>
): SemanticGovernanceIntegration {
  return new SemanticGovernanceIntegration(config);
}

/**
 * Singleton instance for use in intent pipeline
 */
let integrationInstance: SemanticGovernanceIntegration | null = null;

/**
 * Get the singleton integration instance
 */
export function getSemanticGovernanceIntegration(): SemanticGovernanceIntegration {
  if (!integrationInstance) {
    integrationInstance = createSemanticGovernanceIntegration();
  }
  return integrationInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetSemanticGovernanceIntegration(): void {
  if (integrationInstance) {
    integrationInstance.clearCache();
  }
  integrationInstance = null;
}

/**
 * Get integration metrics as Prometheus text format
 */
export async function getIntegrationMetrics(): Promise<string> {
  return integrationRegistry.metrics();
}

/**
 * Get integration metrics content type
 */
export function getIntegrationMetricsContentType(): string {
  return integrationRegistry.contentType;
}
