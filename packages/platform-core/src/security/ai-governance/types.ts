/**
 * AI Governance Type Definitions
 * Vorion Security Platform
 */

// Risk classification levels
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// Audit levels for model access
export type AuditLevel = 'none' | 'basic' | 'detailed' | 'full';

// Data classification levels
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted' | 'top-secret';

// Model deployment status
export type DeploymentStatus = 'development' | 'staging' | 'production' | 'deprecated' | 'retired';

// Bias detection alert severity
export type BiasAlertSeverity = 'info' | 'warning' | 'critical';

/**
 * AI Model Metadata - Complete model inventory information
 */
export interface AIModelMetadata {
  id: string;
  name: string;
  provider: string;
  version: string;
  capabilities: string[];
  riskLevel: RiskLevel;
  dataCategories: string[];
  deployedAt: Date;
  lastAuditedAt?: Date;
  description?: string;
  owner?: string;
  team?: string;
  tags?: string[];
  endpoints?: string[];
  maxTokens?: number;
  costPerToken?: number;
  deploymentStatus: DeploymentStatus;
  complianceFrameworks?: string[];
  dataSensitivity: DataClassification;
  retentionPolicy?: string;
  modelType?: 'llm' | 'embedding' | 'classification' | 'generation' | 'multimodal' | 'custom';
  trainingDataInfo?: TrainingDataInfo;
}

/**
 * Training data information for transparency
 */
export interface TrainingDataInfo {
  sources: string[];
  cutoffDate?: Date;
  dataCategories: string[];
  biasAssessmentDate?: Date;
  privacyReview?: boolean;
}

/**
 * Model Access Policy - Controls who can access AI models
 */
export interface ModelAccessPolicy {
  modelId: string;
  allowedRoles: string[];
  allowedDepartments: string[];
  requireMFA: boolean;
  maxQueriesPerHour: number;
  dataClassificationLimit: DataClassification;
  auditLevel: AuditLevel;
  allowedOperations?: string[];
  deniedOperations?: string[];
  timeRestrictions?: TimeRestriction[];
  ipWhitelist?: string[];
  ipBlacklist?: string[];
  requireApproval?: boolean;
  approvers?: string[];
  expiresAt?: Date;
  maxTokensPerQuery?: number;
  maxCostPerDay?: number;
  geographicRestrictions?: string[];
}

/**
 * Time-based access restrictions
 */
export interface TimeRestriction {
  dayOfWeek: number[];
  startHour: number;
  endHour: number;
  timezone: string;
}

/**
 * Prompt injection detection result
 */
export interface InjectionDetectionResult {
  isInjectionAttempt: boolean;
  confidence: number;
  detectedPatterns: DetectedPattern[];
  sanitizedInput?: string;
  riskScore: number;
  recommendations: string[];
  blocked: boolean;
  originalInput: string;
  timestamp: Date;
}

/**
 * Detected pattern in injection analysis
 */
export interface DetectedPattern {
  type: InjectionPatternType;
  pattern: string;
  location: { start: number; end: number };
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

/**
 * Types of injection patterns
 */
export type InjectionPatternType =
  | 'role-manipulation'
  | 'instruction-override'
  | 'context-manipulation'
  | 'delimiter-injection'
  | 'encoding-attack'
  | 'jailbreak'
  | 'prompt-leaking'
  | 'system-prompt-extraction'
  | 'recursive-injection'
  | 'context-overflow';

/**
 * Output filter result
 */
export interface OutputFilterResult {
  originalOutput: string;
  filteredOutput: string;
  wasFiltered: boolean;
  piiDetected: PIIDetection[];
  sensitiveDataDetected: SensitiveDataMatch[];
  hallucinationIndicators: HallucinationIndicator[];
  confidenceScore: number;
  validationErrors: ValidationError[];
  blocked: boolean;
  redactionCount: number;
}

/**
 * PII detection result
 */
export interface PIIDetection {
  type: PIIType;
  value: string;
  redactedValue: string;
  location: { start: number; end: number };
  confidence: number;
}

/**
 * Types of PII that can be detected
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit-card'
  | 'address'
  | 'name'
  | 'dob'
  | 'ip-address'
  | 'passport'
  | 'driver-license'
  | 'bank-account'
  | 'medical-record'
  | 'biometric';

/**
 * Sensitive data pattern match
 */
export interface SensitiveDataMatch {
  category: string;
  pattern: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  redacted: boolean;
}

/**
 * Hallucination indicator
 */
export interface HallucinationIndicator {
  type: 'factual-inconsistency' | 'temporal-error' | 'contradiction' | 'unsupported-claim' | 'confidence-mismatch';
  description: string;
  confidence: number;
  location?: { start: number; end: number };
}

/**
 * Validation error in output
 */
export interface ValidationError {
  rule: string;
  message: string;
  severity: 'warning' | 'error';
  field?: string;
}

/**
 * AI Audit Log Entry
 */
export interface AIAuditLogEntry {
  id: string;
  timestamp: Date;
  modelId: string;
  userId: string;
  sessionId: string;
  action: AIAuditAction;
  query?: QueryAuditData;
  response?: ResponseAuditData;
  tokenUsage: TokenUsage;
  cost: CostAttribution;
  metadata: AuditMetadata;
  complianceFlags?: string[];
  riskIndicators?: string[];
  ipAddress?: string;
  userAgent?: string;
  geolocation?: GeolocationData;
}

/**
 * AI audit action types
 */
export type AIAuditAction =
  | 'query'
  | 'query-blocked'
  | 'response'
  | 'response-filtered'
  | 'rate-limit-exceeded'
  | 'policy-violation'
  | 'injection-detected'
  | 'bias-detected'
  | 'access-denied'
  | 'model-registered'
  | 'model-updated'
  | 'policy-updated';

/**
 * Query audit data
 */
export interface QueryAuditData {
  prompt: string;
  sanitizedPrompt?: string;
  templateId?: string;
  parameters?: Record<string, unknown>;
  injectionDetectionResult?: InjectionDetectionResult;
}

/**
 * Response audit data
 */
export interface ResponseAuditData {
  response: string;
  filteredResponse?: string;
  filterResult?: OutputFilterResult;
  latencyMs: number;
  modelVersion: string;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

/**
 * Cost attribution
 */
export interface CostAttribution {
  totalCost: number;
  currency: string;
  breakdown: CostBreakdown;
  department?: string;
  project?: string;
  costCenter?: string;
}

/**
 * Cost breakdown
 */
export interface CostBreakdown {
  promptCost: number;
  completionCost: number;
  additionalCosts?: Record<string, number>;
}

/**
 * Audit metadata
 */
export interface AuditMetadata {
  environment: string;
  region?: string;
  applicationId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  customFields?: Record<string, unknown>;
}

/**
 * Geolocation data
 */
export interface GeolocationData {
  country: string;
  region?: string;
  city?: string;
  timezone?: string;
}

/**
 * Bias detection result
 */
export interface BiasDetectionResult {
  modelId: string;
  analysisId: string;
  timestamp: Date;
  metrics: BiasMetrics;
  alerts: BiasAlert[];
  recommendations: string[];
  overallScore: number;
  passesThreshold: boolean;
}

/**
 * Bias metrics
 */
export interface BiasMetrics {
  demographicParity: DemographicParityMetric;
  equalOpportunity: EqualOpportunityMetric;
  responseConsistency: ResponseConsistencyMetric;
  representationGap: RepresentationGapMetric;
  customMetrics?: Record<string, number>;
}

/**
 * Demographic parity metric
 */
export interface DemographicParityMetric {
  score: number;
  threshold: number;
  passes: boolean;
  groupScores: Record<string, number>;
  maxDisparity: number;
}

/**
 * Equal opportunity metric
 */
export interface EqualOpportunityMetric {
  score: number;
  threshold: number;
  passes: boolean;
  truePositiveRates: Record<string, number>;
  falsePositiveRates: Record<string, number>;
}

/**
 * Response consistency metric
 */
export interface ResponseConsistencyMetric {
  score: number;
  threshold: number;
  passes: boolean;
  variationByGroup: Record<string, number>;
  semanticSimilarityScore: number;
}

/**
 * Representation gap metric
 */
export interface RepresentationGapMetric {
  score: number;
  threshold: number;
  passes: boolean;
  underrepresentedGroups: string[];
  overrepresentedGroups: string[];
}

/**
 * Bias alert
 */
export interface BiasAlert {
  id: string;
  severity: BiasAlertSeverity;
  metricType: string;
  description: string;
  affectedGroups: string[];
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt?: Date;
  resolution?: string;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  modelId: string;
  limits: RateLimitRule[];
  burstConfig: BurstConfig;
  costLimits: CostLimit[];
  enforcementMode: 'strict' | 'warn' | 'log-only';
}

/**
 * Rate limit rule
 */
export interface RateLimitRule {
  type: 'token' | 'request' | 'cost';
  limit: number;
  window: number; // seconds
  scope: 'user' | 'department' | 'organization' | 'global';
  action: 'block' | 'queue' | 'degrade';
}

/**
 * Burst configuration
 */
export interface BurstConfig {
  enabled: boolean;
  maxBurstMultiplier: number;
  recoveryTimeSeconds: number;
  burstWindowSeconds: number;
}

/**
 * Cost limit
 */
export interface CostLimit {
  scope: 'user' | 'department' | 'organization';
  scopeId?: string;
  dailyLimit: number;
  monthlyLimit: number;
  currency: string;
  alertThresholds: number[];
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  modelId: string;
  userId: string;
  isLimited: boolean;
  currentUsage: RateLimitUsage;
  limits: RateLimitRule[];
  resetAt: Date;
  retryAfterSeconds?: number;
  remainingQuota: RemainingQuota;
}

/**
 * Rate limit usage
 */
export interface RateLimitUsage {
  tokens: number;
  requests: number;
  cost: number;
  windowStart: Date;
}

/**
 * Remaining quota
 */
export interface RemainingQuota {
  tokens: number;
  requests: number;
  costBudget: number;
}

/**
 * Prompt template for enforcement
 */
export interface PromptTemplate {
  id: string;
  name: string;
  version: string;
  template: string;
  variables: PromptVariable[];
  constraints: PromptConstraint[];
  securityLevel: DataClassification;
  allowedModels: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: Date;
}

/**
 * Prompt variable definition
 */
export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  maxLength?: number;
  pattern?: string;
  allowedValues?: unknown[];
  sanitize: boolean;
  description?: string;
}

/**
 * Prompt constraint
 */
export interface PromptConstraint {
  type: 'max-length' | 'required-prefix' | 'forbidden-content' | 'format' | 'custom';
  value: unknown;
  errorMessage: string;
}

/**
 * Compliance report
 */
export interface ComplianceReport {
  id: string;
  modelId: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'on-demand';
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: ComplianceSummary;
  details: ComplianceDetails;
  recommendations: string[];
  overallScore: number;
  status: 'compliant' | 'non-compliant' | 'needs-review';
}

/**
 * Compliance summary
 */
export interface ComplianceSummary {
  totalQueries: number;
  blockedQueries: number;
  filteredResponses: number;
  policyViolations: number;
  biasAlerts: number;
  injectionAttempts: number;
  averageResponseTime: number;
  totalCost: number;
  uniqueUsers: number;
}

/**
 * Compliance details
 */
export interface ComplianceDetails {
  accessControlCompliance: number;
  dataProtectionCompliance: number;
  auditingCompliance: number;
  biasMonitoringCompliance: number;
  incidentCount: number;
  incidentsByCategory: Record<string, number>;
  topViolations: ViolationSummary[];
}

/**
 * Violation summary
 */
export interface ViolationSummary {
  type: string;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  lastOccurrence: Date;
}

/**
 * AI Governance configuration
 */
export interface AIGovernanceConfig {
  enabled: boolean;
  defaultAuditLevel: AuditLevel;
  defaultRiskLevel: RiskLevel;
  injectionDetection: InjectionDetectionConfig;
  outputFiltering: OutputFilteringConfig;
  biasMonitoring: BiasMonitoringConfig;
  rateLimiting: RateLimitingConfig;
  complianceSettings: ComplianceSettings;
}

/**
 * Injection detection configuration
 */
export interface InjectionDetectionConfig {
  enabled: boolean;
  strictMode: boolean;
  blockOnDetection: boolean;
  sensitivityLevel: 'low' | 'medium' | 'high';
  customPatterns: string[];
  whitelistedPatterns: string[];
}

/**
 * Output filtering configuration
 */
export interface OutputFilteringConfig {
  enabled: boolean;
  piiDetection: boolean;
  piiRedaction: boolean;
  sensitiveDataPatterns: string[];
  hallucinationDetection: boolean;
  confidenceThreshold: number;
}

/**
 * Bias monitoring configuration
 */
export interface BiasMonitoringConfig {
  enabled: boolean;
  alertThresholds: Record<string, number>;
  monitoringFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
  protectedAttributes: string[];
}

/**
 * Rate limiting configuration
 */
export interface RateLimitingConfig {
  enabled: boolean;
  defaultLimits: RateLimitRule[];
  burstConfig: BurstConfig;
  enforcementMode: 'strict' | 'warn' | 'log-only';
}

/**
 * Compliance settings
 */
export interface ComplianceSettings {
  frameworks: string[];
  dataRetentionDays: number;
  reportingFrequency: 'daily' | 'weekly' | 'monthly';
  automatedReporting: boolean;
  alertRecipients: string[];
}

/**
 * Event emitter types for AI governance events
 */
export interface AIGovernanceEvents {
  'model:registered': AIModelMetadata;
  'model:updated': AIModelMetadata;
  'model:deprecated': { modelId: string; reason: string };
  'policy:created': ModelAccessPolicy;
  'policy:updated': ModelAccessPolicy;
  'policy:violated': { policy: ModelAccessPolicy; violation: string; userId: string };
  'injection:detected': InjectionDetectionResult;
  'output:filtered': OutputFilterResult;
  'bias:detected': BiasDetectionResult;
  'rate-limit:exceeded': RateLimitStatus;
  'audit:logged': AIAuditLogEntry;
  'compliance:report': ComplianceReport;
}
