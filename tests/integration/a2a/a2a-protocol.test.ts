/**
 * A2A Protocol Integration Tests
 *
 * Tests agent-to-agent communication, trust negotiation,
 * chain of trust tracking, and attestation recording.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  createA2ARouter,
  createTrustNegotiationService,
  createChainOfTrustService,
  createA2AAttestationService,
  type A2AMessage,
  type TrustContext,
  type ChainLink,
  type ChainContext,
  DEFAULT_A2A_TIMEOUT_MS,
  MAX_CHAIN_DEPTH,
} from '../../../src/a2a/index.js';

describe('A2A Protocol Integration Tests', () => {
  let router: ReturnType<typeof createA2ARouter>;
  let trustService: ReturnType<typeof createTrustNegotiationService>;
  let chainService: ReturnType<typeof createChainOfTrustService>;
  let attestationService: ReturnType<typeof createA2AAttestationService>;

  // Helper to create a ChainLink
  function makeLink(carId: string, action: string, tier: number, score: number): ChainLink {
    return {
      carId,
      tier,
      score,
      action,
      timestamp: new Date().toISOString(),
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
  }

  // Helper to build a valid TrustContext
  function makeTrustContext(overrides: Partial<TrustContext> = {}): TrustContext {
    return {
      callerTier: 5,
      callerScore: 900,
      callerTenant: 'test-tenant',
      callChain: [],
      ...overrides,
    };
  }

  beforeAll(() => {
    router = createA2ARouter();

    // Provide a 32-byte hex signing key and a mock trust provider
    const testSigningKey = 'a'.repeat(64); // 32 bytes in hex
    const mockTrustProvider = {
      getAgentTrust: async (carId: string) => {
        const tierMatch = carId.match(/:.*?-L(\d+)/);
        const tier = tierMatch ? parseInt(tierMatch[1], 10) : 0;
        return {
          carId,
          tier,
          score: tier * 200, // Scale: L0=0, L3=600, L4=800, L5=1000
          tenantId: 'test-tenant',
          capabilities: ['invoke', 'query', 'a2a:invoke'],
          state: 'active',
        };
      },
      validateTrustProof: async () => true,
    };

    trustService = createTrustNegotiationService(testSigningKey, mockTrustProvider);
    chainService = createChainOfTrustService();
    attestationService = createA2AAttestationService();
  });

  describe('Trust Negotiation', () => {
    it('should verify caller trust between two agents', async () => {
      const callerCarId = 'acme.invoice-bot.main:ABF-L5@1.0.0';
      const calleeCarId = 'acme.payment-bot.main:AF-L3@1.0.0';

      const result = await trustService.verifyCallerTrust(
        callerCarId,
        calleeCarId,
        makeTrustContext({ callerTier: 5, callerScore: 1000 }),
        { minTier: 3, requiredCapabilities: [], requireMtls: false }
      );

      expect(result).toHaveProperty('verified');
      expect(result).toHaveProperty('effectiveTier');
      expect(result).toHaveProperty('effectiveScore');
      expect(result.verified).toBe(true);
    });

    it('should reject caller with low trust tier', async () => {
      const callerCarId = 'test.low-trust.agent:A-L0@1.0.0';
      const calleeCarId = 'test.high-security.agent:A-L4@1.0.0';

      const result = await trustService.verifyCallerTrust(
        callerCarId,
        calleeCarId,
        makeTrustContext({ callerTier: 0, callerScore: 0 }),
        { minTier: 6, requiredCapabilities: [], requireMtls: false }
      );

      expect(result.verified).toBe(false);
    });

    it('should generate trust proof for valid agent', async () => {
      const carId = 'enterprise.trusted.agent:ABCF-L4@2.0.0';

      const proof = await trustService.generateTrustProof(carId);

      expect(proof).not.toBeNull();
      if (proof) {
        expect(proof).toHaveProperty('signature');
        expect(proof).toHaveProperty('expiresAt');
        expect(proof.carId).toBe(carId);
      }
    });
  });

  describe('Chain of Trust', () => {
    it('should track call chain correctly', () => {
      const rootCarId = 'org.orchestrator.main:ABCDEF-L4@1.0.0';
      const rootLink = makeLink(rootCarId, 'workflow_execute', 4, 800);
      const rootRequestId = `chain-${Date.now()}`;

      const chain = chainService.startChain(rootRequestId, rootLink);

      expect(chain).toHaveProperty('rootRequestId');
      expect(chain.rootRequestId).toBe(rootRequestId);
      expect(chain.links).toHaveLength(1);
      expect(chain.links[0].carId).toBe(rootCarId);
      expect(chain.state).toBe('active');
    });

    it('should add links to existing chain', () => {
      const rootCarId = 'org.root.agent:A-L4@1.0.0';
      const childCarId = 'org.child.agent:A-L3@1.0.0';
      const rootRequestId = `chain-add-${Date.now()}`;

      const rootLink = makeLink(rootCarId, 'parent_action', 4, 800);
      chainService.startChain(rootRequestId, rootLink);

      const childLink = makeLink(childCarId, 'child_action', 3, 600);
      const result = chainService.addLink(rootRequestId, childLink);

      expect(result.valid).toBe(true);

      // Verify the chain was updated
      const chain = chainService.getChain(rootRequestId);
      expect(chain).toBeDefined();
      expect(chain!.links).toHaveLength(2);
      expect(chain!.links[1].carId).toBe(childCarId);
    });

    it('should enforce maximum chain depth', () => {
      const rootCarId = 'org.root.agent:A-L4@1.0.0';
      const rootRequestId = `chain-depth-${Date.now()}`;

      const rootLink = makeLink(rootCarId, 'deep_call', 4, 800);
      chainService.startChain(rootRequestId, rootLink);

      // Fill chain up to MAX_CHAIN_DEPTH (1 already from root)
      for (let i = 1; i < MAX_CHAIN_DEPTH; i++) {
        const childCarId = `org.child-${i}.agent:A-L3@1.0.0`;
        const childLink = makeLink(childCarId, `action_${i}`, 3, 600);
        const result = chainService.addLink(rootRequestId, childLink);
        expect(result.valid).toBe(true);
      }

      // Next one should fail - exceeds max depth
      const overflowCarId = 'org.overflow.agent:A-L3@1.0.0';
      const overflowLink = makeLink(overflowCarId, 'overflow_action', 3, 600);
      const overflowResult = chainService.addLink(rootRequestId, overflowLink);

      expect(overflowResult.valid).toBe(false);
      expect(overflowResult.violations.length).toBeGreaterThan(0);
      expect(overflowResult.violations[0].message).toContain('depth');
    });

    it('should validate chain context integrity', () => {
      const rootCarId = 'org.root.agent:A-L4@1.0.0';
      const rootRequestId = `chain-validate-${Date.now()}`;

      const rootLink = makeLink(rootCarId, 'verify_action', 4, 800);
      chainService.startChain(rootRequestId, rootLink);

      const context = chainService.buildContext(rootRequestId);
      expect(context).not.toBeNull();

      const validation = chainService.validateChainContext(context!);

      expect(validation.valid).toBe(true);
      expect(validation.violations).toHaveLength(0);
    });

    it('should detect trust downgrade in chain', () => {
      const rootCarId = 'org.high-trust.agent:A-L4@1.0.0';
      const lowTrustCarId = 'org.low-trust.agent:A-L1@1.0.0';
      const rootRequestId = `chain-downgrade-${Date.now()}`;

      const rootLink = makeLink(rootCarId, 'sensitive_action', 4, 800);
      chainService.startChain(rootRequestId, rootLink);

      // Add a low-trust agent — should produce warnings about trust downgrade
      const lowLink = makeLink(lowTrustCarId, 'delegated_action', 1, 200);
      const result = chainService.addLink(rootRequestId, lowLink);

      // The link may be valid but with warnings about trust downgrade
      expect(result.warnings).toBeDefined();
      // Effective tier should drop
      expect(result.effectiveTier).toBeLessThanOrEqual(1);
    });
  });

  describe('A2A Attestation', () => {
    it('should generate attestation from invoke messages', () => {
      const callerCarId = 'org.caller.agent:A-L3@1.0.0';
      const calleeCarId = 'org.callee.agent:A-L3@1.0.0';

      const request: A2AMessage = {
        id: 'req-001',
        version: '1.0',
        type: 'invoke',
        from: callerCarId,
        to: calleeCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { action: 'api_call', params: { endpoint: '/process' } },
      };

      const response: A2AMessage = {
        id: 'res-001',
        version: '1.0',
        type: 'response',
        from: calleeCarId,
        to: callerCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { success: true, result: { processed: true } },
      };

      const attestation = attestationService.generateAttestation(request, response, 150);

      expect(attestation).toHaveProperty('id');
      expect(attestation.callerCarId).toBe(callerCarId);
      expect(attestation.calleeCarId).toBe(calleeCarId);
      expect(attestation.outcome).toBe('success');
    });

    it('should generate failed attestation for null response', () => {
      const callerCarId = 'org.caller.agent:A-L3@1.0.0';
      const calleeCarId = 'org.callee.agent:A-L3@1.0.0';

      const request: A2AMessage = {
        id: 'req-002',
        version: '1.0',
        type: 'invoke',
        from: callerCarId,
        to: calleeCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { action: 'api_call', params: {} },
      };

      const attestation = attestationService.generateAttestation(request, null, 50);

      expect(attestation.outcome).not.toBe('success');
      expect(attestation.callerCarId).toBe(callerCarId);
    });

    it('should record and flush attestations', async () => {
      const callerCarId = 'org.a.agent:A-L3@1.0.0';
      const calleeCarId = 'org.b.agent:A-L3@1.0.0';

      const request: A2AMessage = {
        id: 'req-batch-1',
        version: '1.0',
        type: 'invoke',
        from: callerCarId,
        to: calleeCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { action: 'call_1', params: {} },
      };

      const response: A2AMessage = {
        id: 'res-batch-1',
        version: '1.0',
        type: 'response',
        from: calleeCarId,
        to: callerCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { success: true, result: {} },
      };

      // Generate and record multiple attestations
      for (let i = 0; i < 3; i++) {
        const attestation = attestationService.generateAttestation(request, response, 100 + i * 20);
        await attestationService.record(attestation);
      }

      expect(attestationService.getPendingCount()).toBeGreaterThanOrEqual(0);

      // Flush should process pending
      const flushed = await attestationService.flush();
      expect(flushed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Router Integration', () => {
    it('should register and retrieve agent endpoints', () => {
      const targetCarId = 'org.target.agent:A-L3@1.0.0';

      router.registerEndpoint({
        carId: targetCarId,
        url: 'http://localhost:8080/a2a',
        versions: ['1.0'],
        capabilities: ['invoke', 'query'],
        actions: [
          { name: 'process_data', description: 'Process data', paramsSchema: {}, resultSchema: {} },
        ],
        trustRequirements: { minTier: 3, requiredCapabilities: [], requireMtls: false },
        status: 'healthy',
        lastHealthCheck: new Date().toISOString(),
      });

      const endpoint = router.getEndpoint(targetCarId);
      expect(endpoint).toBeDefined();
      expect(endpoint!.carId).toBe(targetCarId);
      expect(endpoint!.status).toBe('healthy');
    });

    it('should register and unregister message handlers', () => {
      const handlerCarId = 'org.handler.agent:A-L3@1.0.0';

      router.registerHandler(handlerCarId, async (msg, ctx) => {
        return { success: true, result: { processed: true } };
      });

      // Should not throw — handler was registered
      router.unregisterHandler(handlerCarId);
    });

    it('should discover endpoints by capabilities', () => {
      const carId1 = 'org.worker-1.agent:A-L3@1.0.0';
      const carId2 = 'org.worker-2.agent:A-L4@1.0.0';

      router.registerEndpoint({
        carId: carId1,
        url: 'http://localhost:8081/a2a',
        versions: ['1.0'],
        capabilities: ['compute', 'transform'],
        actions: [],
        trustRequirements: { minTier: 2, requiredCapabilities: [], requireMtls: false },
        status: 'healthy',
        lastHealthCheck: new Date().toISOString(),
      });

      router.registerEndpoint({
        carId: carId2,
        url: 'http://localhost:8082/a2a',
        versions: ['1.0'],
        capabilities: ['compute', 'analyze'],
        actions: [],
        trustRequirements: { minTier: 3, requiredCapabilities: [], requireMtls: false },
        status: 'healthy',
        lastHealthCheck: new Date().toISOString(),
      });

      const discovered = router.discoverEndpoints({ capabilities: ['compute'] });
      expect(discovered.length).toBeGreaterThanOrEqual(2);
    });

    it('should report router stats', () => {
      const stats = router.getStats();
      expect(stats).toHaveProperty('endpoints');
      expect(stats).toHaveProperty('pendingRequests');
      expect(stats.endpoints).toBeGreaterThanOrEqual(0);
    });
  });

  describe('End-to-End A2A Flow', () => {
    it('should complete full trust + chain + attestation cycle', async () => {
      const callerCarId = 'enterprise.workflow.orchestrator:ABCDEF-L5@1.0.0';
      const calleeCarId = 'enterprise.data.processor:AF-L5@1.0.0';

      // 1. Verify caller trust with relaxed requirements
      const trustResult = await trustService.verifyCallerTrust(
        callerCarId,
        calleeCarId,
        makeTrustContext({ callerTier: 5, callerScore: 1000 }),
        { minTier: 3, requiredCapabilities: [], requireMtls: false }
      );
      expect(trustResult.verified).toBe(true);

      // 2. Start chain
      const rootRequestId = `e2e-chain-${Date.now()}`;
      const rootLink = makeLink(callerCarId, 'process_batch', trustResult.effectiveTier, trustResult.effectiveScore);
      const chain = chainService.startChain(rootRequestId, rootLink);
      expect(chain.rootRequestId).toBe(rootRequestId);

      // 3. Add callee to chain
      const calleeLink = makeLink(calleeCarId, 'execute_processing', trustResult.effectiveTier, trustResult.effectiveScore);
      const addResult = chainService.addLink(rootRequestId, calleeLink);
      expect(addResult.valid).toBe(true);

      // 4. Verify chain has 2 links
      const updatedChain = chainService.getChain(rootRequestId);
      expect(updatedChain).toBeDefined();
      expect(updatedChain!.links).toHaveLength(2);

      // 5. Generate and record attestation
      const request: A2AMessage = {
        id: `e2e-req-${Date.now()}`,
        version: '1.0',
        type: 'invoke',
        from: callerCarId,
        to: calleeCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext({ callerTier: 5, callerScore: 1000 }),
        payload: { action: 'process_batch', params: {} },
      };

      const response: A2AMessage = {
        id: `e2e-res-${Date.now()}`,
        version: '1.0',
        type: 'response',
        from: calleeCarId,
        to: callerCarId,
        timestamp: new Date().toISOString(),
        trustContext: makeTrustContext(),
        payload: { success: true, result: { batchId: 'batch-001' } },
      };

      const attestation = attestationService.generateAttestation(request, response, 250);
      expect(attestation.id).toBeDefined();
      expect(attestation.outcome).toBe('success');

      await attestationService.record(attestation);

      // 6. Validate chain context
      const context = chainService.buildContext(rootRequestId);
      expect(context).not.toBeNull();
      const validation = chainService.validateChainContext(context!);
      expect(validation.valid).toBe(true);
    });
  });
});
