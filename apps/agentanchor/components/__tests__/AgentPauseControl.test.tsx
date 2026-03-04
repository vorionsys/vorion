// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock lucide-react
vi.mock('lucide-react', () => {
  const Icon = ({ children, className, ...props }: any) => (
    <svg className={className} data-testid="icon" {...props}>{children}</svg>
  )
  return {
    Pause: Icon,
    Play: Icon,
    Loader2: Icon,
    AlertTriangle: Icon,
    Clock: Icon,
    User: Icon,
    FileText: Icon,
  }
})

import { AgentPauseControl } from '../governance/AgentPauseControl'

describe('AgentPauseControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  // -------------------------------------------------------------------------
  // Default (non-paused) state
  // -------------------------------------------------------------------------

  it('renders Active status when no pause state', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows Pause Agent button when not paused', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    expect(screen.getByText('Pause Agent')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Paused state
  // -------------------------------------------------------------------------

  it('renders Paused status when initialPauseState is paused', () => {
    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
          pausedAt: '2026-02-20T10:00:00Z',
        }}
      />
    )
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('shows Resume Agent button when paused', () => {
    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
        }}
      />
    )
    expect(screen.getByText('Resume Agent')).toBeInTheDocument()
  })

  it('shows pause reason in detail view', () => {
    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
          pausedAt: '2026-02-20T10:00:00Z',
        }}
      />
    )
    expect(screen.getByText(/Reason: maintenance/)).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Investigation block
  // -------------------------------------------------------------------------

  it('disables resume for investigation reason', () => {
    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'investigation',
        }}
      />
    )
    expect(screen.getByText('Agents under investigation cannot be self-resumed')).toBeInTheDocument()
    const resumeBtn = screen.getByText('Resume Agent').closest('button')
    expect(resumeBtn).toBeDisabled()
  })

  // -------------------------------------------------------------------------
  // Compact view
  // -------------------------------------------------------------------------

  it('renders compact active badge', () => {
    render(<AgentPauseControl agentId="agent-1" compact />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders compact paused badge', () => {
    render(
      <AgentPauseControl
        agentId="agent-1"
        compact
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
        }}
      />
    )
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Pause modal
  // -------------------------------------------------------------------------

  it('opens pause modal when Pause Agent button is clicked', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    fireEvent.click(screen.getByText('Pause Agent'))
    expect(screen.getByText('Pause Agent?')).toBeInTheDocument()
  })

  it('opens pause modal with agent name', () => {
    render(<AgentPauseControl agentId="agent-1" agentName="MyBot" />)
    fireEvent.click(screen.getByText('Pause Agent'))
    expect(screen.getByText('Pause MyBot?')).toBeInTheDocument()
  })

  it('closes pause modal on cancel', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    fireEvent.click(screen.getByText('Pause Agent'))
    expect(screen.getByText('Pause Agent?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Pause Agent?')).not.toBeInTheDocument()
  })

  it('shows pause reason options in modal', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    fireEvent.click(screen.getByText('Pause Agent'))
    expect(screen.getByText('Reason')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Pause API call
  // -------------------------------------------------------------------------

  it('calls pause API when confirmed', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    global.fetch = mockFetch

    const onPauseChange = vi.fn()
    render(
      <AgentPauseControl agentId="agent-1" onPauseChange={onPauseChange} />
    )

    fireEvent.click(screen.getByText('Pause Agent'))
    // Click the "Pause Agent" button inside the modal
    const modalButtons = screen.getAllByText('Pause Agent')
    const confirmButton = modalButtons[modalButtons.length - 1]
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/agent-1/pause',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Resume API call
  // -------------------------------------------------------------------------

  it('calls resume API on resume click', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    global.fetch = mockFetch

    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
        }}
      />
    )

    fireEvent.click(screen.getByText('Resume Agent'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/agent-1/pause',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('shows error when resume API fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    })
    global.fetch = mockFetch

    render(
      <AgentPauseControl
        agentId="agent-1"
        initialPauseState={{
          agentId: 'agent-1',
          isPaused: true,
          pauseReason: 'maintenance',
        }}
      />
    )

    fireEvent.click(screen.getByText('Resume Agent'))

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })
  })

  it('shows error when other reason has no notes', () => {
    render(<AgentPauseControl agentId="agent-1" />)
    fireEvent.click(screen.getByText('Pause Agent'))

    // Select "Other" reason
    const select = screen.getByDisplayValue('Maintenance')
    fireEvent.change(select, { target: { value: 'other' } })

    // Click confirm without notes
    const modalButtons = screen.getAllByText('Pause Agent')
    fireEvent.click(modalButtons[modalButtons.length - 1])

    expect(screen.getByText('Notes are required when selecting "Other" as the reason')).toBeInTheDocument()
  })
})
