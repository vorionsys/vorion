/**
 * Health Command
 *
 * Check health status of Vorion deployment.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';

/**
 * Default health check URL
 */
const DEFAULT_BASE_URL = 'http://localhost:3000';

interface CheckOptions {
  url: string;
  timeout: string;
  all: boolean;
  endpoint?: string;
  json: boolean;
}

interface WatchOptions {
  url: string;
  interval: string;
  timeout: string;
}

interface WaitOptions {
  url: string;
  timeout: string;
  interval: string;
  startup: boolean;
}

interface DetailsOptions {
  url: string;
  json: boolean;
}

/**
 * Health check endpoints
 */
const HEALTH_ENDPOINTS = {
  live: '/health/live',
  ready: '/health/ready',
  startup: '/health/startup',
  detailed: '/health',
  intent: '/api/v1/intent/health',
  intentReady: '/api/v1/intent/ready',
};

interface HealthCheckResult {
  endpoint: string;
  status: 'pass' | 'fail' | 'error';
  statusCode?: number;
  responseTime: number;
  data?: unknown;
  error?: string;
}

/**
 * Perform a health check request
 */
async function checkEndpoint(
  baseUrl: string,
  endpoint: string,
  timeout: number
): Promise<HealthCheckResult> {
  const url = `${baseUrl}${endpoint}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - start;
    let data: unknown;

    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }

    return {
      endpoint,
      status: response.ok ? 'pass' : 'fail',
      statusCode: response.status,
      responseTime,
      data,
    };
  } catch (error) {
    const responseTime = Date.now() - start;
    let errorMessage = 'Unknown error';

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = `Request timed out after ${timeout}ms`;
      } else {
        errorMessage = error.message;
      }
    }

    return {
      endpoint,
      status: 'error',
      responseTime,
      error: errorMessage,
    };
  }
}

/**
 * Format status with color
 */
function formatStatus(status: 'pass' | 'fail' | 'error'): string {
  switch (status) {
    case 'pass':
      return '\x1b[32mPASS\x1b[0m';
    case 'fail':
      return '\x1b[31mFAIL\x1b[0m';
    case 'error':
      return '\x1b[33mERROR\x1b[0m';
  }
}

export const healthCommand = new Command('health')
  .description('Check health status of Vorion deployment')
  .addHelpText(
    'after',
    `
Examples:
  # Run basic health checks
  $ vorion health check

  # Check all endpoints
  $ vorion health check -a

  # Continuously monitor health
  $ vorion health watch

  # Wait for Vorion to become healthy
  $ vorion health wait -t 120

  # Show detailed health information
  $ vorion health details

For more information, see: https://docs.vorion.io/operations/health-checks
`
  );

healthCommand
  .command('check')
  .description('Run health checks against Vorion API')
  .option('-u, --url <url>', 'Base URL for health checks', DEFAULT_BASE_URL)
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '5000')
  .option('-a, --all', 'Run all health checks', false)
  .option('-e, --endpoint <endpoint>', 'Specific endpoint to check (live, ready, startup, detailed, intent)')
  .option('--json', 'Output results as JSON', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion health check
  $ vorion health check -a              # All endpoints
  $ vorion health check -e ready        # Specific endpoint
  $ vorion health check --json          # JSON output
`
  )
  .action(async (options: CheckOptions) => {
    const baseUrl = options.url;
    const timeout = parseInt(options.timeout, 10);
    const results: HealthCheckResult[] = [];

    console.log(`\nChecking Vorion health at ${baseUrl}\n`);

    // Determine which endpoints to check
    let endpointsToCheck: Array<[string, string]>;

    if (options.endpoint) {
      const endpoint = HEALTH_ENDPOINTS[options.endpoint as keyof typeof HEALTH_ENDPOINTS];
      if (!endpoint) {
        console.error(`Error: Unknown endpoint: ${options.endpoint}`);
        console.error(`Available endpoints: ${Object.keys(HEALTH_ENDPOINTS).join(', ')}`);
        process.exit(1);
      }
      endpointsToCheck = [[options.endpoint, endpoint]];
    } else if (options.all) {
      endpointsToCheck = Object.entries(HEALTH_ENDPOINTS);
    } else {
      // Default: check main health endpoints
      endpointsToCheck = [
        ['live', HEALTH_ENDPOINTS.live],
        ['ready', HEALTH_ENDPOINTS.ready],
        ['detailed', HEALTH_ENDPOINTS.detailed],
      ];
    }

    // Run health checks
    for (const [name, endpoint] of endpointsToCheck) {
      const result = await checkEndpoint(baseUrl, endpoint, timeout);
      results.push(result);

      if (!options.json) {
        const statusStr = formatStatus(result.status);
        const timeStr = `${result.responseTime}ms`;
        const codeStr = result.statusCode ? `(${result.statusCode})` : '';

        console.log(`  ${statusStr}  ${name.padEnd(12)} ${timeStr.padStart(6)} ${codeStr}`);

        if (result.error) {
          console.log(`         \x1b[33m${result.error}\x1b[0m`);
        }
      }
    }

    // Output JSON if requested
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Summary
      const passed = results.filter((r) => r.status === 'pass').length;
      const failed = results.filter((r) => r.status === 'fail').length;
      const errors = results.filter((r) => r.status === 'error').length;

      console.log();
      console.log(`Summary: ${passed} passed, ${failed} failed, ${errors} errors`);

      // Exit code based on results
      if (failed > 0 || errors > 0) {
        process.exit(1);
      }
    }
  });

healthCommand
  .command('watch')
  .description('Continuously monitor health status')
  .option('-u, --url <url>', 'Base URL for health checks', DEFAULT_BASE_URL)
  .option('-i, --interval <seconds>', 'Check interval in seconds', '5')
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '5000')
  .addHelpText(
    'after',
    `
Examples:
  $ vorion health watch                   # Monitor every 5s
  $ vorion health watch -i 10             # Monitor every 10s
  $ vorion health watch -u http://api:3000
`
  )
  .action(async (options: WatchOptions) => {
    const baseUrl = options.url;
    const interval = parseInt(options.interval, 10) * 1000;
    const timeout = parseInt(options.timeout, 10);

    console.log(`\nWatching Vorion health at ${baseUrl}`);
    console.log(`Checking every ${options.interval}s (Ctrl+C to stop)\n`);

    // Clear line and move cursor
    const clearLine = '\x1b[2K\r';

    const checkHealth = async () => {
      const results = await Promise.all([
        checkEndpoint(baseUrl, HEALTH_ENDPOINTS.live, timeout),
        checkEndpoint(baseUrl, HEALTH_ENDPOINTS.ready, timeout),
      ]);

      const [live, ready] = results;
      const timestamp = new Date().toLocaleTimeString();

      const liveStatus = live.status === 'pass' ? '\x1b[32mLIVE\x1b[0m' : '\x1b[31mDOWN\x1b[0m';
      const readyStatus = ready.status === 'pass' ? '\x1b[32mREADY\x1b[0m' : '\x1b[31mNOT READY\x1b[0m';

      process.stdout.write(
        `${clearLine}[${timestamp}] ${liveStatus} | ${readyStatus} | ` +
        `Live: ${live.responseTime}ms | Ready: ${ready.responseTime}ms`
      );
    };

    // Initial check
    await checkHealth();

    // Continuous monitoring
    setInterval(checkHealth, interval);
  });

healthCommand
  .command('wait')
  .description('Wait for Vorion to become healthy')
  .option('-u, --url <url>', 'Base URL for health checks', DEFAULT_BASE_URL)
  .option('-t, --timeout <seconds>', 'Maximum time to wait', '60')
  .option('-i, --interval <seconds>', 'Check interval', '2')
  .option('--startup', 'Wait for startup probe (slower, checks dependencies)', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion health wait                    # Wait up to 60s
  $ vorion health wait -t 120             # Wait up to 120s
  $ vorion health wait --startup          # Wait for full startup
`
  )
  .action(async (options: WaitOptions) => {
    const baseUrl = options.url;
    const maxTimeout = parseInt(options.timeout, 10) * 1000;
    const interval = parseInt(options.interval, 10) * 1000;
    const endpoint = options.startup ? HEALTH_ENDPOINTS.startup : HEALTH_ENDPOINTS.live;

    console.log(`Waiting for Vorion to become healthy at ${baseUrl}...`);

    const startTime = Date.now();

    while (Date.now() - startTime < maxTimeout) {
      const result = await checkEndpoint(baseUrl, endpoint, 5000);

      if (result.status === 'pass') {
        console.log(`\n\x1b[32mVorion is healthy!\x1b[0m (took ${Date.now() - startTime}ms)`);
        process.exit(0);
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      process.stdout.write(`\rWaiting... (${elapsed}s)`);

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    console.log(`\n\x1b[31mTimeout: Vorion did not become healthy within ${options.timeout}s\x1b[0m`);
    process.exit(1);
  });

healthCommand
  .command('details')
  .description('Show detailed health information')
  .option('-u, --url <url>', 'Base URL for health checks', DEFAULT_BASE_URL)
  .option('--json', 'Output as JSON', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion health details                 # Show all details
  $ vorion health details --json          # JSON output
`
  )
  .action(async (options: DetailsOptions) => {
    const baseUrl = options.url;

    const result = await checkEndpoint(baseUrl, HEALTH_ENDPOINTS.detailed, 10000);

    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
      process.exit(result.status === 'pass' ? 0 : 1);
    }

    if (result.status === 'error') {
      console.error(`\x1b[31mError: ${result.error}\x1b[0m`);
      process.exit(1);
    }

    const data = result.data as Record<string, unknown>;

    console.log(`\nVorion Health Details\n`);
    console.log(`  Status: ${data.status === 'healthy' ? '\x1b[32mhealthy\x1b[0m' : '\x1b[31munhealthy\x1b[0m'}`);
    console.log(`  Mode: ${data.mode || 'unknown'}`);
    console.log(`  Version: ${data.version || 'unknown'}`);
    console.log(`  Environment: ${data.environment || 'unknown'}`);
    console.log(`  Uptime: ${data.uptime || 'unknown'}s`);

    if (data.checks && typeof data.checks === 'object') {
      console.log(`\n  Component Status:`);
      for (const [component, check] of Object.entries(data.checks as Record<string, unknown>)) {
        const checkData = check as Record<string, unknown>;
        const status = checkData.status === 'ok' || checkData.status === 'skipped'
          ? '\x1b[32mOK\x1b[0m'
          : '\x1b[31mFAIL\x1b[0m';
        const latency = checkData.latencyMs ? ` (${checkData.latencyMs}ms)` : '';
        console.log(`    ${component}: ${status}${latency}`);
        if (checkData.message) {
          console.log(`      ${checkData.message}`);
        }
      }
    }

    if (data.process && typeof data.process === 'object') {
      const proc = data.process as Record<string, unknown>;
      console.log(`\n  Process:`);
      console.log(`    Uptime: ${proc.uptimeSeconds}s`);
      if (proc.memoryMb && typeof proc.memoryMb === 'object') {
        const mem = proc.memoryMb as Record<string, number>;
        console.log(`    Memory: ${mem.heapUsed}MB / ${mem.heapTotal}MB heap, ${mem.rss}MB RSS`);
      }
    }

    console.log();
    process.exit(result.status === 'pass' ? 0 : 1);
  });
