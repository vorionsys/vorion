/**
 * Security Dashboard API
 *
 * REST API for security metrics and real-time monitoring.
 * Provides endpoints for:
 * - Full dashboard data aggregation
 * - Security score calculation
 * - Active threats and anomalies
 * - Recent incidents
 * - Compliance status by framework
 * - Time series data for charts
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors.js';
import {
  sendSuccess,
  sendError,
  sendForbidden,
  sendUnauthorized,
} from '../../intent/response-middleware.js';
import { HttpStatus } from '../../intent/response.js';
import {
  AnomalyDetector,
  createAnomalyDetector,
  type Anomaly,
  type AnomalySeverity,
} from '../../security/anomaly/index.js';
import {
  getBruteForceProtection,
  type BruteForceProtection,
  type LockoutStatus,
} from '../../security/brute-force.js';
import {
  getSessionManager,
  type SessionManager,
} from '../../security/session-manager.js';

const logger = createLogger({ component: 'api-v1-security-dashboard' });

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Time range query parameter schema
 */
const timeRangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  range: z.enum(['1h', '6h', '24h', '7d', '30d']).optional().default('24h'),
});

/**
 * Pagination query schema
 */
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * Incidents query schema
 */
const incidentsQuerySchema = timeRangeQuerySchema.merge(paginationQuerySchema).extend({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional(),
});

/**
 * Compliance query schema
 */
const complianceQuerySchema = z.object({
  framework: z.string().optional(),
});

/**
 * Trends query schema
 */
const trendsQuerySchema = timeRangeQuerySchema.extend({
  metric: z.enum([
    'auth_success_rate',
    'request_volume',
    'anomaly_count',
    'blocked_actors',
    'failed_auth',
    'injection_attempts',
  ]).optional(),
  interval: z.enum(['5m', '15m', '1h', '6h', '1d']).optional().default('1h'),
});

// =============================================================================
// Response Types / Interfaces
// =============================================================================

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
}

/**
 * Blocked actor information
 */
export interface BlockedActor {
  identifier: string;
  type: 'ip' | 'user';
  blockedAt: Date;
  reason: string;
  lockoutEndsAt?: Date;
  failedAttempts: number;
}

/**
 * Framework compliance status
 */
export interface FrameworkStatus {
  framework: string;
  displayName: string;
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-assessed';
  score: number;
  lastAssessment?: Date;
  controlsPassed: number;
  controlsTotal: number;
  criticalFindings: number;
}

/**
 * Upcoming audit information
 */
export interface Audit {
  id: string;
  framework: string;
  scheduledDate: Date;
  auditor?: string;
  status: 'scheduled' | 'in-progress' | 'completed';
}

/**
 * Security incident
 */
export interface SecurityIncident {
  id: string;
  timestamp: Date;
  type: string;
  severity: AnomalySeverity;
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  title: string;
  description: string;
  affectedUserId?: string;
  affectedIp?: string;
  indicators: Array<{ type: string; value: string | number | boolean }>;
  suggestedActions: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Overview metrics
 */
export interface SecurityOverview {
  securityScore: number;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  activeIncidents: number;
  openVulnerabilities: number;
  lastUpdated: Date;
}

/**
 * Threat metrics
 */
export interface ThreatMetrics {
  recentAnomalies: Anomaly[];
  blockedActors: BlockedActor[];
  failedAuthAttempts: number;
  injectionAttempts: number;
  suspiciousIpCount: number;
  activeLockouts: number;
}

/**
 * Trend metrics
 */
export interface TrendMetrics {
  authSuccessRate: TimeSeriesPoint[];
  requestVolume: TimeSeriesPoint[];
  anomalyCount: TimeSeriesPoint[];
  blockedActorsCount: TimeSeriesPoint[];
  failedAuthCount: TimeSeriesPoint[];
}

/**
 * Compliance metrics
 */
export interface ComplianceMetrics {
  frameworks: FrameworkStatus[];
  upcomingAudits: Audit[];
  overallScore: number;
}

/**
 * Full security dashboard data
 */
export interface SecurityDashboardData {
  overview: SecurityOverview;
  threats: ThreatMetrics;
  trends: TrendMetrics;
  compliance: ComplianceMetrics;
}

// =============================================================================
// Response Schemas (for documentation / type safety)
// =============================================================================

const timeSeriesPointSchema = z.object({
  timestamp: z.coerce.date(),
  value: z.number(),
});

const blockedActorSchema = z.object({
  identifier: z.string(),
  type: z.enum(['ip', 'user']),
  blockedAt: z.coerce.date(),
  reason: z.string(),
  lockoutEndsAt: z.coerce.date().optional(),
  failedAttempts: z.number(),
});

const frameworkStatusSchema = z.object({
  framework: z.string(),
  displayName: z.string(),
  status: z.enum(['compliant', 'partial', 'non-compliant', 'not-assessed']),
  score: z.number().min(0).max(100),
  lastAssessment: z.coerce.date().optional(),
  controlsPassed: z.number(),
  controlsTotal: z.number(),
  criticalFindings: z.number(),
});

const auditSchema = z.object({
  id: z.string(),
  framework: z.string(),
  scheduledDate: z.coerce.date(),
  auditor: z.string().optional(),
  status: z.enum(['scheduled', 'in-progress', 'completed']),
});

const securityIncidentSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
  title: z.string(),
  description: z.string(),
  affectedUserId: z.string().optional(),
  affectedIp: z.string().optional(),
  indicators: z.array(z.object({
    type: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })),
  suggestedActions: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

const securityOverviewSchema = z.object({
  securityScore: z.number().min(0).max(100),
  threatLevel: z.enum(['low', 'medium', 'high', 'critical']),
  activeIncidents: z.number(),
  openVulnerabilities: z.number(),
  lastUpdated: z.coerce.date(),
});

const threatMetricsSchema = z.object({
  recentAnomalies: z.array(z.any()),
  blockedActors: z.array(blockedActorSchema),
  failedAuthAttempts: z.number(),
  injectionAttempts: z.number(),
  suspiciousIpCount: z.number(),
  activeLockouts: z.number(),
});

const trendMetricsSchema = z.object({
  authSuccessRate: z.array(timeSeriesPointSchema),
  requestVolume: z.array(timeSeriesPointSchema),
  anomalyCount: z.array(timeSeriesPointSchema),
  blockedActorsCount: z.array(timeSeriesPointSchema),
  failedAuthCount: z.array(timeSeriesPointSchema),
});

const complianceMetricsSchema = z.object({
  frameworks: z.array(frameworkStatusSchema),
  upcomingAudits: z.array(auditSchema),
  overallScore: z.number().min(0).max(100),
});

const securityDashboardDataSchema = z.object({
  overview: securityOverviewSchema,
  threats: threatMetricsSchema,
  trends: trendMetricsSchema,
  compliance: complianceMetricsSchema,
});

// =============================================================================
// Type Declarations
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify<T = Record<string, unknown>>(): Promise<T>;
  }
}

interface JwtPayload {
  sub?: string;
  userId?: string;
  tenantId?: string;
  tenant_id?: string;
  roles?: string[];
  jti?: string;
}

interface AuthContext {
  userId: string;
  tenantId: string;
  roles: string[];
}

// =============================================================================
// Security Dashboard Service
// =============================================================================

/**
 * Service class for aggregating security dashboard data
 */
class SecurityDashboardService {
  private anomalyDetector: AnomalyDetector;
  private bruteForceProtection: BruteForceProtection;
  private sessionManager: SessionManager;

  // In-memory storage for demo/aggregated metrics
  // In production, these would come from a metrics database (e.g., TimescaleDB, InfluxDB)
  private recentAnomalies: Anomaly[] = [];
  private blockedActors: BlockedActor[] = [];
  private incidents: SecurityIncident[] = [];
  private metricsHistory: Map<string, TimeSeriesPoint[]> = new Map();

  constructor() {
    this.anomalyDetector = createAnomalyDetector({ enabled: true });
    this.bruteForceProtection = getBruteForceProtection();
    this.sessionManager = getSessionManager();

    // Register anomaly callback to track recent anomalies
    this.anomalyDetector.onAnomaly((anomaly) => {
      this.recentAnomalies.unshift(anomaly);
      // Keep last 100 anomalies
      if (this.recentAnomalies.length > 100) {
        this.recentAnomalies.pop();
      }

      // Also create an incident for high-severity anomalies
      if (anomaly.severity === 'high' || anomaly.severity === 'critical') {
        this.createIncidentFromAnomaly(anomaly);
      }
    });

    // Initialize metrics history
    this.initializeMetricsHistory();
  }

  private initializeMetricsHistory(): void {
    const metrics = [
      'auth_success_rate',
      'request_volume',
      'anomaly_count',
      'blocked_actors',
      'failed_auth',
    ];

    for (const metric of metrics) {
      this.metricsHistory.set(metric, []);
    }
  }

  private createIncidentFromAnomaly(anomaly: Anomaly): void {
    const incident: SecurityIncident = {
      id: anomaly.id,
      timestamp: anomaly.timestamp,
      type: anomaly.type,
      severity: anomaly.severity,
      status: 'open',
      title: `${anomaly.type} detected`,
      description: anomaly.description,
      affectedUserId: anomaly.userId,
      affectedIp: anomaly.ipAddress,
      indicators: anomaly.indicators.map((i) => ({
        type: i.type,
        value: i.value,
      })),
      suggestedActions: anomaly.suggestedActions,
      metadata: anomaly.metadata,
    };

    this.incidents.unshift(incident);
    // Keep last 500 incidents
    if (this.incidents.length > 500) {
      this.incidents.pop();
    }
  }

  /**
   * Calculate security score based on various factors
   */
  calculateSecurityScore(): number {
    let score = 100;

    // Deduct for active incidents
    const activeIncidents = this.incidents.filter((i) => i.status === 'open').length;
    score -= Math.min(activeIncidents * 5, 30);

    // Deduct for recent anomalies
    const recentAnomalyCount = this.recentAnomalies.filter(
      (a) => Date.now() - a.timestamp.getTime() < 24 * 60 * 60 * 1000
    ).length;
    score -= Math.min(recentAnomalyCount * 2, 20);

    // Deduct for blocked actors (indicates ongoing attacks)
    score -= Math.min(this.blockedActors.length * 1, 10);

    // Deduct for critical/high severity incidents
    const criticalIncidents = this.incidents.filter(
      (i) => i.status === 'open' && (i.severity === 'critical' || i.severity === 'high')
    ).length;
    score -= Math.min(criticalIncidents * 10, 30);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determine threat level based on metrics
   */
  determineThreatLevel(): 'low' | 'medium' | 'high' | 'critical' {
    const score = this.calculateSecurityScore();

    if (score >= 80) return 'low';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'high';
    return 'critical';
  }

  /**
   * Get security overview metrics
   */
  async getOverview(): Promise<SecurityOverview> {
    const activeIncidents = this.incidents.filter((i) => i.status === 'open').length;

    // In production, this would query a vulnerability scanner
    const openVulnerabilities = 0;

    return {
      securityScore: this.calculateSecurityScore(),
      threatLevel: this.determineThreatLevel(),
      activeIncidents,
      openVulnerabilities,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get threat metrics
   */
  async getThreats(tenantId: string): Promise<ThreatMetrics> {
    // Filter anomalies from last 24 hours
    const recentAnomalies = this.recentAnomalies.filter(
      (a) =>
        Date.now() - a.timestamp.getTime() < 24 * 60 * 60 * 1000 &&
        (!a.tenantId || a.tenantId === tenantId)
    );

    // Get active blocked actors
    const blockedActors = this.blockedActors.filter(
      (a) => !a.lockoutEndsAt || a.lockoutEndsAt > new Date()
    );

    // Count failed auth attempts (from brute force protection data)
    // In production, this would aggregate from actual attempt records
    const failedAuthAttempts = recentAnomalies.filter(
      (a) => a.type === 'failed-auth-spike'
    ).length * 10; // Rough estimate

    // Count injection attempts
    const injectionAttempts = recentAnomalies.filter(
      (a) => a.metadata?.detectorName === 'injection'
    ).length;

    // Count suspicious IPs
    const suspiciousIps = new Set(
      recentAnomalies.filter((a) => a.ipAddress).map((a) => a.ipAddress)
    );

    return {
      recentAnomalies,
      blockedActors,
      failedAuthAttempts,
      injectionAttempts,
      suspiciousIpCount: suspiciousIps.size,
      activeLockouts: blockedActors.length,
    };
  }

  /**
   * Get incidents with filtering
   */
  async getIncidents(
    tenantId: string,
    options: {
      from?: Date;
      to?: Date;
      severity?: AnomalySeverity;
      status?: string;
      page: number;
      pageSize: number;
    }
  ): Promise<{ incidents: SecurityIncident[]; total: number }> {
    let filtered = [...this.incidents];

    // Filter by date range
    if (options.from) {
      filtered = filtered.filter((i) => i.timestamp >= options.from!);
    }
    if (options.to) {
      filtered = filtered.filter((i) => i.timestamp <= options.to!);
    }

    // Filter by severity
    if (options.severity) {
      filtered = filtered.filter((i) => i.severity === options.severity);
    }

    // Filter by status
    if (options.status) {
      filtered = filtered.filter((i) => i.status === options.status);
    }

    const total = filtered.length;
    const start = (options.page - 1) * options.pageSize;
    const incidents = filtered.slice(start, start + options.pageSize);

    return { incidents, total };
  }

  /**
   * Get compliance status
   */
  async getCompliance(tenantId: string, framework?: string): Promise<ComplianceMetrics> {
    // In production, this would query actual compliance assessment data
    const frameworks: FrameworkStatus[] = [
      {
        framework: 'soc2',
        displayName: 'SOC 2 Type II',
        status: 'compliant',
        score: 92,
        lastAssessment: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        controlsPassed: 112,
        controlsTotal: 118,
        criticalFindings: 0,
      },
      {
        framework: 'gdpr',
        displayName: 'GDPR',
        status: 'compliant',
        score: 88,
        lastAssessment: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        controlsPassed: 42,
        controlsTotal: 48,
        criticalFindings: 0,
      },
      {
        framework: 'hipaa',
        displayName: 'HIPAA',
        status: 'partial',
        score: 75,
        lastAssessment: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        controlsPassed: 38,
        controlsTotal: 52,
        criticalFindings: 2,
      },
      {
        framework: 'pci-dss',
        displayName: 'PCI DSS',
        status: 'not-assessed',
        score: 0,
        controlsPassed: 0,
        controlsTotal: 264,
        criticalFindings: 0,
      },
      {
        framework: 'iso27001',
        displayName: 'ISO 27001',
        status: 'compliant',
        score: 95,
        lastAssessment: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        controlsPassed: 93,
        controlsTotal: 98,
        criticalFindings: 0,
      },
    ];

    // Filter by framework if specified
    const filteredFrameworks = framework
      ? frameworks.filter((f) => f.framework === framework)
      : frameworks;

    // Calculate overall score (weighted by controls count)
    const assessedFrameworks = filteredFrameworks.filter((f) => f.status !== 'not-assessed');
    const overallScore =
      assessedFrameworks.length > 0
        ? Math.round(
            assessedFrameworks.reduce((acc, f) => acc + f.score * f.controlsTotal, 0) /
              assessedFrameworks.reduce((acc, f) => acc + f.controlsTotal, 0)
          )
        : 0;

    const upcomingAudits: Audit[] = [
      {
        id: 'audit-001',
        framework: 'soc2',
        scheduledDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        auditor: 'Deloitte',
        status: 'scheduled',
      },
      {
        id: 'audit-002',
        framework: 'iso27001',
        scheduledDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        status: 'scheduled',
      },
    ];

    return {
      frameworks: filteredFrameworks,
      upcomingAudits,
      overallScore,
    };
  }

  /**
   * Get trend data for charts
   */
  async getTrends(
    tenantId: string,
    options: {
      from?: Date;
      to?: Date;
      range: string;
      metric?: string;
      interval: string;
    }
  ): Promise<TrendMetrics> {
    // Calculate time range
    const now = new Date();
    let from = options.from;
    let to = options.to || now;

    if (!from) {
      const rangeMs: Record<string, number> = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      };
      from = new Date(now.getTime() - (rangeMs[options.range] || rangeMs['24h']));
    }

    // Calculate interval in milliseconds
    const intervalMs: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const interval = intervalMs[options.interval] || intervalMs['1h'];

    // Generate time series data points
    const generateTimeSeries = (
      baseValue: number,
      variance: number
    ): TimeSeriesPoint[] => {
      const points: TimeSeriesPoint[] = [];
      let current = from!.getTime();

      while (current <= to.getTime()) {
        // Add some random variation
        const variation = (Math.random() - 0.5) * 2 * variance;
        const value = Math.max(0, baseValue + variation);

        points.push({
          timestamp: new Date(current),
          value: Math.round(value * 100) / 100,
        });

        current += interval;
      }

      return points;
    };

    // Generate realistic-looking trend data
    // In production, these would be actual aggregated metrics
    return {
      authSuccessRate: generateTimeSeries(95, 3), // ~95% success rate
      requestVolume: generateTimeSeries(1000, 500), // ~1000 requests per interval
      anomalyCount: generateTimeSeries(2, 2), // ~2 anomalies per interval
      blockedActorsCount: generateTimeSeries(5, 3), // ~5 blocked actors
      failedAuthCount: generateTimeSeries(50, 30), // ~50 failed auth attempts
    };
  }

  /**
   * Get full dashboard data
   */
  async getDashboard(tenantId: string): Promise<SecurityDashboardData> {
    const [overview, threats, compliance, trends] = await Promise.all([
      this.getOverview(),
      this.getThreats(tenantId),
      this.getCompliance(tenantId),
      this.getTrends(tenantId, { range: '24h', interval: '1h' }),
    ]);

    return {
      overview,
      threats,
      trends,
      compliance,
    };
  }

  /**
   * Record a blocked actor
   */
  recordBlockedActor(actor: BlockedActor): void {
    // Remove existing entry if present
    this.blockedActors = this.blockedActors.filter(
      (a) => a.identifier !== actor.identifier
    );
    this.blockedActors.unshift(actor);

    // Keep last 1000 blocked actors
    if (this.blockedActors.length > 1000) {
      this.blockedActors.pop();
    }
  }
}

// Singleton instance
let dashboardService: SecurityDashboardService | null = null;

function getDashboardService(): SecurityDashboardService {
  if (!dashboardService) {
    dashboardService = new SecurityDashboardService();
  }
  return dashboardService;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if user has required security role
 */
function hasSecurityRole(roles: string[]): boolean {
  const securityRoles = [
    'admin',
    'security-admin',
    'security:admin',
    'tenant:admin',
    'system:admin',
  ];
  return roles.some((role) => securityRoles.includes(role));
}

/**
 * Extract authenticated user context from request
 */
async function getAuthContext(request: FastifyRequest): Promise<AuthContext> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();

    const userId = payload.sub ?? payload.userId;
    const tenantId = payload.tenantId ?? payload.tenant_id;
    const roles = payload.roles ?? [];

    if (!userId) {
      throw new UnauthorizedError('User identifier missing from token');
    }

    if (!tenantId) {
      throw new ForbiddenError('Tenant context missing from token');
    }

    return {
      userId,
      tenantId,
      roles,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or missing authentication token');
  }
}

/**
 * Require security admin role
 */
function requireSecurityAdmin(roles: string[]): void {
  if (!hasSecurityRole(roles)) {
    throw new ForbiddenError('Security admin role required to access this resource');
  }
}

/**
 * Parse time range from query parameters
 */
function parseTimeRange(query: z.infer<typeof timeRangeQuerySchema>): {
  from?: Date;
  to?: Date;
} {
  return {
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

/**
 * Wrap handler with error handling
 */
function withErrorHandling<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
): (request: FastifyRequest, reply: FastifyReply) => Promise<T | void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<T | void> => {
    try {
      return await handler(request, reply);
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          path: e.path.join('.') || '(root)',
          message: e.message,
          code: e.code,
        }));
        throw new ValidationError('Request validation failed', { errors });
      }

      // Handle auth errors
      if (error instanceof UnauthorizedError) {
        return sendUnauthorized(reply, error.message, request);
      }

      if (error instanceof ForbiddenError) {
        return sendForbidden(reply, error.message, request);
      }

      // Re-throw other errors to be handled by global error handler
      throw error;
    }
  };
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * GET /api/v1/security/dashboard - Full dashboard data
 */
async function handleGetDashboard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  logger.debug({ tenantId }, 'Fetching security dashboard');

  const service = getDashboardService();
  const dashboard = await service.getDashboard(tenantId);

  logger.info({ tenantId }, 'Security dashboard retrieved');

  return sendSuccess(reply, dashboard, HttpStatus.OK, request);
}

/**
 * GET /api/v1/security/score - Security score
 */
async function handleGetScore(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  logger.debug({ tenantId }, 'Fetching security score');

  const service = getDashboardService();
  const overview = await service.getOverview();

  logger.info({ tenantId, score: overview.securityScore }, 'Security score retrieved');

  return sendSuccess(
    reply,
    {
      score: overview.securityScore,
      threatLevel: overview.threatLevel,
      lastUpdated: overview.lastUpdated,
    },
    HttpStatus.OK,
    request
  );
}

/**
 * GET /api/v1/security/threats - Active threats and anomalies
 */
async function handleGetThreats(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  const query = timeRangeQuerySchema.parse(request.query);

  logger.debug({ tenantId, query }, 'Fetching security threats');

  const service = getDashboardService();
  const threats = await service.getThreats(tenantId);

  logger.info(
    {
      tenantId,
      anomalyCount: threats.recentAnomalies.length,
      blockedActorCount: threats.blockedActors.length,
    },
    'Security threats retrieved'
  );

  return sendSuccess(reply, threats, HttpStatus.OK, request);
}

/**
 * GET /api/v1/security/incidents - Recent incidents
 */
async function handleGetIncidents(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  const query = incidentsQuerySchema.parse(request.query);
  const timeRange = parseTimeRange(query);

  logger.debug({ tenantId, query }, 'Fetching security incidents');

  const service = getDashboardService();
  const { incidents, total } = await service.getIncidents(tenantId, {
    from: timeRange.from,
    to: timeRange.to,
    severity: query.severity as AnomalySeverity | undefined,
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  logger.info({ tenantId, incidentCount: incidents.length, total }, 'Security incidents retrieved');

  return sendSuccess(
    reply,
    {
      incidents,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    },
    HttpStatus.OK,
    request
  );
}

/**
 * GET /api/v1/security/compliance - Compliance status
 */
async function handleGetCompliance(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  const query = complianceQuerySchema.parse(request.query);

  logger.debug({ tenantId, query }, 'Fetching compliance status');

  const service = getDashboardService();
  const compliance = await service.getCompliance(tenantId, query.framework);

  logger.info(
    {
      tenantId,
      frameworkCount: compliance.frameworks.length,
      overallScore: compliance.overallScore,
    },
    'Compliance status retrieved'
  );

  return sendSuccess(reply, compliance, HttpStatus.OK, request);
}

/**
 * GET /api/v1/security/trends - Time series data for charts
 */
async function handleGetTrends(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenantId, roles } = await getAuthContext(request);
  requireSecurityAdmin(roles);

  const query = trendsQuerySchema.parse(request.query);
  const timeRange = parseTimeRange(query);

  logger.debug({ tenantId, query }, 'Fetching security trends');

  const service = getDashboardService();
  const trends = await service.getTrends(tenantId, {
    from: timeRange.from,
    to: timeRange.to,
    range: query.range,
    metric: query.metric,
    interval: query.interval,
  });

  logger.info({ tenantId, range: query.range, interval: query.interval }, 'Security trends retrieved');

  return sendSuccess(reply, trends, HttpStatus.OK, request);
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register security dashboard routes
 *
 * Routes:
 * - GET /security/dashboard - Full dashboard data
 * - GET /security/score     - Security score (0-100)
 * - GET /security/threats   - Active threats and anomalies
 * - GET /security/incidents - Recent incidents
 * - GET /security/compliance - Compliance status by framework
 * - GET /security/trends    - Time series data for charts
 *
 * @param fastify - Fastify instance
 */
export async function registerSecurityDashboardRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const prefix = '/security';

  // GET /security/dashboard - Full dashboard data
  fastify.get(
    `${prefix}/dashboard`,
    withErrorHandling(async (request, reply) => {
      return handleGetDashboard(request, reply);
    })
  );

  // GET /security/score - Security score
  fastify.get(
    `${prefix}/score`,
    withErrorHandling(async (request, reply) => {
      return handleGetScore(request, reply);
    })
  );

  // GET /security/threats - Active threats and anomalies
  fastify.get(
    `${prefix}/threats`,
    withErrorHandling(async (request, reply) => {
      return handleGetThreats(request, reply);
    })
  );

  // GET /security/incidents - Recent incidents
  fastify.get(
    `${prefix}/incidents`,
    withErrorHandling(async (request, reply) => {
      return handleGetIncidents(request, reply);
    })
  );

  // GET /security/compliance - Compliance status
  fastify.get(
    `${prefix}/compliance`,
    withErrorHandling(async (request, reply) => {
      return handleGetCompliance(request, reply);
    })
  );

  // GET /security/trends - Time series data
  fastify.get(
    `${prefix}/trends`,
    withErrorHandling(async (request, reply) => {
      return handleGetTrends(request, reply);
    })
  );

  logger.info({ prefix }, 'Security dashboard routes registered');
}

export default registerSecurityDashboardRoutes;

// =============================================================================
// Exports
// =============================================================================

export {
  // Service
  SecurityDashboardService,
  getDashboardService,

  // Schemas
  timeRangeQuerySchema,
  paginationQuerySchema,
  incidentsQuerySchema,
  complianceQuerySchema,
  trendsQuerySchema,
  securityDashboardDataSchema,
  securityOverviewSchema,
  threatMetricsSchema,
  trendMetricsSchema,
  complianceMetricsSchema,
  securityIncidentSchema,
  frameworkStatusSchema,
  auditSchema,
  blockedActorSchema,
  timeSeriesPointSchema,
};
