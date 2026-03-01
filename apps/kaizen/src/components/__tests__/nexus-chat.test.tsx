// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  generateId: () => 'mock-id-' + Math.random().toString(36).slice(2, 8),
  sanitizeHtml: (html: string) => html,
}));

// Mock @/lib/lexicon-data
vi.mock('@/lib/lexicon-data', () => ({
  searchLexicon: vi.fn(() => null),
}));

// Mock @/lib/intent-routing
vi.mock('@/lib/intent-routing', () => ({
  getIntentRoute: vi.fn(() => ({
    greeting: 'Welcome!',
    systemContext: 'test context',
    suggestedTerms: [],
  })),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => <a href={href} className={className}>{children}</a>,
}));

// Mock @/components/ui/button
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, type, variant, size, ...props }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    type?: string;
    variant?: string;
    size?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className} type={type} {...props}>
      {children}
    </button>
  ),
}));

// Mock @/components/ui/input
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, disabled, className, ...props }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    [key: string]: unknown;
  }) => (
    <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className={className} {...props} />
  ),
}));

// Mock child components
vi.mock('../nexus/chat-message', () => ({
  ChatMessage: ({ message }: { message: { content: string; role: string } }) => (
    <div data-testid="chat-message" data-role={message.role}>
      <span dangerouslySetInnerHTML={{ __html: message.content }} />
    </div>
  ),
}));

vi.mock('../nexus/processing-indicator', () => ({
  ProcessingIndicator: ({ visible, message }: { visible: boolean; message: string }) => (
    visible ? <div data-testid="processing-indicator">{message}</div> : null
  ),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = vi.fn();

import { NexusChat } from '../nexus/nexus-chat';

describe('NexusChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  describe('Closed state', () => {
    it('shows ACTIVATE button when closed', () => {
      render(<NexusChat isOpen={false} onToggle={vi.fn()} />);
      expect(screen.getByText('ACTIVATE')).toBeInTheDocument();
    });

    it('calls onToggle when ACTIVATE is clicked', () => {
      const onToggle = vi.fn();
      render(<NexusChat isOpen={false} onToggle={onToggle} />);
      fireEvent.click(screen.getByText('ACTIVATE'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('Open state', () => {
    it('shows the chat header with OMNI.AI', () => {
      render(<NexusChat isOpen={true} onToggle={vi.fn()} />);
      expect(screen.getByText('OMNI.AI')).toBeInTheDocument();
    });

    it('renders the initial system message', () => {
      render(<NexusChat isOpen={true} onToggle={vi.fn()} />);
      const messages = screen.getAllByTestId('chat-message');
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0]).toHaveAttribute('data-role', 'system');
    });

    it('shows the input field', () => {
      render(<NexusChat isOpen={true} onToggle={vi.fn()} />);
      expect(screen.getByPlaceholderText('Ask Nexus...')).toBeInTheDocument();
    });

    it('has a close button that calls onToggle', () => {
      const onToggle = vi.fn();
      const { container } = render(<NexusChat isOpen={true} onToggle={onToggle} />);
      // The close button is in the header
      const closeButton = container.querySelector('.bg-gray-800 button') as HTMLElement;
      expect(closeButton).toBeTruthy();
      fireEvent.click(closeButton);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('adds user message on form submit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          synthesis: '<p>Response</p>',
          perspectives: [],
        }),
      });

      render(<NexusChat isOpen={true} onToggle={vi.fn()} />);
      const input = screen.getByPlaceholderText('Ask Nexus...');
      fireEvent.change(input, { target: { value: 'What is an agent?' } });

      const form = input.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        const messages = screen.getAllByTestId('chat-message');
        const userMessages = messages.filter(m => m.getAttribute('data-role') === 'user');
        expect(userMessages.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('does not submit empty messages', () => {
      render(<NexusChat isOpen={true} onToggle={vi.fn()} />);
      const input = screen.getByPlaceholderText('Ask Nexus...');
      const form = input.closest('form')!;
      fireEvent.submit(form);

      // Should still only have the system message
      const messages = screen.getAllByTestId('chat-message');
      expect(messages).toHaveLength(1);
    });
  });
});
