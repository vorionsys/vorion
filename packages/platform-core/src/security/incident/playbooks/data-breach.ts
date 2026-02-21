/**
 * Data Breach Response Playbook
 *
 * Comprehensive playbook for responding to data breach incidents.
 * Follows industry best practices and regulatory requirements.
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
 * Data breach response steps using automated actions
 *
 * Steps are designed to:
 * - Execute automated containment actions immediately
 * - Collect evidence for forensics
 * - Pause for manual investigation and approval where needed
 * - Support parallel execution where dependencies allow
 * - Provide rollback capability for automated steps
 */
const dataBreachSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification
  {
    id: 'db-step-1',
    name: 'Initial Detection Verification',
    type: StepType.MANUAL,
    description: `
      Verify the data breach alert is legitimate:
      1. Review the initial alert/report
      2. Confirm the breach is real (not a false positive)
      3. Identify the type of data potentially exposed
      4. Document initial findings

      Mark this step complete once verification is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },

  // Phase 2: Immediate Containment (Automated)
  {
    id: 'db-step-2',
    name: 'Isolate Affected Systems',
    type: StepType.AUTOMATED,
    description: 'Automatically isolate affected systems to prevent further data exfiltration. This action blocks network access and removes systems from load balancers.',
    actionId: 'isolate-system', // Uses the isolate-system action
    timeout: 120000, // 2 minutes
    requiresApproval: true, // Requires approval due to high impact
    approvers: ['security-lead', 'incident-commander'],
    onFailure: 'halt',
    retryAttempts: 2,
    dependencies: ['db-step-1'],
    metadata: {
      rollbackOnFailure: true,
      notifyOnComplete: true,
    },
  },
  {
    id: 'db-step-3',
    name: 'Revoke Compromised Credentials',
    type: StepType.AUTOMATED,
    description: 'Revoke all potentially compromised credentials including passwords, API keys, tokens, and active sessions.',
    actionId: 'revoke-credentials', // Uses the revoke-credentials action
    timeout: 180000, // 3 minutes
    requiresApproval: false, // Critical action - execute immediately after isolation
    onFailure: 'retry',
    retryAttempts: 3,
    dependencies: ['db-step-2'],
  },
  {
    id: 'db-step-3b',
    name: 'Block Malicious IPs',
    type: StepType.AUTOMATED,
    description: 'Block identified malicious IP addresses at firewall, WAF, and CDN levels.',
    actionId: 'block-ip', // Uses the block-ip action
    timeout: 60000,
    requiresApproval: false,
    onFailure: 'continue', // Non-critical - continue if fails
    retryAttempts: 2,
    dependencies: ['db-step-2'],
  },
  {
    id: 'db-step-4',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced security monitoring including increased logging, additional alerts, detection rules, and honeypots.',
    actionId: 'scale-monitoring', // Uses the scale-monitoring action
    timeout: 180000,
    requiresApproval: false,
    onFailure: 'continue', // Non-critical - continue if fails
    dependencies: ['db-step-2'],
  },

  // Phase 3: Evidence Collection (Automated)
  {
    id: 'db-step-5',
    name: 'Collect Forensic Evidence',
    type: StepType.AUTOMATED,
    description: 'Automatically collect and preserve forensic evidence including logs, system state, network captures, and database audit trails.',
    actionId: 'collect-evidence', // Uses the collect-evidence action
    timeout: 600000, // 10 minutes
    requiresApproval: false,
    onFailure: 'halt', // Critical for investigation
    dependencies: ['db-step-2'],
  },

  // Phase 4: Notification (Automated)
  {
    id: 'db-step-5b',
    name: 'Notify Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send automated notifications to relevant stakeholders based on incident severity.',
    actionId: 'notify-stakeholders', // Uses the notify-stakeholders action
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['db-step-1'],
  },

  // Phase 5: Investigation (Manual)
  {
    id: 'db-step-6',
    name: 'Impact Assessment',
    type: StepType.MANUAL,
    description: `
      Conduct detailed impact assessment:
      1. Identify all affected data types (PII, PHI, financial, etc.)
      2. Determine the number of affected individuals
      3. Assess potential legal and regulatory implications
      4. Evaluate business impact
      5. Document all findings in the incident evidence

      Use the collected evidence from Step 5 for analysis.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['db-step-5'],
  },
  {
    id: 'db-step-7',
    name: 'Determine Root Cause',
    type: StepType.MANUAL,
    description: `
      Investigate and document the root cause:
      1. Analyze forensic evidence
      2. Review security logs and audit trails
      3. Identify attack vectors used
      4. Document vulnerability exploited
      5. Create attack timeline

      Findings should be added to incident evidence.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['db-step-5'],
  },

  // Phase 6: Executive and Legal (Manual with Approvals)
  {
    id: 'db-step-8',
    name: 'Executive Briefing',
    type: StepType.MANUAL,
    description: `
      Prepare and deliver executive briefing:
      1. Summarize incident details
      2. Present impact assessment
      3. Outline containment actions taken
      4. Discuss regulatory notification requirements
      5. Present remediation plan

      Requires approval from executive stakeholders.
    `,
    requiresApproval: true,
    approvers: ['ciso', 'legal', 'executive-team'],
    onFailure: 'halt',
    dependencies: ['db-step-6', 'db-step-7'],
  },
  {
    id: 'db-step-9',
    name: 'Legal Consultation',
    type: StepType.MANUAL,
    description: `
      Consult with legal team:
      1. Review regulatory notification requirements (GDPR, CCPA, HIPAA, etc.)
      2. Determine notification timeline obligations
      3. Prepare legal hold notice if needed
      4. Review communication templates
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['db-step-6'],
  },

  // Phase 7: Regulatory Notification (Manual)
  {
    id: 'db-step-10',
    name: 'Notify Regulatory Bodies',
    type: StepType.MANUAL,
    description: `
      Submit required regulatory notifications:
      1. Complete regulatory notification forms
      2. Submit to relevant authorities (DPA, HHS, etc.)
      3. Document submission timestamps
      4. Track acknowledgments

      This step requires legal and DPO approval.
    `,
    requiresApproval: true,
    approvers: ['legal', 'dpo'],
    onFailure: 'halt',
    dependencies: ['db-step-8', 'db-step-9'],
  },

  // Phase 8: User Notification (Automated with Approval)
  {
    id: 'db-step-11',
    name: 'Notify Affected Users',
    type: StepType.AUTOMATED,
    description: 'Send data breach notification to affected users via email and other configured channels.',
    actionId: 'notify-stakeholders',
    timeout: 300000, // 5 minutes
    requiresApproval: true,
    approvers: ['legal', 'communications'],
    onFailure: 'retry',
    retryAttempts: 3,
    dependencies: ['db-step-10'],
    metadata: {
      notificationType: 'affected-users',
      includeRemediationGuidance: true,
    },
  },

  // Phase 9: Remediation (Manual)
  {
    id: 'db-step-12',
    name: 'Implement Remediation',
    type: StepType.MANUAL,
    description: `
      Implement remediation measures:
      1. Patch identified vulnerabilities
      2. Update security configurations
      3. Implement additional security controls
      4. Update access controls
      5. Deploy security patches

      Requires security lead approval before proceeding.
    `,
    requiresApproval: true,
    approvers: ['security-lead'],
    onFailure: 'halt',
    dependencies: ['db-step-7'],
  },
  {
    id: 'db-step-13',
    name: 'Verification Testing',
    type: StepType.MANUAL,
    description: `
      Verify remediation effectiveness:
      1. Conduct vulnerability scanning
      2. Perform penetration testing
      3. Verify patches are applied
      4. Test security controls
      5. Document results
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['db-step-12'],
  },

  // Phase 10: Recovery (Manual with Approval)
  {
    id: 'db-step-14',
    name: 'Service Restoration',
    type: StepType.MANUAL,
    description: `
      Restore normal operations:
      1. Remove network isolation (coordinate with automation rollback)
      2. Re-enable disabled services
      3. Issue new credentials where needed
      4. Monitor for any anomalies
      5. Confirm service availability

      This step triggers rollback of isolation measures.
    `,
    requiresApproval: true,
    approvers: ['incident-commander', 'operations-lead'],
    onFailure: 'halt',
    dependencies: ['db-step-13'],
  },

  // Phase 11: Post-Incident (Manual)
  {
    id: 'db-step-15',
    name: 'Post-Incident Review',
    type: StepType.MANUAL,
    description: `
      Conduct post-incident review:
      1. Schedule post-mortem meeting
      2. Document lessons learned
      3. Identify process improvements
      4. Update playbooks and procedures
      5. Create final incident report
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['db-step-14'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.DATA_BREACH,
  },
];

const notifications: NotificationConfig[] = [
  {
    channel: NotificationChannel.SLACK,
    target: '#security-incidents',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'security-team',
    severityFilter: [IncidentSeverity.P1, IncidentSeverity.P2],
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'security@company.com',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'legal@company.com',
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
      afterMinutes: 15,
      targets: ['security-team'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY],
      message: 'Incident not acknowledged within 15 minutes',
    },
    {
      level: 2,
      afterMinutes: 30,
      targets: ['security-lead', 'incident-commander'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL],
      message: 'Incident requires immediate attention - escalating to leadership',
    },
    {
      level: 3,
      afterMinutes: 60,
      targets: ['ciso', 'cto'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Critical data breach - executive escalation',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const dataBreachPlaybook: PlaybookInput = {
  id: 'playbook-data-breach-v1',
  name: 'Data Breach Response',
  description: `
    Comprehensive playbook for responding to data breach incidents.
    Covers detection, containment, eradication, recovery, and post-incident activities.
    Compliant with GDPR, CCPA, HIPAA, and other regulatory requirements.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: dataBreachSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['data-breach', 'privacy', 'regulatory', 'critical'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default dataBreachPlaybook;
