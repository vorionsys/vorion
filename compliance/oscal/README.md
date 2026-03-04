# OSCAL Compliance Artifacts for Vorion Cognigate

## Overview

This directory contains OSCAL (Open Security Controls Assessment Language) machine-readable compliance documentation for the Vorion Cognigate Governance Engine. These artifacts map Cognigate's security capabilities to NIST SP 800-53 Rev 5 controls at the Moderate baseline.

OSCAL is a NIST-developed standardized format for expressing security control information in machine-readable JSON, XML, or YAML. This enables automated compliance verification, control inheritance documentation, and integration with GRC (Governance, Risk, and Compliance) platforms.

## Artifacts

### component-definition.json

**OSCAL Model:** Component Definition (v1.1.2)

**Purpose:** Defines the Cognigate Governance Engine as a security component and documents how it implements or supports NIST SP 800-53 Rev 5 Moderate baseline controls. This is the primary artifact for:

- ICP (Initial Compliance Package) review submissions
- FedRAMP authorization boundary documentation
- Consumer organizations documenting inherited controls
- Automated compliance gap analysis

**Contents:**

| Section | Description |
|---------|-------------|
| Metadata | Document versioning, authoring organization (Vorion, Inc.), role definitions (provider, consumer, assessor) |
| Component | Cognigate Governance Engine with type, purpose, protocols, and properties |
| Control Implementations | 47 implemented requirements across 10 control families mapped to NIST SP 800-53 Rev 5 |
| Back Matter | References to NIST catalogs, BASIS specification, security policy, and related documentation |

**Control Family Coverage:**

| Family | Controls | Description |
|--------|----------|-------------|
| AC (Access Control) | 9 | Policy engine, entity management, capability-based access, trust-tier gating, velocity caps, circuit breaker session lock |
| AU (Audit & Accountability) | 9 | Proof chain audit trail, ProofRecord schema, query/analysis API, timestamps, chain integrity, Ed25519 non-repudiation, retention, automatic generation |
| CM (Configuration Management) | 5 | Policy versioning, change tracking, admin access controls, capability taxonomy, SBOM/component inventory |
| IA (Identification & Authentication) | 4 | Entity identification, entity_id management, Ed25519 key management, non-organizational entity verification |
| IR (Incident Response) | 3 | Circuit breaker automatic trip, incident data preservation, status/alert reporting |
| RA (Risk Assessment) | 2 | Real-time risk scoring (0.0-1.0), tripwire detection + AI critic analysis |
| SC (System & Communications Protection) | 4 | API boundary protection, HTTPS enforcement, Ed25519 key management, SHA-256 hash chain cryptographic protection |
| SI (System & Information Integrity) | 5 | Tripwire malicious code detection, circuit breaker monitoring, security advisories, proof chain integrity verification, Pydantic/Zod input validation |
| SA (Supply Chain) | 5 | Dependency tracking, gateway proxy external services, Semgrep/CodeQL/Gitleaks SAST, 593+ automated tests, CycloneDX SBOM |
| CA (Continuous Monitoring) | 1 | Health endpoints, admin status, circuit breaker monitoring, velocity tracking |

**Responsibility Distribution:**

| Responsibility | Count | Meaning |
|----------------|-------|---------|
| provided | 20 | Cognigate fully implements; consumers inherit the control |
| shared | 27 | Cognigate implements the mechanism; consumers configure/operate for their environment |

Each control's `remarks` field explains the specific responsibility split between Cognigate (provider) and the consuming organization.

## Validation

### JSON Schema Validation

Validate the component definition against the official OSCAL JSON schema:

```bash
# Install oscal-cli (requires Java 11+)
# Download from: https://github.com/usnistgov/oscal-cli/releases

# Validate against OSCAL schema
oscal-cli validate \
  vorion/compliance/oscal/component-definition.json \
  --as component-definition

# Alternative: validate with ajv-cli against the OSCAL JSON schema
npm install -g ajv-cli ajv-formats
ajv validate \
  -s https://raw.githubusercontent.com/usnistgov/OSCAL/main/json/schema/oscal_component-definition_schema.json \
  -d vorion/compliance/oscal/component-definition.json \
  --spec=draft2020-12 \
  -c ajv-formats
```

### Basic JSON Validation

```bash
# Verify well-formed JSON
python3 -m json.tool vorion/compliance/oscal/component-definition.json > /dev/null && echo "Valid JSON"

# Verify structure with jq
jq '.["component-definition"].metadata.title' vorion/compliance/oscal/component-definition.json
jq '.["component-definition"].components[0]["control-implementations"][0]["implemented-requirements"] | length' vorion/compliance/oscal/component-definition.json
```

### Control Coverage Verification

```bash
# List all control IDs
jq -r '.["component-definition"].components[0]["control-implementations"][0]["implemented-requirements"][].["control-id"]' \
  vorion/compliance/oscal/component-definition.json | sort

# Count by control family
jq -r '.["component-definition"].components[0]["control-implementations"][0]["implemented-requirements"][].["control-id"]' \
  vorion/compliance/oscal/component-definition.json | \
  sed 's/-[0-9]*$//' | sort | uniq -c | sort -rn

# List responsibility assignments
jq -r '.["component-definition"].components[0]["control-implementations"][0]["implemented-requirements"][] |
  "\(.["control-id"])\t\(.props[] | select(.name == "responsibility") | .value)"' \
  vorion/compliance/oscal/component-definition.json | column -t
```

### UUID Uniqueness Verification

```bash
# Extract all UUIDs and verify uniqueness
python3 -c "
import json, re
with open('vorion/compliance/oscal/component-definition.json') as f:
    content = f.read()
uuids = re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', content)
print(f'Total UUIDs: {len(uuids)}')
print(f'Unique UUIDs: {len(set(uuids))}')
dupes = [u for u in set(uuids) if uuids.count(u) > 1]
if dupes:
    print(f'WARNING: Duplicate UUIDs found: {dupes}')
else:
    print('All UUIDs are unique (excluding cross-references)')
"
```

## Integration

### GRC Platform Import

This OSCAL component definition can be imported into GRC platforms that support OSCAL:

- **RegScale** — Import as component definition; maps to inherited controls
- **Trestle** — `trestle import -f component-definition.json -o cognigate`
- **Lula** — Component definition consumed directly for compliance validation
- **Compliance-trestle** — `trestle import -f component-definition.json -t component-definition`

### SSP (System Security Plan) Integration

When a consumer organization builds their System Security Plan, Cognigate's controls marked as `provided` can be referenced as inherited controls:

```json
{
  "implemented-requirement": {
    "control-id": "ac-3",
    "by-components": [
      {
        "component-uuid": "383eacad-0028-4655-99a8-2d31a7cafde6",
        "description": "Inherited from Cognigate Governance Engine. See Cognigate component definition for implementation details.",
        "implementation-status": {
          "state": "inherited"
        }
      }
    ]
  }
}
```

### FedRAMP Alignment

This component definition is structured for FedRAMP Moderate authorization:

- **Impact Level:** Moderate (as specified in governance-matrix.yaml)
- **Control Source:** NIST SP 800-53 Rev 5 catalog
- **Baseline:** Moderate (NIST SP 800-53B)
- **Responsibility Model:** Provider/shared/consumer (maps to FedRAMP's responsibility model)

## Maintenance

### Update Procedures

1. **New control implementations** — Add new `implemented-requirements` entries when Cognigate adds capabilities that satisfy additional controls
2. **Control description updates** — Update `description` fields when implementation details change (e.g., new enforcement mechanisms, additional audit events)
3. **Responsibility changes** — Update `responsibility` props if the responsibility model changes (e.g., a shared control becomes fully provided)
4. **Version bumps** — Update `metadata.version` and `metadata.last-modified` on every change

### Document Control

| Field | Value |
|-------|-------|
| Document Version | 1.0.0 |
| OSCAL Version | 1.1.2 |
| Target Baseline | NIST SP 800-53 Rev 5 Moderate |
| Last Modified | 2026-02-19 |
| Author | Vorion, Inc. |
| Review Cycle | Quarterly or upon significant capability changes |

## References

- [NIST OSCAL](https://pages.nist.gov/OSCAL/) — Official OSCAL documentation
- [OSCAL Component Definition Model](https://pages.nist.gov/OSCAL-Reference/models/latest/component-definition/json-outline/) — JSON model reference
- [NIST SP 800-53 Rev 5](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) — Security and Privacy Controls
- [NIST SP 800-53B](https://csrc.nist.gov/publications/detail/sp/800-53b/final) — Control Baselines
- [oscal-cli](https://github.com/usnistgov/oscal-cli) — NIST OSCAL validation tool
- [BASIS Specification](https://basis.vorion.org) — Behavioral Agent Standard for Intelligent Systems
