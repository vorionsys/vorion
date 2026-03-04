# Vorion Production Hardening Guide

**Document Version:** 1.0.0
**Last Updated:** 2026-01-29
**Classification:** Vorion Internal

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Environment Variable Checklist](#2-environment-variable-checklist)
3. [Required Security Configurations](#3-required-security-configurations)
4. [Tier-Specific Recommendations](#4-tier-specific-recommendations)
5. [Security Header Configuration](#5-security-header-configuration)
6. [Rate Limiting Configuration](#6-rate-limiting-configuration)
7. [Logging Configuration](#7-logging-configuration)
8. [Backup and Recovery](#8-backup-and-recovery)
9. [Monitoring and Alerting](#9-monitoring-and-alerting)
10. [Pre-Deployment Checklist](#10-pre-deployment-checklist)
11. [Security Validation](#11-security-validation)

---

## 1. Introduction

### 1.1 Purpose

This guide provides comprehensive hardening recommendations for deploying Vorion in production environments. Following these guidelines ensures maximum security posture while maintaining operational functionality.

### 1.2 Audience

- DevOps Engineers
- Security Engineers
- Platform Administrators
- Compliance Officers

### 1.3 Security Tiers

Vorion supports three deployment tiers with increasing security requirements:

| Tier | Use Case | Security Level | Key Features |
|------|----------|----------------|--------------|
| **Personal** | Individual developers, small projects | Standard | Basic auth, encryption at rest |
| **Business** | Teams, commercial applications | Enhanced | SSO, MFA, advanced audit |
| **Enterprise** | Regulated industries, government | Maximum | HSM, FIPS, air-gapped support |

---

## 2. Environment Variable Checklist

### 2.1 Critical Security Variables

These variables **MUST** be configured for any production deployment:

```bash
# =============================================================================
# CRITICAL: These must be set in production
# =============================================================================

# Core Security Mode
VORION_ENV=production                    # REQUIRED: Must be 'production'
VORION_ALLOW_INSECURE_DEV=false          # REQUIRED: Must be 'false' in production

# JWT Configuration
VORION_JWT_SECRET=<256-bit-random>       # REQUIRED: Generate with: openssl rand -base64 48
VORION_JWT_ALGORITHM=RS256               # REQUIRED: RS256 or ES256
VORION_JWT_EXPIRES_IN=15m                # REQUIRED: Maximum 15 minutes recommended
VORION_JWT_ISSUER=https://auth.yourcompany.com  # REQUIRED: Your auth domain

# Encryption Keys
VORION_ENCRYPTION_KEY=<256-bit-key>      # REQUIRED: Generate with: openssl rand -hex 32
VORION_SIGNING_KEY=<private-key-pem>     # REQUIRED: Ed25519 or ECDSA P-256 private key

# Database Security
VORION_DB_SSL=true                       # REQUIRED: Must be 'true'
VORION_DB_SSL_REJECT_UNAUTHORIZED=true   # REQUIRED: Must be 'true'
VORION_DB_CONNECTION_LIMIT=50            # RECOMMENDED: Limit connections

# Redis Security (if using Redis)
VORION_REDIS_TLS=true                    # REQUIRED: Must be 'true'
VORION_REDIS_PASSWORD=<strong-password>  # REQUIRED: Strong password
```

### 2.2 Authentication Variables

```bash
# =============================================================================
# Authentication Configuration
# =============================================================================

# Session Management
VORION_SESSION_SECRET=<256-bit-random>   # REQUIRED: Generate with: openssl rand -base64 48
VORION_SESSION_MAX_AGE=86400000          # 24 hours in milliseconds
VORION_SESSION_SECURE=true               # REQUIRED: Must be 'true' in production
VORION_SESSION_SAME_SITE=strict          # REQUIRED: 'strict' or 'lax'

# MFA Settings
VORION_MFA_ENABLED=true                  # REQUIRED for Business/Enterprise
VORION_MFA_REQUIRED_ROLES=admin,security # Roles requiring MFA
VORION_MFA_TOTP_ISSUER=Vorion           # Issuer name for TOTP apps

# SSO Configuration (if using SSO)
VORION_SSO_ENABLED=true                  # Enable SSO
VORION_SSO_ALLOW_LOCAL_AUTH=false        # Disable password auth when SSO enabled
VORION_OIDC_CLIENT_ID=<client-id>        # OIDC client ID
VORION_OIDC_CLIENT_SECRET=<secret>       # OIDC client secret
VORION_OIDC_ISSUER=https://idp.yourcompany.com  # Identity provider URL

# API Keys
VORION_API_KEY_ROTATION_DAYS=90          # Maximum key age
VORION_API_KEY_MIN_ENTROPY=256           # Minimum key entropy in bits
```

### 2.3 Network Security Variables

```bash
# =============================================================================
# Network Security Configuration
# =============================================================================

# TLS Configuration
VORION_TLS_MIN_VERSION=TLSv1.3           # REQUIRED: Minimum TLS 1.3
VORION_TLS_CERT_PATH=/certs/server.crt   # Path to TLS certificate
VORION_TLS_KEY_PATH=/certs/server.key    # Path to TLS private key

# CORS Configuration
VORION_CORS_ORIGINS=https://app.yourcompany.com  # Allowed origins (comma-separated)
VORION_CORS_CREDENTIALS=true             # Allow credentials
VORION_CORS_MAX_AGE=86400                # Preflight cache duration

# Rate Limiting
VORION_RATE_LIMIT_ENABLED=true           # REQUIRED: Enable rate limiting
VORION_RATE_LIMIT_WINDOW_MS=60000        # 1 minute window
VORION_RATE_LIMIT_MAX_REQUESTS=100       # Max requests per window

# Trusted Proxies
VORION_TRUST_PROXY=true                  # Trust X-Forwarded-* headers
VORION_TRUSTED_PROXY_IPS=10.0.0.0/8      # Trusted proxy IP ranges
```

### 2.4 Audit and Compliance Variables

```bash
# =============================================================================
# Audit and Compliance Configuration
# =============================================================================

# PROOF Chain
VORION_PROOF_ENABLED=true                # REQUIRED: Enable audit chain
VORION_PROOF_SIGNING_KEY=<hsm-key-id>    # HSM key for signing (Enterprise)
VORION_PROOF_RETENTION_DAYS=2555         # 7 years default

# Logging
VORION_LOG_LEVEL=info                    # Log level: error, warn, info, debug
VORION_LOG_FORMAT=json                   # REQUIRED: JSON format for production
VORION_LOG_REDACT_SECRETS=true           # REQUIRED: Redact sensitive data
VORION_LOG_INCLUDE_REQUEST_ID=true       # Include request IDs

# Compliance Mode
VORION_FIPS_MODE=false                   # Enable FIPS 140-2 mode (Enterprise)
VORION_AUDIT_ALL_REQUESTS=true           # Audit all requests (compliance)
```

### 2.5 Generate Secrets Script

Use this script to generate required secrets:

```bash
#!/bin/bash
# generate-secrets.sh - Generate production secrets for Vorion

echo "Generating Vorion production secrets..."

# JWT Secret (384 bits / 48 bytes)
JWT_SECRET=$(openssl rand -base64 48)
echo "VORION_JWT_SECRET=${JWT_SECRET}"

# Encryption Key (256 bits / 32 bytes hex)
ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "VORION_ENCRYPTION_KEY=${ENCRYPTION_KEY}"

# Session Secret (384 bits / 48 bytes)
SESSION_SECRET=$(openssl rand -base64 48)
echo "VORION_SESSION_SECRET=${SESSION_SECRET}"

# Generate Ed25519 signing key pair
openssl genpkey -algorithm ed25519 -out vorion-signing-key.pem
openssl pkey -in vorion-signing-key.pem -pubout -out vorion-signing-key.pub

echo ""
echo "Ed25519 signing key pair generated:"
echo "  Private key: vorion-signing-key.pem"
echo "  Public key:  vorion-signing-key.pub"
echo ""
echo "IMPORTANT: Store the private key securely and never commit it to version control."
```

---

## 3. Required Security Configurations

### 3.1 Mandatory Security Controls

The following controls must be enabled in any production deployment:

| Control | Configuration | Verification |
|---------|---------------|--------------|
| TLS 1.3 | `VORION_TLS_MIN_VERSION=TLSv1.3` | `openssl s_client -connect host:443` |
| HTTPS Only | `VORION_HTTPS_REDIRECT=true` | Check redirect on HTTP |
| Secure Cookies | `VORION_SESSION_SECURE=true` | Inspect Set-Cookie headers |
| CSRF Protection | `VORION_CSRF_ENABLED=true` | Test CSRF token validation |
| Rate Limiting | `VORION_RATE_LIMIT_ENABLED=true` | Load test endpoints |
| Input Validation | Built-in (Zod schemas) | Security scan |
| Output Encoding | Built-in (context-aware) | XSS testing |
| SQL Injection Protection | Built-in (parameterized) | SQLi testing |

### 3.2 Cryptographic Requirements

| Requirement | Standard | Configuration |
|-------------|----------|---------------|
| Symmetric Encryption | AES-256-GCM | Default |
| Asymmetric Encryption | RSA-4096 or ECDSA P-256 | `VORION_JWT_ALGORITHM` |
| Key Derivation | PBKDF2-SHA256 (100k+ iterations) | Default |
| Password Hashing | Argon2id | Default |
| Digital Signatures | Ed25519 or ECDSA P-256 | `VORION_SIGNING_KEY` |

### 3.3 Access Control Requirements

```yaml
# Required access control configuration
access_control:
  # Require authentication for all API endpoints
  require_authentication: true

  # Default deny for all actions
  default_policy: deny

  # Require MFA for sensitive operations
  mfa_required_operations:
    - password_change
    - mfa_enrollment
    - api_key_creation
    - security_settings
    - data_export

  # Session requirements
  session:
    max_concurrent: 5
    inactivity_timeout: 3600  # 1 hour
    absolute_timeout: 86400   # 24 hours
    bind_to_ip: true
```

---

## 4. Tier-Specific Recommendations

### 4.1 Development Environment

**Purpose**: Local development and testing only

```bash
# .env.development
VORION_ENV=development
VORION_ALLOW_INSECURE_DEV=true           # OK for development only
VORION_LOG_LEVEL=debug
VORION_DB_SSL=false                      # OK for local development
VORION_RATE_LIMIT_ENABLED=false          # OK for development
VORION_CSRF_ENABLED=false                # OK for local testing
```

**Security Notes**:
- Never use development configuration in production
- Development secrets should be different from production
- Development environment should be isolated from production network

### 4.2 Staging Environment

**Purpose**: Pre-production testing with production-like configuration

```bash
# .env.staging
VORION_ENV=staging
VORION_ALLOW_INSECURE_DEV=false          # REQUIRED: Must be false
VORION_LOG_LEVEL=info

# Use production-equivalent security
VORION_DB_SSL=true
VORION_REDIS_TLS=true
VORION_RATE_LIMIT_ENABLED=true
VORION_CSRF_ENABLED=true
VORION_MFA_ENABLED=true

# Staging-specific
VORION_JWT_SECRET=<staging-specific>     # Different from production
VORION_ENCRYPTION_KEY=<staging-specific> # Different from production

# Allow internal testing
VORION_CORS_ORIGINS=https://staging.yourcompany.com
```

**Security Notes**:
- Staging should mirror production security controls
- Use separate secrets from production
- Data in staging should be anonymized/synthetic
- Access should be restricted to authorized personnel

### 4.3 Production Environment - Personal Tier

**Purpose**: Individual developers, small projects

```bash
# .env.production.personal
VORION_ENV=production
VORION_ALLOW_INSECURE_DEV=false

# Required Security
VORION_TLS_MIN_VERSION=TLSv1.3
VORION_DB_SSL=true
VORION_REDIS_TLS=true
VORION_RATE_LIMIT_ENABLED=true
VORION_CSRF_ENABLED=true
VORION_PROOF_ENABLED=true

# Authentication
VORION_JWT_ALGORITHM=RS256
VORION_JWT_EXPIRES_IN=15m
VORION_SESSION_SECURE=true
VORION_SESSION_SAME_SITE=strict

# Logging
VORION_LOG_LEVEL=info
VORION_LOG_FORMAT=json
VORION_LOG_REDACT_SECRETS=true

# Optional for Personal tier
VORION_MFA_ENABLED=false                 # Recommended but optional
VORION_SSO_ENABLED=false                 # Not typically needed
```

### 4.4 Production Environment - Business Tier

**Purpose**: Teams, commercial applications, multi-tenant deployments

```bash
# .env.production.business
VORION_ENV=production
VORION_ALLOW_INSECURE_DEV=false

# Required Security (all Personal tier requirements plus:)
VORION_TLS_MIN_VERSION=TLSv1.3
VORION_DB_SSL=true
VORION_DB_SSL_REJECT_UNAUTHORIZED=true
VORION_REDIS_TLS=true
VORION_RATE_LIMIT_ENABLED=true
VORION_CSRF_ENABLED=true
VORION_PROOF_ENABLED=true

# Enhanced Authentication
VORION_MFA_ENABLED=true                  # REQUIRED for Business
VORION_MFA_REQUIRED_ROLES=admin,security
VORION_SSO_ENABLED=true                  # Recommended
VORION_SSO_ALLOW_LOCAL_AUTH=false        # SSO only (recommended)

# Session Hardening
VORION_SESSION_MAX_AGE=28800000          # 8 hours
VORION_SESSION_MAX_CONCURRENT=3
VORION_SESSION_BIND_TO_IP=true

# Rate Limiting (stricter)
VORION_RATE_LIMIT_MAX_REQUESTS=60        # Per minute
VORION_RATE_LIMIT_AUTH_FAILURES=5        # Auth failures before lockout
VORION_RATE_LIMIT_LOCKOUT_DURATION=900   # 15 minute lockout

# Audit
VORION_AUDIT_ALL_REQUESTS=true
VORION_PROOF_RETENTION_DAYS=2555         # 7 years

# Multi-tenant isolation
VORION_TENANT_ISOLATION=strict
VORION_CROSS_TENANT_REQUESTS=false
```

### 4.5 Production Environment - Enterprise Tier

**Purpose**: Regulated industries, government, maximum security requirements

```bash
# .env.production.enterprise
VORION_ENV=production
VORION_ALLOW_INSECURE_DEV=false

# Maximum Security (all Business tier requirements plus:)
VORION_TLS_MIN_VERSION=TLSv1.3
VORION_TLS_CIPHER_SUITES=TLS_AES_256_GCM_SHA384

# FIPS Compliance (if required)
VORION_FIPS_MODE=true                    # Enable FIPS 140-2 mode
VORION_FIPS_LEVEL=2                      # FIPS level (1, 2, or 3)

# HSM Integration
VORION_HSM_ENABLED=true                  # REQUIRED for Enterprise
VORION_HSM_PROVIDER=aws-cloudhsm         # aws-cloudhsm, azure-hsm, pkcs11
VORION_HSM_CLUSTER_ID=<cluster-id>       # HSM cluster identifier

# Enhanced Authentication
VORION_MFA_ENABLED=true                  # REQUIRED
VORION_MFA_REQUIRED_ALL_USERS=true       # MFA for everyone
VORION_WEBAUTHN_ENABLED=true             # Hardware key support
VORION_CAC_PIV_ENABLED=true              # Smart card auth (government)

# Session Hardening (maximum)
VORION_SESSION_MAX_AGE=14400000          # 4 hours
VORION_SESSION_MAX_CONCURRENT=1          # Single session only
VORION_SESSION_BIND_TO_IP=true
VORION_SESSION_REQUIRE_REAUTH_SENSITIVE=true
VORION_SESSION_REAUTH_WINDOW=300         # 5 minute window

# Network Security
VORION_MTLS_ENABLED=true                 # mTLS for all internal traffic
VORION_CLIENT_CERT_REQUIRED=true         # Require client certificates
VORION_IP_ALLOWLIST=10.0.0.0/8,192.168.0.0/16  # Restrict access

# Rate Limiting (strictest)
VORION_RATE_LIMIT_MAX_REQUESTS=30        # Per minute
VORION_RATE_LIMIT_AUTH_FAILURES=3        # Auth failures before lockout
VORION_RATE_LIMIT_LOCKOUT_DURATION=3600  # 1 hour lockout

# Audit (comprehensive)
VORION_AUDIT_ALL_REQUESTS=true
VORION_AUDIT_INCLUDE_PAYLOAD=true        # Audit request/response bodies
VORION_PROOF_RETENTION_DAYS=3650         # 10 years
VORION_PROOF_EXTERNAL_ANCHOR=true        # Blockchain anchoring

# Data Protection
VORION_FIELD_LEVEL_ENCRYPTION=true       # Encrypt sensitive fields
VORION_DATA_MASKING_ENABLED=true         # Mask data in logs/exports
VORION_PII_DETECTION_ENABLED=true        # Detect and protect PII

# Privileged Access
VORION_DUAL_AUTHORIZATION=true           # Require two approvers
VORION_PRIVILEGED_SESSION_RECORDING=true # Record admin sessions
VORION_JIT_ACCESS_ENABLED=true           # Just-in-time access
```

---

## 5. Security Header Configuration

### 5.1 Required HTTP Security Headers

Configure these headers in your reverse proxy or application:

```nginx
# Nginx configuration example
server {
    # Strict Transport Security
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # Content Security Policy
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.vorion.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;

    # Prevent MIME type sniffing
    add_header X-Content-Type-Options "nosniff" always;

    # Clickjacking protection
    add_header X-Frame-Options "DENY" always;

    # XSS Protection (legacy browsers)
    add_header X-XSS-Protection "1; mode=block" always;

    # Referrer Policy
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Permissions Policy
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()" always;

    # Remove server information
    server_tokens off;
    add_header X-Powered-By "" always;
}
```

### 5.2 Header Configuration for Vorion

```bash
# Environment variable configuration
VORION_SECURITY_HEADERS_ENABLED=true

# HSTS
VORION_HSTS_ENABLED=true
VORION_HSTS_MAX_AGE=31536000
VORION_HSTS_INCLUDE_SUBDOMAINS=true
VORION_HSTS_PRELOAD=true

# Content Security Policy
VORION_CSP_ENABLED=true
VORION_CSP_REPORT_URI=https://csp-report.vorion.example.com

# Frame Options
VORION_FRAME_OPTIONS=DENY

# Content Type Options
VORION_CONTENT_TYPE_OPTIONS=nosniff

# Referrer Policy
VORION_REFERRER_POLICY=strict-origin-when-cross-origin
```

### 5.3 API-Specific Headers

```yaml
# API response headers
api_headers:
  # Cache control for sensitive data
  Cache-Control: "no-store, no-cache, must-revalidate, proxy-revalidate"
  Pragma: "no-cache"
  Expires: "0"

  # Prevent caching of authenticated responses
  Vary: "Authorization, Cookie"

  # Request ID for tracing
  X-Request-ID: "<generated-uuid>"

  # Rate limit headers
  X-RateLimit-Limit: "<limit>"
  X-RateLimit-Remaining: "<remaining>"
  X-RateLimit-Reset: "<reset-timestamp>"
```

---

## 6. Rate Limiting Configuration

### 6.1 Rate Limiting Strategy

```yaml
rate_limiting:
  # Global rate limits
  global:
    enabled: true
    window_ms: 60000           # 1 minute
    max_requests: 1000         # Per source IP

  # Per-endpoint rate limits
  endpoints:
    # Authentication endpoints (strict)
    "/api/v1/auth/login":
      window_ms: 60000
      max_requests: 5
      block_duration_ms: 900000  # 15 minute block

    "/api/v1/auth/register":
      window_ms: 3600000        # 1 hour
      max_requests: 3

    "/api/v1/auth/password-reset":
      window_ms: 3600000
      max_requests: 3

    # API endpoints (standard)
    "/api/v1/agents/*":
      window_ms: 60000
      max_requests: 100

    "/api/v1/intents/*":
      window_ms: 60000
      max_requests: 60

    # Admin endpoints (strict)
    "/api/v1/admin/*":
      window_ms: 60000
      max_requests: 30

  # Per-user rate limits
  per_user:
    enabled: true
    window_ms: 60000
    max_requests: 300

  # Per-tenant rate limits
  per_tenant:
    enabled: true
    window_ms: 60000
    max_requests: 10000

  # Burst handling
  burst:
    enabled: true
    multiplier: 2              # Allow 2x burst
    recovery_ms: 1000          # Recover 1 request per second
```

### 6.2 Rate Limit Response

```json
// HTTP 429 Response
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retry_after": 60,
    "limit": 100,
    "remaining": 0,
    "reset": "2026-01-29T12:01:00Z"
  }
}
```

### 6.3 DDoS Protection

```bash
# DDoS protection configuration
VORION_DDOS_PROTECTION_ENABLED=true
VORION_DDOS_THRESHOLD_REQUESTS=10000      # Requests per second
VORION_DDOS_THRESHOLD_BANDWIDTH=100       # MB per second
VORION_DDOS_BLOCK_DURATION=3600           # 1 hour block
VORION_DDOS_CHALLENGE_ENABLED=true        # JavaScript challenge
```

---

## 7. Logging Configuration

### 7.1 Production Logging Requirements

```yaml
logging:
  # Log level
  level: info                 # error, warn, info, debug

  # Format
  format: json                # REQUIRED for production

  # Output
  output:
    - stdout                  # Container stdout
    - /var/log/vorion/app.log # File (if needed)

  # Sensitive data handling
  redaction:
    enabled: true             # REQUIRED
    patterns:
      - password
      - secret
      - token
      - key
      - authorization
      - cookie
      - credit_card
      - ssn

  # Request logging
  request_logging:
    enabled: true
    include_headers: true
    exclude_headers:
      - Authorization
      - Cookie
      - X-API-Key
    include_body: false       # Don't log request bodies
    include_query: true

  # Correlation
  correlation:
    enabled: true
    header: X-Request-ID
    generate_if_missing: true
```

### 7.2 Log Format

```json
{
  "timestamp": "2026-01-29T12:00:00.000Z",
  "level": "info",
  "service": "vorion-api",
  "version": "1.0.0",
  "environment": "production",
  "request_id": "uuid",
  "trace_id": "trace-uuid",
  "span_id": "span-uuid",
  "message": "Request completed",
  "http": {
    "method": "POST",
    "path": "/api/v1/intents",
    "status": 200,
    "duration_ms": 45,
    "client_ip": "192.0.2.1",
    "user_agent": "..."
  },
  "user": {
    "id": "user-uuid",
    "tenant_id": "tenant-uuid"
  },
  "metadata": {}
}
```

### 7.3 Security Event Logging

```yaml
# Security events to log
security_events:
  authentication:
    - login_success
    - login_failure
    - logout
    - password_change
    - mfa_enabled
    - mfa_disabled
    - mfa_challenge
    - session_created
    - session_revoked

  authorization:
    - permission_denied
    - privilege_escalation
    - role_change
    - capability_granted
    - capability_revoked

  data_access:
    - sensitive_data_access
    - bulk_export
    - data_deletion

  administrative:
    - config_change
    - user_created
    - user_deleted
    - api_key_created
    - api_key_revoked

  security_threats:
    - injection_attempt
    - rate_limit_exceeded
    - invalid_token
    - suspicious_activity
```

### 7.4 Log Retention

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Application Logs | 90 days | Hot storage |
| Security Events | 2 years | Warm storage |
| PROOF Chain | 7+ years | Cold storage |
| Access Logs | 1 year | Warm storage |
| Debug Logs | 7 days | Hot storage |

---

## 8. Backup and Recovery

### 8.1 Backup Configuration

```yaml
backup:
  # Database backups
  database:
    enabled: true
    frequency: hourly
    retention:
      hourly: 24              # Keep 24 hourly backups
      daily: 30               # Keep 30 daily backups
      weekly: 52              # Keep 52 weekly backups
      monthly: 24             # Keep 24 monthly backups
    encryption:
      enabled: true
      algorithm: AES-256-GCM
      key_source: kms         # Use KMS for encryption key
    storage:
      primary: s3://backups-primary
      secondary: s3://backups-secondary  # Cross-region
    verification:
      enabled: true
      frequency: daily
      restore_test: weekly

  # PROOF chain backups
  proof_chain:
    enabled: true
    frequency: every_15_minutes
    retention: indefinite     # Never delete PROOF backups
    encryption:
      enabled: true
      algorithm: AES-256-GCM
    storage:
      primary: s3://proof-backups-primary
      secondary: s3://proof-backups-secondary
      cold: glacier://proof-archive

  # Configuration backups
  configuration:
    enabled: true
    frequency: on_change
    retention:
      versions: 100           # Keep last 100 versions
    encryption:
      enabled: true

  # Key material backups
  keys:
    enabled: true
    frequency: on_rotation
    storage: hsm              # HSM-backed key escrow
    dual_control: true        # Require two operators
```

### 8.2 Recovery Procedures

```yaml
recovery:
  # Recovery Time Objectives
  rto:
    critical: 1h              # Critical services: 1 hour
    high: 4h                  # High priority: 4 hours
    medium: 24h               # Medium priority: 24 hours
    low: 72h                  # Low priority: 72 hours

  # Recovery Point Objectives
  rpo:
    database: 15m             # Max 15 minutes data loss
    proof_chain: 0            # No data loss (synchronous replication)
    configuration: 1h         # Max 1 hour

  # Recovery procedures
  procedures:
    database_restore:
      - verify_backup_integrity
      - restore_to_standby
      - validate_data_consistency
      - switch_traffic
      - verify_application_health

    proof_chain_restore:
      - verify_merkle_integrity
      - restore_from_backup
      - verify_chain_continuity
      - resume_operations

    full_disaster_recovery:
      - activate_dr_site
      - restore_infrastructure
      - restore_database
      - restore_proof_chain
      - restore_configuration
      - validate_security_controls
      - switch_dns
      - verify_operations
```

### 8.3 Backup Verification

```bash
#!/bin/bash
# Backup verification script

# Verify database backup
echo "Verifying database backup integrity..."
vorion backup verify --type=database --latest

# Verify PROOF chain backup
echo "Verifying PROOF chain integrity..."
vorion backup verify --type=proof --merkle-check

# Test restore to isolated environment
echo "Testing restore procedure..."
vorion backup restore --type=database --target=test-env --latest

# Validate restored data
echo "Validating restored data..."
vorion validate --environment=test-env

# Cleanup test environment
echo "Cleaning up..."
vorion environment destroy --name=test-env

echo "Backup verification complete."
```

---

## 9. Monitoring and Alerting

### 9.1 Security Monitoring

```yaml
monitoring:
  # Infrastructure metrics
  infrastructure:
    - cpu_usage
    - memory_usage
    - disk_usage
    - network_io
    - container_health

  # Application metrics
  application:
    - request_rate
    - error_rate
    - latency_p50
    - latency_p95
    - latency_p99
    - active_sessions
    - database_connections

  # Security metrics
  security:
    - authentication_failures
    - authorization_denials
    - rate_limit_hits
    - invalid_tokens
    - certificate_expiry
    - key_rotation_status
    - audit_log_volume
    - anomaly_detections
```

### 9.2 Alert Configuration

```yaml
alerts:
  # Critical alerts (immediate response)
  critical:
    - name: "Authentication Failure Spike"
      condition: "auth_failures > 100 in 5m"
      severity: critical
      notification:
        - pagerduty
        - slack-security

    - name: "Data Exfiltration Detected"
      condition: "data_egress_anomaly"
      severity: critical
      notification:
        - pagerduty
        - slack-security
        - email-security

    - name: "PROOF Chain Integrity Failure"
      condition: "proof_integrity_check_failed"
      severity: critical
      notification:
        - pagerduty
        - slack-security

  # High alerts (1 hour response)
  high:
    - name: "Rate Limit Threshold"
      condition: "rate_limit_hits > 1000 in 1m"
      severity: high
      notification:
        - slack-security

    - name: "Certificate Expiring Soon"
      condition: "cert_expiry < 14d"
      severity: high
      notification:
        - slack-security
        - email-ops

    - name: "Elevated Error Rate"
      condition: "error_rate > 5% for 10m"
      severity: high
      notification:
        - slack-ops
        - pagerduty

  # Medium alerts (4 hour response)
  medium:
    - name: "Key Rotation Due"
      condition: "key_age > 80d"
      severity: medium
      notification:
        - slack-security

    - name: "Backup Verification Failed"
      condition: "backup_verify_failed"
      severity: medium
      notification:
        - slack-ops

  # Low alerts (24 hour response)
  low:
    - name: "Elevated Login Failures"
      condition: "login_failures > 50 in 1h"
      severity: low
      notification:
        - slack-security

    - name: "Unusual Traffic Pattern"
      condition: "traffic_anomaly_detected"
      severity: low
      notification:
        - slack-security
```

### 9.3 Dashboard Requirements

**Security Dashboard:**
- Real-time authentication metrics
- Failed login attempts by source
- Active sessions by location
- Trust score distribution
- Rate limit status
- Certificate expiry countdown
- Recent security events

**Operations Dashboard:**
- Service health status
- Error rates by endpoint
- Latency percentiles
- Database connection pool
- Queue depths
- Recent deployments

---

## 10. Pre-Deployment Checklist

### 10.1 Security Configuration Checklist

```markdown
## Pre-Deployment Security Checklist

### Environment Configuration
- [ ] VORION_ENV is set to 'production'
- [ ] VORION_ALLOW_INSECURE_DEV is 'false'
- [ ] All secrets are unique to this environment
- [ ] Secrets are not committed to version control
- [ ] Secrets are stored in secure vault/KMS

### Authentication
- [ ] JWT secret is 256+ bits of entropy
- [ ] JWT expiration is 15 minutes or less
- [ ] Refresh token rotation is enabled
- [ ] MFA is enabled (required for Business/Enterprise)
- [ ] Password policy meets requirements
- [ ] Account lockout is configured

### Encryption
- [ ] TLS 1.3 is minimum version
- [ ] Database connections use TLS
- [ ] Redis connections use TLS
- [ ] Encryption at rest is enabled
- [ ] Key rotation is scheduled

### Network Security
- [ ] Rate limiting is enabled
- [ ] CORS is properly configured
- [ ] WAF rules are active
- [ ] DDoS protection is enabled
- [ ] IP allowlisting is configured (if required)

### Headers
- [ ] HSTS is enabled with appropriate max-age
- [ ] CSP is configured and tested
- [ ] X-Frame-Options is DENY
- [ ] X-Content-Type-Options is nosniff
- [ ] Referrer-Policy is configured

### Logging
- [ ] Log format is JSON
- [ ] Sensitive data redaction is enabled
- [ ] Security events are being captured
- [ ] Log aggregation is configured
- [ ] Log retention meets compliance requirements

### Monitoring
- [ ] Security metrics are being collected
- [ ] Critical alerts are configured
- [ ] Alert notification channels are verified
- [ ] Dashboards are operational

### Backup
- [ ] Database backups are scheduled
- [ ] PROOF chain backups are configured
- [ ] Backup encryption is enabled
- [ ] Backup verification is scheduled
- [ ] Recovery procedures are documented

### Access Control
- [ ] Default deny policy is in place
- [ ] Admin accounts use MFA
- [ ] Service accounts have minimal permissions
- [ ] API keys have appropriate scopes
- [ ] Tenant isolation is verified
```

### 10.2 Automated Security Validation

```bash
#!/bin/bash
# security-check.sh - Pre-deployment security validation

set -e

echo "Running Vorion security checks..."

# Check environment variables
echo "Checking required environment variables..."
vorion security check-env

# Validate TLS configuration
echo "Validating TLS configuration..."
vorion security check-tls

# Verify cryptographic settings
echo "Verifying cryptographic configuration..."
vorion security check-crypto

# Check rate limiting
echo "Checking rate limiting configuration..."
vorion security check-rate-limits

# Validate security headers
echo "Validating security headers..."
vorion security check-headers

# Run security scan
echo "Running security scan..."
vorion security scan

# Check for known vulnerabilities
echo "Checking for known vulnerabilities..."
npm audit --audit-level=high

# Verify backup configuration
echo "Verifying backup configuration..."
vorion backup verify-config

# Check certificate expiry
echo "Checking certificate expiry..."
vorion security check-certs

# Summary
echo ""
echo "Security check complete."
vorion security summary
```

---

## 11. Security Validation

### 11.1 Periodic Security Tasks

| Task | Frequency | Owner |
|------|-----------|-------|
| Security configuration review | Monthly | Security Team |
| Penetration testing | Quarterly | External Vendor |
| Vulnerability scanning | Weekly | Security Team |
| Certificate rotation | Before expiry | DevOps |
| Key rotation | Per schedule | Security Team |
| Access review | Quarterly | Security + HR |
| Backup restore test | Monthly | DevOps |
| Incident response drill | Quarterly | Security Team |
| Security training | Annually | All Staff |

### 11.2 Compliance Validation

```bash
# Run compliance checks
vorion compliance check --framework=soc2
vorion compliance check --framework=iso27001
vorion compliance check --framework=gdpr

# Generate compliance report
vorion compliance report --format=pdf --output=compliance-report.pdf
```

### 11.3 Security Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Mean Time to Detect (MTTD) | < 1 hour | > 2 hours |
| Mean Time to Respond (MTTR) | < 4 hours | > 8 hours |
| Vulnerability SLA Compliance | 100% | < 95% |
| Patch Currency | < 30 days | > 60 days |
| MFA Adoption | 100% (required roles) | < 100% |
| Failed Login Rate | < 1% | > 5% |
| Certificate Expiry | > 14 days | < 14 days |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-29 | Security Team | Initial version |

---

## Related Documents

- [Security Overview](./SECURITY.md)
- [Threat Model](./THREAT_MODEL.md)
- [Vulnerability Disclosure](./VULNERABILITY_DISCLOSURE.md)
- [Platform Operations Runbook](../VORION_V1_FULL_APPROVAL_PDFS/PLATFORM_OPERATIONS_RUNBOOK.md)

---

*This document is maintained by the Vorion Security Team and reviewed quarterly.*
