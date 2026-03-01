// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ChatMessage } from '../nexus/chat-message';
import type { ChatMessage as ChatMessageType } from '@/types';

describe('ChatMessage', () => {
  const baseMessage: ChatMessageType = {
    id: 'msg-1',
    role: 'user',
    content: '<p>Hello Nexus</p>',
    timestamp: new Date('2026-02-26'),
  };

  it('renders user message aligned to the right', () => {
    const { container } = render(<ChatMessage message={baseMessage} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  it('renders assistant message aligned to the left', () => {
    const assistantMsg: ChatMessageType = {
      ...baseMessage,
      id: 'msg-2',
      role: 'assistant',
      content: '<p>I am Nexus</p>',
    };
    const { container } = render(<ChatMessage message={assistantMsg} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
  });

  it('renders message content via dangerouslySetInnerHTML', () => {
    render(<ChatMessage message={baseMessage} />);
    expect(screen.getByText('Hello Nexus')).toBeInTheDocument();
  });

  it('shows LOCAL HIT label for local source messages', () => {
    const localMsg: ChatMessageType = {
      ...baseMessage,
      role: 'assistant',
      source: 'local',
      content: '<p>Found locally</p>',
    };
    render(<ChatMessage message={localMsg} />);
    expect(screen.getByText('LOCAL HIT')).toBeInTheDocument();
  });

  it('shows SYNTHESIS label for synthesis source messages', () => {
    const synthMsg: ChatMessageType = {
      ...baseMessage,
      role: 'assistant',
      source: 'synthesis',
      content: '<p>Synthesized answer</p>',
    };
    render(<ChatMessage message={synthMsg} />);
    expect(screen.getByText('SYNTHESIS')).toBeInTheDocument();
  });

  it('shows SYSTEM label for system role messages', () => {
    const sysMsg: ChatMessageType = {
      ...baseMessage,
      role: 'system',
      content: '<p>System online</p>',
    };
    render(<ChatMessage message={sysMsg} />);
    expect(screen.getByText('SYSTEM')).toBeInTheDocument();
  });

  it('does not show source label for user messages', () => {
    render(<ChatMessage message={baseMessage} />);
    expect(screen.queryByText('LOCAL HIT')).not.toBeInTheDocument();
    expect(screen.queryByText('SYNTHESIS')).not.toBeInTheDocument();
    expect(screen.queryByText('SYSTEM')).not.toBeInTheDocument();
  });

  it('renders perspective contributors when present', () => {
    const msgWithPerspectives: ChatMessageType = {
      ...baseMessage,
      role: 'assistant',
      content: '<p>Multi-model response</p>',
      perspectives: [
        { model: 'gemini', content: 'Gemini says...' },
        { model: 'claude', content: 'Claude says...' },
        { model: 'grok', content: 'Grok says...' },
      ],
    };
    render(<ChatMessage message={msgWithPerspectives} />);
    expect(screen.getByText('Contributors:')).toBeInTheDocument();
    expect(screen.getByText('GEMINI')).toBeInTheDocument();
    expect(screen.getByText('CLAUDE')).toBeInTheDocument();
    expect(screen.getByText('GROK')).toBeInTheDocument();
  });

  it('does not render contributors section when no perspectives', () => {
    render(<ChatMessage message={baseMessage} />);
    expect(screen.queryByText('Contributors:')).not.toBeInTheDocument();
  });
});
