/**
 * Secure Random Utilities
 *
 * Cryptographically secure random number generation utilities
 * to replace Math.random() throughout the codebase.
 *
 * Uses Node.js crypto module for all randomness to ensure
 * unpredictable values suitable for security-sensitive operations.
 *
 * @packageDocumentation
 */

import { randomBytes, randomInt, randomUUID } from 'node:crypto';

/**
 * Generate a cryptographically secure random integer between min (inclusive) and max (exclusive)
 *
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (exclusive)
 * @returns A secure random integer in the range [min, max)
 */
export function secureRandomInt(min: number, max: number): number {
  if (min >= max) {
    throw new Error('min must be less than max');
  }
  return randomInt(min, max);
}

/**
 * Generate a cryptographically secure random float between 0 (inclusive) and 1 (exclusive)
 *
 * Uses 32 bits of randomness for good precision while maintaining performance.
 *
 * @returns A secure random float in the range [0, 1)
 */
export function secureRandomFloat(): number {
  // Generate 4 random bytes (32 bits) and convert to a number between 0 and 1
  const buffer = randomBytes(4);
  const uint32 = buffer.readUInt32BE(0);
  // Divide by 2^32 to get a float in [0, 1)
  return uint32 / 0x100000000;
}

/**
 * Generate a cryptographically secure random element from an array
 *
 * @param array - The array to choose from
 * @returns A randomly selected element from the array
 * @throws Error if the array is empty
 */
export function secureRandomChoice<T>(array: readonly T[]): T {
  if (array.length === 0) {
    throw new Error('Cannot choose from an empty array');
  }
  const index = randomInt(0, array.length);
  return array[index];
}

/**
 * Cryptographically secure Fisher-Yates shuffle
 *
 * Creates a new shuffled array without modifying the original.
 *
 * @param array - The array to shuffle
 * @returns A new array with elements in random order
 */
export function secureRandomShuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate cryptographically secure random bytes
 *
 * @param length - Number of bytes to generate
 * @returns Buffer containing random bytes
 */
export function secureRandomBytes(length: number): Buffer {
  return randomBytes(length);
}

/**
 * Generate a secure unique identifier
 *
 * Uses crypto.randomUUID() for RFC 4122 v4 UUID generation.
 *
 * @returns A cryptographically secure UUID string
 */
export function secureRandomId(): string {
  return randomUUID();
}

/**
 * Generate a secure random string suitable for IDs
 *
 * Creates a URL-safe base64 string from random bytes.
 *
 * @param length - Approximate length of the resulting string (actual length may vary slightly)
 * @returns A random URL-safe string
 */
export function secureRandomString(length: number = 11): string {
  // Base64 encodes 3 bytes into 4 characters, so we need ceil(length * 3/4) bytes
  const byteLength = Math.ceil((length * 3) / 4);
  const bytes = randomBytes(byteLength);
  // Use base64url encoding (URL-safe base64 without padding)
  return bytes.toString('base64url').slice(0, length);
}

/**
 * Generate jitter for delays using secure randomness
 *
 * @param baseDelay - The base delay value
 * @param jitterFactor - Jitter factor (e.g., 0.25 for 25% jitter). Range: [-jitterFactor, +jitterFactor]
 * @returns Base delay with random jitter applied
 */
export function secureJitter(baseDelay: number, jitterFactor: number): number {
  // Generate a random value in [-1, 1] range
  const randomValue = secureRandomFloat() * 2 - 1;
  const jitter = baseDelay * jitterFactor * randomValue;
  return baseDelay + jitter;
}

/**
 * Determine if an event should occur based on probability using secure randomness
 *
 * @param probability - Probability of returning true (0 to 1)
 * @returns true with the given probability
 */
export function secureRandomBoolean(probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return secureRandomFloat() < probability;
}
