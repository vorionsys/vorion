# @vorion/security

Enterprise security modules for the Vorion platform. Provides 23 security modules covering authentication, cryptography, detection, governance, and compliance.

> **Internal package** - Not published to npm. Requires hardening and test coverage before public release.

## Modules

### Authentication & Access

| Module | Import | Description |
|--------|--------|-------------|
| **WebAuthn** | `@vorion/security/webauthn` | FIDO2 passwordless authentication |
| **MFA** | `@vorion/security/mfa` | Multi-factor authentication (TOTP) |
| **SSO** | `@vorion/security/sso` | Single Sign-On (OIDC) |
| **PAM** | `@vorion/security/pam` | Privileged Access Management (JIT, break-glass) |
| **Service Auth** | `@vorion/security/service-auth` | Service-to-service authentication |

### Cryptography

| Module | Import | Description |
|--------|--------|-------------|
| **Crypto** | `@vorion/security/crypto` | FIPS 140-2 compliant crypto operations |
| **HSM** | `@vorion/security/hsm` | Hardware Security Module integration (AWS CloudHSM) |
| **KMS** | `@vorion/security/kms` | Key Management Service (AWS KMS, Azure Key Vault, GCP KMS) |
| **Encryption** | `@vorion/security/encryption` | Field-level encryption |
| **ZKP** | `@vorion/security/zkp` | Zero-knowledge proofs |

### Detection & Monitoring

| Module | Import | Description |
|--------|--------|-------------|
| **SIEM** | `@vorion/security/siem` | SIEM integration (Splunk, Elastic, Loki, Datadog) |
| **Anomaly** | `@vorion/security/anomaly` | Anomaly detection (impossible travel, volume spikes) |
| **Threat Intel** | `@vorion/security/threat-intel` | Threat intelligence (bot detection, IP reputation) |
| **Alerting** | `@vorion/security/alerting` | Multi-channel alerting |

### Governance & Policy

| Module | Import | Description |
|--------|--------|-------------|
| **Policy Engine** | `@vorion/security/policy-engine` | OPA-style policy evaluation |
| **Trust Oracle** | `@vorion/security/trust-oracle` | Vendor risk scoring |
| **AI Governance** | `@vorion/security/ai-governance` | AI governance controls |

### Response & Compliance

| Module | Import | Description |
|--------|--------|-------------|
| **Incident** | `@vorion/security/incident` | Incident response with automated playbooks |
| **DLP** | `@vorion/security/dlp` | Data loss prevention |
| **Headers** | `@vorion/security/headers` | Security headers middleware |
| **API Keys** | `@vorion/security/api-keys` | API key management |
| **Audit** | `@vorion/security/audit` | Audit logging |

## Usage

```typescript
// Import specific modules via subpath
import { webauthn } from '@vorion/security/webauthn';
import { mfa } from '@vorion/security/mfa';
import { siem } from '@vorion/security/siem';

// Or import everything via barrel
import { webauthn, mfa, siem, crypto } from '@vorion/security';
```

## Dependencies

- **Required**: `@simplewebauthn/server`, `jose`, `zod`, `argon2`, `ioredis`, `otplib`, `qrcode`
- **Optional Peer**: `@aws-sdk/client-kms`, `@aws-sdk/client-cloudhsm-v2`, `@azure/keyvault-keys`, `@google-cloud/kms`

## Status

This package is under active development. Before publishing:

- [ ] Add comprehensive test coverage
- [ ] Enable TypeScript strict mode
- [ ] Security audit of all modules
- [ ] Separate cloud provider SDKs into optional peer dependencies
- [ ] API stabilization

## License

MIT
