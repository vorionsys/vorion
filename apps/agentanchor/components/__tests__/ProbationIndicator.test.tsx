// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock lucide-react
vi.mock('lucide-react', () => {
  const Icon = ({ className, ...props }: any) => <svg className={className} data-testid="icon" {...props} />
  return {
    AlertTriangle: Icon,
    Clock: Icon,
    ShieldOff: Icon,
  }
})

import ProbationIndicator, { ProbationCard } from '../agents/ProbationIndicator'

describe('ProbationIndicator', () => {
  it('renders with default size md', () => {
    const { container } = render(<ProbationIndicator daysRemaining={14} />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-sm')
  })

  it('renders On Probation text', () => {
    render(<ProbationIndicator daysRemaining={14} />)
    expect(screen.getByText('On Probation')).toBeInTheDocument()
  })

  it('does not show details by default', () => {
    render(<ProbationIndicator daysRemaining={14} />)
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument()
  })

  it('shows days remaining when showDetails is true', () => {
    render(<ProbationIndicator daysRemaining={14} showDetails />)
    expect(screen.getByText('14 days left')).toBeInTheDocument()
  })

  it('shows correct days for different values', () => {
    render(<ProbationIndicator daysRemaining={3} showDetails />)
    expect(screen.getByText('3 days left')).toBeInTheDocument()
  })

  it('applies sm size classes', () => {
    const { container } = render(<ProbationIndicator daysRemaining={14} size="sm" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-xs')
  })

  it('applies lg size classes', () => {
    const { container } = render(<ProbationIndicator daysRemaining={14} size="lg" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-base')
  })

  it('has a title attribute', () => {
    const { container } = render(<ProbationIndicator daysRemaining={7} />)
    const badge = container.firstChild as HTMLElement
    expect(badge.getAttribute('title')).toContain('7 days remaining')
  })
})

describe('ProbationCard', () => {
  it('renders the card with heading', () => {
    render(<ProbationCard daysRemaining={30} />)
    expect(screen.getByText('Agent On Probation')).toBeInTheDocument()
  })

  it('shows days remaining', () => {
    render(<ProbationCard daysRemaining={30} />)
    expect(screen.getByText('30 days remaining')).toBeInTheDocument()
  })

  it('lists probation restrictions', () => {
    render(<ProbationCard daysRemaining={30} />)
    expect(screen.getByText('Cannot execute autonomous actions')).toBeInTheDocument()
    expect(screen.getByText('All actions require human approval')).toBeInTheDocument()
    expect(screen.getByText('Enhanced monitoring enabled')).toBeInTheDocument()
  })

  it('displays explanation text', () => {
    render(<ProbationCard daysRemaining={30} />)
    expect(screen.getByText(/significant trust score decline/)).toBeInTheDocument()
  })
})
