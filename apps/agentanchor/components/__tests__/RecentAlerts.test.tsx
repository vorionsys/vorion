// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock compliance types
vi.mock('@/lib/compliance/types', () => ({}))

import { RecentAlerts } from '../compliance/RecentAlerts'

const createAlert = (overrides: Record<string, any> = {}) => ({
  id: 'alert-1',
  timestamp: new Date('2026-02-20T10:00:00Z'),
  framework: 'soc2' as const,
  controlId: 'CC6.1',
  severity: 'high' as const,
  title: 'Access Control Violation',
  description: 'Unauthorized access attempt detected',
  acknowledged: false,
  ...overrides,
})

describe('RecentAlerts', () => {
  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('shows empty state when no alerts', () => {
    render(<RecentAlerts alerts={[]} />)
    expect(screen.getByText('No active alerts')).toBeInTheDocument()
    expect(screen.getByText('All systems operating within compliance parameters')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Alert display
  // -------------------------------------------------------------------------

  it('renders alerts with severity badge', () => {
    render(<RecentAlerts alerts={[createAlert()]} />)
    expect(screen.getByText('HIGH')).toBeInTheDocument()
  })

  it('renders alert title and description', () => {
    render(<RecentAlerts alerts={[createAlert()]} />)
    expect(screen.getByText('Access Control Violation')).toBeInTheDocument()
    expect(screen.getByText('Unauthorized access attempt detected')).toBeInTheDocument()
  })

  it('renders framework in uppercase', () => {
    render(<RecentAlerts alerts={[createAlert()]} />)
    expect(screen.getByText('SOC2')).toBeInTheDocument()
  })

  it('renders control ID', () => {
    render(<RecentAlerts alerts={[createAlert()]} />)
    expect(screen.getByText('CC6.1')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Severity colors
  // -------------------------------------------------------------------------

  it('renders critical severity with red styling', () => {
    render(<RecentAlerts alerts={[createAlert({ severity: 'critical' })]} />)
    const badge = screen.getByText('CRITICAL')
    expect(badge.className).toContain('bg-red')
  })

  it('renders high severity with orange styling', () => {
    render(<RecentAlerts alerts={[createAlert({ severity: 'high' })]} />)
    const badge = screen.getByText('HIGH')
    expect(badge.className).toContain('bg-orange')
  })

  it('renders medium severity with yellow styling', () => {
    render(<RecentAlerts alerts={[createAlert({ severity: 'medium' })]} />)
    const badge = screen.getByText('MEDIUM')
    expect(badge.className).toContain('bg-yellow')
  })

  it('renders low severity with blue styling', () => {
    render(<RecentAlerts alerts={[createAlert({ severity: 'low' })]} />)
    const badge = screen.getByText('LOW')
    expect(badge.className).toContain('bg-blue')
  })

  // -------------------------------------------------------------------------
  // Acknowledged state
  // -------------------------------------------------------------------------

  it('shows Acknowledge button for unacknowledged alerts', () => {
    render(<RecentAlerts alerts={[createAlert({ acknowledged: false })]} />)
    expect(screen.getByText('Acknowledge')).toBeInTheDocument()
  })

  it('hides Acknowledge button for acknowledged alerts', () => {
    render(
      <RecentAlerts
        alerts={[createAlert({ acknowledged: true, acknowledgedBy: 'admin@example.com' })]}
      />
    )
    expect(screen.queryByText('Acknowledge')).not.toBeInTheDocument()
    expect(screen.getByText("Ack'd by admin@example.com")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Unacknowledged count
  // -------------------------------------------------------------------------

  it('shows unacknowledged count', () => {
    const alerts = [
      createAlert({ id: '1', acknowledged: false }),
      createAlert({ id: '2', acknowledged: true }),
      createAlert({ id: '3', acknowledged: false }),
    ]
    render(<RecentAlerts alerts={alerts} />)
    expect(screen.getByText('2 unacknowledged')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Multiple alerts
  // -------------------------------------------------------------------------

  it('renders multiple alerts', () => {
    const alerts = [
      createAlert({ id: '1', title: 'Alert One' }),
      createAlert({ id: '2', title: 'Alert Two' }),
    ]
    render(<RecentAlerts alerts={alerts} />)
    expect(screen.getByText('Alert One')).toBeInTheDocument()
    expect(screen.getByText('Alert Two')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<RecentAlerts alerts={[]} className="my-class" />)
    expect(container.firstChild).toHaveClass('my-class')
  })
})
