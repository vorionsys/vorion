/**
 * Trust Oracle REST API
 * API endpoints for vendor trust scoring and risk assessment
 */

import {
  TrustScore,
  RiskAssessment,
  VendorInfo,
  HealthEvent,
  Alert,
  VendorRiskReport,
  PaginatedResponse,
  ApiError,
} from './types';
import { TrustOracleService } from './oracle';
import { VendorRegistry, CreateVendorInput, UpdateVendorInput } from './vendor-registry';
import { AlertManager, ListAlertsOptions } from './alerts';
import { ReportingService, ReportOptions, ListReportsOptions } from './reporting';
import { ContinuousMonitoringService, HealthEventQueryOptions } from './continuous-monitoring';

// ============================================================================
// API Router Configuration
// ============================================================================

export interface TrustOracleApiConfig {
  trustOracle: TrustOracleService;
  vendorRegistry: VendorRegistry;
  alertManager: AlertManager;
  reportingService: ReportingService;
  monitoringService: ContinuousMonitoringService;
  authMiddleware: AuthMiddleware;
  rateLimiter: RateLimiter;
}

export interface AuthMiddleware {
  authenticate(request: ApiRequest): Promise<AuthContext>;
  authorize(context: AuthContext, permission: string): boolean;
}

export interface RateLimiter {
  checkLimit(clientId: string, endpoint: string): Promise<boolean>;
  getRemainingRequests(clientId: string): Promise<number>;
}

export interface AuthContext {
  userId: string;
  clientId: string;
  permissions: string[];
  organizationId: string;
}

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T | ApiError;
  headers?: Record<string, string>;
}

// ============================================================================
// API Router
// ============================================================================

export class TrustOracleApiRouter {
  private readonly config: TrustOracleApiConfig;
  private readonly routes: Map<string, RouteHandler> = new Map();

  constructor(config: TrustOracleApiConfig) {
    this.config = config;
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Trust Score Endpoints
    this.routes.set('GET /trust/vendors/:id/score', this.getVendorTrustScore.bind(this));
    this.routes.set('GET /trust/vendors/:id/history', this.getTrustScoreHistory.bind(this));
    this.routes.set('POST /trust/vendors/assess', this.assessVendorRisk.bind(this));
    this.routes.set('POST /trust/vendors/:id/monitor', this.startVendorMonitoring.bind(this));
    this.routes.set('DELETE /trust/vendors/:id/monitor', this.stopVendorMonitoring.bind(this));
    this.routes.set('GET /trust/vendors/:id/monitoring-status', this.getMonitoringStatus.bind(this));
    this.routes.set('POST /trust/vendors/compare', this.compareTrustScores.bind(this));

    // Vendor Management Endpoints
    this.routes.set('GET /trust/vendors', this.listVendors.bind(this));
    this.routes.set('GET /trust/vendors/:id', this.getVendor.bind(this));
    this.routes.set('POST /trust/vendors', this.createVendor.bind(this));
    this.routes.set('PUT /trust/vendors/:id', this.updateVendor.bind(this));
    this.routes.set('DELETE /trust/vendors/:id', this.deleteVendor.bind(this));

    // Risk Assessment Endpoints
    this.routes.set('GET /trust/vendors/:id/risk-assessment', this.getRiskAssessment.bind(this));
    this.routes.set('POST /trust/vendors/:id/risk-assessment', this.createRiskAssessment.bind(this));
    this.routes.set('GET /trust/portfolio/concentration-risk', this.getConcentrationRisk.bind(this));

    // Health Events Endpoints
    this.routes.set('GET /trust/vendors/:id/health-events', this.getHealthEvents.bind(this));
    this.routes.set('GET /trust/vendors/:id/health-stats', this.getHealthEventStats.bind(this));

    // Alert Endpoints
    this.routes.set('GET /trust/vendors/:id/alerts', this.getVendorAlerts.bind(this));
    this.routes.set('GET /trust/alerts', this.listAlerts.bind(this));
    this.routes.set('GET /trust/alerts/:id', this.getAlert.bind(this));
    this.routes.set('POST /trust/alerts/:id/acknowledge', this.acknowledgeAlert.bind(this));
    this.routes.set('POST /trust/alerts/:id/resolve', this.resolveAlert.bind(this));
    this.routes.set('GET /trust/alerts/stats', this.getAlertStats.bind(this));

    // Reporting Endpoints
    this.routes.set('GET /trust/vendors/:id/reports', this.getVendorReports.bind(this));
    this.routes.set('POST /trust/vendors/:id/reports/assessment', this.generateAssessmentReport.bind(this));
    this.routes.set('POST /trust/vendors/:id/reports/periodic', this.generatePeriodicReport.bind(this));
    this.routes.set('POST /trust/reports/board-summary', this.generateBoardSummary.bind(this));
    this.routes.set('GET /trust/reports/:id', this.getReport.bind(this));
    this.routes.set('GET /trust/reports/:id/export', this.exportReport.bind(this));

    // Certification Endpoints
    this.routes.set('GET /trust/vendors/:id/certifications', this.getVendorCertifications.bind(this));
    this.routes.set('POST /trust/vendors/:id/certifications', this.addCertification.bind(this));
    this.routes.set('PUT /trust/vendors/:id/certifications/:certId', this.updateCertification.bind(this));

    // Contract Endpoints
    this.routes.set('GET /trust/vendors/:id/contracts', this.getVendorContracts.bind(this));
    this.routes.set('POST /trust/vendors/:id/contracts', this.createContract.bind(this));
    this.routes.set('PUT /trust/vendors/:id/contracts/:contractId', this.updateContract.bind(this));
  }

  async handleRequest(request: ApiRequest): Promise<ApiResponse> {
    try {
      // Authenticate request
      const authContext = await this.config.authMiddleware.authenticate(request);

      // Check rate limit
      const withinLimit = await this.config.rateLimiter.checkLimit(
        authContext.clientId,
        request.path,
      );
      if (!withinLimit) {
        return this.rateLimitExceeded(authContext.clientId);
      }

      // Find route handler
      const routeKey = `${request.method} ${this.normalizeRoute(request.path)}`;
      const handler = this.routes.get(routeKey);

      if (!handler) {
        return this.notFound(request.path);
      }

      // Execute handler
      return await handler(request, authContext);
    } catch (error) {
      return this.handleError(error);
    }
  }

  private normalizeRoute(path: string): string {
    // Convert /trust/vendors/123/score to /trust/vendors/:id/score
    return path.replace(/\/trust\/vendors\/[^/]+/g, '/trust/vendors/:id')
      .replace(/\/trust\/alerts\/[^/]+/g, '/trust/alerts/:id')
      .replace(/\/trust\/reports\/[^/]+/g, '/trust/reports/:id')
      .replace(/\/certifications\/[^/]+/g, '/certifications/:certId')
      .replace(/\/contracts\/[^/]+/g, '/contracts/:contractId');
  }

  // ============================================================================
  // Trust Score Endpoints
  // ============================================================================

  private async getVendorTrustScore(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<TrustScore>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const score = await this.config.trustOracle.getVendorTrustScore(vendorId);

    return { status: 200, body: score };
  }

  private async getTrustScoreHistory(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<TrustScore[]>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const limit = parseInt(request.query.limit || '100', 10);

    const history = await this.config.trustOracle.getTrustScoreHistory(vendorId, limit);

    return { status: 200, body: history };
  }

  private async assessVendorRisk(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<RiskAssessment>> {
    this.checkPermission(context, 'trust:assess');

    const input = request.body as AssessVendorInput;
    const vendor = await this.config.vendorRegistry.getVendor(input.vendorId);
    const assessment = await this.config.trustOracle.assessThirdPartyRisk(vendor);

    return { status: 200, body: assessment };
  }

  private async startVendorMonitoring(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<MonitoringStartResponse>> {
    this.checkPermission(context, 'trust:monitor');

    const vendorId = request.params.id;
    await this.config.trustOracle.startVendorMonitoring(vendorId);

    return {
      status: 200,
      body: {
        vendorId,
        status: 'monitoring_started',
        message: `Monitoring started for vendor ${vendorId}`,
      },
    };
  }

  private async stopVendorMonitoring(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<MonitoringStopResponse>> {
    this.checkPermission(context, 'trust:monitor');

    const vendorId = request.params.id;
    await this.config.trustOracle.stopVendorMonitoring(vendorId);

    return {
      status: 200,
      body: {
        vendorId,
        status: 'monitoring_stopped',
        message: `Monitoring stopped for vendor ${vendorId}`,
      },
    };
  }

  private async getMonitoringStatus(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<MonitoringStatusResponse>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const status = await this.config.trustOracle.getMonitoringStatus(vendorId);

    return { status: 200, body: status };
  }

  private async compareTrustScores(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<TrustScoreComparisonResponse>> {
    this.checkPermission(context, 'trust:read');

    const input = request.body as CompareVendorsInput;
    const comparison = await this.config.trustOracle.compareTrustScores(input.vendorIds);

    return { status: 200, body: comparison };
  }

  // ============================================================================
  // Vendor Management Endpoints
  // ============================================================================

  private async listVendors(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<PaginatedResponse<VendorInfo>>> {
    this.checkPermission(context, 'vendors:read');

    const options = {
      page: parseInt(request.query.page || '1', 10),
      pageSize: parseInt(request.query.pageSize || '20', 10),
      status: request.query.status as VendorInfo['status'],
      tier: request.query.tier as VendorInfo['tier'],
      category: request.query.category as VendorInfo['category'],
      sortBy: request.query.sortBy,
      sortOrder: request.query.sortOrder as 'asc' | 'desc',
    };

    const vendors = await this.config.vendorRegistry.listVendors(options);

    return { status: 200, body: vendors };
  }

  private async getVendor(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorInfo>> {
    this.checkPermission(context, 'vendors:read');

    const vendorId = request.params.id;
    const vendor = await this.config.vendorRegistry.getVendor(vendorId);

    return { status: 200, body: vendor };
  }

  private async createVendor(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorInfo>> {
    this.checkPermission(context, 'vendors:create');

    const input = request.body as CreateVendorInput;
    const vendor = await this.config.vendorRegistry.createVendor(input, context.userId);

    return { status: 201, body: vendor };
  }

  private async updateVendor(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorInfo>> {
    this.checkPermission(context, 'vendors:update');

    const vendorId = request.params.id;
    const updates = request.body as UpdateVendorInput;
    const vendor = await this.config.vendorRegistry.updateVendor(vendorId, updates, context.userId);

    return { status: 200, body: vendor };
  }

  private async deleteVendor(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<DeleteResponse>> {
    this.checkPermission(context, 'vendors:delete');

    const vendorId = request.params.id;
    await this.config.vendorRegistry.deleteVendor(vendorId, context.userId);

    return {
      status: 200,
      body: {
        success: true,
        message: `Vendor ${vendorId} deleted`,
      },
    };
  }

  // ============================================================================
  // Risk Assessment Endpoints
  // ============================================================================

  private async getRiskAssessment(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<RiskAssessment>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const vendor = await this.config.vendorRegistry.getVendor(vendorId);
    const assessment = await this.config.trustOracle.assessThirdPartyRisk(vendor);

    return { status: 200, body: assessment };
  }

  private async createRiskAssessment(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<RiskAssessment>> {
    this.checkPermission(context, 'trust:assess');

    const vendorId = request.params.id;
    const vendor = await this.config.vendorRegistry.getVendor(vendorId);
    const assessment = await this.config.trustOracle.assessThirdPartyRisk(vendor);

    return { status: 201, body: assessment };
  }

  private async getConcentrationRisk(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<ConcentrationRiskResponse>> {
    this.checkPermission(context, 'trust:read');

    const analysis = await this.config.trustOracle.getConcentrationRisk();

    return { status: 200, body: analysis };
  }

  // ============================================================================
  // Health Events Endpoints
  // ============================================================================

  private async getHealthEvents(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<HealthEvent[]>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const options: HealthEventQueryOptions = {
      startDate: request.query.startDate ? new Date(request.query.startDate) : undefined,
      endDate: request.query.endDate ? new Date(request.query.endDate) : undefined,
      types: request.query.types?.split(',') as HealthEvent['type'][],
      severities: request.query.severities?.split(',') as HealthEvent['severity'][],
      limit: parseInt(request.query.limit || '100', 10),
      offset: parseInt(request.query.offset || '0', 10),
    };

    const events = await this.config.monitoringService.getHealthEvents(vendorId, options);

    return { status: 200, body: events };
  }

  private async getHealthEventStats(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<HealthEventStatsResponse>> {
    this.checkPermission(context, 'trust:read');

    const vendorId = request.params.id;
    const days = parseInt(request.query.days || '30', 10);

    const stats = await this.config.monitoringService.getHealthEventStats(vendorId, days);

    return { status: 200, body: stats };
  }

  // ============================================================================
  // Alert Endpoints
  // ============================================================================

  private async getVendorAlerts(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<Alert[]>> {
    this.checkPermission(context, 'alerts:read');

    const vendorId = request.params.id;
    const options: ListAlertsOptions = {
      statuses: request.query.statuses?.split(',') as Alert['status'][],
      severities: request.query.severities?.split(',') as Alert['severity'][],
    };

    const alerts = await this.config.alertManager.getVendorAlerts(vendorId, options);

    return { status: 200, body: alerts };
  }

  private async listAlerts(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<PaginatedResponse<Alert>>> {
    this.checkPermission(context, 'alerts:read');

    const options: ListAlertsOptions = {
      vendorId: request.query.vendorId,
      types: request.query.types?.split(',') as Alert['type'][],
      severities: request.query.severities?.split(',') as Alert['severity'][],
      statuses: request.query.statuses?.split(',') as Alert['status'][],
      startDate: request.query.startDate ? new Date(request.query.startDate) : undefined,
      endDate: request.query.endDate ? new Date(request.query.endDate) : undefined,
      page: parseInt(request.query.page || '1', 10),
      pageSize: parseInt(request.query.pageSize || '20', 10),
    };

    const alerts = await this.config.alertManager.listAlerts(options);

    return { status: 200, body: alerts };
  }

  private async getAlert(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<Alert>> {
    this.checkPermission(context, 'alerts:read');

    const alertId = request.params.id;
    const alert = await this.config.alertManager.getAlert(alertId);

    return { status: 200, body: alert };
  }

  private async acknowledgeAlert(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<Alert>> {
    this.checkPermission(context, 'alerts:update');

    const alertId = request.params.id;
    const alert = await this.config.alertManager.acknowledgeAlert(alertId, context.userId);

    return { status: 200, body: alert };
  }

  private async resolveAlert(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<Alert>> {
    this.checkPermission(context, 'alerts:update');

    const alertId = request.params.id;
    const resolution = request.body as AlertResolutionInput;

    const alert = await this.config.alertManager.resolveAlert(alertId, {
      type: resolution.type,
      reason: resolution.reason,
      resolvedBy: context.userId,
      notes: resolution.notes,
    });

    return { status: 200, body: alert };
  }

  private async getAlertStats(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<AlertStatsResponse>> {
    this.checkPermission(context, 'alerts:read');

    const vendorId = request.query.vendorId;
    const stats = await this.config.alertManager.getAlertStats(vendorId);

    return { status: 200, body: stats };
  }

  // ============================================================================
  // Reporting Endpoints
  // ============================================================================

  private async getVendorReports(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorRiskReport[]>> {
    this.checkPermission(context, 'reports:read');

    const vendorId = request.params.id;
    const reports = await this.config.reportingService.getVendorReports(vendorId);

    return { status: 200, body: reports };
  }

  private async generateAssessmentReport(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorRiskReport>> {
    this.checkPermission(context, 'reports:create');

    const vendorId = request.params.id;
    const options = request.body as ReportOptions;

    const report = await this.config.reportingService.generateVendorAssessmentReport(vendorId, {
      ...options,
      generatedBy: context.userId,
    });

    return { status: 201, body: report };
  }

  private async generatePeriodicReport(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorRiskReport>> {
    this.checkPermission(context, 'reports:create');

    const vendorId = request.params.id;
    const options = request.body as ReportOptions;

    const report = await this.config.reportingService.generatePeriodicReviewReport(vendorId, {
      ...options,
      generatedBy: context.userId,
    });

    return { status: 201, body: report };
  }

  private async generateBoardSummary(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorRiskReport>> {
    this.checkPermission(context, 'reports:create');

    const input = request.body as BoardSummaryInput;

    const report = await this.config.reportingService.generateBoardSummaryReport(input.vendorIds, {
      generatedBy: context.userId,
      format: input.format,
    });

    return { status: 201, body: report };
  }

  private async getReport(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<VendorRiskReport | null>> {
    this.checkPermission(context, 'reports:read');

    const reportId = request.params.id;
    const report = await this.config.reportingService.getReport(reportId);

    if (!report) {
      return this.notFound(`Report ${reportId}`) as unknown as ApiResponse<VendorRiskReport | null>;
    }

    return { status: 200, body: report };
  }

  private async exportReport(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<ExportReportResponse>> {
    this.checkPermission(context, 'reports:export');

    const reportId = request.params.id;
    const format = request.query.format as 'pdf' | 'csv' | 'excel' | 'json' || 'pdf';

    const result = await this.config.reportingService.exportReport(reportId, format);

    return {
      status: 200,
      body: {
        url: result.url,
        filename: result.filename,
        size: result.size,
        format: result.format,
        expiresAt: result.expiresAt,
      },
    };
  }

  // ============================================================================
  // Certification Endpoints
  // ============================================================================

  private async getVendorCertifications(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<CertificationResponse[]>> {
    this.checkPermission(context, 'vendors:read');

    const vendorId = request.params.id;
    const certifications = await this.config.vendorRegistry.getVendorCertifications(vendorId);

    return { status: 200, body: certifications };
  }

  private async addCertification(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<CertificationResponse>> {
    this.checkPermission(context, 'vendors:update');

    const vendorId = request.params.id;
    const input = request.body as AddCertificationInput;

    const certification = await this.config.vendorRegistry.addCertification({
      vendorId,
      ...input,
    } as import('./vendor-registry').CreateCertificationInput, context.userId);

    return { status: 201, body: certification };
  }

  private async updateCertification(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<CertificationResponse>> {
    this.checkPermission(context, 'vendors:update');

    const certificationId = request.params.certId;
    const updates = request.body as UpdateCertificationInput;

    const certification = await this.config.vendorRegistry.updateCertification(
      certificationId,
      updates,
      context.userId,
    );

    return { status: 200, body: certification };
  }

  // ============================================================================
  // Contract Endpoints
  // ============================================================================

  private async getVendorContracts(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<ContractResponse[]>> {
    this.checkPermission(context, 'vendors:read');

    const vendorId = request.params.id;
    const contracts = await this.config.vendorRegistry.getVendorContracts(vendorId);

    return { status: 200, body: contracts };
  }

  private async createContract(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<ContractResponse>> {
    this.checkPermission(context, 'vendors:update');

    const vendorId = request.params.id;
    const input = request.body as CreateContractInput;

    const contract = await this.config.vendorRegistry.createContract({
      vendorId,
      ...input,
    } as import('./vendor-registry').CreateContractInput, context.userId);

    return { status: 201, body: contract };
  }

  private async updateContract(
    request: ApiRequest,
    context: AuthContext,
  ): Promise<ApiResponse<ContractResponse>> {
    this.checkPermission(context, 'vendors:update');

    const contractId = request.params.contractId;
    const updates = request.body as UpdateContractInput;

    const contract = await this.config.vendorRegistry.updateContract(
      contractId,
      updates as import('./vendor-registry').UpdateContractInput,
      context.userId,
    );

    return { status: 200, body: contract };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private checkPermission(context: AuthContext, permission: string): void {
    if (!this.config.authMiddleware.authorize(context, permission)) {
      throw new ApiAuthorizationError(permission);
    }
  }

  private notFound(resource: string): ApiResponse<ApiError> {
    return {
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: `${resource} not found`,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      },
    };
  }

  private rateLimitExceeded(clientId: string): ApiResponse<ApiError> {
    return {
      status: 429,
      body: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      },
      headers: {
        'Retry-After': '60',
      },
    };
  }

  private handleError(error: unknown): ApiResponse<ApiError> {
    if (error instanceof ApiAuthorizationError) {
      return {
        status: 403,
        body: {
          code: 'FORBIDDEN',
          message: `Missing permission: ${error.permission}`,
          timestamp: new Date(),
          requestId: this.generateRequestId(),
        },
      };
    }

    if (error instanceof Error) {
      const status = (error as ApiErrorWithStatus).status || 500;
      return {
        status,
        body: {
          code: (error as ApiErrorWithCode).code || 'INTERNAL_ERROR',
          message: error.message,
          timestamp: new Date(),
          requestId: this.generateRequestId(),
        },
      };
    }

    return {
      status: 500,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      },
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// Types
// ============================================================================

type RouteHandler = (request: ApiRequest, context: AuthContext) => Promise<ApiResponse>;

interface AssessVendorInput {
  vendorId: string;
}

interface CompareVendorsInput {
  vendorIds: string[];
}

interface MonitoringStartResponse {
  vendorId: string;
  status: string;
  message: string;
}

interface MonitoringStopResponse {
  vendorId: string;
  status: string;
  message: string;
}

interface MonitoringStatusResponse {
  vendorId: string;
  isMonitored: boolean;
  lastCheck: Date | null;
  healthScore: number | null;
  activeAlerts: number;
}

interface TrustScoreComparisonResponse {
  vendors: Array<{ vendorId: string; score: TrustScore }>;
  ranking: string[];
  averageScore: number;
  highestScore: { vendorId: string; score: TrustScore };
  lowestScore: { vendorId: string; score: TrustScore };
  comparisonDate: Date;
}

interface ConcentrationRiskResponse {
  totalVendors: number;
  categoryConcentration: Record<string, number>;
  tierConcentration: Record<string, number>;
  riskConcentration: Record<string, number>;
  topConcentrationRisks: string[];
  analysisDate: Date;
}

interface HealthEventStatsResponse {
  total: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  resolved: number;
  unresolved: number;
  averageResolutionTime: number;
}

interface AlertResolutionInput {
  type: 'resolved' | 'false_positive' | 'accepted_risk';
  reason: string;
  notes?: string;
}

interface AlertStatsResponse {
  total: number;
  open: number;
  acknowledged: number;
  investigating: number;
  resolved: number;
  suppressed: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  averageResolutionTime: number;
  mttr: number;
}

interface BoardSummaryInput {
  vendorIds: string[];
  format?: 'json' | 'pdf' | 'csv' | 'excel';
}

interface ExportReportResponse {
  url: string;
  filename: string;
  size: number;
  format: string;
  expiresAt: Date;
}

interface DeleteResponse {
  success: boolean;
  message: string;
}

type CertificationResponse = unknown;
type ContractResponse = unknown;

interface AddCertificationInput {
  framework: string;
  certificationBody?: string;
  certificateNumber?: string;
  issueDate: Date;
  expirationDate: Date;
  scope: string;
}

interface UpdateCertificationInput {
  certificationBody?: string;
  certificateNumber?: string;
  issueDate?: Date;
  expirationDate?: Date;
  scope?: string;
}

interface CreateContractInput {
  type: string;
  startDate: Date;
  endDate: Date;
  value: {
    amount: number;
    currency: string;
    billingCycle: string;
  };
}

interface UpdateContractInput {
  type?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  value?: {
    amount: number;
    currency: string;
    billingCycle: string;
  };
}

interface ApiErrorWithStatus extends Error {
  status?: number;
}

interface ApiErrorWithCode extends Error {
  code?: string;
}

// ============================================================================
// Error Classes
// ============================================================================

class ApiAuthorizationError extends Error {
  constructor(public readonly permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = 'ApiAuthorizationError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTrustOracleApi(config: TrustOracleApiConfig): TrustOracleApiRouter {
  return new TrustOracleApiRouter(config);
}

// ============================================================================
// OpenAPI Specification Generator
// ============================================================================

export function generateOpenApiSpec(): OpenApiSpec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Trust Oracle API',
      description: 'API for vendor trust scoring and third-party risk management',
      version: '1.0.0',
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Production server',
      },
    ],
    paths: {
      '/trust/vendors/{id}/score': {
        get: {
          summary: 'Get vendor trust score',
          operationId: 'getVendorTrustScore',
          tags: ['Trust Score'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Trust score retrieved successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TrustScore' },
                },
              },
            },
          },
        },
      },
      '/trust/vendors/assess': {
        post: {
          summary: 'Assess vendor risk',
          operationId: 'assessVendorRisk',
          tags: ['Risk Assessment'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    vendorId: { type: 'string' },
                  },
                  required: ['vendorId'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Risk assessment completed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/RiskAssessment' },
                },
              },
            },
          },
        },
      },
      '/trust/vendors/{id}/history': {
        get: {
          summary: 'Get trust score history',
          operationId: 'getTrustScoreHistory',
          tags: ['Trust Score'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 100 },
            },
          ],
          responses: {
            '200': {
              description: 'Trust score history retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/TrustScore' },
                  },
                },
              },
            },
          },
        },
      },
      '/trust/vendors/{id}/monitor': {
        post: {
          summary: 'Start vendor monitoring',
          operationId: 'startVendorMonitoring',
          tags: ['Monitoring'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Monitoring started',
            },
          },
        },
        delete: {
          summary: 'Stop vendor monitoring',
          operationId: 'stopVendorMonitoring',
          tags: ['Monitoring'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Monitoring stopped',
            },
          },
        },
      },
    },
    components: {
      schemas: {
        TrustScore: {
          type: 'object',
          properties: {
            score: { type: 'number', minimum: 0, maximum: 100 },
            grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
            factors: {
              type: 'array',
              items: { $ref: '#/components/schemas/TrustFactor' },
            },
            calculatedAt: { type: 'string', format: 'date-time' },
            validUntil: { type: 'string', format: 'date-time' },
            trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        TrustFactor: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            weight: { type: 'number' },
            score: { type: 'number' },
            findings: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        RiskAssessment: {
          type: 'object',
          properties: {
            vendorId: { type: 'string' },
            assessmentId: { type: 'string' },
            overallRisk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            riskScore: { type: 'number' },
            categories: {
              type: 'array',
              items: { $ref: '#/components/schemas/RiskCategory' },
            },
            recommendations: { type: 'array', items: { type: 'object' } },
            requiredActions: { type: 'array', items: { type: 'object' } },
          },
        },
        RiskCategory: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            risk: { type: 'string' },
            score: { type: 'number' },
            description: { type: 'string' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  };
}

interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  security: Array<Record<string, string[]>>;
}
