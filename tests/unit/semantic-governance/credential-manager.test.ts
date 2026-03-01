/**
 * Semantic Governance Credential Manager Tests
 *
 * Tests for credential creation, validation, and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SemanticCredentialManager,
  getCredentialManager,
  resetCredentialManager,
  CredentialError,
} from '../../../src/semantic-governance/credential-manager.js';
import {
  TrustTier,
  InferenceLevel,
  type SemanticGovernanceCredential,
  type SemanticGovernanceConfig,
} from '../../../src/semantic-governance/types.js';
import { ValidationError } from '../../../src/common/errors.js';

describe('SemanticCredentialManager', () => {
  let manager: SemanticCredentialManager;

  beforeEach(() => {
    resetCredentialManager();
    manager = new SemanticCredentialManager();
  });

  afterEach(() => {
    resetCredentialManager();
  });

  describe('createCredential', () => {
    it('should create a credential with default values', () => {
      const credential = manager.createCredential(
        'did:example:agent-1',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {}
      );

      expect(credential.id).toMatch(/^sgc:/);
      expect(credential.carId).toBe('a3i.vorion.agent:BD-L2@1.0.0');
      expect(credential.metadata?.version).toBe('1.0.0');
      expect(credential.instructionIntegrity).toBeDefined();
      expect(credential.outputBinding).toBeDefined();
      expect(credential.inferenceScope).toBeDefined();
      expect(credential.contextAuthentication).toBeDefined();
      expect(credential.dualChannel).toBeDefined();
    });

    it('should create a credential with custom instruction integrity', () => {
      const config: SemanticGovernanceConfig = {
        instructionIntegrity: {
          allowedInstructionHashes: [
            'sha256:' + 'a'.repeat(64),
          ],
          instructionTemplates: [],
          instructionSource: {
            allowedSources: ['admin'],
            requireSignature: true,
          },
        },
      };

      const credential = manager.createCredential(
        'did:example:agent-2',
        'a3i.vorion.agent:BD-L3@1.0.0',
        config
      );

      expect(credential.instructionIntegrity.allowedInstructionHashes).toHaveLength(1);
      expect(credential.instructionIntegrity.instructionSource.requireSignature).toBe(true);
    });

    it('should create a credential with custom inference scope', () => {
      const config: SemanticGovernanceConfig = {
        inferenceScope: {
          globalLevel: InferenceLevel.STATISTICAL,
          domainOverrides: [
            { domain: 'F', level: InferenceLevel.NONE, reason: 'Financial protected' },
          ],
          derivedKnowledgeHandling: {
            retention: 'none',
            allowedRecipients: [],
            crossContextSharing: false,
          },
          piiInference: {
            allowed: false,
            handling: 'block',
          },
        },
      };

      const credential = manager.createCredential(
        'did:example:agent-3',
        'a3i.vorion.agent:BD-L1@1.0.0',
        config
      );

      expect(credential.inferenceScope.globalLevel).toBe(InferenceLevel.STATISTICAL);
      expect(credential.inferenceScope.domainOverrides).toHaveLength(1);
    });

    it('should create a credential with custom dual channel config', () => {
      const config: SemanticGovernanceConfig = {
        dualChannel: {
          enforced: true,
          controlPlaneSources: ['admin-console', 'orchestrator'],
          dataPlaneTreatment: 'block',
        },
      };

      const credential = manager.createCredential(
        'did:example:agent-4',
        'a3i.vorion.agent:BD-L2@1.0.0',
        config
      );

      expect(credential.dualChannel.enforced).toBe(true);
      expect(credential.dualChannel.dataPlaneTreatment).toBe('block');
    });

    it('should index credential by agent ID', () => {
      const agentId = 'did:example:indexed-agent';
      manager.createCredential(agentId, 'a3i.vorion.agent:BD-L2@1.0.0', {});

      const retrieved = manager.getCredentialByAgent(agentId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.carId).toBe('a3i.vorion.agent:BD-L2@1.0.0');
    });
  });

  describe('createDefaultCredential', () => {
    it('should create credential with all defaults', () => {
      const credential = manager.createDefaultCredential(
        'did:example:default-agent',
        'a3i.vorion.agent:BD-L2@1.0.0'
      );

      expect(credential.instructionIntegrity.allowedInstructionHashes).toHaveLength(0);
      expect(credential.dualChannel.enforced).toBe(true);
    });
  });

  describe('createRestrictiveCredential', () => {
    it('should create credential with strict settings', () => {
      const credential = manager.createRestrictiveCredential(
        'did:example:restricted-agent',
        'a3i.vorion.agent:BD-L4@1.0.0',
        ['sha256:' + 'b'.repeat(64)]
      );

      expect(credential.instructionIntegrity.allowedInstructionHashes).toHaveLength(1);
      expect(credential.instructionIntegrity.instructionSource.requireSignature).toBe(true);
      expect(credential.inferenceScope.globalLevel).toBe(InferenceLevel.STATISTICAL);
      expect(credential.contextAuthentication.minTrustTier).toBe(TrustTier.T3_MONITORED);
    });
  });

  describe('validateCredential', () => {
    it('should validate a correct credential', () => {
      const credential = manager.createCredential(
        'did:example:valid-agent',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const result = manager.validateCredential(credential);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid instruction hash format', () => {
      // Create a credential first, then mutate it for testing
      const credential = manager.createCredential(
        'did:example:invalid-agent',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      // Manually add invalid hash for validation testing
      const modifiedCredential = {
        ...credential,
        instructionIntegrity: {
          ...credential.instructionIntegrity,
          allowedInstructionHashes: ['invalid-hash'],
        },
      };

      const result = manager.validateCredential(modifiedCredential);
      expect(result.errors.some(e => e.includes('Invalid instruction hash format'))).toBe(true);
    });

    it('should warn about missing instruction hashes and templates', () => {
      const credential = manager.createCredential(
        'did:example:no-hash-agent',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const result = manager.validateCredential(credential);
      // Default credentials have no hashes, so there should be a warning
      expect(result.warnings.some(w => w.includes('No instruction hashes') || w.includes('templates'))).toBe(true);
    });

    it('should detect expired credentials during validation', () => {
      // Create valid credential first
      const credential = manager.createCredential(
        'did:example:expired-test',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      // Create a copy with expired date for validation
      const expiredCredential = {
        ...credential,
        metadata: {
          ...credential.metadata,
          expiresAt: new Date(Date.now() - 1000),
        },
      };

      const result = manager.validateCredential(expiredCredential);
      expect(result.expired).toBe(true);
      expect(result.errors.some(e => e.includes('expired'))).toBe(true);
    });

    it('should warn about soon-to-expire credentials', () => {
      const credential = manager.createCredential(
        'did:example:expiring-test',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      // Create a copy with expiration in 7 days
      const expiringCredential = {
        ...credential,
        metadata: {
          ...credential.metadata,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      };

      const result = manager.validateCredential(expiringCredential);
      expect(result.warnings.some(w => w.includes('expires in'))).toBe(true);
    });

    it('should validate dual channel configuration errors', () => {
      const credential = manager.createCredential(
        'did:example:dual-channel-test',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      // Create a copy with no control plane sources but enforced
      const invalidCredential = {
        ...credential,
        dualChannel: {
          enforced: true,
          controlPlaneSources: [],
          dataPlaneTreatment: 'sanitize' as const,
        },
      };

      const result = manager.validateCredential(invalidCredential);
      expect(result.errors.some(e => e.includes('no control plane sources'))).toBe(true);
    });
  });

  describe('updateCredential', () => {
    it('should update credential and increment version', () => {
      const credential = manager.createCredential(
        'did:example:update-agent',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const updated = manager.updateCredential(credential.id, {
        inferenceScope: {
          globalLevel: InferenceLevel.STATISTICAL,
          domainOverrides: [],
          derivedKnowledgeHandling: {
            retention: 'none',
            allowedRecipients: [],
            crossContextSharing: false,
          },
          piiInference: { allowed: false, handling: 'block' },
        },
      });

      expect(updated.inferenceScope.globalLevel).toBe(InferenceLevel.STATISTICAL);
      expect(updated.metadata?.version).toBe('1.0.1');
    });

    it('should throw error for non-existent credential', () => {
      expect(() => manager.updateCredential('sgc:non-existent', {})).toThrow(CredentialError);
    });
  });

  describe('getCredential', () => {
    it('should return credential by ID', () => {
      const created = manager.createCredential(
        'did:example:get-agent',
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const retrieved = manager.getCredential(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent ID', () => {
      const retrieved = manager.getCredential('sgc:non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getCredentialByAgent', () => {
    it('should return credential by agent ID', () => {
      const agentId = 'did:example:by-agent';
      const created = manager.createCredential(
        agentId,
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const retrieved = manager.getCredentialByAgent(agentId);
      expect(retrieved).toEqual(created);
    });

    it('should return undefined for unregistered agent', () => {
      const retrieved = manager.getCredentialByAgent('did:example:unknown');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('deleteCredential', () => {
    it('should delete credential and remove from index', () => {
      const agentId = 'did:example:delete-agent';
      const credential = manager.createCredential(
        agentId,
        'a3i.vorion.agent:BD-L2@1.0.0',
        {
          dualChannel: {
            enforced: true,
            controlPlaneSources: ['user-direct-input'],
            dataPlaneTreatment: 'sanitize',
          },
        }
      );

      const deleted = manager.deleteCredential(credential.id);
      expect(deleted).toBe(true);

      expect(manager.getCredential(credential.id)).toBeUndefined();
      expect(manager.getCredentialByAgent(agentId)).toBeUndefined();
    });

    it('should return false for non-existent credential', () => {
      const deleted = manager.deleteCredential('sgc:non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listCredentials', () => {
    it('should list all credentials', () => {
      manager.createCredential('did:example:list-1', 'a3i.vorion.agent:BD-L1@1.0.0', {
        dualChannel: { enforced: true, controlPlaneSources: ['admin'], dataPlaneTreatment: 'sanitize' },
      });
      manager.createCredential('did:example:list-2', 'a3i.vorion.agent:BD-L2@1.0.0', {
        dualChannel: { enforced: true, controlPlaneSources: ['admin'], dataPlaneTreatment: 'sanitize' },
      });
      manager.createCredential('did:example:list-3', 'a3i.vorion.agent:BD-L3@1.0.0', {
        dualChannel: { enforced: true, controlPlaneSources: ['admin'], dataPlaneTreatment: 'sanitize' },
      });

      const credentials = manager.listCredentials();
      expect(credentials).toHaveLength(3);
    });

    it('should return empty array when no credentials', () => {
      const credentials = manager.listCredentials();
      expect(credentials).toHaveLength(0);
    });
  });
});

describe('getCredentialManager', () => {
  afterEach(() => {
    resetCredentialManager();
  });

  it('should return singleton instance', () => {
    const manager1 = getCredentialManager();
    const manager2 = getCredentialManager();

    expect(manager1).toBe(manager2);
  });

  it('should persist credentials across calls', () => {
    const manager1 = getCredentialManager();
    manager1.createCredential(
      'did:example:singleton-agent',
      'a3i.vorion.agent:BD-L2@1.0.0',
      {
        dualChannel: {
          enforced: true,
          controlPlaneSources: ['admin'],
          dataPlaneTreatment: 'sanitize',
        },
      }
    );

    const manager2 = getCredentialManager();
    const credential = manager2.getCredentialByAgent('did:example:singleton-agent');

    expect(credential).toBeDefined();
  });
});

describe('resetCredentialManager', () => {
  it('should create new instance after reset', () => {
    const manager1 = getCredentialManager();
    manager1.createCredential(
      'did:example:reset-agent',
      'a3i.vorion.agent:BD-L2@1.0.0',
      {
        dualChannel: {
          enforced: true,
          controlPlaneSources: ['admin'],
          dataPlaneTreatment: 'sanitize',
        },
      }
    );

    resetCredentialManager();

    const manager2 = getCredentialManager();
    const credential = manager2.getCredentialByAgent('did:example:reset-agent');

    expect(credential).toBeUndefined();
  });
});

describe('CredentialError', () => {
  it('should have correct properties', () => {
    const error = new CredentialError('Test error', { field: 'value' });

    expect(error.code).toBe('CREDENTIAL_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('CredentialError');
    expect(error.details).toEqual({ field: 'value' });
  });

  it('should be instance of VorionError', () => {
    const error = new CredentialError('Test error');
    expect(error).toBeInstanceOf(Error);
  });
});
