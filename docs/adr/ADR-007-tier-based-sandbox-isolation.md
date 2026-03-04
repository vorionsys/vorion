# ADR-007: Tier-Based Sandbox Isolation

## Status
**Accepted** - January 2025

## Context

Cognigate serves as the execution gateway for agent operations. Agents operate at different trust levels (T0-T7), and their access to system resources (network, filesystem, compute) must be commensurate with their trust tier. Without proper isolation:

1. **Malicious agents** could exfiltrate data via network
2. **Buggy agents** could corrupt shared filesystems
3. **Resource-hungry agents** could starve other workloads
4. **Low-tier agents** could access capabilities beyond their trust level

The challenge: implement progressive isolation that's strict for untrusted agents (T0-T1) but allows higher-tier agents (T5-T7) to operate efficiently with appropriate capabilities.

## Decision

We implement **tier-based sandbox isolation** with three enforcement layers:

### 1. Network Isolation
Each trust tier maps to a network access level:

| Tier | Network Level | Capabilities |
|------|--------------|--------------|
| T0-T1 | NONE | Localhost only |
| T2-T3 | INTERNAL | Internal APIs (allowlist) |
| T4 | EXTERNAL | Policy-governed egress |
| T5-T6 | CROSS_AGENT | A2A communication |
| T7 | FULL | Full access (monitored) |

Enforcement via:
- Network namespaces per sandbox
- iptables rules generated from policy
- DNS filtering based on allowed domains
- Connection tracking and rate limiting

### 2. Filesystem Isolation
Each trust tier maps to filesystem access level:

| Tier | FS Level | Capabilities |
|------|----------|--------------|
| T0-T1 | READONLY_SANDBOX | Read-only base, /tmp only |
| T2-T4 | WORKSPACE | Agent workspace + /tmp |
| T5-T6 | EXTENDED | Workspace + approved mounts |
| T7 | FULL | Full access (audited) |

Enforcement via:
- Overlay filesystem with ephemeral upper layer
- Bind mounts for allowed paths only
- Disk quotas per tier
- Access control rules blocking sensitive paths

### 3. Resource Limits
Each tier has compute resource caps:

| Tier | Memory | CPU | Execution Time |
|------|--------|-----|----------------|
| T0 | 256MB | 25% | 30s |
| T1 | 512MB | 25% | 60s |
| T2 | 512MB | 50% | 2m |
| T3 | 1GB | 50% | 5m |
| T4 | 2GB | 75% | 10m |
| T5 | 4GB | 100% | 30m |
| T6 | 8GB | 100% | 1h |
| T7 | Unlimited | 100% | Unlimited |

### Runtime Selection
Sandbox runtime is selected based on tier:

- **T0-T1**: gVisor (strongest isolation, kernel syscall interception)
- **T2-T6**: Docker with seccomp (good isolation, lower overhead)
- **T7**: None (host execution, full monitoring)

### Capability Broker
Runtime capability requests are handled through a broker:

1. Agent requests capability (e.g., network egress)
2. Broker checks if tier permits the capability
3. If permitted, capability is granted with conditions (rate limits, audit level)
4. Usage is tracked; capability can be revoked on violation

## Consequences

### Positive
- **Defense in depth**: Multiple isolation layers prevent single-point bypasses
- **Progressive trust**: Agents earn capabilities as trust increases
- **Observability**: All operations are logged for trust scoring
- **Flexibility**: Capability broker allows runtime adaptation

### Negative
- **Performance overhead**: gVisor adds latency for T0-T1
- **Complexity**: Three enforcement systems to maintain
- **False positives**: Legitimate operations may be blocked at low tiers

### Neutral
- **Requires container/VM infrastructure**: Production deployments need container orchestration
- **Audit storage**: Activity logs consume storage; requires retention policy

## Implementation

### Files Created
- `src/cognigate/sandbox/types.ts` - Type definitions and TIER_CAPABILITIES
- `src/cognigate/sandbox/sandbox-service.ts` - Main sandbox lifecycle manager
- `src/cognigate/sandbox/network-policy.ts` - Network namespace and iptables
- `src/cognigate/sandbox/filesystem-policy.ts` - Overlay FS and access control
- `src/cognigate/sandbox/capability-broker.ts` - Runtime capability mediation

### Integration Points
- **Agent Anchor**: Trust tier lookup before sandbox creation
- **Kaizen**: Orchestrates sandbox execution for multi-agent workflows
- **A3I Cache**: Stores sandbox attestation data for trust scoring

## Alternatives Considered

### 1. Flat Sandbox for All Tiers
Rejected: One-size-fits-all creates unnecessary overhead for trusted agents and insufficient isolation for untrusted ones.

### 2. VM-Only Isolation
Rejected: Too heavyweight for high-volume operations. VMs reserved for highest-risk scenarios.

### 3. WASM-Only Runtime
Rejected: WebAssembly provides good isolation but lacks network/filesystem abstractions needed for agent operations. Considered for future lightweight workloads.

### 4. Trust the User to Set Policies
Rejected: Violates "system enforces tier caps" principle. Users can configure policies within tier constraints, but cannot exceed tier-defined maximums.

## References

- [ADR-002: 8-Tier Trust Model](ADR-002-8-tier-trust-model.md)
- [ADR-006: User Decides Risk, System Enforces Caps](ADR-006-user-decides-risk.md)
- [gVisor Documentation](https://gvisor.dev/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
