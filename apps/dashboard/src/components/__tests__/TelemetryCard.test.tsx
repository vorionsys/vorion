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

import { SingleAgentCard } from '../TelemetryCard';

const healthyMetrics = {
  agentId: 'sentinel',
  status: 'healthy' as const,
  lastHeartbeat: Date.now(),
  uptime: 86400,
  requestCount: 1500,
  successCount: 1450,
  failureCount: 50,
  avgResponseTime: 120,
  p95ResponseTime: 350,
  queueDepth: 5,
};

describe('SingleAgentCard', () => {
  it('renders agent name', () => {
    render(<SingleAgentCard metrics={healthyMetrics} />);
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
  });

  it('renders agent status', () => {
    render(<SingleAgentCard metrics={healthyMetrics} />);
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders request count', () => {
    render(<SingleAgentCard metrics={healthyMetrics} />);
    // 1500 formats to 1.5k
    expect(screen.getByText('1.5k')).toBeInTheDocument();
  });

  it('renders success rate', () => {
    render(<SingleAgentCard metrics={healthyMetrics} />);
    // 1450/1500 = 96.7%
    expect(screen.getByText('96.7%')).toBeInTheDocument();
  });

  it('renders average response time', () => {
    render(<SingleAgentCard metrics={healthyMetrics} />);
    expect(screen.getByText('120ms')).toBeInTheDocument();
  });

  it('shows expanded details when expanded is true', () => {
    render(<SingleAgentCard metrics={{ ...healthyMetrics, trustScore: 85 }} expanded={true} />);
    expect(screen.getByText('Uptime:')).toBeInTheDocument();
    expect(screen.getByText('Queue:')).toBeInTheDocument();
    expect(screen.getByText('P95 RT:')).toBeInTheDocument();
    expect(screen.getByText('Trust:')).toBeInTheDocument();
  });

  it('shows last error when present in expanded view', () => {
    const metricsWithError = {
      ...healthyMetrics,
      status: 'unhealthy' as const,
      lastError: 'Connection timeout',
      lastErrorTime: Date.now(),
    };
    render(<SingleAgentCard metrics={metricsWithError} expanded={true} />);
    expect(screen.getByText('Last Error')).toBeInTheDocument();
    expect(screen.getByText('Connection timeout')).toBeInTheDocument();
  });

  it('renders unknown agent IDs as-is', () => {
    const unknownAgent = { ...healthyMetrics, agentId: 'custom-agent' };
    render(<SingleAgentCard metrics={unknownAgent} />);
    expect(screen.getByText('custom-agent')).toBeInTheDocument();
  });

  it('renders different status styles for degraded status', () => {
    const degraded = { ...healthyMetrics, status: 'degraded' as const };
    render(<SingleAgentCard metrics={degraded} />);
    expect(screen.getByText('degraded')).toBeInTheDocument();
  });
});
