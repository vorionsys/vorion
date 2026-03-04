// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock SWR before importing component
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

import { AuditTimeline } from '../AuditTimeline';
import useSWR from 'swr';

const mockUseSWR = vi.mocked(useSWR);

describe('AuditTimeline', () => {
  it('shows loading skeletons when loading', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true } as any);
    const { container } = render(<AuditTimeline />);
    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('shows error message on fetch failure', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: new Error('fail'), isLoading: false } as any);
    render(<AuditTimeline />);
    expect(screen.getByText('Failed to load audit events')).toBeInTheDocument();
  });

  it('shows empty state when no events', () => {
    mockUseSWR.mockReturnValue({
      data: { events: [], chainValid: true },
      error: undefined,
      isLoading: false,
    } as any);
    render(<AuditTimeline />);
    expect(screen.getByText('No audit events found')).toBeInTheDocument();
  });

  it('shows chain verified message when valid', () => {
    mockUseSWR.mockReturnValue({
      data: { events: [], chainValid: true },
      error: undefined,
      isLoading: false,
    } as any);
    render(<AuditTimeline />);
    expect(screen.getByText(/Hash chain verified/)).toBeInTheDocument();
  });

  it('shows chain tamper warning when invalid', () => {
    mockUseSWR.mockReturnValue({
      data: { events: [], chainValid: false },
      error: undefined,
      isLoading: false,
    } as any);
    render(<AuditTimeline />);
    expect(screen.getByText(/possible tampering detected/)).toBeInTheDocument();
  });

  it('renders audit events with agent and action', () => {
    const events = [
      {
        id: 'evt-001',
        timestamp: Date.now(),
        eventType: 'action' as const,
        agentId: 'sentinel',
        action: 'Policy Audit',
        details: 'Checked compliance',
        success: true,
        hash: 'abc123',
        prevHash: '000000',
      },
    ];
    mockUseSWR.mockReturnValue({
      data: { events, chainValid: true },
      error: undefined,
      isLoading: false,
    } as any);
    render(<AuditTimeline />);
    expect(screen.getByText('sentinel')).toBeInTheDocument();
    expect(screen.getByText('Policy Audit')).toBeInTheDocument();
    expect(screen.getByText('Checked compliance')).toBeInTheDocument();
  });

  it('passes agent and type filters to SWR URL', () => {
    mockUseSWR.mockReturnValue({
      data: { events: [], chainValid: true },
      error: undefined,
      isLoading: false,
    } as any);
    render(<AuditTimeline agentFilter="sentinel" typeFilter="action" limit={10} />);
    // Check that SWR was called with the correct URL containing filters
    const swrCall = mockUseSWR.mock.calls[mockUseSWR.mock.calls.length - 1];
    const url = swrCall[0] as string;
    expect(url).toContain('agent=sentinel');
    expect(url).toContain('type=action');
    expect(url).toContain('limit=10');
  });
});
