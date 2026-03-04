# Hardware Security Module (HSM) Integration Guide

This document provides comprehensive guidance for integrating and operating HSM-backed cryptographic operations in Vorion. HSM integration enables FIPS 140-3 compliant key management for enterprise deployments.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Provider Setup](#provider-setup)
   - [AWS CloudHSM](#aws-cloudhsm)
   - [Azure Managed HSM](#azure-managed-hsm)
   - [Google Cloud HSM](#google-cloud-hsm)
   - [Thales Luna Network HSM](#thales-luna-network-hsm)
   - [PKCS#11 Tokens](#pkcs11-tokens)
   - [SoftHSM (Development)](#softhsm-development)
4. [Key Ceremony Procedures](#key-ceremony-procedures)
5. [FIPS 140-3 Compliance](#fips-140-3-compliance)
6. [Configuration Reference](#configuration-reference)
7. [Troubleshooting](#troubleshooting)
8. [Security Best Practices](#security-best-practices)

---

## Overview

Vorion's HSM integration provides:

- **Multi-Provider Support**: AWS CloudHSM, Azure Managed HSM, GCP Cloud HSM, Thales Luna, PKCS#11 tokens
- **Automatic Failover**: Seamless failover between HSM providers
- **Key Ceremonies**: Multi-party key generation with Shamir's Secret Sharing
- **FIPS 140-3 Compliance**: Hardware-backed cryptographic operations
- **Health Monitoring**: Real-time HSM health checks and metrics
- **Audit Logging**: Complete audit trail of all HSM operations

### Architecture

```
                                  +-------------------+
                                  |   Application     |
                                  +--------+----------+
                                           |
                                           v
                              +------------+------------+
                              |    HSM Service Layer    |
                              | (Failover, Caching,     |
                              |  Health Checks)         |
                              +------------+------------+
                                           |
            +------------------------------+------------------------------+
            |                |                |                |          |
            v                v                v                v          v
    +-------+------+  +------+-------+  +----+-----+  +-------+----+  +--+------+
    | AWS CloudHSM |  | Azure HSM    |  | GCP HSM  |  | Thales Luna|  | PKCS#11 |
    +--------------+  +--------------+  +----------+  +------------+  +---------+
```

---

## Quick Start

### Development Setup

For local development, use SoftHSM (software-based HSM emulation):

```typescript
import { quickStart, createSimpleCryptoService } from '@vorionsys/platform-core/security/hsm';

// Quick initialization
const hsm = await quickStart('development');

// Generate and use keys
const encryptionKey = await hsm.generateMasterKey('my-app-key');
const encrypted = await hsm.encrypt(encryptionKey.id, Buffer.from('secret data'));
const decrypted = await hsm.decrypt(encryptionKey.id, encrypted);

// Or use the simple crypto service
const crypto = await createSimpleCryptoService();
const { keyId, ciphertext } = await crypto.encrypt('my-label', Buffer.from('hello'));
const plaintext = await crypto.decrypt(keyId, ciphertext);
```

### Production Setup

1. Enable HSM in your environment configuration:

```bash
# Core HSM settings
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=aws  # or azure, gcp, thales, pkcs11
export VORION_HSM_FIPS_MODE=true

# Provider-specific settings (example for AWS)
export VORION_HSM_AWS_CLUSTER_ID=cluster-xxxx
export VORION_HSM_AWS_REGION=us-east-1
export VORION_HSM_AWS_CRYPTO_USER=crypto_user
# Password should come from secrets manager, not environment
```

2. Initialize the HSM service in your application:

```typescript
import { HSMService, createHSMService } from '@vorionsys/platform-core/security/hsm';
import { registerHealthCheck } from '@vorionsys/platform-core/observability';

// Create and initialize
const hsmService = createHSMService('production');
await hsmService.initialize();

// Register health check
registerHealthCheck(createHSMHealthCheck(hsmService));
```

---

## Provider Setup

### AWS CloudHSM

AWS CloudHSM provides FIPS 140-2 Level 3 validated hardware security modules.

#### Prerequisites

1. Create a CloudHSM cluster in your VPC
2. Initialize the cluster and create a crypto user
3. Install the CloudHSM client on your EC2 instances

#### Configuration

```bash
# Required settings
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=aws
export VORION_HSM_AWS_CLUSTER_ID=cluster-xxxxxxxxx
export VORION_HSM_AWS_REGION=us-east-1
export VORION_HSM_AWS_CRYPTO_USER=crypto_user

# Optional settings
export VORION_HSM_ENABLE_FAILOVER=true
export VORION_HSM_HEALTH_CHECK_INTERVAL_MS=30000
```

#### IAM Permissions

Ensure your EC2 instance role has the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudhsmv2:DescribeClusters",
        "cloudhsmv2:ListTags"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Network Configuration

- CloudHSM requires VPC connectivity (no public endpoints)
- Security group must allow TCP port 2223-2225 from application servers
- Enable VPC DNS resolution for HSM endpoints

### Azure Managed HSM

Azure Managed HSM provides FIPS 140-2 Level 3 validated HSM pools.

#### Prerequisites

1. Create a Managed HSM resource in Azure
2. Activate the HSM by downloading the security domain
3. Configure RBAC for your application's managed identity

#### Configuration

```bash
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=azure
export VORION_HSM_AZURE_HSM_NAME=my-hsm
export VORION_HSM_AZURE_REGION=eastus
export VORION_HSM_AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export VORION_HSM_AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

#### RBAC Configuration

Assign the following roles to your application:

| Role | Purpose |
|------|---------|
| Managed HSM Crypto User | Key operations (encrypt, decrypt, sign, verify) |
| Managed HSM Crypto Officer | Key management (create, delete, rotate) |

```bash
az keyvault role assignment create \
  --hsm-name my-hsm \
  --role "Managed HSM Crypto User" \
  --assignee <client-id> \
  --scope /keys
```

### Google Cloud HSM

GCP Cloud HSM provides FIPS 140-2 Level 3 validated key management.

#### Prerequisites

1. Enable the Cloud KMS API
2. Create a key ring with HSM protection level
3. Configure service account permissions

#### Configuration

```bash
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=gcp
export VORION_HSM_GCP_PROJECT_ID=my-project
export VORION_HSM_GCP_LOCATION=us-central1
export VORION_HSM_GCP_KEY_RING=vorion-keyring
```

#### IAM Permissions

```yaml
# Required roles for the service account
roles:
  - roles/cloudkms.cryptoKeyEncrypterDecrypter
  - roles/cloudkms.signerVerifier
  - roles/cloudkms.admin  # For key management operations
```

### Thales Luna Network HSM

Thales Luna HSMs provide FIPS 140-2 Level 3 validated hardware.

#### Prerequisites

1. Install Luna client software on application servers
2. Configure network connectivity to HSM appliances
3. Initialize partitions and create crypto officer/user

#### Configuration

```bash
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=thales
export VORION_HSM_THALES_PARTITION_NAME=vorion-partition
export VORION_HSM_THALES_IP_ADDRESSES=10.0.1.10,10.0.1.11

# For HA configuration, include all HSM IP addresses
```

#### Client Configuration

Ensure `/etc/Chrystoki.conf` is properly configured:

```ini
Chrystoki2 = {
   LibUNIX64 = /usr/safenet/lunaclient/lib/libCryptoki2_64.so;
}

LunaSA Client = {
   ServerCAFile = /usr/safenet/lunaclient/cert/server/CAFile.pem;
   ClientCertFile = /usr/safenet/lunaclient/cert/client/ClientCert.pem;
   ClientPrivKeyFile = /usr/safenet/lunaclient/cert/client/ClientKey.pem;
   ServerName00 = luna-hsm-1;
   ServerPort00 = 1792;
}
```

### PKCS#11 Tokens

PKCS#11 support enables integration with smart cards and hardware tokens.

#### Supported Tokens

- YubiKey with PIV/PKCS#11 module
- SafeNet eToken
- Gemalto IDPrime
- PIV/CAC smart cards

#### Configuration

```bash
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=pkcs11
export VORION_HSM_PKCS11_LIBRARY_PATH=/usr/lib/libykcs11.so
export VORION_HSM_PKCS11_SLOT=0
export VORION_HSM_PKCS11_FIPS_MODE=true
```

#### YubiKey Setup

1. Install YubiKey PKCS#11 module:
   ```bash
   # macOS
   brew install yubico-piv-tool

   # Ubuntu/Debian
   apt-get install ykcs11
   ```

2. Configure library path:
   ```bash
   # macOS
   export VORION_HSM_PKCS11_LIBRARY_PATH=/usr/local/lib/libykcs11.dylib

   # Linux
   export VORION_HSM_PKCS11_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/libykcs11.so
   ```

### SoftHSM (Development)

SoftHSM is a software-only HSM for development and testing.

**WARNING**: SoftHSM is NOT suitable for production use.

#### Configuration

```bash
export VORION_HSM_ENABLED=true
export VORION_HSM_PROVIDER=softhsm

# Optional: suppress development warnings
export VORION_HSM_SOFTHSM_SUPPRESS_WARNINGS=true
```

---

## Key Ceremony Procedures

Key ceremonies are formal procedures for generating, distributing, and managing cryptographic keys with multi-party control.

### Master Key Generation Ceremony

#### Participants Required

| Role | Count | Responsibility |
|------|-------|----------------|
| Ceremony Administrator | 1 | Orchestrates the ceremony |
| Key Custodians | 3-7 | Receive and secure key shares |
| Witnesses | 2+ | Observe and attest to the ceremony |
| Auditor | 1 | Reviews and signs ceremony report |

#### Procedure

1. **Preparation** (Day Before)
   - Verify HSM connectivity and health
   - Prepare air-gapped ceremony workstation
   - Distribute ceremony instructions to participants
   - Prepare tamper-evident bags for key shares

2. **Ceremony Execution**

   ```typescript
   import {
     KeyCeremonyManager,
     CeremonyType,
     CustodianRole,
   } from '@vorionsys/platform-core/security/hsm';

   // Create ceremony configuration
   const ceremony = await ceremonyManager.createCeremony({
     type: CeremonyType.MASTER_KEY_GENERATION,
     keySpec: {
       label: 'vorion-master-key-2024',
       type: KeyType.AES,
       size: 256,
       usage: [KeyUsage.WRAP, KeyUsage.UNWRAP],
       extractable: false,
     },
     totalShares: 5,
     requiredShares: 3,  // 3-of-5 threshold
     requireDualControl: true,
     requireWitnesses: true,
     custodians: [
       { id: 'cust-1', name: 'Alice', email: 'alice@example.com', role: CustodianRole.KEY_HOLDER },
       { id: 'cust-2', name: 'Bob', email: 'bob@example.com', role: CustodianRole.KEY_HOLDER },
       { id: 'cust-3', name: 'Carol', email: 'carol@example.com', role: CustodianRole.KEY_HOLDER },
       { id: 'cust-4', name: 'Dave', email: 'dave@example.com', role: CustodianRole.KEY_HOLDER },
       { id: 'cust-5', name: 'Eve', email: 'eve@example.com', role: CustodianRole.KEY_HOLDER },
       { id: 'wit-1', name: 'Frank', email: 'frank@example.com', role: CustodianRole.WITNESS },
       { id: 'wit-2', name: 'Grace', email: 'grace@example.com', role: CustodianRole.WITNESS },
     ],
   });

   // Mark custodians as present
   for (const custodian of ceremony.config.custodians) {
     await ceremonyManager.markCustodianPresent(ceremony.id, custodian.id);
   }

   // Start and execute ceremony
   await ceremonyManager.startCeremony(ceremony.id);
   const masterKey = await ceremonyManager.executeMasterKeyGeneration(ceremony.id);

   // Export ceremony report
   const report = ceremonyManager.exportCeremonyReport(ceremony.id);
   console.log('Ceremony completed. Report:', report);
   ```

3. **Post-Ceremony**
   - Each custodian seals their share in a tamper-evident bag
   - Shares are stored in separate secure locations
   - Ceremony report is signed by all participants
   - Report is archived with legal/compliance team

### Key Recovery Procedure

In case the master key is lost or the HSM needs to be restored:

1. Assemble minimum required custodians (threshold)
2. Each custodian provides their share
3. System reconstructs the key using Shamir's Secret Sharing
4. Key is re-imported to HSM

```typescript
// Create recovery ceremony
const recovery = await ceremonyManager.createCeremony({
  type: CeremonyType.KEY_RECOVERY,
  totalShares: 5,
  requiredShares: 3,
  custodians: [...originalCustodians],
});

// Collect shares from custodians
await ceremonyManager.submitShare(recovery.id, 'cust-1', share1);
await ceremonyManager.submitShare(recovery.id, 'cust-3', share3);
await ceremonyManager.submitShare(recovery.id, 'cust-5', share5);

// Reconstruct and recover
const recoveredKey = await ceremonyManager.executeKeyRecovery(recovery.id);
```

---

## FIPS 140-3 Compliance

### Compliance Requirements

FIPS 140-3 defines four security levels:

| Level | Requirements | Vorion Support |
|-------|--------------|----------------|
| Level 1 | Software-only crypto | SoftHSM (dev only) |
| Level 2 | Tamper-evident hardware | - |
| Level 3 | Tamper-resistant + authentication | AWS, Azure, GCP, Thales |
| Level 4 | Complete physical security | Thales Luna |

### Approved Algorithms

When FIPS mode is enabled (`VORION_HSM_FIPS_MODE=true`), only these algorithms are permitted:

**Symmetric Encryption**:
- AES-128, AES-192, AES-256 (CBC, GCM, CTR modes)

**Asymmetric Encryption**:
- RSA-2048 or larger (OAEP-SHA256)

**Digital Signatures**:
- RSA-2048+ with SHA-256/384/512 (PKCS#1 v1.5 or PSS)
- ECDSA with P-256, P-384, P-521 curves
- Ed25519 (per FIPS 186-5)

**Key Derivation**:
- HKDF-SHA256/384/512
- PBKDF2-SHA256/512 (minimum 100,000 iterations)

**Message Authentication**:
- HMAC-SHA256/384/512
- AES-CMAC

### FIPS Mode Configuration

```bash
# Enable FIPS mode
export VORION_HSM_FIPS_MODE=true

# Ensure production HSM provider
export VORION_HSM_PROVIDER=aws  # Not softhsm
```

### Validation Certificates

| Provider | FIPS Validation | Certificate |
|----------|-----------------|-------------|
| AWS CloudHSM | 140-2 Level 3 | [#3254](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/3254) |
| Azure Managed HSM | 140-2 Level 3 | [#3615](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/3615) |
| GCP Cloud HSM | 140-2 Level 3 | [#3681](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/3681) |
| Thales Luna 7 | 140-2 Level 3/4 | [#3723](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/3723) |

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_HSM_ENABLED` | `false` | Enable HSM integration |
| `VORION_HSM_PROVIDER` | `softhsm` | HSM provider type |
| `VORION_HSM_ENABLE_FAILOVER` | `true` | Enable automatic failover |
| `VORION_HSM_FAILOVER_PROVIDERS` | - | Comma-separated failover providers |
| `VORION_HSM_HEALTH_CHECK_INTERVAL_MS` | `30000` | Health check interval (ms) |
| `VORION_HSM_ENABLE_KEY_CACHE` | `true` | Enable key metadata caching |
| `VORION_HSM_KEY_CACHE_TTL_SECONDS` | `300` | Cache TTL (seconds) |
| `VORION_HSM_ENABLE_AUDIT_LOGGING` | `true` | Enable operation audit logs |
| `VORION_HSM_FIPS_MODE` | `false` | Enable FIPS-only algorithms |
| `VORION_HSM_CONNECTION_TIMEOUT_MS` | `30000` | Connection timeout (ms) |
| `VORION_HSM_OPERATION_TIMEOUT_MS` | `60000` | Operation timeout (ms) |

### Provider-Specific Variables

#### AWS CloudHSM
| Variable | Required | Description |
|----------|----------|-------------|
| `VORION_HSM_AWS_CLUSTER_ID` | Yes | CloudHSM cluster ID |
| `VORION_HSM_AWS_REGION` | Yes | AWS region |
| `VORION_HSM_AWS_CRYPTO_USER` | Yes | Crypto user name |

#### Azure Managed HSM
| Variable | Required | Description |
|----------|----------|-------------|
| `VORION_HSM_AZURE_HSM_NAME` | Yes | Managed HSM name |
| `VORION_HSM_AZURE_REGION` | Yes | Azure region |
| `VORION_HSM_AZURE_TENANT_ID` | Yes | Azure AD tenant ID |
| `VORION_HSM_AZURE_CLIENT_ID` | Yes | Application client ID |

#### GCP Cloud HSM
| Variable | Required | Description |
|----------|----------|-------------|
| `VORION_HSM_GCP_PROJECT_ID` | Yes | GCP project ID |
| `VORION_HSM_GCP_LOCATION` | Yes | KMS location |
| `VORION_HSM_GCP_KEY_RING` | Yes | Key ring name |

#### Thales Luna
| Variable | Required | Description |
|----------|----------|-------------|
| `VORION_HSM_THALES_PARTITION_NAME` | Yes | HSM partition name |
| `VORION_HSM_THALES_IP_ADDRESSES` | Yes | Comma-separated HSM IPs |

#### PKCS#11
| Variable | Required | Description |
|----------|----------|-------------|
| `VORION_HSM_PKCS11_LIBRARY_PATH` | Yes | Path to PKCS#11 library |
| `VORION_HSM_PKCS11_SLOT` | No | Slot number (default: 0) |
| `VORION_HSM_PKCS11_FIPS_MODE` | No | FIPS mode for token |

---

## Troubleshooting

### Common Issues

#### HSM Connection Failed

**Symptoms**: `HSMConnectionError: Failed to connect to HSM`

**Solutions**:
1. Verify network connectivity to HSM endpoints
2. Check firewall rules (CloudHSM: TCP 2223-2225)
3. Validate credentials/certificates
4. Ensure HSM client software is installed

```bash
# Test CloudHSM connectivity
/opt/cloudhsm/bin/cloudhsm_mgmt_util /opt/cloudhsm/etc/cloudhsm_mgmt_util.cfg

# Test Luna connectivity
vtl verify
```

#### Key Operation Timeout

**Symptoms**: Operations taking longer than expected

**Solutions**:
1. Check HSM load and performance
2. Increase operation timeout: `VORION_HSM_OPERATION_TIMEOUT_MS=120000`
3. Enable key caching: `VORION_HSM_ENABLE_KEY_CACHE=true`
4. Review circuit breaker status

#### FIPS Mode Errors

**Symptoms**: `FIPS mode does not allow curve: secp256k1`

**Solutions**:
1. Use only FIPS-approved algorithms
2. Check key specifications match FIPS requirements
3. Verify HSM is FIPS validated

### Health Check Failures

Monitor HSM health via the health endpoint:

```bash
curl http://localhost:3000/health | jq '.data.components[] | select(.name == "hsm")'
```

**Healthy response**:
```json
{
  "name": "hsm",
  "status": "healthy",
  "latencyMs": 45,
  "details": {
    "initialized": true,
    "activeProvider": "AWS CloudHSM",
    "providerCount": 2,
    "healthyProviders": 2,
    "isProductionMode": true
  }
}
```

### Logs and Debugging

Enable debug logging:
```bash
export VORION_LOG_LEVEL=debug
```

Check HSM audit logs:
```typescript
const logs = hsmService.getAuditLogs(
  new Date(Date.now() - 3600000),  // Last hour
  new Date()
);
console.log('Recent HSM operations:', logs);
```

---

## Security Best Practices

### Key Management

1. **Key Separation**: Use different keys for different purposes
   - Master KEK for wrapping
   - Data encryption keys per tenant/application
   - Signing keys separate from encryption keys

2. **Key Rotation**: Rotate keys regularly
   - Encryption keys: Annually or after suspected compromise
   - Signing keys: Every 2 years
   - Master keys: Every 3-5 years with ceremony

3. **Key Destruction**: Securely destroy keys when no longer needed
   - Use HSM's secure erase function
   - Document destruction in audit log
   - Revoke associated certificates

### Access Control

1. **Principle of Least Privilege**
   - Application: Crypto User (encrypt/decrypt/sign/verify)
   - Key Management: Crypto Officer
   - Administration: Security Officer

2. **Dual Control**: Require multiple parties for sensitive operations
   - Key generation
   - Key destruction
   - Configuration changes

3. **Audit All Access**: Enable comprehensive logging
   ```bash
   export VORION_HSM_ENABLE_AUDIT_LOGGING=true
   ```

### Network Security

1. **Private Connectivity**: Use private endpoints
   - AWS: VPC endpoints for CloudHSM
   - Azure: Private endpoints for Managed HSM
   - GCP: VPC Service Controls

2. **mTLS**: Enable mutual TLS where supported
   - Client certificates for HSM access
   - Certificate pinning for API calls

3. **Firewall Rules**: Minimize allowed ports and IPs
   - Allow only application servers
   - Block all public access

### Backup and Recovery

1. **Key Backup**: Maintain encrypted key backups
   - Use key wrapping (not plaintext export)
   - Store in separate security domain
   - Test recovery procedures quarterly

2. **Share Distribution**: Store key ceremony shares securely
   - Different geographic locations
   - Different custodians
   - Tamper-evident storage

3. **Disaster Recovery**: Plan for HSM failure
   - Cross-region failover (if supported)
   - Key share recovery procedure
   - Communication plan for custodians

---

## Support

For HSM-related issues:
- Review this documentation and troubleshooting guide
- Check HSM provider status pages
- Contact Vorion support with:
  - HSM provider and version
  - Error messages and logs
  - Configuration (redacted secrets)
  - Steps to reproduce
