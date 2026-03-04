/**
 * Credential Revocation Action
 *
 * Automated credential revocation for compromised accounts.
 * Handles passwords, API keys, tokens, sessions, and OAuth grants.
 *
 * @packageDocumentation
 * @module security/incident/actions/revoke-credentials
 */

import { createLogger } from '../../../common/logger.js';
import type { ActionDefinition, ActionContext, ActionResult } from '../types.js';

const logger = createLogger({ component: 'action-revoke-credentials' });

// ============================================================================
// Credential Types
// ============================================================================

export interface CredentialTarget {
  type: 'password' | 'api_key' | 'oauth_token' | 'session' | 'ssh_key' | 'certificate';
  userId?: string;
  keyId?: string;
  sessionId?: string;
  scope?: string;
}

export interface RevocationResult {
  credentialType: string;
  identifier: string;
  revoked: boolean;
  timestamp: Date;
  previousState?: unknown;
}

export interface RevocationRollbackData {
  revocations: RevocationResult[];
  incidentId: string;
  canRestore: boolean;
}

// ============================================================================
// Credential Service Interface
// ============================================================================

export interface CredentialService {
  /** Invalidate user password and require reset */
  invalidatePassword(userId: string): Promise<{ success: boolean; resetToken?: string }>;

  /** Revoke API keys for a user */
  revokeApiKeys(userId: string, keyIds?: string[]): Promise<{ success: boolean; revokedCount: number; keyIds: string[] }>;

  /** Revoke OAuth tokens */
  revokeOAuthTokens(userId: string, clientIds?: string[]): Promise<{ success: boolean; revokedCount: number }>;

  /** Terminate all active sessions */
  terminateSessions(userId: string, sessionIds?: string[]): Promise<{ success: boolean; terminatedCount: number }>;

  /** Revoke SSH keys */
  revokeSshKeys(userId: string, keyIds?: string[]): Promise<{ success: boolean; revokedCount: number }>;

  /** Revoke certificates */
  revokeCertificates(userId: string, certIds?: string[]): Promise<{ success: boolean; revokedCount: number }>;

  /** Get all active credentials for a user (for comprehensive revocation) */
  getActiveCredentials(userId: string): Promise<{
    apiKeys: string[];
    oauthClients: string[];
    activeSessions: string[];
    sshKeys: string[];
    certificates: string[];
  }>;
}

// ============================================================================
// Default Mock Credential Service
// ============================================================================

class MockCredentialService implements CredentialService {
  async invalidatePassword(userId: string): Promise<{ success: boolean; resetToken?: string }> {
    logger.info('Invalidating password', { userId });
    await this.simulateOperation(500);
    return { success: true, resetToken: `reset-${Date.now()}` };
  }

  async revokeApiKeys(userId: string, keyIds?: string[]): Promise<{ success: boolean; revokedCount: number; keyIds: string[] }> {
    logger.info('Revoking API keys', { userId, keyIds });
    await this.simulateOperation(800);
    const revokedKeyIds = keyIds || ['key-1', 'key-2'];
    return { success: true, revokedCount: revokedKeyIds.length, keyIds: revokedKeyIds };
  }

  async revokeOAuthTokens(userId: string, clientIds?: string[]): Promise<{ success: boolean; revokedCount: number }> {
    logger.info('Revoking OAuth tokens', { userId, clientIds });
    await this.simulateOperation(600);
    return { success: true, revokedCount: clientIds?.length || 3 };
  }

  async terminateSessions(userId: string, sessionIds?: string[]): Promise<{ success: boolean; terminatedCount: number }> {
    logger.info('Terminating sessions', { userId, sessionIds });
    await this.simulateOperation(400);
    return { success: true, terminatedCount: sessionIds?.length || 5 };
  }

  async revokeSshKeys(userId: string, keyIds?: string[]): Promise<{ success: boolean; revokedCount: number }> {
    logger.info('Revoking SSH keys', { userId, keyIds });
    await this.simulateOperation(700);
    return { success: true, revokedCount: keyIds?.length || 2 };
  }

  async revokeCertificates(userId: string, certIds?: string[]): Promise<{ success: boolean; revokedCount: number }> {
    logger.info('Revoking certificates', { userId, certIds });
    await this.simulateOperation(900);
    return { success: true, revokedCount: certIds?.length || 1 };
  }

  async getActiveCredentials(userId: string): Promise<{
    apiKeys: string[];
    oauthClients: string[];
    activeSessions: string[];
    sshKeys: string[];
    certificates: string[];
  }> {
    logger.info('Getting active credentials', { userId });
    await this.simulateOperation(300);
    return {
      apiKeys: ['key-1', 'key-2'],
      oauthClients: ['client-1', 'client-2', 'client-3'],
      activeSessions: ['session-1', 'session-2', 'session-3', 'session-4', 'session-5'],
      sshKeys: ['ssh-1', 'ssh-2'],
      certificates: ['cert-1'],
    };
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Credential Service
// ============================================================================

let credentialService: CredentialService | null = null;

export function setCredentialService(service: CredentialService): void {
  credentialService = service;
}

export function getCredentialService(): CredentialService {
  if (!credentialService) {
    throw new Error(
      'No credential service configured. Call setCredentialService() with a real implementation before use. ' +
      'For tests, use createMockCredentialService().'
    );
  }
  return credentialService;
}

/** Create a mock credential service for testing only. */
export function createMockCredentialService(): CredentialService {
  return new MockCredentialService();
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeRevocation(context: ActionContext): Promise<ActionResult> {
  const service = getCredentialService();
  const { incident, logger: actionLogger, setVariable, getVariable } = context;
  const startTime = Date.now();
  const results: RevocationResult[] = [];

  // Get affected users from incident
  const affectedUsers = extractAffectedUsers(incident.affectedResources, incident.metadata);

  if (affectedUsers.length === 0) {
    actionLogger.warn('No affected users identified for credential revocation');
    return {
      success: true,
      output: { message: 'No affected users identified', results: [] },
      metrics: { durationMs: Date.now() - startTime, itemsProcessed: 0 },
      canRollback: false,
    };
  }

  actionLogger.info('Starting credential revocation', {
    affectedUsers,
    userCount: affectedUsers.length,
  });

  let totalRevoked = 0;
  let totalFailed = 0;

  for (const userId of affectedUsers) {
    try {
      actionLogger.info('Processing user credentials', { userId });

      // Get all active credentials
      const activeCredentials = await service.getActiveCredentials(userId);

      // 1. Terminate all sessions first (immediate effect)
      try {
        const sessionResult = await service.terminateSessions(userId);
        results.push({
          credentialType: 'session',
          identifier: userId,
          revoked: sessionResult.success,
          timestamp: new Date(),
          previousState: { terminatedCount: sessionResult.terminatedCount },
        });
        if (sessionResult.success) {
          totalRevoked += sessionResult.terminatedCount;
          actionLogger.info('Sessions terminated', { userId, count: sessionResult.terminatedCount });
        }
      } catch (error) {
        totalFailed++;
        actionLogger.error('Failed to terminate sessions', { userId, error });
      }

      // 2. Invalidate password
      try {
        const passwordResult = await service.invalidatePassword(userId);
        results.push({
          credentialType: 'password',
          identifier: userId,
          revoked: passwordResult.success,
          timestamp: new Date(),
          previousState: { resetToken: passwordResult.resetToken },
        });
        if (passwordResult.success) {
          totalRevoked++;
          setVariable(`password_reset_token_${userId}`, passwordResult.resetToken);
          actionLogger.info('Password invalidated', { userId });
        }
      } catch (error) {
        totalFailed++;
        actionLogger.error('Failed to invalidate password', { userId, error });
      }

      // 3. Revoke API keys
      if (activeCredentials.apiKeys.length > 0) {
        try {
          const apiKeyResult = await service.revokeApiKeys(userId);
          results.push({
            credentialType: 'api_key',
            identifier: userId,
            revoked: apiKeyResult.success,
            timestamp: new Date(),
            previousState: { revokedKeyIds: apiKeyResult.keyIds },
          });
          if (apiKeyResult.success) {
            totalRevoked += apiKeyResult.revokedCount;
            actionLogger.info('API keys revoked', { userId, count: apiKeyResult.revokedCount });
          }
        } catch (error) {
          totalFailed++;
          actionLogger.error('Failed to revoke API keys', { userId, error });
        }
      }

      // 4. Revoke OAuth tokens
      if (activeCredentials.oauthClients.length > 0) {
        try {
          const oauthResult = await service.revokeOAuthTokens(userId);
          results.push({
            credentialType: 'oauth_token',
            identifier: userId,
            revoked: oauthResult.success,
            timestamp: new Date(),
            previousState: { revokedCount: oauthResult.revokedCount },
          });
          if (oauthResult.success) {
            totalRevoked += oauthResult.revokedCount;
            actionLogger.info('OAuth tokens revoked', { userId, count: oauthResult.revokedCount });
          }
        } catch (error) {
          totalFailed++;
          actionLogger.error('Failed to revoke OAuth tokens', { userId, error });
        }
      }

      // 5. Revoke SSH keys
      if (activeCredentials.sshKeys.length > 0) {
        try {
          const sshResult = await service.revokeSshKeys(userId);
          results.push({
            credentialType: 'ssh_key',
            identifier: userId,
            revoked: sshResult.success,
            timestamp: new Date(),
            previousState: { revokedCount: sshResult.revokedCount },
          });
          if (sshResult.success) {
            totalRevoked += sshResult.revokedCount;
            actionLogger.info('SSH keys revoked', { userId, count: sshResult.revokedCount });
          }
        } catch (error) {
          totalFailed++;
          actionLogger.error('Failed to revoke SSH keys', { userId, error });
        }
      }

      // 6. Revoke certificates
      if (activeCredentials.certificates.length > 0) {
        try {
          const certResult = await service.revokeCertificates(userId);
          results.push({
            credentialType: 'certificate',
            identifier: userId,
            revoked: certResult.success,
            timestamp: new Date(),
            previousState: { revokedCount: certResult.revokedCount },
          });
          if (certResult.success) {
            totalRevoked += certResult.revokedCount;
            actionLogger.info('Certificates revoked', { userId, count: certResult.revokedCount });
          }
        } catch (error) {
          totalFailed++;
          actionLogger.error('Failed to revoke certificates', { userId, error });
        }
      }
    } catch (error) {
      totalFailed++;
      actionLogger.error('Error processing user credentials', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Store results for reference
  setVariable('credential_revocation_results', results);

  const durationMs = Date.now() - startTime;
  const success = totalFailed === 0;

  actionLogger.info('Credential revocation completed', {
    success,
    totalRevoked,
    totalFailed,
    durationMs,
  });

  // Credential revocation generally cannot be rolled back (security best practice)
  return {
    success,
    output: {
      message: success
        ? `Successfully revoked ${totalRevoked} credential(s) for ${affectedUsers.length} user(s)`
        : `Revocation completed with ${totalFailed} failure(s), ${totalRevoked} credential(s) revoked`,
      results,
      totalRevoked,
      totalFailed,
      affectedUsers,
    },
    metrics: {
      durationMs,
      itemsProcessed: totalRevoked,
      itemsFailed: totalFailed,
    },
    canRollback: false, // Credentials should not be restored after compromise
    rollbackData: {
      revocations: results,
      incidentId: incident.id,
      canRestore: false,
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractAffectedUsers(
  affectedResources: string[],
  metadata?: Record<string, unknown>
): string[] {
  const users: Set<string> = new Set();

  for (const resource of affectedResources) {
    if (resource.startsWith('user:')) {
      users.add(resource.replace('user:', ''));
    } else if (resource.startsWith('account:')) {
      users.add(resource.replace('account:', ''));
    }
  }

  // Also check metadata for affected users
  const metadataUsers = metadata?.['affectedUsers'] as string[] | undefined;
  if (metadataUsers) {
    metadataUsers.forEach((u) => users.add(u));
  }

  // Check for compromised user ID
  const compromisedUserId = metadata?.['compromisedUserId'] as string | undefined;
  if (compromisedUserId) {
    users.add(compromisedUserId);
  }

  return Array.from(users);
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const revokeCredentialsAction: ActionDefinition = {
  id: 'revoke-credentials',
  name: 'Revoke Compromised Credentials',
  description: 'Revoke all credentials (passwords, API keys, tokens, sessions) for compromised accounts',
  category: 'containment',
  riskLevel: 'medium',
  requiresApproval: false, // Critical action, should execute immediately
  supportsRollback: false, // Security best practice - don't restore compromised credentials
  defaultTimeoutMs: 180000, // 3 minutes
  maxRetries: 3,
  execute: executeRevocation,
  validate: async (context) => {
    const { incident } = context;

    const affectedUsers = extractAffectedUsers(incident.affectedResources, incident.metadata);
    if (affectedUsers.length === 0) {
      return {
        valid: false,
        reason: 'No affected users identified for credential revocation',
      };
    }

    return { valid: true };
  },
};

export default revokeCredentialsAction;
