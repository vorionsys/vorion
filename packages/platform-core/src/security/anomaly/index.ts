/**
 * Anomaly Detection Engine
 *
 * Rule-based anomaly detection system for identifying suspicious security patterns.
 * No machine learning required - uses statistical analysis and configurable rules.
 *
 * Features:
 * - Geographic anomaly detection (impossible travel)
 * - Temporal anomaly detection (unusual access times)
 * - Volume spike detection (request rate anomalies)
 * - Pluggable detector architecture
 * - Redis-backed baseline storage
 * - Event callbacks for alerting
 *
 * @example
 * ```typescript
 * import { AnomalyDetector, createAnomalyDetector } from './security/anomaly';
 *
 * const detector = createAnomalyDetector({
 *   enabled: true,
 *   alertThreshold: 70,
 *   autoBlock: false,
 * });
 *
 * // Analyze an event
 * const result = await detector.analyze(securityEvent);
 *
 * // Register callback for anomalies
 * detector.onAnomaly((anomaly) => {
 *   console.log('Anomaly detected:', anomaly);
 * });
 * ```
 *
 * @packageDocumentation
 * @module security/anomaly
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../../common/logger.js';
import type {
  Anomaly,
  AnomalyDetectorConfig,
  AggregatedDetectionResult,
  SecurityEvent,
  Detector,
  DetectionResult,
  AnomalyCallback,
  AnomalyAlert,
  AlertCallback,
  AnomalySeverity,
  Indicator,
} from './types.js';
import {
  DEFAULT_ANOMALY_DETECTOR_CONFIG,
  AnomalyType,
  AnomalySeverity as Severity,
} from './types.js';
import { GeographicDetector, createGeographicDetector } from './detectors/geographic.js';
import { TemporalDetector, createTemporalDetector } from './detectors/temporal.js';
import { VolumeDetector, createVolumeDetector } from './detectors/volume.js';

const logger = createLogger({ component: 'anomaly-detector' });

// =============================================================================
// Main Anomaly Detector Class
// =============================================================================

/**
 * Main anomaly detection engine that orchestrates multiple detectors
 */
export class AnomalyDetector {
  private readonly config: AnomalyDetectorConfig;
  private readonly detectors: Map<string, Detector>;
  private readonly anomalyCallbacks: AnomalyCallback[];
  private readonly alertCallbacks: AlertCallback[];

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_ANOMALY_DETECTOR_CONFIG, ...config };
    this.detectors = new Map();
    this.anomalyCallbacks = [];
    this.alertCallbacks = [];

    // Initialize default detectors
    this.initializeDefaultDetectors();

    logger.info(
      {
        enabled: this.config.enabled,
        detectors: this.config.detectors,
        alertThreshold: this.config.alertThreshold,
        autoBlock: this.config.autoBlock,
      },
      'Anomaly detector initialized'
    );
  }

  /**
   * Initialize the default set of detectors
   */
  private initializeDefaultDetectors(): void {
    const keyPrefix = this.config.redisKeyPrefix ?? 'vorion:anomaly:';

    if (this.config.detectors.includes('geographic')) {
      this.registerDetector(
        createGeographicDetector({}, `${keyPrefix}geo:history:`)
      );
    }

    if (this.config.detectors.includes('temporal')) {
      this.registerDetector(
        createTemporalDetector({}, `${keyPrefix}temporal:pattern:`)
      );
    }

    if (this.config.detectors.includes('volume')) {
      this.registerDetector(
        createVolumeDetector(
          {},
          `${keyPrefix}volume:count:`,
          `${keyPrefix}volume:baseline:`
        )
      );
    }
  }

  /**
   * Register a custom detector
   */
  registerDetector(detector: Detector): void {
    this.detectors.set(detector.name, detector);
    logger.debug({ detector: detector.name }, 'Detector registered');
  }

  /**
   * Unregister a detector
   */
  unregisterDetector(name: string): boolean {
    const removed = this.detectors.delete(name);
    if (removed) {
      logger.debug({ detector: name }, 'Detector unregistered');
    }
    return removed;
  }

  /**
   * Get a registered detector by name
   */
  getDetector(name: string): Detector | undefined {
    return this.detectors.get(name);
  }

  /**
   * Get all registered detector names
   */
  getDetectorNames(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * Register a callback for when anomalies are detected
   */
  onAnomaly(callback: AnomalyCallback): void {
    this.anomalyCallbacks.push(callback);
  }

  /**
   * Register a callback for when alerts are generated
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Analyze a security event for anomalies
   */
  async analyze(event: SecurityEvent): Promise<AggregatedDetectionResult> {
    const startTime = performance.now();
    const detectorResults: DetectionResult[] = [];
    const anomalies: Anomaly[] = [];

    if (!this.config.enabled) {
      return {
        event,
        detectorResults: [],
        anomalies: [],
        totalDurationMs: 0,
        analyzedAt: new Date(),
      };
    }

    logger.debug({ eventId: event.eventId, eventType: event.eventType }, 'Analyzing event');

    // Run all detectors in parallel
    const detectionPromises = Array.from(this.detectors.values()).map(
      async (detector) => {
        try {
          return await detector.detect(event);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            { error, detector: detector.name, eventId: event.eventId },
            'Detector failed'
          );
          return {
            detectorName: detector.name,
            anomalyDetected: false,
            indicators: [],
            suggestedActions: [],
            durationMs: 0,
            error: errorMessage,
          } as DetectionResult;
        }
      }
    );

    const results = await Promise.all(detectionPromises);
    detectorResults.push(...results);

    // Aggregate results and create anomalies
    const positiveResults = results.filter((r) => r.anomalyDetected && !r.error);

    for (const result of positiveResults) {
      if (
        result.confidence !== undefined &&
        result.confidence >= this.config.alertThreshold
      ) {
        const anomaly = this.createAnomaly(event, result);
        anomalies.push(anomaly);

        // Emit anomaly callbacks
        await this.emitAnomaly(anomaly);

        // Create alert if confidence is high enough
        if (result.confidence >= this.config.alertThreshold) {
          const alert = this.createAlert(anomaly);
          await this.emitAlert(alert);
        }

        // Auto-block if configured and threshold met
        if (
          this.config.autoBlock &&
          result.confidence >= this.config.autoBlockThreshold
        ) {
          await this.handleAutoBlock(event, anomaly);
        }
      }
    }

    // Learn from the event for all detectors
    await this.learnFromEvent(event);

    const totalDurationMs = performance.now() - startTime;

    logger.debug(
      {
        eventId: event.eventId,
        detectorsRun: detectorResults.length,
        anomaliesFound: anomalies.length,
        durationMs: totalDurationMs,
      },
      'Event analysis complete'
    );

    return {
      event,
      detectorResults,
      anomalies,
      totalDurationMs,
      analyzedAt: new Date(),
    };
  }

  /**
   * Learn from an event to update baselines
   */
  async learnFromEvent(event: SecurityEvent): Promise<void> {
    const detectors = Array.from(this.detectors.values());
    const detectorNames = Array.from(this.detectors.keys());

    const results = await Promise.allSettled(
      detectors.map((detector) => detector.learn(event))
    );

    // Log any rejected promises with context
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(
          {
            error: result.reason,
            detector: detectorNames[index],
            eventId: event.eventId,
          },
          'Detector learning failed'
        );
      }
    });
  }

  /**
   * Reset all detector baselines
   */
  async resetBaselines(): Promise<void> {
    logger.info('Resetting all detector baselines');

    const detectors = Array.from(this.detectors.values());
    const results = await Promise.allSettled(
      detectors.map((detector) => detector.reset())
    );

    // Process results and log appropriately
    const detectorNames = Array.from(this.detectors.keys());
    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      const detectorName = detectorNames[index];
      if (result.status === 'fulfilled') {
        successCount++;
        logger.info({ detector: detectorName }, 'Detector reset complete');
      } else {
        failureCount++;
        logger.error(
          { error: result.reason, detector: detectorName },
          'Detector reset failed'
        );
      }
    });

    if (failureCount > 0) {
      logger.warn(
        { successCount, failureCount },
        'Some detector baselines failed to reset'
      );
    } else {
      logger.info('All detector baselines reset');
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AnomalyDetectorConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AnomalyDetectorConfig>): void {
    Object.assign(this.config, updates);
    logger.info({ updates }, 'Configuration updated');
  }

  /**
   * Create an anomaly from a detection result
   */
  private createAnomaly(event: SecurityEvent, result: DetectionResult): Anomaly {
    return {
      id: randomUUID(),
      timestamp: new Date(),
      type: this.mapDetectorToAnomalyType(result.detectorName, result.indicators),
      severity: result.severity ?? Severity.MEDIUM,
      confidence: result.confidence ?? 0,
      userId: event.userId,
      tenantId: event.tenantId,
      ipAddress: event.ipAddress,
      description: result.description ?? `Anomaly detected by ${result.detectorName}`,
      indicators: result.indicators,
      suggestedActions: result.suggestedActions,
      metadata: {
        eventId: event.eventId,
        eventType: event.eventType,
        detectorName: result.detectorName,
        durationMs: result.durationMs,
      },
    };
  }

  /**
   * Map detector name to anomaly type
   */
  private mapDetectorToAnomalyType(
    detectorName: string,
    indicators: Indicator[]
  ): Anomaly['type'] {
    switch (detectorName) {
      case 'geographic':
        if (indicators.some((i) => i.type === 'impossible_travel')) {
          return AnomalyType.IMPOSSIBLE_TRAVEL;
        }
        return AnomalyType.IMPOSSIBLE_TRAVEL;

      case 'temporal':
        return AnomalyType.UNUSUAL_TIME;

      case 'volume':
        // Check if it's auth-related
        if (indicators.some((i) => i.type.includes('auth'))) {
          return AnomalyType.FAILED_AUTH_SPIKE;
        }
        return AnomalyType.VOLUME_SPIKE;

      default:
        return AnomalyType.VOLUME_SPIKE;
    }
  }

  /**
   * Create an alert from an anomaly
   */
  private createAlert(anomaly: Anomaly): AnomalyAlert {
    return {
      alertId: randomUUID(),
      anomaly,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
      autoActionTaken: false,
    };
  }

  /**
   * Emit anomaly to registered callbacks
   */
  private async emitAnomaly(anomaly: Anomaly): Promise<void> {
    for (const callback of this.anomalyCallbacks) {
      try {
        await callback(anomaly);
      } catch (error) {
        logger.error({ error, anomalyId: anomaly.id }, 'Anomaly callback failed');
      }
    }
  }

  /**
   * Emit alert to registered callbacks
   */
  private async emitAlert(alert: AnomalyAlert): Promise<void> {
    for (const callback of this.alertCallbacks) {
      try {
        await callback(alert);
      } catch (error) {
        logger.error({ error, alertId: alert.alertId }, 'Alert callback failed');
      }
    }
  }

  /**
   * Handle automatic blocking when threshold is met
   */
  private async handleAutoBlock(event: SecurityEvent, anomaly: Anomaly): Promise<void> {
    logger.warn(
      {
        anomalyId: anomaly.id,
        userId: event.userId,
        ipAddress: event.ipAddress,
        confidence: anomaly.confidence,
      },
      'Auto-block threshold met'
    );

    // Note: Actual blocking implementation would be handled by external systems
    // This is a placeholder for integration with rate limiting or blocking services
    // For now, we just log the event and emit through callbacks
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new AnomalyDetector instance
 */
export function createAnomalyDetector(
  config?: Partial<AnomalyDetectorConfig>
): AnomalyDetector {
  return new AnomalyDetector(config);
}

// =============================================================================
// Exports
// =============================================================================

// Re-export types
export * from './types.js';

// Re-export detectors
export {
  GeographicDetector,
  createGeographicDetector,
  calculateHaversineDistance,
  calculateTravelSpeed,
} from './detectors/geographic.js';

export { TemporalDetector, createTemporalDetector } from './detectors/temporal.js';

export { VolumeDetector, createVolumeDetector } from './detectors/volume.js';
