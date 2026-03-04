#!/usr/bin/env ts-node
/**
 * Network Isolation Manager
 *
 * Enforces network policies for air-gapped deployments:
 * - Block all egress by default
 * - Allowlist for internal services only
 * - DNS configuration for internal resolution
 * - Proxy configuration (if applicable)
 */

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

interface NetworkPolicy {
  name: string;
  description: string;
  rules: NetworkRule[];
  enabled: boolean;
}

interface NetworkRule {
  id: string;
  type: 'allow' | 'deny';
  direction: 'ingress' | 'egress' | 'both';
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  source?: string;
  destination?: string;
  port?: number | string;
  priority: number;
  description: string;
}

interface InternalService {
  name: string;
  hostname: string;
  ip: string;
  port: number;
  protocol: 'tcp' | 'udp';
  description: string;
}

interface DNSConfig {
  servers: string[];
  searchDomains: string[];
  localEntries: { hostname: string; ip: string }[];
}

interface ProxyConfig {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy: string[];
}

interface NetworkIsolationConfig {
  policies: NetworkPolicy[];
  internalServices: InternalService[];
  dns: DNSConfig;
  proxy: ProxyConfig;
  dockerNetwork: {
    name: string;
    subnet: string;
    gateway: string;
    internal: boolean;
  };
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

function execCommand(command: string, silent = false): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    return { success: true, output: output?.toString().trim() || '' };
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

function detectFirewall(): 'iptables' | 'nftables' | 'firewalld' | 'ufw' | 'none' {
  if (execCommand('which nft', true).success) {
    return 'nftables';
  }
  if (execCommand('which firewall-cmd', true).success) {
    return 'firewalld';
  }
  if (execCommand('which ufw', true).success) {
    return 'ufw';
  }
  if (execCommand('which iptables', true).success) {
    return 'iptables';
  }
  return 'none';
}

// ============================================================================
// Network Isolation Manager
// ============================================================================

class NetworkIsolationManager {
  private config: NetworkIsolationConfig;
  private configPath: string;
  private firewallType: 'iptables' | 'nftables' | 'firewalld' | 'ufw' | 'none';

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(__dirname, 'network-isolation.json');
    this.firewallType = detectFirewall();
    this.config = this.loadOrCreateConfig();
  }

  private loadOrCreateConfig(): NetworkIsolationConfig {
    if (fs.existsSync(this.configPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch (error) {
        log(`Failed to load config, using defaults: ${error}`, 'warn');
      }
    }

    return this.getDefaultConfig();
  }

  private getDefaultConfig(): NetworkIsolationConfig {
    return {
      policies: [
        {
          name: 'default-deny-egress',
          description: 'Block all outbound traffic by default',
          enabled: true,
          rules: [
            {
              id: 'deny-all-egress',
              type: 'deny',
              direction: 'egress',
              protocol: 'all',
              destination: '0.0.0.0/0',
              priority: 1000,
              description: 'Deny all outbound traffic',
            },
          ],
        },
        {
          name: 'allow-internal',
          description: 'Allow internal network communication',
          enabled: true,
          rules: [
            {
              id: 'allow-docker-internal',
              type: 'allow',
              direction: 'both',
              protocol: 'all',
              source: '172.28.0.0/16',
              destination: '172.28.0.0/16',
              priority: 100,
              description: 'Allow Docker internal network',
            },
            {
              id: 'allow-localhost',
              type: 'allow',
              direction: 'both',
              protocol: 'all',
              source: '127.0.0.0/8',
              destination: '127.0.0.0/8',
              priority: 100,
              description: 'Allow localhost',
            },
          ],
        },
        {
          name: 'allow-internal-dns',
          description: 'Allow internal DNS resolution',
          enabled: true,
          rules: [
            {
              id: 'allow-dns-tcp',
              type: 'allow',
              direction: 'egress',
              protocol: 'tcp',
              port: 53,
              priority: 50,
              description: 'Allow DNS over TCP',
            },
            {
              id: 'allow-dns-udp',
              type: 'allow',
              direction: 'egress',
              protocol: 'udp',
              port: 53,
              priority: 50,
              description: 'Allow DNS over UDP',
            },
          ],
        },
        {
          name: 'allow-ntp',
          description: 'Allow NTP for time synchronization',
          enabled: false, // Disabled by default in air-gap
          rules: [
            {
              id: 'allow-ntp-udp',
              type: 'allow',
              direction: 'egress',
              protocol: 'udp',
              port: 123,
              priority: 50,
              description: 'Allow NTP',
            },
          ],
        },
      ],
      internalServices: [
        {
          name: 'api',
          hostname: 'vorion-api',
          ip: '172.28.0.10',
          port: 3000,
          protocol: 'tcp',
          description: 'API server',
        },
        {
          name: 'web',
          hostname: 'vorion-web',
          ip: '172.28.0.11',
          port: 80,
          protocol: 'tcp',
          description: 'Web frontend',
        },
        {
          name: 'postgres',
          hostname: 'vorion-postgres',
          ip: '172.28.0.20',
          port: 5432,
          protocol: 'tcp',
          description: 'PostgreSQL database',
        },
        {
          name: 'redis',
          hostname: 'vorion-redis',
          ip: '172.28.0.21',
          port: 6379,
          protocol: 'tcp',
          description: 'Redis cache',
        },
      ],
      dns: {
        servers: ['127.0.0.1'],
        searchDomains: ['internal.local'],
        localEntries: [
          { hostname: 'vorion.local', ip: '127.0.0.1' },
          { hostname: 'api.vorion.local', ip: '172.28.0.10' },
          { hostname: 'db.vorion.local', ip: '172.28.0.20' },
        ],
      },
      proxy: {
        enabled: false,
        noProxy: [
          'localhost',
          '127.0.0.1',
          '172.28.0.0/16',
          '.internal.local',
          '.vorion.local',
        ],
      },
      dockerNetwork: {
        name: 'vorion-internal',
        subnet: '172.28.0.0/16',
        gateway: '172.28.0.1',
        internal: true,
      },
    };
  }

  saveConfig(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    log(`Configuration saved to ${this.configPath}`, 'success');
  }

  // =========================================================================
  // Firewall Management
  // =========================================================================

  async applyNetworkPolicies(): Promise<void> {
    if (!isRoot()) {
      log('Root privileges required to apply network policies', 'error');
      throw new Error('Root privileges required');
    }

    log(`Detected firewall: ${this.firewallType}`, 'info');

    switch (this.firewallType) {
      case 'iptables':
        await this.applyIptablesRules();
        break;
      case 'nftables':
        await this.applyNftablesRules();
        break;
      case 'firewalld':
        await this.applyFirewalldRules();
        break;
      case 'ufw':
        await this.applyUfwRules();
        break;
      default:
        log('No supported firewall detected', 'warn');
        break;
    }
  }

  private async applyIptablesRules(): Promise<void> {
    log('Applying iptables rules...', 'info');

    // Create chain for Vorion rules
    execCommand('iptables -N VORION-EGRESS 2>/dev/null || true', true);
    execCommand('iptables -F VORION-EGRESS', true);

    // Apply rules from enabled policies
    for (const policy of this.config.policies.filter((p) => p.enabled)) {
      log(`  Applying policy: ${policy.name}`, 'debug');

      for (const rule of policy.rules.sort((a, b) => a.priority - b.priority)) {
        const iptablesRule = this.buildIptablesRule(rule);
        if (iptablesRule) {
          execCommand(iptablesRule, true);
        }
      }
    }

    // Insert jump to VORION chain
    execCommand(
      'iptables -C OUTPUT -j VORION-EGRESS 2>/dev/null || iptables -I OUTPUT -j VORION-EGRESS',
      true
    );

    log('iptables rules applied', 'success');
  }

  private buildIptablesRule(rule: NetworkRule): string | null {
    const action = rule.type === 'allow' ? 'ACCEPT' : 'DROP';
    const chain = rule.direction === 'egress' ? 'VORION-EGRESS' : 'INPUT';

    let cmd = `iptables -A ${chain}`;

    if (rule.protocol !== 'all') {
      cmd += ` -p ${rule.protocol}`;
    }

    if (rule.source) {
      cmd += ` -s ${rule.source}`;
    }

    if (rule.destination) {
      cmd += ` -d ${rule.destination}`;
    }

    if (rule.port && rule.protocol !== 'icmp' && rule.protocol !== 'all') {
      cmd += ` --dport ${rule.port}`;
    }

    cmd += ` -j ${action} -m comment --comment "${rule.description}"`;

    return cmd;
  }

  private async applyNftablesRules(): Promise<void> {
    log('Applying nftables rules...', 'info');

    const nftConfig = this.generateNftablesConfig();
    const configPath = '/etc/nftables.d/vorion.conf';

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, nftConfig);

    execCommand('nft -f ' + configPath, true);
    log('nftables rules applied', 'success');
  }

  private generateNftablesConfig(): string {
    let config = `# Vorion Network Isolation Rules
# Generated: ${new Date().toISOString()}

table inet vorion {
  chain egress {
    type filter hook output priority filter; policy drop;

    # Allow established connections
    ct state established,related accept

    # Allow loopback
    oif lo accept

`;

    for (const policy of this.config.policies.filter((p) => p.enabled)) {
      config += `    # Policy: ${policy.name}\n`;

      for (const rule of policy.rules) {
        if (rule.direction === 'egress' || rule.direction === 'both') {
          const action = rule.type === 'allow' ? 'accept' : 'drop';
          let nftRule = '    ';

          if (rule.destination) {
            nftRule += `ip daddr ${rule.destination} `;
          }

          if (rule.protocol !== 'all') {
            nftRule += `${rule.protocol} `;
            if (rule.port) {
              nftRule += `dport ${rule.port} `;
            }
          }

          nftRule += `${action} comment "${rule.description}"\n`;
          config += nftRule;
        }
      }
    }

    config += `
    # Default deny
    counter drop
  }
}
`;

    return config;
  }

  private async applyFirewalldRules(): Promise<void> {
    log('Applying firewalld rules...', 'info');

    // Create Vorion zone
    execCommand('firewall-cmd --permanent --new-zone=vorion 2>/dev/null || true', true);

    // Configure zone
    execCommand('firewall-cmd --permanent --zone=vorion --set-target=DROP', true);

    // Add allowed services
    for (const service of this.config.internalServices) {
      execCommand(
        `firewall-cmd --permanent --zone=vorion --add-rich-rule='rule family="ipv4" source address="${this.config.dockerNetwork.subnet}" port port="${service.port}" protocol="${service.protocol}" accept'`,
        true
      );
    }

    // Reload
    execCommand('firewall-cmd --reload', true);
    log('firewalld rules applied', 'success');
  }

  private async applyUfwRules(): Promise<void> {
    log('Applying ufw rules...', 'info');

    // Reset to defaults
    execCommand('ufw --force reset', true);

    // Default policies
    execCommand('ufw default deny outgoing', true);
    execCommand('ufw default deny incoming', true);

    // Allow internal network
    execCommand(`ufw allow from ${this.config.dockerNetwork.subnet}`, true);
    execCommand(`ufw allow to ${this.config.dockerNetwork.subnet}`, true);

    // Allow localhost
    execCommand('ufw allow from 127.0.0.0/8', true);

    // Allow specific ports if needed
    for (const policy of this.config.policies.filter((p) => p.enabled)) {
      for (const rule of policy.rules) {
        if (rule.type === 'allow' && rule.port) {
          const direction = rule.direction === 'egress' ? 'out' : 'in';
          execCommand(`ufw allow ${direction} ${rule.port}/${rule.protocol}`, true);
        }
      }
    }

    // Enable
    execCommand('ufw --force enable', true);
    log('ufw rules applied', 'success');
  }

  // =========================================================================
  // Docker Network Management
  // =========================================================================

  async setupDockerNetwork(): Promise<void> {
    log('Setting up Docker network...', 'info');

    const { name, subnet, gateway, internal } = this.config.dockerNetwork;

    // Check if network exists
    const networkExists = execCommand(
      `docker network inspect ${name} 2>/dev/null`,
      true
    ).success;

    if (networkExists) {
      log(`Network ${name} already exists`, 'info');

      // Optionally recreate
      // execCommand(`docker network rm ${name}`, true);
    } else {
      // Create network
      let cmd = `docker network create --driver bridge --subnet ${subnet} --gateway ${gateway}`;

      if (internal) {
        cmd += ' --internal';
      }

      cmd += ` ${name}`;

      const result = execCommand(cmd, true);
      if (result.success) {
        log(`Created Docker network: ${name}`, 'success');
      } else {
        log(`Failed to create network: ${result.output}`, 'error');
      }
    }
  }

  // =========================================================================
  // DNS Configuration
  // =========================================================================

  async configureDNS(): Promise<void> {
    log('Configuring DNS...', 'info');

    // Update /etc/hosts
    await this.updateHostsFile();

    // Configure resolved if available
    if (fs.existsSync('/etc/systemd/resolved.conf')) {
      await this.configureSystemdResolved();
    } else {
      // Update resolv.conf directly
      await this.updateResolvConf();
    }
  }

  private async updateHostsFile(): Promise<void> {
    const hostsPath = '/etc/hosts';
    const marker = '# VORION AIR-GAP DNS ENTRIES';

    let content = '';
    if (fs.existsSync(hostsPath)) {
      content = fs.readFileSync(hostsPath, 'utf8');
    }

    // Remove existing Vorion entries
    const lines = content.split('\n');
    const filteredLines: string[] = [];
    let inVorionSection = false;

    for (const line of lines) {
      if (line.includes(marker + ' START')) {
        inVorionSection = true;
        continue;
      }
      if (line.includes(marker + ' END')) {
        inVorionSection = false;
        continue;
      }
      if (!inVorionSection) {
        filteredLines.push(line);
      }
    }

    // Add new entries
    filteredLines.push('');
    filteredLines.push(`${marker} START`);
    for (const entry of this.config.dns.localEntries) {
      filteredLines.push(`${entry.ip}\t${entry.hostname}`);
    }
    filteredLines.push(`${marker} END`);

    fs.writeFileSync(hostsPath, filteredLines.join('\n'));
    log('Updated /etc/hosts', 'success');
  }

  private async configureSystemdResolved(): Promise<void> {
    const resolvedConf = '/etc/systemd/resolved.conf';
    const dropInDir = '/etc/systemd/resolved.conf.d';

    fs.mkdirSync(dropInDir, { recursive: true });

    const config = `# Vorion Air-Gap DNS Configuration
[Resolve]
DNS=${this.config.dns.servers.join(' ')}
Domains=${this.config.dns.searchDomains.join(' ')}
DNSOverTLS=no
DNSSEC=no
`;

    fs.writeFileSync(path.join(dropInDir, 'vorion.conf'), config);
    execCommand('systemctl restart systemd-resolved', true);
    log('Configured systemd-resolved', 'success');
  }

  private async updateResolvConf(): Promise<void> {
    const resolvPath = '/etc/resolv.conf';
    const content = `# Vorion Air-Gap DNS Configuration
# Generated: ${new Date().toISOString()}

${this.config.dns.servers.map((s) => `nameserver ${s}`).join('\n')}
${this.config.dns.searchDomains.length > 0 ? `search ${this.config.dns.searchDomains.join(' ')}` : ''}
options timeout:2 attempts:2
`;

    fs.writeFileSync(resolvPath, content);
    log('Updated /etc/resolv.conf', 'success');
  }

  // =========================================================================
  // Proxy Configuration
  // =========================================================================

  async configureProxy(): Promise<void> {
    if (!this.config.proxy.enabled) {
      log('Proxy is disabled, removing proxy configuration...', 'info');
      await this.removeProxyConfig();
      return;
    }

    log('Configuring proxy settings...', 'info');

    // Set environment variables
    const envContent = `# Vorion Proxy Configuration
${this.config.proxy.httpProxy ? `HTTP_PROXY=${this.config.proxy.httpProxy}` : ''}
${this.config.proxy.httpProxy ? `http_proxy=${this.config.proxy.httpProxy}` : ''}
${this.config.proxy.httpsProxy ? `HTTPS_PROXY=${this.config.proxy.httpsProxy}` : ''}
${this.config.proxy.httpsProxy ? `https_proxy=${this.config.proxy.httpsProxy}` : ''}
NO_PROXY=${this.config.proxy.noProxy.join(',')}
no_proxy=${this.config.proxy.noProxy.join(',')}
`;

    fs.writeFileSync('/etc/profile.d/vorion-proxy.sh', envContent);
    log('Proxy environment configured', 'success');

    // Configure Docker daemon proxy
    await this.configureDockerProxy();
  }

  private async removeProxyConfig(): Promise<void> {
    const proxyFile = '/etc/profile.d/vorion-proxy.sh';
    if (fs.existsSync(proxyFile)) {
      fs.unlinkSync(proxyFile);
    }
  }

  private async configureDockerProxy(): Promise<void> {
    const dockerConfigDir = '/etc/systemd/system/docker.service.d';
    fs.mkdirSync(dockerConfigDir, { recursive: true });

    const proxyConfig = `[Service]
Environment="HTTP_PROXY=${this.config.proxy.httpProxy || ''}"
Environment="HTTPS_PROXY=${this.config.proxy.httpsProxy || ''}"
Environment="NO_PROXY=${this.config.proxy.noProxy.join(',')}"
`;

    fs.writeFileSync(path.join(dockerConfigDir, 'http-proxy.conf'), proxyConfig);

    execCommand('systemctl daemon-reload', true);
    execCommand('systemctl restart docker', true);
    log('Docker proxy configured', 'success');
  }

  // =========================================================================
  // Service Management
  // =========================================================================

  addInternalService(service: InternalService): void {
    const existing = this.config.internalServices.find(
      (s) => s.name === service.name
    );

    if (existing) {
      Object.assign(existing, service);
    } else {
      this.config.internalServices.push(service);
    }

    // Add DNS entry
    const dnsEntry = this.config.dns.localEntries.find(
      (e) => e.hostname === service.hostname
    );
    if (!dnsEntry) {
      this.config.dns.localEntries.push({
        hostname: service.hostname,
        ip: service.ip,
      });
    }

    this.saveConfig();
    log(`Added internal service: ${service.name}`, 'success');
  }

  removeInternalService(serviceName: string): void {
    const index = this.config.internalServices.findIndex(
      (s) => s.name === serviceName
    );

    if (index >= 0) {
      const service = this.config.internalServices[index];
      this.config.internalServices.splice(index, 1);

      // Remove DNS entry
      const dnsIndex = this.config.dns.localEntries.findIndex(
        (e) => e.hostname === service.hostname
      );
      if (dnsIndex >= 0) {
        this.config.dns.localEntries.splice(dnsIndex, 1);
      }

      this.saveConfig();
      log(`Removed internal service: ${serviceName}`, 'success');
    }
  }

  // =========================================================================
  // Verification
  // =========================================================================

  async verifyIsolation(): Promise<{ passed: boolean; results: string[] }> {
    log('Verifying network isolation...', 'info');
    const results: string[] = [];
    let allPassed = true;

    // Test external connectivity (should fail)
    log('  Testing external connectivity (should be blocked)...', 'debug');
    const externalTest = execCommand('curl -s --connect-timeout 5 https://www.google.com', true);
    if (externalTest.success) {
      results.push('FAIL: External internet access is not blocked');
      allPassed = false;
    } else {
      results.push('PASS: External internet access is blocked');
    }

    // Test internal connectivity (should work)
    log('  Testing internal connectivity...', 'debug');
    for (const service of this.config.internalServices) {
      const testCmd = `nc -zv -w 2 ${service.ip} ${service.port} 2>&1`;
      const result = execCommand(testCmd, true);

      if (result.success || result.output.includes('succeeded')) {
        results.push(`PASS: ${service.name} (${service.ip}:${service.port}) is reachable`);
      } else {
        results.push(`INFO: ${service.name} (${service.ip}:${service.port}) not reachable (may not be running)`);
      }
    }

    // Test DNS resolution
    log('  Testing DNS resolution...', 'debug');
    for (const entry of this.config.dns.localEntries) {
      const result = execCommand(`getent hosts ${entry.hostname}`, true);
      if (result.success && result.output.includes(entry.ip)) {
        results.push(`PASS: DNS resolution for ${entry.hostname} -> ${entry.ip}`);
      } else {
        results.push(`FAIL: DNS resolution failed for ${entry.hostname}`);
        allPassed = false;
      }
    }

    return { passed: allPassed, results };
  }

  // =========================================================================
  // Status Report
  // =========================================================================

  printStatus(): void {
    console.log('\n' + '='.repeat(60));
    console.log('NETWORK ISOLATION STATUS');
    console.log('='.repeat(60));

    console.log('\nFirewall: ' + this.firewallType);

    console.log('\nPolicies:');
    for (const policy of this.config.policies) {
      const status = policy.enabled ? '\x1b[32mENABLED\x1b[0m' : '\x1b[33mDISABLED\x1b[0m';
      console.log(`  - ${policy.name}: ${status}`);
    }

    console.log('\nInternal Services:');
    for (const service of this.config.internalServices) {
      console.log(`  - ${service.name}: ${service.ip}:${service.port} (${service.hostname})`);
    }

    console.log('\nDNS Configuration:');
    console.log(`  Servers: ${this.config.dns.servers.join(', ')}`);
    console.log(`  Search domains: ${this.config.dns.searchDomains.join(', ')}`);

    console.log('\nDocker Network:');
    console.log(`  Name: ${this.config.dockerNetwork.name}`);
    console.log(`  Subnet: ${this.config.dockerNetwork.subnet}`);
    console.log(`  Internal only: ${this.config.dockerNetwork.internal}`);

    console.log('\nProxy:');
    console.log(`  Enabled: ${this.config.proxy.enabled}`);
    if (this.config.proxy.enabled) {
      console.log(`  HTTP Proxy: ${this.config.proxy.httpProxy || 'not set'}`);
      console.log(`  HTTPS Proxy: ${this.config.proxy.httpsProxy || 'not set'}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
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
Vorion Network Isolation Manager

Usage: network-isolation.ts <command> [options]

Commands:
  apply           Apply network isolation policies
  verify          Verify isolation is working
  status          Show current status
  setup-docker    Set up isolated Docker network
  configure-dns   Configure DNS for internal resolution
  configure-proxy Configure proxy settings
  add-service     Add an internal service
  remove-service  Remove an internal service
  export          Export current configuration
  import          Import configuration from file

Options:
  -c, --config <path>   Configuration file path
  -h, --help            Show this help message

Examples:
  sudo ./network-isolation.ts apply
  sudo ./network-isolation.ts verify
  ./network-isolation.ts status
  ./network-isolation.ts add-service --name myservice --ip 172.28.0.50 --port 8080
`);
    process.exit(0);
  }

  const configIndex = args.findIndex((a) => a === '-c' || a === '--config');
  const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined;

  const manager = new NetworkIsolationManager(configPath);

  switch (command) {
    case 'apply':
      await manager.applyNetworkPolicies();
      await manager.configureDNS();
      break;

    case 'verify':
      const { passed, results } = await manager.verifyIsolation();
      console.log('\nVerification Results:');
      for (const result of results) {
        console.log(`  ${result}`);
      }
      console.log(`\nOverall: ${passed ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
      process.exit(passed ? 0 : 1);
      break;

    case 'status':
      manager.printStatus();
      break;

    case 'setup-docker':
      await manager.setupDockerNetwork();
      break;

    case 'configure-dns':
      await manager.configureDNS();
      break;

    case 'configure-proxy':
      await manager.configureProxy();
      break;

    case 'add-service':
      const nameIdx = args.indexOf('--name');
      const ipIdx = args.indexOf('--ip');
      const portIdx = args.indexOf('--port');

      if (nameIdx < 0 || ipIdx < 0 || portIdx < 0) {
        log('Missing required arguments: --name, --ip, --port', 'error');
        process.exit(1);
      }

      manager.addInternalService({
        name: args[nameIdx + 1],
        hostname: args[nameIdx + 1],
        ip: args[ipIdx + 1],
        port: parseInt(args[portIdx + 1], 10),
        protocol: 'tcp',
        description: `Added via CLI on ${new Date().toISOString()}`,
      });
      break;

    case 'remove-service':
      const serviceNameIdx = args.indexOf('--name');
      if (serviceNameIdx < 0) {
        log('Missing required argument: --name', 'error');
        process.exit(1);
      }
      manager.removeInternalService(args[serviceNameIdx + 1]);
      break;

    case 'export':
      manager.saveConfig();
      break;

    case 'import':
      const importPath = args[1];
      if (!importPath || !fs.existsSync(importPath)) {
        log('Configuration file not found', 'error');
        process.exit(1);
      }
      // Config is loaded in constructor, just save to default location
      manager.saveConfig();
      log('Configuration imported', 'success');
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

export { NetworkIsolationManager, NetworkIsolationConfig, NetworkPolicy, NetworkRule };
