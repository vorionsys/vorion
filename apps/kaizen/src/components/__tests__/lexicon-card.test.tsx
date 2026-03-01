// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock @/lib/lexicon-data
vi.mock('@/lib/lexicon-data', () => ({
  termToSlug: (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, className, style }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={href} onClick={onClick} className={className} style={style}>
      {children}
    </a>
  ),
}));

import { LexiconCard } from '../nexus/lexicon-card';
import type { LexiconTerm } from '@/types';

describe('LexiconCard', () => {
  const baseTerm: LexiconTerm = {
    term: 'Agent',
    definition: 'An autonomous software entity that can perceive, decide, and act.',
    level: 'novice',
    category: 'core',
    tags: ['autonomy', 'ai', 'decision-making'],
  };

  it('renders the term name', () => {
    render(<LexiconCard term={baseTerm} />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('renders the definition', () => {
    render(<LexiconCard term={baseTerm} />);
    expect(screen.getByText(baseTerm.definition)).toBeInTheDocument();
  });

  it('renders the knowledge level badge', () => {
    render(<LexiconCard term={baseTerm} />);
    expect(screen.getByText('novice')).toBeInTheDocument();
  });

  it('links to the correct lexicon slug', () => {
    render(<LexiconCard term={baseTerm} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/lexicon/agent');
  });

  it('uses the slug field when available', () => {
    const termWithSlug: LexiconTerm = {
      ...baseTerm,
      slug: 'custom-slug',
    };
    render(<LexiconCard term={termWithSlug} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/lexicon/custom-slug');
  });

  it('renders tags (up to 3)', () => {
    render(<LexiconCard term={baseTerm} />);
    expect(screen.getByText('autonomy')).toBeInTheDocument();
    expect(screen.getByText('ai')).toBeInTheDocument();
    expect(screen.getByText('decision-making')).toBeInTheDocument();
  });

  it('does not render tags section when no tags', () => {
    const noTagsTerm: LexiconTerm = {
      ...baseTerm,
      tags: undefined,
    };
    render(<LexiconCard term={noTagsTerm} />);
    expect(screen.queryByText('autonomy')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<LexiconCard term={baseTerm} onClick={onClick} />);
    fireEvent.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders expert level correctly', () => {
    const expertTerm: LexiconTerm = {
      ...baseTerm,
      level: 'expert',
    };
    render(<LexiconCard term={expertTerm} />);
    expect(screen.getByText('expert')).toBeInTheDocument();
  });
});
