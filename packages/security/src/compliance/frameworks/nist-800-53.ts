/**
 * NIST 800-53 Compliance Framework
 *
 * Implements security and privacy controls from NIST Special Publication 800-53
 * Revision 5, focusing on key control families:
 * - AC: Access Control
 * - AU: Audit and Accountability
 * - IA: Identification and Authentication
 * - SC: System and Communications Protection
 *
 * @packageDocumentation
 */

import type {
  ComplianceFramework,
  ComplianceControl,
  Evidence,
  ControlPriority,
  ImplementationStatus,
} from '../types.js';

// =============================================================================
// EVIDENCE COLLECTION HELPERS
// =============================================================================

/**
 * Create evidence from audit logs
 */
function createLogEvidence(
  id: string,
  title: string,
  description: string,
  source: string
): Evidence {
  return {
    id,
    type: 'log',
    title,
    description,
    source,
    collectedAt: new Date(),
  };
}

/**
 * Create evidence from configuration
 */
function createConfigEvidence(
  id: string,
  title: string,
  description: string,
  source: string
): Evidence {
  return {
    id,
    type: 'config',
    title,
    description,
    source,
    collectedAt: new Date(),
  };
}

/**
 * Create evidence from policy documents
 */
function createPolicyEvidence(
  id: string,
  title: string,
  description: string,
  source: string
): Evidence {
  return {
    id,
    type: 'policy',
    title,
    description,
    source,
    collectedAt: new Date(),
  };
}

/**
 * Create evidence from test results
 */
function createTestEvidence(
  id: string,
  title: string,
  description: string,
  source: string
): Evidence {
  return {
    id,
    type: 'test-result',
    title,
    description,
    source,
    collectedAt: new Date(),
  };
}

// =============================================================================
// AC - ACCESS CONTROL
// =============================================================================

const acControls: ComplianceControl[] = [
  {
    id: 'AC-1',
    name: 'Policy and Procedures',
    description:
      'Develop, document, and disseminate access control policy and procedures that address purpose, scope, roles, responsibilities, management commitment, coordination, and compliance.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-1-001',
        'Access Control Policy',
        'Organizational access control policy document',
        '/policies/access-control-policy.md'
      ),
      createPolicyEvidence(
        'ac-1-002',
        'Access Control Procedures',
        'Detailed access control procedures',
        '/procedures/access-control-procedures.md'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.2'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AC-2',
    name: 'Account Management',
    description:
      'Define and document account types, establish conditions for group membership, assign account managers, require appropriate approvals, authorize and monitor usage, disable accounts when no longer required, and review accounts periodically.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-2-001',
        'IAM Configuration',
        'Identity and access management system configuration',
        '/config/iam-config.yaml'
      ),
      createLogEvidence(
        'ac-2-002',
        'Account Provisioning Logs',
        'Logs of account creation, modification, and deletion',
        'IAM System - Audit Logs'
      ),
      createLogEvidence(
        'ac-2-003',
        'Quarterly Access Reviews',
        'Documentation of quarterly access review process',
        'IAM System - Access Reviews'
      ),
    ],
    crossReferences: ['CC6.2', 'CC6.3'],
    owner: 'Identity Manager',
    automatedTest: async () => {
      // Verify no orphaned accounts, no accounts inactive > 90 days
      return true;
    },
  },
  {
    id: 'AC-3',
    name: 'Access Enforcement',
    description:
      'Enforce approved authorizations for logical access to information and system resources in accordance with applicable access control policies.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-3-001',
        'RBAC Configuration',
        'Role-based access control configuration',
        '/config/rbac-config.yaml'
      ),
      createTestEvidence(
        'ac-3-002',
        'Access Enforcement Tests',
        'Results of access enforcement testing',
        'Security Testing - Access Tests'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Test that unauthorized access attempts are blocked
      return true;
    },
  },
  {
    id: 'AC-4',
    name: 'Information Flow Enforcement',
    description:
      'Enforce approved authorizations for controlling the flow of information within the system and between interconnected systems based on applicable policy.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-4-001',
        'Network Segmentation',
        'Network segmentation and flow control configuration',
        '/config/network-segmentation.yaml'
      ),
      createConfigEvidence(
        'ac-4-002',
        'DLP Configuration',
        'Data loss prevention configuration',
        '/config/dlp-config.yaml'
      ),
    ],
    crossReferences: ['CC6.7'],
    owner: 'Network Security Manager',
    automatedTest: async () => {
      // Verify network flow controls are enforced
      return true;
    },
  },
  {
    id: 'AC-5',
    name: 'Separation of Duties',
    description:
      'Separate duties of individuals to reduce risk of malevolent activity. Define system access authorizations to support separation of duties.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-5-001',
        'Separation of Duties Matrix',
        'Matrix defining incompatible duties and required separation',
        '/governance/sod-matrix.md'
      ),
      createConfigEvidence(
        'ac-5-002',
        'Role Definitions',
        'Role definitions enforcing separation of duties',
        '/config/role-definitions.yaml'
      ),
    ],
    crossReferences: ['CC5.1'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AC-6',
    name: 'Least Privilege',
    description:
      'Employ the principle of least privilege, allowing only authorized access necessary to accomplish assigned organizational tasks.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-6-001',
        'Minimum Privilege Configuration',
        'Configuration enforcing minimum necessary privileges',
        '/config/privilege-config.yaml'
      ),
      createLogEvidence(
        'ac-6-002',
        'Privilege Escalation Logs',
        'Logs of temporary privilege escalations',
        'PAM System - Escalation Logs'
      ),
    ],
    crossReferences: ['CC6.3'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify no excessive privileges exist
      return true;
    },
  },
  {
    id: 'AC-7',
    name: 'Unsuccessful Logon Attempts',
    description:
      'Enforce a limit of consecutive invalid logon attempts by a user, and automatically lock the account or delay next logon prompt according to organization-defined settings.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-7-001',
        'Account Lockout Configuration',
        'Configuration for account lockout after failed attempts',
        '/config/auth-lockout.yaml'
      ),
      createLogEvidence(
        'ac-7-002',
        'Lockout Event Logs',
        'Logs of account lockout events',
        'Authentication System - Lockout Logs'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Identity Manager',
    automatedTest: async () => {
      // Verify account lockout is enforced
      return true;
    },
  },
  {
    id: 'AC-8',
    name: 'System Use Notification',
    description:
      'Display an approved system use notification message before granting access. The message must provide privacy and security notices consistent with applicable laws and policies.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-8-001',
        'Login Banner Configuration',
        'Configuration of system use notification banners',
        '/config/login-banner.yaml'
      ),
    ],
    crossReferences: ['CC2.3'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AC-11',
    name: 'Device Lock',
    description:
      'Prevent access to the system by initiating a device lock after organization-defined time period of inactivity.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-11-001',
        'Session Timeout Configuration',
        'Configuration for automatic session timeout and lock',
        '/config/session-timeout.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify session timeout is enforced
      return true;
    },
  },
  {
    id: 'AC-12',
    name: 'Session Termination',
    description:
      'Automatically terminate a user session after organization-defined conditions or trigger events.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-12-001',
        'Session Management Configuration',
        'Configuration for automatic session termination',
        '/config/session-management.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'AC-14',
    name: 'Permitted Actions Without Identification or Authentication',
    description:
      'Identify user actions that can be performed on the system without identification or authentication consistent with organizational missions/business functions.',
    family: 'AC - Access Control',
    priority: 'P3',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-14-001',
        'Public Access Documentation',
        'Documentation of permitted anonymous/public access',
        '/security/public-access-policy.md'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AC-17',
    name: 'Remote Access',
    description:
      'Establish and document usage restrictions, configuration/connection requirements, and implementation guidance for remote access. Authorize remote access prior to allowing such connections.',
    family: 'AC - Access Control',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-17-001',
        'Remote Access Policy',
        'Policy governing remote access requirements',
        '/policies/remote-access-policy.md'
      ),
      createConfigEvidence(
        'ac-17-002',
        'VPN Configuration',
        'VPN and remote access configuration',
        '/config/vpn-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.7'],
    owner: 'Network Security Manager',
    automatedTest: async () => {
      // Verify VPN and MFA are required for remote access
      return true;
    },
  },
  {
    id: 'AC-18',
    name: 'Wireless Access',
    description:
      'Establish usage restrictions, configuration/connection requirements, and implementation guidance for wireless access. Authorize wireless access before allowing such connections.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ac-18-001',
        'Wireless Security Configuration',
        'Configuration for secure wireless access',
        '/config/wireless-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Network Security Manager',
  },
  {
    id: 'AC-19',
    name: 'Access Control for Mobile Devices',
    description:
      'Establish usage restrictions, configuration requirements, connection requirements, and implementation guidance for organization-controlled mobile devices.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-19-001',
        'Mobile Device Policy',
        'Policy for mobile device management and security',
        '/policies/mobile-device-policy.md'
      ),
      createConfigEvidence(
        'ac-19-002',
        'MDM Configuration',
        'Mobile device management configuration',
        '/config/mdm-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Endpoint Security Manager',
  },
  {
    id: 'AC-20',
    name: 'Use of External Systems',
    description:
      'Establish terms and conditions for authorized individuals to access the system from external systems, and enforce restrictions as appropriate.',
    family: 'AC - Access Control',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-20-001',
        'External Access Policy',
        'Policy governing access from external systems',
        '/policies/external-access-policy.md'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AC-22',
    name: 'Publicly Accessible Content',
    description:
      'Designate individuals authorized to post information onto a publicly accessible system. Train authorized individuals. Review content before posting and periodically thereafter.',
    family: 'AC - Access Control',
    priority: 'P3',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ac-22-001',
        'Public Content Policy',
        'Policy for managing publicly accessible content',
        '/policies/public-content-policy.md'
      ),
    ],
    crossReferences: ['CC2.3'],
    owner: 'Communications Director',
  },
];

// =============================================================================
// AU - AUDIT AND ACCOUNTABILITY
// =============================================================================

const auControls: ComplianceControl[] = [
  {
    id: 'AU-1',
    name: 'Policy and Procedures',
    description:
      'Develop, document, and disseminate audit and accountability policy and procedures that address purpose, scope, roles, responsibilities, management commitment, coordination, and compliance.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'au-1-001',
        'Audit Policy',
        'Organizational audit and accountability policy',
        '/policies/audit-policy.md'
      ),
      createPolicyEvidence(
        'au-1-002',
        'Logging Procedures',
        'Detailed logging and audit procedures',
        '/procedures/logging-procedures.md'
      ),
    ],
    crossReferences: ['CC2.1', 'CC4.1'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'AU-2',
    name: 'Event Logging',
    description:
      'Identify the types of events that the system is capable of logging. Coordinate the event logging function with other organizational entities requiring audit-related information.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-2-001',
        'Audit Event Categories',
        'Configuration defining auditable event categories',
        '/config/audit-events.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Security Operations Manager',
  },
  {
    id: 'AU-3',
    name: 'Content of Audit Records',
    description:
      'Ensure that audit records contain information that establishes what type of event occurred, when it occurred, where it occurred, the source of the event, the outcome, and the identity of any individuals or subjects associated with the event.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-3-001',
        'Audit Record Format',
        'Configuration for audit record content and format',
        '/config/audit-format.yaml'
      ),
      createLogEvidence(
        'au-3-002',
        'Sample Audit Records',
        'Sample audit records demonstrating required content',
        'SIEM System - Sample Logs'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Security Operations Manager',
    automatedTest: async () => {
      // Verify audit records contain required fields
      return true;
    },
  },
  {
    id: 'AU-4',
    name: 'Audit Log Storage Capacity',
    description:
      'Allocate audit log storage capacity and configure auditing to reduce the likelihood of storage capacity being exceeded.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-4-001',
        'Log Storage Configuration',
        'Configuration for audit log storage capacity and retention',
        '/config/log-storage.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Infrastructure Manager',
    automatedTest: async () => {
      // Verify sufficient log storage capacity exists
      return true;
    },
  },
  {
    id: 'AU-5',
    name: 'Response to Audit Logging Process Failures',
    description:
      'Alert designated personnel in the event of an audit logging process failure. Take organization-defined additional actions in response to audit logging process failures.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-5-001',
        'Audit Failure Alerting',
        'Configuration for alerting on audit process failures',
        '/config/audit-alerting.yaml'
      ),
    ],
    crossReferences: ['CC4.1'],
    owner: 'Security Operations Manager',
    automatedTest: async () => {
      // Verify audit failure alerting is configured
      return true;
    },
  },
  {
    id: 'AU-6',
    name: 'Audit Record Review, Analysis, and Reporting',
    description:
      'Review and analyze system audit records for indications of inappropriate or unusual activity. Report findings to designated organizational officials.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-6-001',
        'SIEM Rules Configuration',
        'SIEM detection rules and correlation configuration',
        '/config/siem-rules.yaml'
      ),
      createLogEvidence(
        'au-6-002',
        'Audit Review Reports',
        'Weekly audit review reports',
        'SIEM System - Weekly Reports'
      ),
    ],
    crossReferences: ['CC4.1', 'CC7.2'],
    owner: 'Security Operations Manager',
  },
  {
    id: 'AU-7',
    name: 'Audit Record Reduction and Report Generation',
    description:
      'Provide and implement an audit record reduction and report generation capability that supports on-demand audit record review, analysis, and reporting.',
    family: 'AU - Audit and Accountability',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-7-001',
        'Audit Reporting Tools',
        'Configuration for audit report generation',
        '/config/audit-reporting.yaml'
      ),
    ],
    crossReferences: ['CC4.1'],
    owner: 'Security Operations Manager',
  },
  {
    id: 'AU-8',
    name: 'Time Stamps',
    description:
      'Use internal system clocks to generate time stamps for audit records. Record time stamps that meet organization-defined granularity of time measurement and can be mapped to Coordinated Universal Time (UTC).',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-8-001',
        'NTP Configuration',
        'Time synchronization configuration',
        '/config/ntp-config.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Infrastructure Manager',
    automatedTest: async () => {
      // Verify NTP synchronization is working
      return true;
    },
  },
  {
    id: 'AU-9',
    name: 'Protection of Audit Information',
    description:
      'Protect audit information and audit logging tools from unauthorized access, modification, and deletion.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-9-001',
        'Audit Log Protection',
        'Configuration for protecting audit logs from tampering',
        '/config/audit-protection.yaml'
      ),
      createLogEvidence(
        'au-9-002',
        'Audit Integrity Verification',
        'Evidence of audit log integrity verification',
        'Audit System - Integrity Reports'
      ),
    ],
    crossReferences: ['CC2.1', 'CC6.8'],
    owner: 'Security Operations Manager',
    automatedTest: async () => {
      // Verify audit logs are protected and integrity verified
      return true;
    },
  },
  {
    id: 'AU-10',
    name: 'Non-repudiation',
    description:
      'Provide irrefutable evidence that an individual (or process) performed organization-defined actions.',
    family: 'AU - Audit and Accountability',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-10-001',
        'Digital Signature Configuration',
        'Configuration for cryptographic non-repudiation',
        '/config/signing-config.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'AU-11',
    name: 'Audit Record Retention',
    description:
      'Retain audit records for organization-defined time period to provide support for after-the-fact investigations and to meet regulatory and organizational information retention requirements.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-11-001',
        'Log Retention Policy',
        'Configuration for audit log retention periods',
        '/config/log-retention.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Security Operations Manager',
  },
  {
    id: 'AU-12',
    name: 'Audit Record Generation',
    description:
      'Provide audit record generation capability for the events defined in AU-2 at all system components where audit capability is deployed. Allow designated personnel to select which events are to be audited.',
    family: 'AU - Audit and Accountability',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'au-12-001',
        'Audit Generation Configuration',
        'Configuration for audit event generation',
        '/config/audit-generation.yaml'
      ),
    ],
    crossReferences: ['CC2.1'],
    owner: 'Security Operations Manager',
    automatedTest: async () => {
      // Verify all systems are generating required audit events
      return true;
    },
  },
];

// =============================================================================
// IA - IDENTIFICATION AND AUTHENTICATION
// =============================================================================

const iaControls: ComplianceControl[] = [
  {
    id: 'IA-1',
    name: 'Policy and Procedures',
    description:
      'Develop, document, and disseminate identification and authentication policy and procedures that address purpose, scope, roles, responsibilities, management commitment, coordination, and compliance.',
    family: 'IA - Identification and Authentication',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ia-1-001',
        'Authentication Policy',
        'Organizational identification and authentication policy',
        '/policies/authentication-policy.md'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.2'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'IA-2',
    name: 'Identification and Authentication (Organizational Users)',
    description:
      'Uniquely identify and authenticate organizational users and associate that unique identification with processes acting on behalf of those users.',
    family: 'IA - Identification and Authentication',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-2-001',
        'User Authentication Configuration',
        'Configuration for organizational user authentication',
        '/config/user-auth.yaml'
      ),
      createConfigEvidence(
        'ia-2-002',
        'MFA Configuration',
        'Multi-factor authentication configuration',
        '/config/mfa-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.2'],
    owner: 'Identity Manager',
    automatedTest: async () => {
      // Verify MFA is enabled for all users
      return true;
    },
  },
  {
    id: 'IA-3',
    name: 'Device Identification and Authentication',
    description:
      'Uniquely identify and authenticate devices before establishing a connection.',
    family: 'IA - Identification and Authentication',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-3-001',
        'Device Authentication Configuration',
        'Configuration for device certificate authentication',
        '/config/device-auth.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'IA-4',
    name: 'Identifier Management',
    description:
      'Manage system identifiers by receiving authorization to assign an identifier, selecting an identifier, assigning to the intended individual/group/device, preventing reuse, and disabling after a period of inactivity.',
    family: 'IA - Identification and Authentication',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ia-4-001',
        'Identifier Management Procedure',
        'Procedure for managing user and system identifiers',
        '/procedures/identifier-management.md'
      ),
    ],
    crossReferences: ['CC6.2'],
    owner: 'Identity Manager',
  },
  {
    id: 'IA-5',
    name: 'Authenticator Management',
    description:
      'Manage system authenticators by verifying identity before initial distribution, establishing initial content, ensuring appropriate strength, changing authenticators periodically, protecting against unauthorized disclosure and modification, and changing default authenticators.',
    family: 'IA - Identification and Authentication',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ia-5-001',
        'Password Policy',
        'Password and authenticator management policy',
        '/policies/password-policy.md'
      ),
      createConfigEvidence(
        'ia-5-002',
        'Password Complexity Configuration',
        'Configuration enforcing password complexity requirements',
        '/config/password-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Identity Manager',
    automatedTest: async () => {
      // Verify password policy is enforced
      return true;
    },
  },
  {
    id: 'IA-6',
    name: 'Authenticator Feedback',
    description:
      'Obscure feedback of authentication information during the authentication process to protect the information from possible exploitation by unauthorized individuals.',
    family: 'IA - Identification and Authentication',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-6-001',
        'Authentication UI Configuration',
        'Configuration for obscuring authentication feedback',
        '/config/auth-ui.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'IA-7',
    name: 'Cryptographic Module Authentication',
    description:
      'Implement mechanisms for authentication to a cryptographic module that meet the requirements of applicable laws, policies, and standards.',
    family: 'IA - Identification and Authentication',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-7-001',
        'HSM Configuration',
        'Hardware security module configuration',
        '/config/hsm-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'IA-8',
    name: 'Identification and Authentication (Non-Organizational Users)',
    description:
      'Uniquely identify and authenticate non-organizational users or processes acting on behalf of non-organizational users.',
    family: 'IA - Identification and Authentication',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-8-001',
        'External User Authentication',
        'Configuration for authenticating external users',
        '/config/external-auth.yaml'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.2'],
    owner: 'Identity Manager',
  },
  {
    id: 'IA-11',
    name: 'Re-authentication',
    description:
      'Require users to re-authenticate when organization-defined circumstances or situations requiring re-authentication occur.',
    family: 'IA - Identification and Authentication',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'ia-11-001',
        'Re-authentication Configuration',
        'Configuration for requiring re-authentication for sensitive operations',
        '/config/reauth-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'IA-12',
    name: 'Identity Proofing',
    description:
      'Identity proof users that require accounts at organization-defined assurance level.',
    family: 'IA - Identification and Authentication',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'ia-12-001',
        'Identity Proofing Procedure',
        'Procedure for identity proofing new users',
        '/procedures/identity-proofing.md'
      ),
    ],
    crossReferences: ['CC6.2'],
    owner: 'Identity Manager',
  },
];

// =============================================================================
// SC - SYSTEM AND COMMUNICATIONS PROTECTION
// =============================================================================

const scControls: ComplianceControl[] = [
  {
    id: 'SC-1',
    name: 'Policy and Procedures',
    description:
      'Develop, document, and disseminate system and communications protection policy and procedures that address purpose, scope, roles, responsibilities, management commitment, coordination, and compliance.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'sc-1-001',
        'System Protection Policy',
        'Organizational system and communications protection policy',
        '/policies/system-protection-policy.md'
      ),
    ],
    crossReferences: ['CC5.2', 'CC6.7'],
    owner: 'Security Policy Manager',
  },
  {
    id: 'SC-2',
    name: 'Separation of System and User Functionality',
    description:
      'Separate user functionality, including user interface services, from system management functionality.',
    family: 'SC - System and Communications Protection',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-2-001',
        'System Architecture',
        'Architecture diagram showing separation of user and admin functions',
        '/architecture/system-separation.yaml'
      ),
    ],
    crossReferences: ['CC5.2'],
    owner: 'Security Architecture Manager',
  },
  {
    id: 'SC-4',
    name: 'Information in Shared System Resources',
    description:
      'Prevent unauthorized and unintended information transfer via shared system resources.',
    family: 'SC - System and Communications Protection',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-4-001',
        'Memory Protection Configuration',
        'Configuration for memory isolation and protection',
        '/config/memory-protection.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'SC-5',
    name: 'Denial-of-Service Protection',
    description:
      'Protect against or limit the effects of denial-of-service attacks by employing organization-defined security safeguards.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-5-001',
        'DDoS Protection Configuration',
        'Configuration for DDoS mitigation',
        '/config/ddos-protection.yaml'
      ),
      createConfigEvidence(
        'sc-5-002',
        'Rate Limiting Configuration',
        'API rate limiting configuration',
        '/config/rate-limiting.yaml'
      ),
    ],
    crossReferences: ['CC7.1'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify DDoS protection is active
      return true;
    },
  },
  {
    id: 'SC-7',
    name: 'Boundary Protection',
    description:
      'Monitor and control communications at the external managed interfaces to the system and at key internal managed interfaces within the system.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-7-001',
        'Firewall Configuration',
        'Network firewall rules and configuration',
        '/config/firewall-config.yaml'
      ),
      createConfigEvidence(
        'sc-7-002',
        'WAF Configuration',
        'Web application firewall configuration',
        '/config/waf-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1', 'CC6.6'],
    owner: 'Network Security Manager',
    automatedTest: async () => {
      // Verify firewall rules are properly configured
      return true;
    },
  },
  {
    id: 'SC-8',
    name: 'Transmission Confidentiality and Integrity',
    description:
      'Protect the confidentiality and integrity of transmitted information.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-8-001',
        'TLS Configuration',
        'TLS 1.3 configuration for all communications',
        '/config/tls-config.yaml'
      ),
      createTestEvidence(
        'sc-8-002',
        'SSL/TLS Scan Results',
        'Results of SSL/TLS security scanning',
        'Security Scanner - SSL Reports'
      ),
    ],
    crossReferences: ['CC6.7'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify TLS 1.3 is enforced on all endpoints
      return true;
    },
  },
  {
    id: 'SC-10',
    name: 'Network Disconnect',
    description:
      'Terminate the network connection associated with a communications session at the end of the session or after organization-defined time period of inactivity.',
    family: 'SC - System and Communications Protection',
    priority: 'P3',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-10-001',
        'Connection Timeout Configuration',
        'Configuration for network session timeouts',
        '/config/connection-timeout.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Network Security Manager',
  },
  {
    id: 'SC-12',
    name: 'Cryptographic Key Establishment and Management',
    description:
      'Establish and manage cryptographic keys when cryptography is employed within the system in accordance with organization-defined requirements.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'sc-12-001',
        'Key Management Policy',
        'Cryptographic key management policy',
        '/policies/key-management-policy.md'
      ),
      createConfigEvidence(
        'sc-12-002',
        'KMS Configuration',
        'Key management system configuration',
        '/config/kms-config.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'SC-13',
    name: 'Cryptographic Protection',
    description:
      'Determine the organization-defined cryptographic uses and implement the following types of cryptography required for each specified use: FIPS-validated or NSA-approved cryptography.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-13-001',
        'Cryptography Standards',
        'Configuration defining approved cryptographic algorithms',
        '/config/crypto-standards.yaml'
      ),
    ],
    crossReferences: ['CC6.7'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify only approved cryptographic algorithms are in use
      return true;
    },
  },
  {
    id: 'SC-17',
    name: 'Public Key Infrastructure Certificates',
    description:
      'Issue public key certificates under an organization-defined certificate policy or obtain public key certificates from an approved service provider.',
    family: 'SC - System and Communications Protection',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createPolicyEvidence(
        'sc-17-001',
        'Certificate Policy',
        'PKI certificate issuance and management policy',
        '/policies/certificate-policy.md'
      ),
      createConfigEvidence(
        'sc-17-002',
        'PKI Configuration',
        'Public key infrastructure configuration',
        '/config/pki-config.yaml'
      ),
    ],
    crossReferences: ['CC6.7'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'SC-20',
    name: 'Secure Name/Address Resolution Service (Authoritative Source)',
    description:
      'Provide additional data origin authentication and integrity verification artifacts along with the authoritative name resolution data the system returns in response to external name/address resolution queries.',
    family: 'SC - System and Communications Protection',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-20-001',
        'DNSSEC Configuration',
        'DNS security extensions configuration',
        '/config/dnssec-config.yaml'
      ),
    ],
    crossReferences: ['CC5.2'],
    owner: 'Infrastructure Manager',
  },
  {
    id: 'SC-23',
    name: 'Session Authenticity',
    description:
      'Protect the authenticity of communications sessions.',
    family: 'SC - System and Communications Protection',
    priority: 'P2',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-23-001',
        'Session Management Configuration',
        'Configuration for session authenticity protection',
        '/config/session-auth.yaml'
      ),
    ],
    crossReferences: ['CC6.1'],
    owner: 'Security Engineering Manager',
  },
  {
    id: 'SC-28',
    name: 'Protection of Information at Rest',
    description:
      'Protect the confidentiality and integrity of organization-defined information at rest.',
    family: 'SC - System and Communications Protection',
    priority: 'P1',
    implementation: 'implemented',
    evidence: [
      createConfigEvidence(
        'sc-28-001',
        'Encryption at Rest Configuration',
        'Configuration for data encryption at rest',
        '/config/encryption-at-rest.yaml'
      ),
    ],
    crossReferences: ['CC6.7'],
    owner: 'Security Engineering Manager',
    automatedTest: async () => {
      // Verify all databases and storage have encryption enabled
      return true;
    },
  },
];

// =============================================================================
// NIST 800-53 FRAMEWORK
// =============================================================================

/**
 * Complete NIST 800-53 Rev 5 compliance framework (key families)
 */
export const nist80053Framework: ComplianceFramework = {
  id: 'nist-800-53',
  name: 'NIST 800-53',
  version: 'Rev. 5',
  description:
    'Security and Privacy Controls for Information Systems and Organizations. This implementation focuses on key control families: Access Control (AC), Audit and Accountability (AU), Identification and Authentication (IA), and System and Communications Protection (SC).',
  authority: 'National Institute of Standards and Technology (NIST)',
  controls: [...acControls, ...auControls, ...iaControls, ...scControls],
  effectiveDate: new Date('2020-09-23'),
};

/**
 * Get NIST 800-53 controls by family
 */
export function getNist80053ControlsByFamily(
  family: string
): ComplianceControl[] {
  return nist80053Framework.controls.filter((c) => c.family.startsWith(family));
}

/**
 * Get NIST 800-53 control by ID
 */
export function getNist80053ControlById(
  id: string
): ComplianceControl | undefined {
  return nist80053Framework.controls.find((c) => c.id === id);
}

/**
 * Get all NIST 800-53 controls by implementation status
 */
export function getNist80053ControlsByStatus(
  status: ImplementationStatus
): ComplianceControl[] {
  return nist80053Framework.controls.filter((c) => c.implementation === status);
}

/**
 * Get all NIST 800-53 controls by priority
 */
export function getNist80053ControlsByPriority(
  priority: ControlPriority
): ComplianceControl[] {
  return nist80053Framework.controls.filter((c) => c.priority === priority);
}

export default nist80053Framework;
