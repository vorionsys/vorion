/**
 * Safe JSON Parser
 *
 * Provides secure JSON parsing with prototype pollution protection,
 * schema validation, depth limits, and size limits.
 *
 * Security features:
 * - Removes __proto__, constructor, and prototype properties
 * - Validates against Zod schemas
 * - Limits object nesting depth to prevent stack overflow
 * - Limits JSON size to prevent memory exhaustion
 * - Uses Object.create(null) for prototype-free objects where appropriate
 *
 * @packageDocumentation
 */

import { z, ZodSchema } from "zod";

import { createLogger } from "./logger.js";

const logger = createLogger({ component: "safe-json" });

// =============================================================================
// Constants
// =============================================================================

/**
 * Properties that are dangerous and should be stripped from parsed objects
 * to prevent prototype pollution attacks.
 */
const DANGEROUS_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Default maximum depth for nested objects
 */
const DEFAULT_MAX_DEPTH = 20;

/**
 * Default maximum size in bytes for JSON strings
 */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

// =============================================================================
// Types
// =============================================================================

/**
 * Options for safe JSON parsing
 */
export interface SafeParseOptions<T = unknown> {
  /**
   * Zod schema to validate the parsed JSON against.
   * If provided, the parsed result will be validated and typed according to the schema.
   */
  schema?: ZodSchema<T>;

  /**
   * Maximum nesting depth allowed for the parsed object.
   * Prevents stack overflow attacks from deeply nested structures.
   * @default 20
   */
  maxDepth?: number;

  /**
   * Maximum size in bytes for the JSON string.
   * Prevents memory exhaustion from extremely large payloads.
   * @default 10485760 (10MB)
   */
  maxSize?: number;

  /**
   * Whether to strip dangerous prototype properties from the parsed object.
   * This includes __proto__, constructor, and prototype.
   * @default true
   */
  stripPrototype?: boolean;

  /**
   * Whether to use Object.create(null) for the resulting object.
   * This creates an object with no prototype, providing additional protection.
   * Only applies to the top-level object and its nested objects.
   * @default false
   */
  useNullPrototype?: boolean;
}

/**
 * Result of a safe parse operation
 */
export interface SafeParseResult<T> {
  /** Whether the parse was successful */
  success: boolean;
  /** The parsed and validated data (only present if success is true) */
  data?: T;
  /** The error that occurred (only present if success is false) */
  error?: SafeJsonError;
}

/**
 * Error codes for safe JSON operations
 */
export enum SafeJsonErrorCode {
  /** JSON syntax is invalid */
  INVALID_JSON = "INVALID_JSON",
  /** JSON exceeds maximum size limit */
  SIZE_EXCEEDED = "SIZE_EXCEEDED",
  /** JSON nesting exceeds maximum depth */
  DEPTH_EXCEEDED = "DEPTH_EXCEEDED",
  /** JSON failed schema validation */
  SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED",
  /** Prototype pollution attempt detected */
  PROTOTYPE_POLLUTION = "PROTOTYPE_POLLUTION",
}

/**
 * Error class for safe JSON operations
 */
export class SafeJsonError extends Error {
  /** Error code identifying the type of error */
  code: SafeJsonErrorCode;
  /** Original error that caused this error (if any) */
  override cause?: Error;
  /** Validation errors from Zod (if applicable) */
  validationErrors?: z.ZodIssue[];

  constructor(
    message: string,
    code: SafeJsonErrorCode,
    cause?: Error,
    validationErrors?: z.ZodIssue[],
  ) {
    super(message);
    this.name = "SafeJsonError";
    this.code = code;
    this.cause = cause;
    this.validationErrors = validationErrors;
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Recursively remove dangerous prototype properties from an object.
 *
 * This function walks through an object and its nested properties,
 * removing any properties that could be used for prototype pollution attacks.
 *
 * @param obj - The object to sanitize
 * @returns A new sanitized object with dangerous properties removed
 *
 * @example
 * ```typescript
 * const malicious = { __proto__: { isAdmin: true }, name: 'test' };
 * const safe = sanitizeObject(malicious);
 * // safe = { name: 'test' }
 * ```
 */
export function sanitizeObject<T extends object>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => {
      if (typeof item === "object" && item !== null) {
        return sanitizeObject(item);
      }
      return item;
    }) as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    // Skip dangerous properties
    if (DANGEROUS_PROPERTIES.has(key)) {
      logger.warn(
        { property: key },
        "Stripped dangerous property from parsed JSON",
      );
      continue;
    }

    const value = (obj as Record<string, unknown>)[key];

    if (typeof value === "object" && value !== null) {
      result[key] = sanitizeObject(value as object);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Create a null-prototype object from an existing object.
 *
 * This creates a new object with Object.create(null) and copies
 * all properties from the source object. The resulting object
 * has no prototype chain, providing protection against prototype
 * pollution attacks.
 *
 * @param obj - The source object
 * @returns A new object with null prototype
 */
function toNullPrototype<T extends object>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => {
      if (typeof item === "object" && item !== null) {
        return toNullPrototype(item);
      }
      return item;
    }) as unknown as T;
  }

  const result = Object.create(null) as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];

    if (typeof value === "object" && value !== null) {
      result[key] = toNullPrototype(value as object);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Check if an object exceeds the maximum nesting depth.
 *
 * @param obj - The object to check
 * @param maxDepth - Maximum allowed depth
 * @param currentDepth - Current depth in the traversal
 * @returns true if depth is valid, false if exceeded
 */
function checkDepth(obj: unknown, maxDepth: number, currentDepth = 0): boolean {
  if (currentDepth > maxDepth) {
    return false;
  }

  if (typeof obj !== "object" || obj === null) {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.every((item) => checkDepth(item, maxDepth, currentDepth + 1));
  }

  return Object.values(obj).every((value) =>
    checkDepth(value, maxDepth, currentDepth + 1),
  );
}

/**
 * Check if an object contains dangerous prototype properties.
 *
 * @param obj - The object to check
 * @returns true if dangerous properties are found
 */
function hasDangerousProperties(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  if (Array.isArray(obj)) {
    return obj.some((item) => hasDangerousProperties(item));
  }

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_PROPERTIES.has(key)) {
      return true;
    }

    const value = (obj as Record<string, unknown>)[key];
    if (hasDangerousProperties(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Safely parse a JSON string with security protections.
 *
 * This function provides multiple layers of protection against common
 * JSON-based attacks:
 * - Size limits to prevent memory exhaustion
 * - Depth limits to prevent stack overflow
 * - Prototype pollution protection
 * - Optional schema validation
 *
 * @param json - The JSON string to parse
 * @param options - Parsing options
 * @returns The parsed and validated object
 * @throws {SafeJsonError} If parsing fails or validation fails
 *
 * @example
 * ```typescript
 * // Basic usage
 * const data = safeJsonParse<{ name: string }>('{"name": "test"}');
 *
 * // With schema validation
 * const schema = z.object({ name: z.string(), age: z.number() });
 * const validated = safeJsonParse('{"name": "test", "age": 25}', { schema });
 *
 * // With all options
 * const secure = safeJsonParse(untrustedJson, {
 *   schema: mySchema,
 *   maxDepth: 10,
 *   maxSize: 1024 * 1024, // 1MB
 *   stripPrototype: true,
 *   useNullPrototype: true,
 * });
 * ```
 */
export function safeJsonParse<T = unknown>(
  json: string,
  options: SafeParseOptions<T> = {},
): T {
  const {
    schema,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxSize = DEFAULT_MAX_SIZE,
    stripPrototype = true,
    useNullPrototype = false,
  } = options;

  // Check size limit
  const size = new TextEncoder().encode(json).length;
  if (size > maxSize) {
    throw new SafeJsonError(
      `JSON size ${size} bytes exceeds maximum of ${maxSize} bytes`,
      SafeJsonErrorCode.SIZE_EXCEEDED,
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SafeJsonError(
      `Invalid JSON: ${error instanceof Error ? error.message : "Unknown error"}`,
      SafeJsonErrorCode.INVALID_JSON,
      error instanceof Error ? error : undefined,
    );
  }

  // Check depth limit
  if (typeof parsed === "object" && parsed !== null) {
    if (!checkDepth(parsed, maxDepth)) {
      throw new SafeJsonError(
        `JSON nesting depth exceeds maximum of ${maxDepth}`,
        SafeJsonErrorCode.DEPTH_EXCEEDED,
      );
    }
  }

  // Check for and optionally strip dangerous properties
  if (typeof parsed === "object" && parsed !== null) {
    if (hasDangerousProperties(parsed)) {
      if (stripPrototype) {
        logger.warn(
          { jsonPreview: json.substring(0, 100) },
          "Dangerous properties detected and stripped from JSON",
        );
        parsed = sanitizeObject(parsed as object);
      } else {
        throw new SafeJsonError(
          "JSON contains dangerous prototype properties",
          SafeJsonErrorCode.PROTOTYPE_POLLUTION,
        );
      }
    }

    // Convert to null prototype if requested
    if (useNullPrototype) {
      parsed = toNullPrototype(parsed as object);
    }
  }

  // Validate against schema if provided
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new SafeJsonError(
        `Schema validation failed: ${result.error.message}`,
        SafeJsonErrorCode.SCHEMA_VALIDATION_FAILED,
        result.error,
        result.error.errors,
      );
    }
    return result.data;
  }

  return parsed as T;
}

/**
 * Safely parse a JSON string, returning a result object instead of throwing.
 *
 * This is the "safe" variant that never throws, making it suitable for
 * use cases where you want to handle errors gracefully.
 *
 * @param json - The JSON string to parse
 * @param options - Parsing options
 * @returns A result object with success/failure status
 *
 * @example
 * ```typescript
 * const result = safeJsonParseSafe(userInput, { schema: mySchema });
 * if (result.success) {
 *   console.log('Parsed:', result.data);
 * } else {
 *   console.error('Failed:', result.error?.message);
 * }
 * ```
 */
export function safeJsonParseSafe<T = unknown>(
  json: string,
  options: SafeParseOptions<T> = {},
): SafeParseResult<T> {
  try {
    const data = safeJsonParse<T>(json, options);
    return { success: true, data };
  } catch (error) {
    if (error instanceof SafeJsonError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new SafeJsonError(
        `Unexpected error: ${error instanceof Error ? error.message : "Unknown"}`,
        SafeJsonErrorCode.INVALID_JSON,
        error instanceof Error ? error : undefined,
      ),
    };
  }
}

/**
 * Create a Map from JSON instead of a plain object.
 *
 * Maps are inherently safe from prototype pollution because they
 * don't have a prototype chain for data access.
 *
 * @param json - The JSON string to parse (must be an object)
 * @param options - Parsing options (schema is not applicable for Maps)
 * @returns A Map with string keys
 *
 * @example
 * ```typescript
 * const map = safeJsonParseAsMap('{"key1": "value1", "key2": "value2"}');
 * console.log(map.get('key1')); // "value1"
 * ```
 */
export function safeJsonParseAsMap<V = unknown>(
  json: string,
  options: Omit<SafeParseOptions, "schema" | "useNullPrototype"> = {},
): Map<string, V> {
  const parsed = safeJsonParse<Record<string, V>>(json, {
    ...options,
    stripPrototype: true,
  });

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SafeJsonError(
      "JSON must be an object to parse as Map",
      SafeJsonErrorCode.INVALID_JSON,
    );
  }

  const map = new Map<string, V>();

  for (const [key, value] of Object.entries(parsed)) {
    // Skip dangerous keys even though sanitizeObject should have removed them
    if (!DANGEROUS_PROPERTIES.has(key)) {
      map.set(key, value as V);
    }
  }

  return map;
}

/**
 * Stringify an object to JSON safely.
 *
 * This function sanitizes the object before stringifying to ensure
 * dangerous properties are not serialized.
 *
 * @param value - The value to stringify
 * @param space - Indentation for pretty printing
 * @returns The JSON string
 *
 * @example
 * ```typescript
 * const json = safeJsonStringify({ name: 'test', __proto__: { evil: true } });
 * // json = '{"name":"test"}'
 * ```
 */
export function safeJsonStringify(
  value: unknown,
  space?: string | number,
): string {
  if (typeof value === "object" && value !== null) {
    value = sanitizeObject(value as object);
  }
  return JSON.stringify(value, null, space);
}

// =============================================================================
// Pre-configured Parsers
// =============================================================================

/**
 * Create a type-safe parser for a specific schema.
 *
 * This creates a reusable parser function that always validates
 * against the provided schema.
 *
 * @param schema - The Zod schema to validate against
 * @param defaultOptions - Default options for all parse calls
 * @returns A parser function
 *
 * @example
 * ```typescript
 * const userSchema = z.object({
 *   id: z.string().uuid(),
 *   name: z.string(),
 *   email: z.string().email(),
 * });
 *
 * const parseUser = createSafeParser(userSchema);
 *
 * // Later...
 * const user = parseUser(jsonString);
 * // user is typed as { id: string; name: string; email: string }
 * ```
 */
export function createSafeParser<T>(
  schema: ZodSchema<T>,
  defaultOptions: Omit<SafeParseOptions<T>, "schema"> = {},
): (json: string, options?: Omit<SafeParseOptions<T>, "schema">) => T {
  return (
    json: string,
    options: Omit<SafeParseOptions<T>, "schema"> = {},
  ): T => {
    return safeJsonParse<T>(json, {
      ...defaultOptions,
      ...options,
      schema,
    });
  };
}

/**
 * Create a type-safe parser that returns a SafeParseResult.
 *
 * @param schema - The Zod schema to validate against
 * @param defaultOptions - Default options for all parse calls
 * @returns A parser function that returns SafeParseResult
 */
export function createSafeParserSafe<T>(
  schema: ZodSchema<T>,
  defaultOptions: Omit<SafeParseOptions<T>, "schema"> = {},
): (
  json: string,
  options?: Omit<SafeParseOptions<T>, "schema">,
) => SafeParseResult<T> {
  return (
    json: string,
    options: Omit<SafeParseOptions<T>, "schema"> = {},
  ): SafeParseResult<T> => {
    return safeJsonParseSafe<T>(json, {
      ...defaultOptions,
      ...options,
      schema,
    });
  };
}

// =============================================================================
// Reviver-based Parsing
// =============================================================================

/**
 * A JSON.parse reviver function that strips dangerous properties.
 *
 * This can be used directly with JSON.parse when you need low-level control.
 *
 * @param key - The property key
 * @param value - The property value
 * @returns The value (or undefined to skip)
 *
 * @example
 * ```typescript
 * const parsed = JSON.parse(json, safeReviver);
 * ```
 */
export function safeReviver(key: string, value: unknown): unknown {
  if (DANGEROUS_PROPERTIES.has(key)) {
    return undefined;
  }
  return value;
}
