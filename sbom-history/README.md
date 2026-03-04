# SBOM History

This directory contains historical Software Bill of Materials (SBOM) files for each Vorion release.

## Purpose

- Track dependency changes between versions
- Provide audit trail for compliance
- Enable vulnerability retrospective analysis
- Support software supply chain transparency

## File Naming Convention

Files are named using the pattern: `sbom-v{version}-{date}.{format}`

- **version**: Semantic version of the release
- **date**: Generation date (YYYY-MM-DD)
- **format**: Either `json` or `xml`

## Available SBOMs

*SBOMs will be added automatically with each release.*

## Usage

To compare SBOMs between versions:

```bash
# Using jq to compare component counts
jq '.components | length' sbom-v1.0.0-*.json
jq '.components | length' sbom-v1.1.0-*.json

# Diff component lists
diff <(jq -r '.components[].name' sbom-v1.0.0-*.json | sort) \
     <(jq -r '.components[].name' sbom-v1.1.0-*.json | sort)
```

## More Information

See [/docs/SBOM.md](/docs/SBOM.md) for complete SBOM documentation.
