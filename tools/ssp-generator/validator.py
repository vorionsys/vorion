"""
OSCAL SSP JSON Structural Validator

Validates that an OSCAL SSP JSON document conforms to the expected structure
per NIST OSCAL 1.1.2 schema requirements. This is a structural validator --
for full schema validation, use the NIST OSCAL validation tools.

Checks:
- Required top-level keys
- Metadata completeness (title, version, oscal-version, roles, parties)
- import-profile presence
- system-characteristics structure
- system-implementation components and users
- control-implementation implemented-requirements
- back-matter resources
- UUID format validity
- Cross-reference integrity (role-ids, party-uuids, component-uuids)
"""

import re
from typing import Any

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID-4 format."""
    return bool(UUID_PATTERN.match(value))


def validate_oscal_ssp(ssp: dict) -> dict[str, Any]:
    """
    Validate an OSCAL SSP JSON document structure.

    Returns a dict with:
        valid: bool
        checks_passed: int
        checks_failed: int
        errors: list[str]
        warnings: list[str]
    """
    errors: list[str] = []
    warnings: list[str] = []
    passed = 0
    failed = 0

    def check(condition: bool, error_msg: str, is_warning: bool = False) -> None:
        nonlocal passed, failed
        if condition:
            passed += 1
        else:
            failed += 1
            if is_warning:
                warnings.append(error_msg)
            else:
                errors.append(error_msg)

    # -----------------------------------------------------------------------
    # Top-level structure
    # -----------------------------------------------------------------------
    check(
        "system-security-plan" in ssp,
        "Missing required top-level key: system-security-plan",
    )

    plan = ssp.get("system-security-plan", {})

    check(
        isinstance(plan.get("uuid"), str) and _is_valid_uuid(plan.get("uuid", "")),
        "system-security-plan.uuid must be a valid UUID",
    )

    # -----------------------------------------------------------------------
    # Metadata
    # -----------------------------------------------------------------------
    metadata = plan.get("metadata", {})
    check(bool(metadata), "Missing required section: metadata")
    check(bool(metadata.get("title")), "metadata.title is required")
    check(bool(metadata.get("last-modified")), "metadata.last-modified is required")
    check(bool(metadata.get("version")), "metadata.version is required")
    check(bool(metadata.get("oscal-version")), "metadata.oscal-version is required")

    # Roles
    roles = metadata.get("roles", [])
    check(
        isinstance(roles, list) and len(roles) > 0,
        "metadata.roles should contain at least one role",
        is_warning=True,
    )
    role_ids = set()
    for role in roles:
        role_id = role.get("id", "")
        check(bool(role_id), f"Role missing id: {role}")
        check(bool(role.get("title")), f"Role '{role_id}' missing title")
        role_ids.add(role_id)

    # Parties
    parties = metadata.get("parties", [])
    check(
        isinstance(parties, list) and len(parties) > 0,
        "metadata.parties should contain at least one party",
        is_warning=True,
    )
    party_uuids = set()
    for party in parties:
        puuid = party.get("uuid", "")
        check(
            _is_valid_uuid(puuid),
            f"Party UUID invalid: {puuid}",
        )
        check(bool(party.get("type")), f"Party '{puuid}' missing type")
        check(bool(party.get("name")), f"Party '{puuid}' missing name")
        party_uuids.add(puuid)

    # Responsible parties
    resp_parties = metadata.get("responsible-parties", [])
    for rp in resp_parties:
        rp_role = rp.get("role-id", "")
        check(
            rp_role in role_ids,
            f"responsible-parties references undefined role-id: {rp_role}",
            is_warning=True,
        )
        for puuid in rp.get("party-uuids", []):
            check(
                puuid in party_uuids,
                f"responsible-parties references undefined party-uuid: {puuid}",
                is_warning=True,
            )

    # -----------------------------------------------------------------------
    # Import Profile
    # -----------------------------------------------------------------------
    import_profile = plan.get("import-profile", {})
    check(bool(import_profile), "Missing required section: import-profile")
    check(
        bool(import_profile.get("href")),
        "import-profile.href is required",
    )

    # -----------------------------------------------------------------------
    # System Characteristics
    # -----------------------------------------------------------------------
    sys_chars = plan.get("system-characteristics", {})
    check(bool(sys_chars), "Missing required section: system-characteristics")
    check(
        bool(sys_chars.get("system-name")),
        "system-characteristics.system-name is required",
    )
    check(
        bool(sys_chars.get("description")),
        "system-characteristics.description is required",
    )
    check(
        bool(sys_chars.get("security-sensitivity-level")),
        "system-characteristics.security-sensitivity-level is required",
    )
    check(
        bool(sys_chars.get("system-information")),
        "system-characteristics.system-information is required",
    )
    check(
        bool(sys_chars.get("security-impact-level")),
        "system-characteristics.security-impact-level is required",
    )
    check(
        bool(sys_chars.get("status")),
        "system-characteristics.status is required",
    )
    check(
        bool(sys_chars.get("authorization-boundary")),
        "system-characteristics.authorization-boundary is required",
    )

    # Information types
    sys_info = sys_chars.get("system-information", {})
    info_types = sys_info.get("information-types", [])
    check(
        isinstance(info_types, list) and len(info_types) > 0,
        "system-information should have at least one information-type",
    )
    for it in info_types:
        check(bool(it.get("title")), "information-type missing title")
        check(bool(it.get("description")), "information-type missing description")

    # -----------------------------------------------------------------------
    # System Implementation
    # -----------------------------------------------------------------------
    sys_impl = plan.get("system-implementation", {})
    check(bool(sys_impl), "Missing required section: system-implementation")

    users = sys_impl.get("users", [])
    check(
        isinstance(users, list) and len(users) > 0,
        "system-implementation.users should have at least one user",
    )
    for user in users:
        check(
            _is_valid_uuid(user.get("uuid", "")),
            f"User UUID invalid: {user.get('uuid', '')}",
        )
        check(bool(user.get("title")), "User missing title")

    components = sys_impl.get("components", [])
    check(
        isinstance(components, list) and len(components) > 0,
        "system-implementation.components should have at least one component",
    )
    component_uuids = set()
    for comp in components:
        cuuid = comp.get("uuid", "")
        check(_is_valid_uuid(cuuid), f"Component UUID invalid: {cuuid}")
        check(bool(comp.get("type")), f"Component '{cuuid}' missing type")
        check(bool(comp.get("title")), f"Component '{cuuid}' missing title")
        check(bool(comp.get("description")), f"Component '{cuuid}' missing description")
        check(
            bool(comp.get("status", {}).get("state")),
            f"Component '{cuuid}' missing status.state",
        )
        component_uuids.add(cuuid)

    # -----------------------------------------------------------------------
    # Control Implementation
    # -----------------------------------------------------------------------
    ctrl_impl = plan.get("control-implementation", {})
    check(bool(ctrl_impl), "Missing required section: control-implementation")
    check(
        bool(ctrl_impl.get("description")),
        "control-implementation.description is required",
    )

    impl_reqs = ctrl_impl.get("implemented-requirements", [])
    check(
        isinstance(impl_reqs, list) and len(impl_reqs) > 0,
        "control-implementation should have at least one implemented-requirement",
    )

    control_ids_seen = set()
    for req in impl_reqs:
        req_uuid = req.get("uuid", "")
        check(_is_valid_uuid(req_uuid), f"Implemented requirement UUID invalid: {req_uuid}")

        ctrl_id = req.get("control-id", "")
        check(bool(ctrl_id), f"Implemented requirement '{req_uuid}' missing control-id")

        if ctrl_id in control_ids_seen:
            warnings.append(f"Duplicate control-id in implemented-requirements: {ctrl_id}")
        control_ids_seen.add(ctrl_id)

        # Validate statements reference valid components
        for stmt in req.get("statements", []):
            stmt_uuid = stmt.get("uuid", "")
            check(
                _is_valid_uuid(stmt_uuid),
                f"Statement UUID invalid: {stmt_uuid}",
            )
            for bc in stmt.get("by-components", []):
                bc_comp_uuid = bc.get("component-uuid", "")
                check(
                    bc_comp_uuid in component_uuids,
                    f"Statement references undefined component-uuid: {bc_comp_uuid}",
                    is_warning=True,
                )

    # -----------------------------------------------------------------------
    # Back Matter
    # -----------------------------------------------------------------------
    back_matter = plan.get("back-matter", {})
    check(bool(back_matter), "Missing section: back-matter", is_warning=True)

    resources = back_matter.get("resources", [])
    check(
        isinstance(resources, list) and len(resources) > 0,
        "back-matter should have at least one resource",
        is_warning=True,
    )
    for res in resources:
        check(
            _is_valid_uuid(res.get("uuid", "")),
            f"Resource UUID invalid: {res.get('uuid', '')}",
        )
        check(bool(res.get("title")), "Resource missing title")

    # -----------------------------------------------------------------------
    # Result
    # -----------------------------------------------------------------------
    return {
        "valid": failed == 0 or all(
            e in [w for w in warnings] for e in errors
        ),
        "checks_passed": passed,
        "checks_failed": failed,
        "total_controls": len(control_ids_seen),
        "total_components": len(component_uuids),
        "errors": errors,
        "warnings": warnings,
    }
