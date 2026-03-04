/**
 * Scale Monitoring Action
 *
 * Enhanced monitoring activation for incident response.
 * Increases logging verbosity, enables additional alerts, and deploys detection rules.
 *
 * @packageDocumentation
 * @module security/incident/actions/scale-monitoring
 */

import { createLogger } from '../../../common/logger.js';
import type { ActionDefinition, ActionContext, ActionResult } from '../types.js';

const logger = createLogger({ component: 'action-scale-monitoring' });

// ============================================================================
// Monitoring Types
// ============================================================================

export interface MonitoringEnhancement {
  type: 'log_verbosity' | 'alert_rule' | 'detection_rule' | 'metric_collection' | 'trace_sampling' | 'honeypot';
  target: string;
  previousState?: unknown;
  newState?: unknown;
  activated: boolean;
  activatedAt?: Date;
  expiresAt?: Date;
}

export interface MonitoringRollbackData {
  enhancements: MonitoringEnhancement[];
  incidentId: string;
}

// ============================================================================
// Monitoring Service Interface
// ============================================================================

export interface MonitoringScalingService {
  /** Increase log verbosity for a service */
  increaseLogVerbosity(serviceId: string, level: 'debug' | 'trace'): Promise<{
    success: boolean;
    previousLevel: string;
  }>;

  /** Restore log verbosity */
  restoreLogVerbosity(serviceId: string, level: string): Promise<boolean>;

  /** Enable additional alert rules */
  enableAlertRules(ruleIds: string[]): Promise<{
    success: boolean;
    enabledRules: string[];
    previousStates: Record<string, boolean>;
  }>;

  /** Disable alert rules */
  disableAlertRules(ruleIds: string[]): Promise<boolean>;

  /** Deploy threat detection rules */
  deployDetectionRules(rules: { id: string; pattern: string; action: string }[]): Promise<{
    success: boolean;
    deployedRuleIds: string[];
  }>;

  /** Remove detection rules */
  removeDetectionRules(ruleIds: string[]): Promise<boolean>;

  /** Enable enhanced metric collection */
  enableEnhancedMetrics(targets: string[], metricsToCollect: string[]): Promise<{
    success: boolean;
    enabledTargets: string[];
  }>;

  /** Disable enhanced metric collection */
  disableEnhancedMetrics(targets: string[]): Promise<boolean>;

  /** Increase trace sampling rate */
  increaseTraceSampling(serviceId: string, samplingRate: number): Promise<{
    success: boolean;
    previousRate: number;
  }>;

  /** Restore trace sampling rate */
  restoreTraceSampling(serviceId: string, rate: number): Promise<boolean>;

  /** Deploy honeypots */
  deployHoneypots(config: { type: string; location: string }[]): Promise<{
    success: boolean;
    deployedHoneypots: string[];
  }>;

  /** Remove honeypots */
  removeHoneypots(honeypotIds: string[]): Promise<boolean>;

  /** Get available alert rules for incident type */
  getAvailableAlertRules(incidentType: string): Promise<string[]>;

  /** Get available detection rules for incident type */
  getAvailableDetectionRules(incidentType: string): Promise<{ id: string; pattern: string; action: string }[]>;
}

// ============================================================================
// Default Mock Monitoring Service
// ============================================================================

class MockMonitoringScalingService implements MonitoringScalingService {
  async increaseLogVerbosity(
    serviceId: string,
    level: 'debug' | 'trace'
  ): Promise<{ success: boolean; previousLevel: string }> {
    logger.info('Increasing log verbosity', { serviceId, level });
    await this.simulateOperation(500);
    return { success: true, previousLevel: 'info' };
  }

  async restoreLogVerbosity(serviceId: string, level: string): Promise<boolean> {
    logger.info('Restoring log verbosity', { serviceId, level });
    await this.simulateOperation(300);
    return true;
  }

  async enableAlertRules(ruleIds: string[]): Promise<{
    success: boolean;
    enabledRules: string[];
    previousStates: Record<string, boolean>;
  }> {
    logger.info('Enabling alert rules', { ruleIds });
    await this.simulateOperation(800);
    const previousStates: Record<string, boolean> = {};
    ruleIds.forEach((id) => (previousStates[id] = false));
    return { success: true, enabledRules: ruleIds, previousStates };
  }

  async disableAlertRules(ruleIds: string[]): Promise<boolean> {
    logger.info('Disabling alert rules', { ruleIds });
    await this.simulateOperation(600);
    return true;
  }

  async deployDetectionRules(
    rules: { id: string; pattern: string; action: string }[]
  ): Promise<{ success: boolean; deployedRuleIds: string[] }> {
    logger.info('Deploying detection rules', { ruleCount: rules.length });
    await this.simulateOperation(1000);
    return { success: true, deployedRuleIds: rules.map((r) => r.id) };
  }

  async removeDetectionRules(ruleIds: string[]): Promise<boolean> {
    logger.info('Removing detection rules', { ruleIds });
    await this.simulateOperation(700);
    return true;
  }

  async enableEnhancedMetrics(
    targets: string[],
    metricsToCollect: string[]
  ): Promise<{ success: boolean; enabledTargets: string[] }> {
    logger.info('Enabling enhanced metrics', { targets, metricsToCollect });
    await this.simulateOperation(600);
    return { success: true, enabledTargets: targets };
  }

  async disableEnhancedMetrics(targets: string[]): Promise<boolean> {
    logger.info('Disabling enhanced metrics', { targets });
    await this.simulateOperation(400);
    return true;
  }

  async increaseTraceSampling(
    serviceId: string,
    samplingRate: number
  ): Promise<{ success: boolean; previousRate: number }> {
    logger.info('Increasing trace sampling', { serviceId, samplingRate });
    await this.simulateOperation(400);
    return { success: true, previousRate: 0.1 };
  }

  async restoreTraceSampling(serviceId: string, rate: number): Promise<boolean> {
    logger.info('Restoring trace sampling', { serviceId, rate });
    await this.simulateOperation(300);
    return true;
  }

  async deployHoneypots(
    config: { type: string; location: string }[]
  ): Promise<{ success: boolean; deployedHoneypots: string[] }> {
    logger.info('Deploying honeypots', { count: config.length });
    await this.simulateOperation(2000);
    return {
      success: true,
      deployedHoneypots: config.map((c) => `honeypot-${c.type}-${Date.now()}`),
    };
  }

  async removeHoneypots(honeypotIds: string[]): Promise<boolean> {
    logger.info('Removing honeypots', { honeypotIds });
    await this.simulateOperation(1000);
    return true;
  }

  async getAvailableAlertRules(incidentType: string): Promise<string[]> {
    const commonRules = [
      'suspicious-login-attempts',
      'unusual-data-access',
      'privilege-escalation-attempt',
      'lateral-movement-detection',
    ];

    const typeSpecificRules: Record<string, string[]> = {
      data_breach: ['data-exfiltration', 'sensitive-data-access', 'bulk-download'],
      account_compromise: ['impossible-travel', 'credential-stuffing', 'session-hijacking'],
      malware: ['malicious-process', 'c2-communication', 'file-encryption'],
      ransomware: ['mass-file-modification', 'shadow-copy-deletion', 'ransom-note-creation'],
      denial_of_service: ['traffic-spike', 'connection-flood', 'resource-exhaustion'],
    };

    return [...commonRules, ...(typeSpecificRules[incidentType] || [])];
  }

  async getAvailableDetectionRules(
    incidentType: string
  ): Promise<{ id: string; pattern: string; action: string }[]> {
    const rules: { id: string; pattern: string; action: string }[] = [
      { id: 'detect-suspicious-ip', pattern: 'source.ip in threat_intel', action: 'alert' },
      { id: 'detect-unusual-hours', pattern: 'timestamp outside business_hours', action: 'alert' },
    ];

    if (incidentType === 'data_breach') {
      rules.push(
        { id: 'detect-bulk-export', pattern: 'export_count > 1000', action: 'block' },
        { id: 'detect-sensitive-access', pattern: 'resource contains PII', action: 'alert' }
      );
    } else if (incidentType === 'account_compromise') {
      rules.push(
        { id: 'detect-password-spray', pattern: 'failed_auth_count > 100', action: 'block' },
        { id: 'detect-token-reuse', pattern: 'token.reuse_count > 5', action: 'revoke' }
      );
    }

    return rules;
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Monitoring Service
// ============================================================================

let monitoringService: MonitoringScalingService | null = null;

export function setMonitoringScalingService(service: MonitoringScalingService): void {
  monitoringService = service;
}

export function getMonitoringScalingService(): MonitoringScalingService {
  if (!monitoringService) {
    throw new Error(
      'No monitoring scaling service configured. Call setMonitoringScalingService() with a real implementation before use. ' +
      'For tests, use createMockMonitoringScalingService().'
    );
  }
  return monitoringService;
}

/** Create a mock monitoring scaling service for testing only. */
export function createMockMonitoringScalingService(): MonitoringScalingService {
  return new MockMonitoringScalingService();
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeScaleMonitoring(context: ActionContext): Promise<ActionResult> {
  const { incident, logger: actionLogger, setVariable } = context;
  const startTime = Date.now();
  const enhancements: MonitoringEnhancement[] = [];
  const service = getMonitoringScalingService();

  // Calculate expiry (enhanced monitoring for 7 days by default)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  actionLogger.info('Starting monitoring scale-up', {
    incidentId: incident.id,
    type: incident.type,
    severity: incident.severity,
  });

  let successCount = 0;
  let failureCount = 0;

  try {
    // 1. Increase log verbosity for affected services
    const affectedServices = extractAffectedServices(incident.affectedResources);
    for (const serviceId of affectedServices) {
      try {
        const result = await service.increaseLogVerbosity(serviceId, 'debug');
        enhancements.push({
          type: 'log_verbosity',
          target: serviceId,
          previousState: result.previousLevel,
          newState: 'debug',
          activated: result.success,
          activatedAt: new Date(),
          expiresAt,
        });
        if (result.success) {
          successCount++;
          actionLogger.info('Log verbosity increased', { serviceId });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Failed to increase log verbosity', { serviceId, error });
      }
    }

    // 2. Enable additional alert rules
    const alertRules = await service.getAvailableAlertRules(incident.type);
    if (alertRules.length > 0) {
      try {
        const result = await service.enableAlertRules(alertRules);
        enhancements.push({
          type: 'alert_rule',
          target: 'alert-rules',
          previousState: result.previousStates,
          newState: result.enabledRules,
          activated: result.success,
          activatedAt: new Date(),
          expiresAt,
        });
        if (result.success) {
          successCount++;
          actionLogger.info('Alert rules enabled', { count: result.enabledRules.length });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Failed to enable alert rules', { error });
      }
    }

    // 3. Deploy detection rules
    const detectionRules = await service.getAvailableDetectionRules(incident.type);
    if (detectionRules.length > 0) {
      try {
        const result = await service.deployDetectionRules(detectionRules);
        enhancements.push({
          type: 'detection_rule',
          target: 'detection-rules',
          previousState: [],
          newState: result.deployedRuleIds,
          activated: result.success,
          activatedAt: new Date(),
          expiresAt,
        });
        if (result.success) {
          successCount++;
          actionLogger.info('Detection rules deployed', { count: result.deployedRuleIds.length });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Failed to deploy detection rules', { error });
      }
    }

    // 4. Enable enhanced metrics
    if (affectedServices.length > 0) {
      try {
        const metricsToCollect = [
          'request_latency_detailed',
          'error_rate_by_endpoint',
          'connection_count',
          'memory_allocation',
          'cpu_usage_detailed',
        ];
        const result = await service.enableEnhancedMetrics(
          affectedServices,
          metricsToCollect
        );
        enhancements.push({
          type: 'metric_collection',
          target: 'enhanced-metrics',
          previousState: [],
          newState: result.enabledTargets,
          activated: result.success,
          activatedAt: new Date(),
          expiresAt,
        });
        if (result.success) {
          successCount++;
          actionLogger.info('Enhanced metrics enabled', { targets: result.enabledTargets });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Failed to enable enhanced metrics', { error });
      }
    }

    // 5. Increase trace sampling (for P1/P2 incidents)
    if (incident.severity === 'P1' || incident.severity === 'P2') {
      for (const serviceId of affectedServices.slice(0, 3)) {
        // Limit to 3 services
        try {
          const result = await service.increaseTraceSampling(serviceId, 1.0); // 100% sampling
          enhancements.push({
            type: 'trace_sampling',
            target: serviceId,
            previousState: result.previousRate,
            newState: 1.0,
            activated: result.success,
            activatedAt: new Date(),
            expiresAt,
          });
          if (result.success) {
            successCount++;
            actionLogger.info('Trace sampling increased', { serviceId });
          }
        } catch (error) {
          failureCount++;
          actionLogger.error('Failed to increase trace sampling', { serviceId, error });
        }
      }
    }

    // 6. Deploy honeypots (for certain incident types)
    if (['data_breach', 'unauthorized_access', 'insider_threat'].includes(incident.type)) {
      try {
        const honeypotConfig = [
          { type: 'database', location: 'internal-network' },
          { type: 'file-share', location: 'sensitive-data-zone' },
          { type: 'api-endpoint', location: 'dmz' },
        ];
        const result = await service.deployHoneypots(honeypotConfig);
        enhancements.push({
          type: 'honeypot',
          target: 'honeypots',
          previousState: [],
          newState: result.deployedHoneypots,
          activated: result.success,
          activatedAt: new Date(),
          expiresAt,
        });
        if (result.success) {
          successCount++;
          actionLogger.info('Honeypots deployed', { count: result.deployedHoneypots.length });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Failed to deploy honeypots', { error });
      }
    }

    // Store enhancements for rollback
    setVariable('monitoring_enhancements', enhancements);

    const durationMs = Date.now() - startTime;
    const success = successCount > 0;

    actionLogger.info('Monitoring scale-up completed', {
      success,
      successCount,
      failureCount,
      enhancementsActivated: enhancements.filter((e) => e.activated).length,
      durationMs,
    });

    const rollbackData: MonitoringRollbackData = {
      enhancements: enhancements.filter((e) => e.activated),
      incidentId: incident.id,
    };

    return {
      success,
      output: {
        message: success
          ? `Activated ${successCount} monitoring enhancement(s)`
          : 'Failed to activate any monitoring enhancements',
        enhancements,
        successCount,
        failureCount,
        expiresAt,
      },
      metrics: {
        durationMs,
        itemsProcessed: successCount,
        itemsFailed: failureCount,
      },
      canRollback: enhancements.some((e) => e.activated),
      rollbackData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    actionLogger.error('Monitoring scale-up failed', { error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      metrics: { durationMs: Date.now() - startTime },
      canRollback: enhancements.some((e) => e.activated),
      rollbackData: {
        enhancements: enhancements.filter((e) => e.activated),
        incidentId: incident.id,
      },
    };
  }
}

async function rollbackScaleMonitoring(
  context: ActionContext,
  rollbackData: unknown
): Promise<ActionResult> {
  const { logger: actionLogger } = context;
  const startTime = Date.now();
  const data = rollbackData as MonitoringRollbackData;
  const service = getMonitoringScalingService();

  actionLogger.info('Starting monitoring scale-down', {
    enhancementCount: data.enhancements.length,
  });

  let successCount = 0;
  let failureCount = 0;

  for (const enhancement of data.enhancements) {
    try {
      let restored = false;

      switch (enhancement.type) {
        case 'log_verbosity':
          restored = await service.restoreLogVerbosity(
            enhancement.target,
            enhancement.previousState as string
          );
          break;

        case 'alert_rule':
          const ruleIds = Object.keys(enhancement.previousState as Record<string, boolean>);
          restored = await service.disableAlertRules(ruleIds);
          break;

        case 'detection_rule':
          restored = await service.removeDetectionRules(
            enhancement.newState as string[]
          );
          break;

        case 'metric_collection':
          restored = await service.disableEnhancedMetrics(
            enhancement.newState as string[]
          );
          break;

        case 'trace_sampling':
          restored = await service.restoreTraceSampling(
            enhancement.target,
            enhancement.previousState as number
          );
          break;

        case 'honeypot':
          restored = await service.removeHoneypots(enhancement.newState as string[]);
          break;
      }

      if (restored) {
        successCount++;
        actionLogger.info('Enhancement rolled back', {
          type: enhancement.type,
          target: enhancement.target,
        });
      } else {
        failureCount++;
        actionLogger.error('Failed to roll back enhancement', {
          type: enhancement.type,
          target: enhancement.target,
        });
      }
    } catch (error) {
      failureCount++;
      actionLogger.error('Error rolling back enhancement', {
        type: enhancement.type,
        target: enhancement.target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: failureCount === 0,
    output: {
      message: `Rolled back ${successCount} of ${data.enhancements.length} monitoring enhancement(s)`,
      successCount,
      failureCount,
    },
    metrics: {
      durationMs: Date.now() - startTime,
      itemsProcessed: successCount,
      itemsFailed: failureCount,
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractAffectedServices(affectedResources: string[]): string[] {
  const services: Set<string> = new Set();

  for (const resource of affectedResources) {
    if (resource.startsWith('service:')) {
      services.add(resource.replace('service:', ''));
    } else if (resource.startsWith('server:')) {
      // Extract service from server identifier
      const serverId = resource.replace('server:', '');
      // Assume format: service-name-instance-id
      const parts = serverId.split('-');
      if (parts.length > 1) {
        services.add(parts[0]);
      }
    } else if (resource.startsWith('container:')) {
      const containerId = resource.replace('container:', '');
      // Containers often named with service prefix
      const parts = containerId.split('-');
      if (parts.length > 0) {
        services.add(parts[0]);
      }
    }
  }

  // Always include core services for monitoring
  services.add('api-gateway');
  services.add('auth-service');

  return Array.from(services);
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const scaleMonitoringAction: ActionDefinition = {
  id: 'scale-monitoring',
  name: 'Enhanced Monitoring Activation',
  description: 'Activate enhanced monitoring including increased logging, additional alerts, detection rules, and honeypots',
  category: 'monitoring',
  riskLevel: 'low',
  requiresApproval: false,
  supportsRollback: true,
  defaultTimeoutMs: 180000, // 3 minutes
  maxRetries: 2,
  execute: executeScaleMonitoring,
  rollback: rollbackScaleMonitoring,
  validate: async (context) => {
    const { incident } = context;

    // Always valid - we can always enhance monitoring
    return { valid: true };
  },
};

export default scaleMonitoringAction;
