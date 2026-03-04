---
sidebar_position: 5
title: Extension Protocol
---

# Extension Protocol

The CAR Extension Protocol enables optional runtime governance capabilities via a standardized hook system, maintaining backward compatibility with core implementations.

## Extension Format

Extensions are declared in the CAR string after a `#` separator:

```
a3i.vorion.classifier:DF-L3@1.0.0#cognigate
a3i.hospital.triage:DHS-L4@2.0.0#cognigate,hipaa
```

## Extension Interface

```typescript
interface CARExtension {
  readonly id: string;           // e.g. "car-ext-cognigate-v1"
  readonly shortcode: string;    // e.g. "cognigate"
  readonly version: string;

  // Pre-action hook — runs before agent executes
  preCheck?(context: ActionContext): Promise<ExtensionResult>;

  // Post-action hook — runs after agent executes
  postAction?(context: ActionContext, result: ActionResult): Promise<ExtensionResult>;

  // Behavioral verification — continuous monitoring
  verifyBehavior?(metrics: BehaviorMetrics): Promise<ExtensionResult>;
}
```

### Hook Execution Order

1. All registered extensions' `preCheck()` hooks run in alphabetical order
2. If any returns `deny`, the action is blocked
3. Agent executes the action
4. All `postAction()` hooks run (for audit/monitoring)
5. `verifyBehavior()` runs periodically in the background

### Timeout SLAs

| Hook | Max Duration | Failure Mode |
|------|-------------|-------------|
| `preCheck` | 100ms | Deny (fail-closed) |
| `postAction` | 500ms | Log warning, continue |
| `verifyBehavior` | 5s | Log, schedule retry |

## Reference Extensions

### Cognigate Governance (`#cognigate`)

Full runtime governance with policy evaluation, action gating, and comprehensive audit logging.

```typescript
{
  id: 'car-ext-cognigate-v1',
  shortcode: 'cognigate',
  preCheck: async (ctx) => {
    const policy = await cognigate.evaluate(ctx.agent, ctx.action);
    return policy.allowed ? { allow: true } : { deny: true, reason: policy.reason };
  },
  postAction: async (ctx, result) => {
    await cognigate.audit(ctx.agent, ctx.action, result);
    return { allow: true };
  }
}
```

### HIPAA Healthcare (`#hipaa`)

Healthcare-specific controls for PHI handling, access logging, and compliance reporting.

### EU AI Act (`#euai`)

European Union AI Act compliance checks — risk classification, transparency requirements, human oversight enforcement.

## Creating Custom Extensions

1. Implement the `CARExtension` interface
2. Register with the CAR registry
3. Publish extension metadata (DID-signed)
4. Agents reference via shortcode in their CAR string

## Backward Compatibility

- Extensions are optional — core CAR parsing ignores the `#` suffix
- Extension-unaware systems process the base CAR string normally
- Extensions cannot modify the agent's identity, domains, or level
