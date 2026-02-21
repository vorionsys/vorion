/**
 * Incident Response Actions
 *
 * Collection of automated actions for incident response playbooks.
 * Each action provides execute, validate, and optional rollback capabilities.
 *
 * @packageDocumentation
 * @module security/incident/actions
 */

// Export all action definitions
export { isolateSystemAction, setIsolationService, getIsolationService } from './isolate-system.js';
export type { IsolationService, IsolationTarget, IsolationResult } from './isolate-system.js';

export { revokeCredentialsAction, setCredentialService, getCredentialService } from './revoke-credentials.js';
export type { CredentialService, CredentialTarget, RevocationResult } from './revoke-credentials.js';

export { blockIpAction, setIpBlockingService, getIpBlockingService } from './block-ip.js';
export type { IpBlockingService, IpBlockTarget, IpBlockResult } from './block-ip.js';

export { notifyStakeholdersAction, setStakeholderNotificationService, getStakeholderNotificationService } from './notify-stakeholders.js';
export type { StakeholderNotificationService, StakeholderNotification, StakeholderConfig } from './notify-stakeholders.js';

export { collectEvidenceAction, setEvidenceCollectionService, getEvidenceCollectionService } from './collect-evidence.js';
export type { EvidenceCollectionService, EvidenceTarget, CollectionResult } from './collect-evidence.js';

export { scaleMonitoringAction, setMonitoringScalingService, getMonitoringScalingService } from './scale-monitoring.js';
export type { MonitoringScalingService, MonitoringEnhancement } from './scale-monitoring.js';

import type { ActionDefinition } from '../types.js';
import { isolateSystemAction } from './isolate-system.js';
import { revokeCredentialsAction } from './revoke-credentials.js';
import { blockIpAction } from './block-ip.js';
import { notifyStakeholdersAction } from './notify-stakeholders.js';
import { collectEvidenceAction } from './collect-evidence.js';
import { scaleMonitoringAction } from './scale-monitoring.js';

/**
 * Registry of all built-in actions
 */
export const builtInActions: ActionDefinition[] = [
  isolateSystemAction,
  revokeCredentialsAction,
  blockIpAction,
  notifyStakeholdersAction,
  collectEvidenceAction,
  scaleMonitoringAction,
];

/**
 * Get action by ID
 */
export function getBuiltInAction(actionId: string): ActionDefinition | undefined {
  return builtInActions.find((a) => a.id === actionId);
}

/**
 * Get all actions by category
 */
export function getActionsByCategory(category: ActionDefinition['category']): ActionDefinition[] {
  return builtInActions.filter((a) => a.category === category);
}

/**
 * Get all action IDs
 */
export function getActionIds(): string[] {
  return builtInActions.map((a) => a.id);
}
