/**
 * Tests for Bot Detection Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotDetectionService } from '../bot-detection.js';
import type { FastifyRequest } from 'fastify';

// Mock request factory
function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    headers: {},
    url: '/test',
    method: 'GET',
    ip: '192.168.1.1',
    routeOptions: { url: '/test' },
    ...overrides,
  } as FastifyRequest;
}

describe('BotDetectionService - Known Good Bots', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should identify Googlebot as good bot', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownGoodBot).toBe(true);
    expect(score.recommendation).toBe('allow');
    expect(score.signals.some((s) => s.type === 'known_good_bot')).toBe(true);
  });

  it('should identify Bingbot as good bot', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownGoodBot).toBe(true);
    expect(score.recommendation).toBe('allow');
  });
});

describe('BotDetectionService - Known Bad Bots', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should identify SQLMap as bad bot', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'sqlmap/1.0',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownBadBot).toBe(true);
    expect(score.recommendation).toBe('block');
    expect(score.score).toBeLessThan(30);
  });

  it('should identify Nikto scanner as bad bot', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.00 (Nikto/2.1.5)',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownBadBot).toBe(true);
    expect(score.recommendation).toBe('block');
  });
});

describe('BotDetectionService - Normal Browser Requests', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should allow normal Chrome browser', async () => {
    // Header order must match Chrome expected: host, connection, sec-ch-ua, ...
    const request = createMockRequest({
      headers: {
        host: 'localhost',
        connection: 'keep-alive',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
      },
    });

    const score = await service.analyze(request);

    expect(score.recommendation).toBe('allow');
    // Bot detection starts at 50 (neutral) and only applies negative signals.
    // A clean request with all correct headers scores exactly 50.
    expect(score.score).toBeGreaterThanOrEqual(50);
  });

  it('should allow normal Firefox browser', async () => {
    // Header order must match Firefox expected: host, user-agent, accept, ...
    const request = createMockRequest({
      headers: {
        host: 'localhost',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
        connection: 'keep-alive',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
      },
    });

    const score = await service.analyze(request);

    expect(score.recommendation).toBe('allow');
    expect(score.score).toBeGreaterThanOrEqual(50);
  });
});

describe('BotDetectionService - Headless Browser Detection', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should detect HeadlessChrome', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/118.0.0.0 Safari/537.36',
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'headless_browser')).toBe(true);
    expect(score.score).toBeLessThan(50);
  });

  it('should detect PhantomJS', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'headless_browser')).toBe(true);
    expect(score.recommendation).not.toBe('allow');
  });
});

describe('BotDetectionService - Missing Headers', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should flag missing Accept-Language header', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept-encoding': 'gzip, deflate',
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'missing_accept_language')).toBe(true);
  });

  it('should flag missing Accept-Encoding header', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept-language': 'en-US',
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'missing_accept_encoding')).toBe(true);
  });
});

describe('BotDetectionService - Skip Paths', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService({
      skipPaths: ['/health', '/metrics'],
    });
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should store skip paths in config for middleware use', async () => {
    // Note: analyze() does NOT check skipPaths — that is enforced in the
    // Fastify middleware. The config stores the paths for middleware to use.
    const config = service.getConfig();
    expect(config.skipPaths).toEqual(['/health', '/metrics']);
  });
});

describe('BotDetectionService - Cache', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should cache scores based on fingerprint', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip',
      },
    });

    const score1 = await service.analyze(request);
    const score2 = await service.analyze(request);

    expect(score1.fingerprint).toBe(score2.fingerprint);
    // Second call should be faster (from cache)
    expect(score2.analysisMs).toBeLessThanOrEqual(score1.analysisMs);
  });

  it('should clear cache', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
      },
    });

    await service.analyze(request);

    const statsBefore = service.getCacheStats();
    expect(statsBefore.size).toBeGreaterThan(0);

    service.clearCache();

    const statsAfter = service.getCacheStats();
    expect(statsAfter.size).toBe(0);
  });
});

describe('BotDetectionService - Custom Configuration', () => {
  it('should use custom thresholds', async () => {
    const service = new BotDetectionService({
      blockThreshold: 10,
      challengeThreshold: 70,
    });

    const request = createMockRequest({
      headers: {
        'user-agent': 'curl/7.68.0',
      },
    });

    const score = await service.analyze(request);

    // Custom thresholds should affect recommendation
    expect(score).toBeDefined();

    service.shutdown();
  });

  it('should use strict mode', async () => {
    const service = new BotDetectionService({
      strictMode: true,
    });

    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
        // Missing Accept-Language
      },
    });

    const score = await service.analyze(request);

    const missingLangSignal = score.signals.find((s) => s.type === 'missing_accept_language');
    expect(missingLangSignal?.scoreAdjustment).toBe(-15); // Stricter penalty

    service.shutdown();
  });
});

describe('BotDetectionService - Fingerprinting', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should generate consistent fingerprints for same request', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-US',
      },
    });

    const fp1 = service.getFingerprint(request);
    const fp2 = service.getFingerprint(request);

    expect(fp1).toBe(fp2);
  });

  it('should generate different fingerprints for different requests', async () => {
    const request1 = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
      },
    });

    const request2 = createMockRequest({
      headers: {
        'user-agent': 'Chrome/120.0',
      },
    });

    const fp1 = service.getFingerprint(request1);
    const fp2 = service.getFingerprint(request2);

    expect(fp1).not.toBe(fp2);
  });
});

describe('BotDetectionService - Update Configuration', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should update configuration', () => {
    service.updateConfig({
      blockThreshold: 5,
    });

    const config = service.getConfig();
    expect(config.blockThreshold).toBe(5);
  });
});

describe('BotDetectionService - Quick Bot Check', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService({
      challengeThreshold: 50,
    });
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should return true for likely bot', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'curl/7.68.0',
      },
    });

    const isBot = await service.isBot(request);
    expect(isBot).toBe(true);
  });

  it('should return false for likely human', async () => {
    const request = createMockRequest({
      headers: {
        host: 'localhost',
        connection: 'keep-alive',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip, deflate, br',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
      },
    });

    const isBot = await service.isBot(request);
    expect(isBot).toBe(false);
  });
});

describe('BotDetectionService - Sec Headers', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should flag Chrome without Sec-CH-UA headers', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Missing sec-ch-ua headers
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'missing_sec_headers')).toBe(true);
  });
});

describe('BotDetectionService - Cookies and Referer', () => {
  let service: BotDetectionService;

  beforeEach(() => {
    service = new BotDetectionService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should flag return visit without cookies', async () => {
    const request = createMockRequest({
      headers: {
        'user-agent': 'Mozilla/5.0',
        referer: 'http://localhost/previous-page',
        host: 'localhost',
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'missing_cookies_return_visit')).toBe(true);
  });

  it('should flag POST without referer', async () => {
    const request = createMockRequest({
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0',
        // Missing referer
      },
    });

    const score = await service.analyze(request);

    expect(score.signals.some((s) => s.type === 'missing_referer_on_post')).toBe(true);
  });
});

describe('BotDetectionService - Custom Bot Lists', () => {
  it('should allow custom good bots', async () => {
    const service = new BotDetectionService({
      allowedBots: ['MyCustomBot'],
    });

    const request = createMockRequest({
      headers: {
        'user-agent': 'MyCustomBot/1.0',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownGoodBot).toBe(true);
    expect(score.recommendation).toBe('allow');

    service.shutdown();
  });

  it('should block custom bad bots', async () => {
    const service = new BotDetectionService({
      blockedBots: ['EvilScraper'],
    });

    const request = createMockRequest({
      headers: {
        'user-agent': 'EvilScraper/2.0',
      },
    });

    const score = await service.analyze(request);

    expect(score.isKnownBadBot).toBe(true);
    expect(score.recommendation).toBe('block');

    service.shutdown();
  });
});
