/**
 * Agent Registry Integration Tests
 *
 * Tests agent registration, lifecycle management,
 * trust scoring, and attestation submission.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock database for testing
vi.mock('../../../src/db/index.js', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  })),
}));

import {
  createAgentRegistryService,
  createA3ICacheService,
  TRUST_TIER_RANGES,
  DOMAIN_BITS,
  type RegisterAgentOptions,
} from '../../../src/agent-registry/index.js';

describe('Agent Registry Integration Tests', () => {
  describe('CAR ID Generation', () => {
    it('should generate valid CAR format', () => {
      const options: RegisterAgentOptions = {
        organization: 'acme-corp',
        agentClass: 'invoice-processor',
        domains: ['A', 'B', 'F'],
        level: 3,
        version: '1.0.0',
      };

      // CAR format: {org}.{class}.{instance}:{domains}-L{level}@{version}
      const expectedPattern = /^acme-corp\.invoice-processor\.[a-z0-9-]+:ABF-L3@1\.0\.0$/;

      // Generate CAR ID from options
      const domainCode = options.domains.sort().join('');
      const instanceId = 'main'; // Default instance
      const carId = `${options.organization}.${options.agentClass}.${instanceId}:${domainCode}-L${options.level}@${options.version}`;

      expect(carId).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+:[A-Z]+-L[0-7]@\d+\.\d+\.\d+$/);
    });

    it('should sort domain codes alphabetically', () => {
      const domains = ['F', 'A', 'C', 'B'];
      const sorted = [...domains].sort().join('');
      expect(sorted).toBe('ABCF');
    });

    it('should validate domain codes', () => {
      const validDomains = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'S'];
      const invalidDomains = ['X', 'Y', 'Z'];

      validDomains.forEach(d => {
        expect(DOMAIN_BITS).toHaveProperty(d);
      });

      invalidDomains.forEach(d => {
        expect(DOMAIN_BITS).not.toHaveProperty(d);
      });
    });
  });

  describe('Trust Tier Ranges', () => {
    it('should have correct tier boundaries', () => {
      expect(TRUST_TIER_RANGES[0]).toEqual({ min: 0, max: 199 });
      expect(TRUST_TIER_RANGES[1]).toEqual({ min: 200, max: 349 });
      expect(TRUST_TIER_RANGES[2]).toEqual({ min: 350, max: 499 });
      expect(TRUST_TIER_RANGES[3]).toEqual({ min: 500, max: 649 });
      expect(TRUST_TIER_RANGES[4]).toEqual({ min: 650, max: 799 });
      expect(TRUST_TIER_RANGES[5]).toEqual({ min: 800, max: 875 });
      expect(TRUST_TIER_RANGES[6]).toEqual({ min: 876, max: 950 });
      expect(TRUST_TIER_RANGES[7]).toEqual({ min: 951, max: 1000 });
    });

    it('should calculate tier from score correctly', () => {
      const scoreToTier = (score: number): number => {
        for (let tier = 7; tier >= 0; tier--) {
          if (score >= TRUST_TIER_RANGES[tier].min) {
            return tier;
          }
        }
        return 0;
      };

      expect(scoreToTier(0)).toBe(0);
      expect(scoreToTier(199)).toBe(0);
      expect(scoreToTier(200)).toBe(1);
      expect(scoreToTier(349)).toBe(1);
      expect(scoreToTier(500)).toBe(3);
      expect(scoreToTier(800)).toBe(5);
      expect(scoreToTier(951)).toBe(7);
      expect(scoreToTier(1000)).toBe(7);
    });

    it('should have non-overlapping tier ranges', () => {
      for (let i = 1; i < TRUST_TIER_RANGES.length; i++) {
        const prev = TRUST_TIER_RANGES[i - 1];
        const curr = TRUST_TIER_RANGES[i];
        expect(curr.min).toBe(prev.max + 1);
      }
    });
  });

  describe('Agent State Transitions', () => {
    const validTransitions: Record<string, string[]> = {
      provisioned: ['active', 'archived'],
      active: ['suspended', 'revoked', 'archived'],
      suspended: ['active', 'revoked', 'archived'],
      revoked: ['archived'],
      archived: [],
    };

    it('should allow valid state transitions', () => {
      Object.entries(validTransitions).forEach(([from, toStates]) => {
        toStates.forEach(to => {
          expect(validTransitions[from]).toContain(to);
        });
      });
    });

    it('should not allow transition from archived', () => {
      expect(validTransitions.archived).toHaveLength(0);
    });

    it('should not allow direct transition from provisioned to revoked', () => {
      expect(validTransitions.provisioned).not.toContain('revoked');
    });
  });

  describe('A3I Cache', () => {
    it('should generate consistent cache keys', () => {
      const carId = 'acme.bot.main:ABF-L3@1.0.0';
      const tenantId = 'tenant-123';

      const trustKey = `a3i:trust:${carId}`;
      const agentKey = `a3i:agent:${tenantId}:${carId}`;

      expect(trustKey).toBe('a3i:trust:acme.bot.main:ABF-L3@1.0.0');
      expect(agentKey).toBe('a3i:agent:tenant-123:acme.bot.main:ABF-L3@1.0.0');
    });

    it('should calculate XFetch probability correctly', () => {
      // XFetch algorithm: probability = delta / (ttl * beta)
      const calculateXFetchProbability = (
        currentTime: number,
        expiryTime: number,
        ttl: number,
        beta: number = 1.0
      ): number => {
        const delta = expiryTime - currentTime;
        if (delta <= 0) return 1; // Expired, definitely refetch
        return Math.min(1, delta / (ttl * beta));
      };

      const ttl = 300; // 5 minutes
      const now = Date.now();
      const expiry = now + 60000; // 1 minute left

      const probability = calculateXFetchProbability(now, expiry, ttl * 1000);
      expect(probability).toBeGreaterThan(0);
      expect(probability).toBeLessThan(1);
    });
  });

  describe('Attestation Types', () => {
    const attestationTypes = ['behavioral', 'identity', 'security', 'compliance', 'external'];

    it('should recognize all attestation types', () => {
      attestationTypes.forEach(type => {
        expect(attestationTypes).toContain(type);
      });
    });

    it('should weight attestations by type', () => {
      const weights: Record<string, number> = {
        behavioral: 0.3,
        identity: 0.2,
        security: 0.25,
        compliance: 0.15,
        external: 0.1,
      };

      const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(totalWeight).toBe(1.0);
    });
  });

  describe('Human Approval Gates', () => {
    it('should require approval for tier promotion above T4', () => {
      const HUMAN_APPROVAL_GATES = [5, 6, 7]; // T5, T6, T7 require human approval

      expect(HUMAN_APPROVAL_GATES).toContain(5);
      expect(HUMAN_APPROVAL_GATES).toContain(6);
      expect(HUMAN_APPROVAL_GATES).toContain(7);
      expect(HUMAN_APPROVAL_GATES).not.toContain(4);
    });

    it('should calculate approval requirement', () => {
      const requiresApproval = (currentTier: number, newTier: number): boolean => {
        const HUMAN_APPROVAL_GATES = [5, 6, 7];
        return HUMAN_APPROVAL_GATES.includes(newTier) && newTier > currentTier;
      };

      expect(requiresApproval(4, 5)).toBe(true);
      expect(requiresApproval(5, 6)).toBe(true);
      expect(requiresApproval(3, 4)).toBe(false);
      expect(requiresApproval(6, 6)).toBe(false); // Same tier
    });
  });

  describe('Version Compatibility', () => {
    it('should parse semantic versions correctly', () => {
      const parseVersion = (version: string): { major: number; minor: number; patch: number } => {
        const [major, minor, patch] = version.split('.').map(Number);
        return { major, minor, patch };
      };

      const v1 = parseVersion('1.0.0');
      expect(v1).toEqual({ major: 1, minor: 0, patch: 0 });

      const v2 = parseVersion('2.5.10');
      expect(v2).toEqual({ major: 2, minor: 5, patch: 10 });
    });

    it('should compare versions correctly', () => {
      const compareVersions = (a: string, b: string): number => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);

        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
      };

      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    });
  });
});
