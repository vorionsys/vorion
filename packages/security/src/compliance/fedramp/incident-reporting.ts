/**
 * FedRAMP Incident Reporting
 *
 * Implements FedRAMP incident reporting requirements including:
 * - US-CERT notification requirements
 * - Incident categorization (CAT 1-6)
 * - Reporting timelines
 * - Evidence preservation
 *
 * Based on FedRAMP Incident Communications Procedure and US-CERT Federal Incident
 * Notification Guidelines.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'fedramp-incident' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * US-CERT Incident Categories (CAT 1-6)
 *
 * CAT 1: Unauthorized Access - Highest priority
 * CAT 2: Denial of Service
 * CAT 3: Malicious Code
 * CAT 4: Improper Usage
 * CAT 5: Scans/Probes/Attempted Access
 * CAT 6: Investigation (unconfirmed incidents)
 */
export const INCIDENT_CATEGORIES = ['CAT-1', 'CAT-2', 'CAT-3', 'CAT-4', 'CAT-5', 'CAT-6'] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/**
 * Incident category definitions
 */
export const INCIDENT_CATEGORY_DEFINITIONS: Record<
  IncidentCategory,
  {
    name: string;
    description: string;
    reportingTimeframe: string;
    reportingTimeframeHours: number;
    examples: string[];
  }
> = {
  'CAT-1': {
    name: 'Unauthorized Access',
    description:
      'An individual gains logical or physical access without permission to a federal agency network, system, application, data, or other resource.',
    reportingTimeframe: 'Within 1 hour',
    reportingTimeframeHours: 1,
    examples: [
      'Root-level compromise',
      'Unauthorized system access',
      'Data exfiltration',
      'Compromised credentials with data access',
    ],
  },
  'CAT-2': {
    name: 'Denial of Service',
    description:
      'An attack that successfully prevents or impairs the normal authorized functionality of networks, systems, or applications by exhausting resources.',
    reportingTimeframe: 'Within 2 hours',
    reportingTimeframeHours: 2,
    examples: [
      'Successful DDoS attack',
      'Resource exhaustion attack',
      'Service disruption from attack',
    ],
  },
  'CAT-3': {
    name: 'Malicious Code',
    description:
      'Successful installation of malicious software (e.g., virus, worm, Trojan horse, or other code-based malicious entity) that infects an operating system or application.',
    reportingTimeframe: 'Within 1 hour',
    reportingTimeframeHours: 1,
    examples: [
      'Ransomware infection',
      'Virus or worm infection',
      'Trojan installation',
      'Rootkit detection',
    ],
  },
  'CAT-4': {
    name: 'Improper Usage',
    description:
      'A person violates acceptable computing use policies. This includes unauthorized use of resources.',
    reportingTimeframe: 'Weekly report',
    reportingTimeframeHours: 168, // 7 days
    examples: [
      'Violation of acceptable use policy',
      'Unauthorized software installation',
      'Policy violation by authorized user',
    ],
  },
  'CAT-5': {
    name: 'Scans/Probes/Attempted Access',
    description:
      'This category includes any activity that seeks to access or identify a federal agency computer, open ports, protocols, services, or any combination for later exploit.',
    reportingTimeframe: 'Monthly report',
    reportingTimeframeHours: 720, // 30 days
    examples: ['Port scanning', 'Vulnerability scanning', 'Failed login attempts'],
  },
  'CAT-6': {
    name: 'Investigation',
    description: 'Unconfirmed incidents that are potentially malicious or anomalous activity.',
    reportingTimeframe: 'Monthly report',
    reportingTimeframeHours: 720, // 30 days
    examples: [
      'Suspicious activity under investigation',
      'Anomalous behavior analysis',
      'Unconfirmed security events',
    ],
  },
};

/**
 * Incident status
 */
export const INCIDENT_STATUSES = [
  'detected',
  'reported',
  'investigating',
  'contained',
  'eradicated',
  'recovering',
  'closed',
  'post-incident-review',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * Notification recipients
 */
export const NOTIFICATION_RECIPIENTS = [
  'us-cert',
  'fedramp-pmo',
  'agency-isso',
  'agency-ciso',
  'authorizing-official',
  'internal-security',
  'legal',
  'executive',
  'affected-customers',
] as const;
export type NotificationRecipient = (typeof NOTIFICATION_RECIPIENTS)[number];

/**
 * Evidence type
 */
export const EVIDENCE_TYPES = [
  'log-file',
  'memory-dump',
  'disk-image',
  'network-capture',
  'screenshot',
  'configuration',
  'malware-sample',
  'indicator-of-compromise',
  'forensic-report',
  'timeline',
  'interview-notes',
  'other',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * Preserved evidence record
 */
export interface PreservedEvidence {
  /** Unique identifier */
  id: string;
  /** Evidence type */
  type: EvidenceType;
  /** Title/name */
  title: string;
  /** Description */
  description: string;
  /** Collection timestamp */
  collectedAt: Date;
  /** Collected by */
  collectedBy: string;
  /** Chain of custody started */
  chainOfCustodyStarted: Date;
  /** Current custodian */
  currentCustodian: string;
  /** Storage location */
  storageLocation: string;
  /** Hash of evidence (for integrity) */
  hash: string;
  /** Hash algorithm used */
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  /** Is evidence encrypted */
  isEncrypted: boolean;
  /** File size in bytes */
  fileSizeBytes?: number;
  /** Source system */
  sourceSystem: string;
  /** Retention required until */
  retentionUntil: Date;
  /** Chain of custody log */
  chainOfCustodyLog: Array<{
    timestamp: Date;
    action: 'collected' | 'transferred' | 'accessed' | 'copied' | 'stored';
    fromPerson?: string;
    toPerson: string;
    reason: string;
    signature?: string;
  }>;
}

export const preservedEvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(EVIDENCE_TYPES),
  title: z.string().min(1),
  description: z.string().min(1),
  collectedAt: z.coerce.date(),
  collectedBy: z.string().min(1),
  chainOfCustodyStarted: z.coerce.date(),
  currentCustodian: z.string().min(1),
  storageLocation: z.string().min(1),
  hash: z.string().min(1),
  hashAlgorithm: z.enum(['sha256', 'sha384', 'sha512']),
  isEncrypted: z.boolean(),
  fileSizeBytes: z.number().nonnegative().optional(),
  sourceSystem: z.string().min(1),
  retentionUntil: z.coerce.date(),
  chainOfCustodyLog: z.array(
    z.object({
      timestamp: z.coerce.date(),
      action: z.enum(['collected', 'transferred', 'accessed', 'copied', 'stored']),
      fromPerson: z.string().optional(),
      toPerson: z.string().min(1),
      reason: z.string().min(1),
      signature: z.string().optional(),
    })
  ),
});

/**
 * Notification record
 */
export interface IncidentNotification {
  /** Unique identifier */
  id: string;
  /** Recipient type */
  recipient: NotificationRecipient;
  /** Recipient name */
  recipientName: string;
  /** Recipient email/contact */
  recipientContact: string;
  /** Notification method */
  method: 'email' | 'phone' | 'portal' | 'secure-message';
  /** Notification time */
  sentAt: Date;
  /** Sent by */
  sentBy: string;
  /** Content summary */
  contentSummary: string;
  /** Acknowledgment received */
  acknowledgmentReceived?: boolean;
  /** Acknowledgment time */
  acknowledgmentTime?: Date;
  /** Tracking number (e.g., US-CERT ticket) */
  trackingNumber?: string;
  /** Follow-up required */
  followUpRequired: boolean;
  /** Follow-up date */
  followUpDate?: Date;
}

export const incidentNotificationSchema = z.object({
  id: z.string().min(1),
  recipient: z.enum(NOTIFICATION_RECIPIENTS),
  recipientName: z.string().min(1),
  recipientContact: z.string().min(1),
  method: z.enum(['email', 'phone', 'portal', 'secure-message']),
  sentAt: z.coerce.date(),
  sentBy: z.string().min(1),
  contentSummary: z.string().min(1),
  acknowledgmentReceived: z.boolean().optional(),
  acknowledgmentTime: z.coerce.date().optional(),
  trackingNumber: z.string().optional(),
  followUpRequired: z.boolean(),
  followUpDate: z.coerce.date().optional(),
});

/**
 * Security incident record
 */
export interface SecurityIncident {
  /** Unique identifier */
  id: string;
  /** Incident title */
  title: string;
  /** Detailed description */
  description: string;
  /** Incident category */
  category: IncidentCategory;
  /** Current status */
  status: IncidentStatus;
  /** Detection timestamp */
  detectedAt: Date;
  /** Detection method */
  detectionMethod: string;
  /** Detected by */
  detectedBy: string;
  /** Incident commander/handler */
  incidentHandler: string;
  /** Affected systems */
  affectedSystems: string[];
  /** Affected data types */
  affectedDataTypes: string[];
  /** Estimated affected users/records */
  estimatedImpact?: {
    usersAffected?: number;
    recordsAffected?: number;
    systemsAffected: number;
  };
  /** Is PII involved */
  piiInvolved: boolean;
  /** Is PHI involved */
  phiInvolved: boolean;
  /** Root cause (when known) */
  rootCause?: string;
  /** Attack vector (when known) */
  attackVector?: string;
  /** Indicators of compromise */
  iocs: Array<{
    type: 'ip' | 'domain' | 'hash' | 'email' | 'url' | 'other';
    value: string;
    description?: string;
  }>;
  /** Timeline of events */
  timeline: Array<{
    timestamp: Date;
    event: string;
    actor?: string;
  }>;
  /** Notifications sent */
  notifications: IncidentNotification[];
  /** Preserved evidence */
  evidence: PreservedEvidence[];
  /** Containment actions taken */
  containmentActions: Array<{
    timestamp: Date;
    action: string;
    performedBy: string;
    result: string;
  }>;
  /** Eradication actions taken */
  eradicationActions: Array<{
    timestamp: Date;
    action: string;
    performedBy: string;
    result: string;
  }>;
  /** Recovery actions taken */
  recoveryActions: Array<{
    timestamp: Date;
    action: string;
    performedBy: string;
    result: string;
  }>;
  /** Lessons learned (post-incident) */
  lessonsLearned?: string;
  /** Recommendations */
  recommendations?: string[];
  /** Related POA&M IDs */
  relatedPOAMIds?: string[];
  /** Closure date */
  closedAt?: Date;
  /** Closure notes */
  closureNotes?: string;
  /** Reporting deadline */
  reportingDeadline: Date;
  /** Is reported to US-CERT */
  reportedToUSCERT: boolean;
  /** US-CERT ticket number */
  usCertTicketNumber?: string;
  /** Is reported to FedRAMP */
  reportedToFedRAMP: boolean;
  /** FedRAMP notification date */
  fedrampNotificationDate?: Date;
}

export const securityIncidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(INCIDENT_CATEGORIES),
  status: z.enum(INCIDENT_STATUSES),
  detectedAt: z.coerce.date(),
  detectionMethod: z.string().min(1),
  detectedBy: z.string().min(1),
  incidentHandler: z.string().min(1),
  affectedSystems: z.array(z.string()),
  affectedDataTypes: z.array(z.string()),
  estimatedImpact: z
    .object({
      usersAffected: z.number().nonnegative().optional(),
      recordsAffected: z.number().nonnegative().optional(),
      systemsAffected: z.number().nonnegative(),
    })
    .optional(),
  piiInvolved: z.boolean(),
  phiInvolved: z.boolean(),
  rootCause: z.string().optional(),
  attackVector: z.string().optional(),
  iocs: z.array(
    z.object({
      type: z.enum(['ip', 'domain', 'hash', 'email', 'url', 'other']),
      value: z.string().min(1),
      description: z.string().optional(),
    })
  ),
  timeline: z.array(
    z.object({
      timestamp: z.coerce.date(),
      event: z.string().min(1),
      actor: z.string().optional(),
    })
  ),
  notifications: z.array(incidentNotificationSchema),
  evidence: z.array(preservedEvidenceSchema),
  containmentActions: z.array(
    z.object({
      timestamp: z.coerce.date(),
      action: z.string().min(1),
      performedBy: z.string().min(1),
      result: z.string().min(1),
    })
  ),
  eradicationActions: z.array(
    z.object({
      timestamp: z.coerce.date(),
      action: z.string().min(1),
      performedBy: z.string().min(1),
      result: z.string().min(1),
    })
  ),
  recoveryActions: z.array(
    z.object({
      timestamp: z.coerce.date(),
      action: z.string().min(1),
      performedBy: z.string().min(1),
      result: z.string().min(1),
    })
  ),
  lessonsLearned: z.string().optional(),
  recommendations: z.array(z.string()).optional(),
  relatedPOAMIds: z.array(z.string()).optional(),
  closedAt: z.coerce.date().optional(),
  closureNotes: z.string().optional(),
  reportingDeadline: z.coerce.date(),
  reportedToUSCERT: z.boolean(),
  usCertTicketNumber: z.string().optional(),
  reportedToFedRAMP: z.boolean(),
  fedrampNotificationDate: z.coerce.date().optional(),
});

/**
 * Incident reporting configuration
 */
export interface IncidentReportingConfig {
  /** Organization name */
  organizationName: string;
  /** System name */
  systemName: string;
  /** FedRAMP package ID */
  fedrampPackageId: string;
  /** ISSO contact */
  isso: { name: string; email: string; phone: string };
  /** CISO contact */
  ciso: { name: string; email: string; phone: string };
  /** US-CERT POC */
  usCertPoc: { name: string; email: string; phone: string };
  /** FedRAMP PMO contact */
  fedrampPmoPoc: { name: string; email: string };
  /** Agency ISSO contact */
  agencyIsso?: { name: string; email: string; phone: string };
  /** Evidence retention period (days) */
  evidenceRetentionDays: number;
  /** Auto-escalation enabled */
  autoEscalation: boolean;
}

// =============================================================================
// INCIDENT REPORTING SERVICE
// =============================================================================

/**
 * FedRAMP Incident Reporting Service
 */
export class IncidentReportingService {
  private config: IncidentReportingConfig;
  private incidents: Map<string, SecurityIncident>;

  constructor(config: IncidentReportingConfig) {
    this.config = config;
    this.incidents = new Map();

    logger.info(
      { systemName: config.systemName },
      'Incident reporting service initialized'
    );
  }

  // ===========================================================================
  // INCIDENT MANAGEMENT
  // ===========================================================================

  /**
   * Create a new incident
   */
  createIncident(
    incident: Omit<
      SecurityIncident,
      | 'id'
      | 'notifications'
      | 'evidence'
      | 'containmentActions'
      | 'eradicationActions'
      | 'recoveryActions'
      | 'reportingDeadline'
      | 'reportedToUSCERT'
      | 'reportedToFedRAMP'
    >
  ): SecurityIncident {
    const id = `INC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Calculate reporting deadline based on category
    const categoryDef = INCIDENT_CATEGORY_DEFINITIONS[incident.category];
    const reportingDeadline = new Date(incident.detectedAt);
    reportingDeadline.setHours(
      reportingDeadline.getHours() + categoryDef.reportingTimeframeHours
    );

    const newIncident: SecurityIncident = {
      ...incident,
      id,
      notifications: [],
      evidence: [],
      containmentActions: [],
      eradicationActions: [],
      recoveryActions: [],
      reportingDeadline,
      reportedToUSCERT: false,
      reportedToFedRAMP: false,
    };

    // Add initial timeline entry
    newIncident.timeline.unshift({
      timestamp: new Date(),
      event: `Incident ${id} created - Category ${incident.category}`,
      actor: 'System',
    });

    securityIncidentSchema.parse(newIncident);
    this.incidents.set(id, newIncident);

    logger.warn(
      {
        incidentId: id,
        category: incident.category,
        reportingDeadline,
        piiInvolved: incident.piiInvolved,
      },
      'Security incident created'
    );

    // Check for immediate notification requirements
    this.checkNotificationRequirements(newIncident);

    return newIncident;
  }

  /**
   * Check and alert on notification requirements
   */
  private checkNotificationRequirements(incident: SecurityIncident): void {
    const categoryDef = INCIDENT_CATEGORY_DEFINITIONS[incident.category];

    if (categoryDef.reportingTimeframeHours <= 2) {
      logger.warn(
        {
          incidentId: incident.id,
          category: incident.category,
          deadline: incident.reportingDeadline,
        },
        `URGENT: ${incident.category} incident requires reporting ${categoryDef.reportingTimeframe}`
      );
    }
  }

  /**
   * Update incident status
   */
  updateStatus(incidentId: string, status: IncidentStatus, notes?: string): SecurityIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const oldStatus = incident.status;
    incident.status = status;

    incident.timeline.push({
      timestamp: new Date(),
      event: `Status changed from ${oldStatus} to ${status}${notes ? `: ${notes}` : ''}`,
    });

    if (status === 'closed') {
      incident.closedAt = new Date();
      incident.closureNotes = notes;
    }

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, oldStatus, newStatus: status }, 'Incident status updated');

    return incident;
  }

  /**
   * Add containment action
   */
  addContainmentAction(
    incidentId: string,
    action: string,
    performedBy: string,
    result: string
  ): SecurityIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.containmentActions.push({
      timestamp: new Date(),
      action,
      performedBy,
      result,
    });

    incident.timeline.push({
      timestamp: new Date(),
      event: `Containment action: ${action}`,
      actor: performedBy,
    });

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, action }, 'Containment action added');

    return incident;
  }

  /**
   * Add eradication action
   */
  addEradicationAction(
    incidentId: string,
    action: string,
    performedBy: string,
    result: string
  ): SecurityIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.eradicationActions.push({
      timestamp: new Date(),
      action,
      performedBy,
      result,
    });

    incident.timeline.push({
      timestamp: new Date(),
      event: `Eradication action: ${action}`,
      actor: performedBy,
    });

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, action }, 'Eradication action added');

    return incident;
  }

  /**
   * Add recovery action
   */
  addRecoveryAction(
    incidentId: string,
    action: string,
    performedBy: string,
    result: string
  ): SecurityIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.recoveryActions.push({
      timestamp: new Date(),
      action,
      performedBy,
      result,
    });

    incident.timeline.push({
      timestamp: new Date(),
      event: `Recovery action: ${action}`,
      actor: performedBy,
    });

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, action }, 'Recovery action added');

    return incident;
  }

  /**
   * Add IOC to incident
   */
  addIOC(
    incidentId: string,
    type: 'ip' | 'domain' | 'hash' | 'email' | 'url' | 'other',
    value: string,
    description?: string
  ): SecurityIncident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.iocs.push({ type, value, description });

    incident.timeline.push({
      timestamp: new Date(),
      event: `IOC added: ${type} - ${value}`,
    });

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, iocType: type, iocValue: value }, 'IOC added to incident');

    return incident;
  }

  // ===========================================================================
  // NOTIFICATION MANAGEMENT
  // ===========================================================================

  /**
   * Record a notification sent
   */
  recordNotification(
    incidentId: string,
    notification: Omit<IncidentNotification, 'id'>
  ): IncidentNotification {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const id = randomUUID();
    const newNotification: IncidentNotification = { ...notification, id };

    incidentNotificationSchema.parse(newNotification);
    incident.notifications.push(newNotification);

    // Update US-CERT/FedRAMP reporting status
    if (notification.recipient === 'us-cert') {
      incident.reportedToUSCERT = true;
      incident.usCertTicketNumber = notification.trackingNumber;
    }
    if (notification.recipient === 'fedramp-pmo') {
      incident.reportedToFedRAMP = true;
      incident.fedrampNotificationDate = notification.sentAt;
    }

    incident.timeline.push({
      timestamp: new Date(),
      event: `Notification sent to ${notification.recipient}: ${notification.recipientName}`,
      actor: notification.sentBy,
    });

    this.incidents.set(incidentId, incident);

    logger.info(
      {
        incidentId,
        recipient: notification.recipient,
        method: notification.method,
      },
      'Notification recorded'
    );

    return newNotification;
  }

  /**
   * Record notification acknowledgment
   */
  recordAcknowledgment(
    incidentId: string,
    notificationId: string,
    trackingNumber?: string
  ): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const notification = incident.notifications.find((n) => n.id === notificationId);
    if (!notification) {
      throw new Error(`Notification not found: ${notificationId}`);
    }

    notification.acknowledgmentReceived = true;
    notification.acknowledgmentTime = new Date();
    if (trackingNumber) {
      notification.trackingNumber = trackingNumber;
    }

    this.incidents.set(incidentId, incident);

    logger.info({ incidentId, notificationId, trackingNumber }, 'Acknowledgment recorded');
  }

  /**
   * Get required notifications for incident
   */
  getRequiredNotifications(incidentId: string): NotificationRecipient[] {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const required: NotificationRecipient[] = ['us-cert', 'fedramp-pmo', 'internal-security'];

    // CAT 1-3 require immediate agency notification
    if (['CAT-1', 'CAT-2', 'CAT-3'].includes(incident.category)) {
      required.push('agency-isso', 'agency-ciso', 'authorizing-official');
    }

    // PII/PHI incidents may require additional notifications
    if (incident.piiInvolved || incident.phiInvolved) {
      required.push('legal');
    }

    return required;
  }

  /**
   * Get missing required notifications
   */
  getMissingNotifications(incidentId: string): NotificationRecipient[] {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const required = this.getRequiredNotifications(incidentId);
    const sent = new Set(incident.notifications.map((n) => n.recipient));

    return required.filter((r) => !sent.has(r));
  }

  // ===========================================================================
  // EVIDENCE MANAGEMENT
  // ===========================================================================

  /**
   * Preserve evidence
   */
  preserveEvidence(
    incidentId: string,
    evidence: Omit<PreservedEvidence, 'id' | 'chainOfCustodyLog'>
  ): PreservedEvidence {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const id = `EVD-${randomUUID().slice(0, 8).toUpperCase()}`;

    const preservedEvidence: PreservedEvidence = {
      ...evidence,
      id,
      chainOfCustodyLog: [
        {
          timestamp: evidence.collectedAt,
          action: 'collected',
          toPerson: evidence.collectedBy,
          reason: 'Initial evidence collection for incident investigation',
        },
      ],
    };

    preservedEvidenceSchema.parse(preservedEvidence);
    incident.evidence.push(preservedEvidence);

    incident.timeline.push({
      timestamp: new Date(),
      event: `Evidence preserved: ${evidence.title} (${evidence.type})`,
      actor: evidence.collectedBy,
    });

    this.incidents.set(incidentId, incident);

    logger.info(
      {
        incidentId,
        evidenceId: id,
        type: evidence.type,
        hash: evidence.hash,
      },
      'Evidence preserved'
    );

    return preservedEvidence;
  }

  /**
   * Transfer evidence custody
   */
  transferEvidence(
    incidentId: string,
    evidenceId: string,
    toPerson: string,
    reason: string
  ): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const evidence = incident.evidence.find((e) => e.id === evidenceId);
    if (!evidence) {
      throw new Error(`Evidence not found: ${evidenceId}`);
    }

    const fromPerson = evidence.currentCustodian;
    evidence.currentCustodian = toPerson;
    evidence.chainOfCustodyLog.push({
      timestamp: new Date(),
      action: 'transferred',
      fromPerson,
      toPerson,
      reason,
    });

    this.incidents.set(incidentId, incident);

    logger.info(
      { incidentId, evidenceId, fromPerson, toPerson },
      'Evidence custody transferred'
    );
  }

  /**
   * Record evidence access
   */
  recordEvidenceAccess(
    incidentId: string,
    evidenceId: string,
    accessedBy: string,
    reason: string
  ): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const evidence = incident.evidence.find((e) => e.id === evidenceId);
    if (!evidence) {
      throw new Error(`Evidence not found: ${evidenceId}`);
    }

    evidence.chainOfCustodyLog.push({
      timestamp: new Date(),
      action: 'accessed',
      toPerson: accessedBy,
      reason,
    });

    this.incidents.set(incidentId, incident);
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  /**
   * Get incident by ID
   */
  getIncident(id: string): SecurityIncident | undefined {
    return this.incidents.get(id);
  }

  /**
   * Get all incidents
   */
  getAllIncidents(filter?: {
    category?: IncidentCategory;
    status?: IncidentStatus;
    startDate?: Date;
    endDate?: Date;
    piiInvolved?: boolean;
  }): SecurityIncident[] {
    let incidents = Array.from(this.incidents.values());

    if (filter?.category) {
      incidents = incidents.filter((i) => i.category === filter.category);
    }
    if (filter?.status) {
      incidents = incidents.filter((i) => i.status === filter.status);
    }
    if (filter?.startDate) {
      incidents = incidents.filter((i) => i.detectedAt >= filter.startDate!);
    }
    if (filter?.endDate) {
      incidents = incidents.filter((i) => i.detectedAt <= filter.endDate!);
    }
    if (filter?.piiInvolved !== undefined) {
      incidents = incidents.filter((i) => i.piiInvolved === filter.piiInvolved);
    }

    return incidents.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  /**
   * Get open incidents
   */
  getOpenIncidents(): SecurityIncident[] {
    const openStatuses: IncidentStatus[] = [
      'detected',
      'reported',
      'investigating',
      'contained',
      'eradicated',
      'recovering',
    ];
    return this.getAllIncidents().filter((i) => openStatuses.includes(i.status));
  }

  /**
   * Get incidents past reporting deadline
   */
  getOverdueReporting(): SecurityIncident[] {
    const now = new Date();
    return this.getAllIncidents().filter(
      (i) =>
        !i.reportedToUSCERT &&
        i.reportingDeadline < now &&
        ['detected', 'reported', 'investigating'].includes(i.status)
    );
  }

  /**
   * Get incidents requiring follow-up
   */
  getFollowUpRequired(): SecurityIncident[] {
    const now = new Date();
    return this.getAllIncidents().filter((i) =>
      i.notifications.some(
        (n) => n.followUpRequired && n.followUpDate && n.followUpDate <= now
      )
    );
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate incident summary for FedRAMP monthly report
   */
  generateMonthlyReport(month: Date): IncidentMonthlyReport {
    const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);

    const incidents = this.getAllIncidents({
      startDate: startOfMonth,
      endDate: endOfMonth,
    });

    const byCategory: Record<IncidentCategory, number> = {
      'CAT-1': 0,
      'CAT-2': 0,
      'CAT-3': 0,
      'CAT-4': 0,
      'CAT-5': 0,
      'CAT-6': 0,
    };

    for (const incident of incidents) {
      byCategory[incident.category]++;
    }

    const openIncidents = incidents.filter((i) => i.status !== 'closed');
    const closedIncidents = incidents.filter((i) => i.status === 'closed');

    const averageResolutionTime =
      closedIncidents.length > 0
        ? Math.round(
            closedIncidents.reduce((sum, i) => {
              if (i.closedAt) {
                return sum + (i.closedAt.getTime() - i.detectedAt.getTime());
              }
              return sum;
            }, 0) /
              closedIncidents.length /
              (1000 * 60 * 60)
          ) // in hours
        : 0;

    return {
      reportPeriod: {
        start: startOfMonth,
        end: endOfMonth,
      },
      systemName: this.config.systemName,
      generatedAt: new Date(),
      totalIncidents: incidents.length,
      byCategory,
      openIncidents: openIncidents.length,
      closedIncidents: closedIncidents.length,
      piiIncidents: incidents.filter((i) => i.piiInvolved).length,
      averageResolutionTimeHours: averageResolutionTime,
      overdueReporting: this.getOverdueReporting().length,
      incidentSummaries: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        status: i.status,
        detectedAt: i.detectedAt,
        reportedToUSCERT: i.reportedToUSCERT,
        usCertTicketNumber: i.usCertTicketNumber,
        piiInvolved: i.piiInvolved,
      })),
    };
  }

  /**
   * Generate US-CERT incident report format
   */
  generateUSCERTReport(incidentId: string): USCERTIncidentReport {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const categoryDef = INCIDENT_CATEGORY_DEFINITIONS[incident.category];

    return {
      reportDate: new Date(),
      incidentCategory: incident.category,
      incidentCategoryName: categoryDef.name,
      organizationName: this.config.organizationName,
      systemName: this.config.systemName,
      fedrampPackageId: this.config.fedrampPackageId,
      incidentDescription: incident.description,
      dateTimeOfIncident: incident.detectedAt,
      dateTimeDetected: incident.detectedAt,
      detectionMethod: incident.detectionMethod,
      affectedSystems: incident.affectedSystems,
      estimatedImpact: incident.estimatedImpact,
      piiInvolved: incident.piiInvolved,
      piiDetails: incident.piiInvolved ? 'See full incident report' : 'N/A',
      phiInvolved: incident.phiInvolved,
      rootCause: incident.rootCause || 'Under investigation',
      attackVector: incident.attackVector || 'Under investigation',
      indicatorsOfCompromise: incident.iocs,
      containmentActions: incident.containmentActions.map((a) => a.action),
      eradicationActions: incident.eradicationActions.map((a) => a.action),
      recoveryActions: incident.recoveryActions.map((a) => a.action),
      currentStatus: incident.status,
      pocName: this.config.isso.name,
      pocEmail: this.config.isso.email,
      pocPhone: this.config.isso.phone,
    };
  }
}

// =============================================================================
// TYPES FOR REPORTS
// =============================================================================

export interface IncidentMonthlyReport {
  reportPeriod: { start: Date; end: Date };
  systemName: string;
  generatedAt: Date;
  totalIncidents: number;
  byCategory: Record<IncidentCategory, number>;
  openIncidents: number;
  closedIncidents: number;
  piiIncidents: number;
  averageResolutionTimeHours: number;
  overdueReporting: number;
  incidentSummaries: Array<{
    id: string;
    title: string;
    category: IncidentCategory;
    status: IncidentStatus;
    detectedAt: Date;
    reportedToUSCERT: boolean;
    usCertTicketNumber?: string;
    piiInvolved: boolean;
  }>;
}

export interface USCERTIncidentReport {
  reportDate: Date;
  incidentCategory: IncidentCategory;
  incidentCategoryName: string;
  organizationName: string;
  systemName: string;
  fedrampPackageId: string;
  incidentDescription: string;
  dateTimeOfIncident: Date;
  dateTimeDetected: Date;
  detectionMethod: string;
  affectedSystems: string[];
  estimatedImpact?: {
    usersAffected?: number;
    recordsAffected?: number;
    systemsAffected: number;
  };
  piiInvolved: boolean;
  piiDetails: string;
  phiInvolved: boolean;
  rootCause: string;
  attackVector: string;
  indicatorsOfCompromise: Array<{
    type: string;
    value: string;
    description?: string;
  }>;
  containmentActions: string[];
  eradicationActions: string[];
  recoveryActions: string[];
  currentStatus: IncidentStatus;
  pocName: string;
  pocEmail: string;
  pocPhone: string;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default IncidentReportingService;
