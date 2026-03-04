/**
 * Runtime Configuration
 *
 * Dynamic policy reload without restart, feature flags for enforcement modes,
 * and A/B testing for policy changes.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { withSpan, type TraceSpan } from '../common/trace.js';
import { secureRandomString, secureRandomFloat } from '../common/random.js';
import type { ID, Timestamp } from '../common/types.js';

const logger = createLogger({ component: 'runtime-config' });

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Feature flag definition
 */
export interface FeatureFlag {
  /** Unique flag identifier */
  id: ID;
  /** Flag name */
  name: string;
  /** Flag description */
  description?: string;
  /** Whether flag is enabled */
  enabled: boolean;
  /** Percentage of traffic to enable for (0-100) */
  percentage?: number;
  /** Specific entity IDs to include */
  includeEntities?: ID[];
  /** Specific entity IDs to exclude */
  excludeEntities?: ID[];
  /** Specific tenant IDs to include */
  includeTenants?: ID[];
  /** Specific tenant IDs to exclude */
  excludeTenants?: ID[];
  /** Expiration timestamp */
  expiresAt?: Timestamp;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Created timestamp */
  createdAt: Timestamp;
  /** Updated timestamp */
  updatedAt: Timestamp;
}

/**
 * Enforcement mode
 */
export type EnforcementMode =
  | 'strict'        // All policies enforced, deny on violation
  | 'permissive'    // Log violations but allow
  | 'audit-only'    // Only audit, no enforcement
  | 'shadow'        // Run enforcement but don't apply decision
  | 'disabled';     // No enforcement

/**
 * A/B test variant
 */
export interface ABTestVariant {
  /** Variant identifier */
  id: ID;
  /** Variant name */
  name: string;
  /** Traffic allocation percentage (0-100) */
  allocation: number;
  /** Configuration overrides for this variant */
  config: Record<string, unknown>;
  /** Metrics to track */
  metrics?: string[];
}

/**
 * A/B test definition
 */
export interface ABTest {
  /** Unique test identifier */
  id: ID;
  /** Test name */
  name: string;
  /** Test description */
  description?: string;
  /** Whether test is active */
  active: boolean;
  /** Test variants */
  variants: ABTestVariant[];
  /** Control variant ID */
  controlVariantId: ID;
  /** Traffic percentage for test (0-100) */
  trafficPercentage: number;
  /** Assignment strategy */
  assignmentStrategy: 'random' | 'entity-hash' | 'tenant-hash';
  /** Start timestamp */
  startedAt?: Timestamp;
  /** End timestamp */
  endedAt?: Timestamp;
  /** Target sample size */
  targetSampleSize?: number;
  /** Current sample counts per variant */
  sampleCounts: Map<ID, number>;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Created timestamp */
  createdAt: Timestamp;
  /** Updated timestamp */
  updatedAt: Timestamp;
}

/**
 * A/B test assignment result
 */
export interface ABTestAssignment {
  /** Test ID */
  testId: ID;
  /** Test name */
  testName: string;
  /** Assigned variant */
  variant: ABTestVariant;
  /** Assignment key (entity/tenant ID) */
  assignmentKey: string;
  /** Assignment timestamp */
  assignedAt: Timestamp;
}

/**
 * Policy configuration reload event
 */
export interface ReloadEvent {
  /** Event ID */
  id: ID;
  /** Event type */
  type: 'policy' | 'feature-flag' | 'ab-test' | 'config';
  /** Action taken */
  action: 'add' | 'update' | 'remove' | 'reload';
  /** Resource ID affected */
  resourceId?: ID;
  /** Old value (for updates) */
  oldValue?: unknown;
  /** New value */
  newValue?: unknown;
  /** Event timestamp */
  timestamp: Timestamp;
  /** Source of the change */
  source: string;
  /** Success status */
  success: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Configuration value with metadata
 */
export interface ConfigValue<T = unknown> {
  /** The configuration value */
  value: T;
  /** Default value */
  defaultValue: T;
  /** Value description */
  description?: string;
  /** Whether value can be changed at runtime */
  mutable: boolean;
  /** Validation function */
  validate?: (value: T) => boolean;
  /** Last updated timestamp */
  updatedAt: Timestamp;
  /** Update source */
  updatedBy?: string;
}

// =============================================================================
// RUNTIME CONFIG OPTIONS
// =============================================================================

/**
 * Runtime configuration options
 */
export interface RuntimeConfigOptions {
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Default enforcement mode */
  defaultEnforcementMode?: EnforcementMode;
  /** Reload check interval in ms */
  reloadCheckIntervalMs?: number;
  /** Maximum reload events to keep */
  maxReloadEvents?: number;
  /** Configuration source (for external config) */
  configSource?: ConfigSource;
  /** Enable A/B testing */
  enableABTesting?: boolean;
}

/**
 * Configuration source interface for external config systems
 */
export interface ConfigSource {
  /** Load all configuration */
  loadAll(): Promise<Record<string, unknown>>;
  /** Watch for changes */
  watch(callback: (key: string, value: unknown) => void): () => void;
  /** Get specific key */
  get(key: string): Promise<unknown>;
  /** Set specific key */
  set(key: string, value: unknown): Promise<void>;
}

/**
 * In-memory configuration source
 */
export class InMemoryConfigSource implements ConfigSource {
  private data: Map<string, unknown> = new Map();
  private watchers: Array<(key: string, value: unknown) => void> = [];

  async loadAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.data);
  }

  watch(callback: (key: string, value: unknown) => void): () => void {
    this.watchers.push(callback);
    return () => {
      const index = this.watchers.indexOf(callback);
      if (index !== -1) {
        this.watchers.splice(index, 1);
      }
    };
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    for (const watcher of this.watchers) {
      try {
        watcher(key, value);
      } catch (error) {
        logger.error({ key, error }, 'Config watcher error');
      }
    }
  }

  delete(key: string): boolean {
    const deleted = this.data.delete(key);
    if (deleted) {
      for (const watcher of this.watchers) {
        try {
          watcher(key, undefined);
        } catch (error) {
          logger.error({ key, error }, 'Config watcher error');
        }
      }
    }
    return deleted;
  }

  clear(): void {
    this.data.clear();
  }
}

// =============================================================================
// RUNTIME CONFIGURATION MANAGER
// =============================================================================

/**
 * RuntimeConfig class for dynamic configuration management
 */
export class RuntimeConfig {
  private options: Required<RuntimeConfigOptions>;
  private featureFlags: Map<ID, FeatureFlag> = new Map();
  private abTests: Map<ID, ABTest> = new Map();
  private configValues: Map<string, ConfigValue> = new Map();
  private reloadEvents: ReloadEvent[] = [];
  private configSource: ConfigSource;
  private enforcementMode: EnforcementMode;
  private changeListeners: Array<(event: ReloadEvent) => void> = [];
  private variantAssignments: Map<string, Map<ID, ID>> = new Map(); // entityId -> testId -> variantId

  constructor(options: RuntimeConfigOptions = {}) {
    this.options = {
      enableTracing: options.enableTracing ?? true,
      defaultEnforcementMode: options.defaultEnforcementMode ?? 'strict',
      reloadCheckIntervalMs: options.reloadCheckIntervalMs ?? 30000,
      maxReloadEvents: options.maxReloadEvents ?? 1000,
      configSource: options.configSource ?? new InMemoryConfigSource(),
      enableABTesting: options.enableABTesting ?? true,
    };

    this.configSource = this.options.configSource;
    this.enforcementMode = this.options.defaultEnforcementMode;

    logger.info({
      defaultEnforcementMode: this.enforcementMode,
      enableABTesting: this.options.enableABTesting,
    }, 'Runtime config initialized');
  }

  // =============================================================================
  // ENFORCEMENT MODE
  // =============================================================================

  /**
   * Get current enforcement mode
   */
  getEnforcementMode(): EnforcementMode {
    return this.enforcementMode;
  }

  /**
   * Set enforcement mode
   */
  setEnforcementMode(mode: EnforcementMode, source: string = 'api'): void {
    const oldMode = this.enforcementMode;
    this.enforcementMode = mode;

    this.recordEvent({
      type: 'config',
      action: 'update',
      resourceId: 'enforcement-mode',
      oldValue: oldMode,
      newValue: mode,
      source,
      success: true,
    });

    logger.info({ oldMode, newMode: mode, source }, 'Enforcement mode changed');
  }

  /**
   * Check if enforcement is active
   */
  isEnforcementActive(): boolean {
    return this.enforcementMode === 'strict' || this.enforcementMode === 'permissive';
  }

  /**
   * Check if should deny on violation
   */
  shouldDenyOnViolation(): boolean {
    return this.enforcementMode === 'strict';
  }

  /**
   * Check if should audit
   */
  shouldAudit(): boolean {
    return this.enforcementMode !== 'disabled';
  }

  // =============================================================================
  // FEATURE FLAGS
  // =============================================================================

  /**
   * Add a feature flag
   */
  addFeatureFlag(flag: FeatureFlag): void {
    this.featureFlags.set(flag.id, flag);

    this.recordEvent({
      type: 'feature-flag',
      action: 'add',
      resourceId: flag.id,
      newValue: flag,
      source: 'api',
      success: true,
    });

    logger.info({ flagId: flag.id, flagName: flag.name }, 'Feature flag added');
  }

  /**
   * Update a feature flag
   */
  updateFeatureFlag(flagId: ID, updates: Partial<FeatureFlag>, source: string = 'api'): boolean {
    const existing = this.featureFlags.get(flagId);
    if (!existing) {
      return false;
    }

    const updated: FeatureFlag = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.featureFlags.set(flagId, updated);

    this.recordEvent({
      type: 'feature-flag',
      action: 'update',
      resourceId: flagId,
      oldValue: existing,
      newValue: updated,
      source,
      success: true,
    });

    logger.info({ flagId, source }, 'Feature flag updated');
    return true;
  }

  /**
   * Remove a feature flag
   */
  removeFeatureFlag(flagId: ID, source: string = 'api'): boolean {
    const existing = this.featureFlags.get(flagId);
    if (!existing) {
      return false;
    }

    this.featureFlags.delete(flagId);

    this.recordEvent({
      type: 'feature-flag',
      action: 'remove',
      resourceId: flagId,
      oldValue: existing,
      source,
      success: true,
    });

    logger.info({ flagId, source }, 'Feature flag removed');
    return true;
  }

  /**
   * Check if a feature flag is enabled for a context
   */
  isFeatureEnabled(
    flagId: ID,
    context?: { entityId?: ID; tenantId?: ID }
  ): boolean {
    const flag = this.featureFlags.get(flagId);
    if (!flag) {
      return false;
    }

    // Check expiration
    if (flag.expiresAt && new Date(flag.expiresAt) < new Date()) {
      return false;
    }

    // Check base enabled
    if (!flag.enabled) {
      return false;
    }

    // Check entity exclusions/inclusions
    if (context?.entityId) {
      if (flag.excludeEntities?.includes(context.entityId)) {
        return false;
      }
      if (flag.includeEntities?.length && !flag.includeEntities.includes(context.entityId)) {
        // If include list exists, entity must be in it
        return false;
      }
    }

    // Check tenant exclusions/inclusions
    if (context?.tenantId) {
      if (flag.excludeTenants?.includes(context.tenantId)) {
        return false;
      }
      if (flag.includeTenants?.length && !flag.includeTenants.includes(context.tenantId)) {
        return false;
      }
    }

    // Check percentage rollout
    if (flag.percentage !== undefined && flag.percentage < 100) {
      const hash = this.hashString(
        `${flagId}:${context?.entityId ?? 'default'}:${context?.tenantId ?? 'default'}`
      );
      const bucket = hash % 100;
      return bucket < flag.percentage;
    }

    return true;
  }

  /**
   * Get all feature flags
   */
  getFeatureFlags(): FeatureFlag[] {
    return Array.from(this.featureFlags.values());
  }

  /**
   * Get a feature flag by ID
   */
  getFeatureFlag(flagId: ID): FeatureFlag | undefined {
    return this.featureFlags.get(flagId);
  }

  // =============================================================================
  // A/B TESTING
  // =============================================================================

  /**
   * Add an A/B test
   */
  addABTest(test: ABTest): void {
    if (!this.options.enableABTesting) {
      logger.warn({ testId: test.id }, 'A/B testing disabled');
      return;
    }

    this.abTests.set(test.id, test);

    this.recordEvent({
      type: 'ab-test',
      action: 'add',
      resourceId: test.id,
      newValue: test,
      source: 'api',
      success: true,
    });

    logger.info({ testId: test.id, testName: test.name }, 'A/B test added');
  }

  /**
   * Start an A/B test
   */
  startABTest(testId: ID): boolean {
    const test = this.abTests.get(testId);
    if (!test) {
      return false;
    }

    test.active = true;
    test.startedAt = new Date().toISOString();
    test.updatedAt = new Date().toISOString();

    this.recordEvent({
      type: 'ab-test',
      action: 'update',
      resourceId: testId,
      newValue: { active: true, startedAt: test.startedAt },
      source: 'api',
      success: true,
    });

    logger.info({ testId }, 'A/B test started');
    return true;
  }

  /**
   * Stop an A/B test
   */
  stopABTest(testId: ID): boolean {
    const test = this.abTests.get(testId);
    if (!test) {
      return false;
    }

    test.active = false;
    test.endedAt = new Date().toISOString();
    test.updatedAt = new Date().toISOString();

    this.recordEvent({
      type: 'ab-test',
      action: 'update',
      resourceId: testId,
      newValue: { active: false, endedAt: test.endedAt },
      source: 'api',
      success: true,
    });

    logger.info({ testId }, 'A/B test stopped');
    return true;
  }

  /**
   * Get A/B test variant assignment
   */
  getABTestAssignment(
    testId: ID,
    context: { entityId: ID; tenantId?: ID }
  ): ABTestAssignment | null {
    if (!this.options.enableABTesting) {
      return null;
    }

    const test = this.abTests.get(testId);
    if (!test || !test.active) {
      return null;
    }

    // Check if already assigned
    const entityAssignments = this.variantAssignments.get(context.entityId);
    if (entityAssignments?.has(testId)) {
      const variantId = entityAssignments.get(testId)!;
      const variant = test.variants.find(v => v.id === variantId);
      if (variant) {
        return {
          testId: test.id,
          testName: test.name,
          variant,
          assignmentKey: context.entityId,
          assignedAt: new Date().toISOString(),
        };
      }
    }

    // Check traffic percentage
    const trafficHash = this.hashString(`${testId}:traffic:${context.entityId}`);
    if ((trafficHash % 100) >= test.trafficPercentage) {
      return null; // Not in test
    }

    // Assign variant based on strategy
    const variant = this.assignVariant(test, context);
    if (!variant) {
      return null;
    }

    // Record assignment
    if (!this.variantAssignments.has(context.entityId)) {
      this.variantAssignments.set(context.entityId, new Map());
    }
    this.variantAssignments.get(context.entityId)!.set(testId, variant.id);

    // Update sample count
    test.sampleCounts.set(variant.id, (test.sampleCounts.get(variant.id) ?? 0) + 1);

    return {
      testId: test.id,
      testName: test.name,
      variant,
      assignmentKey: context.entityId,
      assignedAt: new Date().toISOString(),
    };
  }

  /**
   * Assign variant based on test strategy
   */
  private assignVariant(
    test: ABTest,
    context: { entityId: ID; tenantId?: ID }
  ): ABTestVariant | null {
    let hashInput: string;
    switch (test.assignmentStrategy) {
      case 'random':
        hashInput = `${test.id}:${Date.now()}:${secureRandomFloat()}`;
        break;
      case 'entity-hash':
        hashInput = `${test.id}:entity:${context.entityId}`;
        break;
      case 'tenant-hash':
        hashInput = `${test.id}:tenant:${context.tenantId ?? context.entityId}`;
        break;
      default:
        hashInput = `${test.id}:${context.entityId}`;
    }

    const hash = this.hashString(hashInput);
    const bucket = hash % 100;

    // Find variant based on allocation
    let cumulative = 0;
    for (const variant of test.variants) {
      cumulative += variant.allocation;
      if (bucket < cumulative) {
        return variant;
      }
    }

    // Fall back to control
    return test.variants.find(v => v.id === test.controlVariantId) ?? test.variants[0] ?? null;
  }

  /**
   * Get all A/B tests
   */
  getABTests(): ABTest[] {
    return Array.from(this.abTests.values());
  }

  /**
   * Get active A/B tests
   */
  getActiveABTests(): ABTest[] {
    return Array.from(this.abTests.values()).filter(t => t.active);
  }

  /**
   * Get A/B test by ID
   */
  getABTest(testId: ID): ABTest | undefined {
    return this.abTests.get(testId);
  }

  /**
   * Get A/B test results
   */
  getABTestResults(testId: ID): { variant: ABTestVariant; sampleCount: number }[] | null {
    const test = this.abTests.get(testId);
    if (!test) {
      return null;
    }

    return test.variants.map(variant => ({
      variant,
      sampleCount: test.sampleCounts.get(variant.id) ?? 0,
    }));
  }

  // =============================================================================
  // CONFIGURATION VALUES
  // =============================================================================

  /**
   * Set a configuration value
   */
  setConfig<T>(
    key: string,
    value: T,
    options?: {
      defaultValue?: T;
      description?: string;
      mutable?: boolean;
      validate?: (value: T) => boolean;
      source?: string;
    }
  ): boolean {
    const existing = this.configValues.get(key);

    // Check if mutable
    if (existing && !existing.mutable) {
      logger.warn({ key }, 'Attempted to modify immutable config');
      return false;
    }

    // Validate
    if (options?.validate && !options.validate(value)) {
      logger.warn({ key, value }, 'Config validation failed');
      return false;
    }

    const configValue: ConfigValue<T> = {
      value,
      defaultValue: (options?.defaultValue ?? existing?.defaultValue ?? value) as T,
      description: options?.description ?? existing?.description,
      mutable: options?.mutable ?? existing?.mutable ?? true,
      validate: options?.validate ?? (existing?.validate as ((value: T) => boolean) | undefined),
      updatedAt: new Date().toISOString(),
      updatedBy: options?.source,
    };

    this.configValues.set(key, configValue as ConfigValue);

    this.recordEvent({
      type: 'config',
      action: existing ? 'update' : 'add',
      resourceId: key,
      oldValue: existing?.value,
      newValue: value,
      source: options?.source ?? 'api',
      success: true,
    });

    logger.debug({ key, source: options?.source }, 'Config value set');
    return true;
  }

  /**
   * Get a configuration value
   */
  getConfig<T>(key: string, defaultValue?: T): T | undefined {
    const config = this.configValues.get(key);
    if (!config) {
      return defaultValue;
    }
    return config.value as T;
  }

  /**
   * Get config with metadata
   */
  getConfigWithMetadata<T>(key: string): ConfigValue<T> | undefined {
    return this.configValues.get(key) as ConfigValue<T> | undefined;
  }

  /**
   * Delete a configuration value
   */
  deleteConfig(key: string, source: string = 'api'): boolean {
    const existing = this.configValues.get(key);
    if (!existing) {
      return false;
    }

    this.configValues.delete(key);

    this.recordEvent({
      type: 'config',
      action: 'remove',
      resourceId: key,
      oldValue: existing.value,
      source,
      success: true,
    });

    logger.debug({ key, source }, 'Config value deleted');
    return true;
  }

  /**
   * Get all configuration keys
   */
  getConfigKeys(): string[] {
    return Array.from(this.configValues.keys());
  }

  /**
   * Get all configuration values
   */
  getAllConfig(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, config] of this.configValues) {
      result[key] = config.value;
    }
    return result;
  }

  // =============================================================================
  // RELOAD AND SYNC
  // =============================================================================

  /**
   * Reload configuration from source
   */
  async reload(source: string = 'system'): Promise<boolean> {
    try {
      const config = await this.configSource.loadAll();

      for (const [key, value] of Object.entries(config)) {
        this.setConfig(key, value, { source });
      }

      this.recordEvent({
        type: 'config',
        action: 'reload',
        source,
        success: true,
      });

      logger.info({ source }, 'Configuration reloaded');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.recordEvent({
        type: 'config',
        action: 'reload',
        source,
        success: false,
        error: message,
      });

      logger.error({ source, error: message }, 'Configuration reload failed');
      return false;
    }
  }

  /**
   * Sync configuration to source
   */
  async sync(source: string = 'system'): Promise<boolean> {
    try {
      for (const [key, config] of this.configValues) {
        await this.configSource.set(key, config.value);
      }

      logger.info({ source }, 'Configuration synced');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ source, error: message }, 'Configuration sync failed');
      return false;
    }
  }

  // =============================================================================
  // CHANGE LISTENERS
  // =============================================================================

  /**
   * Register a change listener
   */
  onConfigChange(listener: (event: ReloadEvent) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index !== -1) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Record a reload event and notify listeners
   */
  private recordEvent(
    event: Omit<ReloadEvent, 'id' | 'timestamp'>
  ): void {
    const fullEvent: ReloadEvent = {
      ...event,
      id: `event-${Date.now()}-${secureRandomString(9)}`,
      timestamp: new Date().toISOString(),
    };

    this.reloadEvents.push(fullEvent);

    // Trim if exceeds max
    if (this.reloadEvents.length > this.options.maxReloadEvents) {
      this.reloadEvents.splice(0, this.reloadEvents.length - this.options.maxReloadEvents);
    }

    // Notify listeners
    for (const listener of this.changeListeners) {
      try {
        listener(fullEvent);
      } catch (error) {
        logger.error({ eventId: fullEvent.id, error }, 'Change listener error');
      }
    }
  }

  /**
   * Get reload events
   */
  getReloadEvents(limit?: number): ReloadEvent[] {
    const events = [...this.reloadEvents].reverse();
    return limit ? events.slice(0, limit) : events;
  }

  // =============================================================================
  // UTILITIES
  // =============================================================================

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clear all configuration
   */
  clear(): void {
    this.featureFlags.clear();
    this.abTests.clear();
    this.configValues.clear();
    this.reloadEvents = [];
    this.variantAssignments.clear();
    this.enforcementMode = this.options.defaultEnforcementMode;

    logger.info('Runtime config cleared');
  }

  /**
   * Get configuration statistics
   */
  getStats(): {
    enforcementMode: EnforcementMode;
    featureFlags: number;
    enabledFlags: number;
    abTests: number;
    activeTests: number;
    configValues: number;
    reloadEvents: number;
  } {
    return {
      enforcementMode: this.enforcementMode,
      featureFlags: this.featureFlags.size,
      enabledFlags: Array.from(this.featureFlags.values()).filter(f => f.enabled).length,
      abTests: this.abTests.size,
      activeTests: Array.from(this.abTests.values()).filter(t => t.active).length,
      configValues: this.configValues.size,
      reloadEvents: this.reloadEvents.length,
    };
  }
}

/**
 * Create a new runtime config instance
 */
export function createRuntimeConfig(options?: RuntimeConfigOptions): RuntimeConfig {
  return new RuntimeConfig(options);
}

/**
 * Create a feature flag with defaults
 */
export function createFeatureFlag(
  partial: Partial<FeatureFlag> & Pick<FeatureFlag, 'id' | 'name'>
): FeatureFlag {
  const now = new Date().toISOString();
  return {
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/**
 * Create an A/B test with defaults
 */
export function createABTest(
  partial: Partial<ABTest> & Pick<ABTest, 'id' | 'name' | 'variants' | 'controlVariantId'>
): ABTest {
  const now = new Date().toISOString();
  return {
    active: false,
    trafficPercentage: 100,
    assignmentStrategy: 'entity-hash',
    sampleCounts: new Map(),
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/**
 * Create an A/B test variant
 */
export function createABTestVariant(
  partial: Partial<ABTestVariant> & Pick<ABTestVariant, 'id' | 'name' | 'allocation'>
): ABTestVariant {
  return {
    config: {},
    ...partial,
  };
}
