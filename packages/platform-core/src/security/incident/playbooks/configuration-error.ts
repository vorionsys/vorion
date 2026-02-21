/**
 * Configuration Error Response Playbook
 *
 * Streamlined playbook for responding to configuration error incidents.
 * Covers verification, immediate mitigation, impact assessment, remediation,
 * and post-incident configuration management improvements.
 *
 * Configuration errors are often quick to fix but may have security implications
 * if they exposed data or created vulnerabilities.
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
 * Configuration error response steps using automated actions
 *
 * Steps are designed to:
 * - Quickly verify the configuration issue and assess security impact
 * - Implement immediate mitigation (fix config or disable service)
 * - Assess if data was exposed or systems were compromised
 * - Collect evidence if exposure occurred
 * - Apply correct configuration and validate the fix
 * - Restore normal operations
 * - Update configuration management practices
 */
const configurationErrorSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification
  {
    id: 'cfg-step-1',
    name: 'Verify Configuration Issue',
    type: StepType.MANUAL,
    description: `
      Verify the configuration error and assess security impact:
      1. Review the alert or report identifying the configuration issue
      2. Confirm the misconfiguration exists
      3. Identify affected systems, services, or resources
      4. Determine the type of misconfiguration (permissions, network, secrets, etc.)
      5. Assess potential security impact (data exposure, unauthorized access, etc.)
      6. Document initial findings and severity assessment

      Mark this step complete once verification is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },

  // Phase 2: Immediate Mitigation
  {
    id: 'cfg-step-2',
    name: 'Apply Immediate Mitigation',
    type: StepType.MANUAL,
    description: `
      Implement immediate mitigation to stop any ongoing exposure:
      1. If possible, fix the configuration immediately
      2. If fix is complex, disable or isolate the affected service
      3. Revoke any exposed credentials or access tokens
      4. Block unauthorized access paths if applicable
      5. Verify mitigation is effective
      6. Document mitigation actions taken

      Choose the fastest path to stop any active security exposure.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['cfg-step-1'],
  },
  {
    id: 'cfg-step-2b',
    name: 'Notify Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send automated notifications to relevant stakeholders about the configuration incident.',
    actionId: 'notify-stakeholders',
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['cfg-step-1'],
  },
  {
    id: 'cfg-step-2c',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced monitoring to detect any exploitation attempts or ongoing unauthorized access.',
    actionId: 'scale-monitoring',
    timeout: 180000,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-1'],
    metadata: {
      monitoringLevel: 'elevated',
      focusAreas: ['access-patterns', 'data-access', 'authentication'],
    },
  },

  // Phase 3: Impact Assessment
  {
    id: 'cfg-step-3',
    name: 'Assess Data Exposure',
    type: StepType.MANUAL,
    description: `
      Determine if data was exposed during the misconfiguration window:
      1. Identify the time window the misconfiguration was active
      2. Review access logs for the affected resources
      3. Identify any unauthorized access or data retrieval
      4. Determine what data types were potentially exposed
      5. Estimate the number of affected records/users
      6. Document all findings

      If data was exposed, proceed to evidence collection.
      If no exposure, this may be documented and skipped.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-2'],
  },
  {
    id: 'cfg-step-3b',
    name: 'Check for System Compromise',
    type: StepType.MANUAL,
    description: `
      Assess if systems were compromised due to the misconfiguration:
      1. Check for signs of unauthorized system access
      2. Review authentication logs for suspicious activity
      3. Check for unauthorized changes or deployments
      4. Look for persistence mechanisms (new users, keys, scheduled tasks)
      5. Verify system integrity
      6. Document any indicators of compromise

      If compromise indicators found, consider escalating to a broader incident type.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-2'],
  },

  // Phase 4: Evidence Collection (Conditional - if data exposure)
  {
    id: 'cfg-step-4',
    name: 'Collect Evidence',
    type: StepType.AUTOMATED,
    description: 'Collect and preserve evidence if data exposure or unauthorized access occurred. Includes logs, access records, and system state.',
    actionId: 'collect-evidence',
    timeout: 300000, // 5 minutes
    requiresApproval: false,
    onFailure: 'continue', // Evidence is important but don't halt remediation
    dependencies: ['cfg-step-3'],
    metadata: {
      evidenceTypes: ['access-logs', 'audit-trails', 'configuration-snapshots'],
      preserveChainOfCustody: true,
    },
  },

  // Phase 5: Remediation
  {
    id: 'cfg-step-5',
    name: 'Apply Correct Configuration',
    type: StepType.MANUAL,
    description: `
      Apply the correct configuration:
      1. Determine the correct/secure configuration settings
      2. Review changes with appropriate team members
      3. Apply configuration changes through proper change management
      4. Verify configuration is applied correctly
      5. Test that services function as expected
      6. Document the configuration change

      Requires approval to ensure proper review.
    `,
    requiresApproval: true,
    approvers: ['security-lead', 'operations-lead'],
    onFailure: 'halt',
    dependencies: ['cfg-step-2'],
  },
  {
    id: 'cfg-step-5b',
    name: 'Validate Fix',
    type: StepType.MANUAL,
    description: `
      Validate the configuration fix:
      1. Verify the security issue is resolved
      2. Test that unauthorized access is no longer possible
      3. Confirm services are functioning correctly
      4. Run security scan against affected resources
      5. Verify no regression in functionality
      6. Document validation results
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['cfg-step-5'],
  },

  // Phase 6: Recovery
  {
    id: 'cfg-step-6',
    name: 'Restore Normal Operations',
    type: StepType.MANUAL,
    description: `
      Restore normal operations:
      1. Re-enable any services that were disabled
      2. Remove temporary access restrictions
      3. Return monitoring to normal levels
      4. Verify all services are operating normally
      5. Confirm with stakeholders that operations are restored
      6. Update incident status
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-5b'],
  },

  // Phase 7: Post-Incident
  {
    id: 'cfg-step-7',
    name: 'Update Configuration Management',
    type: StepType.MANUAL,
    description: `
      Improve configuration management to prevent recurrence:
      1. Add configuration validation rules to catch this type of error
      2. Update infrastructure-as-code templates if applicable
      3. Add automated configuration scanning
      4. Update deployment pipelines with configuration checks
      5. Review and update configuration documentation
      6. Consider configuration drift detection tools

      Document all changes for the incident report.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-5b'],
  },
  {
    id: 'cfg-step-7b',
    name: 'Post-Incident Review',
    type: StepType.MANUAL,
    description: `
      Conduct post-incident review:
      1. Document root cause of the misconfiguration
      2. Identify how the error was introduced
      3. Review detection and response timeline
      4. Identify process improvements
      5. Update runbooks and playbooks
      6. Create final incident report
      7. Share lessons learned with relevant teams
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['cfg-step-6', 'cfg-step-7'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.CONFIGURATION_ERROR,
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
    target: '#ops-alerts',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'security-oncall',
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
      afterMinutes: 15,
      targets: ['security-team', 'operations-team'],
      channels: [NotificationChannel.SLACK],
      message: 'Configuration error incident not acknowledged - please review',
    },
    {
      level: 2,
      afterMinutes: 30,
      targets: ['security-lead', 'operations-lead'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY],
      message: 'Configuration error requires attention - escalating to leadership',
    },
    {
      level: 3,
      afterMinutes: 60,
      targets: ['ciso', 'cto'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL],
      message: 'Configuration error incident unresolved - executive escalation',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const configurationErrorPlaybook: PlaybookInput = {
  id: 'playbook-configuration-error-v1',
  name: 'Configuration Error Response',
  description: `
    Streamlined playbook for responding to configuration error incidents.
    Covers verification, immediate mitigation, impact assessment, evidence
    collection (if data exposed), remediation, and configuration management
    improvements. Designed for efficient resolution of misconfigurations
    while ensuring security implications are properly addressed.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: configurationErrorSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['configuration', 'misconfiguration', 'config-error', 'security', 'operations'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default configurationErrorPlaybook;
