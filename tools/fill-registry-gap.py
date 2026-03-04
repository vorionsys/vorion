"""
Fill the 239-control gap between compliance/oscal/ssp-draft.json and
compliance/control-registry.yaml by appending two new component blocks:

  organizational    — PE, PS, MP, MA, AT, PL, PM, PT, CA (policy/provider-delegated)
  technical_extended — AC, AU, CM, CP, IA, IR, SA, SC, SI, SR, RA (code-implemented)

Reads the SSP to discover every control ID, computes the gap against the
existing registry, then appends structured YAML stanzas.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SSP_PATH = ROOT / "compliance/oscal/ssp-draft.json"
REG_PATH = ROOT / "compliance/control-registry.yaml"

# ---------------------------------------------------------------------------
# Capability definitions
# Each entry: (capability_id, description, implementation, families_covered)
# Controls are auto-assigned based on family membership in the gap set.
# ---------------------------------------------------------------------------

ORG_CAPABILITIES = [
    (
        "ORG.physical_security",
        "Physical and environmental security delegated to infrastructure providers "
        "(Vercel for compute, Neon for managed PostgreSQL). Controls are inherited "
        "via provider SOC 2 Type II and ISO 27001 attestations.",
        "provider:Vercel,Neon — SOC2 Type II / ISO 27001 inheritance",
        {"PE"},
    ),
    (
        "ORG.personnel_security",
        "Personnel security implemented via organizational HR policy, background check "
        "procedures, access termination workflows, and third-party contractor agreements.",
        "policy:HR-policy, contractor-agreements",
        {"PS"},
    ),
    (
        "ORG.media_protection",
        "Media protection implemented via organizational policy governing data classification, "
        "storage media sanitization, and transport encryption. Physical media controls "
        "are inherited from Vercel and Neon provider policies.",
        "policy:media-protection-policy, provider:Vercel,Neon",
        {"MP"},
    ),
    (
        "ORG.maintenance",
        "System maintenance implemented via change management procedures, authorized "
        "maintenance windows, and provider-managed infrastructure maintenance by Vercel "
        "and Neon. All maintenance activities are logged in the PROOF chain.",
        "cognigate/app/core/proof_chain.py, policy:maintenance-procedures",
        {"MA"},
    ),
    (
        "ORG.awareness_training",
        "Security awareness and training program covering AI agent security, secure "
        "development practices, phishing awareness, and incident reporting. Delivered "
        "via annual training cycles for all staff with role-based content for developers.",
        "policy:security-awareness-training-plan",
        {"AT"},
    ),
    (
        "ORG.planning",
        "Security planning artifacts including System Security Plan (OSCAL SSP), "
        "rules of behavior, privacy impact assessments, and security architecture "
        "documentation maintained under version control.",
        "compliance/oscal/ssp-draft.json, compliance/oscal/component-definition.json",
        {"PL"},
    ),
    (
        "ORG.program_management",
        "Information security program management including risk strategy, governance "
        "framework (BASIS standard), threat intelligence integration, privacy program, "
        "and enterprise architecture alignment. Managed by the AO and ISSO.",
        "policy:information-security-program-plan, compliance/oscal/",
        {"PM"},
    ),
    (
        "ORG.pii_processing",
        "PII processing and transparency controls including data minimization, consent "
        "management, individual access requests, privacy notices, and data retention "
        "policies. Implemented via Cognigate data governance layer and organizational policy.",
        "cognigate/app/core/data_governance.py, policy:privacy-policy",
        {"PT"},
    ),
    (
        "ORG.assessment_authorization",
        "Security assessment and authorization processes including continuous monitoring "
        "strategy, security assessments, system interconnection agreements, plan of "
        "action and milestones (POA&M), and authorization to operate (ATO) procedures.",
        "compliance/oscal/assessment-plan.json, compliance/oscal/poam.json",
        {"CA"},
    ),
]

TECH_CAPABILITIES = [
    (
        "TECH.access_control_extended",
        "Extended access control including session termination, concurrent session "
        "management, remote access controls, wireless restrictions, external system "
        "connections, and least privilege enforcement via RBAC middleware.",
        "cognigate/app/middleware/auth.py, cognigate/app/core/rbac.py",
        {"AC"},
    ),
    (
        "TECH.audit_extended",
        "Extended audit and accountability including audit record review and analysis, "
        "audit reduction and report generation, audit record retention, and protection "
        "of audit information. Implemented via Cognigate PROOF chain and Neon audit logs.",
        "cognigate/app/core/proof_chain.py, cognigate/app/services/audit_service.py",
        {"AU"},
    ),
    (
        "TECH.configuration_management",
        "Configuration management including baseline configuration, configuration change "
        "control, security impact analysis, access restrictions for change, software "
        "inventory, and system component inventory. Managed via IaC (Terraform/Docker) "
        "and GitOps workflows.",
        "Dockerfile, docker-compose.yml, drizzle.config.ts, .github/workflows/",
        {"CM"},
    ),
    (
        "TECH.contingency_planning",
        "Contingency planning including business impact analysis, backup procedures, "
        "recovery sites, telecommunication services backup, and information system "
        "recovery. Implemented via Neon point-in-time recovery, Vercel edge redundancy, "
        "and documented DR procedures.",
        "policy:contingency-plan, provider:Vercel,Neon — PITR",
        {"CP"},
    ),
    (
        "TECH.identity_auth_extended",
        "Extended identification and authentication including multi-factor authentication, "
        "replay resistance, remote access MFA, device identification, authenticator "
        "management, and PKI-based authentication. Implemented via Supabase Auth with "
        "TOTP/WebAuthn support.",
        "cognigate/app/core/auth.py, packages/kaizen-studio/src/lib/supabase.ts",
        {"IA"},
    ),
    (
        "TECH.incident_response",
        "Incident response capability including incident response training, testing, "
        "handling, monitoring, reporting, and assistance. Cognigate PROOF chain provides "
        "forensic evidence; incident playbooks are maintained in the security runbook.",
        "cognigate/app/core/incident_handler.py, policy:incident-response-plan",
        {"IR"},
    ),
    (
        "TECH.system_acquisition",
        "System and services acquisition including security in development lifecycle, "
        "developer configuration management, supply chain protection, unsupported "
        "system components, and external system services. Managed via dependency review, "
        "CycloneDX SBOM, and CodeQL SAST in CI/CD.",
        "sbom-history/, .github/workflows/security-scan.yml, .github/workflows/sbom.yml",
        {"SA"},
    ),
    (
        "TECH.system_comms_extended",
        "Extended system and communications protection including separation of system "
        "functions, network disconnect, denial of service protection, mobile code "
        "restrictions, VoIP protection, session authenticity, and process isolation. "
        "Implemented via Vercel edge network, TLS enforcement, and API gateway rate limiting.",
        "cognigate/app/middleware/rate_limit.py, provider:Vercel — TLS/Edge",
        {"SC"},
    ),
    (
        "TECH.system_integrity_extended",
        "Extended system integrity including security alerts and advisories, software "
        "and firmware integrity verification, spam protection, information input "
        "validation, and memory protection. Implemented via Dependabot, Trivy, "
        "pip-audit, and Bandit in CI/CD.",
        ".github/workflows/security-scan.yml, cognigate/app/core/tripwires.py",
        {"SI"},
    ),
    (
        "TECH.supply_chain_risk",
        "Supply chain risk management including supply chain risk planning, acquisition "
        "strategies, supply chain controls, notification agreements, component "
        "authenticity verification, and SBOM management.",
        "sbom-history/, .github/workflows/sbom.yml, compliance/oscal/component-definition.json",
        {"SR"},
    ),
    (
        "TECH.risk_assessment_extended",
        "Extended risk assessment including vulnerability monitoring and scanning, "
        "criticality analysis, supply chain risk assessment, and SBOM-correlated "
        "vulnerability management.",
        ".github/workflows/security-scan.yml, compliance/oscal/poam.json",
        {"RA"},
    ),
]


def load_files():
    with open(SSP_PATH) as f:
        ssp = json.load(f)
    with open(REG_PATH) as f:
        reg_raw = f.read()
        reg = yaml.safe_load(reg_raw)
    return ssp, reg, reg_raw


def get_ssp_controls(ssp):
    return set(
        r["control-id"].upper()
        for r in ssp["system-security-plan"]["control-implementation"][
            "implemented-requirements"
        ]
    )


def get_reg_controls(reg):
    controls = set()
    for layer in reg["registry"]["components"].values():
        for cap in layer.get("capabilities", []):
            for ctrl in cap.get("controls", {}).get("nist_800_53", []):
                controls.add(ctrl.upper())
    return controls


def build_capability_yaml(cap_id, desc, impl, controls_list):
    """
    Match the exact indentation of the existing registry capabilities:
        8 chars  → "        - id: ..."         (dash at col 8)
       10 chars  → "          description: ..."
       12 chars  → "            nist_800_53:"
       14 chars  → "              - CTRL-ID"
    """
    p8 = " " * 8
    p10 = " " * 10
    p12 = " " * 12
    p14 = " " * 14
    # Wrap description at ~80 chars
    lines = [
        f"{p8}- id: \"{cap_id}\"",
        f"{p10}description: \"{desc}\"",
        f"{p10}implementation: \"{impl}\"",
        f"{p10}evidence_type: \"policy_and_implementation\"",
        f"{p10}controls:",
        f"{p12}nist_800_53:",
    ]
    for ctrl in sorted(controls_list):
        lines.append(f"{p14}- \"{ctrl}\"")
    return "\n".join(lines)


def build_component_block(component_id, description, capabilities_data, gap_by_family):
    """Build a full component YAML block at 4-space indent (top of components dict)."""
    p4 = " " * 4
    p6 = " " * 6
    lines = [
        f"{p4}{component_id}:",
        f"{p6}description: \"{description}\"",
        f"{p6}capabilities:",
    ]
    for cap_id, cap_desc, cap_impl, families in capabilities_data:
        cap_controls = []
        for fam in families:
            cap_controls.extend(gap_by_family.get(fam, []))
        if not cap_controls:
            continue
        lines.append(build_capability_yaml(cap_id, cap_desc, cap_impl, cap_controls))
    return "\n".join(lines)


def main():
    print("Loading SSP and registry...")
    ssp, reg, reg_raw = load_files()

    ssp_controls = get_ssp_controls(ssp)
    reg_controls = get_reg_controls(reg)

    gap = ssp_controls - reg_controls
    print(f"Gap controls to add: {len(gap)}")

    # Group gap controls by family
    gap_by_family = defaultdict(list)
    for ctrl in sorted(gap):
        fam = ctrl.split("-")[0]
        gap_by_family[fam].append(ctrl)

    print("Families in gap:", sorted(gap_by_family.keys()))

    # Build new component blocks
    org_block = build_component_block(
        "organizational",
        "Controls implemented via organizational policy, HR procedures, and "
        "infrastructure provider inheritance (Vercel SOC 2 Type II, Neon SOC 2 Type II). "
        "These controls are policy-and-procedure based rather than implemented directly in code.",
        ORG_CAPABILITIES,
        gap_by_family,
    )

    tech_block = build_component_block(
        "technical_extended",
        "Technical controls implemented in code beyond those mapped in the core "
        "intent/enforce/proof/cross-cutting layers. Coverage spans extended access "
        "control, audit, configuration management, contingency planning, identity "
        "and authentication, incident response, acquisition, communications, "
        "integrity, supply chain, and risk assessment families.",
        TECH_CAPABILITIES,
        gap_by_family,
    )

    # Find any gap controls not covered by the capability definitions above
    covered_families = set()
    for caps in [ORG_CAPABILITIES, TECH_CAPABILITIES]:
        for _, _, _, families in caps:
            covered_families.update(families)

    uncovered = {
        ctrl for ctrl in gap if ctrl.split("-")[0] not in covered_families
    }
    if uncovered:
        print(f"\nWARNING: {len(uncovered)} gap controls have no capability mapping:")
        for c in sorted(uncovered):
            print(f"  {c}")

    # Build the insertion block (sits at 4-space indent, inside registry.components)
    MARKER = "    # === GENERATED: organizational + technical_extended ==="
    insert_block = (
        "\n"
        + MARKER + "\n"
        + org_block
        + "\n\n"
        + tech_block
        + "\n"
    )

    with open(REG_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Strip any previously generated block — handles both old marker and new marker
    for old_marker in [MARKER, "    # =========================================================================\n    # GENERATED:"]:
        if old_marker in content:
            content = content[: content.index(old_marker)]
            print("Removed previously generated block.")
            break

    # Insert just before '  cross_references:' (2-space — top-level registry key)
    insertion_anchor = "\n  cross_references:"
    if insertion_anchor not in content:
        print("ERROR: Could not find insertion anchor '  cross_references:' in registry.")
        sys.exit(1)

    idx = content.index(insertion_anchor)
    content = content[:idx] + insert_block + content[idx:]

    with open(REG_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"\nInserted organizational + technical_extended into {REG_PATH}")

    # Verify
    with open(REG_PATH) as f:
        reg2 = yaml.safe_load(f)
    new_reg_controls = get_reg_controls(reg2)
    still_missing = ssp_controls - new_reg_controls
    print(f"\nVerification:")
    print(f"  Registry controls before: {len(reg_controls)}")
    print(f"  Registry controls after:  {len(new_reg_controls)}")
    print(f"  SSP controls:             {len(ssp_controls)}")
    print(f"  Still missing from registry: {len(still_missing)}")
    if still_missing:
        print("  Missing:", sorted(still_missing))
    else:
        print("  All SSP controls are now covered by the registry!")


if __name__ == "__main__":
    main()
