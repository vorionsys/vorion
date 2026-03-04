#!/usr/bin/env ts-node
/**
 * Offline Update Manager
 *
 * Manages software updates for air-gapped deployments:
 * - Delta update bundles
 * - Rollback capability
 * - Update verification
 * - Changelog tracking
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

interface UpdateManifest {
  id: string;
  version: string;
  previousVersion: string;
  releaseDate: string;
  updateType: 'full' | 'delta' | 'patch' | 'security';
  size: number;
  checksum: string;
  signature: string;
  components: UpdateComponent[];
  changelog: ChangelogEntry[];
  dependencies: {
    minVersion: string;
    docker?: string;
    nodeJs?: string;
    postgresql?: string;
  };
  rollback: {
    supported: boolean;
    snapshotRequired: boolean;
  };
  preChecks: PreCheck[];
  postActions: PostAction[];
}

interface UpdateComponent {
  name: string;
  type: 'docker-image' | 'database-migration' | 'config' | 'script' | 'binary';
  action: 'add' | 'update' | 'remove';
  source: string;
  target?: string;
  checksum: string;
  size: number;
  rollbackSource?: string;
}

interface ChangelogEntry {
  type: 'feature' | 'bugfix' | 'security' | 'improvement' | 'breaking';
  title: string;
  description: string;
  issueId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

interface PreCheck {
  id: string;
  name: string;
  type: 'disk-space' | 'service-status' | 'version-check' | 'custom';
  command?: string;
  expected?: string;
  required: boolean;
}

interface PostAction {
  id: string;
  name: string;
  type: 'restart-service' | 'run-migration' | 'clear-cache' | 'custom';
  command?: string;
  rollbackCommand?: string;
  required: boolean;
}

interface UpdateHistory {
  updates: UpdateRecord[];
  currentVersion: string;
  lastUpdateDate: string;
}

interface UpdateRecord {
  id: string;
  version: string;
  previousVersion: string;
  appliedAt: string;
  status: 'success' | 'failed' | 'rolled-back';
  snapshot?: string;
  notes?: string;
}

interface Snapshot {
  id: string;
  version: string;
  createdAt: string;
  path: string;
  size: number;
  components: string[];
}

interface UpdateResult {
  success: boolean;
  version: string;
  previousVersion: string;
  components: { name: string; status: 'success' | 'failed' | 'skipped' }[];
  errors: string[];
  warnings: string[];
  duration: number;
  rollbackAvailable: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' | 'debug' = 'info'): void {
  const timestamp = new Date().toISOString();
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
    debug: '\x1b[90m',
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}`);
}

function execCommand(command: string, options: { cwd?: string; silent?: boolean } = {}): {
  success: boolean;
  output: string;
} {
  try {
    const output = execSync(command, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
    });
    return { success: true, output: output?.toString().trim() || '' };
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function calculateChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
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
// Update Manager
// ============================================================================

class UpdateManager {
  private installDir: string;
  private updateDir: string;
  private snapshotDir: string;
  private historyPath: string;
  private publicKeyPath: string;
  private history: UpdateHistory;

  constructor(options: {
    installDir?: string;
    updateDir?: string;
    snapshotDir?: string;
    publicKeyPath?: string;
  } = {}) {
    this.installDir = options.installDir || '/opt/vorion';
    this.updateDir = options.updateDir || path.join(this.installDir, 'updates');
    this.snapshotDir = options.snapshotDir || path.join(this.installDir, 'snapshots');
    this.publicKeyPath = options.publicKeyPath || path.join(this.installDir, 'update-public.pem');
    this.historyPath = path.join(this.installDir, 'update-history.json');

    // Ensure directories exist
    fs.mkdirSync(this.updateDir, { recursive: true });
    fs.mkdirSync(this.snapshotDir, { recursive: true });

    this.history = this.loadHistory();
  }

  private loadHistory(): UpdateHistory {
    if (fs.existsSync(this.historyPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      } catch {
        log('Failed to load update history, starting fresh', 'warn');
      }
    }

    return {
      updates: [],
      currentVersion: '1.0.0',
      lastUpdateDate: new Date().toISOString(),
    };
  }

  private saveHistory(): void {
    fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2));
  }

  // =========================================================================
  // Update Package Handling
  // =========================================================================

  async importUpdatePackage(packagePath: string): Promise<UpdateManifest> {
    log(`Importing update package: ${packagePath}`, 'info');

    if (!fs.existsSync(packagePath)) {
      throw new Error(`Update package not found: ${packagePath}`);
    }

    // Extract package
    const extractDir = path.join(this.updateDir, `extract-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      execCommand(`tar -xzf "${packagePath}" -C "${extractDir}"`, { silent: true });
    } catch (error) {
      throw new Error(`Failed to extract update package: ${error}`);
    }

    // Find and validate manifest
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(extractDir, { recursive: true });
      throw new Error('Update package missing manifest.json');
    }

    const manifest: UpdateManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Verify signature
    if (!await this.verifyPackageSignature(manifest, extractDir)) {
      fs.rmSync(extractDir, { recursive: true });
      throw new Error('Update package signature verification failed');
    }

    // Verify checksums
    if (!await this.verifyComponentChecksums(manifest, extractDir)) {
      fs.rmSync(extractDir, { recursive: true });
      throw new Error('Update package checksum verification failed');
    }

    // Move to updates directory
    const targetDir = path.join(this.updateDir, manifest.id);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }
    fs.renameSync(extractDir, targetDir);

    log(`Update package imported: ${manifest.version}`, 'success');
    return manifest;
  }

  private async verifyPackageSignature(manifest: UpdateManifest, packageDir: string): Promise<boolean> {
    if (!fs.existsSync(this.publicKeyPath)) {
      log('Public key not found, skipping signature verification', 'warn');
      return true;
    }

    const signaturePath = path.join(packageDir, 'signature.sig');
    const manifestPath = path.join(packageDir, 'manifest.json');

    if (!fs.existsSync(signaturePath)) {
      log('No signature file found', 'warn');
      return true;
    }

    const result = execCommand(
      `openssl dgst -sha256 -verify "${this.publicKeyPath}" -signature "${signaturePath}" "${manifestPath}"`,
      { silent: true }
    );

    return result.success;
  }

  private async verifyComponentChecksums(manifest: UpdateManifest, packageDir: string): Promise<boolean> {
    for (const component of manifest.components) {
      const componentPath = path.join(packageDir, component.source);

      if (!fs.existsSync(componentPath)) {
        if (component.action !== 'remove') {
          log(`Component not found: ${component.name}`, 'error');
          return false;
        }
        continue;
      }

      const actualChecksum = calculateChecksum(componentPath);
      if (actualChecksum !== component.checksum) {
        log(`Checksum mismatch for ${component.name}`, 'error');
        return false;
      }
    }

    return true;
  }

  // =========================================================================
  // Pre-Update Checks
  // =========================================================================

  async runPreChecks(manifest: UpdateManifest): Promise<{ passed: boolean; results: { check: PreCheck; passed: boolean; message: string }[] }> {
    log('Running pre-update checks...', 'info');

    const results: { check: PreCheck; passed: boolean; message: string }[] = [];
    let allPassed = true;

    // Version compatibility check
    if (compareVersions(this.history.currentVersion, manifest.dependencies.minVersion) < 0) {
      results.push({
        check: {
          id: 'version-check',
          name: 'Version Compatibility',
          type: 'version-check',
          required: true,
        },
        passed: false,
        message: `Current version ${this.history.currentVersion} is below minimum ${manifest.dependencies.minVersion}`,
      });
      allPassed = false;
    } else {
      results.push({
        check: {
          id: 'version-check',
          name: 'Version Compatibility',
          type: 'version-check',
          required: true,
        },
        passed: true,
        message: `Version ${this.history.currentVersion} meets requirements`,
      });
    }

    // Custom pre-checks
    for (const check of manifest.preChecks) {
      let passed = true;
      let message = '';

      switch (check.type) {
        case 'disk-space':
          const availableSpace = this.getAvailableDiskSpace();
          const requiredSpace = manifest.size * 2; // Need 2x for safety
          passed = availableSpace >= requiredSpace;
          message = passed
            ? `Sufficient disk space: ${formatBytes(availableSpace)}`
            : `Insufficient disk space: ${formatBytes(availableSpace)} < ${formatBytes(requiredSpace)}`;
          break;

        case 'service-status':
          if (check.command) {
            const result = execCommand(check.command, { silent: true });
            passed = result.success && (!check.expected || result.output.includes(check.expected));
            message = passed ? 'Service check passed' : `Service check failed: ${result.output}`;
          }
          break;

        case 'custom':
          if (check.command) {
            const result = execCommand(check.command, { silent: true });
            passed = result.success;
            message = result.output || (passed ? 'Check passed' : 'Check failed');
          }
          break;
      }

      results.push({ check, passed, message });

      if (!passed && check.required) {
        allPassed = false;
      }
    }

    // Print results
    for (const result of results) {
      const status = result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      const required = result.check.required ? '' : ' (optional)';
      log(`  [${status}] ${result.check.name}${required}: ${result.message}`, 'info');
    }

    return { passed: allPassed, results };
  }

  private getAvailableDiskSpace(): number {
    try {
      const result = execCommand(`df -B1 "${this.installDir}" | tail -1 | awk '{print $4}'`, { silent: true });
      return parseInt(result.output, 10) || 0;
    } catch {
      return 0;
    }
  }

  // =========================================================================
  // Snapshot Management
  // =========================================================================

  async createSnapshot(version: string, components?: string[]): Promise<Snapshot> {
    log(`Creating snapshot for version ${version}...`, 'info');

    const snapshotId = `snapshot-${version}-${Date.now()}`;
    const snapshotPath = path.join(this.snapshotDir, `${snapshotId}.tar.gz`);

    // Determine what to backup
    const dirsToBackup = components || ['config', 'database', 'docker-images'];
    const existingDirs = dirsToBackup.filter((dir) =>
      fs.existsSync(path.join(this.installDir, dir))
    );

    if (existingDirs.length === 0) {
      throw new Error('No directories to snapshot');
    }

    // Create tarball
    const tarArgs = existingDirs.map((dir) => `"${dir}"`).join(' ');
    const result = execCommand(
      `tar -czf "${snapshotPath}" -C "${this.installDir}" ${tarArgs}`,
      { silent: true }
    );

    if (!result.success) {
      throw new Error(`Failed to create snapshot: ${result.output}`);
    }

    const stats = fs.statSync(snapshotPath);

    const snapshot: Snapshot = {
      id: snapshotId,
      version,
      createdAt: new Date().toISOString(),
      path: snapshotPath,
      size: stats.size,
      components: existingDirs,
    };

    // Save snapshot metadata
    const metadataPath = path.join(this.snapshotDir, `${snapshotId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(snapshot, null, 2));

    log(`Snapshot created: ${snapshotPath} (${formatBytes(stats.size)})`, 'success');

    return snapshot;
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    log(`Restoring snapshot: ${snapshotId}...`, 'info');

    const metadataPath = path.join(this.snapshotDir, `${snapshotId}.json`);
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const snapshot: Snapshot = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    if (!fs.existsSync(snapshot.path)) {
      throw new Error(`Snapshot archive not found: ${snapshot.path}`);
    }

    // Stop services before restore
    log('Stopping services...', 'info');
    execCommand(`docker compose -f "${this.installDir}/docker-compose.yml" down`, { silent: true });

    // Backup current state
    await this.createSnapshot(`pre-restore-${Date.now()}`);

    // Restore snapshot
    const result = execCommand(
      `tar -xzf "${snapshot.path}" -C "${this.installDir}"`,
      { silent: true }
    );

    if (!result.success) {
      throw new Error(`Failed to restore snapshot: ${result.output}`);
    }

    // Restart services
    log('Restarting services...', 'info');
    execCommand(`docker compose -f "${this.installDir}/docker-compose.yml" up -d`, { silent: true });

    log(`Snapshot restored: ${snapshotId}`, 'success');
  }

  listSnapshots(): Snapshot[] {
    const snapshots: Snapshot[] = [];

    const files = fs.readdirSync(this.snapshotDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const metadataPath = path.join(this.snapshotDir, file);
        try {
          const snapshot: Snapshot = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (fs.existsSync(snapshot.path)) {
            snapshots.push(snapshot);
          }
        } catch {
          // Skip invalid metadata
        }
      }
    }

    return snapshots.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // =========================================================================
  // Update Application
  // =========================================================================

  async applyUpdate(manifestOrId: UpdateManifest | string): Promise<UpdateResult> {
    const startTime = Date.now();

    // Load manifest if ID provided
    let manifest: UpdateManifest;
    let updateDir: string;

    if (typeof manifestOrId === 'string') {
      updateDir = path.join(this.updateDir, manifestOrId);
      const manifestPath = path.join(updateDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Update not found: ${manifestOrId}`);
      }
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } else {
      manifest = manifestOrId;
      updateDir = path.join(this.updateDir, manifest.id);
    }

    log(`Applying update ${manifest.version}...`, 'info');

    const result: UpdateResult = {
      success: false,
      version: manifest.version,
      previousVersion: this.history.currentVersion,
      components: [],
      errors: [],
      warnings: [],
      duration: 0,
      rollbackAvailable: false,
    };

    try {
      // Run pre-checks
      const preCheckResult = await this.runPreChecks(manifest);
      if (!preCheckResult.passed) {
        result.errors.push('Pre-update checks failed');
        return result;
      }

      // Create snapshot for rollback
      if (manifest.rollback.supported) {
        log('Creating rollback snapshot...', 'info');
        await this.createSnapshot(this.history.currentVersion);
        result.rollbackAvailable = true;
      }

      // Stop services
      log('Stopping services...', 'info');
      execCommand(`docker compose -f "${this.installDir}/docker-compose.yml" down`, { silent: true });

      // Apply components
      for (const component of manifest.components) {
        log(`  Processing: ${component.name}...`, 'info');

        try {
          await this.applyComponent(component, updateDir);
          result.components.push({ name: component.name, status: 'success' });
        } catch (error) {
          result.components.push({ name: component.name, status: 'failed' });
          result.errors.push(`Failed to apply ${component.name}: ${error}`);

          // Attempt rollback on failure
          if (manifest.rollback.supported) {
            log('Attempting rollback...', 'warn');
            await this.rollbackUpdate(manifest.id);
            return result;
          }
        }
      }

      // Run post-actions
      for (const action of manifest.postActions) {
        log(`  Running post-action: ${action.name}...`, 'info');

        try {
          await this.runPostAction(action);
        } catch (error) {
          if (action.required) {
            result.errors.push(`Post-action failed: ${action.name}`);
          } else {
            result.warnings.push(`Optional post-action failed: ${action.name}`);
          }
        }
      }

      // Start services
      log('Starting services...', 'info');
      execCommand(`docker compose -f "${this.installDir}/docker-compose.yml" up -d`, { silent: true });

      // Update history
      this.history.currentVersion = manifest.version;
      this.history.lastUpdateDate = new Date().toISOString();
      this.history.updates.push({
        id: manifest.id,
        version: manifest.version,
        previousVersion: result.previousVersion,
        appliedAt: new Date().toISOString(),
        status: 'success',
      });
      this.saveHistory();

      result.success = true;
      result.duration = Date.now() - startTime;

      log(`Update ${manifest.version} applied successfully in ${result.duration}ms`, 'success');

    } catch (error) {
      result.errors.push(`Update failed: ${error}`);
      result.duration = Date.now() - startTime;

      // Record failed update
      this.history.updates.push({
        id: manifest.id,
        version: manifest.version,
        previousVersion: result.previousVersion,
        appliedAt: new Date().toISOString(),
        status: 'failed',
        notes: String(error),
      });
      this.saveHistory();
    }

    return result;
  }

  private async applyComponent(component: UpdateComponent, updateDir: string): Promise<void> {
    const sourcePath = path.join(updateDir, component.source);

    switch (component.type) {
      case 'docker-image':
        await this.loadDockerImage(sourcePath);
        break;

      case 'database-migration':
        await this.runMigration(sourcePath);
        break;

      case 'config':
        await this.updateConfig(sourcePath, component.target);
        break;

      case 'script':
        await this.runScript(sourcePath);
        break;

      case 'binary':
        await this.updateBinary(sourcePath, component.target);
        break;
    }
  }

  private async loadDockerImage(imagePath: string): Promise<void> {
    const result = execCommand(`docker load -i "${imagePath}"`, { silent: true });
    if (!result.success) {
      throw new Error(`Failed to load Docker image: ${result.output}`);
    }
  }

  private async runMigration(migrationPath: string): Promise<void> {
    // Run migration SQL against PostgreSQL
    const result = execCommand(
      `docker exec vorion-postgres psql -U \${POSTGRES_USER:-vorion} -d \${POSTGRES_DB:-vorion} < "${migrationPath}"`,
      { silent: true }
    );
    if (!result.success) {
      throw new Error(`Migration failed: ${result.output}`);
    }
  }

  private async updateConfig(sourcePath: string, targetPath?: string): Promise<void> {
    const target = targetPath || path.join(this.installDir, 'config', path.basename(sourcePath));
    fs.copyFileSync(sourcePath, target);
  }

  private async runScript(scriptPath: string): Promise<void> {
    fs.chmodSync(scriptPath, '755');
    const result = execCommand(scriptPath, { cwd: this.installDir, silent: true });
    if (!result.success) {
      throw new Error(`Script failed: ${result.output}`);
    }
  }

  private async updateBinary(sourcePath: string, targetPath?: string): Promise<void> {
    const target = targetPath || path.join(this.installDir, 'bin', path.basename(sourcePath));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sourcePath, target);
    fs.chmodSync(target, '755');
  }

  private async runPostAction(action: PostAction): Promise<void> {
    switch (action.type) {
      case 'restart-service':
        execCommand(`docker compose -f "${this.installDir}/docker-compose.yml" restart`, { silent: true });
        break;

      case 'run-migration':
        if (action.command) {
          execCommand(action.command, { cwd: this.installDir, silent: true });
        }
        break;

      case 'clear-cache':
        execCommand('docker exec vorion-redis redis-cli FLUSHALL', { silent: true });
        break;

      case 'custom':
        if (action.command) {
          execCommand(action.command, { cwd: this.installDir, silent: true });
        }
        break;
    }
  }

  // =========================================================================
  // Rollback
  // =========================================================================

  async rollbackUpdate(updateId: string): Promise<void> {
    log(`Rolling back update: ${updateId}...`, 'info');

    // Find the update record
    const updateRecord = this.history.updates.find((u) => u.id === updateId);
    if (!updateRecord) {
      throw new Error(`Update record not found: ${updateId}`);
    }

    // Find snapshot
    const snapshots = this.listSnapshots();
    const snapshot = snapshots.find((s) => s.version === updateRecord.previousVersion);

    if (!snapshot) {
      throw new Error(`No snapshot available for version ${updateRecord.previousVersion}`);
    }

    // Restore snapshot
    await this.restoreSnapshot(snapshot.id);

    // Update history
    updateRecord.status = 'rolled-back';
    this.history.currentVersion = updateRecord.previousVersion;
    this.saveHistory();

    log(`Rolled back to version ${updateRecord.previousVersion}`, 'success');
  }

  // =========================================================================
  // Changelog
  // =========================================================================

  getChangelog(fromVersion?: string): ChangelogEntry[] {
    const changelog: ChangelogEntry[] = [];

    // Get all available updates
    const updates = fs.readdirSync(this.updateDir)
      .filter((dir) => {
        const manifestPath = path.join(this.updateDir, dir, 'manifest.json');
        return fs.existsSync(manifestPath);
      })
      .map((dir) => {
        const manifestPath = path.join(this.updateDir, dir, 'manifest.json');
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as UpdateManifest;
      })
      .filter((manifest) => {
        if (!fromVersion) return true;
        return compareVersions(manifest.version, fromVersion) > 0;
      })
      .sort((a, b) => compareVersions(b.version, a.version));

    for (const update of updates) {
      changelog.push(...update.changelog.map((entry) => ({
        ...entry,
        title: `[${update.version}] ${entry.title}`,
      })));
    }

    return changelog;
  }

  // =========================================================================
  // Status Report
  // =========================================================================

  printStatus(): void {
    console.log('\n' + '='.repeat(60));
    console.log('UPDATE MANAGER STATUS');
    console.log('='.repeat(60));

    console.log(`\nCurrent Version: ${this.history.currentVersion}`);
    console.log(`Last Update: ${this.history.lastUpdateDate}`);

    // Available updates
    const availableUpdates = this.getAvailableUpdates();
    console.log(`\nAvailable Updates: ${availableUpdates.length}`);
    for (const update of availableUpdates) {
      console.log(`  - ${update.version} (${update.updateType}): ${formatBytes(update.size)}`);
    }

    // Snapshots
    const snapshots = this.listSnapshots();
    console.log(`\nSnapshots: ${snapshots.length}`);
    for (const snapshot of snapshots.slice(0, 5)) {
      console.log(`  - ${snapshot.version} (${snapshot.createdAt}): ${formatBytes(snapshot.size)}`);
    }

    // Recent updates
    console.log(`\nRecent Update History:`);
    for (const update of this.history.updates.slice(-5).reverse()) {
      const status = update.status === 'success'
        ? '\x1b[32mSUCCESS\x1b[0m'
        : update.status === 'rolled-back'
          ? '\x1b[33mROLLED BACK\x1b[0m'
          : '\x1b[31mFAILED\x1b[0m';
      console.log(`  - ${update.version} (${update.appliedAt}): ${status}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  getAvailableUpdates(): UpdateManifest[] {
    const updates: UpdateManifest[] = [];

    try {
      const dirs = fs.readdirSync(this.updateDir);
      for (const dir of dirs) {
        const manifestPath = path.join(this.updateDir, dir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          const manifest: UpdateManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (compareVersions(manifest.version, this.history.currentVersion) > 0) {
            updates.push(manifest);
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return updates.sort((a, b) => compareVersions(a.version, b.version));
  }

  getCurrentVersion(): string {
    return this.history.currentVersion;
  }
}

// ============================================================================
// Delta Update Creator (for vendor use)
// ============================================================================

class DeltaUpdateCreator {
  static async createDeltaUpdate(
    oldVersionDir: string,
    newVersionDir: string,
    outputPath: string,
    options: {
      privateKeyPath?: string;
      changelog?: ChangelogEntry[];
    } = {}
  ): Promise<UpdateManifest> {
    log('Creating delta update package...', 'info');

    const oldManifest = JSON.parse(
      fs.readFileSync(path.join(oldVersionDir, 'manifest.json'), 'utf8')
    );
    const newManifest = JSON.parse(
      fs.readFileSync(path.join(newVersionDir, 'manifest.json'), 'utf8')
    );

    // Create temporary directory for delta
    const deltaDir = path.join(path.dirname(outputPath), `delta-${Date.now()}`);
    fs.mkdirSync(deltaDir, { recursive: true });

    const components: UpdateComponent[] = [];

    // Compare and identify changes
    // This is a simplified implementation - real delta would use binary diff
    const oldFiles = new Map<string, string>();
    const newFiles = new Map<string, string>();

    // ... (implementation would compare files and create delta)

    const manifest: UpdateManifest = {
      id: `update-${newManifest.version}-${Date.now()}`,
      version: newManifest.version,
      previousVersion: oldManifest.version,
      releaseDate: new Date().toISOString(),
      updateType: 'delta',
      size: 0,
      checksum: '',
      signature: '',
      components,
      changelog: options.changelog || [],
      dependencies: {
        minVersion: oldManifest.version,
      },
      rollback: {
        supported: true,
        snapshotRequired: true,
      },
      preChecks: [],
      postActions: [],
    };

    // Save manifest
    fs.writeFileSync(
      path.join(deltaDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Create tarball
    execCommand(`tar -czf "${outputPath}" -C "${deltaDir}" .`, { silent: true });

    // Cleanup
    fs.rmSync(deltaDir, { recursive: true });

    log(`Delta update created: ${outputPath}`, 'success');

    return manifest;
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
Vorion Offline Update Manager

Usage: update-manager.ts <command> [options]

Commands:
  status                Show current status
  import <package>      Import update package
  check                 Check for available updates
  apply <update-id>     Apply an update
  rollback <update-id>  Rollback an update
  snapshot              Create a snapshot
  snapshots             List snapshots
  restore <snapshot-id> Restore a snapshot
  changelog [version]   Show changelog

Options:
  --install-dir <path>  Installation directory
  -h, --help            Show this help message

Examples:
  ./update-manager.ts status
  ./update-manager.ts import ./update-2.0.0.tar.gz
  ./update-manager.ts apply update-2.0.0-1234567890
  ./update-manager.ts rollback update-2.0.0-1234567890
  ./update-manager.ts changelog 1.0.0
`);
    process.exit(0);
  }

  const installDirIdx = args.indexOf('--install-dir');
  const installDir = installDirIdx >= 0 ? args[installDirIdx + 1] : undefined;

  const manager = new UpdateManager({ installDir });

  switch (command) {
    case 'status':
      manager.printStatus();
      break;

    case 'import':
      const packagePath = args[1];
      if (!packagePath) {
        log('Package path required', 'error');
        process.exit(1);
      }
      await manager.importUpdatePackage(packagePath);
      break;

    case 'check':
      const available = manager.getAvailableUpdates();
      if (available.length === 0) {
        log('No updates available', 'info');
      } else {
        console.log('\nAvailable Updates:');
        for (const update of available) {
          console.log(`  ${update.version} (${update.updateType})`);
          console.log(`    Size: ${formatBytes(update.size)}`);
          console.log(`    Released: ${update.releaseDate}`);
        }
      }
      break;

    case 'apply':
      const updateId = args[1];
      if (!updateId) {
        log('Update ID required', 'error');
        process.exit(1);
      }
      const result = await manager.applyUpdate(updateId);
      if (!result.success) {
        process.exit(1);
      }
      break;

    case 'rollback':
      const rollbackId = args[1];
      if (!rollbackId) {
        log('Update ID required', 'error');
        process.exit(1);
      }
      await manager.rollbackUpdate(rollbackId);
      break;

    case 'snapshot':
      await manager.createSnapshot(manager.getCurrentVersion());
      break;

    case 'snapshots':
      const snapshots = manager.listSnapshots();
      console.log('\nSnapshots:');
      for (const snapshot of snapshots) {
        console.log(`  ${snapshot.id}`);
        console.log(`    Version: ${snapshot.version}`);
        console.log(`    Created: ${snapshot.createdAt}`);
        console.log(`    Size: ${formatBytes(snapshot.size)}`);
      }
      break;

    case 'restore':
      const snapshotId = args[1];
      if (!snapshotId) {
        log('Snapshot ID required', 'error');
        process.exit(1);
      }
      await manager.restoreSnapshot(snapshotId);
      break;

    case 'changelog':
      const fromVersion = args[1];
      const changelog = manager.getChangelog(fromVersion);
      console.log('\nChangelog:');
      for (const entry of changelog) {
        const typeColor = {
          feature: '\x1b[32m',
          bugfix: '\x1b[33m',
          security: '\x1b[31m',
          improvement: '\x1b[36m',
          breaking: '\x1b[35m',
        }[entry.type] || '';
        console.log(`  ${typeColor}[${entry.type.toUpperCase()}]\x1b[0m ${entry.title}`);
        if (entry.description) {
          console.log(`    ${entry.description}`);
        }
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

export { UpdateManager, DeltaUpdateCreator, UpdateManifest, UpdateResult, Snapshot };
