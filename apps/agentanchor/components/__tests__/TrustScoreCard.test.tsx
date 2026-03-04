// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import TrustScoreCard from '../bot-trust/TrustScoreCard'

describe('TrustScoreCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('shows loading skeleton initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) // Never resolves
    const { container } = render(<TrustScoreCard botId="bot-1" />)
    const pulseEl = container.querySelector('.animate-pulse')
    expect(pulseEl).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Successful data load
  // -------------------------------------------------------------------------

  it('renders trust score when data loads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          trust_score: {
            score: 750,
            components: {
              decision_accuracy: 85,
              ethics_compliance: 90,
              training_success: 75,
              operational_stability: 80,
              peer_reviews: 70,
            },
            calculated_at: '2026-02-20T10:00:00Z',
          },
        }),
    })

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('750')).toBeInTheDocument()
    })

    expect(screen.getByText('/1000')).toBeInTheDocument()
    expect(screen.getByText('Certified')).toBeInTheDocument()
  })

  it('renders component breakdown', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          trust_score: {
            score: 500,
            components: {
              decision_accuracy: 80,
              ethics_compliance: 75,
              training_success: 60,
              operational_stability: 70,
              peer_reviews: 50,
            },
            calculated_at: '2026-02-20T10:00:00Z',
          },
        }),
    })

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('Decision Accuracy')).toBeInTheDocument()
    })

    expect(screen.getByText('Ethics Compliance')).toBeInTheDocument()
    expect(screen.getByText('Training Success')).toBeInTheDocument()
    expect(screen.getByText('Operational Stability')).toBeInTheDocument()
    expect(screen.getByText('Peer Reviews')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Score labels
  // -------------------------------------------------------------------------

  it('shows Sandbox label for score < 100', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          trust_score: {
            score: 50,
            components: { decision_accuracy: 10, ethics_compliance: 10, training_success: 10, operational_stability: 10, peer_reviews: 10 },
            calculated_at: '2026-02-20T10:00:00Z',
          },
        }),
    })

    render(<TrustScoreCard botId="bot-1" />)
    await waitFor(() => expect(screen.getByText('Sandbox')).toBeInTheDocument())
  })

  it('shows Trusted label for score 500-699', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          trust_score: {
            score: 550,
            components: { decision_accuracy: 60, ethics_compliance: 60, training_success: 60, operational_stability: 60, peer_reviews: 60 },
            calculated_at: '2026-02-20T10:00:00Z',
          },
        }),
    })

    render(<TrustScoreCard botId="bot-1" />)
    await waitFor(() => expect(screen.getByText('Trusted')).toBeInTheDocument())
  })

  it('shows Autonomous label for score >= 900', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          trust_score: {
            score: 950,
            components: { decision_accuracy: 95, ethics_compliance: 95, training_success: 95, operational_stability: 95, peer_reviews: 95 },
            calculated_at: '2026-02-20T10:00:00Z',
          },
        }),
    })

    render(<TrustScoreCard botId="bot-1" />)
    await waitFor(() => expect(screen.getByText('Autonomous')).toBeInTheDocument())
  })

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it('shows error message on API failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    })

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
    })
  })

  it('shows network error on fetch exception', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // 404 triggers calculate
  // -------------------------------------------------------------------------

  it('calculates trust score on 404', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Not found' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            trust_score: {
              score: 300,
              components: { decision_accuracy: 50, ethics_compliance: 50, training_success: 50, operational_stability: 50, peer_reviews: 50 },
              calculated_at: '2026-02-20T10:00:00Z',
            },
          }),
      })
    })

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('300')).toBeInTheDocument()
    })

    // Should have been called twice: once GET, once POST
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------------
  // Null trust score
  // -------------------------------------------------------------------------

  it('shows no trust score available when data is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ trust_score: null }),
    })

    render(<TrustScoreCard botId="bot-1" />)

    await waitFor(() => {
      expect(screen.getByText('No trust score available')).toBeInTheDocument()
    })
  })
})
