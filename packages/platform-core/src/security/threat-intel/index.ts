/**
 * Threat Intelligence Module
 *
 * Provides threat intelligence integration for security monitoring and protection.
 *
 * @packageDocumentation
 * @module security/threat-intel
 */

export {
  // Types
  type IPCategory,
  type IPReputation,
  type IPReport,
  type ExternalAPIConfig,
  type IPReputationConfig,
  type IPReputationMiddlewareOptions,
  // Constants
  DEFAULT_IP_REPUTATION_CONFIG,
  // Classes
  IPReputationService,
  // Middleware
  ipReputationCheck,
  // Singleton functions
  getIPReputationService,
  resetIPReputationService,
} from './ip-reputation.js';
