import Link from 'next/link';
import { urls } from '../../lib/config';
import {
  Shield,
  ShoppingCart,
  Rocket,
  Search,
  Award,
  Users,
  TrendingUp,
  Zap,
  CheckCircle,
  ArrowRight,
  Star,
  Bot,
  GraduationCap,
  Coins,
} from 'lucide-react';

// Trust tier configuration
const trustTiers: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  T0: { label: 'T0 Sandbox', color: 'text-gray-400', bgColor: 'bg-gray-500/10', borderColor: 'border-gray-500/30' },
  T1: { label: 'T1 Provisional', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  T2: { label: 'T2 Established', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30' },
  T3: { label: 'T3 Trusted', color: 'text-lime-400', bgColor: 'bg-lime-500/10', borderColor: 'border-lime-500/30' },
  T4: { label: 'T4 Verified', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  T5: { label: 'T5 Certified', color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', borderColor: 'border-cyan-500/30' },
};

// Mock agent data
const featuredAgents = [
  {
    id: 'agent-001',
    name: 'DataSentinel Pro',
    description: 'Enterprise-grade data analysis and reporting agent with advanced pattern recognition and anomaly detection capabilities.',
    trustTier: 'T5',
    trustScore: 945,
    specialization: 'Data Analysis',
    pricing: { model: 'subscription', price: '$299/mo' },
    rating: 4.9,
    deployments: 1243,
    trainer: 'Nexus Labs',
  },
  {
    id: 'agent-002',
    name: 'ComplianceGuard',
    description: 'Automated compliance monitoring and regulatory reporting. SOC2, HIPAA, and GDPR policy enforcement.',
    trustTier: 'T5',
    trustScore: 912,
    specialization: 'Compliance',
    pricing: { model: 'commission', price: '2.5% per audit' },
    rating: 4.8,
    deployments: 876,
    trainer: 'RegTech Solutions',
  },
  {
    id: 'agent-003',
    name: 'CustomerVoice AI',
    description: 'Multi-channel customer support agent with sentiment analysis and escalation routing. 24/7 availability.',
    trustTier: 'T4',
    trustScore: 784,
    specialization: 'Customer Support',
    pricing: { model: 'per-interaction', price: '$0.12/interaction' },
    rating: 4.7,
    deployments: 2156,
    trainer: 'CX Dynamics',
  },
  {
    id: 'agent-004',
    name: 'CodeReview Assistant',
    description: 'Automated code review with security vulnerability detection, best practices enforcement, and documentation generation.',
    trustTier: 'T4',
    trustScore: 721,
    specialization: 'Development',
    pricing: { model: 'subscription', price: '$149/mo' },
    rating: 4.6,
    deployments: 534,
    trainer: 'DevOps Academy',
  },
  {
    id: 'agent-005',
    name: 'InvoiceProcessor',
    description: 'Intelligent invoice processing with OCR, validation, and ERP integration. Reduces manual processing by 95%.',
    trustTier: 'T3',
    trustScore: 567,
    specialization: 'Finance',
    pricing: { model: 'per-document', price: '$0.50/invoice' },
    rating: 4.5,
    deployments: 1892,
    trainer: 'FinanceAI Corp',
  },
  {
    id: 'agent-006',
    name: 'TalentScout',
    description: 'Resume screening and candidate matching with bias detection. Integrates with major ATS platforms.',
    trustTier: 'T3',
    trustScore: 523,
    specialization: 'HR & Recruiting',
    pricing: { model: 'per-hire', price: '$25/candidate screened' },
    rating: 4.4,
    deployments: 445,
    trainer: 'PeopleFirst AI',
  },
  {
    id: 'agent-007',
    name: 'MarketPulse',
    description: 'Real-time market analysis and trading signal generation. Supports equities, crypto, and forex markets.',
    trustTier: 'T2',
    trustScore: 389,
    specialization: 'Trading & Finance',
    pricing: { model: 'subscription', price: '$499/mo' },
    rating: 4.3,
    deployments: 234,
    trainer: 'AlgoTrade Labs',
  },
  {
    id: 'agent-008',
    name: 'HealthCheck AI',
    description: 'Medical records analysis and preliminary diagnostic suggestions. HIPAA compliant with physician review workflow.',
    trustTier: 'T4',
    trustScore: 756,
    specialization: 'Healthcare',
    pricing: { model: 'enterprise', price: 'Contact Sales' },
    rating: 4.8,
    deployments: 189,
    trainer: 'MedTech Innovations',
  },
];

const howItWorks = [
  {
    step: 1,
    title: 'Browse',
    description: 'Explore the marketplace to find agents that match your needs. Filter by trust tier, specialization, and pricing model.',
    icon: Search,
    color: 'from-blue-500 to-blue-600',
  },
  {
    step: 2,
    title: 'Acquire',
    description: 'Choose your pricing model and acquire the agent. Review trust scores, audit trails, and trainer reputation before deploying.',
    icon: ShoppingCart,
    color: 'from-purple-500 to-purple-600',
  },
  {
    step: 3,
    title: 'Deploy',
    description: 'Deploy instantly with full governance controls. Monitor performance, set capability limits, and scale as needed.',
    icon: Rocket,
    color: 'from-cyan-500 to-cyan-600',
  },
];

const trainerBenefits = [
  {
    title: 'Earn Revenue',
    description: 'Set your pricing model and earn commissions on every deployment of your trained agents.',
    icon: Coins,
  },
  {
    title: 'Build Reputation',
    description: 'Your agents build trust scores over time, increasing their visibility and demand in the marketplace.',
    icon: TrendingUp,
  },
  {
    title: 'Access Tools',
    description: 'Use our sandbox, shadow training, and analytics tools to create high-performing agents.',
    icon: Zap,
  },
  {
    title: 'Get Certified',
    description: 'Complete our trainer certification program to unlock premium marketplace features.',
    icon: Award,
  },
];

const consumerBenefits = [
  {
    title: 'Verified Trust',
    description: 'Every agent has a transparent trust score built from real-world performance and governance compliance.',
    icon: Shield,
  },
  {
    title: 'Instant Deployment',
    description: 'Deploy pre-trained agents in minutes with full governance controls already configured.',
    icon: Rocket,
  },
  {
    title: 'Full Audit Trail',
    description: 'Every agent action is logged with cryptographic proof. Know exactly what your agents are doing.',
    icon: CheckCircle,
  },
  {
    title: 'Community Ratings',
    description: 'Real reviews from real deployments help you choose the right agent for your use case.',
    icon: Star,
  },
];

export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-[#05050a] text-gray-200">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#05050a]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <span className="text-xl font-semibold text-white">AgentAnchor</span>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <Link href="/" className="text-gray-400 hover:text-white transition text-sm font-medium">Home</Link>
              <Link href="/marketplace" className="text-cyan-400 text-sm font-medium">Marketplace</Link>
              <Link href="/pricing" className="text-gray-400 hover:text-white transition text-sm font-medium">Pricing</Link>
              <a href={urls.discord} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition text-sm font-medium">
                Discord
              </a>
              <a href={urls.app} className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-white rounded-lg transition text-sm font-medium">
                Launch App
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium">
            <Bot className="w-4 h-4" />
            AI Agent Marketplace
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight tracking-tight">
            Discover Trusted<br />
            <span className="bg-gradient-to-r from-cyan-400 to-cyan-300 bg-clip-text text-transparent">AI Agents</span>
          </h1>

          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Browse, acquire, and deploy pre-trained AI agents with verified trust scores.
            Every agent comes with full governance controls and immutable audit trails.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={urls.app}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-white rounded-lg font-semibold transition shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 inline-flex items-center justify-center gap-2"
            >
              <Search className="w-5 h-5" />
              Browse Agents
            </a>
            <a
              href="#for-trainers"
              className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-semibold transition inline-flex items-center justify-center gap-2"
            >
              <GraduationCap className="w-5 h-5" />
              Become a Trainer
            </a>
          </div>

          {/* Stats */}
          <div className="mt-16 pt-8 border-t border-white/5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div>
                <div className="text-3xl font-bold text-white mb-1">500+</div>
                <div className="text-sm text-gray-500">Trained Agents</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white mb-1">12K+</div>
                <div className="text-sm text-gray-500">Deployments</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white mb-1">98%</div>
                <div className="text-sm text-gray-500">Trust Compliance</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white mb-1">200+</div>
                <div className="text-sm text-gray-500">Certified Trainers</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Agents Grid */}
      <section className="py-20 bg-white/[0.02] border-y border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium">
              <Star className="w-4 h-4" />
              Featured
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">
              Top-Rated Agents
            </h2>
            <p className="text-lg text-gray-400">
              Explore our highest-rated agents with verified trust scores and proven track records.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredAgents.map((agent) => {
              const tier = trustTiers[agent.trustTier];
              return (
                <div
                  key={agent.id}
                  className="bg-white/5 rounded-xl border border-white/5 hover:border-cyan-500/30 transition overflow-hidden group"
                >
                  {/* Agent Header */}
                  <div className="p-5 pb-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${tier.bgColor} ${tier.color} ${tier.borderColor} border`}>
                        {tier.label}
                      </div>
                      <div className="flex items-center gap-1 text-amber-400">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span className="text-sm font-medium">{agent.rating}</span>
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-cyan-400 transition">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-gray-500 mb-3">by {agent.trainer}</p>
                    <p className="text-sm text-gray-400 line-clamp-2">
                      {agent.description}
                    </p>
                  </div>

                  {/* Agent Footer */}
                  <div className="px-5 py-4 bg-white/[0.02] border-t border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-gray-500">{agent.specialization}</span>
                      <span className="text-xs text-gray-500">{agent.deployments.toLocaleString()} deployments</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="text-white font-medium">{agent.pricing.price}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Trust: <span className="text-cyan-400 font-medium">{agent.trustScore}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <a
              href={urls.app}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition"
            >
              View All Agents
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              How It Works
            </h2>
            <p className="text-lg text-gray-400">
              Get started with trusted AI agents in three simple steps.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {howItWorks.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="relative">
                  {/* Connector line for desktop */}
                  {step.step < 3 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-white/20 to-transparent" />
                  )}

                  <div className="text-center">
                    <div className={`w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg`}>
                      <Icon className="w-10 h-10 text-white" />
                    </div>
                    <div className="text-sm text-cyan-400 font-medium mb-2">Step {step.step}</div>
                    <h3 className="text-xl font-semibold text-white mb-3">{step.title}</h3>
                    <p className="text-gray-400">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* For Trainers Section */}
      <section id="for-trainers" className="py-20 bg-gradient-to-b from-purple-500/5 to-transparent border-y border-purple-500/10 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-purple-400 text-sm font-medium">
                <GraduationCap className="w-4 h-4" />
                For Trainers
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">
                Train Agents. Earn Revenue.
              </h2>
              <p className="text-lg text-gray-400 mb-8">
                Join our community of AI trainers and build a sustainable business by creating high-quality,
                trusted AI agents. Set your own pricing and earn commissions on every deployment.
              </p>

              <div className="grid sm:grid-cols-2 gap-6">
                {trainerBenefits.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <div key={benefit.title} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white mb-1">{benefit.title}</h3>
                        <p className="text-sm text-gray-400">{benefit.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8">
                <a
                  href={urls.app}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-purple-500 hover:bg-purple-400 text-white rounded-lg font-medium transition"
                >
                  Start Training
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>

            <div className="bg-white/5 rounded-2xl border border-white/10 p-8">
              <h3 className="text-xl font-semibold text-white mb-6">Trainer Revenue Models</h3>
              <div className="space-y-4">
                {[
                  { model: 'Subscription', desc: 'Monthly recurring revenue per deployment', example: '$50-500/mo per customer' },
                  { model: 'Per-Transaction', desc: 'Earn on each agent interaction', example: '$0.01-0.50 per action' },
                  { model: 'Commission', desc: 'Percentage of value delivered', example: '1-5% of transaction value' },
                  { model: 'Enterprise License', desc: 'Custom pricing for large deployments', example: 'Negotiated contracts' },
                ].map((item) => (
                  <div key={item.model} className="flex items-start gap-4 p-4 bg-white/5 rounded-lg border border-white/5">
                    <CheckCircle className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-white">{item.model}</div>
                      <div className="text-sm text-gray-400">{item.desc}</div>
                      <div className="text-xs text-cyan-400 mt-1">{item.example}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Consumers Section */}
      <section id="for-consumers" className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="bg-white/5 rounded-2xl border border-white/10 p-8">
                <h3 className="text-xl font-semibold text-white mb-6">Trust Tier System</h3>
                <div className="space-y-3">
                  {Object.entries(trustTiers).reverse().map(([key, tier]) => (
                    <div key={key} className="flex items-center gap-4 p-3 bg-white/5 rounded-lg border border-white/5">
                      <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${tier.bgColor} ${tier.color} ${tier.borderColor} border min-w-[100px] text-center`}>
                        {tier.label}
                      </div>
                      <div className="text-sm text-gray-400">
                        {key === 'T5' && 'Highest autonomy, full capability access'}
                        {key === 'T4' && 'Verified track record, expanded permissions'}
                        {key === 'T3' && 'Proven reliability, standard operations'}
                        {key === 'T2' && 'Building trust, supervised actions'}
                        {key === 'T1' && 'Early stage, limited capabilities'}
                        {key === 'T0' && 'Testing phase, sandbox environment'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium">
                <Users className="w-4 h-4" />
                For Consumers
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">
                Deploy AI You Can Trust
              </h2>
              <p className="text-lg text-gray-400 mb-8">
                Every agent in the marketplace comes with verified trust scores, full audit trails,
                and enterprise governance controls. Know exactly what your agents are doing at all times.
              </p>

              <div className="grid sm:grid-cols-2 gap-6">
                {consumerBenefits.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <div key={benefit.title} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white mb-1">{benefit.title}</h3>
                        <p className="text-sm text-gray-400">{benefit.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8">
                <a
                  href={urls.app}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg font-medium transition"
                >
                  Explore Marketplace
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-b from-cyan-500/5 to-transparent border-t border-cyan-500/10">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium">
            <Zap className="w-4 h-4" />
            Get Started Today
          </div>
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Transform Your AI Operations?
          </h2>
          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the marketplace and discover trusted AI agents, or become a trainer and start building your own.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={urls.app}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-white rounded-lg font-semibold transition shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 inline-flex items-center justify-center gap-2"
            >
              Launch App
              <ArrowRight className="w-5 h-5" />
            </a>
            <a
              href={urls.discord}
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-semibold transition inline-flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Join Community
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-gray-500">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="text-white font-semibold">AgentAnchor</span>
            <span className="text-gray-600">|</span>
            <span>&copy; {new Date().getFullYear()} Vorion.</span>
          </div>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-cyan-400 transition-colors">
              Home
            </Link>
            <Link href="/marketplace" className="hover:text-cyan-400 transition-colors">
              Marketplace
            </Link>
            <Link href="/pricing" className="hover:text-cyan-400 transition-colors">
              Pricing
            </Link>
            <a href="https://vorion.org" className="hover:text-cyan-400 transition-colors">
              Vorion
            </a>
            <a href={urls.discord} className="hover:text-cyan-400 transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Discord
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
