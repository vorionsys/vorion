---
sidebar_position: 2
title: Integration Guide
---

# Integration Guide

How to integrate ACI with your existing infrastructure.

## OAuth 2.0 / OpenID Connect

### API Gateway Integration

Add ACI claim validation to your API gateway:

```typescript
// Express middleware
function requireACI(options: { domains?: string[], minLevel?: number, minTrust?: number }) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const decoded = verifyToken(token);

    // Check ACI claims
    if (options.domains) {
      const hasAll = options.domains.every(d => decoded.aci_domains?.includes(d));
      if (!hasAll) return res.status(403).json({ error: 'Insufficient domain authorization' });
    }

    if (options.minLevel !== undefined && decoded.aci_level < options.minLevel) {
      return res.status(403).json({ error: `Requires L${options.minLevel}+` });
    }

    if (options.minTrust !== undefined && decoded.aci_trust < options.minTrust) {
      return res.status(403).json({ error: `Requires T${options.minTrust}+` });
    }

    req.agent = decoded;
    next();
  };
}

// Usage
app.post('/api/transactions',
  requireACI({ domains: ['F'], minLevel: 3, minTrust: 4 }),
  handleTransaction
);
```

### Authorization Server Configuration

Register ACI claims and scopes with your OIDC provider:

```json
{
  "claims_supported": ["aci", "aci_domains", "aci_level", "aci_trust"],
  "scopes_supported": ["aci:F:L3", "aci:H:L2", "aci:*:L0"]
}
```

## DID Integration

### Resolve Agent Identity

```typescript
import { resolveDID } from '@vorionsys/aci-spec';

const didDocument = await resolveDID('did:aci:agentanchor:vorion:classifier');

// Verify the agent's public key
const publicKey = didDocument.verificationMethod[0].publicKeyJwk;

// Check ACI capabilities from DID Document
const capabilities = didDocument.aciCapabilities;
console.log(`Domains: ${capabilities.domains}, Level: L${capabilities.level}`);
```

### Verify Attestations

```typescript
const attestations = didDocument.aciAttestations;
for (const att of attestations) {
  const isValid = await verifyAttestation(att);
  const isExpired = new Date(att.expirationDate) < new Date();

  if (!isValid || isExpired) {
    throw new Error('Invalid or expired attestation');
  }
}
```

## Cognigate Integration

Use Cognigate as a policy engine for ACI-based governance:

```typescript
import { CognigateClient } from '@vorionsys/cognigate-client';

const cognigate = new CognigateClient({
  endpoint: 'https://api.cognigate.dev',
  apiKey: process.env.COGNIGATE_API_KEY,
});

// Evaluate policy before agent action
const decision = await cognigate.evaluate({
  agent: 'aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0',
  action: 'process-document',
  resource: 'financial-report',
  context: { documentType: 'tax-return', sensitivity: 'high' }
});

if (decision.allowed) {
  // Proceed
} else {
  console.log('Blocked:', decision.reason);
}
```

## ATSF Trust Scoring

Map ATSF trust scores to ACI trust tiers:

```typescript
import { trustScoreToTier } from '@vorionsys/aci-spec';

const atsfScore = 842;
const tier = trustScoreToTier(atsfScore); // T5 (Trusted: 800-875)

// Use in ACI string
const aci = `aci:agentanchor:vorion:classifier/FH/L3/T${tier}/1.0.0`;
```

| ATSF Score | ACI Tier | Name |
|------------|----------|------|
| 0–199 | T0 | Sandbox |
| 200–349 | T1 | Observed |
| 350–499 | T2 | Provisional |
| 500–649 | T3 | Monitored |
| 650–799 | T4 | Standard |
| 800–875 | T5 | Trusted |
| 876–950 | T6 | Certified |
| 951–1000 | T7 | Autonomous |

## BASIS Standard Integration

ACI agents can reference BASIS compliance through attestations:

```json
{
  "type": "BASISComplianceAttestation",
  "issuer": "did:aci:agentanchor:vorion:basis-ca",
  "claims": {
    "basisVersion": "1.0.0",
    "layers": ["identity", "behavior", "safety", "governance"],
    "complianceLevel": "full"
  }
}
```
