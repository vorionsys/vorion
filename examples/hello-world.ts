/**
 * Vorion Hello World Example
 *
 * This example demonstrates the basic workflow of submitting an intent
 * through Vorion's governance platform.
 *
 * Prerequisites:
 * - PostgreSQL running with the Vorion schema
 * - Redis running (or VORION_LITE_ENABLED=true for in-memory)
 * - Environment variables configured (see .env.example)
 *
 * To run this example:
 *   npx tsx examples/hello-world.ts
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// STEP 1: Import Vorion components
// ============================================================================

// The IntentService handles all intent lifecycle operations
import {
  IntentService,
  type IntentSubmission,
  type SubmitOptions,
  type ListOptions,
} from '../src/intent/index.js';

// ============================================================================
// STEP 2: Configuration
// ============================================================================

// In production, these come from environment variables (see CONFIG_REFERENCE.md)
// For this example, we'll use the defaults which work with local development

console.log('Vorion Hello World Example');
console.log('==========================\n');

// ============================================================================
// STEP 3: Create the Intent Service
// ============================================================================

async function main() {
  console.log('Step 1: Creating IntentService...');

  // The IntentService constructor accepts optional dependencies for testing.
  // When no dependencies are provided, it uses the configured globals.
  // This requires:
  // - Database connection (configured via VORION_DB_* env vars)
  // - Redis connection (configured via VORION_REDIS_* env vars)
  const intentService = new IntentService();

  console.log('  IntentService created successfully.\n');

  // ============================================================================
  // STEP 4: Prepare an Intent
  // ============================================================================

  console.log('Step 2: Preparing intent submission...');

  // An intent represents a goal that an AI agent wants to accomplish.
  // Vorion evaluates intents against governance rules before allowing execution.

  // Generate unique IDs (in production, these would come from your system)
  const entityId = randomUUID();
  const tenantId = randomUUID();

  const intentSubmission: IntentSubmission = {
    // The entity (agent) requesting to perform this action
    entityId,

    // Human-readable description of what the agent wants to do
    goal: 'Send welcome email to new customer',

    // Structured context with details about the action
    context: {
      action: 'send_email',
      recipient: 'customer@example.com',
      template: 'welcome_new_customer',
      customer_name: 'Jane Doe',
    },

    // Optional: categorize the intent type for policy matching
    intentType: 'customer_communication',

    // Optional: priority level (0-10, where 0 is lowest)
    priority: 5,

    // Optional: idempotency key prevents duplicate submissions
    idempotencyKey: `welcome-email-${entityId}-${Date.now()}`,
  };

  // Submit options include tenant context and optional trust information
  const submitOptions: SubmitOptions = {
    // Required: tenant ID for multi-tenant isolation
    tenantId,

    // Optional: snapshot of trust state at submission time
    trustSnapshot: {
      level: 2,
      score: 65,
      lastEvaluated: new Date().toISOString(),
    },

    // Optional: current trust level for gate validation (0-4)
    trustLevel: '2',
  };

  console.log('  Intent prepared:');
  console.log(`    Entity ID: ${intentSubmission.entityId}`);
  console.log(`    Goal: ${intentSubmission.goal}`);
  console.log(`    Type: ${intentSubmission.intentType}`);
  console.log(`    Tenant ID: ${submitOptions.tenantId}\n`);

  // ============================================================================
  // STEP 5: Submit the Intent
  // ============================================================================

  console.log('Step 3: Submitting intent to Vorion...');

  try {
    // Submit the intent for governance evaluation
    // This triggers the following pipeline:
    // 1. Validation - ensures the intent is well-formed
    // 2. Deduplication - checks for duplicate submissions
    // 3. Trust Gate - verifies the entity has sufficient trust level
    // 4. Policy Evaluation - checks against governance rules
    // 5. Evidence Recording - creates an immutable proof record

    const result = await intentService.submit(intentSubmission, submitOptions);

    console.log('  Intent submitted successfully!');
    console.log(`    Intent ID: ${result.id}`);
    console.log(`    Status: ${result.status}`);
    console.log(`    Created At: ${result.createdAt}`);

    // ============================================================================
    // STEP 6: Check Intent Status
    // ============================================================================

    console.log('\nStep 4: Retrieving intent status...');

    // You can retrieve the intent at any time to check its status
    const retrievedIntent = await intentService.get(result.id, tenantId);

    if (retrievedIntent) {
      console.log('  Intent retrieved:');
      console.log(`    ID: ${retrievedIntent.id}`);
      console.log(`    Status: ${retrievedIntent.status}`);
      console.log(`    Goal: ${retrievedIntent.goal}`);

      // Status can be one of:
      // - pending: Waiting for evaluation
      // - evaluating: Currently being evaluated
      // - approved: Passed all governance checks
      // - denied: Failed governance checks
      // - executing: Currently being executed
      // - completed: Successfully completed
      // - failed: Execution failed
      // - cancelled: Cancelled by user or system
    }

    // ============================================================================
    // STEP 7: List Entity Intents (Optional)
    // ============================================================================

    console.log('\nStep 5: Listing all intents for this entity...');

    const listOptions: ListOptions = {
      tenantId,
      entityId,
      limit: 10,
    };

    const entityIntents = await intentService.list(listOptions);

    console.log(`  Found ${entityIntents.total} intent(s) for entity ${entityId}`);
    for (const intent of entityIntents.items) {
      console.log(`    - ${intent.id}: ${intent.status} - ${intent.goal}`);
    }

    console.log('\n========================================');
    console.log('Hello World example completed successfully!');
    console.log('========================================\n');

    console.log('Next steps:');
    console.log('  1. Check CONFIG_REFERENCE.md for all configuration options');
    console.log('  2. Read TROUBLESHOOTING.md if you encounter issues');
    console.log('  3. Explore the API documentation at /api/v1/docs');

  } catch (error) {
    // ============================================================================
    // ERROR HANDLING
    // ============================================================================

    console.error('\nError submitting intent:');

    if (error instanceof Error) {
      console.error(`  Message: ${error.message}`);

      // Common errors and solutions:
      // - "Trust level insufficient" -> Entity needs higher trust score
      // - "Consent required" -> User consent is needed for this action
      // - "Rate limit exceeded" -> Too many requests, wait and retry
      // - "Database connection failed" -> Check DATABASE_URL config

      console.error('\nSee TROUBLESHOOTING.md for common error solutions.');
    } else {
      console.error('  Unknown error:', error);
    }

    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
