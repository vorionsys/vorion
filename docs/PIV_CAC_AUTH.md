# PIV/CAC Smart Card Authentication

This document provides comprehensive guidance for configuring and using PIV (Personal Identity Verification) and CAC (Common Access Card) smart card authentication in the Vorion platform.

## Table of Contents

- [Overview](#overview)
- [Configuration Guide](#configuration-guide)
- [Certificate Requirements](#certificate-requirements)
- [DoD PKI Compatibility](#dod-pki-compatibility)
- [Integration Guide](#integration-guide)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)

## Overview

The PIV/CAC authentication module provides enterprise-grade smart card authentication for government and high-security environments. It supports:

- **X.509 Certificate Authentication**: Full certificate chain validation
- **OCSP/CRL Revocation Checking**: Real-time certificate status verification
- **Certificate-to-User Mapping**: Flexible strategies including UPN, SAN, and custom rules
- **Card Removal Detection**: Session termination on card removal with configurable policies
- **PKCS#11 Integration**: Direct smart card reader communication
- **DoD PKI Compatibility**: Full support for Department of Defense PKI certificates

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIV/CAC Authentication Flow                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐       │
│  │ Client  │───▶│ TLS Termination│───▶│ PIV Middleware   │       │
│  │ + Card  │    │ (Certificate)  │    │                   │       │
│  └─────────┘    └──────────────┘    └─────────┬─────────┘       │
│                                               │                  │
│                      ┌───────────────────────┼──────────┐       │
│                      │                       │          │       │
│               ┌──────▼─────┐    ┌───────────▼────┐    ┌─▼────┐  │
│               │Certificate │    │  Revocation    │    │ User │  │
│               │ Validator  │    │   Checker      │    │Mapper│  │
│               │            │    │ (OCSP/CRL)     │    │      │  │
│               └──────┬─────┘    └───────────────┘    └──────┘  │
│                      │                                          │
│               ┌──────▼─────┐    ┌────────────────┐             │
│               │  Trusted   │    │ Card Removal   │             │
│               │   CA Store │    │   Handler      │             │
│               └────────────┘    └────────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Guide

### Basic Configuration

```typescript
import { pivAuthPlugin, type PIVCACConfig } from '@vorionsys/platform-core/auth/piv-cac';

const config: Partial<PIVCACConfig> = {
  // Enable PIV authentication
  enabled: true,

  // Trusted Certificate Authorities
  trustedCAs: [
    {
      name: 'My Root CA',
      certificate: `-----BEGIN CERTIFICATE-----
MIIDxTCCAq2gAwIBAgIQAqxcJmoLQJuPC3nyrkYldzANBgkqh...
-----END CERTIFICATE-----`,
      isRoot: true,
    },
  ],

  // Revocation checking method
  revocationMethod: 'ocsp_with_crl_fallback',

  // Session timeout (8 hours)
  sessionTtl: 28800000,
};

// Register plugin
await fastify.register(pivAuthPlugin, { config });
```

### OCSP Configuration

```typescript
const config: Partial<PIVCACConfig> = {
  ocsp: {
    // Enable OCSP checking
    enabled: true,

    // Optional: Override responder URL (uses AIA if not set)
    responderUrl: 'http://ocsp.example.com',

    // Request timeout
    timeout: 5000,

    // Cache successful responses
    cacheTtl: 3600000, // 1 hour

    // Use nonce in requests (recommended)
    useNonce: true,

    // Soft fail on network errors (not recommended for production)
    softFail: false,
  },
};
```

### CRL Configuration

```typescript
const config: Partial<PIVCACConfig> = {
  crl: {
    // Enable CRL checking
    enabled: true,

    // Optional: Override distribution point URL
    distributionPointUrl: 'http://crl.example.com/ca.crl',

    // Download timeout
    timeout: 30000,

    // Maximum CRL size (10MB default)
    maxSize: 10 * 1024 * 1024,

    // Auto-refresh before expiration
    refreshBefore: 300000, // 5 minutes

    // Check delta CRLs
    checkDelta: true,

    // Soft fail on network errors
    softFail: false,
  },
};
```

### Card Removal Policy

```typescript
const config: Partial<PIVCACConfig> = {
  cardRemovalPolicy: {
    // Terminate session when card is removed
    terminateSession: true,

    // Grace period before termination (0 = immediate)
    gracePeriod: 0,

    // Allow re-authentication within timeout
    allowReauthentication: false,
    reauthenticationTimeout: 60000,

    // Optional: Webhook for card removal events
    notificationWebhook: 'https://api.example.com/hooks/card-removed',
  },
};
```

### Certificate Mapping Rules

```typescript
const config: Partial<PIVCACConfig> = {
  mappingRules: [
    // Map DoD CAC certificates by UPN
    {
      name: 'dod-cac',
      priority: 10,
      issuerPattern: 'DOD|Department of Defense',
      strategy: 'upn',
    },

    // Map by email for corporate certificates
    {
      name: 'corporate-email',
      priority: 20,
      issuerPattern: 'Your Organization CA',
      strategy: 'email',
      tenantId: 'corp-tenant',
    },

    // Custom attribute mapping
    {
      name: 'custom-mapping',
      priority: 30,
      strategy: 'subject_dn',
      userIdAttribute: 'CN',
      attributeMappings: {
        department: 'OU',
        organization: 'O',
      },
    },
  ],
};
```

## Certificate Requirements

### PIV Card Certificates

PIV cards typically contain the following certificates:

| Slot | OID | Purpose |
|------|-----|---------|
| 9A | PIV Authentication | General authentication |
| 9C | Digital Signature | Document signing |
| 9D | Key Management | Key encipherment |
| 9E | Card Authentication | Physical access |

### Required Extensions

For authentication, certificates must have:

1. **Key Usage** (2.5.29.15): `digitalSignature`
2. **Extended Key Usage** (2.5.29.37):
   - `1.3.6.1.5.5.7.3.2` (Client Authentication)
   - `1.3.6.1.4.1.311.20.2.2` (Smart Card Logon) - for Microsoft environments
3. **Subject Alternative Name** (2.5.29.17): Contains UPN or email
4. **Authority Information Access** (1.3.6.1.5.5.7.1.1): OCSP responder URL
5. **CRL Distribution Points** (2.5.29.31): CRL download URL

### Certificate Chain

A valid PIV certificate chain typically includes:

```
Root CA (Trust Anchor)
  └── Intermediate CA 1
        └── Intermediate CA 2 (optional)
              └── End-Entity Certificate (PIV card)
```

All intermediate certificates must be available, either:
- Included in the client's certificate chain
- Configured as trusted CAs
- Available via AIA caIssuers extension

## DoD PKI Compatibility

### Overview

The DoD PKI (Public Key Infrastructure) issues certificates for CAC cards used by military and government personnel. Enable DoD PKI compatibility mode:

```typescript
import { DOD_PKI_CONFIG, type PIVCACConfig } from '@vorionsys/platform-core/auth/piv-cac';

const config: Partial<PIVCACConfig> = {
  ...DOD_PKI_CONFIG,
  enabled: true,
  trustedCAs: [
    // DoD Root CAs
    { name: 'DoD Root CA 3', certificate: '...', isRoot: true },
    { name: 'DoD Root CA 5', certificate: '...', isRoot: true },
    { name: 'DoD Root CA 6', certificate: '...', isRoot: true },
  ],
};
```

### DoD PKI Configuration Preset

The `DOD_PKI_CONFIG` preset includes:

```typescript
{
  dodPkiCompatibility: true,
  fips201Compliance: true,
  revocationMethod: 'ocsp_with_crl_fallback',
  requiredKeyUsage: ['piv_authentication'],
  requiredExtendedKeyUsage: [
    '1.3.6.1.5.5.7.3.2',      // id-kp-clientAuth
    '1.3.6.1.4.1.311.20.2.2', // Microsoft Smart Card Logon
  ],
  requiredPolicies: [
    '2.16.840.1.101.2.1.11.19', // DoD ID SW (Software)
    '2.16.840.1.101.2.1.11.20', // DoD ID HW (Hardware)
  ],
  maxChainDepth: 6,
}
```

### EDIPI Extraction

The Electronic Data Interchange Personal Identifier (EDIPI) is a 10-digit DoD ID number. It's automatically extracted from:

- Subject DN `serialNumber` attribute
- Subject CN (if contains 10-digit number)

```typescript
// Require EDIPI for specific routes
fastify.get('/classified',
  { preHandler: [requirePIVAuth(), requireEDIPI()] },
  handler
);

// Access EDIPI in handler
const edipi = getPIVUser(request)?.edipi;
```

### DoD Root CA Certificates

Download DoD Root CA certificates from:
- https://militarycac.com/dodcerts.htm
- https://crl.gds.disa.mil/

Common DoD Root CAs:
- DoD Root CA 3 (SHA-256)
- DoD Root CA 4 (SHA-384) - deprecated
- DoD Root CA 5 (SHA-384)
- DoD Root CA 6 (SHA-384)

## Integration Guide

### Fastify Plugin

```typescript
import Fastify from 'fastify';
import {
  pivAuthPlugin,
  registerPIVRoutes,
  requirePIVAuth
} from '@vorionsys/platform-core/auth/piv-cac';

const fastify = Fastify({
  logger: true,
  https: {
    // Enable client certificate requests
    requestCert: true,
    // Don't reject unauthorized (handle in middleware)
    rejectUnauthorized: false,
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.crt'),
    ca: fs.readFileSync('trusted-cas.pem'),
  },
});

// Register PIV plugin
await fastify.register(pivAuthPlugin, {
  config: {
    enabled: true,
    trustedCAs: [...],
  },
  skipPaths: ['/health', '/metrics'],
});

// Register PIV routes
await registerPIVRoutes(fastify, { prefix: '/auth/piv' });

// Protected route
fastify.get('/protected',
  { preHandler: [requirePIVAuth()] },
  async (request) => {
    const user = getPIVUser(request);
    return { message: `Hello ${user?.username}` };
  }
);
```

### TLS Configuration (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    ssl_certificate /path/to/server.crt;
    ssl_certificate_key /path/to/server.key;

    # Request client certificate
    ssl_verify_client optional_no_ca;
    ssl_client_certificate /path/to/trusted-cas.pem;

    location / {
        proxy_pass http://backend;

        # Pass client certificate to backend
        proxy_set_header X-Client-Certificate $ssl_client_cert;
        proxy_set_header X-Client-Certificate-Chain $ssl_client_raw_cert;
        proxy_set_header X-Client-Verify $ssl_client_verify;
    }
}
```

### Apache Configuration

```apache
<VirtualHost *:443>
    SSLEngine on
    SSLCertificateFile /path/to/server.crt
    SSLCertificateKeyFile /path/to/server.key

    # Client certificate verification
    SSLCACertificateFile /path/to/trusted-cas.pem
    SSLVerifyClient optional
    SSLVerifyDepth 5

    # Pass to backend
    RequestHeader set X-Client-Certificate "%{SSL_CLIENT_CERT}s"
    RequestHeader set X-Client-Verify "%{SSL_CLIENT_VERIFY}s"
</VirtualHost>
```

## API Reference

### Authentication Endpoints

#### POST /auth/piv/authenticate

Authenticate with a PIV/CAC certificate.

**Request Body:**
```json
{
  "clientCertificate": "-----BEGIN CERTIFICATE-----...",
  "certificateChain": "-----BEGIN CERTIFICATE-----...",
  "pin": "optional-pin"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "userId": "user@example.com",
    "username": "user",
    "email": "user@example.com",
    "edipi": "1234567890",
    "tenantId": "default"
  },
  "sessionId": "abc123...",
  "expiresAt": "2024-01-01T08:00:00Z",
  "accessToken": "eyJ...",
  "refreshToken": "xyz..."
}
```

#### POST /auth/piv/challenge

Generate a challenge for card signing.

**Response:**
```json
{
  "challengeId": "challenge-id",
  "challenge": "base64-encoded-challenge",
  "expiresAt": "2024-01-01T00:05:00Z",
  "instructions": "Sign this challenge with your PIV card"
}
```

#### GET /auth/piv/status

Get current PIV authentication status.

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "userId": "user@example.com",
    "edipi": "1234567890"
  },
  "certificate": {
    "subject": "John Doe",
    "issuer": "DoD CA",
    "fingerprint": "abc123...",
    "notAfter": "2025-01-01T00:00:00Z"
  },
  "session": {
    "sessionId": "session-id",
    "state": "active",
    "expiresAt": "2024-01-01T08:00:00Z"
  }
}
```

### Middleware Functions

```typescript
// Require PIV authentication
requirePIVAuth()

// Require specific certificate attribute
requireCertificateAttribute('department', /Engineering/)

// Require EDIPI (DoD ID)
requireEDIPI()
```

### Request Helpers

```typescript
// Get full PIV context
const pivAuth = getPIVAuth(request);

// Check if authenticated
if (hasPIVAuth(request)) { ... }

// Get user identity
const user = getPIVUser(request);

// Get user ID
const userId = getPIVUserId(request);

// Get certificate fingerprint
const fingerprint = getCertificateFingerprint(request);

// Get EDIPI
const edipi = getEDIPI(request);
```

## Troubleshooting

### Common Issues

#### Certificate Not Being Sent

**Symptoms:** Client certificate not received by server

**Solutions:**
1. Verify browser has certificate installed
2. Check TLS configuration requests client certs
3. Ensure certificate is in trusted store
4. Check browser certificate selection prompt

#### OCSP Check Failing

**Symptoms:** `OCSP_CHECK_FAILED` error

**Solutions:**
1. Verify network connectivity to OCSP responder
2. Check AIA extension contains valid OCSP URL
3. Increase timeout if responder is slow
4. Enable `softFail` for testing (not production)

```typescript
ocsp: {
  timeout: 10000,  // Increase timeout
  softFail: true,  // For testing only
}
```

#### CRL Download Failing

**Symptoms:** `CRL_CHECK_FAILED` error

**Solutions:**
1. Verify CRL URL is accessible
2. Check CRL size is within limits
3. Verify CRL is not expired
4. Check for proxy/firewall issues

#### Certificate Chain Invalid

**Symptoms:** `CERTIFICATE_CHAIN_INVALID` error

**Solutions:**
1. Include all intermediate certificates
2. Verify root CA is in trusted store
3. Check certificate order (end-entity first)
4. Verify chain depth is within limits

#### User Mapping Failed

**Symptoms:** `USER_MAPPING_FAILED` error

**Solutions:**
1. Check certificate has required attributes (UPN, email, etc.)
2. Verify mapping rules match certificate issuer
3. Add fallback mapping rules
4. Check custom mapper function

### Debug Logging

Enable debug logging:

```typescript
import { createLogger } from '@vorionsys/platform-core/common';

// Set log level to debug
process.env.LOG_LEVEL = 'debug';

// Or configure logger
const logger = createLogger({
  component: 'piv-debug',
  level: 'debug'
});
```

### Testing with Self-Signed Certificates

For development/testing:

```bash
# Generate test CA
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/CN=Test CA"

# Generate client certificate
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=Test User/emailAddress=test@example.com"
openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt

# Convert to PKCS#12 for browser import
openssl pkcs12 -export -out client.p12 -inkey client.key -in client.crt -certfile ca.crt
```

## Security Considerations

### Certificate Validation

- **Always validate** the full certificate chain
- **Always check** revocation status (OCSP or CRL)
- **Never disable** revocation checking in production
- **Verify** certificate purpose (Extended Key Usage)
- **Check** certificate policies for high-security environments

### Session Management

- **Bind sessions** to certificate fingerprint
- **Terminate sessions** on card removal
- **Set appropriate** session timeouts
- **Implement** idle timeout
- **Log** all authentication events

### PKCS#11 Security

- **Protect** PIN during entry
- **Never log** PIN values
- **Use** hardware security modules when available
- **Implement** card reader monitoring

### Network Security

- **Use TLS 1.2+** for all communications
- **Verify** OCSP/CRL server certificates
- **Implement** connection timeouts
- **Cache** revocation responses appropriately

### Audit Logging

```typescript
// All authentication events are logged
// - Successful authentications
// - Failed authentications
// - Certificate validation failures
// - Revocation check results
// - Session terminations
// - Card removal events
```

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Verify certificate chain with `openssl verify`
4. Test OCSP/CRL endpoints manually
5. Contact security team for production issues
