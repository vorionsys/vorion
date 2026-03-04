/**
 * Risk Scoring Engine
 * Multi-factor risk calculation with historical incident weighting and industry benchmarks
 */

import {
  TrustScore,
  TrustGrade,
  TrustFactor,
  TrustFactorCategory,
  TrustTrend,
  RiskAssessment,
  RiskLevel,
  RiskCategory,
  Recommendation,
  RequiredAction,
  ControlStatus,
  VendorInfo,
  VendorTier,
  ComplianceCertification,
  SecurityRating,
  BreachRecord,
  HealthEvent,
  DataQualityMetrics,
} from './types';

// ============================================================================
// Risk Scorer Configuration
// ============================================================================

export interface RiskScorerConfig {
  factorWeights: FactorWeights;
  industryBenchmarks: IndustryBenchmarks;
  incidentDecayRate: number; // How fast historical incidents lose weight (0-1)
  minimumDataQuality: number; // Minimum data quality score to trust results
  gradeThresholds: GradeThresholds;
  riskThresholds: RiskThresholds;
}

export interface FactorWeights {
  security_posture: number;
  compliance: number;
  financial_stability: number;
  operational_resilience: number;
  data_protection: number;
  incident_history: number;
  reputation: number;
  contractual_compliance: number;
}

export interface IndustryBenchmarks {
  [industry: string]: {
    averageScore: number;
    percentiles: {
      p25: number;
      p50: number;
      p75: number;
      p90: number;
    };
    requiredCertifications: string[];
  };
}

export interface GradeThresholds {
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface RiskThresholds {
  low: number;
  medium: number;
  high: number;
}

// ============================================================================
// Risk Scorer Service
// ============================================================================

export class RiskScorer {
  private readonly config: RiskScorerConfig;
  private readonly scoreHistory: Map<string, TrustScore[]> = new Map();

  constructor(config: Partial<RiskScorerConfig> = {}) {
    this.config = {
      factorWeights: config.factorWeights || this.getDefaultFactorWeights(),
      industryBenchmarks: config.industryBenchmarks || this.getDefaultBenchmarks(),
      incidentDecayRate: config.incidentDecayRate || 0.1,
      minimumDataQuality: config.minimumDataQuality || 0.6,
      gradeThresholds: config.gradeThresholds || { A: 90, B: 80, C: 70, D: 60 },
      riskThresholds: config.riskThresholds || { low: 75, medium: 50, high: 25 },
    };
  }

  // ============================================================================
  // Trust Score Calculation
  // ============================================================================

  async calculateTrustScore(input: TrustScoreInput): Promise<TrustScore> {
    // Calculate individual factor scores
    const factors = await this.calculateFactors(input);

    // Calculate overall score (weighted average)
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Apply industry benchmark adjustment
    const benchmarkAdjustedScore = this.applyBenchmarkAdjustment(
      overallScore,
      input.vendor.industry,
    );

    // Calculate data quality
    const dataQuality = this.calculateDataQuality(input);

    // Determine grade
    const grade = this.calculateGrade(benchmarkAdjustedScore);

    // Determine trend
    const trend = this.calculateTrend(input.vendorId, benchmarkAdjustedScore);

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(dataQuality, factors);

    const now = new Date();
    const trustScore: TrustScore = {
      score: Math.round(benchmarkAdjustedScore * 100) / 100,
      grade,
      factors,
      calculatedAt: now,
      validUntil: new Date(now.getTime() + this.getValidityDuration(input.vendor.tier)),
      trend,
      confidence,
      dataQuality,
    };

    // Store in history for trend analysis
    this.storeScoreHistory(input.vendorId, trustScore);

    return trustScore;
  }

  private async calculateFactors(input: TrustScoreInput): Promise<TrustFactor[]> {
    const factors: TrustFactor[] = [];

    // Security Posture
    factors.push(await this.calculateSecurityPostureFactor(input));

    // Compliance
    factors.push(await this.calculateComplianceFactor(input));

    // Financial Stability
    factors.push(await this.calculateFinancialStabilityFactor(input));

    // Operational Resilience
    factors.push(await this.calculateOperationalResilienceFactor(input));

    // Data Protection
    factors.push(await this.calculateDataProtectionFactor(input));

    // Incident History
    factors.push(await this.calculateIncidentHistoryFactor(input));

    // Reputation
    factors.push(await this.calculateReputationFactor(input));

    // Contractual Compliance
    factors.push(await this.calculateContractualComplianceFactor(input));

    return factors;
  }

  private async calculateSecurityPostureFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    // Aggregate security ratings from external sources
    if (input.securityRatings && input.securityRatings.length > 0) {
      const avgRating = input.securityRatings.reduce((sum, r) => sum + r.rating, 0) / input.securityRatings.length;
      score = avgRating;
      evidenceSources.push(...input.securityRatings.map(r => r.source));

      // Analyze critical issues
      for (const rating of input.securityRatings) {
        for (const factor of rating.factors) {
          const criticalIssues = factor.issues.filter(i => i.severity === 'critical');
          for (const issue of criticalIssues) {
            findings.push(`[Critical] ${issue.title}`);
            score -= 5;
          }

          const highIssues = factor.issues.filter(i => i.severity === 'high');
          for (const issue of highIssues) {
            findings.push(`[High] ${issue.title}`);
            score -= 2;
          }
        }
      }
    } else {
      findings.push('No external security ratings available');
      score = 50; // Unknown state
    }

    // Check security questionnaire results
    if (input.securityQuestionnaire) {
      if (input.securityQuestionnaire.score < 70) {
        findings.push(`Security questionnaire score below threshold: ${input.securityQuestionnaire.score}%`);
        score -= 10;
      }
      evidenceSources.push('Security Questionnaire');
    }

    return {
      category: 'security_posture',
      weight: this.config.factorWeights.security_posture,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateComplianceFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    const requiredCerts = this.config.industryBenchmarks[input.vendor.industry]?.requiredCertifications || [];
    const vendorCerts = input.certifications || [];

    // Check for required certifications
    for (const required of requiredCerts) {
      const hasCert = vendorCerts.some(c =>
        c.framework === required && c.status === 'valid',
      );
      if (!hasCert) {
        findings.push(`Missing required certification: ${required}`);
        score -= 15;
      }
    }

    // Check certification statuses
    for (const cert of vendorCerts) {
      evidenceSources.push(`${cert.framework} Certificate`);

      if (cert.status === 'expired') {
        findings.push(`Expired certification: ${cert.framework}`);
        score -= 20;
      } else if (cert.status === 'expiring_soon') {
        findings.push(`Certification expiring soon: ${cert.framework}`);
        score -= 5;
      } else if (cert.status === 'revoked') {
        findings.push(`Revoked certification: ${cert.framework}`);
        score -= 30;
      }
    }

    // Compliance gap analysis
    if (input.complianceGaps && input.complianceGaps.length > 0) {
      for (const gap of input.complianceGaps) {
        findings.push(`Compliance gap: ${gap.description}`);
        score -= gap.severity === 'critical' ? 15 : gap.severity === 'high' ? 10 : 5;
      }
    }

    return {
      category: 'compliance',
      weight: this.config.factorWeights.compliance,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateFinancialStabilityFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 75; // Default for unknown

    if (input.financialData) {
      evidenceSources.push(input.financialData.source);
      score = 100;

      // Credit rating analysis
      if (input.financialData.creditRating) {
        const ratingScore = this.creditRatingToScore(input.financialData.creditRating);
        score = (score + ratingScore) / 2;
        if (ratingScore < 70) {
          findings.push(`Low credit rating: ${input.financialData.creditRating}`);
        }
      }

      // Revenue trend
      if (input.financialData.revenueGrowth !== undefined) {
        if (input.financialData.revenueGrowth < -10) {
          findings.push('Significant revenue decline detected');
          score -= 15;
        } else if (input.financialData.revenueGrowth < 0) {
          findings.push('Negative revenue growth');
          score -= 5;
        }
      }

      // Profitability
      if (input.financialData.profitMargin !== undefined) {
        if (input.financialData.profitMargin < 0) {
          findings.push('Operating at a loss');
          score -= 10;
        }
      }

      // Debt ratio
      if (input.financialData.debtToEquityRatio !== undefined) {
        if (input.financialData.debtToEquityRatio > 2) {
          findings.push('High debt-to-equity ratio');
          score -= 10;
        }
      }

      // Recent financial events
      if (input.financialData.recentEvents) {
        for (const event of input.financialData.recentEvents) {
          if (event.type === 'bankruptcy') {
            findings.push('Bankruptcy filing detected');
            score -= 40;
          } else if (event.type === 'layoffs') {
            findings.push('Significant layoffs announced');
            score -= 10;
          } else if (event.type === 'acquisition') {
            findings.push('Acquisition activity detected');
            score -= 5; // Neutral to slightly negative due to uncertainty
          }
        }
      }
    } else {
      findings.push('No financial data available');
    }

    return {
      category: 'financial_stability',
      weight: this.config.factorWeights.financial_stability,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateOperationalResilienceFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    // SLA performance
    if (input.slaPerformance && input.slaPerformance.length > 0) {
      evidenceSources.push('SLA Metrics');

      let totalBreaches = 0;
      let totalSLAs = input.slaPerformance.length;

      for (const sla of input.slaPerformance) {
        if (sla.breachCount > 0) {
          totalBreaches += sla.breachCount;
          findings.push(`SLA breaches for ${sla.name}: ${sla.breachCount}`);
        }
      }

      if (totalBreaches > 0) {
        const breachRate = (totalBreaches / totalSLAs) * 100;
        score -= Math.min(30, breachRate);
      }
    }

    // Uptime history
    if (input.uptimeHistory) {
      evidenceSources.push('Uptime Monitoring');

      const avgUptime = input.uptimeHistory.averageUptime;
      if (avgUptime < 99) {
        findings.push(`Below target uptime: ${avgUptime}%`);
        score -= (100 - avgUptime) * 2;
      }

      if (input.uptimeHistory.majorOutages > 0) {
        findings.push(`Major outages in past year: ${input.uptimeHistory.majorOutages}`);
        score -= input.uptimeHistory.majorOutages * 5;
      }
    }

    // Disaster recovery
    if (input.disasterRecovery) {
      evidenceSources.push('DR Assessment');

      if (!input.disasterRecovery.planExists) {
        findings.push('No disaster recovery plan documented');
        score -= 20;
      }

      if (!input.disasterRecovery.testedRecently) {
        findings.push('DR plan not tested recently');
        score -= 10;
      }

      if (input.disasterRecovery.rto && input.disasterRecovery.rto > 24) {
        findings.push(`High RTO: ${input.disasterRecovery.rto} hours`);
        score -= 5;
      }
    }

    return {
      category: 'operational_resilience',
      weight: this.config.factorWeights.operational_resilience,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateDataProtectionFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    // Data processing terms
    if (input.dataProcessingTerms) {
      evidenceSources.push('Data Processing Agreement');

      if (!input.dataProcessingTerms.dataSubjectRights) {
        findings.push('Data subject rights not properly addressed');
        score -= 15;
      }

      if (input.dataProcessingTerms.breachNotificationHours > 72) {
        findings.push(`Breach notification timeline exceeds 72 hours: ${input.dataProcessingTerms.breachNotificationHours}h`);
        score -= 10;
      }

      // Check for risky data transfers
      const riskyTransfers = input.dataProcessingTerms.transferMechanisms.filter(
        m => m === 'none' || m === 'consent_only',
      );
      if (riskyTransfers.length > 0) {
        findings.push('Questionable data transfer mechanisms');
        score -= 10;
      }
    }

    // Encryption practices
    if (input.encryptionPractices) {
      evidenceSources.push('Security Assessment');

      if (!input.encryptionPractices.atRest) {
        findings.push('Data not encrypted at rest');
        score -= 15;
      }

      if (!input.encryptionPractices.inTransit) {
        findings.push('Data not encrypted in transit');
        score -= 20;
      }

      if (input.encryptionPractices.keyManagement === 'poor') {
        findings.push('Poor key management practices');
        score -= 10;
      }
    }

    // Access controls
    if (input.accessControls) {
      evidenceSources.push('Access Control Assessment');

      if (!input.accessControls.mfaRequired) {
        findings.push('MFA not required for access');
        score -= 10;
      }

      if (!input.accessControls.roleBasedAccess) {
        findings.push('Role-based access control not implemented');
        score -= 10;
      }

      if (input.accessControls.privilegedAccessReviewFrequency === 'never') {
        findings.push('Privileged access never reviewed');
        score -= 15;
      }
    }

    return {
      category: 'data_protection',
      weight: this.config.factorWeights.data_protection,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateIncidentHistoryFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    // Breach history
    if (input.breachRecords && input.breachRecords.length > 0) {
      evidenceSources.push('Breach Databases');

      for (const breach of input.breachRecords) {
        const ageInDays = Math.floor(
          (Date.now() - breach.breachDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Apply decay - recent breaches count more
        const decayFactor = Math.exp(-this.config.incidentDecayRate * (ageInDays / 365));
        const severityScore = this.calculateBreachSeverity(breach);
        const impact = severityScore * decayFactor;

        findings.push(`Data breach (${breach.breachDate.toISOString().split('T')[0]}): ${breach.recordsAffected || 'Unknown'} records affected`);
        score -= impact;
      }
    }

    // Security incidents
    if (input.securityIncidents && input.securityIncidents.length > 0) {
      evidenceSources.push('Incident Reports');

      const recentIncidents = input.securityIncidents.filter(i => {
        const ageInDays = Math.floor(
          (Date.now() - i.detectedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        return ageInDays <= 365;
      });

      for (const incident of recentIncidents) {
        const severityImpact = {
          critical: 20,
          error: 10,
          warning: 5,
          info: 1,
        };
        findings.push(`Security incident: ${incident.title}`);
        score -= severityImpact[incident.severity] || 5;
      }
    }

    // Positive factor: No incidents
    if (score === 100) {
      findings.push('No security incidents or breaches on record');
    }

    return {
      category: 'incident_history',
      weight: this.config.factorWeights.incident_history,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateReputationFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 85; // Default neutral

    // Dark web mentions
    if (input.darkWebMentions && input.darkWebMentions.length > 0) {
      evidenceSources.push('Dark Web Monitoring');

      const credentialDumps = input.darkWebMentions.filter(m => m.mentionType === 'credential_dump');
      if (credentialDumps.length > 0) {
        findings.push(`Credentials found on dark web: ${credentialDumps.length} instances`);
        score -= Math.min(30, credentialDumps.length * 10);
      }

      const dataSales = input.darkWebMentions.filter(m => m.mentionType === 'data_sale');
      if (dataSales.length > 0) {
        findings.push(`Data sale listings found: ${dataSales.length} instances`);
        score -= Math.min(25, dataSales.length * 15);
      }
    }

    // Sanctions screening
    if (input.sanctionsMatches && input.sanctionsMatches.length > 0) {
      evidenceSources.push('Sanctions Lists');

      for (const match of input.sanctionsMatches) {
        if (match.matchScore > 0.9) {
          findings.push(`High-confidence sanctions match: ${match.source}`);
          score -= 50;
        } else if (match.matchScore > 0.7) {
          findings.push(`Potential sanctions match: ${match.source}`);
          score -= 20;
        }
      }
    }

    // News sentiment
    if (input.newsSentiment) {
      evidenceSources.push('News Analysis');

      if (input.newsSentiment.negativeArticles > 5) {
        findings.push(`Negative news coverage: ${input.newsSentiment.negativeArticles} articles`);
        score -= Math.min(20, input.newsSentiment.negativeArticles * 2);
      }

      if (input.newsSentiment.sentimentScore < -0.5) {
        findings.push('Significant negative sentiment in news coverage');
        score -= 15;
      }
    }

    // Industry standing
    if (input.industryRanking) {
      evidenceSources.push('Industry Analysis');

      if (input.industryRanking.percentile >= 90) {
        findings.push('Top 10% in industry reputation');
        score += 10;
      } else if (input.industryRanking.percentile <= 25) {
        findings.push('Bottom 25% in industry reputation');
        score -= 10;
      }
    }

    return {
      category: 'reputation',
      weight: this.config.factorWeights.reputation,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  private async calculateContractualComplianceFactor(input: TrustScoreInput): Promise<TrustFactor> {
    const findings: string[] = [];
    const evidenceSources: string[] = [];
    let score = 100;

    // Security requirements compliance
    if (input.securityRequirements && input.securityRequirements.length > 0) {
      evidenceSources.push('Contract Requirements');

      const mandatory = input.securityRequirements.filter(r => r.priority === 'mandatory');
      const unverifiedMandatory = mandatory.filter(r => !r.verified);

      if (unverifiedMandatory.length > 0) {
        findings.push(`Unverified mandatory requirements: ${unverifiedMandatory.length}`);
        score -= unverifiedMandatory.length * 10;
      }

      const recommended = input.securityRequirements.filter(r => r.priority === 'recommended');
      const unverifiedRecommended = recommended.filter(r => !r.verified);

      if (unverifiedRecommended.length > recommended.length / 2) {
        findings.push('Many recommended requirements unverified');
        score -= 5;
      }
    }

    // Audit rights
    if (input.contractualAuditRights) {
      evidenceSources.push('Contract Terms');

      if (!input.contractualAuditRights.exists) {
        findings.push('No audit rights in contract');
        score -= 15;
      } else if (!input.contractualAuditRights.exercised) {
        findings.push('Audit rights not exercised');
        score -= 5;
      }
    }

    // Response time compliance
    if (input.responseTimeMetrics) {
      evidenceSources.push('Support Metrics');

      if (input.responseTimeMetrics.averageResponseTime > input.responseTimeMetrics.targetResponseTime) {
        findings.push('Response time SLA not met');
        score -= 10;
      }

      if (input.responseTimeMetrics.escalationDelays > 0) {
        findings.push(`Escalation delays: ${input.responseTimeMetrics.escalationDelays}`);
        score -= 5;
      }
    }

    return {
      category: 'contractual_compliance',
      weight: this.config.factorWeights.contractual_compliance,
      score: Math.max(0, Math.min(100, score)),
      findings,
      evidenceSources,
      lastUpdated: new Date(),
    };
  }

  // ============================================================================
  // Risk Assessment
  // ============================================================================

  async assessRisk(input: RiskAssessmentInput): Promise<RiskAssessment> {
    const trustScore = await this.calculateTrustScore(input);
    const riskCategories = this.categorizeRisks(trustScore.factors, input);
    const recommendations = this.generateRecommendations(trustScore, riskCategories, input);
    const requiredActions = this.generateRequiredActions(trustScore, riskCategories, input);

    const overallRisk = this.calculateOverallRisk(trustScore.score);

    return {
      vendorId: input.vendorId,
      assessmentId: this.generateAssessmentId(),
      overallRisk,
      riskScore: 100 - trustScore.score,
      categories: riskCategories,
      recommendations,
      requiredActions,
      assessedAt: new Date(),
      validUntil: trustScore.validUntil,
      assessor: {
        type: 'automated',
        methodology: 'Trust Oracle Risk Assessment v1.0',
        version: '1.0.0',
      },
    };
  }

  private categorizeRisks(factors: TrustFactor[], input: RiskAssessmentInput): RiskCategory[] {
    const categories: RiskCategory[] = [];

    // Map each factor to a risk category
    for (const factor of factors) {
      const riskLevel = this.scoreToRiskLevel(factor.score);
      const controls = this.getControlStatus(factor.category, input);

      categories.push({
        name: this.formatCategoryName(factor.category),
        risk: riskLevel,
        score: 100 - factor.score,
        description: this.getCategoryDescription(factor.category, factor.score),
        mitigations: this.getSuggestedMitigations(factor.category, factor.findings),
        controls,
      });
    }

    return categories.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.risk] - riskOrder[b.risk];
    });
  }

  private generateRecommendations(
    trustScore: TrustScore,
    categories: RiskCategory[],
    input: RiskAssessmentInput,
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Generate recommendations for each high-risk category
    for (const category of categories) {
      if (category.risk === 'critical' || category.risk === 'high') {
        const categoryRecs = this.getCategoryRecommendations(category, input);
        recommendations.push(...categoryRecs);
      }
    }

    // Add tier-specific recommendations
    if (input.vendor.tier === 'critical') {
      if (!input.certifications?.some(c => c.framework === 'SOC2_TYPE2' && c.status === 'valid')) {
        recommendations.push({
          id: `rec_${Date.now()}_soc2`,
          priority: 'high',
          category: 'Compliance',
          description: 'Require SOC 2 Type II certification for critical tier vendor',
          expectedImpact: 'Provides assurance of security controls over time',
          estimatedEffort: 'significant',
          deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        });
      }
    }

    // Score-based recommendations
    if (trustScore.score < 70) {
      recommendations.push({
        id: `rec_${Date.now()}_review`,
        priority: 'high',
        category: 'Governance',
        description: 'Schedule comprehensive vendor security review',
        expectedImpact: 'Identify and address critical security gaps',
        estimatedEffort: 'moderate',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    if (trustScore.trend === 'declining') {
      recommendations.push({
        id: `rec_${Date.now()}_monitoring`,
        priority: 'medium',
        category: 'Monitoring',
        description: 'Increase monitoring frequency due to declining trust score',
        expectedImpact: 'Early detection of further degradation',
        estimatedEffort: 'minimal',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private generateRequiredActions(
    trustScore: TrustScore,
    categories: RiskCategory[],
    input: RiskAssessmentInput,
  ): RequiredAction[] {
    const actions: RequiredAction[] = [];

    // Critical score threshold
    if (trustScore.score < 40) {
      actions.push({
        id: `action_${Date.now()}_suspend`,
        action: 'Immediate vendor relationship review',
        reason: 'Trust score below critical threshold',
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        consequence: 'Vendor suspension if not addressed',
        status: 'pending',
      });
    }

    // Critical category risks
    for (const category of categories) {
      if (category.risk === 'critical') {
        actions.push({
          id: `action_${Date.now()}_${category.name.toLowerCase().replace(/\s/g, '_')}`,
          action: `Address critical ${category.name} risks`,
          reason: `${category.name} risk level is critical`,
          deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          consequence: 'Escalation to executive review',
          status: 'pending',
        });
      }
    }

    // Certification expiration
    if (input.certifications) {
      const expiringSoon = input.certifications.filter(c => c.status === 'expiring_soon');
      for (const cert of expiringSoon) {
        actions.push({
          id: `action_${Date.now()}_cert_${cert.framework}`,
          action: `Obtain renewed ${cert.framework} certification`,
          reason: 'Certification expiring soon',
          deadline: cert.expirationDate,
          consequence: 'Compliance gap upon expiration',
          status: 'pending',
        });
      }
    }

    return actions;
  }

  private getCategoryRecommendations(
    category: RiskCategory,
    input: RiskAssessmentInput,
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    const categoryRecommendationMap: Record<string, Recommendation[]> = {
      'Security Posture': [
        {
          id: `rec_${Date.now()}_pentest`,
          priority: 'high',
          category: 'Security Posture',
          description: 'Request recent penetration test results',
          expectedImpact: 'Identify exploitable vulnerabilities',
          estimatedEffort: 'minimal',
        },
        {
          id: `rec_${Date.now()}_vuln`,
          priority: 'high',
          category: 'Security Posture',
          description: 'Review vulnerability management program',
          expectedImpact: 'Ensure timely patching of known vulnerabilities',
          estimatedEffort: 'moderate',
        },
      ],
      'Compliance': [
        {
          id: `rec_${Date.now()}_cert`,
          priority: 'high',
          category: 'Compliance',
          description: 'Verify and obtain missing certifications',
          expectedImpact: 'Meet compliance requirements',
          estimatedEffort: 'significant',
        },
      ],
      'Data Protection': [
        {
          id: `rec_${Date.now()}_dpa`,
          priority: 'high',
          category: 'Data Protection',
          description: 'Review and update data processing agreement',
          expectedImpact: 'Ensure proper data handling safeguards',
          estimatedEffort: 'moderate',
        },
      ],
      'Incident History': [
        {
          id: `rec_${Date.now()}_incident`,
          priority: 'high',
          category: 'Incident History',
          description: 'Request post-incident review reports',
          expectedImpact: 'Understand root causes and remediation',
          estimatedEffort: 'minimal',
        },
      ],
    };

    return categoryRecommendationMap[category.name] || [];
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private applyBenchmarkAdjustment(score: number, industry: string): number {
    const benchmark = this.config.industryBenchmarks[industry];
    if (!benchmark) return score;

    // Normalize score against industry average
    const deviation = score - benchmark.averageScore;
    const adjustmentFactor = 0.1; // 10% weight for industry comparison

    return score + (deviation * adjustmentFactor);
  }

  private calculateDataQuality(input: TrustScoreInput): DataQualityMetrics {
    let completeness = 0;
    let totalFields = 0;

    // Check data completeness
    const checkField = (value: unknown) => {
      totalFields++;
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length > 0) completeness++;
        else if (!Array.isArray(value)) completeness++;
      }
    };

    checkField(input.securityRatings);
    checkField(input.certifications);
    checkField(input.breachRecords);
    checkField(input.financialData);
    checkField(input.securityQuestionnaire);
    checkField(input.slaPerformance);
    checkField(input.uptimeHistory);

    const completenessScore = totalFields > 0 ? completeness / totalFields : 0;

    // Calculate freshness based on most recent data
    let freshness = 1;
    if (input.securityRatings && input.securityRatings.length > 0) {
      const mostRecent = Math.max(...input.securityRatings.map(r => r.fetchedAt.getTime()));
      const ageInDays = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
      freshness = Math.max(0, 1 - (ageInDays / 30)); // Decay over 30 days
    }

    return {
      completeness: completenessScore,
      freshness,
      accuracy: 0.9, // Assumed based on source reliability
      sourceCount: this.countUniqueSources(input),
    };
  }

  private countUniqueSources(input: TrustScoreInput): number {
    const sources = new Set<string>();

    if (input.securityRatings) {
      input.securityRatings.forEach(r => sources.add(r.source));
    }
    if (input.breachRecords) {
      input.breachRecords.forEach(b => sources.add(b.source));
    }
    if (input.financialData) {
      sources.add(input.financialData.source);
    }

    return sources.size;
  }

  private calculateGrade(score: number): TrustGrade {
    if (score >= this.config.gradeThresholds.A) return 'A';
    if (score >= this.config.gradeThresholds.B) return 'B';
    if (score >= this.config.gradeThresholds.C) return 'C';
    if (score >= this.config.gradeThresholds.D) return 'D';
    return 'F';
  }

  private calculateTrend(vendorId: string, currentScore: number): TrustTrend {
    const history = this.scoreHistory.get(vendorId) || [];

    if (history.length < 2) return 'stable';

    const recentScores = history.slice(-5).map(s => s.score);
    const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

    if (currentScore > avgRecent + 5) return 'improving';
    if (currentScore < avgRecent - 5) return 'declining';
    return 'stable';
  }

  private calculateConfidence(
    dataQuality: DataQualityMetrics,
    factors: TrustFactor[],
  ): number {
    const baseConfidence =
      (dataQuality.completeness * 0.4) +
      (dataQuality.freshness * 0.3) +
      (dataQuality.accuracy * 0.2) +
      (Math.min(dataQuality.sourceCount / 5, 1) * 0.1);

    // Reduce confidence if many factors have no evidence
    const factorsWithEvidence = factors.filter(f => f.evidenceSources.length > 0).length;
    const evidenceFactor = factorsWithEvidence / factors.length;

    return baseConfidence * 0.7 + evidenceFactor * 0.3;
  }

  private storeScoreHistory(vendorId: string, score: TrustScore): void {
    const history = this.scoreHistory.get(vendorId) || [];
    history.push(score);

    // Keep only last 100 scores
    if (history.length > 100) {
      history.shift();
    }

    this.scoreHistory.set(vendorId, history);
  }

  private getValidityDuration(tier: VendorTier): number {
    // Duration in milliseconds
    const durations: Record<VendorTier, number> = {
      critical: 24 * 60 * 60 * 1000, // 1 day
      high: 7 * 24 * 60 * 60 * 1000, // 1 week
      medium: 14 * 24 * 60 * 60 * 1000, // 2 weeks
      low: 30 * 24 * 60 * 60 * 1000, // 30 days
    };
    return durations[tier];
  }

  private calculateBreachSeverity(breach: BreachRecord): number {
    let severity = 10;

    if (breach.recordsAffected) {
      if (breach.recordsAffected > 1000000) severity = 40;
      else if (breach.recordsAffected > 100000) severity = 30;
      else if (breach.recordsAffected > 10000) severity = 20;
    }

    // Increase for sensitive data types
    const sensitiveTypes = ['passwords', 'financial', 'health', 'ssn', 'credit_card'];
    const hasSensitiveData = breach.dataTypes.some(t =>
      sensitiveTypes.some(s => t.toLowerCase().includes(s)),
    );
    if (hasSensitiveData) severity *= 1.5;

    return severity;
  }

  private creditRatingToScore(rating: string): number {
    const ratingScores: Record<string, number> = {
      'AAA': 100, 'AA+': 95, 'AA': 92, 'AA-': 89,
      'A+': 86, 'A': 83, 'A-': 80,
      'BBB+': 76, 'BBB': 72, 'BBB-': 68,
      'BB+': 62, 'BB': 56, 'BB-': 50,
      'B+': 44, 'B': 38, 'B-': 32,
      'CCC+': 26, 'CCC': 20, 'CCC-': 14,
      'CC': 8, 'C': 4, 'D': 0,
    };
    return ratingScores[rating.toUpperCase()] || 50;
  }

  private scoreToRiskLevel(score: number): RiskLevel {
    if (score >= this.config.riskThresholds.low) return 'low';
    if (score >= this.config.riskThresholds.medium) return 'medium';
    if (score >= this.config.riskThresholds.high) return 'high';
    return 'critical';
  }

  private calculateOverallRisk(trustScore: number): RiskLevel {
    return this.scoreToRiskLevel(trustScore);
  }

  private formatCategoryName(category: TrustFactorCategory): string {
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getCategoryDescription(category: TrustFactorCategory, score: number): string {
    const descriptions: Record<TrustFactorCategory, (score: number) => string> = {
      security_posture: (s) => s >= 80
        ? 'Strong security posture with minimal issues'
        : s >= 60
          ? 'Moderate security posture with some concerns'
          : 'Weak security posture requiring immediate attention',
      compliance: (s) => s >= 80
        ? 'Comprehensive compliance coverage'
        : s >= 60
          ? 'Adequate compliance with some gaps'
          : 'Significant compliance gaps identified',
      financial_stability: (s) => s >= 80
        ? 'Strong financial position'
        : s >= 60
          ? 'Stable financial condition'
          : 'Financial concerns requiring monitoring',
      operational_resilience: (s) => s >= 80
        ? 'Highly resilient operations'
        : s >= 60
          ? 'Adequate operational resilience'
          : 'Operational concerns identified',
      data_protection: (s) => s >= 80
        ? 'Strong data protection practices'
        : s >= 60
          ? 'Adequate data protection with room for improvement'
          : 'Data protection deficiencies identified',
      incident_history: (s) => s >= 80
        ? 'Clean incident history'
        : s >= 60
          ? 'Minor incidents with proper remediation'
          : 'Concerning incident history',
      reputation: (s) => s >= 80
        ? 'Strong market reputation'
        : s >= 60
          ? 'Neutral market standing'
          : 'Reputation concerns identified',
      contractual_compliance: (s) => s >= 80
        ? 'Excellent contractual compliance'
        : s >= 60
          ? 'Generally compliant with minor issues'
          : 'Contractual compliance issues identified',
    };

    return descriptions[category](score);
  }

  private getSuggestedMitigations(category: TrustFactorCategory, findings: string[]): string[] {
    const baseMitigations: Record<TrustFactorCategory, string[]> = {
      security_posture: [
        'Request updated penetration test',
        'Review vulnerability management program',
        'Verify security controls implementation',
      ],
      compliance: [
        'Obtain missing certifications',
        'Schedule compliance assessment',
        'Review regulatory requirements',
      ],
      financial_stability: [
        'Obtain financial guarantees',
        'Increase escrow requirements',
        'Monitor for early warning signs',
      ],
      operational_resilience: [
        'Review disaster recovery plans',
        'Verify backup procedures',
        'Test failover capabilities',
      ],
      data_protection: [
        'Update data processing agreement',
        'Verify encryption practices',
        'Review access controls',
      ],
      incident_history: [
        'Review post-incident reports',
        'Verify remediation actions',
        'Assess current controls',
      ],
      reputation: [
        'Enhanced due diligence',
        'Monitor news and social media',
        'Review sanctions lists regularly',
      ],
      contractual_compliance: [
        'Exercise audit rights',
        'Review SLA performance',
        'Update security requirements',
      ],
    };

    return baseMitigations[category] || [];
  }

  private getControlStatus(
    category: TrustFactorCategory,
    input: RiskAssessmentInput,
  ): ControlStatus[] {
    // Map controls based on category and available data
    const controls: ControlStatus[] = [];

    if (category === 'security_posture' && input.securityControls) {
      for (const control of input.securityControls) {
        controls.push({
          controlId: control.id,
          name: control.name,
          implemented: control.implemented,
          effectiveness: control.effectiveness,
          lastVerified: control.lastVerified,
        });
      }
    }

    return controls;
  }

  private generateAssessmentId(): string {
    return `assess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private getDefaultFactorWeights(): FactorWeights {
    return {
      security_posture: 0.25,
      compliance: 0.15,
      financial_stability: 0.10,
      operational_resilience: 0.15,
      data_protection: 0.15,
      incident_history: 0.10,
      reputation: 0.05,
      contractual_compliance: 0.05,
    };
  }

  private getDefaultBenchmarks(): IndustryBenchmarks {
    return {
      technology: {
        averageScore: 75,
        percentiles: { p25: 60, p50: 75, p75: 85, p90: 92 },
        requiredCertifications: ['SOC2_TYPE2', 'ISO27001'],
      },
      healthcare: {
        averageScore: 72,
        percentiles: { p25: 58, p50: 72, p75: 83, p90: 90 },
        requiredCertifications: ['SOC2_TYPE2', 'HIPAA', 'HITRUST'],
      },
      financial_services: {
        averageScore: 78,
        percentiles: { p25: 65, p50: 78, p75: 87, p90: 94 },
        requiredCertifications: ['SOC2_TYPE2', 'PCI_DSS', 'ISO27001'],
      },
      retail: {
        averageScore: 68,
        percentiles: { p25: 52, p50: 68, p75: 80, p90: 88 },
        requiredCertifications: ['PCI_DSS'],
      },
      default: {
        averageScore: 70,
        percentiles: { p25: 55, p50: 70, p75: 82, p90: 90 },
        requiredCertifications: [],
      },
    };
  }
}

// ============================================================================
// Input Types
// ============================================================================

export interface TrustScoreInput extends RiskAssessmentInput {
  vendorId: string;
}

export interface RiskAssessmentInput {
  vendorId: string;
  vendor: VendorInfo;
  securityRatings?: SecurityRating[];
  certifications?: ComplianceCertification[];
  breachRecords?: BreachRecord[];
  securityIncidents?: HealthEvent[];
  financialData?: FinancialData;
  securityQuestionnaire?: SecurityQuestionnaireResult;
  complianceGaps?: ComplianceGap[];
  slaPerformance?: SLAPerformance[];
  uptimeHistory?: UptimeHistory;
  disasterRecovery?: DisasterRecoveryInfo;
  dataProcessingTerms?: DataProcessingTermsInput;
  encryptionPractices?: EncryptionPractices;
  accessControls?: AccessControlsInfo;
  darkWebMentions?: DarkWebMention[];
  sanctionsMatches?: SanctionMatch[];
  newsSentiment?: NewsSentiment;
  industryRanking?: IndustryRanking;
  securityRequirements?: SecurityRequirementInput[];
  contractualAuditRights?: AuditRightsInfo;
  responseTimeMetrics?: ResponseTimeMetrics;
  securityControls?: SecurityControl[];
}

export interface FinancialData {
  source: string;
  creditRating?: string;
  revenueGrowth?: number;
  profitMargin?: number;
  debtToEquityRatio?: number;
  recentEvents?: FinancialEvent[];
}

export interface FinancialEvent {
  type: 'bankruptcy' | 'layoffs' | 'acquisition' | 'ipo' | 'funding';
  date: Date;
  description: string;
}

export interface SecurityQuestionnaireResult {
  score: number;
  completedAt: Date;
  responses: Record<string, unknown>;
}

export interface ComplianceGap {
  framework: string;
  control: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface SLAPerformance {
  name: string;
  target: number;
  actual: number;
  breachCount: number;
}

export interface UptimeHistory {
  averageUptime: number;
  majorOutages: number;
  minorIncidents: number;
}

export interface DisasterRecoveryInfo {
  planExists: boolean;
  testedRecently: boolean;
  rto?: number;
  rpo?: number;
}

export interface DataProcessingTermsInput {
  dataSubjectRights: boolean;
  breachNotificationHours: number;
  transferMechanisms: string[];
}

export interface EncryptionPractices {
  atRest: boolean;
  inTransit: boolean;
  keyManagement: 'strong' | 'adequate' | 'poor';
}

export interface AccessControlsInfo {
  mfaRequired: boolean;
  roleBasedAccess: boolean;
  privilegedAccessReviewFrequency: 'monthly' | 'quarterly' | 'annually' | 'never';
}

export interface DarkWebMention {
  mentionType: 'credential_dump' | 'data_sale' | 'discussion' | 'exploit';
  discoveredAt: Date;
  confidence: number;
}

export interface SanctionMatch {
  source: string;
  matchScore: number;
}

export interface NewsSentiment {
  negativeArticles: number;
  sentimentScore: number; // -1 to 1
}

export interface IndustryRanking {
  percentile: number;
}

export interface SecurityRequirementInput {
  priority: 'mandatory' | 'recommended';
  verified: boolean;
}

export interface AuditRightsInfo {
  exists: boolean;
  exercised: boolean;
}

export interface ResponseTimeMetrics {
  averageResponseTime: number;
  targetResponseTime: number;
  escalationDelays: number;
}

export interface SecurityControl {
  id: string;
  name: string;
  implemented: boolean;
  effectiveness: 'strong' | 'adequate' | 'weak' | 'missing';
  lastVerified: Date;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRiskScorer(config?: Partial<RiskScorerConfig>): RiskScorer {
  return new RiskScorer(config);
}
