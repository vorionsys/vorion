/**
 * CAR ID String Extension Utilities
 *
 * Provides parsing and manipulation functions for CAR ID strings with
 * extension suffixes. Extensions are declared in CAR ID strings using
 * the # suffix format.
 *
 * @packageDocumentation
 * @module @vorion/car-extensions/car-string-extensions
 * @license Apache-2.0
 *
 * @example
 * ```
 * // CAR ID string formats:
 * // Without extensions:
 * //   a3i.vorion.banquet-advisor:FHC-L3@1.2.0
 * //
 * // With single extension:
 * //   a3i.vorion.banquet-advisor:FHC-L3@1.2.0#gov
 * //
 * // With multiple extensions:
 * //   a3i.vorion.banquet-advisor:FHC-L3@1.2.0#gov,audit,hipaa
 * ```
 */

import { z } from 'zod';

/**
 * Result of parsing extensions from a CAR ID string
 */
export interface ParsedExtensions {
  /** The core CAR ID string (without extension suffix) */
  core: string;
  /** Array of extension shortcodes */
  extensions: string[];
}

/**
 * Zod schema for ParsedExtensions validation
 */
export const ParsedExtensionsSchema = z.object({
  core: z.string().min(1),
  extensions: z.array(z.string()),
});

/**
 * Regular expression for validating extension ID format
 * Format: car-ext-{name}-v{major}
 * Example: car-ext-governance-v1
 */
const EXTENSION_ID_REGEX = /^car-ext-[a-z]+-v\d+$/;

/**
 * Regular expression for validating shortcode format
 * Format: 1-10 lowercase letters
 * Example: gov, audit, hipaa
 */
const SHORTCODE_REGEX = /^[a-z]{1,10}$/;

/**
 * Regular expression for validating CAR ID string with optional extensions
 * Matches: namespace.publisher.name:DOMAINS-L{level}@version[#extensions]
 * Note: Trust tier is NOT part of CAR ID - it's computed at runtime
 */
const CAR_WITH_EXTENSIONS_REGEX =
  /^[a-z0-9]+\.[a-z0-9-]+\.[a-z0-9-]+:[A-Z]+-L[0-7]@\d+\.\d+\.\d+(#[a-z]+(,[a-z]+)*)?$/;

/**
 * Parse extension suffix from a CAR ID string
 *
 * Extracts the core CAR ID string and any extension shortcodes from
 * a CAR ID string that may include an extension suffix.
 *
 * @param carId - The CAR ID string to parse (with or without extensions)
 * @returns Object containing core CAR ID string and array of extensions
 *
 * @example
 * ```typescript
 * // Without extensions
 * parseExtensions('a3i.vorion.agent:FHC-L3@1.0.0');
 * // { core: 'a3i.vorion.agent:FHC-L3@1.0.0', extensions: [] }
 *
 * // With single extension
 * parseExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov');
 * // { core: 'a3i.vorion.agent:FHC-L3@1.0.0', extensions: ['gov'] }
 *
 * // With multiple extensions
 * parseExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov,audit,hipaa');
 * // { core: 'a3i.vorion.agent:FHC-L3@1.0.0', extensions: ['gov', 'audit', 'hipaa'] }
 * ```
 */
export function parseExtensions(carId: string): ParsedExtensions {
  const hashIndex = carId.indexOf('#');

  if (hashIndex === -1) {
    return { core: carId, extensions: [] };
  }

  const core = carId.slice(0, hashIndex);
  const extSuffix = carId.slice(hashIndex + 1);

  // Split by comma and trim whitespace
  const extensions = extSuffix
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  return { core, extensions };
}

/**
 * Add an extension shortcode to a CAR ID string
 *
 * If the extension is already present, the string is returned unchanged.
 * Extensions are appended to the end of the extension list.
 *
 * @param carId - The CAR ID string (with or without existing extensions)
 * @param extension - The extension shortcode to add
 * @returns The CAR ID string with the extension added
 *
 * @example
 * ```typescript
 * // Add to string without extensions
 * addExtension('a3i.vorion.agent:FHC-L3@1.0.0', 'gov');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#gov'
 *
 * // Add to string with existing extensions
 * addExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov', 'audit');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#gov,audit'
 *
 * // Extension already present
 * addExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov', 'gov');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#gov'
 * ```
 */
export function addExtension(carId: string, extension: string): string {
  const { core, extensions } = parseExtensions(carId);

  // Don't add if already present
  if (extensions.includes(extension)) {
    return carId;
  }

  extensions.push(extension);
  return `${core}#${extensions.join(',')}`;
}

/**
 * Add multiple extensions to a CAR ID string
 *
 * Adds all specified extensions that are not already present.
 * Extensions are appended in the order provided.
 *
 * @param carId - The CAR ID string (with or without existing extensions)
 * @param extensionsToAdd - Array of extension shortcodes to add
 * @returns The CAR ID string with all extensions added
 *
 * @example
 * ```typescript
 * addExtensions('a3i.vorion.agent:FHC-L3@1.0.0', ['gov', 'audit']);
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#gov,audit'
 * ```
 */
export function addExtensions(carId: string, extensionsToAdd: string[]): string {
  let result = carId;
  for (const ext of extensionsToAdd) {
    result = addExtension(result, ext);
  }
  return result;
}

/**
 * Remove an extension shortcode from a CAR ID string
 *
 * If the extension is not present, the string is returned unchanged.
 * If removing the last extension, the # suffix is also removed.
 *
 * @param carId - The CAR ID string with extensions
 * @param extension - The extension shortcode to remove
 * @returns The CAR ID string with the extension removed
 *
 * @example
 * ```typescript
 * // Remove from multiple extensions
 * removeExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov,audit', 'gov');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#audit'
 *
 * // Remove last extension
 * removeExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov', 'gov');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0'
 *
 * // Extension not present
 * removeExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov', 'audit');
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#gov'
 * ```
 */
export function removeExtension(carId: string, extension: string): string {
  const { core, extensions } = parseExtensions(carId);
  const filtered = extensions.filter((e) => e !== extension);

  if (filtered.length === 0) {
    return core;
  }

  return `${core}#${filtered.join(',')}`;
}

/**
 * Remove multiple extensions from a CAR ID string
 *
 * @param carId - The CAR ID string with extensions
 * @param extensionsToRemove - Array of extension shortcodes to remove
 * @returns The CAR ID string with all specified extensions removed
 */
export function removeExtensions(carId: string, extensionsToRemove: string[]): string {
  const { core, extensions } = parseExtensions(carId);
  const filtered = extensions.filter((e) => !extensionsToRemove.includes(e));

  if (filtered.length === 0) {
    return core;
  }

  return `${core}#${filtered.join(',')}`;
}

/**
 * Check if a CAR ID string has a specific extension
 *
 * @param carId - The CAR ID string to check
 * @param extension - The extension shortcode to look for
 * @returns True if the extension is present, false otherwise
 *
 * @example
 * ```typescript
 * hasExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov,audit', 'gov');
 * // true
 *
 * hasExtension('a3i.vorion.agent:FHC-L3@1.0.0#gov', 'audit');
 * // false
 *
 * hasExtension('a3i.vorion.agent:FHC-L3@1.0.0', 'gov');
 * // false
 * ```
 */
export function hasExtension(carId: string, extension: string): boolean {
  const { extensions } = parseExtensions(carId);
  return extensions.includes(extension);
}

/**
 * Check if a CAR ID string has all specified extensions
 *
 * @param carId - The CAR ID string to check
 * @param requiredExtensions - Array of extension shortcodes required
 * @returns True if all extensions are present, false otherwise
 */
export function hasAllExtensions(carId: string, requiredExtensions: string[]): boolean {
  const { extensions } = parseExtensions(carId);
  return requiredExtensions.every((ext) => extensions.includes(ext));
}

/**
 * Check if a CAR ID string has any of the specified extensions
 *
 * @param carId - The CAR ID string to check
 * @param extensionsToCheck - Array of extension shortcodes to check
 * @returns True if any extension is present, false otherwise
 */
export function hasAnyExtension(carId: string, extensionsToCheck: string[]): boolean {
  const { extensions } = parseExtensions(carId);
  return extensionsToCheck.some((ext) => extensions.includes(ext));
}

/**
 * Validate extension ID format
 *
 * Extension IDs must follow the format: car-ext-{name}-v{major}
 * Where {name} is lowercase letters and {major} is a positive integer.
 *
 * @param id - The extension ID to validate
 * @returns True if the ID is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidExtensionId('car-ext-governance-v1');  // true
 * isValidExtensionId('car-ext-healthcare-v2'); // true
 * isValidExtensionId('car-ext-CAPS-v1');       // false (uppercase)
 * isValidExtensionId('my-extension');          // false (wrong format)
 * isValidExtensionId('car-ext-foo');           // false (missing version)
 * ```
 */
export function isValidExtensionId(id: string): boolean {
  return EXTENSION_ID_REGEX.test(id);
}

/**
 * Validate extension shortcode format
 *
 * Shortcodes must be 1-10 lowercase letters only.
 *
 * @param shortcode - The shortcode to validate
 * @returns True if the shortcode is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidShortcode('gov');     // true
 * isValidShortcode('hipaa');   // true
 * isValidShortcode('audit');   // true
 * isValidShortcode('GOV');     // false (uppercase)
 * isValidShortcode('gov1');    // false (contains number)
 * isValidShortcode('');        // false (empty)
 * isValidShortcode('verylongcode'); // false (too long)
 * ```
 */
export function isValidShortcode(shortcode: string): boolean {
  return SHORTCODE_REGEX.test(shortcode);
}

/**
 * Validate a CAR ID string with optional extensions
 *
 * Validates that the CAR ID string follows the expected format including
 * any extension suffix.
 *
 * @param carId - The CAR ID string to validate
 * @returns True if the CAR ID string is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidCARWithExtensions('a3i.vorion.agent:FHC-L3@1.0.0');           // true
 * isValidCARWithExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov');       // true
 * isValidCARWithExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov,audit'); // true
 * isValidCARWithExtensions('invalid-car-string');                      // false
 * ```
 */
export function isValidCARWithExtensions(carId: string): boolean {
  return CAR_WITH_EXTENSIONS_REGEX.test(carId);
}

/**
 * Get the extension count for a CAR ID string
 *
 * @param carId - The CAR ID string to check
 * @returns Number of extensions in the CAR ID string
 */
export function getExtensionCount(carId: string): number {
  const { extensions } = parseExtensions(carId);
  return extensions.length;
}

/**
 * Replace all extensions in a CAR ID string
 *
 * Removes any existing extensions and adds the new ones.
 *
 * @param carId - The CAR ID string (with or without extensions)
 * @param newExtensions - Array of new extension shortcodes
 * @returns CAR ID string with only the new extensions
 *
 * @example
 * ```typescript
 * replaceExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov', ['audit', 'hipaa']);
 * // 'a3i.vorion.agent:FHC-L3@1.0.0#audit,hipaa'
 *
 * replaceExtensions('a3i.vorion.agent:FHC-L3@1.0.0#gov', []);
 * // 'a3i.vorion.agent:FHC-L3@1.0.0'
 * ```
 */
export function replaceExtensions(carId: string, newExtensions: string[]): string {
  const { core } = parseExtensions(carId);

  if (newExtensions.length === 0) {
    return core;
  }

  // Remove duplicates while preserving order
  const unique = Array.from(new Set(newExtensions));
  return `${core}#${unique.join(',')}`;
}

/**
 * Sort extensions in a CAR ID string alphabetically
 *
 * @param carId - The CAR ID string with extensions
 * @returns CAR ID string with extensions sorted alphabetically
 */
export function sortExtensions(carId: string): string {
  const { core, extensions } = parseExtensions(carId);

  if (extensions.length === 0) {
    return core;
  }

  const sorted = [...extensions].sort();
  return `${core}#${sorted.join(',')}`;
}

/**
 * Compare two CAR ID strings for extension equality
 *
 * Checks if two CAR ID strings have the same extensions (regardless of order).
 *
 * @param carId1 - First CAR ID string
 * @param carId2 - Second CAR ID string
 * @returns True if both have the same extensions
 */
export function haveEqualExtensions(carId1: string, carId2: string): boolean {
  const ext1 = parseExtensions(carId1).extensions.sort();
  const ext2 = parseExtensions(carId2).extensions.sort();

  if (ext1.length !== ext2.length) {
    return false;
  }

  return ext1.every((e, i) => e === ext2[i]);
}

/**
 * Extract the core CAR ID string without extensions
 *
 * @param carId - The CAR ID string (with or without extensions)
 * @returns The core CAR ID string
 */
export function getCoreCAR(carId: string): string {
  return parseExtensions(carId).core;
}

/**
 * Build a CAR ID string from core and extensions
 *
 * @param core - The core CAR ID string
 * @param extensions - Array of extension shortcodes
 * @returns Complete CAR ID string with extensions
 */
export function buildCAR(core: string, extensions: string[]): string {
  if (extensions.length === 0) {
    return core;
  }

  // Remove duplicates while preserving order
  const unique = Array.from(new Set(extensions));
  return `${core}#${unique.join(',')}`;
}

/**
 * Parse extension ID to extract name and version
 *
 * @param extensionId - The extension ID (e.g., 'car-ext-governance-v1')
 * @returns Object with name and version, or null if invalid
 *
 * @example
 * ```typescript
 * parseExtensionId('car-ext-governance-v1');
 * // { name: 'governance', version: 1 }
 *
 * parseExtensionId('invalid');
 * // null
 * ```
 */
export function parseExtensionId(
  extensionId: string
): { name: string; version: number } | null {
  const match = extensionId.match(/^car-ext-([a-z]+)-v(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    name: match[1]!,
    version: parseInt(match[2]!, 10),
  };
}

/**
 * Build an extension ID from name and version
 *
 * @param name - Extension name (lowercase letters)
 * @param version - Major version number
 * @returns Extension ID in format car-ext-{name}-v{version}
 *
 * @example
 * ```typescript
 * buildExtensionId('governance', 1);
 * // 'car-ext-governance-v1'
 * ```
 */
export function buildExtensionId(name: string, version: number): string {
  return `car-ext-${name.toLowerCase()}-v${version}`;
}
