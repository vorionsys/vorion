# ORANGE TEAM Security Training Analysis Report

**Classification:** INTERNAL - DEVELOPER EDUCATION
**Assessment Date:** 2026-02-03
**Assessment Team:** Orange Team (Security Education)
**Target:** Vorion Platform Development Team
**Scope:** Security Training Based on Red Team Findings

---

## Executive Summary

This Orange Team report transforms Red Team attack findings and Purple Team gap analysis into actionable security education for the Vorion development team. The goal is to build a security-aware engineering culture that prevents vulnerabilities before they reach production.

### Training Priorities (Based on Red Team Findings)

| Priority | Topic | Source Findings | Developer Impact |
|----------|-------|-----------------|------------------|
| CRITICAL | Cryptographic Implementation | CRIT-001, CRIT-005, CRIT-006 | All developers handling sensitive data |
| HIGH | Input Validation & Sanitization | HIGH-011, MED-009 | All developers |
| HIGH | Authentication & Identity | CRIT-002, CRIT-003, HIGH-009 | Auth team, API developers |
| HIGH | Race Conditions & Timing | CRIT-004, HIGH-008 | Distributed systems developers |
| MEDIUM | Memory Security | CRIT-007 | Core security team |
| MEDIUM | Error Handling | MED-006, LOW-001 | All developers |

---

## 1. Security Training Curriculum

### 1.1 Core Security Foundations (Required for All Developers)

#### Module 1: Cryptography Fundamentals (4 hours)

**Lesson 1.1: Why Cryptographic Primitives Matter**

*Learning from CRIT-001: Weak Cryptographic Primitives*

The Red Team discovered that critical security operations used fundamentally weak cryptographic approaches:

```typescript
// ANTI-PATTERN: What was found (DO NOT USE)
// XOR is NOT encryption - trivially reversible
for (let i = 0; i < chunk.length; i++) {
  encrypted[i] = chunk[i] ^ keyStream[i % keyStream.length];
}
```

**Why this is dangerous:**
- XOR with a repeating key can be trivially reversed
- An attacker with access to encrypted data can decrypt without any keys
- This provides no security against any threat model

```typescript
// SECURE PATTERN: Proper encryption
import { createCipheriv, randomBytes } from 'crypto';

function encryptData(plaintext: Buffer, key: Buffer): EncryptedData {
  // Generate unique IV for each encryption
  const iv = randomBytes(12); // 96-bit IV for GCM

  // Use AES-256-GCM - authenticated encryption
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
}
```

**Key Takeaways:**
1. Always use authenticated encryption (AES-GCM, ChaCha20-Poly1305)
2. Never roll your own cryptography
3. Generate fresh IVs for every encryption operation
4. Verify authentication tags before decryption

---

**Lesson 1.2: Hash Functions - When Security Matters**

*Learning from CRIT-006: Non-Cryptographic Hash*

```typescript
// ANTI-PATTERN: Simple hash with collision vulnerability
private hashData(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
```

**Why this is dangerous:**
- 32-bit output space = ~65K attempts for birthday collision
- Predictable, deterministic algorithm allows precomputation
- No cryptographic security guarantees

```typescript
// SECURE PATTERN: Cryptographic hashing
import { createHash } from 'crypto';

function secureHash(data: string | Buffer): string {
  return createHash('sha256')
    .update(data)
    .digest('hex');
}

// For password hashing, use dedicated algorithms
import { hash, verify } from 'argon2';

async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    type: 2, // Argon2id
    memoryCost: 65536,  // 64 MB
    timeCost: 3,
    parallelism: 4
  });
}
```

**Hash Function Selection Guide:**

| Use Case | Recommended Algorithm | NOT To Use |
|----------|----------------------|------------|
| General integrity | SHA-256, SHA-3 | MD5, SHA-1, custom |
| Password storage | Argon2id, bcrypt, scrypt | SHA-256, PBKDF2 (weak) |
| HMAC | HMAC-SHA-256 | Custom MAC |
| Short hash (non-security) | xxHash, MurmurHash | For security purposes |

---

**Lesson 1.3: Digital Signatures - Proving Authenticity**

*Learning from CRIT-005: Self-Signed Hash Signatures*

```typescript
// ANTI-PATTERN: Hash is NOT a signature
private signAnchor(anchorId, hash, owner): string {
  // This is NOT signing - anyone can compute this
  const signatureData = `${anchorId}:${hash}:${owner}`;
  return createHash('sha256').update(signatureData).digest('hex');
}
```

**Why this is dangerous:**
- Hashing provides integrity, NOT authenticity
- Anyone can compute the same hash
- No proof that a specific party created the data

```typescript
// SECURE PATTERN: Asymmetric digital signatures
import { generateKeyPairSync, sign, verify } from 'crypto';

// Key generation (do once, store securely)
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

// Signing (requires private key)
function signData(data: Buffer, privateKey: KeyObject): Buffer {
  return sign(null, data, privateKey);
}

// Verification (requires only public key)
function verifySignature(
  data: Buffer,
  signature: Buffer,
  publicKey: KeyObject
): boolean {
  return verify(null, data, publicKey, signature);
}
```

**Signature vs Hash:**

| Property | Hash | Signature |
|----------|------|-----------|
| Anyone can compute | Yes | No (needs private key) |
| Proves integrity | Yes | Yes |
| Proves authenticity | No | Yes |
| Non-repudiation | No | Yes |

---

**Lesson 1.4: Key Derivation Functions**

*Learning from CRIT-001: Weak Key Derivation*

```typescript
// ANTI-PATTERN: Linear key derivation
derived[i] = (masterKey[i] + shardIndex * 17 + i * 23) & 0xFF;
```

**Why this is dangerous:**
- Predictable derivation allows key reconstruction
- No computational hardness against brute force
- Magic numbers (17, 23) provide no security

```typescript
// SECURE PATTERN: HKDF for key derivation
import { hkdf } from 'crypto';

async function deriveKey(
  masterKey: Buffer,
  salt: Buffer,
  info: string,
  keyLength: number = 32
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    hkdf(
      'sha256',
      masterKey,
      salt,
      Buffer.from(info, 'utf8'),
      keyLength,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(Buffer.from(derivedKey));
      }
    );
  });
}

// Usage: Derive different keys for different purposes
const encryptionKey = await deriveKey(masterKey, salt, 'encryption');
const hmacKey = await deriveKey(masterKey, salt, 'hmac');
const signingKey = await deriveKey(masterKey, salt, 'signing');
```

---

#### Module 2: Input Validation & Injection Prevention (3 hours)

**Lesson 2.1: Regular Expression Denial of Service (ReDoS)**

*Learning from HIGH-011: Regex Without Sanitization*

```typescript
// ANTI-PATTERN: Vulnerable regex pattern
const userPattern = new RegExp(userInput);
const result = userPattern.test(targetString);
```

**Why this is dangerous:**
- Malicious patterns can cause catastrophic backtracking
- O(2^n) time complexity with crafted input
- Can freeze application threads

```typescript
// SECURE PATTERN: Safe regex handling
import RE2 from 're2';

// Option 1: Use RE2 (no backtracking)
function safePatternMatch(pattern: string, input: string): boolean {
  try {
    const safeRegex = new RE2(pattern, { timeout: 1000 });
    return safeRegex.test(input);
  } catch (error) {
    // Invalid pattern
    return false;
  }
}

// Option 2: Timeout wrapper for native regex
function regexWithTimeout(
  pattern: RegExp,
  input: string,
  timeoutMs: number = 100
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Regex timeout - possible ReDoS'));
    }, timeoutMs);

    try {
      const result = pattern.test(input);
      clearTimeout(timeout);
      resolve(result);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Option 3: Validate pattern complexity before use
function isRegexSafe(pattern: string): boolean {
  // Reject patterns with nested quantifiers
  const dangerousPatterns = [
    /\(.+\+\)+\+/,  // Nested + quantifiers
    /\(.+\*\)+\*/,  // Nested * quantifiers
    /\(\.\+\)\{.+\}/  // Repeated groups with quantifiers
  ];

  return !dangerousPatterns.some(dp => dp.test(pattern));
}
```

---

**Lesson 2.2: Input Validation Patterns**

*Learning from MED-009: Missing Input Validation*

```typescript
// ANTI-PATTERN: No validation
async function processUser(userId: string) {
  const user = await db.users.findById(userId);
  return user;
}
```

```typescript
// SECURE PATTERN: Comprehensive validation with Zod
import { z } from 'zod';

// Define strict schemas
const UserIdSchema = z.string()
  .uuid()
  .describe('Valid UUID for user identification');

const UserInputSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['user', 'admin', 'moderator']),
});

// Validation middleware
function validateInput<T>(schema: z.ZodSchema<T>) {
  return (input: unknown): T => {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new ValidationError(
        'Invalid input',
        result.error.flatten()
      );
    }
    return result.data;
  };
}

// Usage
async function processUser(rawUserId: unknown) {
  const userId = validateInput(UserIdSchema)(rawUserId);
  const user = await db.users.findById(userId);
  return user;
}
```

**Validation Checklist:**

- [ ] Validate all external input (API, files, environment)
- [ ] Use allowlists over denylists when possible
- [ ] Validate type, length, format, and range
- [ ] Sanitize for the specific output context
- [ ] Log validation failures for security monitoring

---

#### Module 3: Authentication & Identity Security (4 hours)

**Lesson 3.1: Biometric Threshold Selection**

*Learning from CRIT-003: Biometric Fusion Threshold Too Low*

```typescript
// ANTI-PATTERN: Permissive defaults
const config = {
  minSignalsRequired: 2,  // Too low
  // Allows weak signal combination (typing + mouse)
};
```

**Why this is dangerous:**
- Weak signals (typing rhythm, mouse movement) are easily spoofed
- 2 of 5 signals means 60% can be missing
- Dedicated hardware can replay these signals

```typescript
// SECURE PATTERN: Defense-in-depth biometrics
interface BiometricConfig {
  minSignalsRequired: number;
  minStrongSignals: number;
  signalStrengths: Record<BiometricType, 'strong' | 'medium' | 'weak'>;
}

const SECURE_BIOMETRIC_CONFIG: BiometricConfig = {
  minSignalsRequired: 3,
  minStrongSignals: 1,  // At least one strong signal required
  signalStrengths: {
    fingerprint: 'strong',
    faceId: 'strong',
    voiceprint: 'strong',
    typingPattern: 'weak',
    mouseMovement: 'weak',
    gazeTracking: 'medium',
  }
};

function validateBiometricSignals(signals: BiometricSignal[]): ValidationResult {
  const strongSignals = signals.filter(
    s => SECURE_BIOMETRIC_CONFIG.signalStrengths[s.type] === 'strong'
  );

  if (signals.length < SECURE_BIOMETRIC_CONFIG.minSignalsRequired) {
    return { valid: false, reason: 'Insufficient signals' };
  }

  if (strongSignals.length < SECURE_BIOMETRIC_CONFIG.minStrongSignals) {
    return { valid: false, reason: 'Requires at least one strong biometric' };
  }

  return { valid: true };
}
```

---

**Lesson 3.2: AI Detection Hardening**

*Learning from CRIT-002: AI Detection Bypass*

```typescript
// ANTI-PATTERN: Hardcoded detection patterns
const AI_INDICATOR_PHRASES = [
  'as an ai',
  'i cannot',
  'i don\'t have personal',
];
```

**Why this is dangerous:**
- Patterns are visible in client code
- AI can be trained to avoid these exact phrases
- Static patterns have zero adaptive capability

```typescript
// SECURE PATTERN: Multi-layer AI detection
interface AIDetectionConfig {
  // Never expose patterns client-side
  securePatternEndpoint: string;

  // ML-based classification
  mlModelPath: string;
  mlThreshold: number;  // 0.1 = very strict

  // Behavioral analysis
  sessionFingerprintRequired: true;
  minSessionDuration: number;
}

class AIDetector {
  private patterns: string[] = []; // Loaded from secure server

  async loadPatternsSecurely(): Promise<void> {
    // Load from authenticated server endpoint
    const response = await fetch(this.config.securePatternEndpoint, {
      headers: { 'Authorization': `Bearer ${await this.getServiceToken()}` }
    });
    this.patterns = await response.json();
  }

  async classify(interaction: UserInteraction): Promise<AIClassification> {
    // Multi-factor classification
    const patternScore = this.analyzePatterns(interaction);
    const mlScore = await this.mlClassify(interaction);
    const behavioralScore = this.analyzeBehavior(interaction);
    const timingScore = this.analyzeTimingPatterns(interaction);

    // Weighted combination
    const finalScore =
      patternScore * 0.2 +
      mlScore * 0.4 +
      behavioralScore * 0.25 +
      timingScore * 0.15;

    return {
      aiProbability: finalScore,
      isLikelyAI: finalScore > this.config.mlThreshold,
      confidence: this.calculateConfidence(/* ... */),
    };
  }
}
```

---

**Lesson 3.3: Rate Limiting Implementation**

*Learning from HIGH-009: No Rate Limiting*

```typescript
// ANTI-PATTERN: Unlimited attempts
async function verifyUser(credentials: Credentials): Promise<boolean> {
  // No rate limiting = brute force vulnerability
  return await checkCredentials(credentials);
}
```

```typescript
// SECURE PATTERN: Comprehensive rate limiting
interface RateLimitConfig {
  maxAttempts: number;
  windowSeconds: number;
  maxConsecutiveFailures: number;
  lockoutDurationSeconds: number;
  enableExponentialBackoff: boolean;
}

class VerificationRateLimiter {
  private attempts = new Map<string, AttemptRecord>();

  async checkRateLimit(
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const record = this.attempts.get(identifier) || this.createRecord();

    // Check lockout
    if (record.lockedUntil && Date.now() < record.lockedUntil) {
      return {
        allowed: false,
        reason: 'Account locked',
        retryAfter: record.lockedUntil - Date.now(),
      };
    }

    // Check window limit
    const recentAttempts = record.attempts.filter(
      a => Date.now() - a.timestamp < config.windowSeconds * 1000
    );

    if (recentAttempts.length >= config.maxAttempts) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        retryAfter: this.calculateRetryAfter(record, config),
      };
    }

    // Check consecutive failures
    if (record.consecutiveFailures >= config.maxConsecutiveFailures) {
      record.lockedUntil = Date.now() + config.lockoutDurationSeconds * 1000;
      return {
        allowed: false,
        reason: 'Too many failures - account locked',
        retryAfter: config.lockoutDurationSeconds * 1000,
      };
    }

    return { allowed: true };
  }

  private calculateRetryAfter(
    record: AttemptRecord,
    config: RateLimitConfig
  ): number {
    if (!config.enableExponentialBackoff) {
      return config.windowSeconds * 1000;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s...
    const backoff = Math.pow(2, record.consecutiveFailures) * 1000;
    return Math.min(backoff, 60000); // Cap at 1 minute
  }
}
```

---

#### Module 4: Concurrency & Timing Security (3 hours)

**Lesson 4.1: Race Condition Prevention**

*Learning from CRIT-004: Entanglement Race Condition*

```typescript
// ANTI-PATTERN: Wide timing window allows injection
const config = {
  simultaneityWindowMs: 5000,  // 5 second window = exploitable
};
```

**Why this is dangerous:**
- Attacker can wait for legitimate party to initiate
- Inject malicious data within the window
- Complete multi-party auth with fewer legitimate parties

```typescript
// SECURE PATTERN: Commit-reveal scheme
interface CommitRevealScheme {
  commitPhaseTimeoutMs: number;
  revealPhaseTimeoutMs: number;
  maxSimultaneityWindowMs: number;
}

class SecureMultiPartyProtocol {
  private commitments = new Map<string, Commitment>();
  private reveals = new Map<string, Reveal>();

  // Phase 1: All parties submit commitments (hash of their data)
  async submitCommitment(
    ceremonyId: string,
    participantId: string,
    commitment: string  // hash(data + nonce)
  ): Promise<void> {
    const ceremony = await this.getCeremony(ceremonyId);

    // All commitments must arrive within tight window
    if (Date.now() - ceremony.startTime > 500) {  // 500ms max
      throw new Error('Commitment phase expired');
    }

    this.commitments.set(`${ceremonyId}:${participantId}`, {
      commitment,
      timestamp: Date.now(),
    });
  }

  // Phase 2: After all commitments, parties reveal actual data
  async submitReveal(
    ceremonyId: string,
    participantId: string,
    data: Buffer,
    nonce: Buffer
  ): Promise<void> {
    const commitmentKey = `${ceremonyId}:${participantId}`;
    const commitment = this.commitments.get(commitmentKey);

    // Verify reveal matches commitment
    const expectedCommitment = this.hash(Buffer.concat([data, nonce]));
    if (commitment?.commitment !== expectedCommitment) {
      throw new Error('Reveal does not match commitment');
    }

    // Check freshness
    const MAX_BIO_STATE_AGE_MS = 30000;
    if (Date.now() - commitment.timestamp > MAX_BIO_STATE_AGE_MS) {
      throw new Error('Bio-state too old');
    }

    this.reveals.set(commitmentKey, { data, nonce, timestamp: Date.now() });
  }
}
```

---

**Lesson 4.2: Timing Attack Prevention**

```typescript
// ANTI-PATTERN: Early return reveals information
function checkToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;  // Reveals length information
  }

  for (let i = 0; i < provided.length; i++) {
    if (provided[i] !== expected[i]) {
      return false;  // Reveals character position
    }
  }

  return true;
}
```

```typescript
// SECURE PATTERN: Constant-time comparison
import { timingSafeEqual } from 'crypto';

function secureCompare(a: string, b: string): boolean {
  // Pad to equal length to avoid timing leak
  const maxLength = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLength, 0);
  const bufB = Buffer.alloc(maxLength, 0);

  Buffer.from(a).copy(bufA);
  Buffer.from(b).copy(bufB);

  // Length check in constant time
  const lengthMatch = a.length === b.length;

  // Content comparison in constant time
  const contentMatch = timingSafeEqual(bufA, bufB);

  return lengthMatch && contentMatch;
}
```

---

#### Module 5: Secure Memory Handling (2 hours)

**Lesson 5.1: Memory Security in JavaScript**

*Learning from CRIT-007: Insecure Memory Wipe*

```typescript
// ANTI-PATTERN: Attempting to wipe immutable strings
private secureWipe(data: string): void {
  // JavaScript strings are immutable - this does nothing!
  // Data remains in memory
}
```

**Why this is dangerous:**
- Sensitive data persists in memory
- Memory forensics can recover "deleted" data
- Garbage collection timing is unpredictable

```typescript
// SECURE PATTERN: Proper secure memory handling
class SecureMemory {
  // Use Uint8Array for sensitive data (can be zeroed)
  static createSecureBuffer(size: number): Uint8Array {
    return new Uint8Array(size);
  }

  // 4-pass secure wipe
  static secureWipe(buffer: Uint8Array): void {
    // Pass 1: Random data
    crypto.getRandomValues(buffer);
    // Pass 2: Zero fill
    buffer.fill(0);
    // Pass 3: Random data again
    crypto.getRandomValues(buffer);
    // Pass 4: Final zero fill
    buffer.fill(0);
  }

  // Helper for temporary secure operations
  static async withSecureBuffer<T>(
    size: number,
    operation: (buffer: Uint8Array) => Promise<T>
  ): Promise<T> {
    const buffer = this.createSecureBuffer(size);
    try {
      return await operation(buffer);
    } finally {
      this.secureWipe(buffer);
    }
  }
}

// Usage
const key = await SecureMemory.withSecureBuffer(32, async (buffer) => {
  // Derive key into buffer
  await deriveKey(masterKey, buffer);
  // Use key for encryption
  return encrypt(data, buffer);
});
// Buffer is automatically wiped after use
```

**Memory Security Rules:**
1. Never store sensitive data in strings
2. Use `Uint8Array` for keys, passwords, tokens
3. Wipe sensitive buffers immediately after use
4. Use `withSecureBuffer` pattern for automatic cleanup
5. Consider WebAssembly for critical crypto operations

---

### 1.2 Specialized Security Tracks

#### Track A: API Security (For Backend Developers)

**Topics:**
- Authentication token handling (JWTs, refresh tokens)
- Authorization patterns (RBAC, ABAC, ReBAC)
- Rate limiting and throttling
- API versioning security
- GraphQL-specific security concerns

#### Track B: Frontend Security (For Frontend Developers)

**Topics:**
- XSS prevention patterns
- CSP configuration
- Secure storage (cookies, localStorage)
- CSRF protection
- Clickjacking prevention

#### Track C: Infrastructure Security (For DevOps/SRE)

**Topics:**
- Secrets management
- Container security
- Network segmentation
- Log security and retention
- Incident response procedures

---

## 2. Developer Security Guide

### 2.1 Input Validation Patterns

#### Standard Validation Pipeline

```typescript
// Input validation should follow this pipeline
const validationPipeline = {
  // 1. Type validation
  type: 'Ensure correct data type',

  // 2. Length validation
  length: 'Check min/max bounds',

  // 3. Format validation
  format: 'Validate against expected pattern',

  // 4. Range validation
  range: 'Check numeric ranges, date ranges',

  // 5. Business rule validation
  business: 'Apply domain-specific rules',

  // 6. Sanitization
  sanitize: 'Clean for output context',
};
```

#### Validation Schema Examples

```typescript
import { z } from 'zod';

// User registration input
const RegistrationSchema = z.object({
  email: z.string()
    .email()
    .max(254)
    .toLowerCase()
    .transform(v => v.trim()),

  password: z.string()
    .min(12)
    .max(128)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),

  username: z.string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid characters'),
});

// API key format
const APIKeySchema = z.string()
  .regex(/^vk_[a-zA-Z0-9]{32}$/, 'Invalid API key format');

// UUID validation
const UUIDSchema = z.string().uuid();

// Pagination parameters
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['created', 'updated', 'name']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
```

---

### 2.2 Authentication/Authorization Patterns

#### Secure Token Handling

```typescript
// Token generation
import { randomBytes } from 'crypto';

function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

// Token storage (server-side)
interface TokenRecord {
  hashedToken: string;  // Store hash, not token
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  metadata: TokenMetadata;
}

async function storeToken(
  token: string,
  userId: string,
  ttlSeconds: number
): Promise<void> {
  const hashedToken = createHash('sha256').update(token).digest('hex');

  await tokenStore.create({
    hashedToken,
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
}

// Token verification
async function verifyToken(token: string): Promise<TokenRecord | null> {
  const hashedToken = createHash('sha256').update(token).digest('hex');

  const record = await tokenStore.findByHash(hashedToken);

  if (!record) return null;
  if (record.expiresAt < new Date()) return null;

  return record;
}
```

#### Role-Based Access Control

```typescript
// Permission definitions
const PERMISSIONS = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete',
  ADMIN: 'admin',
} as const;

// Role definitions
const ROLES: Record<string, Permission[]> = {
  viewer: [PERMISSIONS.READ],
  editor: [PERMISSIONS.READ, PERMISSIONS.WRITE],
  admin: [PERMISSIONS.READ, PERMISSIONS.WRITE, PERMISSIONS.DELETE, PERMISSIONS.ADMIN],
};

// Authorization check
function authorize(
  user: User,
  requiredPermission: Permission,
  resource?: Resource
): boolean {
  const userPermissions = ROLES[user.role] || [];

  // Check base permission
  if (!userPermissions.includes(requiredPermission)) {
    return false;
  }

  // Check resource-specific access if applicable
  if (resource && !canAccessResource(user, resource)) {
    return false;
  }

  return true;
}

// Decorator for route protection
function requirePermission(permission: Permission) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;

    descriptor.value = async function (req: Request, res: Response) {
      if (!authorize(req.user, permission)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return original.apply(this, [req, res]);
    };

    return descriptor;
  };
}
```

---

### 2.3 Cryptography Best Practices

#### Algorithm Selection Guide

| Purpose | Recommended | Key Size | Notes |
|---------|-------------|----------|-------|
| Symmetric encryption | AES-256-GCM | 256-bit | Authenticated encryption |
| Asymmetric encryption | RSA-OAEP, X25519+AES | 2048+ bit / 256-bit | Hybrid encryption preferred |
| Digital signatures | Ed25519, ECDSA P-256 | 256-bit | Ed25519 preferred |
| Password hashing | Argon2id | N/A | Memory-hard function |
| Key derivation | HKDF-SHA256 | N/A | For key expansion |
| Password-based KDF | PBKDF2, scrypt | N/A | High iteration count |
| Message auth | HMAC-SHA256 | 256-bit | |
| General hashing | SHA-256, SHA-3 | N/A | |

#### Key Management Principles

```typescript
// Key hierarchy
interface KeyHierarchy {
  // Master key: HSM-protected, never exported
  masterKey: 'HSM_PROTECTED';

  // Key encryption keys: Derived from master, encrypt data keys
  keyEncryptionKey: 'DERIVED_FROM_MASTER';

  // Data encryption keys: Encrypt actual data, rotated frequently
  dataEncryptionKey: 'ENCRYPTED_BY_KEK';
}

// Key rotation pattern
class KeyRotation {
  private currentVersion: number = 1;
  private keys: Map<number, EncryptedKey> = new Map();

  async rotate(): Promise<void> {
    // Generate new key
    const newKey = await generateKey();
    const newVersion = this.currentVersion + 1;

    // Encrypt with KEK
    const encryptedKey = await this.encryptKeyWithKEK(newKey);

    // Store new version
    this.keys.set(newVersion, encryptedKey);
    this.currentVersion = newVersion;

    // Schedule old key cleanup (after re-encryption period)
    this.scheduleKeyCleanup(this.currentVersion - 2);
  }

  // Always use current key for encryption
  async encrypt(data: Buffer): Promise<EncryptedData> {
    const key = await this.getCurrentKey();
    const encrypted = await encryptWithKey(data, key);
    return { ...encrypted, keyVersion: this.currentVersion };
  }

  // Support decryption with any valid key version
  async decrypt(data: EncryptedData): Promise<Buffer> {
    const key = await this.getKey(data.keyVersion);
    return decryptWithKey(data, key);
  }
}
```

---

### 2.4 Error Handling Security

*Learning from MED-006: Error Messages May Leak System State*

#### Secure Error Responses

```typescript
// ANTI-PATTERN: Leaky errors
app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack,  // NEVER in production!
    query: req.query,   // Reveals input
    user: req.user,     // Reveals auth state
  });
});
```

```typescript
// SECURE PATTERN: Sanitized error handling
import { v4 as uuidv4 } from 'uuid';

// Error categories for safe external display
const SAFE_ERROR_MESSAGES = {
  VALIDATION: 'Invalid input provided',
  AUTH: 'Authentication required',
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Resource not found',
  RATE_LIMIT: 'Too many requests',
  SERVER: 'An error occurred',
};

class SecureErrorHandler {
  handle(err: Error, req: Request, res: Response): void {
    // Generate correlation ID for log tracking
    const errorId = uuidv4();

    // Log full details internally
    logger.error({
      errorId,
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });

    // Return safe error to client
    const statusCode = this.getStatusCode(err);
    const safeMessage = this.getSafeMessage(err);

    res.status(statusCode).json({
      error: safeMessage,
      errorId,  // For support reference
      // No stack trace, no internal details
    });
  }

  private getSafeMessage(err: Error): string {
    if (err instanceof ValidationError) return SAFE_ERROR_MESSAGES.VALIDATION;
    if (err instanceof AuthError) return SAFE_ERROR_MESSAGES.AUTH;
    if (err instanceof ForbiddenError) return SAFE_ERROR_MESSAGES.FORBIDDEN;
    if (err instanceof NotFoundError) return SAFE_ERROR_MESSAGES.NOT_FOUND;
    if (err instanceof RateLimitError) return SAFE_ERROR_MESSAGES.RATE_LIMIT;
    return SAFE_ERROR_MESSAGES.SERVER;
  }
}
```

---

## 3. Code Review Security Checklist

### 3.1 Pre-Review Automated Checks

Run these before manual review:

```yaml
# .github/workflows/security-checks.yml
security-review:
  steps:
    - name: Static Analysis (SAST)
      run: |
        npm run lint:security
        semgrep --config p/security-audit .

    - name: Dependency Audit
      run: |
        npm audit --audit-level=moderate
        snyk test

    - name: Secret Scanning
      run: |
        gitleaks detect --source . --verbose
        trufflehog git file://. --only-verified

    - name: SBOM Generation
      run: |
        npm sbom --omit=dev > sbom.json
```

### 3.2 Manual Review Checklist

#### Authentication & Authorization

- [ ] All endpoints require authentication unless explicitly public
- [ ] Authorization checks happen on every request, not just initial
- [ ] Sensitive operations require step-up authentication
- [ ] Session tokens are invalidated on logout and password change
- [ ] Failed auth attempts are logged and rate-limited
- [ ] No hardcoded credentials or API keys

#### Input Validation

- [ ] All external input is validated before use
- [ ] Input validation uses allowlists where possible
- [ ] File uploads are validated (type, size, content)
- [ ] SQL queries use parameterized statements
- [ ] No string concatenation for commands/queries
- [ ] Regex patterns checked for ReDoS vulnerability

#### Cryptography

- [ ] No weak algorithms (MD5, SHA1, DES, RC4)
- [ ] Encryption uses authenticated modes (GCM, CCM)
- [ ] Keys are of appropriate length (AES-256, RSA-2048+)
- [ ] IVs/nonces are unique per encryption
- [ ] Keys stored securely, not in code
- [ ] Password hashing uses Argon2id, bcrypt, or scrypt

#### Data Protection

- [ ] Sensitive data encrypted at rest
- [ ] Sensitive data encrypted in transit (TLS 1.2+)
- [ ] PII has appropriate access controls
- [ ] Logs do not contain sensitive data
- [ ] Error messages do not leak internal details
- [ ] Temporary files are securely deleted

#### Session Management

- [ ] Session tokens are unpredictable (cryptographically random)
- [ ] Sessions have appropriate timeout
- [ ] Session fixation attacks prevented
- [ ] Concurrent session control if required
- [ ] Secure cookie flags set (HttpOnly, Secure, SameSite)

#### Concurrency

- [ ] Race conditions identified and mitigated
- [ ] Database operations use appropriate locking
- [ ] State changes are atomic where required
- [ ] Timing attacks considered for sensitive comparisons

### 3.3 OWASP Top 10 Coverage

| OWASP Category | Checklist Items | Automated Tools |
|----------------|-----------------|-----------------|
| A01: Broken Access Control | Auth checks on all endpoints, RBAC validation | Semgrep rules |
| A02: Cryptographic Failures | Algorithm review, key management | Semgrep, custom rules |
| A03: Injection | Input validation, parameterized queries | SQLMap, semgrep |
| A04: Insecure Design | Threat modeling review | Manual review |
| A05: Security Misconfiguration | Security headers, default credentials | ZAP, nuclei |
| A06: Vulnerable Components | Dependency audit | npm audit, Snyk |
| A07: Auth Failures | Session management, credential handling | Burp Suite |
| A08: Data Integrity Failures | SSRF checks, deserialization review | Semgrep |
| A09: Logging & Monitoring | Log coverage, alerting review | Manual review |
| A10: SSRF | URL validation, allowlists | Semgrep, manual |

---

## 4. Security Champions Program

### 4.1 Role Definition

#### Security Champion Responsibilities

**Primary Duties:**
1. Serve as security point-of-contact for their team
2. Perform initial security review on team PRs
3. Escalate complex security issues to security team
4. Promote security awareness within team
5. Participate in threat modeling sessions

**Time Allocation:**
- 10-20% of work time dedicated to security activities
- Minimum 4 hours per week for security reviews
- Monthly security champion meetings (2 hours)

#### Security Champion Selection Criteria

- Senior engineer level or above
- Demonstrated interest in security
- Strong code review skills
- Good communication abilities
- Commitment to ongoing learning

### 4.2 Training Requirements

#### Initial Training (40 hours)

| Module | Hours | Topics |
|--------|-------|--------|
| Security Fundamentals | 8 | OWASP Top 10, common vulnerabilities |
| Cryptography | 8 | Encryption, hashing, signatures, key management |
| Application Security | 8 | Input validation, authentication, session management |
| Secure Code Review | 8 | Review methodology, common patterns, tooling |
| Threat Modeling | 4 | STRIDE, attack trees, risk assessment |
| Incident Response | 4 | Playbooks, escalation, evidence preservation |

#### Ongoing Training (8 hours/quarter)

- Quarterly security update briefings
- New vulnerability pattern training
- Tool and technique updates
- Tabletop exercises

### 4.3 Champion Responsibilities Matrix

| Activity | Frequency | Time Estimate |
|----------|-----------|---------------|
| Security PR reviews | Daily | 30-60 min |
| Team security questions | As needed | 15-30 min |
| Security champion sync | Weekly | 30 min |
| Security team sync | Bi-weekly | 30 min |
| Threat modeling sessions | Monthly | 2 hours |
| Training updates | Quarterly | 8 hours |
| Security documentation | As needed | Varies |

### 4.4 Success Metrics

#### Individual Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Security reviews completed | 10+/month | PR tracking |
| Issues identified pre-merge | 2+/month | Issue tracking |
| Team training delivered | 1+/quarter | Training records |
| Time to escalation | <4 hours | Ticket timestamps |

#### Program Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Security vulnerabilities in production | <2/quarter | Incident reports |
| Time to remediate (critical) | <24 hours | Ticket timestamps |
| Security review coverage | >90% PRs | PR analytics |
| Champion retention | >80%/year | HR records |
| Developer security survey score | >4/5 | Quarterly survey |

### 4.5 Recognition and Career Development

**Recognition:**
- Monthly security champion spotlight
- Annual security excellence awards
- Conference attendance sponsorship
- Security certification funding

**Career Path:**
- Security Champion -> Senior Security Champion
- Security Champion -> Application Security Engineer
- Security Champion -> Security Architect

---

## 5. Training Materials

### 5.1 Quick Reference Cards

#### Cryptography Quick Reference

```
+-------------------------------------------+
|      CRYPTOGRAPHY QUICK REFERENCE         |
+-------------------------------------------+

ENCRYPTION:
  Symmetric:  AES-256-GCM (always authenticated)
  Asymmetric: X25519 + AES-256-GCM (hybrid)
  NEVER:      DES, 3DES, RC4, ECB mode

HASHING:
  General:    SHA-256, SHA-3
  Passwords:  Argon2id (preferred), bcrypt, scrypt
  NEVER:      MD5, SHA-1 for security

SIGNATURES:
  Preferred:  Ed25519
  Alternative: ECDSA P-256, RSA-PSS 2048+
  NEVER:      RSA PKCS#1 v1.5

KEY DERIVATION:
  From key:   HKDF-SHA256
  From password: PBKDF2 (100k+ iter), scrypt, Argon2

IV/NONCE:
  AES-GCM:    96-bit random, NEVER reuse
  ChaCha20:   96-bit random, NEVER reuse
+-------------------------------------------+
```

#### Input Validation Quick Reference

```
+-------------------------------------------+
|     INPUT VALIDATION QUICK REFERENCE      |
+-------------------------------------------+

VALIDATION ORDER:
  1. Type  -> Is it the expected type?
  2. Length -> Within min/max bounds?
  3. Format -> Matches expected pattern?
  4. Range  -> Within valid values?
  5. Business -> Meets domain rules?
  6. Sanitize -> Safe for output context?

COMMON PATTERNS:
  Email:    z.string().email().max(254)
  UUID:     z.string().uuid()
  URL:      z.string().url().startsWith('https://')
  Integer:  z.coerce.number().int().min(0)

DANGEROUS INPUTS:
  - SQL:     Use parameterized queries
  - Command: Avoid shell execution
  - Regex:   Use RE2 or timeout
  - Path:    Canonicalize, check traversal
  - XML:     Disable external entities

SANITIZATION BY CONTEXT:
  HTML:     HTML encode (<>&"')
  URL:      URL encode
  JSON:     JSON.stringify
  SQL:      Parameterized query
  Shell:    AVOID (use libraries)
+-------------------------------------------+
```

#### Authentication Quick Reference

```
+-------------------------------------------+
|    AUTHENTICATION QUICK REFERENCE         |
+-------------------------------------------+

TOKEN GENERATION:
  Use: crypto.randomBytes(32).toString('base64url')
  NOT: Math.random(), predictable seeds

TOKEN STORAGE:
  Store: Hash of token (SHA-256)
  NOT:   Plain token

PASSWORD REQUIREMENTS:
  Minimum: 12 characters
  Require: Upper + Lower + Number + Symbol
  Check:   Against breached password list
  Hash:    Argon2id, bcrypt, or scrypt

SESSION MANAGEMENT:
  Cookies: HttpOnly, Secure, SameSite=Strict
  Timeout: Idle (15min), Absolute (8hr)
  Logout:  Invalidate server-side

RATE LIMITING:
  Login:   5 attempts / 15 min
  API:     100 requests / min
  Lockout: 10 failures -> 30 min lock

MFA:
  Methods: TOTP, WebAuthn (preferred), SMS (backup)
  Required: Admin accounts, sensitive ops
+-------------------------------------------+
```

### 5.2 Secure Code Examples

#### Secure API Endpoint Pattern

```typescript
import { z } from 'zod';
import { rateLimiter } from '@/security/rate-limiter';
import { authorize } from '@/security/auth';
import { validateInput } from '@/security/validation';
import { sanitizeError } from '@/security/errors';

// Schema definition
const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(254).toLowerCase(),
  bio: z.string().max(500).optional(),
});

// Endpoint implementation
export async function updateProfile(req: Request, res: Response) {
  try {
    // 1. Rate limiting
    await rateLimiter.check(req.ip, 'profile-update');

    // 2. Authentication
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 3. Authorization
    if (!authorize(user, 'profile:write', { userId: req.params.id })) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 4. Input validation
    const input = validateInput(UpdateProfileSchema, req.body);

    // 5. Business logic
    const updated = await profileService.update(req.params.id, input);

    // 6. Audit logging
    await auditLog.record({
      action: 'profile.update',
      userId: user.id,
      targetId: req.params.id,
      changes: input,
    });

    // 7. Response
    return res.json({ data: updated });

  } catch (error) {
    // Sanitized error response
    return sanitizeError(error, res);
  }
}
```

#### Secure Database Query Pattern

```typescript
import { sql } from '@/db';

// SECURE: Parameterized query
async function getUser(userId: string): Promise<User | null> {
  const result = await sql`
    SELECT id, email, name, created_at
    FROM users
    WHERE id = ${userId}
    AND deleted_at IS NULL
  `;
  return result[0] || null;
}

// SECURE: Safe dynamic query building
async function searchUsers(
  filters: UserFilters,
  pagination: Pagination
): Promise<User[]> {
  const conditions = [];
  const params: any[] = [];

  if (filters.name) {
    conditions.push('name ILIKE $' + (params.length + 1));
    params.push(`%${filters.name}%`);
  }

  if (filters.role) {
    conditions.push('role = $' + (params.length + 1));
    params.push(filters.role);
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  // Validated, allowlisted sort column
  const sortColumn = ['name', 'created_at'].includes(filters.sortBy)
    ? filters.sortBy
    : 'created_at';

  const query = `
    SELECT id, email, name, role, created_at
    FROM users
    ${whereClause}
    ORDER BY ${sortColumn} ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  params.push(pagination.limit, pagination.offset);

  return db.query(query, params);
}
```

### 5.3 Anti-Patterns to Avoid

#### Cryptography Anti-Patterns

```typescript
// ANTI-PATTERN 1: Weak encryption
function badEncrypt(data: string, key: string): string {
  // XOR is not encryption!
  return data.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))
  ).join('');
}

// ANTI-PATTERN 2: ECB mode
const cipher = createCipheriv('aes-256-ecb', key, null);
// ECB leaks patterns in data!

// ANTI-PATTERN 3: Hardcoded keys
const ENCRYPTION_KEY = 'my-super-secret-key-12345';

// ANTI-PATTERN 4: Predictable IVs
const iv = Buffer.from('0000000000000000');

// ANTI-PATTERN 5: MD5 for security
const hash = crypto.createHash('md5').update(data).digest('hex');

// ANTI-PATTERN 6: Math.random for crypto
const token = Math.random().toString(36).substring(7);
```

#### Authentication Anti-Patterns

```typescript
// ANTI-PATTERN 1: Storing plain passwords
await db.users.insert({ email, password: plainPassword });

// ANTI-PATTERN 2: Timing-vulnerable comparison
if (providedToken === expectedToken) { /* ... */ }

// ANTI-PATTERN 3: No rate limiting
async function login(email: string, password: string) {
  // Unlimited attempts!
  const user = await findUserByEmail(email);
  return verifyPassword(password, user.passwordHash);
}

// ANTI-PATTERN 4: Information leakage
if (!user) {
  return { error: 'User not found' };  // Reveals user existence
}
if (!passwordMatch) {
  return { error: 'Invalid password' };  // Reveals user exists
}

// ANTI-PATTERN 5: JWT without expiration
const token = jwt.sign({ userId }, secret);  // No exp claim!

// ANTI-PATTERN 6: Storing sensitive data in JWT
const token = jwt.sign({
  userId,
  ssn: user.ssn,        // NEVER!
  creditCard: user.card  // NEVER!
}, secret);
```

#### Input Validation Anti-Patterns

```typescript
// ANTI-PATTERN 1: No validation
app.post('/api/users', (req, res) => {
  db.users.insert(req.body);  // Direct insertion!
});

// ANTI-PATTERN 2: Client-side only validation
// Server trusts client validation completely

// ANTI-PATTERN 3: Denylist approach
const badChars = ['<', '>', '"', "'", '&'];
const sanitized = input.split('').filter(c => !badChars.includes(c)).join('');
// Denylist always misses something

// ANTI-PATTERN 4: Regex for HTML sanitization
const clean = html.replace(/<script.*?>.*?<\/script>/gi, '');
// Can be bypassed!

// ANTI-PATTERN 5: String concatenation in queries
const query = `SELECT * FROM users WHERE id = '${userId}'`;

// ANTI-PATTERN 6: Unsafe file path handling
const filePath = path.join('/uploads', userInput);
// Allows path traversal: ../../../etc/passwd
```

### 5.4 Security Testing Guidance

#### Unit Test Security Examples

```typescript
describe('Input Validation', () => {
  it('should reject SQL injection attempts', () => {
    const maliciousInputs = [
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "1; SELECT * FROM passwords",
    ];

    for (const input of maliciousInputs) {
      expect(() => validateUserId(input)).toThrow(ValidationError);
    }
  });

  it('should reject XSS payloads', () => {
    const xssPayloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
    ];

    for (const payload of xssPayloads) {
      const sanitized = sanitizeHtml(payload);
      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).not.toContain('javascript:');
    }
  });

  it('should use constant-time comparison for secrets', () => {
    const token1 = 'secret-token-12345';
    const token2 = 'secret-token-12345';
    const token3 = 'wrong-token-00000';

    // Measure comparison time
    const iterations = 10000;

    const start1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      secureCompare(token1, token2);
    }
    const time1 = performance.now() - start1;

    const start2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      secureCompare(token1, token3);
    }
    const time2 = performance.now() - start2;

    // Times should be similar (within 20%)
    expect(Math.abs(time1 - time2) / time1).toBeLessThan(0.2);
  });
});

describe('Authentication', () => {
  it('should rate limit failed login attempts', async () => {
    const email = 'test@example.com';
    const wrongPassword = 'wrong-password';

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login(email, wrongPassword)
      ).rejects.toThrow(AuthenticationError);
    }

    // 6th attempt should be rate limited
    await expect(
      authService.login(email, wrongPassword)
    ).rejects.toThrow(RateLimitError);
  });

  it('should not reveal user existence', async () => {
    const validUser = 'existing@example.com';
    const invalidUser = 'nonexistent@example.com';
    const wrongPassword = 'wrong-password';

    const result1 = await authService.login(validUser, wrongPassword);
    const result2 = await authService.login(invalidUser, wrongPassword);

    // Both should return same error message
    expect(result1.error).toBe(result2.error);
    expect(result1.error).toBe('Invalid credentials');
  });
});

describe('Cryptography', () => {
  it('should generate unique IVs for each encryption', () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from('test data');

    const encrypted1 = encrypt(plaintext, key);
    const encrypted2 = encrypt(plaintext, key);

    // IVs should be different
    expect(encrypted1.iv).not.toEqual(encrypted2.iv);

    // Ciphertext should be different (due to different IV)
    expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
  });

  it('should detect tampering via authentication tag', () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from('sensitive data');

    const encrypted = encrypt(plaintext, key);

    // Tamper with ciphertext
    encrypted.ciphertext[0] ^= 0xFF;

    // Decryption should fail due to authentication
    expect(() => decrypt(encrypted, key)).toThrow();
  });
});
```

---

## 6. Framework-Specific Security Guidance

### 6.1 TypeScript/Node.js Security

#### Secure Configuration

```typescript
// Secure Express configuration
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
}));

// Disable fingerprinting
app.disable('x-powered-by');

// Secure JSON parsing
app.use(express.json({
  limit: '10kb',  // Limit body size
  strict: true,   // Only accept arrays and objects
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
  credentials: true,
  maxAge: 86400,
}));
```

### 6.2 Zod Schema Security

```typescript
import { z } from 'zod';

// Secure schema definitions
const SecureUserSchema = z.object({
  // String constraints
  email: z.string()
    .email()
    .max(254)
    .toLowerCase()
    .transform(s => s.trim()),

  // Numeric constraints
  age: z.number()
    .int()
    .min(0)
    .max(150)
    .optional(),

  // Enum for fixed values
  role: z.enum(['user', 'admin', 'moderator']),

  // URL validation
  website: z.string()
    .url()
    .startsWith('https://')
    .max(2048)
    .optional(),

  // Array with limits
  tags: z.array(z.string().max(50))
    .max(10)
    .default([]),

  // Object with strict mode
  preferences: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
  }).strict(),  // Reject unknown keys

}).strict();  // Reject unknown keys at top level

// Refinements for complex validation
const PasswordSchema = z.string()
  .min(12)
  .max(128)
  .refine(
    (pw) => /[A-Z]/.test(pw),
    'Must contain uppercase letter'
  )
  .refine(
    (pw) => /[a-z]/.test(pw),
    'Must contain lowercase letter'
  )
  .refine(
    (pw) => /[0-9]/.test(pw),
    'Must contain number'
  )
  .refine(
    (pw) => /[^A-Za-z0-9]/.test(pw),
    'Must contain special character'
  )
  .refine(
    async (pw) => !await isBreachedPassword(pw),
    'Password found in breach database'
  );
```

---

## 7. Appendices

### Appendix A: Red Team Findings Summary

| Finding ID | Severity | Status | Training Module |
|------------|----------|--------|-----------------|
| CRIT-001 | Critical | FIXED | Module 1: Cryptography |
| CRIT-002 | Critical | FIXED | Module 3: Authentication |
| CRIT-003 | Critical | FIXED | Module 3: Authentication |
| CRIT-004 | Critical | FIXED | Module 4: Concurrency |
| CRIT-005 | Critical | FIXED | Module 1: Cryptography |
| CRIT-006 | Critical | FIXED | Module 1: Cryptography |
| CRIT-007 | Critical | FIXED | Module 5: Memory Security |
| CRIT-008 | Critical | FIXED | Module 4: Concurrency |
| HIGH-002 | High | FIXED | Module 5: Memory Security |
| HIGH-003 | High | FIXED | Module 3: Authentication |
| HIGH-004 | High | OPEN | Module 1: Cryptography |
| HIGH-005 | High | OPEN | Code Review Checklist |
| HIGH-009 | High | FIXED | Module 3: Authentication |
| HIGH-010 | High | OPEN | Code Review Checklist |
| HIGH-011 | High | OPEN | Module 2: Input Validation |
| HIGH-012 | High | FIXED | Module 3: Authentication |

### Appendix B: Training Schedule Template

| Week | Topic | Duration | Format |
|------|-------|----------|--------|
| 1 | Security Fundamentals | 4 hrs | Workshop |
| 2 | Cryptography Basics | 4 hrs | Workshop |
| 3 | Input Validation | 3 hrs | Workshop |
| 4 | Authentication/Authorization | 4 hrs | Workshop |
| 5 | Concurrency Security | 3 hrs | Workshop |
| 6 | Memory Security | 2 hrs | Workshop |
| 7 | Secure Code Review | 4 hrs | Hands-on |
| 8 | Threat Modeling | 4 hrs | Hands-on |
| Ongoing | Security Champion Syncs | 1 hr/week | Meeting |

### Appendix C: Security Resources

**Internal:**
- `/Users/alexblanc/dev/vorion/src/security/void/RED_TEAM_REPORT.md`
- `/Users/alexblanc/dev/vorion/src/security/void/RED_TEAM_REPORT_R3.md`
- `/Users/alexblanc/dev/vorion/analysis/PURPLE_TEAM_REPORT.md`
- `/Users/alexblanc/dev/vorion/analysis/BLUE_TEAM_REPORT.md`

**External:**
- OWASP Top 10: https://owasp.org/Top10/
- OWASP Cheat Sheets: https://cheatsheetseries.owasp.org/
- CWE Top 25: https://cwe.mitre.org/top25/
- NIST Cryptographic Standards: https://csrc.nist.gov/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/

### Appendix D: Glossary

| Term | Definition |
|------|------------|
| AES-GCM | Authenticated encryption standard providing confidentiality and integrity |
| Argon2id | Memory-hard password hashing algorithm resistant to GPU attacks |
| CSRF | Cross-Site Request Forgery - attack forcing authenticated users to perform unwanted actions |
| HKDF | HMAC-based Key Derivation Function for deriving multiple keys from one |
| HSM | Hardware Security Module - dedicated hardware for secure key management |
| OWASP | Open Web Application Security Project - security standards organization |
| RBAC | Role-Based Access Control - authorization based on user roles |
| ReDoS | Regular Expression Denial of Service - attack using pathological regex patterns |
| SAST | Static Application Security Testing - code analysis without execution |
| XSS | Cross-Site Scripting - injection of malicious scripts into web pages |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-03 | Orange Team | Initial release |

---

*Orange Team Report - Transforming security findings into developer education.*

*For internal use only. Questions: security-training@vorion.dev*
