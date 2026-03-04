// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupedAgentSelect, AgentSelect } from '../GroupedAgentSelect';

describe('GroupedAgentSelect', () => {
  it('renders a select element', () => {
    render(<GroupedAgentSelect value="" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('renders the default placeholder', () => {
    render(<GroupedAgentSelect value="" onChange={vi.fn()} />);
    expect(screen.getByText('All Agents')).toBeInTheDocument();
  });

  it('renders custom placeholder', () => {
    render(<GroupedAgentSelect value="" onChange={vi.fn()} placeholder="Pick one" />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('calls onChange when selection changes', () => {
    const handleChange = vi.fn();
    render(<GroupedAgentSelect value="" onChange={handleChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'sentinel' } });
    expect(handleChange).toHaveBeenCalledWith('sentinel');
  });

  it('applies custom className', () => {
    render(<GroupedAgentSelect value="" onChange={vi.fn()} className="custom-class" />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveClass('custom-class');
  });
});

describe('AgentSelect', () => {
  it('renders a flat select element', () => {
    render(<AgentSelect value="" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('renders All Agents as default option', () => {
    render(<AgentSelect value="" onChange={vi.fn()} />);
    expect(screen.getByText('All Agents')).toBeInTheDocument();
  });

  it('calls onChange when value changes', () => {
    const handleChange = vi.fn();
    render(<AgentSelect value="" onChange={handleChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'architect' } });
    expect(handleChange).toHaveBeenCalledWith('architect');
  });
});
