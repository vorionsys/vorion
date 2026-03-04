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

import { CommandHistory } from '../CommandHistory';
import useSWR from 'swr';

const mockUseSWR = vi.mocked(useSWR);

describe('CommandHistory', () => {
  it('returns null when not open', () => {
    mockUseSWR.mockReturnValue({ data: undefined, mutate: vi.fn() } as any);
    const { container } = render(
      <CommandHistory isOpen={false} onClose={vi.fn()} onReplay={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders header when open', () => {
    mockUseSWR.mockReturnValue({
      data: { entries: [], total: 0, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(screen.getByText('Command History')).toBeInTheDocument();
  });

  it('shows command count', () => {
    mockUseSWR.mockReturnValue({
      data: { entries: [], total: 5, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(screen.getByText('5 commands')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    mockUseSWR.mockReturnValue({
      data: { entries: [], total: 0, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(screen.getByText('No commands found')).toBeInTheDocument();
  });

  it('renders search input', () => {
    mockUseSWR.mockReturnValue({
      data: { entries: [], total: 0, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search commands...')).toBeInTheDocument();
  });

  it('renders command entries with agent and command', () => {
    const entries = [
      {
        id: 'cmd-1',
        command: 'audit --verbose',
        response: 'All clear',
        agent: 'sentinel',
        success: true,
        timestamp: Date.now(),
        duration: 150,
      },
    ];
    mockUseSWR.mockReturnValue({
      data: { entries, total: 1, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    // 'sentinel' appears both as agent label and as filter button, so use getAllByText
    const sentinelElements = screen.getAllByText('sentinel');
    expect(sentinelElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('audit --verbose')).toBeInTheDocument();
  });

  it('shows ESC hint in footer', () => {
    mockUseSWR.mockReturnValue({
      data: { entries: [], total: 0, hasMore: false },
      mutate: vi.fn(),
    } as any);
    render(<CommandHistory isOpen={true} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });
});
