import Link from 'next/link';
import { ArrowRight, Shield, Cpu, Database, Link2, Scale, FileText, BookOpen, AlertTriangle, CheckCircle, GitBranch, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BASIS v1.0 | Open Standard for AI Agent Governance',
  description: 'The open standard defining how AI agents should be governed before they act. Trust scores, capability gating, immutable audit trails.',
};

export default function BASISPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <main className="pt-24 pb-20">
        {/* Hero */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <div className="flex items-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-mono text-amber-400">
              <Scale className="w-3 h-3" />
              OPEN STANDARD
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400">
              <CheckCircle className="w-3 h-3" />
              V1.0.0
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-4">
            BASIS
          </h1>
          <p className="text-2xl md:text-3xl text-neutral-400 mb-4 max-w-3xl">
            Baseline Authority for Safe &amp; Interoperable Systems
          </p>
          <p className="text-lg text-neutral-500 max-w-2xl mb-8">
            The open standard for AI agent governance. Defining what must happen before an AI agent acts.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/basis/spec"
              className="px-6 py-3 bg-white text-black font-semibold rounded hover:bg-neutral-200 transition-colors flex items-center gap-2"
            >
              Read the Specification <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="https://github.com/vorionsys/vorion/tree/master/basis-core"
              className="px-6 py-3 border border-white/10 rounded text-white hover:bg-white/5 transition-colors flex items-center gap-2"
            >
              <GitBranch className="w-4 h-4" /> View on GitHub
            </Link>
          </div>
        </section>

        {/* Four Layer Architecture */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <h2 className="text-3xl font-bold text-white mb-8">The Four-Layer Architecture</h2>
          <div className="mb-8 space-y-1">
            {[
              { num: '1', name: 'INTENT',  color: 'border-blue-500 bg-blue-500/10 text-blue-400',     desc: 'Parse & classify action requests' },
              { num: '2', name: 'ENFORCE', color: 'border-indigo-500 bg-indigo-500/10 text-indigo-400', desc: 'Evaluate against trust score & policies' },
              { num: '3', name: 'PROOF',   color: 'border-emerald-500 bg-emerald-500/10 text-emerald-400', desc: 'Log with cryptographic integrity' },
              { num: '4', name: 'CHAIN',   color: 'border-purple-500 bg-purple-500/10 text-purple-400', desc: 'Anchor to external verifier (optional)' },
            ].map((layer) => (
              <div key={layer.num} className={`flex items-center gap-4 p-4 rounded-lg border-l-4 ${layer.color}`}>
                <span className="font-mono text-xs text-neutral-500 w-16 shrink-0">LAYER {layer.num}</span>
                <span className={`font-mono font-bold text-sm w-20 shrink-0 ${layer.color.split(' ')[2]}`}>{layer.name}</span>
                <span className="text-neutral-400 text-sm">{layer.desc}</span>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <LayerCard
              href="/basis/intent"
              icon={<Cpu className="w-6 h-6 text-blue-400" />}
              name="INTENT"
              subtitle="Parse & Plan"
              description="Parse natural language, extract capabilities, classify risk level."
            />
            <LayerCard
              href="/basis/enforce"
              icon={<Shield className="w-6 h-6 text-indigo-400" />}
              name="ENFORCE"
              subtitle="Trust & Gate"
              description="Evaluate against trust score and policy rules. ALLOW, DENY, ESCALATE, or DEGRADE."
            />
            <LayerCard
              href="/basis/proof"
              icon={<Database className="w-6 h-6 text-emerald-400" />}
              name="PROOF"
              subtitle="Log & Audit"
              description="Create immutable, SHA-256 chained audit records with 7-year retention."
            />
            <LayerCard
              href="/basis/chain"
              icon={<Link2 className="w-6 h-6 text-purple-400" />}
              name="CHAIN"
              subtitle="Anchor & Verify"
              description="Optional blockchain anchoring for independent verification."
            />
          </div>
        </section>

        {/* Trust Model */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-white">Trust Model</h2>
            <Link href="/basis/trust" className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              Full documentation <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid lg:grid-cols-2 gap-8">
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Eight Trust Tiers (T0&ndash;T7)</h3>
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="text-left px-4 py-3 text-neutral-400 font-medium">Tier</th>
                      <th className="text-left px-4 py-3 text-neutral-400 font-medium">Score</th>
                      <th className="text-left px-4 py-3 text-neutral-400 font-medium">Default Capabilities</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <TrustRow tier="T0 — Sandbox" score="0–199" capabilities="Isolated testing only" color="neutral" />
                    <TrustRow tier="T1 — Observed" score="200–349" capabilities="Read public data, internal messaging" color="yellow600" />
                    <TrustRow tier="T2 — Provisional" score="350–499" capabilities="Limited write, strict guardrails" color="yellow" />
                    <TrustRow tier="T3 — Monitored" score="500–649" capabilities="Standard workflows, limited external reads" color="orange" />
                    <TrustRow tier="T4 — Standard" score="650–799" capabilities="External API calls, routine operations" color="green" />
                    <TrustRow tier="T5 — Trusted" score="800–875" capabilities="Financial transactions, elevated access" color="blue" />
                    <TrustRow tier="T6 — Certified" score="876–950" capabilities="Critical system modifications" color="indigo" />
                    <TrustRow tier="T7 — Autonomous" score="951–1000" capabilities="Full autonomy within policy" color="purple" />
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Trust Dynamics</h3>
              <div className="space-y-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h4 className="font-mono text-sm text-amber-400 mb-2">Decay</h4>
                  <p className="text-neutral-400 text-sm">182-day half-life. Inactive agents reach 50% trust score at 182 days idle — stepped milestones at 7, 14, 28, 56, 112, and 182 days.</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h4 className="font-mono text-sm text-red-400 mb-2">Failure Amplification</h4>
                  <p className="text-neutral-400 text-sm">Tier-scaled 2–10× penalty on failures — lowest at T0 (2×, aids ascension) rising to 10× at T5–T7. New agents can recover; high-trust agents pay steeply for any lapse.</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h4 className="font-mono text-sm text-emerald-400 mb-2">Tier Boundaries</h4>
                  <p className="text-neutral-400 text-sm">Hard floors and ceilings at tier boundaries. Can&apos;t skip tiers.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Specification Documents */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <h2 className="text-3xl font-bold text-white mb-8">Specification Documents</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SpecCard
              href="/basis/spec"
              icon={<FileText className="w-5 h-5" />}
              title="Core Specification"
              size="28K"
              description="Architecture, trust model, wire protocol, conformance levels"
            />
            <SpecCard
              href="/basis/capabilities"
              icon={<BookOpen className="w-5 h-5" />}
              title="Capability Taxonomy"
              size="18K"
              description="100+ capabilities across 7 namespaces"
            />
            <SpecCard
              href="/basis/schemas"
              icon={<FileText className="w-5 h-5" />}
              title="JSON Schemas"
              size="28K"
              description="Complete wire protocol schemas (Draft 2020-12)"
            />
            <SpecCard
              href="/basis/errors"
              icon={<AlertTriangle className="w-5 h-5" />}
              title="Error Codes"
              size="16K"
              description="60+ error codes in 12 categories"
            />
            <SpecCard
              href="/basis/threat-model"
              icon={<Shield className="w-5 h-5" />}
              title="Threat Model"
              size="20K"
              description="STRIDE analysis, 20+ threats with mitigations"
            />
            <SpecCard
              href="/basis/failure-modes"
              icon={<AlertTriangle className="w-5 h-5" />}
              title="Failure Modes"
              size="16K"
              description="Layer-by-layer failure handling"
            />
            <SpecCard
              href="/basis/compliance"
              icon={<CheckCircle className="w-5 h-5" />}
              title="Compliance Mapping"
              size="17K"
              description="SOC 2, ISO 27001, GDPR, HIPAA, EU AI Act"
            />
            <SpecCard
              href="/basis/migration"
              icon={<GitBranch className="w-5 h-5" />}
              title="Migration Guide"
              size="21K"
              description="5-phase adoption roadmap"
            />
          </div>
        </section>

        {/* Conformance Levels */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <h2 className="text-3xl font-bold text-white mb-8">Conformance Levels</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <ConformanceCard
              level="Core"
              requirements={['INTENT layer', 'ENFORCE layer', 'PROOF layer']}
              description="Minimum viable governance"
            />
            <ConformanceCard
              level="Complete"
              requirements={['All Core requirements', 'CHAIN layer', 'Full capability taxonomy']}
              description="Production-ready implementation"
              highlighted
            />
            <ConformanceCard
              level="Extended"
              requirements={['All Complete requirements', 'Multi-tenant isolation', 'Federated trust']}
              description="Enterprise-scale deployment"
            />
          </div>
        </section>

        {/* Quick Start */}
        <section className="px-6 max-w-7xl mx-auto mb-20">
          <h2 className="text-3xl font-bold text-white mb-8">Quick Start</h2>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Example Policy Snippet</h3>
            <pre className="text-sm text-neutral-300 overflow-x-auto font-mono bg-black/30 p-4 rounded-lg">
{`basis_version: "1.0"
policy_id: "corp-finance-limited"
constraints:
  - type: "capability_gate"
    capabilities: ["financial:transaction/medium"]
    minimum_tier: "certified"
  - type: "escalation_required"
    capabilities: ["admin:policy/modify"]
obligations:
  - trigger: "transaction_value > 10000"
    action: "require_human_approval"`}
            </pre>
          </div>
        </section>

        {/* CTA */}
        <section className="px-6 max-w-7xl mx-auto">
          <div className="border border-white/10 rounded-xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
            <h2 className="text-2xl font-bold text-white mb-4">Ready to Implement?</h2>
            <p className="text-neutral-400 mb-6 max-w-2xl">
              Use Cognigate, the reference implementation of BASIS, or build your own compliant implementation using the specification.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="https://cognigate.dev"
                className="px-6 py-3 bg-white text-black font-semibold rounded hover:bg-neutral-200 transition-colors flex items-center gap-2"
              >
                Cognigate (Reference) <ExternalLink className="w-4 h-4" />
              </Link>
              <Link
                href="https://github.com/vorionsys/vorion/tree/master/basis-core"
                className="px-6 py-3 border border-white/10 rounded text-white hover:bg-white/5 transition-colors"
              >
                View Schemas on GitHub
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

interface LayerCardProps {
  href: string;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  description: string;
}

function LayerCard({ href, icon, name, subtitle, description }: LayerCardProps) {
  return (
    <Link href={href} className="block p-6 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10 transition-all group">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-white/5 rounded-lg group-hover:bg-white/10 transition-colors">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-white">{name}</h3>
          <p className="text-xs font-mono text-neutral-500 uppercase">{subtitle}</p>
        </div>
      </div>
      <p className="text-sm text-neutral-400">{description}</p>
    </Link>
  );
}

interface TrustRowProps {
  tier: string;
  score: string;
  capabilities: string;
  color: string;
}

function TrustRow({ tier, score, capabilities, color }: TrustRowProps) {
  const colorClasses: Record<string, string> = {
    neutral: 'text-neutral-400',
    yellow600: 'text-yellow-600',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
    green: 'text-emerald-400',
    blue: 'text-blue-400',
    indigo: 'text-indigo-400',
    purple: 'text-purple-400',
  };

  return (
    <tr>
      <td className={`px-4 py-3 font-medium ${colorClasses[color]}`}>{tier}</td>
      <td className="px-4 py-3 text-neutral-300 font-mono">{score}</td>
      <td className="px-4 py-3 text-neutral-400">{capabilities}</td>
    </tr>
  );
}

interface SpecCardProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  size: string;
  description: string;
}

function SpecCard({ href, icon, title, size, description }: SpecCardProps) {
  return (
    <Link href={href} className="block p-5 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10 transition-all group">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-indigo-400">{icon}</div>
        <h3 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{title}</h3>
        <span className="ml-auto text-xs font-mono text-neutral-500">{size}</span>
      </div>
      <p className="text-sm text-neutral-400">{description}</p>
    </Link>
  );
}

interface ConformanceCardProps {
  level: string;
  requirements: string[];
  description: string;
  highlighted?: boolean;
}

function ConformanceCard({ level, requirements, description, highlighted }: ConformanceCardProps) {
  return (
    <div className={`p-6 rounded-xl border ${highlighted ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-white/5 border-white/10'}`}>
      <h3 className={`text-xl font-bold mb-2 ${highlighted ? 'text-indigo-300' : 'text-white'}`}>
        BASIS {level}
      </h3>
      <p className="text-sm text-neutral-400 mb-4">{description}</p>
      <ul className="space-y-2">
        {requirements.map((req, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-neutral-300">
            <CheckCircle className={`w-4 h-4 ${highlighted ? 'text-indigo-400' : 'text-emerald-400'}`} />
            {req}
          </li>
        ))}
      </ul>
    </div>
  );
}