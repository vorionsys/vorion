/**
 * Anomaly Detectors Index
 *
 * Exports all anomaly detectors for the UEBA (User and Entity Behavior Analytics) system.
 *
 * Core Detectors (existing):
 * - GeographicDetector: Impossible travel and location anomalies
 * - TemporalDetector: Unusual access time patterns
 * - VolumeDetector: Request volume spikes
 *
 * UEBA Detectors (new):
 * - PrivilegeEscalationDetector: Permission grants and role changes
 * - DataExfiltrationDetector: Bulk exports and unusual data access
 * - LateralMovementDetector: System-to-system movement patterns
 * - AccountCompromiseDetector: Multi-signal compromise detection
 *
 * @packageDocumentation
 * @module security/anomaly/detectors
 */

// =============================================================================
// Core Detectors
// =============================================================================

export {
  GeographicDetector,
  createGeographicDetector,
  calculateHaversineDistance,
  calculateTravelSpeed,
} from './geographic.js';

export {
  TemporalDetector,
  createTemporalDetector,
} from './temporal.js';

export {
  VolumeDetector,
  createVolumeDetector,
} from './volume.js';

// =============================================================================
// UEBA Detectors
// =============================================================================

export {
  PrivilegeEscalationDetector,
  createPrivilegeEscalationDetector,
  type PrivilegeEscalationDetectorConfig,
  DEFAULT_PRIVILEGE_ESCALATION_CONFIG,
} from './privilege-escalation.js';

export {
  DataExfiltrationDetector,
  createDataExfiltrationDetector,
  type DataExfiltrationDetectorConfig,
  DEFAULT_DATA_EXFILTRATION_CONFIG,
} from './data-exfiltration.js';

export {
  LateralMovementDetector,
  createLateralMovementDetector,
  type LateralMovementDetectorConfig,
  DEFAULT_LATERAL_MOVEMENT_CONFIG,
} from './lateral-movement.js';

export {
  AccountCompromiseDetector,
  createAccountCompromiseDetector,
  type AccountCompromiseDetectorConfig,
  DEFAULT_ACCOUNT_COMPROMISE_CONFIG,
} from './account-compromise.js';

// =============================================================================
// Detector Registry
// =============================================================================

import type { Detector } from '../types.js';
import { GeographicDetector } from './geographic.js';
import { TemporalDetector } from './temporal.js';
import { VolumeDetector } from './volume.js';
import { PrivilegeEscalationDetector } from './privilege-escalation.js';
import { DataExfiltrationDetector } from './data-exfiltration.js';
import { LateralMovementDetector } from './lateral-movement.js';
import { AccountCompromiseDetector } from './account-compromise.js';

/**
 * All available detector types
 */
export const DetectorType = {
  GEOGRAPHIC: 'geographic',
  TEMPORAL: 'temporal',
  VOLUME: 'volume',
  PRIVILEGE_ESCALATION: 'privilege-escalation',
  DATA_EXFILTRATION: 'data-exfiltration',
  LATERAL_MOVEMENT: 'lateral-movement',
  ACCOUNT_COMPROMISE: 'account-compromise',
} as const;

export type DetectorType = (typeof DetectorType)[keyof typeof DetectorType];

/**
 * Detector constructor type for registry
 */
type DetectorConstructor = new (...args: any[]) => Detector;

/**
 * Registry of all available detectors
 */
export const detectorRegistry: Record<DetectorType, DetectorConstructor> = {
  [DetectorType.GEOGRAPHIC]: GeographicDetector,
  [DetectorType.TEMPORAL]: TemporalDetector,
  [DetectorType.VOLUME]: VolumeDetector,
  [DetectorType.PRIVILEGE_ESCALATION]: PrivilegeEscalationDetector,
  [DetectorType.DATA_EXFILTRATION]: DataExfiltrationDetector,
  [DetectorType.LATERAL_MOVEMENT]: LateralMovementDetector,
  [DetectorType.ACCOUNT_COMPROMISE]: AccountCompromiseDetector,
};

/**
 * Create a detector instance by type
 *
 * @param type - The detector type to create
 * @param config - Optional configuration for the detector
 * @returns A new detector instance
 *
 * @example
 * ```typescript
 * const detector = createDetector('privilege-escalation', {
 *   maxDailyGrants: 10,
 * });
 * ```
 */
export function createDetector(
  type: DetectorType,
  config?: Record<string, unknown>
): Detector {
  const DetectorClass = detectorRegistry[type];

  if (!DetectorClass) {
    throw new Error(`Unknown detector type: ${type}`);
  }

  return new DetectorClass(config);
}

/**
 * Create all UEBA detectors with default configurations
 *
 * @returns Array of all UEBA detector instances
 *
 * @example
 * ```typescript
 * const detectors = createAllUEBADetectors();
 * for (const detector of detectors) {
 *   anomalyEngine.registerDetector(detector);
 * }
 * ```
 */
export function createAllUEBADetectors(): Detector[] {
  return [
    new PrivilegeEscalationDetector(),
    new DataExfiltrationDetector(),
    new LateralMovementDetector(),
    new AccountCompromiseDetector(),
  ];
}

/**
 * Get list of all available detector types
 */
export function getAvailableDetectorTypes(): DetectorType[] {
  return Object.values(DetectorType);
}

/**
 * Check if a detector type is valid
 */
export function isValidDetectorType(type: string): type is DetectorType {
  return Object.values(DetectorType).includes(type as DetectorType);
}
