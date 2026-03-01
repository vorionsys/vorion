/**
 * CAR CLI - Client Configuration Tests
 *
 * Tests the getClient() function behavior by verifying how createCARClient
 * is called with different environment variable combinations.
 *
 * Since getClient() is not exported, we test it indirectly by triggering
 * a command handler and inspecting the createCARClient mock call arguments.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Capture registered commands (same pattern as cli-commands.test.ts)
// ---------------------------------------------------------------------------

type RegisteredCommand = {
  name: string
  description: string
  args: string[]
  options: Array<{ flags: string; description: string; defaultValue?: string }>
  action: (...args: any[]) => Promise<void>
}

const registeredCommands: RegisteredCommand[] = []

function createCommandChain() {
  const cmd: RegisteredCommand = {
    name: '',
    description: '',
    args: [],
    options: [],
    action: async () => {},
  }

  const chain: any = {
    description(desc: string) {
      cmd.description = desc
      return chain
    },
    option(flags: string, desc: string, defaultValue?: string) {
      cmd.options.push({ flags, description: desc, defaultValue })
      return chain
    },
    action(fn: (...args: any[]) => Promise<void>) {
      cmd.action = fn
      registeredCommands.push(cmd)
      return chain
    },
  }

  return { cmd, chain }
}

const programChain: any = {}
programChain.name = vi.fn(() => programChain)
programChain.description = vi.fn(() => programChain)
programChain.version = vi.fn(() => programChain)
programChain.command = vi.fn((nameAndArgs: string) => {
  const parts = nameAndArgs.split(/\s+/)
  const { cmd, chain } = createCommandChain()
  cmd.name = parts[0]
  cmd.args = parts.slice(1)
  return chain
})
programChain.parse = vi.fn()

vi.mock('commander', () => ({
  Command: vi.fn().mockImplementation(() => programChain),
}))

// Mock chalk, ora, cli-table3
const identity = (s: string) => s
const chalkMock: any = new Proxy(identity, {
  get(_target, prop) {
    if (prop === 'bgRed') return chalkMock
    return identity
  },
  apply(_target, _thisArg, args) {
    return args[0]
  },
})
vi.mock('chalk', () => ({ default: chalkMock }))

const spinnerMock = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
}
vi.mock('ora', () => ({ default: vi.fn(() => spinnerMock) }))
vi.mock('cli-table3', () => ({
  default: vi.fn().mockImplementation(() => ({
    push: vi.fn(),
    toString: vi.fn().mockReturnValue('[table]'),
  })),
}))

// ---------------------------------------------------------------------------
// Mock @vorionsys/car-client with spying on createCARClient
// ---------------------------------------------------------------------------

const mockClient = {
  getStats: vi.fn(),
  evaluateRoleGate: vi.fn(),
  checkCeiling: vi.fn(),
  getProvenance: vi.fn(),
  getGamingAlerts: vi.fn(),
  getPresetHierarchy: vi.fn(),
}

const createCARClientSpy = vi.fn(() => mockClient)

vi.mock('@vorionsys/car-client', () => ({
  createCARClient: createCARClientSpy,
  CARClient: vi.fn(),
  CARError: class CARError extends Error {
    statusCode: number
    constructor(msg: string, code: number) {
      super(msg)
      this.statusCode = code
    }
  },
  TrustTier: {},
  AgentRole: {},
  TRUST_TIER_LABELS: {
    T0: 'Sandbox', T1: 'Probation', T2: 'Limited', T3: 'Standard',
    T4: 'Trusted', T5: 'Elevated', T6: 'Autonomous', T7: 'Sovereign',
  },
  AGENT_ROLE_LABELS: {
    R_L0: 'Listener', R_L1: 'Executor', R_L2: 'Planner', R_L3: 'Orchestrator',
    R_L4: 'Architect', R_L5: 'Governor', R_L6: 'Sovereign', R_L7: 'Meta-Agent',
    R_L8: 'Ecosystem Controller',
  },
}))

// ---------------------------------------------------------------------------
// Import CLI once
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await import('../src/cli.js')
})

function findCommand(name: string): RegisteredCommand | undefined {
  return registeredCommands.find((c) => c.name === name)
}

// Save original env
const originalEnv = { ...process.env }

// Default stats response used to avoid errors in the handler
const defaultStatsResponse = {
  stats: {
    contextStats: { deployments: 0, organizations: 0, agents: 0, activeOperations: 0 },
    ceilingStats: { complianceBreakdown: { compliant: 0, warning: 0, violation: 0 } },
    roleGateStats: { byDecision: { ALLOW: 0, DENY: 0, ESCALATE: 0 } },
  },
  tierDistribution: [],
  version: { major: 1, minor: 0, patch: 0 },
}

// =============================================================================
// TESTS
// =============================================================================

describe('CAR CLI - getClient() environment variable resolution', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)

    // Clear all CAR/VORION env vars
    delete process.env.CAR_API_URL
    delete process.env.VORION_BASE_URL
    delete process.env.CAR_API_KEY
    delete process.env.VORION_API_KEY
  })

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv }
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('uses default localhost:3000 when no env vars are set', async () => {
    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:3000',
      apiKey: undefined,
      timeout: 30000,
    })
  })

  it('prefers CAR_API_URL over VORION_BASE_URL', async () => {
    process.env.CAR_API_URL = 'https://car-api.example.com'
    process.env.VORION_BASE_URL = 'https://vorion.example.com'

    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://car-api.example.com',
      })
    )
  })

  it('falls back to VORION_BASE_URL when CAR_API_URL is not set', async () => {
    process.env.VORION_BASE_URL = 'https://vorion.example.com'

    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://vorion.example.com',
      })
    )
  })

  it('prefers CAR_API_KEY over VORION_API_KEY', async () => {
    process.env.CAR_API_KEY = 'car-secret-key'
    process.env.VORION_API_KEY = 'vorion-secret-key'

    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'car-secret-key',
      })
    )
  })

  it('falls back to VORION_API_KEY when CAR_API_KEY is not set', async () => {
    process.env.VORION_API_KEY = 'vorion-secret-key'

    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'vorion-secret-key',
      })
    )
  })

  it('always sets timeout to 30000ms', async () => {
    mockClient.getStats.mockResolvedValueOnce(defaultStatsResponse)

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(createCARClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 30000,
      })
    )
  })
})
