/**
 * Agent Count Badge
 *
 * GET /api/badge/agents.svg
 * Returns an SVG badge showing total active agent count.
 */
import type { APIRoute } from 'astro';
import { renderBadge, COLORS } from '../../../lib/badge';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  let count = '?';

  try {
    const cached = await env?.BAI_CC_CACHE?.get('dashboard:public-stats');
    if (cached) {
      const stats = JSON.parse(cached);
      count = String(stats.agents?.total ?? 0);
    }
  } catch {
    // Fall through with '?'
  }

  const svg = renderBadge({
    label: 'agents',
    message: count,
    color: count === '?' ? COLORS.lightgrey : COLORS.blue,
  });

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
};
