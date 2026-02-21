/**
 * Denial of Service Response Playbook
 *
 * Comprehensive playbook for responding to denial of service (DoS/DDoS) incidents.
 * Covers detection, mitigation, traffic analysis, scaling, and recovery.
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
 * Denial of service response steps using automated actions
 *
 * Steps are designed to:
 * - Quickly verify and assess the attack
 * - Implement immediate mitigation measures
 * - Analyze traffic patterns and attack sources
 * - Scale infrastructure to absorb attack traffic
 * - Communicate with stakeholders throughout
 * - Restore normal operations once attack subsides
 * - Document lessons learned for future defense improvements
 */
const denialOfServiceSteps: PlaybookStepInput[] = [
  // Phase 1: Detection and Verification
  {
    id: 'dos-step-1',
    name: 'Verify DoS Attack Indicators',
    type: StepType.MANUAL,
    description: `
      Verify the denial of service alert is legitimate:
      1. Review monitoring alerts (high latency, error rates, traffic spikes)
      2. Check system metrics (CPU, memory, network bandwidth, connection counts)
      3. Verify service degradation or unavailability
      4. Distinguish between DoS attack and legitimate traffic surge
      5. Identify affected services and endpoints
      6. Estimate attack volume and type (volumetric, protocol, application layer)
      7. Document initial findings

      Mark this step complete once verification is done.
    `,
    requiresApproval: false,
    onFailure: 'halt',
  },
  {
    id: 'dos-step-1b',
    name: 'Classify Attack Type',
    type: StepType.MANUAL,
    description: `
      Classify the type of DoS/DDoS attack:
      1. Volumetric attacks (UDP flood, ICMP flood, amplification)
      2. Protocol attacks (SYN flood, Ping of Death, fragmented packets)
      3. Application layer attacks (HTTP flood, Slowloris, DNS query flood)
      4. Determine if attack is distributed (DDoS) or single source (DoS)
      5. Identify attack vectors being used
      6. Document classification for mitigation strategy

      This helps determine the appropriate mitigation approach.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-1'],
  },

  // Phase 2: Immediate Mitigation (Automated)
  {
    id: 'dos-step-2',
    name: 'Enable Rate Limiting',
    type: StepType.AUTOMATED,
    description: 'Enable aggressive rate limiting at application and infrastructure levels to throttle malicious traffic and protect backend services.',
    actionId: 'enable-rate-limiting',
    timeout: 60000, // 1 minute
    requiresApproval: false, // Critical action - execute immediately
    onFailure: 'continue', // Continue with other mitigations if this fails
    retryAttempts: 2,
    dependencies: ['dos-step-1'],
    metadata: {
      rateLimit: 'aggressive',
      notifyOnComplete: true,
    },
  },
  {
    id: 'dos-step-2b',
    name: 'Block Attacking IPs',
    type: StepType.AUTOMATED,
    description: 'Block identified attacking IP addresses at firewall, WAF, and network edge levels.',
    actionId: 'block-ip', // Uses the block-ip action
    timeout: 120000, // 2 minutes
    requiresApproval: false,
    onFailure: 'continue', // Non-critical - continue if fails
    retryAttempts: 3,
    dependencies: ['dos-step-1'],
    metadata: {
      blockType: 'ddos-mitigation',
      blockDurationMinutes: 60,
      autoExtend: true,
    },
  },
  {
    id: 'dos-step-2c',
    name: 'Enable CDN Protection',
    type: StepType.AUTOMATED,
    description: 'Enable enhanced CDN protection mode including DDoS mitigation, bot protection, and geographic filtering.',
    actionId: 'enable-cdn-protection',
    timeout: 180000, // 3 minutes
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 2,
    dependencies: ['dos-step-1'],
    metadata: {
      protectionLevel: 'under-attack',
      enableBotProtection: true,
      enableGeoFiltering: true,
    },
  },
  {
    id: 'dos-step-2d',
    name: 'Enable Enhanced Monitoring',
    type: StepType.AUTOMATED,
    description: 'Activate enhanced monitoring for traffic analysis, attack pattern detection, and real-time alerting.',
    actionId: 'scale-monitoring', // Uses the scale-monitoring action
    timeout: 180000,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-1'],
    metadata: {
      monitoringLevel: 'high',
      enableTrafficAnalysis: true,
      enableAnomalyDetection: true,
    },
  },

  // Phase 3: Traffic Analysis (Manual)
  {
    id: 'dos-step-3',
    name: 'Analyze Attack Patterns',
    type: StepType.MANUAL,
    description: `
      Analyze attack traffic patterns:
      1. Review network traffic logs and flow data
      2. Identify attack signatures and patterns
      3. Analyze request characteristics (headers, payloads, timing)
      4. Identify common user agents, referers, or request patterns
      5. Look for botnet indicators
      6. Document attack patterns for mitigation tuning
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-2d'],
  },
  {
    id: 'dos-step-3b',
    name: 'Identify Attack Sources',
    type: StepType.MANUAL,
    description: `
      Identify and document attack sources:
      1. Compile list of attacking IP addresses
      2. Analyze geographic distribution of attack traffic
      3. Identify ASNs and hosting providers involved
      4. Check for compromised infrastructure (botnets)
      5. Cross-reference with threat intelligence feeds
      6. Prioritize IP blocks for blocking
      7. Document findings for potential reporting to ISPs/authorities
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-2d'],
  },
  {
    id: 'dos-step-3c',
    name: 'Tune Mitigation Rules',
    type: StepType.MANUAL,
    description: `
      Fine-tune mitigation based on analysis:
      1. Update WAF rules based on attack patterns
      2. Adjust rate limiting thresholds
      3. Add custom blocking rules for identified patterns
      4. Configure geographic blocking if applicable
      5. Update bot detection signatures
      6. Test rules to minimize legitimate user impact
    `,
    requiresApproval: true,
    approvers: ['security-lead', 'network-engineer'],
    onFailure: 'continue',
    dependencies: ['dos-step-3', 'dos-step-3b'],
  },

  // Phase 4: Infrastructure Scaling (Automated)
  {
    id: 'dos-step-4',
    name: 'Scale Infrastructure',
    type: StepType.AUTOMATED,
    description: 'Scale up infrastructure to absorb attack traffic including additional servers, load balancers, and network capacity.',
    actionId: 'scale-infrastructure',
    timeout: 300000, // 5 minutes
    requiresApproval: true, // Cost implications - requires approval
    approvers: ['incident-commander', 'operations-lead'],
    onFailure: 'continue',
    retryAttempts: 2,
    dependencies: ['dos-step-1'],
    metadata: {
      scaleFactor: 2,
      maxInstances: 100,
      scaleComponents: ['web', 'api', 'loadbalancer'],
    },
  },
  {
    id: 'dos-step-4b',
    name: 'Enable Auto-Scaling',
    type: StepType.AUTOMATED,
    description: 'Enable aggressive auto-scaling policies to dynamically respond to traffic changes.',
    actionId: 'enable-autoscaling',
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 2,
    dependencies: ['dos-step-4'],
    metadata: {
      scalingPolicy: 'aggressive',
      cooldownSeconds: 60,
      targetCpuPercent: 50,
    },
  },

  // Phase 5: Communication (Automated and Manual)
  {
    id: 'dos-step-5',
    name: 'Notify Stakeholders',
    type: StepType.AUTOMATED,
    description: 'Send automated notifications to relevant stakeholders including security team, operations, and management.',
    actionId: 'notify-stakeholders', // Uses the notify-stakeholders action
    timeout: 120000,
    requiresApproval: false,
    onFailure: 'continue',
    retryAttempts: 3,
    dependencies: ['dos-step-1'],
    metadata: {
      notificationType: 'dos-incident',
      includeSeverity: true,
      includeImpactAssessment: true,
    },
  },
  {
    id: 'dos-step-5b',
    name: 'Update Status Page',
    type: StepType.MANUAL,
    description: `
      Update public status page:
      1. Create incident on status page
      2. Describe service impact (without revealing attack details)
      3. Set appropriate severity level
      4. Provide estimated time to resolution if possible
      5. Schedule regular updates (every 15-30 minutes)
      6. Keep communications professional and user-focused
    `,
    requiresApproval: true,
    approvers: ['communications', 'incident-commander'],
    onFailure: 'continue',
    dependencies: ['dos-step-1'],
  },
  {
    id: 'dos-step-5c',
    name: 'Customer Communication',
    type: StepType.MANUAL,
    description: `
      Communicate with affected customers:
      1. Draft customer communication (focus on impact, not attack details)
      2. Review with communications and legal team
      3. Send via appropriate channels (email, in-app, support)
      4. Prepare support team for incoming inquiries
      5. Document customer impact for later reporting
    `,
    requiresApproval: true,
    approvers: ['communications', 'legal'],
    onFailure: 'continue',
    dependencies: ['dos-step-5b'],
  },

  // Phase 6: Ongoing Monitoring (Manual)
  {
    id: 'dos-step-6',
    name: 'Monitor Attack Status',
    type: StepType.MANUAL,
    description: `
      Continuously monitor attack and mitigation effectiveness:
      1. Track attack volume trends
      2. Monitor service availability and latency
      3. Verify mitigation measures are effective
      4. Watch for attack pattern changes
      5. Adjust mitigation as needed
      6. Document attack timeline
      7. Estimate when attack may subside

      Continue monitoring until attack subsides significantly.
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-2', 'dos-step-2b', 'dos-step-2c', 'dos-step-4'],
  },

  // Phase 7: Recovery (Manual with Approvals)
  {
    id: 'dos-step-7',
    name: 'Verify Attack Subsided',
    type: StepType.MANUAL,
    description: `
      Confirm attack has subsided:
      1. Monitor traffic patterns for sustained normal levels
      2. Verify no new attack vectors emerging
      3. Check error rates and latency returning to normal
      4. Confirm service availability restored
      5. Wait sufficient time to ensure attack is truly over (minimum 30 minutes)
      6. Document end of attack timeline
    `,
    requiresApproval: false,
    onFailure: 'halt',
    dependencies: ['dos-step-6'],
  },
  {
    id: 'dos-step-7b',
    name: 'Restore Normal Operations',
    type: StepType.MANUAL,
    description: `
      Gradually restore normal operations:
      1. Reduce rate limiting to normal levels
      2. Disable under-attack mode on CDN
      3. Review and remove temporary IP blocks (keep persistent threats blocked)
      4. Scale down infrastructure to normal levels
      5. Return auto-scaling to normal policies
      6. Verify services functioning normally
      7. Update status page to resolved

      Requires approval to ensure attack has truly subsided.
    `,
    requiresApproval: true,
    approvers: ['incident-commander', 'operations-lead'],
    onFailure: 'halt',
    dependencies: ['dos-step-7'],
  },
  {
    id: 'dos-step-7c',
    name: 'Final Status Update',
    type: StepType.MANUAL,
    description: `
      Publish final status update:
      1. Update status page to resolved
      2. Send final customer communication
      3. Provide summary of incident duration and impact
      4. Thank users for patience
      5. Close status page incident
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-7b'],
  },

  // Phase 8: Post-Incident (Manual)
  {
    id: 'dos-step-8',
    name: 'Document Attack Details',
    type: StepType.MANUAL,
    description: `
      Comprehensive attack documentation:
      1. Attack timeline (detection to resolution)
      2. Attack type and vectors used
      3. Peak attack volume and duration
      4. Source IPs and geographic distribution
      5. Services and systems affected
      6. Mitigation actions taken and effectiveness
      7. Customer impact assessment
      8. Cost of incident (infrastructure, revenue, labor)
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-7b'],
  },
  {
    id: 'dos-step-8b',
    name: 'Lessons Learned Review',
    type: StepType.MANUAL,
    description: `
      Conduct lessons learned review:
      1. Schedule post-mortem meeting with all stakeholders
      2. Review what worked well in the response
      3. Identify gaps in detection and response
      4. Evaluate mitigation effectiveness
      5. Assess communication effectiveness
      6. Document actionable improvements
    `,
    requiresApproval: false,
    onFailure: 'continue',
    dependencies: ['dos-step-8'],
  },
  {
    id: 'dos-step-8c',
    name: 'Improve Defenses',
    type: StepType.MANUAL,
    description: `
      Implement defense improvements:
      1. Update DDoS protection configurations
      2. Enhance rate limiting rules
      3. Improve traffic analysis capabilities
      4. Update auto-scaling policies
      5. Enhance monitoring and alerting
      6. Update incident response procedures
      7. Consider additional DDoS protection services
      8. Update playbook based on lessons learned
      9. Schedule regular DDoS drills
    `,
    requiresApproval: true,
    approvers: ['security-lead', 'cto'],
    onFailure: 'continue',
    dependencies: ['dos-step-8b'],
  },
  {
    id: 'dos-step-8d',
    name: 'External Reporting',
    type: StepType.MANUAL,
    description: `
      Report attack to external parties if appropriate:
      1. Report to ISPs/hosting providers of attacking IPs
      2. Report to law enforcement if warranted
      3. Share indicators with threat intelligence communities
      4. Update security vendors with attack signatures
      5. Document all external communications
    `,
    requiresApproval: true,
    approvers: ['legal', 'security-lead'],
    onFailure: 'continue',
    dependencies: ['dos-step-8'],
  },
];

const triggerConditions: TriggerCondition[] = [
  {
    field: 'type',
    operator: 'equals',
    value: IncidentType.DENIAL_OF_SERVICE,
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
    target: 'network-oncall',
    severityFilter: [IncidentSeverity.P1, IncidentSeverity.P2],
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  {
    channel: NotificationChannel.PAGERDUTY,
    target: 'security-oncall',
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
    target: 'operations@company.com',
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
      afterMinutes: 5,
      targets: ['network-team', 'security-team'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY],
      message: 'DoS attack detected - immediate response required',
    },
    {
      level: 2,
      afterMinutes: 15,
      targets: ['security-lead', 'network-lead', 'incident-commander'],
      channels: [NotificationChannel.SLACK, NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL],
      message: 'DoS attack ongoing - escalating to leadership',
    },
    {
      level: 3,
      afterMinutes: 30,
      targets: ['ciso', 'cto', 'vp-engineering'],
      channels: [NotificationChannel.PAGERDUTY, NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Major DoS attack - executive escalation',
    },
    {
      level: 4,
      afterMinutes: 60,
      targets: ['ceo', 'board-security-committee'],
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
      message: 'Extended DoS attack affecting service availability - executive notification',
    },
  ],
  maxLevel: 4,
  resetOnAcknowledge: true,
};

// ============================================================================
// Export Playbook
// ============================================================================

export const denialOfServicePlaybook: PlaybookInput = {
  id: 'playbook-denial-of-service-v1',
  name: 'Denial of Service Response',
  description: `
    Comprehensive playbook for responding to denial of service (DoS/DDoS) incidents.
    Covers attack verification, immediate mitigation, traffic analysis, infrastructure
    scaling, stakeholder communication, service recovery, and defense improvements.
  `.trim(),
  version: '1.0.0',
  triggerConditions,
  steps: denialOfServiceSteps,
  notifications,
  escalation,
  enabled: true,
  tags: ['dos', 'ddos', 'denial-of-service', 'availability', 'network', 'critical'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export default denialOfServicePlaybook;
