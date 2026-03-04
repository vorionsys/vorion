# Vorion API Documentation

## Overview

The Vorion API provides programmatic access to the AI governance platform, enabling secure agent management, intent processing, trust scoring, and comprehensive RBAC controls.

## Base URL Structure

```
Production:  https://api.vorion.io/api/v1
Staging:     https://staging-api.vorion.io/api/v1
Development: http://localhost:3000/api/v1
```

All API endpoints are prefixed with `/api/v1` for version 1 of the API.

## Authentication Requirements

### JWT Bearer Tokens

All API requests require authentication via JWT bearer tokens:

```http
Authorization: Bearer <access_token>
```

Tokens are obtained through the authentication endpoints and include:
- `sub`: User identifier
- `tenantId`: Tenant context for multi-tenancy isolation
- `jti`: Unique token identifier for revocation tracking
- `sessionId`: Session identifier for device/session management
- `exp`: Token expiration timestamp

### DPoP (Demonstrating Proof-of-Possession)

For Trust Tiers T2 and above, DPoP is required per RFC 9449. DPoP binds access tokens to a cryptographic key pair, preventing token theft and replay attacks.

**Required Headers:**
```http
Authorization: Bearer <access_token>
DPoP: <dpop_proof_jwt>
```

**DPoP Proof Requirements:**
- Algorithm: ES256 (ES384, ES512 also supported)
- Maximum proof age: 60 seconds
- Clock skew tolerance: 5 seconds
- JTI uniqueness enforced via Redis-backed cache

See [Authentication Documentation](./authentication.md#dpop-requirements) for implementation details.

### Multi-Factor Authentication

MFA is supported for enhanced security. When MFA is enabled:
1. Initial login returns a partial token
2. MFA challenge must be completed
3. Full access token issued upon successful verification

See [Authentication Documentation](./authentication.md#mfa-endpoints) for MFA flow details.

## Rate Limiting

Rate limits are applied per endpoint category:

| Category | Limit | Window |
|----------|-------|--------|
| Read operations | 100 requests | 60 seconds |
| Write operations | 30 requests | 60 seconds |
| Admin operations | 10 requests | 60 seconds |
| Authentication (logout) | 10 requests | 60 seconds |
| Revoke all tokens | 3 requests | 3600 seconds (1 hour) |
| Token refresh | 10 requests | 60 seconds |

**Rate Limit Headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706000000
```

When rate limited, the API returns:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

## Error Handling

### Error Response Format

All errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    }
  }
}
```

### Common Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 401 | `INVALID_PASSWORD` | Password verification failed |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource already exists |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Server error |
| 501 | `NOT_IMPLEMENTED` | Feature not available |

### MFA-Specific Error Codes

| Code | Description |
|------|-------------|
| `MFA_ENROLLMENT_EXPIRED` | MFA enrollment session expired |
| `MFA_CHALLENGE_EXPIRED` | MFA challenge expired |
| `MFA_TOO_MANY_ATTEMPTS` | Too many verification attempts |
| `MFA_INVALID_CODE` | Invalid verification code |
| `MFA_VERIFICATION_FAILED` | MFA verification failed |

### DPoP Error Codes

| Code | Description |
|------|-------------|
| `DPOP_ERROR` | Generic DPoP error |
| `INVALID_FORMAT` | Invalid DPoP proof format |
| `INVALID_SIGNATURE` | DPoP signature verification failed |
| `EXPIRED` | DPoP proof expired |
| `REPLAY` | DPoP proof replay detected |
| `METHOD_MISMATCH` | HTTP method mismatch |
| `URI_MISMATCH` | Target URI mismatch |

## Versioning

The API uses URL path versioning:

```
/api/v1/...  # Version 1 (current)
/api/v2/...  # Version 2 (future)
```

**Version Lifecycle:**
- **Current**: Fully supported with new features
- **Deprecated**: Supported but no new features, migration recommended
- **Sunset**: Read-only access, then removed

Breaking changes result in a new major version. Non-breaking additions are made within the current version.

## Request/Response Format

### Content Type

All requests and responses use JSON:

```http
Content-Type: application/json
Accept: application/json
```

### Pagination

List endpoints support pagination via query parameters:

```
GET /api/v1/rbac/roles?limit=50&offset=0
```

**Parameters:**
- `limit`: Maximum items to return (default: 50, max: 100)
- `offset`: Number of items to skip (default: 0)

**Response:**
```json
{
  "roles": [...],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

### Filtering

Many endpoints support filtering via query parameters:

```
GET /api/v1/agents?tier=3&limit=20
GET /api/v1/intents/agent/{agentId}?status=approved&limit=50
```

## Tenant Isolation

All API operations are scoped to the authenticated user's tenant. The `tenantId` is extracted from the JWT token and cannot be overridden via request parameters.

**Security Note:** Tenant ID is never accepted from request body or URL parameters to prevent tenant-spoofing attacks.

## API Endpoints Summary

| Category | Base Path | Documentation |
|----------|-----------|---------------|
| Authentication | `/api/v1/auth/*` | [authentication.md](./authentication.md) |
| MFA | `/api/v1/mfa/*` | [authentication.md](./authentication.md#mfa-endpoints) |
| Intents | `/api/v1/intents/*` | [intents.md](./intents.md) |
| Agents | `/api/v1/agents/*` | [intents.md](./intents.md#agent-management) |
| Trust | `/api/v1/trust/*` | [intents.md](./intents.md#trust-management) |
| Proofs | `/api/v1/proofs/*` | [intents.md](./intents.md#proof-verification) |
| RBAC | `/api/v1/rbac/*` | [rbac.md](./rbac.md) |
| Extensions | `/api/v1/extensions/*` | [extensions.md](./extensions.md) |

## SDK Support

Official SDKs are available for:
- TypeScript/JavaScript: `@vorionsys/sdk`
- Python: `vorion-sdk` (coming soon)

## Support

- Documentation: https://docs.vorion.io
- API Status: https://status.vorion.io
- Support: support@vorion.io
