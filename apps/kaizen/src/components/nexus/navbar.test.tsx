import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Navbar } from './navbar';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt = '', ...props }: { alt?: string }) => <img alt={alt} {...props} />,
}));

describe('Navbar', () => {
  it('renders primary navigation links', () => {
    render(<Navbar />);

    expect(screen.getByRole('link', { name: /Kaizen/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Lexicon/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Paths/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Docs/i }).length).toBeGreaterThan(0);
  });

  it('calls onActivateChat when ACTIVATE is clicked', () => {
    const onActivateChat = vi.fn();
    render(<Navbar onActivateChat={onActivateChat} />);

    fireEvent.click(screen.getByRole('button', { name: /ACTIVATE/i }));
    expect(onActivateChat).toHaveBeenCalledTimes(1);
  });

  it('toggles mobile menu visibility', () => {
    render(<Navbar />);

    const toggle = screen.getByTestId('navbar-mobile-toggle');
    const menu = screen.getByTestId('navbar-mobile-menu');

    expect(menu.className).toContain('invisible');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(menu.className).toContain('visible');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes mobile menu when a mobile nav link is clicked', () => {
    render(<Navbar />);

    const toggle = screen.getByTestId('navbar-mobile-toggle');
    const menu = screen.getByTestId('navbar-mobile-menu');

    expect(screen.getByTestId('navbar-mobile-open-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('navbar-mobile-close-icon')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(menu.className).toContain('visible');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('navbar-mobile-close-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('navbar-mobile-open-icon')).not.toBeInTheDocument();

    const mobileLexiconLinks = screen.getAllByRole('link', { name: /Lexicon/i });
    fireEvent.click(mobileLexiconLinks[1]);

    expect(menu.className).toContain('invisible');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('navbar-mobile-open-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('navbar-mobile-close-icon')).not.toBeInTheDocument();
  });
});
