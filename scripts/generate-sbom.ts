#!/usr/bin/env tsx
/**
 * SBOM (Software Bill of Materials) Generator
 *
 * Generates CycloneDX SBOM in JSON and XML formats with vulnerability correlation.
 * Part of the Vorion security infrastructure (P0-007).
 *
 * @see https://cyclonedx.org/specification/overview/
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const SBOM_DIR = join(ROOT_DIR, 'sbom');

interface SBOMOptions {
  validateOnly: boolean;
  outputDir: string;
  includeDevDeps: boolean;
  flattenComponents: boolean;
  specVersion: string;
}

interface VulnerabilityData {
  id: string;
  severity: string;
  title: string;
  url: string;
  affectedPackage: string;
  affectedVersions: string;
  recommendation: string;
}

interface AuditVulnerability {
  via: Array<{
    source?: number;
    name?: string;
    title?: string;
    severity?: string;
    url?: string;
    range?: string;
  } | string>;
  nodes: string[];
  effects: string[];
  range: string;
  severity: string;
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

interface AuditReport {
  vulnerabilities: Record<string, AuditVulnerability>;
  metadata: {
    vulnerabilities: {
      total: number;
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
    };
  };
}

interface CycloneDXComponent {
  type: string;
  name: string;
  version: string;
  purl?: string;
  'bom-ref'?: string;
}

interface CycloneDXBom {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{
      vendor: string;
      name: string;
      version: string;
    }>;
    component: {
      type: string;
      name: string;
      version: string;
    };
  };
  components: CycloneDXComponent[];
  vulnerabilities?: Array<{
    id: string;
    source: {
      name: string;
      url: string;
    };
    ratings: Array<{
      severity: string;
      method: string;
    }>;
    description: string;
    recommendation: string;
    affects: Array<{
      ref: string;
      versions: Array<{
        version: string;
        status: string;
      }>;
    }>;
  }>;
}

function parseArgs(): SBOMOptions {
  const args = process.argv.slice(2);
  return {
    validateOnly: args.includes('--validate-only'),
    outputDir: SBOM_DIR,
    includeDevDeps: !args.includes('--production'),
    flattenComponents: args.includes('--flatten'),
    specVersion: '1.5',
  };
}

function ensureOutputDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created output directory: ${dir}`);
  }
}

function getPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
  return packageJson.version || '0.0.0';
}

function getTimestamp(): string {
  return new Date().toISOString();
}

async function runNpmAudit(): Promise<VulnerabilityData[]> {
  console.log('Running npm audit for vulnerability correlation...');

  try {
    const result = execSync('npm audit --json 2>/dev/null || true', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repos
    });

    if (!result.trim()) {
      console.log('No vulnerability data available from npm audit');
      return [];
    }

    const auditData: AuditReport = JSON.parse(result);
    const vulnerabilities: VulnerabilityData[] = [];

    if (auditData.vulnerabilities) {
      for (const [pkgName, vuln] of Object.entries(auditData.vulnerabilities)) {
        // Handle nested via entries
        for (const via of vuln.via) {
          if (typeof via === 'object' && via.source) {
            vulnerabilities.push({
              id: `NPM-${via.source}`,
              severity: via.severity || vuln.severity,
              title: via.title || 'Unknown vulnerability',
              url: via.url || '',
              affectedPackage: pkgName,
              affectedVersions: via.range || vuln.range,
              recommendation: typeof vuln.fixAvailable === 'object'
                ? `Upgrade to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
                : (vuln.fixAvailable ? 'Fix available' : 'No fix available'),
            });
          }
        }
      }
    }

    console.log(`Found ${vulnerabilities.length} vulnerabilities`);
    return vulnerabilities;
  } catch (error) {
    console.warn('Warning: Could not run npm audit:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

async function generateCycloneDXSbom(options: SBOMOptions): Promise<string> {
  console.log('Generating CycloneDX SBOM...');

  const args = [
    '--output-format', 'JSON',
    '--spec-version', options.specVersion,
    '--output-reproducible',
  ];

  if (!options.includeDevDeps) {
    args.push('--omit', 'dev');
  }

  if (options.flattenComponents) {
    args.push('--flatten-components');
  }

  const outputFile = join(options.outputDir, 'sbom.json');
  args.push('--output-file', outputFile);

  return new Promise((resolve, reject) => {
    const cyclonedx = spawn('npx', ['@cyclonedx/cyclonedx-npm', ...args], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    cyclonedx.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    cyclonedx.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    cyclonedx.on('close', (code) => {
      if (code !== 0) {
        console.error('CycloneDX stderr:', stderr);
        reject(new Error(`CycloneDX generation failed with code ${code}`));
      } else {
        console.log('CycloneDX SBOM generated successfully');
        resolve(outputFile);
      }
    });

    cyclonedx.on('error', (err) => {
      reject(err);
    });
  });
}

function addVulnerabilityData(sbomPath: string, vulnerabilities: VulnerabilityData[]): void {
  if (vulnerabilities.length === 0) {
    console.log('No vulnerabilities to add to SBOM');
    return;
  }

  console.log('Adding vulnerability correlation data to SBOM...');

  const sbom: CycloneDXBom = JSON.parse(readFileSync(sbomPath, 'utf-8'));

  // Create a map of component names to their bom-refs
  const componentRefs = new Map<string, string>();
  for (const component of sbom.components || []) {
    const ref = component['bom-ref'] || `${component.name}@${component.version}`;
    componentRefs.set(component.name, ref);
  }

  // Add vulnerabilities section
  sbom.vulnerabilities = vulnerabilities.map((vuln) => ({
    id: vuln.id,
    source: {
      name: 'npm',
      url: vuln.url || 'https://www.npmjs.com/advisories',
    },
    ratings: [{
      severity: vuln.severity.toLowerCase(),
      method: 'CVSSv3',
    }],
    description: vuln.title,
    recommendation: vuln.recommendation,
    affects: [{
      ref: componentRefs.get(vuln.affectedPackage) || vuln.affectedPackage,
      versions: [{
        version: vuln.affectedVersions,
        status: 'affected',
      }],
    }],
  }));

  writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
  console.log(`Added ${vulnerabilities.length} vulnerabilities to SBOM`);
}

function convertToXml(jsonPath: string): string {
  console.log('Converting SBOM to XML format...');

  const sbom: CycloneDXBom = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const xmlPath = jsonPath.replace('.json', '.xml');

  // Generate XML manually for better control
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<bom xmlns="http://cyclonedx.org/schema/bom/${sbom.specVersion}" `;
  xml += `version="${sbom.version}" serialNumber="${sbom.serialNumber}">\n`;

  // Metadata
  xml += '  <metadata>\n';
  xml += `    <timestamp>${sbom.metadata.timestamp}</timestamp>\n`;
  xml += '    <tools>\n';
  for (const tool of sbom.metadata.tools) {
    xml += '      <tool>\n';
    xml += `        <vendor>${escapeXml(tool.vendor)}</vendor>\n`;
    xml += `        <name>${escapeXml(tool.name)}</name>\n`;
    xml += `        <version>${escapeXml(tool.version)}</version>\n`;
    xml += '      </tool>\n';
  }
  xml += '    </tools>\n';
  xml += '    <component type="application">\n';
  xml += `      <name>${escapeXml(sbom.metadata.component.name)}</name>\n`;
  xml += `      <version>${escapeXml(sbom.metadata.component.version)}</version>\n`;
  xml += '    </component>\n';
  xml += '  </metadata>\n';

  // Components
  xml += '  <components>\n';
  for (const component of sbom.components || []) {
    xml += `    <component type="${component.type}"`;
    if (component['bom-ref']) {
      xml += ` bom-ref="${escapeXml(component['bom-ref'])}"`;
    }
    xml += '>\n';
    xml += `      <name>${escapeXml(component.name)}</name>\n`;
    xml += `      <version>${escapeXml(component.version)}</version>\n`;
    if (component.purl) {
      xml += `      <purl>${escapeXml(component.purl)}</purl>\n`;
    }
    xml += '    </component>\n';
  }
  xml += '  </components>\n';

  // Vulnerabilities
  if (sbom.vulnerabilities && sbom.vulnerabilities.length > 0) {
    xml += '  <vulnerabilities>\n';
    for (const vuln of sbom.vulnerabilities) {
      xml += '    <vulnerability ref="">\n';
      xml += `      <id>${escapeXml(vuln.id)}</id>\n';
      xml += '      <source>\n';
      xml += `        <name>${escapeXml(vuln.source.name)}</name>\n';
      xml += `        <url>${escapeXml(vuln.source.url)}</url>\n';
      xml += '      </source>\n';
      xml += '      <ratings>\n';
      for (const rating of vuln.ratings) {
        xml += '        <rating>\n';
        xml += `          <severity>${escapeXml(rating.severity)}</severity>\n`;
        xml += `          <method>${escapeXml(rating.method)}</method>\n`;
        xml += '        </rating>\n';
      }
      xml += '      </ratings>\n';
      xml += `      <description>${escapeXml(vuln.description)}</description>\n`;
      xml += `      <recommendation>${escapeXml(vuln.recommendation)}</recommendation>\n`;
      xml += '      <affects>\n';
      for (const affect of vuln.affects) {
        xml += `        <target ref="${escapeXml(affect.ref)}">\n`;
        xml += '          <versions>\n';
        for (const version of affect.versions) {
          xml += `            <version>${escapeXml(version.version)}</version>\n`;
        }
        xml += '          </versions>\n';
        xml += '        </target>\n';
      }
      xml += '      </affects>\n';
      xml += '    </vulnerability>\n';
    }
    xml += '  </vulnerabilities>\n';
  }

  xml += '</bom>\n';

  writeFileSync(xmlPath, xml);
  console.log(`XML SBOM written to: ${xmlPath}`);

  return xmlPath;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validateSbom(jsonPath: string): boolean {
  console.log('Validating SBOM...');

  try {
    const sbom: CycloneDXBom = JSON.parse(readFileSync(jsonPath, 'utf-8'));

    // Basic validation checks
    const errors: string[] = [];

    if (!sbom.bomFormat || sbom.bomFormat !== 'CycloneDX') {
      errors.push('Missing or invalid bomFormat');
    }

    if (!sbom.specVersion) {
      errors.push('Missing specVersion');
    }

    if (!sbom.serialNumber) {
      errors.push('Missing serialNumber');
    }

    if (!sbom.metadata) {
      errors.push('Missing metadata');
    } else {
      if (!sbom.metadata.timestamp) {
        errors.push('Missing metadata.timestamp');
      }
      if (!sbom.metadata.component) {
        errors.push('Missing metadata.component');
      }
    }

    if (!sbom.components || !Array.isArray(sbom.components)) {
      errors.push('Missing or invalid components array');
    } else {
      for (let i = 0; i < sbom.components.length; i++) {
        const comp = sbom.components[i];
        if (!comp) continue;
        if (!comp.name) {
          errors.push(`Component ${i} missing name`);
        }
        if (!comp.version) {
          errors.push(`Component ${i} missing version`);
        }
        if (!comp.type) {
          errors.push(`Component ${i} missing type`);
        }
      }
    }

    if (errors.length > 0) {
      console.error('SBOM validation failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      return false;
    }

    console.log('SBOM validation passed');
    console.log(`  - Format: ${sbom.bomFormat}`);
    console.log(`  - Spec Version: ${sbom.specVersion}`);
    console.log(`  - Components: ${sbom.components?.length || 0}`);
    console.log(`  - Vulnerabilities: ${sbom.vulnerabilities?.length || 0}`);

    return true;
  } catch (error) {
    console.error('SBOM validation error:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

function generateVersionedCopy(basePath: string, version: string): void {
  const timestamp = new Date().toISOString().split('T')[0];
  const versionedName = `sbom-v${version}-${timestamp}`;

  // Copy JSON
  const jsonSource = basePath;
  const jsonDest = jsonSource.replace('sbom.json', `${versionedName}.json`);
  writeFileSync(jsonDest, readFileSync(jsonSource));
  console.log(`Created versioned copy: ${jsonDest}`);

  // Copy XML
  const xmlSource = basePath.replace('.json', '.xml');
  const xmlDest = xmlSource.replace('sbom.xml', `${versionedName}.xml`);
  if (existsSync(xmlSource)) {
    writeFileSync(xmlDest, readFileSync(xmlSource));
    console.log(`Created versioned copy: ${xmlDest}`);
  }
}

function generateSummary(jsonPath: string): void {
  const sbom: CycloneDXBom = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  console.log('\n========================================');
  console.log('SBOM Generation Summary');
  console.log('========================================');
  console.log(`Generated: ${sbom.metadata.timestamp}`);
  console.log(`Serial Number: ${sbom.serialNumber}`);
  console.log(`Spec Version: ${sbom.specVersion}`);
  console.log(`Total Components: ${sbom.components?.length || 0}`);
  console.log(`Total Vulnerabilities: ${sbom.vulnerabilities?.length || 0}`);

  if (sbom.vulnerabilities && sbom.vulnerabilities.length > 0) {
    const severityCounts: Record<string, number> = {};
    for (const vuln of sbom.vulnerabilities) {
      const severity = vuln.ratings[0]?.severity || 'unknown';
      severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    }

    console.log('\nVulnerabilities by severity:');
    for (const [severity, count] of Object.entries(severityCounts)) {
      console.log(`  ${severity}: ${count}`);
    }
  }

  console.log('========================================\n');
}

async function main(): Promise<void> {
  console.log('Vorion SBOM Generator v1.0.0');
  console.log('============================\n');

  const options = parseArgs();

  // Ensure output directory exists
  ensureOutputDir(options.outputDir);

  // Check if we're just validating
  if (options.validateOnly) {
    const jsonPath = join(options.outputDir, 'sbom.json');
    if (!existsSync(jsonPath)) {
      console.error('No SBOM found to validate. Run without --validate-only first.');
      process.exit(1);
    }

    const isValid = validateSbom(jsonPath);
    process.exit(isValid ? 0 : 1);
  }

  try {
    // Step 1: Generate base CycloneDX SBOM
    const jsonPath = await generateCycloneDXSbom(options);

    // Step 2: Get vulnerability data from npm audit
    const vulnerabilities = await runNpmAudit();

    // Step 3: Add vulnerability data to SBOM
    addVulnerabilityData(jsonPath, vulnerabilities);

    // Step 4: Convert to XML format
    convertToXml(jsonPath);

    // Step 5: Validate the generated SBOM
    const isValid = validateSbom(jsonPath);
    if (!isValid) {
      console.warn('Warning: Generated SBOM has validation issues');
    }

    // Step 6: Create versioned copies
    const version = getPackageVersion();
    generateVersionedCopy(jsonPath, version);

    // Step 7: Generate summary
    generateSummary(jsonPath);

    console.log('SBOM generation complete!');
    console.log(`Output directory: ${options.outputDir}`);

  } catch (error) {
    console.error('SBOM generation failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
