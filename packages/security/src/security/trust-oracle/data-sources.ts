/**
 * External Data Integration
 * Integrates with security ratings APIs, breach databases, and threat intelligence feeds
 */

import {
  SecurityRating,
  SecurityRatingFactor,
  SecurityIssue,
  BreachRecord,
  CertificateInfo,
  SanctionEntry,
  ThreatIntelligence,
  ThreatIndicator,
} from './types';

// ============================================================================
// Data Source Configuration
// ============================================================================

export interface DataSourceConfig {
  name: string;
  type: DataSourceType;
  enabled: boolean;
  apiEndpoint: string;
  apiKey?: string;
  rateLimit: RateLimitConfig;
  cacheConfig: CacheConfig;
  retryConfig: RetryConfig;
}

export type DataSourceType =
  | 'security_rating'
  | 'breach_database'
  | 'certificate_transparency'
  | 'sanctions_list'
  | 'threat_feed'
  | 'dark_web'
  | 'dns_intelligence'
  | 'news_aggregator';

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstLimit: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxEntries: number;
}

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
}

// ============================================================================
// Data Source Manager
// ============================================================================

export class DataSourceManager {
  private sources: Map<string, DataSource> = new Map();
  private cache: DataCache;
  private rateLimiter: RateLimiter;

  constructor(
    private readonly config: DataSourceManagerConfig,
  ) {
    this.cache = new DataCache(config.globalCacheConfig);
    this.rateLimiter = new RateLimiter(config.globalRateLimit);
    this.initializeSources();
  }

  private initializeSources(): void {
    // Security Rating Sources
    this.registerSource(new BitSightDataSource(this.config.sources.bitSight));
    this.registerSource(new SecurityScorecardDataSource(this.config.sources.securityScorecard));
    this.registerSource(new RiskReconDataSource(this.config.sources.riskRecon));

    // Breach Databases
    this.registerSource(new HaveIBeenPwnedDataSource(this.config.sources.haveIBeenPwned));
    this.registerSource(new BreachDirectoryDataSource(this.config.sources.breachDirectory));

    // Certificate Transparency
    this.registerSource(new CertTransparencyDataSource(this.config.sources.certTransparency));

    // Sanctions Lists
    this.registerSource(new OFACDataSource(this.config.sources.ofac));
    this.registerSource(new EUSanctionsDataSource(this.config.sources.euSanctions));
    this.registerSource(new UNSanctionsDataSource(this.config.sources.unSanctions));

    // Threat Intelligence
    this.registerSource(new ThreatFeedDataSource(this.config.sources.threatFeed));
    this.registerSource(new DarkWebMonitorDataSource(this.config.sources.darkWebMonitor));
  }

  registerSource(source: DataSource): void {
    this.sources.set(source.name, source);
  }

  async getSecurityRatings(domain: string): Promise<SecurityRating[]> {
    const ratings: SecurityRating[] = [];
    const ratingsSources = this.getSourcesByType('security_rating');

    const results = await Promise.allSettled(
      ratingsSources.map(source => this.fetchWithCache(
        source,
        `rating:${domain}`,
        () => (source as SecurityRatingSource).getSecurityRating(domain),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        ratings.push(result.value);
      }
    }

    return ratings;
  }

  async getBreachRecords(domain: string): Promise<BreachRecord[]> {
    const records: BreachRecord[] = [];
    const breachSources = this.getSourcesByType('breach_database');

    const results = await Promise.allSettled(
      breachSources.map(source => this.fetchWithCache(
        source,
        `breach:${domain}`,
        () => (source as BreachDatabaseSource).getBreaches(domain),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        records.push(...result.value);
      }
    }

    // Deduplicate by breach ID
    const uniqueRecords = new Map<string, BreachRecord>();
    for (const record of records) {
      if (!uniqueRecords.has(record.id)) {
        uniqueRecords.set(record.id, record);
      }
    }

    return Array.from(uniqueRecords.values());
  }

  async getCertificateInfo(domain: string): Promise<CertificateInfo[]> {
    const certSources = this.getSourcesByType('certificate_transparency');
    const certificates: CertificateInfo[] = [];

    const results = await Promise.allSettled(
      certSources.map(source => this.fetchWithCache(
        source,
        `cert:${domain}`,
        () => (source as CertTransparencySource).getCertificates(domain),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        certificates.push(...result.value);
      }
    }

    return certificates;
  }

  async checkSanctions(entityName: string, entityType: string): Promise<SanctionEntry[]> {
    const sanctionsSources = this.getSourcesByType('sanctions_list');
    const entries: SanctionEntry[] = [];

    const results = await Promise.allSettled(
      sanctionsSources.map(source => this.fetchWithCache(
        source,
        `sanctions:${entityName}:${entityType}`,
        () => (source as SanctionsListSource).checkEntity(entityName, entityType),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        entries.push(...result.value);
      }
    }

    return entries;
  }

  async getThreatIntelligence(domain: string): Promise<ThreatIntelligence[]> {
    const threatSources = this.getSourcesByType('threat_feed');
    const intelligence: ThreatIntelligence[] = [];

    const results = await Promise.allSettled(
      threatSources.map(source => this.fetchWithCache(
        source,
        `threat:${domain}`,
        () => (source as ThreatFeedSource).getIndicators(domain),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        intelligence.push(result.value);
      }
    }

    return intelligence;
  }

  async scanDarkWeb(domain: string): Promise<DarkWebMention[]> {
    const darkWebSources = this.getSourcesByType('dark_web');
    const mentions: DarkWebMention[] = [];

    const results = await Promise.allSettled(
      darkWebSources.map(source => this.fetchWithCache(
        source,
        `darkweb:${domain}`,
        () => (source as DarkWebSource).scanForMentions(domain),
      )),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        mentions.push(...result.value);
      }
    }

    return mentions;
  }

  private getSourcesByType(type: DataSourceType): DataSource[] {
    return Array.from(this.sources.values())
      .filter(source => source.type === type && source.isEnabled());
  }

  private async fetchWithCache<T>(
    source: DataSource,
    cacheKey: string,
    fetcher: () => Promise<T>,
  ): Promise<T | null> {
    const fullCacheKey = `${source.name}:${cacheKey}`;

    // Check cache
    const cached = this.cache.get<T>(fullCacheKey);
    if (cached !== null) {
      return cached;
    }

    // Rate limit check
    await this.rateLimiter.acquire(source.name);

    try {
      const result = await fetcher();
      this.cache.set(fullCacheKey, result, source.getCacheTTL());
      return result;
    } catch (error) {
      console.error(`Error fetching from ${source.name}:`, error);
      return null;
    }
  }

  getSourceStatus(): DataSourceStatus[] {
    return Array.from(this.sources.values()).map(source => ({
      name: source.name,
      type: source.type,
      enabled: source.isEnabled(),
      healthy: source.isHealthy(),
      lastCheck: source.getLastHealthCheck(),
      errorCount: source.getErrorCount(),
    }));
  }
}

export interface DataSourceManagerConfig {
  globalCacheConfig: CacheConfig;
  globalRateLimit: RateLimitConfig;
  sources: Record<string, DataSourceConfig>;
}

export interface DataSourceStatus {
  name: string;
  type: DataSourceType;
  enabled: boolean;
  healthy: boolean;
  lastCheck: Date;
  errorCount: number;
}

// ============================================================================
// Base Data Source
// ============================================================================

export abstract class DataSource {
  protected config: DataSourceConfig;
  protected lastHealthCheck: Date = new Date();
  protected healthy: boolean = true;
  protected errorCount: number = 0;

  constructor(
    public readonly name: string,
    public readonly type: DataSourceType,
    config: DataSourceConfig,
  ) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  getLastHealthCheck(): Date {
    return this.lastHealthCheck;
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getCacheTTL(): number {
    return this.config.cacheConfig.ttlSeconds;
  }

  protected async makeRequest<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.config.apiEndpoint}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      this.errorCount++;
      throw new DataSourceError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    this.errorCount = 0;
    this.healthy = true;
    this.lastHealthCheck = new Date();

    return response.json() as Promise<T>;
  }

  abstract healthCheck(): Promise<boolean>;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export class DataSourceError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(`[${source}] ${message}`);
    this.name = 'DataSourceError';
  }
}

// ============================================================================
// Security Rating Sources
// ============================================================================

interface SecurityRatingSource extends DataSource {
  getSecurityRating(domain: string): Promise<SecurityRating>;
}

class BitSightDataSource extends DataSource implements SecurityRatingSource {
  constructor(config: DataSourceConfig) {
    super('BitSight', 'security_rating', config);
  }

  async getSecurityRating(domain: string): Promise<SecurityRating> {
    const data = await this.makeRequest<BitSightResponse>(`/ratings/v1/companies?domain=${domain}`);

    return {
      source: this.name,
      vendorId: data.guid,
      domain,
      rating: data.rating,
      grade: this.mapRatingToGrade(data.rating),
      factors: this.mapFactors(data.rating_details),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + this.getCacheTTL() * 1000),
    };
  }

  private mapRatingToGrade(rating: number): string {
    if (rating >= 740) return 'A';
    if (rating >= 640) return 'B';
    if (rating >= 540) return 'C';
    if (rating >= 440) return 'D';
    return 'F';
  }

  private mapFactors(details: BitSightRatingDetail[]): SecurityRatingFactor[] {
    return details.map(detail => ({
      name: detail.name,
      score: detail.rating,
      weight: detail.weight,
      issues: detail.findings.map(f => ({
        id: f.id,
        severity: this.mapSeverity(f.severity),
        category: detail.name,
        title: f.title,
        description: f.description,
        firstSeen: new Date(f.first_seen),
        lastSeen: new Date(f.last_seen),
        resolved: f.resolved,
      })),
    }));
  }

  private mapSeverity(severity: string): SecurityIssue['severity'] {
    const mapping: Record<string, SecurityIssue['severity']> = {
      'critical': 'critical',
      'severe': 'high',
      'moderate': 'medium',
      'minor': 'low',
      'informational': 'info',
    };
    return mapping[severity.toLowerCase()] || 'info';
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface BitSightResponse {
  guid: string;
  rating: number;
  rating_details: BitSightRatingDetail[];
}

interface BitSightRatingDetail {
  name: string;
  rating: number;
  weight: number;
  findings: BitSightFinding[];
}

interface BitSightFinding {
  id: string;
  severity: string;
  title: string;
  description: string;
  first_seen: string;
  last_seen: string;
  resolved: boolean;
}

class SecurityScorecardDataSource extends DataSource implements SecurityRatingSource {
  constructor(config: DataSourceConfig) {
    super('SecurityScorecard', 'security_rating', config);
  }

  async getSecurityRating(domain: string): Promise<SecurityRating> {
    const data = await this.makeRequest<SecurityScorecardResponse>(`/companies/${domain}`);

    return {
      source: this.name,
      vendorId: data.id,
      domain,
      rating: data.score,
      grade: data.grade,
      factors: data.factors.map(f => ({
        name: f.name,
        score: f.score,
        weight: f.weight || 1,
        issues: f.issue_summary.map(issue => ({
          id: issue.type,
          severity: issue.severity as SecurityIssue['severity'],
          category: f.name,
          title: issue.type,
          description: `${issue.count} issues found`,
          firstSeen: new Date(),
          lastSeen: new Date(),
          resolved: false,
        })),
      })),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + this.getCacheTTL() * 1000),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface SecurityScorecardResponse {
  id: string;
  score: number;
  grade: string;
  factors: SecurityScorecardFactor[];
}

interface SecurityScorecardFactor {
  name: string;
  score: number;
  weight?: number;
  issue_summary: SecurityScorecardIssue[];
}

interface SecurityScorecardIssue {
  type: string;
  severity: string;
  count: number;
}

class RiskReconDataSource extends DataSource implements SecurityRatingSource {
  constructor(config: DataSourceConfig) {
    super('RiskRecon', 'security_rating', config);
  }

  async getSecurityRating(domain: string): Promise<SecurityRating> {
    const data = await this.makeRequest<RiskReconResponse>(`/api/v1/entities?domain=${domain}`);

    const entity = data.entities[0];
    if (!entity) {
      throw new DataSourceError(this.name, `No entity found for domain: ${domain}`);
    }

    return {
      source: this.name,
      vendorId: entity.id,
      domain,
      rating: entity.rating * 10, // RiskRecon uses 0-10 scale
      grade: this.mapRatingToGrade(entity.rating),
      factors: entity.domains.map(d => ({
        name: d.name,
        score: d.rating * 10,
        weight: 1,
        issues: d.findings.map(f => ({
          id: f.id,
          severity: f.severity as SecurityIssue['severity'],
          category: d.name,
          title: f.name,
          description: f.description,
          firstSeen: new Date(f.discovered),
          lastSeen: new Date(f.last_observed),
          resolved: f.status === 'resolved',
        })),
      })),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + this.getCacheTTL() * 1000),
    };
  }

  private mapRatingToGrade(rating: number): string {
    if (rating >= 8) return 'A';
    if (rating >= 6) return 'B';
    if (rating >= 4) return 'C';
    if (rating >= 2) return 'D';
    return 'F';
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface RiskReconResponse {
  entities: RiskReconEntity[];
}

interface RiskReconEntity {
  id: string;
  rating: number;
  domains: RiskReconDomain[];
}

interface RiskReconDomain {
  name: string;
  rating: number;
  findings: RiskReconFinding[];
}

interface RiskReconFinding {
  id: string;
  name: string;
  description: string;
  severity: string;
  discovered: string;
  last_observed: string;
  status: string;
}

// ============================================================================
// Breach Database Sources
// ============================================================================

interface BreachDatabaseSource extends DataSource {
  getBreaches(domain: string): Promise<BreachRecord[]>;
}

class HaveIBeenPwnedDataSource extends DataSource implements BreachDatabaseSource {
  constructor(config: DataSourceConfig) {
    super('HaveIBeenPwned', 'breach_database', config);
  }

  async getBreaches(domain: string): Promise<BreachRecord[]> {
    const data = await this.makeRequest<HIBPBreach[]>(`/api/v3/breaches?domain=${domain}`);

    return data.map(breach => ({
      id: `hibp:${breach.Name}`,
      vendorDomain: domain,
      breachDate: new Date(breach.BreachDate),
      disclosureDate: new Date(breach.AddedDate),
      source: this.name,
      recordsAffected: breach.PwnCount,
      dataTypes: breach.DataClasses,
      description: breach.Description,
      verified: breach.IsVerified,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/api/v3/breaches');
      return true;
    } catch {
      return false;
    }
  }
}

interface HIBPBreach {
  Name: string;
  BreachDate: string;
  AddedDate: string;
  PwnCount: number;
  DataClasses: string[];
  Description: string;
  IsVerified: boolean;
}

class BreachDirectoryDataSource extends DataSource implements BreachDatabaseSource {
  constructor(config: DataSourceConfig) {
    super('BreachDirectory', 'breach_database', config);
  }

  async getBreaches(domain: string): Promise<BreachRecord[]> {
    const data = await this.makeRequest<BreachDirectoryResponse>(`/api/search?domain=${domain}`);

    return data.results.map(breach => ({
      id: `bd:${breach.id}`,
      vendorDomain: domain,
      breachDate: new Date(breach.date),
      disclosureDate: new Date(breach.added),
      source: this.name,
      recordsAffected: breach.records,
      dataTypes: breach.data_types,
      description: breach.description,
      verified: breach.verified,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface BreachDirectoryResponse {
  results: BreachDirectoryEntry[];
}

interface BreachDirectoryEntry {
  id: string;
  date: string;
  added: string;
  records: number;
  data_types: string[];
  description: string;
  verified: boolean;
}

// ============================================================================
// Certificate Transparency Sources
// ============================================================================

interface CertTransparencySource extends DataSource {
  getCertificates(domain: string): Promise<CertificateInfo[]>;
}

class CertTransparencyDataSource extends DataSource implements CertTransparencySource {
  constructor(config: DataSourceConfig) {
    super('CertTransparency', 'certificate_transparency', config);
  }

  async getCertificates(domain: string): Promise<CertificateInfo[]> {
    // Query Certificate Transparency logs
    const data = await this.makeRequest<CTLogResponse>(`/api/v1/search?domain=${domain}`);

    return data.certificates.map(cert => {
      const validTo = new Date(cert.not_after);
      const now = new Date();
      const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return {
        domain: cert.common_name,
        issuer: cert.issuer_name,
        subject: cert.subject_name,
        validFrom: new Date(cert.not_before),
        validTo,
        daysUntilExpiry,
        algorithm: cert.signature_algorithm,
        keySize: cert.key_size,
        serialNumber: cert.serial_number,
        fingerprint: cert.fingerprint,
        ctLogged: true,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface CTLogResponse {
  certificates: CTCertificate[];
}

interface CTCertificate {
  common_name: string;
  issuer_name: string;
  subject_name: string;
  not_before: string;
  not_after: string;
  signature_algorithm: string;
  key_size: number;
  serial_number: string;
  fingerprint: string;
}

// ============================================================================
// Sanctions List Sources
// ============================================================================

interface SanctionsListSource extends DataSource {
  checkEntity(entityName: string, entityType: string): Promise<SanctionEntry[]>;
}

class OFACDataSource extends DataSource implements SanctionsListSource {
  constructor(config: DataSourceConfig) {
    super('OFAC', 'sanctions_list', config);
  }

  async checkEntity(entityName: string, entityType: string): Promise<SanctionEntry[]> {
    const data = await this.makeRequest<OFACResponse>(
      `/api/v1/search?name=${encodeURIComponent(entityName)}&type=${entityType}`,
    );

    return data.matches.map(match => ({
      source: this.name,
      entityName: match.name,
      matchScore: match.score,
      listType: match.program,
      addedDate: new Date(match.add_date),
      reason: match.reason,
      aliases: match.aliases || [],
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface OFACResponse {
  matches: OFACMatch[];
}

interface OFACMatch {
  name: string;
  score: number;
  program: string;
  add_date: string;
  reason?: string;
  aliases?: string[];
}

class EUSanctionsDataSource extends DataSource implements SanctionsListSource {
  constructor(config: DataSourceConfig) {
    super('EU_Sanctions', 'sanctions_list', config);
  }

  async checkEntity(entityName: string, entityType: string): Promise<SanctionEntry[]> {
    const data = await this.makeRequest<EUSanctionsResponse>(
      `/api/search?q=${encodeURIComponent(entityName)}&entity_type=${entityType}`,
    );

    return data.entities.map(entity => ({
      source: this.name,
      entityName: entity.name,
      matchScore: entity.confidence,
      listType: entity.regime,
      addedDate: new Date(entity.listed_on),
      reason: entity.grounds,
      aliases: entity.name_aliases || [],
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface EUSanctionsResponse {
  entities: EUSanctionEntity[];
}

interface EUSanctionEntity {
  name: string;
  confidence: number;
  regime: string;
  listed_on: string;
  grounds?: string;
  name_aliases?: string[];
}

class UNSanctionsDataSource extends DataSource implements SanctionsListSource {
  constructor(config: DataSourceConfig) {
    super('UN_Sanctions', 'sanctions_list', config);
  }

  async checkEntity(entityName: string, entityType: string): Promise<SanctionEntry[]> {
    const data = await this.makeRequest<UNSanctionsResponse>(
      `/api/v1/consolidated?name=${encodeURIComponent(entityName)}&type=${entityType}`,
    );

    return data.individuals.concat(data.entities as UNSanctionRecord[]).map(record => ({
      source: this.name,
      entityName: record.name,
      matchScore: record.match_score,
      listType: record.un_list,
      addedDate: new Date(record.listed_on),
      reason: record.narrative,
      aliases: record.aliases || [],
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface UNSanctionsResponse {
  individuals: UNSanctionRecord[];
  entities: UNSanctionRecord[];
}

interface UNSanctionRecord {
  name: string;
  match_score: number;
  un_list: string;
  listed_on: string;
  narrative?: string;
  aliases?: string[];
}

// ============================================================================
// Threat Intelligence Sources
// ============================================================================

interface ThreatFeedSource extends DataSource {
  getIndicators(domain: string): Promise<ThreatIntelligence>;
}

class ThreatFeedDataSource extends DataSource implements ThreatFeedSource {
  constructor(config: DataSourceConfig) {
    super('ThreatFeed', 'threat_feed', config);
  }

  async getIndicators(domain: string): Promise<ThreatIntelligence> {
    const data = await this.makeRequest<ThreatFeedResponse>(
      `/api/v2/indicators?domain=${domain}`,
    );

    return {
      source: this.name,
      vendorDomain: domain,
      indicators: data.indicators.map(ind => ({
        type: ind.type as ThreatIndicator['type'],
        value: ind.value,
        confidence: ind.confidence,
        severity: ind.severity,
        description: ind.description,
        firstSeen: new Date(ind.first_seen),
        lastSeen: new Date(ind.last_seen),
      })),
      fetchedAt: new Date(),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface ThreatFeedResponse {
  indicators: ThreatFeedIndicator[];
}

interface ThreatFeedIndicator {
  type: string;
  value: string;
  confidence: number;
  severity: string;
  description: string;
  first_seen: string;
  last_seen: string;
}

// ============================================================================
// Dark Web Sources
// ============================================================================

export interface DarkWebMention {
  id: string;
  source: string;
  domain: string;
  mentionType: 'credential_dump' | 'data_sale' | 'discussion' | 'exploit';
  content: string;
  discoveredAt: Date;
  confidence: number;
  url?: string;
}

interface DarkWebSource extends DataSource {
  scanForMentions(domain: string): Promise<DarkWebMention[]>;
}

class DarkWebMonitorDataSource extends DataSource implements DarkWebSource {
  constructor(config: DataSourceConfig) {
    super('DarkWebMonitor', 'dark_web', config);
  }

  async scanForMentions(domain: string): Promise<DarkWebMention[]> {
    const data = await this.makeRequest<DarkWebResponse>(
      `/api/v1/search?query=${encodeURIComponent(domain)}`,
    );

    return data.mentions.map(mention => ({
      id: mention.id,
      source: this.name,
      domain,
      mentionType: mention.type as DarkWebMention['mentionType'],
      content: mention.snippet,
      discoveredAt: new Date(mention.discovered_at),
      confidence: mention.confidence,
      url: mention.source_url,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch {
      return false;
    }
  }
}

interface DarkWebResponse {
  mentions: DarkWebMentionRecord[];
}

interface DarkWebMentionRecord {
  id: string;
  type: string;
  snippet: string;
  discovered_at: string;
  confidence: number;
  source_url?: string;
}

// ============================================================================
// Cache & Rate Limiting
// ============================================================================

class DataCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  constructor(private readonly config: CacheConfig) {}

  get<T>(key: string): T | null {
    if (!this.config.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds?: number): void {
    if (!this.config.enabled) return;

    // Enforce max entries
    if (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const ttl = ttlSeconds || this.config.ttlSeconds;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(private readonly config: RateLimitConfig) {}

  async acquire(sourceId: string): Promise<void> {
    const now = Date.now();
    const requests = this.requests.get(sourceId) || [];

    // Clean old requests
    const oneMinuteAgo = now - 60000;
    const recentRequests = requests.filter(time => time > oneMinuteAgo);

    // Check rate limit
    if (recentRequests.length >= this.config.requestsPerMinute) {
      const waitTime = recentRequests[0] + 60000 - now;
      await this.sleep(waitTime);
    }

    recentRequests.push(now);
    this.requests.set(sourceId, recentRequests);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createDataSourceManager(config: DataSourceManagerConfig): DataSourceManager {
  return new DataSourceManager(config);
}

export function getDefaultDataSourceConfig(): DataSourceManagerConfig {
  return {
    globalCacheConfig: {
      enabled: true,
      ttlSeconds: 3600, // 1 hour
      maxEntries: 10000,
    },
    globalRateLimit: {
      requestsPerMinute: 60,
      requestsPerDay: 10000,
      burstLimit: 10,
    },
    sources: {
      bitSight: {
        name: 'BitSight',
        type: 'security_rating',
        enabled: true,
        apiEndpoint: process.env.BITSIGHT_API_URL || 'https://api.bitsighttech.com',
        apiKey: process.env.BITSIGHT_API_KEY,
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, burstLimit: 5 },
        cacheConfig: { enabled: true, ttlSeconds: 3600, maxEntries: 1000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      securityScorecard: {
        name: 'SecurityScorecard',
        type: 'security_rating',
        enabled: true,
        apiEndpoint: process.env.SECURITYSCORECARD_API_URL || 'https://api.securityscorecard.io',
        apiKey: process.env.SECURITYSCORECARD_API_KEY,
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, burstLimit: 5 },
        cacheConfig: { enabled: true, ttlSeconds: 3600, maxEntries: 1000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      riskRecon: {
        name: 'RiskRecon',
        type: 'security_rating',
        enabled: false,
        apiEndpoint: process.env.RISKRECON_API_URL || 'https://api.riskrecon.com',
        apiKey: process.env.RISKRECON_API_KEY,
        rateLimit: { requestsPerMinute: 20, requestsPerDay: 2000, burstLimit: 3 },
        cacheConfig: { enabled: true, ttlSeconds: 3600, maxEntries: 1000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      haveIBeenPwned: {
        name: 'HaveIBeenPwned',
        type: 'breach_database',
        enabled: true,
        apiEndpoint: 'https://haveibeenpwned.com',
        apiKey: process.env.HIBP_API_KEY,
        rateLimit: { requestsPerMinute: 10, requestsPerDay: 1000, burstLimit: 2 },
        cacheConfig: { enabled: true, ttlSeconds: 86400, maxEntries: 5000 },
        retryConfig: { maxRetries: 3, backoffMs: 1500, backoffMultiplier: 2 },
      },
      breachDirectory: {
        name: 'BreachDirectory',
        type: 'breach_database',
        enabled: false,
        apiEndpoint: process.env.BREACH_DIRECTORY_API_URL || 'https://api.breachdirectory.com',
        apiKey: process.env.BREACH_DIRECTORY_API_KEY,
        rateLimit: { requestsPerMinute: 20, requestsPerDay: 2000, burstLimit: 5 },
        cacheConfig: { enabled: true, ttlSeconds: 86400, maxEntries: 5000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      certTransparency: {
        name: 'CertTransparency',
        type: 'certificate_transparency',
        enabled: true,
        apiEndpoint: process.env.CT_API_URL || 'https://crt.sh',
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, burstLimit: 10 },
        cacheConfig: { enabled: true, ttlSeconds: 3600, maxEntries: 2000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      ofac: {
        name: 'OFAC',
        type: 'sanctions_list',
        enabled: true,
        apiEndpoint: process.env.OFAC_API_URL || 'https://sanctionslist.ofac.treas.gov',
        rateLimit: { requestsPerMinute: 60, requestsPerDay: 10000, burstLimit: 20 },
        cacheConfig: { enabled: true, ttlSeconds: 86400, maxEntries: 10000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      euSanctions: {
        name: 'EU_Sanctions',
        type: 'sanctions_list',
        enabled: true,
        apiEndpoint: process.env.EU_SANCTIONS_API_URL || 'https://webgate.ec.europa.eu/fsd/fsf',
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, burstLimit: 10 },
        cacheConfig: { enabled: true, ttlSeconds: 86400, maxEntries: 10000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      unSanctions: {
        name: 'UN_Sanctions',
        type: 'sanctions_list',
        enabled: true,
        apiEndpoint: process.env.UN_SANCTIONS_API_URL || 'https://scsanctions.un.org/api',
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, burstLimit: 10 },
        cacheConfig: { enabled: true, ttlSeconds: 86400, maxEntries: 10000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      threatFeed: {
        name: 'ThreatFeed',
        type: 'threat_feed',
        enabled: true,
        apiEndpoint: process.env.THREAT_FEED_API_URL || 'https://api.threatfeed.example.com',
        apiKey: process.env.THREAT_FEED_API_KEY,
        rateLimit: { requestsPerMinute: 60, requestsPerDay: 10000, burstLimit: 20 },
        cacheConfig: { enabled: true, ttlSeconds: 1800, maxEntries: 5000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
      darkWebMonitor: {
        name: 'DarkWebMonitor',
        type: 'dark_web',
        enabled: true,
        apiEndpoint: process.env.DARK_WEB_API_URL || 'https://api.darkwebmonitor.example.com',
        apiKey: process.env.DARK_WEB_API_KEY,
        rateLimit: { requestsPerMinute: 20, requestsPerDay: 2000, burstLimit: 5 },
        cacheConfig: { enabled: true, ttlSeconds: 3600, maxEntries: 2000 },
        retryConfig: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      },
    },
  };
}
