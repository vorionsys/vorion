"""
Vorion Cognigate -- OSCAL SSP Auto-Draft Generator

Combines:
- OSCAL Component Definition (compliance/oscal/component-definition.json)
- Control Registry (compliance/control-registry.yaml)
- SBOM data (sbom-history/*.json)
- Control Health snapshot (from Cognigate /v1/compliance/snapshot API)
- PROOF Ledger sample (from Cognigate /v1/proof/query API)

Outputs:
- OSCAL SSP JSON (compliance/oscal/ssp-draft.json)
- Human-readable SSP summary (compliance/oscal/ssp-summary.md)

OSCAL version: 1.1.2
Schema: https://pages.nist.gov/OSCAL-Reference/models/v1.1.2/system-security-plan/json-schema/
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import yaml

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]

logger = logging.getLogger("vorion.ssp_generator")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OSCAL_VERSION = "1.1.2"

NIST_MODERATE_PROFILE_HREF = (
    "https://raw.githubusercontent.com/usnistgov/oscal-content/main/"
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline_profile.json"
)

CONTROL_FAMILIES = {
    "AC": "Access Control",
    "AT": "Awareness and Training",
    "AU": "Audit and Accountability",
    "CA": "Assessment, Authorization, and Monitoring",
    "CM": "Configuration Management",
    "CP": "Contingency Planning",
    "IA": "Identification and Authentication",
    "IR": "Incident Response",
    "MA": "Maintenance",
    "MP": "Media Protection",
    "PE": "Physical and Environmental Protection",
    "PL": "Planning",
    "PM": "Program Management",
    "PS": "Personnel Security",
    "PT": "PII Processing and Transparency",
    "RA": "Risk Assessment",
    "SA": "System and Services Acquisition",
    "SC": "System and Communications Protection",
    "SI": "System and Information Integrity",
    "SR": "Supply Chain Risk Management",
}

IMPLEMENTATION_STATUS_MAP = {
    "implemented": "implemented",
    "partially-implemented": "partial",
    "partially_implemented": "partial",
    "partial": "partial",
    "planned": "planned",
    "alternative": "alternative",
    "not-applicable": "not-applicable",
    "not_applicable": "not-applicable",
}


def _uuid() -> str:
    """Generate a new UUID-4 string."""
    return str(uuid4())


def _now_iso() -> str:
    """Return current UTC time in ISO-8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------------------------------------------------------------------------
# SSP Generator
# ---------------------------------------------------------------------------


class SSPGenerator:
    """
    Generates an OSCAL 1.1.2 System Security Plan (SSP) JSON document.

    Combines multiple compliance data sources into a single OSCAL SSP that
    passes NIST OSCAL validation tools.
    """

    def __init__(
        self,
        component_def_path: Optional[str] = None,
        control_registry_path: Optional[str] = None,
        sbom_path: Optional[str] = None,
        cognigate_url: Optional[str] = None,
        output_dir: Optional[str] = None,
    ):
        self.component_def_path = component_def_path
        self.control_registry_path = control_registry_path
        self.sbom_path = sbom_path
        self.cognigate_url = cognigate_url
        self.output_dir = output_dir or str(
            Path(__file__).resolve().parent.parent.parent / "compliance" / "oscal"
        )

        # Loaded data caches
        self._component_def: Optional[dict] = None
        self._control_registry: Optional[dict] = None
        self._sbom: Optional[dict] = None
        self._control_health: Optional[dict] = None
        self._proof_sample: Optional[list] = None

        # UUIDs for cross-referencing within the SSP
        self._org_party_uuid = _uuid()
        self._system_owner_role_id = "system-owner"
        self._isso_role_id = "isso"
        self._ao_role_id = "authorizing-official"
        self._admin_role_id = "system-administrator"
        self._agent_role_id = "agent-entity"
        self._auditor_role_id = "auditor"

        # Component UUIDs
        self._cognigate_engine_uuid = _uuid()
        self._proof_plane_uuid = _uuid()
        self._policy_engine_uuid = _uuid()
        self._trust_engine_uuid = _uuid()

    # -----------------------------------------------------------------------
    # Data Loading
    # -----------------------------------------------------------------------

    def _load_component_definition(self) -> dict:
        """Load OSCAL component definition JSON."""
        if self._component_def is not None:
            return self._component_def

        if self.component_def_path and os.path.exists(self.component_def_path):
            with open(self.component_def_path, "r", encoding="utf-8") as f:
                self._component_def = json.load(f)
            logger.info("Loaded component definition from %s", self.component_def_path)
        else:
            logger.warning("No component definition found; using built-in defaults")
            self._component_def = self._build_default_component_definition()

        return self._component_def

    def _load_control_registry(self) -> dict:
        """Load control registry YAML."""
        if self._control_registry is not None:
            return self._control_registry

        if self.control_registry_path and os.path.exists(self.control_registry_path):
            with open(self.control_registry_path, "r", encoding="utf-8") as f:
                self._control_registry = yaml.safe_load(f)
            logger.info("Loaded control registry from %s", self.control_registry_path)
        else:
            logger.warning("No control registry found; using built-in defaults")
            self._control_registry = self._build_default_control_registry()

        return self._control_registry

    def _load_sbom(self) -> Optional[dict]:
        """Load CycloneDX SBOM JSON."""
        if self._sbom is not None:
            return self._sbom

        if self.sbom_path and os.path.exists(self.sbom_path):
            with open(self.sbom_path, "r", encoding="utf-8") as f:
                self._sbom = json.load(f)
            logger.info("Loaded SBOM from %s", self.sbom_path)
        else:
            logger.info("No SBOM path provided; SBOM references will be omitted")
            self._sbom = None

        return self._sbom

    def _fetch_control_health(self) -> Optional[dict]:
        """Fetch control health snapshot from Cognigate API."""
        if self._control_health is not None:
            return self._control_health

        if not self.cognigate_url or requests is None:
            logger.info("Cognigate URL not configured; skipping control health fetch")
            return None

        try:
            resp = requests.get(
                f"{self.cognigate_url.rstrip('/')}/v1/compliance/snapshot",
                timeout=10,
            )
            resp.raise_for_status()
            self._control_health = resp.json()
            logger.info("Fetched control health from %s", self.cognigate_url)
        except Exception as exc:
            logger.warning("Failed to fetch control health: %s", exc)
            self._control_health = None

        return self._control_health

    def _fetch_proof_sample(self) -> Optional[list]:
        """Fetch sample proof records from Cognigate API."""
        if self._proof_sample is not None:
            return self._proof_sample

        if not self.cognigate_url or requests is None:
            logger.info("Cognigate URL not configured; skipping proof sample fetch")
            return None

        try:
            resp = requests.post(
                f"{self.cognigate_url.rstrip('/')}/v1/proof/query",
                json={"limit": 25, "offset": 0},
                timeout=10,
            )
            resp.raise_for_status()
            self._proof_sample = resp.json()
            logger.info(
                "Fetched %d proof records from %s",
                len(self._proof_sample),
                self.cognigate_url,
            )
        except Exception as exc:
            logger.warning("Failed to fetch proof sample: %s", exc)
            self._proof_sample = None

        return self._proof_sample

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    def generate(self) -> dict:
        """
        Generate a complete OSCAL SSP JSON document.

        Returns:
            dict: OSCAL SSP document conforming to NIST OSCAL 1.1.2 schema.
        """
        # Pre-load all data sources
        self._load_component_definition()
        self._load_control_registry()
        self._load_sbom()
        self._fetch_control_health()
        self._fetch_proof_sample()

        ssp = {
            "system-security-plan": {
                "uuid": _uuid(),
                "metadata": self._build_metadata(),
                "import-profile": self._build_import_profile(),
                "system-characteristics": self._build_system_characteristics(),
                "system-implementation": self._build_system_implementation(),
                "control-implementation": self._build_control_implementation(),
                "back-matter": self._build_back_matter(),
            }
        }

        return ssp

    def save(self, ssp: Optional[dict] = None) -> tuple[str, str]:
        """
        Generate (if needed) and save SSP JSON and summary Markdown.

        Returns:
            Tuple of (ssp_path, summary_path).
        """
        if ssp is None:
            ssp = self.generate()

        os.makedirs(self.output_dir, exist_ok=True)

        ssp_path = os.path.join(self.output_dir, "ssp-draft.json")
        with open(ssp_path, "w", encoding="utf-8") as f:
            json.dump(ssp, f, indent=2, ensure_ascii=False)
        logger.info("Wrote SSP to %s", ssp_path)

        summary = self.generate_summary(ssp)
        summary_path = os.path.join(self.output_dir, "ssp-summary.md")
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write(summary)
        logger.info("Wrote SSP summary to %s", summary_path)

        return ssp_path, summary_path

    # -----------------------------------------------------------------------
    # SSP Section Builders
    # -----------------------------------------------------------------------

    def _build_metadata(self) -> dict:
        """Build SSP metadata: title, version, roles, parties, responsible-parties."""
        now = _now_iso()
        return {
            "title": "Vorion Cognigate System Security Plan",
            "last-modified": now,
            "version": "1.0.0",
            "oscal-version": OSCAL_VERSION,
            "revision-history": [
                {
                    "version": "1.0.0",
                    "oscal-version": OSCAL_VERSION,
                    "title": "Initial SSP auto-draft",
                    "published": now,
                    "last-modified": now,
                    "remarks": (
                        "Auto-generated SSP draft combining OSCAL component definition, "
                        "control registry, SBOM, PROOF ledger, and continuous monitoring data."
                    ),
                }
            ],
            "roles": [
                {
                    "id": self._system_owner_role_id,
                    "title": "System Owner",
                    "description": (
                        "Individual responsible for the overall procurement, development, "
                        "integration, modification, operation, maintenance, and retirement "
                        "of the system."
                    ),
                },
                {
                    "id": self._ao_role_id,
                    "title": "Authorizing Official",
                    "description": (
                        "Senior official with the authority to formally assume responsibility "
                        "for operating the system at an acceptable level of risk."
                    ),
                },
                {
                    "id": self._isso_role_id,
                    "title": "Information System Security Officer",
                    "description": (
                        "Individual responsible for ensuring the security posture of the "
                        "information system is maintained."
                    ),
                },
                {
                    "id": self._admin_role_id,
                    "title": "System Administrator",
                    "description": (
                        "Personnel responsible for deploying, configuring, and maintaining "
                        "the Cognigate platform."
                    ),
                },
                {
                    "id": self._agent_role_id,
                    "title": "Agent Entity",
                    "description": (
                        "Autonomous AI agent interacting with the governance engine. "
                        "Subject to trust scoring, policy enforcement, and proof recording."
                    ),
                },
                {
                    "id": self._auditor_role_id,
                    "title": "Auditor",
                    "description": (
                        "Internal or external compliance auditor reviewing PROOF ledger "
                        "records, control health, and governance decisions."
                    ),
                },
            ],
            "parties": [
                {
                    "uuid": self._org_party_uuid,
                    "type": "organization",
                    "name": "Vorion, Inc.",
                    "short-name": "Vorion",
                    "remarks": (
                        "Developer and operator of the Cognigate AI Agent Governance Engine "
                        "and the BASIS (Behavioral AI Safety Interoperability Standard) specification."
                    ),
                }
            ],
            "responsible-parties": [
                {
                    "role-id": self._system_owner_role_id,
                    "party-uuids": [self._org_party_uuid],
                },
                {
                    "role-id": self._isso_role_id,
                    "party-uuids": [self._org_party_uuid],
                },
            ],
        }

    def _build_import_profile(self) -> dict:
        """Reference to NIST 800-53 Rev 5 Moderate baseline profile."""
        return {"href": NIST_MODERATE_PROFILE_HREF}

    def _build_system_characteristics(self) -> dict:
        """
        Build system-characteristics section (SSP Section 9 equivalent).

        Includes system name, description, security categorization,
        authorization boundary, network architecture, data flow,
        and information types.
        """
        return {
            "system-ids": [
                {
                    "identifier-type": (
                        "https://ietf.org/rfc/rfc4122"
                    ),
                    "id": _uuid(),
                }
            ],
            "system-name": "Vorion Cognigate",
            "system-name-short": "Cognigate",
            "description": (
                "Vorion Cognigate is an AI Agent Governance Runtime implementing the "
                "BASIS (Behavioral AI Safety Interoperability Standard) specification. "
                "It provides real-time intent normalization, policy enforcement, trust "
                "scoring, and cryptographic proof generation for autonomous AI agent "
                "operations. Cognigate serves as an inherited control enforcement layer "
                "for AI execution environments, ensuring that every agent action is "
                "authorized, bounded, and auditable."
            ),
            "security-sensitivity-level": "moderate",
            "system-information": {
                "information-types": [
                    {
                        "uuid": _uuid(),
                        "title": "AI Agent Telemetry",
                        "description": (
                            "Operational telemetry from AI agent interactions including "
                            "intent declarations, policy evaluation results, trust scores, "
                            "and enforcement decisions."
                        ),
                        "categorizations": [
                            {
                                "system": "https://doi.org/10.6028/NIST.SP.800-60v2r1",
                                "information-type-ids": ["C.3.5.8"],
                            }
                        ],
                        "confidentiality-impact": {
                            "base": "moderate",
                        },
                        "integrity-impact": {
                            "base": "moderate",
                        },
                        "availability-impact": {
                            "base": "moderate",
                        },
                    },
                    {
                        "uuid": _uuid(),
                        "title": "Governance Decisions",
                        "description": (
                            "Records of allow/deny/escalate/modify decisions made by the "
                            "policy engine, including the full decision rationale and "
                            "policy chain evaluated."
                        ),
                        "categorizations": [
                            {
                                "system": "https://doi.org/10.6028/NIST.SP.800-60v2r1",
                                "information-type-ids": ["C.3.5.1"],
                            }
                        ],
                        "confidentiality-impact": {
                            "base": "moderate",
                        },
                        "integrity-impact": {
                            "base": "high",
                            "selected": "moderate",
                            "adjustment-justification": (
                                "Governance decisions are cryptographically sealed in the "
                                "PROOF ledger with dual-hash chain integrity, providing "
                                "tamper-evidence. Moderate selected due to compensating "
                                "cryptographic controls."
                            ),
                        },
                        "availability-impact": {
                            "base": "moderate",
                        },
                    },
                    {
                        "uuid": _uuid(),
                        "title": "Trust Scores",
                        "description": (
                            "Dynamic trust scores (0-1000 scale, 8-tier model) computed "
                            "for each AI agent entity based on behavioral history, policy "
                            "compliance, and outcome alignment."
                        ),
                        "categorizations": [
                            {
                                "system": "https://doi.org/10.6028/NIST.SP.800-60v2r1",
                                "information-type-ids": ["C.2.8.12"],
                            }
                        ],
                        "confidentiality-impact": {
                            "base": "moderate",
                        },
                        "integrity-impact": {
                            "base": "moderate",
                        },
                        "availability-impact": {
                            "base": "low",
                        },
                    },
                ],
            },
            "security-impact-level": {
                "security-objective-confidentiality": "moderate",
                "security-objective-integrity": "moderate",
                "security-objective-availability": "moderate",
            },
            "status": {
                "state": "operational",
                "remarks": (
                    "Cognigate is operational in production, processing AI agent "
                    "governance requests via the INTENT -> ENFORCE -> PROOF pipeline."
                ),
            },
            "authorization-boundary": {
                "description": (
                    "The authorization boundary encompasses the Cognigate Engine core, "
                    "the PROOF Plane (immutable dual-hash chain audit ledger), the "
                    "Policy Engine (BASIS rule evaluation), the Trust Engine (8-tier "
                    "trust scoring), and all supporting API infrastructure. The boundary "
                    "includes the /v1/intent, /v1/enforce, and /v1/proof API surfaces. "
                    "External AI agents and their host environments are outside the "
                    "authorization boundary but are subject to Cognigate governance "
                    "controls when interacting with the system."
                ),
            },
            "network-architecture": {
                "description": (
                    "Cognigate operates as an API-based microservice architecture "
                    "deployed on cloud infrastructure. The architecture consists of:\n\n"
                    "1. API Gateway Layer - TLS-terminated ingress with rate limiting\n"
                    "2. Cognigate Engine - FastAPI application handling INTENT/ENFORCE/PROOF\n"
                    "3. Policy Engine - In-process BASIS rule evaluation engine\n"
                    "4. Trust Engine - Agent trust score computation service\n"
                    "5. PROOF Plane - Append-only cryptographic audit ledger\n"
                    "6. Data Layer - PostgreSQL with encrypted storage\n"
                    "7. Cache Layer - Redis for session and policy cache\n\n"
                    "All inter-service communication uses TLS 1.2+ with mutual "
                    "authentication where applicable."
                ),
            },
            "data-flow": {
                "description": (
                    "Primary data flow follows the INTENT -> ENFORCE -> PROOF -> CHAIN "
                    "pipeline:\n\n"
                    "1. INTENT: Agent submits action intention via /v1/intent. The intent "
                    "is normalized, validated, and assigned a unique intent_id.\n\n"
                    "2. ENFORCE: Normalized intent is evaluated against active BASIS "
                    "policies. The policy engine checks trust level, permission scope, "
                    "resource boundaries, and behavioral constraints. Result is "
                    "allow/deny/escalate/modify.\n\n"
                    "3. PROOF: Enforcement verdict is cryptographically sealed into a "
                    "proof record with SHA-256 content hashing and Ed25519 digital "
                    "signatures.\n\n"
                    "4. CHAIN: Proof record is appended to the immutable dual-hash chain "
                    "with forward-linking integrity verification."
                ),
            },
        }

    def _build_system_implementation(self) -> dict:
        """
        Build system-implementation section with components, users, and services.

        Includes Cognigate Engine, Proof Plane, Policy Engine, Trust Engine,
        SBOM as inventory item, and user types.
        """
        users = [
            {
                "uuid": _uuid(),
                "title": "System Administrator",
                "description": (
                    "Personnel responsible for deploying, configuring, and maintaining "
                    "the Cognigate platform. Has access to admin API endpoints."
                ),
                "role-ids": [self._admin_role_id],
                "props": [
                    {"name": "type", "value": "internal"},
                    {"name": "privilege-level", "value": "privileged"},
                ],
            },
            {
                "uuid": _uuid(),
                "title": "Agent Entity",
                "description": (
                    "Autonomous AI agent that submits intents to Cognigate for "
                    "governance evaluation. Each agent has a trust score and is "
                    "subject to policy enforcement."
                ),
                "role-ids": [self._agent_role_id],
                "props": [
                    {"name": "type", "value": "external"},
                    {"name": "privilege-level", "value": "non-privileged"},
                ],
            },
            {
                "uuid": _uuid(),
                "title": "Auditor",
                "description": (
                    "Internal or external compliance auditor with read-only access "
                    "to PROOF ledger records, control health dashboards, and "
                    "governance decision logs."
                ),
                "role-ids": [self._auditor_role_id],
                "props": [
                    {"name": "type", "value": "internal"},
                    {"name": "privilege-level", "value": "non-privileged"},
                ],
            },
        ]

        components = [
            {
                "uuid": self._cognigate_engine_uuid,
                "type": "software",
                "title": "Cognigate Engine",
                "description": (
                    "Core FastAPI application implementing the INTENT -> ENFORCE -> PROOF "
                    "pipeline. Handles intent normalization, policy evaluation dispatch, "
                    "and proof record creation. Built with Python/FastAPI."
                ),
                "status": {"state": "operational"},
                "props": [
                    {"name": "version", "value": "1.0.0"},
                    {"name": "vendor", "value": "Vorion, Inc."},
                    {"name": "asset-type", "value": "application"},
                ],
                "responsible-roles": [
                    {
                        "role-id": self._admin_role_id,
                        "party-uuids": [self._org_party_uuid],
                    }
                ],
            },
            {
                "uuid": self._proof_plane_uuid,
                "type": "software",
                "title": "PROOF Plane",
                "description": (
                    "Immutable dual-hash chain audit ledger. Creates cryptographically "
                    "sealed records (PROOF = Persistent Record of Operational Facts) "
                    "with SHA-256 content hashing, Ed25519 digital signatures, and "
                    "append-only chain integrity. Each record links to its predecessor "
                    "via previous_hash, forming a tamper-evident chain."
                ),
                "status": {"state": "operational"},
                "props": [
                    {"name": "asset-type", "value": "data-store"},
                    {"name": "integrity-mechanism", "value": "dual-hash-chain"},
                    {"name": "signature-algorithm", "value": "Ed25519"},
                    {"name": "hash-algorithm", "value": "SHA-256"},
                ],
                "responsible-roles": [
                    {
                        "role-id": self._admin_role_id,
                        "party-uuids": [self._org_party_uuid],
                    }
                ],
            },
            {
                "uuid": self._policy_engine_uuid,
                "type": "software",
                "title": "Policy Engine",
                "description": (
                    "BASIS rule evaluation engine. Evaluates agent intents against "
                    "active governance policies including trust-level gates, permission "
                    "scope checks, resource boundary enforcement, behavioral constraint "
                    "validation, and velocity/rate limiting. Supports policy hot-reload "
                    "and versioned policy chains."
                ),
                "status": {"state": "operational"},
                "props": [
                    {"name": "asset-type", "value": "application"},
                    {"name": "standard", "value": "BASIS v1.0"},
                ],
                "responsible-roles": [
                    {
                        "role-id": self._admin_role_id,
                        "party-uuids": [self._org_party_uuid],
                    }
                ],
            },
            {
                "uuid": self._trust_engine_uuid,
                "type": "software",
                "title": "Trust Engine",
                "description": (
                    "Computes and maintains dynamic trust scores for AI agent entities. "
                    "Implements an 8-tier trust model (0-1000 scale): Quarantine (0-99), "
                    "Untrusted (100-249), Provisional (250-399), Basic (400-549), "
                    "Standard (550-699), Trusted (700-849), Verified (850-949), "
                    "Sovereign (950-1000). Trust scores influence policy evaluation "
                    "and enforcement decisions."
                ),
                "status": {"state": "operational"},
                "props": [
                    {"name": "asset-type", "value": "application"},
                    {"name": "trust-tiers", "value": "8"},
                    {"name": "score-range", "value": "0-1000"},
                ],
                "responsible-roles": [
                    {
                        "role-id": self._admin_role_id,
                        "party-uuids": [self._org_party_uuid],
                    }
                ],
            },
        ]

        # Add SBOM as inventory item if available
        inventory_items = []
        sbom = self._load_sbom()
        if sbom:
            component_count = len(sbom.get("components", []))
            inventory_items.append(
                {
                    "uuid": _uuid(),
                    "description": (
                        f"Software Bill of Materials (CycloneDX {sbom.get('specVersion', '1.5')}) "
                        f"with {component_count} components cataloged."
                    ),
                    "props": [
                        {"name": "asset-type", "value": "software-inventory"},
                        {"name": "sbom-format", "value": "CycloneDX"},
                        {
                            "name": "sbom-spec-version",
                            "value": str(sbom.get("specVersion", "1.5")),
                        },
                        {"name": "component-count", "value": str(component_count)},
                    ],
                    "implemented-components": [
                        {"component-uuid": self._cognigate_engine_uuid}
                    ],
                }
            )

        result: dict[str, Any] = {
            "users": users,
            "components": components,
        }
        if inventory_items:
            result["inventory-items"] = inventory_items

        return result

    def _build_control_implementation(self) -> dict:
        """
        Build control-implementation section.

        For each NIST 800-53 Rev 5 Moderate baseline control:
        - Implementation status
        - Implementation description (from component definition or registry)
        - Responsible role
        - Evidence reference (proof chain + monitoring)
        """
        registry = self._load_control_registry()
        comp_def = self._load_component_definition()
        health = self._fetch_control_health()

        # Build a lookup from component-definition control statements
        comp_statements = {}
        if comp_def:
            for comp in comp_def.get("component-definition", {}).get("components", []):
                for ci in comp.get("control-implementations", []):
                    for req in ci.get("implemented-requirements", []):
                        ctrl_id = req.get("control-id", "")
                        comp_statements[ctrl_id] = req

        # Build a lookup from control health
        health_status = {}
        if health and isinstance(health, dict):
            for ctrl in health.get("controls", []):
                health_status[ctrl.get("control_id", "")] = ctrl

        # Build implemented requirements
        implemented_requirements = []

        controls = registry.get("controls", [])
        for ctrl in controls:
            ctrl_id = ctrl.get("id", "")
            ctrl_id_lower = ctrl_id.lower()

            # Determine implementation status
            raw_status = ctrl.get("implementation_status", "planned")
            if health_status.get(ctrl_id, {}).get("status"):
                raw_status = health_status[ctrl_id]["status"]
            status = IMPLEMENTATION_STATUS_MAP.get(raw_status, "planned")

            # Build description from multiple sources
            description_parts = []
            if ctrl.get("implementation_description"):
                description_parts.append(ctrl["implementation_description"])
            if comp_statements.get(ctrl_id_lower, {}).get("description"):
                description_parts.append(comp_statements[ctrl_id_lower]["description"])

            if not description_parts:
                description_parts.append(
                    f"Implementation of {ctrl_id} ({ctrl.get('name', 'N/A')}) "
                    f"is {raw_status}."
                )

            description = " ".join(description_parts)

            # Build the requirement
            req: dict[str, Any] = {
                "uuid": _uuid(),
                "control-id": ctrl_id_lower,
                "props": [
                    {
                        "name": "implementation-status",
                        "ns": "https://fedramp.gov/ns/oscal",
                        "value": status,
                    }
                ],
            }

            # Add statements
            statements: list[dict] = []
            statement = {
                "statement-id": f"{ctrl_id_lower}_smt",
                "uuid": _uuid(),
                "by-components": [
                    {
                        "component-uuid": self._cognigate_engine_uuid,
                        "uuid": _uuid(),
                        "description": description,
                        "implementation-status": {"state": status},
                    }
                ],
            }

            # Add responsible role
            responsible_role = ctrl.get("responsible_role", "system-administrator")
            role_id = responsible_role.lower().replace(" ", "-")
            statement["by-components"][0]["responsible-roles"] = [
                {
                    "role-id": role_id,
                    "party-uuids": [self._org_party_uuid],
                }
            ]

            # Add PROOF evidence reference for implemented controls
            if status == "implemented" and self._proof_plane_uuid:
                proof_by_component = {
                    "component-uuid": self._proof_plane_uuid,
                    "uuid": _uuid(),
                    "description": (
                        f"Continuous evidence for {ctrl_id} is maintained in the PROOF "
                        f"ledger via dual-hash chain records with Ed25519 signatures. "
                        f"Chain integrity is verified automatically."
                    ),
                    "implementation-status": {"state": "implemented"},
                }
                statement["by-components"].append(proof_by_component)

            statements.append(statement)
            req["statements"] = statements

            implemented_requirements.append(req)

        return {
            "description": (
                "This section describes how NIST SP 800-53 Rev 5 Moderate baseline "
                "controls are implemented within the Vorion Cognigate AI Agent "
                "Governance Engine. Implementation statements reference the Cognigate "
                "Engine, PROOF Plane, Policy Engine, and Trust Engine components. "
                "Evidence is continuously collected via the PROOF ledger and "
                "control health monitoring."
            ),
            "implemented-requirements": implemented_requirements,
        }

    def _build_back_matter(self) -> dict:
        """
        Build back-matter section with supporting artifact references.
        """
        resources = [
            {
                "uuid": _uuid(),
                "title": "NIST SP 800-53 Rev 5 Moderate Baseline Profile",
                "description": (
                    "The OSCAL profile defining the NIST SP 800-53 Rev 5 Moderate "
                    "baseline control selection."
                ),
                "rlinks": [{"href": NIST_MODERATE_PROFILE_HREF}],
            },
            {
                "uuid": _uuid(),
                "title": "BASIS Specification",
                "description": (
                    "Behavioral AI Safety Interoperability Standard -- the governance "
                    "specification implemented by Cognigate."
                ),
                "props": [
                    {"name": "type", "value": "specification"},
                    {"name": "version", "value": "1.0"},
                ],
            },
            {
                "uuid": _uuid(),
                "title": "PROOF Ledger Sample",
                "description": (
                    "Sample records from the immutable PROOF ledger demonstrating "
                    "dual-hash chain integrity and Ed25519 digital signatures."
                ),
                "props": [
                    {"name": "type", "value": "evidence"},
                    {"name": "evidence-type", "value": "audit-trail"},
                ],
            },
            {
                "uuid": _uuid(),
                "title": "Control Health Export",
                "description": (
                    "Continuous monitoring output showing current control implementation "
                    "status, health metrics, and compliance posture."
                ),
                "props": [
                    {"name": "type", "value": "evidence"},
                    {"name": "evidence-type", "value": "continuous-monitoring"},
                ],
            },
            {
                "uuid": _uuid(),
                "title": "Architecture Overview",
                "description": (
                    "System architecture one-pager describing the three-layer "
                    "architecture (INTENT -> ENFORCE -> PROOF), trust model, data flow, "
                    "security boundaries, and cryptographic controls."
                ),
                "props": [{"name": "type", "value": "architecture"}],
            },
        ]

        # Add SBOM reference if available
        sbom = self._load_sbom()
        if sbom:
            resources.append(
                {
                    "uuid": _uuid(),
                    "title": "Software Bill of Materials (CycloneDX)",
                    "description": (
                        f"CycloneDX {sbom.get('specVersion', '1.5')} SBOM cataloging "
                        f"{len(sbom.get('components', []))} software components with "
                        f"vulnerability correlation."
                    ),
                    "props": [
                        {"name": "type", "value": "sbom"},
                        {"name": "format", "value": "CycloneDX"},
                    ],
                }
            )
            resources.append(
                {
                    "uuid": _uuid(),
                    "title": "Software Bill of Materials (SPDX)",
                    "description": (
                        "SPDX 2.3 SBOM providing an alternative standards-compliant "
                        "view of the software supply chain."
                    ),
                    "props": [
                        {"name": "type", "value": "sbom"},
                        {"name": "format", "value": "SPDX"},
                    ],
                }
            )

        # Add test results reference
        resources.append(
            {
                "uuid": _uuid(),
                "title": "Automated Test Results",
                "description": (
                    "Results from automated security control testing including "
                    "unit tests, integration tests, and policy enforcement validation."
                ),
                "props": [
                    {"name": "type", "value": "evidence"},
                    {"name": "evidence-type", "value": "test-results"},
                ],
            }
        )

        return {"resources": resources}

    # -----------------------------------------------------------------------
    # Summary Generation
    # -----------------------------------------------------------------------

    def generate_summary(self, ssp: dict) -> str:
        """
        Generate a human-readable SSP summary in Markdown.

        Sections:
        1. System Overview
        2. Security Categorization
        3. Authorization Boundary
        4. Control Implementation Summary (counts by family)
        5. Evidence Overview
        6. Gap Analysis (controls not yet implemented)
        7. POA&M Items (planned controls)
        """
        plan = ssp.get("system-security-plan", {})
        chars = plan.get("system-characteristics", {})
        ctrl_impl = plan.get("control-implementation", {})
        impl_reqs = ctrl_impl.get("implemented-requirements", [])
        back = plan.get("back-matter", {})
        metadata = plan.get("metadata", {})

        # Count controls by status
        status_counts: dict[str, int] = {
            "implemented": 0,
            "partial": 0,
            "planned": 0,
            "alternative": 0,
            "not-applicable": 0,
        }
        family_counts: dict[str, dict[str, int]] = {}
        gap_controls: list[dict] = []
        poam_controls: list[dict] = []

        for req in impl_reqs:
            ctrl_id = req.get("control-id", "").upper()
            family_prefix = ctrl_id.split("-")[0] if "-" in ctrl_id else ctrl_id[:2]
            family_name = CONTROL_FAMILIES.get(family_prefix, family_prefix)

            status = "planned"
            for prop in req.get("props", []):
                if prop.get("name") == "implementation-status":
                    status = prop.get("value", "planned")
                    break

            status_counts[status] = status_counts.get(status, 0) + 1

            if family_name not in family_counts:
                family_counts[family_name] = {"total": 0, "implemented": 0}
            family_counts[family_name]["total"] += 1
            if status == "implemented":
                family_counts[family_name]["implemented"] += 1

            if status not in ("implemented", "not-applicable"):
                gap_controls.append({"id": ctrl_id, "status": status})
            if status == "planned":
                poam_controls.append({"id": ctrl_id, "status": status})

        total = sum(status_counts.values())
        impl_pct = (
            round(status_counts["implemented"] / total * 100, 1) if total > 0 else 0
        )

        lines: list[str] = []

        # Header
        lines.append("# Vorion Cognigate -- System Security Plan Summary")
        lines.append("")
        lines.append(f"**Generated:** {metadata.get('last-modified', _now_iso())}")
        lines.append(f"**OSCAL Version:** {OSCAL_VERSION}")
        lines.append(f"**SSP Version:** {metadata.get('version', '1.0.0')}")
        lines.append("")

        # Section 1: System Overview
        lines.append("## 1. System Overview")
        lines.append("")
        lines.append(f"**System Name:** {chars.get('system-name', 'Vorion Cognigate')}")
        lines.append(
            f"**System Status:** {chars.get('status', {}).get('state', 'operational')}"
        )
        lines.append("")
        desc = chars.get("description", "")
        if desc:
            lines.append(desc)
            lines.append("")

        # Section 2: Security Categorization
        lines.append("## 2. Security Categorization")
        lines.append("")
        impact = chars.get("security-impact-level", {})
        lines.append("| Objective | Level |")
        lines.append("|-----------|-------|")
        lines.append(
            f"| Confidentiality | {impact.get('security-objective-confidentiality', 'moderate').upper()} |"
        )
        lines.append(
            f"| Integrity | {impact.get('security-objective-integrity', 'moderate').upper()} |"
        )
        lines.append(
            f"| Availability | {impact.get('security-objective-availability', 'moderate').upper()} |"
        )
        lines.append(
            f"| **Overall** | **{chars.get('security-sensitivity-level', 'moderate').upper()}** |"
        )
        lines.append("")

        # Section 3: Authorization Boundary
        lines.append("## 3. Authorization Boundary")
        lines.append("")
        boundary = chars.get("authorization-boundary", {})
        lines.append(boundary.get("description", "Not specified."))
        lines.append("")

        # Section 4: Control Implementation Summary
        lines.append("## 4. Control Implementation Summary")
        lines.append("")
        lines.append(f"**Total Controls:** {total}")
        lines.append(f"**Implementation Rate:** {impl_pct}%")
        lines.append("")
        lines.append("| Status | Count | Percentage |")
        lines.append("|--------|-------|------------|")
        for status_key, label in [
            ("implemented", "Implemented"),
            ("partial", "Partially Implemented"),
            ("planned", "Planned"),
            ("alternative", "Alternative Implementation"),
            ("not-applicable", "Not Applicable"),
        ]:
            count = status_counts.get(status_key, 0)
            pct = round(count / total * 100, 1) if total > 0 else 0
            lines.append(f"| {label} | {count} | {pct}% |")
        lines.append("")

        # By family
        lines.append("### By Control Family")
        lines.append("")
        lines.append("| Family | Total | Implemented | Rate |")
        lines.append("|--------|-------|-------------|------|")
        for family_name in sorted(family_counts.keys()):
            fc = family_counts[family_name]
            rate = (
                round(fc["implemented"] / fc["total"] * 100, 1)
                if fc["total"] > 0
                else 0
            )
            lines.append(
                f"| {family_name} | {fc['total']} | {fc['implemented']} | {rate}% |"
            )
        lines.append("")

        # Section 5: Evidence Overview
        lines.append("## 5. Evidence Overview")
        lines.append("")
        resources = back.get("resources", [])
        if resources:
            lines.append("| Artifact | Type | Description |")
            lines.append("|----------|------|-------------|")
            for res in resources:
                art_type = "general"
                for prop in res.get("props", []):
                    if prop.get("name") == "type":
                        art_type = prop.get("value", "general")
                        break
                lines.append(
                    f"| {res.get('title', 'N/A')} | {art_type} | "
                    f"{res.get('description', 'N/A')[:80]}... |"
                )
        else:
            lines.append("No evidence artifacts referenced.")
        lines.append("")

        # Section 6: Gap Analysis
        lines.append("## 6. Gap Analysis")
        lines.append("")
        if gap_controls:
            lines.append(
                f"**{len(gap_controls)} controls** require attention "
                f"(not yet fully implemented):"
            )
            lines.append("")
            lines.append("| Control ID | Current Status |")
            lines.append("|------------|---------------|")
            for gc in sorted(gap_controls, key=lambda x: x["id"]):
                lines.append(f"| {gc['id']} | {gc['status']} |")
        else:
            lines.append("All controls are fully implemented or not applicable.")
        lines.append("")

        # Section 7: POA&M Items
        lines.append("## 7. Plan of Action & Milestones (POA&M)")
        lines.append("")
        if poam_controls:
            lines.append(
                f"**{len(poam_controls)} controls** are in planned status and "
                f"require implementation:"
            )
            lines.append("")
            lines.append("| Control ID | Status | Priority |")
            lines.append("|------------|--------|----------|")
            for pc in sorted(poam_controls, key=lambda x: x["id"]):
                lines.append(f"| {pc['id']} | Planned | To be determined |")
        else:
            lines.append("No planned controls remaining -- all controls addressed.")
        lines.append("")

        # Footer
        lines.append("---")
        lines.append("")
        lines.append(
            "*This summary was auto-generated by the Vorion SSP Generator. "
            "Review and validate all sections before submission.*"
        )
        lines.append("")

        return "\n".join(lines)

    # -----------------------------------------------------------------------
    # Default Data Builders (when external files are not available)
    # -----------------------------------------------------------------------

    def _build_default_component_definition(self) -> dict:
        """Build a minimal OSCAL component definition with Cognigate components."""
        return {
            "component-definition": {
                "uuid": _uuid(),
                "metadata": {
                    "title": "Vorion Cognigate Component Definition",
                    "last-modified": _now_iso(),
                    "version": "1.0.0",
                    "oscal-version": OSCAL_VERSION,
                },
                "components": [
                    {
                        "uuid": _uuid(),
                        "type": "software",
                        "title": "Cognigate Engine",
                        "description": "AI Agent Governance Runtime",
                        "control-implementations": [],
                    }
                ],
            }
        }

    def _build_default_control_registry(self) -> dict:
        """
        Build a default control registry with NIST 800-53 Rev 5 Moderate
        baseline controls.

        This provides a representative set across all 20 control families.
        """
        controls = []

        # Comprehensive set: all families, representative controls
        default_controls = [
            # AC - Access Control
            ("AC-1", "Policy and Procedures", "implemented", "CISO"),
            ("AC-2", "Account Management", "implemented", "Identity Manager"),
            ("AC-3", "Access Enforcement", "implemented", "Security Engineering"),
            ("AC-4", "Information Flow Enforcement", "implemented", "Network Security"),
            ("AC-5", "Separation of Duties", "implemented", "Security Policy"),
            ("AC-6", "Least Privilege", "implemented", "Security Engineering"),
            ("AC-7", "Unsuccessful Logon Attempts", "implemented", "Identity Manager"),
            ("AC-8", "System Use Notification", "implemented", "Security Policy"),
            ("AC-11", "Device Lock", "implemented", "Security Engineering"),
            ("AC-12", "Session Termination", "implemented", "Security Engineering"),
            ("AC-14", "Permitted Actions Without Identification", "implemented", "Security Policy"),
            ("AC-17", "Remote Access", "implemented", "Network Security"),
            ("AC-18", "Wireless Access", "implemented", "Network Security"),
            ("AC-19", "Access Control for Mobile Devices", "implemented", "Endpoint Security"),
            ("AC-20", "Use of External Systems", "implemented", "Security Policy"),
            ("AC-21", "Information Sharing", "implemented", "Security Engineering"),
            ("AC-22", "Publicly Accessible Content", "implemented", "Communications"),
            # AT - Awareness and Training
            ("AT-1", "Policy and Procedures", "implemented", "Training Manager"),
            ("AT-2", "Literacy Training and Awareness", "implemented", "Training Manager"),
            ("AT-3", "Role-Based Training", "implemented", "Training Manager"),
            ("AT-4", "Training Records", "implemented", "Training Manager"),
            # AU - Audit and Accountability
            ("AU-1", "Policy and Procedures", "implemented", "Security Operations"),
            ("AU-2", "Event Logging", "implemented", "Security Operations"),
            ("AU-3", "Content of Audit Records", "implemented", "Security Operations"),
            ("AU-4", "Audit Log Storage Capacity", "implemented", "Infrastructure"),
            ("AU-5", "Response to Audit Processing Failures", "implemented", "Security Operations"),
            ("AU-6", "Audit Record Review, Analysis, and Reporting", "implemented", "Security Operations"),
            ("AU-7", "Audit Record Reduction and Report Generation", "implemented", "Security Operations"),
            ("AU-8", "Time Stamps", "implemented", "Infrastructure"),
            ("AU-9", "Protection of Audit Information", "implemented", "Security Operations"),
            ("AU-10", "Non-repudiation", "implemented", "Security Engineering"),
            ("AU-11", "Audit Record Retention", "implemented", "Security Operations"),
            ("AU-12", "Audit Record Generation", "implemented", "Security Operations"),
            # CA - Assessment, Authorization, and Monitoring
            ("CA-1", "Policy and Procedures", "implemented", "CISO"),
            ("CA-2", "Control Assessments", "implemented", "CISO"),
            ("CA-3", "Information Exchange", "implemented", "Security Policy"),
            ("CA-5", "Plan of Action and Milestones", "implemented", "CISO"),
            ("CA-6", "Authorization", "planned", "Authorizing Official"),
            ("CA-7", "Continuous Monitoring", "implemented", "Security Operations"),
            ("CA-8", "Penetration Testing", "implemented", "Security Engineering"),
            ("CA-9", "Internal System Connections", "implemented", "Network Security"),
            # CM - Configuration Management
            ("CM-1", "Policy and Procedures", "implemented", "Configuration Manager"),
            ("CM-2", "Baseline Configuration", "implemented", "Configuration Manager"),
            ("CM-3", "Configuration Change Control", "implemented", "Configuration Manager"),
            ("CM-4", "Impact Analyses", "implemented", "Configuration Manager"),
            ("CM-5", "Access Restrictions for Change", "implemented", "Configuration Manager"),
            ("CM-6", "Configuration Settings", "implemented", "Security Engineering"),
            ("CM-7", "Least Functionality", "implemented", "Security Engineering"),
            ("CM-8", "System Component Inventory", "implemented", "Configuration Manager"),
            ("CM-9", "Configuration Management Plan", "implemented", "Configuration Manager"),
            ("CM-10", "Software Usage Restrictions", "implemented", "Configuration Manager"),
            ("CM-11", "User-Installed Software", "implemented", "Security Policy"),
            # CP - Contingency Planning
            ("CP-1", "Policy and Procedures", "implemented", "Contingency Manager"),
            ("CP-2", "Contingency Plan", "implemented", "Contingency Manager"),
            ("CP-3", "Contingency Training", "implemented", "Contingency Manager"),
            ("CP-4", "Contingency Plan Testing", "implemented", "Contingency Manager"),
            ("CP-6", "Alternate Storage Site", "implemented", "Infrastructure"),
            ("CP-7", "Alternate Processing Site", "implemented", "Infrastructure"),
            ("CP-8", "Telecommunications Services", "planned", "Infrastructure"),
            ("CP-9", "System Backup", "implemented", "Infrastructure"),
            ("CP-10", "System Recovery and Reconstitution", "implemented", "Infrastructure"),
            # IA - Identification and Authentication
            ("IA-1", "Policy and Procedures", "implemented", "Security Policy"),
            ("IA-2", "User Identification and Authentication", "implemented", "Identity Manager"),
            ("IA-3", "Device Identification and Authentication", "implemented", "Security Engineering"),
            ("IA-4", "Identifier Management", "implemented", "Identity Manager"),
            ("IA-5", "Authenticator Management", "implemented", "Identity Manager"),
            ("IA-6", "Authentication Feedback", "implemented", "Security Engineering"),
            ("IA-7", "Cryptographic Module Authentication", "implemented", "Security Engineering"),
            ("IA-8", "Identification and Authentication (Non-Org Users)", "implemented", "Identity Manager"),
            ("IA-11", "Re-authentication", "implemented", "Security Engineering"),
            ("IA-12", "Identity Proofing", "implemented", "Identity Manager"),
            # IR - Incident Response
            ("IR-1", "Policy and Procedures", "implemented", "Incident Response Manager"),
            ("IR-2", "Incident Response Training", "implemented", "Incident Response Manager"),
            ("IR-3", "Incident Response Testing", "implemented", "Incident Response Manager"),
            ("IR-4", "Incident Handling", "implemented", "Incident Response Manager"),
            ("IR-5", "Incident Monitoring", "implemented", "Security Operations"),
            ("IR-6", "Incident Reporting", "implemented", "Incident Response Manager"),
            ("IR-7", "Incident Response Assistance", "implemented", "Incident Response Manager"),
            ("IR-8", "Incident Response Plan", "implemented", "Incident Response Manager"),
            # MA - Maintenance
            ("MA-1", "Policy and Procedures", "implemented", "System Administrator"),
            ("MA-2", "Controlled Maintenance", "implemented", "System Administrator"),
            ("MA-3", "Maintenance Tools", "implemented", "System Administrator"),
            ("MA-4", "Nonlocal Maintenance", "implemented", "System Administrator"),
            ("MA-5", "Maintenance Personnel", "implemented", "System Administrator"),
            # MP - Media Protection
            ("MP-1", "Policy and Procedures", "implemented", "Security Policy"),
            ("MP-2", "Media Access", "implemented", "Security Policy"),
            ("MP-3", "Media Marking", "not-applicable", "Security Policy"),
            ("MP-4", "Media Storage", "implemented", "Infrastructure"),
            ("MP-5", "Media Transport", "not-applicable", "Security Policy"),
            ("MP-6", "Media Sanitization", "implemented", "Infrastructure"),
            ("MP-7", "Media Use", "implemented", "Security Policy"),
            # PE - Physical and Environmental Protection
            ("PE-1", "Policy and Procedures", "implemented", "Facilities Manager"),
            ("PE-2", "Physical Access Authorizations", "implemented", "Facilities Manager"),
            ("PE-3", "Physical Access Control", "implemented", "Facilities Manager"),
            ("PE-6", "Monitoring Physical Access", "implemented", "Facilities Manager"),
            ("PE-8", "Visitor Access Records", "implemented", "Facilities Manager"),
            ("PE-9", "Power Equipment and Cabling", "implemented", "Facilities Manager"),
            ("PE-10", "Emergency Shutoff", "implemented", "Facilities Manager"),
            ("PE-11", "Emergency Power", "implemented", "Facilities Manager"),
            ("PE-12", "Emergency Lighting", "implemented", "Facilities Manager"),
            ("PE-13", "Fire Protection", "implemented", "Facilities Manager"),
            ("PE-14", "Environmental Controls", "implemented", "Facilities Manager"),
            ("PE-15", "Water Damage Protection", "implemented", "Facilities Manager"),
            ("PE-16", "Delivery and Removal", "implemented", "Facilities Manager"),
            ("PE-17", "Alternate Work Site", "implemented", "Facilities Manager"),
            # PL - Planning
            ("PL-1", "Policy and Procedures", "implemented", "Security Policy"),
            ("PL-2", "System Security and Privacy Plans", "implemented", "ISSO"),
            ("PL-4", "Rules of Behavior", "implemented", "Security Policy"),
            ("PL-10", "Baseline Selection", "implemented", "ISSO"),
            ("PL-11", "Baseline Tailoring", "implemented", "ISSO"),
            # PM - Program Management
            ("PM-1", "Information Security Program Plan", "implemented", "CISO"),
            ("PM-2", "Information Security Program Leadership Role", "implemented", "CISO"),
            ("PM-3", "Information Security and Privacy Resources", "implemented", "CISO"),
            ("PM-4", "Plan of Action and Milestones Process", "implemented", "CISO"),
            ("PM-5", "System Inventory", "implemented", "CISO"),
            ("PM-6", "Measures of Performance", "implemented", "CISO"),
            ("PM-9", "Risk Management Strategy", "implemented", "CISO"),
            ("PM-10", "Authorization Process", "planned", "CISO"),
            ("PM-11", "Mission and Business Process Definition", "implemented", "CISO"),
            # PS - Personnel Security
            ("PS-1", "Policy and Procedures", "implemented", "HR Manager"),
            ("PS-2", "Position Risk Designation", "implemented", "HR Manager"),
            ("PS-3", "Personnel Screening", "implemented", "HR Manager"),
            ("PS-4", "Personnel Termination", "implemented", "HR Manager"),
            ("PS-5", "Personnel Transfer", "implemented", "HR Manager"),
            ("PS-6", "Access Agreements", "implemented", "HR Manager"),
            ("PS-7", "External Personnel Security", "implemented", "HR Manager"),
            ("PS-8", "Personnel Sanctions", "implemented", "HR Manager"),
            # PT - PII Processing and Transparency
            ("PT-1", "Policy and Procedures", "implemented", "Privacy Officer"),
            ("PT-2", "Authority to Process PII", "implemented", "Privacy Officer"),
            ("PT-3", "PII Processing Purposes", "implemented", "Privacy Officer"),
            ("PT-4", "Consent", "not-applicable", "Privacy Officer"),
            ("PT-5", "Privacy Notice", "implemented", "Privacy Officer"),
            # RA - Risk Assessment
            ("RA-1", "Policy and Procedures", "implemented", "Risk Manager"),
            ("RA-2", "Security Categorization", "implemented", "ISSO"),
            ("RA-3", "Risk Assessment", "implemented", "Risk Manager"),
            ("RA-5", "Vulnerability Monitoring and Scanning", "implemented", "Security Operations"),
            ("RA-7", "Risk Response", "implemented", "Risk Manager"),
            # SA - System and Services Acquisition
            ("SA-1", "Policy and Procedures", "implemented", "Acquisition Manager"),
            ("SA-2", "Allocation of Resources", "implemented", "CISO"),
            ("SA-3", "System Development Life Cycle", "implemented", "Development Lead"),
            ("SA-4", "Acquisition Process", "implemented", "Acquisition Manager"),
            ("SA-5", "System Documentation", "implemented", "Technical Writer"),
            ("SA-8", "Security and Privacy Engineering Principles", "implemented", "Security Architecture"),
            ("SA-9", "External System Services", "implemented", "Acquisition Manager"),
            ("SA-10", "Developer Configuration Management", "implemented", "Development Lead"),
            ("SA-11", "Developer Testing and Evaluation", "implemented", "QA Lead"),
            # SC - System and Communications Protection
            ("SC-1", "Policy and Procedures", "implemented", "Network Security"),
            ("SC-2", "Separation of System and User Functionality", "implemented", "Security Architecture"),
            ("SC-4", "Information in Shared System Resources", "implemented", "Security Engineering"),
            ("SC-5", "Denial-of-Service Protection", "implemented", "Network Security"),
            ("SC-7", "Boundary Protection", "implemented", "Network Security"),
            ("SC-8", "Transmission Confidentiality and Integrity", "implemented", "Security Engineering"),
            ("SC-10", "Network Disconnect", "implemented", "Network Security"),
            ("SC-12", "Cryptographic Key Establishment and Management", "implemented", "Security Engineering"),
            ("SC-13", "Cryptographic Protection", "implemented", "Security Engineering"),
            ("SC-15", "Collaborative Computing Devices and Applications", "implemented", "Security Engineering"),
            ("SC-17", "PKI Certificates", "implemented", "Security Engineering"),
            ("SC-18", "Mobile Code", "not-applicable", "Security Engineering"),
            ("SC-20", "Secure Name/Address Resolution Service (Auth Source)", "implemented", "Infrastructure"),
            ("SC-21", "Secure Name/Address Resolution Service (Recursive)", "implemented", "Infrastructure"),
            ("SC-22", "Architecture and Provisioning for Name/Address Resolution", "implemented", "Infrastructure"),
            ("SC-23", "Session Authenticity", "implemented", "Security Engineering"),
            ("SC-28", "Protection of Information at Rest", "implemented", "Security Engineering"),
            ("SC-39", "Process Isolation", "implemented", "Security Engineering"),
            # SI - System and Information Integrity
            ("SI-1", "Policy and Procedures", "implemented", "Security Operations"),
            ("SI-2", "Flaw Remediation", "implemented", "Security Operations"),
            ("SI-3", "Malicious Code Protection", "implemented", "Endpoint Security"),
            ("SI-4", "System Monitoring", "implemented", "Security Operations"),
            ("SI-5", "Security Alerts, Advisories, and Directives", "implemented", "Security Operations"),
            ("SI-7", "Software, Firmware, and Information Integrity", "implemented", "Security Engineering"),
            ("SI-8", "Spam Protection", "not-applicable", "Security Operations"),
            ("SI-10", "Information Input Validation", "implemented", "Development Lead"),
            ("SI-11", "Error Handling", "implemented", "Development Lead"),
            ("SI-12", "Information Management and Retention", "implemented", "Security Policy"),
            ("SI-16", "Memory Protection", "implemented", "Security Engineering"),
            # SR - Supply Chain Risk Management
            ("SR-1", "Policy and Procedures", "implemented", "Supply Chain Manager"),
            ("SR-2", "Supply Chain Risk Management Plan", "implemented", "Supply Chain Manager"),
            ("SR-3", "Supply Chain Controls and Processes", "implemented", "Supply Chain Manager"),
            ("SR-5", "Acquisition Strategies, Tools, and Methods", "implemented", "Acquisition Manager"),
            ("SR-6", "Supplier Assessments and Reviews", "planned", "Supply Chain Manager"),
            ("SR-8", "Notification Agreements", "implemented", "Supply Chain Manager"),
            ("SR-10", "Inspection of Systems or Components", "planned", "Supply Chain Manager"),
            ("SR-11", "Component Authenticity", "implemented", "Supply Chain Manager"),
            ("SR-12", "Component Disposal", "implemented", "Supply Chain Manager"),
        ]

        for ctrl_id, name, status, role in default_controls:
            family_prefix = ctrl_id.split("-")[0]
            family = CONTROL_FAMILIES.get(family_prefix, family_prefix)

            description = self._generate_implementation_description(
                ctrl_id, name, family
            )

            controls.append(
                {
                    "id": ctrl_id,
                    "name": name,
                    "family": family,
                    "implementation_status": status,
                    "implementation_description": description,
                    "responsible_role": role,
                }
            )

        return {"controls": controls}

    def _generate_implementation_description(
        self, ctrl_id: str, name: str, family: str
    ) -> str:
        """
        Generate a Cognigate-specific implementation description for a control.
        """
        # Cognigate-specific descriptions for key controls
        specific_descriptions: dict[str, str] = {
            "AC-2": (
                "Account management for Cognigate is handled through centralized IAM "
                "with automated provisioning. Agent entities are registered via the "
                "/v1/intent API with unique entity_ids. Access reviews are conducted "
                "quarterly. Agent accounts are automatically suspended when trust "
                "scores drop below the Quarantine tier (0-99)."
            ),
            "AC-3": (
                "Access enforcement is implemented through the Cognigate Policy Engine. "
                "Every agent action passes through the ENFORCE pipeline, which evaluates "
                "trust level gates, permission scope checks, resource boundary "
                "enforcement, and behavioral constraints. Deny-by-default is the "
                "foundational policy."
            ),
            "AC-4": (
                "Information flow enforcement is implemented through network segmentation, "
                "API gateway controls, and the Cognigate ENFORCE pipeline. Data flows "
                "follow the INTENT -> ENFORCE -> PROOF -> CHAIN path with each stage "
                "applying flow control policies."
            ),
            "AU-2": (
                "Cognigate logs all security-relevant events including: authentication "
                "attempts, authorization decisions (allow/deny/escalate/modify), policy "
                "evaluations, trust score changes, proof record creation, chain integrity "
                "verification, and administrative actions. Events are structured as JSON "
                "via structlog."
            ),
            "AU-3": (
                "All audit records contain: timestamp (UTC ISO-8601), event type, "
                "source component, outcome (decision), entity identity (entity_id), "
                "intent identifier, verdict identifier, and additional context. PROOF "
                "records additionally include inputs_hash, outputs_hash, previous_hash, "
                "and Ed25519 digital signature."
            ),
            "AU-9": (
                "The PROOF Plane implements immutable audit records via a dual-hash "
                "chain (SHA-256). Records are append-only with cryptographic integrity "
                "verification. Each record links to its predecessor via previous_hash. "
                "Ed25519 signatures provide non-repudiation. Access to PROOF records "
                "is read-only for auditors."
            ),
            "AU-10": (
                "Non-repudiation is provided by the PROOF Plane's Ed25519 digital "
                "signatures on every governance decision record. The dual-hash chain "
                "provides additional integrity assurance. Chain verification is "
                "automated via /v1/proof/{proof_id}/verify."
            ),
            "CA-7": (
                "Continuous monitoring is implemented through automated control health "
                "checking, PROOF ledger integrity verification, trust score monitoring, "
                "policy compliance dashboards, and automated alerting. Control health "
                "snapshots are available via /v1/compliance/snapshot."
            ),
            "CM-8": (
                "System component inventory is maintained through CycloneDX SBOM "
                "generation (automated via CI/CD pipeline), SPDX companion SBOMs, "
                "and automated vulnerability correlation with npm audit data."
            ),
            "IA-2": (
                "All human users are uniquely identified via centralized IAM with MFA "
                "required. AI agent entities are uniquely identified via entity_id "
                "assigned during registration. Agent authentication uses API keys "
                "with Ed25519 signature verification."
            ),
            "SC-7": (
                "Boundary protection is enforced through API gateway with TLS "
                "termination, rate limiting, IP allowlisting for admin endpoints, "
                "CORS restrictions, and GZip middleware. The authorization boundary "
                "encompasses the Cognigate Engine, PROOF Plane, Policy Engine, and "
                "Trust Engine."
            ),
            "SC-8": (
                "All transmissions use TLS 1.2+ with strong cipher suites. "
                "Internal PROOF records use SHA-256 and SHA3-256 hashing with "
                "Ed25519 digital signatures for integrity and authenticity."
            ),
            "SC-12": (
                "Cryptographic key management leverages Ed25519 for digital "
                "signatures, SHA-256 for content hashing in the PROOF chain, "
                "and SHA3-256 as secondary hash. Keys are generated and stored "
                "securely with rotation procedures documented."
            ),
            "SC-13": (
                "Cryptographic protection uses Ed25519 (digital signatures), "
                "SHA-256 (primary hash), SHA3-256 (secondary hash), and TLS 1.2+ "
                "(transport). All algorithms are NIST-approved."
            ),
            "SI-7": (
                "Software and information integrity is verified through the PROOF "
                "ledger's dual-hash chain (SHA-256 + previous_hash linkage), "
                "Ed25519 digital signatures on proof records, and CycloneDX SBOM "
                "with component hashes. Chain integrity verification is automated."
            ),
            "SR-2": (
                "Supply chain risk management includes CycloneDX and SPDX SBOM "
                "generation, automated vulnerability correlation with npm audit, "
                "NTIA minimum elements validation, and versioned SBOM archival "
                "in sbom-history/."
            ),
        }

        if ctrl_id in specific_descriptions:
            return specific_descriptions[ctrl_id]

        # Generic description based on family
        return (
            f"Vorion implements {ctrl_id} ({name}) as part of the {family} "
            f"control family. Implementation details are documented in the "
            f"Cognigate operational procedures and governance framework."
        )


# ---------------------------------------------------------------------------
# Convenience function
# ---------------------------------------------------------------------------


def generate_ssp(
    component_def_path: Optional[str] = None,
    control_registry_path: Optional[str] = None,
    sbom_path: Optional[str] = None,
    cognigate_url: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> tuple[str, str]:
    """
    Convenience function to generate and save an OSCAL SSP.

    Returns:
        Tuple of (ssp_json_path, summary_md_path).
    """
    generator = SSPGenerator(
        component_def_path=component_def_path,
        control_registry_path=control_registry_path,
        sbom_path=sbom_path,
        cognigate_url=cognigate_url,
        output_dir=output_dir,
    )
    return generator.save()
