// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock next/router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: '/',
  }),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CommandPalette isOpen={false} onClose={vi.fn()} />
    );
    // When closed, AnimatePresence wraps nothing visible
    expect(container.querySelector('input')).not.toBeInTheDocument();
  });

  it('renders search input when open', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search commands...')).toBeInTheDocument();
  });

  it('renders navigation commands', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
  });

  it('renders agent commands', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Run Sentinel Audit')).toBeInTheDocument();
    expect(screen.getByText('Run Scribe Mapping')).toBeInTheDocument();
  });

  it('filters commands by search input', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(input, { target: { value: 'sentinel' } });
    expect(screen.getByText('Run Sentinel Audit')).toBeInTheDocument();
    expect(screen.queryByText('Run Scribe Mapping')).not.toBeInTheDocument();
  });

  it('shows no results message for non-matching search', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(input, { target: { value: 'zzzznotfound' } });
    expect(screen.getByText('No commands found')).toBeInTheDocument();
  });

  it('displays ESC key hint', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  it('shows Vorion Command Palette footer', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Vorion Command Palette')).toBeInTheDocument();
  });
});
