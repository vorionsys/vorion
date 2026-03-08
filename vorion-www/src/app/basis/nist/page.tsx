import Link from 'next/link';
import { ExternalLink, FileText, Shield, Calendar, Hash, ArrowRight, AlertTriangle, CheckCircle } from 'lucide-react';

export const metadata = {
  title: 'NIST Submissions | Vorion',
  description: 'Vorion\'s formal submissions to NIST on AI agent security, risk management, and governance standards.',
};

const submissions = [
  {
    id: 'caisi-rfi',
    badge: 'RFI Response',
    badgeColor: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
    title: 'NIST CAISI: Security Considerations for AI Agents',
    docket: 'NIST-2025-0035',
    document: 'Federal Register Vol. 91, No. 5 (pp. 698\u2013701)',
    submitted: 'March 9, 2026',
    deadline: 'March 9, 2026, 11:59 PM ET',
    status: 'Pending submission',
    statusColor: 'text-amber-400',
    summary: 'Vorion\u2019s response to NIST CAISI\u2019s RFI on AI agent security, drawing from direct experience building the Vorion Governed AI Execution Platform. Addresses all five RFI topics with concrete implementation patterns, quantitative data, and open-source reference implementations.',
    keyPoints: [
      '10 threat categories specific to agentic AI, mapped to OWASP Top 10 for Agentic Applications',
      'Trust-tiered capability gating as the primary security control pattern',
      'Cryptographic proof chains for forensic-grade auditability',
      'Recommendations for NIST to adopt graduated trust (not binary allow/deny) in forthcoming guidance',
    ],
    githubUrl: 'https://github.com/vorionsys/vorion/blob/main/docs/nist-caisi-rfi-response-2026-02.md',
    regulationsUrl: 'https://www.regulations.gov/docket/NIST-2025-0035',
    highlights: [
      { icon: AlertTriangle, color: 'text-red-400', label: 'Threat Model', text: 'Goal hijacking, tool weaponization, memory poisoning \u2014 10 novel attack vectors unique to agents' },
      { icon: Shield, color: 'text-indigo-400', label: 'Control Pattern', text: 'Trust-tiered gating: T0\u2013T7 tiers with 16 behavioral factors governing what agents can do' },
      { icon: CheckCircle, color: 'text-emerald-400', label: 'Open Source', text: 'Full reference implementation at github.com/vorionsys/vorion (Apache-2.0)' },
    ],
  },
];

export default function NISTPage() {
  return (
    <div className="min-h-screen pt-20 pb-24 bg-neutral-950 text-neutral-200">
      {/* Hero */}
      <section className="border-b border-white/5 pb-12">
        <div className="max-w-5xl mx-auto px-6 pt-12">
          <div className="flex items-center gap-2 text-sm text-neutral-500 mb-6">
            <Link href="/basis" className="hover:text-white transition-colors">BASIS</Link>
            <span>/</span>
            <span className="text-neutral-300">NIST Submissions</span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs mb-6">
            <FileText className="w-3 h-3" />
            Public Policy Engagement
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            NIST Submissions
          </h1>
          <p className="text-lg text-neutral-400 max-w-3xl leading-relaxed mb-8">
            Vorion actively participates in NIST's AI standards development. Our submissions
            draw from direct experience operating the BASIS-governed AI platform to provide
            concrete, implementable recommendations to policymakers.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <a
              href="https://airc.nist.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 border border-white/10 rounded-lg text-neutral-300 hover:text-white hover:border-white/20 transition-colors"
            >
              NIST AI Resource Center <ExternalLink className="w-3 h-3" />
            </a>
            <Link
              href="/basis/compliance#nist-ai-rmf"
              className="inline-flex items-center gap-2 px-4 py-2 border border-white/10 rounded-lg text-neutral-300 hover:text-white hover:border-white/20 transition-colors"
            >
              Vorion NIST RMF Alignment <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* Submissions */}
      <section className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {submissions.map((sub) => (
          <article key={sub.id} className="rounded-2xl bg-white/5 border border-white/5 overflow-hidden">
            {/* Header */}
            <div className="p-8 border-b border-white/5">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${sub.badgeColor}`}>
                  {sub.badge}
                </span>
                <span className={`text-sm font-medium ${sub.statusColor}`}>
                  ✓ {sub.status}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">{sub.title}</h2>
              <p className="text-neutral-400 leading-relaxed mb-6">{sub.summary}</p>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-600 mb-1">
                    <Hash className="w-3 h-3" /> Docket
                  </div>
                  <p className="text-sm text-neutral-300 font-mono">{sub.docket}</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-600 mb-1">
                    <Calendar className="w-3 h-3" /> Submitted
                  </div>
                  <p className="text-sm text-neutral-300">{sub.submitted}</p>
                </div>
                <div className="col-span-2">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-600 mb-1">
                    <FileText className="w-3 h-3" /> Document
                  </div>
                  <p className="text-sm text-neutral-400">{sub.document}</p>
                </div>
              </div>

              {/* Highlights */}
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {sub.highlights.map(({ icon: Icon, color, label, text }) => (
                  <div key={label} className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className={`flex items-center gap-2 mb-2 text-sm font-medium ${color}`}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>

              {/* Key Points */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Key Recommendations</h3>
                <ul className="space-y-2">
                  {sub.keyPoints.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-neutral-400">
                      <ArrowRight className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 flex flex-wrap gap-4">
              <a
                href={sub.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Read full submission on GitHub
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={sub.regulationsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                View NIST docket
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </article>
        ))}
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-8">
        <div className="rounded-2xl bg-gradient-to-r from-indigo-500/10 to-cyan-500/10 border border-indigo-500/20 p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-2">Vorion's Open Standards Work</h2>
          <p className="text-neutral-400 mb-6 max-w-xl mx-auto text-sm">
            The BASIS standard and Vorion platform are fully open-source. All governance infrastructure
            referenced in these submissions is available for NIST review and public implementation.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="https://github.com/vorionsys/vorion"
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-white text-black font-semibold rounded-lg hover:bg-neutral-200 transition-colors text-sm inline-flex items-center gap-2"
            >
              GitHub Repository <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <Link
              href="/basis"
              className="px-5 py-2.5 border border-white/10 rounded-lg text-white hover:bg-white/5 transition-colors text-sm inline-flex items-center gap-2"
            >
              BASIS Standard <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/basis/compliance"
              className="px-5 py-2.5 border border-white/10 rounded-lg text-white hover:bg-white/5 transition-colors text-sm inline-flex items-center gap-2"
            >
              Compliance Maps <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
