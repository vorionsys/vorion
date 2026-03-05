/**
 * Import agents for specific users
 *
 * Usage:
 *   node scripts/import-agents-for-users.js
 *   node scripts/import-agents-for-users.js --dry-run
 */

const { Client } = require('pg');
const fs = require('node:fs');
require('dotenv').config({ path: '.env.local' });

const SEED_FILE = './data/seeds/ai-workforce-agents.json';
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');

// Target users — configure via TARGET_EMAILS env var (comma-separated)
// e.g. TARGET_EMAILS=user@example.com,other@example.com node scripts/import-agents-for-users.js
const TARGET_EMAILS = process.env.TARGET_EMAILS
  ? process.env.TARGET_EMAILS.split(',').map(e => e.trim()).filter(Boolean)
  : [];

async function main() {
  console.log('═'.repeat(60));
  console.log('   🚀 Import Agents for Multiple Users');
  console.log('═'.repeat(60));

  if (DRY_RUN) {
    console.log('\n   🔍 DRY RUN MODE\n');
  }

  // Load agents
  if (!fs.existsSync(SEED_FILE)) {
    console.error('❌ Seed file not found:', SEED_FILE);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const agents = data.agents || [];
  console.log(`\n📁 Loaded ${agents.length} agents from seed file\n`);

  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get user IDs for target emails
    const usersResult = await client.query(`
      SELECT id, email, full_name
      FROM profiles
      WHERE email = ANY($1)
    `, [TARGET_EMAILS]);

    console.log(`👥 Found ${usersResult.rows.length} users:\n`);
    for (const user of usersResult.rows) {
      console.log(`   • ${user.email} (${user.full_name || 'no name'})`);
    }

    if (usersResult.rows.length === 0) {
      console.error('\n❌ No matching users found');
      process.exit(1);
    }

    // Import for each user
    for (const user of usersResult.rows) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📥 Importing for: ${user.email}`);
      console.log(`${'─'.repeat(50)}\n`);

      let imported = 0;
      let skipped = 0;
      let errors = 0;

      for (const agent of agents) {
        try {
          // Check if already exists for this user
          const existing = await client.query(
            'SELECT id FROM agents WHERE owner_id = $1 AND name = $2',
            [user.id, agent.name]
          );

          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          if (DRY_RUN) {
            imported++;
            continue;
          }

          // Insert agent
          const result = await client.query(`
            INSERT INTO agents (
              owner_id, name, description, system_prompt, model,
              status, trust_score, config, metadata,
              created_at, updated_at, graduated_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, NOW(), NOW(), NOW())
            RETURNING id
          `, [
            user.id,
            agent.name,
            agent.description,
            agent.system_prompt,
            agent.model || 'claude-sonnet-4-20250514',
            agent.trust_score || 400,
            JSON.stringify(agent.config || {}),
            JSON.stringify(agent.metadata || {})
          ]);

          // Add trust history entry
          await client.query(`
            INSERT INTO trust_history (agent_id, previous_score, new_score, change, reason, source, created_at)
            VALUES ($1, 0, $2, $2, 'Founding Agent - platform import', 'manual_adjustment', NOW())
          `, [result.rows[0].id, agent.trust_score || 400]);

          imported++;

        } catch (err) {
          errors++;
          if (errors <= 3) {
            console.log(`   ❌ ${agent.name}: ${err.message}`);
          }
        }
      }

      console.log(`   ✅ Imported: ${imported}`);
      console.log(`   ⏭️  Skipped:  ${skipped}`);
      if (errors > 0) console.log(`   ❌ Errors:   ${errors}`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('   ✨ Done!');
    console.log('═'.repeat(60) + '\n');

  } finally {
    await client.end();
  }
}

main().catch(console.error);
