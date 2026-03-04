/**
 * Incident Response Playbooks
 *
 * This module exports all available incident response playbooks.
 * Each playbook defines the steps, notifications, and escalation
 * procedures for handling specific incident types.
 *
 * @packageDocumentation
 * @module security/incident/playbooks
 */

export { accountCompromisePlaybook } from './account-compromise.js';
export { configurationErrorPlaybook } from './configuration-error.js';
export { dataBreachPlaybook } from './data-breach.js';
export { denialOfServicePlaybook } from './denial-of-service.js';
export { insiderThreatPlaybook } from './insider-threat.js';
export { malwarePlaybook } from './malware.js';
export { ransomwarePlaybook } from './ransomware.js';
export { unauthorizedAccessPlaybook } from './unauthorized-access.js';

import { accountCompromisePlaybook } from './account-compromise.js';
import { configurationErrorPlaybook } from './configuration-error.js';
import { dataBreachPlaybook } from './data-breach.js';
import { denialOfServicePlaybook } from './denial-of-service.js';
import { insiderThreatPlaybook } from './insider-threat.js';
import { malwarePlaybook } from './malware.js';
import { ransomwarePlaybook } from './ransomware.js';
import { unauthorizedAccessPlaybook } from './unauthorized-access.js';
import type { PlaybookInput } from '../types.js';

/**
 * All available incident response playbooks indexed by their ID.
 */
export const allPlaybooks: Record<string, PlaybookInput> = {
  [accountCompromisePlaybook.id]: accountCompromisePlaybook,
  [configurationErrorPlaybook.id]: configurationErrorPlaybook,
  [dataBreachPlaybook.id]: dataBreachPlaybook,
  [denialOfServicePlaybook.id]: denialOfServicePlaybook,
  [insiderThreatPlaybook.id]: insiderThreatPlaybook,
  [malwarePlaybook.id]: malwarePlaybook,
  [ransomwarePlaybook.id]: ransomwarePlaybook,
  [unauthorizedAccessPlaybook.id]: unauthorizedAccessPlaybook,
};

/**
 * Array of all available playbooks for iteration.
 */
export const playbookList: PlaybookInput[] = Object.values(allPlaybooks);

/**
 * Get a playbook by its ID.
 */
export function getPlaybookById(id: string): PlaybookInput | undefined {
  return allPlaybooks[id];
}

/**
 * Get all enabled playbooks.
 */
export function getEnabledPlaybooks(): PlaybookInput[] {
  return playbookList.filter(p => p.enabled);
}
