#!/usr/bin/env python3
"""
VorionSDK Deep Analysis - Terminal 1
Analyzes Python/TypeScript repos and generates execution plan
"""

import os
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any

class VorionAnalyzer:
    def __init__(self, repo_path: str = "."):
        self.repo_path = Path(repo_path)
        self.analysis_dir = self.repo_path / "analysis"
        self.config_dir = self.repo_path / "config"
        self.compliance_dir = self.repo_path / "compliance"

        # Create required directories
        for dir_path in [self.analysis_dir, self.config_dir, self.compliance_dir]:
            dir_path.mkdir(exist_ok=True)

    def detect_project_type(self) -> Dict[str, bool]:
        """Detect Python/TypeScript project structure"""
        return {
            "python": any([
                (self.repo_path / "setup.py").exists(),
                (self.repo_path / "pyproject.toml").exists(),
                (self.repo_path / "requirements.txt").exists(),
                len(list(self.repo_path.rglob("*.py"))) > 0
            ]),
            "typescript": any([
                (self.repo_path / "package.json").exists(),
                (self.repo_path / "tsconfig.json").exists(),
                len(list(self.repo_path.rglob("*.ts"))) > 0
            ])
        }

    def analyze_python_structure(self) -> Dict[str, Any]:
        """Analyze Python project structure and gaps"""
        analysis = {
            "type": "python",
            "timestamp": datetime.now().isoformat(),
            "structure": {},
            "gaps": [],
            "dependencies": {},
            "test_coverage": {},
            "compliance_status": {}
        }

        # Check project structure
        structure_checks = {
            "setup.py or pyproject.toml": (self.repo_path / "setup.py").exists() or
                                          (self.repo_path / "pyproject.toml").exists(),
            "tests directory": (self.repo_path / "tests").exists(),
            "src or package directory": (self.repo_path / "src").exists() or any(
                (self.repo_path / name).is_dir() and not name.startswith((".", "_"))
                for name in os.listdir(self.repo_path)
            ),
            "README.md": (self.repo_path / "README.md").exists(),
            "requirements.txt": (self.repo_path / "requirements.txt").exists(),
            "type hints": len(list(self.repo_path.rglob("*.pyi"))) > 0,
            "CI/CD config": any([
                (self.repo_path / ".github" / "workflows").exists(),
                (self.repo_path / ".gitlab-ci.yml").exists()
            ])
        }

        analysis["structure"] = structure_checks
        analysis["gaps"] = [name for name, exists in structure_checks.items() if not exists]

        # Analyze dependencies
        if (self.repo_path / "requirements.txt").exists():
            with open(self.repo_path / "requirements.txt") as f:
                deps = [line.strip() for line in f if line.strip() and not line.startswith("#")]
                analysis["dependencies"]["count"] = len(deps)
                analysis["dependencies"]["list"] = deps

        # Check for test framework
        test_frameworks = {
            "pytest": self._check_import("pytest"),
            "unittest": self._check_import("unittest"),
            "coverage": self._check_import("coverage")
        }
        analysis["test_coverage"]["frameworks"] = test_frameworks

        # Compliance checks
        analysis["compliance_status"] = self._check_python_compliance()

        return analysis

    def analyze_typescript_structure(self) -> Dict[str, Any]:
        """Analyze TypeScript project structure and gaps"""
        analysis = {
            "type": "typescript",
            "timestamp": datetime.now().isoformat(),
            "structure": {},
            "gaps": [],
            "dependencies": {},
            "test_coverage": {},
            "compliance_status": {}
        }

        # Check project structure
        structure_checks = {
            "package.json": (self.repo_path / "package.json").exists(),
            "tsconfig.json": (self.repo_path / "tsconfig.json").exists(),
            "src directory": (self.repo_path / "src").exists(),
            "tests directory": any([
                (self.repo_path / "tests").exists(),
                (self.repo_path / "test").exists(),
                (self.repo_path / "__tests__").exists()
            ]),
            "README.md": (self.repo_path / "README.md").exists(),
            "eslint config": any([
                (self.repo_path / ".eslintrc.js").exists(),
                (self.repo_path / ".eslintrc.json").exists(),
                (self.repo_path / "eslint.config.js").exists()
            ]),
            "prettier config": any([
                (self.repo_path / ".prettierrc").exists(),
                (self.repo_path / "prettier.config.js").exists()
            ]),
            "CI/CD config": any([
                (self.repo_path / ".github" / "workflows").exists(),
                (self.repo_path / ".gitlab-ci.yml").exists()
            ])
        }

        analysis["structure"] = structure_checks
        analysis["gaps"] = [name for name, exists in structure_checks.items() if not exists]

        # Analyze package.json
        if (self.repo_path / "package.json").exists():
            with open(self.repo_path / "package.json") as f:
                package_data = json.load(f)
                analysis["dependencies"]["production"] = len(package_data.get("dependencies", {}))
                analysis["dependencies"]["dev"] = len(package_data.get("devDependencies", {}))
                analysis["dependencies"]["scripts"] = package_data.get("scripts", {})

        # Check for test framework
        test_frameworks = {
            "jest": self._check_package("jest"),
            "vitest": self._check_package("vitest"),
            "mocha": self._check_package("mocha")
        }
        analysis["test_coverage"]["frameworks"] = test_frameworks

        # Compliance checks
        analysis["compliance_status"] = self._check_typescript_compliance()

        return analysis

    def _check_import(self, package: str) -> bool:
        """Check if Python package is importable"""
        try:
            __import__(package)
            return True
        except ImportError:
            return False

    def _check_package(self, package: str) -> bool:
        """Check if npm package exists in package.json"""
        package_json = self.repo_path / "package.json"
        if not package_json.exists():
            return False

        with open(package_json) as f:
            data = json.load(f)
            return package in data.get("dependencies", {}) or \
                   package in data.get("devDependencies", {})

    def _check_python_compliance(self) -> Dict[str, Any]:
        """Check Python-specific compliance requirements"""
        return {
            "security": {
                "bandit_scan": (self.repo_path / ".bandit").exists(),
                "safety_check": self._check_import("safety"),
                "secrets_detection": any([
                    (self.repo_path / ".gitleaks.toml").exists(),
                    (self.repo_path / ".secrets.baseline").exists()
                ])
            },
            "code_quality": {
                "black_formatter": self._check_import("black"),
                "mypy_type_check": (self.repo_path / "mypy.ini").exists() or
                                   (self.repo_path / ".mypy.ini").exists(),
                "pylint": self._check_import("pylint"),
                "ruff": self._check_import("ruff")
            },
            "documentation": {
                "docstrings": True,  # Would need AST parsing
                "sphinx_docs": (self.repo_path / "docs").exists()
            }
        }

    def _check_typescript_compliance(self) -> Dict[str, Any]:
        """Check TypeScript-specific compliance requirements"""
        return {
            "security": {
                "npm_audit": True,  # Built into npm
                "snyk": self._check_package("snyk"),
                "secrets_detection": any([
                    (self.repo_path / ".gitleaks.toml").exists(),
                    (self.repo_path / ".secrets.baseline").exists()
                ])
            },
            "code_quality": {
                "eslint": self._check_package("eslint"),
                "prettier": self._check_package("prettier"),
                "typescript_strict": self._check_tsconfig_strict(),
                "husky_hooks": (self.repo_path / ".husky").exists()
            },
            "documentation": {
                "jsdoc": True,  # Would need AST parsing
                "typedoc": self._check_package("typedoc")
            }
        }

    def _check_tsconfig_strict(self) -> bool:
        """Check if TypeScript strict mode is enabled"""
        tsconfig = self.repo_path / "tsconfig.json"
        if not tsconfig.exists():
            return False

        with open(tsconfig) as f:
            config = json.load(f)
            return config.get("compilerOptions", {}).get("strict", False)

    def generate_workstreams(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Generate workstream configuration based on analysis"""

        project_type = analysis["type"]
        gaps = analysis["gaps"]

        # Base workstreams structure
        workstreams = {
            "orchestration": {
                "strategy": "parallel-bounded",
                "max_concurrent": 6,
                "coordination": "event-driven",
                "project_type": project_type
            },
            "workstreams": {}
        }

        # Foundation workstream
        foundation_tasks = []
        if "setup.py or pyproject.toml" in gaps and project_type == "python":
            foundation_tasks.append("create-pyproject-toml")
        if "package.json" in gaps and project_type == "typescript":
            foundation_tasks.append("initialize-package-json")
        if "CI/CD config" in gaps:
            foundation_tasks.append("setup-github-actions")
        foundation_tasks.extend([
            "update-dependencies-secure",
            "implement-feature-flags",
            "setup-monitoring"
        ])

        workstreams["workstreams"]["foundation"] = {
            "priority": "critical",
            "blockers": [],
            "tasks": foundation_tasks,
            "agent": "specialist-infra"
        }

        # Architecture workstream
        arch_tasks = [
            "refactor-module-boundaries",
            "implement-clean-interfaces",
            "add-telemetry-hooks"
        ]
        if project_type == "python":
            arch_tasks.append("add-type-hints")
        if project_type == "typescript":
            arch_tasks.append("enable-strict-mode")

        workstreams["workstreams"]["architecture"] = {
            "priority": "critical",
            "blockers": ["foundation"],
            "tasks": arch_tasks,
            "agent": "specialist-architecture"
        }

        # Security workstream
        workstreams["workstreams"]["security"] = {
            "priority": "critical",
            "blockers": [],
            "parallel_with": ["foundation", "architecture"],
            "tasks": [
                "implement-rbac",
                "add-encryption-layer",
                "setup-audit-logging",
                "vulnerability-remediation",
                "compliance-certification-prep",
                f"setup-{project_type}-security-scanning"
            ],
            "agent": "specialist-security",
            "compliance_frameworks": [
                "NIST-800-53",
                "SOC2-TypeII",
                "GDPR",
                "ISO27001",
                "FedRAMP-Moderate",
                "CMMC-Level2"
            ]
        }

        # Quality workstream
        quality_tasks = [
            "increase-coverage-to-80",
            "add-integration-tests",
            "setup-performance-baselines",
            "implement-contract-tests"
        ]
        if "tests directory" in gaps:
            quality_tasks.insert(0, "create-test-structure")

        workstreams["workstreams"]["quality"] = {
            "priority": "high",
            "blockers": ["architecture"],
            "tasks": quality_tasks,
            "agent": "specialist-qa"
        }

        # DevX workstream
        devx_tasks = [
            "write-getting-started-guide",
            "create-example-apps",
            "improve-error-messages",
            "build-debugging-tools"
        ]
        if "README.md" in gaps:
            devx_tasks.insert(0, "create-readme")

        workstreams["workstreams"]["devx"] = {
            "priority": "medium",
            "blockers": ["architecture"],
            "tasks": devx_tasks,
            "agent": "specialist-devx"
        }

        # Enterprise workstream
        workstreams["workstreams"]["enterprise"] = {
            "priority": "high",
            "blockers": ["security", "quality"],
            "tasks": [
                "implement-multi-tenancy",
                "add-usage-analytics",
                "create-deployment-templates",
                "write-runbooks",
                "basis-integration-prep"
            ],
            "agent": "specialist-enterprise"
        }

        return workstreams

    def generate_quality_gates(self, project_type: str) -> Dict[str, Any]:
        """Generate quality gates configuration"""

        base_gates = {
            "commit": {
                "name": "Code Quality",
                "checks": ["linter_pass", "type_check_pass", "security_scan_pass"],
                "auto_fix": True
            },
            "pull_request": {
                "name": "Integration Readiness",
                "checks": [
                    "tests_pass",
                    {"coverage_threshold": 75},
                    "no_critical_vulnerabilities",
                    "documentation_updated"
                ],
                "block_merge": True
            },
            "deployment": {
                "name": "Compliance Validation",
                "checks": [
                    "nist_controls_verified",
                    "gdpr_data_flow_mapped",
                    "encryption_enabled",
                    "audit_logging_active"
                ],
                "manual_override": "security_lead_only"
            }
        }

        # Add language-specific checks
        if project_type == "python":
            base_gates["commit"]["checks"].extend([
                "black_formatted",
                "mypy_type_check",
                "bandit_security_scan"
            ])
        elif project_type == "typescript":
            base_gates["commit"]["checks"].extend([
                "prettier_formatted",
                "eslint_pass",
                "tsc_no_errors"
            ])

        return {"gates": base_gates}

    def generate_governance_matrix(self) -> Dict[str, Any]:
        """Generate compliance governance matrix"""
        return {
            "governance": {
                "frameworks": {
                    "nist_800_53": {
                        "version": "rev5",
                        "controls_mapping": "./compliance/nist/controls.yaml",
                        "evidence_collection": "automated",
                        "audit_trail": "required"
                    },
                    "soc2_type2": {
                        "trust_principles": ["security", "availability", "confidentiality"],
                        "evidence_retention": "12_months",
                        "continuous_monitoring": "enabled"
                    },
                    "gdpr": {
                        "data_classification": "required",
                        "privacy_by_design": "enforced",
                        "breach_notification": "automated",
                        "dpo_contact": "./compliance/gdpr/dpo.yaml"
                    },
                    "iso27001": {
                        "isms_integration": True,
                        "risk_assessment": "quarterly",
                        "incident_response": "./compliance/iso/ir-plan.yaml"
                    },
                    "fedramp": {
                        "impact_level": "moderate",
                        "continuous_monitoring": "fisma",
                        "authorization_boundary": "./compliance/fedramp/boundary.yaml"
                    },
                    "cmmc": {
                        "level": 2,
                        "practice_domains": "all",
                        "assessment_scope": "./compliance/cmmc/scope.yaml"
                    }
                },
                "cross_cutting": {
                    "evidence_automation": [
                        "audit_logs",
                        "access_reviews",
                        "vulnerability_scans",
                        "penetration_tests",
                        "code_reviews"
                    ],
                    "policy_enforcement": [
                        "pre_commit_hooks",
                        "ci_cd_gates",
                        "runtime_validation",
                        "deployment_checks"
                    ]
                }
            }
        }

    def generate_basis_integration(self) -> Dict[str, Any]:
        """Generate BASIS integration requirements"""
        return {
            "basis_integration": {
                "authentication": {
                    "method": "quantum_credential_vault",
                    "mfa": "required",
                    "session_lifetime": "4_hours"
                },
                "authorization": {
                    "model": "zero_trust_rbac",
                    "policy_engine": "basis_trust_engine",
                    "behavioral_verification": "enabled"
                },
                "audit": {
                    "destination": "basis_immutable_ledger",
                    "retention": "7_years",
                    "compliance_export": "automated"
                },
                "agent_coordination": {
                    "trust_verification": "basis_fingerprint",
                    "inter_agent_auth": "quantum_certificates",
                    "coordination_layer": "basis_mesh"
                }
            }
        }

    def run_analysis(self) -> None:
        """Main analysis workflow"""
        print("🔍 VorionSDK Deep Analysis - Starting...")
        print("=" * 60)

        # Detect project type
        print("\n📦 Detecting project type...")
        project_types = self.detect_project_type()

        if not any(project_types.values()):
            print("❌ No Python or TypeScript project detected!")
            sys.exit(1)

        # Prioritize TypeScript if both exist (main project is TS, Python is helper scripts)
        ts_files = len(list(self.repo_path.rglob("*.ts")))
        py_files = len(list(self.repo_path.rglob("*.py")))

        if project_types["typescript"] and project_types["python"]:
            # Choose based on file count
            active_type = "typescript" if ts_files > py_files else "python"
            print(f"   (Found {ts_files} .ts files, {py_files} .py files)")
        else:
            active_type = "typescript" if project_types["typescript"] else "python"
        print(f"✅ Detected: {active_type.upper()} project")

        # Run appropriate analysis
        print(f"\n🔬 Analyzing {active_type} structure...")
        if active_type == "python":
            analysis = self.analyze_python_structure()
        else:
            analysis = self.analyze_typescript_structure()

        # Save analysis
        analysis_file = self.analysis_dir / "gap-assessment.json"
        with open(analysis_file, "w") as f:
            json.dump(analysis, f, indent=2)
        print(f"✅ Gap assessment saved: {analysis_file}")

        # Generate workstreams
        print("\n⚙️  Generating workstream configuration...")
        workstreams = self.generate_workstreams(analysis)
        workstreams_file = self.config_dir / "workstreams.yaml"

        # Convert to YAML manually (avoiding pyyaml dependency)
        with open(workstreams_file, "w") as f:
            self._write_yaml(workstreams, f)
        print(f"✅ Workstreams configured: {workstreams_file}")

        # Generate quality gates
        print("\n🚦 Generating quality gates...")
        gates = self.generate_quality_gates(active_type)
        gates_file = self.config_dir / "quality-gates.yaml"
        with open(gates_file, "w") as f:
            self._write_yaml(gates, f)
        print(f"✅ Quality gates configured: {gates_file}")

        # Generate governance matrix
        print("\n📋 Generating compliance governance...")
        governance = self.generate_governance_matrix()
        gov_file = self.compliance_dir / "governance-matrix.yaml"
        with open(gov_file, "w") as f:
            self._write_yaml(governance, f)
        print(f"✅ Governance matrix created: {gov_file}")

        # Generate BASIS integration
        print("\n🔐 Generating BASIS integration config...")
        basis = self.generate_basis_integration()
        basis_file = self.config_dir / "basis-requirements.yaml"
        with open(basis_file, "w") as f:
            self._write_yaml(basis, f)
        print(f"✅ BASIS integration configured: {basis_file}")

        # Summary
        print("\n" + "=" * 60)
        print("✨ Analysis Complete!")
        print("=" * 60)
        print(f"\n📊 Found {len(analysis['gaps'])} gaps to address")
        print(f"🎯 Generated {len(workstreams['workstreams'])} workstreams")
        print(f"🔧 Project type: {active_type}")
        print("\n📁 Output files:")
        print(f"   • {analysis_file}")
        print(f"   • {workstreams_file}")
        print(f"   • {gates_file}")
        print(f"   • {gov_file}")
        print(f"   • {basis_file}")
        print("\n✅ Ready for Terminal 2 execution")
        print("   Run: ./scripts/run-terminal-2.sh")

    def _write_yaml(self, data: Any, file, indent: int = 0) -> None:
        """Simple YAML writer (avoids pyyaml dependency)"""
        spacing = "  " * indent

        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, (dict, list)):
                    file.write(f"{spacing}{key}:\n")
                    self._write_yaml(value, file, indent + 1)
                else:
                    file.write(f"{spacing}{key}: {json.dumps(value)}\n")
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, (dict, list)):
                    file.write(f"{spacing}-\n")
                    self._write_yaml(item, file, indent + 1)
                else:
                    file.write(f"{spacing}- {json.dumps(item)}\n")

if __name__ == "__main__":
    analyzer = VorionAnalyzer()
    analyzer.run_analysis()
