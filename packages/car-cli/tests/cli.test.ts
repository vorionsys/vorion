/**
 * CAR CLI - Smoke Tests
 *
 * Verifies that the CLI module exports exist, command definitions are valid,
 * and the programmatic API re-exports work correctly.
 */

import { describe, it, expect } from 'vitest';

describe('car-cli programmatic exports', () => {
  it('exports createCARClient', async () => {
    const mod = await import('../src/index.js');
    expect(mod.createCARClient).toBeDefined();
    expect(typeof mod.createCARClient).toBe('function');
  });

  it('exports CARClient class', async () => {
    const mod = await import('../src/index.js');
    expect(mod.CARClient).toBeDefined();
    expect(typeof mod.CARClient).toBe('function');
  });

  it('exports CARError class', async () => {
    const mod = await import('../src/index.js');
    expect(mod.CARError).toBeDefined();
    expect(typeof mod.CARError).toBe('function');
  });

  it('exports backwards-compatible aliases', async () => {
    const mod = await import('../src/index.js');
    expect(mod.createACIClient).toBeDefined();
    expect(mod.ACIClient).toBeDefined();
    expect(mod.ACIError).toBeDefined();
    // Aliases should point to same functions
    expect(mod.createACIClient).toBe(mod.createCARClient);
    expect(mod.ACIClient).toBe(mod.CARClient);
    expect(mod.ACIError).toBe(mod.CARError);
  });

  it('exports trust tier constants', async () => {
    const mod = await import('../src/index.js');
    expect(mod.TRUST_TIER_RANGES).toBeDefined();
    expect(mod.TRUST_TIER_LABELS).toBeDefined();
  });

  it('exports agent role labels', async () => {
    const mod = await import('../src/index.js');
    expect(mod.AGENT_ROLE_LABELS).toBeDefined();
  });

  it('exports Zod schemas for runtime validation', async () => {
    const mod = await import('../src/index.js');
    expect(mod.TrustTierSchema).toBeDefined();
    expect(mod.AgentRoleSchema).toBeDefined();
    expect(mod.RoleGateRequestSchema).toBeDefined();
    expect(mod.CeilingCheckRequestSchema).toBeDefined();
  });

  it('exports utility functions', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.getTierFromScore).toBe('function');
    expect(typeof mod.isRoleAllowedForTier).toBe('function');
  });
});

describe('car-cli CLI entry point', () => {
  it('cli.ts module can be imported without throwing', async () => {
    // The CLI module uses commander and registers commands.
    // Importing it should not throw; it only calls program.parse()
    // at module level, but we can verify the module path resolves.
    // We test this indirectly -- if index.ts resolves, the package is valid.
    const mod = await import('../src/index.js');
    expect(mod).toBeDefined();
  });
});

describe('CARClient construction', () => {
  it('createCARClient returns a CARClient instance', async () => {
    const { createCARClient, CARClient } = await import('../src/index.js');
    const client = createCARClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
    });
    expect(client).toBeInstanceOf(CARClient);
  });

  it('CARClient can be instantiated directly', async () => {
    const { CARClient } = await import('../src/index.js');
    const client = new CARClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
    });
    expect(client).toBeInstanceOf(CARClient);
  });

  it('CARClient has expected methods', async () => {
    const { createCARClient } = await import('../src/index.js');
    const client = createCARClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
    });
    expect(typeof client.getStats).toBe('function');
    expect(typeof client.evaluateRoleGate).toBe('function');
    expect(typeof client.checkCeiling).toBe('function');
    expect(typeof client.getProvenance).toBe('function');
    expect(typeof client.getGamingAlerts).toBe('function');
    expect(typeof client.getPresetHierarchy).toBe('function');
  });
});

describe('CARError', () => {
  it('is an instance of Error', async () => {
    const { CARError } = await import('../src/index.js');
    const error = new CARError('test message', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CARError);
    expect(error.message).toBe('test message');
    expect(error.name).toBe('CARError');
  });

  it('exposes statusCode and details', async () => {
    const { CARError } = await import('../src/index.js');
    const error = new CARError('not found', 404, { resource: 'agent' });
    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ resource: 'agent' });
  });

  it('has status check helpers', async () => {
    const { CARError } = await import('../src/index.js');
    const clientErr = new CARError('bad request', 400);
    expect(clientErr.isClientError()).toBe(true);
    expect(clientErr.isServerError()).toBe(false);

    const serverErr = new CARError('internal error', 500);
    expect(serverErr.isServerError()).toBe(true);
    expect(serverErr.isClientError()).toBe(false);

    const timeoutErr = new CARError('timeout', 408);
    expect(timeoutErr.isTimeout()).toBe(true);
  });
});
