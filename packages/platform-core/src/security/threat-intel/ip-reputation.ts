/**
 * IP Reputation Service - Threat Intelligence Integration
 *
 * Provides IP reputation checking with multi-layer caching for threat intelligence.
 * Features include:
 * - Multi-layer caching (L1 in-memory LRU, L2 Redis, L3 external API)
 * - Built-in threat feeds (Tor exit nodes, datacenter IPs, internal blocklist)
 * - Async refresh pattern for non-blocking requests
 * - AbuseIPDB-compatible interface
 * - Fastify middleware for IP reputation checks
 *
 * @packageDocumentation
 * @module security/threat-intel/ip-reputation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import { getRedis } from '../../common/redis.js';

const logger = createLogger({ component: 'ip-reputation' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for IP reputation cache */
const REPUTATION_PREFIX = 'vorion:ip_reputation:';

/** Redis key prefix for reported IPs */
const REPORTED_PREFIX = 'vorion:ip_reported:';

/** Redis key prefix for blocklist */
const BLOCKLIST_PREFIX = 'vorion:ip_blocklist:';

/** Redis key prefix for background refresh tracking */
const REFRESH_PREFIX = 'vorion:ip_refresh:';

/** L1 cache max size */
const L1_CACHE_MAX_SIZE = 1000;

/** L1 cache TTL in milliseconds */
const L1_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** L2 Redis cache TTL in seconds */
const L2_CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

/** Stale threshold for async refresh (percentage of TTL) */
const STALE_THRESHOLD = 0.7;

/** Background refresh lock TTL in seconds */
const REFRESH_LOCK_TTL_SECONDS = 30;

// =============================================================================
// Types
// =============================================================================

/**
 * IP reputation categories
 */
export type IPCategory =
  | 'tor'
  | 'vpn'
  | 'proxy'
  | 'botnet'
  | 'spam'
  | 'scanner'
  | 'bruteforce'
  | 'datacenter'
  | 'residential'
  | 'mobile'
  | 'hosting'
  | 'unknown';

/**
 * IP reputation data structure
 */
export interface IPReputation {
  /** Reputation score 0-100 (0 = malicious, 100 = clean) */
  score: number;
  /** Categories this IP is associated with */
  categories: IPCategory[];
  /** When this IP was last seen in threat feeds */
  lastSeen: Date;
  /** Number of reports against this IP */
  reportCount: number;
  /** Source of the reputation data */
  source: string;
  /** Confidence level 0-100 */
  confidence: number;
  /** Country code (ISO 3166-1 alpha-2) */
  countryCode?: string;
  /** ASN information */
  asn?: {
    number: number;
    name: string;
  };
  /** Whether this IP is on the blocklist */
  isBlocked: boolean;
  /** When the reputation was last updated */
  updatedAt: Date;
  /** Whether this data is from cache */
  fromCache: boolean;
  /** Cache layer that provided the data */
  cacheLayer?: 'l1' | 'l2' | 'l3';
}

/**
 * IP report reason
 */
export interface IPReport {
  /** IP address being reported */
  ip: string;
  /** Reason for the report */
  reason: string;
  /** Category of malicious activity */
  category?: IPCategory;
  /** When the report was submitted */
  reportedAt: Date;
  /** Who submitted the report (user/system ID) */
  reportedBy?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * External API configuration (AbuseIPDB-compatible)
 */
export interface ExternalAPIConfig {
  /** API endpoint URL */
  endpoint: string;
  /** API key */
  apiKey: string;
  /** Maximum requests per minute */
  rateLimit: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Whether the API is enabled */
  enabled: boolean;
}

/**
 * IP reputation service configuration
 */
export interface IPReputationConfig {
  /** External API configuration */
  externalAPI?: ExternalAPIConfig;
  /** Default score for unknown IPs */
  defaultScore: number;
  /** Score threshold for blocking (IPs with score below this are blocked) */
  blockThreshold: number;
  /** Enable built-in Tor exit node detection */
  enableTorDetection: boolean;
  /** Enable built-in datacenter IP detection */
  enableDatacenterDetection: boolean;
  /** Enable internal blocklist */
  enableInternalBlocklist: boolean;
  /** Score penalty for Tor exit nodes */
  torPenalty: number;
  /** Score penalty for datacenter IPs */
  datacenterPenalty: number;
  /** Score penalty for VPNs */
  vpnPenalty: number;
  /** Score penalty for proxies */
  proxyPenalty: number;
  /** Enable async background refresh */
  enableAsyncRefresh: boolean;
  /** Callback for high-risk IP detection */
  onHighRiskIP?: (ip: string, reputation: IPReputation) => void;
}

/**
 * L1 cache entry
 */
interface L1CacheEntry {
  reputation: IPReputation;
  expiresAt: number;
  insertedAt: number;
}

/**
 * Serialized reputation for Redis storage
 */
interface SerializedReputation {
  score: number;
  categories: IPCategory[];
  lastSeen: string;
  reportCount: number;
  source: string;
  confidence: number;
  countryCode?: string;
  asn?: {
    number: number;
    name: string;
  };
  isBlocked: boolean;
  updatedAt: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default IP reputation configuration
 */
export const DEFAULT_IP_REPUTATION_CONFIG: IPReputationConfig = {
  defaultScore: 80,
  blockThreshold: 20,
  enableTorDetection: true,
  enableDatacenterDetection: true,
  enableInternalBlocklist: true,
  torPenalty: 40,
  datacenterPenalty: 10,
  vpnPenalty: 20,
  proxyPenalty: 30,
  enableAsyncRefresh: true,
};

// =============================================================================
// Built-in Threat Feeds (Sample Data)
// =============================================================================

/**
 * Known Tor exit node patterns (sample - in production, load from external feed)
 * These are common Tor exit node IP ranges for demonstration
 */
const KNOWN_TOR_EXIT_PATTERNS = new Set([
  // Sample patterns - in production, fetch from https://check.torproject.org/exit-addresses
  '185.220.100.',
  '185.220.101.',
  '185.220.102.',
  '185.220.103.',
  '51.15.', // Some Scaleway ranges used by Tor
  '45.33.', // Some Linode ranges used by Tor
  '104.244.', // Common Tor hosting
]);

/**
 * Known datacenter/cloud IP ranges (sample)
 */
const KNOWN_DATACENTER_RANGES = [
  // AWS ranges (sample)
  { start: '3.0.0.0', end: '3.255.255.255', name: 'AWS' },
  { start: '13.0.0.0', end: '13.255.255.255', name: 'AWS' },
  { start: '52.0.0.0', end: '52.255.255.255', name: 'AWS' },
  { start: '54.0.0.0', end: '54.255.255.255', name: 'AWS' },
  // GCP ranges (sample)
  { start: '34.0.0.0', end: '34.255.255.255', name: 'GCP' },
  { start: '35.0.0.0', end: '35.255.255.255', name: 'GCP' },
  // Azure ranges (sample)
  { start: '40.0.0.0', end: '40.255.255.255', name: 'Azure' },
  // DigitalOcean
  { start: '64.225.0.0', end: '64.225.127.255', name: 'DigitalOcean' },
  { start: '167.71.0.0', end: '167.71.255.255', name: 'DigitalOcean' },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert IP address to numeric value for range comparison
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return 0;
  return parts.reduce((acc, part, index) => {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return 0;
    return acc + (num << (8 * (3 - index)));
  }, 0) >>> 0; // Convert to unsigned
}

/**
 * Check if IP is in a datacenter range
 */
function isDatacenterIP(ip: string): { isDatacenter: boolean; provider?: string } {
  const ipNum = ipToNumber(ip);
  for (const range of KNOWN_DATACENTER_RANGES) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);
    if (ipNum >= startNum && ipNum <= endNum) {
      return { isDatacenter: true, provider: range.name };
    }
  }
  return { isDatacenter: false };
}

/**
 * Check if IP matches known Tor exit node patterns
 */
function isTorExitNode(ip: string): boolean {
  const patterns = Array.from(KNOWN_TOR_EXIT_PATTERNS);
  for (let i = 0; i < patterns.length; i++) {
    if (ip.startsWith(patterns[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Validate IPv4 address format
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Validate IPv6 address format (basic validation)
 */
function isValidIPv6(ip: string): boolean {
  // Basic IPv6 validation - allows full and compressed formats
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?$/;
  return ipv6Regex.test(ip);
}

/**
 * Validate IP address format
 */
function isValidIP(ip: string): boolean {
  return isValidIPv4(ip) || isValidIPv6(ip);
}

// =============================================================================
// IPReputationService Class
// =============================================================================

/**
 * IP Reputation Service
 *
 * Provides IP reputation checking with multi-layer caching for threat intelligence.
 *
 * @example
 * ```typescript
 * const service = new IPReputationService({
 *   blockThreshold: 20,
 *   enableTorDetection: true,
 * });
 *
 * // Check IP reputation
 * const reputation = await service.checkIP('192.168.1.1');
 * console.log(`Score: ${reputation.score}, Categories: ${reputation.categories}`);
 *
 * // Report malicious IP
 * await service.reportMaliciousIP('10.0.0.1', 'Detected brute force attack');
 *
 * // Quick block check
 * const blocked = await service.isBlocked('10.0.0.1');
 * ```
 */
export class IPReputationService {
  private readonly config: IPReputationConfig;
  private readonly redis: Redis;
  private readonly l1Cache: Map<string, L1CacheEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private refreshInProgress: Set<string> = new Set();

  /**
   * Creates a new IPReputationService instance
   *
   * @param config - Service configuration
   * @param redis - Optional Redis instance (uses shared instance if not provided)
   */
  constructor(config: Partial<IPReputationConfig> = {}, redis?: Redis) {
    this.config = { ...DEFAULT_IP_REPUTATION_CONFIG, ...config };
    this.redis = redis ?? getRedis();
    this.l1Cache = new Map();

    // Start L1 cache cleanup interval
    this.startL1CacheCleanup();

    logger.info(
      {
        blockThreshold: this.config.blockThreshold,
        enableTorDetection: this.config.enableTorDetection,
        enableDatacenterDetection: this.config.enableDatacenterDetection,
        enableAsyncRefresh: this.config.enableAsyncRefresh,
        externalAPIEnabled: !!this.config.externalAPI?.enabled,
      },
      'IPReputationService initialized'
    );
  }

  /**
   * Start L1 cache cleanup interval
   */
  private startL1CacheCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(this.l1Cache.entries());
      for (let i = 0; i < entries.length; i++) {
        const [ip, entry] = entries[i];
        if (now > entry.expiresAt) {
          this.l1Cache.delete(ip);
        }
      }

      // Enforce max size by removing oldest entries
      if (this.l1Cache.size > L1_CACHE_MAX_SIZE) {
        const currentEntries = Array.from(this.l1Cache.entries());
        currentEntries.sort((a, b) => a[1].insertedAt - b[1].insertedAt);
        const toRemove = currentEntries.slice(0, currentEntries.length - L1_CACHE_MAX_SIZE);
        for (let i = 0; i < toRemove.length; i++) {
          this.l1Cache.delete(toRemove[i][0]);
        }
      }
    }, 60000); // Cleanup every minute

    this.cleanupInterval.unref();
  }

  /**
   * Get reputation from L1 (in-memory) cache
   */
  private getFromL1Cache(ip: string): IPReputation | null {
    const entry = this.l1Cache.get(ip);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.l1Cache.delete(ip);
      return null;
    }

    return {
      ...entry.reputation,
      fromCache: true,
      cacheLayer: 'l1',
    };
  }

  /**
   * Store reputation in L1 cache
   */
  private storeInL1Cache(ip: string, reputation: IPReputation): void {
    const now = Date.now();

    // Enforce max size before adding
    if (this.l1Cache.size >= L1_CACHE_MAX_SIZE) {
      // Remove oldest entry
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      const entries = Array.from(this.l1Cache.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, entry] = entries[i];
        if (entry.insertedAt < oldestTime) {
          oldestTime = entry.insertedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.l1Cache.delete(oldestKey);
      }
    }

    this.l1Cache.set(ip, {
      reputation,
      expiresAt: now + L1_CACHE_TTL_MS,
      insertedAt: now,
    });
  }

  /**
   * Get reputation from L2 (Redis) cache
   */
  private async getFromL2Cache(ip: string): Promise<IPReputation | null> {
    try {
      const key = `${REPUTATION_PREFIX}${ip}`;
      const data = await this.redis.get(key);

      if (!data) return null;

      const serialized = JSON.parse(data) as SerializedReputation;
      return {
        ...serialized,
        lastSeen: new Date(serialized.lastSeen),
        updatedAt: new Date(serialized.updatedAt),
        fromCache: true,
        cacheLayer: 'l2',
      };
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to get reputation from L2 cache');
      return null;
    }
  }

  /**
   * Store reputation in L2 (Redis) cache
   */
  private async storeInL2Cache(ip: string, reputation: IPReputation): Promise<void> {
    try {
      const key = `${REPUTATION_PREFIX}${ip}`;
      const serialized: SerializedReputation = {
        score: reputation.score,
        categories: reputation.categories,
        lastSeen: reputation.lastSeen.toISOString(),
        reportCount: reputation.reportCount,
        source: reputation.source,
        confidence: reputation.confidence,
        countryCode: reputation.countryCode,
        asn: reputation.asn,
        isBlocked: reputation.isBlocked,
        updatedAt: reputation.updatedAt.toISOString(),
      };

      await this.redis.setex(key, L2_CACHE_TTL_SECONDS, JSON.stringify(serialized));
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to store reputation in L2 cache');
    }
  }

  /**
   * Check if L2 cache entry is stale (should trigger background refresh)
   */
  private async isL2CacheStale(ip: string): Promise<boolean> {
    try {
      const ttl = await this.redis.ttl(`${REPUTATION_PREFIX}${ip}`);
      if (ttl < 0) return true;
      const threshold = L2_CACHE_TTL_SECONDS * STALE_THRESHOLD;
      return ttl < threshold;
    } catch {
      return true;
    }
  }

  /**
   * Get reputation from L3 (external API)
   */
  private async getFromExternalAPI(ip: string): Promise<IPReputation | null> {
    if (!this.config.externalAPI?.enabled || !this.config.externalAPI?.endpoint) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.externalAPI.timeoutMs
      );

      const response = await fetch(
        `${this.config.externalAPI.endpoint}/check?ipAddress=${encodeURIComponent(ip)}`,
        {
          method: 'GET',
          headers: {
            'Key': this.config.externalAPI.apiKey,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn(
          { ip, status: response.status },
          'External API returned non-OK status'
        );
        return null;
      }

      const data = (await response.json()) as {
        data?: {
          abuseConfidenceScore?: number;
          countryCode?: string;
          usageType?: string;
          isp?: string;
          totalReports?: number;
          lastReportedAt?: string;
          isTor?: boolean;
        };
      };

      if (!data.data) return null;

      // Convert AbuseIPDB format to our format
      const abuseScore = data.data.abuseConfidenceScore ?? 0;
      const categories: IPCategory[] = [];

      if (data.data.isTor) categories.push('tor');
      if (data.data.usageType?.toLowerCase().includes('hosting')) {
        categories.push('hosting');
      }
      if (data.data.usageType?.toLowerCase().includes('datacenter')) {
        categories.push('datacenter');
      }

      // Convert abuse confidence (0-100 where 100 is bad) to our score (0-100 where 100 is good)
      const score = 100 - abuseScore;

      return {
        score,
        categories,
        lastSeen: data.data.lastReportedAt
          ? new Date(data.data.lastReportedAt)
          : new Date(),
        reportCount: data.data.totalReports ?? 0,
        source: 'abuseipdb',
        confidence: Math.min(abuseScore + 20, 100), // Higher abuse score = higher confidence
        countryCode: data.data.countryCode,
        isBlocked: score < this.config.blockThreshold,
        updatedAt: new Date(),
        fromCache: false,
        cacheLayer: 'l3',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ ip }, 'External API request timed out');
      } else {
        logger.warn({ error, ip }, 'Failed to get reputation from external API');
      }
      return null;
    }
  }

  /**
   * Compute reputation from built-in threat feeds
   */
  private computeBuiltInReputation(ip: string): IPReputation {
    let score = this.config.defaultScore;
    const categories: IPCategory[] = [];

    // Check Tor exit nodes
    if (this.config.enableTorDetection && isTorExitNode(ip)) {
      score -= this.config.torPenalty;
      categories.push('tor');
    }

    // Check datacenter IPs
    if (this.config.enableDatacenterDetection) {
      const datacenterCheck = isDatacenterIP(ip);
      if (datacenterCheck.isDatacenter) {
        score -= this.config.datacenterPenalty;
        categories.push('datacenter');
        categories.push('hosting');
      }
    }

    // Ensure score stays in range
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      categories: categories.length > 0 ? categories : ['unknown'],
      lastSeen: new Date(),
      reportCount: 0,
      source: 'builtin',
      confidence: 60, // Built-in feeds have moderate confidence
      isBlocked: score < this.config.blockThreshold,
      updatedAt: new Date(),
      fromCache: false,
    };
  }

  /**
   * Trigger background refresh for an IP
   */
  private async triggerBackgroundRefresh(ip: string): Promise<void> {
    // Prevent duplicate refreshes
    if (this.refreshInProgress.has(ip)) return;

    try {
      // Try to acquire refresh lock
      const lockKey = `${REFRESH_PREFIX}${ip}`;
      const locked = await this.redis.set(
        lockKey,
        '1',
        'EX',
        REFRESH_LOCK_TTL_SECONDS,
        'NX'
      );

      if (!locked) return; // Another instance is refreshing

      this.refreshInProgress.add(ip);

      // Perform refresh in background
      setImmediate(async () => {
        try {
          const reputation = await this.getFromExternalAPI(ip);
          if (reputation) {
            // Merge with built-in reputation
            const builtIn = this.computeBuiltInReputation(ip);
            const merged = this.mergeReputations(reputation, builtIn);

            // Store in both caches
            this.storeInL1Cache(ip, merged);
            await this.storeInL2Cache(ip, merged);

            logger.debug({ ip, score: merged.score }, 'Background refresh completed');
          }
        } catch (error) {
          logger.warn({ error, ip }, 'Background refresh failed');
        } finally {
          this.refreshInProgress.delete(ip);
          await this.redis.del(lockKey);
        }
      });
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to trigger background refresh');
    }
  }

  /**
   * Merge reputations from multiple sources
   */
  private mergeReputations(
    primary: IPReputation,
    secondary: IPReputation
  ): IPReputation {
    // Combine categories, removing duplicates
    const categories = Array.from(
      new Set([...primary.categories, ...secondary.categories])
    ) as IPCategory[];

    // Use the lower score (more conservative)
    const score = Math.min(primary.score, secondary.score);

    return {
      score,
      categories,
      lastSeen: primary.lastSeen > secondary.lastSeen ? primary.lastSeen : secondary.lastSeen,
      reportCount: primary.reportCount + secondary.reportCount,
      source: `${primary.source},${secondary.source}`,
      confidence: Math.max(primary.confidence, secondary.confidence),
      countryCode: primary.countryCode ?? secondary.countryCode,
      asn: primary.asn ?? secondary.asn,
      isBlocked: score < this.config.blockThreshold,
      updatedAt: new Date(),
      fromCache: false,
    };
  }

  /**
   * Check IP reputation
   *
   * Returns reputation score and metadata for an IP address.
   * Uses multi-layer caching with async background refresh.
   *
   * @param ip - IP address to check
   * @returns IP reputation data
   */
  async checkIP(ip: string): Promise<IPReputation> {
    // Validate IP format
    if (!isValidIP(ip)) {
      logger.warn({ ip }, 'Invalid IP address format');
      return {
        score: this.config.defaultScore,
        categories: ['unknown'],
        lastSeen: new Date(),
        reportCount: 0,
        source: 'invalid',
        confidence: 0,
        isBlocked: false,
        updatedAt: new Date(),
        fromCache: false,
      };
    }

    // L1 Cache: In-memory LRU
    const l1Result = this.getFromL1Cache(ip);
    if (l1Result) {
      logger.debug({ ip, score: l1Result.score, layer: 'l1' }, 'IP reputation from L1 cache');
      return l1Result;
    }

    // L2 Cache: Redis
    const l2Result = await this.getFromL2Cache(ip);
    if (l2Result) {
      // Store in L1 for faster subsequent lookups
      this.storeInL1Cache(ip, l2Result);

      // Check if stale and trigger background refresh
      if (this.config.enableAsyncRefresh) {
        this.isL2CacheStale(ip).then((isStale: boolean) => {
          if (isStale) {
            this.triggerBackgroundRefresh(ip);
          }
        }).catch(() => {
          // Ignore stale check errors
        });
      }

      logger.debug({ ip, score: l2Result.score, layer: 'l2' }, 'IP reputation from L2 cache');
      return l2Result;
    }

    // L3: External API (if configured)
    let reputation: IPReputation;

    if (this.config.externalAPI?.enabled) {
      const externalResult = await this.getFromExternalAPI(ip);
      if (externalResult) {
        const builtIn = this.computeBuiltInReputation(ip);
        reputation = this.mergeReputations(externalResult, builtIn);
      } else {
        reputation = this.computeBuiltInReputation(ip);
      }
    } else {
      // Fallback to built-in reputation
      reputation = this.computeBuiltInReputation(ip);
    }

    // Check internal blocklist
    if (this.config.enableInternalBlocklist) {
      const blocklisted = await this.isOnBlocklist(ip);
      if (blocklisted) {
        reputation.score = 0;
        reputation.isBlocked = true;
        if (!reputation.categories.includes('unknown')) {
          reputation.categories = reputation.categories.filter((c) => c !== 'unknown');
        }
      }
    }

    // Add report count from internal reports
    const reportCount = await this.getReportCount(ip);
    reputation.reportCount += reportCount;

    // Adjust score based on report count
    if (reportCount > 0) {
      const reportPenalty = Math.min(reportCount * 5, 30);
      reputation.score = Math.max(0, reputation.score - reportPenalty);
      reputation.isBlocked = reputation.score < this.config.blockThreshold;
    }

    // Store in caches
    this.storeInL1Cache(ip, reputation);
    await this.storeInL2Cache(ip, reputation);

    // Notify callback for high-risk IPs
    if (reputation.score < this.config.blockThreshold && this.config.onHighRiskIP) {
      this.config.onHighRiskIP(ip, reputation);
    }

    logger.debug(
      { ip, score: reputation.score, categories: reputation.categories, source: reputation.source },
      'IP reputation computed'
    );

    return reputation;
  }

  /**
   * Report a malicious IP address
   *
   * @param ip - IP address to report
   * @param reason - Reason for the report
   * @param category - Optional category of malicious activity
   * @param reportedBy - Optional reporter identifier
   */
  async reportMaliciousIP(
    ip: string,
    reason: string,
    category?: IPCategory,
    reportedBy?: string
  ): Promise<void> {
    if (!isValidIP(ip)) {
      throw new Error('Invalid IP address format');
    }

    const report: IPReport = {
      ip,
      reason,
      category,
      reportedAt: new Date(),
      reportedBy,
    };

    try {
      // Store report in Redis
      const key = `${REPORTED_PREFIX}${ip}`;
      const reportData = JSON.stringify(report);

      // Add to sorted set with timestamp as score
      await this.redis.zadd(key, Date.now(), reportData);

      // Set expiry (90 days)
      await this.redis.expire(key, 90 * 24 * 60 * 60);

      // Invalidate caches for this IP
      this.l1Cache.delete(ip);
      await this.redis.del(`${REPUTATION_PREFIX}${ip}`);

      // If many reports, consider adding to blocklist
      const reportCount = await this.getReportCount(ip);
      if (reportCount >= 5) {
        await this.addToBlocklist(ip, `Auto-blocked: ${reportCount} reports`);
      }

      logger.info(
        { ip, reason, category, reportedBy, totalReports: reportCount },
        'Malicious IP reported'
      );
    } catch (error) {
      logger.error({ error, ip }, 'Failed to report malicious IP');
      throw error;
    }
  }

  /**
   * Quick check if an IP is blocked
   *
   * @param ip - IP address to check
   * @returns Whether the IP is blocked
   */
  async isBlocked(ip: string): Promise<boolean> {
    if (!isValidIP(ip)) {
      return false;
    }

    // Check L1 cache first
    const l1Result = this.getFromL1Cache(ip);
    if (l1Result) {
      return l1Result.isBlocked;
    }

    // Check blocklist directly (fast path)
    if (this.config.enableInternalBlocklist) {
      const blocklisted = await this.isOnBlocklist(ip);
      if (blocklisted) {
        return true;
      }
    }

    // Check full reputation
    const reputation = await this.checkIP(ip);
    return reputation.isBlocked;
  }

  /**
   * Check if IP is on the internal blocklist
   */
  private async isOnBlocklist(ip: string): Promise<boolean> {
    try {
      const key = `${BLOCKLIST_PREFIX}${ip}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to check blocklist');
      return false;
    }
  }

  /**
   * Add IP to internal blocklist
   *
   * @param ip - IP address to block
   * @param reason - Reason for blocking
   */
  async addToBlocklist(ip: string, reason: string): Promise<void> {
    if (!isValidIP(ip)) {
      throw new Error('Invalid IP address format');
    }

    try {
      const key = `${BLOCKLIST_PREFIX}${ip}`;
      const data = JSON.stringify({
        ip,
        reason,
        blockedAt: new Date().toISOString(),
      });

      // Block for 30 days by default
      await this.redis.setex(key, 30 * 24 * 60 * 60, data);

      // Invalidate caches
      this.l1Cache.delete(ip);
      await this.redis.del(`${REPUTATION_PREFIX}${ip}`);

      logger.info({ ip, reason }, 'IP added to blocklist');
    } catch (error) {
      logger.error({ error, ip }, 'Failed to add IP to blocklist');
      throw error;
    }
  }

  /**
   * Remove IP from internal blocklist
   *
   * @param ip - IP address to unblock
   */
  async removeFromBlocklist(ip: string): Promise<void> {
    try {
      const key = `${BLOCKLIST_PREFIX}${ip}`;
      await this.redis.del(key);

      // Invalidate caches
      this.l1Cache.delete(ip);
      await this.redis.del(`${REPUTATION_PREFIX}${ip}`);

      logger.info({ ip }, 'IP removed from blocklist');
    } catch (error) {
      logger.error({ error, ip }, 'Failed to remove IP from blocklist');
      throw error;
    }
  }

  /**
   * Get report count for an IP
   */
  private async getReportCount(ip: string): Promise<number> {
    try {
      const key = `${REPORTED_PREFIX}${ip}`;
      const count = await this.redis.zcard(key);
      return count;
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to get report count');
      return 0;
    }
  }

  /**
   * Get recent reports for an IP
   *
   * @param ip - IP address to get reports for
   * @param limit - Maximum number of reports to return
   */
  async getReports(ip: string, limit: number = 10): Promise<IPReport[]> {
    try {
      const key = `${REPORTED_PREFIX}${ip}`;
      const reports = await this.redis.zrevrange(key, 0, limit - 1);

      return reports.map((data) => {
        const parsed = JSON.parse(data) as IPReport;
        return {
          ...parsed,
          reportedAt: new Date(parsed.reportedAt),
        };
      });
    } catch (error) {
      logger.warn({ error, ip }, 'Failed to get reports');
      return [];
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    l1Size: number;
    l1MaxSize: number;
    refreshInProgress: number;
  } {
    return {
      l1Size: this.l1Cache.size,
      l1MaxSize: L1_CACHE_MAX_SIZE,
      refreshInProgress: this.refreshInProgress.size,
    };
  }

  /**
   * Clear all caches
   */
  async clearCaches(): Promise<void> {
    this.l1Cache.clear();

    // Clear L2 cache (scan and delete)
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${REPUTATION_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    logger.info('IP reputation caches cleared');
  }

  /**
   * Stop the service and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.l1Cache.clear();
    this.refreshInProgress.clear();

    logger.info('IPReputationService stopped');
  }
}

// =============================================================================
// Fastify Middleware
// =============================================================================

/**
 * Options for IP reputation middleware
 */
export interface IPReputationMiddlewareOptions {
  /** IP reputation service instance */
  service?: IPReputationService;
  /** Service configuration (if not providing service instance) */
  config?: Partial<IPReputationConfig>;
  /** Score threshold for blocking (default: 20) */
  blockThreshold?: number;
  /** Paths to skip reputation checks for */
  skipPaths?: string[];
  /** Whether to add reputation header */
  addReputationHeader?: boolean;
  /** Custom response for blocked IPs */
  blockedResponse?: (ip: string, reputation: IPReputation) => {
    statusCode: number;
    body: Record<string, unknown>;
  };
  /** Log level for suspicious IPs (score < 50) */
  logSuspiciousIPs?: boolean;
  /** Minimum score to log as suspicious */
  suspiciousThreshold?: number;
}

/**
 * Creates Fastify middleware for IP reputation checking
 *
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * const ipReputationMiddleware = ipReputationCheck({
 *   blockThreshold: 20,
 *   skipPaths: ['/health', '/metrics'],
 *   addReputationHeader: true,
 * });
 *
 * fastify.addHook('preHandler', ipReputationMiddleware);
 * ```
 */
export function ipReputationCheck(
  options: IPReputationMiddlewareOptions = {}
): preHandlerHookHandler {
  const service = options.service ?? new IPReputationService(options.config);
  const blockThreshold = options.blockThreshold ?? 20;
  const skipPaths = new Set(options.skipPaths ?? ['/health', '/metrics', '/ready', '/live']);
  const addReputationHeader = options.addReputationHeader ?? true;
  const logSuspiciousIPs = options.logSuspiciousIPs ?? true;
  const suspiciousThreshold = options.suspiciousThreshold ?? 50;

  const defaultBlockedResponse = (ip: string, reputation: IPReputation) => ({
    statusCode: 403,
    body: {
      error: {
        code: 'IP_BLOCKED',
        message: 'Access denied due to IP reputation',
        categories: reputation.categories,
      },
    },
  });

  const blockedResponse = options.blockedResponse ?? defaultBlockedResponse;

  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    // Skip configured paths
    const path = request.url.split('?')[0];
    if (skipPaths.has(path)) {
      return;
    }

    // Get client IP
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (request.headers['x-real-ip'] as string) ??
      request.ip;

    if (!ip) {
      logger.warn('Could not determine client IP');
      return;
    }

    try {
      // Check IP reputation
      const reputation = await service.checkIP(ip);

      // Add reputation header if enabled
      if (addReputationHeader) {
        reply.header('X-IP-Reputation-Score', reputation.score.toString());
      }

      // Log suspicious IPs
      if (logSuspiciousIPs && reputation.score < suspiciousThreshold) {
        logger.warn(
          {
            ip,
            score: reputation.score,
            categories: reputation.categories,
            source: reputation.source,
            path: request.url,
            method: request.method,
          },
          'Suspicious IP detected'
        );
      }

      // Block if below threshold
      if (reputation.score < blockThreshold) {
        logger.warn(
          {
            ip,
            score: reputation.score,
            categories: reputation.categories,
            threshold: blockThreshold,
          },
          'IP blocked due to low reputation score'
        );

        const response = blockedResponse(ip, reputation);
        return reply.status(response.statusCode).send(response.body);
      }

      // Attach reputation to request for downstream handlers
      (request as FastifyRequest & { ipReputation?: IPReputation }).ipReputation =
        reputation;
    } catch (error) {
      // Log error but don't block request on service failure
      logger.error({ error, ip }, 'IP reputation check failed');
      // Continue processing - fail open
    }
  };
}

// =============================================================================
// Fastify Request Declaration
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    ipReputation?: IPReputation;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let ipReputationInstance: IPReputationService | null = null;

/**
 * Gets or creates the singleton IPReputationService instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton IPReputationService instance
 */
export function getIPReputationService(
  config?: Partial<IPReputationConfig>
): IPReputationService {
  if (!ipReputationInstance) {
    ipReputationInstance = new IPReputationService(config);
  }
  return ipReputationInstance;
}

/**
 * Resets the singleton instance (primarily for testing)
 */
export async function resetIPReputationService(): Promise<void> {
  if (ipReputationInstance) {
    await ipReputationInstance.stop();
    ipReputationInstance = null;
  }
}
