#!/usr/bin/env ts-node
/**
 * Offline License Manager
 *
 * Manages software licensing for air-gapped deployments:
 * - Hardware fingerprinting
 * - Offline license validation
 * - License file format
 * - Expiration handling without network
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

interface HardwareFingerprint {
  cpuId: string;
  motherboardId: string;
  macAddresses: string[];
  diskIds: string[];
  hostname: string;
  platform: string;
  combined: string;
}

interface LicenseFeature {
  name: string;
  enabled: boolean;
  limit?: number;
  metadata?: Record<string, unknown>;
}

interface License {
  id: string;
  version: string;
  type: 'trial' | 'standard' | 'professional' | 'enterprise' | 'unlimited';
  licensee: {
    name: string;
    organization: string;
    email: string;
  };
  issuedAt: string;
  expiresAt: string | null; // null = perpetual
  hardwareFingerprint: string;
  maxUsers: number;
  maxNodes: number;
  features: LicenseFeature[];
  metadata: {
    issuer: string;
    supportLevel: string;
    notes?: string;
  };
  signature: string;
}

interface LicenseFile {
  format: 'v1';
  data: string; // Base64 encoded license JSON
  signature: string;
  checksum: string;
}

interface LicenseValidationResult {
  valid: boolean;
  license?: License;
  errors: string[];
  warnings: string[];
  status: 'valid' | 'expired' | 'invalid_hardware' | 'invalid_signature' | 'corrupted' | 'not_found';
  daysRemaining?: number;
}

interface LicenseGenerationOptions {
  licensee: {
    name: string;
    organization: string;
    email: string;
  };
  type: License['type'];
  expiresIn?: number; // days, null for perpetual
  maxUsers: number;
  maxNodes: number;
  features: string[];
  hardwareFingerprint?: string;
}

// ============================================================================
// Constants
// ============================================================================

const LICENSE_MAGIC = 'VORION-LICENSE-V1';
const DEFAULT_FEATURES: Record<string, LicenseFeature> = {
  core: { name: 'Core Features', enabled: true },
  api: { name: 'API Access', enabled: true },
  sso: { name: 'Single Sign-On', enabled: false },
  audit: { name: 'Audit Logging', enabled: true },
  backup: { name: 'Automated Backups', enabled: true },
  ha: { name: 'High Availability', enabled: false },
  multiTenant: { name: 'Multi-Tenancy', enabled: false },
  customBranding: { name: 'Custom Branding', enabled: false },
  advancedReporting: { name: 'Advanced Reporting', enabled: false },
  prioritySupport: { name: 'Priority Support', enabled: false },
};

const LICENSE_TYPES: Record<License['type'], { features: string[]; maxUsers: number; maxNodes: number }> = {
  trial: {
    features: ['core', 'api', 'audit'],
    maxUsers: 5,
    maxNodes: 1,
  },
  standard: {
    features: ['core', 'api', 'audit', 'backup'],
    maxUsers: 25,
    maxNodes: 1,
  },
  professional: {
    features: ['core', 'api', 'audit', 'backup', 'sso', 'advancedReporting'],
    maxUsers: 100,
    maxNodes: 3,
  },
  enterprise: {
    features: ['core', 'api', 'audit', 'backup', 'sso', 'ha', 'multiTenant', 'customBranding', 'advancedReporting', 'prioritySupport'],
    maxUsers: 0, // unlimited
    maxNodes: 0, // unlimited
  },
  unlimited: {
    features: Object.keys(DEFAULT_FEATURES),
    maxUsers: 0,
    maxNodes: 0,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' | 'debug' = 'info'): void {
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
    debug: '\x1b[90m',
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${level.toUpperCase()}]${reset} ${message}`);
}

function execSafe(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ============================================================================
// Hardware Fingerprinting
// ============================================================================

class HardwareFingerprintGenerator {
  static generate(): HardwareFingerprint {
    const cpuId = this.getCpuId();
    const motherboardId = this.getMotherboardId();
    const macAddresses = this.getMacAddresses();
    const diskIds = this.getDiskIds();
    const hostname = os.hostname();
    const platform = os.platform();

    // Combine for overall fingerprint
    const combined = hashString([
      cpuId,
      motherboardId,
      ...macAddresses.slice(0, 2), // Use first 2 MACs for stability
      ...diskIds.slice(0, 2),
      platform,
    ].join('|'));

    return {
      cpuId,
      motherboardId,
      macAddresses,
      diskIds,
      hostname,
      platform,
      combined,
    };
  }

  private static getCpuId(): string {
    const platform = os.platform();

    if (platform === 'linux') {
      // Try multiple methods
      let cpuId = execSafe('cat /proc/cpuinfo | grep "Serial\\|model name" | head -2');
      if (!cpuId) {
        cpuId = execSafe('dmidecode -t processor 2>/dev/null | grep ID');
      }
      return hashString(cpuId || os.cpus()[0]?.model || 'unknown');
    }

    if (platform === 'darwin') {
      const cpuBrand = execSafe('sysctl -n machdep.cpu.brand_string');
      const cpuSerial = execSafe('ioreg -l | grep IOPlatformSerialNumber');
      return hashString(`${cpuBrand}|${cpuSerial}`);
    }

    if (platform === 'win32') {
      const cpuId = execSafe('wmic cpu get processorid');
      return hashString(cpuId || 'unknown');
    }

    return hashString(os.cpus()[0]?.model || 'unknown');
  }

  private static getMotherboardId(): string {
    const platform = os.platform();

    if (platform === 'linux') {
      const uuid = execSafe('cat /sys/class/dmi/id/product_uuid 2>/dev/null');
      const serial = execSafe('cat /sys/class/dmi/id/product_serial 2>/dev/null');
      return hashString(`${uuid}|${serial}`);
    }

    if (platform === 'darwin') {
      const uuid = execSafe('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID');
      return hashString(uuid);
    }

    if (platform === 'win32') {
      const uuid = execSafe('wmic baseboard get serialnumber');
      return hashString(uuid);
    }

    return hashString('unknown-motherboard');
  }

  private static getMacAddresses(): string[] {
    const interfaces = os.networkInterfaces();
    const macs: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const info of iface) {
          if (info.mac && info.mac !== '00:00:00:00:00:00' && !info.internal) {
            macs.push(info.mac.toLowerCase());
          }
        }
      }
    }

    return [...new Set(macs)].sort();
  }

  private static getDiskIds(): string[] {
    const platform = os.platform();
    const ids: string[] = [];

    if (platform === 'linux') {
      const diskByUuid = execSafe('ls -la /dev/disk/by-uuid 2>/dev/null');
      const uuids = diskByUuid.match(/[a-f0-9-]{36}/gi) || [];
      ids.push(...uuids.slice(0, 3).map((u) => hashString(u)));
    }

    if (platform === 'darwin') {
      const diskInfo = execSafe('diskutil info / | grep "Volume UUID"');
      const uuid = diskInfo.match(/[A-F0-9-]{36}/i);
      if (uuid) {
        ids.push(hashString(uuid[0]));
      }
    }

    if (platform === 'win32') {
      const diskSerial = execSafe('wmic diskdrive get serialnumber');
      const serials = diskSerial.split('\n').filter((s) => s.trim());
      ids.push(...serials.slice(1).map((s) => hashString(s.trim())));
    }

    return ids;
  }

  static compare(fp1: string, fp2: string, tolerance = 0.8): boolean {
    if (fp1 === fp2) return true;

    // For more sophisticated comparison, we could decode and compare components
    // For now, require exact match
    return false;
  }
}

// ============================================================================
// License Manager
// ============================================================================

class LicenseManager {
  private publicKeyPath: string;
  private privateKeyPath: string | null;
  private licensePath: string;
  private currentLicense: License | null = null;
  private currentFingerprint: HardwareFingerprint;

  constructor(options: {
    publicKeyPath?: string;
    privateKeyPath?: string;
    licensePath?: string;
  } = {}) {
    const baseDir = path.join(__dirname, '..', '..');
    this.publicKeyPath = options.publicKeyPath || path.join(baseDir, 'license-public.pem');
    this.privateKeyPath = options.privateKeyPath || null;
    this.licensePath = options.licensePath || path.join(baseDir, 'license.key');
    this.currentFingerprint = HardwareFingerprintGenerator.generate();
  }

  // =========================================================================
  // Key Management
  // =========================================================================

  generateKeyPair(outputDir: string): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    const publicKeyPath = path.join(outputDir, 'license-public.pem');
    const privateKeyPath = path.join(outputDir, 'license-private.pem');

    fs.writeFileSync(publicKeyPath, publicKey);
    fs.writeFileSync(privateKeyPath, privateKey);
    fs.chmodSync(privateKeyPath, 0o600);

    log(`Generated key pair in ${outputDir}`, 'success');
    log(`  Public key: ${publicKeyPath}`, 'info');
    log(`  Private key: ${privateKeyPath} (keep secure!)`, 'info');

    return { publicKey, privateKey };
  }

  // =========================================================================
  // License Generation (for vendor use)
  // =========================================================================

  generateLicense(options: LicenseGenerationOptions): License {
    if (!this.privateKeyPath || !fs.existsSync(this.privateKeyPath)) {
      throw new Error('Private key required for license generation');
    }

    const licenseType = LICENSE_TYPES[options.type];
    const features: LicenseFeature[] = [];

    // Build feature list
    for (const featureName of Object.keys(DEFAULT_FEATURES)) {
      const feature = { ...DEFAULT_FEATURES[featureName] };
      feature.enabled = options.features.includes(featureName) ||
        licenseType.features.includes(featureName);
      features.push(feature);
    }

    const now = new Date();
    const expiresAt = options.expiresIn
      ? new Date(now.getTime() + options.expiresIn * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const license: License = {
      id: crypto.randomUUID(),
      version: '1.0',
      type: options.type,
      licensee: options.licensee,
      issuedAt: now.toISOString(),
      expiresAt,
      hardwareFingerprint: options.hardwareFingerprint || '*', // * = any hardware
      maxUsers: options.maxUsers || licenseType.maxUsers,
      maxNodes: options.maxNodes || licenseType.maxNodes,
      features,
      metadata: {
        issuer: 'Vorion License Authority',
        supportLevel: options.type === 'enterprise' ? 'priority' : 'standard',
      },
      signature: '', // Will be set below
    };

    // Sign the license
    license.signature = this.signLicense(license);

    return license;
  }

  private signLicense(license: License): string {
    if (!this.privateKeyPath) {
      throw new Error('Private key path not set');
    }

    const privateKey = fs.readFileSync(this.privateKeyPath, 'utf8');
    const licenseData = this.getLicenseDataForSigning(license);

    const sign = crypto.createSign('SHA256');
    sign.update(licenseData);
    sign.end();

    return sign.sign(privateKey, 'base64');
  }

  private getLicenseDataForSigning(license: License): string {
    // Create a copy without the signature for signing
    const { signature, ...licenseData } = license;
    return JSON.stringify(licenseData, Object.keys(licenseData).sort());
  }

  // =========================================================================
  // License File Operations
  // =========================================================================

  exportLicenseFile(license: License, outputPath: string): void {
    const licenseJson = JSON.stringify(license);
    const licenseBase64 = Buffer.from(licenseJson).toString('base64');

    const licenseFile: LicenseFile = {
      format: 'v1',
      data: licenseBase64,
      signature: license.signature,
      checksum: hashString(licenseJson),
    };

    // Create human-readable format with encoded data
    const fileContent = [
      LICENSE_MAGIC,
      '---',
      `ID: ${license.id}`,
      `Type: ${license.type}`,
      `Licensee: ${license.licensee.organization}`,
      `Issued: ${license.issuedAt}`,
      `Expires: ${license.expiresAt || 'Never'}`,
      '---',
      'DATA:',
      licenseFile.data.match(/.{1,76}/g)?.join('\n') || licenseFile.data,
      '---',
      `SIGNATURE: ${licenseFile.signature}`,
      `CHECKSUM: ${licenseFile.checksum}`,
      '---',
      'END ' + LICENSE_MAGIC,
    ].join('\n');

    fs.writeFileSync(outputPath, fileContent);
    log(`License exported to ${outputPath}`, 'success');
  }

  importLicenseFile(filePath: string): License {
    if (!fs.existsSync(filePath)) {
      throw new Error(`License file not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Verify magic header
    if (!fileContent.startsWith(LICENSE_MAGIC)) {
      throw new Error('Invalid license file format');
    }

    // Extract data section
    const dataMatch = fileContent.match(/DATA:\n([\s\S]+?)\n---\nSIGNATURE:/);
    if (!dataMatch) {
      throw new Error('Could not extract license data');
    }

    const licenseBase64 = dataMatch[1].replace(/\n/g, '');
    const licenseJson = Buffer.from(licenseBase64, 'base64').toString('utf8');
    const license: License = JSON.parse(licenseJson);

    // Extract and verify checksum
    const checksumMatch = fileContent.match(/CHECKSUM: ([a-f0-9]+)/);
    if (checksumMatch) {
      const expectedChecksum = checksumMatch[1];
      const actualChecksum = hashString(licenseJson);
      if (actualChecksum !== expectedChecksum) {
        throw new Error('License file checksum mismatch');
      }
    }

    return license;
  }

  // =========================================================================
  // License Validation
  // =========================================================================

  validateLicense(license?: License): LicenseValidationResult {
    const result: LicenseValidationResult = {
      valid: false,
      errors: [],
      warnings: [],
      status: 'not_found',
    };

    // Load license if not provided
    if (!license) {
      try {
        license = this.importLicenseFile(this.licensePath);
      } catch (error) {
        result.errors.push(`Failed to load license: ${error}`);
        result.status = 'not_found';
        return result;
      }
    }

    result.license = license;

    // Verify signature
    if (!this.verifySignature(license)) {
      result.errors.push('Invalid license signature');
      result.status = 'invalid_signature';
      return result;
    }

    // Check expiration
    if (license.expiresAt) {
      const expiresAt = new Date(license.expiresAt);
      const now = new Date();

      if (expiresAt < now) {
        result.errors.push(`License expired on ${license.expiresAt}`);
        result.status = 'expired';
        return result;
      }

      const daysRemaining = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      );
      result.daysRemaining = daysRemaining;

      if (daysRemaining <= 30) {
        result.warnings.push(`License expires in ${daysRemaining} days`);
      }
    }

    // Check hardware fingerprint
    if (license.hardwareFingerprint !== '*') {
      if (!HardwareFingerprintGenerator.compare(
        license.hardwareFingerprint,
        this.currentFingerprint.combined
      )) {
        result.errors.push('Hardware fingerprint mismatch');
        result.status = 'invalid_hardware';
        return result;
      }
    }

    // All checks passed
    result.valid = true;
    result.status = 'valid';
    this.currentLicense = license;

    return result;
  }

  private verifySignature(license: License): boolean {
    if (!fs.existsSync(this.publicKeyPath)) {
      log('Public key not found, skipping signature verification', 'warn');
      return true; // Allow if no public key (development mode)
    }

    try {
      const publicKey = fs.readFileSync(this.publicKeyPath, 'utf8');
      const licenseData = this.getLicenseDataForSigning(license);

      const verify = crypto.createVerify('SHA256');
      verify.update(licenseData);
      verify.end();

      return verify.verify(publicKey, license.signature, 'base64');
    } catch (error) {
      log(`Signature verification error: ${error}`, 'error');
      return false;
    }
  }

  // =========================================================================
  // Feature Checking
  // =========================================================================

  isFeatureEnabled(featureName: string): boolean {
    if (!this.currentLicense) {
      const validation = this.validateLicense();
      if (!validation.valid) {
        return false;
      }
    }

    const feature = this.currentLicense?.features.find(
      (f) => f.name.toLowerCase() === featureName.toLowerCase() ||
        f.name.toLowerCase().replace(/\s+/g, '') === featureName.toLowerCase()
    );

    return feature?.enabled || false;
  }

  getFeatureLimit(featureName: string): number | null {
    if (!this.currentLicense) {
      return null;
    }

    const feature = this.currentLicense.features.find(
      (f) => f.name.toLowerCase() === featureName.toLowerCase()
    );

    return feature?.limit ?? null;
  }

  getMaxUsers(): number {
    return this.currentLicense?.maxUsers || 0;
  }

  getMaxNodes(): number {
    return this.currentLicense?.maxNodes || 0;
  }

  getLicenseType(): License['type'] | null {
    return this.currentLicense?.type || null;
  }

  // =========================================================================
  // Hardware Fingerprint
  // =========================================================================

  getCurrentFingerprint(): HardwareFingerprint {
    return this.currentFingerprint;
  }

  refreshFingerprint(): HardwareFingerprint {
    this.currentFingerprint = HardwareFingerprintGenerator.generate();
    return this.currentFingerprint;
  }

  // =========================================================================
  // Status Report
  // =========================================================================

  printStatus(): void {
    const validation = this.validateLicense();

    console.log('\n' + '='.repeat(60));
    console.log('LICENSE STATUS');
    console.log('='.repeat(60));

    console.log(`\nStatus: ${this.formatStatus(validation.status)}`);

    if (validation.license) {
      const license = validation.license;
      console.log(`\nLicense Details:`);
      console.log(`  ID: ${license.id}`);
      console.log(`  Type: ${license.type.toUpperCase()}`);
      console.log(`  Licensee: ${license.licensee.organization}`);
      console.log(`  Contact: ${license.licensee.email}`);
      console.log(`  Issued: ${license.issuedAt}`);
      console.log(`  Expires: ${license.expiresAt || 'Never (Perpetual)'}`);

      if (validation.daysRemaining !== undefined) {
        console.log(`  Days Remaining: ${validation.daysRemaining}`);
      }

      console.log(`\nLimits:`);
      console.log(`  Max Users: ${license.maxUsers || 'Unlimited'}`);
      console.log(`  Max Nodes: ${license.maxNodes || 'Unlimited'}`);

      console.log(`\nFeatures:`);
      for (const feature of license.features) {
        const status = feature.enabled
          ? '\x1b[32mENABLED\x1b[0m'
          : '\x1b[90mDISABLED\x1b[0m';
        console.log(`  ${feature.name}: ${status}`);
      }
    }

    if (validation.errors.length > 0) {
      console.log(`\nErrors:`);
      for (const error of validation.errors) {
        console.log(`  \x1b[31m- ${error}\x1b[0m`);
      }
    }

    if (validation.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const warning of validation.warnings) {
        console.log(`  \x1b[33m- ${warning}\x1b[0m`);
      }
    }

    console.log(`\nHardware Fingerprint:`);
    console.log(`  Combined: ${this.currentFingerprint.combined}`);
    console.log(`  Platform: ${this.currentFingerprint.platform}`);
    console.log(`  Hostname: ${this.currentFingerprint.hostname}`);

    console.log('\n' + '='.repeat(60) + '\n');
  }

  private formatStatus(status: LicenseValidationResult['status']): string {
    const colors: Record<string, string> = {
      valid: '\x1b[32m',
      expired: '\x1b[31m',
      invalid_hardware: '\x1b[31m',
      invalid_signature: '\x1b[31m',
      corrupted: '\x1b[31m',
      not_found: '\x1b[33m',
    };
    const reset = '\x1b[0m';
    return `${colors[status] || ''}${status.toUpperCase().replace(/_/g, ' ')}${reset}`;
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Vorion Offline License Manager

Usage: license-manager.ts <command> [options]

Commands:
  status                    Show current license status
  validate                  Validate license file
  fingerprint               Generate hardware fingerprint
  generate-keys             Generate signing key pair (vendor only)
  generate                  Generate a new license (vendor only)
  export                    Export license to file

Options:
  --license <path>          Path to license file
  --public-key <path>       Path to public key
  --private-key <path>      Path to private key (vendor only)
  -h, --help                Show this help message

License Generation Options (with generate command):
  --type <type>             License type (trial, standard, professional, enterprise)
  --org <name>              Organization name
  --email <email>           Contact email
  --name <name>             Contact name
  --expires <days>          Days until expiration (omit for perpetual)
  --fingerprint <fp>        Hardware fingerprint (or '*' for any)
  --output <path>           Output file path

Examples:
  ./license-manager.ts status
  ./license-manager.ts validate --license /path/to/license.key
  ./license-manager.ts fingerprint
  ./license-manager.ts generate-keys --output ./keys
  ./license-manager.ts generate --type enterprise --org "ACME Corp" --email admin@acme.com
`);
    process.exit(0);
  }

  // Parse options
  const options: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      options[key] = args[i + 1] || '';
      i++;
    }
  }

  const manager = new LicenseManager({
    licensePath: options.license,
    publicKeyPath: options['public-key'],
    privateKeyPath: options['private-key'],
  });

  switch (command) {
    case 'status':
      manager.printStatus();
      break;

    case 'validate':
      const validation = manager.validateLicense();
      manager.printStatus();
      process.exit(validation.valid ? 0 : 1);
      break;

    case 'fingerprint':
      const fp = manager.getCurrentFingerprint();
      console.log('\nHardware Fingerprint:');
      console.log(`  Combined: ${fp.combined}`);
      console.log(`  CPU ID: ${fp.cpuId}`);
      console.log(`  Motherboard: ${fp.motherboardId}`);
      console.log(`  MAC Addresses: ${fp.macAddresses.join(', ')}`);
      console.log(`  Disk IDs: ${fp.diskIds.join(', ')}`);
      console.log(`  Platform: ${fp.platform}`);
      console.log(`  Hostname: ${fp.hostname}`);
      break;

    case 'generate-keys':
      const outputDir = options.output || './keys';
      fs.mkdirSync(outputDir, { recursive: true });
      manager.generateKeyPair(outputDir);
      break;

    case 'generate':
      if (!options['private-key']) {
        log('Private key required for license generation', 'error');
        process.exit(1);
      }

      const license = manager.generateLicense({
        type: (options.type as License['type']) || 'standard',
        licensee: {
          name: options.name || 'Unknown',
          organization: options.org || 'Unknown Organization',
          email: options.email || 'unknown@example.com',
        },
        expiresIn: options.expires ? parseInt(options.expires, 10) : undefined,
        maxUsers: options.users ? parseInt(options.users, 10) : 0,
        maxNodes: options.nodes ? parseInt(options.nodes, 10) : 0,
        features: options.features?.split(',') || [],
        hardwareFingerprint: options.fingerprint || '*',
      });

      const outputPath = options.output || './generated-license.key';
      manager.exportLicenseFile(license, outputPath);

      console.log('\nGenerated License:');
      console.log(`  ID: ${license.id}`);
      console.log(`  Type: ${license.type}`);
      console.log(`  Licensee: ${license.licensee.organization}`);
      console.log(`  Expires: ${license.expiresAt || 'Never'}`);
      console.log(`  Output: ${outputPath}`);
      break;

    case 'export':
      const validationResult = manager.validateLicense();
      if (validationResult.valid && validationResult.license) {
        const exportPath = options.output || './license-export.key';
        manager.exportLicenseFile(validationResult.license, exportPath);
      } else {
        log('No valid license to export', 'error');
        process.exit(1);
      }
      break;

    default:
      log(`Unknown command: ${command}`, 'error');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export {
  LicenseManager,
  HardwareFingerprintGenerator,
  License,
  LicenseValidationResult,
  HardwareFingerprint,
};
