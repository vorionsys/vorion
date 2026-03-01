// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { TermDetail } from '../nexus/term-detail';
import type { LexiconTerm } from '@/types';

describe('TermDetail', () => {
  const basicTerm: LexiconTerm = {
    term: 'Agent',
    definition: 'An autonomous software entity that can perceive, decide, and act.',
    level: 'novice',
    category: 'core',
    tags: ['autonomy', 'ai'],
  };

  const fullTerm: LexiconTerm = {
    ...basicTerm,
    overview: 'Agents are the fundamental building blocks of autonomous AI systems.',
    keyConcepts: [
      { title: 'Autonomy', description: 'The ability to act independently.' },
      { title: 'Perception', description: 'Sensing the environment.' },
    ],
    examples: [
      {
        title: 'Simple Agent',
        language: 'typescript',
        code: 'const agent = new Agent();',
        explanation: 'Creates a basic agent instance.',
      },
    ],
    useCases: ['Customer support chatbots', 'Automated trading systems'],
    commonMistakes: ['Giving agents too much autonomy without oversight'],
    practicalTips: ['Start with simple agents before building complex ones'],
    furtherReading: [
      { title: 'Agent Architecture Guide', url: 'https://example.com/agents' },
    ],
    relatedTerms: ['Multi-Agent System', 'Orchestrator'],
  };

  it('renders the term name as heading', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('renders the definition', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText(basicTerm.definition)).toBeInTheDocument();
  });

  it('renders the knowledge level badge', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText('novice')).toBeInTheDocument();
  });

  it('renders category when provided', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText('core')).toBeInTheDocument();
  });

  it('renders tags when provided', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText('autonomy')).toBeInTheDocument();
    expect(screen.getByText('ai')).toBeInTheDocument();
  });

  it('renders the Back to Lexicon link', () => {
    render(<TermDetail term={basicTerm} />);
    const backLink = screen.getByText('Back to Lexicon');
    expect(backLink.closest('a')).toHaveAttribute('href', '/lexicon');
  });

  it('shows placeholder when no extended content', () => {
    render(<TermDetail term={basicTerm} />);
    expect(screen.getByText('Extended tutorial content coming soon.')).toBeInTheDocument();
  });

  it('renders overview section when available', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText(fullTerm.overview!)).toBeInTheDocument();
  });

  it('renders key concepts section', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Key Concepts')).toBeInTheDocument();
    expect(screen.getByText('Autonomy')).toBeInTheDocument();
    expect(screen.getByText('The ability to act independently.')).toBeInTheDocument();
  });

  it('renders code examples section', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Code Examples')).toBeInTheDocument();
    expect(screen.getByText('Simple Agent')).toBeInTheDocument();
    expect(screen.getByText('const agent = new Agent();')).toBeInTheDocument();
  });

  it('renders use cases section', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Real-World Use Cases')).toBeInTheDocument();
    expect(screen.getByText('Customer support chatbots')).toBeInTheDocument();
  });

  it('renders common mistakes section', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Common Mistakes to Avoid')).toBeInTheDocument();
    expect(screen.getByText('Giving agents too much autonomy without oversight')).toBeInTheDocument();
  });

  it('renders practical tips section', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Practical Tips')).toBeInTheDocument();
    expect(screen.getByText('Start with simple agents before building complex ones')).toBeInTheDocument();
  });

  it('renders further reading links', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Further Reading')).toBeInTheDocument();
    const link = screen.getByText('Agent Architecture Guide');
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/agents');
  });

  it('renders related terms as links', () => {
    render(<TermDetail term={fullTerm} />);
    expect(screen.getByText('Related Concepts')).toBeInTheDocument();
    const relatedLink = screen.getByText('Multi-Agent System');
    expect(relatedLink.closest('a')).toHaveAttribute('href', '/lexicon/multi-agent-system');
  });
});
