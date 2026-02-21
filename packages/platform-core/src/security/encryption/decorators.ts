/**
 * Field-Level Encryption Decorators
 *
 * TypeScript decorators for marking class fields that require encryption.
 * These decorators provide metadata that can be used by ORM middleware
 * or other systems to automatically encrypt/decrypt fields.
 *
 * Features:
 * - @Encrypted() - Mark a field for encryption with classification
 * - @SearchableEncrypted() - Mark a field for deterministic encryption
 * - Metadata reflection for runtime field discovery
 * - Policy generation from decorated classes
 *
 * @example
 * ```typescript
 * class User {
 *   @Encrypted(DataClassification.RESTRICTED)
 *   ssn: string;
 *
 *   @SearchableEncrypted()
 *   email: string;
 *
 *   @Encrypted(DataClassification.CONFIDENTIAL, { algorithm: 'chacha20-poly1305' })
 *   phoneNumber: string;
 * }
 *
 * // Get encrypted fields metadata
 * const fields = getEncryptedFields(User);
 * ```
 *
 * @packageDocumentation
 * @module security/encryption/decorators
 */

import type {
  DataClassification,
  EncryptionAlgorithm,
  FieldPolicy,
  FieldEncryptionPolicy,
} from './types.js';
import {
  DataClassification as Classification,
  EncryptionAlgorithm as Algorithm,
} from './types.js';

// =============================================================================
// Metadata Storage
// =============================================================================

/**
 * Symbol for storing encrypted field metadata
 */
const ENCRYPTED_FIELDS_KEY = Symbol('encryptedFields');

/**
 * Encrypted field metadata
 */
export interface EncryptedFieldMetadata {
  /** Property name */
  propertyKey: string;
  /** Data classification level */
  classification: DataClassification;
  /** Whether encryption is required */
  encrypted: boolean;
  /** Custom algorithm override */
  algorithm?: EncryptionAlgorithm;
  /** Whether to use deterministic encryption */
  deterministic: boolean;
  /** Custom key derivation suffix */
  keyDerivationSuffix?: string;
  /** Field description for documentation */
  description?: string;
}

/**
 * Get or create the encrypted fields metadata array for a class
 */
function getOrCreateMetadataArray(target: object): EncryptedFieldMetadata[] {
  // Use Object.getOwnPropertyDescriptor to check for own property
  const existing = Object.getOwnPropertyDescriptor(target, ENCRYPTED_FIELDS_KEY);

  if (existing && Array.isArray(existing.value)) {
    return existing.value as EncryptedFieldMetadata[];
  }

  // Check prototype chain for inherited metadata
  const inherited = (target as Record<symbol, unknown>)[ENCRYPTED_FIELDS_KEY];
  const baseArray: EncryptedFieldMetadata[] = Array.isArray(inherited)
    ? [...inherited]
    : [];

  // Define own property
  Object.defineProperty(target, ENCRYPTED_FIELDS_KEY, {
    value: baseArray,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return baseArray;
}

/**
 * Get encrypted fields metadata from a class
 */
function getMetadataArray(target: object): EncryptedFieldMetadata[] {
  const metadata = (target as Record<symbol, unknown>)[ENCRYPTED_FIELDS_KEY];
  return Array.isArray(metadata) ? metadata : [];
}

// =============================================================================
// Decorator Options
// =============================================================================

/**
 * Options for @Encrypted decorator
 */
export interface EncryptedOptions {
  /** Custom encryption algorithm */
  algorithm?: EncryptionAlgorithm;
  /** Custom key derivation suffix */
  keyDerivationSuffix?: string;
  /** Field description for documentation */
  description?: string;
}

/**
 * Options for @SearchableEncrypted decorator
 */
export interface SearchableEncryptedOptions {
  /** Data classification (defaults to CONFIDENTIAL) */
  classification?: DataClassification;
  /** Custom key derivation suffix */
  keyDerivationSuffix?: string;
  /** Field description for documentation */
  description?: string;
}

// =============================================================================
// Decorators
// =============================================================================

/**
 * Decorator to mark a field for encryption
 *
 * Fields marked with this decorator will be automatically encrypted
 * when stored and decrypted when retrieved, based on their classification.
 *
 * @param classification - The data classification level
 * @param options - Additional encryption options
 *
 * @example
 * ```typescript
 * class Patient {
 *   @Encrypted(DataClassification.RESTRICTED)
 *   medicalRecordNumber: string;
 *
 *   @Encrypted(DataClassification.CONFIDENTIAL, {
 *     algorithm: EncryptionAlgorithm.CHACHA20_POLY1305,
 *     description: 'Patient phone number for contact'
 *   })
 *   phoneNumber: string;
 * }
 * ```
 */
export function Encrypted(
  classification: DataClassification,
  options: EncryptedOptions = {}
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    if (typeof propertyKey !== 'string') {
      throw new Error('@Encrypted decorator can only be applied to string-named properties');
    }

    const metadata = getOrCreateMetadataArray(target.constructor.prototype);

    // Check if this field already has metadata (from parent class)
    const existingIndex = metadata.findIndex((m) => m.propertyKey === propertyKey);

    const fieldMetadata: EncryptedFieldMetadata = {
      propertyKey,
      classification,
      encrypted: true,
      deterministic: false,
      algorithm: options.algorithm,
      keyDerivationSuffix: options.keyDerivationSuffix,
      description: options.description,
    };

    if (existingIndex >= 0) {
      // Override inherited metadata
      metadata[existingIndex] = fieldMetadata;
    } else {
      metadata.push(fieldMetadata);
    }
  };
}

/**
 * Decorator to mark a field for searchable (deterministic) encryption
 *
 * Fields marked with this decorator use deterministic encryption,
 * which allows searching for exact matches while still encrypting data.
 *
 * Security note: Deterministic encryption is less secure than random IV
 * encryption because identical plaintexts produce identical ciphertexts.
 * Use only when searchability is required.
 *
 * @param options - Searchable encryption options
 *
 * @example
 * ```typescript
 * class User {
 *   @SearchableEncrypted({
 *     classification: DataClassification.CONFIDENTIAL,
 *     description: 'User email for login lookup'
 *   })
 *   email: string;
 *
 *   @SearchableEncrypted()
 *   externalId: string;
 * }
 * ```
 */
export function SearchableEncrypted(
  options: SearchableEncryptedOptions = {}
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    if (typeof propertyKey !== 'string') {
      throw new Error('@SearchableEncrypted decorator can only be applied to string-named properties');
    }

    const metadata = getOrCreateMetadataArray(target.constructor.prototype);

    // Check if this field already has metadata
    const existingIndex = metadata.findIndex((m) => m.propertyKey === propertyKey);

    const fieldMetadata: EncryptedFieldMetadata = {
      propertyKey,
      classification: options.classification ?? Classification.CONFIDENTIAL,
      encrypted: true,
      deterministic: true,
      keyDerivationSuffix: options.keyDerivationSuffix,
      description: options.description,
    };

    if (existingIndex >= 0) {
      metadata[existingIndex] = fieldMetadata;
    } else {
      metadata.push(fieldMetadata);
    }
  };
}

/**
 * Decorator to explicitly mark a field as not encrypted
 *
 * Useful when a parent class has encryption but a subclass field should not be encrypted.
 *
 * @param classification - The data classification (for documentation/policy)
 *
 * @example
 * ```typescript
 * class PublicProfile extends User {
 *   @NotEncrypted(DataClassification.PUBLIC)
 *   displayName: string;
 * }
 * ```
 */
export function NotEncrypted(classification: DataClassification): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    if (typeof propertyKey !== 'string') {
      throw new Error('@NotEncrypted decorator can only be applied to string-named properties');
    }

    const metadata = getOrCreateMetadataArray(target.constructor.prototype);
    const existingIndex = metadata.findIndex((m) => m.propertyKey === propertyKey);

    const fieldMetadata: EncryptedFieldMetadata = {
      propertyKey,
      classification,
      encrypted: false,
      deterministic: false,
    };

    if (existingIndex >= 0) {
      metadata[existingIndex] = fieldMetadata;
    } else {
      metadata.push(fieldMetadata);
    }
  };
}

// =============================================================================
// Metadata Access Functions
// =============================================================================

/**
 * Get all encrypted field metadata from a class
 *
 * @param target - The class constructor or instance
 * @returns Array of encrypted field metadata
 *
 * @example
 * ```typescript
 * class User {
 *   @Encrypted(DataClassification.RESTRICTED)
 *   ssn: string;
 *
 *   @SearchableEncrypted()
 *   email: string;
 * }
 *
 * const fields = getEncryptedFields(User);
 * // [
 * //   { propertyKey: 'ssn', classification: 'restricted', encrypted: true, deterministic: false },
 * //   { propertyKey: 'email', classification: 'confidential', encrypted: true, deterministic: true }
 * // ]
 * ```
 */
export function getEncryptedFields(
  target: object | (new (...args: unknown[]) => unknown)
): EncryptedFieldMetadata[] {
  const prototype = typeof target === 'function' ? target.prototype : Object.getPrototypeOf(target);
  return getMetadataArray(prototype);
}

/**
 * Check if a class has any encrypted fields
 *
 * @param target - The class constructor or instance
 * @returns True if the class has encrypted fields
 */
export function hasEncryptedFields(
  target: object | (new (...args: unknown[]) => unknown)
): boolean {
  const fields = getEncryptedFields(target);
  return fields.some((f) => f.encrypted);
}

/**
 * Get metadata for a specific field
 *
 * @param target - The class constructor or instance
 * @param propertyKey - The property name
 * @returns Field metadata or undefined
 */
export function getFieldMetadata(
  target: object | (new (...args: unknown[]) => unknown),
  propertyKey: string
): EncryptedFieldMetadata | undefined {
  const fields = getEncryptedFields(target);
  return fields.find((f) => f.propertyKey === propertyKey);
}

/**
 * Check if a specific field is encrypted
 *
 * @param target - The class constructor or instance
 * @param propertyKey - The property name
 * @returns True if the field is marked for encryption
 */
export function isFieldEncrypted(
  target: object | (new (...args: unknown[]) => unknown),
  propertyKey: string
): boolean {
  const metadata = getFieldMetadata(target, propertyKey);
  return metadata?.encrypted ?? false;
}

/**
 * Check if a specific field uses deterministic encryption
 *
 * @param target - The class constructor or instance
 * @param propertyKey - The property name
 * @returns True if the field uses deterministic encryption
 */
export function isFieldSearchable(
  target: object | (new (...args: unknown[]) => unknown),
  propertyKey: string
): boolean {
  const metadata = getFieldMetadata(target, propertyKey);
  return metadata?.deterministic ?? false;
}

// =============================================================================
// Policy Generation
// =============================================================================

/**
 * Generate a FieldEncryptionPolicy from a decorated class
 *
 * This creates a policy object that can be used with the encryption service
 * to encrypt/decrypt objects based on decorator metadata.
 *
 * @param target - The class constructor
 * @param entityName - Optional entity name (defaults to class name)
 * @returns Field encryption policy
 *
 * @example
 * ```typescript
 * class User {
 *   @Encrypted(DataClassification.RESTRICTED)
 *   ssn: string;
 *
 *   @SearchableEncrypted()
 *   email: string;
 * }
 *
 * const policy = generatePolicy(User);
 * // {
 * //   entityName: 'User',
 * //   fields: [
 * //     { fieldName: 'ssn', classification: 'restricted', encrypted: true },
 * //     { fieldName: 'email', classification: 'confidential', encrypted: true, deterministic: true }
 * //   ]
 * // }
 *
 * // Use with encryption service
 * const encrypted = await service.encryptObject(user, policy);
 * ```
 */
export function generatePolicy(
  target: new (...args: unknown[]) => unknown,
  entityName?: string
): FieldEncryptionPolicy {
  const fields = getEncryptedFields(target);
  const name = entityName ?? target.name;

  const fieldPolicies: FieldPolicy[] = fields.map((metadata) => ({
    fieldName: metadata.propertyKey,
    classification: metadata.classification,
    encrypted: metadata.encrypted,
    algorithm: metadata.algorithm,
    deterministic: metadata.deterministic,
    keyDerivationSuffix: metadata.keyDerivationSuffix,
  }));

  return {
    entityName: name,
    fields: fieldPolicies,
  };
}

/**
 * Generate policies for multiple classes
 *
 * @param classes - Array of class constructors
 * @returns Map of entity names to policies
 *
 * @example
 * ```typescript
 * const policies = generatePolicies([User, Patient, Account]);
 * // Map {
 * //   'User' => { entityName: 'User', fields: [...] },
 * //   'Patient' => { entityName: 'Patient', fields: [...] },
 * //   'Account' => { entityName: 'Account', fields: [...] }
 * // }
 * ```
 */
export function generatePolicies(
  classes: Array<new (...args: unknown[]) => unknown>
): Map<string, FieldEncryptionPolicy> {
  const policies = new Map<string, FieldEncryptionPolicy>();

  for (const cls of classes) {
    const policy = generatePolicy(cls);
    policies.set(policy.entityName, policy);
  }

  return policies;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Type utility to get encrypted field names from a class
 */
export type EncryptedFieldNames<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

/**
 * Type utility to mark encrypted fields in a type
 */
export type WithEncryptedFields<T, Fields extends keyof T> = Omit<T, Fields> & {
  [K in Fields]: T[K] | { __encrypted: true };
};
