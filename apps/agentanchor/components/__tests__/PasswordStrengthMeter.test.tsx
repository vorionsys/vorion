// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PasswordStrengthMeter, validatePassword } from '../auth/PasswordStrengthMeter'

describe('PasswordStrengthMeter', () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('renders nothing when password is empty', () => {
    const { container } = render(<PasswordStrengthMeter password="" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the strength bar and checklist when password is provided', () => {
    render(<PasswordStrengthMeter password="a" />)
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument()
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument()
    expect(screen.getByText('One lowercase letter')).toBeInTheDocument()
    expect(screen.getByText('One number')).toBeInTheDocument()
    expect(screen.getByText('One special character (!@#$%^&*)')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Strength Levels
  // -------------------------------------------------------------------------

  it('shows Weak label for a single lowercase letter', () => {
    render(<PasswordStrengthMeter password="a" />)
    expect(screen.getByText('Weak')).toBeInTheDocument()
  })

  it('shows Weak label for two checks met (lowercase + number)', () => {
    render(<PasswordStrengthMeter password="a1" />)
    expect(screen.getByText('Weak')).toBeInTheDocument()
  })

  it('shows Fair label for three checks met', () => {
    render(<PasswordStrengthMeter password="aA1" />)
    expect(screen.getByText('Fair')).toBeInTheDocument()
  })

  it('shows Good label for four checks met', () => {
    render(<PasswordStrengthMeter password="aA1!short" />)
    // This should hit 4 checks: lowercase, uppercase, number, special
    // But also >= 8 chars, so it hits all 5 = Strong
    // Use a shorter password to hit exactly 4
    const { unmount } = render(<PasswordStrengthMeter password="aA1!" />)
    expect(screen.getByText('Good')).toBeInTheDocument()
    unmount()
  })

  it('shows Strong label when all checks are met', () => {
    render(<PasswordStrengthMeter password="MyP@ssw0rd" />)
    expect(screen.getByText('Strong')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Individual Checks
  // -------------------------------------------------------------------------

  it('marks 8+ characters check as met when password is long enough', () => {
    render(<PasswordStrengthMeter password="abcdefgh" />)
    const item = screen.getByText('At least 8 characters')
    // The met item gets green color class
    expect(item.closest('li')).toHaveClass('text-green-600')
  })

  it('marks 8+ characters check as unmet when password is too short', () => {
    render(<PasswordStrengthMeter password="abc" />)
    const item = screen.getByText('At least 8 characters')
    expect(item.closest('li')).toHaveClass('text-gray-500')
  })

  it('marks uppercase check as met with uppercase letter', () => {
    render(<PasswordStrengthMeter password="A" />)
    const item = screen.getByText('One uppercase letter')
    expect(item.closest('li')).toHaveClass('text-green-600')
  })

  it('marks number check as met with digit', () => {
    render(<PasswordStrengthMeter password="5" />)
    const item = screen.getByText('One number')
    expect(item.closest('li')).toHaveClass('text-green-600')
  })

  it('marks special character check as met with special char', () => {
    render(<PasswordStrengthMeter password="@" />)
    const item = screen.getByText('One special character (!@#$%^&*)')
    expect(item.closest('li')).toHaveClass('text-green-600')
  })
})

describe('validatePassword', () => {
  it('returns valid: true for a strong password', () => {
    const result = validatePassword('MyP@ssw0rd')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns errors for empty password', () => {
    const result = validatePassword('')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must be at least 8 characters')
    expect(result.errors).toContain('Password must contain at least one uppercase letter')
    expect(result.errors).toContain('Password must contain at least one lowercase letter')
    expect(result.errors).toContain('Password must contain at least one number')
    expect(result.errors).toContain('Password must contain at least one special character')
  })

  it('returns error for short password', () => {
    const result = validatePassword('Ab1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must be at least 8 characters')
  })

  it('returns error for missing uppercase', () => {
    const result = validatePassword('myp@ssw0rd')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one uppercase letter')
  })

  it('returns error for missing lowercase', () => {
    const result = validatePassword('MYP@SSW0RD')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one lowercase letter')
  })

  it('returns error for missing number', () => {
    const result = validatePassword('MyP@ssword')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one number')
  })

  it('returns error for missing special character', () => {
    const result = validatePassword('MyPassw0rd')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Password must contain at least one special character')
  })
})
