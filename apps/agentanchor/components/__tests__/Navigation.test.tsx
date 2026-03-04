// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
let mockPathname = '/dashboard'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

// Mock Next.js Link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// Mock Supabase client
const mockSignOut = vi.fn().mockResolvedValue({})
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
    },
  }),
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: any) => <svg {...props}>{children}</svg>
  return {
    Bot: Icon,
    Users: Icon,
    MessageSquare: Icon,
    Settings: Icon,
    LogOut: Icon,
    Menu: Icon,
    X: Icon,
    Sparkles: Icon,
    Library: Icon,
    Zap: Icon,
    UsersRound: Icon,
    GraduationCap: Icon,
  }
})

import Navigation from '../ui/Navigation'

describe('Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/dashboard'
  })

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('renders the brand name', () => {
    render(<Navigation />)
    expect(screen.getByText('AgentAnchor')).toBeInTheDocument()
  })

  it('renders all nav items', () => {
    render(<Navigation />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Orchestrator')).toBeInTheDocument()
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('Academy')).toBeInTheDocument()
    expect(screen.getByText('Collaborate')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Templates')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
  })

  it('renders a logout button', () => {
    render(<Navigation />)
    // Multiple "Logout" elements (desktop + mobile), check at least one exists
    const logoutButtons = screen.getAllByText('Logout')
    expect(logoutButtons.length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // Active State
  // -------------------------------------------------------------------------

  it('highlights the active nav item based on pathname', () => {
    mockPathname = '/agents'
    render(<Navigation />)
    const agentsLink = screen.getByText('Agents').closest('a')
    expect(agentsLink).toHaveClass('text-blue-600')
  })

  it('highlights nested routes (e.g. /agents/123)', () => {
    mockPathname = '/agents/123'
    render(<Navigation />)
    const agentsLink = screen.getByText('Agents').closest('a')
    expect(agentsLink).toHaveClass('text-blue-600')
  })

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  it('calls signOut and navigates to login when logout is clicked', async () => {
    render(<Navigation />)
    // Get the desktop logout button (the first one in the DOM)
    const logoutButtons = screen.getAllByText('Logout')
    fireEvent.click(logoutButtons[0])

    // Wait for the async signOut
    await vi.waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
    })
    expect(mockPush).toHaveBeenCalledWith('/auth/login')
    expect(mockRefresh).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Mobile Menu
  // -------------------------------------------------------------------------

  it('toggles mobile menu on hamburger button click', () => {
    render(<Navigation />)
    // Find the mobile menu toggle button (the one in sm:hidden)
    const buttons = screen.getAllByRole('button')
    // The last button in the DOM before the mobile section is the hamburger
    const mobileToggle = buttons.find(btn => btn.className.includes('sm:hidden') || btn.closest('.sm\\:hidden') || btn.closest('[class*="sm:hidden"]'))
    // Alternate approach: find the button that is not "Logout"
    const hamburgerButton = buttons.filter(b => !b.textContent?.includes('Logout'))[0]

    if (hamburgerButton) {
      fireEvent.click(hamburgerButton)
      // After clicking, mobile menu should appear with nav items duplicated
      const dashboardLinks = screen.getAllByText('Dashboard')
      expect(dashboardLinks.length).toBeGreaterThanOrEqual(2)
    }
  })
})
