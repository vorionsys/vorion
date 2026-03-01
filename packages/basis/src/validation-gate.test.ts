/**
 * Tests for BASIS Validation Gate
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgent,
  isValidAgent,
  createValidationGate,
  strictValidationGate,
  productionValidationGate,
  GateDecision,
  ValidationSeverity,
  type AgentManifest,
  type RegisteredProfile,
  type ValidationGateOptions,
  scoreToTier,
} from './validation-gate';
import { TrustTier } from './trust-factors';

describe('ValidationGate', () => {
  // =============================================================================
  // BASIC VALIDATION TESTS
  // =============================================================================

  describe('validateAgent', () => {
    it('should PASS a valid manifest', () => {
      const manifest: AgentManifest = {
        agentId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
        organization: 'acme-corp',
        agentClass: 'invoice-bot',
        domains: ['A', 'B', 'F'],
        capabilityLevel: 3,
        version: '1.0.0',
        trustScore: 450,
      };

      const result = validateAgent(manifest);

      expect(result.decision).toBe(GateDecision.PASS);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should REJECT manifest missing required agentId', () => {
      const manifest = {
        organization: 'acme-corp',
        trustScore: 450,
      } as AgentManifest;

      const result = validateAgent(manifest);

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should include timing information', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
      };

      const result = validateAgent(manifest);

      expect(result.validatedAt).toBeInstanceOf(Date);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect invalid CAR format', () => {
      const manifest: AgentManifest = {
        agentId: 'invalid-format:missing-parts@1.0.0',
        trustScore: 500,
      };

      const result = validateAgent(manifest);

      const formatIssue = result.issues.find((i) => i.code === 'INVALID_CAR_FORMAT');
      expect(formatIssue).toBeDefined();
    });

    it('should accept simple ID format with info note', () => {
      const manifest: AgentManifest = {
        agentId: 'simple-agent-id',
        trustScore: 500,
      };

      const result = validateAgent(manifest);

      expect(result.valid).toBe(true);
      const infoIssue = result.issues.find((i) => i.code === 'SIMPLE_ID_FORMAT');
      expect(infoIssue).toBeDefined();
      expect(infoIssue?.severity).toBe(ValidationSeverity.INFO);
    });
  });

  // =============================================================================
  // TRUST TIER VALIDATION
  // =============================================================================

  describe('trust tier validation', () => {
    it('should calculate trust tier from score', () => {
      // T0: 0-199
      expect(scoreToTier(0)).toBe(TrustTier.T0_SANDBOX);
      expect(scoreToTier(199)).toBe(TrustTier.T0_SANDBOX);
      // T1: 200-349
      expect(scoreToTier(200)).toBe(TrustTier.T1_OBSERVED);
      expect(scoreToTier(349)).toBe(TrustTier.T1_OBSERVED);
      // T2: 350-499
      expect(scoreToTier(350)).toBe(TrustTier.T2_PROVISIONAL);
      expect(scoreToTier(499)).toBe(TrustTier.T2_PROVISIONAL);
      // T3: 500-649
      expect(scoreToTier(500)).toBe(TrustTier.T3_MONITORED);
      expect(scoreToTier(649)).toBe(TrustTier.T3_MONITORED);
      // T4: 650-799
      expect(scoreToTier(650)).toBe(TrustTier.T4_STANDARD);
      expect(scoreToTier(799)).toBe(TrustTier.T4_STANDARD);
      // T5: 800-875
      expect(scoreToTier(800)).toBe(TrustTier.T5_TRUSTED);
      expect(scoreToTier(875)).toBe(TrustTier.T5_TRUSTED);
      // T6: 876-950
      expect(scoreToTier(876)).toBe(TrustTier.T6_CERTIFIED);
      expect(scoreToTier(950)).toBe(TrustTier.T6_CERTIFIED);
      // T7: 951-1000
      expect(scoreToTier(951)).toBe(TrustTier.T7_AUTONOMOUS);
      expect(scoreToTier(1000)).toBe(TrustTier.T7_AUTONOMOUS);
    });

    it('should REJECT when trust tier is below minimum', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100, // T0
      };

      const result = validateAgent(manifest, undefined, {
        minimumTrustTier: TrustTier.T3_MONITORED,
      });

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'INSUFFICIENT_TRUST_TIER')).toBe(true);
    });

    it('should PASS when trust tier meets minimum', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 700, // T4 (650-799)
      };

      const result = validateAgent(manifest, undefined, {
        minimumTrustTier: TrustTier.T3_MONITORED,
      });

      expect(result.decision).toBe(GateDecision.PASS);
      expect(result.trustTier).toBe(TrustTier.T4_STANDARD);
    });

    it('should warn when trust score is missing', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
      };

      const result = validateAgent(manifest);

      expect(result.warnings.some((w) => w.code === 'MISSING_TRUST_SCORE')).toBe(true);
    });
  });

  // =============================================================================
  // PROFILE VALIDATION
  // =============================================================================

  describe('profile validation', () => {
    const validProfile: RegisteredProfile = {
      agentId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
      organization: 'acme-corp',
      agentClass: 'invoice-bot',
      approvedDomains: ['A', 'B', 'F'],
      maxCapabilityLevel: 4,
      approvedCapabilities: ['CAP-READ-PUBLIC', 'CAP-DB-READ', 'CAP-WRITE-APPROVED'],
      trustScore: 500,
      registeredAt: new Date('2024-01-01'),
    };

    it('should PASS when manifest matches profile', () => {
      const manifest: AgentManifest = {
        agentId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
        organization: 'acme-corp',
        agentClass: 'invoice-bot',
        domains: ['A', 'B'],
        capabilityLevel: 3,
        trustScore: 500,
      };

      const result = validateAgent(manifest, validProfile);

      expect(result.decision).toBe(GateDecision.PASS);
      expect(result.valid).toBe(true);
    });

    it('should REJECT when organization mismatches', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        organization: 'evil-corp',
        trustScore: 500,
      };

      const result = validateAgent(manifest, validProfile);

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'ORG_MISMATCH')).toBe(true);
    });

    it('should REJECT when capability level exceeds maximum', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        organization: 'acme-corp',
        capabilityLevel: 7, // exceeds profile max of 4
        trustScore: 500,
      };

      const result = validateAgent(manifest, validProfile);

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'CAPABILITY_LEVEL_EXCEEDED')).toBe(true);
    });

    it('should REJECT unauthorized domains', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        organization: 'acme-corp',
        domains: ['A', 'B', 'S'], // S not approved
        trustScore: 500,
      };

      const result = validateAgent(manifest, validProfile);

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'UNAUTHORIZED_DOMAINS')).toBe(true);
    });

    it('should warn on unauthorized capabilities', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        organization: 'acme-corp',
        requestedCapabilities: ['CAP-READ-PUBLIC', 'CAP-SYSTEM-ADMIN-FULL'], // admin not approved
        trustScore: 500,
      };

      const result = validateAgent(manifest, validProfile);

      expect(result.warnings.some((w) => w.code === 'UNAUTHORIZED_CAPABILITIES')).toBe(true);
    });

    it('should REJECT when profile required but missing', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
      };

      const result = validateAgent(manifest, undefined, {
        requireRegisteredProfile: true,
      });

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'PROFILE_NOT_FOUND')).toBe(true);
    });
  });

  // =============================================================================
  // CAPABILITY VALIDATION
  // =============================================================================

  describe('capability validation', () => {
    it('should allow capabilities matching trust tier', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 700, // T4_STANDARD (650-799)
        requestedCapabilities: ['CAP-READ-PUBLIC', 'CAP-AGENT-COMMUNICATE'],
      };

      const result = validateAgent(manifest);

      expect(result.allowedCapabilities).toContain('CAP-READ-PUBLIC');
      expect(result.allowedCapabilities).toContain('CAP-AGENT-COMMUNICATE');
      expect(result.deniedCapabilities).toBeUndefined();
    });

    it('should deny capabilities above trust tier', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100, // T0_SANDBOX
        requestedCapabilities: ['CAP-READ-PUBLIC', 'CAP-AGENT-SPAWN'], // spawn requires T6
      };

      const result = validateAgent(manifest);

      expect(result.allowedCapabilities).toContain('CAP-READ-PUBLIC');
      expect(result.deniedCapabilities).toContain('CAP-AGENT-SPAWN');
    });

    it('should provide recommendations for denied capabilities', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100,
        requestedCapabilities: ['CAP-AGENT-SPAWN'],
      };

      const result = validateAgent(manifest);

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations?.some((r) => r.includes('trust score'))).toBe(true);
    });
  });

  // =============================================================================
  // REQUIRED DOMAINS
  // =============================================================================

  describe('required domains', () => {
    it('should REJECT when required domains are missing', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        domains: ['A', 'B'],
        trustScore: 500,
      };

      const result = validateAgent(manifest, undefined, {
        requiredDomains: ['A', 'F'], // F is missing
      });

      expect(result.decision).toBe(GateDecision.REJECT);
      expect(result.errors.some((e) => e.code === 'MISSING_REQUIRED_DOMAINS')).toBe(true);
    });

    it('should PASS when all required domains present', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        domains: ['A', 'B', 'F'],
        trustScore: 500,
      };

      const result = validateAgent(manifest, undefined, {
        requiredDomains: ['A', 'F'],
      });

      expect(result.decision).toBe(GateDecision.PASS);
    });
  });

  // =============================================================================
  // STRICT MODE
  // =============================================================================

  describe('strict mode', () => {
    it('should REJECT on warnings in strict mode', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        // No trust score - generates warning
      };

      const normalResult = validateAgent(manifest, undefined, { strict: false });
      const strictResult = validateAgent(manifest, undefined, { strict: true });

      expect(normalResult.decision).toBe(GateDecision.PASS);
      expect(strictResult.decision).toBe(GateDecision.REJECT);
    });
  });

  // =============================================================================
  // CUSTOM VALIDATORS
  // =============================================================================

  describe('custom validators', () => {
    it('should run custom validators', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
        metadata: { version: '0.0.1' },
      };

      const customValidator = (m: AgentManifest) => {
        const issues = [];
        if (m.metadata?.version === '0.0.1') {
          issues.push({
            code: 'UNSTABLE_VERSION',
            message: 'Agent is using unstable version',
            severity: ValidationSeverity.WARNING,
          });
        }
        return issues;
      };

      const result = validateAgent(manifest, undefined, {
        customValidators: [customValidator],
      });

      expect(result.warnings.some((w) => w.code === 'UNSTABLE_VERSION')).toBe(true);
    });

    it('should handle custom validator errors gracefully', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
      };

      const failingValidator = () => {
        throw new Error('Validator crashed');
      };

      const result = validateAgent(manifest, undefined, {
        customValidators: [failingValidator],
      });

      // Should not crash, just add a warning
      expect(result.warnings.some((w) => w.code === 'CUSTOM_VALIDATOR_ERROR')).toBe(true);
    });
  });

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  describe('isValidAgent', () => {
    it('should return true for valid agent', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
      };

      expect(isValidAgent(manifest)).toBe(true);
    });

    it('should return false for invalid agent', () => {
      const manifest = {} as AgentManifest;

      expect(isValidAgent(manifest)).toBe(false);
    });
  });

  describe('createValidationGate', () => {
    it('should create gate with preset options', () => {
      const gate = createValidationGate({
        minimumTrustTier: TrustTier.T3_MONITORED,
      });

      const lowTrustManifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100,
      };

      const result = gate.validate(lowTrustManifest);
      expect(result.decision).toBe(GateDecision.REJECT);
    });

    it('should allow option overrides', () => {
      const gate = createValidationGate({
        minimumTrustTier: TrustTier.T5_TRUSTED,
      });

      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 700, // T4 (650-799)
      };

      // With default options, should fail (T4 < T5)
      const result1 = gate.validate(manifest);
      expect(result1.decision).toBe(GateDecision.REJECT);

      // With override, should pass (T4 >= T3)
      const result2 = gate.validate(manifest, undefined, {
        minimumTrustTier: TrustTier.T3_MONITORED,
      });
      expect(result2.decision).toBe(GateDecision.PASS);
    });
  });

  describe('preset gates', () => {
    it('strictValidationGate should reject on warnings', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        // Missing trustScore generates warning
      };

      expect(strictValidationGate.isValid(manifest)).toBe(false);
    });

    it('productionValidationGate should require profile', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 500,
      };

      const result = productionValidationGate.validate(manifest);
      expect(result.errors.some((e) => e.code === 'PROFILE_NOT_FOUND')).toBe(true);
    });
  });

  // =============================================================================
  // ESCALATION
  // =============================================================================

  describe('escalation', () => {
    it('should ESCALATE when capability escalation allowed and denied caps exist', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100, // T0
        requestedCapabilities: ['CAP-AGENT-SPAWN'], // Requires T6
      };

      const result = validateAgent(manifest, undefined, {
        allowCapabilityEscalation: true,
      });

      expect(result.decision).toBe(GateDecision.ESCALATE);
    });

    it('should REJECT when capability escalation not allowed', () => {
      const manifest: AgentManifest = {
        agentId: 'test-agent',
        trustScore: 100,
        requestedCapabilities: ['CAP-AGENT-SPAWN'],
      };

      const result = validateAgent(manifest, undefined, {
        allowCapabilityEscalation: false,
      });

      expect(result.decision).toBe(GateDecision.REJECT);
    });
  });
});
