# Vorion Security Architecture

This document describes the security architecture of the Vorion platform, including authentication, authorization, and protection mechanisms.

## Overview

Vorion implements a defense-in-depth security model with multiple layers:

1. **Transport Security** - HTTPS/TLS encryption
2. **Token Security** - DPoP sender-constrained tokens
3. **Request Protection** - CSRF tokens
4. **Multi-Factor Authentication** - TOTP with backup codes
5. **Session Management** - Secure session lifecycle
6. **Authorization** - RBAC with trust-based access control
7. **Tenant Isolation** - Multi-tenant data boundaries

## Authentication Flow

### Standard Authentication Flow

```
+----------+     +----------+     +----------+     +----------+
|          |     |          |     |          |     |          |
|  Client  +---->+  OAuth   +---->+  Vorion  +---->+  Trust   |
|          |     |  Server  |     |  Auth    |     |  Engine  |
+----------+     +----------+     +----------+     +----------+
     |                |                |                |
     |  1. Login      |                |                |
     +--------------->+                |                |
     |                |                |                |
     |  2. Tokens     |                |                |
     +<---------------+                |                |
     |                                 |                |
     |  3. API Request + DPoP Proof    |                |
     +-------------------------------->+                |
     |                                 |                |
     |                  4. Validate    |                |
     |                     Token       |                |
     |                                 +--------------->+
     |                                 |                |
     |                  5. Get Trust   |                |
     |                     Score       +<---------------+
     |                                 |                |
     |  6. Response                    |                |
     +<--------------------------------+                |
```

### MFA-Enhanced Flow

```
1. Initial Login
   Client --> OAuth: Credentials
   OAuth --> Client: Partial token (MFA required)

2. MFA Challenge
   Client --> Vorion: Request challenge
   Vorion --> Client: Challenge token + expiry

3. MFA Verification
   Client --> Vorion: Challenge token + TOTP code
   Vorion --> Client: Full access token

4. Subsequent Requests
   Client --> Vorion: Request + Access token + DPoP proof
```

## Authorization Model

### RBAC + Trust Tiers

Vorion combines traditional RBAC with trust-based access control:

```
                    +------------------+
                    |                  |
                    |  Access Request  |
                    |                  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+         +----------v--------+
     |                 |         |                   |
     |  RBAC Check     |         |  Trust Check      |
     |  (Roles/Perms)  |         |  (Tier/Score)     |
     |                 |         |                   |
     +--------+--------+         +----------+--------+
              |                             |
              +-------------+---------------+
                            |
                   +--------v--------+
                   |                 |
                   |  Final Decision |
                   |                 |
                   +-----------------+
```

### Permission Evaluation

1. **Extract Subject**: User ID or Service Account ID
2. **Get Effective Roles**: Direct + Inherited roles
3. **Aggregate Permissions**: Union of all role permissions
4. **Match Request**: Compare action:resource against permissions
5. **Apply Trust Gate**: Verify minimum trust tier

### Trust-Gated Operations

Operations require minimum trust tiers:

| Operation Type | Minimum Tier | Description |
|---------------|--------------|-------------|
| Read Operations | T0 | Sandbox-safe reads |
| Write Operations | T2 | Provisional+ for writes |
| Execute Operations | T3 | Monitored+ for execution |
| Admin Operations | T5 | Trusted+ for admin |
| Autonomous Operations | T7 | Full autonomy required |

## Token Security (DPoP)

### Overview

DPoP (Demonstrating Proof-of-Possession) binds access tokens to cryptographic key pairs, preventing token theft and replay attacks.

### How DPoP Works

```
1. Key Generation
   Client generates EC key pair (ES256)

2. Proof Creation
   DPoP Proof = JWT {
     header: {
       typ: "dpop+jwt",
       alg: "ES256",
       jwk: <public key>
     },
     payload: {
       jti: <unique ID>,
       htm: "POST",           // HTTP method
       htu: "https://...",    // Target URI
       iat: <timestamp>,
       ath: <access token hash>  // Optional
     }
   }

3. Request
   Authorization: DPoP <access_token>
   DPoP: <proof>

4. Verification
   - Verify proof signature with embedded public key
   - Check JTI uniqueness (prevent replay)
   - Validate htm, htu match request
   - Check iat not expired
   - Verify ath matches token (if bound)
```

### Configuration

```typescript
const dpop = createDPoPService({
  config: {
    requiredForTiers: [2, 3, 4, 5, 6, 7],  // T2+ requires DPoP
    maxProofAge: 60,                        // Seconds
    clockSkewTolerance: 5,                  // Seconds
    allowedAlgorithms: ['ES256'],
  },
  // Production: Redis-backed JTI cache
  // Development: In-memory cache
});
```

### JTI Cache

Prevents replay attacks by tracking seen JTIs:

| Feature | Redis | Memory |
|---------|-------|--------|
| Max Size | 100,000 | 10,000 |
| TTL | 5 minutes | 5 minutes |
| Multi-instance | Yes | No |
| Fallback | Auto-fallback to memory | N/A |

## Session Management

### Session Lifecycle

```
Create --> Active --> [Validate] --> Revoke/Expire
                         |
                         +--> Regenerate (on privilege change)
                         +--> Suspend (on security event)
```

### Session Security Features

1. **Device Fingerprinting**
   - User-Agent components
   - Accept headers
   - Language preferences
   - Platform hints

2. **IP Tracking**
   - Initial IP recording
   - Change detection (warning)
   - Concurrent session detection

3. **Inactivity Timeout**
   - Default: 1 hour
   - Configurable per tenant
   - Requires re-authentication

4. **Session Regeneration**
   - After login
   - After privilege change
   - After password reset
   - Prevents session fixation

### Sensitive Operation Re-authentication

Operations requiring recent authentication:

- Password change
- Email change
- MFA setup/disable
- API key creation
- Account deletion
- High-value transactions

Default window: 5 minutes

## CSRF Protection

### Double-Submit Cookie Pattern

```
1. Server generates token
   Token = Base64(sessionId.timestamp.random.HMAC(data, secret))

2. Token sent as:
   - HttpOnly cookie: __vorion_csrf
   - Must be included in header: X-CSRF-Token

3. Validation
   - Compare header token to cookie token
   - Verify HMAC signature
   - Check timestamp not expired
```

### Configuration

```typescript
const csrf = new CSRFProtection({
  secret: process.env.CSRF_SECRET,   // Min 32 chars
  tokenLength: 32,                    // Random bytes
  cookieName: '__vorion_csrf',
  headerName: 'X-CSRF-Token',
  tokenTTL: 3600000,                 // 1 hour
  cookieOptions: {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  },
  excludePaths: ['/api/webhooks/*'],
  excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
});
```

## MFA Implementation

### TOTP (Time-based One-Time Password)

Implements RFC 6238 for authenticator app integration.

```
1. Enrollment
   - Generate 20-byte secret (160 bits)
   - Create otpauth:// URI
   - Generate QR code for scanning

2. Verification
   - 6-digit code, 30-second window
   - 1 step tolerance (previous + next)
   - Rate limiting on failures

3. Backup Codes
   - 10 codes by default
   - SHA-256 hashed storage
   - Single use, one-way
```

### MFA Flow

```typescript
// 1. Start enrollment
const enrollment = await mfa.enrollUser(userId, tenantId, email);
// Returns: secret, otpauthUrl, qrCode, expiresAt

// 2. Verify enrollment (user scans QR, enters code)
const verified = await mfa.verifyEnrollment(userId, tenantId, code);

// 3. Complete enrollment (generates backup codes)
const complete = await mfa.completeEnrollment(userId, tenantId);
// Returns: backupCodes, enabledAt, gracePeriodEndsAt

// 4. Challenge during login
const challenge = await mfa.createChallenge(userId, sessionId);
// Returns: challengeToken, expiresAt, attemptsRemaining

// 5. Verify challenge
const result = await mfa.verifyChallenge(challengeToken, code, tenantId);
// Returns: verified, method (totp|backup_codes), attemptsRemaining
```

### Security Measures

| Measure | Value |
|---------|-------|
| Max attempts per challenge | 3 |
| Challenge expiry | 5 minutes |
| Enrollment expiry | 10 minutes |
| Backup code count | 10 |
| Grace period | 7 days |
| Secret encryption | AES-256-GCM |

## Tenant Isolation

### Data Boundaries

```
                    +------------------------+
                    |     API Gateway        |
                    +------------------------+
                              |
                    +---------v----------+
                    |  Tenant Extraction |
                    |  (from JWT)        |
                    +---------+----------+
                              |
        +---------------------+---------------------+
        |                     |                     |
+-------v-------+    +--------v-------+    +-------v-------+
|   Tenant A    |    |   Tenant B     |    |   Tenant C    |
|   Database    |    |   Database     |    |   Database    |
|   Partition   |    |   Partition    |    |   Partition   |
+---------------+    +----------------+    +---------------+
```

### Isolation Mechanisms

1. **TenantContext**
   - Created from validated JWT
   - Immutable after creation
   - Required for all data operations

2. **Query Filtering**
   - All queries include tenantId
   - Cross-tenant queries prevented

3. **Cache Isolation**
   - Cache keys include tenantId
   - Prevents cache poisoning

4. **Trust Entity Mapping**
   - Entity-to-tenant association
   - Ownership validation on access

### Example: Tenant-Aware Query

```typescript
// TenantContext can only be created from validated JWT
const ctx = createTenantContextFromJWT(validatedToken);

// All operations require TenantContext
const score = await trustEngine.getScore(entityId, ctx);
const intent = await intentService.get(ctx, intentId);

// Cross-tenant access is blocked
await trustEngine.validateTenantOwnership(entityId, extractTenantId(ctx));
```

## Security Headers

Default security headers applied to all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
X-Request-ID: <correlation-id>
```

## Audit Logging

All security events are logged:

| Event Type | Severity | Data Captured |
|------------|----------|---------------|
| Login success | INFO | userId, IP, userAgent |
| Login failure | WARNING | attemptedUser, IP, reason |
| MFA enrollment | INFO | userId, method |
| MFA verification | INFO | userId, success, method |
| Session creation | INFO | sessionId, userId, IP |
| Session revocation | WARNING | sessionId, reason, revokedBy |
| Permission denied | WARNING | userId, action, resource |
| Trust gate blocked | WARNING | userId, required, actual |

## Security Best Practices

1. **Token Handling**
   - Never log tokens
   - Short-lived access tokens (15 min)
   - Secure token storage

2. **Error Messages**
   - Generic errors to clients
   - Detailed errors in logs
   - No stack traces in production

3. **Rate Limiting**
   - Per-endpoint limits
   - Per-user limits
   - Global limits

4. **Monitoring**
   - Alert on auth failures
   - Monitor session anomalies
   - Track trust score changes
