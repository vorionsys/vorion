/**
 * SIEM Event Enrichment
 *
 * Provides event enrichment capabilities:
 * - Geo-location data from IP addresses
 * - Threat intelligence context
 * - User context (role, tenant)
 * - Field name normalization
 *
 * @packageDocumentation
 * @module security/siem/enrichment
 */

import { createLogger } from '../../common/logger.js';
import type {
  SecurityEvent,
  EnrichmentConfig,
  GeoLocation,
  ThreatContext,
  UserContext,
  GeoEnrichmentConfig,
  ThreatEnrichmentConfig,
  UserEnrichmentConfig,
} from './types.js';

const logger = createLogger({ component: 'siem-enrichment' });

// =============================================================================
// Types
// =============================================================================

/**
 * Enrichment result
 */
export interface EnrichmentResult {
  /** Enriched event */
  event: SecurityEvent;
  /** Fields that were enriched */
  enrichedFields: string[];
  /** Errors during enrichment */
  errors: Array<{ field: string; error: string }>;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// =============================================================================
// Geo Enrichment Provider
// =============================================================================

/**
 * Provider interface for geo enrichment
 */
export interface GeoEnrichmentProvider {
  /** Lookup geo data for an IP address */
  lookup(ip: string): Promise<GeoLocation | null>;
}

/**
 * Default geo enrichment provider using external service
 */
export class DefaultGeoProvider implements GeoEnrichmentProvider {
  private readonly serviceUrl?: string;
  private readonly cache = new Map<string, CacheEntry<GeoLocation | null>>();
  private readonly cacheTtlMs: number;

  constructor(config: GeoEnrichmentConfig) {
    this.serviceUrl = config.serviceUrl;
    this.cacheTtlMs = (config.cacheTtlSeconds ?? 3600) * 1000;
  }

  async lookup(ip: string): Promise<GeoLocation | null> {
    // Check cache
    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Skip private IPs
    if (this.isPrivateIp(ip)) {
      return null;
    }

    try {
      if (!this.serviceUrl) {
        return null;
      }

      const response = await fetch(`${this.serviceUrl}/${ip}`);
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      const geo: GeoLocation = {
        country: data.country as string | undefined,
        countryCode: data.country_code as string | undefined,
        city: data.city as string | undefined,
        region: data.region as string | undefined,
        latitude: data.latitude as number | undefined,
        longitude: data.longitude as number | undefined,
        timezone: data.timezone as string | undefined,
      };

      // Cache result
      this.cache.set(ip, {
        value: geo,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return geo;
    } catch (error) {
      logger.warn({ ip, error: (error as Error).message }, 'Geo lookup failed');
      return null;
    }
  }

  private isPrivateIp(ip: string): boolean {
    // Check for private IP ranges
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return false;
    }

    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);

    // 10.0.0.0/8
    if (first === 10) {
      return true;
    }

    // 172.16.0.0/12
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }

    // 192.168.0.0/16
    if (first === 192 && second === 168) {
      return true;
    }

    // 127.0.0.0/8 (localhost)
    if (first === 127) {
      return true;
    }

    return false;
  }
}

// =============================================================================
// Threat Enrichment Provider
// =============================================================================

/**
 * Provider interface for threat intelligence enrichment
 */
export interface ThreatEnrichmentProvider {
  /** Lookup threat data for an indicator */
  lookup(indicator: string, type: string): Promise<ThreatContext | null>;
}

/**
 * Default threat intelligence provider
 */
export class DefaultThreatProvider implements ThreatEnrichmentProvider {
  private readonly serviceUrl?: string;
  private readonly apiKey?: string;
  private readonly cache = new Map<string, CacheEntry<ThreatContext | null>>();
  private readonly cacheTtlMs: number;

  constructor(config: ThreatEnrichmentConfig) {
    this.serviceUrl = config.serviceUrl;
    this.apiKey = config.apiKey;
    this.cacheTtlMs = (config.cacheTtlSeconds ?? 3600) * 1000;
  }

  async lookup(indicator: string, type: string): Promise<ThreatContext | null> {
    const cacheKey = `${type}:${indicator}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      if (!this.serviceUrl) {
        return null;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(
        `${this.serviceUrl}/lookup?type=${type}&value=${encodeURIComponent(indicator)}`,
        { headers }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      if (!data.found) {
        // Cache negative result
        this.cache.set(cacheKey, {
          value: null,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
        return null;
      }

      const threat: ThreatContext = {
        indicator,
        threatType: data.threat_type as string | undefined,
        confidence: data.confidence as number | undefined,
        source: data.source as string | undefined,
        firstSeen: data.first_seen ? new Date(data.first_seen as string) : undefined,
        lastSeen: data.last_seen ? new Date(data.last_seen as string) : undefined,
        malwareFamilies: data.malware_families as string[] | undefined,
        threatActors: data.threat_actors as string[] | undefined,
        mitreAttack: data.mitre_attack as string[] | undefined,
      };

      // Cache result
      this.cache.set(cacheKey, {
        value: threat,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return threat;
    } catch (error) {
      logger.warn(
        { indicator, type, error: (error as Error).message },
        'Threat lookup failed'
      );
      return null;
    }
  }
}

// =============================================================================
// User Enrichment Provider
// =============================================================================

/**
 * Provider interface for user context enrichment
 */
export interface UserEnrichmentProvider {
  /** Lookup user data by user ID */
  lookup(userId: string): Promise<UserContext | null>;
}

/**
 * Default user enrichment provider
 */
export class DefaultUserProvider implements UserEnrichmentProvider {
  private readonly serviceUrl?: string;
  private readonly includeRoles: boolean;
  private readonly includeGroups: boolean;
  private readonly includeTenant: boolean;
  private readonly cache = new Map<string, CacheEntry<UserContext | null>>();
  private readonly cacheTtlMs: number;

  constructor(config: UserEnrichmentConfig) {
    this.serviceUrl = config.serviceUrl;
    this.includeRoles = config.includeRoles ?? true;
    this.includeGroups = config.includeGroups ?? true;
    this.includeTenant = config.includeTenant ?? true;
    this.cacheTtlMs = (config.cacheTtlSeconds ?? 300) * 1000;
  }

  async lookup(userId: string): Promise<UserContext | null> {
    // Check cache
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      if (!this.serviceUrl) {
        return null;
      }

      const params = new URLSearchParams();
      if (this.includeRoles) params.set('includeRoles', 'true');
      if (this.includeGroups) params.set('includeGroups', 'true');
      if (this.includeTenant) params.set('includeTenant', 'true');

      const response = await fetch(
        `${this.serviceUrl}/users/${userId}?${params.toString()}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      const user: UserContext = {
        userId: data.id as string | undefined,
        username: data.username as string | undefined,
        email: data.email as string | undefined,
        roles: data.roles as string[] | undefined,
        groups: data.groups as string[] | undefined,
        tenantId: data.tenant_id as string | undefined,
        tenantName: data.tenant_name as string | undefined,
        department: data.department as string | undefined,
        privileged: data.privileged as boolean | undefined,
      };

      // Cache result
      this.cache.set(userId, {
        value: user,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return user;
    } catch (error) {
      logger.warn({ userId, error: (error as Error).message }, 'User lookup failed');
      return null;
    }
  }
}

// =============================================================================
// Event Enricher
// =============================================================================

/**
 * Event enricher that combines multiple enrichment sources
 */
export class EventEnricher {
  private readonly config: EnrichmentConfig;
  private readonly geoProvider?: GeoEnrichmentProvider;
  private readonly threatProvider?: ThreatEnrichmentProvider;
  private readonly userProvider?: UserEnrichmentProvider;
  private readonly fieldNormalization: Record<string, string>;

  constructor(
    config: EnrichmentConfig,
    options?: {
      geoProvider?: GeoEnrichmentProvider;
      threatProvider?: ThreatEnrichmentProvider;
      userProvider?: UserEnrichmentProvider;
    }
  ) {
    this.config = config;
    this.fieldNormalization = config.fieldNormalization ?? {};

    // Initialize providers
    if (config.geo?.enabled) {
      this.geoProvider = options?.geoProvider ?? new DefaultGeoProvider(config.geo);
    }

    if (config.threat?.enabled) {
      this.threatProvider =
        options?.threatProvider ?? new DefaultThreatProvider(config.threat);
    }

    if (config.user?.enabled) {
      this.userProvider = options?.userProvider ?? new DefaultUserProvider(config.user);
    }
  }

  /**
   * Enrich a security event
   */
  async enrich(event: SecurityEvent): Promise<EnrichmentResult> {
    const startTime = Date.now();
    const enrichedFields: string[] = [];
    const errors: Array<{ field: string; error: string }> = [];
    let enrichedEvent = { ...event };

    // Geo enrichment
    if (this.geoProvider && !event.geo) {
      const ipFields = this.config.geo?.ipFields ?? ['sourceIp', 'destinationIp'];

      for (const field of ipFields) {
        const ip = this.getFieldValue(event, field);
        if (ip && typeof ip === 'string') {
          try {
            const geo = await this.geoProvider.lookup(ip);
            if (geo) {
              enrichedEvent = { ...enrichedEvent, geo };
              enrichedFields.push('geo');
              break; // Use first successful lookup
            }
          } catch (error) {
            errors.push({
              field: 'geo',
              error: (error as Error).message,
            });
          }
        }
      }
    }

    // Threat enrichment
    if (this.threatProvider && !event.threat) {
      const indicatorFields = this.config.threat?.indicatorFields ?? [
        'sourceIp',
        'destinationIp',
        'fileHash',
      ];

      for (const field of indicatorFields) {
        const indicator = this.getFieldValue(event, field);
        if (indicator && typeof indicator === 'string') {
          try {
            const indicatorType = this.getIndicatorType(field);
            const threat = await this.threatProvider.lookup(indicator, indicatorType);
            if (threat) {
              enrichedEvent = { ...enrichedEvent, threat };
              enrichedFields.push('threat');
              break; // Use first successful lookup
            }
          } catch (error) {
            errors.push({
              field: 'threat',
              error: (error as Error).message,
            });
          }
        }
      }
    }

    // User enrichment
    if (this.userProvider && event.user?.userId) {
      try {
        const userContext = await this.userProvider.lookup(event.user.userId);
        if (userContext) {
          enrichedEvent = {
            ...enrichedEvent,
            user: {
              ...enrichedEvent.user,
              ...userContext,
            },
          };
          enrichedFields.push('user');
        }
      } catch (error) {
        errors.push({
          field: 'user',
          error: (error as Error).message,
        });
      }
    }

    // Field normalization
    if (Object.keys(this.fieldNormalization).length > 0) {
      enrichedEvent = this.normalizeFields(enrichedEvent);
      if (enrichedEvent !== event) {
        enrichedFields.push('fields');
      }
    }

    return {
      event: enrichedEvent,
      enrichedFields,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Enrich multiple events
   */
  async enrichBatch(events: SecurityEvent[]): Promise<EnrichmentResult[]> {
    // Process in parallel with concurrency limit
    const results: EnrichmentResult[] = [];
    const concurrency = 10;

    for (let i = 0; i < events.length; i += concurrency) {
      const batch = events.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((event) => this.enrich(event))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get a field value from an event
   */
  private getFieldValue(event: SecurityEvent, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = event;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  /**
   * Get indicator type based on field name
   */
  private getIndicatorType(field: string): string {
    if (field.toLowerCase().includes('ip')) {
      return 'ip';
    }
    if (field.toLowerCase().includes('hash')) {
      return 'hash';
    }
    if (field.toLowerCase().includes('domain') || field.toLowerCase().includes('host')) {
      return 'domain';
    }
    if (field.toLowerCase().includes('url')) {
      return 'url';
    }
    if (field.toLowerCase().includes('email')) {
      return 'email';
    }
    return 'unknown';
  }

  /**
   * Normalize field names
   */
  private normalizeFields(event: SecurityEvent): SecurityEvent {
    if (!event.customFields) {
      return event;
    }

    const normalizedCustomFields: Record<string, unknown> = {};
    let changed = false;

    for (const [key, value] of Object.entries(event.customFields)) {
      const normalizedKey = this.fieldNormalization[key] ?? key;
      if (normalizedKey !== key) {
        changed = true;
      }
      normalizedCustomFields[normalizedKey] = value;
    }

    if (!changed) {
      return event;
    }

    return {
      ...event,
      customFields: normalizedCustomFields,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an event enricher
 */
export function createEventEnricher(
  config: EnrichmentConfig,
  options?: {
    geoProvider?: GeoEnrichmentProvider;
    threatProvider?: ThreatEnrichmentProvider;
    userProvider?: UserEnrichmentProvider;
  }
): EventEnricher {
  return new EventEnricher(config, options);
}

/**
 * Create a no-op enricher (passthrough)
 */
export function createNoOpEnricher(): EventEnricher {
  return new EventEnricher({});
}
