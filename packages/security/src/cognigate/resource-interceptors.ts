/**
 * Cognigate Resource Interceptors
 *
 * Interceptors for network and file system operations that enforce
 * resource limits and track usage.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/resource-interceptors
 */

import * as fs from 'node:fs/promises';
import { createLogger } from '../common/logger.js';
import type { ID } from '../common/types.js';
import type { ResourceLimits, ResourceStateProvider } from './types.js';

const logger = createLogger({ component: 'cognigate-interceptors' });

/**
 * Error thrown when a resource limit is exceeded
 */
export class ResourceLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly limitType: 'network' | 'filesystem',
    public readonly current: number,
    public readonly limit: number
  ) {
    super(message);
    this.name = 'ResourceLimitExceededError';
  }
}

/**
 * Wrapped fetch function type
 */
export type WrappedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Create a network interceptor that wraps fetch to track and limit requests.
 *
 * @param executionId - Unique execution identifier
 * @param limits - Resource limits to enforce
 * @param stateProvider - State provider for distributed tracking
 * @param signal - Abort signal for termination
 * @returns Wrapped fetch function
 */
export function createNetworkInterceptor(
  executionId: ID,
  limits: ResourceLimits,
  stateProvider: ResourceStateProvider,
  signal: AbortSignal
): WrappedFetch {
  const maxRequests = limits.maxNetworkRequests ?? Infinity;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Check if already aborted
    if (signal.aborted) {
      throw new ResourceLimitExceededError(
        'Execution terminated',
        'network',
        0,
        maxRequests
      );
    }

    // Check and increment request count
    if (maxRequests !== Infinity) {
      const result = await stateProvider.incrementNetworkRequests(executionId, maxRequests);

      if (!result.allowed) {
        logger.warn(
          { executionId, current: result.current, limit: maxRequests },
          'Network request limit exceeded'
        );
        throw new ResourceLimitExceededError(
          `Network request limit exceeded: ${result.current} >= ${maxRequests}`,
          'network',
          result.current,
          maxRequests
        );
      }

      logger.debug(
        { executionId, requestCount: result.current, limit: maxRequests },
        'Network request allowed'
      );
    }

    // Merge abort signal with any existing signal
    const combinedInit: RequestInit = {
      ...init,
      signal: combineAbortSignals(signal, init?.signal),
    };

    // Make the actual fetch request
    return fetch(input, combinedInit);
  };
}

/**
 * Wrapped file system functions type
 */
export interface WrappedFileSystemFunctions {
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  appendFile: typeof fs.appendFile;
  unlink: typeof fs.unlink;
  mkdir: typeof fs.mkdir;
  rmdir: typeof fs.rmdir;
  readdir: typeof fs.readdir;
  stat: typeof fs.stat;
  access: typeof fs.access;
  rename: typeof fs.rename;
  copyFile: typeof fs.copyFile;
}

/**
 * Create file system interceptors that wrap fs functions to track and limit operations.
 *
 * @param executionId - Unique execution identifier
 * @param limits - Resource limits to enforce
 * @param stateProvider - State provider for distributed tracking
 * @param signal - Abort signal for termination
 * @returns Object with wrapped file system functions
 */
export function createFileSystemInterceptors(
  executionId: ID,
  limits: ResourceLimits,
  stateProvider: ResourceStateProvider,
  signal: AbortSignal
): WrappedFileSystemFunctions {
  const maxOps = limits.maxFileSystemOps ?? Infinity;

  /**
   * Check limit and track operation before execution
   */
  async function checkAndTrack(): Promise<void> {
    // Check if already aborted
    if (signal.aborted) {
      throw new ResourceLimitExceededError(
        'Execution terminated',
        'filesystem',
        0,
        maxOps
      );
    }

    // Check and increment operation count
    if (maxOps !== Infinity) {
      const result = await stateProvider.incrementFileSystemOps(executionId, maxOps);

      if (!result.allowed) {
        logger.warn(
          { executionId, current: result.current, limit: maxOps },
          'File system operation limit exceeded'
        );
        throw new ResourceLimitExceededError(
          `File system operation limit exceeded: ${result.current} >= ${maxOps}`,
          'filesystem',
          result.current,
          maxOps
        );
      }

      logger.debug(
        { executionId, opCount: result.current, limit: maxOps },
        'File system operation allowed'
      );
    }
  }

  /**
   * Create a wrapped version of an fs function
   */
  function wrapFsFunction<T extends (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>>(
    fn: T,
    operationName: string
  ): T {
    return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      await checkAndTrack();
      logger.debug({ executionId, operation: operationName }, 'File system operation');
      return fn(...args);
    }) as T;
  }

  return {
    readFile: wrapFsFunction(fs.readFile, 'readFile') as typeof fs.readFile,
    writeFile: wrapFsFunction(fs.writeFile, 'writeFile') as typeof fs.writeFile,
    appendFile: wrapFsFunction(fs.appendFile, 'appendFile') as typeof fs.appendFile,
    unlink: wrapFsFunction(fs.unlink, 'unlink') as typeof fs.unlink,
    mkdir: wrapFsFunction(fs.mkdir, 'mkdir') as typeof fs.mkdir,
    rmdir: wrapFsFunction(fs.rmdir, 'rmdir') as typeof fs.rmdir,
    readdir: wrapFsFunction(fs.readdir, 'readdir') as typeof fs.readdir,
    stat: wrapFsFunction(fs.stat, 'stat') as typeof fs.stat,
    access: wrapFsFunction(fs.access, 'access') as typeof fs.access,
    rename: wrapFsFunction(fs.rename, 'rename') as typeof fs.rename,
    copyFile: wrapFsFunction(fs.copyFile, 'copyFile') as typeof fs.copyFile,
  };
}

/**
 * Combine multiple abort signals into one.
 * The combined signal will abort when any of the input signals abort.
 */
function combineAbortSignals(
  ...signals: (AbortSignal | null | undefined)[]
): AbortSignal {
  const controller = new AbortController();
  const validSignals = signals.filter((s): s is AbortSignal => s != null);

  for (const signal of validSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }

    signal.addEventListener('abort', () => {
      controller.abort(signal.reason);
    }, { once: true });
  }

  return controller.signal;
}

/**
 * Execution context with interceptors for sandboxed execution
 */
export interface ExecutionInterceptors {
  /** Wrapped fetch function */
  fetch: WrappedFetch;
  /** Wrapped file system functions */
  fs: WrappedFileSystemFunctions;
  /** Abort signal for termination */
  signal: AbortSignal;
}

/**
 * Create all interceptors for an execution
 */
export function createExecutionInterceptors(
  executionId: ID,
  limits: ResourceLimits,
  stateProvider: ResourceStateProvider,
  signal: AbortSignal
): ExecutionInterceptors {
  return {
    fetch: createNetworkInterceptor(executionId, limits, stateProvider, signal),
    fs: createFileSystemInterceptors(executionId, limits, stateProvider, signal),
    signal,
  };
}
