import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HeroSection } from './hero-section';
import { staticLexicon } from '@/lib/lexicon-data';

describe('HeroSection', () => {
  it('renders core marketing content', () => {
    render(<HeroSection />);

    expect(screen.getByText('Tri-Model Synthesis Engine')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The Cognitive Router' })).toBeInTheDocument();
    expect(screen.getByText('Kaizen — The Agentic AI Knowledge Base')).toBeInTheDocument();
  });

  it('renders dynamic stat cards', () => {
    render(<HeroSection />);

    expect(screen.getByText(String(staticLexicon.length))).toBeInTheDocument();
    expect(screen.getByText('AI Terms')).toBeInTheDocument();
    expect(screen.getByText('AI Personas')).toBeInTheDocument();
  });
});
