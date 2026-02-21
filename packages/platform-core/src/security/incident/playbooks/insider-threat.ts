/**
 * Insider Threat Response Playbook
 *
 * Playbook for responding to insider threat incidents including
 * data exfiltration, unauthorized access by employees, policy violations,
 * and malicious insider activity.
 *
 * IMPORTANT: Insider threats require careful handling with legal and HR
 * coordination BEFORE taking most actions to protect the organization
 * and ensure proper evidence preservation.
 *
 * This playbook uses automated actions from the actions module that
 * provide real implementations with rollback capabilities.
 */

import { createLogger } from '../../../common/logger.js';
import {
  PlaybookInput,
  PlaybookStepInput,
  TriggerCondition,
  NotificationConfig,
  EscalationConfig,
  IncidentType,
  IncidentSeverity,
  NotificationChannel,
  StepType,
} from '../types.js';

const logger = createLogger({ component: 'incident-response' });

// ============================================================================
// Playbook Definition
// ============================================================================

/**
 * Insider threat response steps using automated actions
 *
 * Steps are designed to:
 * - Verify threat indicators covertly without alerting the subject
 * - Coordinate with Legal and HR before any containment actions
 * - Preserve evidence with chain of custody
 * - Gradually contain the threat to avoid tipping off the subject
 * - Support proper investigation and documentation
 * - Enable legal action if necessary
 */
const insiderThreatSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification (Covert)
  {
    id: 'it-step-1',
    name: 'Initial Threat Assessment',
    type: StepType.MANUAL,
    description: `
      Covertly verify the insider threat indicators:
      1. Review the alert/report that triggered this investigation
      2. Analyze unusual access patterns (after hours, bulk downloads, etc.)
      3. Check for data exfiltration indicators (large transfers, USB usage, cloud uploads)
      4. Review recent access to sensitive systems/data
      5. Assess the subject's role, access level, and business justification
      6. Determine if behavior deviates from baseline
      7. Document initial findings CONFIDENTIALLY

      CRITICAL: Do NOT alert the subject or their direct team.
      Keep investigation details strictly need-to-know.
      Mark this step complete once initial assessment is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },
  {
    id: 'it-step-2',
    name: 'Classify Threat Severity',
    type: StepType.MANUAL,
    description: `
      Classify the insider threat based on indicators:
      1. CRITICAL: Active data exfiltration or sabotage in progress
      2. HIGH: Strong evidence of malicious intent, sensitive data accessed
      3. MEDIUM: Suspicious behavior, policy violations, unclear intent
      4. LOW: Minor violations, likely unintentional

      Document classification reasoning and update incident severity.
      This classification determines the urgency of Legal/HR notification.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['it-step-1'],
  },

  // Phase 2: Legal/HR Coordination (REQUIRED before containment)
  {
    id: 'it-step-3',
    name: 'Notify Legal Counsel',
    type: StepType.MANUAL,
    description: `
      Engage Legal counsel BEFORE any containment actions:
      1. Brief Legal on the situation and evidence
      2. Discuss preservation requirements (litigation hold)
      3. Review employment agreements and policies
      4. Determine if law enforcement involvement is needed
      5. Get guidance on permissible monitoring and evidence collection
      6. Document Legal's recommendations

      CRITICAL: Legal approval is REQUIRED before proceeding.
      Do NOT take any action against the subject without Legal guidance.

      Requires approval from Legal before proceeding to next steps.
    `,
    requiresApproval: true,
    approvers: ['legal', 'general-counsel'],
    onFailure: 'halt',
    dependencies: ['it-step-2'],
  },
  {
    id: 'it-step-4',
    name: 'Notify HR Leadership',
    type: StepType.MANUAL,
    description: `
      Engage HR leadership in coordination with Legal:
      1. Brief HR on the situation (need-to-know basis)
      2. Review the subject's employment history and any prior incidents
      3. Discuss potential employment actions
      4. Plan for potential termination scenario
      5. Coordinate on communication strategy
      6. Document HR guidance

      CRITICAL: HR must be involved before any employment-affecting actions.
      Coordinate with Legal on all communications.

      Requires approval from HR leadership before proceeding.
    `,
    requiresApproval: true,
    approvers: ['hr-leadership', 'hr-director'],
    onFailure: 'halt',
    dependencies: ['it-step-2'],
  },
  {
    id: 'it-step-5',
    name: 'Executive Notification',
    type: StepType.MANUAL,
    description: `
      Notify appropriate executives based on severity:
      1. Brief CISO and relevant VP/C-level executives
      2. Provide summary of threat and potential impact
      3. Outline recommended response plan
      4. Get approval for investigation scope and actions
      5. Establish communication protocols

      For P1/P2 incidents, executive briefing is mandatory.
      Document all decisions and approvals.
    `,
    requiresApproval: true,
    approvers: ['ciso', 'cto', 'ceo'],
    onFailure: 'halt',
    dependencies: ['it-step-3', 'it-step-4'],
  },

  // Phase 3: Evidence Preservation (Covert)
  {
    id: 'it-step-6',
    name: 'Enable Covert Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced monitoring on the subject\'s accounts and systems without alerting them. Increases logging levels, enables detailed audit trails, and activates behavioral analysis.',
    actionId: 'scale-monitoring', // Uses the scale-monitoring action
    timeout: 180000, // 3 minutes
    requiresApproval: true, // Requires Legal/HR approval for monitoring
    approvers: ['legal', 'hr-leadership', 'security-lead'],
    onFailure: 'continue',
    dependencies: ['it-step-3', 'it-step-4'],
    metadata: {
      covertMode: true,
      monitoringScope: 'targeted',
      preservePrivacy: true,
    },
  },
  {
    id: 'it-step-7',
    name: 'Collect Forensic Evidence',
    type: StepType.AUTOMATED,
    description: 'Collect comprehensive forensic evidence including access logs, file activity, email records, network traffic, and system artifacts. Maintains chain of custody for potential legal proceedings.',
    actionId: 'collect-evidence', // Uses the collect-evidence action
    timeout: 900000, // 15 minutes - extensive collection
    requiresApproval: true, // Legal must approve evidence collection scope
    approvers: ['legal', 'security-lead'],
    onFailure: 'halt', // Evidence is critical
    dependencies: ['it-step-5', 'it-step-6'],
    metadata: {
      evidenceTypes: ['logs', 'authentication', 'database_audit', 'file_access', 'network', 'email'],
      preserveChainOfCustody: true,
      legalHold: true,
      covertCollection: true,
    },
  },
  {
    id: 'it-step-8',
    name: 'Document Access History',
    type: StepType.MANUAL,
    description: `
      Document the subject's complete access history:
      1. Compile all systems and data the subject has accessed
      2. Identify sensitive data exposure
      3. Review file downloads, copies, and transfers
      4. Document email and communication patterns
      5. Map out all privileged access used
      6. Create timeline of suspicious activities

      Use the forensic evidence collected in the previous step.
      All documentation must meet legal evidence standards.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['it-step-7'],
  },

  // Phase 4: Containment (Gradual, with approvals)
  {
    id: 'it-step-9',
    name: 'Develop Containment Strategy',
    type: StepType.MANUAL,
    description: `
      Plan the containment approach with Legal and HR:
      1. Determine timing of access revocation
      2. Plan for subject notification/confrontation
      3. Coordinate with physical security if needed
      4. Prepare for potential immediate termination
      5. Plan data recovery/protection measures
      6. Document the containment plan

      The strategy must be approved before execution.
      Consider: immediate vs. gradual containment, interview timing.
    `,
    requiresApproval: true,
    approvers: ['legal', 'hr-leadership', 'ciso'],
    onFailure: 'halt',
    dependencies: ['it-step-8'],
  },
  {
    id: 'it-step-10',
    name: 'Revoke Access Credentials',
    type: StepType.AUTOMATED,
    description: 'Revoke all access credentials including passwords, SSO, VPN, badge access, API keys, and service accounts. Terminates all active sessions.',
    actionId: 'revoke-credentials', // Uses the revoke-credentials action
    timeout: 300000, // 5 minutes
    requiresApproval: true, // Must be coordinated with HR/Legal
    approvers: ['legal', 'hr-leadership', 'security-lead'],
    onFailure: 'halt',
    retryAttempts: 3,
    dependencies: ['it-step-9'],
    metadata: {
      notifyOnComplete: false, // Do not notify subject automatically
      includeAccountDisable: true,
      revokePhysicalAccess: true,
      coordinateWithHR: true,
    },
  },
  {
    id: 'it-step-11',
    name: 'Notify Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send confidential notifications to authorized stakeholders only (security team, Legal, HR, executives). Subject and their team are NOT notified through this action.',
    actionId: 'notify-stakeholders', // Uses the notify-stakeholders action
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['it-step-10'],
    metadata: {
      confidential: true,
      excludeSubjectTeam: true,
      stakeholderGroups: ['security', 'legal', 'hr', 'executives'],
    },
  },

  // Phase 5: Investigation
  {
    id: 'it-step-12',
    name: 'Analyze Accessed Data',
    type: StepType.MANUAL,
    description: `
      Conduct thorough analysis of data the subject accessed:
      1. Inventory all sensitive data accessed or copied
      2. Determine if data was exfiltrated (where, when, how)
      3. Assess potential damage from data exposure
      4. Check for signs of data manipulation or sabotage
      5. Identify any third parties who may have received data
      6. Document findings for Legal and potential reporting

      This analysis informs the legal response and damage assessment.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['it-step-10'],
  },
  {
    id: 'it-step-13',
    name: 'Conduct Witness Interviews',
    type: StepType.MANUAL,
    description: `
      Interview relevant witnesses with HR present:
      1. Identify colleagues who may have relevant information
      2. Coordinate interview schedule with HR and Legal
      3. Conduct interviews with proper documentation
      4. Gather information on subject's recent behavior
      5. Document all statements
      6. Maintain confidentiality of the investigation

      HR representative must be present for all interviews.
      Do not disclose investigation details beyond necessity.
    `,
    requiresApproval: true,
    approvers: ['hr-leadership', 'legal'],
    onFailure: 'continue',
    dependencies: ['it-step-10'],
  },
  {
    id: 'it-step-14',
    name: 'Subject Interview/Confrontation',
    type: StepType.MANUAL,
    description: `
      Interview the subject (if appropriate per Legal/HR guidance):
      1. Coordinate timing with HR and Legal
      2. Have HR representative and witness present
      3. Present findings and gather subject's explanation
      4. Document the interview thoroughly
      5. Follow Legal guidance on admissions and statements
      6. Prepare for potential immediate termination

      CRITICAL: Legal and HR MUST approve interview approach.
      Physical security should be on standby if needed.
    `,
    requiresApproval: true,
    approvers: ['legal', 'hr-leadership'],
    onFailure: 'continue',
    dependencies: ['it-step-12', 'it-step-13'],
  },

  // Phase 6: Remediation
  {
    id: 'it-step-15',
    name: 'Employment Action',
    type: StepType.MANUAL,
    description: `
      Execute appropriate employment action:
      1. Work with HR to finalize employment decision
      2. Execute termination if appropriate
      3. Coordinate final access revocation with termination
      4. Manage equipment and data return
      5. Process exit documentation
      6. Document all actions taken

      HR leads this step with Legal oversight.
      Security supports access management.
    `,
    requiresApproval: true,
    approvers: ['hr-leadership', 'legal', 'executive-sponsor'],
    onFailure: 'halt',
    dependencies: ['it-step-14'],
  },
  {
    id: 'it-step-16',
    name: 'Legal Action Assessment',
    type: StepType.MANUAL,
    description: `
      Assess and pursue legal actions if warranted:
      1. Review evidence with Legal for prosecution viability
      2. Determine if law enforcement referral is needed
      3. Assess civil litigation options
      4. File necessary legal complaints
      5. Prepare documentation for law enforcement
      6. Track any ongoing legal proceedings

      Legal counsel leads this step.
      Document all decisions and rationale.
    `,
    requiresApproval: true,
    approvers: ['general-counsel', 'ciso'],
    onFailure: 'continue',
    dependencies: ['it-step-15'],
  },
  {
    id: 'it-step-17',
    name: 'Regulatory Notifications',
    type: StepType.MANUAL,
    description: `
      Determine and execute required regulatory notifications:
      1. Assess if data breach notification is required
      2. Identify affected regulatory frameworks (GDPR, CCPA, etc.)
      3. Prepare notification content with Legal
      4. Submit notifications within required timeframes
      5. Document all submissions and acknowledgments

      Legal must approve all regulatory communications.
    `,
    requiresApproval: true,
    approvers: ['legal', 'dpo'],
    onFailure: 'halt',
    dependencies: ['it-step-12'],
  },

  // Phase 7: Recovery
  {
    id: 'it-step-18',
    name: 'Review Access Controls',
    type: StepType.MANUAL,
    description: `
      Review and strengthen access controls:
      1. Audit all access the subject had
      2. Review if access was appropriate for role
      3. Identify any access control gaps exploited
      4. Recommend access control improvements
      5. Review access for similar roles
      6. Implement principle of least privilege improvements
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['it-step-15'],
  },
  {
    id: 'it-step-19',
    name: 'Update Monitoring Systems',
    type: StepType.MANUAL,
    description: `
      Enhance detection capabilities based on lessons learned:
      1. Update detection rules based on observed TTPs
      2. Improve insider threat indicators
      3. Enhance behavioral analytics baselines
      4. Add new data exfiltration detection rules
      5. Review and update alert thresholds
      6. Document monitoring improvements

      These improvements should prevent similar incidents.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['it-step-15'],
  },
  {
    id: 'it-step-20',
    name: 'Data Recovery and Protection',
    type: StepType.MANUAL,
    description: `
      Recover and protect affected data:
      1. Restore any manipulated or deleted data
      2. Rotate credentials for affected systems
      3. Review and revoke any unauthorized sharing
      4. Contact third parties if data was shared externally
      5. Implement additional data protection measures
      6. Document recovery actions
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['it-step-12'],
  },

  // Phase 8: Post-Incident
  {
    id: 'it-step-21',
    name: 'Policy Review',
    type: StepType.MANUAL,
    description: `
      Review and update relevant policies:
      1. Review acceptable use policies
      2. Update data handling policies
      3. Strengthen access control policies
      4. Review termination/offboarding procedures
      5. Update insider threat response procedures
      6. Document all policy changes

      Coordinate with Legal, HR, and Compliance.
    `,
    requiresApproval: true,
    approvers: ['ciso', 'legal', 'hr-leadership'],
    onFailure: 'continue',
    dependencies: ['it-step-15'],
  },
  {
    id: 'it-step-22',
    name: 'Training Improvements',
    type: StepType.MANUAL,
    description: `
      Improve training based on lessons learned:
      1. Update security awareness training content
      2. Enhance insider threat recognition training
      3. Improve manager training on warning signs
      4. Review data handling training
      5. Schedule refresher training if needed
      6. Document training updates

      Coordinate with HR on training deployment.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['it-step-21'],
  },
  {
    id: 'it-step-23',
    name: 'Post-Incident Report',
    type: StepType.MANUAL,
    description: `
      Create comprehensive post-incident report:
      1. Document complete incident timeline
      2. Summarize investigation findings
      3. Detail containment and remediation actions
      4. Calculate business impact
      5. Document lessons learned
      6. Recommend preventive measures
      7. Create executive summary

      Report must be reviewed by Legal before distribution.
      Maintain confidentiality of sensitive details.
    `,
    requiresApproval: true,
    approvers: ['legal', 'ciso'],
    onFailure: 'continue',
    dependencies: ['it-step-15', 'it-step-16', 'it-step-17'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.INSIDER_THREAT,
  },
];

const notifications: NotificationConfig[] = [
  // Confidential channel - limited distribution
  {
    channel: NotificationChannel.SLACK,
    target: '#security-insider-threat', // Private channel
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'security-lead-oncall',
    severityFilter: [IncidentSeverity.P1, IncidentSeverity.P2],
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'ciso@company.com',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'legal@company.com',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'hr-leadership@company.com',
    severityFilter: [IncidentSeverity.P1, IncidentSeverity.P2],
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
];

const escalation: EscalationConfig = {
  enabled: true,
  levels: [
    {
      level: 1,
      afterMinutes: 30,
      targets: ['security-lead', 'ciso'],
      channels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      message: 'Insider threat incident requires attention - confidential handling required',
    },
    {
      level: 2,
      afterMinutes: 60,
      targets: ['ciso', 'general-counsel', 'hr-director'],
      channels: [NotificationChannel.EMAIL, NotificationChannel.PAGERDUTY],
      message: 'Insider threat escalation - Legal and HR coordination required',
    },
    {
      level: 3,
      afterMinutes: 120,
      targets: ['ceo', 'cto', 'ciso', 'general-counsel'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Critical insider threat - executive attention required',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const insiderThreatPlaybook: PlaybookInput = {
  id: 'playbook-insider-threat-v1',
  name: 'Insider Threat Response',
  description: `
    Comprehensive playbook for responding to insider threat incidents.
    Covers detection, legal/HR coordination, evidence preservation,
    containment, investigation, and remediation.

    CRITICAL: This playbook requires Legal and HR approval before
    most containment and investigative actions. Insider threats
    involve employment law considerations and potential criminal
    proceedings that require careful coordination.

    All actions must be documented for potential legal use.
    Maintain strict confidentiality throughout the investigation.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: insiderThreatSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['insider-threat', 'data-exfiltration', 'employee', 'legal', 'hr', 'confidential'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default insiderThreatPlaybook;
