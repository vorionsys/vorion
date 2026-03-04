# Accepted Security Risks and Mitigations

> Last Updated: 2026-02-04
> Reference: P0-003 Security Vulnerability Remediation

## Overview

This document details security vulnerabilities that cannot be directly patched due to dependency constraints in the blockchain tooling ecosystem. All listed vulnerabilities have been assessed and accepted with documented mitigations.

## Risk Assessment Summary

| Package | Severity | Risk Status | Mitigation Level |
|---------|----------|-------------|------------------|
| elliptic | Critical | Accepted | High |
| ethers (v5) | Critical | Accepted | High |
| axios | High | Accepted | Medium |
| hardhat-deploy | High | Accepted | Medium |
| zksync-ethers | High | Accepted | Medium |
| ws | High | Accepted | High |
| @astrojs/cloudflare | High | Accepted | Low |
| wrangler | High | Accepted | Low |

## Detailed Risk Analysis

### 1. elliptic (Critical)

**Vulnerability:** Private key extraction in ECDSA upon signing malformed input (GHSA-vjh7-7g9h-fjfh)

**Affected Components:**
- `node_modules/elliptic`
- `node_modules/zksync-ethers/node_modules/elliptic`

**Root Cause:** The `elliptic` package is a transitive dependency of ethers v5, which is required by hardhat-deploy and other blockchain development tools. There is no direct fix available as the upstream packages have not migrated away from elliptic.

**Mitigations:**
1. **Input Validation:** All signing operations use typed data with strict validation
2. **Key Management:** Private keys are only used in development/testing environments
3. **Production:** Production blockchain operations use HSM-backed signers or hardware wallets that do not use the JS elliptic library
4. **Access Control:** Signing endpoints are protected by authentication and rate limiting

**Risk Assessment:** ACCEPTED - The vulnerability requires malformed input to exploit, which is prevented by our input validation. Production systems use hardware-backed signing.

---

### 2. ethers v5 (Critical)

**Vulnerability:** Multiple vulnerabilities in @ethersproject/* packages related to elliptic and signature handling

**Affected Components:**
- `node_modules/eth-gas-reporter/node_modules/ethers`
- `node_modules/hardhat-deploy/node_modules/ethers`
- `node_modules/zksync-ethers/node_modules/ethers`

**Root Cause:** These are development dependencies for Hardhat testing infrastructure. The root project uses ethers v6 for production code, but test tooling requires ethers v5.

**Mitigations:**
1. **Development Only:** ethers v5 is only used in development/test environments
2. **Production Uses v6:** All production blockchain interactions use ethers v6+
3. **Isolated Environment:** Smart contract testing runs in sandboxed Hardhat networks
4. **No Real Assets:** Testing never involves real cryptocurrency or mainnet operations

**Risk Assessment:** ACCEPTED - Development-only dependency with no production exposure.

---

### 3. axios (High)

**Vulnerability:** SSRF and Credential Leakage via Absolute URL (GHSA-jr5f-v2jv-69x6)

**Affected Components:**
- `node_modules/axios` (via hardhat-deploy)

**Root Cause:** axios is a transitive dependency of hardhat-deploy used for deployment verification.

**Mitigations:**
1. **No User Input:** axios is only called with hardcoded URLs for Etherscan verification
2. **Network Isolation:** Deployment scripts run in controlled CI/CD environment
3. **URL Validation:** All URLs are validated before use
4. **Alternative Available:** Production HTTP clients use native fetch or undici

**Risk Assessment:** ACCEPTED - Limited attack surface due to constrained usage patterns.

---

### 4. hardhat-deploy (High)

**Vulnerability:** Inherits vulnerabilities from axios, ethers, and @ethersproject packages

**Affected Components:**
- `node_modules/hardhat-deploy`

**Root Cause:** Essential tool for smart contract deployment scripts with no available replacement.

**Mitigations:**
1. **Development Tool:** Only used in local development and CI/CD
2. **Isolated Execution:** Runs in sandboxed Docker containers in CI
3. **Audit Trail:** All deployments are logged and verified
4. **Manual Verification:** Production deployments require human approval

**Risk Assessment:** ACCEPTED - Essential development tool with controlled usage.

---

### 5. zksync-ethers (High)

**Vulnerability:** Depends on vulnerable ethers v5 and ws packages

**Affected Components:**
- `node_modules/zksync-ethers`

**Root Cause:** Required for zkSync L2 blockchain integration in testing.

**Mitigations:**
1. **Test Environment Only:** zkSync testing uses testnet, never mainnet
2. **No Real Funds:** All zkSync operations use test tokens
3. **Alternative Path:** Production zkSync operations will use updated SDK when available

**Risk Assessment:** ACCEPTED - Test-only usage with no production exposure.

---

### 6. ws (High)

**Vulnerability:** DoS via many HTTP headers (GHSA-3h5v-q93c-6h6q)

**Affected Components:**
- `node_modules/zksync-ethers/node_modules/ws`

**Root Cause:** Nested dependency of zksync-ethers which pins to an older ws version.

**Mitigations:**
1. **Test Environment:** Only used in development WebSocket connections
2. **Rate Limiting:** All WebSocket endpoints have connection limits
3. **Network Isolation:** Development WS servers not exposed to internet
4. **Production Uses Updated ws:** Root package uses ws v8.18+ via override

**Risk Assessment:** ACCEPTED - Development-only with network isolation.

---

### 7. @astrojs/cloudflare & wrangler (High)

**Vulnerability:** OS Command Injection in wrangler pages deploy (GHSA-36p8-mvp6-cv38)

**Affected Components:**
- `node_modules/@astrojs/cloudflare/node_modules/wrangler`

**Root Cause:** @astrojs/cloudflare pins to an older wrangler version for compatibility.

**Mitigations:**
1. **No User Input:** Deployment commands do not accept user input
2. **CI/CD Only:** Wrangler deployments run exclusively in GitHub Actions
3. **Controlled Environment:** CI runners are ephemeral and isolated
4. **Manual Approval:** Production deployments require team approval

**Risk Assessment:** ACCEPTED - Deployment tool with no user input injection path.

---

## Monitoring and Review

### Automated Checks
- Weekly `npm audit` runs in CI/CD
- Dependabot alerts enabled for critical vulnerabilities
- SBOM generated on each release

### Review Schedule
- Monthly review of accepted risks
- Immediate review when upstream fixes become available
- Quarterly reassessment of mitigation effectiveness

### Escalation Triggers
1. CVE score increase to 9.0+
2. Active exploitation in the wild
3. Upstream fix becomes available
4. New attack vector discovered

---

## Package Update Roadmap

### Q1 2026
- Monitor ethers v6 migration in hardhat ecosystem
- Track @noble/curves adoption in ethereum tooling
- Evaluate zksync-ethers v6 beta

### Q2 2026
- Migrate to ethers v6 across all dependencies when supported
- Replace hardhat-deploy with hardhat-deploy-ethers6 if available
- Update @astrojs/cloudflare when wrangler fix is included

---

## Approval

| Role | Name | Date | Decision |
|------|------|------|----------|
| Security Lead | | 2026-02-04 | APPROVED |
| Engineering Lead | | 2026-02-04 | APPROVED |
| CTO | | 2026-02-04 | APPROVED |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial documentation of P0-003 accepted risks | Security Team |
