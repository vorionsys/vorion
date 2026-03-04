#!/usr/bin/env ts-node
/**
 * Air-Gap Bundle Verification Tool
 *
 * Verifies the integrity and completeness of air-gap deployment bundles:
 * - Checksum validation of all files
 * - Cryptographic signature verification
 * - Completeness check against manifest
 * - Version compatibility validation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

interface BundleManifest {
  version: string;
  buildDate: string;
  buildHost: string;
  platform: string;
  checksum: string;
  signature?: string;
  components: {
    name: string;
    version: string;
    checksum: string;
    size: number;
    path: string;
  }[];
  dependencies: {
    docker: string;
    nodeJs: string;
    postgresql: string;
  };
  compatibility: {
    minVersion: string;
    maxVersion: string;
  };
}

interface VerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  details: {
    manifestValid: boolean;
    checksumValid: boolean;
    signatureValid: boolean | null;
    componentsValid: boolean;
    compatibilityValid: boolean;
  };
  manifest?: BundleManifest;
}

interface VerificationOptions {
  bundlePath: string;
  publicKeyPath?: string;
  targetVersion?: string;
  verbose?: boolean;
  skipSignature?: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' | 'debug' = 'info',
  verbose = true
): void {
  if (!verbose && level === 'debug') return;

  const timestamp = new Date().toISOString();
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
    debug: '\x1b[90m',
  };
  const reset = '\x1b[0m';
  const symbols = {
    info: 'i',
    warn: '!',
    error: 'x',
    success: '✓',
    debug: '·',
  };

  console.log(
    `${colors[level]}[${symbols[level]}]${reset} ${message}`
  );
}

function calculateChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function calculateDirectoryChecksum(dirPath: string): string {
  const hashSum = crypto.createHash('sha256');

  function processDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        processDirectory(fullPath);
      } else {
        const content = fs.readFileSync(fullPath);
        hashSum.update(entry.name);
        hashSum.update(content);
      }
    }
  }

  processDirectory(dirPath);
  return hashSum.digest('hex');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

// ============================================================================
// Bundle Verifier Class
// ============================================================================

class BundleVerifier {
  private options: VerificationOptions;
  private bundleDir: string;
  private result: VerificationResult;

  constructor(options: VerificationOptions) {
    this.options = options;
    this.bundleDir = '';
    this.result = {
      valid: true,
      errors: [],
      warnings: [],
      details: {
        manifestValid: false,
        checksumValid: false,
        signatureValid: null,
        componentsValid: false,
        compatibilityValid: false,
      },
    };
  }

  async verify(): Promise<VerificationResult> {
    log('Starting bundle verification...', 'info', this.options.verbose);
    log(`Bundle path: ${this.options.bundlePath}`, 'debug', this.options.verbose);

    try {
      // Extract bundle if compressed
      await this.prepareBundleDirectory();

      // Run all verification checks
      await this.verifyManifest();
      await this.verifyChecksums();

      if (!this.options.skipSignature) {
        await this.verifySignature();
      }

      await this.verifyComponents();
      await this.verifyCompatibility();
      await this.verifyDependencies();

      // Determine overall validity
      this.result.valid =
        this.result.details.manifestValid &&
        this.result.details.checksumValid &&
        this.result.details.componentsValid &&
        this.result.details.compatibilityValid &&
        (this.options.skipSignature || this.result.details.signatureValid !== false);

      this.printSummary();

      return this.result;
    } catch (error) {
      this.result.valid = false;
      this.result.errors.push(`Verification failed: ${error}`);
      return this.result;
    }
  }

  private async prepareBundleDirectory(): Promise<void> {
    const bundlePath = this.options.bundlePath;

    if (bundlePath.endsWith('.tar.gz') || bundlePath.endsWith('.tgz')) {
      log('Extracting compressed bundle...', 'info', this.options.verbose);

      // Create temp directory for extraction
      const tempDir = path.join(
        path.dirname(bundlePath),
        `.verify-${Date.now()}`
      );
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        execSync(`tar -xzf "${bundlePath}" -C "${tempDir}"`, {
          encoding: 'utf8',
          stdio: 'pipe',
        });

        // Find the extracted directory
        const entries = fs.readdirSync(tempDir);
        if (entries.length === 1) {
          this.bundleDir = path.join(tempDir, entries[0]);
        } else {
          this.bundleDir = tempDir;
        }

        log(`Extracted to: ${this.bundleDir}`, 'debug', this.options.verbose);
      } catch (error) {
        throw new Error(`Failed to extract bundle: ${error}`);
      }
    } else if (fs.statSync(bundlePath).isDirectory()) {
      this.bundleDir = bundlePath;
    } else {
      throw new Error('Bundle must be a .tar.gz file or directory');
    }
  }

  private async verifyManifest(): Promise<void> {
    log('Verifying manifest...', 'info', this.options.verbose);

    const manifestPath = path.join(this.bundleDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      this.result.errors.push('manifest.json not found');
      this.result.details.manifestValid = false;
      return;
    }

    try {
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      const manifest: BundleManifest = JSON.parse(manifestContent);

      // Validate required fields
      const requiredFields = ['version', 'buildDate', 'platform', 'checksum', 'components'];
      const missingFields = requiredFields.filter(
        (field) => !(field in manifest)
      );

      if (missingFields.length > 0) {
        this.result.errors.push(
          `Manifest missing required fields: ${missingFields.join(', ')}`
        );
        this.result.details.manifestValid = false;
        return;
      }

      // Validate version format
      if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
        this.result.warnings.push(
          `Version format may be invalid: ${manifest.version}`
        );
      }

      // Validate build date
      const buildDate = new Date(manifest.buildDate);
      if (isNaN(buildDate.getTime())) {
        this.result.errors.push('Invalid build date format');
        this.result.details.manifestValid = false;
        return;
      }

      // Check if bundle is too old (>1 year)
      const ageMs = Date.now() - buildDate.getTime();
      const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);
      if (ageYears > 1) {
        this.result.warnings.push(
          `Bundle is ${ageYears.toFixed(1)} years old - consider updating`
        );
      }

      this.result.manifest = manifest;
      this.result.details.manifestValid = true;

      log(`  Version: ${manifest.version}`, 'debug', this.options.verbose);
      log(`  Platform: ${manifest.platform}`, 'debug', this.options.verbose);
      log(`  Build Date: ${manifest.buildDate}`, 'debug', this.options.verbose);
      log(`  Components: ${manifest.components.length}`, 'debug', this.options.verbose);
      log('  Manifest valid', 'success', this.options.verbose);
    } catch (error) {
      this.result.errors.push(`Failed to parse manifest: ${error}`);
      this.result.details.manifestValid = false;
    }
  }

  private async verifyChecksums(): Promise<void> {
    log('Verifying checksums...', 'info', this.options.verbose);

    const checksumPath = path.join(this.bundleDir, 'SHA256SUMS');

    if (!fs.existsSync(checksumPath)) {
      this.result.errors.push('SHA256SUMS file not found');
      this.result.details.checksumValid = false;
      return;
    }

    const checksumContent = fs.readFileSync(checksumPath, 'utf8');
    const lines = checksumContent.trim().split('\n');

    let validCount = 0;
    let invalidCount = 0;
    const invalidFiles: string[] = [];

    for (const line of lines) {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      if (!match) {
        this.result.warnings.push(`Invalid checksum line format: ${line}`);
        continue;
      }

      const [, expectedChecksum, relativePath] = match;
      const fullPath = path.join(this.bundleDir, relativePath);

      if (!fs.existsSync(fullPath)) {
        this.result.errors.push(`File missing: ${relativePath}`);
        invalidCount++;
        invalidFiles.push(relativePath);
        continue;
      }

      const actualChecksum = calculateChecksum(fullPath);

      if (actualChecksum === expectedChecksum) {
        validCount++;
        log(`  [OK] ${relativePath}`, 'debug', this.options.verbose);
      } else {
        invalidCount++;
        invalidFiles.push(relativePath);
        this.result.errors.push(
          `Checksum mismatch: ${relativePath}\n` +
          `  Expected: ${expectedChecksum}\n` +
          `  Actual:   ${actualChecksum}`
        );
      }
    }

    this.result.details.checksumValid = invalidCount === 0;

    if (invalidCount > 0) {
      log(`  ${invalidCount} file(s) failed checksum verification`, 'error', this.options.verbose);
      for (const file of invalidFiles.slice(0, 5)) {
        log(`    - ${file}`, 'error', this.options.verbose);
      }
      if (invalidFiles.length > 5) {
        log(`    ... and ${invalidFiles.length - 5} more`, 'error', this.options.verbose);
      }
    } else {
      log(`  All ${validCount} files verified`, 'success', this.options.verbose);
    }
  }

  private async verifySignature(): Promise<void> {
    log('Verifying signature...', 'info', this.options.verbose);

    if (!this.options.publicKeyPath) {
      log('  No public key provided, skipping signature verification', 'warn', this.options.verbose);
      this.result.details.signatureValid = null;
      return;
    }

    if (!fs.existsSync(this.options.publicKeyPath)) {
      this.result.errors.push(`Public key not found: ${this.options.publicKeyPath}`);
      this.result.details.signatureValid = false;
      return;
    }

    const signaturePath = path.join(this.bundleDir, 'SHA256SUMS.sig');
    const checksumPath = path.join(this.bundleDir, 'SHA256SUMS');

    if (!fs.existsSync(signaturePath)) {
      this.result.warnings.push('No signature file found (SHA256SUMS.sig)');
      this.result.details.signatureValid = null;
      return;
    }

    try {
      execSync(
        `openssl dgst -sha256 -verify "${this.options.publicKeyPath}" -signature "${signaturePath}" "${checksumPath}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );

      this.result.details.signatureValid = true;
      log('  Signature valid', 'success', this.options.verbose);
    } catch (error) {
      this.result.errors.push('Signature verification failed');
      this.result.details.signatureValid = false;
      log('  Signature INVALID', 'error', this.options.verbose);
    }
  }

  private async verifyComponents(): Promise<void> {
    log('Verifying components...', 'info', this.options.verbose);

    if (!this.result.manifest) {
      this.result.details.componentsValid = false;
      return;
    }

    const missingComponents: string[] = [];
    const corruptComponents: string[] = [];

    for (const component of this.result.manifest.components) {
      const componentPath = path.join(this.bundleDir, component.path);

      log(`  Checking ${component.name}...`, 'debug', this.options.verbose);

      // Check existence
      if (!fs.existsSync(componentPath)) {
        missingComponents.push(component.name);
        continue;
      }

      // Check checksum
      let actualChecksum: string;
      const stats = fs.statSync(componentPath);

      if (stats.isDirectory()) {
        actualChecksum = calculateDirectoryChecksum(componentPath);
      } else {
        actualChecksum = calculateChecksum(componentPath);

        // Verify size
        if (stats.size !== component.size) {
          this.result.warnings.push(
            `Size mismatch for ${component.name}: expected ${formatBytes(component.size)}, got ${formatBytes(stats.size)}`
          );
        }
      }

      if (actualChecksum !== component.checksum) {
        corruptComponents.push(component.name);
      } else {
        log(`    [OK] ${component.name}`, 'debug', this.options.verbose);
      }
    }

    if (missingComponents.length > 0) {
      this.result.errors.push(
        `Missing components: ${missingComponents.join(', ')}`
      );
    }

    if (corruptComponents.length > 0) {
      this.result.errors.push(
        `Corrupt components: ${corruptComponents.join(', ')}`
      );
    }

    this.result.details.componentsValid =
      missingComponents.length === 0 && corruptComponents.length === 0;

    if (this.result.details.componentsValid) {
      log(
        `  All ${this.result.manifest.components.length} components verified`,
        'success',
        this.options.verbose
      );
    }
  }

  private async verifyCompatibility(): Promise<void> {
    log('Verifying compatibility...', 'info', this.options.verbose);

    if (!this.result.manifest) {
      this.result.details.compatibilityValid = false;
      return;
    }

    const { compatibility } = this.result.manifest;

    if (this.options.targetVersion) {
      const target = this.options.targetVersion;
      const min = compatibility.minVersion;
      const max = compatibility.maxVersion;

      log(`  Target version: ${target}`, 'debug', this.options.verbose);
      log(`  Compatible range: ${min} - ${max}`, 'debug', this.options.verbose);

      if (compareVersions(target, min) < 0) {
        this.result.errors.push(
          `Target version ${target} is below minimum ${min}`
        );
        this.result.details.compatibilityValid = false;
        return;
      }

      if (compareVersions(target, max) > 0) {
        this.result.errors.push(
          `Target version ${target} is above maximum ${max}`
        );
        this.result.details.compatibilityValid = false;
        return;
      }

      log('  Version compatible', 'success', this.options.verbose);
    }

    this.result.details.compatibilityValid = true;
  }

  private async verifyDependencies(): Promise<void> {
    log('Verifying dependencies...', 'info', this.options.verbose);

    if (!this.result.manifest) {
      return;
    }

    const { dependencies } = this.result.manifest;

    // Check Docker version
    try {
      const dockerVersion = execSync('docker --version', {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const match = dockerVersion.match(/Docker version (\d+\.\d+\.\d+)/);
      if (match) {
        const installed = match[1];
        if (compareVersions(installed, dependencies.docker) < 0) {
          this.result.warnings.push(
            `Docker ${installed} installed, ${dependencies.docker}+ recommended`
          );
        } else {
          log(`  Docker ${installed} [OK]`, 'debug', this.options.verbose);
        }
      }
    } catch {
      this.result.warnings.push('Docker not installed or not accessible');
    }

    // Check Node.js version
    try {
      const nodeVersion = execSync('node --version', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim().replace('v', '');

      if (compareVersions(nodeVersion, dependencies.nodeJs) < 0) {
        this.result.warnings.push(
          `Node.js ${nodeVersion} installed, ${dependencies.nodeJs}+ recommended`
        );
      } else {
        log(`  Node.js ${nodeVersion} [OK]`, 'debug', this.options.verbose);
      }
    } catch {
      this.result.warnings.push('Node.js not installed or not accessible');
    }
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION SUMMARY');
    console.log('='.repeat(60));

    if (this.result.manifest) {
      console.log(`Bundle Version: ${this.result.manifest.version}`);
      console.log(`Platform: ${this.result.manifest.platform}`);
      console.log(`Build Date: ${this.result.manifest.buildDate}`);
    }

    console.log('\nChecks:');
    console.log(
      `  Manifest:       ${this.formatStatus(this.result.details.manifestValid)}`
    );
    console.log(
      `  Checksums:      ${this.formatStatus(this.result.details.checksumValid)}`
    );
    console.log(
      `  Signature:      ${this.formatStatus(this.result.details.signatureValid)}`
    );
    console.log(
      `  Components:     ${this.formatStatus(this.result.details.componentsValid)}`
    );
    console.log(
      `  Compatibility:  ${this.formatStatus(this.result.details.compatibilityValid)}`
    );

    if (this.result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of this.result.warnings) {
        console.log(`  - ${warning}`);
      }
    }

    if (this.result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of this.result.errors) {
        console.log(`  - ${error}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    if (this.result.valid) {
      console.log('\x1b[32mBUNDLE VERIFICATION: PASSED\x1b[0m');
    } else {
      console.log('\x1b[31mBUNDLE VERIFICATION: FAILED\x1b[0m');
    }
    console.log('='.repeat(60) + '\n');
  }

  private formatStatus(status: boolean | null): string {
    if (status === null) {
      return '\x1b[33mSKIPPED\x1b[0m';
    }
    return status
      ? '\x1b[32mPASSED\x1b[0m'
      : '\x1b[31mFAILED\x1b[0m';
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Vorion Air-Gap Bundle Verification Tool

Usage: verify-bundle.ts <bundle-path> [options]

Arguments:
  bundle-path               Path to bundle (.tar.gz or directory)

Options:
  -k, --public-key <path>   Public key for signature verification
  -t, --target <version>    Target version for compatibility check
  -v, --verbose             Show detailed output
  --skip-signature          Skip signature verification
  -h, --help                Show this help message

Examples:
  ./verify-bundle.ts vorion-bundle-1.0.0.tar.gz
  ./verify-bundle.ts ./bundle-dir -k public.pem -v
  ./verify-bundle.ts bundle.tar.gz -t 1.5.0 --verbose
`);
    process.exit(0);
  }

  const options: VerificationOptions = {
    bundlePath: args[0],
    verbose: false,
    skipSignature: false,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '-k':
      case '--public-key':
        options.publicKeyPath = args[++i];
        break;
      case '-t':
      case '--target':
        options.targetVersion = args[++i];
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '--skip-signature':
        options.skipSignature = true;
        break;
    }
  }

  if (!fs.existsSync(options.bundlePath)) {
    console.error(`Error: Bundle not found: ${options.bundlePath}`);
    process.exit(1);
  }

  const verifier = new BundleVerifier(options);
  const result = await verifier.verify();

  process.exit(result.valid ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { BundleVerifier, VerificationOptions, VerificationResult };
