/**
 * npm Stats Fetcher
 *
 * Fetches weekly download counts, latest version, and last publish date
 * from the npm downloads API and registry for all @vorionsys packages.
 *
 * Ported from bai-cc-dashboard/functions/scheduled.ts syncNpmStats()
 * with additional registry metadata (version, publish date, deprecation).
 */
import { MONITORED_PACKAGES } from '../constants';
import type { NpmPackageEntry, NpmStatsResponse } from '../types';

/** npm downloads API response shape */
interface NpmDownloadsResponse {
  downloads?: number;
  package?: string;
}

/** npm registry abbreviated metadata shape */
interface NpmRegistryResponse {
  'dist-tags'?: { latest?: string };
  time?: Record<string, string>;
  versions?: Record<string, { deprecated?: string }>;
}

/**
 * Fetch stats for a single npm package.
 * Queries both the downloads API and the registry in parallel.
 */
async function fetchPackageStats(
  pkg: (typeof MONITORED_PACKAGES)[number],
): Promise<NpmPackageEntry> {
  const encodedName = encodeURIComponent(pkg.name);

  const defaultResult: NpmPackageEntry = {
    name: pkg.name,
    label: pkg.label,
    latestVersion: 'unknown',
    weeklyDownloads: 0,
    lastPublished: null,
    deprecated: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // Fetch downloads and registry metadata in parallel
    const [downloadsRes, registryRes] = await Promise.all([
      fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodedName}`,
        { signal: controller.signal },
      ).catch(() => null),
      fetch(`https://registry.npmjs.org/${encodedName}`, {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        signal: controller.signal,
      }).catch(() => null),
    ]);

    clearTimeout(timeout);

    // Parse downloads
    let weeklyDownloads = 0;
    if (downloadsRes?.ok) {
      const dlData = (await downloadsRes.json()) as NpmDownloadsResponse;
      weeklyDownloads = dlData.downloads ?? 0;
    }

    // Parse registry metadata
    let latestVersion = 'unknown';
    let lastPublished: string | null = null;
    let deprecated = false;

    if (registryRes?.ok) {
      const regData = (await registryRes.json()) as NpmRegistryResponse;
      latestVersion = regData['dist-tags']?.latest ?? 'unknown';

      // Get last publish date from the time field
      if (regData.time && latestVersion !== 'unknown') {
        lastPublished = regData.time[latestVersion] ?? regData.time.modified ?? null;
      }

      // Check if latest version is deprecated
      if (
        regData.versions &&
        latestVersion !== 'unknown' &&
        regData.versions[latestVersion]?.deprecated
      ) {
        deprecated = true;
      }
    }

    return {
      name: pkg.name,
      label: pkg.label,
      latestVersion,
      weeklyDownloads,
      lastPublished,
      deprecated,
    };
  } catch (err) {
    console.warn(
      `npm stats fetch failed for ${pkg.name}:`,
      err instanceof Error ? err.message : err,
    );
    return defaultResult;
  }
}

/**
 * Fetch npm stats for all monitored packages in parallel.
 */
export async function fetchNpmStats(): Promise<NpmStatsResponse> {
  const packages = await Promise.all(
    MONITORED_PACKAGES.map(fetchPackageStats),
  );

  const totalDownloads = packages.reduce(
    (sum, pkg) => sum + pkg.weeklyDownloads,
    0,
  );

  return {
    packages,
    totalDownloads,
    timestamp: new Date().toISOString(),
  };
}
