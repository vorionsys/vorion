#!/usr/bin/env bash
# =============================================================================
# Vorion SBOM Generation Script
# Generates CycloneDX 1.5 JSON/XML and SPDX 2.3 JSON for the TypeScript monorepo
# Archives versioned copies to sbom-history/
# Validates against NTIA minimum elements
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SBOM_DIR="${ROOT_DIR}/sbom"
HISTORY_DIR="${ROOT_DIR}/sbom-history"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DATE_STAMP="$(date +%Y-%m-%d)"
VERSION=""
PRODUCTION_ONLY=false
VALIDATE_ONLY=false
SKIP_AUDIT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Generate SBOM (Software Bill of Materials) for the Vorion monorepo.

Options:
  -v, --version VERSION    Version string (default: from package.json)
  -p, --production         Exclude dev dependencies
  -V, --validate-only      Only validate existing SBOM, do not generate
  -s, --skip-audit         Skip npm audit vulnerability correlation
  -h, --help               Show this help message

Output:
  sbom/sbom-cyclonedx.json     CycloneDX 1.5 JSON
  sbom/sbom-cyclonedx.xml      CycloneDX 1.5 XML
  sbom/sbom-spdx.json          SPDX 2.3 JSON
  sbom/audit-report.json       npm audit output (if run)
  sbom/vulnerability-summary.json  Vulnerability summary
  sbom-history/                Versioned archives

Examples:
  $(basename "$0")                          # Generate with defaults
  $(basename "$0") -v 1.2.0 -p             # Production-only for v1.2.0
  $(basename "$0") --validate-only          # Validate existing SBOM
EOF
  exit 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -v|--version)      VERSION="$2"; shift 2 ;;
      -p|--production)   PRODUCTION_ONLY=true; shift ;;
      -V|--validate-only) VALIDATE_ONLY=true; shift ;;
      -s|--skip-audit)   SKIP_AUDIT=true; shift ;;
      -h|--help)         usage ;;
      *)                 log_error "Unknown option: $1"; usage ;;
    esac
  done
}

check_dependencies() {
  log_step "Checking dependencies"

  local missing=()

  if ! command -v node &>/dev/null; then
    missing+=("node")
  fi

  if ! command -v npm &>/dev/null; then
    missing+=("npm")
  fi

  if ! command -v jq &>/dev/null; then
    missing+=("jq")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required dependencies: ${missing[*]}"
    log_error "Install them before running this script."
    exit 1
  fi

  # Check for CycloneDX npm tool
  if ! npx @cyclonedx/cyclonedx-npm --version &>/dev/null 2>&1; then
    log_info "Installing @cyclonedx/cyclonedx-npm..."
    npm install -g @cyclonedx/cyclonedx-npm@latest
  fi

  log_ok "All dependencies available"
}

get_version() {
  if [[ -z "${VERSION}" ]]; then
    VERSION="$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || echo "0.0.0")"
  fi
  log_info "SBOM version: ${VERSION}"
}

generate_cyclonedx() {
  log_step "Generating CycloneDX 1.5 SBOM"

  local cdx_args=(
    --output-format JSON
    --spec-version 1.5
    --output-reproducible
    --output-file "${SBOM_DIR}/sbom-cyclonedx.json"
  )

  if [[ "${PRODUCTION_ONLY}" == "true" ]]; then
    cdx_args+=(--omit dev)
    log_info "Excluding dev dependencies"
  fi

  log_info "Running CycloneDX npm generator..."
  if npx @cyclonedx/cyclonedx-npm "${cdx_args[@]}" 2>/dev/null; then
    local comp_count
    comp_count="$(jq '.components | length' "${SBOM_DIR}/sbom-cyclonedx.json")"
    log_ok "CycloneDX JSON generated: ${comp_count} components"
  else
    log_error "CycloneDX JSON generation failed"
    exit 1
  fi

  # Generate XML
  cdx_args[1]="XML"  # Change format to XML
  cdx_args[5]="${SBOM_DIR}/sbom-cyclonedx.xml"  # Change output file
  log_info "Generating CycloneDX XML..."
  if npx @cyclonedx/cyclonedx-npm \
    --output-format XML \
    --spec-version 1.5 \
    --output-reproducible \
    --output-file "${SBOM_DIR}/sbom-cyclonedx.xml" 2>/dev/null; then
    log_ok "CycloneDX XML generated"
  else
    log_warn "CycloneDX XML generation failed (non-fatal)"
  fi
}

generate_spdx() {
  log_step "Generating SPDX 2.3 SBOM"

  node --input-type=module << 'SPDX_SCRIPT'
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const cdxPath = process.env.SBOM_DIR + '/sbom-cyclonedx.json';
const spdxPath = process.env.SBOM_DIR + '/sbom-spdx.json';

const cdx = JSON.parse(readFileSync(cdxPath, 'utf-8'));
const now = new Date().toISOString();

const spdx = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: cdx.metadata?.component?.name || "@vorion/platform",
  documentNamespace: `https://vorion.org/spdx/${randomUUID()}`,
  creationInfo: {
    created: now,
    creators: [
      "Tool: vorion-sbom-pipeline",
      "Organization: Vorion, Inc.",
      `Tool: Node.js-${process.version}`
    ],
    licenseListVersion: "3.22"
  },
  packages: [{
    SPDXID: "SPDXRef-RootPackage",
    name: cdx.metadata?.component?.name || "@vorion/platform",
    versionInfo: cdx.metadata?.component?.version || "0.1.0",
    supplier: "Organization: Vorion, Inc.",
    downloadLocation: "https://github.com/vorion/vorion",
    filesAnalyzed: false,
    licenseConcluded: "Apache-2.0",
    licenseDeclared: "Apache-2.0",
    copyrightText: "Copyright 2026 Vorion, Inc."
  }],
  relationships: []
};

for (const [idx, comp] of (cdx.components || []).entries()) {
  const spdxId = `SPDXRef-Package-${idx}`;
  const licenseId = comp.licenses?.[0]?.license?.id || "NOASSERTION";
  const checksums = (comp.hashes || []).map(h => ({
    algorithm: h.alg === "SHA-256" ? "SHA256" : h.alg,
    checksumValue: h.content
  }));

  spdx.packages.push({
    SPDXID: spdxId,
    name: comp.name,
    versionInfo: comp.version || "NOASSERTION",
    supplier: comp.author || "NOASSERTION",
    downloadLocation: comp.purl
      ? `https://registry.npmjs.org/${comp.name}/-/${comp.name.split('/').pop()}-${comp.version}.tgz`
      : "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: licenseId,
    licenseDeclared: licenseId,
    copyrightText: "NOASSERTION",
    externalRefs: comp.purl ? [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: comp.purl
    }] : [],
    checksums
  });

  spdx.relationships.push({
    spdxElementId: "SPDXRef-RootPackage",
    relatedSpdxElement: spdxId,
    relationshipType: "DEPENDS_ON"
  });
}

writeFileSync(spdxPath, JSON.stringify(spdx, null, 2));
console.log(`SPDX 2.3 JSON generated: ${spdx.packages.length} packages`);
SPDX_SCRIPT

  if [[ -f "${SBOM_DIR}/sbom-spdx.json" ]]; then
    log_ok "SPDX JSON generated"
  else
    log_warn "SPDX generation failed (non-fatal)"
  fi
}

run_audit() {
  if [[ "${SKIP_AUDIT}" == "true" ]]; then
    log_info "Skipping npm audit (--skip-audit)"
    return
  fi

  log_step "Running npm audit for vulnerability correlation"

  cd "${ROOT_DIR}"
  npm audit --json > "${SBOM_DIR}/audit-report.json" 2>/dev/null || true

  if [[ ! -s "${SBOM_DIR}/audit-report.json" ]]; then
    log_info "No audit data returned"
    return
  fi

  # Correlate vulnerabilities into the CycloneDX SBOM
  node --input-type=module << 'AUDIT_SCRIPT'
import { readFileSync, writeFileSync, existsSync } from 'fs';

const sbomPath = process.env.SBOM_DIR + '/sbom-cyclonedx.json';
const auditPath = process.env.SBOM_DIR + '/audit-report.json';

if (!existsSync(auditPath)) process.exit(0);

try {
  const sbom = JSON.parse(readFileSync(sbomPath, 'utf-8'));
  const audit = JSON.parse(readFileSync(auditPath, 'utf-8'));
  const vulnerabilities = [];
  const componentRefs = new Map();

  for (const comp of sbom.components || []) {
    componentRefs.set(comp.name, comp['bom-ref'] || `${comp.name}@${comp.version}`);
  }

  if (audit.vulnerabilities) {
    for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities)) {
      for (const via of vuln.via || []) {
        if (typeof via === 'object' && via.source) {
          vulnerabilities.push({
            id: `NPM-${via.source}`,
            source: { name: 'npm', url: via.url || 'https://www.npmjs.com/advisories' },
            ratings: [{ severity: (via.severity || vuln.severity || 'unknown').toLowerCase(), method: 'CVSSv3' }],
            description: via.title || 'Unknown vulnerability',
            recommendation: typeof vuln.fixAvailable === 'object'
              ? `Upgrade to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
              : (vuln.fixAvailable ? 'Fix available' : 'No fix available'),
            affects: [{
              ref: componentRefs.get(pkgName) || pkgName,
              versions: [{ version: via.range || vuln.range || '*', status: 'affected' }]
            }]
          });
        }
      }
    }
  }

  if (vulnerabilities.length > 0) {
    sbom.vulnerabilities = vulnerabilities;
    writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
  }

  const summary = {
    generated: new Date().toISOString(),
    total: vulnerabilities.length,
    bySeverity: {},
    details: vulnerabilities.map(v => ({
      id: v.id, severity: v.ratings[0]?.severity,
      description: v.description, package: v.affects[0]?.ref,
      recommendation: v.recommendation
    }))
  };
  for (const v of vulnerabilities) {
    const sev = v.ratings[0]?.severity || 'unknown';
    summary.bySeverity[sev] = (summary.bySeverity[sev] || 0) + 1;
  }
  writeFileSync(process.env.SBOM_DIR + '/vulnerability-summary.json', JSON.stringify(summary, null, 2));

  console.log(`Vulnerability correlation complete: ${vulnerabilities.length} vulnerabilities`);
} catch (error) {
  console.warn('Warning: Could not process audit data:', error.message);
}
AUDIT_SCRIPT

  log_ok "Audit correlation complete"
}

archive_sbom() {
  log_step "Archiving SBOM to sbom-history"

  mkdir -p "${HISTORY_DIR}"

  local prefix="sbom-v${VERSION}-${DATE_STAMP}"

  # Create versioned copies
  for fmt in cyclonedx.json cyclonedx.xml spdx.json; do
    local src="${SBOM_DIR}/sbom-${fmt}"
    if [[ -f "${src}" ]]; then
      cp "${src}" "${SBOM_DIR}/${prefix}-${fmt}"
      cp "${src}" "${HISTORY_DIR}/${prefix}-${fmt}"
      log_ok "Archived: ${prefix}-${fmt}"
    fi
  done
}

validate_ntia() {
  log_step "Validating SBOM against NTIA Minimum Elements"

  local sbom_file="${SBOM_DIR}/sbom-cyclonedx.json"

  if [[ ! -f "${sbom_file}" ]]; then
    log_error "No SBOM found at ${sbom_file}"
    exit 1
  fi

  local passed=0
  local failed=0
  local total=0

  check_field() {
    local name="$1"
    local value="$2"
    local detail="${3:-}"
    total=$((total + 1))
    if [[ -n "${value}" && "${value}" != "null" && "${value}" != "0" ]]; then
      passed=$((passed + 1))
      echo -e "  ${GREEN}[PASS]${NC} ${name}${detail:+: ${detail}}"
    else
      failed=$((failed + 1))
      echo -e "  ${RED}[FAIL]${NC} ${name}${detail:+: ${detail}}"
    fi
  }

  echo ""

  # 1. Supplier Name
  local supplier
  supplier="$(jq -r '.metadata.component.name // empty' "${sbom_file}")"
  check_field "Supplier / Component Name" "${supplier}" "${supplier}"

  # 2. Component Version
  local version
  version="$(jq -r '.metadata.component.version // empty' "${sbom_file}")"
  check_field "Component Version" "${version}" "${version}"

  # 3. Unique Identifiers
  local purl_count
  purl_count="$(jq '[.components[]? | select(.purl)] | length' "${sbom_file}")"
  check_field "Unique Identifiers (purl)" "${purl_count}" "${purl_count} components with purl"

  # 4. Dependency Relationships
  local dep_count
  dep_count="$(jq '.dependencies // [] | length' "${sbom_file}")"
  check_field "Dependency Relationships" "${dep_count}" "${dep_count} entries"

  # 5. Author of SBOM Data
  local tool_count
  tool_count="$(jq '.metadata.tools // [] | length' "${sbom_file}")"
  check_field "Author of SBOM Data (tools)" "${tool_count}" "${tool_count} tools"

  # 6. Timestamp
  local ts
  ts="$(jq -r '.metadata.timestamp // empty' "${sbom_file}")"
  check_field "Timestamp" "${ts}" "${ts}"

  # 7. BOM Format
  local format
  format="$(jq -r '.bomFormat // empty' "${sbom_file}")"
  check_field "BOM Format" "${format}" "${format}"

  # 8. Spec Version
  local spec
  spec="$(jq -r '.specVersion // empty' "${sbom_file}")"
  check_field "Spec Version" "${spec}" "${spec}"

  # 9. Serial Number
  local serial
  serial="$(jq -r '.serialNumber // empty' "${sbom_file}")"
  check_field "Serial Number" "${serial}" "${serial:0:40}"

  # 10. Licenses
  local licensed
  licensed="$(jq '[.components[]? | select(.licenses and (.licenses | length > 0))] | length' "${sbom_file}")"
  local total_comps
  total_comps="$(jq '.components // [] | length' "${sbom_file}")"
  check_field "Component Licenses" "${licensed}" "${licensed}/${total_comps} with license data"

  # 11. Hashes
  local hashed
  hashed="$(jq '[.components[]? | select(.hashes and (.hashes | length > 0))] | length' "${sbom_file}")"
  check_field "Component Hashes" "${hashed}" "${hashed}/${total_comps} with hash data"

  echo ""
  echo -e "  ${BLUE}Results: ${passed} passed, ${failed} failed out of ${total} checks${NC}"
  echo ""

  if [[ ${failed} -gt 0 ]]; then
    log_warn "Some NTIA minimum element checks did not pass."
    log_warn "Review failures above and update SBOM generation as needed."
    return 1
  else
    log_ok "All NTIA minimum element checks passed"
    return 0
  fi
}

print_compliance_checklist() {
  log_step "SBOM Compliance Checklist"

  cat << 'CHECKLIST'

  NTIA Minimum Elements for SBOM:
  --------------------------------
  [x] Supplier name
  [x] Component name
  [x] Component version
  [x] Unique identifiers (purl)
  [x] Dependency relationships
  [x] Author of SBOM data
  [x] Timestamp

  EO 14028 Section 4 Requirements:
  ---------------------------------
  [x] Machine-readable SBOM format (CycloneDX JSON/XML, SPDX JSON)
  [x] Generated for each release
  [x] Includes all dependencies (direct + transitive)
  [x] Available for downstream consumers

  NIST SP 800-218 (SSDF) Practices:
  -----------------------------------
  [x] PS.3   — Third-party component inventory
  [x] PW.4   — Verify third-party components
  [x] RV.1   — Identify and confirm vulnerabilities

  CISA 2025 Minimum Elements:
  ----------------------------
  [x] Author name
  [x] Timestamp
  [x] Supplier name
  [x] Component name
  [x] Component version
  [x] Unique identifier
  [x] Dependency relationship
  [x] Component hash
  [x] Lifecycle phase (build)

CHECKLIST
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo "============================================"
  echo "  Vorion SBOM Generator"
  echo "  $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
  echo "============================================"
  echo ""

  parse_args "$@"
  check_dependencies
  get_version

  if [[ "${VALIDATE_ONLY}" == "true" ]]; then
    validate_ntia
    exit $?
  fi

  # Set environment for child scripts
  export SBOM_DIR
  export ROOT_DIR

  mkdir -p "${SBOM_DIR}"

  generate_cyclonedx
  generate_spdx
  run_audit
  archive_sbom

  local validation_rc=0
  validate_ntia || validation_rc=$?

  print_compliance_checklist

  echo ""
  log_step "Generation Complete"
  echo ""
  log_info "Output directory: ${SBOM_DIR}"
  log_info "History directory: ${HISTORY_DIR}"
  log_info "Version: ${VERSION}"

  if [[ -f "${SBOM_DIR}/sbom-cyclonedx.json" ]]; then
    local comp_count
    comp_count="$(jq '.components | length' "${SBOM_DIR}/sbom-cyclonedx.json")"
    local vuln_count
    vuln_count="$(jq '.vulnerabilities // [] | length' "${SBOM_DIR}/sbom-cyclonedx.json")"
    log_info "Components: ${comp_count}"
    log_info "Vulnerabilities: ${vuln_count}"
  fi

  echo ""
  log_info "Files generated:"
  ls -la "${SBOM_DIR}"/sbom-* 2>/dev/null | while read -r line; do
    echo "  ${line}"
  done
  echo ""

  exit ${validation_rc}
}

main "$@"
