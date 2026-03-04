// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastContainer } from '../Toast';
import { ToastProvider, useToast } from '../../contexts/ToastContext';
import React from 'react';

// Mock framer-motion (factory must not reference top-level variables since vi.mock is hoisted)
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    motion: {
      div: React.forwardRef(({ children, ...props }: any, ref: any) => {
        const el = React.createElement('div', { ...props, ref }, children);
        return el;
      }),
    },
    AnimatePresence: ({ children }: any) => children,
  };
});

// Helper that adds toasts via context
function ToastTrigger({ type, message }: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) {
  const toast = useToast();
  React.useEffect(() => {
    toast[type](message);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      {ui}
    </ToastProvider>
  );
}

describe('ToastContainer', () => {
  it('renders success toast', () => {
    renderWithProvider(
      <>
        <ToastTrigger type="success" message="Operation succeeded" />
        <ToastContainer />
      </>
    );
    expect(screen.getByText('Operation succeeded')).toBeInTheDocument();
  });

  it('renders error toast', () => {
    renderWithProvider(
      <>
        <ToastTrigger type="error" message="Something went wrong" />
        <ToastContainer />
      </>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders warning toast', () => {
    renderWithProvider(
      <>
        <ToastTrigger type="warning" message="Be careful" />
        <ToastContainer />
      </>
    );
    expect(screen.getByText('Be careful')).toBeInTheDocument();
  });

  it('renders info toast', () => {
    renderWithProvider(
      <>
        <ToastTrigger type="info" message="Just so you know" />
        <ToastContainer />
      </>
    );
    expect(screen.getByText('Just so you know')).toBeInTheDocument();
  });

  it('has a close button on each toast', () => {
    renderWithProvider(
      <>
        <ToastTrigger type="info" message="Closable toast" />
        <ToastContainer />
      </>
    );
    // The close button is a <button> with an SVG inside
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
