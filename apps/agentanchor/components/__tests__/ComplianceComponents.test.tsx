// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock compliance types
vi.mock('@/lib/compliance/types', () => ({}))

import { ComplianceScoreCard } from '../compliance/ComplianceScoreCard'
import { FrameworkStatus } from '../compliance/FrameworkStatus'
import { RiskOverview } from '../compliance/RiskOverview'

// =============================================================================
// ComplianceScoreCard
// =============================================================================

describe('ComplianceScoreCard', () => {
  it('renders the title', () => {
    render(<ComplianceScoreCard title="Data Protection" score={85} trend="improving" icon="shield" />)
    expect(screen.getByText('Data Protection')).toBeInTheDocument()
  })

  it('renders the score with percent sign', () => {
    render(<ComplianceScoreCard title="Test" score={92} trend="stable" icon="lock" />)
    expect(screen.getByText('92')).toBeInTheDocument()
    expect(screen.getByText('%')).toBeInTheDocument()
  })

  it('shows green color for high score (>= 80)', () => {
    render(<ComplianceScoreCard title="Test" score={85} trend="stable" icon="shield" />)
    const scoreEl = screen.getByText('85')
    expect(scoreEl.className).toContain('text-green-500')
  })

  it('shows yellow color for medium score (60-79)', () => {
    render(<ComplianceScoreCard title="Test" score={70} trend="stable" icon="shield" />)
    const scoreEl = screen.getByText('70')
    expect(scoreEl.className).toContain('text-yellow-500')
  })

  it('shows red color for low score (< 60)', () => {
    render(<ComplianceScoreCard title="Test" score={45} trend="stable" icon="shield" />)
    const scoreEl = screen.getByText('45')
    expect(scoreEl.className).toContain('text-red-500')
  })

  it('shows improving trend', () => {
    render(<ComplianceScoreCard title="Test" score={85} trend="improving" icon="shield" />)
    expect(screen.getByText('improving')).toBeInTheDocument()
  })

  it('shows declining trend', () => {
    render(<ComplianceScoreCard title="Test" score={50} trend="declining" icon="shield" />)
    expect(screen.getByText('declining')).toBeInTheDocument()
  })

  it('shows stable trend', () => {
    render(<ComplianceScoreCard title="Test" score={75} trend="stable" icon="shield" />)
    expect(screen.getByText('stable')).toBeInTheDocument()
  })

  it('renders progress bar with correct width', () => {
    const { container } = render(
      <ComplianceScoreCard title="Test" score={75} trend="stable" icon="shield" />
    )
    const progressBar = container.querySelector('[style*="width: 75%"]')
    expect(progressBar).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <ComplianceScoreCard title="Test" score={75} trend="stable" icon="shield" className="my-class" />
    )
    expect(container.firstChild).toHaveClass('my-class')
  })
})

// =============================================================================
// FrameworkStatus
// =============================================================================

describe('FrameworkStatus', () => {
  const defaultStats = {
    total: 100,
    compliant: 70,
    nonCompliant: 10,
    partial: 15,
    notApplicable: 5,
  }

  it('renders the heading', () => {
    render(<FrameworkStatus controlStats={defaultStats} />)
    expect(screen.getByText('Control Status Overview')).toBeInTheDocument()
  })

  it('renders all status categories in legend', () => {
    render(<FrameworkStatus controlStats={defaultStats} />)
    expect(screen.getByText('Compliant: 70')).toBeInTheDocument()
    expect(screen.getByText('Partial: 15')).toBeInTheDocument()
    expect(screen.getByText('Non-Compliant: 10')).toBeInTheDocument()
    expect(screen.getByText('N/A: 5')).toBeInTheDocument()
  })

  it('shows total controls count', () => {
    render(<FrameworkStatus controlStats={defaultStats} />)
    expect(screen.getByText('Total Controls')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('calculates and shows compliance rate', () => {
    render(<FrameworkStatus controlStats={defaultStats} />)
    expect(screen.getByText('Compliance Rate')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()
  })

  it('handles zero total gracefully (avoids division by zero)', () => {
    const zeroStats = { total: 0, compliant: 0, nonCompliant: 0, partial: 0, notApplicable: 0 }
    render(<FrameworkStatus controlStats={zeroStats} />)
    // total defaults to 1 to avoid division by zero
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <FrameworkStatus controlStats={defaultStats} className="my-class" />
    )
    expect(container.firstChild).toHaveClass('my-class')
  })
})

// =============================================================================
// RiskOverview
// =============================================================================

describe('RiskOverview', () => {
  const defaultRiskStats = {
    total: 25,
    byCategory: {
      security: 8,
      operational: 6,
      compliance: 5,
      reputational: 3,
      financial: 3,
    },
    highRisk: 7,
    criticalRisk: 3,
  }

  it('renders the heading', () => {
    render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('Risk Overview')).toBeInTheDocument()
  })

  it('shows critical risk count', () => {
    const { container } = render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
    // The critical count (3) appears in a red-themed section
    const criticalSection = container.querySelector('.bg-red-50, .bg-red-900\\/20')
    expect(criticalSection).toBeInTheDocument()
    expect(criticalSection!.textContent).toContain('3')
  })

  it('shows high risk count', () => {
    render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('shows total count', () => {
    render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('renders all risk categories', () => {
    render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByText('Operational')).toBeInTheDocument()
    expect(screen.getByText('Compliance')).toBeInTheDocument()
    expect(screen.getByText('Reputational')).toBeInTheDocument()
    expect(screen.getByText('Financial')).toBeInTheDocument()
  })

  it('shows category counts', () => {
    render(<RiskOverview riskStats={defaultRiskStats} />)
    expect(screen.getByText('8')).toBeInTheDocument() // security
    expect(screen.getByText('6')).toBeInTheDocument() // operational
    expect(screen.getByText('5')).toBeInTheDocument() // compliance
  })

  it('applies custom className', () => {
    const { container } = render(
      <RiskOverview riskStats={defaultRiskStats} className="my-class" />
    )
    expect(container.firstChild).toHaveClass('my-class')
  })
})
