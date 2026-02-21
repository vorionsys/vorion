/**
 * Secure Cryptographic Utilities for Vorion
 *
 * Provides constant-time comparison and secure random generation utilities.
 * These are critical security primitives - do not modify without security review.
 *
 * @packageDocumentation
 */

import { timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Performs a constant-time comparison of two strings or Buffers.
 *
 * CRITICAL SECURITY FUNCTION:
 * - Uses Node.js crypto.timingSafeEqual which is guaranteed constant-time
 * - No fallback implementations - fails if timingSafeEqual is unavailable
 * - Pads inputs to same length to prevent length-based timing leaks
 *
 * This function MUST be used for:
 * - Comparing authentication tokens
 * - Comparing backup codes
 * - Comparing HMAC signatures
 * - Comparing password hashes
 * - Any security-sensitive string comparison
 *
 * @param a - First value to compare (string or Buffer)
 * @param b - Second value to compare (string or Buffer)
 * @returns true if values are equal, false otherwise
 *
 * @example
 * ```typescript
 * // Compare backup codes
 * if (constantTimeEquals(inputHash, storedHash)) {
 *   // Codes match
 * }
 *
 * // Compare API tokens
 * if (constantTimeEquals(providedToken, expectedToken)) {
 *   // Token is valid
 * }
 * ```
 */
export function constantTimeEquals(a: string | Buffer, b: string | Buffer): boolean {
  // Convert strings to Buffers for consistent comparison
  const bufferA = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bufferB = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');

  // Get the maximum length for padding
  const maxLength = Math.max(bufferA.length, bufferB.length);

  // If either is empty and the other is not, they're not equal
  // We still need to do constant-time work to prevent timing leaks
  if (maxLength === 0) {
    return bufferA.length === bufferB.length;
  }

  // Pad both buffers to the same length to prevent length-based timing attacks
  // Use zero-padding which is safe since we track the original lengths
  const paddedA = Buffer.alloc(maxLength, 0);
  const paddedB = Buffer.alloc(maxLength, 0);

  bufferA.copy(paddedA);
  bufferB.copy(paddedB);

  // Perform constant-time comparison on the padded buffers
  const contentsEqual = timingSafeEqual(paddedA, paddedB);

  // Both contents AND lengths must match for true equality
  // This comparison is also constant-time (simple integer comparison)
  return contentsEqual && bufferA.length === bufferB.length;
}

/**
 * Generates a cryptographically secure random token.
 *
 * Uses Node.js crypto.randomBytes which is backed by the OS CSPRNG.
 * The output is URL-safe base64 encoded for easy use in URLs and headers.
 *
 * @param length - Number of random bytes to generate (default: 32)
 * @returns URL-safe base64 encoded random string
 *
 * @example
 * ```typescript
 * // Generate a session token (32 bytes = 256 bits)
 * const sessionToken = generateSecureToken(32);
 *
 * // Generate a CSRF token
 * const csrfToken = generateSecureToken(24);
 *
 * // Generate an API key
 * const apiKey = generateSecureToken(48);
 * ```
 */
export function generateSecureToken(length: number = 32): string {
  if (length < 1) {
    throw new Error('Token length must be at least 1 byte');
  }

  if (length > 1024) {
    throw new Error('Token length must not exceed 1024 bytes');
  }

  const bytes = randomBytes(length);

  // Use URL-safe base64 encoding (replaces + with -, / with _, removes padding =)
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generates a cryptographically secure random hex string.
 *
 * @param length - Number of random bytes to generate (hex string will be 2x this length)
 * @returns Hex encoded random string
 *
 * @example
 * ```typescript
 * // Generate a 32-byte (256-bit) hex string (64 characters)
 * const token = generateSecureHexToken(32);
 * ```
 */
export function generateSecureHexToken(length: number = 32): string {
  if (length < 1) {
    throw new Error('Token length must be at least 1 byte');
  }

  if (length > 1024) {
    throw new Error('Token length must not exceed 1024 bytes');
  }

  return randomBytes(length).toString('hex');
}

/**
 * Validates that a value has sufficient entropy for security purposes.
 *
 * This performs advanced entropy validation that checks for:
 * 1. Shannon entropy (character frequency distribution)
 * 2. Pattern detection (repeated sequences, keyboard patterns)
 * 3. Minimum unique character ratio
 *
 * @param value - The string to validate
 * @param minEntropyBits - Minimum required entropy in bits (default: 128)
 * @returns Object with validation result and details
 *
 * @example
 * ```typescript
 * const result = validateEntropy(userProvidedKey, 128);
 * if (!result.valid) {
 *   console.error('Key rejected:', result.reason);
 * }
 * ```
 */
export function validateEntropy(
  value: string,
  minEntropyBits: number = 128
): {
  valid: boolean;
  entropyBits: number;
  reason?: string;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!value || value.length === 0) {
    return {
      valid: false,
      entropyBits: 0,
      reason: 'Value is empty',
      warnings,
    };
  }

  // Calculate Shannon entropy
  const freq = new Map<string, number>();
  for (const char of value) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  const len = value.length;
  let shannonEntropy = 0;
  freq.forEach((count) => {
    const p = count / len;
    shannonEntropy -= p * Math.log2(p);
  });

  // Total entropy in bits
  const entropyBits = shannonEntropy * len;

  // Check minimum entropy
  if (entropyBits < minEntropyBits) {
    return {
      valid: false,
      entropyBits,
      reason: `Insufficient entropy: ${Math.floor(entropyBits)} bits (need ${minEntropyBits}+)`,
      warnings,
    };
  }

  // Check for repeated character patterns
  const repeatedPatterns = detectRepeatedPatterns(value);
  if (repeatedPatterns.length > 0) {
    warnings.push(`Detected repeated patterns: ${repeatedPatterns.join(', ')}`);
  }

  // Check for keyboard patterns
  const keyboardPatterns = detectKeyboardPatterns(value);
  if (keyboardPatterns.length > 0) {
    warnings.push(`Detected keyboard patterns: ${keyboardPatterns.join(', ')}`);
  }

  // Check unique character ratio (should be high for good randomness)
  const uniqueRatio = freq.size / len;
  if (uniqueRatio < 0.3 && len > 10) {
    warnings.push(`Low unique character ratio: ${(uniqueRatio * 100).toFixed(1)}%`);
  }

  // If there are too many pattern warnings, mark as invalid
  const patternCount = repeatedPatterns.length + keyboardPatterns.length;
  if (patternCount >= 3) {
    return {
      valid: false,
      entropyBits,
      reason: 'Too many detectable patterns suggest non-random generation',
      warnings,
    };
  }

  return {
    valid: true,
    entropyBits,
    warnings,
  };
}

/**
 * Detects repeated character patterns in a string
 */
function detectRepeatedPatterns(value: string): string[] {
  const patterns: string[] = [];

  // Check for runs of the same character (e.g., "aaaa")
  const runPattern = /(.)\1{3,}/g;
  let match: RegExpExecArray | null;
  while ((match = runPattern.exec(value)) !== null) {
    patterns.push(`"${match[0].slice(0, 8)}${match[0].length > 8 ? '...' : ''}"`);
  }

  // Check for repeated short sequences (e.g., "abcabc")
  for (let seqLen = 2; seqLen <= 4; seqLen++) {
    for (let i = 0; i <= value.length - seqLen * 2; i++) {
      const seq = value.slice(i, i + seqLen);
      let count = 1;
      let pos = i + seqLen;
      while (pos + seqLen <= value.length && value.slice(pos, pos + seqLen) === seq) {
        count++;
        pos += seqLen;
      }
      if (count >= 3) {
        patterns.push(`"${seq}" x${count}`);
        break; // Only report once per sequence length
      }
    }
  }

  return patterns;
}

/**
 * Detects common keyboard patterns
 */
function detectKeyboardPatterns(value: string): string[] {
  const patterns: string[] = [];
  const lowerValue = value.toLowerCase();

  // Common keyboard row patterns
  const keyboardPatterns = [
    'qwerty',
    'qwertz',
    'azerty',
    'asdfgh',
    'zxcvbn',
    '123456',
    '654321',
    'abcdef',
    'fedcba',
  ];

  for (const pattern of keyboardPatterns) {
    if (lowerValue.includes(pattern)) {
      patterns.push(`"${pattern}"`);
    }
  }

  // Check for sequential characters (e.g., "abcd", "1234")
  for (let i = 0; i <= value.length - 4; i++) {
    const charCodes = value.slice(i, i + 4).split('').map(c => c.charCodeAt(0));
    const isSequential = charCodes.every((code, idx) => {
      if (idx === 0) return true;
      const diff = code - charCodes[idx - 1];
      return diff === 1 || diff === -1;
    });
    if (isSequential) {
      const seq = value.slice(i, i + 4);
      if (!patterns.some(p => p.includes(seq))) {
        patterns.push(`sequential: "${seq}"`);
      }
    }
  }

  return patterns;
}
