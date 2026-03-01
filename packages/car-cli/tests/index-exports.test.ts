/**
 * CAR CLI - Index Exports Tests
 *
 * Verifies that all expected exports from @vorionsys/car-cli are present,
 * correctly typed, and that backward-compatible aliases work properly.
 */

import { describe, it, expect } from 'vitest'

// Import everything from the package entry point
import * as carCli from '../src/index.js'

// =============================================================================
// TESTS
// =============================================================================

describe('car-cli index - Primary exports', () => {
  it('exports createCARClient factory function', () => {
    expect(carCli.createCARClient).toBeDefined()
    expect(typeof carCli.createCARClient).toBe('function')
  })

  it('exports CARClient class', () => {
    expect(carCli.CARClient).toBeDefined()
    expect(typeof carCli.CARClient).toBe('function')
  })

  it('exports CARError class', () => {
    expect(carCli.CARError).toBeDefined()
    expect(typeof carCli.CARError).toBe('function')
  })

  it('exports createLocalCARClient factory function', () => {
    expect(carCli.createLocalCARClient).toBeDefined()
    expect(typeof carCli.createLocalCARClient).toBe('function')
  })
})

describe('car-cli index - Backward-compatible aliases (deprecated)', () => {
  it('exports createACIClient as alias for createCARClient', () => {
    expect(carCli.createACIClient).toBeDefined()
    expect(carCli.createACIClient).toBe(carCli.createCARClient)
  })

  it('exports ACIClient as alias for CARClient', () => {
    expect(carCli.ACIClient).toBeDefined()
    expect(carCli.ACIClient).toBe(carCli.CARClient)
  })

  it('exports ACIError as alias for CARError', () => {
    expect(carCli.ACIError).toBeDefined()
    expect(carCli.ACIError).toBe(carCli.CARError)
  })

  it('exports createLocalACIClient as alias for createLocalCARClient', () => {
    expect(carCli.createLocalACIClient).toBeDefined()
    expect(carCli.createLocalACIClient).toBe(carCli.createLocalCARClient)
  })
})

describe('car-cli index - Constants re-exported from car-client', () => {
  it('exports TRUST_TIER_RANGES with all 8 tiers', () => {
    expect(carCli.TRUST_TIER_RANGES).toBeDefined()
    const tiers = Object.keys(carCli.TRUST_TIER_RANGES)
    expect(tiers).toContain('T0')
    expect(tiers).toContain('T7')
    // Each tier should have min and max
    for (const tier of tiers) {
      const range = carCli.TRUST_TIER_RANGES[tier as keyof typeof carCli.TRUST_TIER_RANGES]
      expect(range).toHaveProperty('min')
      expect(range).toHaveProperty('max')
      expect(typeof range.min).toBe('number')
      expect(typeof range.max).toBe('number')
    }
  })

  it('exports TRUST_TIER_LABELS with all 8 tiers', () => {
    expect(carCli.TRUST_TIER_LABELS).toBeDefined()
    const tiers = Object.keys(carCli.TRUST_TIER_LABELS)
    expect(tiers).toContain('T0')
    expect(tiers).toContain('T7')
    for (const tier of tiers) {
      expect(typeof carCli.TRUST_TIER_LABELS[tier as keyof typeof carCli.TRUST_TIER_LABELS]).toBe('string')
    }
  })

  it('exports AGENT_ROLE_LABELS with all 9 roles (R_L0 to R_L8)', () => {
    expect(carCli.AGENT_ROLE_LABELS).toBeDefined()
    const roles = Object.keys(carCli.AGENT_ROLE_LABELS)
    expect(roles).toHaveLength(9)
    expect(roles).toContain('R_L0')
    expect(roles).toContain('R_L8')
    expect(carCli.AGENT_ROLE_LABELS.R_L0).toBe('Listener')
    expect(carCli.AGENT_ROLE_LABELS.R_L3).toBe('Orchestrator')
    expect(carCli.AGENT_ROLE_LABELS.R_L8).toBe('Ecosystem Controller')
  })

  it('exports DEFAULT_PROVENANCE_MODIFIERS for all creation types', () => {
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS).toBeDefined()
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS.FRESH).toBe(0)
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS.CLONED).toBe(-50)
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS.EVOLVED).toBe(100)
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS.PROMOTED).toBe(150)
    expect(carCli.DEFAULT_PROVENANCE_MODIFIERS.IMPORTED).toBe(-100)
  })

  it('exports REGULATORY_CEILINGS for all frameworks', () => {
    expect(carCli.REGULATORY_CEILINGS).toBeDefined()
    expect(carCli.REGULATORY_CEILINGS.EU_AI_ACT).toBe(699)
    expect(carCli.REGULATORY_CEILINGS.NIST_AI_RMF).toBe(899)
    expect(carCli.REGULATORY_CEILINGS.ISO_42001).toBe(799)
    expect(carCli.REGULATORY_CEILINGS.DEFAULT).toBe(1000)
  })
})

describe('car-cli index - Zod schemas re-exported from car-client', () => {
  it('exports TrustTierSchema', () => {
    expect(carCli.TrustTierSchema).toBeDefined()
    // Verify it parses valid tiers
    expect(carCli.TrustTierSchema.parse('T0')).toBe('T0')
    expect(carCli.TrustTierSchema.parse('T7')).toBe('T7')
  })

  it('exports AgentRoleSchema', () => {
    expect(carCli.AgentRoleSchema).toBeDefined()
    expect(carCli.AgentRoleSchema.parse('R_L0')).toBe('R_L0')
    expect(carCli.AgentRoleSchema.parse('R_L8')).toBe('R_L8')
  })

  it('exports RoleGateRequestSchema', () => {
    expect(carCli.RoleGateRequestSchema).toBeDefined()
    const valid = carCli.RoleGateRequestSchema.parse({
      agentId: 'agent-1',
      requestedRole: 'R_L3',
      currentTier: 'T3',
    })
    expect(valid.agentId).toBe('agent-1')
  })

  it('exports CeilingCheckRequestSchema', () => {
    expect(carCli.CeilingCheckRequestSchema).toBeDefined()
    const valid = carCli.CeilingCheckRequestSchema.parse({
      agentId: 'agent-1',
      proposedScore: 750,
    })
    expect(valid.proposedScore).toBe(750)
  })

  it('exports ProvenanceCreateRequestSchema', () => {
    expect(carCli.ProvenanceCreateRequestSchema).toBeDefined()
    const valid = carCli.ProvenanceCreateRequestSchema.parse({
      agentId: 'agent-1',
      creationType: 'FRESH',
      createdBy: 'system',
    })
    expect(valid.creationType).toBe('FRESH')
  })

  it('exports CreationTypeSchema', () => {
    expect(carCli.CreationTypeSchema).toBeDefined()
    expect(carCli.CreationTypeSchema.parse('CLONED')).toBe('CLONED')
  })

  it('exports RoleGateDecisionSchema', () => {
    expect(carCli.RoleGateDecisionSchema).toBeDefined()
    expect(carCli.RoleGateDecisionSchema.parse('ALLOW')).toBe('ALLOW')
    expect(carCli.RoleGateDecisionSchema.parse('DENY')).toBe('DENY')
    expect(carCli.RoleGateDecisionSchema.parse('ESCALATE')).toBe('ESCALATE')
  })

  it('exports ComplianceStatusSchema', () => {
    expect(carCli.ComplianceStatusSchema).toBeDefined()
    expect(carCli.ComplianceStatusSchema.parse('COMPLIANT')).toBe('COMPLIANT')
  })

  it('exports GamingAlertTypeSchema', () => {
    expect(carCli.GamingAlertTypeSchema).toBeDefined()
    expect(carCli.GamingAlertTypeSchema.parse('RAPID_CHANGE')).toBe('RAPID_CHANGE')
  })

  it('exports AlertSeveritySchema', () => {
    expect(carCli.AlertSeveritySchema).toBeDefined()
    expect(carCli.AlertSeveritySchema.parse('CRITICAL')).toBe('CRITICAL')
  })

  it('exports AlertStatusSchema', () => {
    expect(carCli.AlertStatusSchema).toBeDefined()
    expect(carCli.AlertStatusSchema.parse('ACTIVE')).toBe('ACTIVE')
  })
})

describe('car-cli index - Utility functions re-exported from car-client', () => {
  it('exports getTierFromScore function', () => {
    expect(typeof carCli.getTierFromScore).toBe('function')
  })

  it('getTierFromScore returns correct tiers for known score ranges', () => {
    expect(carCli.getTierFromScore(0)).toBe('T0')
    expect(carCli.getTierFromScore(199)).toBe('T0')
    expect(carCli.getTierFromScore(200)).toBe('T1')
    expect(carCli.getTierFromScore(349)).toBe('T1')
    expect(carCli.getTierFromScore(350)).toBe('T2')
    expect(carCli.getTierFromScore(500)).toBe('T3')
    expect(carCli.getTierFromScore(650)).toBe('T4')
    expect(carCli.getTierFromScore(800)).toBe('T5')
    expect(carCli.getTierFromScore(876)).toBe('T6')
    expect(carCli.getTierFromScore(951)).toBe('T7')
    expect(carCli.getTierFromScore(1000)).toBe('T7')
  })

  it('exports isRoleAllowedForTier function', () => {
    expect(typeof carCli.isRoleAllowedForTier).toBe('function')
  })

  it('isRoleAllowedForTier enforces kernel-layer role/tier constraints', () => {
    // R_L0 and R_L1 allowed for any tier
    expect(carCli.isRoleAllowedForTier('R_L0', 'T0')).toBe(true)
    expect(carCli.isRoleAllowedForTier('R_L1', 'T0')).toBe(true)

    // R_L2 requires T1+
    expect(carCli.isRoleAllowedForTier('R_L2', 'T0')).toBe(false)
    expect(carCli.isRoleAllowedForTier('R_L2', 'T1')).toBe(true)

    // R_L3 requires T2+
    expect(carCli.isRoleAllowedForTier('R_L3', 'T1')).toBe(false)
    expect(carCli.isRoleAllowedForTier('R_L3', 'T2')).toBe(true)

    // R_L4 requires T3+
    expect(carCli.isRoleAllowedForTier('R_L4', 'T2')).toBe(false)
    expect(carCli.isRoleAllowedForTier('R_L4', 'T3')).toBe(true)

    // R_L5 requires T4+
    expect(carCli.isRoleAllowedForTier('R_L5', 'T3')).toBe(false)
    expect(carCli.isRoleAllowedForTier('R_L5', 'T4')).toBe(true)

    // R_L6, R_L7, R_L8 require T5+
    expect(carCli.isRoleAllowedForTier('R_L6', 'T4')).toBe(false)
    expect(carCli.isRoleAllowedForTier('R_L6', 'T5')).toBe(true)
    expect(carCli.isRoleAllowedForTier('R_L7', 'T5')).toBe(true)
    expect(carCli.isRoleAllowedForTier('R_L8', 'T5')).toBe(true)
  })
})

describe('car-cli index - CARClient instantiation via re-exports', () => {
  it('createCARClient produces a working CARClient instance', () => {
    const client = carCli.createCARClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
    })
    expect(client).toBeInstanceOf(carCli.CARClient)
  })

  it('createLocalCARClient creates a debug client on localhost', () => {
    const client = carCli.createLocalCARClient(4000)
    expect(client).toBeInstanceOf(carCli.CARClient)
  })

  it('CARError instances have correct properties', () => {
    const err = new carCli.CARError('test error', 503, { detail: 'service down' })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(carCli.CARError)
    expect(err.message).toBe('test error')
    expect(err.name).toBe('CARError')
    expect(err.statusCode).toBe(503)
    expect(err.details).toEqual({ detail: 'service down' })
  })

  it('CARError status helpers work correctly', () => {
    const clientErr = new carCli.CARError('bad request', 400)
    expect(clientErr.isClientError()).toBe(true)
    expect(clientErr.isServerError()).toBe(false)
    expect(clientErr.isTimeout()).toBe(false)

    const serverErr = new carCli.CARError('server error', 500)
    expect(serverErr.isServerError()).toBe(true)
    expect(serverErr.isClientError()).toBe(false)

    const timeoutErr = new carCli.CARError('timeout', 408)
    expect(timeoutErr.isTimeout()).toBe(true)
    expect(timeoutErr.isStatus(408)).toBe(true)
    expect(timeoutErr.isStatus(500)).toBe(false)
  })
})
