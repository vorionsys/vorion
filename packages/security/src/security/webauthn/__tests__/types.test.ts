/**
 * Tests for WebAuthn types and Zod schemas
 *
 * Validates:
 * - Zod schema field requirements (ObjectLiteral mutations)
 * - min/max method mutations
 * - Default config values (DEFAULT_WEBAUTHN_CONFIG)
 * - Enum value mutations (RegistrationErrorCode, AuthenticationErrorCode, WebAuthnAuditEventType)
 * - supportedAlgorithms values and signs
 * - authenticatorTransportSchema values
 * - Schema validation behavior
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatorTransportSchema,
  webAuthnCredentialSchema,
  generateRegistrationOptionsInputSchema,
  registrationOptionsSchema,
  verifyRegistrationInputSchema,
  registrationResultSchema,
  generateAuthenticationOptionsInputSchema,
  authenticationOptionsSchema,
  verifyAuthenticationInputSchema,
  authenticationResultSchema,
  webAuthnConfigSchema,
  listCredentialsInputSchema,
  renameCredentialInputSchema,
  deleteCredentialInputSchema,
  challengeEntrySchema,
  DEFAULT_WEBAUTHN_CONFIG,
  RegistrationErrorCode,
  AuthenticationErrorCode,
  WebAuthnAuditEventType,
} from '../types.js';

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

describe('DEFAULT_WEBAUTHN_CONFIG', () => {
  it('should have correct rpName', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.rpName).toBe('Vorion Platform');
  });

  it('should have correct rpId', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.rpId).toBe('localhost');
  });

  it('should have correct origin', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.origin).toBe('http://localhost:3000');
  });

  it('should have attestation as none', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.attestation).toBe('none');
  });

  it('should have userVerification as preferred', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.userVerification).toBe('preferred');
  });

  it('should have timeout of 60000', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.timeout).toBe(60000);
  });

  it('should have residentKey as preferred', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.residentKey).toBe('preferred');
  });

  it('should have challengeTTL of 300000 (5 minutes)', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.challengeTTL).toBe(300000);
  });

  it('should have supportedAlgorithms [-7, -257] (ES256 and RS256)', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms).toEqual([-7, -257]);
    // Ensure negative signs are correct (unary operator mutations)
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[0]).toBe(-7);
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[0]).toBeLessThan(0);
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[1]).toBe(-257);
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[1]).toBeLessThan(0);
  });

  it('should not have authenticatorAttachment set', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.authenticatorAttachment).toBeUndefined();
  });
});

// =============================================================================
// REGISTRATION ERROR CODES
// =============================================================================

describe('RegistrationErrorCode', () => {
  it('should have CHALLENGE_NOT_FOUND', () => {
    expect(RegistrationErrorCode.CHALLENGE_NOT_FOUND).toBe('CHALLENGE_NOT_FOUND');
  });

  it('should have CHALLENGE_EXPIRED', () => {
    expect(RegistrationErrorCode.CHALLENGE_EXPIRED).toBe('CHALLENGE_EXPIRED');
  });

  it('should have VERIFICATION_FAILED', () => {
    expect(RegistrationErrorCode.VERIFICATION_FAILED).toBe('VERIFICATION_FAILED');
  });

  it('should have CREDENTIAL_EXISTS', () => {
    expect(RegistrationErrorCode.CREDENTIAL_EXISTS).toBe('CREDENTIAL_EXISTS');
  });

  it('should have INVALID_RESPONSE', () => {
    expect(RegistrationErrorCode.INVALID_RESPONSE).toBe('INVALID_RESPONSE');
  });

  it('should have USER_NOT_FOUND', () => {
    expect(RegistrationErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
  });

  it('should have exactly 6 error codes', () => {
    expect(Object.keys(RegistrationErrorCode)).toHaveLength(6);
  });
});

// =============================================================================
// AUTHENTICATION ERROR CODES
// =============================================================================

describe('AuthenticationErrorCode', () => {
  it('should have CHALLENGE_NOT_FOUND', () => {
    expect(AuthenticationErrorCode.CHALLENGE_NOT_FOUND).toBe('CHALLENGE_NOT_FOUND');
  });

  it('should have CHALLENGE_EXPIRED', () => {
    expect(AuthenticationErrorCode.CHALLENGE_EXPIRED).toBe('CHALLENGE_EXPIRED');
  });

  it('should have CREDENTIAL_NOT_FOUND', () => {
    expect(AuthenticationErrorCode.CREDENTIAL_NOT_FOUND).toBe('CREDENTIAL_NOT_FOUND');
  });

  it('should have VERIFICATION_FAILED', () => {
    expect(AuthenticationErrorCode.VERIFICATION_FAILED).toBe('VERIFICATION_FAILED');
  });

  it('should have COUNTER_ROLLBACK', () => {
    expect(AuthenticationErrorCode.COUNTER_ROLLBACK).toBe('COUNTER_ROLLBACK');
  });

  it('should have NO_CREDENTIALS', () => {
    expect(AuthenticationErrorCode.NO_CREDENTIALS).toBe('NO_CREDENTIALS');
  });

  it('should have INVALID_RESPONSE', () => {
    expect(AuthenticationErrorCode.INVALID_RESPONSE).toBe('INVALID_RESPONSE');
  });

  it('should have USER_NOT_FOUND', () => {
    expect(AuthenticationErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
  });

  it('should have exactly 8 error codes', () => {
    expect(Object.keys(AuthenticationErrorCode)).toHaveLength(8);
  });
});

// =============================================================================
// AUDIT EVENT TYPES
// =============================================================================

describe('WebAuthnAuditEventType', () => {
  it('should have REGISTRATION_OPTIONS_GENERATED', () => {
    expect(WebAuthnAuditEventType.REGISTRATION_OPTIONS_GENERATED).toBe(
      'webauthn.registration_options_generated'
    );
  });

  it('should have REGISTRATION_COMPLETED', () => {
    expect(WebAuthnAuditEventType.REGISTRATION_COMPLETED).toBe(
      'webauthn.registration_completed'
    );
  });

  it('should have REGISTRATION_FAILED', () => {
    expect(WebAuthnAuditEventType.REGISTRATION_FAILED).toBe('webauthn.registration_failed');
  });

  it('should have AUTHENTICATION_OPTIONS_GENERATED', () => {
    expect(WebAuthnAuditEventType.AUTHENTICATION_OPTIONS_GENERATED).toBe(
      'webauthn.authentication_options_generated'
    );
  });

  it('should have AUTHENTICATION_COMPLETED', () => {
    expect(WebAuthnAuditEventType.AUTHENTICATION_COMPLETED).toBe(
      'webauthn.authentication_completed'
    );
  });

  it('should have AUTHENTICATION_FAILED', () => {
    expect(WebAuthnAuditEventType.AUTHENTICATION_FAILED).toBe(
      'webauthn.authentication_failed'
    );
  });

  it('should have COUNTER_ROLLBACK_DETECTED', () => {
    expect(WebAuthnAuditEventType.COUNTER_ROLLBACK_DETECTED).toBe(
      'webauthn.counter_rollback_detected'
    );
  });

  it('should have CREDENTIAL_DELETED', () => {
    expect(WebAuthnAuditEventType.CREDENTIAL_DELETED).toBe('webauthn.credential_deleted');
  });

  it('should have CREDENTIAL_RENAMED', () => {
    expect(WebAuthnAuditEventType.CREDENTIAL_RENAMED).toBe('webauthn.credential_renamed');
  });

  it('should have exactly 9 event types', () => {
    expect(Object.keys(WebAuthnAuditEventType)).toHaveLength(9);
  });
});

// =============================================================================
// AUTHENTICATOR TRANSPORT SCHEMA
// =============================================================================

describe('authenticatorTransportSchema', () => {
  it('should accept all valid transport types', () => {
    const transports = ['usb', 'ble', 'nfc', 'internal', 'cable', 'hybrid', 'smart-card'];
    for (const transport of transports) {
      expect(authenticatorTransportSchema.safeParse(transport).success).toBe(true);
    }
  });

  it('should reject invalid transport types', () => {
    expect(authenticatorTransportSchema.safeParse('wifi').success).toBe(false);
    expect(authenticatorTransportSchema.safeParse('').success).toBe(false);
  });
});

// =============================================================================
// WEBAUTHN CREDENTIAL SCHEMA
// =============================================================================

describe('webAuthnCredentialSchema', () => {
  const validCredential = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    credentialId: 'some-credential-id',
    publicKey: 'some-public-key',
    counter: 0,
    createdAt: new Date(),
    lastUsedAt: null,
    name: 'My Passkey',
    userId: 'user-1',
  };

  it('should accept a valid credential', () => {
    const result = webAuthnCredentialSchema.safeParse(validCredential);
    expect(result.success).toBe(true);
  });

  it('should require id as UUID', () => {
    const result = webAuthnCredentialSchema.safeParse({ ...validCredential, id: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  it('should require credentialId min length 1', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      credentialId: '',
    });
    expect(result.success).toBe(false);
  });

  it('should require publicKey min length 1', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      publicKey: '',
    });
    expect(result.success).toBe(false);
  });

  it('should require counter >= 0', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      counter: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should require name min length 1', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should require name max length 255', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      name: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('should require userId min length 1', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      userId: '',
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional transports', () => {
    const result = webAuthnCredentialSchema.safeParse(validCredential);
    expect(result.success).toBe(true);
  });

  it('should accept valid transports array', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      transports: ['internal', 'usb'],
    });
    expect(result.success).toBe(true);
  });

  it('should allow optional deviceType, backedUp, aaguid', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      deviceType: 'multiDevice',
      backedUp: true,
      aaguid: 'some-aaguid',
    });
    expect(result.success).toBe(true);
  });

  it('should allow nullable lastUsedAt', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      lastUsedAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept lastUsedAt as Date', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      lastUsedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const result = webAuthnCredentialSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// GENERATE REGISTRATION OPTIONS INPUT SCHEMA
// =============================================================================

describe('generateRegistrationOptionsInputSchema', () => {
  it('should accept valid input', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
    });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: '',
      userName: 'user@test.com',
    });
    expect(result.success).toBe(false);
  });

  it('should require userName min length 1', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce userName max length 255', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional userDisplayName', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
      userDisplayName: 'John Doe',
    });
    expect(result.success).toBe(true);
  });

  it('should enforce userDisplayName min length 1', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
      userDisplayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid authenticatorType values', () => {
    expect(
      generateRegistrationOptionsInputSchema.safeParse({
        userId: 'user-1',
        userName: 'user@test.com',
        authenticatorType: 'platform',
      }).success
    ).toBe(true);

    expect(
      generateRegistrationOptionsInputSchema.safeParse({
        userId: 'user-1',
        userName: 'user@test.com',
        authenticatorType: 'cross-platform',
      }).success
    ).toBe(true);
  });

  it('should reject invalid authenticatorType', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
      authenticatorType: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// REGISTRATION OPTIONS SCHEMA
// =============================================================================

describe('registrationOptionsSchema', () => {
  it('should accept valid options', () => {
    const result = registrationOptionsSchema.safeParse({
      options: { challenge: 'test' },
      challenge: 'test-challenge',
    });
    expect(result.success).toBe(true);
  });

  it('should require challenge min length 1', () => {
    const result = registrationOptionsSchema.safeParse({
      options: {},
      challenge: '',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// VERIFY REGISTRATION INPUT SCHEMA
// =============================================================================

describe('verifyRegistrationInputSchema', () => {
  it('should accept valid input', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: { id: 'test' },
    });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: '',
      response: {},
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional credentialName', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
      credentialName: 'My Key',
    });
    expect(result.success).toBe(true);
  });

  it('should enforce credentialName min length 1', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
      credentialName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce credentialName max length 255', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
      credentialName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// REGISTRATION RESULT SCHEMA
// =============================================================================

describe('registrationResultSchema', () => {
  it('should accept successful result', () => {
    const result = registrationResultSchema.safeParse({
      verified: true,
    });
    expect(result.success).toBe(true);
  });

  it('should accept failed result with error and errorCode', () => {
    const result = registrationResultSchema.safeParse({
      verified: false,
      error: 'Something went wrong',
      errorCode: 'VERIFICATION_FAILED',
    });
    expect(result.success).toBe(true);
  });

  it('should require verified boolean', () => {
    const result = registrationResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// GENERATE AUTHENTICATION OPTIONS INPUT SCHEMA
// =============================================================================

describe('generateAuthenticationOptionsInputSchema', () => {
  it('should accept empty object (anonymous flow)', () => {
    const result = generateAuthenticationOptionsInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept with userId', () => {
    const result = generateAuthenticationOptionsInputSchema.safeParse({
      userId: 'user-1',
    });
    expect(result.success).toBe(true);
  });

  it('should enforce userId min length 1 when provided', () => {
    const result = generateAuthenticationOptionsInputSchema.safeParse({
      userId: '',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// AUTHENTICATION OPTIONS SCHEMA
// =============================================================================

describe('authenticationOptionsSchema', () => {
  it('should accept valid options', () => {
    const result = authenticationOptionsSchema.safeParse({
      options: {},
      challenge: 'test-challenge',
    });
    expect(result.success).toBe(true);
  });

  it('should require challenge min length 1', () => {
    const result = authenticationOptionsSchema.safeParse({
      options: {},
      challenge: '',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// VERIFY AUTHENTICATION INPUT SCHEMA
// =============================================================================

describe('verifyAuthenticationInputSchema', () => {
  it('should accept valid input', () => {
    const result = verifyAuthenticationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
    });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = verifyAuthenticationInputSchema.safeParse({
      userId: '',
      response: {},
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// AUTHENTICATION RESULT SCHEMA
// =============================================================================

describe('authenticationResultSchema', () => {
  it('should accept successful result', () => {
    const result = authenticationResultSchema.safeParse({
      verified: true,
      userId: 'user-1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept failed result', () => {
    const result = authenticationResultSchema.safeParse({
      verified: false,
      error: 'Failed',
      errorCode: 'CREDENTIAL_NOT_FOUND',
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// WEBAUTHN CONFIG SCHEMA
// =============================================================================

describe('webAuthnConfigSchema', () => {
  const validConfig = {
    rpName: 'Test',
    rpId: 'localhost',
    origin: 'https://localhost:3000',
    attestation: 'none' as const,
    userVerification: 'preferred' as const,
    timeout: 60000,
    residentKey: 'preferred' as const,
    challengeTTL: 300000,
    supportedAlgorithms: [-7, -257],
  };

  it('should accept valid config', () => {
    const result = webAuthnConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should require rpName min length 1', () => {
    const result = webAuthnConfigSchema.safeParse({ ...validConfig, rpName: '' });
    expect(result.success).toBe(false);
  });

  it('should enforce rpName max length 255', () => {
    const result = webAuthnConfigSchema.safeParse({ ...validConfig, rpName: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('should require rpId min length 1', () => {
    const result = webAuthnConfigSchema.safeParse({ ...validConfig, rpId: '' });
    expect(result.success).toBe(false);
  });

  it('should accept string origin (URL)', () => {
    const result = webAuthnConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should accept array of origins', () => {
    const result = webAuthnConfigSchema.safeParse({
      ...validConfig,
      origin: ['https://example.com', 'https://example2.com'],
    });
    expect(result.success).toBe(true);
  });

  it('should only accept valid attestation values', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, attestation: 'none' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, attestation: 'direct' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, attestation: 'enterprise' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, attestation: 'indirect' }).success
    ).toBe(false);
  });

  it('should only accept valid userVerification values', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, userVerification: 'required' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, userVerification: 'preferred' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, userVerification: 'discouraged' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, userVerification: 'invalid' }).success
    ).toBe(false);
  });

  it('should require timeout to be positive', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: 0 }).success
    ).toBe(false);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: -1 }).success
    ).toBe(false);
  });

  it('should enforce timeout max of 600000', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: 600001 }).success
    ).toBe(false);
  });

  it('should accept valid residentKey values', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, residentKey: 'required' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, residentKey: 'preferred' }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, residentKey: 'discouraged' }).success
    ).toBe(true);
  });

  it('should require challengeTTL to be positive', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, challengeTTL: 0 }).success
    ).toBe(false);
  });

  it('should enforce challengeTTL max of 600000', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, challengeTTL: 600001 }).success
    ).toBe(false);
  });

  it('should accept optional authenticatorAttachment', () => {
    expect(
      webAuthnConfigSchema.safeParse({
        ...validConfig,
        authenticatorAttachment: 'platform',
      }).success
    ).toBe(true);
    expect(
      webAuthnConfigSchema.safeParse({
        ...validConfig,
        authenticatorAttachment: 'cross-platform',
      }).success
    ).toBe(true);
  });

  it('should accept supportedAlgorithms as array of integers', () => {
    const result = webAuthnConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should validate DEFAULT_WEBAUTHN_CONFIG against schema', () => {
    const result = webAuthnConfigSchema.safeParse(DEFAULT_WEBAUTHN_CONFIG);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// LIST CREDENTIALS INPUT SCHEMA
// =============================================================================

describe('listCredentialsInputSchema', () => {
  it('should accept userId only', () => {
    const result = listCredentialsInputSchema.safeParse({ userId: 'user-1' });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = listCredentialsInputSchema.safeParse({ userId: '' });
    expect(result.success).toBe(false);
  });

  it('should default limit to 50', () => {
    const result = listCredentialsInputSchema.parse({ userId: 'user-1' });
    expect(result.limit).toBe(50);
  });

  it('should default offset to 0', () => {
    const result = listCredentialsInputSchema.parse({ userId: 'user-1' });
    expect(result.offset).toBe(0);
  });

  it('should enforce limit min 1', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should enforce limit max 100', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it('should enforce offset min 0', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      offset: -1,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// RENAME CREDENTIAL INPUT SCHEMA
// =============================================================================

describe('renameCredentialInputSchema', () => {
  it('should accept valid input', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'My Key',
    });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: '',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'My Key',
    });
    expect(result.success).toBe(false);
  });

  it('should require credentialId as UUID', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: 'not-a-uuid',
      name: 'My Key',
    });
    expect(result.success).toBe(false);
  });

  it('should require name min length 1', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce name max length 255', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DELETE CREDENTIAL INPUT SCHEMA
// =============================================================================

describe('deleteCredentialInputSchema', () => {
  it('should accept valid input', () => {
    const result = deleteCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('should require userId min length 1', () => {
    const result = deleteCredentialInputSchema.safeParse({
      userId: '',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });

  it('should require credentialId as UUID', () => {
    const result = deleteCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: 'not-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CHALLENGE ENTRY SCHEMA
// =============================================================================

describe('challengeEntrySchema', () => {
  it('should accept valid challenge entry', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test-challenge',
      userId: 'user-1',
      type: 'registration',
      expiresAt: Date.now() + 300000,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('should require challenge min length 1', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: '',
      userId: 'user-1',
      type: 'registration',
      expiresAt: Date.now(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('should require userId min length 1', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test',
      userId: '',
      type: 'registration',
      expiresAt: Date.now(),
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('should only accept registration or authentication type', () => {
    expect(
      challengeEntrySchema.safeParse({
        challenge: 'test',
        userId: 'user-1',
        type: 'registration',
        expiresAt: Date.now(),
        createdAt: new Date(),
      }).success
    ).toBe(true);

    expect(
      challengeEntrySchema.safeParse({
        challenge: 'test',
        userId: 'user-1',
        type: 'authentication',
        expiresAt: Date.now(),
        createdAt: new Date(),
      }).success
    ).toBe(true);

    expect(
      challengeEntrySchema.safeParse({
        challenge: 'test',
        userId: 'user-1',
        type: 'invalid',
        expiresAt: Date.now(),
        createdAt: new Date(),
      }).success
    ).toBe(false);
  });

  it('should require expiresAt to be positive integer', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test',
      userId: 'user-1',
      type: 'registration',
      expiresAt: -1,
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// MUTATION-KILLING: Exact value pinning and boundary tests
// =============================================================================

describe('Mutation-killing: DEFAULT_WEBAUTHN_CONFIG exact values', () => {
  it('should have exactly 9 properties', () => {
    const keys = Object.keys(DEFAULT_WEBAUTHN_CONFIG);
    expect(keys).toHaveLength(9);
    expect(keys).toEqual(
      expect.arrayContaining([
        'rpName', 'rpId', 'origin', 'attestation',
        'userVerification', 'timeout', 'residentKey',
        'challengeTTL', 'supportedAlgorithms',
      ])
    );
  });

  it('should have supportedAlgorithms with exactly 2 elements', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms).toHaveLength(2);
  });

  it('should have supportedAlgorithms in correct order [-7, -257]', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[0]).toBe(-7);
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[1]).toBe(-257);
    // Kill swap mutation
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[0]).not.toBe(-257);
    expect(DEFAULT_WEBAUTHN_CONFIG.supportedAlgorithms[1]).not.toBe(-7);
  });

  it('should have timeout !== challengeTTL (kill value swap mutations)', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.timeout).not.toBe(DEFAULT_WEBAUTHN_CONFIG.challengeTTL);
    expect(DEFAULT_WEBAUTHN_CONFIG.timeout).toBeLessThan(DEFAULT_WEBAUTHN_CONFIG.challengeTTL);
  });

  it('should have rpName exactly "Vorion Platform" (not empty, not rpId)', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.rpName).not.toBe('');
    expect(DEFAULT_WEBAUTHN_CONFIG.rpName).not.toBe(DEFAULT_WEBAUTHN_CONFIG.rpId);
    expect(DEFAULT_WEBAUTHN_CONFIG.rpName.length).toBe(15);
  });

  it('should have origin containing port 3000 (not just localhost)', () => {
    expect(DEFAULT_WEBAUTHN_CONFIG.origin).toContain(':3000');
    expect(DEFAULT_WEBAUTHN_CONFIG.origin).toContain('http://');
    expect(DEFAULT_WEBAUTHN_CONFIG.origin).not.toContain('https://');
  });
});

describe('Mutation-killing: authenticatorTransportSchema exact values', () => {
  it('should have exactly 7 valid transport types', () => {
    const validTransports = ['usb', 'ble', 'nfc', 'internal', 'cable', 'hybrid', 'smart-card'];
    let validCount = 0;
    for (const t of validTransports) {
      if (authenticatorTransportSchema.safeParse(t).success) validCount++;
    }
    expect(validCount).toBe(7);
  });

  it('should reject similar but incorrect transport names', () => {
    expect(authenticatorTransportSchema.safeParse('USB').success).toBe(false);
    expect(authenticatorTransportSchema.safeParse('bluetooth').success).toBe(false);
    expect(authenticatorTransportSchema.safeParse('smartcard').success).toBe(false);
    expect(authenticatorTransportSchema.safeParse('smart_card').success).toBe(false);
    expect(authenticatorTransportSchema.safeParse('Internal').success).toBe(false);
  });
});

describe('Mutation-killing: webAuthnConfigSchema boundary values', () => {
  const validConfig = {
    rpName: 'Test',
    rpId: 'localhost',
    origin: 'https://localhost:3000',
    attestation: 'none' as const,
    userVerification: 'preferred' as const,
    timeout: 60000,
    residentKey: 'preferred' as const,
    challengeTTL: 300000,
    supportedAlgorithms: [-7, -257],
  };

  it('should accept timeout of exactly 1 (minimum positive)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: 1 }).success
    ).toBe(true);
  });

  it('should accept timeout of exactly 600000 (maximum)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: 600000 }).success
    ).toBe(true);
  });

  it('should accept challengeTTL of exactly 1 (minimum positive)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, challengeTTL: 1 }).success
    ).toBe(true);
  });

  it('should accept challengeTTL of exactly 600000 (maximum)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, challengeTTL: 600000 }).success
    ).toBe(true);
  });

  it('should accept rpName of exactly 255 characters (boundary)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, rpName: 'a'.repeat(255) }).success
    ).toBe(true);
  });

  it('should reject rpName of exactly 256 characters (boundary)', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, rpName: 'a'.repeat(256) }).success
    ).toBe(false);
  });

  it('should reject non-integer timeout', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, timeout: 60000.5 }).success
    ).toBe(false);
  });

  it('should reject non-integer challengeTTL', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, challengeTTL: 300000.5 }).success
    ).toBe(false);
  });

  it('should reject invalid residentKey values', () => {
    expect(
      webAuthnConfigSchema.safeParse({ ...validConfig, residentKey: 'invalid' }).success
    ).toBe(false);
  });
});

describe('Mutation-killing: webAuthnCredentialSchema boundary values', () => {
  const validCredential = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    credentialId: 'x',
    publicKey: 'x',
    counter: 0,
    createdAt: new Date(),
    lastUsedAt: null,
    name: 'x',
    userId: 'x',
  };

  it('should accept counter of exactly 0 (minimum)', () => {
    expect(
      webAuthnCredentialSchema.safeParse({ ...validCredential, counter: 0 }).success
    ).toBe(true);
  });

  it('should accept name of exactly 1 character (minimum)', () => {
    expect(
      webAuthnCredentialSchema.safeParse({ ...validCredential, name: 'a' }).success
    ).toBe(true);
  });

  it('should accept name of exactly 255 characters (maximum)', () => {
    expect(
      webAuthnCredentialSchema.safeParse({ ...validCredential, name: 'a'.repeat(255) }).success
    ).toBe(true);
  });

  it('should reject non-integer counter', () => {
    expect(
      webAuthnCredentialSchema.safeParse({ ...validCredential, counter: 1.5 }).success
    ).toBe(false);
  });

  it('should reject lastUsedAt as undefined (must be null or Date)', () => {
    const result = webAuthnCredentialSchema.safeParse({
      ...validCredential,
      lastUsedAt: undefined,
    });
    expect(result.success).toBe(false);
  });
});

describe('Mutation-killing: listCredentialsInputSchema boundary values', () => {
  it('should accept limit of exactly 1 (minimum)', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 1,
    });
    expect(result.success).toBe(true);
  });

  it('should accept limit of exactly 100 (maximum)', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 100,
    });
    expect(result.success).toBe(true);
  });

  it('should accept offset of exactly 0 (minimum)', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      offset: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit of exactly 0 (below minimum)', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject limit of exactly 101 (above maximum)', () => {
    const result = listCredentialsInputSchema.safeParse({
      userId: 'user-1',
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it('should default limit to exactly 50 (not 49 or 51)', () => {
    const result = listCredentialsInputSchema.parse({ userId: 'user-1' });
    expect(result.limit).toBe(50);
    expect(result.limit).not.toBe(49);
    expect(result.limit).not.toBe(51);
  });

  it('should default offset to exactly 0 (not 1 or -1)', () => {
    const result = listCredentialsInputSchema.parse({ userId: 'user-1' });
    expect(result.offset).toBe(0);
    expect(result.offset).not.toBe(1);
  });
});

describe('Mutation-killing: generateRegistrationOptionsInputSchema boundary values', () => {
  it('should accept userName of exactly 255 characters (maximum boundary)', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('should accept userDisplayName of exactly 255 characters (maximum boundary)', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
      userDisplayName: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('should reject userDisplayName of exactly 256 characters', () => {
    const result = generateRegistrationOptionsInputSchema.safeParse({
      userId: 'user-1',
      userName: 'user@test.com',
      userDisplayName: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional requireUserVerification boolean', () => {
    expect(
      generateRegistrationOptionsInputSchema.safeParse({
        userId: 'user-1',
        userName: 'user@test.com',
        requireUserVerification: true,
      }).success
    ).toBe(true);

    expect(
      generateRegistrationOptionsInputSchema.safeParse({
        userId: 'user-1',
        userName: 'user@test.com',
        requireUserVerification: false,
      }).success
    ).toBe(true);
  });
});

describe('Mutation-killing: verifyRegistrationInputSchema boundary values', () => {
  it('should accept credentialName of exactly 1 character (minimum boundary)', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
      credentialName: 'a',
    });
    expect(result.success).toBe(true);
  });

  it('should accept credentialName of exactly 255 characters (maximum boundary)', () => {
    const result = verifyRegistrationInputSchema.safeParse({
      userId: 'user-1',
      response: {},
      credentialName: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });
});

describe('Mutation-killing: renameCredentialInputSchema boundary values', () => {
  it('should accept name of exactly 1 character (minimum boundary)', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'a',
    });
    expect(result.success).toBe(true);
  });

  it('should accept name of exactly 255 characters (maximum boundary)', () => {
    const result = renameCredentialInputSchema.safeParse({
      userId: 'user-1',
      credentialId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });
});

describe('Mutation-killing: RegistrationErrorCode exact string values', () => {
  it('should have keys that match their values exactly', () => {
    for (const [key, value] of Object.entries(RegistrationErrorCode)) {
      expect(key).toBe(value);
    }
  });
});

describe('Mutation-killing: AuthenticationErrorCode exact string values', () => {
  it('should have keys that match their values exactly', () => {
    for (const [key, value] of Object.entries(AuthenticationErrorCode)) {
      expect(key).toBe(value);
    }
  });
});

describe('Mutation-killing: WebAuthnAuditEventType prefix consistency', () => {
  it('should have all event types prefixed with webauthn.', () => {
    for (const value of Object.values(WebAuthnAuditEventType)) {
      expect(value).toMatch(/^webauthn\./);
    }
  });

  it('should have each value unique (no duplicates)', () => {
    const values = Object.values(WebAuthnAuditEventType);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('Mutation-killing: challengeEntrySchema exact boundary values', () => {
  it('should accept expiresAt of exactly 1 (minimum positive)', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test',
      userId: 'user-1',
      type: 'registration',
      expiresAt: 1,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('should reject expiresAt of exactly 0', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test',
      userId: 'user-1',
      type: 'registration',
      expiresAt: 0,
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('should reject expiresAt as float', () => {
    const result = challengeEntrySchema.safeParse({
      challenge: 'test',
      userId: 'user-1',
      type: 'registration',
      expiresAt: 1.5,
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
