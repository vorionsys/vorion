'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { ChevronDown, ExternalLink, Menu, X } from 'lucide-react';

const navigation = [
  {
    label: 'Product',
    items: [
      { label: 'Features', href: '/#platform', description: 'Core governance capabilities' },
      { label: 'Trust Calculator', href: '/calculator', description: 'Interactive trust score calculator' },
      { label: 'Try Demo', href: '/demo', description: 'Code-along governance demo' },
    ],
  },
  {
    label: 'Ecosystem',
    items: [
      { label: 'BASIS Standard', href: '/basis', description: 'The open governance standard' },
      { label: 'Cognigate Engine', href: 'https://cognigate.dev', external: true, description: 'Reference implementation' },
      { label: 'AgentAnchor', href: 'https://agentanchorai.com', external: true, description: 'Certification platform' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'Documentation', href: 'https://cognigate.dev/docs', external: true, description: 'API reference & guides' },
      { label: 'NPM Package', href: 'https://www.npmjs.com/package/@vorionsys/atsf-core', external: true, description: '@vorionsys/atsf-core' },
      { label: 'GitHub', href: 'https://github.com/vorionsys', external: true, description: 'Source code & issues' },
      { label: 'OpenAPI Spec', href: 'https://cognigate.dev/openapi.json', external: true, description: 'API specification' },
    ],
  },
  {
    label: 'Company',
    items: [
      { label: 'About', href: '/manifesto', description: 'Our team & mission' },
      { label: 'Status', href: '/status', description: 'Ecosystem health' },
      { label: 'Discord', href: 'https://discord.gg/basis-protocol', external: true, description: 'Join the community' },
      { label: 'Contact', href: '/#contact', description: 'Get in touch' },
    ],
  },
];

export function Header() {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-lg border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <Image src="/vorion.png" alt="VORION" width={32} height={32} className="w-8 h-8" />
          <span className="font-semibold text-lg tracking-tight text-white">VORION</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navigation.map((section) => (
            <div
              key={section.label}
              className="relative"
              onMouseEnter={() => setOpenDropdown(section.label)}
              onMouseLeave={() => setOpenDropdown(null)}
            >
              <button className="px-3 py-2 text-sm text-zinc-300 hover:text-white flex items-center gap-1 transition-colors">
                {section.label}
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${
                    openDropdown === section.label ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Dropdown */}
              {openDropdown === section.label && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-2">
                  {section.items.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                    >
                      <div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <div className="text-xs text-zinc-500">{item.description}</div>
                      </div>
                      {item.external && (
                        <ExternalLink size={12} className="text-zinc-600" />
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <Link
            href="https://discord.gg/basis-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Discord
          </Link>
          <Link
            href="/demo"
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors text-white"
          >
            Try Demo
          </Link>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-zinc-400 hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-zinc-900 border-t border-zinc-800 py-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
          {navigation.map((section) => (
            <div key={section.label} className="px-4 py-2">
              <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
                {section.label}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  className="flex items-center justify-between py-2 text-zinc-300 hover:text-white"
                  onClick={() => setMobileOpen(false)}
                >
                  <span>{item.label}</span>
                  {item.external && <ExternalLink size={12} className="text-zinc-600" />}
                </Link>
              ))}
            </div>
          ))}
          <div className="px-4 pt-4 border-t border-zinc-800 mt-4">
            <Link
              href="/demo"
              className="block w-full py-3 text-center bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors text-white"
              onClick={() => setMobileOpen(false)}
            >
              Try Demo
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
