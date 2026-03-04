/**
 * Bot Detection Service
 *
 * Advanced bot detection for threat protection. Analyzes HTTP requests
 * using multiple detection signals to determine if a request originates
 * from a human or automated client.
 *
 * Detection signals:
 * - Missing/suspicious headers (Accept-Language, Accept-Encoding)
 * - User-Agent analysis (known bots, headless browsers)
 * - Header order anomalies (browsers have consistent order)
 * - TLS fingerprint anomalies (JA3 hash if available)
 * - Request timing patterns (too fast = bot)
 * - Missing cookies on return visits
 * - JavaScript challenge results
 *
 * @packageDocumentation
 * @module security/threat-intel/bot-detection
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createHash, randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';

const logger = createLogger({ component: 'bot-detection' });

// =============================================================================
// Metrics
// =============================================================================

const botDetectionRequests = new Counter({
  name: 'vorion_bot_detection_requests_total',
  help: 'Total bot detection requests',
  labelNames: ['recommendation'] as const,
  registers: [vorionRegistry],
});

const botDetectionDuration = new Histogram({
  name: 'vorion_bot_detection_duration_seconds',
  help: 'Bot detection analysis duration',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

const botSignalsDetected = new Counter({
  name: 'vorion_bot_signals_detected_total',
  help: 'Bot detection signals triggered',
  labelNames: ['signal'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Bot detection signal types
 */
export type BotSignalType =
  | 'missing_accept_language'
  | 'missing_accept_encoding'
  | 'suspicious_user_agent'
  | 'known_bad_bot'
  | 'known_good_bot'
  | 'headless_browser'
  | 'header_order_anomaly'
  | 'tls_fingerprint_anomaly'
  | 'request_too_fast'
  | 'missing_cookies_return_visit'
  | 'js_challenge_failed'
  | 'js_challenge_passed'
  | 'missing_referer_on_post'
  | 'unusual_header_combination'
  | 'connection_reuse_pattern'
  | 'missing_sec_headers'
  | 'suspicious_accept_header';

/**
 * Individual bot detection signal
 */
export interface BotSignal {
  /** Signal type identifier */
  type: BotSignalType;
  /** Human-readable description */
  description: string;
  /** Score adjustment (-100 to +100) */
  scoreAdjustment: number;
  /** Confidence in this signal (0-1) */
  confidence: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Bot score recommendation
 */
export type BotRecommendation = 'allow' | 'challenge' | 'block';

/**
 * Complete bot detection score result
 */
export interface BotScore {
  /** Final score 0-100 (0 = definitely bot, 100 = definitely human) */
  score: number;
  /** All signals that contributed to the score */
  signals: BotSignal[];
  /** Device/request fingerprint */
  fingerprint: string;
  /** Recommended action */
  recommendation: BotRecommendation;
  /** Whether this is a known good bot (e.g., Googlebot) */
  isKnownGoodBot: boolean;
  /** Whether this is a known bad bot */
  isKnownBadBot: boolean;
  /** Analysis timestamp */
  analyzedAt: Date;
  /** Analysis duration in ms */
  analysisMs: number;
}

/**
 * Bot detection configuration
 */
export interface BotDetectionConfig {
  /** Whether bot detection is enabled */
  enabled: boolean;
  /** Score threshold below which requests are blocked (default: 20) */
  blockThreshold: number;
  /** Score threshold below which requests are challenged (default: 50) */
  challengeThreshold: number;
  /** List of allowed good bots (override built-in) */
  allowedBots: string[];
  /** List of blocked bad bots (override built-in) */
  blockedBots: string[];
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTTLMs: number;
  /** Maximum cache size */
  maxCacheSize: number;
  /** Whether to add X-Bot-Score header to responses */
  addScoreHeader: boolean;
  /** Paths to skip bot detection */
  skipPaths: string[];
  /** Request timing threshold in ms (faster = suspicious) */
  timingThresholdMs: number;
  /** Enable strict mode (stricter signal thresholds) */
  strictMode: boolean;
}

/**
 * Default bot detection configuration
 */
export const DEFAULT_BOT_DETECTION_CONFIG: BotDetectionConfig = {
  enabled: true,
  blockThreshold: 20,
  challengeThreshold: 50,
  allowedBots: [],
  blockedBots: [],
  cacheTTLMs: 5 * 60 * 1000, // 5 minutes
  maxCacheSize: 10000,
  addScoreHeader: true,
  skipPaths: ['/health', '/metrics', '/ready'],
  timingThresholdMs: 50,
  strictMode: false,
};

/**
 * Cached bot score entry
 */
interface CachedScore {
  score: BotScore;
  expiresAt: number;
}

// =============================================================================
// Bot Signatures
// =============================================================================

/**
 * Known good bot User-Agent patterns
 */
const KNOWN_GOOD_BOTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /Googlebot/i, name: 'Googlebot' },
  { pattern: /Googlebot-Image/i, name: 'Googlebot-Image' },
  { pattern: /Googlebot-News/i, name: 'Googlebot-News' },
  { pattern: /Googlebot-Video/i, name: 'Googlebot-Video' },
  { pattern: /Storebot-Google/i, name: 'Storebot-Google' },
  { pattern: /Google-InspectionTool/i, name: 'Google-InspectionTool' },
  { pattern: /GoogleOther/i, name: 'GoogleOther' },
  { pattern: /bingbot/i, name: 'Bingbot' },
  { pattern: /msnbot/i, name: 'MSNBot' },
  { pattern: /Slurp/i, name: 'Yahoo Slurp' },
  { pattern: /DuckDuckBot/i, name: 'DuckDuckBot' },
  { pattern: /Baiduspider/i, name: 'Baiduspider' },
  { pattern: /YandexBot/i, name: 'YandexBot' },
  { pattern: /facebot/i, name: 'Facebook Bot' },
  { pattern: /facebookexternalhit/i, name: 'Facebook External Hit' },
  { pattern: /Twitterbot/i, name: 'Twitterbot' },
  { pattern: /LinkedInBot/i, name: 'LinkedInBot' },
  { pattern: /Slackbot/i, name: 'Slackbot' },
  { pattern: /Discordbot/i, name: 'Discordbot' },
  { pattern: /WhatsApp/i, name: 'WhatsApp' },
  { pattern: /Applebot/i, name: 'Applebot' },
  { pattern: /AdsBot-Google/i, name: 'AdsBot-Google' },
  { pattern: /Mediapartners-Google/i, name: 'Mediapartners-Google' },
  { pattern: /APIs-Google/i, name: 'APIs-Google' },
  { pattern: /GPTBot/i, name: 'GPTBot' },
  { pattern: /Claude-Web/i, name: 'Claude-Web' },
  { pattern: /anthropic-ai/i, name: 'Anthropic AI' },
  { pattern: /UptimeRobot/i, name: 'UptimeRobot' },
  { pattern: /Pingdom/i, name: 'Pingdom' },
  { pattern: /StatusCake/i, name: 'StatusCake' },
];

/**
 * Known bad bot User-Agent patterns
 */
const KNOWN_BAD_BOTS: Array<{ pattern: RegExp; name: string; severity: number }> = [
  // Vulnerability scanners
  { pattern: /nikto/i, name: 'Nikto Scanner', severity: 100 },
  { pattern: /sqlmap/i, name: 'SQLMap', severity: 100 },
  { pattern: /nmap/i, name: 'Nmap', severity: 80 },
  { pattern: /masscan/i, name: 'Masscan', severity: 80 },
  { pattern: /nuclei/i, name: 'Nuclei', severity: 90 },
  { pattern: /wpscan/i, name: 'WPScan', severity: 90 },
  { pattern: /dirbuster/i, name: 'DirBuster', severity: 80 },
  { pattern: /gobuster/i, name: 'GoBuster', severity: 80 },
  { pattern: /burp/i, name: 'Burp Suite', severity: 70 },
  { pattern: /zaproxy|owasp/i, name: 'OWASP ZAP', severity: 70 },
  { pattern: /acunetix/i, name: 'Acunetix', severity: 80 },
  { pattern: /nessus/i, name: 'Nessus', severity: 70 },
  { pattern: /qualys/i, name: 'Qualys', severity: 60 },

  // Scrapers
  { pattern: /scrapy/i, name: 'Scrapy', severity: 60 },
  { pattern: /harvest/i, name: 'Harvester', severity: 70 },
  { pattern: /emailharvest/i, name: 'Email Harvester', severity: 80 },
  { pattern: /webbandit/i, name: 'WebBandit', severity: 70 },
  { pattern: /webzip/i, name: 'WebZIP', severity: 60 },
  { pattern: /httrack/i, name: 'HTTrack', severity: 50 },
  { pattern: /offline explorer/i, name: 'Offline Explorer', severity: 50 },
  { pattern: /teleport/i, name: 'Teleport', severity: 50 },

  // DDoS tools
  { pattern: /slowloris/i, name: 'Slowloris', severity: 100 },
  { pattern: /loic/i, name: 'LOIC', severity: 100 },
  { pattern: /hoic/i, name: 'HOIC', severity: 100 },

  // Spam bots
  { pattern: /xrumer/i, name: 'XRumer', severity: 90 },
  { pattern: /senuke/i, name: 'SENuke', severity: 90 },
  { pattern: /gsa search/i, name: 'GSA', severity: 80 },
  { pattern: /scrapebox/i, name: 'Scrapebox', severity: 80 },

  // Generic bad patterns
  { pattern: /^$/i, name: 'Empty User-Agent', severity: 40 },
  { pattern: /^-$/i, name: 'Hyphen User-Agent', severity: 60 },
  { pattern: /^Mozilla\/4\.0$/i, name: 'Generic Mozilla 4.0', severity: 50 },
  { pattern: /python-requests/i, name: 'Python Requests (raw)', severity: 30 },
  { pattern: /libwww-perl/i, name: 'libwww-perl', severity: 40 },
  { pattern: /curl\/\d/i, name: 'cURL (raw)', severity: 30 },
  { pattern: /wget\//i, name: 'Wget', severity: 30 },
  { pattern: /java\/\d/i, name: 'Java HTTP Client', severity: 30 },
  { pattern: /^okhttp/i, name: 'OkHttp (raw)', severity: 30 },
  { pattern: /^Go-http-client/i, name: 'Go HTTP Client', severity: 30 },
  { pattern: /^node-fetch/i, name: 'Node Fetch (raw)', severity: 30 },
  { pattern: /^axios/i, name: 'Axios (raw)', severity: 30 },
];

/**
 * Headless browser indicators in User-Agent
 */
const HEADLESS_BROWSER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /HeadlessChrome/i, name: 'Headless Chrome' },
  { pattern: /PhantomJS/i, name: 'PhantomJS' },
  { pattern: /Puppeteer/i, name: 'Puppeteer' },
  { pattern: /Playwright/i, name: 'Playwright' },
  { pattern: /Selenium/i, name: 'Selenium' },
  { pattern: /WebDriver/i, name: 'WebDriver' },
  { pattern: /MSIE 5\.0/i, name: 'Suspicious IE5' },
  { pattern: /compatible; MSIE/i, name: 'Old IE Compatibility' },
  { pattern: /SlimerJS/i, name: 'SlimerJS' },
  { pattern: /CasperJS/i, name: 'CasperJS' },
  { pattern: /Nightmare/i, name: 'Nightmare' },
  { pattern: /ZombieJS/i, name: 'ZombieJS' },
];

/**
 * Expected browser header order patterns
 * Browsers typically send headers in a consistent order
 */
const BROWSER_HEADER_ORDERS: Array<{ browser: string; expectedFirst: string[] }> = [
  { browser: 'Chrome', expectedFirst: ['host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile'] },
  { browser: 'Firefox', expectedFirst: ['host', 'user-agent', 'accept'] },
  { browser: 'Safari', expectedFirst: ['host', 'accept', 'user-agent', 'accept-language'] },
  { browser: 'Edge', expectedFirst: ['host', 'connection', 'sec-ch-ua'] },
];

// =============================================================================
// BotDetectionService Class
// =============================================================================

/**
 * Bot Detection Service
 *
 * Analyzes HTTP requests to detect automated/bot traffic using multiple signals.
 *
 * @example
 * ```typescript
 * const detector = new BotDetectionService({
 *   blockThreshold: 20,
 *   challengeThreshold: 50,
 * });
 *
 * // Analyze a request
 * const score = await detector.analyze(request);
 *
 * if (score.recommendation === 'block') {
 *   reply.status(403).send({ error: 'Bot detected' });
 * }
 * ```
 */
export class BotDetectionService {
  private readonly config: BotDetectionConfig;
  private readonly scoreCache: Map<string, CachedScore>;
  private readonly requestTimings: Map<string, number>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<BotDetectionConfig> = {}) {
    this.config = { ...DEFAULT_BOT_DETECTION_CONFIG, ...config };
    this.scoreCache = new Map();
    this.requestTimings = new Map();

    // Start cache cleanup interval
    this.startCleanupInterval();

    logger.info(
      {
        enabled: this.config.enabled,
        blockThreshold: this.config.blockThreshold,
        challengeThreshold: this.config.challengeThreshold,
        strictMode: this.config.strictMode,
      },
      'BotDetectionService initialized'
    );
  }

  /**
   * Analyze a request for bot indicators
   *
   * @param request - Fastify request to analyze
   * @returns Bot detection score and signals
   */
  async analyze(request: FastifyRequest): Promise<BotScore> {
    const startTime = performance.now();
    const signals: BotSignal[] = [];

    if (!this.config.enabled) {
      return this.createScore(50, signals, this.getFingerprint(request), startTime);
    }

    // Get fingerprint for caching
    const fingerprint = this.getFingerprint(request);

    // Check cache first
    const cached = this.getCachedScore(fingerprint);
    if (cached) {
      logger.debug({ fingerprint: fingerprint.substring(0, 8) }, 'Using cached bot score');
      return cached;
    }

    // Extract request data
    const userAgent = request.headers['user-agent'] ?? '';
    const headers = request.headers;
    const headerNames = Object.keys(headers);

    // Run all detection checks
    this.checkKnownGoodBots(userAgent, signals);
    this.checkKnownBadBots(userAgent, signals);
    this.checkHeadlessBrowsers(userAgent, signals);
    this.checkMissingHeaders(headers, signals);
    this.checkSuspiciousHeaders(headers, signals);
    this.checkHeaderOrder(headerNames, userAgent, signals);
    this.checkSecHeaders(headers, signals);
    this.checkRequestTiming(request, signals);
    this.checkTlsFingerprint(request, signals);
    this.checkCookies(request, signals);

    // Calculate final score
    let score = 50; // Start neutral
    let isKnownGoodBot = false;
    let isKnownBadBot = false;

    for (const signal of signals) {
      score += signal.scoreAdjustment * signal.confidence;
      botSignalsDetected.inc({ signal: signal.type });

      if (signal.type === 'known_good_bot') {
        isKnownGoodBot = true;
      }
      if (signal.type === 'known_bad_bot') {
        isKnownBadBot = true;
      }
    }

    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Create result
    const result = this.createScore(score, signals, fingerprint, startTime, isKnownGoodBot, isKnownBadBot);

    // Cache the result
    this.cacheScore(fingerprint, result);

    // Record metrics
    botDetectionRequests.inc({ recommendation: result.recommendation });

    logger.debug(
      {
        fingerprint: fingerprint.substring(0, 8),
        score: result.score,
        recommendation: result.recommendation,
        signalCount: signals.length,
        analysisMs: result.analysisMs,
      },
      'Bot detection analysis complete'
    );

    return result;
  }

  /**
   * Quick check if request is likely a bot
   *
   * @param request - Fastify request to check
   * @returns true if request is likely a bot
   */
  async isBot(request: FastifyRequest): Promise<boolean> {
    const score = await this.analyze(request);
    return score.score < this.config.challengeThreshold;
  }

  /**
   * Generate a fingerprint for the request
   *
   * @param request - Fastify request to fingerprint
   * @returns Fingerprint hash
   */
  getFingerprint(request: FastifyRequest): string {
    const components: string[] = [];

    // Include stable request characteristics
    const userAgent = request.headers['user-agent'] ?? '';
    const acceptLanguage = request.headers['accept-language'] ?? '';
    const acceptEncoding = request.headers['accept-encoding'] ?? '';
    const accept = request.headers['accept'] ?? '';
    const secChUa = request.headers['sec-ch-ua'] ?? '';
    const secChUaPlatform = request.headers['sec-ch-ua-platform'] ?? '';
    const connection = request.headers['connection'] ?? '';

    components.push(
      `ua:${userAgent}`,
      `al:${acceptLanguage}`,
      `ae:${acceptEncoding}`,
      `ac:${accept}`,
      `cu:${secChUa}`,
      `cp:${secChUaPlatform}`,
      `cn:${connection}`
    );

    // Include TLS fingerprint if available
    const ja3 = this.extractJA3(request);
    if (ja3) {
      components.push(`ja3:${ja3}`);
    }

    // Hash the components
    const fingerprintData = components.sort().join('|');
    return createHash('sha256').update(fingerprintData).digest('hex');
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<BotDetectionConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<BotDetectionConfig>): void {
    Object.assign(this.config, updates);
    logger.info({ updates }, 'Bot detection configuration updated');
  }

  /**
   * Clear the score cache
   */
  clearCache(): void {
    this.scoreCache.clear();
    this.requestTimings.clear();
    logger.debug('Bot detection cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.scoreCache.size,
      maxSize: this.config.maxCacheSize,
    };
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearCache();
    logger.info('BotDetectionService shutdown');
  }

  // ===========================================================================
  // Detection Methods
  // ===========================================================================

  private checkKnownGoodBots(userAgent: string, signals: BotSignal[]): void {
    // Check custom allowed bots first
    for (const pattern of this.config.allowedBots) {
      if (new RegExp(pattern, 'i').test(userAgent)) {
        signals.push({
          type: 'known_good_bot',
          description: `Custom allowed bot: ${pattern}`,
          scoreAdjustment: 40,
          confidence: 1.0,
          metadata: { pattern },
        });
        return;
      }
    }

    // Check built-in known good bots
    for (const { pattern, name } of KNOWN_GOOD_BOTS) {
      if (pattern.test(userAgent)) {
        signals.push({
          type: 'known_good_bot',
          description: `Known good bot: ${name}`,
          scoreAdjustment: 35,
          confidence: 0.95,
          metadata: { botName: name },
        });
        return;
      }
    }
  }

  private checkKnownBadBots(userAgent: string, signals: BotSignal[]): void {
    // Check custom blocked bots first
    for (const pattern of this.config.blockedBots) {
      if (new RegExp(pattern, 'i').test(userAgent)) {
        signals.push({
          type: 'known_bad_bot',
          description: `Custom blocked bot: ${pattern}`,
          scoreAdjustment: -50,
          confidence: 1.0,
          metadata: { pattern },
        });
        return;
      }
    }

    // Check built-in known bad bots
    for (const { pattern, name, severity } of KNOWN_BAD_BOTS) {
      if (pattern.test(userAgent)) {
        const adjustment = Math.min(-20, -severity * 0.5);
        signals.push({
          type: 'known_bad_bot',
          description: `Known bad bot: ${name}`,
          scoreAdjustment: adjustment,
          confidence: severity / 100,
          metadata: { botName: name, severity },
        });
        return;
      }
    }
  }

  private checkHeadlessBrowsers(userAgent: string, signals: BotSignal[]): void {
    for (const { pattern, name } of HEADLESS_BROWSER_PATTERNS) {
      if (pattern.test(userAgent)) {
        signals.push({
          type: 'headless_browser',
          description: `Headless browser indicator: ${name}`,
          scoreAdjustment: -25,
          confidence: 0.9,
          metadata: { indicator: name },
        });
        return;
      }
    }
  }

  private checkMissingHeaders(headers: FastifyRequest['headers'], signals: BotSignal[]): void {
    // Check for Accept-Language
    if (!headers['accept-language']) {
      signals.push({
        type: 'missing_accept_language',
        description: 'Missing Accept-Language header',
        scoreAdjustment: this.config.strictMode ? -15 : -10,
        confidence: 0.7,
      });
    }

    // Check for Accept-Encoding
    if (!headers['accept-encoding']) {
      signals.push({
        type: 'missing_accept_encoding',
        description: 'Missing Accept-Encoding header',
        scoreAdjustment: this.config.strictMode ? -12 : -8,
        confidence: 0.6,
      });
    }

    // Check for Accept header
    if (!headers['accept']) {
      signals.push({
        type: 'suspicious_accept_header',
        description: 'Missing Accept header',
        scoreAdjustment: this.config.strictMode ? -10 : -5,
        confidence: 0.5,
      });
    }
  }

  private checkSuspiciousHeaders(headers: FastifyRequest['headers'], signals: BotSignal[]): void {
    const userAgent = headers['user-agent'] ?? '';

    // Check for unusual Accept header
    const accept = headers['accept'] ?? '';
    if (accept === '*/*' && userAgent.includes('Mozilla')) {
      // Browsers typically send more specific Accept headers
      signals.push({
        type: 'suspicious_accept_header',
        description: 'Browser-like UA with generic Accept header',
        scoreAdjustment: -8,
        confidence: 0.6,
      });
    }

    // Check for missing Connection header
    if (!headers['connection']) {
      signals.push({
        type: 'unusual_header_combination',
        description: 'Missing Connection header',
        scoreAdjustment: -5,
        confidence: 0.4,
      });
    }

    // Check for missing Host header (should always be present in HTTP/1.1+)
    if (!headers['host']) {
      signals.push({
        type: 'unusual_header_combination',
        description: 'Missing Host header',
        scoreAdjustment: -20,
        confidence: 0.9,
      });
    }
  }

  private checkHeaderOrder(headerNames: string[], userAgent: string, signals: BotSignal[]): void {
    // Determine expected browser from UA
    let expectedOrder: string[] | undefined;

    for (const { browser, expectedFirst } of BROWSER_HEADER_ORDERS) {
      if (userAgent.includes(browser)) {
        expectedOrder = expectedFirst;
        break;
      }
    }

    if (!expectedOrder) {
      return; // Can't check header order for unknown browser
    }

    // Check if first few headers match expected order
    const lowerHeaderNames = headerNames.map(h => h.toLowerCase());
    let matchCount = 0;
    const checkCount = Math.min(3, expectedOrder.length);

    for (let i = 0; i < checkCount; i++) {
      if (lowerHeaderNames[i] === expectedOrder[i]) {
        matchCount++;
      }
    }

    if (matchCount < checkCount - 1) {
      signals.push({
        type: 'header_order_anomaly',
        description: 'Header order does not match expected browser pattern',
        scoreAdjustment: -10,
        confidence: 0.5,
        metadata: {
          expected: expectedOrder.slice(0, checkCount),
          actual: lowerHeaderNames.slice(0, checkCount),
        },
      });
    }
  }

  private checkSecHeaders(headers: FastifyRequest['headers'], signals: BotSignal[]): void {
    const userAgent = headers['user-agent'] ?? '';

    // Modern Chrome should send Sec-CH-UA headers
    if (userAgent.includes('Chrome') && !userAgent.includes('HeadlessChrome')) {
      if (!headers['sec-ch-ua']) {
        signals.push({
          type: 'missing_sec_headers',
          description: 'Chrome browser without Sec-CH-UA headers',
          scoreAdjustment: -12,
          confidence: 0.7,
        });
      }
    }

    // Check for Sec-Fetch headers (modern browsers)
    if (userAgent.includes('Chrome') || userAgent.includes('Firefox') || userAgent.includes('Edge')) {
      if (!headers['sec-fetch-mode'] && !headers['sec-fetch-site']) {
        signals.push({
          type: 'missing_sec_headers',
          description: 'Modern browser without Sec-Fetch headers',
          scoreAdjustment: this.config.strictMode ? -10 : -5,
          confidence: 0.6,
        });
      }
    }
  }

  private checkRequestTiming(request: FastifyRequest, signals: BotSignal[]): void {
    const clientIp = this.getClientIP(request);
    const now = Date.now();
    const lastRequest = this.requestTimings.get(clientIp);

    if (lastRequest) {
      const timeSinceLastMs = now - lastRequest;

      if (timeSinceLastMs < this.config.timingThresholdMs) {
        signals.push({
          type: 'request_too_fast',
          description: `Request too fast: ${timeSinceLastMs}ms since last`,
          scoreAdjustment: -15,
          confidence: Math.min(1, (this.config.timingThresholdMs - timeSinceLastMs) / this.config.timingThresholdMs),
          metadata: { timeSinceLastMs },
        });
      }
    }

    // Update timing
    this.requestTimings.set(clientIp, now);
  }

  private checkTlsFingerprint(request: FastifyRequest, signals: BotSignal[]): void {
    const ja3 = this.extractJA3(request);

    if (!ja3) {
      return; // No JA3 fingerprint available
    }

    // Known suspicious JA3 hashes (example hashes - in production would be maintained list)
    const suspiciousJA3Hashes = new Set([
      // Python requests default
      '3b5074b1b5d032e5620f69f9f700ff0e',
      // Go default
      '473cd7cb9faa642487833865d516e578',
      // cURL default
      '6fa3244afc6bb6f9fad207b6b52af26b',
    ]);

    if (suspiciousJA3Hashes.has(ja3)) {
      signals.push({
        type: 'tls_fingerprint_anomaly',
        description: 'TLS fingerprint matches known automated client',
        scoreAdjustment: -15,
        confidence: 0.8,
        metadata: { ja3 },
      });
    }
  }

  private checkCookies(request: FastifyRequest, signals: BotSignal[]): void {
    const cookies = request.headers['cookie'];
    const referer = request.headers['referer'];

    // If there's a referer to our domain but no cookies, might be suspicious
    if (referer && !cookies) {
      // Only flag if referer appears to be from same domain
      const host = request.headers['host'] ?? '';
      if (referer.includes(host)) {
        signals.push({
          type: 'missing_cookies_return_visit',
          description: 'Return visit (has referer) but no cookies',
          scoreAdjustment: -8,
          confidence: 0.5,
        });
      }
    }

    // POST request without referer is suspicious for browser
    const userAgent = request.headers['user-agent'] ?? '';
    if (request.method === 'POST' && !referer && userAgent.includes('Mozilla')) {
      signals.push({
        type: 'missing_referer_on_post',
        description: 'POST request from browser without Referer',
        scoreAdjustment: -10,
        confidence: 0.6,
      });
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private createScore(
    score: number,
    signals: BotSignal[],
    fingerprint: string,
    startTime: number,
    isKnownGoodBot = false,
    isKnownBadBot = false
  ): BotScore {
    const analysisMs = Math.round(performance.now() - startTime);
    botDetectionDuration.observe(analysisMs / 1000);

    let recommendation: BotRecommendation;
    if (isKnownGoodBot) {
      recommendation = 'allow';
    } else if (score < this.config.blockThreshold || isKnownBadBot) {
      recommendation = 'block';
    } else if (score < this.config.challengeThreshold) {
      recommendation = 'challenge';
    } else {
      recommendation = 'allow';
    }

    return {
      score,
      signals,
      fingerprint,
      recommendation,
      isKnownGoodBot,
      isKnownBadBot,
      analyzedAt: new Date(),
      analysisMs,
    };
  }

  private getCachedScore(fingerprint: string): BotScore | null {
    const cached = this.scoreCache.get(fingerprint);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.scoreCache.delete(fingerprint);
      return null;
    }

    return cached.score;
  }

  private cacheScore(fingerprint: string, score: BotScore): void {
    // Enforce max cache size
    if (this.scoreCache.size >= this.config.maxCacheSize) {
      // Remove oldest entry (first in map)
      const firstKey = this.scoreCache.keys().next().value;
      if (firstKey) {
        this.scoreCache.delete(firstKey);
      }
    }

    this.scoreCache.set(fingerprint, {
      score,
      expiresAt: Date.now() + this.config.cacheTTLMs,
    });
  }

  private startCleanupInterval(): void {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      // Clean score cache
      for (const [key, value] of this.scoreCache) {
        if (now > value.expiresAt) {
          this.scoreCache.delete(key);
        }
      }

      // Clean request timings (keep last 5 minutes)
      const timingCutoff = now - 5 * 60 * 1000;
      for (const [key, value] of this.requestTimings) {
        if (value < timingCutoff) {
          this.requestTimings.delete(key);
        }
      }
    }, 60 * 1000);

    // Don't keep process alive for cleanup
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private getClientIP(request: FastifyRequest): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0]?.trim() ?? request.ip;
    }
    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0]?.split(',')[0]?.trim() ?? request.ip;
    }
    return request.ip;
  }

  private extractJA3(request: FastifyRequest): string | null {
    // JA3 is typically provided by load balancers/proxies
    // Check common header names
    const ja3Header = request.headers['x-ja3-hash'] ??
                      request.headers['x-ja3'] ??
                      request.headers['ja3-fingerprint'];

    if (typeof ja3Header === 'string') {
      return ja3Header;
    }

    return null;
  }
}

// =============================================================================
// Fastify Middleware
// =============================================================================

/**
 * Bot detection middleware options
 */
export interface BotDetectionMiddlewareOptions {
  /** Bot detection service instance */
  service?: BotDetectionService;
  /** Bot detection configuration (if not providing service) */
  config?: Partial<BotDetectionConfig>;
  /** Action to take: 'log' only logs, 'challenge' returns challenge, 'block' returns 403 */
  action: 'log' | 'challenge' | 'block';
  /** Paths to skip */
  skipPaths?: string[];
  /** Custom block response */
  blockResponse?: (score: BotScore) => { statusCode: number; body: Record<string, unknown> };
  /** Custom challenge response */
  challengeResponse?: (score: BotScore) => { statusCode: number; body: Record<string, unknown> };
  /** Lower rate limit for suspicious requests (multiplier, e.g., 0.5 = 50% of normal) */
  suspiciousRateLimitMultiplier?: number;
}

/**
 * Create bot detection middleware
 *
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * const botMiddleware = botDetectionMiddleware({
 *   action: 'block',
 *   config: {
 *     blockThreshold: 20,
 *     challengeThreshold: 50,
 *   },
 * });
 *
 * fastify.addHook('preHandler', botMiddleware);
 * ```
 */
export function botDetectionMiddleware(
  options: BotDetectionMiddlewareOptions
): preHandlerHookHandler {
  const service = options.service ?? new BotDetectionService(options.config);
  const skipPaths = new Set(options.skipPaths ?? service.getConfig().skipPaths);
  const action = options.action;

  const defaultBlockResponse = (score: BotScore) => ({
    statusCode: 403,
    body: {
      error: {
        code: 'BOT_DETECTED',
        message: 'Request blocked due to suspicious activity',
        recommendation: score.recommendation,
      },
    },
  });

  const defaultChallengeResponse = (score: BotScore) => ({
    statusCode: 429,
    body: {
      error: {
        code: 'BOT_CHALLENGE',
        message: 'Additional verification required',
        recommendation: score.recommendation,
        challengeToken: randomUUID(),
      },
    },
  });

  const blockResponse = options.blockResponse ?? defaultBlockResponse;
  const challengeResponse = options.challengeResponse ?? defaultChallengeResponse;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip configured paths
    const routeUrl = request.routeOptions?.url ?? '';
    if (skipPaths.has(request.url) || skipPaths.has(routeUrl)) {
      return;
    }

    // Analyze the request
    const score = await service.analyze(request);

    // Add score header if configured
    if (service.getConfig().addScoreHeader) {
      reply.header('X-Bot-Score', score.score.toString());
      reply.header('X-Bot-Recommendation', score.recommendation);
    }

    // Decorate request with score
    (request as FastifyRequest & { botScore?: BotScore }).botScore = score;

    // Apply rate limit modifier for suspicious requests
    if (options.suspiciousRateLimitMultiplier && score.recommendation === 'challenge') {
      const rateLimitInfo = (request as { rateLimitInfo?: { limit: number } }).rateLimitInfo;
      if (rateLimitInfo) {
        rateLimitInfo.limit = Math.floor(rateLimitInfo.limit * options.suspiciousRateLimitMultiplier);
      }
    }

    // Take action based on configuration
    if (action === 'log') {
      if (score.recommendation !== 'allow') {
        logger.info(
          {
            score: score.score,
            recommendation: score.recommendation,
            ip: request.ip,
            path: request.url,
            signalCount: score.signals.length,
          },
          'Suspicious bot activity detected'
        );
      }
      return;
    }

    if (action === 'block' && score.recommendation === 'block') {
      const response = blockResponse(score);
      return reply.status(response.statusCode).send(response.body);
    }

    if (action === 'challenge' && score.recommendation !== 'allow') {
      if (score.recommendation === 'block') {
        const response = blockResponse(score);
        return reply.status(response.statusCode).send(response.body);
      }
      const response = challengeResponse(score);
      return reply.status(response.statusCode).send(response.body);
    }
  };
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * Bot detection plugin options
 */
export interface BotDetectionPluginOptions extends BotDetectionMiddlewareOptions {
  /** Decorate Fastify instance with service */
  decorateInstance?: boolean;
}

/**
 * Bot detection Fastify plugin
 *
 * @example
 * ```typescript
 * await fastify.register(botDetectionPlugin, {
 *   action: 'block',
 *   config: {
 *     blockThreshold: 20,
 *   },
 * });
 *
 * // Access score in routes
 * fastify.get('/', (request, reply) => {
 *   const score = request.botScore;
 *   // ...
 * });
 * ```
 */
export const botDetectionPlugin = fp(
  (
    fastify: FastifyInstance,
    options: BotDetectionPluginOptions,
    done: (err?: Error) => void
  ) => {
    const service = options.service ?? new BotDetectionService(options.config);

    // Add middleware
    fastify.addHook('preHandler', botDetectionMiddleware({
      ...options,
      service,
    }));

    // Optionally decorate instance
    if (options.decorateInstance !== false) {
      fastify.decorate('botDetectionService', service);
    }

    // Cleanup on close
    fastify.addHook('onClose', () => {
      service.shutdown();
    });

    logger.info('Bot detection plugin registered');
    done();
  },
  {
    name: 'vorion-bot-detection',
    fastify: '5.x',
  }
);

// =============================================================================
// Type Declarations
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    botScore?: BotScore;
  }

  interface FastifyInstance {
    botDetectionService?: BotDetectionService;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let botDetectionInstance: BotDetectionService | null = null;

/**
 * Get or create singleton BotDetectionService instance
 *
 * @param config - Configuration (only used on first call)
 * @returns Singleton instance
 */
export function getBotDetectionService(
  config?: Partial<BotDetectionConfig>
): BotDetectionService {
  if (!botDetectionInstance) {
    botDetectionInstance = new BotDetectionService(config);
  }
  return botDetectionInstance;
}

/**
 * Reset singleton instance (primarily for testing)
 */
export function resetBotDetectionService(): void {
  if (botDetectionInstance) {
    botDetectionInstance.shutdown();
    botDetectionInstance = null;
  }
}

// =============================================================================
// Exports
// =============================================================================

export default BotDetectionService;
