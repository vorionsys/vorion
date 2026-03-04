/**
 * FedRAMP Plan of Action and Milestones (POA&M) Management
 *
 * Implements POA&M tracking for FedRAMP compliance including:
 * - Weakness tracking
 * - Remediation planning
 * - Milestone tracking
 * - Risk acceptance documentation
 * - Deviation requests
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import type { VulnerabilitySeverity } from './continuous-monitoring.js';

const logger = createLogger({ component: 'fedramp-poam' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * POA&M weakness status
 */
export const POAM_STATUSES = [
  'open',
  'ongoing',
  'completed',
  'closed',
  'risk-accepted',
  'false-positive',
  'delayed',
] as const;
export type POAMStatus = (typeof POAM_STATUSES)[number];

/**
 * Weakness source
 */
export const WEAKNESS_SOURCES = [
  'vulnerability-scan',
  'penetration-test',
  'security-assessment',
  'audit-finding',
  'incident',
  'self-identified',
  'configuration-scan',
  'continuous-monitoring',
] as const;
export type WeaknessSource = (typeof WEAKNESS_SOURCES)[number];

/**
 * Risk level for POA&M items
 */
export const RISK_LEVELS = ['very-high', 'high', 'moderate', 'low', 'very-low'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Deviation request type
 */
export const DEVIATION_TYPES = [
  'operational-requirement',
  'false-positive',
  'risk-acceptance',
  'compensating-control',
  'vendor-dependency',
] as const;
export type DeviationType = (typeof DEVIATION_TYPES)[number];

/**
 * Deviation request status
 */
export const DEVIATION_STATUSES = [
  'draft',
  'submitted',
  'under-review',
  'approved',
  'denied',
  'expired',
] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];

/**
 * POA&M milestone
 */
export interface POAMMilestone {
  /** Unique ID */
  id: string;
  /** Milestone number */
  number: number;
  /** Description of the milestone */
  description: string;
  /** Target completion date */
  targetDate: Date;
  /** Actual completion date */
  completedDate?: Date;
  /** Status */
  status: 'pending' | 'in-progress' | 'completed' | 'missed';
  /** Responsible party */
  responsibleParty: string;
  /** Notes */
  notes?: string;
  /** Percent complete */
  percentComplete: number;
}

export const milestoneSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  description: z.string().min(1),
  targetDate: z.coerce.date(),
  completedDate: z.coerce.date().optional(),
  status: z.enum(['pending', 'in-progress', 'completed', 'missed']),
  responsibleParty: z.string().min(1),
  notes: z.string().optional(),
  percentComplete: z.number().min(0).max(100),
});

/**
 * POA&M item (weakness)
 */
export interface POAMItem {
  /** Unique POA&M ID (e.g., POAM-2024-001) */
  id: string;
  /** POA&M item number for reporting */
  itemNumber: number;
  /** Source of the weakness */
  source: WeaknessSource;
  /** Source identifier (e.g., scan ID, audit finding ID) */
  sourceId?: string;
  /** Weakness title */
  title: string;
  /** Detailed description */
  description: string;
  /** Associated control IDs */
  controlIds: string[];
  /** Risk level */
  riskLevel: RiskLevel;
  /** Original severity from source */
  originalSeverity?: VulnerabilitySeverity;
  /** Adjusted severity after analysis */
  adjustedSeverity?: VulnerabilitySeverity;
  /** Severity adjustment justification */
  severityAdjustmentJustification?: string;
  /** Status */
  status: POAMStatus;
  /** Detection date */
  detectedDate: Date;
  /** Scheduled completion date */
  scheduledCompletionDate: Date;
  /** Actual completion date */
  actualCompletionDate?: Date;
  /** Point of contact */
  poc: string;
  /** POC email */
  pocEmail: string;
  /** Resources required */
  resourcesRequired: string;
  /** Estimated cost */
  estimatedCost?: number;
  /** Remediation plan */
  remediationPlan: string;
  /** Milestones */
  milestones: POAMMilestone[];
  /** Risk statement */
  riskStatement: string;
  /** Business impact */
  businessImpact: string;
  /** Comments/updates history */
  comments: POAMComment[];
  /** Deviation request ID if applicable */
  deviationRequestId?: string;
  /** Related vulnerability IDs */
  relatedVulnerabilityIds: string[];
  /** Evidence of completion */
  completionEvidence?: string[];
  /** Last status update */
  lastUpdated: Date;
  /** Vendor dependency */
  vendorDependency?: {
    vendor: string;
    expectedFixDate?: Date;
    ticketNumber?: string;
  };
  /** Days overdue (negative if not yet due) */
  daysOverdue: number;
  /** Is this a recurring/persistent weakness */
  isRecurring: boolean;
  /** Previous POA&M IDs if recurring */
  previousPOAMIds?: string[];
}

export const poamItemSchema = z.object({
  id: z.string().min(1),
  itemNumber: z.number().int().positive(),
  source: z.enum(WEAKNESS_SOURCES),
  sourceId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  controlIds: z.array(z.string()),
  riskLevel: z.enum(RISK_LEVELS),
  originalSeverity: z.enum(['critical', 'high', 'moderate', 'low']).optional(),
  adjustedSeverity: z.enum(['critical', 'high', 'moderate', 'low']).optional(),
  severityAdjustmentJustification: z.string().optional(),
  status: z.enum(POAM_STATUSES),
  detectedDate: z.coerce.date(),
  scheduledCompletionDate: z.coerce.date(),
  actualCompletionDate: z.coerce.date().optional(),
  poc: z.string().min(1),
  pocEmail: z.string().email(),
  resourcesRequired: z.string().min(1),
  estimatedCost: z.number().nonnegative().optional(),
  remediationPlan: z.string().min(1),
  milestones: z.array(milestoneSchema),
  riskStatement: z.string().min(1),
  businessImpact: z.string().min(1),
  comments: z.array(z.any()),
  deviationRequestId: z.string().optional(),
  relatedVulnerabilityIds: z.array(z.string()),
  completionEvidence: z.array(z.string()).optional(),
  lastUpdated: z.coerce.date(),
  vendorDependency: z
    .object({
      vendor: z.string(),
      expectedFixDate: z.coerce.date().optional(),
      ticketNumber: z.string().optional(),
    })
    .optional(),
  daysOverdue: z.number(),
  isRecurring: z.boolean(),
  previousPOAMIds: z.array(z.string()).optional(),
});

/**
 * POA&M comment/update
 */
export interface POAMComment {
  /** Comment ID */
  id: string;
  /** Author */
  author: string;
  /** Comment date */
  date: Date;
  /** Comment text */
  text: string;
  /** Status at time of comment */
  statusAtTime: POAMStatus;
}

/**
 * Deviation request
 */
export interface DeviationRequest {
  /** Unique ID */
  id: string;
  /** Associated POA&M ID */
  poamId: string;
  /** Deviation type */
  type: DeviationType;
  /** Request status */
  status: DeviationStatus;
  /** Title */
  title: string;
  /** Justification */
  justification: string;
  /** Risk analysis */
  riskAnalysis: string;
  /** Compensating controls (if applicable) */
  compensatingControls?: string;
  /** Business impact if not approved */
  businessImpact: string;
  /** Requested duration (days) */
  requestedDuration?: number;
  /** Expiration date for approved deviations */
  expirationDate?: Date;
  /** Submitted by */
  submittedBy: string;
  /** Submitted date */
  submittedDate: Date;
  /** Reviewed by (AO) */
  reviewedBy?: string;
  /** Review date */
  reviewDate?: Date;
  /** Review comments */
  reviewComments?: string;
  /** Attachments */
  attachments: string[];
}

export const deviationRequestSchema = z.object({
  id: z.string().min(1),
  poamId: z.string().min(1),
  type: z.enum(DEVIATION_TYPES),
  status: z.enum(DEVIATION_STATUSES),
  title: z.string().min(1),
  justification: z.string().min(1),
  riskAnalysis: z.string().min(1),
  compensatingControls: z.string().optional(),
  businessImpact: z.string().min(1),
  requestedDuration: z.number().positive().optional(),
  expirationDate: z.coerce.date().optional(),
  submittedBy: z.string().min(1),
  submittedDate: z.coerce.date(),
  reviewedBy: z.string().optional(),
  reviewDate: z.coerce.date().optional(),
  reviewComments: z.string().optional(),
  attachments: z.array(z.string()),
});

/**
 * POA&M configuration
 */
export interface POAMConfig {
  /** Organization name */
  organizationName: string;
  /** System name */
  systemName: string;
  /** ISSO name and email */
  isso: { name: string; email: string };
  /** System Owner */
  systemOwner: { name: string; email: string };
  /** Authorizing Official */
  authorizingOfficial: { name: string; email: string };
  /** POA&M ID prefix */
  idPrefix: string;
  /** Auto-calculate days overdue */
  autoCalculateOverdue: boolean;
  /** Alert threshold for upcoming deadlines (days) */
  upcomingDeadlineThreshold: number;
}

// =============================================================================
// POA&M SERVICE
// =============================================================================

/**
 * POA&M Management Service
 */
export class POAMService {
  private config: POAMConfig;
  private items: Map<string, POAMItem>;
  private deviations: Map<string, DeviationRequest>;
  private itemCounter: number;

  constructor(config: POAMConfig) {
    this.config = config;
    this.items = new Map();
    this.deviations = new Map();
    this.itemCounter = 0;

    logger.info(
      { systemName: config.systemName },
      'POA&M service initialized'
    );
  }

  // ===========================================================================
  // POA&M ITEM MANAGEMENT
  // ===========================================================================

  /**
   * Create a new POA&M item
   */
  createItem(item: Omit<POAMItem, 'id' | 'itemNumber' | 'comments' | 'lastUpdated' | 'daysOverdue'>): POAMItem {
    this.itemCounter++;
    const id = `${this.config.idPrefix}-${new Date().getFullYear()}-${String(this.itemCounter).padStart(3, '0')}`;

    const poamItem: POAMItem = {
      ...item,
      id,
      itemNumber: this.itemCounter,
      comments: [],
      lastUpdated: new Date(),
      daysOverdue: this.calculateDaysOverdue(item.scheduledCompletionDate),
    };

    poamItemSchema.parse(poamItem);
    this.items.set(id, poamItem);

    logger.info(
      { poamId: id, title: item.title, riskLevel: item.riskLevel },
      'POA&M item created'
    );

    return poamItem;
  }

  /**
   * Update a POA&M item
   */
  updateItem(id: string, updates: Partial<POAMItem>): POAMItem {
    const existing = this.items.get(id);
    if (!existing) {
      throw new Error(`POA&M item not found: ${id}`);
    }

    const updated: POAMItem = {
      ...existing,
      ...updates,
      id: existing.id,
      itemNumber: existing.itemNumber,
      lastUpdated: new Date(),
      daysOverdue: this.calculateDaysOverdue(updates.scheduledCompletionDate || existing.scheduledCompletionDate),
    };

    poamItemSchema.parse(updated);
    this.items.set(id, updated);

    logger.info({ poamId: id }, 'POA&M item updated');

    return updated;
  }

  /**
   * Add a comment to a POA&M item
   */
  addComment(poamId: string, author: string, text: string): POAMComment {
    const item = this.items.get(poamId);
    if (!item) {
      throw new Error(`POA&M item not found: ${poamId}`);
    }

    const comment: POAMComment = {
      id: randomUUID(),
      author,
      date: new Date(),
      text,
      statusAtTime: item.status,
    };

    item.comments.push(comment);
    item.lastUpdated = new Date();
    this.items.set(poamId, item);

    logger.debug({ poamId, author }, 'Comment added to POA&M item');

    return comment;
  }

  /**
   * Add a milestone to a POA&M item
   */
  addMilestone(
    poamId: string,
    milestone: Omit<POAMMilestone, 'id' | 'number'>
  ): POAMMilestone {
    const item = this.items.get(poamId);
    if (!item) {
      throw new Error(`POA&M item not found: ${poamId}`);
    }

    const newMilestone: POAMMilestone = {
      ...milestone,
      id: randomUUID(),
      number: item.milestones.length + 1,
    };

    item.milestones.push(newMilestone);
    item.lastUpdated = new Date();
    this.items.set(poamId, item);

    logger.debug({ poamId, milestoneNumber: newMilestone.number }, 'Milestone added to POA&M item');

    return newMilestone;
  }

  /**
   * Update a milestone
   */
  updateMilestone(
    poamId: string,
    milestoneId: string,
    updates: Partial<POAMMilestone>
  ): POAMMilestone {
    const item = this.items.get(poamId);
    if (!item) {
      throw new Error(`POA&M item not found: ${poamId}`);
    }

    const milestoneIndex = item.milestones.findIndex((m) => m.id === milestoneId);
    if (milestoneIndex === -1) {
      throw new Error(`Milestone not found: ${milestoneId}`);
    }

    item.milestones[milestoneIndex] = {
      ...item.milestones[milestoneIndex],
      ...updates,
      id: milestoneId,
      number: item.milestones[milestoneIndex].number,
    };

    item.lastUpdated = new Date();
    this.items.set(poamId, item);

    return item.milestones[milestoneIndex];
  }

  /**
   * Complete a milestone
   */
  completeMilestone(poamId: string, milestoneId: string): POAMMilestone {
    return this.updateMilestone(poamId, milestoneId, {
      status: 'completed',
      completedDate: new Date(),
      percentComplete: 100,
    });
  }

  /**
   * Close a POA&M item
   */
  closeItem(poamId: string, completionEvidence: string[]): POAMItem {
    const item = this.items.get(poamId);
    if (!item) {
      throw new Error(`POA&M item not found: ${poamId}`);
    }

    // Verify all milestones are complete
    const incompleteMilestones = item.milestones.filter((m) => m.status !== 'completed');
    if (incompleteMilestones.length > 0) {
      logger.warn(
        { poamId, incompleteMilestones: incompleteMilestones.length },
        'Closing POA&M with incomplete milestones'
      );
    }

    return this.updateItem(poamId, {
      status: 'closed',
      actualCompletionDate: new Date(),
      completionEvidence,
    });
  }

  /**
   * Get a POA&M item by ID
   */
  getItem(id: string): POAMItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all POA&M items
   */
  getAllItems(filter?: {
    status?: POAMStatus;
    riskLevel?: RiskLevel;
    controlId?: string;
    overdue?: boolean;
    source?: WeaknessSource;
  }): POAMItem[] {
    let items = Array.from(this.items.values());

    if (filter?.status) {
      items = items.filter((i) => i.status === filter.status);
    }
    if (filter?.riskLevel) {
      items = items.filter((i) => i.riskLevel === filter.riskLevel);
    }
    if (filter?.controlId) {
      items = items.filter((i) => i.controlIds.includes(filter.controlId!));
    }
    if (filter?.overdue !== undefined) {
      items = items.filter((i) => (filter.overdue ? i.daysOverdue > 0 : i.daysOverdue <= 0));
    }
    if (filter?.source) {
      items = items.filter((i) => i.source === filter.source);
    }

    return items.sort((a, b) => {
      // Sort by risk level then by days overdue
      const riskOrder: Record<RiskLevel, number> = {
        'very-high': 0,
        high: 1,
        moderate: 2,
        low: 3,
        'very-low': 4,
      };
      if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      }
      return b.daysOverdue - a.daysOverdue;
    });
  }

  /**
   * Get open POA&M items
   */
  getOpenItems(): POAMItem[] {
    return this.getAllItems().filter((i) => ['open', 'ongoing', 'delayed'].includes(i.status));
  }

  /**
   * Get overdue POA&M items
   */
  getOverdueItems(): POAMItem[] {
    return this.getAllItems({ overdue: true }).filter((i) =>
      ['open', 'ongoing', 'delayed'].includes(i.status)
    );
  }

  /**
   * Calculate days overdue (negative if not yet due)
   */
  private calculateDaysOverdue(scheduledDate: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - scheduledDate.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Update days overdue for all items
   */
  refreshOverdueCalculations(): void {
    for (const [id, item] of Array.from(this.items.entries())) {
      item.daysOverdue = this.calculateDaysOverdue(item.scheduledCompletionDate);
      this.items.set(id, item);
    }
  }

  // ===========================================================================
  // DEVIATION REQUESTS
  // ===========================================================================

  /**
   * Create a deviation request
   */
  createDeviationRequest(
    request: Omit<DeviationRequest, 'id' | 'status' | 'submittedDate'>
  ): DeviationRequest {
    const id = `DR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const deviation: DeviationRequest = {
      ...request,
      id,
      status: 'draft',
      submittedDate: new Date(),
    };

    deviationRequestSchema.parse(deviation);
    this.deviations.set(id, deviation);

    // Link to POA&M item
    const poam = this.items.get(request.poamId);
    if (poam) {
      poam.deviationRequestId = id;
      this.items.set(request.poamId, poam);
    }

    logger.info(
      { deviationId: id, poamId: request.poamId, type: request.type },
      'Deviation request created'
    );

    return deviation;
  }

  /**
   * Submit a deviation request
   */
  submitDeviationRequest(id: string): DeviationRequest {
    const deviation = this.deviations.get(id);
    if (!deviation) {
      throw new Error(`Deviation request not found: ${id}`);
    }

    deviation.status = 'submitted';
    deviation.submittedDate = new Date();
    this.deviations.set(id, deviation);

    logger.info({ deviationId: id }, 'Deviation request submitted');

    return deviation;
  }

  /**
   * Review a deviation request
   */
  reviewDeviationRequest(
    id: string,
    decision: 'approved' | 'denied',
    reviewedBy: string,
    comments: string,
    expirationDate?: Date
  ): DeviationRequest {
    const deviation = this.deviations.get(id);
    if (!deviation) {
      throw new Error(`Deviation request not found: ${id}`);
    }

    deviation.status = decision;
    deviation.reviewedBy = reviewedBy;
    deviation.reviewDate = new Date();
    deviation.reviewComments = comments;

    if (decision === 'approved' && expirationDate) {
      deviation.expirationDate = expirationDate;
    }

    this.deviations.set(id, deviation);

    // Update POA&M item status if approved
    if (decision === 'approved') {
      const poam = this.items.get(deviation.poamId);
      if (poam) {
        poam.status = 'risk-accepted';
        this.items.set(deviation.poamId, poam);
      }
    }

    logger.info(
      { deviationId: id, decision, reviewedBy },
      'Deviation request reviewed'
    );

    return deviation;
  }

  /**
   * Get deviation request by ID
   */
  getDeviationRequest(id: string): DeviationRequest | undefined {
    return this.deviations.get(id);
  }

  /**
   * Get all deviation requests
   */
  getAllDeviationRequests(filter?: {
    status?: DeviationStatus;
    type?: DeviationType;
  }): DeviationRequest[] {
    let deviations = Array.from(this.deviations.values());

    if (filter?.status) {
      deviations = deviations.filter((d) => d.status === filter.status);
    }
    if (filter?.type) {
      deviations = deviations.filter((d) => d.type === filter.type);
    }

    return deviations;
  }

  /**
   * Check for expiring deviations
   */
  getExpiringDeviations(daysThreshold: number = 30): DeviationRequest[] {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + daysThreshold);

    return Array.from(this.deviations.values()).filter(
      (d) =>
        d.status === 'approved' &&
        d.expirationDate &&
        d.expirationDate <= threshold
    );
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate POA&M summary statistics
   */
  getSummaryStatistics(): POAMSummaryStatistics {
    const items = Array.from(this.items.values());
    const openItems = items.filter((i) => ['open', 'ongoing', 'delayed'].includes(i.status));
    const overdueItems = openItems.filter((i) => i.daysOverdue > 0);

    const byRiskLevel = {
      'very-high': openItems.filter((i) => i.riskLevel === 'very-high').length,
      high: openItems.filter((i) => i.riskLevel === 'high').length,
      moderate: openItems.filter((i) => i.riskLevel === 'moderate').length,
      low: openItems.filter((i) => i.riskLevel === 'low').length,
      'very-low': openItems.filter((i) => i.riskLevel === 'very-low').length,
    };

    const byStatus = {
      open: items.filter((i) => i.status === 'open').length,
      ongoing: items.filter((i) => i.status === 'ongoing').length,
      completed: items.filter((i) => i.status === 'completed').length,
      closed: items.filter((i) => i.status === 'closed').length,
      'risk-accepted': items.filter((i) => i.status === 'risk-accepted').length,
      'false-positive': items.filter((i) => i.status === 'false-positive').length,
      delayed: items.filter((i) => i.status === 'delayed').length,
    };

    const bySource: Record<WeaknessSource, number> = {
      'vulnerability-scan': openItems.filter((i) => i.source === 'vulnerability-scan').length,
      'penetration-test': openItems.filter((i) => i.source === 'penetration-test').length,
      'security-assessment': openItems.filter((i) => i.source === 'security-assessment').length,
      'audit-finding': openItems.filter((i) => i.source === 'audit-finding').length,
      incident: openItems.filter((i) => i.source === 'incident').length,
      'self-identified': openItems.filter((i) => i.source === 'self-identified').length,
      'configuration-scan': openItems.filter((i) => i.source === 'configuration-scan').length,
      'continuous-monitoring': openItems.filter((i) => i.source === 'continuous-monitoring').length,
    };

    // Calculate average days open
    const averageDaysOpen =
      openItems.length > 0
        ? Math.round(
            openItems.reduce((sum, i) => {
              const daysOpen = Math.floor(
                (Date.now() - i.detectedDate.getTime()) / (1000 * 60 * 60 * 24)
              );
              return sum + daysOpen;
            }, 0) / openItems.length
          )
        : 0;

    // Calculate closure rate (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const closedLast90Days = items.filter(
      (i) =>
        i.status === 'closed' &&
        i.actualCompletionDate &&
        i.actualCompletionDate >= ninetyDaysAgo
    ).length;
    const openedLast90Days = items.filter(
      (i) => i.detectedDate >= ninetyDaysAgo
    ).length;
    const closureRate =
      openedLast90Days > 0
        ? Math.round((closedLast90Days / openedLast90Days) * 100)
        : 100;

    return {
      totalOpen: openItems.length,
      totalOverdue: overdueItems.length,
      byRiskLevel,
      byStatus,
      bySource,
      averageDaysOpen,
      closureRate,
      deviationsPending: this.getAllDeviationRequests({ status: 'submitted' }).length,
      deviationsExpiringSoon: this.getExpiringDeviations(30).length,
    };
  }

  /**
   * Generate FedRAMP-format POA&M report
   */
  generatePOAMReport(): POAMReport {
    const items = this.getOpenItems();

    return {
      header: {
        systemName: this.config.systemName,
        organizationName: this.config.organizationName,
        generatedDate: new Date(),
        isso: this.config.isso,
        systemOwner: this.config.systemOwner,
        authorizingOfficial: this.config.authorizingOfficial,
      },
      summary: this.getSummaryStatistics(),
      items: items.map((item) => ({
        itemNumber: item.itemNumber,
        id: item.id,
        weakness: item.title,
        pointOfContact: item.poc,
        resourcesRequired: item.resourcesRequired,
        scheduledCompletionDate: item.scheduledCompletionDate,
        milestoneChanges: this.formatMilestoneChanges(item),
        sourceIdentifyingWeakness: item.source,
        status: item.status,
        comments: item.comments[item.comments.length - 1]?.text || '',
        riskLevel: item.riskLevel,
        controlIds: item.controlIds,
        deviationRequest: item.deviationRequestId
          ? this.deviations.get(item.deviationRequestId)
          : undefined,
      })),
    };
  }

  private formatMilestoneChanges(item: POAMItem): string {
    return item.milestones
      .map((m) => `M${m.number}: ${m.description} - ${m.targetDate.toISOString().split('T')[0]} (${m.status})`)
      .join('\n');
  }

  /**
   * Create POA&M item from vulnerability finding
   */
  createFromVulnerability(
    vulnId: string,
    title: string,
    description: string,
    severity: VulnerabilitySeverity,
    controlIds: string[],
    deadline: Date,
    poc: { name: string; email: string },
    remediationPlan: string
  ): POAMItem {
    const riskLevel = this.severityToRiskLevel(severity);

    return this.createItem({
      source: 'vulnerability-scan',
      sourceId: vulnId,
      title,
      description,
      controlIds,
      riskLevel,
      originalSeverity: severity,
      status: 'open',
      detectedDate: new Date(),
      scheduledCompletionDate: deadline,
      poc: poc.name,
      pocEmail: poc.email,
      resourcesRequired: 'Security team, Development team',
      remediationPlan,
      milestones: [],
      riskStatement: `Unmitigated ${severity} vulnerability may result in unauthorized access or system compromise.`,
      businessImpact: `System availability and data confidentiality may be impacted until remediation is complete.`,
      relatedVulnerabilityIds: [vulnId],
      isRecurring: false,
    });
  }

  private severityToRiskLevel(severity: VulnerabilitySeverity): RiskLevel {
    const mapping: Record<VulnerabilitySeverity, RiskLevel> = {
      critical: 'very-high',
      high: 'high',
      moderate: 'moderate',
      low: 'low',
    };
    return mapping[severity];
  }
}

// =============================================================================
// TYPES FOR REPORTS
// =============================================================================

export interface POAMSummaryStatistics {
  totalOpen: number;
  totalOverdue: number;
  byRiskLevel: Record<RiskLevel, number>;
  byStatus: Record<POAMStatus, number>;
  bySource: Record<WeaknessSource, number>;
  averageDaysOpen: number;
  closureRate: number;
  deviationsPending: number;
  deviationsExpiringSoon: number;
}

export interface POAMReport {
  header: {
    systemName: string;
    organizationName: string;
    generatedDate: Date;
    isso: { name: string; email: string };
    systemOwner: { name: string; email: string };
    authorizingOfficial: { name: string; email: string };
  };
  summary: POAMSummaryStatistics;
  items: Array<{
    itemNumber: number;
    id: string;
    weakness: string;
    pointOfContact: string;
    resourcesRequired: string;
    scheduledCompletionDate: Date;
    milestoneChanges: string;
    sourceIdentifyingWeakness: WeaknessSource;
    status: POAMStatus;
    comments: string;
    riskLevel: RiskLevel;
    controlIds: string[];
    deviationRequest?: DeviationRequest;
  }>;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default POAMService;
