// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ProgressBar } from '../progress/ProgressBar';

describe('ProgressBar', () => {
  it('renders with default props', () => {
    const { container } = render(<ProgressBar value={50} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('50%');
  });

  it('clamps value at 0 minimum', () => {
    const { container } = render(<ProgressBar value={-10} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });

  it('clamps value at 100 maximum', () => {
    const { container } = render(<ProgressBar value={150} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('shows label when showLabel is true', () => {
    render(<ProgressBar value={75} showLabel={true} />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('does not show label by default', () => {
    render(<ProgressBar value={75} />);
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });

  it('rounds percentage display in label', () => {
    render(<ProgressBar value={33.7} showLabel={true} />);
    expect(screen.getByText('34%')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ProgressBar value={50} className="custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('custom-class');
  });

  it('renders 0% progress correctly', () => {
    const { container } = render(<ProgressBar value={0} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });

  it('renders 100% progress correctly', () => {
    const { container } = render(<ProgressBar value={100} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });
});
