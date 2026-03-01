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
  default: ({ href, children, onClick, className }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, width, height, className }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
  }) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));

// Mock lucide-react icons as simple spans
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Icon = ({ className }: { className?: string }) => (
      <span data-testid={`icon-${name}`} className={className} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Menu: createIcon('Menu'),
    X: createIcon('X'),
    Brain: createIcon('Brain'),
    BookOpen: createIcon('BookOpen'),
    Settings: createIcon('Settings'),
    FileCode: createIcon('FileCode'),
    Github: createIcon('Github'),
    MessageCircle: createIcon('MessageCircle'),
    Route: createIcon('Route'),
    User: createIcon('User'),
    Layers: createIcon('Layers'),
    Cpu: createIcon('Cpu'),
  };
});

// Mock @/components/ui/button
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, variant, size, ...props }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    variant?: string;
    size?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={className} data-variant={variant} data-size={size} {...props}>
      {children}
    </button>
  ),
}));

import { Navbar } from '../nexus/navbar';

describe('Navbar', () => {
  it('renders the Kaizen logo text', () => {
    render(<Navbar />);
    expect(screen.getByText('Kai')).toBeInTheDocument();
    expect(screen.getByText('zen')).toBeInTheDocument();
  });

  it('renders the Vorion logo image', () => {
    render(<Navbar />);
    const img = screen.getByAltText('Vorion');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/vorion.png');
  });

  it('renders all navigation items', () => {
    render(<Navbar />);
    expect(screen.getAllByText('Lexicon').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Paths').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Neural Link').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Studio').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Docs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cortex').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Profile').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the ACTIVATE button', () => {
    render(<Navbar />);
    expect(screen.getByText('ACTIVATE')).toBeInTheDocument();
  });

  it('calls onActivateChat when ACTIVATE button is clicked', () => {
    const onActivateChat = vi.fn();
    render(<Navbar onActivateChat={onActivateChat} />);
    fireEvent.click(screen.getByText('ACTIVATE'));
    expect(onActivateChat).toHaveBeenCalledTimes(1);
  });

  it('toggles mobile menu on menu button click', () => {
    const { container } = render(<Navbar />);
    // Find the mobile menu button (md:hidden)
    const mobileButton = container.querySelector('button.md\\:hidden') as HTMLElement;
    expect(mobileButton).toBeTruthy();

    // Initially mobile menu is invisible
    const mobileMenu = container.querySelector('.md\\:hidden.absolute') as HTMLElement;
    expect(mobileMenu?.className).toContain('invisible');

    // Click to open
    fireEvent.click(mobileButton);

    // After click, should become visible
    const updatedMenu = container.querySelector('.md\\:hidden.absolute') as HTMLElement;
    expect(updatedMenu?.className).toContain('visible');
  });

  it('renders external links', () => {
    render(<Navbar />);
    const basisLinks = screen.getAllByText('BASIS Standard');
    expect(basisLinks.length).toBeGreaterThanOrEqual(1);
    // Check the first one has correct href and target
    const firstLink = basisLinks[0].closest('a');
    expect(firstLink).toHaveAttribute('href', 'https://basis.vorion.org');
    expect(firstLink).toHaveAttribute('target', '_blank');
  });
});
