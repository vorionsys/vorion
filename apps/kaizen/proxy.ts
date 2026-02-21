import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Domain-based routing proxy (Next.js 16+)
 *
 * learn.vorion.org -> Main learning platform (default)
 * kaizen.vorion.org -> Interactive AI learning experience (starts at /studio)
 */
export function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // Only redirect on root path to avoid infinite loops
  if (pathname !== '/') {
    return NextResponse.next();
  }

  // kaizen.vorion.org starts at the studio/interactive learning experience
  if (hostname.includes('kaizen.vorion.org') || hostname.includes('kaizen.')) {
    return NextResponse.redirect(new URL('/studio', request.url));
  }

  // learn.vorion.org stays at default home
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match root path only for domain-based redirects
    '/',
  ],
};
