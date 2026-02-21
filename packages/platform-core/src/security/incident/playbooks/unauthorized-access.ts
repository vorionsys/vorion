/**
 * Unauthorized Access Response Playbook
 *
 * Comprehensive playbook for responding to unauthorized access incidents.
 * Covers detection, containment, investigation, remediation, and recovery.
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
 * Unauthorized access response steps using automated actions
 *
 * Steps are designed to:
 * - Execute automated containment actions immediately
 * - Collect evidence for forensics
 * - Pause for manual investigation and approval where needed
 * - Support parallel execution where dependencies allow
 * - Provide rollback capability for automated steps
 */
const unauthorizedAccessSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification
  {
    id: 'ua-step-1',
    name: 'Verify Unauthorized Access Indicators',
    type: StepType.MANUAL,
    description: `
      Verify the unauthorized access alert is legitimate:
      1. Review authentication logs and access patterns
      2. Confirm the access is unauthorized (not a false positive)
      3. Identify the compromised account(s) or entry point
      4. Determine if access is ongoing or historical
      5. Document initial findings and timeline

      Mark this step complete once verification is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },

  // Phase 2: Immediate Containment (Automated)
  {
    id: 'ua-step-2',
    name: 'Block Unauthorized IP Addresses',
    type: StepType.AUTOMATED,
    description: 'Automatically block identified unauthorized IP addresses at firewall, WAF, and CDN levels to prevent further access.',
    actionId: 'block-ip',
    timeout: 60000, // 1 minute
    requiresApproval: false, // Critical action - execute immediately
    onFailure: 'retry',
    retryAttempts: 3,
    dependencies: ['ua-step-1'],
    metadata: {
      rollbackOnFailure: true,
      notifyOnComplete: true,
    },
  },
  {
    id: 'ua-step-3',
    name: 'Revoke Compromised Credentials',
    type: StepType.AUTOMATED,
    description: 'Revoke all potentially compromised credentials including passwords, API keys, tokens, and terminate active sessions for affected accounts.',
    actionId: 'revoke-credentials',
    timeout: 180000, // 3 minutes
    requiresApproval: false, // Critical action - execute immediately after IP block
    onFailure: 'retry',
    retryAttempts: 3,
    dependencies: ['ua-step-1'],
  },
  {
    id: 'ua-step-4',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced security monitoring including increased logging, additional alerts, detection rules, and honeypots to detect further unauthorized access attempts.',
    actionId: 'scale-monitoring',
    timeout: 180000, // 3 minutes
    requiresApproval: false,
    onFailure: 'continue', // Non-critical - continue if fails
    dependencies: ['ua-step-1'],
  },

  // Phase 3: Scope Assessment (Manual)
  {
    id: 'ua-step-5',
    name: 'Assess Access Scope',
    type: StepType.MANUAL,
    description: `
      Determine the full scope of unauthorized access:
      1. Identify all systems and resources accessed
      2. Review data that was viewed, downloaded, or modified
      3. Check for lateral movement to other systems
      4. Identify any data exfiltration attempts
      5. Determine the time window of unauthorized access
      6. Document all affected resources

      This information is critical for remediation and potential regulatory reporting.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['ua-step-2', 'ua-step-3'],
  },

  // Phase 4: Evidence Collection (Automated)
  {
    id: 'ua-step-6',
    name: 'Collect Forensic Evidence',
    type: StepType.AUTOMATED,
    description: 'Automatically collect and preserve forensic evidence including authentication logs, access logs, audit trails, session data, and system state.',
    actionId: 'collect-evidence',
    timeout: 600000, // 10 minutes
    requiresApproval: false,
    onFailure: 'halt', // Critical for investigation
    dependencies: ['ua-step-1'],
  },

  // Phase 5: Notification (Automated)
  {
    id: 'ua-step-7',
    name: 'Notify Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send automated notifications to relevant stakeholders based on incident severity.',
    actionId: 'notify-stakeholders',
    timeout: 120000, // 2 minutes
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['ua-step-1'],
  },

  // Phase 6: Investigation (Manual)
  {
    id: 'ua-step-8',
    name: 'Determine Access Method',
    type: StepType.MANUAL,
    description: `
      Investigate how unauthorized access was gained:
      1. Analyze authentication methods used
      2. Check for credential theft (phishing, keylogger, etc.)
      3. Look for vulnerability exploitation
      4. Review for brute force or password spray attacks
      5. Check for session hijacking or token theft
      6. Identify if insider threat is involved
      7. Create detailed attack timeline

      Use the collected evidence from Step 6 for analysis.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['ua-step-5', 'ua-step-6'],
  },
  {
    id: 'ua-step-9',
    name: 'Identify Vulnerabilities Exploited',
    type: StepType.MANUAL,
    description: `
      Identify any vulnerabilities that enabled the unauthorized access:
      1. Review system configurations for weaknesses
      2. Check for missing patches or updates
      3. Analyze authentication mechanisms
      4. Review access control policies
      5. Identify any misconfigurations
      6. Document all findings for remediation

      Findings should be added to incident evidence.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ua-step-8'],
  },

  // Phase 7: Remediation (Manual with Approvals)
  {
    id: 'ua-step-10',
    name: 'Patch Vulnerabilities',
    type: StepType.MANUAL,
    description: `
      Implement remediation for identified vulnerabilities:
      1. Apply security patches to affected systems
      2. Update vulnerable software components
      3. Fix identified misconfigurations
      4. Close unauthorized access vectors
      5. Document all changes made

      Requires security lead approval before proceeding.
    `,
    requiresApproval: true,
    approvers: ['security-lead'],
    onFailure: 'halt',
    dependencies: ['ua-step-9'],
  },
  {
    id: 'ua-step-11',
    name: 'Strengthen Access Controls',
    type: StepType.MANUAL,
    description: `
      Implement stronger access controls:
      1. Review and update access policies
      2. Implement or strengthen MFA requirements
      3. Review and restrict user permissions
      4. Update firewall and network segmentation rules
      5. Implement additional monitoring controls
      6. Update password policies if applicable

      Requires security lead approval before proceeding.
    `,
    requiresApproval: true,
    approvers: ['security-lead'],
    onFailure: 'halt',
    dependencies: ['ua-step-9'],
  },
  {
    id: 'ua-step-12',
    name: 'Verification Testing',
    type: StepType.MANUAL,
    description: `
      Verify remediation effectiveness:
      1. Conduct vulnerability scanning
      2. Perform penetration testing on affected areas
      3. Verify patches are applied correctly
      4. Test access controls are working
      5. Confirm monitoring is capturing events
      6. Document test results
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['ua-step-10', 'ua-step-11'],
  },

  // Phase 8: Recovery (Manual with Approval)
  {
    id: 'ua-step-13',
    name: 'Restore Modified Data',
    type: StepType.MANUAL,
    description: `
      Restore any data modified by unauthorized access:
      1. Identify data that was modified or corrupted
      2. Restore from known good backups
      3. Verify data integrity after restoration
      4. Document all restoration activities
      5. Confirm business operations are not impacted

      This step requires approval from data owners and operations lead.
    `,
    requiresApproval: true,
    approvers: ['data-owner', 'operations-lead'],
    onFailure: 'halt',
    dependencies: ['ua-step-5', 'ua-step-12'],
  },
  {
    id: 'ua-step-14',
    name: 'Issue New Credentials',
    type: StepType.MANUAL,
    description: `
      Issue new credentials to affected users:
      1. Generate new passwords for affected accounts
      2. Rotate API keys and tokens
      3. Issue new certificates if applicable
      4. Communicate securely with affected users
      5. Verify users can access with new credentials
      6. Monitor for any access issues

      This step requires incident commander approval.
    `,
    requiresApproval: true,
    approvers: ['incident-commander'],
    onFailure: 'halt',
    dependencies: ['ua-step-12'],
  },

  // Phase 9: Post-Incident (Manual)
  {
    id: 'ua-step-15',
    name: 'Improve Detection Capabilities',
    type: StepType.MANUAL,
    description: `
      Enhance detection to prevent future incidents:
      1. Create new detection rules based on attack patterns
      2. Update SIEM correlation rules
      3. Implement additional logging where needed
      4. Set up alerts for similar access patterns
      5. Consider deploying additional security tools
      6. Document new detection capabilities
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ua-step-8'],
  },
  {
    id: 'ua-step-16',
    name: 'Update Access Policies',
    type: StepType.MANUAL,
    description: `
      Update access policies based on lessons learned:
      1. Review and update access control policies
      2. Update authentication requirements
      3. Revise network access policies
      4. Update vendor/third-party access procedures
      5. Document policy changes
      6. Communicate changes to relevant teams

      Requires security lead and compliance approval.
    `,
    requiresApproval: true,
    approvers: ['security-lead', 'compliance'],
    onFailure: 'continue',
    dependencies: ['ua-step-8'],
  },
  {
    id: 'ua-step-17',
    name: 'Post-Incident Review',
    type: StepType.MANUAL,
    description: `
      Conduct post-incident review:
      1. Schedule post-mortem meeting
      2. Document lessons learned
      3. Identify process improvements
      4. Update playbooks and procedures
      5. Create final incident report
      6. Share findings with relevant teams
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ua-step-13', 'ua-step-14', 'ua-step-15', 'ua-step-16'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.UNAUTHORIZED_ACCESS,
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
    target: 'it-operations@company.com',
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
      afterMinutes: 10,
      targets: ['security-team'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY],
      message: 'Unauthorized access incident not acknowledged within 10 minutes',
    },
    {
      level: 2,
      afterMinutes: 25,
      targets: ['security-lead', 'incident-commander'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL],
      message: 'Unauthorized access incident requires immediate attention - escalating to leadership',
    },
    {
      level: 3,
      afterMinutes: 45,
      targets: ['ciso', 'cto'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Critical unauthorized access - executive escalation',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const unauthorizedAccessPlaybook: PlaybookInput = {
  id: 'playbook-unauthorized-access-v1',
  name: 'Unauthorized Access Response',
  description: `
    Comprehensive playbook for responding to unauthorized access incidents.
    Covers detection, containment, scope assessment, evidence collection,
    investigation, remediation, recovery, and post-incident activities.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: unauthorizedAccessSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['unauthorized-access', 'intrusion', 'access-control', 'security'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default unauthorizedAccessPlaybook;
