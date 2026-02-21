/**
 * Trust Oracle Type Definitions
 * Core types for vendor trust scoring and risk assessment
 */

// ============================================================================
// Trust Score Types
// ============================================================================

export type TrustGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type TrustTrend = 'improving' | 'stable' | 'declining';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TrustScore {
  score: number; // 0-100
  grade: TrustGrade;
  factors: TrustFactor[];
  calculatedAt: Date;
  validUntil: Date;
  trend: TrustTrend;
  confidence: number; // 0-1, confidence in the score accuracy
  dataQuality: DataQualityMetrics;
}

export interface TrustFactor {
  category: TrustFactorCategory;
  weight: number; // 0-1, sum of all weights should be 1
  score: number; // 0-100
  findings: string[];
  evidenceSources: string[];
  lastUpdated: Date;
}

export type TrustFactorCategory =
  | 'security_posture'
  | 'compliance'
  | 'financial_stability'
  | 'operational_resilience'
  | 'data_protection'
  | 'incident_history'
  | 'reputation'
  | 'contractual_compliance';

export interface DataQualityMetrics {
  completeness: number; // 0-1
  freshness: number; // 0-1
  accuracy: number; // 0-1
  sourceCount: number;
}

// ============================================================================
// Risk Assessment Types
// ============================================================================

export interface RiskAssessment {
  vendorId: string;
  assessmentId: string;
  overallRisk: RiskLevel;
  riskScore: number; // 0-100
  categories: RiskCategory[];
  recommendations: Recommendation[];
  requiredActions: RequiredAction[];
  assessedAt: Date;
  validUntil: Date;
  assessor: AssessorInfo;
}

export interface RiskCategory {
  name: string;
  risk: RiskLevel;
  score: number;
  description: string;
  mitigations: string[];
  controls: ControlStatus[];
}

export interface ControlStatus {
  controlId: string;
  name: string;
  implemented: boolean;
  effectiveness: 'strong' | 'adequate' | 'weak' | 'missing';
  lastVerified: Date;
}

export interface Recommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
  expectedImpact: string;
  estimatedEffort: 'minimal' | 'moderate' | 'significant' | 'major';
  deadline?: Date;
}

export interface RequiredAction {
  id: string;
  action: string;
  reason: string;
  deadline: Date;
  consequence: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  assignee?: string;
}

export interface AssessorInfo {
  type: 'automated' | 'manual' | 'hybrid';
  assessorId?: string;
  methodology: string;
  version: string;
}

// ============================================================================
// Vendor Types
// ============================================================================

export interface VendorInfo {
  id: string;
  name: string;
  legalName: string;
  domain: string;
  industry: string;
  category: VendorCategory;
  tier: VendorTier;
  status: VendorStatus;
  contactInfo: VendorContact;
  metadata: VendorMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export type VendorCategory =
  | 'cloud_service'
  | 'software'
  | 'infrastructure'
  | 'professional_services'
  | 'managed_services'
  | 'hardware'
  | 'data_processor'
  | 'subcontractor'
  | 'other';

export type VendorTier = 'critical' | 'high' | 'medium' | 'low';

export type VendorStatus =
  | 'prospective'
  | 'onboarding'
  | 'active'
  | 'under_review'
  | 'suspended'
  | 'offboarding'
  | 'terminated';

export interface VendorContact {
  primaryContact: ContactPerson;
  securityContact?: ContactPerson;
  complianceContact?: ContactPerson;
  emergencyContacts: ContactPerson[];
}

export interface ContactPerson {
  name: string;
  email: string;
  phone?: string;
  role: string;
}

export interface VendorMetadata {
  headquarters: string;
  yearFounded?: number;
  employeeCount?: number;
  annualRevenue?: string;
  publiclyTraded: boolean;
  stockSymbol?: string;
  parentCompany?: string;
  subsidiaries?: string[];
  dataLocations: string[];
  certifications: string[];
  tags: string[];
}

// ============================================================================
// Contract & SLA Types
// ============================================================================

export interface Contract {
  id: string;
  vendorId: string;
  type: ContractType;
  status: ContractStatus;
  startDate: Date;
  endDate: Date;
  renewalDate?: Date;
  autoRenewal: boolean;
  value: ContractValue;
  slas: SLA[];
  dataProcessingTerms?: DataProcessingTerms;
  securityRequirements: SecurityRequirement[];
  documents: ContractDocument[];
  createdAt: Date;
  updatedAt: Date;
}

export type ContractType =
  | 'master_service_agreement'
  | 'subscription'
  | 'license'
  | 'professional_services'
  | 'data_processing_agreement'
  | 'nda'
  | 'other';

export type ContractStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'terminated';

export interface ContractValue {
  amount: number;
  currency: string;
  billingCycle: 'monthly' | 'quarterly' | 'annually' | 'one_time';
}

export interface SLA {
  id: string;
  name: string;
  metric: string;
  target: number;
  unit: string;
  measurementPeriod: string;
  penalty?: string;
  currentPerformance?: number;
  breachCount: number;
}

export interface DataProcessingTerms {
  dataCategories: string[];
  processingPurposes: string[];
  retentionPeriod: string;
  subProcessors: string[];
  transferMechanisms: string[];
  dataSubjectRights: boolean;
  breachNotificationHours: number;
}

export interface SecurityRequirement {
  id: string;
  requirement: string;
  priority: 'mandatory' | 'recommended';
  verified: boolean;
  verificationDate?: Date;
  evidence?: string;
}

export interface ContractDocument {
  id: string;
  name: string;
  type: string;
  version: string;
  uploadedAt: Date;
  expiresAt?: Date;
  url: string;
}

// ============================================================================
// Compliance Types
// ============================================================================

export interface ComplianceCertification {
  id: string;
  vendorId: string;
  framework: ComplianceFramework;
  status: CertificationStatus;
  certificationBody?: string;
  certificateNumber?: string;
  issueDate: Date;
  expirationDate: Date;
  scope: string;
  documents: CertificationDocument[];
  lastVerified: Date;
  verificationMethod: 'api' | 'manual' | 'attestation';
}

export type ComplianceFramework =
  | 'SOC2_TYPE1'
  | 'SOC2_TYPE2'
  | 'ISO27001'
  | 'ISO27017'
  | 'ISO27018'
  | 'PCI_DSS'
  | 'HIPAA'
  | 'GDPR'
  | 'CCPA'
  | 'FedRAMP'
  | 'StateRAMP'
  | 'NIST_CSF'
  | 'CSA_STAR'
  | 'HITRUST'
  | 'OTHER';

export type CertificationStatus =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'revoked'
  | 'pending_renewal'
  | 'not_applicable';

export interface CertificationDocument {
  id: string;
  type: 'certificate' | 'audit_report' | 'attestation' | 'bridge_letter';
  name: string;
  uploadedAt: Date;
  expiresAt?: Date;
  url: string;
}

// ============================================================================
// Monitoring & Health Types
// ============================================================================

export interface HealthEvent {
  id: string;
  vendorId: string;
  type: HealthEventType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  source: string;
  detectedAt: Date;
  resolvedAt?: Date;
  impact: string;
  metadata: Record<string, unknown>;
}

export type HealthEventType =
  | 'security_incident'
  | 'breach_disclosure'
  | 'certificate_expiring'
  | 'certificate_expired'
  | 'dns_change'
  | 'domain_expiring'
  | 'compliance_gap'
  | 'score_degradation'
  | 'sla_breach'
  | 'service_outage'
  | 'dark_web_mention'
  | 'sanctions_match'
  | 'negative_news'
  | 'financial_alert';

export interface MonitoringConfig {
  vendorId: string;
  enabled: boolean;
  frequency: MonitoringFrequency;
  checks: MonitoringCheck[];
  alertThresholds: AlertThreshold[];
  notificationChannels: string[];
}

export type MonitoringFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly';

export interface MonitoringCheck {
  type: string;
  enabled: boolean;
  frequency: MonitoringFrequency;
  lastRun?: Date;
  lastResult?: 'pass' | 'fail' | 'warning';
  config: Record<string, unknown>;
}

export interface AlertThreshold {
  metric: string;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
  value: number;
  severity: 'warning' | 'error' | 'critical';
}

// ============================================================================
// External Data Source Types
// ============================================================================

export interface SecurityRating {
  source: string;
  vendorId: string;
  domain: string;
  rating: number;
  grade?: string;
  factors: SecurityRatingFactor[];
  fetchedAt: Date;
  expiresAt: Date;
}

export interface SecurityRatingFactor {
  name: string;
  score: number;
  weight: number;
  issues: SecurityIssue[];
}

export interface SecurityIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  description: string;
  firstSeen: Date;
  lastSeen: Date;
  resolved: boolean;
}

export interface BreachRecord {
  id: string;
  vendorDomain: string;
  breachDate: Date;
  disclosureDate: Date;
  source: string;
  recordsAffected?: number;
  dataTypes: string[];
  description: string;
  verified: boolean;
}

export interface CertificateInfo {
  domain: string;
  issuer: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  daysUntilExpiry: number;
  algorithm: string;
  keySize: number;
  serialNumber: string;
  fingerprint: string;
  ctLogged: boolean;
}

export interface SanctionEntry {
  source: string;
  entityName: string;
  matchScore: number;
  listType: string;
  addedDate: Date;
  reason?: string;
  aliases: string[];
}

export interface ThreatIntelligence {
  source: string;
  vendorDomain: string;
  indicators: ThreatIndicator[];
  fetchedAt: Date;
}

export interface ThreatIndicator {
  type: 'ip' | 'domain' | 'hash' | 'email' | 'url';
  value: string;
  confidence: number;
  severity: string;
  description: string;
  firstSeen: Date;
  lastSeen: Date;
}

// ============================================================================
// Alert Types
// ============================================================================

export interface Alert {
  id: string;
  vendorId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  source: string;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  status: AlertStatus;
  assignee?: string;
  relatedEvents: string[];
  actions: AlertAction[];
  metadata: Record<string, unknown>;
}

export type AlertType =
  | 'trust_score_degradation'
  | 'breach_notification'
  | 'compliance_expiration'
  | 'certificate_expiration'
  | 'sla_violation'
  | 'contract_expiration'
  | 'security_incident'
  | 'sanctions_match'
  | 'dark_web_exposure';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export type AlertStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';

export interface AlertAction {
  type: 'link' | 'api_call' | 'workflow';
  label: string;
  target: string;
  parameters?: Record<string, unknown>;
}

// ============================================================================
// Report Types
// ============================================================================

export interface VendorRiskReport {
  id: string;
  vendorId: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  generatedBy: string;
  type: ReportType;
  format: 'json' | 'pdf' | 'csv' | 'excel';
  summary: ReportSummary;
  sections: ReportSection[];
  attachments: ReportAttachment[];
}

export type ReportType =
  | 'vendor_assessment'
  | 'periodic_review'
  | 'incident_report'
  | 'compliance_audit'
  | 'board_summary'
  | 'regulatory_submission';

export interface ReportSummary {
  overallRisk: RiskLevel;
  trustScore: number;
  trustGrade: TrustGrade;
  keyFindings: string[];
  criticalIssues: number;
  openActions: number;
  trend: TrustTrend;
}

export interface ReportSection {
  title: string;
  order: number;
  content: string;
  charts?: ChartData[];
  tables?: TableData[];
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'radar';
  title: string;
  data: Record<string, unknown>;
}

export interface TableData {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface ReportAttachment {
  name: string;
  type: string;
  size: number;
  url: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  requestId: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  actor: {
    id: string;
    type: 'user' | 'service' | 'system';
    name: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    name: string;
  };
  changes?: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
  metadata: Record<string, unknown>;
}

// ============================================================================
// Observable Type (for streaming)
// ============================================================================

export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
}

export interface Observer<T> {
  next: (value: T) => void;
  error: (error: Error) => void;
  complete: () => void;
}

export interface Subscription {
  unsubscribe(): void;
}
