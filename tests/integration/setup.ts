/**
 * Integration Test Setup
 *
 * Provides database setup, teardown, and transaction management for integration tests.
 * Uses real database connections with transaction rollback for test isolation.
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createSigner, createVerifier } from 'fast-jwt';

// Test environment setup
process.env['VORION_ENV'] = 'development';
process.env['VORION_JWT_SECRET'] = 'test-jwt-secret-minimum-32-characters-long';
process.env['VORION_LOG_LEVEL'] = 'error'; // Suppress logs during tests
process.env['VORION_DB_HOST'] = process.env['VORION_DB_HOST'] || 'localhost';
process.env['VORION_DB_PORT'] = process.env['VORION_DB_PORT'] || '5432';
process.env['VORION_DB_NAME'] = process.env['VORION_DB_NAME'] || 'vorion_test';
process.env['VORION_DB_USER'] = process.env['VORION_DB_USER'] || 'vorion';
process.env['VORION_DB_PASSWORD'] = process.env['VORION_DB_PASSWORD'] || 'vorion';
process.env['VORION_REDIS_HOST'] = process.env['VORION_REDIS_HOST'] || 'localhost';
process.env['VORION_REDIS_PORT'] = process.env['VORION_REDIS_PORT'] || '6379';

// JWT secret for test token generation
const JWT_SECRET = process.env['VORION_JWT_SECRET'] || 'test-jwt-secret-minimum-32-characters-long';

// Test tenant IDs for isolation
export const TEST_TENANT_ID = 'test-tenant-001';
export const TEST_TENANT_ID_2 = 'test-tenant-002';
export const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
export const TEST_USER_ID_2 = '550e8400-e29b-41d4-a716-446655440002';
export const TEST_ENTITY_ID = '550e8400-e29b-41d4-a716-446655440010';

/**
 * Test context for managing database transactions
 */
export interface TestContext {
  tenantId: string;
  userId: string;
  entityId: string;
  transactionId?: string;
}

/**
 * Default test context
 */
export const defaultTestContext: TestContext = {
  tenantId: TEST_TENANT_ID,
  userId: TEST_USER_ID,
  entityId: TEST_ENTITY_ID,
};

/**
 * JWT token payload interface
 */
export interface JWTPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  groups?: string[];
  jti?: string;
  exp?: number;
  iat?: number;
}

// Create JWT signer for test tokens
const jwtSigner = createSigner({
  key: JWT_SECRET,
  algorithm: 'HS256',
});

/**
 * Generate a valid JWT token for testing
 */
export function generateTestJWT(payload: Partial<JWTPayload> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    sub: payload.sub ?? TEST_USER_ID,
    tenantId: payload.tenantId ?? TEST_TENANT_ID,
    roles: payload.roles ?? ['user'],
    groups: payload.groups ?? [],
    jti: payload.jti ?? `test-jti-${randomUUID()}`,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + 3600, // 1 hour expiration
  };
  return jwtSigner(fullPayload);
}

/**
 * Generate a valid JWT token for testing (alias for backwards compatibility)
 */
export function generateTestToken(payload: Partial<JWTPayload> = {}): string {
  return generateTestJWT(payload);
}

/**
 * Create authorization header with test token
 */
export function authHeader(payload?: Partial<JWTPayload>): { Authorization: string } {
  return { Authorization: `Bearer ${generateTestJWT(payload)}` };
}

/**
 * Create authorization header for admin user
 */
export function adminAuthHeader(tenantId?: string): { Authorization: string } {
  return authHeader({
    tenantId: tenantId ?? TEST_TENANT_ID,
    roles: ['admin', 'user'],
  });
}

/**
 * Create authorization header for policy writer
 */
export function policyWriterAuthHeader(tenantId?: string): { Authorization: string } {
  return authHeader({
    tenantId: tenantId ?? TEST_TENANT_ID,
    roles: ['policy_writer', 'user'],
  });
}

/**
 * Create authorization header for reader-only user
 */
export function readerAuthHeader(tenantId?: string): { Authorization: string } {
  return authHeader({
    tenantId: tenantId ?? TEST_TENANT_ID,
    roles: ['policy_reader', 'user'],
  });
}

/**
 * Create authorization header for escalation approver
 */
export function escalationApproverAuthHeader(tenantId?: string): { Authorization: string } {
  return authHeader({
    tenantId: tenantId ?? TEST_TENANT_ID,
    roles: ['escalation_approver', 'user'],
  });
}

/**
 * Test server with transaction isolation
 */
let testServer: FastifyInstance | null = null;
let transactionSavepoint: string | null = null;

/**
 * Create test server with configuration
 */
export async function createTestServer(): Promise<FastifyInstance> {
  if (testServer) {
    return testServer;
  }

  // Dynamic import to allow environment setup first
  const { createServer } = await import('../../src/api/server.js');
  testServer = await createServer();
  return testServer;
}

/**
 * Setup test server with proper configuration (alias)
 */
export async function setupTestServer(): Promise<FastifyInstance> {
  return createTestServer();
}

export async function closeTestServer(): Promise<void> {
  if (testServer) {
    await testServer.close();
    testServer = null;
  }
}

/**
 * Get the test server instance
 */
export function getTestServer(): FastifyInstance {
  if (!testServer) {
    throw new Error('Test server not initialized. Call setupTestServer() first.');
  }
  return testServer;
}

/**
 * Begin a database transaction for test isolation
 */
export async function beginTestTransaction(): Promise<string> {
  const savepointId = `test_${randomUUID().replace(/-/g, '_')}`;
  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { sql } = await import('drizzle-orm');
    const db = getDatabase();
    await db.execute(sql.raw(`SAVEPOINT ${savepointId}`));
    transactionSavepoint = savepointId;
    return savepointId;
  } catch (error) {
    console.warn('Begin transaction warning:', error instanceof Error ? error.message : 'Unknown error');
    return savepointId;
  }
}

/**
 * Rollback database transaction for test isolation
 */
export async function rollbackTestTransaction(savepointId?: string): Promise<void> {
  const savepoint = savepointId ?? transactionSavepoint;
  if (!savepoint) return;

  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { sql } = await import('drizzle-orm');
    const db = getDatabase();
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
    transactionSavepoint = null;
  } catch (error) {
    console.warn('Rollback transaction warning:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Clean up test data for a tenant
 */
export async function cleanupTestData(tenantId: string): Promise<void> {
  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { sql } = await import('drizzle-orm');
    const db = getDatabase();

    // Delete in order respecting foreign keys
    await db.execute(sql`DELETE FROM intent_events WHERE intent_id IN (SELECT id FROM intents WHERE tenant_id = ${tenantId})`);
    await db.execute(sql`DELETE FROM intent_evaluations WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM escalation_approvers WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM escalations WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM intents WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM policy_versions WHERE policy_id IN (SELECT id FROM policies WHERE tenant_id = ${tenantId})`);
    await db.execute(sql`DELETE FROM policies WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM audit_records WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM group_memberships WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM user_consents WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM consent_policies WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM webhook_deliveries WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM audit_reads WHERE tenant_id = ${tenantId}`);
  } catch (error) {
    // Tables may not exist yet, that's OK
    console.warn('Cleanup warning:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Setup test tenant membership for authorization
 */
export async function setupTestTenantMembership(
  userId: string,
  tenantId: string,
  role: 'owner' | 'admin' | 'member' | 'readonly' = 'member'
): Promise<void> {
  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { tenantMemberships } = await import('../../src/intent/schema.js');
    const db = getDatabase();

    await db.insert(tenantMemberships).values({
      userId,
      tenantId,
      role,
    }).onConflictDoNothing();
  } catch (error) {
    console.warn('Setup tenant membership warning:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Setup test group membership
 */
export async function setupTestGroupMembership(
  userId: string,
  tenantId: string,
  groupName: string
): Promise<void> {
  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { groupMemberships } = await import('../../src/intent/schema.js');
    const db = getDatabase();

    await db.insert(groupMemberships).values({
      userId,
      tenantId,
      groupName,
      active: true,
    }).onConflictDoNothing();
  } catch (error) {
    console.warn('Setup group membership warning:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Setup data processing consent for GDPR compliance
 */
export async function setupTestConsent(
  userId: string,
  tenantId: string,
  consentType: string = 'data_processing'
): Promise<void> {
  try {
    const { getDatabase } = await import('../../src/common/db.js');
    const { userConsents } = await import('../../src/intent/schema.js');
    const db = getDatabase();

    await db.insert(userConsents).values({
      userId,
      tenantId,
      consentType,
      granted: true,
      grantedAt: new Date(),
      version: '1.0',
    }).onConflictDoNothing();
  } catch (error) {
    console.warn('Setup consent warning:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Vitest setup hooks for integration tests with transaction isolation
 */
export function setupIntegrationTest(): void {
  beforeAll(async () => {
    await setupTestServer();
    // Setup test tenant memberships
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestTenantMembership(TEST_USER_ID_2, TEST_TENANT_ID_2, 'admin');
  });

  afterAll(async () => {
    await cleanupTestData(TEST_TENANT_ID);
    await cleanupTestData(TEST_TENANT_ID_2);
    await closeTestServer();
  });

  beforeEach(async () => {
    // Clean up before each test for isolation
    await cleanupTestData(TEST_TENANT_ID);
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestConsent(TEST_USER_ID, TEST_TENANT_ID);
  });

  afterEach(async () => {
    // Additional cleanup if needed
  });
}

/**
 * Setup with transaction isolation (per-test rollback)
 */
export function setupIntegrationTestWithTransaction(): void {
  beforeAll(async () => {
    await setupTestServer();
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestTenantMembership(TEST_USER_ID_2, TEST_TENANT_ID_2, 'admin');
  });

  afterAll(async () => {
    await cleanupTestData(TEST_TENANT_ID);
    await cleanupTestData(TEST_TENANT_ID_2);
    await closeTestServer();
  });

  beforeEach(async () => {
    await beginTestTransaction();
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestConsent(TEST_USER_ID, TEST_TENANT_ID);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });
}

/**
 * Wait for async operations to complete
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 100 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await delay(delayMs * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastError;
}

/**
 * Wait for an event to occur (polling-based)
 */
export async function waitForEvent<T>(
  checkFn: () => Promise<T | null | undefined>,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 10000, pollIntervalMs = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await checkFn();
    if (result !== null && result !== undefined) {
      return result;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Event did not occur within ${timeoutMs}ms`);
}

/**
 * Generate unique test identifiers
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${randomUUID()}`;
}
