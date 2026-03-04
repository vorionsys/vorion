---
sidebar_position: 3
title: OWASP Cheat Sheet
---

# ACI Security Cheat Sheet

Practical implementation guide mapping ACI controls to each of the **OWASP Top 10 for Agentic Applications** risks.

## Quick Reference

```
aci:<registry>:<org>:<agent-class>/<domains>/<level>/<trust>/<version>
```

## OWASP Risk Mitigation Matrix

### 1. Prompt Injection

**Risk**: Malicious instructions injected via user input or context data.

**ACI Controls:**
- Domain boundaries restrict agent's operational scope
- Capability level constrains executable actions
- Semantic governance validates instruction integrity

```typescript
// Validate agent has required domain before processing
if (!agent.aci_domains.includes('F')) {
  throw new Error('Agent not authorized for financial domain');
}
```

### 2. Insecure Output Handling

**Risk**: Agent outputs consumed without validation.

**ACI Controls:**
- Level-gated execution (L0–L1 agents can only suggest, not execute)
- Output schema binding prevents data exfiltration
- Prohibited pattern matching blocks sensitive data leakage

### 3. Training Data Poisoning

**Risk**: Compromised training data affects agent behavior.

**ACI Controls:**
- T3+ agents require data audit attestations
- Attestation chain verification validates provenance
- Inference scope controls limit knowledge sources

### 4. Model Denial of Service

**Risk**: Resource exhaustion attacks against agent infrastructure.

**ACI Controls:**
- Rate limits enforced by trust tier
- Lower trust = stricter limits
- Registry-level throttling per agent DID

### 5. Supply Chain Vulnerabilities

**Risk**: Compromised dependencies or components.

**ACI Controls:**
- Attestation chain verification (every component signed)
- Extension verification (signed by publisher DID)
- TEE attestation for runtime integrity

### 6. Sensitive Information Disclosure

**Risk**: Agent leaks confidential data.

**ACI Controls:**
- Domain restrictions limit data access
- Output schema binding with prohibited patterns
- Pairwise DIDs prevent identity correlation

### 7. Insecure Plugin Design

**Risk**: Plugins with excessive permissions.

**ACI Controls:**
- Monotonic capability derivation (plugins can't exceed host capabilities)
- Extension protocol with sandboxed execution
- Scope reduction enforcement in delegation chains

### 8. Excessive Agency

**Risk**: Agent takes actions beyond intended scope.

**ACI Controls:**
- Level-appropriate approval workflows (L0 observe, L2 requires approval, L3 policy-bound)
- Dual-channel authorization separates control from data plane
- Trust tier gates determine maximum autonomy

### 9. Overreliance

**Risk**: Users trust agent output without verification.

**ACI Controls:**
- Trust tier UI indicators show agent certification level
- Capability level badges indicate autonomy scope
- Attestation status visible in interfaces

### 10. Model Theft

**Risk**: Unauthorized access to model weights or logic.

**ACI Controls:**
- DID-based identity binds agent to deployment
- TEE attestation ensures code integrity
- Deployment-bound attestations prevent model portability attacks

## Implementation Checklist

### Registration Phase
- [ ] Generate agent DID and key pair
- [ ] Register ACI with appropriate domains, level, and trust
- [ ] Obtain capability attestation from certification authority
- [ ] Configure pairwise DID derivation for privacy

### Runtime Phase
- [ ] Enable DPoP sender-constrained tokens
- [ ] Implement capability checks before every action
- [ ] Configure output schema binding and prohibited patterns
- [ ] Set up instruction integrity validation
- [ ] Enable revocation status checking per SLA tier

### Monitoring Phase
- [ ] Deploy behavioral drift detection
- [ ] Configure trust score continuous evaluation
- [ ] Set up audit logging for all actions
- [ ] Enable alerting for anomalous capability usage

### Incident Response Phase
- [ ] Define revocation procedures per trust tier SLA
- [ ] Configure recursive revocation for delegation chains
- [ ] Set up incident notification webhooks
- [ ] Maintain runbooks for common failure modes
