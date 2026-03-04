---
sidebar_position: 2
title: Extension Protocol
---

# ACI Extension Protocol Specification

The Extension Protocol defines a standardized Layer 4 mechanism for adding optional runtime governance, monitoring, and compliance capabilities to ACI systems while maintaining backward compatibility with core 3-layer implementations.

## Motivation

Core ACI (Layers 1–3) handles identity, verification, and authorization. But production AI agent deployments also need:

- **Behavioral drift detection** — monitoring agents for policy violations at runtime
- **Runtime governance** — enforcing compliance rules during execution
- **Audit logging** — comprehensive action trails for regulatory compliance
- **Domain-specific controls** — healthcare (HIPAA), finance (SOX), legal requirements

## Extension Identification

```
Extension ID format: aci-ext-{domain}-v{major}
Shortcode:           ext-{domain}
ACI suffix:          #ext-{shortcode}
```

Example ACI with extensions:

```
aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0#ext-cognigate,ext-hipaa
```

## Extension Protocol Interface

```typescript
interface ACIExtension {
  // Identity
  readonly id: string;            // e.g. "aci-ext-cognigate-v1"
  readonly shortcode: string;     // e.g. "cognigate"
  readonly version: string;       // semver

  // Lifecycle hooks
  onAgentRegister?(agent: ACIAgent): Promise<ExtensionResult>;
  onAgentDeregister?(agent: ACIAgent): Promise<ExtensionResult>;

  // Capability hooks
  onCapabilityRequest?(request: CapabilityRequest): Promise<ExtensionResult>;
  onCapabilityGrant?(grant: CapabilityGrant): Promise<ExtensionResult>;

  // Action hooks
  beforeAction?(action: AgentAction): Promise<ExtensionResult>;
  afterAction?(action: AgentAction, result: ActionResult): Promise<ExtensionResult>;

  // Monitoring hooks
  onBehavioralDrift?(drift: DriftEvent): Promise<ExtensionResult>;
  onTrustScoreChange?(change: TrustChange): Promise<ExtensionResult>;

  // Trust hooks
  onTrustEvaluation?(evaluation: TrustEvaluation): Promise<ExtensionResult>;

  // Policy hooks
  evaluatePolicy?(context: PolicyContext): Promise<PolicyDecision>;
}
```

## Extension Registration

Extensions register with the ACI registry via:

```
POST /api/v1/extensions
Content-Type: application/json

{
  "id": "aci-ext-cognigate-v1",
  "shortcode": "cognigate",
  "version": "1.0.0",
  "publisher": "did:aci:agentanchor:vorion:cognigate",
  "capabilities": ["governance", "monitoring", "policy"],
  "minimumTrust": "T3"
}
```

## Backward Compatibility

- Extensions are **optional** — core ACI (L1–L3) works without them
- Extension-unaware systems ignore the `#ext-...` suffix
- Extension ordering is deterministic (alphabetical by shortcode)
- Extension failures are isolated — one failing extension doesn't block others

## Reference Extensions

### Cognigate Governance Extension

Full runtime governance with policy evaluation, action gating, and audit logging.

### HIPAA Healthcare Extension

Healthcare-specific controls for PHI handling, access logging, and compliance reporting.

## Security Considerations

- Extension code MUST be verified (signed by publisher DID)
- Hook execution is sandboxed — extensions cannot modify other extensions
- Sensitive data from hooks MUST NOT be persisted without consent
- Extension timeout SLAs: `beforeAction` ≤ 100ms, `afterAction` ≤ 500ms
