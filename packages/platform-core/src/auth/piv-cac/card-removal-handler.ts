/**
 * Card Removal Handler
 *
 * Handles smart card removal events and manages session termination
 * for PIV/CAC authentication.
 *
 * Features:
 * - Card removal detection via PKCS#11
 * - Session binding to card presence
 * - Configurable grace periods
 * - Re-authentication support
 * - Webhook notifications
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../common/logger.js';
import {
  type CardEvent,
  type CardSessionBinding,
  type CardRemovalPolicy,
  CardEventType,
  PIVErrorCode,
} from './types.js';

const logger = createLogger({ component: 'piv-card-removal-handler' });

// =============================================================================
// Constants
// =============================================================================

/** Default card removal policy */
const DEFAULT_CARD_REMOVAL_POLICY: CardRemovalPolicy = {
  terminateSession: true,
  gracePeriod: 0,
  allowReauthentication: false,
  reauthenticationTimeout: 60000, // 1 minute
};

// =============================================================================
// Types
// =============================================================================

/**
 * Session state
 */
export enum SessionState {
  /** Session is active with card present */
  ACTIVE = 'active',
  /** Card removed, within grace period */
  GRACE_PERIOD = 'grace_period',
  /** Awaiting re-authentication */
  AWAITING_REAUTH = 'awaiting_reauth',
  /** Session terminated */
  TERMINATED = 'terminated',
}

/**
 * Session entry with state tracking
 */
interface SessionEntry {
  binding: CardSessionBinding;
  state: SessionState;
  cardRemovalTime?: Date;
  gracePeriodTimer?: NodeJS.Timeout;
  reauthTimer?: NodeJS.Timeout;
}

/**
 * Card removal event
 */
export interface CardRemovalEvent extends CardEvent {
  type: CardEventType.CARD_REMOVED;
  sessionIds: string[];
  action: 'terminate' | 'grace_period' | 'await_reauth';
}

/**
 * Session termination event
 */
export interface SessionTerminationEvent {
  sessionId: string;
  userId: string;
  reason: 'card_removed' | 'grace_period_expired' | 'reauth_timeout' | 'manual';
  timestamp: Date;
}

/**
 * Card removal handler events
 */
export interface CardRemovalHandlerEvents {
  cardInserted: (event: CardEvent) => void;
  cardRemoved: (event: CardRemovalEvent) => void;
  sessionTerminated: (event: SessionTerminationEvent) => void;
  gracePeriodStarted: (sessionId: string, expiresAt: Date) => void;
  gracePeriodExpired: (sessionId: string) => void;
  reauthRequired: (sessionId: string, expiresAt: Date) => void;
  reauthTimeout: (sessionId: string) => void;
  reauthSuccess: (sessionId: string) => void;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Card removal error
 */
export class CardRemovalError extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode = PIVErrorCode.CARD_REMOVED,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CardRemovalError';
  }
}

/**
 * Session not found error
 */
export class SessionNotFoundError extends CardRemovalError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, PIVErrorCode.SESSION_EXPIRED, { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Re-authentication required error
 */
export class ReauthenticationRequiredError extends CardRemovalError {
  constructor(sessionId: string) {
    super(
      'Card removed, re-authentication required',
      PIVErrorCode.CARD_REMOVED,
      { sessionId }
    );
    this.name = 'ReauthenticationRequiredError';
  }
}

// =============================================================================
// Card Removal Handler
// =============================================================================

/**
 * Card removal handler service
 */
export class CardRemovalHandler extends EventEmitter {
  private policy: CardRemovalPolicy;
  private sessions: Map<string, SessionEntry> = new Map();
  private readerToSessions: Map<string, Set<string>> = new Map();
  private atrToSessions: Map<string, Set<string>> = new Map();

  constructor(policy: Partial<CardRemovalPolicy> = {}) {
    super();
    this.policy = { ...DEFAULT_CARD_REMOVAL_POLICY, ...policy };
  }

  /**
   * Bind a session to a card
   */
  bindSession(binding: CardSessionBinding): void {
    const entry: SessionEntry = {
      binding,
      state: SessionState.ACTIVE,
    };

    this.sessions.set(binding.sessionId, entry);

    // Index by reader
    if (!this.readerToSessions.has(binding.readerName)) {
      this.readerToSessions.set(binding.readerName, new Set());
    }
    this.readerToSessions.get(binding.readerName)!.add(binding.sessionId);

    // Index by ATR
    if (!this.atrToSessions.has(binding.atr)) {
      this.atrToSessions.set(binding.atr, new Set());
    }
    this.atrToSessions.get(binding.atr)!.add(binding.sessionId);

    logger.info(
      {
        sessionId: binding.sessionId,
        userId: binding.userId,
        readerName: binding.readerName,
      },
      'Session bound to card'
    );
  }

  /**
   * Unbind a session from card tracking
   */
  unbindSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    // Clear timers
    if (entry.gracePeriodTimer) {
      clearTimeout(entry.gracePeriodTimer);
    }
    if (entry.reauthTimer) {
      clearTimeout(entry.reauthTimer);
    }

    // Remove from indexes
    const readerSessions = this.readerToSessions.get(entry.binding.readerName);
    readerSessions?.delete(sessionId);

    const atrSessions = this.atrToSessions.get(entry.binding.atr);
    atrSessions?.delete(sessionId);

    // Remove session
    this.sessions.delete(sessionId);

    logger.info({ sessionId }, 'Session unbound from card');
  }

  /**
   * Handle card insertion event
   */
  handleCardInserted(event: CardEvent): void {
    logger.info(
      { readerName: event.readerName, atr: event.atr },
      'Card inserted'
    );

    // Check for sessions awaiting re-authentication
    if (event.atr) {
      const sessionIds = this.atrToSessions.get(event.atr);
      if (sessionIds) {
        for (const sessionId of sessionIds) {
          const entry = this.sessions.get(sessionId);
          if (entry?.state === SessionState.AWAITING_REAUTH) {
            this.handleReauthentication(sessionId, event);
          }
        }
      }
    }

    this.emit('cardInserted', event);
  }

  /**
   * Handle card removal event
   */
  handleCardRemoved(event: CardEvent): void {
    logger.info(
      { readerName: event.readerName, atr: event.atr },
      'Card removed'
    );

    // Find affected sessions
    const affectedSessionIds: string[] = [];

    // By reader
    const readerSessions = this.readerToSessions.get(event.readerName);
    if (readerSessions) {
      affectedSessionIds.push(...readerSessions);
    }

    // By ATR (if available)
    if (event.atr) {
      const atrSessions = this.atrToSessions.get(event.atr);
      if (atrSessions) {
        for (const sessionId of atrSessions) {
          if (!affectedSessionIds.includes(sessionId)) {
            affectedSessionIds.push(sessionId);
          }
        }
      }
    }

    if (affectedSessionIds.length === 0) {
      logger.debug({ readerName: event.readerName }, 'No sessions affected by card removal');
      return;
    }

    // Determine action based on policy
    let action: 'terminate' | 'grace_period' | 'await_reauth';

    if (!this.policy.terminateSession) {
      action = 'await_reauth';
    } else if (this.policy.gracePeriod > 0) {
      action = 'grace_period';
    } else if (this.policy.allowReauthentication) {
      action = 'await_reauth';
    } else {
      action = 'terminate';
    }

    // Process affected sessions
    for (const sessionId of affectedSessionIds) {
      this.processCardRemoval(sessionId, action);
    }

    // Emit card removal event
    const removalEvent: CardRemovalEvent = {
      ...event,
      type: CardEventType.CARD_REMOVED,
      sessionIds: affectedSessionIds,
      action,
    };

    this.emit('cardRemoved', removalEvent);

    // Send webhook notification
    this.sendWebhookNotification(removalEvent);
  }

  /**
   * Process card removal for a session
   */
  private processCardRemoval(
    sessionId: string,
    action: 'terminate' | 'grace_period' | 'await_reauth'
  ): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    entry.cardRemovalTime = new Date();

    switch (action) {
      case 'terminate':
        this.terminateSession(sessionId, 'card_removed');
        break;

      case 'grace_period':
        this.startGracePeriod(sessionId, entry);
        break;

      case 'await_reauth':
        this.startReauthentication(sessionId, entry);
        break;
    }
  }

  /**
   * Start grace period for a session
   */
  private startGracePeriod(sessionId: string, entry: SessionEntry): void {
    entry.state = SessionState.GRACE_PERIOD;

    const expiresAt = new Date(Date.now() + this.policy.gracePeriod);

    entry.gracePeriodTimer = setTimeout(() => {
      const currentEntry = this.sessions.get(sessionId);
      if (currentEntry?.state === SessionState.GRACE_PERIOD) {
        this.emit('gracePeriodExpired', sessionId);

        if (this.policy.allowReauthentication) {
          this.startReauthentication(sessionId, currentEntry);
        } else {
          this.terminateSession(sessionId, 'grace_period_expired');
        }
      }
    }, this.policy.gracePeriod);

    logger.info(
      { sessionId, expiresAt, gracePeriod: this.policy.gracePeriod },
      'Grace period started'
    );

    this.emit('gracePeriodStarted', sessionId, expiresAt);
  }

  /**
   * Start re-authentication flow for a session
   */
  private startReauthentication(sessionId: string, entry: SessionEntry): void {
    // Clear any existing timers
    if (entry.gracePeriodTimer) {
      clearTimeout(entry.gracePeriodTimer);
      entry.gracePeriodTimer = undefined;
    }

    entry.state = SessionState.AWAITING_REAUTH;

    const expiresAt = new Date(Date.now() + this.policy.reauthenticationTimeout);

    entry.reauthTimer = setTimeout(() => {
      const currentEntry = this.sessions.get(sessionId);
      if (currentEntry?.state === SessionState.AWAITING_REAUTH) {
        this.emit('reauthTimeout', sessionId);
        this.terminateSession(sessionId, 'reauth_timeout');
      }
    }, this.policy.reauthenticationTimeout);

    logger.info(
      { sessionId, expiresAt, timeout: this.policy.reauthenticationTimeout },
      'Re-authentication required'
    );

    this.emit('reauthRequired', sessionId, expiresAt);
  }

  /**
   * Handle successful re-authentication
   */
  private handleReauthentication(sessionId: string, event: CardEvent): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    // Verify the same card (by ATR) was re-inserted
    if (event.atr && event.atr !== entry.binding.atr) {
      logger.warn(
        {
          sessionId,
          expectedAtr: entry.binding.atr,
          actualAtr: event.atr,
        },
        'Different card inserted, re-authentication rejected'
      );
      return;
    }

    // Clear re-auth timer
    if (entry.reauthTimer) {
      clearTimeout(entry.reauthTimer);
      entry.reauthTimer = undefined;
    }

    // Restore session
    entry.state = SessionState.ACTIVE;
    entry.cardRemovalTime = undefined;
    entry.binding.lastActivity = new Date();

    logger.info({ sessionId }, 'Re-authentication successful');

    this.emit('reauthSuccess', sessionId);
  }

  /**
   * Terminate a session
   */
  terminateSession(
    sessionId: string,
    reason: 'card_removed' | 'grace_period_expired' | 'reauth_timeout' | 'manual'
  ): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    entry.state = SessionState.TERMINATED;

    // Clear timers
    if (entry.gracePeriodTimer) {
      clearTimeout(entry.gracePeriodTimer);
    }
    if (entry.reauthTimer) {
      clearTimeout(entry.reauthTimer);
    }

    const terminationEvent: SessionTerminationEvent = {
      sessionId,
      userId: entry.binding.userId,
      reason,
      timestamp: new Date(),
    };

    logger.info(
      { sessionId, userId: entry.binding.userId, reason },
      'Session terminated'
    );

    this.emit('sessionTerminated', terminationEvent);

    // Remove session
    this.unbindSession(sessionId);
  }

  /**
   * Check if a session is valid (card present)
   */
  isSessionValid(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;

    // Check expiration
    if (new Date() >= entry.binding.expiresAt) {
      this.terminateSession(sessionId, 'manual');
      return false;
    }

    return entry.state === SessionState.ACTIVE;
  }

  /**
   * Get session state
   */
  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  /**
   * Get session binding
   */
  getSessionBinding(sessionId: string): CardSessionBinding | undefined {
    return this.sessions.get(sessionId)?.binding;
  }

  /**
   * Update session activity timestamp
   */
  updateSessionActivity(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.binding.lastActivity = new Date();
    }
  }

  /**
   * Validate session and throw if invalid
   */
  validateSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);

    if (!entry) {
      throw new SessionNotFoundError(sessionId);
    }

    switch (entry.state) {
      case SessionState.ACTIVE:
        // Valid
        break;

      case SessionState.GRACE_PERIOD:
        // Allow during grace period but warn
        logger.debug({ sessionId }, 'Session in grace period');
        break;

      case SessionState.AWAITING_REAUTH:
        throw new ReauthenticationRequiredError(sessionId);

      case SessionState.TERMINATED:
        throw new CardRemovalError(
          'Session has been terminated',
          PIVErrorCode.SESSION_EXPIRED,
          { sessionId }
        );
    }

    // Check expiration
    if (new Date() >= entry.binding.expiresAt) {
      this.terminateSession(sessionId, 'manual');
      throw new CardRemovalError(
        'Session has expired',
        PIVErrorCode.SESSION_EXPIRED,
        { sessionId }
      );
    }
  }

  /**
   * Re-authenticate session with new certificate
   */
  reauthenticateSession(
    sessionId: string,
    certificateFingerprint: string
  ): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;

    // Verify same certificate
    if (entry.binding.certificateFingerprint !== certificateFingerprint) {
      logger.warn(
        {
          sessionId,
          expectedFingerprint: entry.binding.certificateFingerprint,
          actualFingerprint: certificateFingerprint,
        },
        'Certificate mismatch during re-authentication'
      );
      return false;
    }

    // Clear re-auth timer
    if (entry.reauthTimer) {
      clearTimeout(entry.reauthTimer);
      entry.reauthTimer = undefined;
    }

    // Restore session
    entry.state = SessionState.ACTIVE;
    entry.cardRemovalTime = undefined;
    entry.binding.lastActivity = new Date();

    logger.info({ sessionId }, 'Session re-authenticated successfully');

    this.emit('reauthSuccess', sessionId);

    return true;
  }

  /**
   * Send webhook notification for card removal
   */
  private async sendWebhookNotification(event: CardRemovalEvent): Promise<void> {
    if (!this.policy.notificationWebhook) return;

    try {
      const response = await fetch(this.policy.notificationWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: 'card_removed',
          timestamp: event.timestamp.toISOString(),
          readerName: event.readerName,
          atr: event.atr,
          sessionIds: event.sessionIds,
          action: event.action,
        }),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, webhook: this.policy.notificationWebhook },
          'Webhook notification failed'
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send webhook notification');
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): CardSessionBinding[] {
    return Array.from(this.sessions.values())
      .filter((entry) => entry.state === SessionState.ACTIVE)
      .map((entry) => entry.binding);
  }

  /**
   * Get sessions by state
   */
  getSessionsByState(state: SessionState): CardSessionBinding[] {
    return Array.from(this.sessions.values())
      .filter((entry) => entry.state === state)
      .map((entry) => entry.binding);
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    active: number;
    gracePeriod: number;
    awaitingReauth: number;
    terminated: number;
  } {
    const stats = {
      total: this.sessions.size,
      active: 0,
      gracePeriod: 0,
      awaitingReauth: 0,
      terminated: 0,
    };

    for (const entry of this.sessions.values()) {
      switch (entry.state) {
        case SessionState.ACTIVE:
          stats.active++;
          break;
        case SessionState.GRACE_PERIOD:
          stats.gracePeriod++;
          break;
        case SessionState.AWAITING_REAUTH:
          stats.awaitingReauth++;
          break;
        case SessionState.TERMINATED:
          stats.terminated++;
          break;
      }
    }

    return stats;
  }

  /**
   * Update policy
   */
  updatePolicy(policy: Partial<CardRemovalPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    logger.info({ policy: this.policy }, 'Card removal policy updated');
  }

  /**
   * Get current policy
   */
  getPolicy(): CardRemovalPolicy {
    return { ...this.policy };
  }

  /**
   * Shutdown handler (clear all timers)
   */
  shutdown(): void {
    for (const entry of this.sessions.values()) {
      if (entry.gracePeriodTimer) {
        clearTimeout(entry.gracePeriodTimer);
      }
      if (entry.reauthTimer) {
        clearTimeout(entry.reauthTimer);
      }
    }
    this.sessions.clear();
    this.readerToSessions.clear();
    this.atrToSessions.clear();
    this.removeAllListeners();
    logger.info('Card removal handler shutdown');
  }
}

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultHandler: CardRemovalHandler | null = null;

/**
 * Get the default card removal handler
 */
export function getCardRemovalHandler(policy?: Partial<CardRemovalPolicy>): CardRemovalHandler {
  if (!defaultHandler || policy) {
    defaultHandler = new CardRemovalHandler(policy);
  }
  return defaultHandler;
}

/**
 * Create a new card removal handler
 */
export function createCardRemovalHandler(
  policy: Partial<CardRemovalPolicy> = {}
): CardRemovalHandler {
  return new CardRemovalHandler(policy);
}

/**
 * Reset the default handler (for testing)
 */
export function resetCardRemovalHandler(): void {
  if (defaultHandler) {
    defaultHandler.shutdown();
    defaultHandler = null;
  }
}
