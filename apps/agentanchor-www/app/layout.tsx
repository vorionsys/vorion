import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://agentanchorai.com'),
  title: 'AgentAnchor - AI Governance Platform',
  description: 'Enterprise AI governance infrastructure. Deploy AI agents you can trust with real-time trust scoring, capability gating, and immutable audit trails.',
  keywords: ['AI governance', 'AI agents', 'trust scoring', 'AI accountability', 'AI compliance', 'agent governance', 'AI safety', 'enterprise AI'],
  authors: [{ name: 'AgentAnchor Team' }],
  icons: {
    icon: '/favicon.svg',
    apple: '/agentanchor-icon.svg',
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'AgentAnchor - AI Governance Platform',
    description: 'Enterprise AI governance infrastructure. Real-time trust scoring, capability gating, and immutable audit trails.',
    url: 'https://agentanchorai.com',
    siteName: 'AgentAnchor',
    images: ['/agentanchor-logo.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentAnchor - AI Governance Platform',
    description: 'Governance infrastructure for autonomous AI agents.',
    creator: '@agentanchor',
  },
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'AgentAnchor',
  description: 'Enterprise AI governance infrastructure. Deploy AI agents you can trust with real-time trust scoring, capability gating, and immutable audit trails.',
  url: 'https://agentanchorai.com',
  logo: 'https://agentanchorai.com/agentanchor-logo.svg',
  sameAs: [
    'https://github.com/vorionsys',
    'https://basis.vorion.org',
    'https://vorion.org',
  ],
  parentOrganization: {
    '@type': 'Organization',
    name: 'Vorion',
    url: 'https://vorion.org',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className={`${inter.className} antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
