# SDK Generation Guide

This document describes how to generate Agent Anchor SDKs for different languages.

## Prerequisites

- Node.js 20+
- Python 3.10+ (for Python SDK)
- Go 1.21+ (for Go SDK)
- Rust 1.70+ (for Rust SDK)

## Source Files

All SDKs are generated from these source files:

- `packages/agentanchor-sdk/openapi.yaml` - OpenAPI 3.1 specification
- `packages/agentanchor-sdk/schemas/types.json` - JSON Schema type definitions

## Generation Commands

### TypeScript SDK (Reference - Manual)

The TypeScript SDK is manually maintained as the reference implementation.

```bash
cd packages/agentanchor-sdk
npm run build
npm run test
```

### Python SDK

```bash
# Install generators
pip install datamodel-code-generator openapi-python-client

# Generate types from JSON Schema
datamodel-codegen \
  --input packages/agentanchor-sdk/schemas/types.json \
  --output packages/agentanchor-sdk-python/agentanchor/types.py \
  --target-python-version 3.10 \
  --use-standard-collections \
  --use-union-operator

# Generate client from OpenAPI
openapi-python-client generate \
  --path packages/agentanchor-sdk/openapi.yaml \
  --output-path packages/agentanchor-sdk-python/agentanchor/client \
  --config packages/agentanchor-sdk-python/openapi-config.yaml
```

### Go SDK

```bash
# Install generators
go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
go install github.com/atombender/go-jsonschema/cmd/gojsonschema@latest

# Generate types
gojsonschema \
  -p types \
  -o packages/agentanchor-sdk-go/types/types.go \
  packages/agentanchor-sdk/schemas/types.json

# Generate client
oapi-codegen \
  -package client \
  -generate types,client \
  -o packages/agentanchor-sdk-go/client/client.go \
  packages/agentanchor-sdk/openapi.yaml
```

### Rust SDK

```bash
# Install generators
cargo install typify-cli
cargo install progenitor-cli

# Generate types
typify \
  packages/agentanchor-sdk/schemas/types.json \
  > packages/agentanchor-sdk-rust/src/types.rs

# Generate client
progenitor \
  packages/agentanchor-sdk/openapi.yaml \
  -o packages/agentanchor-sdk-rust/src/client.rs
```

### Java/Kotlin SDK

```bash
# Using OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i packages/agentanchor-sdk/openapi.yaml \
  -g kotlin \
  -o packages/agentanchor-sdk-kotlin \
  --additional-properties=packageName=dev.agentanchor.sdk

# Generate types from JSON Schema
npx json-schema-to-typescript \
  packages/agentanchor-sdk/schemas/types.json \
  --out packages/agentanchor-sdk-kotlin/src/main/kotlin/dev/agentanchor/sdk/Types.kt
```

## Post-Generation Steps

After generating, each SDK needs:

1. **High-Level Wrapper** - Add idiomatic `AgentAnchor` class
2. **Error Handling** - Language-specific exception types
3. **Retry Logic** - Exponential backoff with jitter
4. **Tests** - Unit and integration tests
5. **Documentation** - README and API docs
6. **Examples** - Usage examples

## Validation

Run conformance tests to ensure all SDKs behave identically:

```bash
# Run conformance test suite (requires test server)
npm run test:conformance

# This runs shared test fixtures against each SDK
```

## Publishing

### npm (TypeScript)
```bash
cd packages/agentanchor-sdk
npm publish --access public
```

### PyPI (Python)
```bash
cd packages/agentanchor-sdk-python
python -m build
twine upload dist/*
```

### Go Modules (Go)
```bash
cd packages/agentanchor-sdk-go
git tag v1.0.0
git push origin v1.0.0
```

### crates.io (Rust)
```bash
cd packages/agentanchor-sdk-rust
cargo publish
```

### Maven Central (Kotlin)
```bash
cd packages/agentanchor-sdk-kotlin
./gradlew publish
```

## Version Synchronization

All SDKs should export:

```
SDK_VERSION = "x.y.z"      # SDK version
MIN_API_VERSION = "1.0.0"  # Minimum supported API
MAX_API_VERSION = "1.x.x"  # Maximum supported API
```

Update the SDK compatibility matrix in docs when releasing new versions.
