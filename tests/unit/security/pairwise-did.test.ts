/**
 * Pairwise DID Tests
 *
 * Tests for privacy-preserving pairwise DID generation including:
 * - DID generation
 * - DID resolution/validation
 * - Pairwise relationship management
 * - HKDF and SHA-256 derivation algorithms
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PairwiseDIDService,
  createPairwiseDIDService,
  PairwiseDIDError,
} from '../../../src/security/pairwise-did.js';
import {
  DataClassification,
  PairwiseDerivationAlgorithm,
} from '../../../src/security/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../src/intent/metrics.js', () => ({
  intentRegistry: {
    registerMetric: vi.fn(),
  },
}));

describe('Pairwise DID Service', () => {
  let pairwiseService: PairwiseDIDService;

  beforeEach(() => {
    pairwiseService = createPairwiseDIDService({
      requiredForDataTypes: [
        DataClassification.PERSONAL,
        DataClassification.SENSITIVE,
        DataClassification.REGULATED,
      ],
      derivationAlgorithm: PairwiseDerivationAlgorithm.HKDF,
      saltLength: 32,
      hkdfInfo: 'aci-pairwise-did-v1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('DID Generation', () => {
    it('should derive pairwise DID using HKDF', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-master';
      const relyingPartyDID = 'did:web:api.example.com';

      const pairwiseDID = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID
      );

      expect(pairwiseDID).toBeDefined();
      expect(pairwiseDID.startsWith('did:key:z')).toBe(true);
    });

    it('should produce consistent DID for same inputs', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-1';
      const relyingPartyDID = 'did:web:service.example.com';
      const salt = 'fixed-salt-for-testing';

      const did1 = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      // Create new service to avoid cache
      const newService = createPairwiseDIDService({
        derivationAlgorithm: PairwiseDerivationAlgorithm.HKDF,
      });

      const did2 = await newService.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      expect(did1).toBe(did2);
    });

    it('should produce different DIDs for different relying parties', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-1';
      const salt = 'same-salt';

      const did1 = await pairwiseService.derivePairwiseDID(
        masterDID,
        'did:web:service1.example.com',
        salt
      );

      // Create new service to avoid cache
      const newService = createPairwiseDIDService({});

      const did2 = await newService.derivePairwiseDID(
        masterDID,
        'did:web:service2.example.com',
        salt
      );

      expect(did1).not.toBe(did2);
    });

    it('should produce different DIDs for different master DIDs', async () => {
      const relyingPartyDID = 'did:web:api.example.com';
      const salt = 'same-salt';

      const did1 = await pairwiseService.derivePairwiseDID(
        'did:car:a3i:vorion:agent-1',
        relyingPartyDID,
        salt
      );

      // Create new service to avoid cache
      const newService = createPairwiseDIDService({});

      const did2 = await newService.derivePairwiseDID(
        'did:car:a3i:vorion:agent-2',
        relyingPartyDID,
        salt
      );

      expect(did1).not.toBe(did2);
    });

    it('should cache derived DIDs', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-cache';
      const relyingPartyDID = 'did:web:cache.example.com';

      const did1 = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID
      );

      const did2 = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID
      );

      expect(did1).toBe(did2);
    });
  });

  describe('DID Resolution/Validation', () => {
    it('should validate correct pairwise DID', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-validate';
      const relyingPartyDID = 'did:web:validate.example.com';
      const salt = pairwiseService.generateSalt();

      const pairwiseDID = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      const derivation = pairwiseService.getDerivation(masterDID, relyingPartyDID);
      const isValid = await pairwiseService.validatePairwiseDID(
        pairwiseDID,
        masterDID,
        relyingPartyDID,
        derivation!.contextSalt
      );

      expect(isValid).toBe(true);
    });

    it('should reject incorrect pairwise DID', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-reject';
      const relyingPartyDID = 'did:web:reject.example.com';
      const salt = 'test-salt';

      const isValid = await pairwiseService.validatePairwiseDID(
        'did:key:zWrongDID',
        masterDID,
        relyingPartyDID,
        salt
      );

      expect(isValid).toBe(false);
    });

    it('should reject validation with wrong salt', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-salt';
      const relyingPartyDID = 'did:web:salt.example.com';
      const correctSalt = 'correct-salt';

      const pairwiseDID = await pairwiseService.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        correctSalt
      );

      const isValid = await pairwiseService.validatePairwiseDID(
        pairwiseDID,
        masterDID,
        relyingPartyDID,
        'wrong-salt'
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Pairwise Relationship Management', () => {
    it('should store derivation records', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-store';
      const relyingPartyDID = 'did:web:store.example.com';

      await pairwiseService.derivePairwiseDID(masterDID, relyingPartyDID);

      const derivation = pairwiseService.getDerivation(masterDID, relyingPartyDID);

      expect(derivation).toBeDefined();
      expect(derivation!.masterDid).toBe(masterDID);
      expect(derivation!.relyingPartyDid).toBe(relyingPartyDID);
      expect(derivation!.contextSalt).toBeDefined();
      expect(derivation!.derivedDid).toBeDefined();
      expect(derivation!.createdAt).toBeDefined();
    });

    it('should list derivations for a master DID', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-list';

      await pairwiseService.derivePairwiseDID(masterDID, 'did:web:rp1.example.com');
      await pairwiseService.derivePairwiseDID(masterDID, 'did:web:rp2.example.com');
      await pairwiseService.derivePairwiseDID(masterDID, 'did:web:rp3.example.com');

      const derivations = pairwiseService.listDerivations(masterDID);

      expect(derivations).toHaveLength(3);
      expect(derivations.every(d => d.masterDid === masterDID)).toBe(true);
    });

    it('should revoke pairwise relationship', async () => {
      const masterDID = 'did:car:a3i:vorion:agent-revoke';
      const relyingPartyDID = 'did:web:revoke.example.com';

      await pairwiseService.derivePairwiseDID(masterDID, relyingPartyDID);

      expect(pairwiseService.getDerivation(masterDID, relyingPartyDID)).toBeDefined();

      const revoked = pairwiseService.revokeRelationship(masterDID, relyingPartyDID);

      expect(revoked).toBe(true);
      expect(pairwiseService.getDerivation(masterDID, relyingPartyDID)).toBeUndefined();
    });

    it('should return false when revoking non-existent relationship', () => {
      const revoked = pairwiseService.revokeRelationship(
        'did:car:nonexistent',
        'did:web:nonexistent.com'
      );

      expect(revoked).toBe(false);
    });

    it('should allow storing external derivation records', () => {
      const derivation = {
        masterDid: 'did:car:external',
        relyingPartyDid: 'did:web:external.com',
        contextSalt: 'external-salt',
        derivedDid: 'did:key:zExternal',
        createdAt: new Date(),
      };

      pairwiseService.storeDerivation(derivation);

      const retrieved = pairwiseService.getDerivation(
        'did:car:external',
        'did:web:external.com'
      );

      expect(retrieved).toEqual(derivation);
    });
  });

  describe('Data Type Requirements', () => {
    it('should require pairwise for personal data', () => {
      expect(pairwiseService.isRequired(DataClassification.PERSONAL)).toBe(true);
    });

    it('should require pairwise for sensitive data', () => {
      expect(pairwiseService.isRequired(DataClassification.SENSITIVE)).toBe(true);
    });

    it('should require pairwise for regulated data', () => {
      expect(pairwiseService.isRequired(DataClassification.REGULATED)).toBe(true);
    });

    it('should not require pairwise for public data', () => {
      expect(pairwiseService.isRequired(DataClassification.PUBLIC)).toBe(false);
    });

    it('should not require pairwise for business data by default', () => {
      expect(pairwiseService.isRequired(DataClassification.BUSINESS)).toBe(false);
    });

    it('should respect custom data type configuration', () => {
      const customService = createPairwiseDIDService({
        requiredForDataTypes: [DataClassification.BUSINESS],
      });

      expect(customService.isRequired(DataClassification.BUSINESS)).toBe(true);
      expect(customService.isRequired(DataClassification.PERSONAL)).toBe(false);
    });
  });

  describe('Data Classification Mapping', () => {
    it('should map "pii" to personal classification', () => {
      const result = pairwiseService.getRequirement('pii');
      expect(result.classification).toBe(DataClassification.PERSONAL);
      expect(result.required).toBe(true);
    });

    it('should map "financial" to sensitive classification', () => {
      const result = pairwiseService.getRequirement('financial');
      expect(result.classification).toBe(DataClassification.SENSITIVE);
      expect(result.required).toBe(true);
    });

    it('should map "health" to sensitive classification', () => {
      const result = pairwiseService.getRequirement('health');
      expect(result.classification).toBe(DataClassification.SENSITIVE);
      expect(result.required).toBe(true);
    });

    it('should map "gdpr" to regulated classification', () => {
      const result = pairwiseService.getRequirement('gdpr');
      expect(result.classification).toBe(DataClassification.REGULATED);
      expect(result.required).toBe(true);
    });

    it('should map "hipaa" to regulated classification', () => {
      const result = pairwiseService.getRequirement('hipaa');
      expect(result.classification).toBe(DataClassification.REGULATED);
      expect(result.required).toBe(true);
    });

    it('should return null for unknown data types', () => {
      const result = pairwiseService.getRequirement('unknown-type');
      expect(result.classification).toBeNull();
      expect(result.required).toBe(false);
    });
  });

  describe('SHA-256 Derivation Algorithm', () => {
    it('should support SHA-256 derivation', async () => {
      const sha256Service = createPairwiseDIDService({
        derivationAlgorithm: PairwiseDerivationAlgorithm.SHA256,
      });

      const pairwiseDID = await sha256Service.derivePairwiseDID(
        'did:car:sha256-master',
        'did:web:sha256.example.com',
        'sha256-salt'
      );

      expect(pairwiseDID).toBeDefined();
      expect(pairwiseDID.startsWith('did:key:z')).toBe(true);
    });

    it('should produce different results from HKDF with same inputs', async () => {
      const hkdfService = createPairwiseDIDService({
        derivationAlgorithm: PairwiseDerivationAlgorithm.HKDF,
      });

      const sha256Service = createPairwiseDIDService({
        derivationAlgorithm: PairwiseDerivationAlgorithm.SHA256,
      });

      const masterDID = 'did:car:compare';
      const relyingPartyDID = 'did:web:compare.example.com';
      const salt = 'compare-salt';

      const hkdfDID = await hkdfService.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      const sha256DID = await sha256Service.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      expect(hkdfDID).not.toBe(sha256DID);
    });

    it('should validate SHA-256 derived DIDs correctly', async () => {
      const sha256Service = createPairwiseDIDService({
        derivationAlgorithm: PairwiseDerivationAlgorithm.SHA256,
      });

      const masterDID = 'did:car:sha256-validate';
      const relyingPartyDID = 'did:web:sha256-validate.example.com';
      const salt = 'validate-salt';

      const pairwiseDID = await sha256Service.derivePairwiseDID(
        masterDID,
        relyingPartyDID,
        salt
      );

      const isValid = await sha256Service.validatePairwiseDID(
        pairwiseDID,
        masterDID,
        relyingPartyDID,
        salt
      );

      expect(isValid).toBe(true);
    });
  });

  describe('Salt Generation', () => {
    it('should generate cryptographically secure salts', () => {
      const salt1 = pairwiseService.generateSalt();
      const salt2 = pairwiseService.generateSalt();

      expect(salt1).not.toBe(salt2);
      expect(salt1.length).toBeGreaterThan(0);
    });

    it('should generate salts of configured length', () => {
      const service32 = createPairwiseDIDService({ saltLength: 32 });
      const service64 = createPairwiseDIDService({ saltLength: 64 });

      const salt32 = service32.generateSalt();
      const salt64 = service64.generateSalt();

      // Base64url encoding makes the string longer than raw bytes
      expect(salt64.length).toBeGreaterThan(salt32.length);
    });

    it('should generate base64url-safe salts', () => {
      const salt = pairwiseService.generateSalt();

      // Should not contain +, /, or =
      expect(salt).not.toMatch(/[+/=]/);
    });
  });

  describe('Configuration', () => {
    it('should return current configuration', () => {
      const config = pairwiseService.getConfig();

      expect(config.requiredForDataTypes).toContain(DataClassification.PERSONAL);
      expect(config.requiredForDataTypes).toContain(DataClassification.SENSITIVE);
      expect(config.derivationAlgorithm).toBe(PairwiseDerivationAlgorithm.HKDF);
      expect(config.saltLength).toBe(32);
      expect(config.hkdfInfo).toBe('aci-pairwise-did-v1');
    });
  });

  describe('Edge Cases', () => {
    it('should reject empty master DID with validation error', async () => {
      // The service should validate and reject empty master DIDs
      await expect(
        pairwiseService.derivePairwiseDID('', 'did:web:empty.example.com')
      ).rejects.toThrow();
    });

    it('should handle special characters in DIDs', async () => {
      const pairwiseDID = await pairwiseService.derivePairwiseDID(
        'did:car:special!@#$%',
        'did:web:special.example.com'
      );

      expect(pairwiseDID).toBeDefined();
      expect(pairwiseDID.startsWith('did:key:z')).toBe(true);
    });

    it('should handle very long DIDs', async () => {
      const longDID = 'did:car:' + 'a'.repeat(1000);
      const pairwiseDID = await pairwiseService.derivePairwiseDID(
        longDID,
        'did:web:long.example.com'
      );

      expect(pairwiseDID).toBeDefined();
    });
  });
});
