// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock SWR
vi.mock('swr', () => ({
  default: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

import { ActivityFeed, ActivityFeedCompact } from '../ActivityFeed';
import useSWR from 'swr';

const mockUseSWR = vi.mocked(useSWR);

describe('ActivityFeed', () => {
  it('shows loading skeletons when data is undefined', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined } as any);
    const { container } = render(<ActivityFeed />);
    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('shows error message on fetch failure', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: new Error('fail') } as any);
    render(<ActivityFeed />);
    expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
  });

  it('shows empty state when activity array is empty', () => {
    mockUseSWR.mockReturnValue({ data: [], error: undefined } as any);
    render(<ActivityFeed />);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    expect(screen.getByText('Run an agent to see activity here')).toBeInTheDocument();
  });

  it('renders activity entries with agent name and action', () => {
    const activity = [
      { agent: 'sentinel', action: 'audit', input: 'Check policies', timestamp: Date.now(), success: true },
      { agent: 'scribe', action: 'map', timestamp: Date.now() - 1000, success: false },
    ];
    mockUseSWR.mockReturnValue({ data: activity, error: undefined } as any);
    render(<ActivityFeed />);
    expect(screen.getByText('sentinel')).toBeInTheDocument();
    expect(screen.getByText('audit')).toBeInTheDocument();
    expect(screen.getByText('scribe')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
  });

  it('renders input text when available', () => {
    const activity = [
      { agent: 'sentinel', action: 'audit', input: 'Check policies', timestamp: Date.now(), success: true },
    ];
    mockUseSWR.mockReturnValue({ data: activity, error: undefined } as any);
    render(<ActivityFeed />);
    expect(screen.getByText('Check policies')).toBeInTheDocument();
  });

  it('shows Unknown for agents without a name', () => {
    const activity = [
      { agent: '', action: 'test', timestamp: Date.now(), success: true },
    ];
    mockUseSWR.mockReturnValue({ data: activity, error: undefined } as any);
    render(<ActivityFeed />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});

describe('ActivityFeedCompact', () => {
  it('shows empty state when no activity', () => {
    mockUseSWR.mockReturnValue({ data: [], error: undefined } as any);
    render(<ActivityFeedCompact />);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });

  it('renders compact activity entries', () => {
    const activity = [
      { agent: 'sentinel', action: 'audit', timestamp: Date.now(), success: true },
    ];
    mockUseSWR.mockReturnValue({ data: activity, error: undefined } as any);
    render(<ActivityFeedCompact />);
    expect(screen.getByText('sentinel')).toBeInTheDocument();
    expect(screen.getByText('audit')).toBeInTheDocument();
  });
});
