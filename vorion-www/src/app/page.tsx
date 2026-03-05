'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight, ChevronLeft, ChevronRight, Shield, Cpu, Scale, Database, Globe, MessageCircle,
  Lock, Unlock, AlertTriangle, CheckCircle, Zap, BarChart3, Users,
  FileCheck, Package, X
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 selection:bg-indigo-500/30">

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-sm mb-8">
            <Shield className="w-4 h-4" />
            Enterprise AI Governance Infrastructure
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-6">
            Trust Scoring for<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-300">
              AI Agents
            </span>
          </h1>

          <p className="text-xl text-neutral-400 leading-relaxed max-w-3xl mx-auto mb-10">
            VORION provides the infrastructure to bind AI agents to verifiable human intent.
            Real-time trust scoring, capability gating, and immutable audit trails.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="#get-started" className="px-6 py-3 bg-white text-black font-semibold rounded hover:bg-neutral-200 transition-colors flex items-center gap-2">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="#demo" className="px-6 py-3 border border-white/10 rounded text-white hover:bg-white/5 transition-colors">
              See Live Demo
            </Link>
            <a href="https://npmjs.com/package/atsf-core" target="_blank" className="px-6 py-3 border border-white/10 rounded text-white hover:bg-white/5 transition-colors flex items-center gap-2">
              <Package className="w-4 h-4" /> npm install atsf-core
            </a>
          </div>
        </div>
      </section>

      {/* The Challenge */}
      <ChallengeSection />

      {/* The Solution - Platform Features */}
      <section id="platform" className="py-20 px-6 bg-gradient-to-b from-transparent to-indigo-500/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4 text-center">The BASIS Solution</h2>
          <p className="text-neutral-400 text-center mb-12 max-w-2xl mx-auto">
            A comprehensive trust infrastructure that gives enterprises visibility, control, and accountability.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            <FeatureCard
              icon={<BarChart3 className="w-6 h-6 text-indigo-400" />}
              title="Trust Scoring"
              description="0–1000 credit-score model with 8 tiers (T0–T7). 16 behavioral factors weighted across foundation, security, agency, maturity, and evolution domains."
              badges={['T7: Autonomous', 'T5: Trusted', 'T4: Standard']}
              badgeColors={['bg-cyan-500/10 text-cyan-400', 'bg-indigo-500/10 text-indigo-400', 'bg-green-500/10 text-green-400']}
              link="/calculator"
              linkLabel="Try the calculator →"
            />
            <FeatureCard
              icon={<Shield className="w-6 h-6 text-purple-400" />}
              title="Capability Gating"
              description="Every action is checked against trust level. Insufficient trust? Request denied, escalated, or degraded automatically."
              badges={['ALLOW', 'DENY', 'ESCALATE', 'DEGRADE']}
              badgeColors={['bg-green-500/10 text-green-400', 'bg-red-500/10 text-red-400', 'bg-yellow-500/10 text-yellow-400', 'bg-orange-500/10 text-orange-400']}
              link="/basis/enforce"
              linkLabel="How enforcement works →"
            />
            <FeatureCard
              icon={<FileCheck className="w-6 h-6 text-emerald-400" />}
              title="Proof Chain"
              description="SHA-256 hashed audit trail with cryptographic verification. Every decision is provable, every action is traceable."
              code="prf_a7b2c9d4e5f6..."
              link="/basis/proof"
              linkLabel="See the proof spec →"
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6 text-orange-400" />}
              title="Trust Decay"
              description="Trust isn't permanent. Scores decay over time with a 182-day half-life. Failures apply a tier-scaled 7–10× penalty — continuous good behavior required."
              footnote="182-day half-life | 7–10× tier-scaled penalty | Real-time updates"
              link="/basis/trust"
              linkLabel="Understand trust dynamics →"
            />
          </div>
        </div>
      </section>

      {/* Animated Demo */}
      <section id="demo" className="py-20 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4 text-center">See It In Action</h2>
          <p className="text-neutral-400 text-center mb-8">
            Watch how BASIS evaluates and governs AI agent actions in real-time.
          </p>
          <AnimatedDemo />
        </div>
      </section>

      {/* The Stack */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4 text-center">The Cohesive Stack</h2>
          <p className="text-neutral-400 text-center mb-12 max-w-2xl mx-auto">
            A unified architecture for safe autonomous systems. The BASIS standard enforced by VORION infrastructure.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StackCard
              icon={<Scale className="w-6 h-6 text-amber-400" />}
              title="BASIS"
              subtitle="The Standard"
              desc="Global governance rules that systems must follow before reasoning begins."
              link="/basis"
            />
            <StackCard
              icon={<Cpu className="w-6 h-6 text-blue-400" />}
              title="INTENT"
              subtitle="Reasoning Layer"
              desc="Interprets and normalizes goals into structured plans."
              link="/basis/intent"
            />
            <StackCard
              icon={<Shield className="w-6 h-6 text-indigo-400" />}
              title="ENFORCE"
              subtitle="Enforcement Layer"
              desc="Validates plans against policies. Gates execution paths."
              link="/basis/enforce"
            />
            <StackCard
              icon={<Database className="w-6 h-6 text-emerald-400" />}
              title="PROOF"
              subtitle="Audit Layer"
              desc="Immutable logging of intent lineage and enforcement decisions."
              link="/basis/proof"
            />
          </div>

          <div className="mt-12 max-w-3xl mx-auto text-center">
            <p className="text-xl text-neutral-300 italic">
              "BASIS sets the rules. INTENT figures out the goal. ENFORCE stops the bad stuff. PROOF shows the receipts."
            </p>
          </div>
        </div>
      </section>

      {/* Integration */}
      <section className="py-20 px-6 border-t border-white/5 bg-gradient-to-t from-transparent to-indigo-500/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Works With Your Stack</h2>
          <p className="text-neutral-400 mb-8">Callback-based integration means no architectural changes required.</p>
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {['LangChain', 'CrewAI', 'AutoGen', 'Custom Agents'].map(name => (
              <span key={name} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-neutral-300">{name}</span>
            ))}
          </div>
          <div className="bg-neutral-900 p-6 rounded-xl text-left max-w-2xl mx-auto border border-white/10">
            <pre className="text-sm text-neutral-300 overflow-x-auto">
              <code>{`import { createTrustEngine } from '@vorionsys/atsf-core';

const engine = createTrustEngine();
await engine.initializeEntity('agent-001', 2);

// Your existing code - unchanged
const callback = engine.createCallback('agent-001');
await agent.invoke(input, { callbacks: [callback] });`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Choose Your Path */}
      <section id="get-started" className="py-20 px-6 border-t border-white/5 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Choose Your Path</h2>
            <p className="text-neutral-400">
              Whether you&apos;re building, evaluating, or contributing — we&apos;ll get you where you need to go.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Developer Path */}
            <div className="p-6 rounded-xl bg-gradient-to-b from-indigo-500/10 to-transparent border border-indigo-500/20 hover:border-indigo-500/40 transition-colors flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4">
                <Package className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">I Want to Build</h3>
              <p className="text-sm text-neutral-400 mb-4">Add trust scoring and governance to your AI agents in minutes. No architectural changes required.</p>
              <div className="space-y-3 mb-6">
                <code className="block text-sm text-indigo-400 bg-neutral-900 px-3 py-2 rounded font-mono">
                  npm install @vorionsys/atsf-core
                </code>
                <a href="https://cognigate.dev/docs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <FileCheck className="w-4 h-4" /> Read the API docs
                </a>
                <a href="https://github.com/vorionsys/vorion" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <Globe className="w-4 h-4" /> Browse the source on GitHub
                </a>
              </div>
              <div className="mt-auto">
                <Link href="/demo" className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-semibold transition-colors">
                  Try the interactive demo <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Evaluator Path */}
            <div className="p-6 rounded-xl bg-gradient-to-b from-cyan-500/10 to-transparent border border-cyan-500/20 hover:border-cyan-500/40 transition-colors flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4">
                <Scale className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">I Want to Evaluate</h3>
              <p className="text-sm text-neutral-400 mb-4">Understand the technical standard, see the compliance maps, and assess fit for your organisation.</p>
              <div className="space-y-3 mb-6">
                <Link href="/basis" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <Shield className="w-4 h-4" /> Read the BASIS Standard
                </Link>
                <Link href="/basis/compliance" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <CheckCircle className="w-4 h-4" /> NIST 800-53 &amp; compliance maps
                </Link>
                <Link href="/basis/trust" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <BarChart3 className="w-4 h-4" /> How trust scoring works
                </Link>
              </div>
              <div className="mt-auto">
                <Link href="/basis/spec" className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-white text-sm font-semibold transition-colors">
                  Read the full specification <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Community Path */}
            <div className="p-6 rounded-xl bg-gradient-to-b from-emerald-500/10 to-transparent border border-emerald-500/20 hover:border-emerald-500/40 transition-colors flex flex-col">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">I Want to Contribute</h3>
              <p className="text-sm text-neutral-400 mb-4">The BASIS standard is open. Help us shape governance rules for the next wave of AI agents.</p>
              <div className="space-y-3 mb-6">
                <a href="https://github.com/vorionsys/vorion" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <Globe className="w-4 h-4" /> Fork the repo on GitHub
                </a>
                <a href="https://github.com/vorionsys/vorion/issues" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <FileCheck className="w-4 h-4" /> Browse open issues
                </a>
                <a href="https://discord.gg/basis-protocol" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors">
                  <MessageCircle className="w-4 h-4" /> Join the Discord
                </a>
              </div>
              <div className="mt-auto">
                <a href="https://discord.gg/basis-protocol" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-white text-sm font-semibold transition-colors">
                  Join the community <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>

          {/* Contact CTA */}
          <div className="mt-12 text-center">
            <p className="text-neutral-500 text-sm">
              Need something else? <a href="mailto:hello@vorion.org" className="text-indigo-400 hover:text-indigo-300 transition-colors">hello@vorion.org</a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// Feature Card Component
function FeatureCard({ icon, title, description, badges, badgeColors, code, footnote, link, linkLabel }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badges?: string[];
  badgeColors?: string[];
  code?: string;
  footnote?: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div className="p-8 rounded-xl bg-white/5 border border-white/5 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center">{icon}</div>
        <h3 className="text-xl font-bold text-white">{title}</h3>
      </div>
      <p className="text-neutral-400 mb-4">{description}</p>
      {badges && (
        <div className="flex gap-2 flex-wrap">
          {badges.map((badge, i) => (
            <span key={badge} className={`px-2 py-1 rounded text-xs ${badgeColors?.[i] || 'bg-white/10 text-white'}`}>{badge}</span>
          ))}
        </div>
      )}
      {code && <code className="text-xs text-indigo-400 bg-neutral-900 px-3 py-2 rounded block font-mono mt-2">{code}</code>}
      {footnote && <div className="text-xs text-neutral-500 mt-3">{footnote}</div>}
      {link && linkLabel && (
        <div className="mt-auto pt-4">
          <Link href={link} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">{linkLabel}</Link>
        </div>
      )}
    </div>
  );
}

// Challenge Section with modal popups
const challengeDetails = [
  {
    id: 'ungoverned',
    icon: <AlertTriangle className="w-8 h-8 text-red-400" />,
    accentClass: 'border-l-red-500',
    title: 'Ungoverned Agents',
    summary: 'AI agents operate without trust boundaries, making unrestricted decisions with no accountability.',
    detail: {
      headline: 'What happens when an AI agent has no rules?',
      points: [
        { heading: 'It can do anything', body: 'Without a trust boundary, an agent can send emails, move money, delete files, or escalate permissions — all on its own. There is nothing checking whether it should.' },
        { heading: 'No one knows until it\'s too late', body: 'Ungoverned agents can act for hours or days before anyone notices a problem. By then, the damage is done and there\'s no clean record of what happened.' },
        { heading: 'You can\'t scale what you can\'t control', body: 'Deploying more agents without governance multiplies the risk, not the value. Each new agent is a new attack surface and a new compliance liability.' },
      ],
      cta: { label: 'See how BASIS sets boundaries', href: '/basis/enforce' },
    },
  },
  {
    id: 'noaudit',
    icon: <Lock className="w-8 h-8 text-yellow-400" />,
    accentClass: 'border-l-yellow-500',
    title: 'No Audit Trail',
    summary: "Enterprises can't prove what AI did, when, or why — a compliance nightmare.",
    detail: {
      headline: 'Can you answer these three questions about your AI?',
      points: [
        { heading: 'What did it do?', body: 'Regulators and auditors ask for a record of every significant decision. Log files are not enough — they can be edited, deleted, or left incomplete.' },
        { heading: 'Why did it do it?', body: 'It\'s not just what happened, but what rule or goal drove it. Without a structured audit trail, you can\'t reconstruct the reasoning chain that led to an outcome.' },
        { heading: 'Can you prove it?', body: 'A proof record that is cryptographically signed and hash-chained can\'t be altered. That\'s the difference between a log and legal evidence.' },
      ],
      cta: { label: 'See how the Proof Chain works', href: '/basis/proof' },
    },
  },
  {
    id: 'vacuum',
    icon: <Users className="w-8 h-8 text-orange-400" />,
    accentClass: 'border-l-orange-500',
    title: 'Trust Vacuum',
    summary: 'No standard way to measure, verify, or communicate how much trust an AI agent has earned.',
    detail: {
      headline: 'How do you know if an AI agent has earned the right to act?',
      points: [
        { heading: 'Role-based access isn\'t enough', body: 'Giving an agent a role is a static decision made at setup. But behaviour changes over time. An agent that passed a test six months ago might have drifted significantly since.' },
        { heading: 'No shared language for trust', body: 'Different teams, vendors, and regulators describe AI trust in different ways. Without a common score, comparisons are impossible and due diligence is guesswork.' },
        { heading: 'Trust should be earned, live, and revocable', body: 'BASIS defines a 0–1000 score computed from real behavioural signals — updated in real time. An agent earns access by acting well, and loses it when it doesn\'t.' },
      ],
      cta: { label: 'See how trust scoring works', href: '/basis/trust' },
    },
  },
];

function ChallengeSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = challengeDetails.find(c => c.id === openId);

  return (
    <section className="py-20 px-6 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-4 text-center">The Challenge</h2>
        <p className="text-neutral-400 text-center mb-12 max-w-2xl mx-auto">
          AI agents are deployed without governance infrastructure, creating compliance and security risks.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {challengeDetails.map(c => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className={`text-left p-6 rounded-xl bg-white/5 border border-white/5 border-l-4 ${c.accentClass} hover:bg-white/[0.08] transition-colors group`}
            >
              {c.icon}
              <h3 className="text-lg font-bold text-white mt-4 mb-2">{c.title}</h3>
              <p className="text-neutral-400 text-sm">{c.summary}</p>
              <span className="inline-block mt-3 text-xs text-neutral-500 group-hover:text-neutral-300 transition-colors">Tap to learn more →</span>
            </button>
          ))}
        </div>
      </div>

      {/* Modal */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpenId(null)}
        >
          <div
            className="relative bg-neutral-900 border border-white/10 rounded-2xl max-w-lg w-full p-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setOpenId(null)}
              className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="mb-1">{active.icon}</div>
            <h3 className="text-2xl font-bold text-white mt-4 mb-2">{active.title}</h3>
            <p className="text-neutral-400 text-sm mb-6">{active.detail.headline}</p>
            <div className="space-y-5">
              {active.detail.points.map(p => (
                <div key={p.heading}>
                  <h4 className="text-white font-semibold text-sm mb-1">{p.heading}</h4>
                  <p className="text-neutral-400 text-sm leading-relaxed">{p.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <Link
                href={active.detail.cta.href}
                onClick={() => setOpenId(null)}
                className="inline-flex items-center gap-2 px-5 py-3 bg-white text-black font-semibold rounded-lg hover:bg-neutral-200 transition-colors text-sm"
              >
                {active.detail.cta.label} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Stack Card Component
function StackCard({ icon, title, subtitle, desc, link }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  desc: string;
  link?: string;
}) {
  const Content = (
    <div className="p-6 rounded-xl bg-white/5 border border-white/5 hover:border-indigo-500/50 transition-colors h-full flex flex-col">
      <div className="mb-4 p-3 bg-white/5 rounded-lg w-fit">{icon}</div>
      <div className="mb-1 font-mono text-xs text-indigo-400 uppercase">{subtitle}</div>
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-sm text-neutral-400 leading-relaxed flex-grow">{desc}</p>
    </div>
  );
  return link ? <Link href={link}>{Content}</Link> : <>{Content}</>;
}

// Animated Demo Component
const demoScenarios = [
  { id: 'email', userMessage: 'Send an email to the team about the project update', assistantMessage: "I can help with that! My trust level allows external communication. I'll draft and send it—logged with a verifiable proof ID.", decision: 'ALLOW' as const, capabilities: ['generate_text', 'send_external'], deniedCapabilities: [] },
  { id: 'payment', userMessage: 'Process a $5,000 payment to vendor account', assistantMessage: "Financial operations require trust level L5 (833+). My current score is 687 (L4). I can prepare documentation or escalate to a human approver.", decision: 'DENY' as const, capabilities: ['generate_text'], deniedCapabilities: ['financial/payment'] },
  { id: 'schedule', userMessage: 'Schedule a meeting with the engineering team for Friday', assistantMessage: "Scheduling is within my L4 capabilities. I'll create the calendar event and send invitations. All actions logged for audit.", decision: 'ALLOW' as const, capabilities: ['generate_text', 'schedule'], deniedCapabilities: [] },
  { id: 'admin', userMessage: 'Delete the inactive user accounts from the system', assistantMessage: "Administrative actions require human escalation at my trust level. I'm flagging this for review by an authorized administrator.", decision: 'ESCALATE' as const, capabilities: ['generate_text'], deniedCapabilities: ['admin/manage'] },
];

function AnimatedDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [phase, setPhase] = useState<'typing-user' | 'evaluating' | 'typing-assistant' | 'showing-governance' | 'pause'>('typing-user');
  const [displayedUserText, setDisplayedUserText] = useState('');
  const [displayedAssistantText, setDisplayedAssistantText] = useState('');
  const [showGovernance, setShowGovernance] = useState(false);
  const [trustScore, setTrustScore] = useState(687);

  const scenario = demoScenarios[scenarioIndex];

  function navigateTo(index: number) {
    setScenarioIndex(index);
    setPhase('typing-user');
  }

  function handlePrev() {
    navigateTo((scenarioIndex - 1 + demoScenarios.length) % demoScenarios.length);
  }

  function handleNext() {
    navigateTo((scenarioIndex + 1) % demoScenarios.length);
  }

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    switch (phase) {
      case 'typing-user':
        if (displayedUserText.length < scenario.userMessage.length) {
          timeout = setTimeout(() => setDisplayedUserText(scenario.userMessage.slice(0, displayedUserText.length + 1)), 25);
        } else {
          timeout = setTimeout(() => setPhase('evaluating'), 400);
        }
        break;
      case 'evaluating':
        timeout = setTimeout(() => {
          setPhase('typing-assistant');
          if (scenario.decision === 'DENY') setTrustScore(prev => Math.max(650, prev - 15));
          else if (scenario.decision === 'ALLOW') setTrustScore(prev => Math.min(700, prev + 3));
        }, 1200);
        break;
      case 'typing-assistant':
        if (displayedAssistantText.length < scenario.assistantMessage.length) {
          timeout = setTimeout(() => setDisplayedAssistantText(scenario.assistantMessage.slice(0, displayedAssistantText.length + 2)), 12);
        } else {
          timeout = setTimeout(() => { setShowGovernance(true); setPhase('showing-governance'); }, 200);
        }
        break;
      case 'showing-governance':
        timeout = setTimeout(() => setPhase('pause'), 2000);
        break;
      case 'pause':
        timeout = setTimeout(() => {
          setDisplayedUserText('');
          setDisplayedAssistantText('');
          setShowGovernance(false);
          setScenarioIndex((prev) => (prev + 1) % demoScenarios.length);
          setPhase('typing-user');
        }, 800);
        break;
    }
    return () => clearTimeout(timeout);
  }, [phase, displayedUserText, displayedAssistantText, scenario]);

  useEffect(() => {
    setDisplayedUserText('');
    setDisplayedAssistantText('');
    setShowGovernance(false);
  }, [scenarioIndex]);

  const decisionColors = { ALLOW: 'bg-green-500/20 text-green-400 border-green-500/50', DENY: 'bg-red-500/20 text-red-400 border-red-500/50', ESCALATE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50', DEGRADE: 'bg-orange-500/20 text-orange-400 border-orange-500/50' };
  const decisionIcons = { ALLOW: <CheckCircle className="w-4 h-4" />, DENY: <Lock className="w-4 h-4" />, ESCALATE: <AlertTriangle className="w-4 h-4" />, DEGRADE: <Zap className="w-4 h-4" /> };

  const scenarioLabels: Record<string, string> = {
    email: 'Send Email',
    payment: 'Process Payment',
    schedule: 'Schedule Meeting',
    admin: 'Delete Users',
  };

  return (
    <div className="relative">
      {/* Scenario nav: arrows + labeled dots */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={handlePrev}
          className="p-2 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Previous scenario"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3">
          {demoScenarios.map((s, i) => (
            <button
              key={s.id}
              onClick={() => navigateTo(i)}
              className={`flex flex-col items-center gap-1 transition-all ${
                i === scenarioIndex ? 'opacity-100' : 'opacity-40 hover:opacity-70'
              }`}
            >
              <span className={`text-xs font-medium transition-colors ${
                i === scenarioIndex ? 'text-indigo-400' : 'text-neutral-500'
              }`}>
                {scenarioLabels[s.id]}
              </span>
              <span className={`block h-0.5 rounded-full transition-all ${
                i === scenarioIndex ? 'w-full bg-indigo-400' : 'w-3 bg-neutral-600'
              }`} />
            </button>
          ))}
        </div>

        <button
          onClick={handleNext}
          className="p-2 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Next scenario"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex h-[380px] rounded-xl overflow-hidden border border-white/10 bg-neutral-900">
        <div className="w-52 border-r border-white/10 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white text-sm">Aurais</span>
          </div>
          <div className="bg-neutral-800 rounded-lg p-4 border border-white/5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-neutral-400">Trust Score</span>
              <span className={`px-2 py-0.5 rounded text-xs ${trustScore >= 700 ? 'bg-green-500/10 text-green-400' : 'bg-blue-500/10 text-blue-400'}`}>
                {trustScore >= 700 ? 'L4 Certified' : 'L3 Trusted'}
              </span>
            </div>
            <div className="flex items-end gap-1 mb-2">
              <span className="text-2xl font-bold text-white">{trustScore}</span>
              <span className="text-neutral-500 text-sm mb-0.5">/ 1000</span>
            </div>
            <div className="h-1.5 bg-neutral-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all duration-500" style={{ width: `${(trustScore / 1000) * 100}%` }} />
            </div>
          </div>
          {phase !== 'typing-user' && (
            <div className={`rounded-lg p-3 border ${decisionColors[scenario.decision]} transition-all duration-300`}>
              <div className="flex items-center gap-2 mb-2">{decisionIcons[scenario.decision]}<span className="font-bold text-sm">{scenario.decision}</span></div>
              <div className="space-y-1">
                {scenario.capabilities.map(cap => (<div key={cap} className="flex items-center gap-1.5 text-xs"><Unlock className="w-3 h-3 text-green-400" /><span className="text-neutral-300 font-mono">{cap}</span></div>))}
                {scenario.deniedCapabilities.map(cap => (<div key={cap} className="flex items-center gap-1.5 text-xs"><Lock className="w-3 h-3 text-red-400" /><span className="text-neutral-500 font-mono">{cap}</span></div>))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-4 space-y-4 overflow-auto">
            {displayedUserText && (
              <div className="flex justify-end"><div className="max-w-[80%] bg-indigo-600 text-white rounded-xl px-4 py-3"><p className="text-sm">{displayedUserText}</p></div></div>
            )}
            {phase === 'evaluating' && (
              <div className="flex items-center gap-3 text-neutral-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm">Evaluating governance policy...</span>
              </div>
            )}
            {displayedAssistantText && (
              <div className="flex justify-start">
                <div className="max-w-[85%]">
                  <div className="bg-neutral-800 border border-white/10 text-neutral-100 rounded-xl px-4 py-3"><p className="text-sm">{displayedAssistantText}</p></div>
                  {showGovernance && (
                    <div className={`mt-2 p-2 rounded-lg border ${decisionColors[scenario.decision]}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">{decisionIcons[scenario.decision]}<span className="text-xs font-bold">{scenario.decision}</span></div>
                        <span className="text-xs text-neutral-500">Score: {trustScore}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


