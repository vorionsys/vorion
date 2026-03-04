'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Shield,
  Zap,
  Users,
  Building2,
  ArrowRight,
  Check,
  ChevronRight,
  Bot,
  Lock,
  BarChart3,
  Workflow,
} from 'lucide-react'

// Product tiers — all 5 shown on landing page
const tiers = [
  {
    name: 'Core',
    price: 'Free',
    priceDetail: 'forever',
    description: 'Get started with trust-verified AI agents.',
    features: [
      'Up to 3 agents (T0-T3)',
      '1,000 executions/month',
      'Basic analytics',
      'Community support',
    ],
    cta: 'Get Started Free',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '$12',
    priceDetail: '/month',
    description: 'For individuals shipping AI-powered apps.',
    features: [
      'Up to 10 agents (T0-T4)',
      '10,000 executions/month',
      'Private agents & API access',
      'Email support',
    ],
    cta: 'Start Starter Trial',
    href: '/signup?plan=starter',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$49',
    priceDetail: '/month',
    description: 'For teams building production workflows.',
    features: [
      'Unlimited agents (T0-T5)',
      '50,000 executions/month',
      'Team collaboration & webhooks',
      'Priority support & audit logs',
    ],
    cta: 'Start Pro Trial',
    href: '/signup?plan=pro',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$99',
    priceDetail: '/month',
    description: 'For growing teams with compliance needs.',
    features: [
      'Everything in Pro (T0-T6)',
      '200,000 executions/month',
      'SSO/SAML & RBAC',
      'Compliance dashboards',
    ],
    cta: 'Start Team Trial',
    href: '/signup?plan=team',
    highlight: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    priceDetail: 'pricing',
    description: 'Enterprise-grade AI governance.',
    features: [
      'Full T0-T7 trust tiers',
      'Unlimited executions',
      'On-premise & custom SLAs',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    href: '/contact',
    highlight: false,
  },
]

// Features
const features = [
  {
    icon: Shield,
    title: 'Trust-Verified',
    description: 'Every agent is scored and certified by AgentAnchor. Know exactly what your AI can do.',
  },
  {
    icon: Lock,
    title: 'Governed Execution',
    description: 'BASIS enforcement layers ensure agents operate within defined boundaries.',
  },
  {
    icon: BarChart3,
    title: 'Full Transparency',
    description: 'Real-time trust scores, audit trails, and compliance reports at your fingertips.',
  },
  {
    icon: Workflow,
    title: 'Intelligent Orchestration',
    description: 'Coordinate multiple agents with built-in safeguards and escalation paths.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aurais-primary to-aurais-accent flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gradient">Aurais</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-gray-300 hover:text-white transition">Features</Link>
              <Link href="#pricing" className="text-gray-300 hover:text-white transition">Pricing</Link>
              <Link href="/docs" className="text-gray-300 hover:text-white transition">Docs</Link>
              <Link href="/login" className="text-gray-300 hover:text-white transition">Login</Link>
              <Link
                href="/signup"
                className="px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition font-medium"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-8">
            <Shield className="w-4 h-4 text-aurais-primary" />
            <span className="text-sm text-gray-300">Powered by AgentAnchor Trust Infrastructure</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
            <span className="text-gradient">Trust-Verified</span>
            <br />
            AI Agents
          </h1>

          <p className="text-xl text-gray-400 max-w-3xl mx-auto mb-12">
            Deploy AI agents with confidence. Aurais provides certified, governed agents
            backed by real-time trust scoring and full execution transparency.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition font-medium text-lg glow-primary animate-pulse-glow"
            >
              Start Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl glass glass-hover transition font-medium text-lg"
            >
              Watch Demo <ChevronRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Why Choose <span className="text-gradient">Aurais</span>?
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              The only AI agent platform built on a foundation of trust and governance.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl glass glass-hover transition">
                <div className="w-12 h-12 rounded-xl bg-aurais-primary/20 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-aurais-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Architecture */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-black/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                Built on <span className="text-gradient">Vorion</span> Trust Infrastructure
              </h2>
              <p className="text-gray-400 mb-8">
                Aurais agents are backed by the complete Vorion governance stack:
                AgentAnchor for trust certification, BASIS for governance framework,
                and Cognigate for enforcement runtime.
              </p>
              <div className="space-y-4">
                {[
                  { label: 'AgentAnchor', desc: 'Trust scoring & certification' },
                  { label: 'BASIS', desc: 'Open governance standard' },
                  { label: 'Cognigate', desc: 'Enforcement engine runtime' },
                  { label: 'CAR', desc: 'Agent identity & credentials' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-aurais-primary/20 flex items-center justify-center">
                      <Check className="w-4 h-4 text-aurais-primary" />
                    </div>
                    <div>
                      <span className="font-medium">{item.label}</span>
                      <span className="text-gray-400 text-sm ml-2">— {item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="rounded-2xl glass p-8 animate-float">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-aurais-primary to-aurais-accent mb-4">
                    <Shield className="w-8 h-8" />
                  </div>
                  <div className="text-2xl font-bold">847</div>
                  <div className="text-sm text-gray-400">Trust Score</div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Tier</span>
                    <span className="text-aurais-primary font-medium">Certified ●</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Events Scored</span>
                    <span>12,847</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Violations</span>
                    <span className="text-green-400">0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Choose Your <span className="text-gradient">Plan</span>
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              From individual users to enterprise teams, Aurais scales with your needs.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {tiers.map((tier, i) => (
              <div
                key={i}
                className={`relative rounded-2xl ${
                  tier.highlight
                    ? 'glass glow-primary border-aurais-primary'
                    : 'glass'
                } p-6 transition`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-aurais-primary text-xs font-medium">
                    Most Popular
                  </div>
                )}
                <div className="mb-4">
                  <div className="text-xl font-bold">{tier.name}</div>
                  <p className="text-gray-400 text-xs mt-1">{tier.description}</p>
                </div>
                <div className="mb-4">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-gray-400 text-sm ml-1">{tier.priceDetail}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {tier.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-aurais-primary mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.href}
                  className={`block w-full py-2.5 rounded-xl text-center text-sm font-medium transition ${
                    tier.highlight
                      ? 'bg-aurais-primary hover:bg-aurais-secondary'
                      : 'glass glass-hover'
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="rounded-3xl glass p-12 glow-accent">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Ready to Deploy Trusted AI?
            </h2>
            <p className="text-gray-400 mb-8 max-w-2xl mx-auto">
              Join thousands of developers building with confidence on Aurais.
              Start free, scale as you grow.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition font-medium text-lg"
            >
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aurais-primary to-aurais-accent flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">Aurais</span>
              </div>
              <p className="text-gray-400 text-sm">
                Trust-verified AI agents for everyone.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/features" className="hover:text-white transition">Features</Link></li>
                <li><Link href="/pricing" className="hover:text-white transition">Pricing</Link></li>
                <li><Link href="/docs" className="hover:text-white transition">Documentation</Link></li>
                <li><Link href="/changelog" className="hover:text-white transition">Changelog</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/about" className="hover:text-white transition">About</Link></li>
                <li><Link href="/blog" className="hover:text-white transition">Blog</Link></li>
                <li><Link href="/careers" className="hover:text-white transition">Careers</Link></li>
                <li><Link href="/contact" className="hover:text-white transition">Contact</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/privacy" className="hover:text-white transition">Privacy</Link></li>
                <li><Link href="/terms" className="hover:text-white transition">Terms</Link></li>
                <li><Link href="/security" className="hover:text-white transition">Security</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-400">
              &copy; {new Date().getFullYear()} Vorion. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>Part of the</span>
              <Link href="https://vorion.org" className="text-aurais-primary hover:text-aurais-secondary transition">
                Vorion Ecosystem
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
