/**
 * Domain Health Fetcher
 *
 * HTTP HEAD probes all monitored domains in parallel with 3s timeout.
 * Includes SSL certificate expiry check via TLS connect where available.
 *
 * Ported from bai-cc-dashboard/functions/scheduled.ts syncDomainHealth().
 */
import { MONITORED_DOMAINS } from '../constants';
import type { DomainHealthEntry, DomainHealthResponse } from '../types';

/**
 * Attempt to get SSL certificate days remaining via Node.js TLS module.
 * Returns null if TLS inspection is not available (e.g., edge/serverless runtime).
 */
async function getSSLDaysRemaining(domain: string): Promise<number | null> {
  try {
    // Dynamic import — tls may not be available in all serverless runtimes
    const tls = await import('tls');
    return new Promise<number | null>((resolve) => {
      const socket = tls.connect(
        {
          host: domain,
          port: 443,
          servername: domain,
          timeout: 3000,
          rejectUnauthorized: false,
        },
        () => {
          try {
            const cert = (socket as any).getPeerCertificate?.();
            if (cert?.valid_to) {
              const expiryDate = new Date(cert.valid_to);
              const now = new Date();
              const diffMs = expiryDate.getTime() - now.getTime();
              const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
              socket.destroy();
              resolve(diffDays);
            } else {
              socket.destroy();
              resolve(null);
            }
          } catch {
            socket.destroy();
            resolve(null);
          }
        },
      );

      socket.on('error', () => {
        socket.destroy();
        resolve(null);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
    });
  } catch {
    // tls module not available in this runtime
    return null;
  }
}

/**
 * Probe a single domain via HTTP HEAD with a 3s timeout.
 */
async function probeDomain(
  entry: (typeof MONITORED_DOMAINS)[number],
): Promise<DomainHealthEntry> {
  const { domain, label, org } = entry;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`https://${domain}`, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - start;

    // Attempt SSL check in parallel (non-blocking — fallback to null)
    const sslDaysRemaining = await getSSLDaysRemaining(domain).catch(
      () => null,
    );

    return {
      domain,
      label,
      org,
      status: response.ok ? 'up' : 'degraded',
      statusCode: response.status,
      responseTimeMs,
      sslDaysRemaining,
    };
  } catch (err) {
    return {
      domain,
      label,
      org,
      status: 'down',
      statusCode: null,
      responseTimeMs: Date.now() - start,
      sslDaysRemaining: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Fetch domain health for all monitored domains.
 * All probes run in parallel for maximum speed.
 */
export async function fetchDomainHealth(): Promise<DomainHealthResponse> {
  const domains = await Promise.all(MONITORED_DOMAINS.map(probeDomain));

  const up = domains.filter((d) => d.status === 'up').length;
  const degraded = domains.filter((d) => d.status === 'degraded').length;
  const down = domains.filter((d) => d.status === 'down').length;
  const total = domains.length;

  const responseTimes = domains.map((d) => d.responseTimeMs);
  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length,
        )
      : 0;

  return {
    domains,
    summary: { total, up, degraded, down, avgResponseMs },
    timestamp: new Date().toISOString(),
  };
}
