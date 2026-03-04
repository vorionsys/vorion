/**
 * AI Model Registry
 * Manages AI model inventory, versioning, and risk classification
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  AIModelMetadata,
  RiskLevel,
  DeploymentStatus,
  DataClassification,
  TrainingDataInfo,
} from './types';

/**
 * Model registration options
 */
export interface ModelRegistrationOptions {
  id: string;
  name: string;
  provider: string;
  version: string;
  capabilities?: string[];
  riskLevel?: RiskLevel;
  dataCategories?: string[];
  description?: string;
  owner?: string;
  team?: string;
  tags?: string[];
  endpoints?: string[];
  maxTokens?: number;
  costPerToken?: number;
  deploymentStatus?: DeploymentStatus;
  complianceFrameworks?: string[];
  dataSensitivity?: DataClassification;
  retentionPolicy?: string;
  modelType?: AIModelMetadata['modelType'];
  trainingDataInfo?: TrainingDataInfo;
}

/**
 * Model search criteria
 */
export interface ModelSearchCriteria {
  provider?: string;
  riskLevel?: RiskLevel | RiskLevel[];
  deploymentStatus?: DeploymentStatus | DeploymentStatus[];
  dataSensitivity?: DataClassification | DataClassification[];
  capabilities?: string[];
  tags?: string[];
  owner?: string;
  team?: string;
  modelType?: AIModelMetadata['modelType'];
}

/**
 * Model version history entry
 */
export interface ModelVersionEntry {
  version: string;
  registeredAt: Date;
  registeredBy: string;
  changes: string[];
  metadata: Partial<AIModelMetadata>;
  deprecated: boolean;
  deprecatedAt?: Date;
  deprecationReason?: string;
}

/**
 * Risk assessment result
 */
export interface RiskAssessmentResult {
  modelId: string;
  assessedAt: Date;
  assessedBy: string;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: RiskFactor[];
  recommendations: string[];
  nextReviewDate: Date;
}

/**
 * Risk factor
 */
export interface RiskFactor {
  category: string;
  factor: string;
  weight: number;
  score: number;
  description: string;
}

/**
 * Storage interface for model registry persistence
 */
export interface ModelRegistryStorage {
  save(model: AIModelMetadata): Promise<void>;
  get(modelId: string): Promise<AIModelMetadata | null>;
  delete(modelId: string): Promise<void>;
  list(): Promise<AIModelMetadata[]>;
  search(criteria: ModelSearchCriteria): Promise<AIModelMetadata[]>;
  saveVersionHistory(modelId: string, versions: ModelVersionEntry[]): Promise<void>;
  getVersionHistory(modelId: string): Promise<ModelVersionEntry[]>;
  saveRiskAssessment(assessment: RiskAssessmentResult): Promise<void>;
  getRiskAssessments(modelId: string): Promise<RiskAssessmentResult[]>;
}

/**
 * In-memory storage implementation
 */
export class InMemoryModelRegistryStorage implements ModelRegistryStorage {
  private models: Map<string, AIModelMetadata> = new Map();
  private versionHistory: Map<string, ModelVersionEntry[]> = new Map();
  private riskAssessments: Map<string, RiskAssessmentResult[]> = new Map();

  async save(model: AIModelMetadata): Promise<void> {
    this.models.set(model.id, { ...model });
  }

  async get(modelId: string): Promise<AIModelMetadata | null> {
    const model = this.models.get(modelId);
    return model ? { ...model } : null;
  }

  async delete(modelId: string): Promise<void> {
    this.models.delete(modelId);
  }

  async list(): Promise<AIModelMetadata[]> {
    return Array.from(this.models.values()).map((m) => ({ ...m }));
  }

  async search(criteria: ModelSearchCriteria): Promise<AIModelMetadata[]> {
    const models = await this.list();
    return models.filter((model) => {
      if (criteria.provider && model.provider !== criteria.provider) return false;
      if (criteria.riskLevel) {
        const levels = Array.isArray(criteria.riskLevel) ? criteria.riskLevel : [criteria.riskLevel];
        if (!levels.includes(model.riskLevel)) return false;
      }
      if (criteria.deploymentStatus) {
        const statuses = Array.isArray(criteria.deploymentStatus)
          ? criteria.deploymentStatus
          : [criteria.deploymentStatus];
        if (!statuses.includes(model.deploymentStatus)) return false;
      }
      if (criteria.dataSensitivity) {
        const sensitivities = Array.isArray(criteria.dataSensitivity)
          ? criteria.dataSensitivity
          : [criteria.dataSensitivity];
        if (!sensitivities.includes(model.dataSensitivity)) return false;
      }
      if (criteria.capabilities) {
        if (!criteria.capabilities.some((c) => model.capabilities.includes(c))) return false;
      }
      if (criteria.tags && model.tags) {
        if (!criteria.tags.some((t) => model.tags!.includes(t))) return false;
      }
      if (criteria.owner && model.owner !== criteria.owner) return false;
      if (criteria.team && model.team !== criteria.team) return false;
      if (criteria.modelType && model.modelType !== criteria.modelType) return false;
      return true;
    });
  }

  async saveVersionHistory(modelId: string, versions: ModelVersionEntry[]): Promise<void> {
    this.versionHistory.set(modelId, [...versions]);
  }

  async getVersionHistory(modelId: string): Promise<ModelVersionEntry[]> {
    return this.versionHistory.get(modelId) || [];
  }

  async saveRiskAssessment(assessment: RiskAssessmentResult): Promise<void> {
    const existing = this.riskAssessments.get(assessment.modelId) || [];
    existing.push({ ...assessment });
    this.riskAssessments.set(assessment.modelId, existing);
  }

  async getRiskAssessments(modelId: string): Promise<RiskAssessmentResult[]> {
    return (this.riskAssessments.get(modelId) || []).map((a) => ({ ...a }));
  }
}

/**
 * AI Model Registry
 * Central repository for AI model inventory and management
 */
export class ModelRegistry extends EventEmitter {
  private storage: ModelRegistryStorage;
  private riskWeights: Map<string, number>;

  constructor(storage?: ModelRegistryStorage) {
    super();
    this.storage = storage || new InMemoryModelRegistryStorage();
    this.riskWeights = this.initializeRiskWeights();
  }

  /**
   * Initialize default risk weights for assessment
   */
  private initializeRiskWeights(): Map<string, number> {
    return new Map([
      ['dataSensitivity', 0.25],
      ['externalAccess', 0.15],
      ['piiHandling', 0.20],
      ['autonomousDecisions', 0.15],
      ['modelComplexity', 0.10],
      ['auditCoverage', 0.10],
      ['complianceGaps', 0.05],
    ]);
  }

  /**
   * Register a new AI model
   */
  async registerModel(options: ModelRegistrationOptions, registeredBy: string): Promise<AIModelMetadata> {
    // Check for existing model
    const existing = await this.storage.get(options.id);
    if (existing) {
      throw new Error(`Model with ID ${options.id} already exists. Use updateModel() instead.`);
    }

    const model: AIModelMetadata = {
      id: options.id,
      name: options.name,
      provider: options.provider,
      version: options.version,
      capabilities: options.capabilities || [],
      riskLevel: options.riskLevel || 'medium',
      dataCategories: options.dataCategories || [],
      deployedAt: new Date(),
      description: options.description,
      owner: options.owner,
      team: options.team,
      tags: options.tags,
      endpoints: options.endpoints,
      maxTokens: options.maxTokens,
      costPerToken: options.costPerToken,
      deploymentStatus: options.deploymentStatus || 'development',
      complianceFrameworks: options.complianceFrameworks,
      dataSensitivity: options.dataSensitivity || 'internal',
      retentionPolicy: options.retentionPolicy,
      modelType: options.modelType,
      trainingDataInfo: options.trainingDataInfo,
    };

    await this.storage.save(model);

    // Initialize version history
    const versionEntry: ModelVersionEntry = {
      version: model.version,
      registeredAt: new Date(),
      registeredBy,
      changes: ['Initial registration'],
      metadata: { ...model },
      deprecated: false,
    };
    await this.storage.saveVersionHistory(model.id, [versionEntry]);

    this.emit('model:registered', model);
    return model;
  }

  /**
   * Update an existing model
   */
  async updateModel(
    modelId: string,
    updates: Partial<Omit<AIModelMetadata, 'id' | 'deployedAt'>>,
    updatedBy: string,
    changeDescription: string[]
  ): Promise<AIModelMetadata> {
    const existing = await this.storage.get(modelId);
    if (!existing) {
      throw new Error(`Model with ID ${modelId} not found`);
    }

    const updated: AIModelMetadata = {
      ...existing,
      ...updates,
      id: modelId,
      deployedAt: existing.deployedAt,
    };

    await this.storage.save(updated);

    // Add version history entry if version changed
    if (updates.version && updates.version !== existing.version) {
      const history = await this.storage.getVersionHistory(modelId);
      const versionEntry: ModelVersionEntry = {
        version: updates.version,
        registeredAt: new Date(),
        registeredBy: updatedBy,
        changes: changeDescription,
        metadata: updates,
        deprecated: false,
      };
      history.push(versionEntry);
      await this.storage.saveVersionHistory(modelId, history);
    }

    this.emit('model:updated', updated);
    return updated;
  }

  /**
   * Get a model by ID
   */
  async getModel(modelId: string): Promise<AIModelMetadata | null> {
    return this.storage.get(modelId);
  }

  /**
   * List all models
   */
  async listModels(): Promise<AIModelMetadata[]> {
    return this.storage.list();
  }

  /**
   * Search models by criteria
   */
  async searchModels(criteria: ModelSearchCriteria): Promise<AIModelMetadata[]> {
    return this.storage.search(criteria);
  }

  /**
   * Get version history for a model
   */
  async getVersionHistory(modelId: string): Promise<ModelVersionEntry[]> {
    return this.storage.getVersionHistory(modelId);
  }

  /**
   * Deprecate a model version
   */
  async deprecateVersion(
    modelId: string,
    version: string,
    reason: string,
    deprecatedBy: string
  ): Promise<void> {
    const history = await this.storage.getVersionHistory(modelId);
    const versionEntry = history.find((v) => v.version === version);
    if (!versionEntry) {
      throw new Error(`Version ${version} not found for model ${modelId}`);
    }

    versionEntry.deprecated = true;
    versionEntry.deprecatedAt = new Date();
    versionEntry.deprecationReason = reason;

    await this.storage.saveVersionHistory(modelId, history);

    this.emit('model:deprecated', { modelId, version, reason, deprecatedBy });
  }

  /**
   * Update deployment status
   */
  async updateDeploymentStatus(
    modelId: string,
    status: DeploymentStatus,
    updatedBy: string
  ): Promise<AIModelMetadata> {
    return this.updateModel(modelId, { deploymentStatus: status }, updatedBy, [
      `Deployment status changed to ${status}`,
    ]);
  }

  /**
   * Perform risk assessment for a model
   */
  async assessRisk(modelId: string, assessedBy: string): Promise<RiskAssessmentResult> {
    const model = await this.storage.get(modelId);
    if (!model) {
      throw new Error(`Model with ID ${modelId} not found`);
    }

    const factors: RiskFactor[] = [];
    let totalScore = 0;
    let totalWeight = 0;

    // Data sensitivity factor
    const sensitivityScore = this.calculateDataSensitivityScore(model.dataSensitivity);
    const sensitivityWeight = this.riskWeights.get('dataSensitivity') || 0.25;
    factors.push({
      category: 'Data Protection',
      factor: 'Data Sensitivity Level',
      weight: sensitivityWeight,
      score: sensitivityScore,
      description: `Model handles ${model.dataSensitivity} data`,
    });
    totalScore += sensitivityScore * sensitivityWeight;
    totalWeight += sensitivityWeight;

    // PII handling factor
    const piiScore = this.calculatePIIScore(model.dataCategories);
    const piiWeight = this.riskWeights.get('piiHandling') || 0.20;
    factors.push({
      category: 'Data Protection',
      factor: 'PII Handling',
      weight: piiWeight,
      score: piiScore,
      description: `Model processes ${model.dataCategories.length} data categories`,
    });
    totalScore += piiScore * piiWeight;
    totalWeight += piiWeight;

    // External access factor
    const externalScore = this.calculateExternalAccessScore(model);
    const externalWeight = this.riskWeights.get('externalAccess') || 0.15;
    factors.push({
      category: 'Access Control',
      factor: 'External Accessibility',
      weight: externalWeight,
      score: externalScore,
      description: 'Evaluation of external access exposure',
    });
    totalScore += externalScore * externalWeight;
    totalWeight += externalWeight;

    // Model complexity factor
    const complexityScore = this.calculateComplexityScore(model);
    const complexityWeight = this.riskWeights.get('modelComplexity') || 0.10;
    factors.push({
      category: 'Technical',
      factor: 'Model Complexity',
      weight: complexityWeight,
      score: complexityScore,
      description: `Model type: ${model.modelType || 'unknown'}`,
    });
    totalScore += complexityScore * complexityWeight;
    totalWeight += complexityWeight;

    // Audit coverage factor
    const auditScore = this.calculateAuditCoverageScore(model);
    const auditWeight = this.riskWeights.get('auditCoverage') || 0.10;
    factors.push({
      category: 'Compliance',
      factor: 'Audit Coverage',
      weight: auditWeight,
      score: auditScore,
      description: model.lastAuditedAt
        ? `Last audited: ${model.lastAuditedAt.toISOString()}`
        : 'Never audited',
    });
    totalScore += auditScore * auditWeight;
    totalWeight += auditWeight;

    // Compliance gaps factor
    const complianceScore = this.calculateComplianceScore(model);
    const complianceWeight = this.riskWeights.get('complianceGaps') || 0.05;
    factors.push({
      category: 'Compliance',
      factor: 'Compliance Framework Coverage',
      weight: complianceWeight,
      score: complianceScore,
      description: `${model.complianceFrameworks?.length || 0} compliance frameworks`,
    });
    totalScore += complianceScore * complianceWeight;
    totalWeight += complianceWeight;

    const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const riskLevel = this.scoreToRiskLevel(normalizedScore);

    const recommendations = this.generateRiskRecommendations(model, factors, normalizedScore);

    const assessment: RiskAssessmentResult = {
      modelId,
      assessedAt: new Date(),
      assessedBy,
      riskLevel,
      riskScore: normalizedScore,
      factors,
      recommendations,
      nextReviewDate: this.calculateNextReviewDate(riskLevel),
    };

    await this.storage.saveRiskAssessment(assessment);

    // Update model's risk level if different
    if (model.riskLevel !== riskLevel) {
      await this.updateModel(modelId, { riskLevel }, 'system', ['Risk level updated by assessment']);
    }

    return assessment;
  }

  /**
   * Get risk assessments for a model
   */
  async getRiskAssessments(modelId: string): Promise<RiskAssessmentResult[]> {
    return this.storage.getRiskAssessments(modelId);
  }

  /**
   * Mark model as audited
   */
  async markAudited(modelId: string, auditedBy: string): Promise<AIModelMetadata> {
    return this.updateModel(
      modelId,
      { lastAuditedAt: new Date() },
      auditedBy,
      ['Model audited']
    );
  }

  /**
   * Get models requiring audit
   */
  async getModelsRequiringAudit(maxDaysSinceAudit: number = 90): Promise<AIModelMetadata[]> {
    const models = await this.listModels();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxDaysSinceAudit);

    return models.filter((model) => {
      if (model.deploymentStatus === 'retired') return false;
      if (!model.lastAuditedAt) return true;
      return model.lastAuditedAt < cutoffDate;
    });
  }

  /**
   * Get high-risk models
   */
  async getHighRiskModels(): Promise<AIModelMetadata[]> {
    return this.searchModels({ riskLevel: ['high', 'critical'] });
  }

  /**
   * Calculate data sensitivity score (0-1)
   */
  private calculateDataSensitivityScore(sensitivity: DataClassification): number {
    const scores: Record<DataClassification, number> = {
      'public': 0.1,
      'internal': 0.3,
      'confidential': 0.6,
      'restricted': 0.8,
      'top-secret': 1.0,
    };
    return scores[sensitivity] || 0.5;
  }

  /**
   * Calculate PII handling score (0-1)
   */
  private calculatePIIScore(dataCategories: string[]): number {
    const piiCategories = ['pii', 'phi', 'financial', 'biometric', 'genetic'];
    const piiCount = dataCategories.filter((c) =>
      piiCategories.some((p) => c.toLowerCase().includes(p))
    ).length;
    return Math.min(piiCount * 0.25, 1.0);
  }

  /**
   * Calculate external access score (0-1)
   */
  private calculateExternalAccessScore(model: AIModelMetadata): number {
    if (!model.endpoints || model.endpoints.length === 0) return 0.2;
    const hasPublicEndpoint = model.endpoints.some(
      (e) => e.includes('public') || e.includes('external')
    );
    return hasPublicEndpoint ? 0.8 : 0.4;
  }

  /**
   * Calculate complexity score (0-1)
   */
  private calculateComplexityScore(model: AIModelMetadata): number {
    const complexityScores: Record<string, number> = {
      'classification': 0.3,
      'embedding': 0.4,
      'llm': 0.7,
      'generation': 0.6,
      'multimodal': 0.9,
      'custom': 0.8,
    };
    return complexityScores[model.modelType || 'custom'] || 0.5;
  }

  /**
   * Calculate audit coverage score (0-1)
   */
  private calculateAuditCoverageScore(model: AIModelMetadata): number {
    if (!model.lastAuditedAt) return 1.0; // High risk if never audited
    const daysSinceAudit = Math.floor(
      (Date.now() - model.lastAuditedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceAudit < 30) return 0.1;
    if (daysSinceAudit < 90) return 0.3;
    if (daysSinceAudit < 180) return 0.6;
    return 0.9;
  }

  /**
   * Calculate compliance score (0-1)
   */
  private calculateComplianceScore(model: AIModelMetadata): number {
    const frameworkCount = model.complianceFrameworks?.length || 0;
    if (frameworkCount === 0) return 0.8; // High risk if no compliance frameworks
    if (frameworkCount >= 3) return 0.1;
    if (frameworkCount >= 2) return 0.3;
    return 0.5;
  }

  /**
   * Convert score to risk level
   */
  private scoreToRiskLevel(score: number): RiskLevel {
    if (score >= 0.75) return 'critical';
    if (score >= 0.5) return 'high';
    if (score >= 0.25) return 'medium';
    return 'low';
  }

  /**
   * Calculate next review date based on risk level
   */
  private calculateNextReviewDate(riskLevel: RiskLevel): Date {
    const reviewDays: Record<RiskLevel, number> = {
      'critical': 30,
      'high': 60,
      'medium': 90,
      'low': 180,
    };
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + reviewDays[riskLevel]);
    return nextReview;
  }

  /**
   * Generate risk recommendations
   */
  private generateRiskRecommendations(
    model: AIModelMetadata,
    factors: RiskFactor[],
    overallScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (!model.lastAuditedAt) {
      recommendations.push('Schedule initial security audit for this model');
    }

    if (!model.complianceFrameworks || model.complianceFrameworks.length === 0) {
      recommendations.push('Define applicable compliance frameworks');
    }

    if (model.dataSensitivity === 'restricted' || model.dataSensitivity === 'top-secret') {
      recommendations.push('Implement enhanced access controls for sensitive data handling');
      recommendations.push('Enable full audit logging');
    }

    if (model.modelType === 'llm' || model.modelType === 'multimodal') {
      recommendations.push('Enable prompt injection detection');
      recommendations.push('Configure output filtering for PII');
    }

    if (overallScore >= 0.5) {
      recommendations.push('Consider additional bias monitoring');
      recommendations.push('Review rate limiting configuration');
    }

    if (model.deploymentStatus === 'production' && !model.retentionPolicy) {
      recommendations.push('Define data retention policy');
    }

    return recommendations;
  }

  /**
   * Export model inventory for compliance
   */
  async exportInventory(): Promise<{
    exportedAt: Date;
    modelCount: number;
    models: AIModelMetadata[];
    summary: {
      byRiskLevel: Record<RiskLevel, number>;
      byStatus: Record<DeploymentStatus, number>;
      byProvider: Record<string, number>;
    };
  }> {
    const models = await this.listModels();

    const byRiskLevel: Record<RiskLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    const byStatus: Record<DeploymentStatus, number> = {
      development: 0,
      staging: 0,
      production: 0,
      deprecated: 0,
      retired: 0,
    };

    const byProvider: Record<string, number> = {};

    for (const model of models) {
      byRiskLevel[model.riskLevel]++;
      byStatus[model.deploymentStatus]++;
      byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
    }

    return {
      exportedAt: new Date(),
      modelCount: models.length,
      models,
      summary: {
        byRiskLevel,
        byStatus,
        byProvider,
      },
    };
  }
}

export default ModelRegistry;
