/**
 * GDPR Compliance Module
 * Cross-border data transfer controls implementing Chapter V GDPR
 */

// Export all types
export type {
  DataTransfer,
  DataCategory,
  RecipientType,
  TransferLegalBasis,
  SCCModule,
  SupplementaryMeasure,
  EncryptionLevel,
  TransferDecision,
  TransferFilter,
  RiskAssessment,
  RiskLevel,
  RiskFactor,
  AdequacyDecision,
  SCCTemplate,
  SCCAnnex,
  SCCAgreement,
  PartyInfo,
  TransferImpactAssessment,
  SensitivityLevel,
  SafeguardEvaluation,
  SafeguardDetail,
  MeasuresAnalysis,
  TIAConclusion,
  DataLocalizationConfig,
  ProcessingLocation,
  TransferLogEntry,
  SchremsIIAssessment,
  GovernmentAccessRisk
} from './data-transfers';

// Export all classes
export {
  DataTransferService,
  AdequacyDecisionRegistry,
  SCCManager,
  TIAService,
  SchremsIIService,
  DataLocalizationManager,
  createDataTransferService
} from './data-transfers';
