// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ToastProvider, useToast } from '../../contexts/ToastContext';
import { RealtimeProvider, useRealtime } from '../../contexts/RealtimeContext';

// --- ToastContext Tests ---

function ToastConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Success toast')}>Add Success</button>
      <button onClick={() => toast.error('Error toast')}>Add Error</button>
      <button onClick={() => toast.warning('Warning toast')}>Add Warning</button>
      <button onClick={() => toast.info('Info toast')}>Add Info</button>
      <div data-testid="toast-count">{toast.toasts.length}</div>
      <ul>
        {toast.toasts.map(t => (
          <li key={t.id}>
            <span data-testid={`toast-type-${t.id}`}>{t.type}</span>
            <span data-testid={`toast-msg-${t.id}`}>{t.message}</span>
            <button onClick={() => toast.removeToast(t.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('ToastContext', () => {
  it('throws when used outside provider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ToastConsumer />)).toThrow('useToast must be used within a ToastProvider');
    spy.mockRestore();
  });

  it('adds a success toast', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText('Add Success').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
  });

  it('adds multiple toasts', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText('Add Success').click();
      screen.getByText('Add Error').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('2');
  });

  it('removes a toast', () => {
    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    );
    act(() => {
      screen.getByText('Add Info').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      screen.getByText('Remove').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
  });
});

// --- RealtimeContext Tests ---

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

function RealtimeConsumer() {
  const { connected, events, alerts } = useRealtime();
  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="event-count">{events.length}</span>
      <span data-testid="alert-count">{alerts.length}</span>
    </div>
  );
}

describe('RealtimeContext', () => {
  it('throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<RealtimeConsumer />)).toThrow('useRealtime must be used within a RealtimeProvider');
    spy.mockRestore();
  });

  it('provides default disconnected state', () => {
    const originalEventSource = globalThis.EventSource;
    (globalThis as any).EventSource = MockEventSource;

    render(
      <RealtimeProvider>
        <RealtimeConsumer />
      </RealtimeProvider>
    );
    // Initially disconnected until onopen fires
    expect(screen.getByTestId('connected').textContent).toBe('false');

    (globalThis as any).EventSource = originalEventSource;
  });

  it('sets connected to true after EventSource opens', () => {
    const originalEventSource = globalThis.EventSource;
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;

    render(
      <RealtimeProvider>
        <RealtimeConsumer />
      </RealtimeProvider>
    );

    // Simulate connection open
    const instance = MockEventSource.instances[0];
    act(() => {
      instance?.onopen?.();
    });
    expect(screen.getByTestId('connected').textContent).toBe('true');

    (globalThis as any).EventSource = originalEventSource;
  });
});
