// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrustRadar, TrustRadarMini, TrustTierBadge, type TrustDimension } from '../TrustRadar';

// Mock framer-motion to render static elements
vi.mock('framer-motion', () => ({
  motion: {
    path: ({ children, ...props }: any) => <path {...props}>{children}</path>,
    circle: ({ children, ...props }: any) => <circle {...props}>{children}</circle>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

const sampleDimensions: TrustDimension[] = [
  { name: 'Observability', score: 800, trend: 'up', description: 'Transparency' },
  { name: 'Capability', score: 600, trend: 'stable', description: 'Skills' },
  { name: 'Behavior', score: 750, trend: 'down', description: 'Policy adherence' },
  { name: 'Context', score: 500, trend: 'up', description: 'Adaptation' },
  { name: 'Integrity', score: 900, trend: 'stable', description: 'Honesty' },
];

describe('TrustRadar', () => {
  it('renders an SVG element', () => {
    const { container } = render(<TrustRadar dimensions={sampleDimensions} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders dimension labels when showLabels is true', () => {
    render(<TrustRadar dimensions={sampleDimensions} showLabels={true} />);
    // Labels appear in both SVG text and legend, so use getAllByText
    expect(screen.getAllByText('Observability').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Capability').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Behavior').length).toBeGreaterThanOrEqual(1);
  });

  it('renders dimension scores', () => {
    render(<TrustRadar dimensions={sampleDimensions} showLabels={true} />);
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();
  });

  it('renders average score at center', () => {
    render(<TrustRadar dimensions={sampleDimensions} />);
    // AVG label
    expect(screen.getByText('AVG')).toBeInTheDocument();
    // Average of 800+600+750+500+900 = 3550 / 5 = 710
    expect(screen.getByText('710')).toBeInTheDocument();
  });

  it('renders trend indicators in the legend', () => {
    render(<TrustRadar dimensions={sampleDimensions} />);
    // Legend should show dimension names with trend arrows
    const legendItems = screen.getAllByText('Observability');
    expect(legendItems.length).toBeGreaterThanOrEqual(1);
  });

  it('accepts custom size prop', () => {
    const { container } = render(<TrustRadar dimensions={sampleDimensions} size={400} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '400');
    expect(svg).toHaveAttribute('height', '400');
  });
});

describe('TrustRadarMini', () => {
  it('renders without labels', () => {
    const { container } = render(<TrustRadarMini dimensions={sampleDimensions} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Mini version has showLabels=false, so dimension names should only appear in legend
    // But the parent TrustRadar still shows them in the legend
  });

  it('uses compact size by default', () => {
    const { container } = render(<TrustRadarMini dimensions={sampleDimensions} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '120');
  });
});

describe('TrustTierBadge', () => {
  it('renders tier and score', () => {
    render(<TrustTierBadge tier="T3" score={650} />);
    expect(screen.getByText('T3')).toBeInTheDocument();
    expect(screen.getByText('650/1000')).toBeInTheDocument();
  });

  it('renders default tier name when not provided', () => {
    render(<TrustTierBadge tier="T5" score={850} />);
    expect(screen.getByText('Autonomous')).toBeInTheDocument();
  });

  it('renders custom tier name when provided', () => {
    render(<TrustTierBadge tier="T2" tierName="Custom Tier" score={400} />);
    expect(screen.getByText('Custom Tier')).toBeInTheDocument();
  });

  it('renders all predefined tiers correctly', () => {
    const { rerender } = render(<TrustTierBadge tier="T0" score={100} />);
    expect(screen.getByText('Sandbox')).toBeInTheDocument();

    rerender(<TrustTierBadge tier="T6" score={980} />);
    expect(screen.getByText('Sovereign')).toBeInTheDocument();
  });
});
