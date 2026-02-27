import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LexiconTerm } from '@/types';
import { LexiconCard } from './lexicon-card';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('LexiconCard', () => {
  const term: LexiconTerm = {
    term: 'Agent',
    definition: 'An autonomous system that can perform tasks.',
    level: 'novice',
    category: 'core',
    tags: ['fundamentals', 'autonomy'],
    slug: 'agent',
  };

  it('renders term content and metadata', () => {
    render(<LexiconCard term={term} />);

    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('An autonomous system that can perform tasks.')).toBeInTheDocument();
    expect(screen.getByText('novice')).toBeInTheDocument();
    expect(screen.getByText('fundamentals')).toBeInTheDocument();
  });

  it('links to term detail route', () => {
    render(<LexiconCard term={term} />);

    const link = screen.getByRole('link', { name: /Agent/i });
    expect(link).toHaveAttribute('href', '/lexicon/agent');
  });
});
