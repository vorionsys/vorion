// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import RoleBadge from '../profile/RoleBadge'

describe('RoleBadge', () => {
  // -------------------------------------------------------------------------
  // Rendering different roles
  // -------------------------------------------------------------------------

  it('renders Trainer label for trainer role', () => {
    render(<RoleBadge role="trainer" />)
    expect(screen.getByText('Trainer')).toBeInTheDocument()
  })

  it('renders Consumer label for consumer role', () => {
    render(<RoleBadge role="consumer" />)
    expect(screen.getByText('Consumer')).toBeInTheDocument()
  })

  it('renders Trainer & Consumer label for both role', () => {
    render(<RoleBadge role="both" />)
    expect(screen.getByText('Trainer & Consumer')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  it('applies default md size classes', () => {
    const { container } = render(<RoleBadge role="trainer" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-sm')
    expect(badge.className).toContain('py-1')
  })

  it('applies sm size classes', () => {
    const { container } = render(<RoleBadge role="trainer" size="sm" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('text-xs')
    expect(badge.className).toContain('py-0.5')
  })

  // -------------------------------------------------------------------------
  // Color theming
  // -------------------------------------------------------------------------

  it('applies purple color for trainer', () => {
    const { container } = render(<RoleBadge role="trainer" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-purple-100')
    expect(badge.className).toContain('text-purple-700')
  })

  it('applies blue color for consumer', () => {
    const { container } = render(<RoleBadge role="consumer" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-blue-100')
    expect(badge.className).toContain('text-blue-700')
  })

  it('applies green color for both', () => {
    const { container } = render(<RoleBadge role="both" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-green-100')
    expect(badge.className).toContain('text-green-700')
  })

  // -------------------------------------------------------------------------
  // Icon presence
  // -------------------------------------------------------------------------

  it('renders an SVG icon', () => {
    const { container } = render(<RoleBadge role="trainer" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })
})
