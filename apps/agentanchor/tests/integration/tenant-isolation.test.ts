/**
 * Tenant Isolation Integration Test
 *
 * Verifies that Row Level Security (RLS) properly isolates tenant data.
 * Requires a running Postgres instance (CI provides postgres service).
 *
 * Sprint: Foundation Hardening — Epic 4.1 (FR267)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL

const skipReason = !DATABASE_URL
  ? 'DATABASE_URL not set — skipping integration test (requires Postgres)'
  : undefined

const TENANT_A = 'a0000000-0000-0000-0000-000000000001'
const TENANT_B = 'b0000000-0000-0000-0000-000000000002'

describe.skipIf(!!skipReason)('Tenant Isolation (RLS)', () => {
  let adminPool: pg.Pool

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: DATABASE_URL })

    // Create test table with RLS
    await adminPool.query(`
      DROP TABLE IF EXISTS _test_rls_items CASCADE;
      CREATE TABLE _test_rls_items (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id UUID NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      -- Helper function for tenant context
      CREATE OR REPLACE FUNCTION get_current_tenant_id()
      RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::TEXT; $$;

      -- Enable RLS
      ALTER TABLE _test_rls_items ENABLE ROW LEVEL SECURITY;

      -- Force RLS even for table owner
      ALTER TABLE _test_rls_items FORCE ROW LEVEL SECURITY;

      -- Tenant-scoped SELECT
      DROP POLICY IF EXISTS test_rls_select ON _test_rls_items;
      CREATE POLICY test_rls_select ON _test_rls_items
        FOR SELECT USING (tenant_id::text = get_current_tenant_id());

      -- Tenant-scoped INSERT
      DROP POLICY IF EXISTS test_rls_insert ON _test_rls_items;
      CREATE POLICY test_rls_insert ON _test_rls_items
        FOR INSERT WITH CHECK (tenant_id::text = get_current_tenant_id());

      -- Tenant-scoped UPDATE
      DROP POLICY IF EXISTS test_rls_update ON _test_rls_items;
      CREATE POLICY test_rls_update ON _test_rls_items
        FOR UPDATE USING (tenant_id::text = get_current_tenant_id());

      -- Tenant-scoped DELETE
      DROP POLICY IF EXISTS test_rls_delete ON _test_rls_items;
      CREATE POLICY test_rls_delete ON _test_rls_items
        FOR DELETE USING (tenant_id::text = get_current_tenant_id());
    `)

    // Create a non-superuser role for RLS testing (superusers always bypass RLS)
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '_test_rls_user') THEN
          CREATE ROLE _test_rls_user NOLOGIN;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO _test_rls_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON _test_rls_items TO _test_rls_user;
    `)

    // Seed data as superuser (bypasses RLS)
    await adminPool.query(`
      INSERT INTO _test_rls_items (tenant_id, name) VALUES
        ('${TENANT_A}', 'Alpha Item 1'),
        ('${TENANT_A}', 'Alpha Item 2'),
        ('${TENANT_A}', 'Alpha Item 3'),
        ('${TENANT_B}', 'Bravo Item 1'),
        ('${TENANT_B}', 'Bravo Item 2');
    `)
  })

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query('DROP TABLE IF EXISTS _test_rls_items CASCADE')
      await adminPool.query('REVOKE ALL ON SCHEMA public FROM _test_rls_user')
      await adminPool.query('DROP ROLE IF EXISTS _test_rls_user')
      await adminPool.end()
    }
  })

  /**
   * Execute query as a specific tenant with RLS enforced.
   * Uses BEGIN/ROLLBACK transaction so SET LOCAL persists across statements.
   * Uses SET ROLE to switch to non-superuser (superusers bypass RLS).
   */
  async function queryAsTenant(tenantId: string, sql: string, params?: unknown[]) {
    const client = await adminPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE _test_rls_user')
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)
      const result = await client.query(sql, params)
      await client.query('ROLLBACK')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  it('tenant A sees only its own rows', async () => {
    const result = await queryAsTenant(TENANT_A, 'SELECT * FROM _test_rls_items')
    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((r: { tenant_id: string }) => r.tenant_id === TENANT_A)).toBe(true)
  })

  it('tenant B sees only its own rows', async () => {
    const result = await queryAsTenant(TENANT_B, 'SELECT * FROM _test_rls_items')
    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((r: { tenant_id: string }) => r.tenant_id === TENANT_B)).toBe(true)
  })

  it('tenant A cannot read tenant B data', async () => {
    const result = await queryAsTenant(
      TENANT_A,
      `SELECT * FROM _test_rls_items WHERE tenant_id = $1`,
      [TENANT_B],
    )
    expect(result.rows).toHaveLength(0)
  })

  it('tenant A cannot insert with tenant B id', async () => {
    await expect(
      queryAsTenant(
        TENANT_A,
        `INSERT INTO _test_rls_items (tenant_id, name) VALUES ($1, $2)`,
        [TENANT_B, 'Sneaky Item'],
      ),
    ).rejects.toThrow()
  })

  it('tenant B cannot update tenant A rows', async () => {
    const result = await queryAsTenant(
      TENANT_B,
      `UPDATE _test_rls_items SET name = 'Hijacked' WHERE tenant_id = $1 RETURNING *`,
      [TENANT_A],
    )
    expect(result.rows).toHaveLength(0)

    // Verify tenant A data is unchanged
    const check = await queryAsTenant(TENANT_A, 'SELECT * FROM _test_rls_items')
    expect(check.rows.every((r: { name: string }) => r.name !== 'Hijacked')).toBe(true)
  })

  it('tenant B cannot delete tenant A rows', async () => {
    const result = await queryAsTenant(
      TENANT_B,
      `DELETE FROM _test_rls_items WHERE tenant_id = $1 RETURNING *`,
      [TENANT_A],
    )
    expect(result.rows).toHaveLength(0)

    // Verify tenant A data still exists
    const check = await queryAsTenant(TENANT_A, 'SELECT * FROM _test_rls_items')
    expect(check.rows).toHaveLength(3)
  })

  it('no tenant context returns zero rows', async () => {
    const client = await adminPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE _test_rls_user')
      await client.query("SET LOCAL app.current_tenant_id = ''")
      const result = await client.query('SELECT * FROM _test_rls_items')
      await client.query('ROLLBACK')
      expect(result.rows).toHaveLength(0)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  it('row count is correct per tenant', async () => {
    const resultA = await queryAsTenant(TENANT_A, 'SELECT COUNT(*) FROM _test_rls_items')
    const resultB = await queryAsTenant(TENANT_B, 'SELECT COUNT(*) FROM _test_rls_items')
    expect(Number(resultA.rows[0].count)).toBe(3)
    expect(Number(resultB.rows[0].count)).toBe(2)
  })
})
