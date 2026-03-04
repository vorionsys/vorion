// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrustHistory, TrustSummary, type TrustSnapshot } from '../TrustHistory';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    path: ({ children, ...props }: any) => <path {...props}>{children}</path>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

const now = Date.now();
const sampleHistory: TrustSnapshot[] = [
  { timestamp: now - 86400000 * 7, overall: 720, dimensions: { Observability: 750, Capability: 700, Behavior: 730, Context: 690 } },
  { timestamp: now - 86400000 * 5, overall: 740, dimensions: { Observability: 760, Capability: 720, Behavior: 740, Context: 710 } },
  { timestamp: now - 86400000 * 3, overall: 790, dimensions: { Observability: 780, Capability: 740, Behavior: 750, Context: 730 } },
  { timestamp: now - 86400000 * 1, overall: 770, dimensions: { Observability: 800, Capability: 760, Behavior: 770, Context: 750 }, event: 'Tier upgrade' },
];

describe('TrustHistory', () => {
  it('shows empty message when history is empty', () => {
    render(<TrustHistory history={[]} />);
    expect(screen.getByText('No history data available')).toBeInTheDocument();
  });

  it('renders an SVG chart when history has data', () => {
    const { container } = render(<TrustHistory history={sampleHistory} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders event legend when events exist', () => {
    render(<TrustHistory history={sampleHistory} />);
    expect(screen.getByText(/Tier upgrade/)).toBeInTheDocument();
  });

  it('renders dimension toggle buttons when showDimensions is true', () => {
    render(<TrustHistory history={sampleHistory} showDimensions={true} />);
    expect(screen.getByText('Overall')).toBeInTheDocument();
    expect(screen.getByText('Observability')).toBeInTheDocument();
    expect(screen.getByText('Capability')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <TrustHistory history={sampleHistory} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('TrustSummary', () => {
  it('returns null for less than 2 history entries', () => {
    const { container } = render(
      <TrustSummary history={[{ timestamp: now, overall: 700, dimensions: {} }]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders current score', () => {
    render(<TrustSummary history={sampleHistory} />);
    // Current = last entry overall = 770
    expect(screen.getByText('770')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('renders 30d change', () => {
    render(<TrustSummary history={sampleHistory} />);
    // Change = 770 - 720 = +50
    expect(screen.getByText('+50')).toBeInTheDocument();
    expect(screen.getByText('30d Change')).toBeInTheDocument();
  });

  it('renders peak score', () => {
    render(<TrustSummary history={sampleHistory} />);
    expect(screen.getByText('Peak')).toBeInTheDocument();
    // Peak = 790
    expect(screen.getByText('790')).toBeInTheDocument();
  });

  it('renders average score', () => {
    render(<TrustSummary history={sampleHistory} />);
    expect(screen.getByText('Average')).toBeInTheDocument();
    // avg = (720+740+790+770)/4 = 755
    expect(screen.getByText('755')).toBeInTheDocument();
  });
});
