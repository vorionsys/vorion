/**
 * Agent Birth Certificate Credentials
 *
 * Issues, decodes, and verifies JWT-based Agent Birth Certificates
 * that prove an agent's identity, origin, and truth chain position.
 *
 * Uses HMAC-SHA256 for JWT signing with a shared secret.
 * Truth chain provides tamper-evident sequencing of all issued certificates.
 */

import { createHash } from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

// ---------------------------------------------------------------------------
// Module-level truth chain state (in-memory; production would persist this)
// ---------------------------------------------------------------------------

let truthChainSequence = 0;
let truthChainHash = 'genesis';

// ---------------------------------------------------------------------------
// Signing key helper
// ---------------------------------------------------------------------------

function getSigningSecret(): Uint8Array {
  const secret = process.env.VORION_JWT_SECRET || 'vorion-dev-signing-key';
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Tier lookup (self-contained to avoid circular deps)
// ---------------------------------------------------------------------------

const TIER_RANGES: Array<{ tier: string; min: number; max: number }> = [
  { tier: 'T0_SANDBOX', min: 0, max: 199 },
  { tier: 'T1_OBSERVED', min: 200, max: 349 },
  { tier: 'T2_PROVISIONAL', min: 350, max: 499 },
  { tier: 'T3_MONITORED', min: 500, max: 649 },
  { tier: 'T4_STANDARD', min: 650, max: 799 },
  { tier: 'T5_TRUSTED', min: 800, max: 875 },
  { tier: 'T6_CERTIFIED', min: 876, max: 950 },
  { tier: 'T7_AUTONOMOUS', min: 951, max: 1000 },
];

function tierFromScore(score: number): string {
  for (const { tier, min, max } of TIER_RANGES) {
    if (score >= min && score <= max) return tier;
  }
  return 'T0_SANDBOX';
}

// ---------------------------------------------------------------------------
// 1. initializeTruthChain
// ---------------------------------------------------------------------------

export function initializeTruthChain(sequence: number, hash: string): void {
  truthChainSequence = sequence;
  truthChainHash = hash;
}

// ---------------------------------------------------------------------------
// 2. hashAgentConfig
// ---------------------------------------------------------------------------

export function hashAgentConfig(config: Record<string, unknown>): string {
  const deterministic = JSON.stringify(config, Object.keys(config).sort());
  return createHash('sha256').update(deterministic).digest('hex');
}

// ---------------------------------------------------------------------------
// Type definitions (unchanged)
// ---------------------------------------------------------------------------

export interface BirthCertificateInput {
  name: string;
  creatorId: string;
  bornAt: Date;
  initialConfigHash: string;
  level: string;
  type: string;
}

export interface BirthCertificateOutput {
  canonicalId: string;
  fingerprint: string;
  jwt: string;
  truthChainSequence: number;
  truthChainHash: string;
  payload: {
    truth_chain: {
      prev_hash: string;
    };
  };
}

// ---------------------------------------------------------------------------
// 3. issueBirthCertificate
// ---------------------------------------------------------------------------

export async function issueBirthCertificate(
  input: BirthCertificateInput
): Promise<BirthCertificateOutput> {
  const fingerprint = generateFingerprint(input);
  const canonicalId = `vorion:agent:${fingerprint.slice(0, 16)}`;
  const iat = Math.floor(Date.now() / 1000);

  // Capture current chain position before advancing
  const currentSequence = truthChainSequence + 1;
  const prevHash = truthChainHash;

  // Build the core payload (without truth_chain.hash — computed below)
  const birthData = {
    name: input.name,
    creator_id: input.creatorId,
    born_at: input.bornAt.toISOString(),
    initial_config_hash: input.initialConfigHash,
    level: input.level,
    type: input.type,
  };

  // Compute truth chain hash over the payload content
  const chainInput = JSON.stringify({
    iss: 'vorion:anchor',
    sub: canonicalId,
    iat,
    fingerprint,
    birth: birthData,
    truth_chain_sequence: currentSequence,
    truth_chain_prev_hash: prevHash,
  });
  const chainHash = createHash('sha256').update(chainInput).digest('hex');

  // Full payload matching BirthCertificatePayload
  const payload: BirthCertificatePayload = {
    iss: 'vorion:anchor',
    sub: canonicalId,
    iat,
    fingerprint,
    birth: birthData,
    truth_chain: {
      sequence: currentSequence,
      prev_hash: prevHash,
      hash: chainHash,
    },
  };

  // Sign the JWT using jose (HMAC-SHA256)
  const secret = getSigningSecret();
  const jwt = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256', typ: 'BC' })
    .sign(secret);

  // Advance truth chain state
  truthChainSequence = currentSequence;
  truthChainHash = chainHash;

  return {
    canonicalId,
    fingerprint,
    jwt,
    truthChainSequence: currentSequence,
    truthChainHash: chainHash,
    payload: {
      truth_chain: {
        prev_hash: prevHash,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Payload type definition (unchanged)
// ---------------------------------------------------------------------------

export interface BirthCertificatePayload {
  iss: string;
  sub: string;
  iat: number;
  fingerprint: string;
  birth: {
    name: string;
    creator_id: string;
    born_at: string;
    initial_config_hash: string;
    level: string;
    type: string;
  };
  truth_chain: {
    sequence: number;
    prev_hash: string;
    hash: string;
  };
}

// ---------------------------------------------------------------------------
// 4. decodeBirthCertificate
// ---------------------------------------------------------------------------

/**
 * Decodes a Birth Certificate JWT WITHOUT signature verification.
 * Used for inspecting claims before performing full verification
 * (e.g., the verification endpoint decodes first, then verifies via JWKS).
 */
export function decodeBirthCertificate(jwt: string): BirthCertificatePayload | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second segment, base64url-encoded)
    const payloadB64 = parts[1];
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as BirthCertificatePayload;

    // Basic structural validation
    if (!payload.iss || !payload.sub || !payload.fingerprint || !payload.birth || !payload.truth_chain) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. generateFingerprint
// ---------------------------------------------------------------------------

export function generateFingerprint(input: BirthCertificateInput): string {
  const deterministicString = `${input.name}:${input.creatorId}:${input.bornAt.toISOString()}:${input.initialConfigHash}:${input.level}:${input.type}`;
  const hash = createHash('sha256').update(deterministicString).digest('hex');
  return hash.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Verification types (unchanged)
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  agentId?: string;
  trustScore?: number;
  trustTier?: string;
  truthChainVerified?: boolean;
  expiresIn?: number;
  warnings: string[];
}

export interface VerifyCredentialOptions {
  checkRevocation?: (jwtId: string) => Promise<boolean>;
  getCurrentTrustScore?: (agentId: string) => Promise<number | null>;
}

// ---------------------------------------------------------------------------
// 6. verifyCredential
// ---------------------------------------------------------------------------

export async function verifyCredential(
  token: string,
  options?: VerifyCredentialOptions
): Promise<VerificationResult> {
  const warnings: string[] = [];

  // Step 1: Decode the token (without verification first to extract claims)
  const decoded = decodeBirthCertificate(token);
  if (!decoded) {
    return {
      valid: false,
      error: 'Invalid token',
      errorCode: 'INVALID_TOKEN',
      warnings: [],
    };
  }

  // Step 2: Verify HMAC signature using jose
  const secret = getSigningSecret();
  try {
    await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return {
        valid: false,
        error: 'Token has expired',
        errorCode: 'TOKEN_EXPIRED',
        agentId: decoded.sub,
        warnings: [],
      };
    }
    if (
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWTClaimValidationFailed
    ) {
      return {
        valid: false,
        error: 'Signature verification failed',
        errorCode: 'INVALID_SIGNATURE',
        agentId: decoded.sub,
        warnings: [],
      };
    }
    return {
      valid: false,
      error: 'Invalid token',
      errorCode: 'INVALID_TOKEN',
      warnings: [],
    };
  }

  // Step 3: Check expiration if exp claim exists
  const payload = decoded as BirthCertificatePayload & { exp?: number; jti?: string };
  if (payload.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return {
        valid: false,
        error: 'Token has expired',
        errorCode: 'TOKEN_EXPIRED',
        agentId: decoded.sub,
        warnings: [],
      };
    }
    const expiresIn = payload.exp - now;
    // Warn if expiring within 7 days
    if (expiresIn < 7 * 24 * 60 * 60) {
      warnings.push('credential_expiring_soon');
    }
  }

  // Step 4: Check revocation if callback provided
  if (options?.checkRevocation) {
    const jwtId = payload.jti || decoded.sub;
    const isRevoked = await options.checkRevocation(jwtId);
    if (isRevoked) {
      return {
        valid: false,
        error: 'Token has been revoked',
        errorCode: 'TOKEN_REVOKED',
        agentId: decoded.sub,
        warnings: [],
      };
    }
  }

  // Step 5: Verify truth chain hash integrity
  let truthChainVerified = false;
  if (decoded.truth_chain) {
    const chainInput = JSON.stringify({
      iss: decoded.iss,
      sub: decoded.sub,
      iat: decoded.iat,
      fingerprint: decoded.fingerprint,
      birth: decoded.birth,
      truth_chain_sequence: decoded.truth_chain.sequence,
      truth_chain_prev_hash: decoded.truth_chain.prev_hash,
    });
    const expectedHash = createHash('sha256').update(chainInput).digest('hex');
    truthChainVerified = expectedHash === decoded.truth_chain.hash;

    if (!truthChainVerified) {
      warnings.push('truth_chain_hash_mismatch');
    }
  }

  // Step 6: Get current trust score if callback provided
  let trustScore: number | undefined;
  let trustTier: string | undefined;
  if (options?.getCurrentTrustScore) {
    const score = await options.getCurrentTrustScore(decoded.sub);
    if (score !== null && score !== undefined) {
      trustScore = score;
      trustTier = tierFromScore(score);
    }
  }

  // Step 7: Check for stale credential (issued more than 30 days ago)
  const issueDate = new Date(decoded.iat * 1000);
  const daysSinceIssue = (Date.now() - issueDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceIssue > 30) {
    warnings.push('trust_score_may_be_stale');
  }

  return {
    valid: true,
    agentId: decoded.sub,
    trustScore,
    trustTier,
    truthChainVerified,
    expiresIn: payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : undefined,
    warnings,
  };
}
