# VORION SECURITY GAME PLAN: PATH TO IMPENETRABLE

## MISSION: 100% Deployment Readiness Across All Use Cases

**Target State:** A system so secure it can be trusted by individuals protecting personal AI agents, enterprises safeguarding business operations, and governments securing national interests.

**Philosophy:** Security should be invisible to consumers but impenetrable to adversaries.

---

## CURRENT STATE → TARGET STATE

```
                    CURRENT                           TARGET
                    ───────                           ──────
Personal:           85%  ████████░░                   100% ██████████
Business:           72%  ███████░░░                   100% ██████████
Government:         55%  █████░░░░░                   100% ██████████
```

**Timeline:** 26 weeks (6 months) to full deployment readiness
**Parallel Workstreams:** 5 concurrent tracks

---

## MASTER IMPLEMENTATION ROADMAP

```
WEEK    1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26
        ─────────────────────────────────────────────────────────────────────────────
TRACK 1 ████████████████████████████████████████████████████████████████████████████
FOUNDATION & HARDENING

TRACK 2       ████████████████████████████████████████████████████████████████
              AUTHENTICATION & IDENTITY

TRACK 3             ████████████████████████████████████████████████████████████
                    INFRASTRUCTURE & DEPLOYMENT

TRACK 4                   ████████████████████████████████████████████████████
                          COMPLIANCE & CERTIFICATION

TRACK 5                         ████████████████████████████████████████████████████
                                MONITORING & RESPONSE

MILESTONES:
Week 4:  ◆ Personal 100%
Week 12: ◆ Business 100%
Week 20: ◆ Government 95%
Week 26: ◆ Government 100% + Certification
```

---

## TRACK 1: FOUNDATION & HARDENING

### Phase 1A: Critical Security Fixes (Weeks 1-2)

#### TASK 1.1: Eliminate Development Bypasses
**Priority:** CRITICAL | **Effort:** 2 days | **Risk if skipped:** Auth bypass in production

```
Files to modify:
├── src/api/auth.ts
│   └── Remove lines 97-99 (dev secret bypass)
│   └── Add explicit VORION_ALLOW_DEV_AUTH=true requirement
│
├── src/common/encryption.ts
│   └── Remove DEV_FALLBACK_KEY (line 35)
│   └── Remove DEV_FALLBACK_SALT (line 34)
│   └── Require explicit VORION_DEV_MODE=true for fallbacks
│
└── src/common/crypto.ts
    └── Add warning log when ephemeral keys used
    └── Require explicit acknowledgment in dev
```

**Implementation:**
```typescript
// NEW: src/common/security-mode.ts
export type SecurityMode = 'production' | 'staging' | 'development' | 'testing';

export function getSecurityMode(): SecurityMode {
  const env = process.env.VORION_ENV;
  const explicitDev = process.env.VORION_ALLOW_INSECURE_DEV === 'true';

  if (env === 'production' || env === 'staging') {
    if (explicitDev) {
      throw new Error('VORION_ALLOW_INSECURE_DEV cannot be true in production/staging');
    }
    return env;
  }

  return explicitDev ? 'development' : 'production'; // Default to production security
}

export function requireProductionSecurity(): void {
  const mode = getSecurityMode();
  if (mode === 'development' || mode === 'testing') {
    throw new Error('This operation requires production security mode');
  }
}
```

#### TASK 1.2: Session Revocation Service
**Priority:** CRITICAL | **Effort:** 3 days | **Risk if skipped:** Session hijacking

```
New files:
├── src/security/session-manager.ts
├── src/security/session-store.ts (Redis-backed)
└── src/api/v1/sessions.ts (management endpoints)
```

**Implementation:**
```typescript
// src/security/session-manager.ts
export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  deviceFingerprint: string;
  ipAddress: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface SessionManagerConfig {
  maxSessionsPerUser: number;        // Default: 5
  sessionTTL: number;                // Default: 24 hours
  inactivityTimeout: number;         // Default: 1 hour
  requireReauthForSensitive: boolean;// Default: true
  sensitiveOperationWindow: number;  // Default: 5 minutes
}

export class SessionManager {
  // Revoke all sessions on password change
  async revokeAllUserSessions(userId: string, reason: string): Promise<void>;

  // Revoke specific session
  async revokeSession(sessionId: string, reason: string): Promise<void>;

  // Revoke sessions except current
  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void>;

  // Check if re-authentication needed for sensitive ops
  async requiresReauth(sessionId: string, operation: string): Promise<boolean>;

  // Validate session is active and not revoked
  async validateSession(sessionId: string): Promise<SessionValidationResult>;
}
```

#### TASK 1.3: CSRF Protection
**Priority:** CRITICAL | **Effort:** 2 days | **Risk if skipped:** Cross-site attacks

```
New files:
├── src/security/csrf.ts
└── src/api/middleware/csrf.ts
```

**Implementation:**
```typescript
// src/security/csrf.ts
export interface CSRFConfig {
  tokenLength: number;      // Default: 32
  cookieName: string;       // Default: '__vorion_csrf'
  headerName: string;       // Default: 'X-CSRF-Token'
  cookieOptions: CookieOptions;
  excludePaths: string[];   // Paths that don't need CSRF (webhooks, etc.)
  excludeMethods: string[]; // GET, HEAD, OPTIONS by default
}

export class CSRFProtection {
  generateToken(): string;
  validateToken(token: string, cookieToken: string): boolean;
  middleware(): FastifyMiddleware;
}

// Double-submit cookie pattern with signed tokens
// Token = HMAC(sessionId + timestamp + random, secret)
```

#### TASK 1.4: Secure Configuration Validator
**Priority:** HIGH | **Effort:** 2 days | **Risk if skipped:** Misconfiguration vulnerabilities

```
New files:
├── src/security/config-validator.ts
└── src/cli/security-check.ts
```

**Implementation:**
```typescript
// src/security/config-validator.ts
export interface SecurityCheckResult {
  passed: boolean;
  checks: SecurityCheck[];
  criticalFailures: SecurityCheck[];
  warnings: SecurityCheck[];
  recommendations: string[];
}

export interface SecurityCheck {
  id: string;
  name: string;
  category: 'crypto' | 'auth' | 'network' | 'data' | 'config';
  severity: 'critical' | 'high' | 'medium' | 'low';
  passed: boolean;
  message: string;
  remediation?: string;
}

export const SECURITY_CHECKS: SecurityCheckDefinition[] = [
  {
    id: 'JWT_SECRET_ENTROPY',
    name: 'JWT Secret Strength',
    category: 'crypto',
    severity: 'critical',
    check: (config) => {
      const secret = config.jwt.secret;
      const entropy = calculateEntropy(secret);
      return entropy >= 256; // 256 bits minimum
    },
    remediation: 'Generate a new JWT secret with: openssl rand -base64 48',
  },
  {
    id: 'SIGNING_KEY_CONFIGURED',
    name: 'Signing Key Persistence',
    category: 'crypto',
    severity: 'critical',
    check: (config) => !!process.env.VORION_SIGNING_KEY,
    remediation: 'Generate signing key with: npx vorion keys:generate --type=signing',
  },
  {
    id: 'ENCRYPTION_KEY_CONFIGURED',
    name: 'Encryption Key Configured',
    category: 'crypto',
    severity: 'critical',
    check: (config) => !!config.encryption?.key,
    remediation: 'Set VORION_ENCRYPTION_KEY environment variable',
  },
  {
    id: 'DATABASE_TLS',
    name: 'Database TLS Enabled',
    category: 'network',
    severity: 'high',
    check: (config) => config.database.ssl !== false,
    remediation: 'Enable SSL in database connection: VORION_DB_SSL=true',
  },
  {
    id: 'REDIS_TLS',
    name: 'Redis TLS Enabled',
    category: 'network',
    severity: 'high',
    check: (config) => config.redis?.tls !== false,
    remediation: 'Enable TLS for Redis: VORION_REDIS_TLS=true',
  },
  // ... 20+ more checks
];

export async function runSecurityAudit(config: Config): Promise<SecurityCheckResult>;
```

**Startup Integration:**
```typescript
// src/index.ts - Add before server start
const securityResult = await runSecurityAudit(config);

if (securityResult.criticalFailures.length > 0) {
  logger.error({ failures: securityResult.criticalFailures },
    'CRITICAL SECURITY FAILURES - Server cannot start');

  if (config.env === 'production') {
    process.exit(1);
  }
}

securityResult.warnings.forEach(warning => {
  logger.warn({ check: warning }, `Security warning: ${warning.message}`);
});
```

---

### Phase 1B: Input Hardening (Weeks 3-4)

#### TASK 1.5: Enhanced Injection Prevention
**Priority:** HIGH | **Effort:** 3 days

```
Modify: src/common/validation.ts
Add: src/security/injection-detector.ts
```

**Implementation:**
```typescript
// src/security/injection-detector.ts
export interface InjectionDetectorConfig {
  enableSQLDetection: boolean;
  enableXSSDetection: boolean;
  enableCommandDetection: boolean;
  enableTemplateDetection: boolean;
  enablePathTraversalDetection: boolean;
  enableLDAPDetection: boolean;
  enableXMLDetection: boolean;
  enableNoSQLDetection: boolean;
  customPatterns: RegExp[];
  allowlist: string[]; // Known safe patterns
  logDetections: boolean;
  blockOnDetection: boolean;
}

export const INJECTION_PATTERNS = {
  SQL: [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,  // OR 1=1 patterns
    /(--|\#|\/\*)/,                     // SQL comments
    /(\bEXEC\b|\bEXECUTE\b)/i,
    /(\bxp_|\bsp_)/i,                   // SQL Server procs
  ],
  XSS: [
    /<script[^>]*>/i,
    /javascript:/i,
    /on\w+\s*=/i,                       // Event handlers
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /data:/i,
    /vbscript:/i,
  ],
  COMMAND: [
    /[;&|`$]/,
    /\$\([^)]+\)/,                      // $(command)
    /`[^`]+`/,                          // `command`
    /\|\s*\w+/,                         // | command
    />\s*\/\w+/,                        // > /path
  ],
  TEMPLATE: [
    /\$\{[^}]+\}/,                      // ${...}
    /\{\{[^}]+\}\}/,                    // {{...}}
    /<%[^%]+%>/,                        // <%...%>
    /\[\[[^\]]+\]\]/,                   // [[...]]
  ],
  PATH_TRAVERSAL: [
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e%2f/i,
    /%2e%2e\//i,
    /\.%2e\//i,
  ],
  LDAP: [
    /[()\\*]/,
    /\x00/,                             // Null byte
  ],
  XML: [
    /<!ENTITY/i,
    /<!DOCTYPE[^>]*\[/i,
    /SYSTEM\s+["']/i,
  ],
  NOSQL: [
    /\$where/i,
    /\$regex/i,
    /\$gt|\$lt|\$ne|\$eq/i,
    /\{\s*"\$\w+"/,
  ],
};

export class InjectionDetector {
  detect(input: string): InjectionDetectionResult;
  sanitize(input: string): string;
  isAllowlisted(input: string): boolean;
}
```

#### TASK 1.6: Request Signing & Integrity
**Priority:** MEDIUM | **Effort:** 3 days

```
New files:
├── src/security/request-integrity.ts
└── src/api/middleware/request-signing.ts
```

**Implementation:**
```typescript
// src/security/request-integrity.ts
export interface SignedRequest {
  timestamp: number;
  nonce: string;
  signature: string;
  algorithm: 'HMAC-SHA256' | 'Ed25519';
}

export class RequestIntegrity {
  // Verify request hasn't been tampered with
  verifySignature(request: FastifyRequest, signature: SignedRequest): boolean;

  // Generate signature for outgoing requests
  signRequest(method: string, path: string, body: unknown, secret: string): SignedRequest;

  // Check for replay attacks
  isReplay(nonce: string, timestamp: number): boolean;

  // Rate limit by signature to prevent replay
  recordNonce(nonce: string, ttl: number): void;
}
```

#### TASK 1.7: Memory-Safe Credential Handling
**Priority:** MEDIUM | **Effort:** 2 days

```
New file: src/security/secure-memory.ts
```

**Implementation:**
```typescript
// src/security/secure-memory.ts
export class SecureString {
  private buffer: Buffer;
  private cleared: boolean = false;

  constructor(value: string) {
    this.buffer = Buffer.from(value, 'utf8');
  }

  // Use the value (creates temporary copy)
  use<T>(fn: (value: string) => T): T {
    if (this.cleared) throw new Error('SecureString already cleared');
    const value = this.buffer.toString('utf8');
    try {
      return fn(value);
    } finally {
      // Note: Can't truly clear JS string, but this is best effort
    }
  }

  // Zero-fill and release
  clear(): void {
    if (!this.cleared) {
      this.buffer.fill(0);
      this.cleared = true;
    }
  }

  // Ensure cleanup on GC
  [Symbol.dispose](): void {
    this.clear();
  }
}

// Usage:
using secret = new SecureString(process.env.JWT_SECRET!);
const token = secret.use(s => jwt.sign(payload, s));
// Automatically cleared when scope exits
```

---

### Phase 1C: Cryptographic Hardening (Weeks 5-6)

#### TASK 1.8: Key Rotation System
**Priority:** HIGH | **Effort:** 4 days

```
New files:
├── src/security/key-rotation.ts
├── src/security/key-store.ts
└── src/cli/keys.ts
```

**Implementation:**
```typescript
// src/security/key-rotation.ts
export interface KeyMetadata {
  id: string;
  type: 'signing' | 'encryption' | 'jwt';
  algorithm: string;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt?: Date;
  status: 'active' | 'rotating' | 'retired' | 'compromised';
  version: number;
}

export interface KeyRotationConfig {
  signingKeyRotationDays: number;     // Default: 90
  encryptionKeyRotationDays: number;  // Default: 365
  jwtKeyRotationDays: number;         // Default: 30
  keyOverlapDays: number;             // Default: 7 (grace period)
  autoRotate: boolean;
  notifyBeforeDays: number;           // Default: 14
}

export class KeyRotationManager {
  // Rotate a specific key type
  async rotateKey(type: 'signing' | 'encryption' | 'jwt'): Promise<KeyMetadata>;

  // Get all active keys (for verification during overlap)
  async getActiveKeys(type: string): Promise<KeyMetadata[]>;

  // Schedule automatic rotation
  scheduleRotation(config: KeyRotationConfig): void;

  // Verify data with any valid key version
  async verifyWithKeyHistory(data: string, signature: string): Promise<boolean>;

  // Re-encrypt data with new key
  async reencryptWithNewKey(encryptedData: EncryptedEnvelope): Promise<EncryptedEnvelope>;

  // Mark key as compromised (immediate revocation)
  async compromiseKey(keyId: string, reason: string): Promise<void>;
}
```

#### TASK 1.9: Hardware Security Module Integration
**Priority:** HIGH (Government) | **Effort:** 5 days

```
New files:
├── src/security/hsm/index.ts
├── src/security/hsm/aws-cloudhsm.ts
├── src/security/hsm/azure-hsm.ts
├── src/security/hsm/pkcs11.ts
└── src/security/hsm/software-fallback.ts
```

**Implementation:**
```typescript
// src/security/hsm/index.ts
export interface HSMProvider {
  name: string;
  initialize(config: HSMConfig): Promise<void>;
  generateKey(algorithm: string, extractable: boolean): Promise<KeyHandle>;
  sign(keyHandle: KeyHandle, data: Buffer): Promise<Buffer>;
  verify(keyHandle: KeyHandle, data: Buffer, signature: Buffer): Promise<boolean>;
  encrypt(keyHandle: KeyHandle, data: Buffer): Promise<Buffer>;
  decrypt(keyHandle: KeyHandle, data: Buffer): Promise<Buffer>;
  destroyKey(keyHandle: KeyHandle): Promise<void>;
  getKeyInfo(keyHandle: KeyHandle): Promise<KeyInfo>;
}

export interface HSMConfig {
  provider: 'aws-cloudhsm' | 'azure-hsm' | 'pkcs11' | 'software';

  // AWS CloudHSM
  awsClusterId?: string;
  awsHsmUser?: string;
  awsHsmPassword?: SecureString;

  // Azure Dedicated HSM
  azureVaultUrl?: string;
  azureTenantId?: string;

  // PKCS#11 (On-prem HSM)
  pkcs11Library?: string;
  pkcs11Slot?: number;
  pkcs11Pin?: SecureString;

  // Fallback behavior
  allowSoftwareFallback: boolean;
  softwareFallbackInProduction: boolean; // Should be false
}

export async function createHSMProvider(config: HSMConfig): Promise<HSMProvider>;
```

#### TASK 1.10: FIPS 140-2 Compliance Mode
**Priority:** CRITICAL (Government) | **Effort:** 3 days

```
New file: src/security/fips-mode.ts
Modify: src/common/crypto.ts
```

**Implementation:**
```typescript
// src/security/fips-mode.ts
export interface FIPSConfig {
  enabled: boolean;
  level: 1 | 2 | 3;  // FIPS 140-2 levels
  strictMode: boolean;
  allowedAlgorithms: string[];
  disallowedAlgorithms: string[];
}

export const FIPS_ALLOWED_ALGORITHMS = [
  'AES-128-GCM', 'AES-256-GCM',
  'SHA-256', 'SHA-384', 'SHA-512',
  'RSA-2048', 'RSA-3072', 'RSA-4096',
  'ECDSA-P256', 'ECDSA-P384', 'ECDSA-P521',
  'ECDH-P256', 'ECDH-P384', 'ECDH-P521',
  'HMAC-SHA256', 'HMAC-SHA384', 'HMAC-SHA512',
  'PBKDF2-SHA256', 'PBKDF2-SHA512',
];

export const FIPS_DISALLOWED_ALGORITHMS = [
  'MD5', 'SHA1',
  'DES', '3DES', 'RC4',
  'RSA-1024',
  'Ed25519', // Not FIPS approved (use ECDSA-P256 instead)
];

export class FIPSMode {
  static enable(config: FIPSConfig): void;
  static isEnabled(): boolean;
  static validateAlgorithm(algorithm: string): void;
  static getApprovedAlgorithm(preferred: string): string;
}

// Modify crypto.ts to respect FIPS mode
export async function generateKeyPair(): Promise<KeyPair> {
  if (FIPSMode.isEnabled()) {
    // Use ECDSA P-256 instead of Ed25519
    return crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
  }
  // ... existing Ed25519 code
}
```

---

## TRACK 2: AUTHENTICATION & IDENTITY

### Phase 2A: Enterprise Authentication (Weeks 3-8)

#### TASK 2.1: SSO/OIDC Integration
**Priority:** CRITICAL (Business) | **Effort:** 8 days

```
New files:
├── src/auth/sso/index.ts
├── src/auth/sso/oidc-provider.ts
├── src/auth/sso/saml-provider.ts
├── src/auth/sso/providers/okta.ts
├── src/auth/sso/providers/azure-ad.ts
├── src/auth/sso/providers/google.ts
├── src/auth/sso/providers/custom.ts
├── src/api/v1/auth/sso.ts
└── src/db/schema/sso-connections.ts
```

**Implementation:**
```typescript
// src/auth/sso/index.ts
export interface SSOConfig {
  enabled: boolean;
  providers: SSOProviderConfig[];
  defaultProvider?: string;
  allowLocalAuth: boolean;  // Allow username/password alongside SSO
  jitProvisioning: boolean; // Just-in-time user creation
  attributeMapping: AttributeMapping;
}

export interface SSOProviderConfig {
  id: string;
  type: 'oidc' | 'saml';
  name: string;
  enabled: boolean;

  // OIDC settings
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret: SecureString;
    scopes: string[];
    responseType: string;
    responseMode: string;
  };

  // SAML settings
  saml?: {
    entryPoint: string;
    issuer: string;
    cert: string;
    signatureAlgorithm: string;
    digestAlgorithm: string;
  };

  // Tenant mapping
  tenantMapping: 'domain' | 'claim' | 'static';
  tenantClaim?: string;
  staticTenantId?: string;
}

export interface AttributeMapping {
  userId: string;       // Default: 'sub' (OIDC) or 'nameID' (SAML)
  email: string;        // Default: 'email'
  name: string;         // Default: 'name'
  roles: string;        // Default: 'roles' or 'groups'
  tenantId?: string;
}

export class SSOManager {
  // Initialize SSO for tenant
  async configureTenantSSO(tenantId: string, config: SSOProviderConfig): Promise<void>;

  // Start SSO flow
  async initiateLogin(providerId: string, returnUrl: string): Promise<AuthorizationUrl>;

  // Handle callback
  async handleCallback(providerId: string, code: string, state: string): Promise<SSOResult>;

  // Validate SAML assertion
  async validateSAMLAssertion(assertion: string): Promise<SSOResult>;

  // Link existing user to SSO
  async linkUserToSSO(userId: string, providerId: string, externalId: string): Promise<void>;
}
```

#### TASK 2.2: Multi-Factor Authentication
**Priority:** CRITICAL (Business/Government) | **Effort:** 6 days

```
New files:
├── src/auth/mfa/index.ts
├── src/auth/mfa/totp.ts
├── src/auth/mfa/webauthn.ts
├── src/auth/mfa/sms.ts (optional, less secure)
├── src/auth/mfa/backup-codes.ts
├── src/api/v1/auth/mfa.ts
└── src/db/schema/mfa-credentials.ts
```

**Implementation:**
```typescript
// src/auth/mfa/index.ts
export interface MFAConfig {
  enabled: boolean;
  required: boolean;                    // Require for all users
  requiredForRoles: string[];          // Require for specific roles
  requiredForTrustLevels: number[];    // Require for trust levels
  allowedMethods: MFAMethod[];
  rememberDeviceDays: number;          // Default: 30
  maxBackupCodes: number;              // Default: 10
}

export type MFAMethod = 'totp' | 'webauthn' | 'sms' | 'email';

export interface MFAChallenge {
  challengeId: string;
  method: MFAMethod;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MFACredential {
  id: string;
  userId: string;
  method: MFAMethod;
  name: string;                        // User-friendly name
  createdAt: Date;
  lastUsedAt?: Date;

  // TOTP specific
  totpSecret?: string;                 // Encrypted

  // WebAuthn specific
  webauthnCredentialId?: string;
  webauthnPublicKey?: string;
  webauthnCounter?: number;
}

export class MFAManager {
  // Enroll new MFA method
  async beginEnrollment(userId: string, method: MFAMethod): Promise<EnrollmentChallenge>;
  async completeEnrollment(userId: string, challengeId: string, response: string): Promise<MFACredential>;

  // Generate backup codes
  async generateBackupCodes(userId: string): Promise<string[]>;

  // Verify MFA
  async createChallenge(userId: string, method?: MFAMethod): Promise<MFAChallenge>;
  async verifyChallenge(challengeId: string, response: string): Promise<boolean>;

  // Device remembering
  async rememberDevice(userId: string, deviceFingerprint: string): Promise<string>;
  async isDeviceRemembered(userId: string, deviceFingerprint: string): Promise<boolean>;

  // Recovery
  async useBackupCode(userId: string, code: string): Promise<boolean>;
}
```

#### TASK 2.3: CAC/PIV Smart Card Authentication
**Priority:** CRITICAL (Government) | **Effort:** 5 days

```
New files:
├── src/auth/pki/index.ts
├── src/auth/pki/certificate-validator.ts
├── src/auth/pki/cac-extractor.ts
├── src/auth/pki/ocsp-checker.ts
└── src/auth/pki/crl-manager.ts
```

**Implementation:**
```typescript
// src/auth/pki/index.ts
export interface PKIAuthConfig {
  enabled: boolean;
  requireClientCert: boolean;
  trustedCAs: string[];              // PEM-encoded CA certificates
  allowedOIDs: string[];             // Allowed certificate policy OIDs
  checkOCSP: boolean;
  checkCRL: boolean;
  crlUpdateInterval: number;         // Hours
  extractUserInfo: boolean;
  userInfoMapping: CertificateMapping;
}

export interface CertificateMapping {
  userId: string;                    // Default: 'subject.CN' or 'subject.UID'
  email: string;                     // Default: 'subject.emailAddress'
  agency: string;                    // Default: 'subject.O'
  clearanceLevel?: string;           // Extract from certificate extension
}

export interface CertificateValidationResult {
  valid: boolean;
  subject: CertificateSubject;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  serialNumber: string;
  fingerprint: string;
  ocspStatus?: 'good' | 'revoked' | 'unknown';
  crlStatus?: 'valid' | 'revoked' | 'unknown';
  errors: string[];
}

export class PKIAuthenticator {
  // Validate client certificate
  async validateCertificate(cert: X509Certificate): Promise<CertificateValidationResult>;

  // Extract user information from certificate
  extractUserInfo(cert: X509Certificate): CertificateUserInfo;

  // Check certificate revocation via OCSP
  async checkOCSP(cert: X509Certificate): Promise<OCSPResponse>;

  // Check certificate against CRL
  async checkCRL(cert: X509Certificate): Promise<CRLStatus>;

  // Middleware for mTLS authentication
  createMiddleware(): FastifyMiddleware;
}
```

#### TASK 2.4: Brute Force Protection
**Priority:** HIGH | **Effort:** 3 days

```
New files:
├── src/security/brute-force.ts
└── src/security/account-lockout.ts
```

**Implementation:**
```typescript
// src/security/brute-force.ts
export interface BruteForceConfig {
  maxAttempts: number;               // Default: 5
  windowMinutes: number;             // Default: 15
  lockoutMinutes: number;            // Default: 30
  progressiveLockout: boolean;       // Double lockout each time
  maxLockoutMinutes: number;         // Default: 1440 (24 hours)
  notifyOnLockout: boolean;
  captchaAfterAttempts: number;      // Default: 3
  ipRateLimiting: boolean;
  ipMaxAttempts: number;             // Default: 100 per hour
}

export interface LoginAttempt {
  userId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
  failureReason?: string;
}

export class BruteForceProtection {
  // Record login attempt
  async recordAttempt(attempt: LoginAttempt): Promise<void>;

  // Check if locked out
  async isLockedOut(userId: string): Promise<LockoutStatus>;
  async isIPBlocked(ip: string): Promise<boolean>;

  // Get remaining attempts
  async getRemainingAttempts(userId: string): Promise<number>;

  // Unlock account (admin action)
  async unlockAccount(userId: string, reason: string, adminId: string): Promise<void>;

  // Check if captcha required
  async requiresCaptcha(userId: string): Promise<boolean>;
}
```

#### TASK 2.5: Password Policy Engine
**Priority:** HIGH | **Effort:** 2 days

```
New file: src/security/password-policy.ts
```

**Implementation:**
```typescript
// src/security/password-policy.ts
export interface PasswordPolicy {
  minLength: number;                 // Default: 12
  maxLength: number;                 // Default: 128
  requireUppercase: boolean;         // Default: true
  requireLowercase: boolean;         // Default: true
  requireNumbers: boolean;           // Default: true
  requireSpecialChars: boolean;      // Default: true
  specialChars: string;              // Default: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  preventCommonPasswords: boolean;   // Default: true
  preventUserInfo: boolean;          // Default: true (no email/username in password)
  preventReuse: number;              // Default: 12 (last N passwords)
  maxAge: number;                    // Days, 0 = never expires
  minAge: number;                    // Days before can change again
  requireMFA: boolean;               // Require MFA for password changes
}

// Government-specific policies (NIST 800-63B)
export const NIST_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,                      // NIST: 8 minimum
  maxLength: 64,                     // NIST: At least 64
  requireUppercase: false,           // NIST: No composition rules
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialChars: false,
  preventCommonPasswords: true,      // NIST: Required
  preventUserInfo: true,             // NIST: Required
  preventReuse: 0,                   // NIST: Not recommended
  maxAge: 0,                         // NIST: No expiration
  minAge: 0,
  requireMFA: true,                  // NIST: Recommended
};

export class PasswordPolicyEngine {
  // Check password against policy
  validate(password: string, userInfo?: UserInfo): PasswordValidationResult;

  // Calculate password strength (0-100)
  calculateStrength(password: string): number;

  // Check against common password list (100k+ passwords)
  isCommonPassword(password: string): boolean;

  // Check password history
  async isReusedPassword(userId: string, password: string): Promise<boolean>;

  // Get policy for tenant/user
  getPolicy(tenantId: string, userId?: string): PasswordPolicy;
}
```

---

## TRACK 3: INFRASTRUCTURE & DEPLOYMENT

### Phase 3A: Container & Orchestration (Weeks 5-10)

#### TASK 3.1: Kubernetes Deployment
**Priority:** HIGH (Business/Government) | **Effort:** 6 days

```
New directory: deploy/kubernetes/
├── namespace.yaml
├── configmap.yaml
├── secrets.yaml (template)
├── deployment.yaml
├── service.yaml
├── ingress.yaml
├── hpa.yaml
├── pdb.yaml
├── network-policy.yaml
├── service-account.yaml
├── rbac.yaml
└── helm/
    └── vorion/
        ├── Chart.yaml
        ├── values.yaml
        ├── values-production.yaml
        ├── values-government.yaml
        └── templates/
```

**Implementation (deployment.yaml):**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion-api
  labels:
    app: vorion
    component: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: vorion
      component: api
  template:
    metadata:
      labels:
        app: vorion
        component: api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: vorion-api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: vorion
        image: vorion/api:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 9090
          name: metrics
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
              - ALL
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /readiness
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
        envFrom:
        - configMapRef:
            name: vorion-config
        - secretRef:
            name: vorion-secrets
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: data
          mountPath: /app/data
      volumes:
      - name: tmp
        emptyDir: {}
      - name: data
        persistentVolumeClaim:
          claimName: vorion-data
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: vorion
              topologyKey: kubernetes.io/hostname
```

**Network Policy:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vorion-api-policy
spec:
  podSelector:
    matchLabels:
      app: vorion
      component: api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    - podSelector:
        matchLabels:
          app: vorion
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
```

#### TASK 3.2: Air-Gapped Deployment Mode
**Priority:** CRITICAL (Government) | **Effort:** 5 days

```
New files:
├── src/deployment/air-gap.ts
├── deploy/air-gap/
│   ├── README.md
│   ├── offline-bundle.sh
│   ├── verify-bundle.sh
│   └── install.sh
```

**Implementation:**
```typescript
// src/deployment/air-gap.ts
export interface AirGapConfig {
  enabled: boolean;
  disableExternalConnections: boolean;
  disableTelemetry: boolean;
  disableUpdateChecks: boolean;
  localTimeSource: boolean;           // Use local NTP only
  offlineLicenseValidation: boolean;
  bundledDependencies: boolean;
}

export class AirGapMode {
  static enable(config: AirGapConfig): void {
    if (config.disableExternalConnections) {
      // Block all outbound HTTP requests
      http.globalAgent = new http.Agent({
        lookup: () => { throw new Error('External connections disabled in air-gap mode'); }
      });
      https.globalAgent = new https.Agent({
        lookup: () => { throw new Error('External connections disabled in air-gap mode'); }
      });
    }

    if (config.disableTelemetry) {
      // Disable any analytics/telemetry
      process.env.VORION_TELEMETRY_DISABLED = 'true';
    }

    if (config.localTimeSource) {
      // Use local time server only
      process.env.VORION_NTP_SERVERS = 'localhost';
    }
  }

  static verifyIsolation(): AirGapVerificationResult {
    // Attempt outbound connection to verify isolation
    // Should fail in properly configured air-gap
  }
}
```

**Offline Bundle Script:**
```bash
#!/bin/bash
# deploy/air-gap/offline-bundle.sh

set -e

VERSION=${1:-latest}
BUNDLE_DIR="vorion-air-gap-${VERSION}"

echo "Creating air-gapped deployment bundle for Vorion ${VERSION}..."

mkdir -p "${BUNDLE_DIR}"/{images,charts,config,scripts,checksums}

# Save Docker images
echo "Saving Docker images..."
docker pull vorion/api:${VERSION}
docker pull postgres:15-alpine
docker pull redis:7-alpine
docker save vorion/api:${VERSION} | gzip > "${BUNDLE_DIR}/images/vorion-api.tar.gz"
docker save postgres:15-alpine | gzip > "${BUNDLE_DIR}/images/postgres.tar.gz"
docker save redis:7-alpine | gzip > "${BUNDLE_DIR}/images/redis.tar.gz"

# Package Helm charts
echo "Packaging Helm charts..."
helm package deploy/kubernetes/helm/vorion -d "${BUNDLE_DIR}/charts/"

# Copy configuration templates
echo "Copying configuration templates..."
cp -r deploy/kubernetes/*.yaml "${BUNDLE_DIR}/config/"
cp -r deploy/air-gap/templates/* "${BUNDLE_DIR}/config/"

# Copy installation scripts
echo "Copying installation scripts..."
cp deploy/air-gap/install.sh "${BUNDLE_DIR}/scripts/"
cp deploy/air-gap/verify-bundle.sh "${BUNDLE_DIR}/scripts/"

# Generate checksums
echo "Generating checksums..."
find "${BUNDLE_DIR}" -type f -exec sha256sum {} \; > "${BUNDLE_DIR}/checksums/SHA256SUMS"

# Sign the bundle
echo "Signing bundle..."
gpg --armor --detach-sign "${BUNDLE_DIR}/checksums/SHA256SUMS"

# Create final archive
echo "Creating final archive..."
tar -czvf "vorion-air-gap-${VERSION}.tar.gz" "${BUNDLE_DIR}"

# Generate bundle checksum
sha256sum "vorion-air-gap-${VERSION}.tar.gz" > "vorion-air-gap-${VERSION}.tar.gz.sha256"

echo "Air-gapped bundle created: vorion-air-gap-${VERSION}.tar.gz"
```

#### TASK 3.3: Multi-Region Deployment
**Priority:** HIGH (Business/Government) | **Effort:** 4 days

```
New files:
├── src/deployment/multi-region.ts
├── deploy/terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── modules/
│   │   ├── region/
│   │   ├── database/
│   │   └── networking/
│   └── environments/
│       ├── production/
│       └── government/
```

**Implementation:**
```typescript
// src/deployment/multi-region.ts
export interface RegionConfig {
  id: string;
  name: string;
  endpoint: string;
  isPrimary: boolean;
  isReadReplica: boolean;
  dataResidency: string[];           // Allowed data residency (e.g., ['US', 'EU'])
  latencyZone: number;
}

export interface MultiRegionConfig {
  enabled: boolean;
  regions: RegionConfig[];
  failoverMode: 'automatic' | 'manual';
  syncMode: 'async' | 'sync';
  conflictResolution: 'last-write-wins' | 'custom';
  dataLocality: boolean;             // Keep user data in origin region
}

export class MultiRegionManager {
  // Route request to appropriate region
  async routeRequest(request: Request, userRegion: string): Promise<RegionConfig>;

  // Handle failover
  async initiateFailover(fromRegion: string, toRegion: string): Promise<void>;

  // Sync data between regions
  async syncData(sourceRegion: string, targetRegion: string): Promise<SyncResult>;

  // Check regional health
  async getRegionHealth(): Promise<RegionHealthStatus[]>;
}
```

#### TASK 3.4: Automated Backup & Recovery
**Priority:** HIGH | **Effort:** 3 days

```
New files:
├── src/ops/backup.ts
├── src/ops/restore.ts
├── src/cli/backup.ts
└── deploy/backup/
    ├── backup-cronjob.yaml
    └── backup-script.sh
```

**Implementation:**
```typescript
// src/ops/backup.ts
export interface BackupConfig {
  enabled: boolean;
  schedule: string;                  // Cron expression
  retention: {
    daily: number;                   // Days to keep daily backups
    weekly: number;                  // Weeks to keep weekly backups
    monthly: number;                 // Months to keep monthly backups
  };
  encryption: {
    enabled: boolean;
    keyId: string;                   // KMS key or local key ID
  };
  storage: {
    type: 's3' | 'gcs' | 'azure-blob' | 'local';
    bucket?: string;
    path: string;
  };
  components: {
    database: boolean;
    proofChain: boolean;
    configurations: boolean;
    secrets: boolean;                // Backup encrypted secrets
  };
}

export interface BackupManifest {
  id: string;
  timestamp: Date;
  version: string;
  components: string[];
  size: number;
  checksum: string;
  encrypted: boolean;
  metadata: Record<string, unknown>;
}

export class BackupManager {
  // Create full backup
  async createBackup(options?: Partial<BackupConfig>): Promise<BackupManifest>;

  // List available backups
  async listBackups(filter?: BackupFilter): Promise<BackupManifest[]>;

  // Restore from backup
  async restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult>;

  // Verify backup integrity
  async verifyBackup(backupId: string): Promise<VerificationResult>;

  // Test restore (non-destructive)
  async testRestore(backupId: string): Promise<TestRestoreResult>;
}
```

---

## TRACK 4: COMPLIANCE & CERTIFICATION

### Phase 4A: Audit & Logging (Weeks 7-12)

#### TASK 4.1: SIEM Integration
**Priority:** HIGH (Business/Government) | **Effort:** 5 days

```
New files:
├── src/audit/siem/index.ts
├── src/audit/siem/splunk.ts
├── src/audit/siem/elastic.ts
├── src/audit/siem/azure-sentinel.ts
├── src/audit/siem/cloudwatch.ts
└── src/audit/event-schema.ts
```

**Implementation:**
```typescript
// src/audit/siem/index.ts
export interface SIEMConfig {
  enabled: boolean;
  provider: 'splunk' | 'elastic' | 'azure-sentinel' | 'cloudwatch' | 'custom';
  endpoint: string;
  authentication: {
    type: 'api-key' | 'bearer' | 'basic' | 'iam';
    credentials: SecureString;
  };
  batchSize: number;                 // Events per batch
  flushInterval: number;             // Milliseconds
  retryAttempts: number;
  eventTypes: string[];              // Filter which events to send
  enrichment: EventEnrichmentConfig;
}

export interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  category: 'authentication' | 'authorization' | 'data-access' | 'configuration' | 'system';
  severity: 'info' | 'warning' | 'error' | 'critical';
  actor: {
    userId?: string;
    tenantId?: string;
    ipAddress: string;
    userAgent: string;
    sessionId?: string;
  };
  resource: {
    type: string;
    id: string;
    name?: string;
  };
  action: string;
  outcome: 'success' | 'failure' | 'unknown';
  details: Record<string, unknown>;
  metadata: {
    requestId: string;
    traceId?: string;
    spanId?: string;
  };
}

export type AuditEventType =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_LOGIN_FAILED'
  | 'MFA_CHALLENGE'
  | 'MFA_SUCCESS'
  | 'MFA_FAILURE'
  | 'PASSWORD_CHANGE'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_ACCESS'
  | 'RESOURCE_CREATE'
  | 'RESOURCE_UPDATE'
  | 'RESOURCE_DELETE'
  | 'CONFIG_CHANGE'
  | 'KEY_ROTATION'
  | 'CERTIFICATE_EXPIRY'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INJECTION_ATTEMPT'
  | 'ANOMALY_DETECTED'
  | 'ESCALATION_CREATED'
  | 'ESCALATION_RESOLVED'
  | 'PROOF_CREATED'
  | 'PROOF_VERIFIED'
  | 'CHAIN_INTEGRITY_CHECK'
  | 'TRUST_SCORE_CHANGE'
  | 'POLICY_EVALUATION'
  | 'SYSTEM_STARTUP'
  | 'SYSTEM_SHUTDOWN'
  | 'BACKUP_CREATED'
  | 'BACKUP_RESTORED';

export class SIEMConnector {
  async sendEvent(event: AuditEvent): Promise<void>;
  async sendBatch(events: AuditEvent[]): Promise<BatchResult>;
  async testConnection(): Promise<boolean>;
  getStats(): SIEMStats;
}
```

#### TASK 4.2: Compliance Reporting
**Priority:** HIGH (Government) | **Effort:** 4 days

```
New files:
├── src/compliance/index.ts
├── src/compliance/frameworks/
│   ├── fedramp.ts
│   ├── fisma.ts
│   ├── nist-800-53.ts
│   ├── soc2.ts
│   └── iso27001.ts
├── src/compliance/reports.ts
└── src/api/v1/compliance.ts
```

**Implementation:**
```typescript
// src/compliance/index.ts
export interface ComplianceFramework {
  id: string;
  name: string;
  version: string;
  controls: ComplianceControl[];
}

export interface ComplianceControl {
  id: string;                        // e.g., 'AC-2' for NIST 800-53
  name: string;
  description: string;
  family: string;
  priority: 'P1' | 'P2' | 'P3';
  implementation: ImplementationStatus;
  evidence: Evidence[];
  testProcedure: string;
  automatedTest?: () => Promise<boolean>;
}

export type ImplementationStatus =
  | 'implemented'
  | 'partially-implemented'
  | 'planned'
  | 'not-applicable'
  | 'alternative';

export interface ComplianceReport {
  framework: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: {
    totalControls: number;
    implemented: number;
    partiallyImplemented: number;
    planned: number;
    notApplicable: number;
  };
  controls: ControlAssessment[];
  findings: Finding[];
  recommendations: string[];
}

export class ComplianceEngine {
  // Run compliance assessment
  async assess(framework: string): Promise<ComplianceReport>;

  // Generate compliance report
  async generateReport(framework: string, format: 'pdf' | 'json' | 'csv'): Promise<Buffer>;

  // Get continuous monitoring status
  async getContinuousMonitoringStatus(): Promise<MonitoringStatus>;

  // Map controls between frameworks
  mapControl(controlId: string, fromFramework: string, toFramework: string): string[];
}
```

#### TASK 4.3: Security Assessment Documentation
**Priority:** CRITICAL (Government) | **Effort:** 10 days

```
New directory: docs/security-assessment/
├── system-security-plan.md
├── security-assessment-report.md
├── plan-of-action-milestones.md
├── continuous-monitoring-plan.md
├── incident-response-plan.md
├── configuration-management-plan.md
├── access-control-policy.md
├── audit-logging-policy.md
├── data-protection-policy.md
├── vulnerability-management-plan.md
├── privacy-impact-assessment.md
├── interconnection-security-agreement.md
└── templates/
    ├── ato-package/
    ├── poam-template.md
    └── control-implementation.md
```

---

### Phase 4B: Certification Preparation (Weeks 13-20)

#### TASK 4.4: Penetration Testing Framework
**Priority:** CRITICAL | **Effort:** 5 days (setup) + external engagement

```
New files:
├── src/security/pentest-support.ts
├── tests/security/
│   ├── owasp-top10.test.ts
│   ├── injection.test.ts
│   ├── authentication.test.ts
│   ├── authorization.test.ts
│   ├── cryptography.test.ts
│   └── session.test.ts
```

**Implementation:**
```typescript
// src/security/pentest-support.ts
export interface PentestConfig {
  enabled: boolean;                  // Only in staging/pentest environments
  allowedIPs: string[];             // Pentester IP addresses
  rateLimit: number;                // Higher limit for pentesters
  logLevel: 'verbose';              // Full logging for analysis
  disabledProtections: string[];    // Temporarily disable for testing
}

export class PentestSupport {
  // Enable pentest mode for specific IP
  async enablePentestMode(config: PentestConfig): Promise<void>;

  // Generate test data/accounts
  async createTestEnvironment(): Promise<TestEnvironment>;

  // Export relevant logs for analysis
  async exportLogs(startTime: Date, endTime: Date): Promise<LogExport>;

  // Verify all protections re-enabled after testing
  async verifySecurityPosture(): Promise<SecurityPostureReport>;
}
```

**Security Test Suite:**
```typescript
// tests/security/owasp-top10.test.ts
describe('OWASP Top 10 Security Tests', () => {
  describe('A01:2021 - Broken Access Control', () => {
    it('should prevent IDOR attacks', async () => {
      // Create resources as user A
      const resourceA = await createResource(userA.token);

      // Attempt to access as user B
      const response = await fetch(`/api/v1/resources/${resourceA.id}`, {
        headers: { Authorization: `Bearer ${userB.token}` }
      });

      expect(response.status).toBe(403);
    });

    it('should prevent privilege escalation', async () => {
      // Attempt to access admin endpoint as regular user
      const response = await fetch('/api/v1/admin/users', {
        headers: { Authorization: `Bearer ${regularUser.token}` }
      });

      expect(response.status).toBe(403);
    });
  });

  describe('A02:2021 - Cryptographic Failures', () => {
    it('should not expose sensitive data in responses', async () => {
      const user = await createUser({ password: 'secret123' });
      const response = await getUser(user.id);

      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('should use strong encryption for stored data', async () => {
      const encrypted = await encrypt('sensitive data');

      expect(encrypted.envelope.version).toBe(1);
      expect(encrypted.envelope.kdfVersion).toBe(2);
    });
  });

  describe('A03:2021 - Injection', () => {
    const injectionPayloads = [
      "'; DROP TABLE users; --",
      "<script>alert('xss')</script>",
      "{{constructor.constructor('return process')().exit()}}",
      "| cat /etc/passwd",
    ];

    injectionPayloads.forEach(payload => {
      it(`should reject injection payload: ${payload.slice(0, 20)}...`, async () => {
        const response = await createIntent({
          goal: payload,
          context: { data: payload }
        });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INJECTION_DETECTED');
      });
    });
  });

  // ... A04-A10 tests
});
```

#### TASK 4.5: Vulnerability Scanning Integration
**Priority:** HIGH | **Effort:** 3 days

```
New files:
├── src/security/vulnerability-scanner.ts
├── .github/workflows/security-scan.yml
└── scripts/run-security-scan.sh
```

**Implementation:**
```yaml
# .github/workflows/security-scan.yml
name: Security Scanning

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight

jobs:
  dependency-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=high

      - name: Run Snyk
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: 'vorion'
          path: '.'
          format: 'HTML'
          args: >
            --failOnCVSS 7
            --enableExperimental

  sast-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Semgrep
        uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/typescript
            p/owasp-top-ten

      - name: Run CodeQL
        uses: github/codeql-action/analyze@v2
        with:
          languages: typescript

  container-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t vorion:scan .

      - name: Run Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'vorion:scan'
          format: 'sarif'
          severity: 'CRITICAL,HIGH'

  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## TRACK 5: MONITORING & RESPONSE

### Phase 5A: Real-Time Security Monitoring (Weeks 9-16)

#### TASK 5.1: Anomaly Detection Engine
**Priority:** HIGH | **Effort:** 6 days

```
New files:
├── src/security/anomaly/index.ts
├── src/security/anomaly/detectors/
│   ├── behavioral.ts
│   ├── geographic.ts
│   ├── temporal.ts
│   └── volume.ts
├── src/security/anomaly/ml-model.ts
└── src/security/anomaly/alerts.ts
```

**Implementation:**
```typescript
// src/security/anomaly/index.ts
export interface AnomalyConfig {
  enabled: boolean;
  detectors: DetectorConfig[];
  alertThreshold: number;            // 0-100, default 80
  learningPeriod: number;            // Days to establish baseline
  autoBlock: boolean;                // Auto-block on high severity
  autoBlockThreshold: number;        // Severity threshold for auto-block
}

export interface Anomaly {
  id: string;
  timestamp: Date;
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;                // 0-100
  actor: ActorInfo;
  description: string;
  indicators: Indicator[];
  suggestedActions: string[];
  relatedEvents: string[];
}

export type AnomalyType =
  | 'impossible-travel'              // Login from geographically impossible locations
  | 'unusual-time'                   // Activity outside normal hours
  | 'volume-spike'                   // Unusual request volume
  | 'new-device'                     // Login from new device
  | 'failed-auth-spike'              // Multiple failed logins
  | 'privilege-probe'                // Attempts to access unauthorized resources
  | 'data-exfiltration'              // Large data downloads
  | 'api-abuse'                      // Unusual API patterns
  | 'credential-stuffing'            // Bot-like authentication attempts
  | 'session-hijack-attempt';        // Session anomalies

export class AnomalyDetector {
  // Process event and check for anomalies
  async processEvent(event: AuditEvent): Promise<Anomaly[]>;

  // Get current threat level
  async getThreatLevel(): Promise<ThreatLevel>;

  // Get recent anomalies
  async getAnomalies(filter: AnomalyFilter): Promise<Anomaly[]>;

  // Train/update baseline
  async updateBaseline(events: AuditEvent[]): Promise<void>;

  // Block actor
  async blockActor(actorId: string, duration: number, reason: string): Promise<void>;
}
```

**Impossible Travel Detection:**
```typescript
// src/security/anomaly/detectors/geographic.ts
export class ImpossibleTravelDetector {
  // Maximum speed in km/h (faster than any commercial flight)
  private maxSpeedKmH = 1200;

  async detect(currentEvent: AuthEvent, history: AuthEvent[]): Promise<Anomaly | null> {
    const lastEvent = history[history.length - 1];
    if (!lastEvent) return null;

    const timeDiffHours = (currentEvent.timestamp - lastEvent.timestamp) / (1000 * 60 * 60);
    const distanceKm = this.calculateDistance(
      lastEvent.location,
      currentEvent.location
    );

    const requiredSpeedKmH = distanceKm / timeDiffHours;

    if (requiredSpeedKmH > this.maxSpeedKmH) {
      return {
        type: 'impossible-travel',
        severity: requiredSpeedKmH > 5000 ? 'critical' : 'high',
        confidence: Math.min(100, (requiredSpeedKmH / this.maxSpeedKmH) * 50),
        description: `Login detected from ${currentEvent.location.city} ` +
          `only ${timeDiffHours.toFixed(1)} hours after login from ${lastEvent.location.city}. ` +
          `This would require traveling at ${requiredSpeedKmH.toFixed(0)} km/h.`,
        indicators: [
          { type: 'distance', value: distanceKm },
          { type: 'time_diff_hours', value: timeDiffHours },
          { type: 'required_speed', value: requiredSpeedKmH },
        ],
        suggestedActions: [
          'Verify user identity through secondary channel',
          'Review recent account activity',
          'Consider requiring MFA re-verification',
        ],
      };
    }

    return null;
  }

  private calculateDistance(loc1: Location, loc2: Location): number {
    // Haversine formula implementation
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(loc2.lat - loc1.lat);
    const dLon = this.toRad(loc2.lon - loc1.lon);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRad(loc1.lat)) * Math.cos(this.toRad(loc2.lat)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
```

#### TASK 5.2: Incident Response System
**Priority:** HIGH | **Effort:** 5 days

```
New files:
├── src/security/incident/index.ts
├── src/security/incident/playbooks/
│   ├── data-breach.ts
│   ├── account-compromise.ts
│   ├── ddos.ts
│   └── insider-threat.ts
├── src/security/incident/notification.ts
└── src/api/v1/incidents.ts
```

**Implementation:**
```typescript
// src/security/incident/index.ts
export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'detected' | 'investigating' | 'contained' | 'eradicated' | 'recovered' | 'closed';
  type: IncidentType;
  detectedAt: Date;
  acknowledgedAt?: Date;
  containedAt?: Date;
  resolvedAt?: Date;
  assignee?: string;
  affectedResources: string[];
  timeline: TimelineEntry[];
  evidence: Evidence[];
  playbook?: string;
  rootCause?: string;
  remediation?: string;
  lessonsLearned?: string;
}

export type IncidentType =
  | 'data-breach'
  | 'account-compromise'
  | 'unauthorized-access'
  | 'malware'
  | 'ddos'
  | 'insider-threat'
  | 'policy-violation'
  | 'service-disruption';

export interface Playbook {
  id: string;
  name: string;
  triggerConditions: TriggerCondition[];
  steps: PlaybookStep[];
  notifications: NotificationConfig[];
  escalation: EscalationConfig;
}

export interface PlaybookStep {
  id: string;
  name: string;
  type: 'manual' | 'automated';
  description: string;
  action?: () => Promise<void>;      // Automated action
  timeout?: number;                   // Minutes
  requiresApproval?: boolean;
  approvers?: string[];
}

export class IncidentManager {
  // Create new incident
  async createIncident(data: CreateIncidentInput): Promise<Incident>;

  // Update incident status
  async updateStatus(incidentId: string, status: IncidentStatus): Promise<void>;

  // Execute playbook
  async executePlaybook(incidentId: string, playbookId: string): Promise<PlaybookExecution>;

  // Add evidence
  async addEvidence(incidentId: string, evidence: Evidence): Promise<void>;

  // Generate incident report
  async generateReport(incidentId: string): Promise<IncidentReport>;

  // Auto-detect and create incidents from anomalies
  async processAnomaly(anomaly: Anomaly): Promise<Incident | null>;
}
```

**Data Breach Playbook:**
```typescript
// src/security/incident/playbooks/data-breach.ts
export const DATA_BREACH_PLAYBOOK: Playbook = {
  id: 'data-breach-response',
  name: 'Data Breach Response',
  triggerConditions: [
    { type: 'anomaly', anomalyType: 'data-exfiltration', minSeverity: 'high' },
    { type: 'manual', roles: ['security-admin', 'incident-responder'] },
  ],
  steps: [
    {
      id: 'contain-1',
      name: 'Isolate Affected Systems',
      type: 'automated',
      description: 'Disable network access for affected resources',
      action: async () => {
        // Implement network isolation
      },
      timeout: 5,
    },
    {
      id: 'contain-2',
      name: 'Revoke Compromised Credentials',
      type: 'automated',
      description: 'Revoke all sessions and API keys for affected users',
      action: async () => {
        // Implement credential revocation
      },
      timeout: 5,
    },
    {
      id: 'assess-1',
      name: 'Determine Scope of Breach',
      type: 'manual',
      description: 'Analyze logs to determine what data was accessed',
      timeout: 60,
    },
    {
      id: 'notify-1',
      name: 'Notify Legal/Compliance Team',
      type: 'automated',
      action: async () => {
        // Send notification to legal team
      },
      timeout: 5,
    },
    {
      id: 'notify-2',
      name: 'Determine Notification Requirements',
      type: 'manual',
      description: 'Assess regulatory notification requirements (GDPR, CCPA, etc.)',
      timeout: 120,
      requiresApproval: true,
      approvers: ['legal', 'ciso'],
    },
    // ... more steps
  ],
  notifications: [
    { channel: 'slack', target: '#security-incidents', onTrigger: true },
    { channel: 'email', target: 'security@company.com', onTrigger: true },
    { channel: 'pagerduty', target: 'security-oncall', severity: ['P1', 'P2'] },
  ],
  escalation: {
    timeoutMinutes: 30,
    escalateTo: ['ciso', 'cto'],
    notifyExecutive: true,
  },
};
```

#### TASK 5.3: Security Dashboard
**Priority:** MEDIUM | **Effort:** 8 days

```
New files:
├── src/api/v1/security-dashboard.ts
├── apps/admin-dashboard/
│   ├── src/pages/security/
│   │   ├── overview.tsx
│   │   ├── threats.tsx
│   │   ├── incidents.tsx
│   │   ├── compliance.tsx
│   │   └── audit-logs.tsx
│   └── src/components/security/
│       ├── ThreatMap.tsx
│       ├── SecurityScoreCard.tsx
│       ├── IncidentTimeline.tsx
│       └── ComplianceMatrix.tsx
```

**API Implementation:**
```typescript
// src/api/v1/security-dashboard.ts
export interface SecurityDashboardData {
  overview: {
    securityScore: number;           // 0-100
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
    activeIncidents: number;
    openVulnerabilities: number;
    complianceStatus: ComplianceStatus;
  };
  threats: {
    recentAnomalies: Anomaly[];
    blockedActors: BlockedActor[];
    failedAuthAttempts: number;
    injectionAttempts: number;
  };
  trends: {
    authSuccessRate: TimeSeries;
    requestVolume: TimeSeries;
    errorRate: TimeSeries;
    anomalyCount: TimeSeries;
  };
  compliance: {
    frameworks: FrameworkStatus[];
    upcomingAudits: Audit[];
    recentFindings: Finding[];
  };
}

router.get('/security/dashboard',
  requireRole('security-admin', 'admin'),
  async (request, reply) => {
    const data = await securityDashboardService.getDashboardData();
    return reply.send(data);
  }
);
```

---

## IMPLEMENTATION SCHEDULE

### Week-by-Week Breakdown

```
WEEK 1:  [TRACK 1] Tasks 1.1-1.2 (Dev bypasses, Session revocation)
WEEK 2:  [TRACK 1] Tasks 1.3-1.4 (CSRF, Config validator)
WEEK 3:  [TRACK 1] Task 1.5 + [TRACK 2] Task 2.1 start (Injection, SSO)
WEEK 4:  [TRACK 1] Tasks 1.6-1.7 + [TRACK 2] Task 2.1 cont.
         ◆ MILESTONE: Personal 100%
WEEK 5:  [TRACK 1] Task 1.8 + [TRACK 2] Task 2.2 + [TRACK 3] Task 3.1 start
WEEK 6:  [TRACK 1] Tasks 1.9-1.10 + [TRACK 2] Task 2.2 cont.
WEEK 7:  [TRACK 2] Task 2.3 + [TRACK 3] Task 3.1 cont. + [TRACK 4] Task 4.1
WEEK 8:  [TRACK 2] Tasks 2.4-2.5 + [TRACK 3] Task 3.1 complete
WEEK 9:  [TRACK 3] Task 3.2 + [TRACK 4] Task 4.1 cont. + [TRACK 5] Task 5.1
WEEK 10: [TRACK 3] Tasks 3.3-3.4 + [TRACK 4] Task 4.2
WEEK 11: [TRACK 4] Task 4.2 cont. + [TRACK 5] Task 5.1 cont.
WEEK 12: [TRACK 4] Task 4.3 start + [TRACK 5] Task 5.2
         ◆ MILESTONE: Business 100%
WEEK 13: [TRACK 4] Task 4.3 cont. + [TRACK 5] Task 5.2 cont.
WEEK 14: [TRACK 4] Tasks 4.3-4.4 + [TRACK 5] Task 5.3 start
WEEK 15: [TRACK 4] Task 4.4 cont. + [TRACK 5] Task 5.3 cont.
WEEK 16: [TRACK 4] Task 4.5 + [TRACK 5] Task 5.3 complete
WEEK 17: External penetration testing engagement
WEEK 18: Penetration test remediation
WEEK 19: 3PAO assessment preparation
WEEK 20: 3PAO assessment
         ◆ MILESTONE: Government 95%
WEEK 21: Assessment finding remediation
WEEK 22: Documentation finalization
WEEK 23: Final security review
WEEK 24: Certification submission
WEEK 25: Certification review period
WEEK 26: Certification approval
         ◆ MILESTONE: Government 100%
```

---

## SUCCESS METRICS

### Security Posture Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Security Score | ~75 | 95+ | Automated assessment |
| Critical Vulnerabilities | Unknown | 0 | Continuous scanning |
| High Vulnerabilities | Unknown | 0 | Continuous scanning |
| Mean Time to Detect (MTTD) | Unknown | <1 hour | Monitoring system |
| Mean Time to Respond (MTTR) | Unknown | <4 hours | Incident tracking |
| Patch Compliance | Unknown | 100% | 48hr critical, 7d high |
| Code Coverage (Security Tests) | ~40% | 90%+ | Test coverage report |
| Authentication Success Rate | Unknown | >99.9% | Metrics |
| Failed Login Attempts Blocked | Unknown | 100% | Rate limiting |

### Compliance Metrics

| Framework | Current | Target | Timeline |
|-----------|---------|--------|----------|
| SOC 2 Type II | Not started | Certified | Month 4 |
| ISO 27001 | Not started | Certified | Month 5 |
| FedRAMP Ready | Not started | Assessment | Month 5 |
| FedRAMP Moderate | Not started | Authorized | Month 8 |
| FISMA High | Not started | Compliant | Month 10 |

### Deployment Readiness Metrics

| Use Case | Current | Week 4 | Week 12 | Week 26 |
|----------|---------|--------|---------|---------|
| Personal | 85% | 100% | 100% | 100% |
| Business | 72% | 85% | 100% | 100% |
| Government | 55% | 65% | 85% | 100% |

---

## RESOURCE REQUIREMENTS

### Team Composition

| Role | FTE | Duration | Responsibilities |
|------|-----|----------|------------------|
| Security Engineer (Lead) | 1.0 | 26 weeks | Architecture, cryptography, HSM |
| Security Engineer | 1.0 | 26 weeks | Authentication, identity, monitoring |
| Backend Engineer | 1.0 | 20 weeks | API hardening, infrastructure |
| DevOps Engineer | 0.5 | 16 weeks | Kubernetes, CI/CD, deployment |
| Compliance Specialist | 0.5 | 20 weeks | Documentation, audit prep |
| QA Engineer (Security) | 0.5 | 16 weeks | Security testing, penetration support |

### External Resources

| Resource | Cost Estimate | Timeline |
|----------|---------------|----------|
| Penetration Testing (3PAO) | $50-100K | Weeks 17-18 |
| SOC 2 Type II Audit | $30-50K | Months 3-4 |
| FedRAMP 3PAO Assessment | $150-300K | Months 5-8 |
| HSM Infrastructure (AWS CloudHSM) | $1.5K/month | Ongoing |
| Security Scanning Tools (Snyk, etc.) | $500-2K/month | Ongoing |

### Infrastructure

| Component | Specification | Purpose |
|-----------|---------------|---------|
| HSM Cluster | AWS CloudHSM (2 nodes) | Government key management |
| Redis Cluster | 3-node Sentinel | Distributed locking, sessions |
| PostgreSQL HA | Primary + 2 replicas | Data durability |
| Kubernetes Cluster | 5+ nodes, multi-AZ | Production deployment |
| SIEM | Splunk/Elastic Cloud | Log aggregation, monitoring |

---

## RISK MITIGATION

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| HSM integration complexity | High | Start POC early (Week 5), have software fallback |
| FIPS certification delays | High | Use pre-certified modules, engage early with vendors |
| Pentest finds critical issues | High | Internal security testing first, remediation buffer |
| Performance impact of security | Medium | Load testing, caching strategies |

### Schedule Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep | High | Strict change control, phased delivery |
| Resource availability | Medium | Cross-training, documentation |
| External dependency delays | Medium | Parallel workstreams, early engagement |

### Compliance Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Audit finding surprises | High | Pre-assessment, continuous monitoring |
| Documentation gaps | Medium | Dedicated compliance specialist |
| Control implementation gaps | Medium | Regular compliance checks |

---

## DEFINITION OF DONE

### Personal Deployment (100%)
- [ ] One-command installation
- [ ] Auto-HTTPS with Let's Encrypt
- [ ] Secure by default configuration
- [ ] No external dependencies required (SQLite mode)
- [ ] < 5 minute setup time
- [ ] Self-contained Docker image

### Business Deployment (100%)
- [ ] SSO/OIDC integration working
- [ ] MFA enforcement available
- [ ] Per-tenant rate limiting
- [ ] Kubernetes-ready deployment
- [ ] SOC 2 Type II compliant
- [ ] 99.9% availability architecture
- [ ] Admin dashboard functional
- [ ] Automated backup/restore

### Government Deployment (100%)
- [ ] FIPS 140-2 validated cryptography
- [ ] HSM integration working
- [ ] CAC/PIV authentication working
- [ ] Air-gapped deployment mode
- [ ] FedRAMP Moderate authorized
- [ ] FISMA High compliant
- [ ] Full SA&A documentation package
- [ ] Continuous monitoring operational
- [ ] Incident response playbooks active

---

## APPENDIX: QUICK WINS (Can Start Immediately)

These items can be implemented in parallel with the main roadmap:

1. **Add security.txt** (1 hour)
   ```
   /.well-known/security.txt
   Contact: security@vorion.ai
   Preferred-Languages: en
   Policy: https://vorion.ai/security-policy
   ```

2. **Enable CSP reporting** (2 hours)
   ```typescript
   helmet({
     contentSecurityPolicy: {
       directives: {
         ...defaultDirectives,
         reportUri: '/api/v1/csp-report',
       },
     },
   })
   ```

3. **Add rate limit headers** (1 hour) - Already implemented, verify in production

4. **Create security checklist for deployment** (4 hours) - Document all required env vars

5. **Set up Dependabot** (1 hour) - Automatic dependency updates

6. **Add git hooks for secret scanning** (2 hours) - Prevent accidental commits

---

*This game plan represents a comprehensive path to achieving impenetrable security across all deployment scenarios. Regular reviews and adjustments should be made as the implementation progresses.*
