/**
 * ACI String Extensions - Backwards Compatibility Layer
 *
 * This module re-exports from car-string-extensions.ts for backwards compatibility.
 * ACI (Agent Capability Identifier) was renamed to CAR (Capability Authority Record).
 *
 * @deprecated Import from './car-string-extensions.js' instead
 */

export {
  // Types
  type ParsedExtensions,
  ParsedExtensionsSchema,

  // Parsing
  parseExtensions,

  // Manipulation
  addExtension,
  addExtensions,
  removeExtension,
  removeExtensions,
  replaceExtensions,
  sortExtensions,

  // Querying
  hasExtension,
  hasAllExtensions,
  hasAnyExtension,
  getExtensionCount,
  haveEqualExtensions,

  // Core extraction (with ACI alias)
  getCoreCar,
  getCoreCAR,
  getCoreACI,

  // Building (with ACI alias)
  buildCAR,
  buildACI,

  // Validation
  isValidExtensionId,
  isValidShortcode,
  isValidCARWithExtensions,
  isValidACIWithExtensions,

  // Extension ID parsing
  parseExtensionId,
  buildExtensionId,
} from './car-string-extensions.js';
