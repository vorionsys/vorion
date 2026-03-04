/**
 * SSO/OIDC Type Definitions for Vorion Platform
 *
 * TypeScript interfaces for OIDC authentication flow.
 * This module has no dependency on openid-client to allow static type usage
 * without ESM import issues.
 *
 * @module auth/sso/types
 */

import { z } from 'zod';

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Supported OIDC provider types
 */
export type OIDCProviderType = 'okta' | 'azure_ad' | 'google' | 'generic';

/**
 * Tenant mapping strategy - how to determine tenant from SSO identity
 */
export type TenantMappingStrategy = 'domain' | 'claim' | 'static';

/**
 * OIDC Provider configuration
 */
export interface OIDCProviderConfig {
  /** Unique identifier for this provider */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider type (okta, azure_ad, google, generic) */
  type: OIDCProviderType;
  /** Whether this provider is enabled */
  enabled: boolean;

  // OIDC Configuration
  /** Issuer URL (discovery endpoint base) */
  issuer: string;
  /** Client ID from the identity provider */
  clientId: string;
  /** Client secret (for confidential clients) */
  clientSecret?: string;
  /** Redirect URI for authorization callback */
  redirectUri: string;
  /** OIDC scopes to request */
  scopes: string[];
  /** Response type (default: 'code') */
  responseType?: string;

  // PKCE Configuration
  /** Enable PKCE (Proof Key for Code Exchange) - recommended for all flows */
  pkceEnabled: boolean;

  // Token Configuration
  /** Access token lifetime in seconds (if configurable) */
  accessTokenLifetime?: number;
  /** Refresh token lifetime in seconds */
  refreshTokenLifetime?: number;
  /** Whether to request refresh tokens */
  requestRefreshToken: boolean;

  // Tenant Mapping
  /** Strategy for mapping SSO identity to Vorion tenant */
  tenantMapping: TenantMappingStrategy;
  /** For 'static' strategy: the fixed tenant ID */
  staticTenantId?: string;
  /** For 'claim' strategy: the claim name containing tenant ID */
  tenantClaimName?: string;
  /** For 'domain' strategy: mapping of email domains to tenant IDs */
  domainTenantMap?: Record<string, string>;

  // JIT Provisioning
  /** Enable Just-In-Time user provisioning */
  jitProvisioningEnabled: boolean;
  /** Default roles to assign to JIT-provisioned users */
  jitDefaultRoles?: string[];
  /** Claim mappings for JIT provisioning */
  jitClaimMappings?: JITClaimMappings;

  // Additional Settings
  /** Additional parameters to include in authorization request */
  additionalAuthParams?: Record<string, string>;
  /** Custom logout URL (if not using standard OIDC logout) */
  logoutUrl?: string;
  /** Whether to use front-channel logout */
  frontChannelLogout?: boolean;
  /** Allowed clock skew in seconds for token validation */
  clockSkewSeconds?: number;
}

/**
 * Claim mappings for JIT provisioning
 */
export interface JITClaimMappings {
  /** Claim for user's email */
  email?: string;
  /** Claim for user's first name */
  firstName?: string;
  /** Claim for user's last name */
  lastName?: string;
  /** Claim for user's display name */
  displayName?: string;
  /** Claim for user's groups/roles */
  groups?: string;
  /** Custom claim mappings */
  custom?: Record<string, string>;
}

// =============================================================================
// Authentication Flow Types
// =============================================================================

/**
 * Authorization request state - stored during OAuth flow
 */
export interface AuthorizationState {
  /** Random state parameter for CSRF protection */
  state: string;
  /** Nonce for ID token validation */
  nonce: string;
  /** PKCE code verifier (if PKCE is enabled) */
  codeVerifier?: string;
  /** Provider ID this state belongs to */
  providerId: string;
  /** Original URL to redirect to after authentication */
  returnUrl?: string;
  /** Tenant ID if known before authentication */
  tenantId?: string;
  /** Timestamp when this state was created */
  createdAt: Date;
  /** Timestamp when this state expires */
  expiresAt: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Authorization URL result
 */
export interface AuthorizationUrlResult {
  /** The URL to redirect the user to */
  url: string;
  /** The state object to store for validation */
  state: AuthorizationState;
}

/**
 * Token exchange request - parameters from callback
 */
export interface TokenExchangeRequest {
  /** Authorization code from callback */
  code: string;
  /** State parameter from callback */
  state: string;
  /** The stored authorization state for validation */
  storedState: AuthorizationState;
}

/**
 * OIDC tokens received from provider
 */
export interface OIDCTokenSet {
  /** Access token for API calls */
  accessToken: string;
  /** Token type (usually 'Bearer') */
  tokenType: string;
  /** Access token expiration time */
  expiresAt?: Date;
  /** ID token (JWT) */
  idToken?: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Scopes granted by the provider */
  scope?: string;
}

/**
 * Parsed ID token claims
 */
export interface IDTokenClaims {
  /** Issuer */
  iss: string;
  /** Subject (unique user identifier at provider) */
  sub: string;
  /** Audience(s) */
  aud: string | string[];
  /** Expiration time (unix timestamp) */
  exp: number;
  /** Issued at time (unix timestamp) */
  iat: number;
  /** Authentication time (unix timestamp) */
  auth_time?: number;
  /** Nonce */
  nonce?: string;
  /** Access token hash */
  at_hash?: string;
  /** Authorized party */
  azp?: string;

  // Standard claims
  /** User's email */
  email?: string;
  /** Whether email is verified */
  email_verified?: boolean;
  /** User's full name */
  name?: string;
  /** User's given name */
  given_name?: string;
  /** User's family name */
  family_name?: string;
  /** User's preferred username */
  preferred_username?: string;
  /** URL of user's profile picture */
  picture?: string;
  /** User's locale */
  locale?: string;
  /** User's timezone */
  zoneinfo?: string;

  // Provider-specific claims (indexed)
  [key: string]: unknown;
}

/**
 * User info from OIDC userinfo endpoint
 */
export interface OIDCUserInfo {
  /** Subject (same as in ID token) */
  sub: string;
  /** User's email */
  email?: string;
  /** Whether email is verified */
  email_verified?: boolean;
  /** User's full name */
  name?: string;
  /** User's given name */
  given_name?: string;
  /** User's family name */
  family_name?: string;
  /** User's preferred username */
  preferred_username?: string;
  /** URL of user's profile picture */
  picture?: string;
  /** Additional claims */
  [key: string]: unknown;
}

/**
 * Token exchange result
 */
export interface TokenExchangeResult {
  /** The token set */
  tokens: OIDCTokenSet;
  /** Parsed ID token claims */
  claims: IDTokenClaims;
  /** User info (if requested) */
  userInfo?: OIDCUserInfo;
  /** Resolved tenant ID */
  tenantId?: string;
  /** Whether this is a new user (JIT provisioned) */
  isNewUser?: boolean;
  /** User's Vorion user ID (if mapped) */
  userId?: string;
}

/**
 * Token refresh result
 */
export interface TokenRefreshResult {
  /** New token set */
  tokens: OIDCTokenSet;
  /** Updated claims if ID token was refreshed */
  claims?: IDTokenClaims;
}

// =============================================================================
// User Provisioning Types
// =============================================================================

/**
 * JIT provisioned user data
 */
export interface JITProvisionedUser {
  /** External subject ID from identity provider */
  externalSubjectId: string;
  /** Provider ID this user was provisioned from */
  providerId: string;
  /** User's email */
  email: string;
  /** User's first name */
  firstName?: string;
  /** User's last name */
  lastName?: string;
  /** User's display name */
  displayName?: string;
  /** Assigned roles */
  roles: string[];
  /** Resolved tenant ID */
  tenantId: string;
  /** Additional attributes from claims */
  attributes: Record<string, unknown>;
  /** When the user was provisioned */
  provisionedAt: Date;
}

/**
 * SSO session data stored after authentication
 */
export interface SSOSession {
  /** Session ID */
  id: string;
  /** Vorion user ID */
  userId: string;
  /** Provider ID used for authentication */
  providerId: string;
  /** External subject ID from provider */
  externalSubjectId: string;
  /** Tenant ID */
  tenantId: string;
  /** Current token set */
  tokens: OIDCTokenSet;
  /** ID token claims */
  claims: IDTokenClaims;
  /** When the session was created */
  createdAt: Date;
  /** When the session was last refreshed */
  lastRefreshedAt: Date;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Zod schema for provider configuration
 */
export const OIDCProviderConfigSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  type: z.enum(['okta', 'azure_ad', 'google', 'generic']),
  enabled: z.boolean(),

  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).min(1),
  responseType: z.string().default('code'),

  pkceEnabled: z.boolean().default(true),

  accessTokenLifetime: z.number().int().positive().optional(),
  refreshTokenLifetime: z.number().int().positive().optional(),
  requestRefreshToken: z.boolean().default(true),

  tenantMapping: z.enum(['domain', 'claim', 'static']),
  staticTenantId: z.string().optional(),
  tenantClaimName: z.string().optional(),
  domainTenantMap: z.record(z.string()).optional(),

  jitProvisioningEnabled: z.boolean().default(false),
  jitDefaultRoles: z.array(z.string()).optional(),
  jitClaimMappings: z
    .object({
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      displayName: z.string().optional(),
      groups: z.string().optional(),
      custom: z.record(z.string()).optional(),
    })
    .optional(),

  additionalAuthParams: z.record(z.string()).optional(),
  logoutUrl: z.string().url().optional(),
  frontChannelLogout: z.boolean().optional(),
  clockSkewSeconds: z.number().int().min(0).max(300).default(60),
});

/**
 * Zod schema for authorization callback parameters
 */
export const AuthorizationCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// =============================================================================
// Error Types
// =============================================================================

/**
 * SSO-specific error codes
 */
export type SSOErrorCode =
  | 'SSO_PROVIDER_NOT_FOUND'
  | 'SSO_PROVIDER_DISABLED'
  | 'SSO_DISCOVERY_FAILED'
  | 'SSO_STATE_INVALID'
  | 'SSO_STATE_EXPIRED'
  | 'SSO_TOKEN_EXCHANGE_FAILED'
  | 'SSO_TOKEN_VALIDATION_FAILED'
  | 'SSO_TOKEN_REFRESH_FAILED'
  | 'SSO_TOKEN_REVOCATION_FAILED'
  | 'SSO_USERINFO_FAILED'
  | 'SSO_TENANT_MAPPING_FAILED'
  | 'SSO_JIT_PROVISIONING_FAILED'
  | 'SSO_SESSION_NOT_FOUND'
  | 'SSO_CONFIGURATION_ERROR';

/**
 * SSO error details
 */
export interface SSOErrorDetails {
  code: SSOErrorCode;
  providerId?: string;
  originalError?: string;
  context?: Record<string, unknown>;
}

// =============================================================================
// Event Types (for audit logging)
// =============================================================================

/**
 * SSO event types for audit logging
 */
export type SSOEventType =
  | 'sso.auth.started'
  | 'sso.auth.completed'
  | 'sso.auth.failed'
  | 'sso.token.refreshed'
  | 'sso.token.revoked'
  | 'sso.session.created'
  | 'sso.session.terminated'
  | 'sso.user.provisioned'
  | 'sso.user.updated';

/**
 * SSO audit event
 */
export interface SSOAuditEvent {
  type: SSOEventType;
  timestamp: Date;
  providerId: string;
  userId?: string;
  tenantId?: string;
  externalSubjectId?: string;
  metadata?: Record<string, unknown>;
  error?: SSOErrorDetails;
}

// =============================================================================
// Manager Configuration
// =============================================================================

/**
 * SSOManager configuration
 */
export interface SSOManagerConfig {
  /** State expiration time in seconds */
  stateExpirationSeconds: number;
  /** Whether to fetch user info after token exchange */
  fetchUserInfo: boolean;
  /** Whether to validate ID token claims */
  validateClaims: boolean;
  /** Default scopes to request if not specified in provider config */
  defaultScopes: string[];
  /** Maximum number of concurrent provider discoveries */
  maxConcurrentDiscoveries: number;
  /** Discovery cache TTL in seconds */
  discoveryCacheTtlSeconds: number;
  /** Callback for audit events */
  onAuditEvent?: (event: SSOAuditEvent) => void | Promise<void>;
  /** Callback for JIT user provisioning */
  onProvisionUser?: (user: JITProvisionedUser) => Promise<string>;
  /** Callback for looking up existing user by external ID */
  onLookupUser?: (
    providerId: string,
    externalSubjectId: string
  ) => Promise<{ userId: string; tenantId: string } | null>;
}

/**
 * Default SSOManager configuration
 */
export const DEFAULT_SSO_MANAGER_CONFIG: SSOManagerConfig = {
  stateExpirationSeconds: 600, // 10 minutes
  fetchUserInfo: true,
  validateClaims: true,
  defaultScopes: ['openid', 'profile', 'email'],
  maxConcurrentDiscoveries: 5,
  discoveryCacheTtlSeconds: 3600, // 1 hour
};
