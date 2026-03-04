/**
 * OpenTelemetry Tracer Configuration
 *
 * Core tracer setup with SDK initialization, exporter configuration,
 * and sampling strategies for the Vorion security platform.
 *
 * Features:
 * - OTLP exporter for Jaeger, Tempo, and other backends
 * - Configurable sampling strategies (always, probability, rate-limiting)
 * - Resource attributes for service identification
 * - Environment-aware configuration
 *
 * @packageDocumentation
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  type SpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
  type Sampler,
  SamplingDecision,
  type SamplingResult,
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
  trace,
  SpanKind,
  type Tracer,
  type TracerProvider,
  type Context,
  type Link,
  type Attributes,
} from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';

const logger = createLogger({ component: 'telemetry-tracer' });

/**
 * Sampling strategy types
 */
export type SamplingStrategy =
  | 'always'
  | 'never'
  | 'probability'
  | 'rate-limiting'
  | 'parent-based';

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  /** Service name for trace identification */
  serviceName: string;
  /** Service version */
  serviceVersion: string;
  /** Deployment environment (development, staging, production) */
  environment: string;
  /** OTLP endpoint URL */
  otlpEndpoint: string;
  /** OTLP headers for authentication */
  otlpHeaders?: Record<string, string>;
  /** Sampling strategy */
  samplingStrategy: SamplingStrategy;
  /** Sampling rate (0.0 - 1.0) for probability sampling */
  samplingRate: number;
  /** Rate limit (requests per second) for rate-limiting sampling */
  rateLimitPerSecond?: number;
  /** Enable console exporter for debugging */
  enableConsoleExporter?: boolean;
  /** Use batch processor (recommended for production) */
  useBatchProcessor?: boolean;
  /** Batch processor configuration */
  batchConfig?: {
    /** Maximum batch size */
    maxExportBatchSize?: number;
    /** Maximum queue size */
    maxQueueSize?: number;
    /** Scheduled delay in milliseconds */
    scheduledDelayMillis?: number;
    /** Export timeout in milliseconds */
    exportTimeoutMillis?: number;
  };
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string | number | boolean>;
  /** Enable telemetry */
  enabled?: boolean;
}

/**
 * Rate-limiting sampler implementation
 *
 * Limits the number of sampled traces per second to prevent
 * overwhelming the trace backend during high-traffic periods.
 */
export class RateLimitingSampler implements Sampler {
  private readonly maxTracesPerSecond: number;
  private tracesThisSecond = 0;
  private currentSecond = 0;

  constructor(maxTracesPerSecond: number) {
    this.maxTracesPerSecond = maxTracesPerSecond;
  }

  shouldSample(
    _context: Context,
    _traceId: string,
    _spanName: string,
    _spanKind: SpanKind,
    _attributes: Attributes,
    _links: Link[]
  ): SamplingResult {
    const now = Math.floor(Date.now() / 1000);

    // Reset counter for new second
    if (now !== this.currentSecond) {
      this.currentSecond = now;
      this.tracesThisSecond = 0;
    }

    // Check if we've exceeded rate limit
    if (this.tracesThisSecond >= this.maxTracesPerSecond) {
      return {
        decision: SamplingDecision.NOT_RECORD,
        attributes: {},
      };
    }

    this.tracesThisSecond++;
    return {
      decision: SamplingDecision.RECORD_AND_SAMPLED,
      attributes: {},
    };
  }

  toString(): string {
    return `RateLimitingSampler{maxTracesPerSecond=${this.maxTracesPerSecond}}`;
  }
}

/**
 * Security-aware sampler that always samples high-risk operations
 *
 * Ensures security-critical operations are always traced regardless
 * of the base sampling strategy.
 */
export class SecurityAwareSampler implements Sampler {
  private readonly baseSampler: Sampler;
  private readonly alwaysSampleOperations: Set<string>;

  constructor(
    baseSampler: Sampler,
    alwaysSampleOperations: string[] = [
      'auth.login',
      'auth.logout',
      'auth.token.refresh',
      'auth.mfa.verify',
      'security.violation',
      'policy.deny',
      'escalation.create',
      'escalation.resolve',
      'admin.action',
      'data.export',
      'webhook.security',
    ]
  ) {
    this.baseSampler = baseSampler;
    this.alwaysSampleOperations = new Set(alwaysSampleOperations);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[]
  ): SamplingResult {
    // Always sample security-critical operations
    if (this.alwaysSampleOperations.has(spanName)) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: {
          'sampling.reason': 'security-critical-operation',
        },
      };
    }

    // Check for security-related attributes
    const isSecurityRelated =
      attributes['security.event'] === true ||
      attributes['security.risk'] === 'high' ||
      attributes['auth.failure'] === true;

    if (isSecurityRelated) {
      return {
        decision: SamplingDecision.RECORD_AND_SAMPLED,
        attributes: {
          'sampling.reason': 'security-related-attributes',
        },
      };
    }

    // Delegate to base sampler for other operations
    return this.baseSampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links
    );
  }

  toString(): string {
    return `SecurityAwareSampler{base=${this.baseSampler.toString()}}`;
  }
}

/**
 * Create a sampler based on the configured strategy
 */
function createSampler(config: TelemetryConfig): Sampler {
  let baseSampler: Sampler;

  switch (config.samplingStrategy) {
    case 'always':
      baseSampler = new AlwaysOnSampler();
      break;

    case 'never':
      baseSampler = new AlwaysOffSampler();
      break;

    case 'probability':
      baseSampler = new TraceIdRatioBasedSampler(config.samplingRate);
      break;

    case 'rate-limiting':
      baseSampler = new RateLimitingSampler(config.rateLimitPerSecond ?? 100);
      break;

    case 'parent-based':
      baseSampler = new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(config.samplingRate),
      });
      break;

    default:
      logger.warn(
        { strategy: config.samplingStrategy },
        'Unknown sampling strategy, using probability'
      );
      baseSampler = new TraceIdRatioBasedSampler(config.samplingRate);
  }

  // Wrap with security-aware sampler
  return new SecurityAwareSampler(baseSampler);
}

/**
 * Create resource attributes for service identification
 */
function createResourceAttributes(config: TelemetryConfig): Record<string, string | number | boolean> {
  const instanceId = randomUUID();

  return {
    [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment,
    [SEMRESATTRS_SERVICE_INSTANCE_ID]: instanceId,
    // Vorion-specific attributes
    'vorion.platform': 'security',
    'vorion.component': 'intent-engine',
    ...config.resourceAttributes,
  };
}

/**
 * Create OTLP exporter with configuration
 */
function createOtlpExporter(config: TelemetryConfig): SpanExporter {
  return new OTLPTraceExporter({
    url: config.otlpEndpoint,
    headers: config.otlpHeaders,
    timeoutMillis: 30000,
  });
}

/**
 * Create span processor based on configuration
 */
function createSpanProcessor(
  exporter: SpanExporter,
  config: TelemetryConfig
): SpanProcessor {
  if (config.useBatchProcessor !== false) {
    // Use batch processor for production (default)
    return new BatchSpanProcessor(exporter, {
      maxExportBatchSize: config.batchConfig?.maxExportBatchSize ?? 512,
      maxQueueSize: config.batchConfig?.maxQueueSize ?? 2048,
      scheduledDelayMillis: config.batchConfig?.scheduledDelayMillis ?? 5000,
      exportTimeoutMillis: config.batchConfig?.exportTimeoutMillis ?? 30000,
    });
  }

  // Use simple processor for debugging
  return new SimpleSpanProcessor(exporter);
}

// Global SDK instance
let sdk: NodeSDK | null = null;
let isInitialized = false;

/**
 * Get default telemetry configuration from environment
 */
export function getDefaultTelemetryConfig(): TelemetryConfig {
  const config = getConfig();

  return {
    serviceName: config.telemetry.serviceName,
    serviceVersion: config.app.version,
    environment: config.env,
    otlpEndpoint: config.telemetry.otlpEndpoint,
    otlpHeaders: config.telemetry.otlpHeaders,
    samplingStrategy: 'probability',
    samplingRate: config.telemetry.sampleRate,
    enabled: config.telemetry.enabled,
    useBatchProcessor: config.env === 'production',
    enableConsoleExporter: config.env === 'development',
  };
}

/**
 * Initialize the OpenTelemetry SDK
 *
 * @param config - Telemetry configuration (optional, uses defaults)
 * @returns void
 * @throws Error if already initialized
 */
export function initializeTracer(config?: Partial<TelemetryConfig>): void {
  if (isInitialized) {
    logger.warn('Tracer already initialized, skipping');
    return;
  }

  const fullConfig: TelemetryConfig = {
    ...getDefaultTelemetryConfig(),
    ...config,
  };

  if (fullConfig.enabled === false) {
    logger.info('Telemetry disabled by configuration');
    isInitialized = true;
    return;
  }

  const resourceAttributes = createResourceAttributes(fullConfig);
  const sampler = createSampler(fullConfig);

  // Create exporters
  const spanProcessors: SpanProcessor[] = [];

  // OTLP exporter (primary)
  const otlpExporter = createOtlpExporter(fullConfig);
  spanProcessors.push(createSpanProcessor(otlpExporter, fullConfig));

  // Console exporter (debugging)
  if (fullConfig.enableConsoleExporter) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Initialize SDK with resource attributes
  sdk = new NodeSDK({
    serviceName: fullConfig.serviceName,
    resource: resourceFromAttributes(resourceAttributes),
    sampler,
    spanProcessors,
  });

  sdk.start();
  isInitialized = true;

  logger.info(
    {
      serviceName: fullConfig.serviceName,
      environment: fullConfig.environment,
      samplingStrategy: fullConfig.samplingStrategy,
      samplingRate: fullConfig.samplingRate,
      endpoint: fullConfig.otlpEndpoint,
    },
    'OpenTelemetry tracer initialized'
  );
}

/**
 * Shutdown the OpenTelemetry SDK gracefully
 *
 * Should be called during application shutdown to ensure
 * all pending spans are exported.
 */
export async function shutdownTracer(): Promise<void> {
  if (!sdk) {
    logger.debug('Tracer not initialized, nothing to shutdown');
    return;
  }

  try {
    await sdk.shutdown();
    sdk = null;
    isInitialized = false;
    logger.info('OpenTelemetry tracer shutdown complete');
  } catch (error) {
    logger.error({ error }, 'Error shutting down tracer');
    throw error;
  }
}

/**
 * Get a tracer instance for a specific component
 *
 * @param name - Component name (e.g., 'vorion.intent', 'vorion.policy')
 * @param version - Component version (optional)
 * @returns Tracer instance
 */
export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Get the global tracer provider
 */
export function getTracerProvider(): TracerProvider {
  return trace.getTracerProvider();
}

/**
 * Check if the tracer is initialized
 */
export function isTracerInitialized(): boolean {
  return isInitialized;
}

/**
 * Vorion-specific tracer names
 */
export const VorionTracers = {
  INTENT: 'vorion.intent',
  POLICY: 'vorion.policy',
  TRUST: 'vorion.trust',
  SECURITY: 'vorion.security',
  API: 'vorion.api',
  QUEUE: 'vorion.queue',
  DATABASE: 'vorion.database',
  CACHE: 'vorion.cache',
  WEBHOOK: 'vorion.webhook',
  AUDIT: 'vorion.audit',
  GOVERNANCE: 'vorion.governance',
} as const;

/**
 * Get the intent tracer
 */
export function getIntentTracer(): Tracer {
  return getTracer(VorionTracers.INTENT, '1.0.0');
}

/**
 * Get the policy tracer
 */
export function getPolicyTracer(): Tracer {
  return getTracer(VorionTracers.POLICY, '1.0.0');
}

/**
 * Get the security tracer
 */
export function getSecurityTracer(): Tracer {
  return getTracer(VorionTracers.SECURITY, '1.0.0');
}

/**
 * Get the API tracer
 */
export function getApiTracer(): Tracer {
  return getTracer(VorionTracers.API, '1.0.0');
}
