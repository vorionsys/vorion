/**
 * CI Status Badge
 *
 * GET /api/badge/ci.svg
 * Returns an SVG badge showing overall CI pipeline status.
 */
import type { APIRoute } from 'astro';
import { renderBadge, COLORS } from '../../../lib/badge';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  let message = 'unknown';
  let color: string = COLORS.lightgrey;

  try {
    const cached = await env?.BAI_CC_CACHE?.get('dashboard:ci-status');
    if (cached) {
      const data = JSON.parse(cached);
      const workflows: Array<{ status: string }> = data.workflows ?? [];

      const failCount = workflows.filter(w => w.status === 'failure').length;
      const passCount = workflows.filter(w => w.status === 'success').length;
      const total = workflows.length;

      if (failCount > 0) {
        message = `${failCount} failing`;
        color = COLORS.red;
      } else if (passCount === total && total > 0) {
        message = 'passing';
        color = COLORS.brightgreen;
      } else if (passCount > 0) {
        message = `${passCount}/${total} passing`;
        color = COLORS.yellow;
      }
    }
  } catch {
    // Fall through with 'unknown'
  }

  const svg = renderBadge({
    label: 'CI',
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
