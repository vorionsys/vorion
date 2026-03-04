/**
 * Vorion Security SDK
 * Security-as-Code platform for modern applications
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export * from './types';

// ============================================================================
// Policy DSL
// ============================================================================

export {
  // Core builders
  Policy,
  PolicyBuilder,
  FieldCondition,
  TimeField,
  ConditionExpression,
  CombinedCondition,
  RequirementBuilder,

  // Context proxies
  user,
  request,
  time,
  resource,
  env,

  // Requirement builders
  mfa,
  approval,
  permission,

  // Action builders
  allow,
  deny,
  challenge,
  audit,

  // Evaluation
  evaluatePolicy,
} from './dsl/policy-dsl';

// ============================================================================
// DSL Parser
// ============================================================================

export {
  // Parser
  Lexer,
  Parser,
  PolicyValidator,
  PolicyCompiler,

  // Functions
  parsePolicyDSL,
  validatePolicyAST,
  compilePolicyAST,
  parsePolicyString,
  policyToString,
} from './dsl/parser';

// ============================================================================
// Decorators
// ============================================================================

export {
  // Security decorators
  Secured,
  RateLimit,
  AuditLog,
  RequirePermission,
  BreakGlass,

  // Composition utilities
  compose,
  createSecurityProfile,

  // Common profiles
  Public,
  Authenticated,
  AdminOnly,
  Sensitive,
  Critical,

  // Configuration
  setSecurityContextProvider,
  getSecurityContext,
  setSecurityEvaluator,
  createSecurityContext,

  // Rate limiting
  setRateLimiter,
  getRateLimiter,
  setRateLimitExceededHandler,
  parseWindow,
  getRateLimitInfo,
  getRateLimitStatus,
  resetRateLimit,
  createRateLimitMiddleware,
  InMemoryRateLimiter,
  RedisRateLimiter,

  // Audit logging
  setAuditLogger,
  getAuditLogger,
  getAuditLogOptions,
  queryAuditLogs,
  flushAuditLogs,
  audit as auditLog,
  ConsoleAuditLogger,
  BufferedAuditLogger,
  SIEMAuditLogger,

  // Permission checking
  setPermissionChecker,
  getPermissionChecker,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getCurrentPermissions,
  getRequiredPermission,
  permission as permissionString,
  Permissions,
  DefaultPermissionChecker,
  RBACPermissionChecker,
  ABACPermissionChecker,

  // Break glass
  setBreakGlassManager,
  getBreakGlassManager,
  setBreakGlassNotifier,
  requestBreakGlassAccess,
  getBreakGlassOptions,
  getPendingBreakGlassRequests,
  approveBreakGlassRequest,
  denyBreakGlassRequest,
  getBreakGlassRequestStatus,
  getBreakGlassAuditTrail,
  InMemoryBreakGlassManager,
  ConsoleBreakGlassNotifier,

  // Errors
  SecurityError,
  ChallengeRequiredError,
  RateLimitExceededError,
  RateLimitDegradedError,
  PermissionDeniedError,
  BreakGlassRequiredError,

  // Utility functions
  isSecured,
  getSecurityOptions,

  // Types
  type SecurityEvaluator,
  type RateLimiter,
  type RedisClient,
  type RateLimitExceededHandler,
  type AuditLogger,
  type AuditQueryOptions,
  type SIEMConfig,
  type PermissionChecker,
  type RBACConfig,
  type ABACPolicy,
  type BreakGlassManager,
  type BreakGlassNotifier,
  type BreakGlassRequest,
  type BreakGlassApproval,
  type BreakGlassDenial,
  type BreakGlassAuditEntry,
  type BreakGlassRequirements,
} from './decorators';

// ============================================================================
// Testing
// ============================================================================

export {
  // Core testing
  testPolicy,
  runTestSuite,
  expect,

  // Test builders
  TestContextBuilder,
  createPolicyFixture,
  PolicyFixtureBuilder,
  runPolicyFixture,

  // Report generation
  generateTestReport,
  printTestReport,

  // Mocks
  createMockPolicy,
  createMockContext,

  // Assertions
  PolicyTestAssertions,
  AssertionError,

  // Types
  type TestSuiteResult,
  type TestCaseResult,
  type TestReport,
  type PolicyFixture,
} from './testing';

// ============================================================================
// API Client
// ============================================================================

export {
  VorionClient,
  VorionApiError,
  createClient,
  createClientFromEnv,
} from './client';

// ============================================================================
// CLI (for programmatic use)
// ============================================================================

export {
  validatePolicy,
  testPolicy as testPolicyCli,
  deployPolicy,
  diffPolicies,
  generateTypes,
  parseArgs,
  type ParsedArgs,
} from './cli';

// ============================================================================
// Version
// ============================================================================

export const VERSION = '1.0.0';

// ============================================================================
// Default Export
// ============================================================================

import { Policy as PolicyBuilder } from './dsl/policy-dsl';
import { VorionClient, createClient } from './client';

export default {
  Policy: PolicyBuilder,
  Client: VorionClient,
  createClient,
  VERSION: '1.0.0',
};
