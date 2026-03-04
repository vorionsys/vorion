#!/usr/bin/env ts-node
/**
 * Air-Gap Bundle Creator
 *
 * Creates comprehensive offline deployment bundles containing:
 * - Docker images as tarballs
 * - npm dependencies
 * - Database schemas and migrations
 * - Configuration templates
 * - Checksums for verification
 * - Version manifest
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';

// ============================================================================
// Configuration
// ============================================================================

interface BundleConfig {
  version: string;
  buildDate: string;
  buildHost: string;
  targetPlatform: 'linux/amd64' | 'linux/arm64' | 'linux/arm/v7';
  includeDevDependencies: boolean;
  compressionLevel: number;
  signBundle: boolean;
  privateKeyPath?: string;
}

interface DockerImage {
  name: string;
  tag: string;
  required: boolean;
  description: string;
}

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

// ============================================================================
// Constants
// ============================================================================

const DOCKER_IMAGES: DockerImage[] = [
  { name: 'vorion/api', tag: 'latest', required: true, description: 'Main API server' },
  { name: 'vorion/web', tag: 'latest', required: true, description: 'Web frontend' },
  { name: 'vorion/worker', tag: 'latest', required: true, description: 'Background worker' },
  { name: 'vorion/scheduler', tag: 'latest', required: true, description: 'Task scheduler' },
  { name: 'postgres', tag: '15-alpine', required: true, description: 'PostgreSQL database' },
  { name: 'redis', tag: '7-alpine', required: true, description: 'Redis cache' },
  { name: 'nginx', tag: 'alpine', required: true, description: 'Reverse proxy' },
  { name: 'minio/minio', tag: 'latest', required: false, description: 'Object storage' },
  { name: 'prom/prometheus', tag: 'latest', required: false, description: 'Metrics collection' },
  { name: 'grafana/grafana', tag: 'latest', required: false, description: 'Metrics visualization' },
];

const REQUIRED_DIRECTORIES = [
  'docker-images',
  'npm-packages',
  'database',
  'config',
  'scripts',
  'certificates',
  'docs',
];

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
  const timestamp = new Date().toISOString();
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}`);
}

function execCommand(command: string, options: { cwd?: string; silent?: boolean } = {}): string {
  try {
    const result = execSync(command, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
    });
    return result?.toString().trim() || '';
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Command failed: ${command}\n${error.message}`);
    }
    throw error;
  }
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

function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  function processDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        processDirectory(fullPath);
      } else {
        totalSize += fs.statSync(fullPath).size;
      }
    }
  }

  processDirectory(dirPath);
  return totalSize;
}

// ============================================================================
// Bundle Creator Class
// ============================================================================

class AirGapBundleCreator {
  private config: BundleConfig;
  private outputDir: string;
  private manifest: BundleManifest;
  private projectRoot: string;

  constructor(config: Partial<BundleConfig> = {}) {
    this.projectRoot = path.resolve(__dirname, '../../..');
    this.config = {
      version: config.version || this.getProjectVersion(),
      buildDate: new Date().toISOString(),
      buildHost: execCommand('hostname', { silent: true }) || 'unknown',
      targetPlatform: config.targetPlatform || 'linux/amd64',
      includeDevDependencies: config.includeDevDependencies || false,
      compressionLevel: config.compressionLevel || 9,
      signBundle: config.signBundle || false,
      privateKeyPath: config.privateKeyPath,
    };

    this.outputDir = path.join(
      this.projectRoot,
      'dist',
      'air-gap-bundle',
      `vorion-${this.config.version}-${Date.now()}`
    );

    this.manifest = {
      version: this.config.version,
      buildDate: this.config.buildDate,
      buildHost: this.config.buildHost,
      platform: this.config.targetPlatform,
      checksum: '',
      components: [],
      dependencies: {
        docker: '24.0.0',
        nodeJs: '20.0.0',
        postgresql: '15.0',
      },
      compatibility: {
        minVersion: this.calculateMinVersion(this.config.version),
        maxVersion: this.config.version,
      },
    };
  }

  private getProjectVersion(): string {
    try {
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version || '1.0.0';
      }
    } catch {
      // Ignore errors
    }
    return '1.0.0';
  }

  private calculateMinVersion(version: string): string {
    const parts = version.split('.').map(Number);
    // Allow upgrades from one minor version back
    parts[1] = Math.max(0, parts[1] - 1);
    parts[2] = 0;
    return parts.join('.');
  }

  async createBundle(): Promise<string> {
    log('Starting air-gap bundle creation...', 'info');
    log(`Version: ${this.config.version}`, 'info');
    log(`Platform: ${this.config.targetPlatform}`, 'info');
    log(`Output: ${this.outputDir}`, 'info');

    try {
      await this.initializeDirectories();
      await this.packageDockerImages();
      await this.bundleNpmDependencies();
      await this.includeDatabaseSchemas();
      await this.bundleConfigTemplates();
      await this.includeScripts();
      await this.generateCertificateTools();
      await this.generateDocumentation();
      await this.createManifest();
      await this.createChecksums();

      if (this.config.signBundle) {
        await this.signBundle();
      }

      const archivePath = await this.compressBundle();

      log(`Bundle created successfully: ${archivePath}`, 'success');
      log(`Total size: ${formatBytes(fs.statSync(archivePath).size)}`, 'info');

      return archivePath;
    } catch (error) {
      log(`Bundle creation failed: ${error}`, 'error');
      throw error;
    }
  }

  private async initializeDirectories(): Promise<void> {
    log('Initializing directory structure...', 'info');

    if (fs.existsSync(this.outputDir)) {
      fs.rmSync(this.outputDir, { recursive: true });
    }

    fs.mkdirSync(this.outputDir, { recursive: true });

    for (const dir of REQUIRED_DIRECTORIES) {
      fs.mkdirSync(path.join(this.outputDir, dir), { recursive: true });
    }
  }

  private async packageDockerImages(): Promise<void> {
    log('Packaging Docker images...', 'info');

    const imagesDir = path.join(this.outputDir, 'docker-images');
    const imageManifest: { name: string; file: string; checksum: string }[] = [];

    for (const image of DOCKER_IMAGES) {
      const fullName = `${image.name}:${image.tag}`;
      const safeFileName = `${image.name.replace(/\//g, '_')}_${image.tag}.tar`;
      const outputPath = path.join(imagesDir, safeFileName);

      log(`  Pulling ${fullName}...`, 'info');

      try {
        // Pull the image for the target platform
        execCommand(
          `docker pull --platform ${this.config.targetPlatform} ${fullName}`,
          { silent: true }
        );

        // Save the image to a tarball
        log(`  Saving ${fullName} to tarball...`, 'info');
        execCommand(`docker save -o "${outputPath}" ${fullName}`, { silent: true });

        const checksum = calculateChecksum(outputPath);
        const stats = fs.statSync(outputPath);

        imageManifest.push({
          name: fullName,
          file: safeFileName,
          checksum,
        });

        this.manifest.components.push({
          name: `docker-image:${image.name}`,
          version: image.tag,
          checksum,
          size: stats.size,
          path: `docker-images/${safeFileName}`,
        });

        log(`  Saved ${fullName} (${formatBytes(stats.size)})`, 'success');
      } catch (error) {
        if (image.required) {
          throw new Error(`Failed to package required image ${fullName}: ${error}`);
        }
        log(`  Skipping optional image ${fullName}: ${error}`, 'warn');
      }
    }

    // Write image manifest
    fs.writeFileSync(
      path.join(imagesDir, 'manifest.json'),
      JSON.stringify(imageManifest, null, 2)
    );
  }

  private async bundleNpmDependencies(): Promise<void> {
    log('Bundling npm dependencies...', 'info');

    const npmDir = path.join(this.outputDir, 'npm-packages');
    const packageJsonPath = path.join(this.projectRoot, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      log('  No package.json found, skipping npm bundling', 'warn');
      return;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = { ...packageJson.dependencies };

    if (this.config.includeDevDependencies) {
      Object.assign(dependencies, packageJson.devDependencies);
    }

    // Create a package.json for offline installation
    const offlinePackageJson = {
      name: 'vorion-offline-deps',
      version: this.config.version,
      private: true,
      dependencies,
    };

    fs.writeFileSync(
      path.join(npmDir, 'package.json'),
      JSON.stringify(offlinePackageJson, null, 2)
    );

    // Create npm pack for each dependency
    log('  Creating npm tarballs...', 'info');

    try {
      // Use npm pack to download all dependencies
      execCommand(
        `npm pack ${Object.entries(dependencies).map(([name, version]) => `${name}@${version}`).join(' ')}`,
        { cwd: npmDir, silent: true }
      );
    } catch (error) {
      log(`  Warning: Some npm packages may not have been packed: ${error}`, 'warn');
    }

    // Also create a node_modules archive if it exists
    const nodeModulesPath = path.join(this.projectRoot, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      log('  Creating node_modules archive...', 'info');
      const archivePath = path.join(npmDir, 'node_modules.tar.gz');

      execCommand(
        `tar -czf "${archivePath}" -C "${this.projectRoot}" node_modules`,
        { silent: true }
      );

      const stats = fs.statSync(archivePath);
      this.manifest.components.push({
        name: 'npm:node_modules',
        version: this.config.version,
        checksum: calculateChecksum(archivePath),
        size: stats.size,
        path: 'npm-packages/node_modules.tar.gz',
      });

      log(`  Created node_modules archive (${formatBytes(stats.size)})`, 'success');
    }
  }

  private async includeDatabaseSchemas(): Promise<void> {
    log('Including database schemas...', 'info');

    const dbDir = path.join(this.outputDir, 'database');
    const sourceMigrations = path.join(this.projectRoot, 'migrations');
    const sourceSchemas = path.join(this.projectRoot, 'database');

    // Copy migrations if they exist
    if (fs.existsSync(sourceMigrations)) {
      const migrationsTarget = path.join(dbDir, 'migrations');
      fs.mkdirSync(migrationsTarget, { recursive: true });
      this.copyDirectory(sourceMigrations, migrationsTarget);
      log('  Copied migrations', 'success');
    }

    // Copy database schemas if they exist
    if (fs.existsSync(sourceSchemas)) {
      const schemasTarget = path.join(dbDir, 'schemas');
      fs.mkdirSync(schemasTarget, { recursive: true });
      this.copyDirectory(sourceSchemas, schemasTarget);
      log('  Copied database schemas', 'success');
    }

    // Create initial schema SQL
    const initialSchemaSQL = this.generateInitialSchema();
    fs.writeFileSync(path.join(dbDir, 'init.sql'), initialSchemaSQL);

    // Create seed data template
    const seedDataSQL = this.generateSeedData();
    fs.writeFileSync(path.join(dbDir, 'seed.sql'), seedDataSQL);

    this.manifest.components.push({
      name: 'database:schemas',
      version: this.config.version,
      checksum: calculateDirectoryChecksum(dbDir),
      size: getDirectorySize(dbDir),
      path: 'database/',
    });
  }

  private generateInitialSchema(): string {
    return `-- Vorion Air-Gap Database Initialization
-- Version: ${this.config.version}
-- Generated: ${this.config.buildDate}

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Licenses table (for offline licensing)
CREATE TABLE IF NOT EXISTS licenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_key VARCHAR(255) UNIQUE NOT NULL,
    hardware_fingerprint VARCHAR(255),
    issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    max_users INTEGER DEFAULT 0,
    features JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System configuration table
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
CREATE TRIGGER update_system_config_updated_at
    BEFORE UPDATE ON system_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default system configuration
INSERT INTO system_config (key, value, description) VALUES
    ('app.version', '"${this.config.version}"', 'Application version'),
    ('app.installation_type', '"airgap"', 'Installation type'),
    ('app.installed_at', '"${this.config.buildDate}"', 'Installation timestamp'),
    ('security.session_timeout', '3600', 'Session timeout in seconds'),
    ('security.max_login_attempts', '5', 'Maximum login attempts before lockout'),
    ('security.password_min_length', '12', 'Minimum password length')
ON CONFLICT (key) DO NOTHING;
`;
  }

  private generateSeedData(): string {
    return `-- Vorion Air-Gap Seed Data
-- Version: ${this.config.version}
-- Generated: ${this.config.buildDate}

-- Create default admin user (password should be changed immediately)
-- Default password: 'changeme123!' (bcrypt hash)
INSERT INTO users (email, password_hash, name, role, status) VALUES
    ('admin@localhost', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G0IStOXWqKsQmK', 'System Administrator', 'admin', 'active')
ON CONFLICT (email) DO NOTHING;

-- Note: In production, generate a new password hash using:
-- SELECT crypt('your-new-password', gen_salt('bf', 12));
`;
  }

  private async bundleConfigTemplates(): Promise<void> {
    log('Bundling configuration templates...', 'info');

    const configDir = path.join(this.outputDir, 'config');
    const sourceTemplates = path.join(__dirname, 'config-templates');

    // Copy existing config templates if they exist
    if (fs.existsSync(sourceTemplates)) {
      this.copyDirectory(sourceTemplates, configDir);
    }

    // Generate additional configurations
    this.generateDockerCompose(configDir);
    this.generateEnvTemplate(configDir);
    this.generateNginxConfig(configDir);

    this.manifest.components.push({
      name: 'config:templates',
      version: this.config.version,
      checksum: calculateDirectoryChecksum(configDir),
      size: getDirectorySize(configDir),
      path: 'config/',
    });

    log('  Configuration templates bundled', 'success');
  }

  private generateDockerCompose(configDir: string): void {
    const dockerCompose = `# Vorion Air-Gap Docker Compose Configuration
# Version: ${this.config.version}
# Generated: ${this.config.buildDate}

version: '3.8'

services:
  api:
    image: vorion/api:latest
    container_name: vorion-api
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=\${JWT_SECRET}
      - CORS_ORIGIN=\${CORS_ORIGIN}
    networks:
      - vorion-internal
    volumes:
      - api-data:/app/data
      - ./certs:/app/certs:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  web:
    image: vorion/web:latest
    container_name: vorion-web
    restart: unless-stopped
    depends_on:
      - api
    environment:
      - API_URL=http://api:3000
    networks:
      - vorion-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80/"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: vorion/worker:latest
    container_name: vorion-worker
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379
    networks:
      - vorion-internal
    volumes:
      - worker-data:/app/data

  scheduler:
    image: vorion/scheduler:latest
    container_name: vorion-scheduler
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}
      - REDIS_URL=redis://redis:6379
    networks:
      - vorion-internal

  postgres:
    image: postgres:15-alpine
    container_name: vorion-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=\${POSTGRES_USER}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=\${POSTGRES_DB}
    networks:
      - vorion-internal
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./database/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
      - ./database/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: vorion-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass \${REDIS_PASSWORD}
    networks:
      - vorion-internal
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "\${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  nginx:
    image: nginx:alpine
    container_name: vorion-nginx
    restart: unless-stopped
    depends_on:
      - api
      - web
    ports:
      - "\${HTTP_PORT:-80}:80"
      - "\${HTTPS_PORT:-443}:443"
    networks:
      - vorion-internal
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  vorion-internal:
    driver: bridge
    internal: true
    ipam:
      config:
        - subnet: 172.28.0.0/16

volumes:
  api-data:
  worker-data:
  postgres-data:
  redis-data:
`;

    fs.writeFileSync(path.join(configDir, 'docker-compose.airgap.yml'), dockerCompose);
  }

  private generateEnvTemplate(configDir: string): void {
    const envTemplate = `# Vorion Air-Gap Environment Configuration
# Version: ${this.config.version}
# Generated: ${this.config.buildDate}
#
# IMPORTANT: Copy this file to .env and configure all values before deployment
# NEVER commit the .env file to version control

# ============================================================================
# Database Configuration
# ============================================================================
POSTGRES_USER=vorion
POSTGRES_PASSWORD=CHANGE_THIS_SECURE_PASSWORD
POSTGRES_DB=vorion

# ============================================================================
# Redis Configuration
# ============================================================================
REDIS_PASSWORD=CHANGE_THIS_SECURE_PASSWORD

# ============================================================================
# Application Security
# ============================================================================
# Generate with: openssl rand -base64 64
JWT_SECRET=CHANGE_THIS_SECURE_SECRET

# Session encryption key (32 bytes, base64 encoded)
# Generate with: openssl rand -base64 32
SESSION_SECRET=CHANGE_THIS_SECURE_SECRET

# ============================================================================
# Network Configuration
# ============================================================================
# External ports (change if conflicts exist)
HTTP_PORT=80
HTTPS_PORT=443

# Allowed origins for CORS (comma-separated)
CORS_ORIGIN=https://vorion.local

# Internal hostname (used for internal service communication)
INTERNAL_HOSTNAME=vorion.local

# ============================================================================
# TLS/SSL Configuration
# ============================================================================
# Path to SSL certificate and key (relative to config directory)
SSL_CERT_PATH=./certs/server.crt
SSL_KEY_PATH=./certs/server.key
SSL_CA_PATH=./certs/ca.crt

# ============================================================================
# Logging Configuration
# ============================================================================
LOG_LEVEL=info
LOG_FORMAT=json

# ============================================================================
# License Configuration
# ============================================================================
LICENSE_FILE_PATH=./license.key

# ============================================================================
# Backup Configuration
# ============================================================================
BACKUP_RETENTION_DAYS=30
BACKUP_PATH=/var/backups/vorion

# ============================================================================
# Air-Gap Specific Settings
# ============================================================================
# Disable all external network calls
DISABLE_TELEMETRY=true
DISABLE_UPDATE_CHECK=true
DISABLE_EXTERNAL_INTEGRATIONS=true

# Internal time server (if available)
# NTP_SERVER=ntp.internal.local

# Internal DNS server (if available)
# DNS_SERVER=dns.internal.local
`;

    fs.writeFileSync(path.join(configDir, '.env.airgap.template'), envTemplate);
  }

  private generateNginxConfig(configDir: string): void {
    const nginxConfig = `# Vorion Air-Gap Nginx Configuration
# Version: ${this.config.version}
# Generated: ${this.config.buildDate}

user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging format
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;

    # Performance settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'" always;

    # Hide server version
    server_tokens off;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript
               application/xml application/rss+xml application/atom+xml image/svg+xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login_limit:10m rate=1r/s;

    # Upstream definitions
    upstream api_backend {
        server api:3000;
        keepalive 32;
    }

    upstream web_backend {
        server web:80;
        keepalive 32;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    # Main HTTPS server
    server {
        listen 443 ssl http2;
        server_name _;

        # SSL configuration
        ssl_certificate /etc/nginx/certs/server.crt;
        ssl_certificate_key /etc/nginx/certs/server.key;
        ssl_client_certificate /etc/nginx/certs/ca.crt;

        # Modern SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # HSTS
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Request size limits
        client_max_body_size 100M;
        client_body_buffer_size 128k;

        # API endpoints
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;

            proxy_pass http://api_backend/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 90s;
            proxy_connect_timeout 90s;
            proxy_send_timeout 90s;
        }

        # Login endpoint with stricter rate limiting
        location /api/auth/login {
            limit_req zone=login_limit burst=5 nodelay;

            proxy_pass http://api_backend/auth/login;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health check endpoint (no rate limiting)
        location /health {
            proxy_pass http://api_backend/health;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            access_log off;
        }

        # Static files and web frontend
        location / {
            proxy_pass http://web_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Cache static assets
            location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
                proxy_pass http://web_backend;
                expires 1y;
                add_header Cache-Control "public, immutable";
            }
        }

        # Deny access to sensitive files
        location ~ /\\. {
            deny all;
            access_log off;
            log_not_found off;
        }
    }
}
`;

    fs.writeFileSync(path.join(configDir, 'nginx.airgap.conf'), nginxConfig);
  }

  private async includeScripts(): Promise<void> {
    log('Including installation scripts...', 'info');

    const scriptsDir = path.join(this.outputDir, 'scripts');
    const sourceScripts = path.join(__dirname, '..', '..', 'scripts');

    // Copy existing scripts if they exist
    if (fs.existsSync(sourceScripts)) {
      this.copyDirectory(sourceScripts, scriptsDir);
    }

    // Copy the offline installer
    const installerSource = path.join(__dirname, 'offline-installer.sh');
    if (fs.existsSync(installerSource)) {
      fs.copyFileSync(installerSource, path.join(scriptsDir, 'offline-installer.sh'));
    }

    // Create additional utility scripts
    this.createHealthCheckScript(scriptsDir);
    this.createBackupScript(scriptsDir);
    this.createRestoreScript(scriptsDir);

    log('  Installation scripts included', 'success');
  }

  private createHealthCheckScript(scriptsDir: string): void {
    const script = `#!/bin/bash
# Vorion Health Check Script
# Version: ${this.config.version}

set -e

echo "Checking Vorion services health..."

check_service() {
    local service=$1
    local status=$(docker inspect --format='{{.State.Health.Status}}' "vorion-$service" 2>/dev/null || echo "not found")

    if [ "$status" = "healthy" ]; then
        echo "[OK] $service: healthy"
        return 0
    elif [ "$status" = "not found" ]; then
        echo "[ERROR] $service: container not found"
        return 1
    else
        echo "[WARN] $service: $status"
        return 1
    fi
}

services=("api" "web" "worker" "scheduler" "postgres" "redis" "nginx")
failed=0

for service in "\${services[@]}"; do
    check_service "$service" || ((failed++))
done

echo ""
if [ $failed -eq 0 ]; then
    echo "All services are healthy!"
    exit 0
else
    echo "$failed service(s) are not healthy."
    exit 1
fi
`;
    fs.writeFileSync(path.join(scriptsDir, 'health-check.sh'), script);
    fs.chmodSync(path.join(scriptsDir, 'health-check.sh'), '755');
  }

  private createBackupScript(scriptsDir: string): void {
    const script = `#!/bin/bash
# Vorion Backup Script
# Version: ${this.config.version}

set -e

BACKUP_DIR="\${BACKUP_DIR:-/var/backups/vorion}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="vorion_backup_$TIMESTAMP"

echo "Starting Vorion backup..."
echo "Backup directory: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
echo "Backing up PostgreSQL database..."
docker exec vorion-postgres pg_dump -U \${POSTGRES_USER:-vorion} \${POSTGRES_DB:-vorion} | gzip > "$BACKUP_DIR/$BACKUP_NAME.sql.gz"

# Backup Redis
echo "Backing up Redis data..."
docker exec vorion-redis redis-cli -a \${REDIS_PASSWORD} BGSAVE
sleep 2
docker cp vorion-redis:/data/dump.rdb "$BACKUP_DIR/$BACKUP_NAME.rdb"

# Backup configuration
echo "Backing up configuration..."
tar -czf "$BACKUP_DIR/$BACKUP_NAME.config.tar.gz" -C /opt/vorion config/

# Backup volumes
echo "Backing up Docker volumes..."
docker run --rm -v vorion_api-data:/data -v "$BACKUP_DIR":/backup alpine tar -czf /backup/$BACKUP_NAME.api-data.tar.gz -C /data .
docker run --rm -v vorion_worker-data:/data -v "$BACKUP_DIR":/backup alpine tar -czf /backup/$BACKUP_NAME.worker-data.tar.gz -C /data .

# Create manifest
echo "Creating backup manifest..."
cat > "$BACKUP_DIR/$BACKUP_NAME.manifest.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "version": "${this.config.version}",
  "files": [
    "$BACKUP_NAME.sql.gz",
    "$BACKUP_NAME.rdb",
    "$BACKUP_NAME.config.tar.gz",
    "$BACKUP_NAME.api-data.tar.gz",
    "$BACKUP_NAME.worker-data.tar.gz"
  ]
}
EOF

echo ""
echo "Backup completed successfully!"
echo "Backup files saved to: $BACKUP_DIR/$BACKUP_NAME.*"

# Cleanup old backups (keep last 30 days by default)
RETENTION_DAYS=\${BACKUP_RETENTION_DAYS:-30}
echo "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "vorion_backup_*" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo "Backup process complete."
`;
    fs.writeFileSync(path.join(scriptsDir, 'backup.sh'), script);
    fs.chmodSync(path.join(scriptsDir, 'backup.sh'), '755');
  }

  private createRestoreScript(scriptsDir: string): void {
    const script = `#!/bin/bash
# Vorion Restore Script
# Version: ${this.config.version}

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_name>"
    echo "Example: $0 vorion_backup_20240115_120000"
    exit 1
fi

BACKUP_DIR="\${BACKUP_DIR:-/var/backups/vorion}"
BACKUP_NAME=$1

echo "Starting Vorion restore from $BACKUP_NAME..."

# Verify backup files exist
if [ ! -f "$BACKUP_DIR/$BACKUP_NAME.sql.gz" ]; then
    echo "ERROR: Backup file not found: $BACKUP_DIR/$BACKUP_NAME.sql.gz"
    exit 1
fi

# Stop services (except database)
echo "Stopping application services..."
docker compose -f /opt/vorion/docker-compose.yml stop api web worker scheduler

# Restore PostgreSQL
echo "Restoring PostgreSQL database..."
gunzip -c "$BACKUP_DIR/$BACKUP_NAME.sql.gz" | docker exec -i vorion-postgres psql -U \${POSTGRES_USER:-vorion} \${POSTGRES_DB:-vorion}

# Restore Redis
if [ -f "$BACKUP_DIR/$BACKUP_NAME.rdb" ]; then
    echo "Restoring Redis data..."
    docker cp "$BACKUP_DIR/$BACKUP_NAME.rdb" vorion-redis:/data/dump.rdb
    docker restart vorion-redis
fi

# Restore configuration
if [ -f "$BACKUP_DIR/$BACKUP_NAME.config.tar.gz" ]; then
    echo "Restoring configuration..."
    tar -xzf "$BACKUP_DIR/$BACKUP_NAME.config.tar.gz" -C /opt/vorion/
fi

# Restore volumes
if [ -f "$BACKUP_DIR/$BACKUP_NAME.api-data.tar.gz" ]; then
    echo "Restoring API data..."
    docker run --rm -v vorion_api-data:/data -v "$BACKUP_DIR":/backup alpine tar -xzf /backup/$BACKUP_NAME.api-data.tar.gz -C /data
fi

if [ -f "$BACKUP_DIR/$BACKUP_NAME.worker-data.tar.gz" ]; then
    echo "Restoring worker data..."
    docker run --rm -v vorion_worker-data:/data -v "$BACKUP_DIR":/backup alpine tar -xzf /backup/$BACKUP_NAME.worker-data.tar.gz -C /data
fi

# Restart all services
echo "Restarting all services..."
docker compose -f /opt/vorion/docker-compose.yml up -d

echo ""
echo "Restore completed successfully!"
echo "Please verify system functionality."
`;
    fs.writeFileSync(path.join(scriptsDir, 'restore.sh'), script);
    fs.chmodSync(path.join(scriptsDir, 'restore.sh'), '755');
  }

  private async generateCertificateTools(): Promise<void> {
    log('Generating certificate tools...', 'info');

    const certsDir = path.join(this.outputDir, 'certificates');

    // CA generation script
    const caScript = `#!/bin/bash
# Internal CA Generation Script
# Version: ${this.config.version}

set -e

OUTPUT_DIR="\${1:-.}"
CA_DAYS=3650
CA_KEY_SIZE=4096

echo "Generating Internal Certificate Authority..."

# Generate CA private key
openssl genrsa -out "$OUTPUT_DIR/ca.key" $CA_KEY_SIZE

# Generate CA certificate
openssl req -x509 -new -nodes \\
    -key "$OUTPUT_DIR/ca.key" \\
    -sha256 -days $CA_DAYS \\
    -out "$OUTPUT_DIR/ca.crt" \\
    -subj "/C=US/ST=State/L=City/O=Organization/OU=IT/CN=Vorion Internal CA"

echo "CA certificate generated:"
echo "  Private Key: $OUTPUT_DIR/ca.key"
echo "  Certificate: $OUTPUT_DIR/ca.crt"
echo ""
echo "IMPORTANT: Keep ca.key secure and backed up!"
`;
    fs.writeFileSync(path.join(certsDir, 'generate-ca.sh'), caScript);
    fs.chmodSync(path.join(certsDir, 'generate-ca.sh'), '755');

    // Server certificate generation script
    const serverScript = `#!/bin/bash
# Server Certificate Generation Script
# Version: ${this.config.version}

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <hostname> [output_dir] [ca_dir]"
    echo "Example: $0 vorion.local ./certs ./ca"
    exit 1
fi

HOSTNAME=$1
OUTPUT_DIR="\${2:-.}"
CA_DIR="\${3:-.}"
CERT_DAYS=365
KEY_SIZE=2048

echo "Generating server certificate for: $HOSTNAME"

# Create OpenSSL config with SAN
cat > "$OUTPUT_DIR/openssl.cnf" << EOF
[req]
default_bits = $KEY_SIZE
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C = US
ST = State
L = City
O = Organization
OU = IT
CN = $HOSTNAME

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $HOSTNAME
DNS.2 = *.$HOSTNAME
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

# Generate server private key
openssl genrsa -out "$OUTPUT_DIR/server.key" $KEY_SIZE

# Generate CSR
openssl req -new \\
    -key "$OUTPUT_DIR/server.key" \\
    -out "$OUTPUT_DIR/server.csr" \\
    -config "$OUTPUT_DIR/openssl.cnf"

# Sign with CA
openssl x509 -req \\
    -in "$OUTPUT_DIR/server.csr" \\
    -CA "$CA_DIR/ca.crt" \\
    -CAkey "$CA_DIR/ca.key" \\
    -CAcreateserial \\
    -out "$OUTPUT_DIR/server.crt" \\
    -days $CERT_DAYS \\
    -sha256 \\
    -extfile "$OUTPUT_DIR/openssl.cnf" \\
    -extensions req_ext

# Create full chain
cat "$OUTPUT_DIR/server.crt" "$CA_DIR/ca.crt" > "$OUTPUT_DIR/fullchain.crt"

# Cleanup
rm -f "$OUTPUT_DIR/server.csr" "$OUTPUT_DIR/openssl.cnf"

echo ""
echo "Server certificate generated:"
echo "  Private Key: $OUTPUT_DIR/server.key"
echo "  Certificate: $OUTPUT_DIR/server.crt"
echo "  Full Chain:  $OUTPUT_DIR/fullchain.crt"
echo ""
echo "Verify certificate:"
openssl x509 -in "$OUTPUT_DIR/server.crt" -text -noout | head -20
`;
    fs.writeFileSync(path.join(certsDir, 'generate-server-cert.sh'), serverScript);
    fs.chmodSync(path.join(certsDir, 'generate-server-cert.sh'), '755');

    // Client certificate generation script
    const clientScript = `#!/bin/bash
# Client Certificate Generation Script
# Version: ${this.config.version}

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <client_name> [output_dir] [ca_dir]"
    echo "Example: $0 admin ./certs ./ca"
    exit 1
fi

CLIENT_NAME=$1
OUTPUT_DIR="\${2:-.}"
CA_DIR="\${3:-.}"
CERT_DAYS=365
KEY_SIZE=2048

echo "Generating client certificate for: $CLIENT_NAME"

# Generate client private key
openssl genrsa -out "$OUTPUT_DIR/$CLIENT_NAME.key" $KEY_SIZE

# Generate CSR
openssl req -new \\
    -key "$OUTPUT_DIR/$CLIENT_NAME.key" \\
    -out "$OUTPUT_DIR/$CLIENT_NAME.csr" \\
    -subj "/C=US/ST=State/L=City/O=Organization/OU=Users/CN=$CLIENT_NAME"

# Sign with CA
openssl x509 -req \\
    -in "$OUTPUT_DIR/$CLIENT_NAME.csr" \\
    -CA "$CA_DIR/ca.crt" \\
    -CAkey "$CA_DIR/ca.key" \\
    -CAcreateserial \\
    -out "$OUTPUT_DIR/$CLIENT_NAME.crt" \\
    -days $CERT_DAYS \\
    -sha256

# Create PKCS12 bundle for import into browsers
openssl pkcs12 -export \\
    -out "$OUTPUT_DIR/$CLIENT_NAME.p12" \\
    -inkey "$OUTPUT_DIR/$CLIENT_NAME.key" \\
    -in "$OUTPUT_DIR/$CLIENT_NAME.crt" \\
    -certfile "$CA_DIR/ca.crt" \\
    -passout pass:changeme

# Cleanup
rm -f "$OUTPUT_DIR/$CLIENT_NAME.csr"

echo ""
echo "Client certificate generated:"
echo "  Private Key: $OUTPUT_DIR/$CLIENT_NAME.key"
echo "  Certificate: $OUTPUT_DIR/$CLIENT_NAME.crt"
echo "  PKCS12:      $OUTPUT_DIR/$CLIENT_NAME.p12 (password: changeme)"
`;
    fs.writeFileSync(path.join(certsDir, 'generate-client-cert.sh'), clientScript);
    fs.chmodSync(path.join(certsDir, 'generate-client-cert.sh'), '755');

    log('  Certificate tools generated', 'success');
  }

  private async generateDocumentation(): Promise<void> {
    log('Generating documentation...', 'info');

    const docsDir = path.join(this.outputDir, 'docs');

    // Copy main documentation
    const mainDocSource = path.join(__dirname, 'docs', 'AIR-GAP-DEPLOYMENT.md');
    if (fs.existsSync(mainDocSource)) {
      fs.copyFileSync(mainDocSource, path.join(docsDir, 'AIR-GAP-DEPLOYMENT.md'));
    }

    // Generate quick start guide
    const quickStart = `# Vorion Air-Gap Quick Start Guide
## Version: ${this.config.version}

### Prerequisites
- Linux server (RHEL 8+, Ubuntu 20.04+, or similar)
- Docker Engine 24.0+
- 8GB RAM minimum, 16GB recommended
- 100GB storage minimum

### Quick Installation

1. **Transfer bundle to air-gapped system**
2. **Extract and run installer:**
   \`\`\`bash
   tar -xzf vorion-bundle-${this.config.version}.tar.gz
   cd vorion-bundle
   sudo ./scripts/offline-installer.sh
   \`\`\`
3. **Configure environment:**
   \`\`\`bash
   cp config/.env.airgap.template /opt/vorion/.env
   nano /opt/vorion/.env  # Edit with your values
   \`\`\`
4. **Generate certificates:**
   \`\`\`bash
   cd /opt/vorion/certificates
   ./generate-ca.sh ./ca
   ./generate-server-cert.sh vorion.local ./certs ./ca
   \`\`\`
5. **Start services:**
   \`\`\`bash
   cd /opt/vorion
   docker compose up -d
   \`\`\`

### Default Access
- URL: https://vorion.local (configure in hosts file)
- Admin: admin@localhost / changeme123! (CHANGE IMMEDIATELY)

### Troubleshooting
See full documentation: docs/AIR-GAP-DEPLOYMENT.md
`;
    fs.writeFileSync(path.join(docsDir, 'QUICK-START.md'), quickStart);

    log('  Documentation generated', 'success');
  }

  private async createManifest(): Promise<void> {
    log('Creating version manifest...', 'info');

    // Calculate overall bundle checksum
    this.manifest.checksum = calculateDirectoryChecksum(this.outputDir);

    fs.writeFileSync(
      path.join(this.outputDir, 'manifest.json'),
      JSON.stringify(this.manifest, null, 2)
    );

    log('  Manifest created', 'success');
  }

  private async createChecksums(): Promise<void> {
    log('Creating checksums...', 'info');

    const checksumFile: string[] = [];

    function processDirectory(dir: string, basePath: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          processDirectory(fullPath, basePath);
        } else if (!entry.name.endsWith('.sha256')) {
          const checksum = calculateChecksum(fullPath);
          checksumFile.push(`${checksum}  ${relativePath}`);
        }
      }
    }

    processDirectory(this.outputDir, this.outputDir);

    fs.writeFileSync(
      path.join(this.outputDir, 'SHA256SUMS'),
      checksumFile.join('\n') + '\n'
    );

    log('  Checksums created', 'success');
  }

  private async signBundle(): Promise<void> {
    log('Signing bundle...', 'info');

    if (!this.config.privateKeyPath || !fs.existsSync(this.config.privateKeyPath)) {
      log('  Private key not found, skipping signature', 'warn');
      return;
    }

    const checksumPath = path.join(this.outputDir, 'SHA256SUMS');
    const signaturePath = path.join(this.outputDir, 'SHA256SUMS.sig');

    try {
      execCommand(
        `openssl dgst -sha256 -sign "${this.config.privateKeyPath}" -out "${signaturePath}" "${checksumPath}"`,
        { silent: true }
      );

      // Read and add signature to manifest
      const signature = fs.readFileSync(signaturePath).toString('base64');
      this.manifest.signature = signature;

      // Update manifest with signature
      fs.writeFileSync(
        path.join(this.outputDir, 'manifest.json'),
        JSON.stringify(this.manifest, null, 2)
      );

      log('  Bundle signed successfully', 'success');
    } catch (error) {
      log(`  Failed to sign bundle: ${error}`, 'warn');
    }
  }

  private async compressBundle(): Promise<string> {
    log('Compressing bundle...', 'info');

    const archiveName = `vorion-bundle-${this.config.version}.tar.gz`;
    const archivePath = path.join(path.dirname(this.outputDir), archiveName);

    execCommand(
      `tar -czf "${archivePath}" -C "${path.dirname(this.outputDir)}" "${path.basename(this.outputDir)}"`,
      { silent: true }
    );

    // Create checksum for the archive
    const archiveChecksum = calculateChecksum(archivePath);
    fs.writeFileSync(`${archivePath}.sha256`, `${archiveChecksum}  ${archiveName}\n`);

    log(`  Bundle compressed: ${archivePath}`, 'success');

    return archivePath;
  }

  private copyDirectory(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const config: Partial<BundleConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--version':
      case '-v':
        config.version = args[++i];
        break;
      case '--platform':
      case '-p':
        config.targetPlatform = args[++i] as BundleConfig['targetPlatform'];
        break;
      case '--include-dev':
        config.includeDevDependencies = true;
        break;
      case '--sign':
        config.signBundle = true;
        config.privateKeyPath = args[++i];
        break;
      case '--compression':
      case '-c':
        config.compressionLevel = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
Vorion Air-Gap Bundle Creator

Usage: bundle-creator.ts [options]

Options:
  -v, --version <version>     Set bundle version (default: from package.json)
  -p, --platform <platform>   Target platform (linux/amd64, linux/arm64, linux/arm/v7)
  --include-dev               Include dev dependencies in npm bundle
  --sign <key-path>           Sign bundle with private key
  -c, --compression <level>   Compression level 1-9 (default: 9)
  -h, --help                  Show this help message

Examples:
  ./bundle-creator.ts
  ./bundle-creator.ts -v 2.0.0 -p linux/arm64
  ./bundle-creator.ts --sign /path/to/private.key
`);
        process.exit(0);
    }
  }

  const creator = new AirGapBundleCreator(config);
  await creator.createBundle();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { AirGapBundleCreator, BundleConfig, BundleManifest };
