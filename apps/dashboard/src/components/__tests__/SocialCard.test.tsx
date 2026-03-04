// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SocialCard from '../SocialCard';

describe('SocialCard', () => {
  it('renders twitter card with content', () => {
    render(<SocialCard platform="twitter" content="Hello from Vorion!" />);
    expect(screen.getByText('Hello from Vorion!')).toBeInTheDocument();
  });

  it('renders twitter card with Vorion branding', () => {
    render(<SocialCard platform="twitter" content="Test content" />);
    expect(screen.getByText(/Vorion Inc\./)).toBeInTheDocument();
    expect(screen.getByText(/@VorionAI/)).toBeInTheDocument();
  });

  it('renders twitter engagement metrics', () => {
    render(<SocialCard platform="twitter" content="Test" />);
    expect(screen.getByText(/156/)).toBeInTheDocument();
    expect(screen.getByText(/48/)).toBeInTheDocument();
  });

  it('renders linkedin card with content', () => {
    render(<SocialCard platform="linkedin" content="Professional update" />);
    expect(screen.getByText('Professional update')).toBeInTheDocument();
  });

  it('renders linkedin card with company info', () => {
    render(<SocialCard platform="linkedin" content="Test" />);
    expect(screen.getByText('Vorion Inc.')).toBeInTheDocument();
    expect(screen.getByText('Autonomous Ecosystem')).toBeInTheDocument();
  });

  it('renders linkedin social actions', () => {
    render(<SocialCard platform="linkedin" content="Test" />);
    expect(screen.getByText(/Like/)).toBeInTheDocument();
    expect(screen.getByText(/Comment/)).toBeInTheDocument();
    expect(screen.getByText(/Repost/)).toBeInTheDocument();
  });

  it('preserves whitespace in content', () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    render(<SocialCard platform="twitter" content={multiline} />);
    // Testing library normalizes whitespace, so use a custom matcher
    expect(screen.getByText((_content, element) => {
      return element?.textContent === multiline;
    })).toBeInTheDocument();
  });
});
