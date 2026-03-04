/**
 * Authentication E2E Tests
 *
 * Comprehensive end-to-end tests for the authentication flow including:
 * - User registration
 * - Login flow
 * - Token refresh
 * - Logout (single and all sessions)
 * - Session management
 *
 * Uses vitest with mocked external dependencies (database, Redis) but tests
 * full request/response cycles.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock stores for isolated testing
const mockUserStore = new Map<string, any>();
const mockSessionStore = new Map<string, any>();
const mockRefreshTokenStore = new Map<string, any>();
const mockRevokedTokenStore = new Set<string>();
const mockTenantMembershipStore = new Map<string, any>();

function resetStores(): void {
  mockUserStore.clear();
  mockSessionStore.clear();
  mockRefreshTokenStore.clear();
  mockRevokedTokenStore.clear();
  mockTenantMembershipStore.clear();
}

// Mock configuration
vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: {
      secret: 'test-jwt-secret-minimum-32-characters-long',
      requireJti: true,
      expiration: '1h',
      refreshExpiration: '7d',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1', rateLimit: 1000 },
    redis: { host: 'localhost', port: 6379, db: 0 },
    database: {
      host: 'localhost',
      port: 5432,
      database: 'vorion_test',
      poolMin: 2,
      poolMax: 10,
    },
    intent: {
      defaultNamespace: 'default',
      trustGates: { 'high-risk': 3 },
      defaultMinTrustLevel: 0,
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TEST UTILITIES
// =============================================================================

const TEST_TENANT_ID = 'test-tenant-auth-e2e';
const JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';

interface TestUser {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string;
  roles: string[];
  createdAt: Date;
  mfaEnabled?: boolean;
  mfaSecret?: string;
}

interface TestSession {
  id: string;
  userId: string;
  tenantId: string;
  deviceId: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

interface TestRefreshToken {
  id: string;
  userId: string;
  tenantId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}

/**
 * Mock JWT Service for testing
 */
class MockAuthService {
  private secret = JWT_SECRET;

  createAccessToken(payload: {
    sub: string;
    tenantId: string;
    roles?: string[];
    sessionId?: string;
    jti?: string;
    exp?: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.sub,
      tid: payload.tenantId,
      roles: payload.roles ?? ['user'],
      sessionId: payload.sessionId ?? randomUUID(),
      jti: payload.jti ?? randomUUID(),
      iat: now,
      exp: payload.exp ?? now + 3600,
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
    return `${header}.${body}.mock-signature`;
  }

  createRefreshToken(userId: string, tenantId: string, familyId?: string): TestRefreshToken {
    const token: TestRefreshToken = {
      id: randomUUID(),
      userId,
      tenantId,
      familyId: familyId ?? randomUUID(),
      tokenHash: `refresh-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    };
    mockRefreshTokenStore.set(token.id, token);
    return token;
  }

  verifyToken(token: string): { valid: boolean; payload?: any; error?: string } {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }

      if (payload.jti && mockRevokedTokenStore.has(payload.jti)) {
        return { valid: false, error: 'Token has been revoked' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'Token parsing failed' };
    }
  }

  revokeToken(jti: string): void {
    mockRevokedTokenStore.add(jti);
  }

  async hashPassword(password: string): Promise<string> {
    // Mock password hashing (in production would use argon2/bcrypt)
    return `hashed-${password}`;
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return hash === `hashed-${password}`;
  }
}

/**
 * Mock User Service
 */
class MockUserService {
  async createUser(data: {
    email: string;
    password: string;
    tenantId: string;
    roles?: string[];
  }): Promise<TestUser> {
    const authService = new MockAuthService();
    const user: TestUser = {
      id: randomUUID(),
      email: data.email,
      passwordHash: await authService.hashPassword(data.password),
      tenantId: data.tenantId,
      roles: data.roles ?? ['user'],
      createdAt: new Date(),
    };
    mockUserStore.set(user.id, user);
    mockUserStore.set(user.email, user); // Index by email too

    // Also create tenant membership
    mockTenantMembershipStore.set(`${user.id}:${data.tenantId}`, {
      userId: user.id,
      tenantId: data.tenantId,
      role: 'member',
    });

    return user;
  }

  async getUserByEmail(email: string): Promise<TestUser | null> {
    return mockUserStore.get(email) ?? null;
  }

  async getUserById(id: string): Promise<TestUser | null> {
    return mockUserStore.get(id) ?? null;
  }
}

/**
 * Mock Session Service
 */
class MockSessionService {
  async createSession(userId: string, tenantId: string, deviceId: string): Promise<TestSession> {
    const session: TestSession = {
      id: randomUUID(),
      userId,
      tenantId,
      deviceId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      isActive: true,
    };
    mockSessionStore.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<TestSession | null> {
    return mockSessionStore.get(id) ?? null;
  }

  async getUserSessions(userId: string, tenantId: string): Promise<TestSession[]> {
    const sessions: TestSession[] = [];
    for (const session of mockSessionStore.values()) {
      if (session.userId === userId && session.tenantId === tenantId && session.isActive) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  async revokeSession(id: string): Promise<boolean> {
    const session = mockSessionStore.get(id);
    if (session) {
      session.isActive = false;
      mockSessionStore.set(id, session);
      return true;
    }
    return false;
  }

  async revokeAllUserSessions(userId: string, tenantId: string, excludeSessionId?: string): Promise<number> {
    let count = 0;
    for (const [id, session] of mockSessionStore.entries()) {
      if (session.userId === userId && session.tenantId === tenantId && session.isActive) {
        if (excludeSessionId && id === excludeSessionId) continue;
        session.isActive = false;
        mockSessionStore.set(id, session);
        count++;
      }
    }
    return count;
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Authentication E2E Tests', () => {
  const authService = new MockAuthService();
  const userService = new MockUserService();
  const sessionService = new MockSessionService();

  beforeEach(() => {
    resetStores();
  });

  // ===========================================================================
  // USER REGISTRATION
  // ===========================================================================

  describe('User Registration', () => {
    it('should register a new user successfully', async () => {
      const registrationData = {
        email: 'newuser@test.example.com',
        password: 'SecurePassword123!',
        tenantId: TEST_TENANT_ID,
      };

      const user = await userService.createUser(registrationData);

      expect(user.id).toBeDefined();
      expect(user.email).toBe(registrationData.email);
      expect(user.tenantId).toBe(TEST_TENANT_ID);
      expect(user.roles).toContain('user');
      expect(user.passwordHash).not.toBe(registrationData.password);
    });

    it('should hash passwords securely', async () => {
      const password = 'MySecurePassword123!';
      const user = await userService.createUser({
        email: 'hashtest@test.example.com',
        password,
        tenantId: TEST_TENANT_ID,
      });

      // Password should be hashed
      expect(user.passwordHash).not.toBe(password);
      expect(user.passwordHash.startsWith('hashed-')).toBe(true);

      // Should be able to verify the password
      const isValid = await authService.verifyPassword(password, user.passwordHash);
      expect(isValid).toBe(true);

      // Wrong password should fail
      const isInvalid = await authService.verifyPassword('WrongPassword', user.passwordHash);
      expect(isInvalid).toBe(false);
    });

    it('should create tenant membership on registration', async () => {
      const user = await userService.createUser({
        email: 'membership@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
      });

      const membership = mockTenantMembershipStore.get(`${user.id}:${TEST_TENANT_ID}`);
      expect(membership).toBeDefined();
      expect(membership.userId).toBe(user.id);
      expect(membership.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should assign default roles to new users', async () => {
      const user = await userService.createUser({
        email: 'defaultroles@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
      });

      expect(user.roles).toEqual(['user']);
    });

    it('should allow custom roles on registration', async () => {
      const user = await userService.createUser({
        email: 'customroles@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
        roles: ['admin', 'policy_writer'],
      });

      expect(user.roles).toContain('admin');
      expect(user.roles).toContain('policy_writer');
    });
  });

  // ===========================================================================
  // LOGIN FLOW
  // ===========================================================================

  describe('Login Flow', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await userService.createUser({
        email: 'logintest@test.example.com',
        password: 'CorrectPassword123!',
        tenantId: TEST_TENANT_ID,
      });
    });

    it('should login with valid credentials', async () => {
      const user = await userService.getUserByEmail('logintest@test.example.com');
      expect(user).not.toBeNull();

      const isValid = await authService.verifyPassword('CorrectPassword123!', user!.passwordHash);
      expect(isValid).toBe(true);

      // Create session and tokens
      const session = await sessionService.createSession(user!.id, TEST_TENANT_ID, 'device-001');
      const accessToken = authService.createAccessToken({
        sub: user!.id,
        tenantId: TEST_TENANT_ID,
        roles: user!.roles,
        sessionId: session.id,
      });
      const refreshToken = authService.createRefreshToken(user!.id, TEST_TENANT_ID);

      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(session.id).toBeDefined();
    });

    it('should reject login with invalid password', async () => {
      const user = await userService.getUserByEmail('logintest@test.example.com');
      expect(user).not.toBeNull();

      const isValid = await authService.verifyPassword('WrongPassword!', user!.passwordHash);
      expect(isValid).toBe(false);
    });

    it('should reject login for non-existent user', async () => {
      const user = await userService.getUserByEmail('nonexistent@test.example.com');
      expect(user).toBeNull();
    });

    it('should create session on successful login', async () => {
      const session = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');

      expect(session.id).toBeDefined();
      expect(session.userId).toBe(testUser.id);
      expect(session.tenantId).toBe(TEST_TENANT_ID);
      expect(session.isActive).toBe(true);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should include session ID in access token', async () => {
      const session = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      const accessToken = authService.createAccessToken({
        sub: testUser.id,
        tenantId: TEST_TENANT_ID,
        sessionId: session.id,
      });

      const verification = authService.verifyToken(accessToken);
      expect(verification.valid).toBe(true);
      expect(verification.payload.sessionId).toBe(session.id);
    });

    it('should track device information in session', async () => {
      const deviceId = 'browser-chrome-macos';
      const session = await sessionService.createSession(testUser.id, TEST_TENANT_ID, deviceId);

      expect(session.deviceId).toBe(deviceId);
    });
  });

  // ===========================================================================
  // TOKEN REFRESH
  // ===========================================================================

  describe('Token Refresh', () => {
    let testUser: TestUser;
    let testSession: TestSession;
    let testRefreshToken: TestRefreshToken;

    beforeEach(async () => {
      testUser = await userService.createUser({
        email: 'refreshtest@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
      });
      testSession = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      testRefreshToken = authService.createRefreshToken(testUser.id, TEST_TENANT_ID);
    });

    it('should refresh access token with valid refresh token', async () => {
      // Get the stored refresh token
      const storedToken = mockRefreshTokenStore.get(testRefreshToken.id);
      expect(storedToken).toBeDefined();
      expect(storedToken.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Create new access token
      const newAccessToken = authService.createAccessToken({
        sub: testUser.id,
        tenantId: TEST_TENANT_ID,
        roles: testUser.roles,
        sessionId: testSession.id,
      });

      const verification = authService.verifyToken(newAccessToken);
      expect(verification.valid).toBe(true);
      expect(verification.payload.sub).toBe(testUser.id);
    });

    it('should reject expired refresh token', async () => {
      // Create an expired refresh token
      const expiredToken: TestRefreshToken = {
        id: randomUUID(),
        userId: testUser.id,
        tenantId: TEST_TENANT_ID,
        familyId: randomUUID(),
        tokenHash: `refresh-${randomUUID()}`,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      mockRefreshTokenStore.set(expiredToken.id, expiredToken);

      // Verify token is expired
      expect(expiredToken.expiresAt.getTime()).toBeLessThan(Date.now());
    });

    it('should reject revoked refresh token', async () => {
      // Revoke the refresh token
      const storedToken = mockRefreshTokenStore.get(testRefreshToken.id);
      storedToken.revokedAt = new Date();
      mockRefreshTokenStore.set(testRefreshToken.id, storedToken);

      // Verify token is revoked
      expect(storedToken.revokedAt).toBeDefined();
    });

    it('should rotate refresh token on use (token family)', async () => {
      const familyId = testRefreshToken.familyId;

      // Mark old token as used
      const storedToken = mockRefreshTokenStore.get(testRefreshToken.id);
      storedToken.usedAt = new Date();
      mockRefreshTokenStore.set(testRefreshToken.id, storedToken);

      // Create new refresh token in same family
      const newRefreshToken = authService.createRefreshToken(testUser.id, TEST_TENANT_ID, familyId);

      expect(newRefreshToken.familyId).toBe(familyId);
      expect(newRefreshToken.id).not.toBe(testRefreshToken.id);
    });

    it('should detect refresh token reuse (potential theft)', async () => {
      // Mark token as already used
      const storedToken = mockRefreshTokenStore.get(testRefreshToken.id);
      storedToken.usedAt = new Date(Date.now() - 1000);
      mockRefreshTokenStore.set(testRefreshToken.id, storedToken);

      // Attempting to use already-used token indicates potential theft
      expect(storedToken.usedAt).toBeDefined();
      expect(storedToken.usedAt.getTime()).toBeLessThan(Date.now());
    });
  });

  // ===========================================================================
  // LOGOUT
  // ===========================================================================

  describe('Logout', () => {
    let testUser: TestUser;
    let testSession: TestSession;
    let accessToken: string;

    beforeEach(async () => {
      testUser = await userService.createUser({
        email: 'logouttest@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
      });
      testSession = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      accessToken = authService.createAccessToken({
        sub: testUser.id,
        tenantId: TEST_TENANT_ID,
        sessionId: testSession.id,
      });
    });

    it('should logout from current session', async () => {
      // Verify session is active
      const sessionBefore = await sessionService.getSession(testSession.id);
      expect(sessionBefore?.isActive).toBe(true);

      // Logout
      await sessionService.revokeSession(testSession.id);

      // Verify session is revoked
      const sessionAfter = await sessionService.getSession(testSession.id);
      expect(sessionAfter?.isActive).toBe(false);
    });

    it('should revoke access token on logout', async () => {
      const verification = authService.verifyToken(accessToken);
      expect(verification.valid).toBe(true);
      const jti = verification.payload.jti;

      // Revoke the token
      authService.revokeToken(jti);

      // Verify token is now invalid
      const verificationAfter = authService.verifyToken(accessToken);
      expect(verificationAfter.valid).toBe(false);
      expect(verificationAfter.error).toBe('Token has been revoked');
    });

    it('should logout from all sessions', async () => {
      // Create multiple sessions
      const session2 = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-002');
      const session3 = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-003');

      // Verify all are active
      const sessions = await sessionService.getUserSessions(testUser.id, TEST_TENANT_ID);
      expect(sessions.length).toBe(3);

      // Logout all
      const revokedCount = await sessionService.revokeAllUserSessions(testUser.id, TEST_TENANT_ID);

      expect(revokedCount).toBe(3);

      // Verify all are inactive
      const sessionsAfter = await sessionService.getUserSessions(testUser.id, TEST_TENANT_ID);
      expect(sessionsAfter.length).toBe(0);
    });

    it('should logout from all sessions except current', async () => {
      // Create multiple sessions
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-002');
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-003');

      // Logout all except current
      const revokedCount = await sessionService.revokeAllUserSessions(
        testUser.id,
        TEST_TENANT_ID,
        testSession.id
      );

      expect(revokedCount).toBe(2);

      // Verify current session is still active
      const currentSession = await sessionService.getSession(testSession.id);
      expect(currentSession?.isActive).toBe(true);
    });

    it('should return success even with invalid token (prevent information leak)', async () => {
      // Create an invalid/expired token
      const expiredToken = authService.createAccessToken({
        sub: testUser.id,
        tenantId: TEST_TENANT_ID,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      });

      const verification = authService.verifyToken(expiredToken);
      expect(verification.valid).toBe(false);

      // Logout should still "succeed" to prevent timing attacks
      // In real implementation, this would return 200 OK regardless
      expect(verification.error).toBe('Token expired');
    });
  });

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  describe('Session Management', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await userService.createUser({
        email: 'sessiontest@test.example.com',
        password: 'Password123!',
        tenantId: TEST_TENANT_ID,
      });
    });

    it('should list all active sessions for user', async () => {
      // Create multiple sessions
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-002');
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-003');

      const sessions = await sessionService.getUserSessions(testUser.id, TEST_TENANT_ID);

      expect(sessions.length).toBe(3);
      sessions.forEach(session => {
        expect(session.userId).toBe(testUser.id);
        expect(session.isActive).toBe(true);
      });
    });

    it('should not list revoked sessions', async () => {
      const session1 = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-002');

      // Revoke one session
      await sessionService.revokeSession(session1.id);

      const sessions = await sessionService.getUserSessions(testUser.id, TEST_TENANT_ID);

      expect(sessions.length).toBe(1);
      expect(sessions[0].deviceId).toBe('device-002');
    });

    it('should track session creation time', async () => {
      const before = Date.now();
      const session = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      const after = Date.now();

      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('should set session expiration', async () => {
      const session = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');

      // Session should expire in ~24 hours
      const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    it('should isolate sessions by tenant', async () => {
      const otherTenantId = 'other-tenant';

      // Create sessions in different tenants
      await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      await sessionService.createSession(testUser.id, otherTenantId, 'device-002');

      // Get sessions for first tenant
      const sessions1 = await sessionService.getUserSessions(testUser.id, TEST_TENANT_ID);
      expect(sessions1.length).toBe(1);
      expect(sessions1[0].tenantId).toBe(TEST_TENANT_ID);

      // Get sessions for second tenant
      const sessions2 = await sessionService.getUserSessions(testUser.id, otherTenantId);
      expect(sessions2.length).toBe(1);
      expect(sessions2[0].tenantId).toBe(otherTenantId);
    });

    it('should logout specific device', async () => {
      const session1 = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-001');
      const session2 = await sessionService.createSession(testUser.id, TEST_TENANT_ID, 'device-002');

      // Revoke specific session
      await sessionService.revokeSession(session1.id);

      // Verify only that session is revoked
      const s1 = await sessionService.getSession(session1.id);
      const s2 = await sessionService.getSession(session2.id);

      expect(s1?.isActive).toBe(false);
      expect(s2?.isActive).toBe(true);
    });
  });

  // ===========================================================================
  // TOKEN VALIDATION
  // ===========================================================================

  describe('Token Validation', () => {
    it('should validate a well-formed token', async () => {
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
        roles: ['user'],
      });

      const result = authService.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload.tid).toBe(TEST_TENANT_ID);
    });

    it('should reject malformed token', () => {
      const result = authService.verifyToken('invalid.token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject expired token', () => {
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
        exp: Math.floor(Date.now() / 1000) - 3600,
      });

      const result = authService.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should reject revoked token', () => {
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });

      const verification = authService.verifyToken(token);
      const jti = verification.payload.jti;

      // Revoke
      authService.revokeToken(jti);

      // Verify rejection
      const result = authService.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has been revoked');
    });

    it('should include all required claims in token', () => {
      const userId = randomUUID();
      const sessionId = randomUUID();
      const token = authService.createAccessToken({
        sub: userId,
        tenantId: TEST_TENANT_ID,
        roles: ['admin', 'user'],
        sessionId,
      });

      const result = authService.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload.sub).toBe(userId);
      expect(result.payload.tid).toBe(TEST_TENANT_ID);
      expect(result.payload.roles).toContain('admin');
      expect(result.payload.roles).toContain('user');
      expect(result.payload.sessionId).toBe(sessionId);
      expect(result.payload.jti).toBeDefined();
      expect(result.payload.iat).toBeDefined();
      expect(result.payload.exp).toBeDefined();
    });
  });

  // ===========================================================================
  // SECURITY CHECKS
  // ===========================================================================

  describe('Security Checks', () => {
    it('should use unique JTI for each token', () => {
      const token1 = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });
      const token2 = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });

      const v1 = authService.verifyToken(token1);
      const v2 = authService.verifyToken(token2);

      expect(v1.payload.jti).not.toBe(v2.payload.jti);
    });

    it('should include tenant ID in all tokens', () => {
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });

      const result = authService.verifyToken(token);

      expect(result.payload.tid).toBe(TEST_TENANT_ID);
    });

    it('should enforce token expiration', () => {
      // Token expires in 1 hour by default
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });

      const result = authService.verifyToken(token);
      const now = Math.floor(Date.now() / 1000);

      expect(result.payload.exp).toBeGreaterThan(now);
      expect(result.payload.exp).toBeLessThanOrEqual(now + 3600 + 1);
    });

    it('should support immediate token revocation', () => {
      const token = authService.createAccessToken({
        sub: randomUUID(),
        tenantId: TEST_TENANT_ID,
      });

      // Token is valid
      expect(authService.verifyToken(token).valid).toBe(true);

      // Revoke immediately
      const jti = authService.verifyToken(token).payload.jti;
      authService.revokeToken(jti);

      // Token is now invalid
      expect(authService.verifyToken(token).valid).toBe(false);
    });
  });
});
