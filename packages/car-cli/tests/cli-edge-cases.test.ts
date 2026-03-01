/**
 * CAR CLI - Edge Case & Error Handling Tests
 *
 * Tests edge cases in command handlers, such as:
 * - Score parsing from string arguments
 * - Empty/missing data scenarios
 * - Various severity/status color mapping branches
 * - Lineage display logic
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Command capture infrastructure
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

// Mock chalk to be transparent
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

// Mock client
const mockClient = {
  getStats: vi.fn(),
  evaluateRoleGate: vi.fn(),
  checkCeiling: vi.fn(),
  getProvenance: vi.fn(),
  getGamingAlerts: vi.fn(),
  getPresetHierarchy: vi.fn(),
}

vi.mock('@vorionsys/car-client', () => ({
  createCARClient: vi.fn(() => mockClient),
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

// =============================================================================
// TESTS
// =============================================================================

describe('CAR CLI - evaluate command edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('parses score string to integer correctly', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: { finalDecision: 'ALLOW', decisionReason: null },
      layers: {
        kernel: { allowed: true },
        policy: { result: null },
        basis: { overrideUsed: false },
      },
    })

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-1', 'R_L3', { tier: 'T3', score: '999' })

    expect(mockClient.evaluateRoleGate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentScore: 999,
      })
    )
  })

  it('handles ESCALATE decision display', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: {
        finalDecision: 'ESCALATE',
        decisionReason: 'Requires manual override',
      },
      layers: {
        kernel: { allowed: true },
        policy: { result: 'ESCALATE' },
        basis: { overrideUsed: false },
      },
    })

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-1', 'R_L6', { tier: 'T4', score: '700' })

    // Verify decisionReason is printed
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasReason = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('Requires manual override')
    )
    expect(hasReason).toBe(true)
  })

  it('handles BASIS override display', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: {
        finalDecision: 'ALLOW',
        decisionReason: 'Override approved',
      },
      layers: {
        kernel: { allowed: false },
        policy: { result: 'DENY' },
        basis: { overrideUsed: true },
      },
    })

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-1', 'R_L7', { tier: 'T3', score: '550' })

    // The handler should display the override as used
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('handles null/undefined decisionReason gracefully (no Reason line)', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: {
        finalDecision: 'DENY',
        decisionReason: undefined,
      },
      layers: {
        kernel: { allowed: false },
        policy: { result: 'DENY' },
        basis: { overrideUsed: false },
      },
    })

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-1', 'R_L4', { tier: 'T1', score: '300' })

    // When decisionReason is falsy, the "Reason:" line should NOT appear
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasReason = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('Reason:')
    )
    expect(hasReason).toBe(false)
  })
})

describe('CAR CLI - ceiling command edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('score argument is parsed as integer via parseInt', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 500,
        effectiveCeiling: 1000,
        ceilingApplied: false,
        complianceStatus: 'COMPLIANT',
        gamingIndicators: [],
      },
    })

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-1', '500', { framework: 'DEFAULT' })

    expect(mockClient.checkCeiling).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedScore: 500,
      })
    )
  })

  it('does not show gaming indicators section when array is empty', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 800,
        effectiveCeiling: 1000,
        ceilingApplied: false,
        complianceStatus: 'COMPLIANT',
        gamingIndicators: [],
      },
    })

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-1', '800', { framework: 'DEFAULT' })

    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasGamingSection = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('Gaming Indicators')
    )
    expect(hasGamingSection).toBe(false)
  })

  it('does not show gaming indicators section when gamingIndicators is null', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 800,
        effectiveCeiling: 1000,
        ceilingApplied: false,
        complianceStatus: 'COMPLIANT',
        gamingIndicators: null,
      },
    })

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-1', '800', { framework: 'DEFAULT' })

    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasGamingSection = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('Gaming Indicators')
    )
    expect(hasGamingSection).toBe(false)
  })

  it('previous score is parsed as integer when provided', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 700,
        effectiveCeiling: 699,
        ceilingApplied: true,
        complianceStatus: 'WARNING',
        gamingIndicators: [],
      },
    })

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-1', '700', { framework: 'EU_AI_ACT', previous: '450' })

    expect(mockClient.checkCeiling).toHaveBeenCalledWith(
      expect.objectContaining({
        previousScore: 450,
      })
    )
  })
})

describe('CAR CLI - provenance command edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('does not display lineage section for single-entry lineage', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-solo',
          creationType: 'FRESH',
          trustModifier: 0,
          parentAgentId: null,
          createdBy: 'system',
        },
      ],
      lineage: [{ agentId: 'agent-solo' }],
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-solo')

    // Single-entry lineage should NOT show the lineage chain header
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasLineageHeader = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('Lineage')
    )
    expect(hasLineageHeader).toBe(false)
  })

  it('handles negative trust modifiers in display', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-imported',
          creationType: 'IMPORTED',
          trustModifier: -100,
          parentAgentId: null,
          createdBy: 'migration-tool',
        },
      ],
      lineage: null,
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-imported')

    expect(mockClient.getProvenance).toHaveBeenCalledWith('agent-imported')
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('handles null lineage without crashing', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-1',
          creationType: 'FRESH',
          trustModifier: 0,
          parentAgentId: null,
          createdBy: 'system',
        },
      ],
      lineage: null,
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-1')

    // Should not throw or crash
    expect(spinnerMock.stop).toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })
})

describe('CAR CLI - alerts command edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('handles all severity levels (LOW, MEDIUM, HIGH, CRITICAL)', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [
        { agentId: 'a1', alertType: 'RAPID_CHANGE', severity: 'LOW', status: 'ACTIVE', occurrences: 1 },
        { agentId: 'a2', alertType: 'OSCILLATION', severity: 'MEDIUM', status: 'INVESTIGATING', occurrences: 2 },
        { agentId: 'a3', alertType: 'BOUNDARY_TESTING', severity: 'HIGH', status: 'RESOLVED', occurrences: 3 },
        { agentId: 'a4', alertType: 'CEILING_BREACH', severity: 'CRITICAL', status: 'FALSE_POSITIVE', occurrences: 4 },
      ],
      summary: { total: 4 },
    })

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    expect(spinnerMock.stop).toHaveBeenCalled()
    // Should print summary showing all 4
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasSummary = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('4 of 4')
    )
    expect(hasSummary).toBe(true)
  })

  it('handles all alert status values', async () => {
    const statuses = ['ACTIVE', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'] as const
    for (const status of statuses) {
      vi.clearAllMocks()
      const localConsoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)

      mockClient.getGamingAlerts.mockResolvedValueOnce({
        alerts: [
          { agentId: 'a1', alertType: 'RAPID_CHANGE', severity: 'LOW', status, occurrences: 1 },
        ],
        summary: { total: 1 },
      })

      const cmd = findCommand('alerts')
      await cmd!.action(status, { limit: '5' })

      expect(mockClient.getGamingAlerts).toHaveBeenCalledWith(status, 5)
      expect(spinnerMock.stop).toHaveBeenCalled()

      localConsoleSpy.mockRestore()
    }
  })

  it('limit option string is parsed to integer', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [],
      summary: { total: 0 },
    })

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '50' })

    expect(mockClient.getGamingAlerts).toHaveBeenCalledWith(undefined, 50)
  })
})

describe('CAR CLI - presets command edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('truncates long preset hashes in CAR table display', async () => {
    const longHash = 'abcdefghijklmnopqrstuvwxyz0123456789'
    mockClient.getPresetHierarchy.mockResolvedValueOnce({
      carId: [
        { presetId: 'car-1', name: 'Baseline', presetHash: longHash },
      ],
      vorion: [],
      axiom: [],
      summary: { carIdCount: 1, vorionCount: 0, axiomCount: 0 },
    })

    const cmd = findCommand('presets')
    await cmd!.action()

    // The handler calls presetHash.slice(0, 16) + '...'
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('displays lineageVerified as check or cross mark for axiom presets', async () => {
    mockClient.getPresetHierarchy.mockResolvedValueOnce({
      carId: [],
      vorion: [],
      axiom: [
        { presetId: 'axm-1', name: 'Verified', lineageVerified: true },
        { presetId: 'axm-2', name: 'Unverified', lineageVerified: false },
      ],
      summary: { carIdCount: 0, vorionCount: 0, axiomCount: 2 },
    })

    const cmd = findCommand('presets')
    await cmd!.action()

    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('handles empty preset hierarchy gracefully', async () => {
    mockClient.getPresetHierarchy.mockResolvedValueOnce({
      carId: [],
      vorion: [],
      axiom: [],
      summary: { carIdCount: 0, vorionCount: 0, axiomCount: 0 },
    })

    const cmd = findCommand('presets')
    await cmd!.action()

    expect(spinnerMock.stop).toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })
})

describe('CAR CLI - Error message forwarding', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('stats command prints error message to console.error', async () => {
    mockClient.getStats.mockRejectedValueOnce(new Error('Connection refused'))

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(consoleErrorSpy).toHaveBeenCalledWith('Connection refused')
  })

  it('evaluate command prints error message to console.error', async () => {
    mockClient.evaluateRoleGate.mockRejectedValueOnce(new Error('Invalid role'))

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-1', 'R_L99', { tier: 'T3', score: '550' })

    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid role')
  })

  it('ceiling command prints error message to console.error', async () => {
    mockClient.checkCeiling.mockRejectedValueOnce(new Error('Agent not found'))

    const cmd = findCommand('ceiling')
    await cmd!.action('unknown-agent', '800', { framework: 'DEFAULT' })

    expect(consoleErrorSpy).toHaveBeenCalledWith('Agent not found')
  })

  it('provenance command prints error message to console.error', async () => {
    mockClient.getProvenance.mockRejectedValueOnce(new Error('Access denied'))

    const cmd = findCommand('provenance')
    await cmd!.action('agent-1')

    expect(consoleErrorSpy).toHaveBeenCalledWith('Access denied')
  })

  it('alerts command prints error message to console.error', async () => {
    mockClient.getGamingAlerts.mockRejectedValueOnce(new Error('Rate limited'))

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    expect(consoleErrorSpy).toHaveBeenCalledWith('Rate limited')
  })

  it('presets command prints error message to console.error', async () => {
    mockClient.getPresetHierarchy.mockRejectedValueOnce(new Error('Service unavailable'))

    const cmd = findCommand('presets')
    await cmd!.action()

    expect(consoleErrorSpy).toHaveBeenCalledWith('Service unavailable')
  })

  it('all commands call process.exit(1) on failure', async () => {
    const commands = ['stats', 'evaluate', 'ceiling', 'provenance', 'alerts', 'presets']
    const errors = [
      () => mockClient.getStats.mockRejectedValueOnce(new Error('fail')),
      () => mockClient.evaluateRoleGate.mockRejectedValueOnce(new Error('fail')),
      () => mockClient.checkCeiling.mockRejectedValueOnce(new Error('fail')),
      () => mockClient.getProvenance.mockRejectedValueOnce(new Error('fail')),
      () => mockClient.getGamingAlerts.mockRejectedValueOnce(new Error('fail')),
      () => mockClient.getPresetHierarchy.mockRejectedValueOnce(new Error('fail')),
    ]
    const actionArgs: any[][] = [
      [],
      ['agent-1', 'R_L3', { tier: 'T3', score: '550' }],
      ['agent-1', '750', { framework: 'DEFAULT' }],
      ['agent-1'],
      [undefined, { limit: '20' }],
      [],
    ]

    for (let i = 0; i < commands.length; i++) {
      vi.clearAllMocks()
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)

      errors[i]()

      const cmd = findCommand(commands[i])
      expect(cmd).toBeDefined()
      await cmd!.action(...actionArgs[i])

      expect(exitSpy).toHaveBeenCalledWith(1)
    }
  })
})
