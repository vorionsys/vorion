/**
 * Ransomware Incident Response Playbook
 *
 * Comprehensive playbook for responding to ransomware incidents.
 * CRITICAL: Ransomware requires IMMEDIATE isolation - no approval delay
 * for initial containment to prevent encryption spread.
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
 * Ransomware response steps using automated actions
 *
 * Steps are designed to:
 * - IMMEDIATELY isolate affected systems (no approval delay)
 * - Verify ransomware indicators and identify variant
 * - Assess encryption impact and backup status
 * - Collect ransomware samples and ransom notes for evidence
 * - Coordinate with legal and law enforcement
 * - Make informed recovery decisions (restore vs negotiate)
 * - Eradicate ransomware and restore from clean backups
 * - Improve defenses and backup procedures post-incident
 *
 * CRITICAL: Time is essential - every minute of delay allows more encryption
 */
const ransomwareSteps: PlaybookStepInput[] = [
  // Phase 1: IMMEDIATE Isolation (Automated - NO APPROVAL REQUIRED)
  // This MUST happen first before any investigation to stop encryption spread
  {
    id: 'rw-step-1',
    name: 'Emergency System Isolation',
    type: StepType.AUTOMATED,
    description: 'IMMEDIATE automated isolation of all affected systems to halt ransomware spread and encryption. This action disconnects systems from the network without approval delay. Every second counts - ransomware can encrypt thousands of files per minute.',
    actionId: 'isolate-system', // Uses the isolate-system action
    timeout: 60000, // 1 minute - must be fast
    requiresApproval: false, // CRITICAL: No approval delay for ransomware
    onFailure: 'retry',
    retryAttempts: 3,
    metadata: {
      rollbackOnFailure: false, // Do not rollback isolation on failure
      notifyOnComplete: true,
      emergencyIsolation: true,
      disconnectAllNetworkInterfaces: true,
    },
  },
  {
    id: 'rw-step-1b',
    name: 'Block Ransomware C2 Infrastructure',
    type: StepType.AUTOMATED,
    description: 'Block known ransomware command and control IP addresses and domains at all network boundaries to prevent key exchange and exfiltration.',
    actionId: 'block-ip', // Uses the block-ip action
    timeout: 60000, // 1 minute
    requiresApproval: false, // No approval delay
    onFailure: 'continue', // Continue even if some blocks fail
    retryAttempts: 3,
    dependencies: ['rw-step-1'],
    metadata: {
      blockType: 'ransomware_c2',
      includeKnownRansomwareIOCs: true,
      blockExfiltrationEndpoints: true,
    },
  },
  {
    id: 'rw-step-1c',
    name: 'Notify Emergency Response Team',
    type: StepType.AUTOMATED,
    description: 'Send immediate emergency notifications to security team, IT operations, and incident commanders about the ransomware attack.',
    actionId: 'notify-stakeholders', // Uses the notify-stakeholders action
    timeout: 60000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['rw-step-1'],
    metadata: {
      notificationType: 'ransomware_emergency',
      priority: 'critical',
      includeExecutives: true,
    },
  },

  // Phase 2: Detection and Verification
  {
    id: 'rw-step-2',
    name: 'Verify Ransomware Indicators',
    type: StepType.MANUAL,
    description: `
      Verify and document the ransomware attack:
      1. Confirm ransomware indicators (encrypted files, ransom notes)
      2. Identify the ransomware variant/family if possible:
         - Check file extensions added to encrypted files
         - Analyze ransom note format and content
         - Search for known ransomware signatures
      3. Determine infection vector (phishing, RDP, vulnerability)
      4. Identify patient zero (first infected system)
      5. Document all ransom note contents and payment demands
      6. Record ransom wallet addresses and payment instructions
      7. Check if this is a known decryptable variant

      Note: Systems should already be isolated from Step 1.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-1'],
  },
  {
    id: 'rw-step-2b',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced security monitoring to detect any ongoing encryption, lateral movement, or data exfiltration attempts.',
    actionId: 'scale-monitoring', // Uses the scale-monitoring action
    timeout: 180000, // 3 minutes
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-1'],
    metadata: {
      monitoringProfile: 'ransomware_incident',
      enableFileIntegrityMonitoring: true,
      detectEncryptionPatterns: true,
    },
  },

  // Phase 3: Impact Assessment
  {
    id: 'rw-step-3',
    name: 'Assess Encryption Impact',
    type: StepType.MANUAL,
    description: `
      Assess the full scope of encryption damage:
      1. Identify all encrypted files and file types
      2. Determine total volume of encrypted data
      3. List all affected systems and servers:
         - Workstations
         - Servers
         - Network shares
         - Cloud storage
         - Databases
      4. Assess impact on business operations
      5. Identify any unencrypted critical systems
      6. Check for data exfiltration (double extortion)
      7. Document encryption timestamps and patterns

      Create comprehensive impact report for decision making.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-2'],
  },
  {
    id: 'rw-step-3b',
    name: 'Assess Backup Status',
    type: StepType.MANUAL,
    description: `
      CRITICAL: Evaluate backup availability and integrity:
      1. Check backup system isolation (ensure not encrypted)
      2. Verify backup integrity and recoverability:
         - When was the last successful backup?
         - Are backups tested and verified?
         - Are offline/air-gapped backups available?
      3. Determine Recovery Point Objective (RPO):
         - How much data will be lost from backup restore?
         - What is the acceptable data loss window?
      4. Estimate Recovery Time Objective (RTO):
         - How long will full restoration take?
         - What is the priority order for restoration?
      5. Identify any unbackedup critical data
      6. Check cloud backup availability
      7. Verify backup authentication is not compromised

      Backup status is CRITICAL for recovery strategy decision.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-3'],
  },

  // Phase 4: Evidence Collection
  {
    id: 'rw-step-4',
    name: 'Collect Ransomware Evidence',
    type: StepType.AUTOMATED,
    description: 'Collect and preserve forensic evidence including ransomware samples, ransom notes, encrypted file samples, system logs, and network captures for investigation and potential law enforcement involvement.',
    actionId: 'collect-evidence', // Uses the collect-evidence action
    timeout: 900000, // 15 minutes
    requiresApproval: false,
    onFailure: 'halt', // Critical for investigation
    dependencies: ['rw-step-2'],
    metadata: {
      evidenceTypes: [
        'ransomware_samples',
        'ransom_notes',
        'encrypted_files',
        'memory_dump',
        'logs',
        'network_capture',
        'registry',
      ],
      preserveChainOfCustody: true,
      calculateHashes: true,
      lawEnforcementReady: true,
    },
  },
  {
    id: 'rw-step-4b',
    name: 'Document Ransom Demands',
    type: StepType.MANUAL,
    description: `
      Thoroughly document all ransom communications:
      1. Capture all ransom notes (screenshots, copies)
      2. Record payment demands (amount, cryptocurrency type)
      3. Document wallet addresses and payment instructions
      4. Note any deadlines or threat escalations
      5. Capture attacker communication channels:
         - Tor sites
         - Email addresses
         - Chat portals
      6. Document any proof of decryption offered
      7. Record double extortion threats (data leak threats)
      8. Preserve all evidence with timestamps

      DO NOT communicate with attackers without legal approval.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-4'],
  },

  // Phase 5: Communication and Legal
  {
    id: 'rw-step-5',
    name: 'Notify Internal Stakeholders',
    type: StepType.MANUAL,
    description: `
      Notify all required internal stakeholders:
      1. Executive leadership (CEO, COO, CFO)
      2. Legal department - CRITICAL for recovery decision
      3. Board of Directors (for significant incidents)
      4. Communications/PR team
      5. Human Resources
      6. Finance department (for potential payment)
      7. Affected department heads
      8. Insurance provider (cyber insurance)

      Provide current status, impact assessment, and recovery options.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-3', 'rw-step-3b'],
  },
  {
    id: 'rw-step-5b',
    name: 'Legal Consultation',
    type: StepType.MANUAL,
    description: `
      Consult with legal counsel on critical decisions:
      1. Review legal implications of paying ransom:
         - OFAC sanctions compliance
         - Anti-money laundering requirements
         - Insurance policy coverage
      2. Assess regulatory notification requirements:
         - GDPR breach notification (72 hours)
         - CCPA, HIPAA, PCI-DSS requirements
         - State breach notification laws
      3. Document legal advice received
      4. Prepare for potential law enforcement involvement
      5. Establish legal privilege for communications
      6. Review contract obligations to customers/partners

      Legal must approve any payment consideration.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-5'],
  },
  {
    id: 'rw-step-5c',
    name: 'Consider Law Enforcement Notification',
    type: StepType.MANUAL,
    description: `
      Evaluate and execute law enforcement notification:
      1. Determine jurisdiction (FBI, local law enforcement)
      2. Consult with legal on notification decision
      3. If notifying, prepare incident summary:
         - Timeline of events
         - Ransomware variant identification
         - Impact assessment
         - Evidence collected
         - Ransom demands
      4. Contact appropriate agencies:
         - FBI Internet Crime Complaint Center (IC3)
         - FBI local field office
         - CISA (Cybersecurity and Infrastructure Security Agency)
         - Local law enforcement
      5. Document all law enforcement communications
      6. Coordinate evidence sharing requirements

      Law enforcement may have decryption keys or intelligence.
    `,
    requiresApproval: true,
    approvers: ['ciso', 'legal', 'executive-team'],
    onFailure: 'continue',
    dependencies: ['rw-step-5b'],
  },

  // Phase 6: Recovery Strategy Decision
  {
    id: 'rw-step-6',
    name: 'Decide Recovery Strategy',
    type: StepType.MANUAL,
    description: `
      CRITICAL DECISION: Determine recovery approach:

      Option A - Restore from Backups (RECOMMENDED):
      - Viable backups exist and are verified
      - Acceptable data loss window
      - Estimated restoration time acceptable
      - Most secure and ethical option

      Option B - Use Decryption Tools:
      - Known ransomware variant with available decryptor
      - Check No More Ransom project
      - Verify decryptor legitimacy

      Option C - Negotiate/Pay Ransom (LAST RESORT):
      - No viable backups available
      - Critical data loss unacceptable
      - Business continuity at severe risk
      - REQUIRES: Legal approval, OFAC check, executive sign-off
      - NOTE: Payment does not guarantee recovery
      - NOTE: Paying may encourage future attacks

      Document decision rationale and all approvals obtained.
    `,
    requiresApproval: true,
    approvers: ['ciso', 'legal', 'cto', 'executive-team'],
    onFailure: 'halt',
    dependencies: ['rw-step-3b', 'rw-step-5b'],
  },

  // Phase 7: Eradication
  {
    id: 'rw-step-7',
    name: 'Revoke Compromised Credentials',
    type: StepType.AUTOMATED,
    description: 'Revoke all potentially compromised credentials. Ransomware attackers often have persistent access through stolen credentials.',
    actionId: 'revoke-credentials', // Uses the revoke-credentials action
    timeout: 180000, // 3 minutes
    requiresApproval: false, // Critical action - no delay
    onFailure: 'halt',
    retryAttempts: 2,
    dependencies: ['rw-step-6'],
    metadata: {
      revokeType: 'ransomware_compromise',
      forcePasswordReset: true,
      revokeAllSessions: true,
      includeServiceAccounts: true,
    },
  },
  {
    id: 'rw-step-7b',
    name: 'Remove Ransomware',
    type: StepType.MANUAL,
    description: `
      Completely remove ransomware from all systems:
      1. Terminate all ransomware processes
      2. Remove ransomware executables and scripts
      3. Clean registry entries and scheduled tasks
      4. Remove persistence mechanisms:
         - Startup entries
         - Services
         - Group Policy modifications
         - WMI subscriptions
      5. Remove any backdoors installed by attackers
      6. Delete attacker tools and utilities
      7. Clean any dropped payloads or additional malware
      8. Remove any legitimate tools misused (PsExec, etc.)

      Document all removal actions for audit.
    `,
    requiresApproval: true,
    approvers: ['security-lead'],
    onFailure: 'halt',
    dependencies: ['rw-step-6'],
  },
  {
    id: 'rw-step-7c',
    name: 'Patch Vulnerabilities',
    type: StepType.MANUAL,
    description: `
      Address vulnerabilities used in the attack:
      1. Identify and patch the initial infection vector:
         - RDP vulnerabilities
         - VPN vulnerabilities
         - Email gateway issues
         - Software vulnerabilities
      2. Apply all critical security patches
      3. Disable unnecessary services (especially RDP)
      4. Implement network segmentation improvements
      5. Update endpoint protection signatures
      6. Strengthen access controls
      7. Enable MFA where missing
      8. Review and harden Group Policy settings

      Systems must be patched before reconnection.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-7b'],
  },

  // Phase 8: Recovery
  {
    id: 'rw-step-8',
    name: 'Restore from Clean Backups',
    type: StepType.MANUAL,
    description: `
      Execute system restoration from verified backups:
      1. Verify backup integrity before restoration
      2. Restore systems in priority order:
         - Critical business systems first
         - Domain controllers
         - Database servers
         - Application servers
         - User workstations
      3. Restore to clean, patched base images
      4. Apply all security patches before network connection
      5. Restore user data from verified backups
      6. Verify restored data integrity
      7. Test application functionality
      8. Document all restoration activities

      Keep systems isolated during restoration.
    `,
    requiresApproval: true,
    approvers: ['incident-commander', 'operations-lead'],
    onFailure: 'halt',
    dependencies: ['rw-step-7c'],
  },
  {
    id: 'rw-step-8b',
    name: 'Verify Clean System State',
    type: StepType.MANUAL,
    description: `
      Verify systems are clean before network reconnection:
      1. Run comprehensive malware scans
      2. Verify no ransomware artifacts remain
      3. Check for backdoors and persistence mechanisms
      4. Confirm all security patches are applied
      5. Verify endpoint protection is functional
      6. Test system functionality
      7. Monitor for 24-48 hours in isolation
      8. Document verification results

      Systems must pass all checks before reconnection.
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['rw-step-8'],
  },
  {
    id: 'rw-step-8c',
    name: 'Restore Network Connectivity',
    type: StepType.MANUAL,
    description: `
      Gradually restore network connectivity:
      1. Coordinate with automation rollback for isolation
      2. Restore network in phases (most critical first)
      3. Monitor network traffic closely for anomalies
      4. Verify security controls are operational
      5. Restore external connectivity last
      6. Maintain enhanced monitoring for 30+ days
      7. Confirm business operations restored
      8. Document full restoration

      This step triggers rollback of isolation measures.
    `,
    requiresApproval: true,
    approvers: ['incident-commander', 'security-lead', 'ciso'],
    onFailure: 'halt',
    dependencies: ['rw-step-8b'],
  },

  // Phase 9: Post-Incident
  {
    id: 'rw-step-9',
    name: 'Complete Regulatory Notifications',
    type: StepType.MANUAL,
    description: `
      Complete all required regulatory notifications:
      1. Submit GDPR breach notification (if applicable)
      2. Complete state breach notification requirements
      3. Notify affected customers/users
      4. File insurance claims
      5. Complete SEC disclosure (if public company)
      6. Document all notifications with timestamps
      7. Respond to regulatory inquiries
      8. Update legal on notification status
    `,
    requiresApproval: true,
    approvers: ['legal', 'dpo'],
    onFailure: 'continue',
    dependencies: ['rw-step-8c'],
  },
  {
    id: 'rw-step-9b',
    name: 'Post-Incident Review',
    type: StepType.MANUAL,
    description: `
      Conduct comprehensive post-incident review:
      1. Schedule post-mortem with all responders
      2. Document complete incident timeline
      3. Analyze root cause and infection vector
      4. Evaluate response effectiveness:
         - Detection time
         - Isolation speed
         - Recovery time
         - Decision making
      5. Identify security gaps that enabled attack
      6. Document lessons learned
      7. Calculate total incident cost
      8. Create final incident report for executives
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-8c'],
  },
  {
    id: 'rw-step-9c',
    name: 'Improve Backup Procedures',
    type: StepType.MANUAL,
    description: `
      Enhance backup procedures based on lessons learned:
      1. Implement 3-2-1 backup rule:
         - 3 copies of data
         - 2 different storage media
         - 1 offsite/offline copy
      2. Enable immutable/air-gapped backups
      3. Increase backup frequency if needed
      4. Implement backup integrity testing schedule
      5. Ensure backup systems are isolated from network
      6. Test restoration procedures regularly
      7. Document updated backup procedures
      8. Train staff on backup verification
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-9b'],
  },
  {
    id: 'rw-step-9d',
    name: 'Update Security Defenses',
    type: StepType.MANUAL,
    description: `
      Implement security improvements:
      1. Deploy additional ransomware detection:
         - File integrity monitoring
         - Canary files
         - Behavioral detection
      2. Implement network segmentation
      3. Enhance email filtering
      4. Restrict PowerShell and scripting
      5. Implement application whitelisting
      6. Enable MFA for all access
      7. Restrict RDP and remote access
      8. Update security awareness training
      9. Conduct tabletop exercises
      10. Update this playbook with improvements
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['rw-step-9b'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.RANSOMWARE,
  },
];

const notifications: NotificationConfig[] = [
  // CRITICAL: Immediate notifications for ransomware
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'security-oncall',
    enabled: true,
    retryAttempts: 5,
    retryDelayMs: 3000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'incident-commanders',
    enabled: true,
    retryAttempts: 5,
    retryDelayMs: 3000,
  },
  {
    channel: NotificationChannel.SLACK,
    target: '#security-incidents',
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.SLACK,
    target: '#executive-alerts',
    severityFilter: [IncidentSeverity.P1],
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
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.EMAIL,
    target: 'executives@company.com',
    severityFilter: [IncidentSeverity.P1, IncidentSeverity.P2],
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.SMS,
    target: 'ciso-phone',
    severityFilter: [IncidentSeverity.P1],
    enabled: true,
    retryAttempts: 5,
    retryDelayMs: 2000,
  },
];

const escalation: EscalationConfig = {
  enabled: true,
  levels: [
    {
      level: 1,
      afterMinutes: 5, // Aggressive escalation for ransomware
      targets: ['security-team', 'incident-commanders'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.SLACK, NotificationChannel.SMS],
      message: 'RANSOMWARE ALERT: Incident not acknowledged within 5 minutes - immediate response required',
    },
    {
      level: 2,
      afterMinutes: 15,
      targets: ['ciso', 'cto', 'security-lead'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'RANSOMWARE CRITICAL: Executive attention required - active ransomware incident',
    },
    {
      level: 3,
      afterMinutes: 30,
      targets: ['ceo', 'coo', 'board-liaison'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'RANSOMWARE EMERGENCY: Board-level escalation - major ransomware attack in progress',
    },
  ],
  maxLevel: 3,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const ransomwarePlaybook: PlaybookInput = {
  id: 'playbook-ransomware-v1',
  name: 'Ransomware Incident Response',
  description: `
    Critical playbook for responding to ransomware incidents.
    IMMEDIATE isolation without approval delay to prevent encryption spread.
    Covers emergency containment, variant identification, impact assessment,
    backup verification, legal consultation, recovery strategy decision,
    eradication, restoration, and post-incident security improvements.
    Compliant with regulatory notification requirements.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: ransomwareSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['ransomware', 'critical', 'emergency', 'backup', 'legal', 'law-enforcement'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default ransomwarePlaybook;
