/**
 * MFA Database Store
 *
 * Database operations for MFA using Drizzle ORM patterns.
 * Handles persistence of user MFA settings, backup codes, and challenges.
 *
 * @packageDocumentation
 */

import { pgTable, uuid, text, boolean, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';
import { eq, and, isNull, lt, desc } from 'drizzle-orm';
import { getDatabase, type Database } from '../../common/db.js';
import { createLogger } from '../../common/logger.js';
import { secureRandomId } from '../../common/random.js';
import type {
  UserMfaRecord,
  MfaBackupCodeRecord,
  MfaChallengeRecord,
  CreateUserMfaInput,
  CreateBackupCodeInput,
  CreateChallengeInput,
  MfaStatus,
} from './types.js';

const logger = createLogger({ component: 'mfa-store' });

// =============================================================================
// Drizzle Schema Definitions
// =============================================================================

export const mfaMethodEnum = pgEnum('mfa_method', ['totp', 'backup_codes']);
export const mfaStatusEnum = pgEnum('mfa_status', ['pending', 'active', 'disabled']);

export const userMfa = pgTable('user_mfa', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  totpSecret: text('totp_secret'),
  totpSecretEncrypted: boolean('totp_secret_encrypted').default(true),
  status: mfaStatusEnum('status').notNull().default('pending'),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  enrollmentStartedAt: timestamp('enrollment_started_at', { withTimezone: true }),
  enrollmentExpiresAt: timestamp('enrollment_expires_at', { withTimezone: true }),
  gracePeriodEndsAt: timestamp('grace_period_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mfaBackupCodes = pgTable('mfa_backup_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userMfaId: uuid('user_mfa_id').notNull().references(() => userMfa.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedFromIp: text('used_from_ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mfaChallenges = pgTable('mfa_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  challengeToken: text('challenge_token').notNull().unique(),
  verified: boolean('verified').default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  attempts: integer('attempts').default(0),
  maxAttempts: integer('max_attempts').default(5),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Type inference from schema
export type UserMfaSelect = typeof userMfa.$inferSelect;
export type MfaBackupCodeSelect = typeof mfaBackupCodes.$inferSelect;
export type MfaChallengeSelect = typeof mfaChallenges.$inferSelect;

// =============================================================================
// MFA Store Class
// =============================================================================

/**
 * Database store for MFA operations
 */
export class MfaStore {
  private db: Database;

  constructor(database?: Database) {
    this.db = database ?? getDatabase();
  }

  // ---------------------------------------------------------------------------
  // User MFA Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new user MFA record
   */
  async createUserMfa(input: CreateUserMfaInput): Promise<UserMfaRecord> {
    const now = new Date();
    const enrollmentExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

    const [record] = await this.db
      .insert(userMfa)
      .values({
        userId: input.userId,
        tenantId: input.tenantId,
        totpSecret: input.totpSecret,
        totpSecretEncrypted: input.totpSecretEncrypted ?? true,
        status: 'pending',
        enrollmentStartedAt: now,
        enrollmentExpiresAt,
      })
      .returning();

    logger.info({ userId: input.userId, tenantId: input.tenantId }, 'Created user MFA record');
    return this.mapUserMfaRecord(record);
  }

  /**
   * Get user MFA record by user ID and tenant ID
   */
  async getUserMfa(userId: string, tenantId: string): Promise<UserMfaRecord | null> {
    const [record] = await this.db
      .select()
      .from(userMfa)
      .where(and(eq(userMfa.userId, userId), eq(userMfa.tenantId, tenantId)))
      .limit(1);

    return record ? this.mapUserMfaRecord(record) : null;
  }

  /**
   * Get user MFA record by ID
   */
  async getUserMfaById(id: string): Promise<UserMfaRecord | null> {
    const [record] = await this.db
      .select()
      .from(userMfa)
      .where(eq(userMfa.id, id))
      .limit(1);

    return record ? this.mapUserMfaRecord(record) : null;
  }

  /**
   * Update user MFA status to active
   */
  async activateUserMfa(
    id: string,
    gracePeriodEndsAt: Date
  ): Promise<UserMfaRecord | null> {
    const now = new Date();

    const [record] = await this.db
      .update(userMfa)
      .set({
        status: 'active',
        enabledAt: now,
        enrollmentExpiresAt: null,
        gracePeriodEndsAt,
        updatedAt: now,
      })
      .where(eq(userMfa.id, id))
      .returning();

    if (record) {
      logger.info({ id, userId: record.userId }, 'Activated user MFA');
    }
    return record ? this.mapUserMfaRecord(record) : null;
  }

  /**
   * Disable user MFA
   */
  async disableUserMfa(userId: string, tenantId: string): Promise<UserMfaRecord | null> {
    const now = new Date();

    const [record] = await this.db
      .update(userMfa)
      .set({
        status: 'disabled',
        totpSecret: null,
        enabledAt: null,
        gracePeriodEndsAt: null,
        updatedAt: now,
      })
      .where(and(eq(userMfa.userId, userId), eq(userMfa.tenantId, tenantId)))
      .returning();

    if (record) {
      logger.info({ userId, tenantId }, 'Disabled user MFA');
    }
    return record ? this.mapUserMfaRecord(record) : null;
  }

  /**
   * Delete user MFA record (and cascade to backup codes)
   */
  async deleteUserMfa(userId: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .delete(userMfa)
      .where(and(eq(userMfa.userId, userId), eq(userMfa.tenantId, tenantId)))
      .returning({ id: userMfa.id });

    if (result.length > 0) {
      logger.info({ userId, tenantId }, 'Deleted user MFA record');
      return true;
    }
    return false;
  }

  /**
   * Update enrollment expiry time
   */
  async updateEnrollmentExpiry(id: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(userMfa)
      .set({
        enrollmentExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userMfa.id, id));
  }

  // ---------------------------------------------------------------------------
  // Backup Code Operations
  // ---------------------------------------------------------------------------

  /**
   * Create backup codes for a user MFA record
   */
  async createBackupCodes(
    userMfaId: string,
    codeHashes: string[]
  ): Promise<MfaBackupCodeRecord[]> {
    const values = codeHashes.map((codeHash) => ({
      userMfaId,
      codeHash,
    }));

    const records = await this.db
      .insert(mfaBackupCodes)
      .values(values)
      .returning();

    logger.info({ userMfaId, count: records.length }, 'Created backup codes');
    return records.map(this.mapBackupCodeRecord);
  }

  /**
   * Get unused backup codes for a user MFA record
   */
  async getUnusedBackupCodes(userMfaId: string): Promise<MfaBackupCodeRecord[]> {
    const records = await this.db
      .select()
      .from(mfaBackupCodes)
      .where(and(eq(mfaBackupCodes.userMfaId, userMfaId), isNull(mfaBackupCodes.usedAt)));

    return records.map(this.mapBackupCodeRecord);
  }

  /**
   * Get count of unused backup codes
   */
  async getUnusedBackupCodeCount(userMfaId: string): Promise<number> {
    const codes = await this.getUnusedBackupCodes(userMfaId);
    return codes.length;
  }

  /**
   * Mark a backup code as used
   */
  async markBackupCodeUsed(
    id: string,
    usedFromIp: string | null
  ): Promise<MfaBackupCodeRecord | null> {
    const [record] = await this.db
      .update(mfaBackupCodes)
      .set({
        usedAt: new Date(),
        usedFromIp,
      })
      .where(eq(mfaBackupCodes.id, id))
      .returning();

    if (record) {
      logger.info({ id }, 'Marked backup code as used');
    }
    return record ? this.mapBackupCodeRecord(record) : null;
  }

  /**
   * Delete all backup codes for a user MFA record
   */
  async deleteBackupCodes(userMfaId: string): Promise<number> {
    const result = await this.db
      .delete(mfaBackupCodes)
      .where(eq(mfaBackupCodes.userMfaId, userMfaId))
      .returning({ id: mfaBackupCodes.id });

    logger.info({ userMfaId, count: result.length }, 'Deleted backup codes');
    return result.length;
  }

  // ---------------------------------------------------------------------------
  // Challenge Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new MFA challenge
   */
  async createChallenge(input: CreateChallengeInput): Promise<MfaChallengeRecord> {
    const challengeToken = secureRandomId();

    const [record] = await this.db
      .insert(mfaChallenges)
      .values({
        userId: input.userId,
        sessionId: input.sessionId,
        challengeToken,
        expiresAt: input.expiresAt,
        maxAttempts: input.maxAttempts ?? 5,
      })
      .returning();

    logger.info({ userId: input.userId, sessionId: input.sessionId }, 'Created MFA challenge');
    return this.mapChallengeRecord(record);
  }

  /**
   * Get challenge by token
   */
  async getChallengeByToken(challengeToken: string): Promise<MfaChallengeRecord | null> {
    const [record] = await this.db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.challengeToken, challengeToken))
      .limit(1);

    return record ? this.mapChallengeRecord(record) : null;
  }

  /**
   * Get active challenge for a user session
   */
  async getActiveChallenge(
    userId: string,
    sessionId: string
  ): Promise<MfaChallengeRecord | null> {
    const now = new Date();

    const [record] = await this.db
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.userId, userId),
          eq(mfaChallenges.sessionId, sessionId),
          eq(mfaChallenges.verified, false)
        )
      )
      .orderBy(desc(mfaChallenges.createdAt))
      .limit(1);

    if (record && new Date(record.expiresAt) > now) {
      return this.mapChallengeRecord(record);
    }
    return null;
  }

  /**
   * Increment challenge attempts
   */
  async incrementChallengeAttempts(id: string): Promise<MfaChallengeRecord | null> {
    // First get the current attempts count
    const current = await this.getChallengeById(id);
    if (!current) {
      return null;
    }

    const [record] = await this.db
      .update(mfaChallenges)
      .set({
        attempts: current.attempts + 1,
      })
      .where(eq(mfaChallenges.id, id))
      .returning();

    return record ? this.mapChallengeRecord(record) : null;
  }

  /**
   * Get challenge by ID
   */
  async getChallengeById(id: string): Promise<MfaChallengeRecord | null> {
    const [record] = await this.db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.id, id))
      .limit(1);

    return record ? this.mapChallengeRecord(record) : null;
  }

  /**
   * Mark challenge as verified
   */
  async markChallengeVerified(id: string): Promise<MfaChallengeRecord | null> {
    const [record] = await this.db
      .update(mfaChallenges)
      .set({
        verified: true,
        verifiedAt: new Date(),
      })
      .where(eq(mfaChallenges.id, id))
      .returning();

    if (record) {
      logger.info({ id }, 'Marked MFA challenge as verified');
    }
    return record ? this.mapChallengeRecord(record) : null;
  }

  /**
   * Delete expired challenges
   */
  async deleteExpiredChallenges(): Promise<number> {
    const now = new Date();

    const result = await this.db
      .delete(mfaChallenges)
      .where(lt(mfaChallenges.expiresAt, now))
      .returning({ id: mfaChallenges.id });

    if (result.length > 0) {
      logger.info({ count: result.length }, 'Deleted expired MFA challenges');
    }
    return result.length;
  }

  /**
   * Check if challenge is verified for a session
   */
  async isSessionVerified(userId: string, sessionId: string): Promise<boolean> {
    const [record] = await this.db
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.userId, userId),
          eq(mfaChallenges.sessionId, sessionId),
          eq(mfaChallenges.verified, true)
        )
      )
      .orderBy(desc(mfaChallenges.verifiedAt))
      .limit(1);

    return record !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Mapping Functions
  // ---------------------------------------------------------------------------

  private mapUserMfaRecord(record: UserMfaSelect): UserMfaRecord {
    return {
      id: record.id,
      userId: record.userId,
      tenantId: record.tenantId,
      totpSecret: record.totpSecret,
      totpSecretEncrypted: record.totpSecretEncrypted ?? true,
      status: record.status as MfaStatus,
      enabledAt: record.enabledAt,
      enrollmentStartedAt: record.enrollmentStartedAt,
      enrollmentExpiresAt: record.enrollmentExpiresAt,
      gracePeriodEndsAt: record.gracePeriodEndsAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapBackupCodeRecord(record: MfaBackupCodeSelect): MfaBackupCodeRecord {
    return {
      id: record.id,
      userMfaId: record.userMfaId,
      codeHash: record.codeHash,
      usedAt: record.usedAt,
      usedFromIp: record.usedFromIp,
      createdAt: record.createdAt,
    };
  }

  private mapChallengeRecord(record: MfaChallengeSelect): MfaChallengeRecord {
    return {
      id: record.id,
      userId: record.userId,
      sessionId: record.sessionId,
      challengeToken: record.challengeToken,
      verified: record.verified ?? false,
      verifiedAt: record.verifiedAt,
      attempts: record.attempts ?? 0,
      maxAttempts: record.maxAttempts ?? 5,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let mfaStoreInstance: MfaStore | null = null;

/**
 * Get the singleton MFA store instance
 */
export function getMfaStore(): MfaStore {
  if (!mfaStoreInstance) {
    mfaStoreInstance = new MfaStore();
  }
  return mfaStoreInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetMfaStore(): void {
  mfaStoreInstance = null;
}

/**
 * Create a new MFA store with custom database (for testing)
 */
export function createMfaStore(database: Database): MfaStore {
  return new MfaStore(database);
}
