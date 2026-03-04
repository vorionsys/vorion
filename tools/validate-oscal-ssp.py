"""Structural validation for OSCAL SSP artifacts."""
import json
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent / "compliance" / "oscal"

ARTIFACTS = {
    "ssp-draft.json": "system-security-plan",
    "component-definition.json": "component-definition",
    "assessment-plan.json": "assessment-plan",
    "poam.json": "plan-of-action-and-milestones",
}

REQUIRED_SSP_FIELDS = [
    "uuid",
    "metadata",
    "import-profile",
    "system-characteristics",
    "system-implementation",
    "control-implementation",
]

all_passed = True

for filename, root_key in ARTIFACTS.items():
    path = BASE / filename
    print(f"\n{'='*60}")
    print(f"Validating: {filename}")
    print(f"{'='*60}")

    if not path.exists():
        print(f"  MISSING: {path}")
        all_passed = False
        continue

    try:
        with open(path) as f:
            data = json.load(f)
        print("  JSON parse: OK")
    except json.JSONDecodeError as e:
        print(f"  JSON parse: FAILED — {e}")
        all_passed = False
        continue

    if root_key not in data:
        print(f"  Root key '{root_key}': MISSING")
        all_passed = False
        continue

    doc = data[root_key]
    meta = doc.get("metadata", {})

    print(f"  Root key '{root_key}': OK")
    print(f"  UUID: {doc.get('uuid', 'MISSING')}")
    print(f"  OSCAL version: {meta.get('oscal-version', 'MISSING')}")
    print(f"  Title: {meta.get('title', 'MISSING')}")
    print(f"  Last modified: {meta.get('last-modified', 'MISSING')}")

    if filename == "ssp-draft.json":
        print("\n  Required field checks:")
        for field in REQUIRED_SSP_FIELDS:
            present = field in doc
            status = "OK" if present else "MISSING"
            print(f"    [{status}] {field}")
            if not present:
                all_passed = False

        ci = doc.get("control-implementation", {})
        reqs = ci.get("implemented-requirements", [])
        print(f"\n  Implemented requirements: {len(reqs)}")

        roles = meta.get("roles", [])
        parties = meta.get("parties", [])
        print(f"  Roles: {len(roles)} — {[r.get('id') for r in roles]}")
        print(f"  Parties: {len(parties)} — {[p.get('name') for p in parties]}")

print(f"\n{'='*60}")
if all_passed:
    print("OSCAL VALIDATION: ALL ARTIFACTS PASSED")
    sys.exit(0)
else:
    print("OSCAL VALIDATION: FAILURES DETECTED")
    sys.exit(1)
