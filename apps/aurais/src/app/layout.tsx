import type { Metadata } from 'next'
import './globals.css'

// Force all pages to render dynamically (SSR) to avoid React 18/19
// version conflicts during static generation in the monorepo.
// This is the correct setting for an auth-heavy app anyway.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Aurais - Trust-Verified AI Agents',
  description: 'Deploy AI agents with confidence. Aurais provides trust-verified agents backed by AgentAnchor certification.',
  keywords: ['AI agents', 'trust', 'governance', 'automation', 'certified agents'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-aurais-dark text-white antialiased">
        {children}
      </body>
    </html>
  )
}
