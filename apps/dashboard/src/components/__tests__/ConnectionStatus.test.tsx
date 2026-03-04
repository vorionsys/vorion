// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock the hooks
vi.mock('../../hooks/useRealtime', () => ({
  useConnectionStatus: vi.fn(),
  useAlerts: vi.fn(),
}));

import { ConnectionStatus, ConnectionDot, AlertDropdown } from '../ConnectionStatus';
import { useConnectionStatus, useAlerts } from '../../hooks/useRealtime';

const mockUseConnectionStatus = vi.mocked(useConnectionStatus);
const mockUseAlerts = vi.mocked(useAlerts);

describe('ConnectionStatus', () => {
  it('renders Live text for good connection', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: true, quality: 'good', lastEventTime: Date.now() });
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 0, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<ConnectionStatus />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders Delayed text for degraded connection', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: true, quality: 'degraded', lastEventTime: Date.now() });
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 0, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<ConnectionStatus />);
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });

  it('renders Offline text for disconnected', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: false, quality: 'disconnected', lastEventTime: undefined });
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 0, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<ConnectionStatus />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows alert badge when there are unread alerts', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: true, quality: 'good', lastEventTime: Date.now() });
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 3, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<ConnectionStatus />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show alert badge when unreadCount is 0', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: true, quality: 'good', lastEventTime: Date.now() });
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 0, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    const { container } = render(<ConnectionStatus />);
    // No alert badge number should be present
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});

describe('ConnectionDot', () => {
  it('renders a dot element', () => {
    mockUseConnectionStatus.mockReturnValue({ connected: true, quality: 'good', lastEventTime: Date.now() });
    const { container } = render(<ConnectionDot />);
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
  });
});

describe('AlertDropdown', () => {
  it('shows empty state when no alerts', () => {
    mockUseAlerts.mockReturnValue({ alerts: [], unreadAlerts: [], unreadCount: 0, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<AlertDropdown />);
    expect(screen.getByText('No recent alerts')).toBeInTheDocument();
  });

  it('renders alerts with message and level', () => {
    const alerts = [
      {
        type: 'alert' as const,
        agentId: 'sentinel',
        data: { level: 'warning', message: 'High CPU usage' },
        timestamp: Date.now(),
      },
    ];
    mockUseAlerts.mockReturnValue({ alerts, unreadAlerts: alerts, unreadCount: 1, acknowledge: vi.fn(), acknowledgeAll: vi.fn(), clearAlerts: vi.fn() });
    render(<AlertDropdown />);
    expect(screen.getByText('High CPU usage')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });
});
