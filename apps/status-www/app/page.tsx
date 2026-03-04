import {
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
  CalendarClock,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { getServiceStatus } from './lib/status-client';
import StatusDisplay from './components/StatusDisplay';

export const revalidate = 60;

const features = [
  {
    icon: CheckCircle,
    title: 'Service Health',
    description:
      'Live status for Trust API, Logic API, Platform API, Cognigate, and more. Real-time monitoring with automatic health checks every 5 minutes.',
  },
  {
    icon: Clock,
    title: 'Response Times',
    description:
      'Latency monitoring across all Agent Anchor services. Data sourced from the centralized Vorion monitoring pipeline.',
  },
  {
    icon: AlertTriangle,
    title: 'Health Checks',
    description:
      'HTTP health checks run every 5 minutes against all ecosystem domains. Status updates automatically with no manual intervention.',
  },
  {
    icon: CalendarClock,
    title: 'Auto-Refresh',
    description:
      'This page refreshes every 60 seconds to show the latest status. All data is live and pulled from real infrastructure.',
  },
];

const footerLinks = [
  { label: 'Vorion', href: 'https://vorion.org' },
  { label: 'BASIS Standard', href: 'https://basis.vorion.org' },
  { label: 'Agent Anchor', href: 'https://agentanchorai.com' },
  { label: 'GitHub', href: 'https://github.com/vorionsys' },
];

export default async function StatusPage() {
  const statusData = await getServiceStatus();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#05050a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-amber-400" />
            <span className="font-semibold text-lg">Agent Anchor Status</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://app.agentanchorai.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm bg-amber-500/10 text-amber-400 px-4 py-2 rounded-lg border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
            >
              Open Dashboard
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1">
        <section className="pt-32 pb-16 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl sm:text-7xl font-bold mb-6">
              <span className="text-white">Platform</span>
              <br />
              <span className="bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">
                Status
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto mb-10">
              Real-time health monitoring for Agent Anchor services.
              Uptime, incidents, and maintenance — all in one place.
            </p>
          </div>
        </section>

        {/* Live Service Status */}
        <section className="pb-16 px-6">
          <StatusDisplay initialData={statusData} />
        </section>

        {/* Features */}
        <section className="pb-20 px-6">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-white/[0.03] p-6 rounded-xl border border-white/5 hover:border-amber-500/30 transition-colors"
              >
                <feature.icon className="w-8 h-8 text-amber-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="pb-20 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <a
              href="https://app.agentanchorai.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-medium shadow-lg shadow-amber-500/25 transition-all"
            >
              Open Dashboard
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-white/40">
            &copy; {new Date().getFullYear()} Vorion Systems. All rights reserved.
          </div>
          <div className="flex items-center gap-6">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/40 hover:text-white/80 transition-colors inline-flex items-center gap-1"
              >
                {link.label}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
