/**
 * npm Downloads Badge
 *
 * GET /api/badge/npm.svg
 * Returns an SVG badge showing total weekly npm downloads across all @vorionsys packages.
 */
import type { APIRoute } from 'astro';
import { renderBadge, COLORS } from '../../../lib/badge';

export const prerender = false;

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  let message = '?';
  let color: string = COLORS.lightgrey;

  try {
    const cached = await env?.BAI_CC_CACHE?.get('dashboard:npm-stats');
    if (cached) {
      const stats = JSON.parse(cached);
      const total = Number(stats.totalDownloads ?? 0);
      message = `${formatDownloads(total)}/week`;
      color = total > 1000 ? COLORS.brightgreen : total > 100 ? COLORS.green : total > 0 ? COLORS.yellow : COLORS.lightgrey;
    }
  } catch {
    // Fall through with '?'
  }

  const svg = renderBadge({
    label: 'npm downloads',
    message,
    color,
  });

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
};
