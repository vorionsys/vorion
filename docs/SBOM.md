# Software Bill of Materials (SBOM)

## Overview

Vorion generates a Software Bill of Materials (SBOM) for every release using the CycloneDX format. The SBOM provides a comprehensive inventory of all software components, dependencies, and associated vulnerabilities.

## Format

Vorion uses the **CycloneDX 1.5** specification, which is:
- An OWASP standard for SBOM
- Machine-readable (JSON and XML formats)
- Supports vulnerability correlation
- Compatible with major security tools

## Generation

### Automatic Generation

SBOMs are automatically generated during:
- Every tagged release (`v*` tags)
- Published GitHub releases
- Manual workflow dispatch

### Manual Generation

To generate an SBOM locally:

```bash
# Generate SBOM (JSON and XML)
npm run sbom:generate

# Validate existing SBOM
npm run sbom:validate

# Generate without dev dependencies
npm run sbom:generate -- --production

# Generate with flattened component tree
npm run sbom:generate -- --flatten
```

### Output Files

Generated files are stored in the `sbom/` directory:

| File | Description |
|------|-------------|
| `sbom.json` | Current SBOM in JSON format |
| `sbom.xml` | Current SBOM in XML format |
| `sbom-v{version}-{date}.json` | Versioned SBOM snapshot (JSON) |
| `sbom-v{version}-{date}.xml` | Versioned SBOM snapshot (XML) |
| `audit-report.json` | npm audit data (CI only) |

## SBOM Contents

### Metadata

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:...",
  "version": 1,
  "metadata": {
    "timestamp": "2026-02-04T00:00:00Z",
    "tools": [...],
    "component": {
      "type": "application",
      "name": "@vorion/platform",
      "version": "0.1.0"
    }
  }
}
```

### Components

Each component includes:
- **name**: Package name
- **version**: Exact version
- **type**: Component type (library, application, etc.)
- **purl**: Package URL for unique identification
- **bom-ref**: Reference ID for vulnerability correlation
- **licenses**: License information
- **hashes**: Integrity hashes (SHA-256, etc.)

Example:
```json
{
  "type": "library",
  "name": "fastify",
  "version": "5.7.3",
  "purl": "pkg:npm/fastify@5.7.3",
  "bom-ref": "fastify@5.7.3",
  "licenses": [
    {
      "license": {
        "id": "MIT"
      }
    }
  ]
}
```

### Vulnerabilities

The SBOM includes correlated vulnerability data from npm audit:

```json
{
  "vulnerabilities": [
    {
      "id": "NPM-12345",
      "source": {
        "name": "npm",
        "url": "https://npmjs.com/advisories/12345"
      },
      "ratings": [
        {
          "severity": "high",
          "method": "CVSSv3"
        }
      ],
      "description": "Description of the vulnerability",
      "recommendation": "Upgrade to package@version",
      "affects": [
        {
          "ref": "affected-package@1.0.0",
          "versions": [
            {
              "version": "<2.0.0",
              "status": "affected"
            }
          ]
        }
      ]
    }
  ]
}
```

## Accessing SBOMs

### GitHub Releases

SBOMs are attached as assets to each GitHub release:
1. Go to [Releases](https://github.com/vorion/vorion/releases)
2. Download `sbom.json` or `sbom.xml` from the release assets

### CI Artifacts

SBOMs are stored as CI artifacts for 90 days:
1. Go to [Actions](https://github.com/vorion/vorion/actions)
2. Select the SBOM Generation workflow run
3. Download the `sbom-{version}` artifact

### Local Generation

```bash
# Clone the repository
git clone https://github.com/vorion/vorion.git
cd vorion

# Install dependencies
npm install

# Generate SBOM
npm run sbom:generate

# SBOM files will be in ./sbom/
```

### SBOM History

Historical SBOMs for each release are stored in the `sbom-history/` directory on the main branch.

## Integration

### Security Scanning Tools

The CycloneDX format is supported by:
- **Dependency-Track**: Import SBOM for continuous monitoring
- **OWASP Dependency-Check**: Vulnerability scanning
- **Grype**: Container image vulnerability scanner
- **Trivy**: Security scanner
- **Snyk**: Security platform

### Import to Dependency-Track

```bash
# Using the Dependency-Track API
curl -X POST \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @sbom/sbom.json \
  https://your-dependency-track/api/v1/bom
```

### GitHub Dependency Graph

The CI workflow automatically uploads SBOM data to GitHub's Dependency Graph for:
- Security alerts
- Dependabot updates
- Dependency insights

## Validation

### Automated Validation

The SBOM workflow validates:
- JSON/XML syntax
- Required CycloneDX fields
- Component completeness
- Vulnerability correlation accuracy

### Manual Validation

```bash
# Validate SBOM format
npm run sbom:validate

# Using CycloneDX CLI (if installed)
cyclonedx validate --input-file sbom/sbom.json
```

### Validation Checks

| Check | Description |
|-------|-------------|
| bomFormat | Must be "CycloneDX" |
| specVersion | Must be valid spec version |
| serialNumber | Must be unique URN UUID |
| metadata | Must contain timestamp and component |
| components | Must be non-empty array |

## Compliance

### NTIA Minimum Elements

The Vorion SBOM includes all NTIA minimum elements for SBOM:
- Supplier name
- Component name
- Version string
- Other unique identifiers (purl)
- Dependency relationships
- Author of SBOM data
- Timestamp

### Executive Order 14028

Compliant with the U.S. Executive Order on Improving the Nation's Cybersecurity requirements for SBOM generation and distribution.

### NIST SP 800-218

Follows NIST Secure Software Development Framework (SSDF) practices for supply chain security.

## Best Practices

### For Consumers

1. **Verify Integrity**: Check SBOM hashes match release artifacts
2. **Monitor Vulnerabilities**: Import SBOM into security tools for continuous monitoring
3. **Track Updates**: Compare SBOMs between versions for dependency changes
4. **Audit Licenses**: Review component licenses for compliance

### For Contributors

1. **Update Dependencies**: Use `npm audit fix` before releases
2. **Review Changes**: Check SBOM diff in pull requests
3. **Document Exceptions**: Note any accepted vulnerability risks
4. **Test Generation**: Run `npm run sbom:generate` locally before release

## Troubleshooting

### SBOM Generation Fails

```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Retry generation
npm run sbom:generate
```

### Validation Errors

If validation fails:
1. Check the error messages for specific issues
2. Verify npm dependencies are correctly installed
3. Ensure CycloneDX npm package is available
4. Review the generated SBOM for malformed data

### Missing Vulnerabilities

Vulnerability data may be incomplete if:
- npm audit cannot reach the registry
- New vulnerabilities are not yet in the npm database
- Packages are not published to npm

## References

- [CycloneDX Specification](https://cyclonedx.org/specification/overview/)
- [NTIA SBOM Minimum Elements](https://www.ntia.gov/page/software-bill-materials)
- [OWASP Dependency-Track](https://dependencytrack.org/)
- [npm audit documentation](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [GitHub Dependency Graph](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph)
