/**
 * Vorion Security Platform - Canary Deployment Types
 * Type definitions for canary deployment system
 */

// ============================================================================
// Core Canary Configuration Types
// ============================================================================

export interface CanaryConfig {
  /** Unique identifier for the canary deployment */
  name: string;
  /** Target service/application to deploy */
  targetService: string;
  /** Namespace or environment */
  namespace: string;
  /** Stages for gradual rollout */
  stages: CanaryStage[];
  /** Metric thresholds for health checks */
  metrics: MetricThreshold[];
  /** Policy for automatic rollback */
  rollbackPolicy: RollbackPolicy;
  /** Seconds to wait between stages */
  promotionDelay: number;
  /** Optional: baseline version for comparison */
  baselineVersion?: string;
  /** Optional: canary version being deployed */
  canaryVersion?: string;
  /** Optional: labels for filtering/identification */
  labels?: Record<string, string>;
  /** Optional: annotations for metadata */
  annotations?: Record<string, string>;
}

export interface CanaryStage {
  /** Percentage of traffic to route to canary (0-100) */
  percentage: number;
  /** Seconds to observe at this stage before promotion */
  duration: number;
  /** Required success rate to pass this stage (0-1) */
  requiredSuccessRate: number;
  /** Optional: stage name for identification */
  name?: string;
  /** Optional: additional validation checks */
  validations?: StageValidation[];
}

export interface StageValidation {
  /** Type of validation */
  type: 'http' | 'grpc' | 'tcp' | 'custom';
  /** Endpoint to validate */
  endpoint?: string;
  /** Expected response code or pattern */
  expectedResponse?: string | number;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface MetricThreshold {
  /** Metric name (e.g., 'error_rate', 'latency_p99') */
  metric: string;
  /** Comparison operator */
  operator: 'lt' | 'gt' | 'eq' | 'lte' | 'gte' | 'ne';
  /** Threshold value */
  threshold: number;
  /** Time window in seconds for metric collection */
  window: number;
  /** Optional: metric source (prometheus, datadog, etc.) */
  source?: MetricSource;
  /** Optional: query template for custom metrics */
  query?: string;
  /** Whether this threshold is critical (triggers immediate rollback) */
  critical?: boolean;
}

export type MetricSource = 'prometheus' | 'datadog' | 'cloudwatch' | 'custom';

export interface RollbackPolicy {
  /** Enable automatic rollback on failure */
  automatic: boolean;
  /** Number of consecutive failures before rollback */
  failureThreshold: number;
  /** Time window in seconds to count failures */
  failureWindow: number;
  /** Enable graceful connection draining */
  gracefulDrain: boolean;
  /** Drain timeout in seconds */
  drainTimeout: number;
  /** Preserve state on rollback */
  preserveState: boolean;
  /** Actions to take on rollback */
  onRollback?: RollbackAction[];
}

export interface RollbackAction {
  /** Type of action */
  type: 'webhook' | 'script' | 'notification';
  /** Action configuration */
  config: Record<string, unknown>;
}

// ============================================================================
// Deployment State Types
// ============================================================================

export type CanaryStatus =
  | 'pending'
  | 'initializing'
  | 'progressing'
  | 'paused'
  | 'promoting'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'aborted';

export interface CanaryDeployment {
  /** Unique deployment ID */
  id: string;
  /** Configuration for this deployment */
  config: CanaryConfig;
  /** Current status */
  status: CanaryStatus;
  /** Current stage index (0-based) */
  currentStage: number;
  /** Current traffic percentage */
  currentPercentage: number;
  /** Deployment start time */
  startTime: Date;
  /** Last update time */
  lastUpdated: Date;
  /** Stage transition history */
  stageHistory: StageTransition[];
  /** Collected metrics */
  metrics: CollectedMetrics;
  /** Error information if failed */
  error?: DeploymentError;
  /** Rollback information if rolled back */
  rollbackInfo?: RollbackInfo;
}

export interface StageTransition {
  /** Stage index */
  stage: number;
  /** Traffic percentage at this stage */
  percentage: number;
  /** Transition time */
  timestamp: Date;
  /** Status of the transition */
  status: 'success' | 'failed' | 'skipped';
  /** Metrics snapshot at transition */
  metricsSnapshot?: MetricsSnapshot;
  /** Reason for transition */
  reason?: string;
}

export interface CollectedMetrics {
  /** Error rate over time */
  errorRate: TimeSeriesData[];
  /** Latency percentiles */
  latency: LatencyMetrics;
  /** Request count */
  requestCount: TimeSeriesData[];
  /** Custom metrics */
  custom: Record<string, TimeSeriesData[]>;
}

export interface LatencyMetrics {
  p50: TimeSeriesData[];
  p75: TimeSeriesData[];
  p90: TimeSeriesData[];
  p95: TimeSeriesData[];
  p99: TimeSeriesData[];
}

export interface TimeSeriesData {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}

export interface MetricsSnapshot {
  timestamp: Date;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  requestCount: number;
  customMetrics: Record<string, number>;
}

export interface DeploymentError {
  code: string;
  message: string;
  timestamp: Date;
  stage?: number;
  details?: Record<string, unknown>;
}

export interface RollbackInfo {
  timestamp: Date;
  reason: string;
  fromStage: number;
  fromPercentage: number;
  automatic: boolean;
  drainDuration?: number;
}

// ============================================================================
// Traffic Routing Types
// ============================================================================

export interface TrafficRoute {
  /** Route identifier */
  id: string;
  /** Target version/deployment */
  target: 'baseline' | 'canary';
  /** Weight for weighted routing (0-100) */
  weight: number;
  /** Header match rules */
  headerMatches?: HeaderMatch[];
  /** Cookie match rules */
  cookieMatches?: CookieMatch[];
}

export interface HeaderMatch {
  /** Header name */
  name: string;
  /** Match type */
  matchType: 'exact' | 'prefix' | 'regex';
  /** Value to match */
  value: string;
}

export interface CookieMatch {
  /** Cookie name */
  name: string;
  /** Expected value (if exact match) */
  value?: string;
  /** Whether cookie must exist */
  required: boolean;
}

export interface RoutingDecision {
  /** Selected target */
  target: 'baseline' | 'canary';
  /** Reason for selection */
  reason: 'weight' | 'header' | 'cookie' | 'sticky' | 'forced';
  /** Session ID if sticky session */
  sessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

export interface LoadBalancerConfig {
  /** Load balancer type */
  type: 'nginx' | 'envoy' | 'haproxy' | 'aws_alb' | 'gcp_lb' | 'custom';
  /** API endpoint for configuration */
  endpoint: string;
  /** Authentication credentials */
  credentials?: LoadBalancerCredentials;
  /** Custom configuration options */
  options?: Record<string, unknown>;
}

export interface LoadBalancerCredentials {
  type: 'token' | 'basic' | 'oauth' | 'aws_iam';
  token?: string;
  username?: string;
  password?: string;
  region?: string;
}

// ============================================================================
// Metrics Analysis Types
// ============================================================================

export interface MetricsComparison {
  /** Baseline metrics summary */
  baseline: MetricsSummary;
  /** Canary metrics summary */
  canary: MetricsSummary;
  /** Statistical comparison results */
  comparison: StatisticalComparison;
  /** Overall health assessment */
  health: HealthAssessment;
  /** Detected anomalies */
  anomalies: Anomaly[];
}

export interface MetricsSummary {
  /** Sample count */
  sampleCount: number;
  /** Time range */
  timeRange: { start: Date; end: Date };
  /** Error rate statistics */
  errorRate: StatisticalSummary;
  /** Latency statistics by percentile */
  latency: {
    p50: StatisticalSummary;
    p95: StatisticalSummary;
    p99: StatisticalSummary;
  };
  /** Request rate */
  requestRate: StatisticalSummary;
}

export interface StatisticalSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  variance: number;
}

export interface StatisticalComparison {
  /** Error rate comparison */
  errorRateDiff: ComparisonResult;
  /** Latency comparison */
  latencyDiff: {
    p50: ComparisonResult;
    p95: ComparisonResult;
    p99: ComparisonResult;
  };
  /** Request rate comparison */
  requestRateDiff: ComparisonResult;
}

export interface ComparisonResult {
  /** Absolute difference */
  absoluteDiff: number;
  /** Relative difference (percentage) */
  relativeDiff: number;
  /** P-value from statistical test */
  pValue: number;
  /** Whether the difference is statistically significant */
  significant: boolean;
  /** Confidence interval */
  confidenceInterval: { lower: number; upper: number };
}

export interface HealthAssessment {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Health score (0-100) */
  score: number;
  /** Individual metric assessments */
  metrics: MetricHealthAssessment[];
  /** Recommendations */
  recommendations: string[];
}

export interface MetricHealthAssessment {
  metric: string;
  status: 'pass' | 'warn' | 'fail';
  value: number;
  threshold: number;
  message: string;
}

export interface Anomaly {
  /** Anomaly type */
  type: 'spike' | 'drop' | 'trend' | 'outlier';
  /** Affected metric */
  metric: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Detection timestamp */
  timestamp: Date;
  /** Anomaly description */
  description: string;
  /** Expected vs actual value */
  expected?: number;
  actual?: number;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationConfig {
  /** Notification channels */
  channels: NotificationChannel[];
  /** Events to notify on */
  events: NotificationEvent[];
  /** Throttling configuration */
  throttle?: ThrottleConfig;
}

export interface NotificationChannel {
  /** Channel type */
  type: 'slack' | 'teams' | 'email' | 'pagerduty' | 'webhook';
  /** Channel configuration */
  config: SlackConfig | TeamsConfig | EmailConfig | PagerDutyConfig | WebhookConfig;
  /** Events this channel subscribes to */
  events?: NotificationEvent[];
}

export interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export interface TeamsConfig {
  webhookUrl: string;
  title?: string;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  from: string;
  to: string[];
  cc?: string[];
  useTls?: boolean;
}

export interface PagerDutyConfig {
  routingKey: string;
  serviceKey?: string;
  severity?: 'critical' | 'error' | 'warning' | 'info';
}

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeout?: number;
}

export type NotificationEvent =
  | 'deployment_started'
  | 'stage_promoted'
  | 'stage_failed'
  | 'deployment_succeeded'
  | 'deployment_failed'
  | 'rollback_initiated'
  | 'rollback_completed'
  | 'paused'
  | 'resumed'
  | 'anomaly_detected'
  | 'threshold_exceeded';

export interface ThrottleConfig {
  /** Minimum interval between notifications (seconds) */
  interval: number;
  /** Maximum notifications per interval */
  maxPerInterval: number;
  /** Group similar notifications */
  groupSimilar: boolean;
}

export interface Notification {
  /** Notification ID */
  id: string;
  /** Event type */
  event: NotificationEvent;
  /** Deployment ID */
  deploymentId: string;
  /** Timestamp */
  timestamp: Date;
  /** Notification title */
  title: string;
  /** Notification message */
  message: string;
  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Additional data */
  data?: Record<string, unknown>;
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIContext {
  /** Current working directory */
  cwd: string;
  /** Configuration file path */
  configPath?: string;
  /** Loaded configuration */
  config?: CanaryConfig;
  /** API endpoint */
  apiEndpoint?: string;
  /** Authentication token */
  authToken?: string;
  /** Verbose output */
  verbose: boolean;
  /** Output format */
  outputFormat: 'text' | 'json' | 'yaml';
}

export interface CLICommand {
  /** Command name */
  name: string;
  /** Command description */
  description: string;
  /** Command aliases */
  aliases?: string[];
  /** Command options */
  options: CLIOption[];
  /** Command arguments */
  arguments?: CLIArgument[];
  /** Command handler */
  handler: (args: Record<string, unknown>, context: CLIContext) => Promise<CLIResult>;
}

export interface CLIOption {
  name: string;
  short?: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
}

export interface CLIArgument {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface CLIResult {
  success: boolean;
  message?: string;
  data?: unknown;
  exitCode: number;
}

// ============================================================================
// Event Types
// ============================================================================

export interface CanaryEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: CanaryEventType;
  /** Deployment ID */
  deploymentId: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event data */
  data: Record<string, unknown>;
  /** Actor who triggered the event (if manual) */
  actor?: string;
}

export type CanaryEventType =
  | 'deployment_created'
  | 'deployment_started'
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'promotion_started'
  | 'promotion_completed'
  | 'rollback_started'
  | 'rollback_completed'
  | 'deployment_paused'
  | 'deployment_resumed'
  | 'deployment_aborted'
  | 'deployment_succeeded'
  | 'deployment_failed'
  | 'metrics_collected'
  | 'anomaly_detected'
  | 'threshold_breached';

// ============================================================================
// Storage Types
// ============================================================================

export interface DeploymentStore {
  /** Get deployment by ID */
  get(id: string): Promise<CanaryDeployment | null>;
  /** List all deployments */
  list(filter?: DeploymentFilter): Promise<CanaryDeployment[]>;
  /** Save deployment */
  save(deployment: CanaryDeployment): Promise<void>;
  /** Delete deployment */
  delete(id: string): Promise<void>;
  /** Update deployment status */
  updateStatus(id: string, status: CanaryStatus, error?: DeploymentError): Promise<void>;
}

export interface DeploymentFilter {
  status?: CanaryStatus[];
  namespace?: string;
  service?: string;
  startTimeAfter?: Date;
  startTimeBefore?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type AsyncResult<T> = Promise<{ success: true; data: T } | { success: false; error: Error }>;

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
