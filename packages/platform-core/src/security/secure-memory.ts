/**
 * Secure Memory Handling Module
 *
 * Provides memory-safe credential handling for secrets that need to be
 * cleared from memory after use. Implements best-effort memory clearing
 * to minimize the window of exposure for sensitive data.
 *
 * Security Considerations:
 * - Node.js/V8 does not guarantee memory clearing due to garbage collection
 * - This provides defense-in-depth, not cryptographic guarantees
 * - For highest security, consider native modules or HSM integration
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';

const logger = createLogger({ component: 'secure-memory' });

// =============================================================================
// Constants
// =============================================================================

const IS_DEVELOPMENT = process.env['NODE_ENV'] !== 'production';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown when attempting to use a cleared secure value
 */
export class SecureMemoryError extends VorionError {
  override code = 'SECURE_MEMORY_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'SecureMemoryError';
  }
}

/**
 * Error thrown when a required environment variable is missing
 */
export class MissingEnvironmentError extends VorionError {
  override code = 'MISSING_ENVIRONMENT_VARIABLE';
  override statusCode = 500;

  constructor(variableName: string) {
    super(`Required environment variable '${variableName}' is not set`, {
      variableName,
    });
    this.name = 'MissingEnvironmentError';
  }
}

// =============================================================================
// SecureString Class
// =============================================================================

/**
 * SecureString class for handling sensitive string data
 *
 * Provides best-effort memory clearing when no longer needed.
 * Uses Buffer internally for more reliable memory clearing than
 * JavaScript strings, which are immutable and may be interned.
 *
 * @example
 * ```typescript
 * // Create a secure string from a password
 * const password = new SecureString(userInput);
 *
 * // Use the value safely
 * const hash = password.use((pwd) => bcrypt.hashSync(pwd, 10));
 *
 * // Explicitly clear when done (or use 'using' declaration)
 * password.clear();
 *
 * // Using the 'using' declaration (TypeScript 5.2+)
 * {
 *   using secret = new SecureString(apiKey);
 *   await secret.useAsync((key) => fetchWithAuth(key));
 * } // Automatically cleared at end of block
 * ```
 */
export class SecureString {
  private buffer: Buffer;
  private cleared: boolean = false;
  private readonly createdAt: number;
  private readonly id: string;

  /**
   * Create a new SecureString from a string value
   *
   * @param value - The sensitive string to protect
   */
  constructor(value: string) {
    this.buffer = Buffer.from(value, 'utf8');
    this.createdAt = Date.now();
    this.id = crypto.randomUUID().slice(0, 8);

    if (IS_DEVELOPMENT) {
      logger.debug(
        { secureStringId: this.id, length: this.buffer.length },
        'SecureString created'
      );
    }
  }

  /**
   * Use the secret value with a callback
   *
   * Creates a temporary string copy for the operation. The callback
   * should not store the value or allow it to escape the function scope.
   *
   * @param fn - Callback that receives the decrypted value
   * @returns The return value of the callback
   * @throws SecureMemoryError if the string has been cleared
   */
  use<T>(fn: (value: string) => T): T {
    this.ensureNotCleared();

    const value = this.buffer.toString('utf8');
    try {
      return fn(value);
    } finally {
      // Best effort: the string is still in memory until GC
      // but we've limited the exposure window
    }
  }

  /**
   * Async version of use
   *
   * Creates a temporary string copy for the async operation.
   *
   * @param fn - Async callback that receives the decrypted value
   * @returns Promise resolving to the callback's return value
   * @throws SecureMemoryError if the string has been cleared
   */
  async useAsync<T>(fn: (value: string) => Promise<T>): Promise<T> {
    this.ensureNotCleared();

    const value = this.buffer.toString('utf8');
    try {
      return await fn(value);
    } finally {
      // Best effort clearing
    }
  }

  /**
   * Zero-fill the buffer and mark as cleared
   *
   * This provides best-effort memory clearing. Due to V8's garbage
   * collection and string interning, complete clearing is not guaranteed.
   */
  clear(): void {
    if (this.cleared) {
      return;
    }

    // Zero-fill the buffer
    this.buffer.fill(0);

    // Replace with empty buffer to release reference
    this.buffer = Buffer.alloc(0);

    this.cleared = true;

    const lifetime = Date.now() - this.createdAt;

    if (IS_DEVELOPMENT) {
      logger.debug(
        { secureStringId: this.id, lifetimeMs: lifetime },
        'SecureString cleared'
      );
    } else {
      logger.trace(
        { secureStringId: this.id, lifetimeMs: lifetime },
        'SecureString cleared'
      );
    }
  }

  /**
   * Check if the secure string has been cleared
   *
   * @returns true if the value has been cleared
   */
  isCleared(): boolean {
    return this.cleared;
  }

  /**
   * Get the length of the secure string (without exposing the value)
   *
   * @returns Length of the string in bytes
   * @throws SecureMemoryError if the string has been cleared
   */
  get length(): number {
    this.ensureNotCleared();
    return this.buffer.length;
  }

  /**
   * Symbol.dispose for using declaration (TypeScript 5.2+)
   *
   * Enables automatic cleanup with the 'using' keyword:
   * ```typescript
   * using secret = new SecureString(value);
   * // secret is automatically cleared at end of block
   * ```
   */
  [Symbol.dispose](): void {
    this.clear();
  }

  /**
   * Ensure the value hasn't been cleared
   * @throws SecureMemoryError if cleared
   */
  private ensureNotCleared(): void {
    if (this.cleared) {
      throw new SecureMemoryError(
        'Attempted to use a SecureString that has been cleared',
        { secureStringId: this.id }
      );
    }
  }

  /**
   * Override toString to prevent accidental logging
   */
  toString(): string {
    return '[SecureString]';
  }

  /**
   * Override toJSON to prevent accidental serialization
   */
  toJSON(): string {
    return '[SecureString]';
  }

  /**
   * Custom inspect for Node.js util.inspect
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SecureString { cleared: ${this.cleared}, length: ${this.cleared ? 0 : this.buffer.length} }`;
  }
}

// =============================================================================
// SecureBuffer Class
// =============================================================================

/**
 * SecureBuffer class for handling sensitive binary data
 *
 * Similar to SecureString but designed for binary data such as
 * encryption keys, random bytes, or binary secrets.
 *
 * @example
 * ```typescript
 * // Create a secure buffer from binary data
 * const key = new SecureBuffer(cryptoKeyBytes);
 *
 * // Use the value safely
 * const encrypted = key.use((k) => crypto.encrypt(data, k));
 *
 * // Clear when done
 * key.clear();
 * ```
 */
export class SecureBuffer {
  private buffer: Buffer;
  private cleared: boolean = false;
  private readonly createdAt: number;
  private readonly id: string;

  /**
   * Create a new SecureBuffer from binary data
   *
   * @param data - The sensitive binary data to protect (Buffer, Uint8Array, or hex string)
   */
  constructor(data: Buffer | Uint8Array | string) {
    if (typeof data === 'string') {
      // Assume hex-encoded string
      this.buffer = Buffer.from(data, 'hex');
    } else if (data instanceof Uint8Array) {
      this.buffer = Buffer.from(data);
    } else {
      this.buffer = Buffer.from(data);
    }

    this.createdAt = Date.now();
    this.id = crypto.randomUUID().slice(0, 8);

    if (IS_DEVELOPMENT) {
      logger.debug(
        { secureBufferId: this.id, length: this.buffer.length },
        'SecureBuffer created'
      );
    }
  }

  /**
   * Use the secret value with a callback
   *
   * Creates a copy of the buffer for the operation to prevent
   * external modification of the internal buffer.
   *
   * @param fn - Callback that receives a copy of the buffer
   * @returns The return value of the callback
   * @throws SecureMemoryError if the buffer has been cleared
   */
  use<T>(fn: (value: Buffer) => T): T {
    this.ensureNotCleared();

    // Create a copy to prevent external modification
    const copy = Buffer.from(this.buffer);
    try {
      return fn(copy);
    } finally {
      // Zero-fill the copy
      copy.fill(0);
    }
  }

  /**
   * Async version of use
   *
   * @param fn - Async callback that receives a copy of the buffer
   * @returns Promise resolving to the callback's return value
   * @throws SecureMemoryError if the buffer has been cleared
   */
  async useAsync<T>(fn: (value: Buffer) => Promise<T>): Promise<T> {
    this.ensureNotCleared();

    // Create a copy to prevent external modification
    const copy = Buffer.from(this.buffer);
    try {
      return await fn(copy);
    } finally {
      // Zero-fill the copy
      copy.fill(0);
    }
  }

  /**
   * Zero-fill the buffer and mark as cleared
   */
  clear(): void {
    if (this.cleared) {
      return;
    }

    // Zero-fill the buffer
    this.buffer.fill(0);

    // Replace with empty buffer to release reference
    this.buffer = Buffer.alloc(0);

    this.cleared = true;

    const lifetime = Date.now() - this.createdAt;

    if (IS_DEVELOPMENT) {
      logger.debug(
        { secureBufferId: this.id, lifetimeMs: lifetime },
        'SecureBuffer cleared'
      );
    } else {
      logger.trace(
        { secureBufferId: this.id, lifetimeMs: lifetime },
        'SecureBuffer cleared'
      );
    }
  }

  /**
   * Check if the secure buffer has been cleared
   *
   * @returns true if the value has been cleared
   */
  isCleared(): boolean {
    return this.cleared;
  }

  /**
   * Get the length of the secure buffer (without exposing the value)
   *
   * @returns Length of the buffer in bytes
   * @throws SecureMemoryError if the buffer has been cleared
   */
  get length(): number {
    this.ensureNotCleared();
    return this.buffer.length;
  }

  /**
   * Symbol.dispose for using declaration (TypeScript 5.2+)
   */
  [Symbol.dispose](): void {
    this.clear();
  }

  /**
   * Ensure the value hasn't been cleared
   * @throws SecureMemoryError if cleared
   */
  private ensureNotCleared(): void {
    if (this.cleared) {
      throw new SecureMemoryError(
        'Attempted to use a SecureBuffer that has been cleared',
        { secureBufferId: this.id }
      );
    }
  }

  /**
   * Override toString to prevent accidental logging
   */
  toString(): string {
    return '[SecureBuffer]';
  }

  /**
   * Override toJSON to prevent accidental serialization
   */
  toJSON(): string {
    return '[SecureBuffer]';
  }

  /**
   * Custom inspect for Node.js util.inspect
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SecureBuffer { cleared: ${this.cleared}, length: ${this.cleared ? 0 : this.buffer.length} }`;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a SecureString from an environment variable
 *
 * @param name - The name of the environment variable
 * @returns SecureString containing the value, or undefined if not set
 *
 * @example
 * ```typescript
 * const apiKey = secureEnv('API_KEY');
 * if (apiKey) {
 *   apiKey.use((key) => callApi(key));
 *   apiKey.clear();
 * }
 * ```
 */
export function secureEnv(name: string): SecureString | undefined {
  const value = process.env[name];

  if (value === undefined || value === '') {
    if (IS_DEVELOPMENT) {
      logger.debug({ envVar: name }, 'Environment variable not set');
    }
    return undefined;
  }

  const secure = new SecureString(value);

  // Best effort: clear from process.env
  // Note: This doesn't truly clear the memory, but removes the reference
  // and signals intent. The original value may still exist in memory.
  if (IS_DEVELOPMENT) {
    logger.warn(
      { envVar: name },
      'Development mode: Environment variable not cleared from process.env for debugging'
    );
  } else {
    // In production, we attempt to overwrite and delete
    // This is still best-effort due to V8 string interning
    process.env[name] = '*'.repeat(value.length);
    delete process.env[name];

    logger.info(
      { envVar: name },
      'Environment variable wrapped in SecureString and cleared from process.env'
    );
  }

  return secure;
}

/**
 * Create a SecureString from a required environment variable
 *
 * @param name - The name of the environment variable
 * @returns SecureString containing the value
 * @throws MissingEnvironmentError if the variable is not set
 *
 * @example
 * ```typescript
 * // Throws if DATABASE_PASSWORD is not set
 * const dbPassword = requireSecureEnv('DATABASE_PASSWORD');
 * ```
 */
export function requireSecureEnv(name: string): SecureString {
  const secure = secureEnv(name);

  if (!secure) {
    logger.error({ envVar: name }, 'Required environment variable is missing');
    throw new MissingEnvironmentError(name);
  }

  return secure;
}

/**
 * Create a SecureBuffer from random bytes
 *
 * @param length - Number of random bytes to generate
 * @returns SecureBuffer containing random bytes
 *
 * @example
 * ```typescript
 * const key = secureRandomBytes(32);
 * key.use((bytes) => encrypt(data, bytes));
 * key.clear();
 * ```
 */
export function secureRandomBytes(length: number): SecureBuffer {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return new SecureBuffer(bytes);
}

/**
 * Securely compare two SecureStrings in constant time
 *
 * @param a - First SecureString
 * @param b - Second SecureString
 * @returns true if values are equal
 * @throws SecureMemoryError if either string has been cleared
 *
 * @example
 * ```typescript
 * const input = new SecureString(userInput);
 * const stored = new SecureString(storedHash);
 * const match = secureCompare(input, stored);
 * ```
 */
export function secureCompare(a: SecureString, b: SecureString): boolean {
  return a.use((aVal) =>
    b.use((bVal) => {
      const aBuf = Buffer.from(aVal);
      const bBuf = Buffer.from(bVal);

      // Constant-time comparison
      if (aBuf.length !== bBuf.length) {
        // Still do the comparison to maintain constant time
        const dummy = Buffer.alloc(aBuf.length);
        crypto.subtle; // Reference to ensure crypto is available
        let result = 0;
        for (let i = 0; i < aBuf.length; i++) {
          result |= aBuf[i]! ^ dummy[i]!;
        }
        return false;
      }

      let result = 0;
      for (let i = 0; i < aBuf.length; i++) {
        result |= aBuf[i]! ^ bBuf[i]!;
      }

      return result === 0;
    })
  );
}

/**
 * Securely compare two SecureBuffers in constant time
 *
 * @param a - First SecureBuffer
 * @param b - Second SecureBuffer
 * @returns true if values are equal
 * @throws SecureMemoryError if either buffer has been cleared
 */
export function secureCompareBuffers(a: SecureBuffer, b: SecureBuffer): boolean {
  return a.use((aBuf) =>
    b.use((bBuf) => {
      if (aBuf.length !== bBuf.length) {
        // Still do the comparison to maintain constant time
        const dummy = Buffer.alloc(aBuf.length);
        let result = 0;
        for (let i = 0; i < aBuf.length; i++) {
          result |= aBuf[i]! ^ dummy[i]!;
        }
        return false;
      }

      let result = 0;
      for (let i = 0; i < aBuf.length; i++) {
        result |= aBuf[i]! ^ bBuf[i]!;
      }

      return result === 0;
    })
  );
}

// =============================================================================
// Scoped Secret Management
// =============================================================================

/**
 * Execute a function with a temporary secure string that is automatically cleared
 *
 * @param value - The sensitive string value
 * @param fn - Function to execute with the secure string
 * @returns The return value of the function
 *
 * @example
 * ```typescript
 * const result = withSecureString(password, (secure) => {
 *   return secure.use((pwd) => hashPassword(pwd));
 * });
 * // SecureString is automatically cleared
 * ```
 */
export function withSecureString<T>(
  value: string,
  fn: (secure: SecureString) => T
): T {
  const secure = new SecureString(value);
  try {
    return fn(secure);
  } finally {
    secure.clear();
  }
}

/**
 * Execute an async function with a temporary secure string that is automatically cleared
 *
 * @param value - The sensitive string value
 * @param fn - Async function to execute with the secure string
 * @returns Promise resolving to the function's return value
 */
export async function withSecureStringAsync<T>(
  value: string,
  fn: (secure: SecureString) => Promise<T>
): Promise<T> {
  const secure = new SecureString(value);
  try {
    return await fn(secure);
  } finally {
    secure.clear();
  }
}

/**
 * Execute a function with a temporary secure buffer that is automatically cleared
 *
 * @param data - The sensitive binary data
 * @param fn - Function to execute with the secure buffer
 * @returns The return value of the function
 */
export function withSecureBuffer<T>(
  data: Buffer | Uint8Array | string,
  fn: (secure: SecureBuffer) => T
): T {
  const secure = new SecureBuffer(data);
  try {
    return fn(secure);
  } finally {
    secure.clear();
  }
}

/**
 * Execute an async function with a temporary secure buffer that is automatically cleared
 *
 * @param data - The sensitive binary data
 * @param fn - Async function to execute with the secure buffer
 * @returns Promise resolving to the function's return value
 */
export async function withSecureBufferAsync<T>(
  data: Buffer | Uint8Array | string,
  fn: (secure: SecureBuffer) => Promise<T>
): Promise<T> {
  const secure = new SecureBuffer(data);
  try {
    return await fn(secure);
  } finally {
    secure.clear();
  }
}
