/**
 * Vorion Security SDK - Type Definitions
 * Core types for Security-as-Code platform
 */

// ============================================================================
// Policy Types
// ============================================================================

export type PolicyOutcome = 'allow' | 'deny' | 'challenge' | 'audit';

export interface PolicyResult {
  outcome: PolicyOutcome;
  reason?: string;
  metadata?: Record<string, unknown>;
  auditId?: string;
  timestamp: Date;
  policyId: string;
  policyVersion: string;
}

export interface PolicyCondition {
  type: 'equals' | 'notEquals' | 'contains' | 'inRange' | 'between' | 'matches' | 'custom';
  field: string;
  value: unknown;
  operator?: 'and' | 'or';
}

export interface PolicyRequirement {
  type: 'mfa' | 'approval' | 'permission' | 'custom';
  config: Record<string, unknown>;
}

export interface PolicyAction {
  type: PolicyOutcome;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  conditions: PolicyCondition[];
  requirements: PolicyRequirement[];
  action: PolicyAction;
  fallbackAction: PolicyAction;
  priority: number;
  enabled: boolean;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Context Types
// ============================================================================

export interface UserContext {
  id: string;
  email?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  groups?: string[];
  attributes?: Record<string, unknown>;
  mfaVerified?: boolean;
  sessionId?: string;
  authMethod?: 'password' | 'sso' | 'api_key' | 'oauth';
}

export interface RequestContext {
  ip: string;
  userAgent?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  geo?: {
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
}

export interface TimeContext {
  timestamp?: Date;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  timezone?: string;
}

export interface ResourceContext {
  type: string;
  id: string;
  owner?: string;
  attributes?: Record<string, unknown>;
}

export interface EvaluationContext {
  user: UserContext;
  request: RequestContext;
  time?: TimeContext;
  resource?: ResourceContext;
  environment?: Record<string, unknown>;
  custom?: Record<string, unknown>;
}

// ============================================================================
// Decorator Types
// ============================================================================

export interface SecuredOptions {
  roles?: string[];
  permissions?: string[];
  mfa?: boolean;
  ipWhitelist?: string[];
  timeRestriction?: {
    start: string;
    end: string;
    timezone?: string;
  };
  customPolicy?: string;
}

export interface RateLimitOptions {
  requests: number;
  window: string;
  keyBy?: 'ip' | 'user' | 'session' | 'custom';
  customKey?: (context: EvaluationContext) => string;
  onExceeded?: 'deny' | 'queue' | 'degrade';
  skipIf?: (context: EvaluationContext) => boolean;
}

export interface AuditLogOptions {
  level: 'minimal' | 'standard' | 'detailed' | 'full';
  includeRequest?: boolean;
  includeResponse?: boolean;
  redactFields?: string[];
  customFields?: Record<string, unknown>;
  destination?: 'default' | 'siem' | 'custom';
}

export interface RequirePermissionOptions {
  permission: string;
  resource?: string;
  action?: string;
  conditions?: Record<string, unknown>;
}

export interface BreakGlassOptions {
  approvers: string[];
  minApprovals?: number;
  expiresIn?: string;
  notifyChannels?: string[];
  requireReason?: boolean;
  auditLevel?: 'high' | 'critical';
}

// ============================================================================
// AST Types
// ============================================================================

export type ASTNodeType =
  | 'Policy'
  | 'Condition'
  | 'Requirement'
  | 'Action'
  | 'Identifier'
  | 'Literal'
  | 'BinaryExpression'
  | 'CallExpression'
  | 'MemberExpression';

export interface ASTNode {
  type: ASTNodeType;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface PolicyAST extends ASTNode {
  type: 'Policy';
  id: string;
  description?: string;
  conditions: ConditionAST[];
  requirements: RequirementAST[];
  thenAction: ActionAST;
  otherwiseAction?: ActionAST;
}

export interface ConditionAST extends ASTNode {
  type: 'Condition';
  operator: 'and' | 'or';
  left: ExpressionAST;
  right?: ConditionAST;
}

export interface RequirementAST extends ASTNode {
  type: 'Requirement';
  name: string;
  args: unknown[];
}

export interface ActionAST extends ASTNode {
  type: 'Action';
  outcome: PolicyOutcome;
  message?: string;
}

export type ExpressionAST =
  | IdentifierAST
  | LiteralAST
  | BinaryExpressionAST
  | CallExpressionAST
  | MemberExpressionAST;

export interface IdentifierAST extends ASTNode {
  type: 'Identifier';
  name: string;
}

export interface LiteralAST extends ASTNode {
  type: 'Literal';
  value: unknown;
}

export interface BinaryExpressionAST extends ASTNode {
  type: 'BinaryExpression';
  operator: string;
  left: ExpressionAST;
  right: ExpressionAST;
}

export interface CallExpressionAST extends ASTNode {
  type: 'CallExpression';
  callee: ExpressionAST;
  arguments: ExpressionAST[];
}

export interface MemberExpressionAST extends ASTNode {
  type: 'MemberExpression';
  object: ExpressionAST;
  property: IdentifierAST;
}

// ============================================================================
// API Client Types
// ============================================================================

export interface VorionClientConfig {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  timeout?: number;
  retries?: number;
  websocket?: {
    enabled: boolean;
    reconnect?: boolean;
    reconnectInterval?: number;
  };
}

export interface PolicyListOptions {
  page?: number;
  limit?: number;
  filter?: {
    enabled?: boolean;
    tags?: string[];
    search?: string;
  };
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

export interface PolicyListResponse {
  policies: PolicyDefinition[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SimulationRequest {
  policyId?: string;
  policyDefinition?: PolicyDefinition;
  context: EvaluationContext;
  options?: {
    trace?: boolean;
    explain?: boolean;
  };
}

export interface SimulationTrace {
  step: number;
  type: 'condition' | 'requirement' | 'action';
  description: string;
  result: boolean;
  duration: number;
}

export interface SimulationResponse {
  result: PolicyResult;
  trace?: SimulationTrace[];
  explanation?: string;
  matchedPolicies?: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  policyId: string;
  userId?: string;
  action: string;
  outcome: PolicyOutcome;
  context: Partial<EvaluationContext>;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQuery {
  startTime?: Date;
  endTime?: Date;
  policyId?: string;
  userId?: string;
  outcome?: PolicyOutcome;
  limit?: number;
  cursor?: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  cursor?: string;
  hasMore: boolean;
}

export interface PolicyDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  type: 'added' | 'removed' | 'changed';
}

export interface PolicyCompareResponse {
  policyId: string;
  env1: string;
  env2: string;
  diffs: PolicyDiff[];
  compatible: boolean;
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLICommand {
  name: string;
  description: string;
  options: CLIOption[];
  action: (args: Record<string, unknown>) => Promise<void>;
}

export interface CLIOption {
  name: string;
  alias?: string;
  description: string;
  required?: boolean;
  default?: unknown;
  type: 'string' | 'number' | 'boolean' | 'array';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  location?: {
    line: number;
    column: number;
  };
  severity: 'error';
}

export interface ValidationWarning {
  code: string;
  message: string;
  location?: {
    line: number;
    column: number;
  };
  severity: 'warning';
}

// ============================================================================
// Testing Types
// ============================================================================

export interface TestContext {
  user?: Partial<UserContext>;
  request?: Partial<RequestContext>;
  time?: Partial<TimeContext>;
  resource?: Partial<ResourceContext>;
  environment?: Record<string, unknown>;
  custom?: Record<string, unknown>;
}

export interface TestResult {
  passed: boolean;
  outcome: PolicyOutcome;
  expected?: PolicyOutcome;
  message?: string;
  duration: number;
  trace?: SimulationTrace[];
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
  beforeAll?: () => Promise<void>;
  afterAll?: () => Promise<void>;
  beforeEach?: () => Promise<void>;
  afterEach?: () => Promise<void>;
}

export interface TestCase {
  name: string;
  policy: PolicyDefinition | string;
  context: TestContext;
  expected: PolicyOutcome;
  timeout?: number;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export type WebSocketEventType =
  | 'policy:created'
  | 'policy:updated'
  | 'policy:deleted'
  | 'policy:enabled'
  | 'policy:disabled'
  | 'evaluation:completed'
  | 'alert:triggered';

export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  timestamp: Date;
  data: T;
}

export interface PolicyChangeEvent {
  policyId: string;
  version: string;
  changes: PolicyDiff[];
  changedBy: string;
}

export interface EvaluationEvent {
  policyId: string;
  outcome: PolicyOutcome;
  userId?: string;
  duration: number;
}

export interface AlertEvent {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  policyId?: string;
  context?: Partial<EvaluationContext>;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
  timestamp: Date;
}
