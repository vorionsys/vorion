# Authentication API

The Authentication API provides endpoints for user session management, token lifecycle, and multi-factor authentication.

## Overview

Vorion uses JWT-based authentication with support for:
- Session management (single and multi-device)
- Token revocation with audit logging
- Multi-factor authentication (TOTP)
- DPoP (Demonstrating Proof-of-Possession) for enhanced security

---

## POST /api/v1/auth/logout

Logout from current session or all sessions.

### Request

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body (optional):**
```json
{
  "logoutAll": false,
  "excludeCurrentSession": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `logoutAll` | boolean | `false` | Logout from all sessions |
| `excludeCurrentSession` | boolean | `false` | Keep current session when using `logoutAll` |

### Response

**Success (200 OK):**
```json
{
  "message": "Logged out successfully",
  "loggedOutSessions": 1,
  "revokedTokenFamilies": 0
}
```

**Fields:**
- `message`: Status message
- `loggedOutSessions`: Number of sessions terminated (when `logoutAll` is true)
- `revokedTokenFamilies`: Number of refresh token families revoked

### Behavior

**Single Session Logout (`logoutAll: false`):**
1. Revokes the current JWT token (adds JTI to revocation list)
2. Adds token to bloom filter for fast revocation checking
3. Publishes revocation to other instances
4. Revokes associated session if `sessionId` present in token

**All Sessions Logout (`logoutAll: true`):**
1. Revokes all JWT tokens for the user
2. Revokes all refresh token families
3. Terminates all active sessions
4. Optionally keeps current session if `excludeCurrentSession: true`

### Notes

- Returns success even if token is invalid/expired (prevents information leakage)
- Audit events are logged for all logout operations
- Rate limited: 10 requests per 60 seconds

---

## POST /api/v1/auth/revoke-all

Revoke all tokens with password confirmation. This is a security-sensitive operation that invalidates all authentication credentials.

### Request

```http
POST /api/v1/auth/revoke-all
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "currentPassword": "user_password",
  "includeApiKeys": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `currentPassword` | string | Yes | Current password for verification |
| `includeApiKeys` | boolean | No | Also revoke API keys (default: false) |

### Response

**Success (200 OK):**
```json
{
  "message": "All tokens have been revoked",
  "result": {
    "totalRevoked": 15,
    "jwtTokensRevoked": 5,
    "refreshTokenFamiliesRevoked": 3,
    "sessionsRevoked": 4,
    "apiKeysRevoked": 3
  }
}
```

**Invalid Password (401 Unauthorized):**
```json
{
  "error": {
    "code": "INVALID_PASSWORD",
    "message": "Current password is incorrect"
  }
}
```

**Validation Error (400 Bad Request):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Current password is required"
  }
}
```

### Behavior

1. Verifies JWT token
2. Validates current password
3. Revokes all token types:
   - JWT access tokens
   - Refresh tokens
   - Active sessions
   - API keys (if `includeApiKeys: true`)
4. Logs audit event with password confirmation flag

### Notes

- Requires password confirmation for security
- Failed password attempts are logged
- Rate limited: 3 requests per 3600 seconds (1 hour)

---

## POST /api/v1/auth/logout-device

Logout from a specific device by device ID.

### Request

```http
POST /api/v1/auth/logout-device
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "deviceId": "device_uuid_or_fingerprint"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceId` | string | Yes | Device identifier to logout |

### Response

**Success (200 OK):**
```json
{
  "message": "Device logged out successfully",
  "sessionsRevoked": 2,
  "refreshTokensRevoked": 1
}
```

**Validation Error (400 Bad Request):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Device ID is required"
  }
}
```

### Behavior

1. Verifies JWT token
2. Revokes all sessions for the specified device
3. Revokes all refresh tokens associated with the device
4. Logs audit event

### Notes

- Useful for remote device management
- Does not affect other devices
- Rate limited: 10 requests per 60 seconds

---

## MFA Endpoints

Multi-Factor Authentication endpoints for TOTP-based second factor authentication.

### POST /api/v1/mfa/enroll

Start MFA enrollment process. Generates TOTP secret and QR code.

**Request:**
```http
POST /api/v1/mfa/enroll
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body (optional):**
```json
{
  "email": "user@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | No | Email for enrollment (uses token email if not provided) |

**Response (200 OK):**
```json
{
  "enrollmentId": "enrollment_uuid",
  "secret": "BASE32_ENCODED_SECRET",
  "qrCodeUrl": "otpauth://totp/Vorion:user@example.com?secret=...",
  "expiresAt": "2026-02-04T12:30:00Z"
}
```

### POST /api/v1/mfa/enroll/verify

Verify TOTP code during enrollment.

**Request:**
```http
POST /api/v1/mfa/enroll/verify
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "code": "123456"
}
```

**Success Response (200 OK):**
```json
{
  "verified": true,
  "message": "Verification successful. Complete enrollment to activate MFA."
}
```

**Invalid Code Response (400 Bad Request):**
```json
{
  "error": {
    "code": "MFA_INVALID_CODE",
    "message": "Invalid verification code. Please check your authenticator app and try again."
  }
}
```

### POST /api/v1/mfa/enroll/complete

Complete MFA enrollment after verification.

**Request:**
```http
POST /api/v1/mfa/enroll/complete
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "enabled": true,
  "backupCodes": [
    "AAAA-BBBB-CCCC",
    "DDDD-EEEE-FFFF",
    "..."
  ],
  "backupCodesCount": 10
}
```

**Note:** Backup codes are only shown once. Store them securely.

### POST /api/v1/mfa/challenge

Create an MFA challenge for authentication.

**Request:**
```http
POST /api/v1/mfa/challenge
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body (optional):**
```json
{
  "sessionId": "optional_session_id"
}
```

**Response (200 OK):**
```json
{
  "challengeToken": "challenge_jwt_token",
  "expiresAt": "2026-02-04T12:05:00Z",
  "method": "totp"
}
```

### POST /api/v1/mfa/challenge/verify

Verify MFA challenge.

**Request:**
```http
POST /api/v1/mfa/challenge/verify
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "challengeToken": "challenge_jwt_token",
  "code": "123456"
}
```

**Success Response (200 OK):**
```json
{
  "verified": true,
  "sessionToken": "new_session_token"
}
```

**Failure Response (401 Unauthorized):**
```json
{
  "error": {
    "code": "MFA_VERIFICATION_FAILED",
    "message": "MFA verification failed"
  },
  "details": {
    "attemptsRemaining": 2
  }
}
```

### DELETE /api/v1/mfa

Disable MFA for the current user.

**Request:**
```http
DELETE /api/v1/mfa
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "message": "MFA has been disabled successfully"
}
```

### POST /api/v1/mfa/backup-codes/regenerate

Regenerate backup codes (invalidates existing codes).

**Request:**
```http
POST /api/v1/mfa/backup-codes/regenerate
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "backupCodes": [
    "XXXX-YYYY-ZZZZ",
    "..."
  ],
  "generatedAt": "2026-02-04T12:00:00Z"
}
```

### GET /api/v1/mfa/status

Get MFA status for the current user.

**Request:**
```http
GET /api/v1/mfa/status
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "enabled": true,
  "method": "totp",
  "backupCodesRemaining": 8,
  "enrolledAt": "2026-01-15T10:30:00Z",
  "lastUsedAt": "2026-02-03T14:22:00Z"
}
```

---

## DPoP Requirements

DPoP (Demonstrating Proof-of-Possession) is required for Trust Tiers T2 and above.

### Overview

DPoP binds access tokens to a cryptographic key pair held by the client, preventing:
- Token theft
- Token replay attacks
- Man-in-the-middle token interception

### Required Trust Tiers

| Trust Tier | DPoP Required |
|------------|---------------|
| T0 (Sandbox) | No |
| T1 (Restricted) | No |
| T2 (Standard) | Yes |
| T3 (Elevated) | Yes |
| T4 (High) | Yes |
| T5 (Full) | Yes |

### DPoP Proof Structure

The DPoP proof is a JWT with the following structure:

**Header:**
```json
{
  "typ": "dpop+jwt",
  "alg": "ES256",
  "jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

**Payload:**
```json
{
  "jti": "unique_identifier",
  "htm": "POST",
  "htu": "https://api.vorion.io/api/v1/intents",
  "iat": 1706961234,
  "ath": "access_token_hash"
}
```

| Claim | Description |
|-------|-------------|
| `jti` | Unique identifier (prevents replay) |
| `htm` | HTTP method |
| `htu` | Target URI |
| `iat` | Issued at timestamp |
| `ath` | SHA-256 hash of access token (for bound tokens) |

### Making DPoP-Protected Requests

```http
POST /api/v1/intents
Authorization: Bearer <access_token>
DPoP: <dpop_proof_jwt>
Content-Type: application/json
```

### Configuration

| Parameter | Value |
|-----------|-------|
| Allowed algorithms | ES256, ES384, ES512 |
| Maximum proof age | 60 seconds |
| Clock skew tolerance | 5 seconds |
| JTI cache backend | Redis (with in-memory fallback) |

### Error Responses

**Invalid DPoP Proof (401 Unauthorized):**
```json
{
  "error": {
    "code": "INVALID_FORMAT",
    "message": "Invalid DPoP proof format"
  }
}
```

**Expired Proof (401 Unauthorized):**
```json
{
  "error": {
    "code": "EXPIRED",
    "message": "DPoP proof expired (age: 65s, max: 60s)"
  }
}
```

**Replay Detected (401 Unauthorized):**
```json
{
  "error": {
    "code": "REPLAY",
    "message": "DPoP proof replay detected"
  }
}
```

### Implementation Example (TypeScript)

```typescript
import { createDPoPService } from '@vorionsys/security';

const dpop = createDPoPService();

// Generate key pair
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

// Generate proof
const proof = await dpop.generateProof(
  keyPair.privateKey,
  'POST',
  'https://api.vorion.io/api/v1/intents',
  accessTokenHash
);

// Make request
const response = await fetch('https://api.vorion.io/api/v1/intents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'DPoP': proof,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(intentData)
});
```

---

## Role Requirements

| Endpoint | Required Roles |
|----------|----------------|
| MFA endpoints (self) | `admin`, `tenant:admin`, `user` |
| MFA status (read) | `admin`, `tenant:admin`, `user`, `mfa:reader` |

---

## Audit Logging

All authentication events are logged:

- `token.revoked` - Single token revocation
- `sessions.bulk_revoked` - Multiple sessions revoked
- `auth.attempt` - Authentication attempts (success/failure)
- `mfa.enrolled` - MFA enrollment completed
- `mfa.disabled` - MFA disabled
- `mfa.challenge.verified` - MFA challenge verified

Audit logs include:
- Actor information (user ID, IP, user agent)
- Tenant context
- Timestamp
- Operation details
