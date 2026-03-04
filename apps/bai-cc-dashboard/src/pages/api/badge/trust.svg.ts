/**
 * Trust Score Badge
 *
 * GET /api/badge/trust.svg
 * Returns an SVG badge showing average trust score with color coding.
 */
import type { APIRoute } from 'astro';
import { renderBadge, COLORS } from '../../../lib/badge';

export const prerender = false;

function scoreColor(score: number): string {
  if (score >= 800) return COLORS.brightgreen;
  if (score >= 500) return COLORS.green;
  if (score >= 350) return COLORS.yellow;
  if (score >= 200) return COLORS.orange;
  return COLORS.red;
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  let message = '?';
  let color: string = COLORS.lightgrey;

  try {
    const cached = await env?.BAI_CC_CACHE?.get('dashboard:public-stats');
    if (cached) {
      const stats = JSON.parse(cached);
      const avg = Number(stats.agents?.avg_score ?? 0);
      message = String(Math.round(avg));
      color = scoreColor(avg);
    }
  } catch {
    // Fall through with '?'
  }

  const svg = renderBadge({
    label: 'avg trust',
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
