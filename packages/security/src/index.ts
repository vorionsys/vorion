/**
 * @vorion/security - Enterprise Security Modules
 *
 * A comprehensive security toolkit for the Vorion platform including:
 *
 * ## Authentication & Access
 * - WebAuthn/FIDO2 passwordless authentication
 * - Multi-factor authentication (TOTP)
 * - Single Sign-On (OIDC)
 * - Privileged Access Management (JIT, break-glass)
 * - Service-to-service authentication
 *
 * ## Cryptography
 * - FIPS 140-2 compliant crypto operations
 * - Hardware Security Module (HSM) integration
 * - Key Management Service (KMS) abstraction
 * - Field-level encryption
 *
 * ## Detection & Monitoring
 * - SIEM integration (Splunk, Elastic, Loki, Datadog)
 * - Anomaly detection (impossible travel, volume spikes)
 * - Threat intelligence (bot detection, IP reputation)
 * - Multi-channel alerting
 *
 * ## Governance & Policy
 * - Policy engine (OPA-style evaluation)
 * - Zero-knowledge proofs
 * - Trust oracle (vendor risk scoring)
 * - AI governance controls
 *
 * ## Response & Compliance
 * - Incident response with automated playbooks
 * - Data loss prevention
 * - Security headers middleware
 * - API key management
 *
 * @packageDocumentation
 * @module @vorion/security
 */

// =============================================================================
// Re-export all modules for convenience
// Users can also import directly: import { X } from '@vorion/security/webauthn'
// =============================================================================

// Authentication & Access
export * as webauthn from './security/webauthn/index.js';
export * as mfa from './auth/mfa/index.js';
export * as sso from './auth/sso/index.js';
export * as pam from './security/pam/index.js';
export * as serviceAuth from './security/service-auth/index.js';

// Cryptography
export * as crypto from './security/crypto/index.js';
export * as hsm from './security/hsm/index.js';
export * as kms from './security/kms/index.js';
export * as encryption from './security/encryption/index.js';

// Detection & Monitoring
export * as siem from './security/siem/index.js';
export * as anomaly from './security/anomaly/index.js';
export * as threatIntel from './security/threat-intel/index.js';
export * as alerting from './security/alerting/index.js';

// Governance & Policy
export * as policyEngine from './security/policy-engine/index.js';
export * as zkp from './security/zkp/index.js';
export * as trustOracle from './security/trust-oracle/index.js';
export * as aiGovernance from './security/ai-governance/index.js';

// Response & Compliance
export * as incident from './security/incident/index.js';
export * as dlp from './security/dlp/index.js';
export * as headers from './security/headers/index.js';
export * as apiKeys from './security/api-keys/index.js';

// Audit
export * as audit from './audit/index.js';

// Common utilities (for advanced users)
export * as common from './common/index.js';
