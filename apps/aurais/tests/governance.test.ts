import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock env before importing governance
vi.mock('@/lib/env', () => ({
  env: {
    COGNIGATE_API_URL: 'https://cognigate.test',
    COGNIGATE_API_KEY: 'test-api-key',
  },
}))

// Mock trust-tiers re-exports
vi.mock('@/lib/trust-tiers', () => ({
  TIER_THRESHOLDS: {},
  ALL_TIERS: [],
  getTierStylesFromScore: () => ({ name: 'Test', color: 'text-gray-400', bg: 'bg-gray-500/20' }),
  getTierStylesFromName: () => ({ name: 'Test', color: 'text-gray-400', bg: 'bg-gray-500/20' }),
  getTierColor: () => 'text-gray-400',
}))

import {
  getTierFromScore,
  getDecisionColor,
  getTrustStatusFromIntent,
  getDefaultTrustStatus,
  parseIntent,
  enforceGovernance,
  checkHealth,
  getProof,
  getProofStats,
  type IntentResult,
} from '@/lib/governance'

// =============================================================================
// getTierFromScore
// =============================================================================

describe('getTierFromScore', () => {
  it('returns sandbox for scores below 200', () => {
    expect(getTierFromScore(0)).toBe('sandbox')
    expect(getTierFromScore(100)).toBe('sandbox')
    expect(getTierFromScore(199)).toBe('sandbox')
  })

  it('returns observed for scores 200-349', () => {
    expect(getTierFromScore(200)).toBe('observed')
    expect(getTierFromScore(349)).toBe('observed')
  })

  it('returns provisional for scores 350-499', () => {
    expect(getTierFromScore(350)).toBe('provisional')
    expect(getTierFromScore(499)).toBe('provisional')
  })

  it('returns monitored for scores 500-649', () => {
    expect(getTierFromScore(500)).toBe('monitored')
    expect(getTierFromScore(649)).toBe('monitored')
  })

  it('returns standard for scores 650-799', () => {
    expect(getTierFromScore(650)).toBe('standard')
    expect(getTierFromScore(799)).toBe('standard')
  })

  it('returns trusted for scores 800-875', () => {
    expect(getTierFromScore(800)).toBe('trusted')
    expect(getTierFromScore(875)).toBe('trusted')
  })

  it('returns certified for scores 876-950', () => {
    expect(getTierFromScore(876)).toBe('certified')
    expect(getTierFromScore(950)).toBe('certified')
  })

  it('returns autonomous for scores 951+', () => {
    expect(getTierFromScore(951)).toBe('autonomous')
    expect(getTierFromScore(1000)).toBe('autonomous')
  })

  it('clamps scores to 0-1000', () => {
    expect(getTierFromScore(-50)).toBe('sandbox')
    expect(getTierFromScore(1500)).toBe('autonomous')
  })
})

// =============================================================================
// getDecisionColor
// =============================================================================

describe('getDecisionColor', () => {
  it('returns correct color for each decision', () => {
    expect(getDecisionColor('allow')).toContain('green')
    expect(getDecisionColor('deny')).toContain('red')
    expect(getDecisionColor('escalate')).toContain('yellow')
    expect(getDecisionColor('modify')).toContain('orange')
  })

  it('returns gray for unknown decision', () => {
    expect(getDecisionColor('unknown' as any)).toContain('gray')
  })
})

// =============================================================================
// getTrustStatusFromIntent
// =============================================================================

describe('getTrustStatusFromIntent', () => {
  it('maps IntentResult to TrustStatus correctly', () => {
    const intent: IntentResult = {
      intent_id: 'int-123',
      entity_id: 'agent-456',
      status: 'normalized',
      plan: null,
      trust_level: 4,
      trust_score: 700,
      created_at: '2026-01-01T00:00:00Z',
    }

    const status = getTrustStatusFromIntent(intent)
    expect(status.entityId).toBe('agent-456')
    expect(status.score).toBe(700)
    expect(status.tier).toBe('standard')
    expect(status.level).toBe(4)
    expect(status.createdAt).toBe('2026-01-01T00:00:00Z')
  })
})

// =============================================================================
// getDefaultTrustStatus
// =============================================================================

describe('getDefaultTrustStatus', () => {
  it('returns observed tier with score 200', () => {
    const status = getDefaultTrustStatus('new-agent')
    expect(status.entityId).toBe('new-agent')
    expect(status.score).toBe(200)
    expect(status.tier).toBe('observed')
    expect(status.level).toBe(1)
    expect(status.capabilities).toContain('sandbox:*')
  })
})

// =============================================================================
// API Client — parseIntent
// =============================================================================

describe('parseIntent', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockFetch.mockReset()
  })

  it('sends correct request to /v1/intent', async () => {
    const intentResponse: IntentResult = {
      intent_id: 'int-1',
      entity_id: 'agent-1',
      status: 'normalized',
      plan: {
        plan_id: 'plan-1',
        goal: 'Read customer data',
        tools_required: ['db_read'],
        endpoints_required: ['/api/customers'],
        data_classifications: ['pii'],
        risk_indicators: { data_access: 0.7 },
        risk_score: 0.5,
        reasoning_trace: 'Low risk read operation',
      },
      trust_level: 3,
      trust_score: 600,
      created_at: '2026-01-01T00:00:00Z',
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(intentResponse),
    })

    const result = await parseIntent('agent-1', 'Read customer data')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://cognigate.test/v1/intent')
    expect(options.method).toBe('POST')
    expect(options.headers['X-API-Key']).toBe('test-api-key')

    const body = JSON.parse(options.body)
    expect(body.entity_id).toBe('agent-1')
    expect(body.goal).toBe('Read customer data')
    expect(body.context.source).toBe('aurais-chat')

    expect(result.intent_id).toBe('int-1')
    expect(result.plan?.goal).toBe('Read customer data')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ detail: 'Invalid entity_id' }),
    })

    await expect(parseIntent('bad', 'test')).rejects.toThrow('Invalid entity_id')
  })
})

// =============================================================================
// API Client — enforceGovernance
// =============================================================================

describe('enforceGovernance', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockFetch.mockReset()
  })

  it('throws when intent has no plan', async () => {
    const intent: IntentResult = {
      intent_id: 'int-1',
      entity_id: 'agent-1',
      status: 'blocked',
      plan: null,
      trust_level: 1,
      trust_score: 100,
      created_at: '2026-01-01T00:00:00Z',
    }

    await expect(enforceGovernance(intent)).rejects.toThrow('Cannot enforce: intent has no plan')
  })

  it('sends correct EnforceRequest format', async () => {
    const intent: IntentResult = {
      intent_id: 'int-1',
      entity_id: 'agent-1',
      status: 'normalized',
      plan: {
        plan_id: 'plan-1',
        goal: 'Read data',
        tools_required: [],
        endpoints_required: [],
        data_classifications: [],
        risk_indicators: {},
        risk_score: 0.2,
        reasoning_trace: 'test',
      },
      trust_level: 3,
      trust_score: 600,
      created_at: '2026-01-01T00:00:00Z',
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verdict_id: 'v-1', allowed: true, action: 'allow' }),
    })

    await enforceGovernance(intent, { rigorMode: 'strict' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://cognigate.test/v1/enforce')
    const body = JSON.parse(options.body)
    expect(body.plan.plan_id).toBe('plan-1')
    expect(body.entity_id).toBe('agent-1')
    expect(body.trust_level).toBe(3)
    expect(body.trust_score).toBe(600)
    expect(body.rigor_mode).toBe('strict')
  })
})

// =============================================================================
// API Client — checkHealth
// =============================================================================

describe('checkHealth', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockFetch.mockReset()
  })

  it('calls /health (not /v1/health)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'healthy',
          version: '1.0.0',
          basis_version: '0.3.0',
          layers: { intent: 'ok', enforce: 'ok', proof: 'ok' },
        }),
    })

    const result = await checkHealth()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://cognigate.test/health')
    expect(result.status).toBe('healthy')
    expect(result.basisVersion).toBe('0.3.0')
  })

  it('returns unhealthy on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await checkHealth()
    expect(result.status).toBe('unhealthy')
    expect(result.version).toBe('unknown')
  })
})

// =============================================================================
// API Client — getProof
// =============================================================================

describe('getProof', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockFetch.mockReset()
  })

  it('maps snake_case response to camelCase', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          proof_id: 'p-1',
          intent_id: 'int-1',
          timestamp: '2026-01-01T00:00:00Z',
          payload_hash: 'abc123',
          previous_proof_id: null,
          previous_hash: null,
          sequence_number: 1,
          signature: 'sig-xyz',
        }),
    })

    const result = await getProof('p-1')
    expect(result.proofId).toBe('p-1')
    expect(result.intentId).toBe('int-1')
    expect(result.payloadHash).toBe('abc123')
    expect(result.sequenceNumber).toBe(1)
    expect(result.signature).toBe('sig-xyz')
  })
})

// =============================================================================
// API Client — getProofStats
// =============================================================================

describe('getProofStats', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockFetch.mockReset()
  })

  it('returns degraded on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const result = await getProofStats()
    expect(result.status).toBe('degraded')
    expect(result.chainLength).toBe(0)
  })

  it('returns healthy stats on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          proof_chain_length: 42,
          last_proof_at: '2026-01-01T00:00:00Z',
        }),
    })

    const result = await getProofStats()
    expect(result.status).toBe('healthy')
    expect(result.chainLength).toBe(42)
  })
})
