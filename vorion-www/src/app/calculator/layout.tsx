import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trust Calculator | VORION — Interactive ATSF Trust Scoring',
  description: 'Explore how 16 behavioral factors combine into a 0–1000 trust score. Adjust sliders, simulate decay, and test ceiling enforcement in real-time.',
  openGraph: {
    title: 'ATSF Trust Calculator | VORION',
    description: 'Interactive trust score calculator for AI agents. 16 factors × 8 tiers × real-time.',
  },
};

export default function CalculatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
