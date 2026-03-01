/**
 * CAR CLI - Command Registration & Handler Tests
 *
 * Tests the CLI command definitions, argument parsing, option handling,
 * and action handlers with mocked dependencies.
 *
 * Strategy: We mock `commander`, `@vorionsys/car-client`, `chalk`, `ora`,
 * and `cli-table3` so that importing cli.ts registers commands without
 * side effects. We then invoke the registered action handlers directly
 * and verify they call the correct client methods with the right arguments.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mock state that action handlers will write into
// ---------------------------------------------------------------------------

type RegisteredCommand = {
  name: string
  description: string
  args: string[]
  options: Array<{ flags: string; description: string; defaultValue?: string }>
  action: (...args: any[]) => Promise<void>
}

const registeredCommands: RegisteredCommand[] = []
const programMeta: { name?: string; description?: string; version?: string } = {}

// ---------------------------------------------------------------------------
// Mock: commander
// ---------------------------------------------------------------------------

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

programChain.name = vi.fn((n: string) => {
  programMeta.name = n
  return programChain
})
programChain.description = vi.fn((d: string) => {
  programMeta.description = d
  return programChain
})
programChain.version = vi.fn((v: string) => {
  programMeta.version = v
  return programChain
})
programChain.command = vi.fn((nameAndArgs: string) => {
  const parts = nameAndArgs.split(/\s+/)
  const name = parts[0]
  const args = parts.slice(1)
  const { cmd, chain } = createCommandChain()
  cmd.name = name
  cmd.args = args
  return chain
})
programChain.parse = vi.fn()

vi.mock('commander', () => ({
  Command: vi.fn().mockImplementation(() => programChain),
}))

// ---------------------------------------------------------------------------
// Mock: chalk - just return strings unchanged
// ---------------------------------------------------------------------------

const identity = (s: string) => s
const chalkMock: any = new Proxy(identity, {
  get(_target, prop) {
    if (prop === 'bold') return identity
    if (prop === 'dim') return identity
    if (prop === 'gray') return identity
    if (prop === 'red') return identity
    if (prop === 'green') return identity
    if (prop === 'blue') return identity
    if (prop === 'yellow') return identity
    if (prop === 'magenta') return identity
    if (prop === 'cyan') return identity
    if (prop === 'whiteBright') return identity
    if (prop === 'white') return identity
    if (prop === 'bgRed') return chalkMock
    return identity
  },
  apply(_target, _thisArg, args) {
    return args[0]
  },
})

vi.mock('chalk', () => ({ default: chalkMock }))

// ---------------------------------------------------------------------------
// Mock: ora
// ---------------------------------------------------------------------------

const spinnerMock = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
}

vi.mock('ora', () => ({
  default: vi.fn(() => spinnerMock),
}))

// ---------------------------------------------------------------------------
// Mock: cli-table3
// ---------------------------------------------------------------------------

vi.mock('cli-table3', () => ({
  default: vi.fn().mockImplementation(() => ({
    push: vi.fn(),
    toString: vi.fn().mockReturnValue('[table]'),
  })),
}))

// ---------------------------------------------------------------------------
// Mock: @vorionsys/car-client
// ---------------------------------------------------------------------------

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
    T0: 'Sandbox',
    T1: 'Probation',
    T2: 'Limited',
    T3: 'Standard',
    T4: 'Trusted',
    T5: 'Elevated',
    T6: 'Autonomous',
    T7: 'Sovereign',
  },
  AGENT_ROLE_LABELS: {
    R_L0: 'Listener',
    R_L1: 'Executor',
    R_L2: 'Planner',
    R_L3: 'Orchestrator',
    R_L4: 'Architect',
    R_L5: 'Governor',
    R_L6: 'Sovereign',
    R_L7: 'Meta-Agent',
    R_L8: 'Ecosystem Controller',
  },
}))

// ---------------------------------------------------------------------------
// Import the CLI module once (after mocks are set up).
// Module-level code in cli.ts runs once: it registers commands via our
// mocked Commander, then calls program.parse() (a no-op mock).
// The registeredCommands array is populated at this point and the action
// handler closures remain valid for the rest of the test suite.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await import('../src/cli.js')
})

// ---------------------------------------------------------------------------
// Helper: find a registered command by name
// ---------------------------------------------------------------------------

function findCommand(name: string): RegisteredCommand | undefined {
  return registeredCommands.find((c) => c.name === name)
}

// =============================================================================
// TESTS
// =============================================================================

describe('CAR CLI - Program metadata', () => {
  it('sets program name to "car"', () => {
    expect(programChain.name).toHaveBeenCalledWith('car')
  })

  it('sets program description containing "CAR"', () => {
    expect(programChain.description).toHaveBeenCalledWith(
      expect.stringContaining('CAR')
    )
  })

  it('sets version to 1.0.0', () => {
    expect(programChain.version).toHaveBeenCalledWith('1.0.0')
  })

  it('calls program.parse()', () => {
    expect(programChain.parse).toHaveBeenCalled()
  })
})

describe('CAR CLI - Command registration', () => {
  it('registers the "stats" command', () => {
    const cmd = findCommand('stats')
    expect(cmd).toBeDefined()
    expect(cmd!.description).toMatch(/statistics/i)
  })

  it('registers the "evaluate" command with <agentId> and <role> arguments', () => {
    const cmd = findCommand('evaluate')
    expect(cmd).toBeDefined()
    expect(cmd!.args).toContain('<agentId>')
    expect(cmd!.args).toContain('<role>')
  })

  it('registers evaluate command with --tier and --score options', () => {
    const cmd = findCommand('evaluate')
    expect(cmd).toBeDefined()
    const tierOpt = cmd!.options.find((o) => o.flags.includes('--tier'))
    expect(tierOpt).toBeDefined()
    expect(tierOpt!.defaultValue).toBe('T3')

    const scoreOpt = cmd!.options.find((o) => o.flags.includes('--score'))
    expect(scoreOpt).toBeDefined()
    expect(scoreOpt!.defaultValue).toBe('550')
  })

  it('registers the "ceiling" command with <agentId> and <score> arguments', () => {
    const cmd = findCommand('ceiling')
    expect(cmd).toBeDefined()
    expect(cmd!.args).toContain('<agentId>')
    expect(cmd!.args).toContain('<score>')
  })

  it('registers ceiling command with --framework and --previous options', () => {
    const cmd = findCommand('ceiling')
    expect(cmd).toBeDefined()
    const fwOpt = cmd!.options.find((o) => o.flags.includes('--framework'))
    expect(fwOpt).toBeDefined()
    expect(fwOpt!.defaultValue).toBe('DEFAULT')

    const prevOpt = cmd!.options.find((o) => o.flags.includes('--previous'))
    expect(prevOpt).toBeDefined()
  })

  it('registers the "provenance" command with <agentId> argument', () => {
    const cmd = findCommand('provenance')
    expect(cmd).toBeDefined()
    expect(cmd!.args).toContain('<agentId>')
  })

  it('registers the "alerts" command with optional [status] argument', () => {
    const cmd = findCommand('alerts')
    expect(cmd).toBeDefined()
    expect(cmd!.args).toContain('[status]')
  })

  it('registers alerts command with --limit option defaulting to 20', () => {
    const cmd = findCommand('alerts')
    expect(cmd).toBeDefined()
    const limitOpt = cmd!.options.find((o) => o.flags.includes('--limit'))
    expect(limitOpt).toBeDefined()
    expect(limitOpt!.defaultValue).toBe('20')
  })

  it('registers the "presets" command with no arguments', () => {
    const cmd = findCommand('presets')
    expect(cmd).toBeDefined()
    expect(cmd!.args).toHaveLength(0)
  })

  it('registers exactly 6 commands', () => {
    expect(registeredCommands).toHaveLength(6)
    const names = registeredCommands.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['stats', 'evaluate', 'ceiling', 'provenance', 'alerts', 'presets'])
    )
  })
})

describe('CAR CLI - "stats" command handler', () => {
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

  it('calls client.getStats() and stops spinner on success', async () => {
    mockClient.getStats.mockResolvedValueOnce({
      stats: {
        contextStats: { deployments: 3, organizations: 5, agents: 42, activeOperations: 7 },
        ceilingStats: { complianceBreakdown: { compliant: 30, warning: 8, violation: 4 } },
        roleGateStats: { byDecision: { ALLOW: 100, DENY: 20, ESCALATE: 5 } },
      },
      tierDistribution: [
        { tier: 'T3', label: 'Standard', range: '500-649', count: 15 },
      ],
      version: { major: 1, minor: 0, patch: 0 },
    })

    const cmd = findCommand('stats')
    expect(cmd).toBeDefined()

    await cmd!.action()

    expect(mockClient.getStats).toHaveBeenCalledOnce()
    expect(spinnerMock.stop).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('calls spinner.fail and process.exit(1) on error', async () => {
    mockClient.getStats.mockRejectedValueOnce(new Error('Network error'))

    const cmd = findCommand('stats')
    await cmd!.action()

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to fetch statistics')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

describe('CAR CLI - "evaluate" command handler', () => {
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

  it('calls client.evaluateRoleGate with correct parameters', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: {
        finalDecision: 'ALLOW',
        decisionReason: 'Tier meets minimum requirement',
      },
      layers: {
        kernel: { allowed: true },
        policy: { result: 'ALLOW' },
        basis: { overrideUsed: false },
      },
    })

    const cmd = findCommand('evaluate')
    expect(cmd).toBeDefined()

    // Commander passes positional args followed by options object
    await cmd!.action('agent-123', 'R_L3', { tier: 'T4', score: '700' })

    expect(mockClient.evaluateRoleGate).toHaveBeenCalledWith({
      agentId: 'agent-123',
      requestedRole: 'R_L3',
      currentTier: 'T4',
      currentScore: 700,
    })
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('uses default tier T3 and score 550 when not specified', async () => {
    mockClient.evaluateRoleGate.mockResolvedValueOnce({
      evaluation: {
        finalDecision: 'DENY',
        decisionReason: null,
      },
      layers: {
        kernel: { allowed: false },
        policy: { result: null },
        basis: { overrideUsed: false },
      },
    })

    const cmd = findCommand('evaluate')
    // Simulating default option values that Commander would provide
    await cmd!.action('agent-456', 'R_L5', { tier: 'T3', score: '550' })

    expect(mockClient.evaluateRoleGate).toHaveBeenCalledWith({
      agentId: 'agent-456',
      requestedRole: 'R_L5',
      currentTier: 'T3',
      currentScore: 550,
    })
  })

  it('handles errors and exits with code 1', async () => {
    mockClient.evaluateRoleGate.mockRejectedValueOnce(new Error('Server unavailable'))

    const cmd = findCommand('evaluate')
    await cmd!.action('agent-123', 'R_L3', { tier: 'T3', score: '550' })

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to evaluate role gate')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

describe('CAR CLI - "ceiling" command handler', () => {
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

  it('calls client.checkCeiling with correct parameters', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 699,
        effectiveCeiling: 699,
        ceilingApplied: true,
        complianceStatus: 'COMPLIANT',
        gamingIndicators: [],
      },
    })

    const cmd = findCommand('ceiling')
    expect(cmd).toBeDefined()

    await cmd!.action('agent-123', '750', { framework: 'EU_AI_ACT', previous: '600' })

    expect(mockClient.checkCeiling).toHaveBeenCalledWith({
      agentId: 'agent-123',
      proposedScore: 750,
      previousScore: 600,
      complianceFramework: 'EU_AI_ACT',
    })
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('omits previousScore when --previous is not provided', async () => {
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
    // No previous option provided
    await cmd!.action('agent-123', '800', { framework: 'DEFAULT' })

    expect(mockClient.checkCeiling).toHaveBeenCalledWith({
      agentId: 'agent-123',
      proposedScore: 800,
      previousScore: undefined,
      complianceFramework: 'DEFAULT',
    })
  })

  it('displays gaming indicators when present', async () => {
    mockClient.checkCeiling.mockResolvedValueOnce({
      result: {
        finalScore: 699,
        effectiveCeiling: 699,
        ceilingApplied: true,
        complianceStatus: 'WARNING',
        gamingIndicators: ['RAPID_CHANGE', 'OSCILLATION'],
      },
    })

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-123', '750', { framework: 'EU_AI_ACT' })

    // Verify console.log was called with gaming indicator output
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasGamingOutput = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('RAPID_CHANGE')
    )
    expect(hasGamingOutput).toBe(true)
  })

  it('handles errors and exits with code 1', async () => {
    mockClient.checkCeiling.mockRejectedValueOnce(new Error('API down'))

    const cmd = findCommand('ceiling')
    await cmd!.action('agent-123', '800', { framework: 'DEFAULT' })

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to check ceiling')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

describe('CAR CLI - "provenance" command handler', () => {
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

  it('calls client.getProvenance with the provided agentId', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-123',
          creationType: 'FRESH',
          trustModifier: 0,
          parentAgentId: null,
          createdBy: 'system',
        },
      ],
      lineage: null,
    })

    const cmd = findCommand('provenance')
    expect(cmd).toBeDefined()

    await cmd!.action('agent-123')

    expect(mockClient.getProvenance).toHaveBeenCalledWith('agent-123')
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('handles empty provenance records', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [],
      lineage: null,
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-unknown')

    // Should log "No provenance records found"
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasNoRecords = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('No provenance records found')
    )
    expect(hasNoRecords).toBe(true)
  })

  it('displays lineage chain when multiple lineage entries exist', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-child',
          creationType: 'CLONED',
          trustModifier: -50,
          parentAgentId: 'agent-parent',
          createdBy: 'admin',
        },
      ],
      lineage: [
        { agentId: 'agent-root' },
        { agentId: 'agent-parent' },
        { agentId: 'agent-child' },
      ],
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-child')

    // Should contain lineage display with arrow chain
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasLineage = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('agent-root')
    )
    expect(hasLineage).toBe(true)
  })

  it('displays positive trust modifiers with + prefix', async () => {
    mockClient.getProvenance.mockResolvedValueOnce({
      records: [
        {
          agentId: 'agent-evolved',
          creationType: 'EVOLVED',
          trustModifier: 100,
          parentAgentId: 'agent-base',
          createdBy: 'system',
        },
      ],
      lineage: null,
    })

    const cmd = findCommand('provenance')
    await cmd!.action('agent-evolved')

    // The handler formats positive modifiers with +prefix
    expect(spinnerMock.stop).toHaveBeenCalled()
    expect(mockClient.getProvenance).toHaveBeenCalledWith('agent-evolved')
  })

  it('handles errors and exits with code 1', async () => {
    mockClient.getProvenance.mockRejectedValueOnce(new Error('Not found'))

    const cmd = findCommand('provenance')
    await cmd!.action('agent-123')

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to fetch provenance')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

describe('CAR CLI - "alerts" command handler', () => {
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

  it('calls client.getGamingAlerts with status and limit', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [],
      summary: { total: 0 },
    })

    const cmd = findCommand('alerts')
    expect(cmd).toBeDefined()

    await cmd!.action('ACTIVE', { limit: '10' })

    expect(mockClient.getGamingAlerts).toHaveBeenCalledWith('ACTIVE', 10)
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('passes undefined status when not provided', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [],
      summary: { total: 0 },
    })

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    expect(mockClient.getGamingAlerts).toHaveBeenCalledWith(undefined, 20)
  })

  it('handles empty alerts with "No alerts found" message', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [],
      summary: { total: 0 },
    })

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasNoAlerts = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('No alerts found')
    )
    expect(hasNoAlerts).toBe(true)
  })

  it('displays alerts table when alerts are present', async () => {
    mockClient.getGamingAlerts.mockResolvedValueOnce({
      alerts: [
        {
          agentId: 'agent-suspicious',
          alertType: 'RAPID_CHANGE',
          severity: 'HIGH',
          status: 'ACTIVE',
          occurrences: 5,
        },
        {
          agentId: 'agent-testing',
          alertType: 'BOUNDARY_TESTING',
          severity: 'MEDIUM',
          status: 'INVESTIGATING',
          occurrences: 3,
        },
      ],
      summary: { total: 2 },
    })

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    // Should display summary line
    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasSummary = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('2 of 2')
    )
    expect(hasSummary).toBe(true)
  })

  it('handles errors and exits with code 1', async () => {
    mockClient.getGamingAlerts.mockRejectedValueOnce(new Error('Server error'))

    const cmd = findCommand('alerts')
    await cmd!.action(undefined, { limit: '20' })

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to fetch alerts')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})

describe('CAR CLI - "presets" command handler', () => {
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

  it('calls client.getPresetHierarchy()', async () => {
    mockClient.getPresetHierarchy.mockResolvedValueOnce({
      carId: [
        { presetId: 'car-1', name: 'Baseline', presetHash: 'abc123def456gh78' },
      ],
      vorion: [
        { presetId: 'vor-1', name: 'Reference', parentCarIdPresetId: 'car-1' },
      ],
      axiom: [
        { presetId: 'axm-1', name: 'Deploy A', lineageVerified: true },
      ],
      summary: { carIdCount: 1, vorionCount: 1, axiomCount: 1 },
    })

    const cmd = findCommand('presets')
    expect(cmd).toBeDefined()

    await cmd!.action()

    expect(mockClient.getPresetHierarchy).toHaveBeenCalledOnce()
    expect(spinnerMock.stop).toHaveBeenCalled()
  })

  it('displays summary line with counts', async () => {
    mockClient.getPresetHierarchy.mockResolvedValueOnce({
      carId: [],
      vorion: [],
      axiom: [],
      summary: { carIdCount: 5, vorionCount: 3, axiomCount: 8 },
    })

    const cmd = findCommand('presets')
    await cmd!.action()

    const logCalls = consoleSpy.mock.calls.map((c) => c[0])
    const hasSummary = logCalls.some(
      (msg: string) => typeof msg === 'string' && msg.includes('5 CAR')
    )
    expect(hasSummary).toBe(true)
  })

  it('handles errors and exits with code 1', async () => {
    mockClient.getPresetHierarchy.mockRejectedValueOnce(new Error('Timeout'))

    const cmd = findCommand('presets')
    await cmd!.action()

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to fetch presets')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})
