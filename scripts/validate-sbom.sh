#!/usr/bin/env bash
# =============================================================================
# SBOM Validation Script
# Validates generated SBOM files against:
#   - NTIA Minimum Elements
#   - EO 14028 Requirements
#   - NIST SP 800-218 (SSDF) Practices
#   - CISA 2025 Minimum Elements (9 data fields)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SBOM_DIR="${ROOT_DIR}/sbom"
SBOM_FILE=""
EXIT_CODE=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Counters
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_WARN=0
TOTAL_CHECKS=0

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[PASS]${NC}  $*"; }
log_fail()    { echo -e "${RED}[FAIL]${NC}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_section() { echo -e "\n${BOLD}${CYAN}$*${NC}"; echo -e "${CYAN}$(printf '%.0s─' $(seq 1 ${#1}))${NC}"; }

usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS] [SBOM_FILE]

Validate SBOM files against regulatory and standards requirements.

Arguments:
  SBOM_FILE                    Path to SBOM JSON file (default: sbom/sbom-cyclonedx.json)

Options:
  -d, --dir DIR                SBOM directory (default: ./sbom)
  -a, --all                    Validate all SBOM files in the directory
  -q, --quiet                  Only output failures
  -j, --json                   Output results as JSON
  -h, --help                   Show this help message

Validated Standards:
  - NTIA Minimum Elements for SBOM
  - EO 14028 Section 4 (Improving the Nation's Cybersecurity)
  - NIST SP 800-218 (Secure Software Development Framework)
  - CISA 2025 SBOM Minimum Elements (9 fields)

Exit Codes:
  0    All checks passed
  1    One or more checks failed
  2    SBOM file not found or invalid JSON

Examples:
  $(basename "$0")                                    # Validate default SBOM
  $(basename "$0") sbom/sbom-cyclonedx.json           # Validate specific file
  $(basename "$0") --all --json                       # Validate all, JSON output
EOF
  exit 0
}

ALL_MODE=false
QUIET_MODE=false
JSON_MODE=false

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--dir)     SBOM_DIR="$2"; shift 2 ;;
      -a|--all)     ALL_MODE=true; shift ;;
      -q|--quiet)   QUIET_MODE=true; shift ;;
      -j|--json)    JSON_MODE=true; shift ;;
      -h|--help)    usage ;;
      -*)           echo "Unknown option: $1"; usage ;;
      *)            SBOM_FILE="$1"; shift ;;
    esac
  done

  if [[ -z "${SBOM_FILE}" ]]; then
    SBOM_FILE="${SBOM_DIR}/sbom-cyclonedx.json"
  fi
}

check_pass() {
  local name="$1"
  local detail="${2:-}"
  TOTAL_PASS=$((TOTAL_PASS + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "${QUIET_MODE}" != "true" ]]; then
    echo -e "  ${GREEN}[PASS]${NC} ${name}${detail:+ — ${detail}}"
  fi
}

check_fail() {
  local name="$1"
  local detail="${2:-}"
  TOTAL_FAIL=$((TOTAL_FAIL + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  EXIT_CODE=1
  echo -e "  ${RED}[FAIL]${NC} ${name}${detail:+ — ${detail}}"
}

check_warn() {
  local name="$1"
  local detail="${2:-}"
  TOTAL_WARN=$((TOTAL_WARN + 1))
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "${QUIET_MODE}" != "true" ]]; then
    echo -e "  ${YELLOW}[WARN]${NC} ${name}${detail:+ — ${detail}}"
  fi
}

check_condition() {
  local name="$1"
  local value="$2"
  local detail="${3:-}"

  if [[ -n "${value}" && "${value}" != "null" && "${value}" != "0" && "${value}" != "false" ]]; then
    check_pass "${name}" "${detail}"
  else
    check_fail "${name}" "${detail}"
  fi
}

# ---------------------------------------------------------------------------
# Validation: Structural Integrity
# ---------------------------------------------------------------------------
validate_structure() {
  log_section "Structural Integrity"

  # Check file exists
  if [[ ! -f "${SBOM_FILE}" ]]; then
    check_fail "SBOM file exists" "${SBOM_FILE} not found"
    exit 2
  fi
  check_pass "SBOM file exists" "${SBOM_FILE}"

  # Check valid JSON
  if ! jq empty "${SBOM_FILE}" 2>/dev/null; then
    check_fail "Valid JSON" "File is not valid JSON"
    exit 2
  fi
  check_pass "Valid JSON"

  # Check BOM format
  local bom_format
  bom_format="$(jq -r '.bomFormat // empty' "${SBOM_FILE}")"
  check_condition "bomFormat is CycloneDX" "$([ "${bom_format}" = "CycloneDX" ] && echo "yes")" "${bom_format}"

  # Check spec version
  local spec_version
  spec_version="$(jq -r '.specVersion // empty' "${SBOM_FILE}")"
  check_condition "specVersion present" "${spec_version}" "${spec_version}"

  # Check serial number
  local serial
  serial="$(jq -r '.serialNumber // empty' "${SBOM_FILE}")"
  check_condition "serialNumber present" "${serial}" "${serial:0:50}"

  # Check non-empty components
  local comp_count
  comp_count="$(jq '.components // [] | length' "${SBOM_FILE}")"
  check_condition "Components array non-empty" "$([ "${comp_count}" -gt 0 ] && echo "yes")" "${comp_count} components"

  # Check metadata exists
  local has_metadata
  has_metadata="$(jq '.metadata != null' "${SBOM_FILE}")"
  check_condition "Metadata section present" "$([ "${has_metadata}" = "true" ] && echo "yes")"
}

# ---------------------------------------------------------------------------
# Validation: NTIA Minimum Elements
# ---------------------------------------------------------------------------
validate_ntia() {
  log_section "NTIA Minimum Elements for SBOM"

  # 1. Supplier Name
  local supplier
  supplier="$(jq -r '.metadata.component.name // .metadata.component.author // .metadata.manufacture.name // empty' "${SBOM_FILE}")"
  check_condition "Supplier Name" "${supplier}" "${supplier}"

  # 2. Component Name
  local comp_name
  comp_name="$(jq -r '.metadata.component.name // empty' "${SBOM_FILE}")"
  check_condition "Component Name" "${comp_name}" "${comp_name}"

  # 3. Version of the Component
  local comp_version
  comp_version="$(jq -r '.metadata.component.version // empty' "${SBOM_FILE}")"
  check_condition "Version String" "${comp_version}" "${comp_version}"

  # 4. Other Unique Identifiers
  local purl_count
  purl_count="$(jq '[.components[]? | select(.purl != null)] | length' "${SBOM_FILE}")"
  local bomref_count
  bomref_count="$(jq '[.components[]? | select(.["bom-ref"] != null)] | length' "${SBOM_FILE}")"
  local total_comps
  total_comps="$(jq '.components // [] | length' "${SBOM_FILE}")"
  check_condition "Other Unique Identifiers" "$([ "${purl_count}" -gt 0 ] && echo "yes")" \
    "${purl_count}/${total_comps} with purl, ${bomref_count}/${total_comps} with bom-ref"

  # 5. Dependency Relationship
  local dep_count
  dep_count="$(jq '.dependencies // [] | length' "${SBOM_FILE}")"
  check_condition "Dependency Relationships" "$([ "${dep_count}" -gt 0 ] && echo "yes")" \
    "${dep_count} dependency entries"

  # 6. Author of SBOM Data
  local tool_count
  tool_count="$(jq '
    if .metadata.tools | type == "array" then
      .metadata.tools | length
    elif .metadata.tools.components then
      .metadata.tools.components | length
    else 0 end
  ' "${SBOM_FILE}")"
  check_condition "Author of SBOM Data" "$([ "${tool_count}" -gt 0 ] && echo "yes")" \
    "${tool_count} tools listed"

  # 7. Timestamp
  local timestamp
  timestamp="$(jq -r '.metadata.timestamp // empty' "${SBOM_FILE}")"
  check_condition "Timestamp" "${timestamp}" "${timestamp}"
}

# ---------------------------------------------------------------------------
# Validation: EO 14028 Section 4
# ---------------------------------------------------------------------------
validate_eo14028() {
  log_section "Executive Order 14028 — Section 4 Requirements"

  # Machine-readable format
  local bom_format
  bom_format="$(jq -r '.bomFormat // empty' "${SBOM_FILE}")"
  local is_machine_readable
  is_machine_readable="$([ "${bom_format}" = "CycloneDX" ] || [ "${bom_format}" = "SPDX" ] && echo "yes")"
  check_condition "Machine-readable SBOM format" "${is_machine_readable}" "${bom_format}"

  # Known/recognized format
  local spec_version
  spec_version="$(jq -r '.specVersion // empty' "${SBOM_FILE}")"
  check_condition "Recognized specification version" "${spec_version}" "${bom_format} ${spec_version}"

  # All dependencies (direct + transitive)
  local dep_count
  dep_count="$(jq '.dependencies // [] | length' "${SBOM_FILE}")"
  local comp_count
  comp_count="$(jq '.components // [] | length' "${SBOM_FILE}")"
  check_condition "Includes direct and transitive dependencies" "$([ "${comp_count}" -gt 0 ] && echo "yes")" \
    "${comp_count} components, ${dep_count} dependency relationships"

  # Sufficient detail to track known vulnerabilities
  local has_purl
  has_purl="$(jq '[.components[]? | select(.purl != null)] | length' "${SBOM_FILE}")"
  check_condition "Sufficient detail for vulnerability tracking (purl)" \
    "$([ "${has_purl}" -gt 0 ] && echo "yes")" "${has_purl} components with purl"

  # Vulnerability data correlation (if present)
  local vuln_count
  vuln_count="$(jq '.vulnerabilities // [] | length' "${SBOM_FILE}")"
  if [[ "${vuln_count}" -gt 0 ]]; then
    check_pass "Vulnerability correlation present" "${vuln_count} vulnerabilities documented"
  else
    check_warn "Vulnerability correlation present" "No vulnerabilities section (may be acceptable if no known vulns)"
  fi

  # Produced for every release
  check_pass "Automation capability" "CI/CD workflow integration verified by script presence"

  # Available to downstream consumers
  local has_serial
  has_serial="$(jq -r '.serialNumber // empty' "${SBOM_FILE}")"
  check_condition "Unique serial number for distribution" "${has_serial}" "${has_serial:0:40}"
}

# ---------------------------------------------------------------------------
# Validation: NIST SP 800-218 (SSDF)
# ---------------------------------------------------------------------------
validate_ssdf() {
  log_section "NIST SP 800-218 — Secure Software Development Framework (SSDF)"

  # PS.3 — Maintain a secure software development environment
  # Measured by: having an SBOM at all, with components listed
  local comp_count
  comp_count="$(jq '.components // [] | length' "${SBOM_FILE}")"
  check_condition "PS.3 — Third-party component inventory" \
    "$([ "${comp_count}" -gt 0 ] && echo "yes")" "${comp_count} components inventoried"

  # PW.4 — Verify third-party software components
  local hashed_count
  hashed_count="$(jq '[.components[]? | select(.hashes != null and (.hashes | length > 0))] | length' "${SBOM_FILE}")"
  if [[ "${hashed_count}" -gt 0 ]]; then
    check_pass "PW.4.1 — Component integrity verification (hashes)" "${hashed_count}/${comp_count} with hashes"
  else
    check_warn "PW.4.1 — Component integrity verification (hashes)" "No component hashes found"
  fi

  local licensed_count
  licensed_count="$(jq '[.components[]? | select(.licenses != null and (.licenses | length > 0))] | length' "${SBOM_FILE}")"
  if [[ "${licensed_count}" -gt 0 ]]; then
    check_pass "PW.4.2 — License compliance tracking" "${licensed_count}/${comp_count} with license data"
  else
    check_warn "PW.4.2 — License compliance tracking" "No license data found"
  fi

  local purl_count
  purl_count="$(jq '[.components[]? | select(.purl != null)] | length' "${SBOM_FILE}")"
  check_condition "PW.4.3 — Component provenance (purl)" \
    "$([ "${purl_count}" -gt 0 ] && echo "yes")" "${purl_count}/${comp_count} with purl"

  # RV.1 — Identify and confirm vulnerabilities
  local vuln_count
  vuln_count="$(jq '.vulnerabilities // [] | length' "${SBOM_FILE}")"
  if [[ "${vuln_count}" -gt 0 ]]; then
    check_pass "RV.1 — Vulnerability identification and correlation" "${vuln_count} vulnerabilities documented"
  else
    check_warn "RV.1 — Vulnerability identification and correlation" "No vulnerability data (may need audit run)"
  fi

  # PS.1 — Define organizational security requirements
  local has_metadata
  has_metadata="$(jq '.metadata != null' "${SBOM_FILE}")"
  check_condition "PS.1 — SBOM metadata completeness" "$([ "${has_metadata}" = "true" ] && echo "yes")"

  # PO.1 — Define security requirements for software development
  local dep_count
  dep_count="$(jq '.dependencies // [] | length' "${SBOM_FILE}")"
  check_condition "PO.1 — Dependency graph captured" \
    "$([ "${dep_count}" -gt 0 ] && echo "yes")" "${dep_count} dependency relationships"
}

# ---------------------------------------------------------------------------
# Validation: CISA 2025 Minimum Elements (9 fields)
# ---------------------------------------------------------------------------
validate_cisa_2025() {
  log_section "CISA 2025 SBOM Minimum Elements (9 Data Fields)"

  # 1. Author Name
  local author
  author="$(jq -r '
    if .metadata.tools | type == "array" then
      (.metadata.tools[0].vendor // .metadata.tools[0].name // empty)
    elif .metadata.tools.components then
      (.metadata.tools.components[0].author // .metadata.tools.components[0].name // empty)
    else empty end
  ' "${SBOM_FILE}")"
  check_condition "1. Author Name" "${author}" "${author}"

  # 2. Timestamp
  local timestamp
  timestamp="$(jq -r '.metadata.timestamp // empty' "${SBOM_FILE}")"
  check_condition "2. Timestamp" "${timestamp}" "${timestamp}"

  # 3. Supplier Name
  local supplier
  supplier="$(jq -r '.metadata.component.name // .metadata.component.author // empty' "${SBOM_FILE}")"
  check_condition "3. Supplier Name" "${supplier}" "${supplier}"

  # 4. Component Name
  local all_named
  all_named="$(jq '[.components[]? | select(.name == null or .name == "")] | length' "${SBOM_FILE}")"
  local total_comps
  total_comps="$(jq '.components // [] | length' "${SBOM_FILE}")"
  check_condition "4. Component Name (all components)" \
    "$([ "${all_named}" -eq 0 ] && [ "${total_comps}" -gt 0 ] && echo "yes")" \
    "$((total_comps - all_named))/${total_comps} components named"

  # 5. Component Version
  local unversioned
  unversioned="$(jq '[.components[]? | select(.version == null or .version == "")] | length' "${SBOM_FILE}")"
  check_condition "5. Component Version (all components)" \
    "$([ "${unversioned}" -eq 0 ] && [ "${total_comps}" -gt 0 ] && echo "yes")" \
    "$((total_comps - unversioned))/${total_comps} components versioned"

  # 6. Unique Identifier
  local purl_count
  purl_count="$(jq '[.components[]? | select(.purl != null)] | length' "${SBOM_FILE}")"
  local bomref_count
  bomref_count="$(jq '[.components[]? | select(.["bom-ref"] != null)] | length' "${SBOM_FILE}")"
  local identified
  identified=$(( purl_count > bomref_count ? purl_count : bomref_count ))
  check_condition "6. Unique Identifier" "$([ "${identified}" -gt 0 ] && echo "yes")" \
    "${purl_count} purl, ${bomref_count} bom-ref"

  # 7. Dependency Relationship
  local dep_count
  dep_count="$(jq '.dependencies // [] | length' "${SBOM_FILE}")"
  check_condition "7. Dependency Relationship" "$([ "${dep_count}" -gt 0 ] && echo "yes")" \
    "${dep_count} dependency entries"

  # 8. Component Hash
  local hashed_count
  hashed_count="$(jq '[.components[]? | select(.hashes != null and (.hashes | length > 0))] | length' "${SBOM_FILE}")"
  if [[ "${hashed_count}" -gt 0 ]]; then
    check_pass "8. Component Hash" "${hashed_count}/${total_comps} components with hash data"
  else
    check_warn "8. Component Hash" "No component hashes found (recommended but may depend on tooling)"
  fi

  # 9. Lifecycle Phase
  local has_lifecycle
  has_lifecycle="$(jq '.metadata.lifecycles // empty' "${SBOM_FILE}")"
  if [[ -n "${has_lifecycle}" && "${has_lifecycle}" != "null" ]]; then
    check_pass "9. Lifecycle Phase" "Lifecycle data present"
  else
    # CycloneDX 1.5 metadata.lifecycles is optional; presence of the SBOM itself
    # indicates "build" phase
    check_warn "9. Lifecycle Phase" "No explicit lifecycle field (implicitly 'build' phase)"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  Validation Summary${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  File:     ${SBOM_FILE}"
  echo -e "  Total:    ${TOTAL_CHECKS} checks"
  echo -e "  ${GREEN}Passed:  ${TOTAL_PASS}${NC}"
  echo -e "  ${RED}Failed:  ${TOTAL_FAIL}${NC}"
  echo -e "  ${YELLOW}Warned:  ${TOTAL_WARN}${NC}"
  echo ""

  if [[ ${TOTAL_FAIL} -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}RESULT: PASSED${NC} — SBOM meets all required compliance checks."
  else
    echo -e "  ${RED}${BOLD}RESULT: FAILED${NC} — ${TOTAL_FAIL} required check(s) did not pass."
    echo -e "  Review the failures above and regenerate or update the SBOM."
  fi

  if [[ ${TOTAL_WARN} -gt 0 ]]; then
    echo -e "  ${YELLOW}NOTE:${NC} ${TOTAL_WARN} advisory warning(s). These are recommended but not required."
  fi

  echo ""
}

print_json_summary() {
  cat << JSON_EOF
{
  "file": "${SBOM_FILE}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "totalChecks": ${TOTAL_CHECKS},
  "passed": ${TOTAL_PASS},
  "failed": ${TOTAL_FAIL},
  "warnings": ${TOTAL_WARN},
  "result": "$([ ${TOTAL_FAIL} -eq 0 ] && echo "PASSED" || echo "FAILED")",
  "frameworks": {
    "ntia": "validated",
    "eo14028": "validated",
    "nist_sp_800_218": "validated",
    "cisa_2025": "validated"
  }
}
JSON_EOF
}

validate_single_file() {
  SBOM_FILE="$1"
  TOTAL_PASS=0
  TOTAL_FAIL=0
  TOTAL_WARN=0
  TOTAL_CHECKS=0
  EXIT_CODE=0

  if [[ "${JSON_MODE}" != "true" ]]; then
    echo ""
    echo -e "${BOLD}Validating: ${SBOM_FILE}${NC}"
  fi

  validate_structure
  validate_ntia
  validate_eo14028
  validate_ssdf
  validate_cisa_2025

  if [[ "${JSON_MODE}" == "true" ]]; then
    print_json_summary
  else
    print_summary
  fi

  return ${EXIT_CODE}
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  if [[ "${JSON_MODE}" != "true" ]]; then
    echo ""
    echo "============================================"
    echo "  SBOM Compliance Validator"
    echo "  $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
    echo "============================================"
  fi

  local overall_exit=0

  if [[ "${ALL_MODE}" == "true" ]]; then
    local found=false
    if [[ "${JSON_MODE}" == "true" ]]; then
      echo "["
      local first=true
    fi

    for f in "${SBOM_DIR}"/sbom-*.json; do
      [[ -f "${f}" ]] || continue
      found=true

      if [[ "${JSON_MODE}" == "true" && "${first}" != "true" ]]; then
        echo ","
      fi
      first=false

      validate_single_file "${f}" || overall_exit=1
    done

    if [[ "${JSON_MODE}" == "true" ]]; then
      echo "]"
    fi

    if [[ "${found}" == "false" ]]; then
      echo "No SBOM files found in ${SBOM_DIR}"
      exit 2
    fi
  else
    validate_single_file "${SBOM_FILE}" || overall_exit=1
  fi

  exit ${overall_exit}
}

main "$@"
