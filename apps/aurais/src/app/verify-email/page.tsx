'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Bot, Mail, ArrowRight, RefreshCw } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')
  const [isResending, setIsResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResend = async () => {
    if (!email) return
    setIsResending(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to resend email')
      }

      setResent(true)
      setTimeout(() => setResent(false), 5000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-aurais-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-aurais-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aurais-primary to-aurais-accent flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-gradient">Aurais</span>
          </Link>
        </div>

        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-aurais-primary/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-aurais-primary" />
          </div>

          <h1 className="text-2xl font-bold mb-2">Check your email</h1>
          <p className="text-gray-400 mb-6">
            We've sent you a verification link.{' '}
            {email ? (
              <>Check <strong className="text-white">{email}</strong> and click the link to verify your account.</>
            ) : (
              <>Click the link in your email to verify your account.</>
            )}
          </p>

          <div className="p-4 rounded-xl bg-white/5 mb-6">
            <p className="text-sm text-gray-400">
              The verification link will expire in <strong className="text-white">24 hours</strong>
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {email && (
              <button
                onClick={handleResend}
                disabled={isResending || resent}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl glass glass-hover transition font-medium disabled:opacity-50"
              >
                {isResending ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : resent ? (
                  'Email sent!'
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Resend verification email
                  </>
                )}
              </button>
            )}

            <Link
              href="/login"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition font-medium"
            >
              Continue to sign in
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>

          <p className="text-sm text-gray-500 mt-6">
            Wrong email?{' '}
            <Link href="/signup" className="text-aurais-primary hover:text-aurais-secondary">
              Sign up again
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}
