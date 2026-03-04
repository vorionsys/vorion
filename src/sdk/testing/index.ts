/**
 * Vorion Security SDK - Testing Utilities
 * Policy testing framework and utilities
 */

import {
  PolicyDefinition,
  PolicyOutcome,
  EvaluationContext,
  TestContext,
  TestResult,
  TestSuite,
  TestCase,
  SimulationTrace,
  UserContext,
  RequestContext,
  TimeContext,
} from '../types';
import { evaluatePolicy } from '../dsl/policy-dsl';

// ============================================================================
// Test Policy Function
// ============================================================================

/**
 * Test a policy against a given context
 *
 * @example
 * const result = await testPolicy(adminPolicy, {
 *   user: { role: 'admin' },
 *   request: { ip: '10.0.0.1' },
 *   time: { hour: 10 }
 * });
 * expect(result.outcome).toBe('allow');
 */
export async function testPolicy(
  policy: PolicyDefinition | string,
  context: TestContext,
  options: { trace?: boolean; timeout?: number } = {}
): Promise<TestResult> {
  const startTime = Date.now();
  const trace: SimulationTrace[] = [];

  try {
    // Resolve policy if string (policy ID)
    let resolvedPolicy: PolicyDefinition;
    if (typeof policy === 'string') {
      throw new Error('Policy ID resolution not implemented. Please provide PolicyDefinition.');
    } else {
      resolvedPolicy = policy;
    }

    // Build full evaluation context
    const fullContext = buildFullContext(context);

    // Evaluate with tracing if requested
    let step = 0;
    const originalConditions = [...resolvedPolicy.conditions];

    if (options.trace) {
      // Trace condition evaluation
      for (const condition of originalConditions) {
        const conditionStart = Date.now();
        trace.push({
          step: step++,
          type: 'condition',
          description: `Evaluate ${condition.field} ${condition.type} ${JSON.stringify(condition.value)}`,
          result: true, // Will be updated by actual evaluation
          duration: Date.now() - conditionStart,
        });
      }

      // Trace requirement checks
      for (const req of resolvedPolicy.requirements) {
        const reqStart = Date.now();
        trace.push({
          step: step++,
          type: 'requirement',
          description: `Check requirement: ${req.type}`,
          result: true,
          duration: Date.now() - reqStart,
        });
      }
    }

    // Perform actual evaluation
    const result = await evaluatePolicy(resolvedPolicy, fullContext);

    // Add action trace
    if (options.trace) {
      trace.push({
        step: step++,
        type: 'action',
        description: `Execute action: ${result.outcome}`,
        result: true,
        duration: 0,
      });
    }

    const duration = Date.now() - startTime;

    return {
      passed: true, // No expected value to compare against
      outcome: result.outcome,
      message: result.reason,
      duration,
      trace: options.trace ? trace : undefined,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      passed: false,
      outcome: 'deny',
      message: `Error: ${(error as Error).message}`,
      duration,
      trace: options.trace ? trace : undefined,
    };
  }
}

/**
 * Build a complete EvaluationContext from partial TestContext
 */
function buildFullContext(partial: TestContext): EvaluationContext {
  const now = new Date();

  const user: UserContext = {
    id: partial.user?.id || 'test-user',
    email: partial.user?.email,
    role: partial.user?.role,
    roles: partial.user?.roles,
    permissions: partial.user?.permissions || [],
    groups: partial.user?.groups || [],
    mfaVerified: partial.user?.mfaVerified ?? false,
    sessionId: partial.user?.sessionId,
    authMethod: partial.user?.authMethod,
    attributes: partial.user?.attributes,
  };

  const request: RequestContext = {
    ip: partial.request?.ip || '127.0.0.1',
    userAgent: partial.request?.userAgent,
    method: partial.request?.method || 'GET',
    path: partial.request?.path || '/',
    headers: partial.request?.headers || {},
    geo: partial.request?.geo,
  };

  const time: TimeContext = {
    timestamp: partial.time?.timestamp || now,
    hour: partial.time?.hour ?? now.getHours(),
    minute: partial.time?.minute ?? now.getMinutes(),
    dayOfWeek: partial.time?.dayOfWeek ?? now.getDay(),
    timezone: partial.time?.timezone,
  };

  // Build resource context if partial is provided with required fields
  const resource = partial.resource && partial.resource.type && partial.resource.id
    ? {
        type: partial.resource.type,
        id: partial.resource.id,
        owner: partial.resource.owner,
        attributes: partial.resource.attributes,
      }
    : undefined;

  return {
    user,
    request,
    time,
    resource,
    environment: partial.environment,
    custom: partial.custom,
  };
}

// ============================================================================
// Test Suite Runner
// ============================================================================

export interface TestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestCaseResult[];
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  expected: PolicyOutcome;
  actual: PolicyOutcome;
  message?: string;
  duration: number;
  trace?: SimulationTrace[];
}

/**
 * Run a test suite
 *
 * @example
 * const suite: TestSuite = {
 *   name: 'Admin Policy Tests',
 *   tests: [
 *     {
 *       name: 'allows admin access during business hours',
 *       policy: adminPolicy,
 *       context: { user: { role: 'admin' }, time: { hour: 10 } },
 *       expected: 'allow'
 *     },
 *     {
 *       name: 'denies non-admin access',
 *       policy: adminPolicy,
 *       context: { user: { role: 'user' } },
 *       expected: 'deny'
 *     }
 *   ]
 * };
 *
 * const result = await runTestSuite(suite);
 */
export async function runTestSuite(suite: TestSuite): Promise<TestSuiteResult> {
  const startTime = Date.now();
  const results: TestCaseResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Run beforeAll hook
  if (suite.beforeAll) {
    await suite.beforeAll();
  }

  for (const test of suite.tests) {
    // Run beforeEach hook
    if (suite.beforeEach) {
      await suite.beforeEach();
    }

    try {
      const testResult = await testPolicy(test.policy, test.context, {
        trace: true,
        timeout: test.timeout,
      });

      const testPassed = testResult.outcome === test.expected;

      results.push({
        name: test.name,
        passed: testPassed,
        expected: test.expected,
        actual: testResult.outcome,
        message: testResult.message,
        duration: testResult.duration,
        trace: testResult.trace,
      });

      if (testPassed) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        expected: test.expected,
        actual: 'deny',
        message: `Error: ${(error as Error).message}`,
        duration: 0,
      });
      failed++;
    }

    // Run afterEach hook
    if (suite.afterEach) {
      await suite.afterEach();
    }
  }

  // Run afterAll hook
  if (suite.afterAll) {
    await suite.afterAll();
  }

  return {
    name: suite.name,
    passed,
    failed,
    skipped,
    duration: Date.now() - startTime,
    results,
  };
}

// ============================================================================
// Test Assertions
// ============================================================================

export class PolicyTestAssertions {
  private result: TestResult;

  constructor(result: TestResult) {
    this.result = result;
  }

  /**
   * Assert that the outcome matches expected
   */
  toHaveOutcome(expected: PolicyOutcome): this {
    if (this.result.outcome !== expected) {
      throw new AssertionError(
        `Expected outcome '${expected}' but got '${this.result.outcome}'`
      );
    }
    return this;
  }

  /**
   * Assert that the policy allowed access
   */
  toAllow(): this {
    return this.toHaveOutcome('allow');
  }

  /**
   * Assert that the policy denied access
   */
  toDeny(): this {
    return this.toHaveOutcome('deny');
  }

  /**
   * Assert that the policy challenged (requires additional verification)
   */
  toChallenge(): this {
    return this.toHaveOutcome('challenge');
  }

  /**
   * Assert that the policy audited (allowed but logged)
   */
  toAudit(): this {
    return this.toHaveOutcome('audit');
  }

  /**
   * Assert that the message contains a string
   */
  toHaveMessage(substring: string): this {
    if (!this.result.message || !this.result.message.includes(substring)) {
      throw new AssertionError(
        `Expected message to contain '${substring}' but got '${this.result.message}'`
      );
    }
    return this;
  }

  /**
   * Assert that the evaluation completed within a time limit
   */
  toCompleteWithin(maxMs: number): this {
    if (this.result.duration > maxMs) {
      throw new AssertionError(
        `Expected evaluation to complete within ${maxMs}ms but took ${this.result.duration}ms`
      );
    }
    return this;
  }
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * Create assertion wrapper for test result
 *
 * @example
 * const result = await testPolicy(policy, context);
 * expect(result).toAllow();
 * expect(result).toHaveMessage('access granted');
 */
export function expect(result: TestResult): PolicyTestAssertions {
  return new PolicyTestAssertions(result);
}

// ============================================================================
// Test Context Builders
// ============================================================================

/**
 * Builder for creating test contexts
 *
 * @example
 * const context = TestContextBuilder.create()
 *   .withUser({ role: 'admin', mfaVerified: true })
 *   .withRequest({ ip: '10.0.0.1' })
 *   .withTime({ hour: 10 })
 *   .build();
 */
export class TestContextBuilder {
  private context: TestContext = {};

  static create(): TestContextBuilder {
    return new TestContextBuilder();
  }

  withUser(user: Partial<UserContext>): this {
    this.context.user = { ...this.context.user, ...user };
    return this;
  }

  withRequest(request: Partial<RequestContext>): this {
    this.context.request = { ...this.context.request, ...request };
    return this;
  }

  withTime(time: Partial<TimeContext>): this {
    this.context.time = { ...this.context.time, ...time };
    return this;
  }

  withResource(resource: { type: string; id: string; owner?: string; attributes?: Record<string, unknown> }): this {
    this.context.resource = resource;
    return this;
  }

  withEnvironment(env: Record<string, unknown>): this {
    this.context.environment = { ...this.context.environment, ...env };
    return this;
  }

  withCustom(custom: Record<string, unknown>): this {
    this.context.custom = { ...this.context.custom, ...custom };
    return this;
  }

  /**
   * Create context for admin user
   */
  asAdmin(): this {
    return this.withUser({
      role: 'admin',
      roles: ['admin'],
      permissions: ['*'],
      mfaVerified: true,
    });
  }

  /**
   * Create context for regular user
   */
  asUser(): this {
    return this.withUser({
      role: 'user',
      roles: ['user'],
      permissions: [],
      mfaVerified: false,
    });
  }

  /**
   * Create context for anonymous user
   */
  asAnonymous(): this {
    return this.withUser({
      id: 'anonymous',
      role: undefined,
      roles: [],
      permissions: [],
    });
  }

  /**
   * Set time to business hours (10 AM on Monday)
   */
  duringBusinessHours(): this {
    return this.withTime({
      hour: 10,
      minute: 0,
      dayOfWeek: 1, // Monday
    });
  }

  /**
   * Set time to after hours (10 PM on Monday)
   */
  afterHours(): this {
    return this.withTime({
      hour: 22,
      minute: 0,
      dayOfWeek: 1,
    });
  }

  /**
   * Set time to weekend
   */
  onWeekend(): this {
    return this.withTime({
      hour: 10,
      minute: 0,
      dayOfWeek: 6, // Saturday
    });
  }

  /**
   * Set request from internal network
   */
  fromInternalNetwork(): this {
    return this.withRequest({
      ip: '10.0.0.1',
    });
  }

  /**
   * Set request from external network
   */
  fromExternalNetwork(): this {
    return this.withRequest({
      ip: '203.0.113.1',
    });
  }

  build(): TestContext {
    return { ...this.context };
  }
}

// ============================================================================
// Policy Test Fixtures
// ============================================================================

export interface PolicyFixture {
  name: string;
  policy: PolicyDefinition;
  scenarios: {
    name: string;
    context: TestContext;
    expected: PolicyOutcome;
  }[];
}

/**
 * Create a policy fixture for testing
 *
 * @example
 * const fixture = createPolicyFixture('Admin Access Policy', adminPolicy)
 *   .withScenario('admin user allowed', { user: { role: 'admin' } }, 'allow')
 *   .withScenario('regular user denied', { user: { role: 'user' } }, 'deny')
 *   .build();
 */
export function createPolicyFixture(
  name: string,
  policy: PolicyDefinition
): PolicyFixtureBuilder {
  return new PolicyFixtureBuilder(name, policy);
}

export class PolicyFixtureBuilder {
  private fixture: PolicyFixture;

  constructor(name: string, policy: PolicyDefinition) {
    this.fixture = {
      name,
      policy,
      scenarios: [],
    };
  }

  withScenario(
    name: string,
    context: TestContext,
    expected: PolicyOutcome
  ): this {
    this.fixture.scenarios.push({ name, context, expected });
    return this;
  }

  build(): PolicyFixture {
    return { ...this.fixture };
  }
}

/**
 * Run all scenarios in a policy fixture
 */
export async function runPolicyFixture(
  fixture: PolicyFixture
): Promise<TestSuiteResult> {
  const suite: TestSuite = {
    name: fixture.name,
    tests: fixture.scenarios.map((scenario) => ({
      name: scenario.name,
      policy: fixture.policy,
      context: scenario.context,
      expected: scenario.expected,
    })),
  };

  return runTestSuite(suite);
}

// ============================================================================
// Test Report Generator
// ============================================================================

export interface TestReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    passRate: number;
  };
  suites: TestSuiteResult[];
}

/**
 * Generate a test report from multiple suite results
 */
export function generateTestReport(suites: TestSuiteResult[]): TestReport {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration = 0;

  for (const suite of suites) {
    total += suite.passed + suite.failed + suite.skipped;
    passed += suite.passed;
    failed += suite.failed;
    skipped += suite.skipped;
    duration += suite.duration;
  }

  return {
    summary: {
      total,
      passed,
      failed,
      skipped,
      duration,
      passRate: total > 0 ? (passed / total) * 100 : 0,
    },
    suites,
  };
}

/**
 * Print a test report to console
 */
export function printTestReport(report: TestReport): void {
  console.log('\n\x1b[36m═══════════════════════════════════════════\x1b[0m');
  console.log('\x1b[36m           POLICY TEST REPORT              \x1b[0m');
  console.log('\x1b[36m═══════════════════════════════════════════\x1b[0m\n');

  for (const suite of report.suites) {
    console.log(`\x1b[1m${suite.name}\x1b[0m`);

    for (const result of suite.results) {
      const icon = result.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const duration = `(${result.duration}ms)`;

      console.log(`  ${icon} ${result.name} ${duration}`);

      if (!result.passed) {
        console.log(`      Expected: ${result.expected}`);
        console.log(`      Actual: ${result.actual}`);
        if (result.message) {
          console.log(`      Message: ${result.message}`);
        }
      }
    }

    console.log();
  }

  console.log('\x1b[36m───────────────────────────────────────────\x1b[0m');
  console.log('Summary:');
  console.log(`  Total: ${report.summary.total}`);
  console.log(`  \x1b[32mPassed: ${report.summary.passed}\x1b[0m`);
  console.log(`  \x1b[31mFailed: ${report.summary.failed}\x1b[0m`);
  console.log(`  \x1b[33mSkipped: ${report.summary.skipped}\x1b[0m`);
  console.log(`  Duration: ${report.summary.duration}ms`);
  console.log(`  Pass Rate: ${report.summary.passRate.toFixed(1)}%`);
  console.log('\x1b[36m═══════════════════════════════════════════\x1b[0m\n');
}

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock policy for testing
 */
export function createMockPolicy(
  overrides: Partial<PolicyDefinition> = {}
): PolicyDefinition {
  return {
    id: 'mock-policy',
    name: 'Mock Policy',
    description: 'A mock policy for testing',
    version: '1.0.0',
    conditions: [],
    requirements: [],
    action: { type: 'allow' },
    fallbackAction: { type: 'deny', message: 'Conditions not met' },
    priority: 100,
    enabled: true,
    tags: ['mock', 'test'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock context for testing
 */
export function createMockContext(
  overrides: Partial<TestContext> = {}
): TestContext {
  return {
    user: {
      id: 'mock-user',
      role: 'user',
      permissions: [],
      ...overrides.user,
    },
    request: {
      ip: '127.0.0.1',
      ...overrides.request,
    },
    time: {
      hour: 12,
      dayOfWeek: 1,
      ...overrides.time,
    },
    ...overrides,
  };
}
