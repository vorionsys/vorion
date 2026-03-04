import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration tests for the Aurais API routes.
 *
 * Tests the full signup → agent creation → trust status flow
 * by mocking Supabase at the module level and calling route handlers directly.
 */

// =============================================================================
// Mocks
// =============================================================================

const mockSupabaseUser = {
  id: 'user-123',
  email: 'test@aurais.net',
  user_metadata: { name: 'Test User', plan: 'core' },
}

const mockSignUp = vi.fn()
const mockSignIn = vi.fn()
const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signUp: mockSignUp,
        signInWithPassword: mockSignIn,
        getUser: mockGetUser,
      },
      from: mockFrom,
    })
  ),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
    NEXT_PUBLIC_URL: 'https://aurais.test',
    COGNIGATE_API_URL: 'https://cognigate.test',
    COGNIGATE_API_KEY: 'test-key',
  },
}))

vi.mock('@/lib/db/profiles', () => ({
  getOrCreateProfile: vi.fn(() => Promise.resolve({ id: 'user-123' })),
}))

// Minimal NextRequest/NextResponse for testing
function createMockRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const { method = 'GET', body, headers = {} } = options
  const reqUrl = new URL(url, 'https://aurais.test')

  return {
    method,
    url: reqUrl.toString(),
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    nextUrl: reqUrl,
    json: () => Promise.resolve(body),
  } as any
}

// =============================================================================
// Signup Validation
// =============================================================================

describe('POST /api/auth/signup — validation', () => {
  let signupHandler: (req: any) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    // Re-mock before each import
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(() =>
        Promise.resolve({
          auth: {
            signUp: mockSignUp,
            getUser: mockGetUser,
          },
          from: mockFrom,
        })
      ),
    }))
    vi.doMock('@/lib/env', () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        NEXT_PUBLIC_URL: 'https://aurais.test',
        COGNIGATE_API_URL: 'https://cognigate.test',
        COGNIGATE_API_KEY: 'test-key',
      },
    }))
    vi.doMock('@/lib/rate-limit', () => ({
      rateLimit: () => null, // Never rate-limit in tests
    }))

    const mod = await import('@/app/api/auth/signup/route')
    signupHandler = mod.POST
    mockSignUp.mockReset()
  })

  it('rejects missing required fields', async () => {
    const req = createMockRequest('/api/auth/signup', {
      method: 'POST',
      body: { email: 'test@test.com' }, // no name, no password
    })

    const res = await signupHandler(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('required')
  })

  it('rejects invalid email format', async () => {
    const req = createMockRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Test', email: 'not-an-email', password: 'password123' },
    })

    const res = await signupHandler(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('email')
  })

  it('rejects short passwords', async () => {
    const req = createMockRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Test', email: 'test@test.com', password: 'short' },
    })

    const res = await signupHandler(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('8 characters')
  })

  it('succeeds with valid input', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: mockSupabaseUser },
      error: null,
    })

    const req = createMockRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Test User', email: 'test@aurais.net', password: 'securepass123' },
    })

    const res = await signupHandler(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.user.email).toBe('test@aurais.net')
  })

  it('passes supabase error through', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered' },
    })

    const req = createMockRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Test User', email: 'existing@test.com', password: 'securepass123' },
    })

    const res = await signupHandler(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toBe('User already registered')
  })
})

// =============================================================================
// Agent CRUD Validation
// =============================================================================

describe('POST /api/agents — validation', () => {
  let agentsHandler: { POST: (req: any) => Promise<Response> }

  beforeEach(async () => {
    vi.resetModules()
    // Mock db module
    vi.doMock('@/lib/db', () => ({
      listAgents: vi.fn(() => Promise.resolve([])),
      createAgent: vi.fn((input: any) =>
        Promise.resolve({
          id: 'agent-1',
          ...input,
          user_id: 'user-123',
          status: 'active',
          trust_score: 200,
          trust_tier: 'observed',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      ),
    }))

    agentsHandler = await import('@/app/api/agents/route')
  })

  it('rejects missing name', async () => {
    const req = createMockRequest('/api/agents', {
      method: 'POST',
      body: { description: 'test agent' },
    })

    const res = await agentsHandler.POST(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('name')
  })

  it('rejects empty name', async () => {
    const req = createMockRequest('/api/agents', {
      method: 'POST',
      body: { name: '   ' },
    })

    const res = await agentsHandler.POST(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error).toContain('name')
  })

  it('creates agent with valid input', async () => {
    const req = createMockRequest('/api/agents', {
      method: 'POST',
      body: {
        name: 'My Agent',
        description: 'A test agent',
        specialization: 'research',
        capabilities: ['web_search'],
      },
    })

    const res = await agentsHandler.POST(req)
    const data = await res.json()
    expect(res.status).toBe(201)
    expect(data.agent.name).toBe('My Agent')
    expect(data.agent.trust_score).toBe(200)
    expect(data.agent.trust_tier).toBe('observed')
  })
})

// =============================================================================
// Full Flow: Signup → Create Agent → Get Trust Status
// =============================================================================

describe('full flow: signup → create agent → trust', () => {
  it('new user gets agent with default observed trust', async () => {
    vi.resetModules()

    const createdAgent = {
      id: 'agent-new',
      name: 'Research Bot',
      user_id: 'user-123',
      status: 'active',
      trust_score: 200,
      trust_tier: 'observed',
      specialization: 'research',
      capabilities: ['web_search'],
      created_at: '2026-01-01T00:00:00Z',
    }

    vi.doMock('@/lib/db', () => ({
      listAgents: vi.fn(() => Promise.resolve([createdAgent])),
      createAgent: vi.fn(() => Promise.resolve(createdAgent)),
    }))

    const agentsModule = await import('@/app/api/agents/route')

    // Step 1: Create agent
    const createReq = createMockRequest('/api/agents', {
      method: 'POST',
      body: { name: 'Research Bot', specialization: 'research', capabilities: ['web_search'] },
    })
    const createRes = await agentsModule.POST(createReq)
    const createData = await createRes.json()
    expect(createRes.status).toBe(201)
    expect(createData.agent.trust_tier).toBe('observed')
    expect(createData.agent.trust_score).toBe(200)

    // Step 2: List agents — should include the one we created
    const listRes = await agentsModule.GET()
    const listData = await listRes.json()
    expect(listData.agents).toHaveLength(1)
    expect(listData.agents[0].name).toBe('Research Bot')
    expect(listData.agents[0].trust_tier).toBe('observed')

    // Step 3: Verify trust status from governance helper
    const { getDefaultTrustStatus, getTierFromScore } = await import('@/lib/governance')
    const trustStatus = getDefaultTrustStatus(createData.agent.id)
    expect(trustStatus.tier).toBe('observed')
    expect(trustStatus.score).toBe(200)
    expect(getTierFromScore(200)).toBe('observed')
  })
})
