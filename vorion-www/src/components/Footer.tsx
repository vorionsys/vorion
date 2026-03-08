'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Github, MessageCircle, Twitter, Linkedin, Mail, ExternalLink } from 'lucide-react';

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const footerSections: Record<string, FooterLink[]> = {
  Product: [
    { label: 'Features', href: '/#platform' },
    { label: 'Demo', href: '/demo' },
  ],
  Ecosystem: [
    { label: 'BASIS Standard', href: '/basis' },
    { label: 'Cognigate', href: 'https://cognigate.dev', external: true },
    { label: 'AgentAnchor', href: 'https://agentanchorai.com', external: true },
    { label: 'Kaizen', href: 'https://learn.vorion.org', external: true },
  ],
  Developers: [
    { label: 'Documentation', href: 'https://cognigate.dev/docs', external: true },
    { label: 'NPM Package', href: 'https://www.npmjs.com/package/@vorionsys/atsf-core', external: true },
    { label: 'GitHub', href: 'https://github.com/vorionsys', external: true },
    { label: 'OpenAPI Spec', href: 'https://cognigate.dev/openapi.json', external: true },
  ],
  Company: [
    { label: 'About', href: '/manifesto' },
    { label: 'NIST Submissions', href: '/basis/nist' },
    { label: 'Contact', href: '/#contact' },
    { label: 'Status', href: '/status' },
  ],
  Legal: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Security', href: '/security' },
  ],
};

const socialLinks = [
  { icon: Github, href: 'https://github.com/vorionsys', label: 'GitHub' },
  { icon: MessageCircle, href: 'https://discord.gg/basis-protocol', label: 'Discord' },
  { icon: Twitter, href: 'https://twitter.com/vorionorg', label: 'Twitter' },
  { icon: Linkedin, href: 'https://linkedin.com/company/vorion', label: 'LinkedIn' },
  { icon: Mail, href: 'mailto:hello@vorion.org', label: 'Email' },
];

export function Footer() {
  return (
    <footer className="bg-black border-t border-zinc-800 py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-12">
          {/* Brand Column */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-4">
              <Image src="/vorion.png" alt="VORION" width={32} height={32} className="w-8 h-8" />
              <span className="font-semibold text-lg text-white">VORION</span>
            </Link>
            <p className="text-zinc-500 text-sm mb-6 max-w-xs">
              Governance for the Autonomous Age. Infrastructure to bind AI agents
              to verifiable human intent.
            </p>
            {/* Social Links */}
            <div className="flex items-center gap-4">
              {socialLinks.map((social) => (
                <Link
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-600 hover:text-white transition-colors"
                  aria-label={social.label}
                >
                  <social.icon size={20} />
                </Link>
              ))}
            </div>
          </div>

          {/* Link Columns */}
          {Object.entries(footerSections).map(([title, links]) => (
            <div key={title}>
              <h4 className="font-semibold text-sm text-white mb-4">{title}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="text-sm text-zinc-500 hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                      {link.label}
                      {link.external && <ExternalLink size={10} className="opacity-50" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Compliance Badges */}
        <div className="border-t border-zinc-800 pt-8 mb-8">
          <p className="text-xs text-zinc-600 uppercase tracking-wide mb-3">
            Designed for compliance with
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 mb-5">
            {([
              { label: 'NIST AI RMF', href: '/basis/compliance#nist-ai-rmf', tip: 'NIST AI Risk Management Framework' },
              { label: 'EU AI Act', href: '/basis/compliance#eu-ai-act', tip: 'EU Artificial Intelligence Act (Art. 9–15)' },
              { label: 'ISO 42001', href: '/basis/compliance#iso-42001', tip: 'ISO/IEC 42001 AI Management Systems' },
              { label: 'SOC 2', href: '/basis/compliance#soc2', tip: 'SOC 2 Type II — Security & Availability' },
              { label: 'GDPR', href: '/basis/compliance#gdpr', tip: 'EU General Data Protection Regulation' },
            ] as const).map(({ label, href, tip }) => (
              <div key={label} className="group relative">
                <Link
                  href={href}
                  className="px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800 hover:border-zinc-600 hover:text-white transition-colors"
                >
                  {label}
                </Link>
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                  <div className="bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
                    {tip}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-700 uppercase tracking-wide mb-3">Roadmap</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {([
              { label: 'NIST AI 600-1', tip: 'NIST GenAI Profile · Targeting 2026', href: 'https://airc.nist.gov/Docs/1' },
              { label: 'EU AI Act Milestones', tip: 'Full enforcement milestones · Aug 2026', href: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai' },
              { label: 'CAISI', tip: 'NIST Collaborative AI Standards Initiative · 2026', href: 'https://airc.nist.gov/Docs/2' },
              { label: 'ISO 42005', tip: 'AI Impact Assessment Standard · In development', href: 'https://www.iso.org/standard/44546.html' },
              { label: 'CISA AI Guidelines', tip: 'CISA Secure AI Development · 2026', href: 'https://www.cisa.gov/ai' },
            ] as const).map(({ label, tip, href }) => (
              <div key={label} className="group relative">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 bg-zinc-900/50 rounded-full border border-dashed border-zinc-700 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400 transition-colors text-sm inline-block"
                >
                  {label}
                </a>
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                  <div className="bg-zinc-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg">
                    {tip}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-zinc-600">
            &copy; {new Date().getFullYear()} Vorion Risk, LLC. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-zinc-600">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
            <Link href="/security" className="hover:text-white transition-colors">
              Security
            </Link>
            <Link
              href="https://cognigate.dev/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              API
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
