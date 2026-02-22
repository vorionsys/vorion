# @vorionsys/car-spec

OpenAPI 3.1.0 specification for the **Categorical Agentic Registry (CAR)** and **Trust Engine** API -- the machine-readable contract that every Vorion SDK, CLI, and integration is built from.

## What is CAR?

The **Categorical Agentic Registry (CAR)** is Vorion's universal certification and classification system for autonomous AI agents. Every agent in the Vorion ecosystem receives a **CAR ID** -- a unique, immutable, cryptographically-anchored identity that tracks registration, provenance, capability declarations, and role permissions across the agent's entire lifecycle.

CAR is the **identity registry** that the **Phase 6 Trust Engine** (ATSF/Cognigate) relies on. The trust engine provides dynamic behavioral trust scoring, role-based access control, capability ceilings, and gaming detection -- all keyed to CAR IDs. In short: **CAR answers "WHO is this agent?"** while **ATSF/Cognigate answers "HOW MUCH do we trust this agent?"**

## What This Package Provides

This package contains a single file -- `openapi.yaml` -- the source-of-truth OpenAPI 3.1.0 specification for the Vorion CAR & Trust Engine API (v1.0.0). All typed clients, server stubs, and documentation are generated from this spec.

## Using the Spec

### Generate a TypeScript SDK

```bash
npx @openapitools/openapi-generator-cli generate \
  -i node_modules/@vorionsys/car-spec/openapi.yaml \
  -g typescript-fetch \
  -o ./generated/car-client
```

### Generate a Python SDK

```bash
openapi-generator generate \
  -i node_modules/@vorionsys/car-spec/openapi.yaml \
  -g python \
  -o ./generated/car-python
```

### Import into Swagger UI

Point Swagger UI at the spec file to get an interactive API explorer:

```bash
docker run -p 8080:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v $(pwd)/node_modules/@vorionsys/car-spec:/spec \
  swaggerapi/swagger-ui
```

### Import into Postman

1. Open Postman and select **Import**.
2. Choose the `openapi.yaml` file from this package.
3. Postman will generate a full collection with all endpoints, parameters, and example payloads.

### Validate the Spec

```bash
npx @redocly/cli lint node_modules/@vorionsys/car-spec/openapi.yaml
```

## API Overview

| Property | Value |
|----------|-------|
| **Spec version** | OpenAPI 3.1.0 |
| **API version** | 1.0.0 |
| **Production URL** | `https://api.vorion.org/v1` |
| **Staging URL** | `https://staging-api.vorion.org/v1` |
| **Local dev URL** | `http://localhost:3000/api/v1` |
| **Auth** | Bearer token (JWT) or API key (`X-API-Key` header) |
| **Rate limits** | 100 req/min (default), 200 req/min (authenticated), 30 req/min (role gates) |
| **Error format** | `P6_ERROR_CODE` (e.g., `P6_UNAUTHORIZED`, `P6_RATE_LIMITED`) |
| **License** | Apache-2.0 |

## Endpoint Reference

### Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/stats` | Dashboard statistics (CAR identity + trust engine metrics) |

### Role Gates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/role-gates` | List role gate configurations |
| `POST` | `/phase6/role-gates` | Create a new role gate |
| `POST` | `/phase6/role-gates/evaluate` | Evaluate role gate access for an agent |
| `GET` | `/phase6/role-gates/{gateId}` | Get role gate by ID |
| `PATCH` | `/phase6/role-gates/{gateId}` | Update role gate |
| `DELETE` | `/phase6/role-gates/{gateId}` | Delete role gate |

### Capability Ceilings

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/phase6/ceiling/check` | Check if an agent exceeds a capability ceiling |
| `GET` | `/phase6/ceiling/usage` | Get ceiling usage statistics for an agent |

### Provenance

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/provenance` | List provenance records |
| `POST` | `/phase6/provenance` | Create a provenance record |
| `GET` | `/phase6/provenance/{provenanceId}` | Get provenance record by ID |
| `GET` | `/phase6/provenance/{provenanceId}/chain` | Get full provenance chain |

### Gaming Detection Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/alerts` | List gaming detection alerts |
| `GET` | `/phase6/alerts/{alertId}` | Get alert by ID |
| `PATCH` | `/phase6/alerts/{alertId}` | Update alert status |

### Presets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/presets` | List governance presets |
| `POST` | `/phase6/presets` | Create a custom preset |
| `POST` | `/phase6/presets/{presetId}/apply` | Apply a preset (supports dry run) |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/phase6/webhooks` | List webhooks |
| `POST` | `/phase6/webhooks` | Create a webhook |
| `DELETE` | `/phase6/webhooks/{webhookId}` | Delete a webhook |
| `POST` | `/phase6/webhooks/{webhookId}/test` | Test a webhook |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (database, redis) |
| `GET` | `/health/ready` | Readiness check |

## Related Packages

| Package | Description |
|---------|-------------|
| [`@vorionsys/car-client`](../car-client) | TypeScript client SDK for the CAR & Trust Engine API |
| [`@vorionsys/car-cli`](../car-cli) | CLI tool for CAR operations |
| [`@vorionsys/car-python`](../car-python) | Python client SDK |

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

## Links

- [Repository](https://github.com/voriongit/vorion)
- [Package directory](https://github.com/voriongit/vorion/tree/main/packages/car-spec)
- [Issue tracker](https://github.com/voriongit/vorion/issues)
