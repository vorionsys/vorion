/**
 * Account Compromise Response Playbook
 *
 * Playbook for responding to account compromise incidents including
 * unauthorized access, credential theft, and account takeover.
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
 * Account compromise response steps using automated actions
 *
 * Steps are designed to:
 * - Immediately contain the compromise
 * - Revoke all credentials and sessions
 * - Collect evidence for investigation
 * - Support parallel execution where dependencies allow
 * - Provide clear manual steps for investigation
 */
const accountCompromiseSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification
  {
    id: 'ac-step-1',
    name: 'Verify Compromise Indicators',
    type: StepType.MANUAL,
    description: `
      Verify the account compromise alert:
      1. Review the suspicious activity that triggered the alert
      2. Check for indicators of compromise (impossible travel, unusual access patterns)
      3. Verify with the account owner if possible (use secondary channel)
      4. Document initial findings
      5. Determine if this is a true positive

      Mark this step complete once verification is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },

  // Phase 2: Immediate Containment (Automated - runs in parallel)
  {
    id: 'ac-step-2',
    name: 'Revoke All Credentials',
    type: StepType.AUTOMATED,
    description: 'Immediately revoke all credentials including passwords, API keys, OAuth tokens, and terminate all active sessions.',
    actionId: 'revoke-credentials', // Uses the revoke-credentials action
    timeout: 180000, // 3 minutes
    requiresApproval: true, // Requires approval before disabling account
    approvers: ['security-team', 'account-owner-manager'],
    onFailure: 'halt',
    retryAttempts: 3,
    dependencies: ['ac-step-1'],
    metadata: {
      notifyOnComplete: true,
      includeAccountDisable: true,
    },
  },
  {
    id: 'ac-step-2b',
    name: 'Block Attacker IPs',
    type: StepType.AUTOMATED,
    description: 'Block IP addresses associated with the compromise attempt.',
    actionId: 'block-ip', // Uses the block-ip action
    timeout: 60000,
    requiresApproval: false,
    onFailure: 'continue', // Non-critical
    retryAttempts: 2,
    dependencies: ['ac-step-1'],
  },
  {
    id: 'ac-step-3',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced monitoring for the compromised account and related systems.',
    actionId: 'scale-monitoring', // Uses the scale-monitoring action
    timeout: 180000,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-2'],
  },

  // Phase 3: Evidence Collection (Automated)
  {
    id: 'ac-step-4',
    name: 'Collect Account Activity Evidence',
    type: StepType.AUTOMATED,
    description: 'Collect all account activity logs, authentication records, and access patterns for forensic analysis.',
    actionId: 'collect-evidence', // Uses the collect-evidence action
    timeout: 600000, // 10 minutes
    requiresApproval: false,
    onFailure: 'continue', // Continue even if evidence collection partially fails
    dependencies: ['ac-step-2'],
    metadata: {
      evidenceTypes: ['logs', 'authentication', 'database_audit'],
      preserveChainOfCustody: true,
    },
  },

  // Phase 4: Notification (Automated)
  {
    id: 'ac-step-4b',
    name: 'Notify Security Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send automated notifications to security team and relevant stakeholders.',
    actionId: 'notify-stakeholders', // Uses the notify-stakeholders action
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['ac-step-1'],
  },

  // Phase 5: Investigation (Manual - can run in parallel)
  {
    id: 'ac-step-5',
    name: 'Determine Compromise Source',
    type: StepType.MANUAL,
    description: `
      Investigate how the account was compromised:
      1. Review authentication logs for suspicious patterns
      2. Check for phishing indicators (examine email, links clicked)
      3. Analyze IP addresses and geolocation data
      4. Review password history and reset activity
      5. Check for credential stuffing patterns
      6. Document the attack vector

      Use the evidence collected in Step 4 for analysis.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-4'],
  },
  {
    id: 'ac-step-6',
    name: 'Assess Lateral Movement',
    type: StepType.MANUAL,
    description: `
      Check for lateral movement to other systems:
      1. Review what resources the compromised account accessed
      2. Check for privilege escalation attempts
      3. Identify any data that was accessed or exported
      4. Check for changes made by the attacker
      5. Identify any affected downstream systems
      6. Document all findings
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['ac-step-4'],
  },
  {
    id: 'ac-step-7',
    name: 'Review Related Accounts',
    type: StepType.MANUAL,
    description: `
      Check for compromise of related accounts:
      1. Identify accounts with similar access patterns
      2. Check for accounts using same/similar credentials
      3. Review accounts of team members (same team, shared resources)
      4. Check service accounts associated with the user
      5. Flag any suspicious accounts for investigation
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-5'],
  },

  // Phase 6: User Communication (Manual)
  {
    id: 'ac-step-8',
    name: 'Contact Account Owner',
    type: StepType.MANUAL,
    description: `
      Reach out to the legitimate account owner:
      1. Verify identity through established protocols (use secondary channel/phone)
      2. Inform them of the compromise
      3. Gather any relevant information they may have:
         - Recent phishing emails?
         - Password reuse?
         - Shared credentials?
      4. Explain next steps for account recovery
      5. Document the conversation

      This step can proceed in parallel with investigation.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-1'],
  },

  // Phase 7: Remediation (Manual with Approvals)
  {
    id: 'ac-step-9',
    name: 'Remediate Root Cause',
    type: StepType.MANUAL,
    description: `
      Address the root cause of the compromise:
      1. If phishing: report and block phishing infrastructure
      2. If credential stuffing: enforce password policy changes
      3. If vulnerability: apply security patches
      4. If MFA bypass: review and strengthen MFA
      5. Update security controls as needed
      6. Document remediation actions

      Requires security lead approval.
    `,
    requiresApproval: true,
    approvers: ['security-lead'],
    onFailure: 'halt',
    dependencies: ['ac-step-5'],
  },

  // Phase 8: Account Recovery (Manual with Approvals)
  {
    id: 'ac-step-10',
    name: 'Restore Account Access',
    type: StepType.MANUAL,
    description: `
      Restore account access to legitimate owner:
      1. Guide user through secure account recovery
      2. Ensure new strong password is set
      3. Re-enable MFA with new seed/device
      4. Review and update account permissions
      5. Verify account is functioning normally
      6. Provide security awareness guidance

      Requires approval from security team and account owner's manager.
    `,
    requiresApproval: true,
    approvers: ['security-team', 'account-owner-manager'],
    onFailure: 'halt',
    dependencies: ['ac-step-6', 'ac-step-8', 'ac-step-9'],
  },

  // Phase 9: User Notification (Automated)
  {
    id: 'ac-step-11',
    name: 'Send Formal Notification',
    type: StepType.AUTOMATED,
    description: 'Send formal notification to the user about the incident, actions taken, and security recommendations.',
    actionId: 'notify-stakeholders',
    timeout: 60000,
    requiresApproval: false,
    onFailure: 'retry',
    retryAttempts: 3,
    dependencies: ['ac-step-10'],
    metadata: {
      notificationType: 'account-owner',
      includeSecurityGuidance: true,
    },
  },

  // Phase 10: Monitoring and Closure (Manual)
  {
    id: 'ac-step-12',
    name: 'Post-Incident Monitoring',
    type: StepType.MANUAL,
    description: `
      Establish ongoing monitoring:
      1. Verify enhanced monitoring is active (from Step 3)
      2. Set up alerts for suspicious activity on this account
      3. Schedule follow-up security review (30 days)
      4. Monitor for attacker return attempts
      5. Track user for any issues
      6. Plan monitoring duration (typically 30-90 days)
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-10'],
  },
  {
    id: 'ac-step-13',
    name: 'Documentation and Lessons Learned',
    type: StepType.MANUAL,
    description: `
      Complete incident documentation:
      1. Finalize incident timeline
      2. Document all actions taken
      3. Identify lessons learned
      4. Recommend process improvements
      5. Create final incident report
      6. Update playbook if improvements identified
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['ac-step-10'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.ACCOUNT_COMPROMISE,
  },
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.UNAUTHORIZED_ACCESS,
    logicalOperator: 'or',
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
    channel: NotificationChannel.SLACK,
    target: '#identity-team',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'identity-oncall',
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
];

const escalation: EscalationConfig = {
  enabled: true,
  levels: [
    {
      level: 1,
      afterMinutes: 10,
      targets: ['identity-team'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY],
      message: 'Account compromise not acknowledged - immediate action required',
    },
    {
      level: 2,
      afterMinutes: 20,
      targets: ['security-lead', 'identity-lead'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL],
      message: 'Account compromise escalating - leadership attention needed',
    },
    {
      level: 3,
      afterMinutes: 45,
      targets: ['ciso', 'vp-engineering'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Critical account compromise - executive escalation',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const accountCompromisePlaybook: PlaybookInput = {
  id: 'playbook-account-compromise-v1',
  name: 'Account Compromise Response',
  description: `
    Playbook for responding to account compromise incidents.
    Covers account lockdown, forensic collection, impact assessment,
    and secure account recovery procedures.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: accountCompromiseSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['account-compromise', 'identity', 'authentication', 'security'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default accountCompromisePlaybook;
