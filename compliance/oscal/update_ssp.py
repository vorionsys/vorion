#!/usr/bin/env python3
"""
Update SSP draft JSON:
1. Add back-matter resources for all 13 policy documents
2. Upgrade implementation-status for controls with complete policy documentation
3. Add resource links to upgraded control entries
4. Print summary statistics
"""

import json
import uuid
from pathlib import Path

SSP_PATH = Path("/Users/alexblanc/vorion-nist-integration/vorion/compliance/oscal/ssp-draft.json")
POLICIES_DIR = Path("/Users/alexblanc/vorion-nist-integration/vorion/compliance/policies")

# ── Policy document metadata and control mappings ──────────────────────────

POLICY_DOCS = {
    "contingency-plan.md": {
        "title": "Contingency Plan",
        "description": "Vorion contingency planning policy covering business continuity, disaster recovery, backup procedures, and alternate processing/storage site requirements.",
        "controls_to_implement": [
            "cp-1", "cp-2", "cp-2.1", "cp-2.8", "cp-3", "cp-4", "cp-4.1",
            "cp-6", "cp-6.1", "cp-6.3", "cp-7", "cp-7.1", "cp-7.2", "cp-7.3",
            "cp-9", "cp-9.1", "cp-9.8"
        ],
    },
    "incident-response-plan.md": {
        "title": "Incident Response Plan",
        "description": "Vorion incident response policy covering incident handling training, testing, reporting, and information sharing procedures.",
        "controls_to_implement": ["ir-2", "ir-3", "ir-3.2", "ir-6.3"],
    },
    "maintenance-policy.md": {
        "title": "Maintenance Policy",
        "description": "Vorion maintenance policy covering controlled maintenance, maintenance tools, maintenance tool inspections, and maintenance personnel authorization.",
        "controls_to_implement": ["ma-1", "ma-2", "ma-3", "ma-3.1", "ma-3.2", "ma-3.3", "ma-5"],
    },
    "media-protection-policy.md": {
        "title": "Media Protection Policy",
        "description": "Vorion media protection policy covering media access, marking, storage, transport, sanitization, and use restrictions.",
        "controls_to_implement": ["mp-1", "mp-2", "mp-3", "mp-4", "mp-5", "mp-6"],
    },
    "personnel-security-policy.md": {
        "title": "Personnel Security Policy",
        "description": "Vorion personnel security policy covering position risk designation, personnel screening, termination, transfer, sanctions, and third-party personnel security.",
        "controls_to_implement": ["ps-1", "ps-2", "ps-3", "ps-5", "ps-6", "ps-7", "ps-9"],
    },
    "awareness-training-policy.md": {
        "title": "Awareness and Training Policy",
        "description": "Vorion security awareness and training policy covering literacy training, role-based training, practical exercises, and training records.",
        "controls_to_implement": ["at-1", "at-2", "at-2.2", "at-2.3", "at-3", "at-4"],
    },
    "privacy-policy.md": {
        "title": "Privacy Policy",
        "description": "Vorion privacy policy covering personally identifiable information processing, consent, data minimization, and privacy impact assessments.",
        "controls_to_implement": ["pt-1", "pt-4", "pt-5", "pt-7"],
    },
    "program-management-plan.md": {
        "title": "Program Management Plan",
        "description": "Vorion information security and privacy program management plan covering planning, risk management, architecture, continuous monitoring, and threat awareness.",
        "controls_to_implement": [
            "pm-3", "pm-4", "pm-7", "pm-8", "pm-10", "pm-13", "pm-17", "pm-18",
            "pm-20", "pm-21", "pm-22", "pm-26", "pm-27"
        ],
    },
    "access-control-policy.md": {
        "title": "Access Control Policy",
        "description": "Vorion access control policy addendum covering session lock, system use notification, and automated account management enforcement.",
        "controls_to_implement": ["ac-2.2", "ac-8", "ac-11"],
    },
    "configuration-management-plan.md": {
        "title": "Configuration Management Plan",
        "description": "Vorion configuration management plan covering baseline configurations, impact analysis, least functionality, and software usage restrictions.",
        "controls_to_implement": ["cm-2.3", "cm-4", "cm-7.1", "cm-9", "cm-10"],
    },
    "assessment-authorization-policy.md": {
        "title": "Assessment and Authorization Policy",
        "description": "Vorion security assessment and authorization policy covering independent assessors, plan of action and milestones, authorization, and penetration testing.",
        "controls_to_implement": ["ca-2.1", "ca-5", "ca-6", "ca-7.1", "ca-8"],
    },
    "risk-supply-chain-addendum.md": {
        "title": "Risk and Supply Chain Addendum",
        "description": "Vorion risk assessment and supply chain risk management addendum covering public access system vulnerability analysis and component authenticity.",
        "controls_to_implement": ["ra-5(11)", "sr-11(1)"],
    },
    "authentication-architecture.md": {
        "title": "Authentication Architecture",
        "description": "Vorion authentication architecture document covering multi-factor authentication, identity proofing, federated identity, and physical access controls.",
        "controls_to_implement": [
            "pe-10",         # upgrade to implemented
            "ia-2.12",       # upgrade to implemented
            "ia-8.4",        # upgrade to implemented
            "ia-12.5",       # upgrade to implemented
            # The following STAY partial - referenced but not upgraded:
            "ia-2.1", "ia-2.2",            # MFA not yet implemented
            "ia-5.1", "ia-8.1", "ia-8.2",  # OIDC/SAML/FIDO2 not yet implemented
        ],
    },
}

# Controls that should be upgraded to "implemented"
UPGRADE_TO_IMPLEMENTED = set()
# Controls that must STAY partial (authentication-architecture.md partial items)
KEEP_PARTIAL = {"ia-2.1", "ia-2.2", "ia-5.1", "ia-8.1", "ia-8.2"}

for doc, info in POLICY_DOCS.items():
    if doc == "authentication-architecture.md":
        # Only specific controls get upgraded
        UPGRADE_TO_IMPLEMENTED.update(["pe-10", "ia-2.12", "ia-8.4", "ia-12.5"])
    else:
        UPGRADE_TO_IMPLEMENTED.update(info["controls_to_implement"])

# AT-1 special case: change from "planned" to "implemented"
# (Already included via awareness-training-policy.md controls_to_implement)
# AT-4 special case: change from "planned" to "implemented"
# (Already included via awareness-training-policy.md controls_to_implement)

print(f"Controls to upgrade to 'implemented': {len(UPGRADE_TO_IMPLEMENTED)}")
print(f"Controls to keep as partial: {len(KEEP_PARTIAL)}")

# ── Build reverse mapping: control-id -> resource UUID ─────────────────────

# Generate UUIDs for each policy document resource
resource_uuids = {}
for doc in POLICY_DOCS:
    resource_uuids[doc] = str(uuid.uuid4())

# Build control-id -> list of resource UUIDs (for linking)
control_to_resources = {}
for doc, info in POLICY_DOCS.items():
    for cid in info["controls_to_implement"]:
        control_to_resources.setdefault(cid, []).append(resource_uuids[doc])

# ── Load SSP ───────────────────────────────────────────────────────────────

with open(SSP_PATH, "r") as f:
    ssp_data = json.load(f)

ssp = ssp_data["system-security-plan"]

# ── Step 1: Add back-matter resources ──────────────────────────────────────

resources = ssp["back-matter"]["resources"]
existing_titles = {r["title"] for r in resources}

added_resources = 0
for doc, info in POLICY_DOCS.items():
    if info["title"] in existing_titles:
        print(f"  SKIP (already exists): {info['title']}")
        continue

    resource = {
        "uuid": resource_uuids[doc],
        "title": info["title"],
        "description": info["description"],
        "props": [
            {"name": "type", "value": "policy"},
        ],
        "rlinks": [
            {"href": f"../policies/{doc}", "media-type": "text/markdown"}
        ],
    }
    resources.append(resource)
    added_resources += 1

print(f"\nAdded {added_resources} new back-matter resources (total: {len(resources)})")

# ── Step 2 & 3: Update implementation status and add resource links ────────

irs = ssp["control-implementation"]["implemented-requirements"]

upgraded_count = 0
linked_count = 0

for ir in irs:
    cid = ir["control-id"]

    # Check if this control should be upgraded
    if cid in UPGRADE_TO_IMPLEMENTED:
        for prop in ir.get("props", []):
            if prop["name"] == "implementation-status":
                old_val = prop["value"]
                if old_val in ("partial", "planned"):
                    prop["value"] = "implemented"
                    upgraded_count += 1
                    print(f"  UPGRADE {cid}: {old_val} -> implemented")

    # Add resource links for all controls that have a policy document
    # (including those that stay partial -- they still reference the doc)
    if cid in control_to_resources:
        # Add links array if not present
        if "links" not in ir:
            ir["links"] = []

        existing_hrefs = {l.get("href", "") for l in ir["links"]}

        for res_uuid in control_to_resources[cid]:
            href = f"#{res_uuid}"
            if href not in existing_hrefs:
                ir["links"].append({
                    "href": href,
                    "rel": "reference",
                    "text": "Policy document providing implementation evidence"
                })
                linked_count += 1

print(f"\nUpgraded {upgraded_count} controls to 'implemented'")
print(f"Added {linked_count} resource links to implemented-requirements")

# ── Step 4: Save ───────────────────────────────────────────────────────────

with open(SSP_PATH, "w") as f:
    json.dump(ssp_data, f, indent=2)
    f.write("\n")  # trailing newline

print(f"\nSaved to {SSP_PATH}")

# ── Step 5: Summary statistics ─────────────────────────────────────────────

# Re-count from the saved data
with open(SSP_PATH, "r") as f:
    final_data = json.load(f)

final_irs = final_data["system-security-plan"]["control-implementation"]["implemented-requirements"]

counts = {"implemented": 0, "partial": 0, "planned": 0, "not-applicable": 0, "other": 0}
for ir in final_irs:
    status = "unknown"
    for prop in ir.get("props", []):
        if prop["name"] == "implementation-status":
            status = prop["value"]
    if status in counts:
        counts[status] += 1
    else:
        counts["other"] += 1

total = len(final_irs)
print(f"\n{'='*50}")
print(f"FINAL SSP CONTROL STATUS SUMMARY")
print(f"{'='*50}")
print(f"  Total controls:    {total}")
print(f"  Implemented:       {counts['implemented']}")
print(f"  Partial:           {counts['partial']}")
print(f"  Planned:           {counts['planned']}")
print(f"  Not Applicable:    {counts['not-applicable']}")
if counts['other'] > 0:
    print(f"  Other:             {counts['other']}")
print(f"{'='*50}")
print(f"  Implementation rate: {counts['implemented']/total*100:.1f}%")
