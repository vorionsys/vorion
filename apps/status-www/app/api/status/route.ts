import { NextResponse } from 'next/server';
import { getServiceStatus } from '../../lib/status-client';

export const revalidate = 60;

export async function GET() {
  const data = await getServiceStatus();

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
    },
  });
}
