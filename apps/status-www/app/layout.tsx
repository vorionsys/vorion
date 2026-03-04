import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://status.agentanchorai.com'),
  title: 'Agent Anchor Status — Platform Health',
  description:
    'Real-time health monitoring for Agent Anchor services. Service status, uptime tracking, and incident reports.',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'Agent Anchor Status — Platform Health',
    description:
      'Real-time health monitoring for Agent Anchor services. Service status, uptime tracking, and incident reports.',
    url: 'https://status.agentanchorai.com',
    siteName: 'Agent Anchor Status',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Agent Anchor Status — Platform Health',
    description:
      'Real-time health monitoring for Agent Anchor services. Service status, uptime tracking, and incident reports.',
    images: ['/og-image.png'],
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Agent Anchor Status',
  description:
    'Real-time health monitoring for Agent Anchor services. Service status, uptime tracking, and incident reports.',
  url: 'https://status.agentanchorai.com',
  publisher: {
    '@type': 'Organization',
    name: 'Vorion',
    url: 'https://vorion.org',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="bg-[#05050a] text-white antialiased font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
