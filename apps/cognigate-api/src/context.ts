/**
 * Runtime Context
 *
 * Holds shared instances of TrustFacade, ProofCommitter, and IntentPipeline
 * for use across all routes.
 *
 * Supports both in-memory (testing) and SQLite (production) storage modes.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  TrustFacade,
  createTrustFacade,
  ProofCommitter,
  createProofCommitter,
  IntentPipeline,
  createIntentPipeline,
  InMemoryProofStore,
  SQLiteProofStore,
  createSQLiteProofStore,
  SQLiteTrustStore,
  createSQLiteTrustStore,
  type TrustFacadeConfig,
  type ProofCommitterConfig,
  type ProofStore,
} from '@vorionsys/runtime';

export interface RuntimeContext {
  trustFacade: TrustFacade;
  proofCommitter: ProofCommitter;
  intentPipeline: IntentPipeline;
  proofStore: ProofStore;
  trustStore?: SQLiteTrustStore;
}

export interface ContextConfig {
  trustFacade?: Partial<TrustFacadeConfig>;
  proofCommitter?: Partial<ProofCommitterConfig>;
  /** Storage mode: 'memory' for in-memory, 'sqlite' for persistent */
  storageMode?: 'memory' | 'sqlite';
  /** Database directory for SQLite mode (default: './data') */
  dataDir?: string;
}

let context: RuntimeContext | null = null;

/**
 * Initialize the runtime context
 */
export function initializeContext(config: ContextConfig = {}): RuntimeContext {
  if (context) {
    return context;
  }

  const storageMode = config.storageMode ?? (process.env.NODE_ENV === 'production' ? 'sqlite' : 'memory');
  const dataDir = config.dataDir ?? process.env.DATA_DIR ?? './data';

  let proofStore: ProofStore;
  let trustStore: SQLiteTrustStore | undefined;

  if (storageMode === 'sqlite') {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create SQLite stores
    proofStore = createSQLiteProofStore({
      dbPath: path.join(dataDir, 'proofs.db'),
    });

    trustStore = createSQLiteTrustStore({
      dbPath: path.join(dataDir, 'trust.db'),
    });

    console.log(`[context] Using SQLite storage in ${dataDir}`);
  } else {
    // Use in-memory stores (for testing/development)
    proofStore = new InMemoryProofStore();
    console.log('[context] Using in-memory storage');
  }

  // Create core components
  const trustFacade = createTrustFacade(config.trustFacade);
  const proofCommitter = createProofCommitter(
    {
      maxBufferSize: 100,
      flushIntervalMs: 1000,
      ...config.proofCommitter,
    },
    proofStore
  );

  // Create intent pipeline
  const intentPipeline = createIntentPipeline(trustFacade, proofCommitter);

  context = {
    trustFacade,
    proofCommitter,
    intentPipeline,
    proofStore,
    trustStore,
  };

  return context;
}

/**
 * Get the current runtime context
 */
export function getContext(): RuntimeContext {
  if (!context) {
    throw new Error('Runtime context not initialized. Call initializeContext() first.');
  }
  return context;
}

/**
 * Shutdown the runtime context
 */
export async function shutdownContext(): Promise<void> {
  if (context) {
    await context.intentPipeline.stop();

    // Close SQLite connections if using persistent storage
    if (context.proofStore instanceof SQLiteProofStore) {
      (context.proofStore as SQLiteProofStore).close();
    }
    if (context.trustStore) {
      context.trustStore.close();
    }

    context = null;
  }
}
