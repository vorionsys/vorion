#!/usr/bin/env python3
"""
Vorion Cognigate -- OSCAL SSP Generator CLI

Commands:
    generate   Generate an OSCAL SSP JSON document and human-readable summary
    validate   Validate an existing OSCAL SSP JSON document structure
    summary    Generate a Markdown summary from an existing SSP JSON
    package    Generate a complete ICP evidence package

Usage:
    python -m vorion.tools.ssp_generator.cli generate \
        --component-def compliance/oscal/component-definition.json \
        --registry compliance/control-registry.yaml \
        --sbom sbom/sbom-cyclonedx.json \
        --output compliance/oscal/

    python -m vorion.tools.ssp_generator.cli validate \
        --ssp compliance/oscal/ssp-draft.json

    python -m vorion.tools.ssp_generator.cli summary \
        --ssp compliance/oscal/ssp-draft.json \
        --output compliance/oscal/ssp-summary.md

    python -m vorion.tools.ssp_generator.cli package \
        --output-dir icp-package/
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from .ssp_generator import SSPGenerator, generate_ssp, OSCAL_VERSION
from .package_generator import ICPPackageGenerator
from .validator import validate_oscal_ssp

logger = logging.getLogger("vorion.ssp_cli")


def cmd_generate(args: argparse.Namespace) -> int:
    """Generate an OSCAL SSP JSON document."""
    print(f"Vorion SSP Generator v1.0.0 (OSCAL {OSCAL_VERSION})")
    print("=" * 60)

    generator = SSPGenerator(
        component_def_path=args.component_def,
        control_registry_path=args.registry,
        sbom_path=args.sbom,
        cognigate_url=args.cognigate_url,
        output_dir=args.output,
    )

    print("Generating OSCAL SSP...")
    ssp = generator.generate()

    ssp_path, summary_path = generator.save(ssp)

    plan = ssp.get("system-security-plan", {})
    ctrl_impl = plan.get("control-implementation", {})
    impl_reqs = ctrl_impl.get("implemented-requirements", [])

    print(f"\nSSP generated successfully:")
    print(f"  SSP JSON:    {ssp_path}")
    print(f"  Summary MD:  {summary_path}")
    print(f"  Controls:    {len(impl_reqs)}")
    print(f"  OSCAL ver:   {OSCAL_VERSION}")

    # Print quick status summary
    status_counts: dict[str, int] = {}
    for req in impl_reqs:
        for prop in req.get("props", []):
            if prop.get("name") == "implementation-status":
                status = prop.get("value", "planned")
                status_counts[status] = status_counts.get(status, 0) + 1

    print("\n  Implementation Status:")
    for status, count in sorted(status_counts.items()):
        print(f"    {status}: {count}")

    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    """Validate an OSCAL SSP JSON document."""
    ssp_path = args.ssp
    if not Path(ssp_path).exists():
        print(f"Error: SSP file not found: {ssp_path}", file=sys.stderr)
        return 1

    print(f"Validating OSCAL SSP: {ssp_path}")
    print("=" * 60)

    with open(ssp_path, "r", encoding="utf-8") as f:
        ssp = json.load(f)

    result = validate_oscal_ssp(ssp)

    if result["valid"]:
        print("\nVALIDATION PASSED")
        print(f"  Checks passed: {result['checks_passed']}")
        print(f"  Warnings:      {len(result.get('warnings', []))}")
    else:
        print("\nVALIDATION FAILED")
        print(f"  Checks passed: {result['checks_passed']}")
        print(f"  Checks failed: {result['checks_failed']}")

    if result.get("errors"):
        print("\n  Errors:")
        for err in result["errors"]:
            print(f"    - {err}")

    if result.get("warnings"):
        print("\n  Warnings:")
        for warn in result["warnings"]:
            print(f"    - {warn}")

    return 0 if result["valid"] else 1


def cmd_summary(args: argparse.Namespace) -> int:
    """Generate a Markdown summary from an existing SSP JSON."""
    ssp_path = args.ssp
    if not Path(ssp_path).exists():
        print(f"Error: SSP file not found: {ssp_path}", file=sys.stderr)
        return 1

    with open(ssp_path, "r", encoding="utf-8") as f:
        ssp = json.load(f)

    generator = SSPGenerator()
    summary = generator.generate_summary(ssp)

    output_path = args.output
    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(summary)
        print(f"Summary written to: {output_path}")
    else:
        print(summary)

    return 0


def cmd_package(args: argparse.Namespace) -> int:
    """Generate a complete ICP evidence package."""
    print("Vorion ICP Evidence Package Generator")
    print("=" * 60)

    pkg_gen = ICPPackageGenerator(
        component_def_path=args.component_def,
        control_registry_path=args.registry,
        sbom_cyclonedx_path=args.sbom_cyclonedx,
        sbom_spdx_path=args.sbom_spdx,
        cognigate_url=args.cognigate_url,
        output_dir=args.output_dir,
    )

    manifest = pkg_gen.generate()

    print(f"\nICP evidence package generated:")
    print(f"  Output directory: {args.output_dir}")
    print(f"  Files created:    {len(manifest.get('files', []))}")
    print()
    for f in manifest.get("files", []):
        print(f"    {f}")

    return 0


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        prog="ssp-generator",
        description="Vorion Cognigate OSCAL SSP Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # -- generate --
    gen_parser = subparsers.add_parser(
        "generate",
        help="Generate an OSCAL SSP JSON document",
    )
    gen_parser.add_argument(
        "--component-def",
        type=str,
        default=None,
        help="Path to OSCAL component definition JSON",
    )
    gen_parser.add_argument(
        "--registry",
        type=str,
        default=None,
        help="Path to control registry YAML",
    )
    gen_parser.add_argument(
        "--sbom",
        type=str,
        default=None,
        help="Path to CycloneDX SBOM JSON",
    )
    gen_parser.add_argument(
        "--cognigate-url",
        type=str,
        default=None,
        help="Cognigate API base URL (for live control health and proof data)",
    )
    gen_parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output directory for SSP files (default: compliance/oscal/)",
    )

    # -- validate --
    val_parser = subparsers.add_parser(
        "validate",
        help="Validate an OSCAL SSP JSON document",
    )
    val_parser.add_argument(
        "--ssp",
        type=str,
        required=True,
        help="Path to OSCAL SSP JSON file",
    )

    # -- summary --
    sum_parser = subparsers.add_parser(
        "summary",
        help="Generate a Markdown summary from an SSP JSON",
    )
    sum_parser.add_argument(
        "--ssp",
        type=str,
        required=True,
        help="Path to OSCAL SSP JSON file",
    )
    sum_parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output path for Markdown summary (default: stdout)",
    )

    # -- package --
    pkg_parser = subparsers.add_parser(
        "package",
        help="Generate a complete ICP evidence package",
    )
    pkg_parser.add_argument(
        "--component-def",
        type=str,
        default=None,
        help="Path to OSCAL component definition JSON",
    )
    pkg_parser.add_argument(
        "--registry",
        type=str,
        default=None,
        help="Path to control registry YAML",
    )
    pkg_parser.add_argument(
        "--sbom-cyclonedx",
        type=str,
        default=None,
        help="Path to CycloneDX SBOM JSON",
    )
    pkg_parser.add_argument(
        "--sbom-spdx",
        type=str,
        default=None,
        help="Path to SPDX SBOM JSON",
    )
    pkg_parser.add_argument(
        "--cognigate-url",
        type=str,
        default=None,
        help="Cognigate API base URL",
    )
    pkg_parser.add_argument(
        "--output-dir",
        type=str,
        default="icp-package",
        help="Output directory for the evidence package",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    """Main entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if not args.command:
        parser.print_help()
        return 1

    commands = {
        "generate": cmd_generate,
        "validate": cmd_validate,
        "summary": cmd_summary,
        "package": cmd_package,
    }

    handler = commands.get(args.command)
    if handler is None:
        print(f"Unknown command: {args.command}", file=sys.stderr)
        return 1

    try:
        return handler(args)
    except Exception as exc:
        logger.exception("Command failed: %s", exc)
        print(f"\nError: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
