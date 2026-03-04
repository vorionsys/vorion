# ADR-012: SDK Language Support

## Status
**Accepted** - January 2025

## Context

The Vorion platform needs SDKs in multiple languages to support diverse agent ecosystems:

1. **TypeScript/JavaScript** - Web agents, Node.js services (reference implementation)
2. **Python** - ML/AI agents, data science workflows, LangChain/LlamaIndex integrations
3. **Go** - High-performance agents, cloud-native services
4. **Rust** - System-level agents, embedded runtimes
5. **Java/Kotlin** - Enterprise agents, Android apps

Current state:
- TypeScript SDK (`@agentanchor/sdk`) is the reference implementation
- No other language SDKs exist
- API is REST-based, enabling any HTTP client

Challenges:
- Maintaining feature parity across languages
- Type safety in dynamically-typed languages
- Async/await patterns vary by language
- Testing across language ecosystems

## Decision

We implement a **tiered SDK strategy** with generated and hand-crafted components:

### 1. SDK Tiers

| Tier | Languages | Approach | Maintainer |
|------|-----------|----------|------------|
| **Tier 1** | TypeScript | Reference implementation | Core team |
| **Tier 2** | Python, Go | Generated + hand-crafted | Core team |
| **Tier 3** | Rust, Java/Kotlin | Community with core review | Community |

### 2. SDK Architecture Layers

Each SDK consists of three layers:

```
┌─────────────────────────────────────┐
│          High-Level SDK             │  ← Idiomatic API
│  (AgentAnchor, TrustEngine, etc.)   │
├─────────────────────────────────────┤
│         Generated Client            │  ← From OpenAPI
│  (HTTP client, request/response)    │
├─────────────────────────────────────┤
│           Core Types                │  ← From JSON Schema
│  (CAR, TrustScore, Attestation)     │
└─────────────────────────────────────┘
```

### 3. Code Generation Strategy

**Source of Truth:**
- OpenAPI 3.1 specification for REST API
- JSON Schema for domain types
- Protocol Buffers for A2A messages (future)

**Generation Tools:**

| Language | Type Generator | Client Generator |
|----------|----------------|------------------|
| TypeScript | - (manual) | - (manual) |
| Python | datamodel-code-generator | openapi-python-client |
| Go | go-jsonschema | oapi-codegen |
| Rust | typify | progenitor |
| Java/Kotlin | jsonschema2pojo | openapi-generator |

### 4. Core Type Mapping

| TypeScript | Python | Go | Rust | Java |
|------------|--------|-----|------|------|
| `string` | `str` | `string` | `String` | `String` |
| `number` | `int`/`float` | `int`/`float64` | `i32`/`f64` | `int`/`double` |
| `boolean` | `bool` | `bool` | `bool` | `boolean` |
| `Date` | `datetime` | `time.Time` | `chrono::DateTime` | `Instant` |
| `Record<K,V>` | `Dict[K,V]` | `map[K]V` | `HashMap<K,V>` | `Map<K,V>` |
| `T[]` | `List[T]` | `[]T` | `Vec<T>` | `List<T>` |
| `T \| null` | `Optional[T]` | `*T` | `Option<T>` | `@Nullable T` |
| `Promise<T>` | `Awaitable[T]` | `<-chan T` | `Future<T>` | `CompletableFuture<T>` |

### 5. SDK Feature Matrix

| Feature | TS | Python | Go | Rust | Java |
|---------|-----|--------|-----|------|------|
| Agent Registration | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trust Scoring | ✓ | ✓ | ✓ | ✓ | ✓ |
| Attestations | ✓ | ✓ | ✓ | ✓ | ✓ |
| A2A Invoke | ✓ | ✓ | ✓ | ○ | ○ |
| A2A Streaming | ✓ | ✓ | ○ | ○ | ○ |
| Sandbox Client | ✓ | ○ | ○ | ○ | ○ |
| Plugin SDK | ✓ | ✓ | ○ | - | - |

✓ = Implemented, ○ = Planned, - = Not planned

### 6. Package Structure

Each SDK follows a consistent structure:

```
sdk-{language}/
├── src/                    # Source code
│   ├── client/             # HTTP client
│   ├── types/              # Domain types
│   ├── agent/              # Agent operations
│   ├── trust/              # Trust operations
│   ├── attestation/        # Attestation operations
│   └── a2a/                # A2A operations
├── examples/               # Usage examples
├── tests/                  # Test suite
├── docs/                   # Language-specific docs
├── README.md               # Quick start
├── CHANGELOG.md            # Version history
└── {package-config}        # package.json, setup.py, go.mod, Cargo.toml
```

### 7. Python SDK Design

```python
from agentanchor import AgentAnchor, CapabilityLevel
from agentanchor.types import RegisterAgentOptions, AttestationType

# Initialize client
anchor = AgentAnchor(api_key="your-api-key")

# Register agent
agent = await anchor.register_agent(RegisterAgentOptions(
    organization="acme",
    agent_class="invoice-bot",
    domains=["A", "B", "F"],
    level=CapabilityLevel.L3_EXECUTE,
    version="1.0.0",
))

print(f"Registered: {agent.aci}")

# Get trust score
score = await anchor.get_trust_score(agent.aci)
print(f"Trust: {score.score}/1000 (Tier {score.tier})")

# Submit attestation
await anchor.submit_attestation(
    aci=agent.aci,
    type=AttestationType.BEHAVIORAL,
    outcome="success",
    action="process_invoice",
)
```

### 8. Go SDK Design

```go
package main

import (
    "context"
    "fmt"
    anchor "github.com/vorion/agentanchor-go"
)

func main() {
    // Initialize client
    client := anchor.NewClient(anchor.Config{
        APIKey: "your-api-key",
    })

    // Register agent
    agent, err := client.RegisterAgent(context.Background(), anchor.RegisterAgentOptions{
        Organization: "acme",
        AgentClass:   "invoice-bot",
        Domains:      []string{"A", "B", "F"},
        Level:        anchor.L3Execute,
        Version:      "1.0.0",
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Registered: %s\n", agent.CAR)

    // Get trust score
    score, err := client.GetTrustScore(context.Background(), agent.CAR)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Trust: %d/1000 (Tier %d)\n", score.Score, score.Tier)
}
```

### 9. Testing Strategy

Each SDK must pass:

1. **Unit Tests** - Pure logic, mocked HTTP
2. **Integration Tests** - Against test server
3. **Contract Tests** - Verify API compatibility
4. **Conformance Tests** - Cross-language behavior parity

**Shared Test Fixtures:**
```json
{
  "register_agent": {
    "input": { "organization": "acme", "agentClass": "test", ... },
    "expected": { "aci": "a3i.acme.test:A-L1@1.0.0", ... }
  },
  "trust_score": {
    "input": { "aci": "a3i.acme.test:A-L1@1.0.0" },
    "expected": { "score": 0, "tier": 0 }
  }
}
```

### 10. Documentation Requirements

Each SDK must include:

1. **README** - Quick start, installation, basic usage
2. **API Reference** - Generated from code comments
3. **Examples** - Common use cases
4. **Migration Guide** - Version upgrade paths
5. **CHANGELOG** - Keep a Changelog format

## Implementation Phases

### Phase 1: Foundation (Current)
- [x] TypeScript SDK (reference)
- [ ] OpenAPI specification generation
- [ ] JSON Schema for types
- [ ] Shared test fixtures

### Phase 2: Python SDK
- [ ] Type generation from JSON Schema
- [ ] Client generation from OpenAPI
- [ ] High-level SDK wrapper
- [ ] PyPI publishing

### Phase 3: Go SDK
- [ ] Type generation
- [ ] Client generation
- [ ] High-level wrapper
- [ ] Go module publishing

### Phase 4: Community SDKs
- [ ] Rust SDK (community)
- [ ] Java/Kotlin SDK (community)
- [ ] SDK contribution guidelines

## Consequences

### Positive
- **Broad adoption** - Agents in any language can integrate
- **Consistency** - Generated code ensures API alignment
- **Maintainability** - Single source of truth reduces drift

### Negative
- **Generation complexity** - Toolchain for each language
- **Idiomatic gaps** - Generated code may not feel native
- **Testing burden** - Each SDK needs its own test suite

### Mitigations
- Hand-craft high-level APIs for idiomatic feel
- Automated conformance testing
- Community contributions for language expertise

## SDK Versioning

SDKs follow independent versioning with API compatibility markers:

```python
SDK_VERSION = "1.2.3"
MIN_API_VERSION = "1.0.0"
MAX_API_VERSION = "1.99.99"
```

## References

- [ADR-011: Versioning Strategy](ADR-011-versioning-strategy.md)
- [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0)
- [JSON Schema](https://json-schema.org/)
- [Smithy (AWS API modeling)](https://smithy.io/)
