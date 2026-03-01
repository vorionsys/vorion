// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ProcessingIndicator } from '../nexus/processing-indicator';

describe('ProcessingIndicator', () => {
  it('returns null when not visible', () => {
    const { container } = render(
      <ProcessingIndicator visible={false} message="Loading..." />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the message when visible', () => {
    render(
      <ProcessingIndicator visible={true} message="Scanning Local Memory..." />
    );
    expect(screen.getByText('Scanning Local Memory...')).toBeInTheDocument();
  });

  it('renders three node indicators', () => {
    const { container } = render(
      <ProcessingIndicator visible={true} message="Processing..." activeNodes={[]} />
    );
    // Three node dots (gemini, claude, grok)
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBe(3);
  });

  it('activates node dots when activeNodes includes them', () => {
    const { container } = render(
      <ProcessingIndicator
        visible={true}
        message="Engaging Triad..."
        activeNodes={['gemini', 'claude', 'grok']}
      />
    );
    const dots = container.querySelectorAll('.rounded-full');
    // All three should have opacity-100 (active)
    dots.forEach(dot => {
      expect(dot.className).toContain('opacity-100');
    });
  });

  it('dims inactive nodes', () => {
    const { container } = render(
      <ProcessingIndicator
        visible={true}
        message="Loading..."
        activeNodes={[]}
      />
    );
    const dots = container.querySelectorAll('.rounded-full');
    dots.forEach(dot => {
      expect(dot.className).toContain('opacity-30');
    });
  });
});
