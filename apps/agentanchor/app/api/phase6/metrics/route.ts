/**
 * Phase 6 Prometheus Metrics API
 *
 * Exposes metrics for monitoring Phase 6 Trust Engine performance.
 * Compatible with Prometheus scraping.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  incrementCounter,
  setGauge,
  observeHistogram,
  formatPrometheusMetrics,
  getCounters,
  getGauges,
} from '@/lib/phase6/metrics'

/**
 * GET /api/phase6/metrics
 * Prometheus metrics endpoint
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'prometheus'

  if (format === 'json') {
    // JSON format for debugging
    const counters = getCounters()
    const gauges = getGauges()

    const metrics = {
      counters: Object.fromEntries(
        Array.from(counters.entries()).map(([name, values]) => [
          name,
          Object.fromEntries(values),
        ])
      ),
      gauges: Object.fromEntries(
        Array.from(gauges.entries()).map(([name, values]) => [
          name,
          Object.fromEntries(values),
        ])
      ),
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(metrics)
  }

  // Prometheus format (default)
  const metricsText = formatPrometheusMetrics()

  return new Response(metricsText, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  })
}

/**
 * POST /api/phase6/metrics
 * Record a metric (internal use)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, name, value, labels } = body

    switch (type) {
      case 'counter':
        incrementCounter(name, labels, value)
        break
      case 'gauge':
        setGauge(name, value, labels)
        break
      case 'histogram':
        observeHistogram(name, value, labels)
        break
      default:
        return NextResponse.json(
          { error: `Invalid metric type: ${type}` },
          { status: 400 }
        )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
