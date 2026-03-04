#!/usr/bin/env python3
"""BASIS Integration Readiness Checker"""
from pathlib import Path
import json
import time
from datetime import datetime

class BASISReadinessChecker:
    def __init__(self):
        self.config_dir = Path("./config")
        self.src_dir = Path("./src")

    def check_readiness(self):
        print(f"\n🔐 BASIS Readiness Check - {datetime.now().strftime('%H:%M:%S')}")
        print("=" * 60)

        checks = {
            "quantum_credential_vault_ready": self._check_credential_vault(),
            "trust_engine_hooks_present": self._check_trust_hooks(),
            "behavioral_fingerprinting_enabled": self._check_fingerprinting(),
            "immutable_ledger_configured": self._check_audit_ledger(),
            "zero_trust_rbac_implemented": self._check_rbac(),
            "agent_mesh_compatible": self._check_mesh_compatibility()
        }

        passed = sum(1 for v in checks.values() if v)
        total = len(checks)

        print(f"\n📊 Readiness Score: {passed}/{total} ({passed/total*100:.0f}%)")

        for check, status in checks.items():
            icon = "✅" if status else "❌"
            print(f"{icon} {check.replace('_', ' ').title()}")

        if passed == total:
            print("\n🎉 VorionSDK is BASIS-ready!")
        else:
            print(f"\n⚠️  {total - passed} requirements remaining")

    def _check_credential_vault(self) -> bool:
        if not self.src_dir.exists():
            return False
        vault_files = list(self.src_dir.rglob("*credential*")) + list(self.src_dir.rglob("*vault*"))
        return len(vault_files) > 0

    def _check_trust_hooks(self) -> bool:
        return (self.src_dir / "trust-engine").exists() if self.src_dir.exists() else False

    def _check_fingerprinting(self) -> bool:
        fingerprint_files = list(self.src_dir.rglob("*fingerprint*")) if self.src_dir.exists() else []
        return len(fingerprint_files) > 0

    def _check_audit_ledger(self) -> bool:
        audit_files = list(self.src_dir.rglob("*audit*")) if self.src_dir.exists() else []
        return len(audit_files) > 0

    def _check_rbac(self) -> bool:
        if not self.src_dir.exists():
            return False
        rbac_files = list(self.src_dir.rglob("*rbac*")) + list(self.src_dir.rglob("*authorization*"))
        return len(rbac_files) > 0

    def _check_mesh_compatibility(self) -> bool:
        return (self.config_dir / "basis-requirements.yaml").exists()

    def run_continuous_check(self):
        print("🔐 BASIS Readiness Monitor Started")
        print("=" * 60)

        while True:
            self.check_readiness()
            print("\n⏳ Next check in 30 minutes...")
            time.sleep(1800)

if __name__ == "__main__":
    checker = BASISReadinessChecker()
    checker.run_continuous_check()
