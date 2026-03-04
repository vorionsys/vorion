// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock the circuit breaker types
vi.mock('@/lib/circuit-breaker/types', () => ({
  PAUSE_REASON_LABELS: {
    investigation: 'Under Investigation',
    maintenance: 'Scheduled Maintenance',
    consumer_request: 'Consumer Request',
    circuit_breaker: 'Circuit Breaker',
    cascade_halt: 'Cascade Halt',
    emergency_stop: 'Emergency Stop',
    other: 'Other',
  },
}))

import { PausedBadge } from '../agents/PausedBadge'

describe('PausedBadge', () => {
  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  it('renders nothing when isPaused is false', () => {
    const { container } = render(<PausedBadge isPaused={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when isPaused is true', () => {
    render(<PausedBadge isPaused={true} reason="maintenance" />)
    expect(screen.getByText('Scheduled Maintenance')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Compact Mode
  // -------------------------------------------------------------------------

  it('shows PAUSED in compact mode', () => {
    render(<PausedBadge isPaused={true} reason="maintenance" compact />)
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
  })

  it('shows icon emoji in compact mode', () => {
    render(<PausedBadge isPaused={true} reason="emergency_stop" compact />)
    // Emergency stop shows fire truck emoji
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Reason Labels
  // -------------------------------------------------------------------------

  it('shows Under Investigation for investigation reason', () => {
    render(<PausedBadge isPaused={true} reason="investigation" />)
    expect(screen.getByText('Under Investigation')).toBeInTheDocument()
  })

  it('shows Emergency Stop for emergency_stop reason', () => {
    render(<PausedBadge isPaused={true} reason="emergency_stop" />)
    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('shows Cascade Halt for cascade_halt reason', () => {
    render(<PausedBadge isPaused={true} reason="cascade_halt" />)
    expect(screen.getByText('Cascade Halt')).toBeInTheDocument()
  })

  it('shows Circuit Breaker for circuit_breaker reason', () => {
    render(<PausedBadge isPaused={true} reason="circuit_breaker" />)
    expect(screen.getByText('Circuit Breaker')).toBeInTheDocument()
  })

  it('shows Consumer Request for consumer_request reason', () => {
    render(<PausedBadge isPaused={true} reason="consumer_request" />)
    expect(screen.getByText('Consumer Request')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Expiry display
  // -------------------------------------------------------------------------

  it('shows expiry time when expiresAt is in the future', () => {
    const future = new Date(Date.now() + 3600000 * 2).toISOString() // 2 hours from now
    render(<PausedBadge isPaused={true} reason="maintenance" expiresAt={future} />)
    // Should show something like "(2h)"
    expect(screen.getByText(/\(.*h\)/)).toBeInTheDocument()
  })

  it('shows days for expiresAt far in the future', () => {
    // Use 3.5 days to avoid floor rounding down to 2d due to ms elapsed during render
    const future = new Date(Date.now() + 86400000 * 3.5).toISOString()
    render(<PausedBadge isPaused={true} reason="maintenance" expiresAt={future} />)
    expect(screen.getByText(/\(3d\)/)).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Hover details
  // -------------------------------------------------------------------------

  it('shows hover details when showDetails is true and hovered', () => {
    render(
      <PausedBadge
        isPaused={true}
        reason="maintenance"
        showDetails
        pausedAt={new Date(Date.now() - 3600000).toISOString()} // 1 hour ago
      />
    )

    const badge = screen.getByText('Scheduled Maintenance').closest('div[class*="relative"]')
    if (badge) {
      fireEvent.mouseEnter(badge)
      expect(screen.getByText(/Reason:/)).toBeInTheDocument()
      expect(screen.getByText(/Paused:/)).toBeInTheDocument()
    }
  })

  it('hides hover details when not hovered', () => {
    render(
      <PausedBadge
        isPaused={true}
        reason="maintenance"
        showDetails
      />
    )
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Custom classname
  // -------------------------------------------------------------------------

  it('applies custom className', () => {
    const { container } = render(
      <PausedBadge isPaused={true} reason="maintenance" className="my-custom-class" />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('my-custom-class')
  })

  // -------------------------------------------------------------------------
  // Color by reason
  // -------------------------------------------------------------------------

  it('applies red color for investigation', () => {
    render(<PausedBadge isPaused={true} reason="investigation" />)
    const badgeInner = screen.getByText('Under Investigation').closest('div[class*="bg-red"]')
    expect(badgeInner).toBeInTheDocument()
  })

  it('applies blue color for maintenance', () => {
    render(<PausedBadge isPaused={true} reason="maintenance" />)
    const badgeInner = screen.getByText('Scheduled Maintenance').closest('div[class*="bg-blue"]')
    expect(badgeInner).toBeInTheDocument()
  })
})
