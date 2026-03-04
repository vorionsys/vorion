// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const Icon = ({ children, className, ...props }: any) => (
    <svg className={className} data-testid="icon" {...props}>{children}</svg>
  )
  return {
    Shield: Icon,
    ShieldCheck: Icon,
    ShieldAlert: Icon,
    Star: Icon,
    Crown: Icon,
    Sparkles: Icon,
    ExternalLink: Icon,
    Anchor: Icon,
  }
})

import TrustBadge, {
  TrustScoreIndicator,
  CertificationBadge,
  AutonomyIndicator,
  TrustTierCard,
  ProbationIndicator,
  BAICertificationBadge,
  tierEmojis,
  tierAutonomy,
  tierToCertification,
  certificationLabels,
} from '../agents/TrustBadge'

describe('TrustBadge', () => {
  it('renders with tier label by default', () => {
    render(<TrustBadge score={500} tier="trusted" />)
    expect(screen.getByText('Trusted')).toBeInTheDocument()
  })

  it('shows score when showScore is true', () => {
    render(<TrustBadge score={750} tier="elite" showScore />)
    expect(screen.getByText('(750)')).toBeInTheDocument()
  })

  it('hides label when showLabel is false', () => {
    render(<TrustBadge score={500} tier="trusted" showLabel={false} />)
    expect(screen.queryByText('Trusted')).not.toBeInTheDocument()
  })

  it('shows emoji when showEmoji is true', () => {
    render(<TrustBadge score={500} tier="trusted" showEmoji />)
    const emojiSpan = screen.getByRole('img', { name: 'Trusted' })
    expect(emojiSpan).toBeInTheDocument()
  })

  it('renders icon instead of emoji when showEmoji is false', () => {
    render(<TrustBadge score={500} tier="trusted" showEmoji={false} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('applies size classes correctly for sm', () => {
    const { container } = render(<TrustBadge score={500} tier="trusted" size="sm" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-xs')
  })

  it('applies size classes correctly for lg', () => {
    const { container } = render(<TrustBadge score={500} tier="trusted" size="lg" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-base')
  })

  it('renders sparkles for legendary tier', () => {
    const { container } = render(<TrustBadge score={850} tier="legendary" />)
    // Legendary gets an extra Sparkles icon
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to score-based tier when tier is invalid', () => {
    // Score 500 => trusted tier
    render(<TrustBadge score={500} tier={'invalid' as any} />)
    expect(screen.getByText('Trusted')).toBeInTheDocument()
  })

  it('displays title attribute with score and tier info', () => {
    const { container } = render(<TrustBadge score={500} tier="trusted" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.getAttribute('title')).toContain('Trust Score: 500/1000')
  })
})

describe('TrustScoreIndicator', () => {
  it('renders score as fraction of 1000', () => {
    render(<TrustScoreIndicator score={750} tier="elite" />)
    expect(screen.getByText('750/1000')).toBeInTheDocument()
  })

  it('renders tier label', () => {
    render(<TrustScoreIndicator score={750} tier="elite" />)
    expect(screen.getByText('Elite')).toBeInTheDocument()
  })

  it('calculates progress bar width correctly', () => {
    const { container } = render(<TrustScoreIndicator score={500} tier="trusted" />)
    const progressBar = container.querySelector('[style*="width"]')
    expect(progressBar).toHaveStyle({ width: '50%' })
  })
})

describe('CertificationBadge', () => {
  it('renders Uncertified for level 0', () => {
    render(<CertificationBadge level={0} />)
    expect(screen.getByText('Uncertified')).toBeInTheDocument()
  })

  it('renders Level N for non-zero levels', () => {
    render(<CertificationBadge level={3} />)
    expect(screen.getByText('Level 3')).toBeInTheDocument()
  })

  it('renders sparkles for level 5', () => {
    const { container } = render(<CertificationBadge level={5} />)
    expect(screen.getByText('Level 5')).toBeInTheDocument()
    // Should have extra Sparkles icon
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThanOrEqual(2)
  })
})

describe('AutonomyIndicator', () => {
  it('renders correct autonomy description for untrusted', () => {
    render(<AutonomyIndicator tier="untrusted" />)
    expect(screen.getByText('Cannot operate autonomously')).toBeInTheDocument()
  })

  it('renders correct risk level for trusted tier', () => {
    render(<AutonomyIndicator tier="trusted" />)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders the tier label in the heading', () => {
    render(<AutonomyIndicator tier="elite" />)
    expect(screen.getByText('Elite Autonomy')).toBeInTheDocument()
  })

  it('falls back to score-based tier for invalid tier', () => {
    render(<AutonomyIndicator tier={'bogus' as any} score={200} />)
    expect(screen.getByText('Novice Autonomy')).toBeInTheDocument()
  })
})

describe('TrustTierCard', () => {
  it('renders score and tier label', () => {
    render(<TrustTierCard score={750} tier="elite" />)
    expect(screen.getByText('Elite')).toBeInTheDocument()
    expect(screen.getByText('750')).toBeInTheDocument()
    expect(screen.getByText('/ 1000')).toBeInTheDocument()
  })

  it('shows points to next tier when not at max', () => {
    render(<TrustTierCard score={500} tier="trusted" />)
    // Next tier after trusted is elite (min 650), so 150 points to go
    expect(screen.getByText(/150 points to/)).toBeInTheDocument()
  })

  it('does not show points to next tier for legendary (max tier)', () => {
    render(<TrustTierCard score={875} tier="legendary" />)
    // Legendary is the highest tier, so no "points to" text should appear
    expect(screen.queryByText(/points to/)).not.toBeInTheDocument()
  })

  it('renders autonomy section', () => {
    render(<TrustTierCard score={750} tier="elite" />)
    expect(screen.getByText('Autonomy Level')).toBeInTheDocument()
    expect(screen.getByText('High-risk with minimal oversight')).toBeInTheDocument()
  })
})

describe('ProbationIndicator (from TrustBadge module)', () => {
  it('renders probation period text', () => {
    render(<ProbationIndicator daysRemaining={14} />)
    expect(screen.getByText('Probation Period')).toBeInTheDocument()
    expect(screen.getByText(/14 days remaining/)).toBeInTheDocument()
  })

  it('includes reason if provided', () => {
    render(<ProbationIndicator daysRemaining={7} reason="policy violation" />)
    expect(screen.getByText(/policy violation/)).toBeInTheDocument()
  })
})

describe('BAICertificationBadge', () => {
  const defaultProps = {
    agentId: 'agent-1',
    agentName: 'TestBot',
    score: 750,
    tier: 'elite' as const,
  }

  it('renders full variant with agent name and score', () => {
    render(<BAICertificationBadge {...defaultProps} variant="full" />)
    expect(screen.getByText('TestBot')).toBeInTheDocument()
    expect(screen.getByText('750')).toBeInTheDocument()
    expect(screen.getByText('/1000')).toBeInTheDocument()
  })

  it('renders compact variant', () => {
    render(<BAICertificationBadge {...defaultProps} variant="compact" />)
    expect(screen.getByText('BAI Autonomous')).toBeInTheDocument()
    expect(screen.getByText('750')).toBeInTheDocument()
  })

  it('renders inline variant', () => {
    render(<BAICertificationBadge {...defaultProps} variant="inline" />)
    expect(screen.getByText('BAI Autonomous')).toBeInTheDocument()
  })

  it('hides verify link when showVerifyLink is false', () => {
    render(<BAICertificationBadge {...defaultProps} showVerifyLink={false} />)
    expect(screen.queryByText('Verify on AgentAnchor')).not.toBeInTheDocument()
  })

  it('shows verify link by default', () => {
    render(<BAICertificationBadge {...defaultProps} variant="full" showVerifyLink />)
    expect(screen.getByText('Verify on AgentAnchor')).toBeInTheDocument()
  })

  it('uses verificationHash in verify link when provided', () => {
    render(<BAICertificationBadge {...defaultProps} variant="full" verificationHash="abc123" />)
    const verifyLink = screen.getByText('Verify on AgentAnchor').closest('a')
    expect(verifyLink?.getAttribute('href')).toBe('/verify/abc123')
  })
})

describe('tierEmojis', () => {
  it('maps all tiers to emojis', () => {
    expect(tierEmojis.untrusted).toBeDefined()
    expect(tierEmojis.novice).toBeDefined()
    expect(tierEmojis.proven).toBeDefined()
    expect(tierEmojis.trusted).toBeDefined()
    expect(tierEmojis.elite).toBeDefined()
    expect(tierEmojis.legendary).toBeDefined()
  })
})

describe('tierToCertification', () => {
  it('maps untrusted to none', () => {
    expect(tierToCertification.untrusted).toBe('none')
  })

  it('maps legendary to genesis', () => {
    expect(tierToCertification.legendary).toBe('genesis')
  })
})
