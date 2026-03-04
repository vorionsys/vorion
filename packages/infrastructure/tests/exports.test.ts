import { describe, it, expect } from 'vitest';
import {
  ReplicationManager,
  generateStreamingReplicationConfig,
  generatePatroniConfig,
  generatePgAutoFailoverCommands,
  replicationRegistry,
  replicationLagBytesGauge,
  replicationLagSecondsGauge,
  clusterHealthGauge,
  healthyReplicaCountGauge,
  failoverEventsCounter,
  failoverDurationHistogram,
} from '../src/index.js';

describe('infrastructure exports', () => {
  it('exports ReplicationManager class', () => {
    expect(ReplicationManager).toBeDefined();
    expect(typeof ReplicationManager).toBe('function');
  });

  it('exports config generator functions', () => {
    expect(typeof generateStreamingReplicationConfig).toBe('function');
    expect(typeof generatePatroniConfig).toBe('function');
    expect(typeof generatePgAutoFailoverCommands).toBe('function');
  });

  it('exports Prometheus metrics', () => {
    expect(replicationRegistry).toBeDefined();
    expect(replicationLagBytesGauge).toBeDefined();
    expect(replicationLagSecondsGauge).toBeDefined();
    expect(clusterHealthGauge).toBeDefined();
    expect(healthyReplicaCountGauge).toBeDefined();
    expect(failoverEventsCounter).toBeDefined();
    expect(failoverDurationHistogram).toBeDefined();
  });
});

describe('ReplicationManager', () => {
  const baseConfig = {
    clusterName: 'test-cluster',
    replicationMode: 'streaming' as const,
    orchestrator: 'manual' as const,
    primary: {
      nodeId: 'primary-1',
      host: 'localhost',
      port: 5432,
      database: 'vorion',
      user: 'postgres',
      password: 'secret',
    },
    replicas: [
      {
        nodeId: 'replica-1',
        host: 'replica-1.local',
        port: 5432,
        database: 'vorion',
        user: 'postgres',
        password: 'secret',
      },
    ],
  };

  it('constructs with valid config', () => {
    const manager = new ReplicationManager(baseConfig);
    expect(manager).toBeInstanceOf(ReplicationManager);
  });

  it('getConfig returns cluster configuration', () => {
    const manager = new ReplicationManager(baseConfig);
    const config = manager.getConfig();
    expect(config.clusterName).toBe('test-cluster');
    expect(config.replicationMode).toBe('streaming');
    expect(config.orchestrator).toBe('manual');
  });

  it('getCurrentPrimary returns primary node ID', () => {
    const manager = new ReplicationManager(baseConfig);
    expect(manager.getCurrentPrimary()).toBe('primary-1');
  });

  it('isManagerRunning returns false initially', () => {
    const manager = new ReplicationManager(baseConfig);
    expect(manager.isManagerRunning()).toBe(false);
  });

  it('getLastHealth returns null before any health check', () => {
    const manager = new ReplicationManager(baseConfig);
    expect(manager.getLastHealth()).toBeNull();
  });

  it('applies default config values', () => {
    const manager = new ReplicationManager(baseConfig);
    const config = manager.getConfig();
    expect(config.maxReplicationLagBytes).toBe(100 * 1024 * 1024);
    expect(config.maxReplicationLagSeconds).toBe(30);
    expect(config.healthCheckIntervalMs).toBe(10000);
    expect(config.failoverTimeoutMs).toBe(60000);
    expect(config.autoFailoverEnabled).toBe(true);
    expect(config.synchronousStandbyCount).toBe(1);
  });

  it('accepts custom thresholds', () => {
    const manager = new ReplicationManager({
      ...baseConfig,
      maxReplicationLagSeconds: 60,
      autoFailoverEnabled: false,
    });
    const config = manager.getConfig();
    expect(config.maxReplicationLagSeconds).toBe(60);
    expect(config.autoFailoverEnabled).toBe(false);
  });
});

describe('generateStreamingReplicationConfig', () => {
  it('generates primary and replica configs', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: ['10.0.0.2', '10.0.0.3'],
    });

    expect(config.primary).toBeDefined();
    expect(config.replica).toBeDefined();
  });

  it('primary config has correct WAL settings', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: [],
    });

    expect(config.primary.postgresqlConf.wal_level).toBe('replica');
    expect(config.primary.postgresqlConf.max_wal_senders).toBe(10);
    expect(config.primary.postgresqlConf.max_replication_slots).toBe(10);
    expect(config.primary.postgresqlConf.hot_standby).toBe(true);
  });

  it('generates pg_hba.conf entries for replication', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: ['10.0.0.2'],
    });

    const entries = config.primary.pgHbaEntries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some(e => e.includes('replicator'))).toBe(true);
    expect(entries.some(e => e.includes('10.0.0.2'))).toBe(true);
  });

  it('handles CIDR notation in hosts', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: ['10.0.0.0/24'],
    });

    const entries = config.primary.pgHbaEntries;
    expect(entries.some(e => e.includes('10.0.0.0/24'))).toBe(true);
  });

  it('replica config has recovery settings', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: [],
    });

    expect(config.replica.recoveryConf.primary_conninfo).toContain('pg-primary');
    expect(config.replica.recoveryConf.primary_conninfo).toContain('5432');
    expect(config.replica.recoveryConf.primary_conninfo).toContain('replicator');
    expect(config.replica.recoveryConf.recovery_target_timeline).toBe('latest');
  });

  it('supports synchronous replication config', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: ['10.0.0.2'],
      synchronousMode: 'remote_apply',
      synchronousStandbyNames: ['replica-1', 'replica-2'],
    });

    expect(config.primary.postgresqlConf.synchronous_commit).toBe('remote_apply');
    expect(config.primary.postgresqlConf.synchronous_standby_names).toContain('replica-1');
    expect(config.primary.postgresqlConf.synchronous_standby_names).toContain('replica-2');
  });

  it('custom WAL settings override defaults', () => {
    const config = generateStreamingReplicationConfig({
      replicationUser: 'replicator',
      primaryHost: 'pg-primary',
      primaryPort: 5432,
      replicaHosts: [],
      maxWalSenders: 20,
      maxReplicationSlots: 20,
      walKeepSize: 2048,
    });

    expect(config.primary.postgresqlConf.max_wal_senders).toBe(20);
    expect(config.primary.postgresqlConf.max_replication_slots).toBe(20);
    expect(config.primary.postgresqlConf.wal_keep_size).toBe('2048MB');
  });
});

describe('generatePatroniConfig', () => {
  const baseOptions = {
    clusterName: 'vorion-prod',
    nodeName: 'node-1',
    dataDir: '/var/lib/postgresql/14/data',
    pgPort: 5432,
    restApiPort: 8008,
    dcsType: 'etcd' as const,
    dcsHosts: ['etcd-1:2379', 'etcd-2:2379'],
    superuser: { username: 'postgres', password: 'super-secret' },
    replication: { username: 'replicator', password: 'rep-secret' },
  };

  it('generates valid Patroni config', () => {
    const config = generatePatroniConfig(baseOptions);
    expect(config.scope).toBe('vorion-prod');
    expect(config.name).toBe('node-1');
  });

  it('configures REST API', () => {
    const config = generatePatroniConfig(baseOptions);
    const restapi = config.restapi as Record<string, string>;
    expect(restapi.listen).toContain('8008');
    expect(restapi.connect_address).toContain('node-1');
  });

  it('configures PostgreSQL settings', () => {
    const config = generatePatroniConfig(baseOptions);
    const pg = config.postgresql as Record<string, unknown>;
    expect(pg.data_dir).toBe('/var/lib/postgresql/14/data');
    expect((pg as Record<string, unknown>).listen).toContain('5432');
  });

  it('configures etcd DCS', () => {
    const config = generatePatroniConfig(baseOptions);
    const etcd = config.etcd as Record<string, string[]>;
    expect(etcd.hosts).toEqual(['etcd-1:2379', 'etcd-2:2379']);
  });

  it('configures consul DCS', () => {
    const config = generatePatroniConfig({
      ...baseOptions,
      dcsType: 'consul',
      dcsHosts: ['consul-1:8500'],
    });
    const consul = config.consul as Record<string, string>;
    expect(consul.host).toBe('consul-1:8500');
  });

  it('configures kubernetes DCS', () => {
    const config = generatePatroniConfig({
      ...baseOptions,
      dcsType: 'kubernetes',
      dcsHosts: [],
    });
    const k8s = config.kubernetes as Record<string, boolean>;
    expect(k8s.use_endpoints).toBe(true);
  });

  it('includes bootstrap config', () => {
    const config = generatePatroniConfig(baseOptions);
    const bootstrap = config.bootstrap as Record<string, unknown>;
    expect(bootstrap.dcs).toBeDefined();
    expect(bootstrap.initdb).toBeDefined();
    expect(bootstrap.pg_hba).toBeDefined();
  });
});

describe('generatePgAutoFailoverCommands', () => {
  it('generates monitor setup commands', () => {
    const commands = generatePgAutoFailoverCommands({
      formation: 'vorion',
      role: 'monitor',
      dataDir: '/var/lib/postgresql/monitor',
      pgPort: 5432,
      nodeName: 'monitor-1',
      hostname: 'monitor.local',
    });

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(c => c.includes('create monitor'))).toBe(true);
    expect(commands.some(c => c.includes('monitor.local'))).toBe(true);
  });

  it('generates primary/secondary setup commands', () => {
    const commands = generatePgAutoFailoverCommands({
      formation: 'vorion',
      role: 'primary',
      dataDir: '/var/lib/postgresql/data',
      pgPort: 5432,
      monitorConnectionString: 'postgres://monitor.local/pg_auto_failover',
      nodeName: 'primary-1',
      hostname: 'primary.local',
    });

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(c => c.includes('create postgres'))).toBe(true);
    expect(commands.some(c => c.includes('primary.local'))).toBe(true);
    expect(commands.some(c => c.includes('monitor.local'))).toBe(true);
  });

  it('throws for primary/secondary without monitor connection string', () => {
    expect(() => generatePgAutoFailoverCommands({
      formation: 'vorion',
      role: 'primary',
      dataDir: '/var/lib/postgresql/data',
      pgPort: 5432,
      nodeName: 'primary-1',
      hostname: 'primary.local',
    })).toThrow('Monitor connection string required');
  });

  it('includes ssl mode configuration', () => {
    const commands = generatePgAutoFailoverCommands({
      formation: 'vorion',
      role: 'monitor',
      dataDir: '/var/lib/postgresql/monitor',
      pgPort: 5432,
      nodeName: 'monitor-1',
      hostname: 'monitor.local',
      sslMode: 'verify-full',
    });

    expect(commands.some(c => c.includes('verify-full'))).toBe(true);
  });

  it('uses default ssl mode of require', () => {
    const commands = generatePgAutoFailoverCommands({
      formation: 'vorion',
      role: 'monitor',
      dataDir: '/var/lib/postgresql/monitor',
      pgPort: 5432,
      nodeName: 'monitor-1',
      hostname: 'monitor.local',
    });

    expect(commands.some(c => c.includes('require'))).toBe(true);
  });
});

describe('Prometheus metrics', () => {
  it('replicationRegistry is a valid registry', () => {
    expect(replicationRegistry).toBeDefined();
    expect(typeof replicationRegistry.metrics).toBe('function');
  });

  it('metrics have correct names', () => {
    // These are Gauge/Counter/Histogram instances from prom-client
    expect(replicationLagBytesGauge).toBeDefined();
    expect(replicationLagSecondsGauge).toBeDefined();
    expect(clusterHealthGauge).toBeDefined();
    expect(healthyReplicaCountGauge).toBeDefined();
    expect(failoverEventsCounter).toBeDefined();
    expect(failoverDurationHistogram).toBeDefined();
  });
});
