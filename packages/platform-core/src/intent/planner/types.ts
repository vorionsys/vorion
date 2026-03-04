/**
 * EXECUTION PLANNER TYPES
 *
 * Shared type definitions for the execution planner module.
 * Extracted to avoid circular dependencies between index.ts, rollback.ts, and templates.ts
 *
 * @packageDocumentation
 */

/**
 * Failure handling strategy for a step
 */
export type OnFailureStrategy =
  | 'abort'           // Stop execution and mark plan as failed
  | 'rollback'        // Trigger rollback of completed steps
  | 'continue'        // Continue with next step (for non-critical steps)
  | 'retry'           // Retry the step (up to retries count)
  | 'skip';           // Skip this step and continue

/**
 * Execution step definition
 */
export interface ExecutionStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Action type to execute */
  action: string;
  /** Action parameters */
  params: Record<string, unknown>;
  /** Timeout in milliseconds */
  timeout: number;
  /** Number of retries on failure */
  retries: number;
  /** Strategy on failure */
  onFailure: OnFailureStrategy;
  /** Optional description */
  description?: string;
  /** Estimated duration in milliseconds */
  estimatedDuration?: number;
  /** Whether this step is critical (affects rollback behavior) */
  critical?: boolean;
}
