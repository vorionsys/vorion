import Link from 'next/link'
import { Bot, Check, ArrowRight, Zap, Shield, Users } from 'lucide-react'

const plans = [
  {
    name: 'Core',
    price: 'Free',
    period: 'forever',
    description: 'Get started with AI agents',
    features: [
      'Up to 3 agents',
      'T0-T3 trust tiers',
      '1,000 executions/month',
      'Community support',
      'Basic analytics',
      'Public marketplace access',
    ],
    cta: 'Start Free',
    href: '/signup?plan=core',
    highlighted: false,
  },
  {
    name: 'Starter',
    price: '$12',
    period: '/month',
    description: 'For individuals shipping AI-powered apps',
    features: [
      'Up to 10 agents',
      'T0-T4 trust tiers',
      '10,000 executions/month',
      'Email support',
      'Standard analytics',
      'Private agents',
      'API access',
    ],
    cta: 'Start Starter Trial',
    href: '/signup?plan=starter',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/month',
    description: 'For teams building production workflows',
    features: [
      'Unlimited agents',
      'T0-T5 trust tiers',
      '50,000 executions/month',
      'Priority support',
      'Advanced analytics',
      'Team collaboration (up to 5)',
      'Custom webhooks',
      'Audit logs',
    ],
    cta: 'Start Pro Trial',
    href: '/signup?plan=pro',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$99',
    period: '/month',
    description: 'For growing teams with compliance needs',
    features: [
      'Everything in Pro',
      'T0-T6 trust tiers',
      '200,000 executions/month',
      'Unlimited team members',
      'SSO/SAML',
      'Role-based access control',
      'Compliance dashboards',
      'Dedicated onboarding',
    ],
    cta: 'Start Team Trial',
    href: '/signup?plan=team',
    highlighted: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For orgs with advanced requirements',
    features: [
      'Everything in Team',
      'T0-T7 trust tiers',
      'Unlimited executions',
      'Dedicated support & SLAs',
      'On-premise option',
      'Custom integrations',
      'Compliance reports',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    href: '/contact',
    highlighted: false,
  },
]

const faqs = [
  {
    q: 'What counts as an execution?',
    a: 'An execution is counted each time an agent processes a request or completes a task. Simple queries count as one execution.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.',
  },
  {
    q: 'What trust tiers are available?',
    a: 'Core supports T0-T3, Starter T0-T4, Pro T0-T5, Team T0-T6, and Enterprise unlocks all tiers including T7 for autonomous operations.',
  },
  {
    q: 'Is there a free trial for paid plans?',
    a: 'Yes, Starter, Pro, and Team all include a 14-day free trial with full features. No credit card required to start.',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aurais-primary to-aurais-accent flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gradient">Aurais</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/features" className="text-gray-400 hover:text-white transition">Features</Link>
            <Link href="/pricing" className="text-white font-medium">Pricing</Link>
            <Link href="/docs" className="text-gray-400 hover:text-white transition">Docs</Link>
            <Link href="/login" className="text-gray-400 hover:text-white transition">Sign In</Link>
            <Link href="/signup" className="px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-6">
            Simple, transparent pricing
          </h1>
          <p className="text-xl text-gray-400">
            Start free and scale as you grow. All plans include the BASIS trust framework.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-8 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={`rounded-2xl p-8 ${
                  plan.highlighted
                    ? 'glass border-2 border-aurais-primary relative'
                    : 'glass'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-aurais-primary text-xs font-medium">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
                <p className="text-gray-400 text-sm mb-6">{plan.description}</p>

                <Link
                  href={plan.href}
                  className={`block w-full text-center py-3 rounded-xl font-medium transition mb-6 ${
                    plan.highlighted
                      ? 'bg-aurais-primary hover:bg-aurais-secondary'
                      : 'glass glass-hover'
                  }`}
                >
                  {plan.cta}
                </Link>

                <ul className="space-y-3">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Tiers Comparison */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Trust Tier Access by Plan</h2>
          <div className="glass rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-4 font-medium">Trust Tier</th>
                  <th className="text-center px-4 py-4 font-medium">Core</th>
                  <th className="text-center px-4 py-4 font-medium">Starter</th>
                  <th className="text-center px-4 py-4 font-medium text-aurais-primary">Pro</th>
                  <th className="text-center px-4 py-4 font-medium">Team</th>
                  <th className="text-center px-4 py-4 font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { tier: 'T0-T3 (Sandbox → Monitored)', core: true, starter: true, pro: true, team: true, ent: true },
                  { tier: 'T4 Standard', core: false, starter: true, pro: true, team: true, ent: true },
                  { tier: 'T5 Trusted', core: false, starter: false, pro: true, team: true, ent: true },
                  { tier: 'T6 Certified', core: false, starter: false, pro: false, team: true, ent: true },
                  { tier: 'T7 Autonomous', core: false, starter: false, pro: false, team: false, ent: true },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="px-4 py-4">{row.tier}</td>
                    <td className="px-4 py-4 text-center">
                      {row.core ? <Check className="w-5 h-5 text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {row.starter ? <Check className="w-5 h-5 text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-4 text-center bg-aurais-primary/5">
                      {row.pro ? <Check className="w-5 h-5 text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {row.team ? <Check className="w-5 h-5 text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {row.ent ? <Check className="w-5 h-5 text-green-400 mx-auto" /> : <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="glass rounded-xl p-6">
                <h3 className="font-semibold mb-2">{faq.q}</h3>
                <p className="text-gray-400 text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-gray-400 mb-8">Deploy your first agent in minutes. Free forever on the Core plan.</p>
          <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition font-medium text-lg">
            Start Free <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </div>
  )
}
