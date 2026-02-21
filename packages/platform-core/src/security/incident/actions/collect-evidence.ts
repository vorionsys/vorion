/**
 * Evidence Collection Action
 *
 * Automated evidence collection for incident forensics.
 * Collects logs, system state, network captures, and memory dumps.
 *
 * @packageDocumentation
 * @module security/incident/actions/collect-evidence
 */

import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { createLogger } from '../../../common/logger.js';
import type { ActionDefinition, ActionContext, ActionResult, Evidence } from '../types.js';

const logger = createLogger({ component: 'action-collect-evidence' });

// ============================================================================
// Evidence Types
// ============================================================================

export interface EvidenceTarget {
  type: 'logs' | 'system_state' | 'network_capture' | 'memory_dump' | 'configuration' | 'database_audit' | 'file_snapshot';
  source: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  filters?: Record<string, unknown>;
}

export interface CollectionResult {
  targetType: string;
  source: string;
  collected: boolean;
  location?: string;
  size?: number;
  hash?: string;
  timestamp: Date;
  error?: string;
}

// ============================================================================
// Evidence Collection Service Interface
// ============================================================================

export interface EvidenceCollectionService {
  /** Collect logs from a source */
  collectLogs(source: string, timeRange?: { start: Date; end: Date }, filters?: Record<string, unknown>): Promise<{
    success: boolean;
    location: string;
    size: number;
    lineCount: number;
  }>;

  /** Capture system state */
  captureSystemState(systemId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
    components: string[];
  }>;

  /** Capture network traffic */
  captureNetworkTraffic(interfaceId: string, duration: number, filters?: Record<string, unknown>): Promise<{
    success: boolean;
    location: string;
    size: number;
    packetCount: number;
  }>;

  /** Capture memory dump */
  captureMemoryDump(processId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
  }>;

  /** Export configuration */
  exportConfiguration(serviceId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
  }>;

  /** Export database audit logs */
  exportDatabaseAudit(databaseId: string, timeRange?: { start: Date; end: Date }): Promise<{
    success: boolean;
    location: string;
    size: number;
    entryCount: number;
  }>;

  /** Create file snapshot */
  createFileSnapshot(path: string): Promise<{
    success: boolean;
    location: string;
    size: number;
    fileCount: number;
  }>;

  /** Calculate file hash */
  calculateHash(location: string): Promise<string>;

  /** Verify evidence integrity */
  verifyIntegrity(location: string, expectedHash: string): Promise<boolean>;
}

// ============================================================================
// Default Mock Evidence Collection Service
// ============================================================================

class MockEvidenceCollectionService implements EvidenceCollectionService {
  async collectLogs(
    source: string,
    timeRange?: { start: Date; end: Date },
    filters?: Record<string, unknown>
  ): Promise<{ success: boolean; location: string; size: number; lineCount: number }> {
    logger.info('Collecting logs', { source, timeRange, filters });
    await this.simulateOperation(2000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/logs/${source.replace(/[^a-zA-Z0-9]/g, '_')}.log.gz`,
      size: 15728640, // 15 MB
      lineCount: 250000,
    };
  }

  async captureSystemState(systemId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
    components: string[];
  }> {
    logger.info('Capturing system state', { systemId });
    await this.simulateOperation(3000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/system_state/${systemId}.tar.gz`,
      size: 52428800, // 50 MB
      components: ['processes', 'network_connections', 'open_files', 'environment', 'user_sessions'],
    };
  }

  async captureNetworkTraffic(
    interfaceId: string,
    duration: number,
    filters?: Record<string, unknown>
  ): Promise<{ success: boolean; location: string; size: number; packetCount: number }> {
    logger.info('Capturing network traffic', { interfaceId, duration, filters });
    await this.simulateOperation(Math.min(duration * 1000, 5000)); // Simulate capture
    return {
      success: true,
      location: `/evidence/${Date.now()}/pcap/${interfaceId}.pcap`,
      size: 104857600, // 100 MB
      packetCount: 1500000,
    };
  }

  async captureMemoryDump(processId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
  }> {
    logger.info('Capturing memory dump', { processId });
    await this.simulateOperation(5000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/memory/${processId}.dmp`,
      size: 2147483648, // 2 GB
    };
  }

  async exportConfiguration(serviceId: string): Promise<{
    success: boolean;
    location: string;
    size: number;
  }> {
    logger.info('Exporting configuration', { serviceId });
    await this.simulateOperation(1000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/config/${serviceId}.json`,
      size: 65536, // 64 KB
    };
  }

  async exportDatabaseAudit(
    databaseId: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<{ success: boolean; location: string; size: number; entryCount: number }> {
    logger.info('Exporting database audit', { databaseId, timeRange });
    await this.simulateOperation(4000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/db_audit/${databaseId}.sql.gz`,
      size: 31457280, // 30 MB
      entryCount: 500000,
    };
  }

  async createFileSnapshot(path: string): Promise<{
    success: boolean;
    location: string;
    size: number;
    fileCount: number;
  }> {
    logger.info('Creating file snapshot', { path });
    await this.simulateOperation(6000);
    return {
      success: true,
      location: `/evidence/${Date.now()}/snapshot/${path.replace(/\//g, '_')}.tar.gz`,
      size: 524288000, // 500 MB
      fileCount: 15000,
    };
  }

  async calculateHash(location: string): Promise<string> {
    // Generate a mock SHA-256 hash
    return crypto.createHash('sha256').update(location + Date.now()).digest('hex');
  }

  async verifyIntegrity(location: string, expectedHash: string): Promise<boolean> {
    // Mock verification always passes
    return true;
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Evidence Collection Service
// ============================================================================

let evidenceService: EvidenceCollectionService = new MockEvidenceCollectionService();

export function setEvidenceCollectionService(service: EvidenceCollectionService): void {
  evidenceService = service;
}

export function getEvidenceCollectionService(): EvidenceCollectionService {
  return evidenceService;
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeEvidenceCollection(context: ActionContext): Promise<ActionResult> {
  const { incident, logger: actionLogger, setVariable, addEvidence } = context;
  const startTime = Date.now();
  const results: CollectionResult[] = [];

  // Determine evidence targets based on incident
  const targets = determineEvidenceTargets(incident.affectedResources, incident.type, incident.metadata);

  if (targets.length === 0) {
    actionLogger.warn('No evidence targets identified');
    return {
      success: true,
      output: { message: 'No evidence targets identified', results: [] },
      metrics: { durationMs: Date.now() - startTime, itemsProcessed: 0 },
      canRollback: false,
    };
  }

  actionLogger.info('Starting evidence collection', {
    incidentId: incident.id,
    targetCount: targets.length,
    targetTypes: Array.from(new Set(targets.map((t) => t.type))),
  });

  let successCount = 0;
  let failureCount = 0;
  let totalSize = 0;

  // Set time range for log collection (past 24 hours by default)
  const timeRange = {
    start: new Date(incident.detectedAt.getTime() - 24 * 60 * 60 * 1000),
    end: incident.detectedAt,
  };

  for (const target of targets) {
    const result: CollectionResult = {
      targetType: target.type,
      source: target.source,
      collected: false,
      timestamp: new Date(),
    };

    try {
      actionLogger.info('Collecting evidence', {
        type: target.type,
        source: target.source,
      });

      switch (target.type) {
        case 'logs': {
          const logResult = await evidenceService.collectLogs(
            target.source,
            target.timeRange || timeRange,
            target.filters
          );
          result.collected = logResult.success;
          result.location = logResult.location;
          result.size = logResult.size;

          if (logResult.success) {
            result.hash = await evidenceService.calculateHash(logResult.location);
            await addEvidence({
              type: 'log',
              name: `${target.source} logs`,
              description: `Logs collected from ${target.source} (${logResult.lineCount} lines)`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: logResult.size,
              location: logResult.location,
              metadata: { lineCount: logResult.lineCount, timeRange },
            });
          }
          break;
        }

        case 'system_state': {
          const stateResult = await evidenceService.captureSystemState(target.source);
          result.collected = stateResult.success;
          result.location = stateResult.location;
          result.size = stateResult.size;

          if (stateResult.success) {
            result.hash = await evidenceService.calculateHash(stateResult.location);
            await addEvidence({
              type: 'other',
              name: `${target.source} system state`,
              description: `System state capture (${stateResult.components.join(', ')})`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: stateResult.size,
              location: stateResult.location,
              metadata: { components: stateResult.components },
            });
          }
          break;
        }

        case 'network_capture': {
          const pcapResult = await evidenceService.captureNetworkTraffic(
            target.source,
            60, // 60 seconds capture
            target.filters
          );
          result.collected = pcapResult.success;
          result.location = pcapResult.location;
          result.size = pcapResult.size;

          if (pcapResult.success) {
            result.hash = await evidenceService.calculateHash(pcapResult.location);
            await addEvidence({
              type: 'network_capture',
              name: `${target.source} network capture`,
              description: `Network traffic capture (${pcapResult.packetCount} packets)`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: pcapResult.size,
              location: pcapResult.location,
              metadata: { packetCount: pcapResult.packetCount },
            });
          }
          break;
        }

        case 'memory_dump': {
          const memResult = await evidenceService.captureMemoryDump(target.source);
          result.collected = memResult.success;
          result.location = memResult.location;
          result.size = memResult.size;

          if (memResult.success) {
            result.hash = await evidenceService.calculateHash(memResult.location);
            await addEvidence({
              type: 'memory_dump',
              name: `${target.source} memory dump`,
              description: `Memory dump of process ${target.source}`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: memResult.size,
              location: memResult.location,
            });
          }
          break;
        }

        case 'configuration': {
          const configResult = await evidenceService.exportConfiguration(target.source);
          result.collected = configResult.success;
          result.location = configResult.location;
          result.size = configResult.size;

          if (configResult.success) {
            result.hash = await evidenceService.calculateHash(configResult.location);
            await addEvidence({
              type: 'configuration',
              name: `${target.source} configuration`,
              description: `Configuration export for ${target.source}`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: configResult.size,
              location: configResult.location,
            });
          }
          break;
        }

        case 'database_audit': {
          const auditResult = await evidenceService.exportDatabaseAudit(
            target.source,
            target.timeRange || timeRange
          );
          result.collected = auditResult.success;
          result.location = auditResult.location;
          result.size = auditResult.size;

          if (auditResult.success) {
            result.hash = await evidenceService.calculateHash(auditResult.location);
            await addEvidence({
              type: 'log',
              name: `${target.source} database audit`,
              description: `Database audit logs (${auditResult.entryCount} entries)`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: auditResult.size,
              location: auditResult.location,
              metadata: { entryCount: auditResult.entryCount, timeRange },
            });
          }
          break;
        }

        case 'file_snapshot': {
          const snapResult = await evidenceService.createFileSnapshot(target.source);
          result.collected = snapResult.success;
          result.location = snapResult.location;
          result.size = snapResult.size;

          if (snapResult.success) {
            result.hash = await evidenceService.calculateHash(snapResult.location);
            await addEvidence({
              type: 'file',
              name: `${target.source} snapshot`,
              description: `File snapshot (${snapResult.fileCount} files)`,
              source: target.source,
              collectedBy: 'automated-evidence-collection',
              hash: result.hash,
              size: snapResult.size,
              location: snapResult.location,
              metadata: { fileCount: snapResult.fileCount },
            });
          }
          break;
        }

        default:
          actionLogger.warn('Unknown evidence type', { type: target.type });
      }

      if (result.collected) {
        successCount++;
        totalSize += result.size || 0;
        actionLogger.info('Evidence collected', {
          type: target.type,
          source: target.source,
          location: result.location,
          size: result.size,
        });
      } else {
        failureCount++;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      failureCount++;
      actionLogger.error('Evidence collection failed', {
        type: target.type,
        source: target.source,
        error: result.error,
      });
    }

    results.push(result);
  }

  // Store results
  setVariable('evidence_collection_results', results);

  const durationMs = Date.now() - startTime;
  const success = successCount > 0; // Partial success is acceptable

  actionLogger.info('Evidence collection completed', {
    success,
    successCount,
    failureCount,
    totalSize,
    durationMs,
  });

  return {
    success,
    output: {
      message: success
        ? `Collected ${successCount} evidence item(s), total size: ${formatBytes(totalSize)}`
        : 'Failed to collect any evidence',
      results,
      successCount,
      failureCount,
      totalSize,
    },
    metrics: {
      durationMs,
      itemsProcessed: successCount,
      itemsFailed: failureCount,
    },
    canRollback: false, // Evidence collection cannot be rolled back
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function determineEvidenceTargets(
  affectedResources: string[],
  incidentType: string,
  metadata?: Record<string, unknown>
): EvidenceTarget[] {
  const targets: EvidenceTarget[] = [];

  // Always collect security logs
  targets.push({
    type: 'logs',
    source: 'security-events',
  });

  // Collect application logs
  targets.push({
    type: 'logs',
    source: 'application',
  });

  // Collect authentication logs
  targets.push({
    type: 'logs',
    source: 'authentication',
  });

  // Add targets based on affected resources
  for (const resource of affectedResources) {
    if (resource.startsWith('server:')) {
      const serverId = resource.replace('server:', '');
      targets.push(
        { type: 'system_state', source: serverId },
        { type: 'logs', source: `server:${serverId}` }
      );
    } else if (resource.startsWith('database:')) {
      const dbId = resource.replace('database:', '');
      targets.push({ type: 'database_audit', source: dbId });
    } else if (resource.startsWith('service:')) {
      const serviceId = resource.replace('service:', '');
      targets.push(
        { type: 'configuration', source: serviceId },
        { type: 'logs', source: `service:${serviceId}` }
      );
    }
  }

  // Add targets based on incident type
  if (incidentType === 'data_breach') {
    targets.push({ type: 'database_audit', source: 'all-databases' });
  } else if (incidentType === 'malware' || incidentType === 'ransomware') {
    // Add memory dumps for malware analysis
    const affectedProcesses = metadata?.['affectedProcesses'] as string[] | undefined;
    if (affectedProcesses) {
      for (const proc of affectedProcesses) {
        targets.push({ type: 'memory_dump', source: proc });
      }
    }

    // Add file snapshots
    const affectedPaths = metadata?.['affectedPaths'] as string[] | undefined;
    if (affectedPaths) {
      for (const path of affectedPaths) {
        targets.push({ type: 'file_snapshot', source: path });
      }
    }
  } else if (incidentType === 'denial_of_service') {
    targets.push({ type: 'network_capture', source: 'primary-interface' });
  }

  // Add custom targets from metadata
  const customTargets = metadata?.['evidenceTargets'] as EvidenceTarget[] | undefined;
  if (customTargets) {
    targets.push(...customTargets);
  }

  return targets;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const collectEvidenceAction: ActionDefinition = {
  id: 'collect-evidence',
  name: 'Collect Forensic Evidence',
  description: 'Automatically collect and preserve forensic evidence including logs, system state, and network captures',
  category: 'evidence',
  riskLevel: 'low',
  requiresApproval: false,
  supportsRollback: false,
  defaultTimeoutMs: 600000, // 10 minutes (evidence collection can take time)
  maxRetries: 2,
  execute: executeEvidenceCollection,
  validate: async (context) => {
    const { incident } = context;

    // Always valid - we can always collect some evidence
    return { valid: true };
  },
};

export default collectEvidenceAction;
