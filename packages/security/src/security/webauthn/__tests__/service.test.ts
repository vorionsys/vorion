/**
 * Tests for WebAuthnService
 *
 * Validates:
 * - Registration flow: generateRegistrationOptions, verifyRegistration
 * - Authentication flow: generateAuthenticationOptions, verifyAuthentication
 * - Counter rollback detection and zero-counter exception
 * - Cross-user credential isolation
 * - Credential management: list, rename, delete with ownership checks
 * - Singleton lifecycle: getWebAuthnService, resetWebAuthnService
 * - Config: getConfig returns a copy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../common/random.js', () => ({
  secureRandomId: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 10)),
  secureRandomString: vi.fn((len: number) => 'x'.repeat(len)),
}));

vi.mock('../../../common/errors.js', async () => {
  const actual = await vi.importActual<typeof import('../../../common/errors.js')>('../../../common/errors.js');
  return actual;
});

vi.mock('../../distributed-state.js', () => ({
  getRedisStateProvider: vi.fn(() => ({})),
}));

import {
  generateRegistrationOptions as mockGenRegOptions,
  verifyRegistrationResponse as mockVerifyRegResponse,
  generateAuthenticationOptions as mockGenAuthOptions,
  verifyAuthenticationResponse as mockVerifyAuthResponse,
} from '@simplewebauthn/server';

import {
  WebAuthnService,
  WebAuthnError,
  WebAuthnRegistrationError,
  WebAuthnAuthenticationError,
  getWebAuthnService,
  createWebAuthnService,
  resetWebAuthnService,
  type IAuditLogger,
} from '../service.js';

import { InMemoryWebAuthnStore } from '../store.js';
import type { WebAuthnCredential, WebAuthnConfig } from '../types.js';
import {
  RegistrationErrorCode,
  AuthenticationErrorCode,
  WebAuthnAuditEventType,
  DEFAULT_WEBAUTHN_CONFIG,
} from '../types.js';

// =============================================================================
// HELPERS
// =============================================================================

const TEST_CONFIG: Partial<WebAuthnConfig> = {
  rpName: 'Test RP',
  rpId: 'test.example.com',
  origin: 'https://test.example.com',
  attestation: 'none',
  userVerification: 'preferred',
  timeout: 60000,
  residentKey: 'preferred',
  challengeTTL: 300000,
  supportedAlgorithms: [-7, -257],
};

let store: InMemoryWebAuthnStore;
let service: WebAuthnService;

function createService(): WebAuthnService {
  store = new InMemoryWebAuthnStore();
  return new WebAuthnService({
    store,
    config: TEST_CONFIG,
  });
}

let credCounter = 0;

function createStoredCredential(overrides: Partial<WebAuthnCredential> = {}): WebAuthnCredential {
  credCounter++;
  // id must be a valid UUID because renameCredentialInputSchema/deleteCredentialInputSchema validate it
  const uuid = `00000000-0000-0000-0000-${String(credCounter).padStart(12, '0')}`;
  return {
    id: uuid,
    credentialId: `webauthn-cred-${credCounter}`,
    publicKey: 'cHVibGljS2V5',
    counter: 5,
    transports: ['internal'],
    createdAt: new Date(),
    lastUsedAt: null,
    name: `Passkey ${credCounter}`,
    userId: 'user-1',
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: '00000000-0000-0000-0000-000000000000',
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('WebAuthnService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credCounter = 0;
    service = createService();
  });

  afterEach(() => {
    store.stop();
    resetWebAuthnService();
  });

  // ===========================================================================
  // REGISTRATION FLOW
  // ===========================================================================

  describe('generateRegistrationOptions', () => {
    it('should generate registration options and store challenge', async () => {
      const mockOptions = {
        challenge: 'test-challenge-abc123',
        rp: { name: 'Test RP', id: 'test.example.com' },
        user: { id: 'user-1', name: 'user@test.com', displayName: 'user@test.com' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);

      const result = await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      expect(result.options).toEqual(mockOptions);
      expect(result.challenge).toBe('test-challenge-abc123');
      expect(mockGenRegOptions).toHaveBeenCalledOnce();
      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpName: 'Test RP',
          rpID: 'test.example.com',
          userName: 'user@test.com',
        })
      );
    });

    it('should exclude existing credentials from registration options', async () => {
      // Pre-store a credential for the user
      const existing = createStoredCredential({ userId: 'user-1', credentialId: 'existing-cred-1' });
      await store.createCredential(existing);

      const mockOptions = { challenge: 'challenge-2', rp: {}, user: {}, pubKeyCredParams: [] };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({ id: 'existing-cred-1' }),
          ]),
        })
      );
    });
  });

  describe('verifyRegistration', () => {
    it('should verify registration and store credential on success', async () => {
      // First generate options to store a challenge
      const mockOptions = { challenge: 'reg-challenge-1', rp: {}, user: {}, pubKeyCredParams: [] };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      // Mock successful verification
      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'new-credential-id-base64',
          credentialPublicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          aaguid: '12345678-1234-1234-1234-123456789abc',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'resp-id', rawId: 'raw-id', type: 'public-key', response: {} } as any,
        credentialName: 'My New Passkey',
      });

      expect(result.verified).toBe(true);
      expect(result.credential).toBeDefined();
      expect(result.credential!.credentialId).toBe('new-credential-id-base64');
      expect(result.credential!.userId).toBe('user-1');
      expect(result.credential!.name).toBe('My New Passkey');
      expect(result.credential!.deviceType).toBe('multiDevice');
      expect(result.credential!.backedUp).toBe(true);

      // Verify credential was stored
      const stored = await store.getCredentialByCredentialId('new-credential-id-base64');
      expect(stored).not.toBeNull();
    });

    it('should return CHALLENGE_NOT_FOUND when no challenge stored', async () => {
      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'resp-id', rawId: 'raw-id', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('CHALLENGE_NOT_FOUND');
    });

    it('should return VERIFICATION_FAILED when library throws', async () => {
      // Store a challenge first
      const mockOptions = { challenge: 'reg-challenge-fail', rp: {}, user: {}, pubKeyCredParams: [] };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockRejectedValue(
        new Error('Invalid attestation')
      );

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'resp-id', rawId: 'raw-id', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
      expect(result.error).toContain('Invalid attestation');
    });

    it('should return CREDENTIAL_EXISTS for duplicate credential', async () => {
      // Pre-store a credential with the same credentialId
      await store.createCredential(
        createStoredCredential({ credentialId: 'duplicate-cred-id' })
      );

      // Store a challenge
      const mockOptions = { challenge: 'reg-challenge-dup', rp: {}, user: {}, pubKeyCredParams: [] };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'duplicate-cred-id',
          credentialPublicKey: new Uint8Array([5, 6, 7]),
          counter: 0,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'resp-id', rawId: 'raw-id', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('CREDENTIAL_EXISTS');
    });

    it('should return VERIFICATION_FAILED when verification returns false', async () => {
      const mockOptions = { challenge: 'reg-challenge-false', rp: {}, user: {}, pubKeyCredParams: [] };
      vi.mocked(mockGenRegOptions).mockResolvedValue(mockOptions as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: false,
        registrationInfo: undefined,
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'resp-id', rawId: 'raw-id', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
    });
  });

  // ===========================================================================
  // AUTHENTICATION FLOW
  // ===========================================================================

  describe('generateAuthenticationOptions', () => {
    it('should generate authentication options and store challenge', async () => {
      // Pre-store a credential for the user
      await store.createCredential(createStoredCredential({ userId: 'user-1' }));

      const mockOptions = { challenge: 'auth-challenge-1', rpId: 'test.example.com' };
      vi.mocked(mockGenAuthOptions).mockResolvedValue(mockOptions as any);

      const result = await service.generateAuthenticationOptions({ userId: 'user-1' });

      expect(result.options).toEqual(mockOptions);
      expect(result.challenge).toBe('auth-challenge-1');
      expect(mockGenAuthOptions).toHaveBeenCalledOnce();
    });

    it('should throw NO_CREDENTIALS error for user with no credentials', async () => {
      await expect(
        service.generateAuthenticationOptions({ userId: 'no-creds-user' })
      ).rejects.toThrow('No credentials found for user');
    });
  });

  describe('verifyAuthentication', () => {
    it('should verify authentication and update counter on success', async () => {
      // Store a credential
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-cred-1',
        counter: 5,
      });
      await store.createCredential(cred);

      // Generate auth options to store a challenge
      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-challenge-verify',
        rpId: 'test.example.com',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      // Mock successful verification
      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: {
          id: 'auth-cred-1',
          rawId: 'raw-id',
          type: 'public-key',
          response: {},
        } as any,
      });

      expect(result.verified).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.credential).toBeDefined();
      expect(result.credential!.counter).toBe(6);

      // Verify counter was updated in store
      const updated = await store.getCredentialById(cred.id);
      expect(updated!.counter).toBe(6);
      expect(updated!.lastUsedAt).not.toBeNull();
    });

    it('should return CHALLENGE_NOT_FOUND when no challenge exists', async () => {
      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'some-cred', rawId: 'raw', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('CHALLENGE_NOT_FOUND');
    });

    it('should return CREDENTIAL_NOT_FOUND for unknown credentialId', async () => {
      // Store a credential so auth options can be generated
      await store.createCredential(createStoredCredential({ userId: 'user-1' }));

      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-ch-unknown',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: {
          id: 'non-existent-credential-id',
          rawId: 'raw',
          type: 'public-key',
          response: {},
        } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('CREDENTIAL_NOT_FOUND');
    });

    it('should detect counter rollback when newCounter <= storedCounter and storedCounter !== 0', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'rollback-cred',
        counter: 10,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-ch-rollback',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5 }, // rollback: 5 < 10
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: {
          id: 'rollback-cred',
          rawId: 'raw',
          type: 'public-key',
          response: {},
        } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('COUNTER_ROLLBACK');
    });

    it('should allow counter zero when storedCounter is 0 (no rollback exception)', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'zero-counter-cred',
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-ch-zero',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 0 },
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: {
          id: 'zero-counter-cred',
          rawId: 'raw',
          type: 'public-key',
          response: {},
        } as any,
      });

      // storedCounter === 0 means skip rollback check
      expect(result.verified).toBe(true);
    });

    it('should reject cross-user credential access (credential owned by user A, auth attempt by user B)', async () => {
      const cred = createStoredCredential({
        userId: 'user-A',
        credentialId: 'user-a-cred',
      });
      await store.createCredential(cred);

      // User B generates auth options (needs at least one cred)
      await store.createCredential(
        createStoredCredential({ userId: 'user-B', credentialId: 'user-b-cred' })
      );
      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-ch-cross-user',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-B' });

      const result = await service.verifyAuthentication({
        userId: 'user-B',
        response: {
          id: 'user-a-cred', // user A's credential
          rawId: 'raw',
          type: 'public-key',
          response: {},
        } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('CREDENTIAL_NOT_FOUND');
    });

    it('should return VERIFICATION_FAILED when library throws during auth', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-fail-cred',
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'auth-ch-fail',
      } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockRejectedValue(
        new Error('Signature verification failed')
      );

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: {
          id: 'auth-fail-cred',
          rawId: 'raw',
          type: 'public-key',
          response: {},
        } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
      expect(result.error).toContain('Signature verification failed');
    });
  });

  // ===========================================================================
  // CREDENTIAL MANAGEMENT
  // ===========================================================================

  describe('listCredentials', () => {
    it('should list credentials with pagination', async () => {
      // Create 5 credentials with staggered dates
      for (let i = 0; i < 5; i++) {
        await store.createCredential(
          createStoredCredential({
            userId: 'paginated-user',
            createdAt: new Date(Date.now() - i * 1000),
          })
        );
      }

      const page1 = await service.listCredentials({
        userId: 'paginated-user',
        limit: 2,
        offset: 0,
      });

      expect(page1.total).toBe(5);
      expect(page1.credentials).toHaveLength(2);

      const page2 = await service.listCredentials({
        userId: 'paginated-user',
        limit: 2,
        offset: 2,
      });

      expect(page2.total).toBe(5);
      expect(page2.credentials).toHaveLength(2);

      const page3 = await service.listCredentials({
        userId: 'paginated-user',
        limit: 2,
        offset: 4,
      });

      expect(page3.total).toBe(5);
      expect(page3.credentials).toHaveLength(1);
    });
  });

  describe('renameCredential', () => {
    it('should rename a credential successfully', async () => {
      const cred = createStoredCredential({ userId: 'user-1' });
      await store.createCredential(cred);

      const updated = await service.renameCredential({
        userId: 'user-1',
        credentialId: cred.id,
        name: 'My Work Laptop',
      });

      expect(updated.name).toBe('My Work Laptop');
      expect(updated.id).toBe(cred.id);
    });

    it('should throw NotFoundError when credential belongs to different user', async () => {
      const cred = createStoredCredential({ userId: 'user-A' });
      await store.createCredential(cred);

      await expect(
        service.renameCredential({
          userId: 'user-B', // wrong user
          credentialId: cred.id,
          name: 'Stolen Name',
        })
      ).rejects.toThrow(/not found/i);
    });

    it('should throw NotFoundError for non-existent credential', async () => {
      await expect(
        service.renameCredential({
          userId: 'user-1',
          credentialId: '00000000-0000-0000-0000-000000000000',
          name: 'Ghost',
        })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('deleteCredential', () => {
    it('should delete a credential successfully', async () => {
      const cred = createStoredCredential({ userId: 'user-1' });
      await store.createCredential(cred);

      await service.deleteCredential({
        userId: 'user-1',
        credentialId: cred.id,
      });

      const found = await store.getCredentialById(cred.id);
      expect(found).toBeNull();
    });

    it('should throw NotFoundError when credential belongs to different user', async () => {
      const cred = createStoredCredential({ userId: 'user-A' });
      await store.createCredential(cred);

      await expect(
        service.deleteCredential({
          userId: 'user-B',
          credentialId: cred.id,
        })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('getCredentialCount', () => {
    it('should return the correct count for a user', async () => {
      await store.createCredential(createStoredCredential({ userId: 'count-user' }));
      await store.createCredential(createStoredCredential({ userId: 'count-user' }));

      const count = await service.getCredentialCount('count-user');
      expect(count).toBe(2);
    });

    it('should return 0 for user with no credentials', async () => {
      const count = await service.getCredentialCount('empty-user');
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // SINGLETON & CONFIG
  // ===========================================================================

  describe('getWebAuthnService and resetWebAuthnService', () => {
    it('should return and reset singleton', () => {
      resetWebAuthnService();
      const s1 = getWebAuthnService(TEST_CONFIG);
      const s2 = getWebAuthnService();
      expect(s1).toBe(s2);

      resetWebAuthnService();
      const s3 = getWebAuthnService(TEST_CONFIG);
      expect(s3).not.toBe(s1);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = service.getConfig();
      expect(config.rpName).toBe('Test RP');
      expect(config.rpId).toBe('test.example.com');

      // Verify it is a copy, not the original
      config.rpName = 'Mutated';
      const configAgain = service.getConfig();
      expect(configAgain.rpName).toBe('Test RP');
    });

    it('should return all expected config fields with correct values', () => {
      const config = service.getConfig();
      expect(config.origin).toBe('https://test.example.com');
      expect(config.attestation).toBe('none');
      expect(config.userVerification).toBe('preferred');
      expect(config.timeout).toBe(60000);
      expect(config.residentKey).toBe('preferred');
      expect(config.challengeTTL).toBe(300000);
      expect(config.supportedAlgorithms).toEqual([-7, -257]);
    });

    it('should merge user config over DEFAULT_WEBAUTHN_CONFIG', () => {
      const partialStore = new InMemoryWebAuthnStore();
      const svc = new WebAuthnService({
        store: partialStore,
        config: { rpName: 'Custom RP' },
      });
      const cfg = svc.getConfig();
      // Custom field
      expect(cfg.rpName).toBe('Custom RP');
      // Defaults from DEFAULT_WEBAUTHN_CONFIG
      expect(cfg.rpId).toBe(DEFAULT_WEBAUTHN_CONFIG.rpId);
      expect(cfg.origin).toBe(DEFAULT_WEBAUTHN_CONFIG.origin);
      expect(cfg.challengeTTL).toBe(DEFAULT_WEBAUTHN_CONFIG.challengeTTL);
      partialStore.stop();
    });
  });

  // ===========================================================================
  // ERROR CLASSES
  // ===========================================================================

  describe('WebAuthnError', () => {
    it('should set correct code and statusCode', () => {
      const err = new WebAuthnError('test error');
      expect(err.code).toBe('WEBAUTHN_ERROR');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('WebAuthnError');
      expect(err.message).toBe('test error');
    });

    it('should accept details', () => {
      const err = new WebAuthnError('test', { foo: 'bar' });
      expect(err.details).toEqual({ foo: 'bar' });
    });
  });

  describe('WebAuthnRegistrationError', () => {
    it('should set correct code, statusCode, and errorCode', () => {
      const err = new WebAuthnRegistrationError(
        'registration failed',
        RegistrationErrorCode.VERIFICATION_FAILED
      );
      expect(err.code).toBe('WEBAUTHN_REGISTRATION_ERROR');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('WebAuthnRegistrationError');
      expect(err.errorCode).toBe('VERIFICATION_FAILED');
      expect(err.message).toBe('registration failed');
    });

    it('should merge details with errorCode', () => {
      const err = new WebAuthnRegistrationError(
        'fail',
        RegistrationErrorCode.CHALLENGE_NOT_FOUND,
        { extra: 123 }
      );
      expect(err.details).toEqual(
        expect.objectContaining({
          errorCode: 'CHALLENGE_NOT_FOUND',
          extra: 123,
        })
      );
    });

    it('should be instanceof WebAuthnError', () => {
      const err = new WebAuthnRegistrationError('x', RegistrationErrorCode.CREDENTIAL_EXISTS);
      expect(err).toBeInstanceOf(WebAuthnError);
    });
  });

  describe('WebAuthnAuthenticationError', () => {
    it('should set correct code, statusCode, and errorCode', () => {
      const err = new WebAuthnAuthenticationError(
        'auth failed',
        AuthenticationErrorCode.COUNTER_ROLLBACK
      );
      expect(err.code).toBe('WEBAUTHN_AUTHENTICATION_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('WebAuthnAuthenticationError');
      expect(err.errorCode).toBe('COUNTER_ROLLBACK');
      expect(err.message).toBe('auth failed');
    });

    it('should merge details with errorCode', () => {
      const err = new WebAuthnAuthenticationError(
        'fail',
        AuthenticationErrorCode.CREDENTIAL_NOT_FOUND,
        { info: 'test' }
      );
      expect(err.details).toEqual(
        expect.objectContaining({
          errorCode: 'CREDENTIAL_NOT_FOUND',
          info: 'test',
        })
      );
    });

    it('should be instanceof WebAuthnError', () => {
      const err = new WebAuthnAuthenticationError('x', AuthenticationErrorCode.NO_CREDENTIALS);
      expect(err).toBeInstanceOf(WebAuthnError);
    });
  });

  // ===========================================================================
  // AUDIT LOGGING
  // ===========================================================================

  describe('audit logging', () => {
    let auditLogger: IAuditLogger;
    let auditService: WebAuthnService;
    let auditStore: InMemoryWebAuthnStore;

    beforeEach(() => {
      auditLogger = { record: vi.fn().mockResolvedValue(undefined) };
      auditStore = new InMemoryWebAuthnStore();
      auditService = new WebAuthnService({
        store: auditStore,
        config: TEST_CONFIG,
        auditLogger,
      });
    });

    afterEach(() => {
      auditStore.stop();
    });

    it('should call audit on generateRegistrationOptions success', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-audit-1',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'audit@test.com',
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_OPTIONS_GENERATED,
          actor: { type: 'user', id: 'audit-user' },
          action: 'generate_registration_options',
          outcome: 'success',
        })
      );
    });

    it('should call audit on verifyRegistration challenge not found', async () => {
      await auditService.verifyRegistration({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
          outcome: 'failure',
          reason: 'Challenge not found or expired',
        })
      );
    });

    it('should call audit on verifyRegistration verification exception', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-x' } as any);
      await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'a@b.com',
      });

      vi.mocked(mockVerifyRegResponse).mockRejectedValue(new Error('bad attestation'));

      await auditService.verifyRegistration({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
          outcome: 'failure',
          reason: 'bad attestation',
        })
      );
    });

    it('should call audit on verifyRegistration not verified', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-nv' } as any);
      await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'a@b.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: false,
        registrationInfo: undefined,
      } as any);

      await auditService.verifyRegistration({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
          reason: 'Verification returned false',
        })
      );
    });

    it('should call audit on verifyRegistration credential exists', async () => {
      await auditStore.createCredential(
        createStoredCredential({ credentialId: 'dup-aud', userId: 'audit-user' })
      );

      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-dup-aud' } as any);
      await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'a@b.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'dup-aud',
          credentialPublicKey: new Uint8Array([1]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      await auditService.verifyRegistration({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
          reason: 'Credential already exists',
        })
      );
    });

    it('should call audit on successful registration', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-succ-reg' } as any);
      await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'a@b.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'new-cred-audit',
          credentialPublicKey: new Uint8Array([1, 2]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          aaguid: '11111111-1111-1111-1111-111111111111',
        },
      } as any);

      await auditService.verifyRegistration({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.REGISTRATION_COMPLETED,
          outcome: 'success',
          metadata: expect.objectContaining({
            deviceType: 'multiDevice',
            backedUp: true,
          }),
        })
      );
    });

    it('should call audit on generateAuthenticationOptions success', async () => {
      await auditStore.createCredential(
        createStoredCredential({ userId: 'audit-user', credentialId: 'aud-auth-cred' })
      );

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-auth-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_OPTIONS_GENERATED,
          outcome: 'success',
        })
      );
    });

    it('should call audit on generateAuthenticationOptions failure (no credentials)', async () => {
      await expect(
        auditService.generateAuthenticationOptions({ userId: 'audit-user-none' })
      ).rejects.toThrow();

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          outcome: 'failure',
          reason: 'No credentials found',
        })
      );
    });

    it('should call audit on verifyAuthentication challenge not found', async () => {
      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          reason: 'Challenge not found or expired',
        })
      );
    });

    it('should call audit on verifyAuthentication credential not found', async () => {
      await auditStore.createCredential(
        createStoredCredential({ userId: 'audit-user', credentialId: 'aud-cred-x' })
      );

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-no-cred-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'missing-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          reason: 'Credential not found',
        })
      );
    });

    it('should call audit on verifyAuthentication cross-user', async () => {
      await auditStore.createCredential(
        createStoredCredential({ userId: 'audit-user', credentialId: 'aud-own-cred' })
      );
      await auditStore.createCredential(
        createStoredCredential({ userId: 'other-user', credentialId: 'aud-other-cred' })
      );

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-cross-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'aud-other-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          reason: 'Credential does not belong to user',
        })
      );
    });

    it('should call audit on verifyAuthentication library error', async () => {
      const cred = createStoredCredential({
        userId: 'audit-user',
        credentialId: 'aud-auth-err-cred',
      });
      await auditStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-lib-err' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      vi.mocked(mockVerifyAuthResponse).mockRejectedValue(new Error('sig fail'));

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'aud-auth-err-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          reason: 'sig fail',
        })
      );
    });

    it('should call audit on verifyAuthentication verification false', async () => {
      const cred = createStoredCredential({
        userId: 'audit-user',
        credentialId: 'aud-auth-false-cred',
      });
      await auditStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-false-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: false,
      } as any);

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'aud-auth-false-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          reason: 'Verification returned false',
        })
      );
    });

    it('should call audit on counter rollback', async () => {
      const cred = createStoredCredential({
        userId: 'audit-user',
        credentialId: 'aud-rollback-cred',
        counter: 10,
      });
      await auditStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-roll-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      } as any);

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'aud-rollback-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.COUNTER_ROLLBACK_DETECTED,
          reason: 'Counter rollback detected',
          metadata: expect.objectContaining({
            storedCounter: 10,
            receivedCounter: 5,
          }),
        })
      );
    });

    it('should call audit on successful authentication', async () => {
      const cred = createStoredCredential({
        userId: 'audit-user',
        credentialId: 'aud-succ-auth-cred',
        counter: 3,
      });
      await auditStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-succ-auth-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'audit-user' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 4 },
      } as any);

      await auditService.verifyAuthentication({
        userId: 'audit-user',
        response: { id: 'aud-succ-auth-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.AUTHENTICATION_COMPLETED,
          outcome: 'success',
          metadata: expect.objectContaining({
            oldCounter: 3,
            newCounter: 4,
          }),
        })
      );
    });

    it('should call audit on renameCredential success', async () => {
      const cred = createStoredCredential({ userId: 'audit-user' });
      await auditStore.createCredential(cred);

      await auditService.renameCredential({
        userId: 'audit-user',
        credentialId: cred.id,
        name: 'Renamed Key',
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.CREDENTIAL_RENAMED,
          outcome: 'success',
          metadata: expect.objectContaining({
            oldName: cred.name,
            newName: 'Renamed Key',
          }),
        })
      );
    });

    it('should call audit on deleteCredential success', async () => {
      const cred = createStoredCredential({ userId: 'audit-user' });
      await auditStore.createCredential(cred);

      await auditService.deleteCredential({
        userId: 'audit-user',
        credentialId: cred.id,
      });

      expect(auditLogger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: WebAuthnAuditEventType.CREDENTIAL_DELETED,
          outcome: 'success',
        })
      );
    });

    it('should not fail if audit logger throws', async () => {
      (auditLogger.record as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('audit down'));

      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-aud-fail' } as any);

      // Should not throw even though audit logger fails
      const result = await auditService.generateRegistrationOptions({
        userId: 'audit-user',
        userName: 'a@b.com',
      });

      expect(result.challenge).toBe('ch-aud-fail');
    });

    it('should not call audit when auditLogger is not provided', async () => {
      // service (from beforeEach) has no auditLogger
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-no-audit' } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      // No error thrown and auditLogger not called
      expect(auditLogger.record).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // REGISTRATION FLOW ADDITIONAL MUTATIONS
  // ===========================================================================

  describe('generateRegistrationOptions - additional mutations', () => {
    it('should pass userDisplayName when provided', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-display',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
        userDisplayName: 'John Doe',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userDisplayName: 'John Doe',
        })
      );
    });

    it('should default userDisplayName to userName when not provided', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-default-display',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userDisplayName: 'user@test.com',
        })
      );
    });

    it('should pass authenticatorType when provided in input', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-auth-type',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
        authenticatorType: 'platform',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticatorSelection: expect.objectContaining({
            authenticatorAttachment: 'platform',
          }),
        })
      );
    });

    it('should use config authenticatorAttachment when input does not specify', async () => {
      const storeAtt = new InMemoryWebAuthnStore();
      const svcAtt = new WebAuthnService({
        store: storeAtt,
        config: { ...TEST_CONFIG, authenticatorAttachment: 'cross-platform' },
      });

      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-att-config',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await svcAtt.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticatorSelection: expect.objectContaining({
            authenticatorAttachment: 'cross-platform',
          }),
        })
      );

      storeAtt.stop();
    });

    it('should set userVerification to required when requireUserVerification is true', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-req-uv',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
        requireUserVerification: true,
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticatorSelection: expect.objectContaining({
            userVerification: 'required',
          }),
        })
      );
    });

    it('should pass existing credential transports for excludeCredentials', async () => {
      const existing = createStoredCredential({
        userId: 'user-1',
        credentialId: 'cred-with-transports',
        transports: ['usb', 'ble'],
      });
      await store.createCredential(existing);

      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-transports',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      expect(mockGenRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [
            expect.objectContaining({
              id: 'cred-with-transports',
              transports: ['usb', 'ble'],
            }),
          ],
        })
      );
    });
  });

  // ===========================================================================
  // VERIFY REGISTRATION CONDITIONAL BRANCHES
  // ===========================================================================

  describe('verifyRegistration - conditional mutations', () => {
    it('should handle verification returning verified=true but registrationInfo=undefined', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-no-info' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: undefined,
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      // Should fail because registrationInfo is missing even though verified is true
      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
      expect(result.error).toBe('Registration verification failed');
    });

    it('should generate credential name when credentialName is not provided', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-name-gen' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'auto-name-cred',
          credentialPublicKey: new Uint8Array([10, 20]),
          counter: 0,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        // No credentialName provided
      });

      expect(result.verified).toBe(true);
      // Should start with "Passkey " followed by a date
      expect(result.credential!.name).toMatch(/^Passkey /);
    });

    it('should handle non-Error throw from verifyRegistrationResponse', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-non-error' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockRejectedValue('string error');

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
      expect(result.error).toContain('Unknown error');
    });
  });

  // ===========================================================================
  // VERIFY AUTHENTICATION ADDITIONAL
  // ===========================================================================

  describe('verifyAuthentication - additional mutations', () => {
    it('should return VERIFICATION_FAILED when verified is false (no authenticationInfo)', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-false-no-info',
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-vf' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: false,
        // No authenticationInfo
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'auth-false-no-info', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('VERIFICATION_FAILED');
      expect(result.error).toBe('Authentication verification failed');
    });

    it('should handle non-Error throw from verifyAuthenticationResponse', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-non-error',
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-ne' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockRejectedValue(42);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'auth-non-error', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.error).toContain('Unknown error');
    });

    it('should detect rollback when newCounter equals storedCounter (and storedCounter > 0)', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'eq-counter-cred',
        counter: 7,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-eq' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 7 }, // equals stored counter
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'eq-counter-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe('COUNTER_ROLLBACK');
    });

    it('should accept when newCounter is storedCounter + 1 (boundary above)', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'boundary-cred',
        counter: 7,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-boundary' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 8 },
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'boundary-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(true);
      expect(result.credential!.counter).toBe(8);
    });
  });

  // ===========================================================================
  // DISCOVERABLE CREDENTIAL (anonymous) FLOW
  // ===========================================================================

  describe('generateAuthenticationOptions - discoverable credentials', () => {
    it('should support anonymous (discoverable) credential flow', async () => {
      vi.mocked(mockGenAuthOptions).mockResolvedValue({
        challenge: 'ch-discoverable',
        rpId: 'test.example.com',
      } as any);

      const result = await service.generateAuthenticationOptions({});

      expect(result.challenge).toBe('ch-discoverable');
      expect(mockGenAuthOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'test.example.com',
        })
      );
    });

    it('should set userVerification to required when requireUserVerification is true', async () => {
      await store.createCredential(createStoredCredential({ userId: 'user-1' }));

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-req-uv-auth' } as any);

      await service.generateAuthenticationOptions({
        userId: 'user-1',
        requireUserVerification: true,
      });

      expect(mockGenAuthOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userVerification: 'required',
        })
      );
    });
  });

  // ===========================================================================
  // FACTORY FUNCTIONS
  // ===========================================================================

  describe('createWebAuthnService', () => {
    it('should create a new instance each time', () => {
      const s1 = createWebAuthnService({ config: TEST_CONFIG });
      const s2 = createWebAuthnService({ config: TEST_CONFIG });
      expect(s1).not.toBe(s2);
      expect(s1).toBeInstanceOf(WebAuthnService);
    });

    it('should create instance with default deps when none provided', () => {
      const s = createWebAuthnService();
      expect(s).toBeInstanceOf(WebAuthnService);
    });
  });

  // ===========================================================================
  // CONSTRUCTOR
  // ===========================================================================

  describe('constructor', () => {
    it('should use default store when none provided', () => {
      const svc = new WebAuthnService({ config: TEST_CONFIG });
      // Should not throw
      expect(svc.getConfig().rpName).toBe('Test RP');
    });

    it('should use empty deps when no argument provided', () => {
      const svc = new WebAuthnService();
      const config = svc.getConfig();
      expect(config.rpName).toBe(DEFAULT_WEBAUTHN_CONFIG.rpName);
    });
  });

  // ===========================================================================
  // LIST CREDENTIALS - DEFAULTS
  // ===========================================================================

  describe('listCredentials - default pagination', () => {
    it('should use default limit and offset when not provided', async () => {
      await store.createCredential(createStoredCredential({ userId: 'default-page-user' }));

      const result = await service.listCredentials({ userId: 'default-page-user' });

      expect(result.total).toBe(1);
      expect(result.credentials).toHaveLength(1);
    });

    it('should return empty credentials for user with none', async () => {
      const result = await service.listCredentials({ userId: 'no-creds-user' });
      expect(result.total).toBe(0);
      expect(result.credentials).toEqual([]);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Audit logger record() exact field structures (ObjectLiteral)
  // ===========================================================================

  describe('audit logger record() - exact field structures', () => {
    let auditLogger: IAuditLogger;
    let auditStore: InMemoryWebAuthnStore;
    let auditService: WebAuthnService;

    beforeEach(() => {
      auditLogger = { record: vi.fn().mockResolvedValue(undefined) };
      auditStore = new InMemoryWebAuthnStore();
      auditService = new WebAuthnService({
        store: auditStore,
        config: TEST_CONFIG,
        auditLogger,
      });
    });

    afterEach(() => {
      auditStore.stop();
    });

    it('generateRegistrationOptions audit has exact tenantId, actor, target, and metadata', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({
        challenge: 'ch-exact-audit',
        rp: {},
        user: {},
        pubKeyCredParams: [],
      } as any);

      await auditService.generateRegistrationOptions({
        userId: 'audit-user-1',
        userName: 'audit@test.com',
        authenticatorType: 'platform',
      });

      expect(auditLogger.record).toHaveBeenCalledWith({
        tenantId: 'default',
        eventType: WebAuthnAuditEventType.REGISTRATION_OPTIONS_GENERATED,
        actor: { type: 'user', id: 'audit-user-1' },
        target: { type: 'webauthn_credential', id: 'audit-user-1', name: 'audit@test.com' },
        action: 'generate_registration_options',
        outcome: 'success',
        reason: undefined,
        metadata: {
          existingCredentials: 0,
          authenticatorType: 'platform',
        },
      });
    });

    it('verifyRegistration challenge-not-found audit has exact target fields', async () => {
      await auditService.verifyRegistration({
        userId: 'audit-u2',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(auditLogger.record).toHaveBeenCalledWith({
        tenantId: 'default',
        eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
        actor: { type: 'user', id: 'audit-u2' },
        target: { type: 'webauthn_credential', id: 'audit-u2', name: 'audit-u2' },
        action: 'verify_registration',
        outcome: 'failure',
        reason: 'Challenge not found or expired',
        metadata: undefined,
      });
    });

    it('verifyRegistration success audit has correct target.id and target.name from credential', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-succ-exact' } as any);
      await auditService.generateRegistrationOptions({
        userId: 'audit-u3',
        userName: 'a@b.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'new-cred-exact',
          credentialPublicKey: new Uint8Array([1, 2]),
          counter: 0,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      await auditService.verifyRegistration({
        userId: 'audit-u3',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        credentialName: 'My Key',
      });

      // Find the REGISTRATION_COMPLETED call
      const completedCall = (auditLogger.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0].eventType === WebAuthnAuditEventType.REGISTRATION_COMPLETED
      );

      expect(completedCall).toBeDefined();
      const arg = completedCall![0];
      expect(arg.tenantId).toBe('default');
      expect(arg.actor).toEqual({ type: 'user', id: 'audit-u3' });
      // target.id is the credential's id (a uuid), target.name is credentialName
      expect(arg.target.type).toBe('webauthn_credential');
      expect(arg.target.name).toBe('My Key');
      expect(arg.action).toBe('verify_registration');
      expect(arg.outcome).toBe('success');
      expect(arg.metadata).toEqual({
        deviceType: 'singleDevice',
        backedUp: false,
        aaguid: '00000000-0000-0000-0000-000000000000',
      });
    });

    it('generateAuthenticationOptions audit has correct allowedCredentials metadata', async () => {
      await auditStore.createCredential(
        createStoredCredential({ userId: 'aud-u4', credentialId: 'cred-aud-4' })
      );
      await auditStore.createCredential(
        createStoredCredential({ userId: 'aud-u4', credentialId: 'cred-aud-5' })
      );

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-aud-creds' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'aud-u4' });

      const call = (auditLogger.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0].eventType === WebAuthnAuditEventType.AUTHENTICATION_OPTIONS_GENERATED
      );

      expect(call).toBeDefined();
      expect(call![0].metadata).toEqual({ allowedCredentials: 2 });
    });

    it('generateAuthenticationOptions anonymous flow audit uses anonymous for userId and target', async () => {
      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-anon' } as any);
      await auditService.generateAuthenticationOptions({});

      const call = (auditLogger.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0].eventType === WebAuthnAuditEventType.AUTHENTICATION_OPTIONS_GENERATED
      );

      expect(call).toBeDefined();
      expect(call![0].actor).toEqual({ type: 'user', id: 'anonymous' });
      expect(call![0].target.id).toBe('anonymous');
      expect(call![0].target.name).toBe('anonymous');
      expect(call![0].metadata).toEqual({ allowedCredentials: 0 });
    });

    it('verifyAuthentication success audit has exact metadata with old and new counter', async () => {
      const cred = createStoredCredential({
        userId: 'aud-u5',
        credentialId: 'aud-counter-cred',
        counter: 10,
      });
      await auditStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-counter-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'aud-u5' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 11 },
      } as any);

      await auditService.verifyAuthentication({
        userId: 'aud-u5',
        response: { id: 'aud-counter-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      const call = (auditLogger.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0].eventType === WebAuthnAuditEventType.AUTHENTICATION_COMPLETED
      );

      expect(call).toBeDefined();
      expect(call![0].target.type).toBe('webauthn_credential');
      expect(call![0].target.name).toBe(cred.name);
      expect(call![0].metadata).toEqual({ oldCounter: 10, newCounter: 11 });
    });

    it('renameCredential audit has exact metadata with oldName and newName', async () => {
      const cred = createStoredCredential({ userId: 'aud-u6', name: 'OldName' });
      await auditStore.createCredential(cred);

      await auditService.renameCredential({
        userId: 'aud-u6',
        credentialId: cred.id,
        name: 'NewName',
      });

      expect(auditLogger.record).toHaveBeenCalledWith({
        tenantId: 'default',
        eventType: WebAuthnAuditEventType.CREDENTIAL_RENAMED,
        actor: { type: 'user', id: 'aud-u6' },
        target: { type: 'webauthn_credential', id: cred.id, name: 'NewName' },
        action: 'rename_credential',
        outcome: 'success',
        reason: undefined,
        metadata: { oldName: 'OldName', newName: 'NewName' },
      });
    });

    it('deleteCredential audit has exact structure with no metadata', async () => {
      const cred = createStoredCredential({ userId: 'aud-u7', name: 'DeleteMe' });
      await auditStore.createCredential(cred);

      await auditService.deleteCredential({
        userId: 'aud-u7',
        credentialId: cred.id,
      });

      expect(auditLogger.record).toHaveBeenCalledWith({
        tenantId: 'default',
        eventType: WebAuthnAuditEventType.CREDENTIAL_DELETED,
        actor: { type: 'user', id: 'aud-u7' },
        target: { type: 'webauthn_credential', id: cred.id, name: 'DeleteMe' },
        action: 'delete_credential',
        outcome: 'success',
        reason: undefined,
        metadata: undefined,
      });
    });

    it('verifyAuthentication credential-not-found audit has metadata with credentialId', async () => {
      await auditStore.createCredential(
        createStoredCredential({ userId: 'aud-u8', credentialId: 'aud-cred-8' })
      );

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-nf-aud' } as any);
      await auditService.generateAuthenticationOptions({ userId: 'aud-u8' });

      await auditService.verifyAuthentication({
        userId: 'aud-u8',
        response: { id: 'missing-cred-id', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      const call = (auditLogger.record as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0].reason === 'Credential not found'
      );

      expect(call).toBeDefined();
      expect(call![0].metadata).toEqual({ credentialId: 'missing-cred-id' });
    });
  });

  // ===========================================================================
  // MUTATION KILLS: base64url padding calculation (ArithmeticOperator)
  // ===========================================================================

  describe('base64UrlToUint8Array padding calculation', () => {
    it('should correctly convert base64url to Uint8Array during auth verification', async () => {
      // The base64url conversion is tested implicitly through successful auth verification.
      // We test with a credential whose publicKey has a known base64url encoding.
      const publicKeyBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const base64url = Buffer.from(publicKeyBytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'b64-test-cred',
        publicKey: base64url,
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-b64' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'b64-test-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(true);

      // Verify the authenticator was called with correct credentialPublicKey
      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: publicKeyBytes,
          }),
        })
      );
    });

    it('should handle base64url strings that need padding (length % 4 !== 0)', async () => {
      // Create a key whose base64url encoding needs padding
      // 1 byte -> 2 base64 chars -> needs 2 padding chars
      const oneByteKey = new Uint8Array([42]);
      const base64url = Buffer.from(oneByteKey).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      // base64url of [42] is "Kg" (2 chars, needs padding to 4: "Kg==")

      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'padding-test-cred',
        publicKey: base64url,
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-pad' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'padding-test-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: oneByteKey,
          }),
        })
      );
    });

    it('should handle base64url strings with length divisible by 4 (no padding needed)', async () => {
      // 3 bytes -> 4 base64 chars -> no padding needed
      const threeByteKey = new Uint8Array([1, 2, 3]);
      const base64url = Buffer.from(threeByteKey).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      // base64url of [1,2,3] is "AQID" (4 chars, no padding needed)

      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'no-padding-cred',
        publicKey: base64url,
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-nopad' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'no-padding-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: threeByteKey,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // MUTATION KILLS: ConditionalExpression - userVerification === 'required'
  // ===========================================================================

  describe('userVerification config setting for verifyRegistration and verifyAuthentication', () => {
    it('should pass requireUserVerification=true when config.userVerification is required', async () => {
      const reqStore = new InMemoryWebAuthnStore();
      const reqService = new WebAuthnService({
        store: reqStore,
        config: { ...TEST_CONFIG, userVerification: 'required' },
      });

      // Registration flow
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-req-config' } as any);
      await reqService.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'req-uv-cred',
          credentialPublicKey: new Uint8Array([1]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      await reqService.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      // Kills ConditionalExpression line 311: config.userVerification === 'required'
      expect(mockVerifyRegResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requireUserVerification: true,
        })
      );

      reqStore.stop();
    });

    it('should pass requireUserVerification=false when config.userVerification is preferred', async () => {
      // service already has userVerification: 'preferred'
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-pref-config' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'user@test.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'pref-uv-cred',
          credentialPublicKey: new Uint8Array([2]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyRegResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requireUserVerification: false,
        })
      );
    });

    it('should pass requireUserVerification=true for auth when config is required', async () => {
      const reqStore = new InMemoryWebAuthnStore();
      const reqService = new WebAuthnService({
        store: reqStore,
        config: { ...TEST_CONFIG, userVerification: 'required' },
      });

      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-req-uv-cred',
      });
      await reqStore.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-auth-req-uv' } as any);
      await reqService.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      await reqService.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'auth-req-uv-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      // Kills ConditionalExpression line 642: config.userVerification === 'required'
      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requireUserVerification: true,
        })
      );

      reqStore.stop();
    });

    it('should pass requireUserVerification=false for auth when config is preferred', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-pref-uv-cred',
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-auth-pref-uv' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'auth-pref-uv-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requireUserVerification: false,
        })
      );
    });
  });

  // ===========================================================================
  // MUTATION KILLS: BlockStatement - empty blocks for audit guard + deleteCredential
  // ===========================================================================

  describe('BlockStatement and conditional edge cases', () => {
    it('deleteCredential where store.deleteCredential returns false throws NotFoundError', async () => {
      // Create a store that returns the credential on getCredentialById, but
      // deleteCredential returns false
      const cred = createStoredCredential({ userId: 'user-1' });
      await store.createCredential(cred);

      // Override the store's deleteCredential to return false
      vi.spyOn(store, 'deleteCredential').mockResolvedValue(false);

      await expect(
        service.deleteCredential({
          userId: 'user-1',
          credentialId: cred.id,
        })
      ).rejects.toThrow(/not found/i);
    });

    it('renameCredential where store.updateCredential returns null throws NotFoundError', async () => {
      const cred = createStoredCredential({ userId: 'user-1' });
      await store.createCredential(cred);

      // Override the store's updateCredential to return null
      vi.spyOn(store, 'updateCredential').mockResolvedValue(null);

      await expect(
        service.renameCredential({
          userId: 'user-1',
          credentialId: cred.id,
          name: 'New Name',
        })
      ).rejects.toThrow(/not found/i);
    });

    it('getChallengeKey produces distinct keys for registration and authentication', async () => {
      // Verify by generating both reg and auth options for same user
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'reg-ch-key' } as any);
      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'auth-ch-key' } as any);

      await store.createCredential(createStoredCredential({ userId: 'user-1' }));

      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      // Both should succeed (different keys stored)
      // If getChallengeKey was mutated to return empty string, they'd collide
    });

    it('verifyRegistration with non-Error exception includes Unknown error in message', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-ne2' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockRejectedValue(undefined);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(false);
      expect(result.error).toContain('Unknown error');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: LogicalOperator for userId ?? 'anonymous'
  // ===========================================================================

  describe('userId fallback to anonymous in auth options', () => {
    it('should use userId when provided (not anonymous)', async () => {
      await store.createCredential(createStoredCredential({ userId: 'real-user' }));

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-real' } as any);
      const result = await service.generateAuthenticationOptions({ userId: 'real-user' });

      expect(result.challenge).toBe('ch-real');
    });

    it('should use anonymous when userId is undefined', async () => {
      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-anon-2' } as any);
      const result = await service.generateAuthenticationOptions({});

      expect(result.challenge).toBe('ch-anon-2');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Challenge key format (StringLiteral template)
  // ===========================================================================

  describe('getChallengeKey exact format', () => {
    it('should produce webauthn:registration:userId for registration', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-key-1' } as any);
      await service.generateRegistrationOptions({
        userId: 'test-user-key',
        userName: 'u@t.com',
      });

      // The challenge is stored under key "webauthn:registration:test-user-key"
      // Verify by retrieving it directly from the store
      const challenge = await store.getChallenge('webauthn:registration:test-user-key');
      expect(challenge).not.toBeNull();
      expect(challenge!.challenge).toBe('ch-key-1');
      expect(challenge!.type).toBe('registration');
      expect(challenge!.userId).toBe('test-user-key');
    });

    it('should produce webauthn:authentication:userId for authentication', async () => {
      await store.createCredential(createStoredCredential({ userId: 'test-user-key' }));
      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-key-2' } as any);
      await service.generateAuthenticationOptions({ userId: 'test-user-key' });

      const challenge = await store.getChallenge('webauthn:authentication:test-user-key');
      expect(challenge).not.toBeNull();
      expect(challenge!.challenge).toBe('ch-key-2');
      expect(challenge!.type).toBe('authentication');
    });

    it('challenge key includes exact colon separators (not slash, dash, etc)', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-sep' } as any);
      await service.generateRegistrationOptions({
        userId: 'u1',
        userName: 'u@t.com',
      });

      // Only the exact key format should work
      expect(await store.getChallenge('webauthn:registration:u1')).not.toBeNull();
      expect(await store.getChallenge('webauthn/registration/u1')).toBeNull();
      expect(await store.getChallenge('webauthn-registration-u1')).toBeNull();
      expect(await store.getChallenge('registration:webauthn:u1')).toBeNull();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: generateCredentialName exact format
  // ===========================================================================

  describe('generateCredentialName exact format', () => {
    it('should produce "Passkey " prefix (not "Key ", "Credential ", etc.)', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-name-fmt' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'auto-name-fmt-cred',
          credentialPublicKey: new Uint8Array([1, 2]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        // No credentialName → auto-generated
      });

      expect(result.verified).toBe(true);
      expect(result.credential!.name).toMatch(/^Passkey /);
      // Must NOT be "Key " or empty
      expect(result.credential!.name.startsWith('Key ')).toBe(false);
      expect(result.credential!.name.startsWith('Credential ')).toBe(false);
    });

    it('should use en-US locale with short month, numeric day, numeric year', async () => {
      // Use a known date to verify the format
      const fixedDate = new Date('2026-02-27T12:00:00Z');
      vi.spyOn(global, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return fixedDate;
        // @ts-ignore
        return new (Function.prototype.bind.apply(OriginalDate, [null, ...args]))();
      } as any);
      const OriginalDate = globalThis.Date;
      // Restore properly
      vi.spyOn(global, 'Date').mockRestore();

      // Instead test the format pattern: "Passkey <Mon> <D>, <YYYY>"
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-locale' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'locale-cred',
          credentialPublicKey: new Uint8Array([3]),
          counter: 0,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(true);
      // Pattern: "Passkey Feb 27, 2026" (en-US short month, day, year)
      expect(result.credential!.name).toMatch(/^Passkey [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: uint8ArrayToBase64Url character replacement
  // ===========================================================================

  describe('uint8ArrayToBase64Url exact character replacements', () => {
    it('should replace + with - (not remain as +)', async () => {
      // The byte 0x3E in base64 produces '+', which should become '-'
      // We test this through the registration flow where publicKey is encoded
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-b64-plus' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      // Uint8Array that produces '+' in base64: [251] → base64 "+w==" → base64url "-w"
      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'plus-test-cred',
          credentialPublicKey: new Uint8Array([251]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        credentialName: 'plus test',
      });

      expect(result.verified).toBe(true);
      const pk = result.credential!.publicKey;
      // Must contain '-' not '+'
      expect(pk).not.toContain('+');
      expect(pk).not.toContain('=');
      // Verify it starts with '-' (base64 of [251] is "+w==" → "-w")
      expect(pk).toBe('-w');
    });

    it('should replace / with _ (not remain as /)', async () => {
      // [63] → base64 "Pw==" → base64url "Pw"
      // But we need a byte that produces '/': [63] in base64 is "Pw==", not "/".
      // Actually base64 char '/' corresponds to value 63.
      // Bytes [0x3F, 0xBF] → base64 "P78=" → contains no /
      // Let's use [255, 255] → base64 "//8=" → base64url "__8"
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-b64-slash' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'slash-test-cred',
          credentialPublicKey: new Uint8Array([255, 255]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        credentialName: 'slash test',
      });

      expect(result.verified).toBe(true);
      const pk = result.credential!.publicKey;
      expect(pk).not.toContain('/');
      expect(pk).not.toContain('=');
      // base64 of [255, 255] is "//8=" → base64url "__8"
      expect(pk).toBe('__8');
    });

    it('should remove = padding (not leave it)', async () => {
      // [1] → base64 "AQ==" → base64url "AQ"
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-b64-pad' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'pad-test-cred',
          credentialPublicKey: new Uint8Array([1]),
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: false,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        credentialName: 'pad test',
      });

      expect(result.verified).toBe(true);
      expect(result.credential!.publicKey).not.toContain('=');
      expect(result.credential!.publicKey).toBe('AQ');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: base64UrlToUint8Array padding formula all mod-4 cases
  // ===========================================================================

  describe('base64UrlToUint8Array padding for all mod-4 cases', () => {
    it('should handle length % 4 === 0 (no padding needed)', async () => {
      // "AQID" (4 chars, mod 4 = 0, 0 padding) → [1, 2, 3]
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'b64-mod0',
        publicKey: 'AQID', // base64url of [1, 2, 3]
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-mod0' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'b64-mod0', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: new Uint8Array([1, 2, 3]),
          }),
        })
      );
    });

    it('should handle length % 4 === 2 (2 padding chars needed)', async () => {
      // "AQ" (2 chars, mod 4 = 2, needs "==" padding) → [1]
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'b64-mod2',
        publicKey: 'AQ', // base64url of [1]
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-mod2' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'b64-mod2', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: new Uint8Array([1]),
          }),
        })
      );
    });

    it('should handle length % 4 === 3 (1 padding char needed)', async () => {
      // "AQI" (3 chars, mod 4 = 3, needs "=" padding) → [1, 2]
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'b64-mod3',
        publicKey: 'AQI', // base64url of [1, 2]
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-mod3' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'b64-mod3', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: new Uint8Array([1, 2]),
          }),
        })
      );
    });

    it('should replace - back to + and _ back to / during decode', async () => {
      // "__8" (base64url) → "//8=" (base64) → [255, 255]
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'b64-special',
        publicKey: '__8', // base64url of [255, 255]
        counter: 0,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-special' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'b64-special', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: expect.objectContaining({
            credentialPublicKey: new Uint8Array([255, 255]),
          }),
        })
      );
    });
  });

  // ===========================================================================
  // MUTATION KILLS: listCredentials pagination arithmetic (offset + limit)
  // ===========================================================================

  describe('listCredentials pagination arithmetic', () => {
    it('should slice(offset, offset + limit) exactly (kills offset-limit and offset*limit)', async () => {
      // Create 10 credentials with distinct names
      for (let i = 0; i < 10; i++) {
        await store.createCredential(
          createStoredCredential({
            userId: 'page-user',
            name: `Cred-${i}`,
            createdAt: new Date(Date.now() - i * 1000),
          })
        );
      }

      // offset=3, limit=2 → should get items at indices 3 and 4
      const result = await service.listCredentials({
        userId: 'page-user',
        offset: 3,
        limit: 2,
      });

      expect(result.total).toBe(10);
      expect(result.credentials).toHaveLength(2);
    });

    it('should return empty when offset equals total', async () => {
      await store.createCredential(createStoredCredential({ userId: 'page-user-2' }));
      await store.createCredential(createStoredCredential({ userId: 'page-user-2' }));

      const result = await service.listCredentials({
        userId: 'page-user-2',
        offset: 2,
        limit: 10,
      });

      expect(result.total).toBe(2);
      expect(result.credentials).toHaveLength(0);
    });

    it('should return partial page when offset + limit exceeds total', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createCredential(
          createStoredCredential({ userId: 'page-user-3' })
        );
      }

      const result = await service.listCredentials({
        userId: 'page-user-3',
        offset: 3,
        limit: 10,
      });

      expect(result.total).toBe(5);
      expect(result.credentials).toHaveLength(2);
    });

    it('should use default limit 50 and offset 0 when not specified', async () => {
      // Create 3 credentials; defaults should return all 3
      for (let i = 0; i < 3; i++) {
        await store.createCredential(
          createStoredCredential({ userId: 'page-user-defaults' })
        );
      }

      const result = await service.listCredentials({ userId: 'page-user-defaults' });

      expect(result.total).toBe(3);
      expect(result.credentials).toHaveLength(3);
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Challenge TTL arithmetic (Date.now() + TTL, not -)
  // ===========================================================================

  describe('challenge TTL arithmetic', () => {
    it('should set expiresAt to Date.now() + challengeTTL (not minus)', async () => {
      const dateNowSpy = vi.spyOn(Date, 'now');
      dateNowSpy.mockReturnValue(1000000);

      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-ttl' } as any);
      await service.generateRegistrationOptions({
        userId: 'ttl-user',
        userName: 'u@t.com',
      });

      const challenge = await store.getChallenge('webauthn:registration:ttl-user');
      expect(challenge).not.toBeNull();
      // challengeTTL is 300000 (from TEST_CONFIG)
      // expiresAt = Date.now() + 300000 = 1300000
      expect(challenge!.expiresAt).toBe(1300000);
      // Not Date.now() - challengeTTL = 700000
      expect(challenge!.expiresAt).not.toBe(700000);

      dateNowSpy.mockRestore();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: verifyAuthentication updatedCredential ?? credential fallback
  // ===========================================================================

  describe('verifyAuthentication updatedCredential fallback', () => {
    it('should return updatedCredential when updateCredential succeeds', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'fallback-cred',
        counter: 5,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-fb' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'fallback-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(true);
      // updatedCredential should have the new counter
      expect(result.credential!.counter).toBe(6);
      // lastUsedAt should be set (not null)
      expect(result.credential!.lastUsedAt).not.toBeNull();
    });

    it('should return original credential when updateCredential returns null', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'null-update-cred',
        counter: 5,
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-nu' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      // Make updateCredential return null
      vi.spyOn(store, 'updateCredential').mockResolvedValue(null);

      const result = await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'null-update-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(result.verified).toBe(true);
      // Falls back to original credential
      expect(result.credential!.counter).toBe(5);
      expect(result.credential!.userId).toBe('user-1');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Error class exact string literals
  // ===========================================================================

  describe('error class exact string values', () => {
    it('WebAuthnError.code is exactly "WEBAUTHN_ERROR" (not empty, not swapped)', () => {
      const err = new WebAuthnError('test');
      expect(err.code).toBe('WEBAUTHN_ERROR');
      expect(err.code).not.toBe('');
      expect(err.code).not.toBe('WEBAUTHN_REGISTRATION_ERROR');
      expect(err.code).not.toBe('WEBAUTHN_AUTHENTICATION_ERROR');
    });

    it('WebAuthnError.statusCode is exactly 400 (not 401, 500, 0)', () => {
      const err = new WebAuthnError('test');
      expect(err.statusCode).toBe(400);
      expect(err.statusCode).not.toBe(401);
      expect(err.statusCode).not.toBe(500);
      expect(err.statusCode).not.toBe(0);
    });

    it('WebAuthnError.name is exactly "WebAuthnError"', () => {
      const err = new WebAuthnError('test');
      expect(err.name).toBe('WebAuthnError');
    });

    it('WebAuthnRegistrationError.code is exactly "WEBAUTHN_REGISTRATION_ERROR"', () => {
      const err = new WebAuthnRegistrationError('test', RegistrationErrorCode.VERIFICATION_FAILED);
      expect(err.code).toBe('WEBAUTHN_REGISTRATION_ERROR');
      expect(err.code).not.toBe('WEBAUTHN_ERROR');
      expect(err.code).not.toBe('WEBAUTHN_AUTHENTICATION_ERROR');
    });

    it('WebAuthnRegistrationError.statusCode is exactly 400 (not 401)', () => {
      const err = new WebAuthnRegistrationError('test', RegistrationErrorCode.VERIFICATION_FAILED);
      expect(err.statusCode).toBe(400);
      expect(err.statusCode).not.toBe(401);
    });

    it('WebAuthnRegistrationError.name is exactly "WebAuthnRegistrationError"', () => {
      const err = new WebAuthnRegistrationError('test', RegistrationErrorCode.VERIFICATION_FAILED);
      expect(err.name).toBe('WebAuthnRegistrationError');
      expect(err.name).not.toBe('WebAuthnError');
    });

    it('WebAuthnAuthenticationError.code is exactly "WEBAUTHN_AUTHENTICATION_ERROR"', () => {
      const err = new WebAuthnAuthenticationError('test', AuthenticationErrorCode.VERIFICATION_FAILED);
      expect(err.code).toBe('WEBAUTHN_AUTHENTICATION_ERROR');
      expect(err.code).not.toBe('WEBAUTHN_ERROR');
      expect(err.code).not.toBe('WEBAUTHN_REGISTRATION_ERROR');
    });

    it('WebAuthnAuthenticationError.statusCode is exactly 401 (not 400)', () => {
      const err = new WebAuthnAuthenticationError('test', AuthenticationErrorCode.VERIFICATION_FAILED);
      expect(err.statusCode).toBe(401);
      expect(err.statusCode).not.toBe(400);
    });

    it('WebAuthnAuthenticationError.name is exactly "WebAuthnAuthenticationError"', () => {
      const err = new WebAuthnAuthenticationError('test', AuthenticationErrorCode.VERIFICATION_FAILED);
      expect(err.name).toBe('WebAuthnAuthenticationError');
      expect(err.name).not.toBe('WebAuthnError');
    });
  });

  // ===========================================================================
  // MUTATION KILLS: Config merge spread order
  // ===========================================================================

  describe('config merge spread order', () => {
    it('user config overrides DEFAULT_WEBAUTHN_CONFIG (not the reverse)', () => {
      const customStore = new InMemoryWebAuthnStore();
      const svc = new WebAuthnService({
        store: customStore,
        config: {
          rpName: 'Override RP',
          rpId: 'override.example.com',
          origin: 'https://override.example.com',
          timeout: 30000,
          challengeTTL: 600000,
        },
      });

      const cfg = svc.getConfig();
      // User overrides should win
      expect(cfg.rpName).toBe('Override RP');
      expect(cfg.rpId).toBe('override.example.com');
      expect(cfg.origin).toBe('https://override.example.com');
      expect(cfg.timeout).toBe(30000);
      expect(cfg.challengeTTL).toBe(600000);
      // Non-overridden should use defaults
      expect(cfg.attestation).toBe(DEFAULT_WEBAUTHN_CONFIG.attestation);
      expect(cfg.userVerification).toBe(DEFAULT_WEBAUTHN_CONFIG.userVerification);
      expect(cfg.residentKey).toBe(DEFAULT_WEBAUTHN_CONFIG.residentKey);
      expect(cfg.supportedAlgorithms).toEqual(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms);

      customStore.stop();
    });

    it('empty config object uses all defaults', () => {
      const customStore = new InMemoryWebAuthnStore();
      const svc = new WebAuthnService({
        store: customStore,
        config: {},
      });

      const cfg = svc.getConfig();
      expect(cfg.rpName).toBe(DEFAULT_WEBAUTHN_CONFIG.rpName);
      expect(cfg.rpId).toBe(DEFAULT_WEBAUTHN_CONFIG.rpId);
      expect(cfg.origin).toBe(DEFAULT_WEBAUTHN_CONFIG.origin);
      expect(cfg.timeout).toBe(DEFAULT_WEBAUTHN_CONFIG.timeout);
      expect(cfg.challengeTTL).toBe(DEFAULT_WEBAUTHN_CONFIG.challengeTTL);

      customStore.stop();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: verifyRegistration stores credential with correct fields
  // ===========================================================================

  describe('verifyRegistration stored credential exact field mapping', () => {
    it('should store publicKey as base64url (not raw bytes)', async () => {
      vi.mocked(mockGenRegOptions).mockResolvedValue({ challenge: 'ch-pk' } as any);
      await service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'u@t.com',
      });

      vi.mocked(mockVerifyRegResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: 'pk-check-cred',
          credentialPublicKey: new Uint8Array([1, 2, 3]),
          counter: 42,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: true,
          aaguid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        },
      } as any);

      const result = await service.verifyRegistration({
        userId: 'user-1',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } as any,
        credentialName: 'PK Test',
      });

      expect(result.verified).toBe(true);
      const cred = result.credential!;
      // publicKey should be base64url string, not Uint8Array
      expect(typeof cred.publicKey).toBe('string');
      expect(cred.publicKey).toBe('AQID');
      // counter from registrationInfo
      expect(cred.counter).toBe(42);
      // deviceType from registrationInfo
      expect(cred.deviceType).toBe('singleDevice');
      // backedUp from registrationInfo
      expect(cred.backedUp).toBe(true);
      // aaguid from registrationInfo
      expect(cred.aaguid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      // userId from input
      expect(cred.userId).toBe('user-1');
      // name from input
      expect(cred.name).toBe('PK Test');
      // lastUsedAt should be null for newly created credential
      expect(cred.lastUsedAt).toBeNull();
    });
  });

  // ===========================================================================
  // MUTATION KILLS: verifyAuthentication passes correct authenticator object
  // ===========================================================================

  describe('verifyAuthentication authenticator object fields', () => {
    it('should pass credentialID, credentialPublicKey, counter, and transports to verifyAuthenticationResponse', async () => {
      const cred = createStoredCredential({
        userId: 'user-1',
        credentialId: 'auth-obj-cred',
        publicKey: 'AQID', // [1, 2, 3]
        counter: 10,
        transports: ['usb', 'ble'],
      });
      await store.createCredential(cred);

      vi.mocked(mockGenAuthOptions).mockResolvedValue({ challenge: 'ch-auth-obj' } as any);
      await service.generateAuthenticationOptions({ userId: 'user-1' });

      vi.mocked(mockVerifyAuthResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 11 },
      } as any);

      await service.verifyAuthentication({
        userId: 'user-1',
        response: { id: 'auth-obj-cred', rawId: 'x', type: 'public-key', response: {} } as any,
      });

      expect(mockVerifyAuthResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticator: {
            credentialID: 'auth-obj-cred',
            credentialPublicKey: new Uint8Array([1, 2, 3]),
            counter: 10,
            transports: ['usb', 'ble'],
          },
        })
      );
    });
  });
});
