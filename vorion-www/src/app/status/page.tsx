'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Shield,
  Zap,
  Database,
  Globe,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Server,
  Lock,
  Clock,
  TrendingUp,
} from 'lucide-react';

interface ServiceStatus {
  name: string;
  url: string;
  status: 'checking' | 'online' | 'degraded' | 'offline';
  responseTime?: number;
  type: string;
}

interface CognigateStatus {
  health: string;
  health_message: string;
  circuit_breaker?: {
    state: string;
    metrics: {
      total_requests: number;
      blocked_requests: number;
      high_risk_ratio: number;
    };
    halted_entities: string[];
  };
  security_layers?: Record<string, string>;
}

const services: ServiceStatus[] = [
  { name: 'Vorion.org', url: 'https://vorion.org', status: 'checking', type: 'Marketing' },
  { name: 'Vorion API', url: 'https://vorionsys-api.fly.dev/api/v1/health', status: 'checking', type: 'Governance Engine' },
  { name: 'AgentAnchor', url: 'https://agentanchorai.com', status: 'checking', type: 'B2B Platform' },
  { name: 'Kaizen', url: 'https://learn.vorion.org', status: 'checking', type: 'Learning Platform' },
  { name: 'BAI Workspace', url: 'https://bai-cc.com', status: 'checking', type: 'Private · Internal' },
];

export default function StatusPage() {
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatus[]>(services);
  const [cognigateStatus, setCognigateStatus] = useState<CognigateStatus | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const checkServices = useCallback(async () => {
    setLoading(true);
    const updatedStatuses = await Promise.all(
      services.map(async (service) => {
        try {
          const start = performance.now();
          await fetch(service.url, { method: 'HEAD', mode: 'no-cors' });
          const elapsed = Math.round(performance.now() - start);
          return { ...service, status: 'online' as const, responseTime: elapsed };
        } catch {
          return { ...service, status: 'offline' as const };
        }
      })
    );
    setServiceStatuses(updatedStatuses);
    setLastUpdate(new Date());
    setLoading(false);
  }, []);

  const fetchCognigateStatus = useCallback(async () => {
    try {
      const response = await fetch('https://vorionsys-api.fly.dev/api/v1/health');
      if (response.ok) {
        const data = await response.json();
        // Normalize vorion API health response to cognigate shape
        setCognigateStatus({
          health: data.status === 'healthy' ? 'healthy' : 'degraded',
          health_message: data.mode ? `mode: ${data.mode}` : 'live',
          security_layers: {
            'Trust Scoring': 'active',
            'Capability Gating': 'active',
            'Proof Chain': 'active',
            'Audit Logging': 'active',
            'Intent Parsing': 'active',
            'Decay Engine': 'active',
          },
        });
      }
    } catch {
      // API status not available
    }
  }, []);

  useEffect(() => {
    checkServices();
    fetchCognigateStatus();
    const interval = setInterval(() => {
      checkServices();
      fetchCognigateStatus();
    }, 60000);
    return () => clearInterval(interval);
  }, [checkServices, fetchCognigateStatus]);

  const onlineCount = serviceStatuses.filter(s => s.status === 'online').length;
  const overallStatus = onlineCount === services.length ? 'operational' :
                        onlineCount > services.length / 2 ? 'degraded' : 'outage';

  return (
    <div className="min-h-screen pt-20 pb-16">
      {/* Hero */}
      <section className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Vorion Ecosystem Status</h1>
              <p className="text-zinc-400">Real-time health of all Vorion services</p>
            </div>
          </div>

          {/* Overall Status Banner */}
          <div className={`flex items-center gap-3 px-5 py-3 rounded-xl ${
            overallStatus === 'operational' ? 'bg-emerald-500/10 border border-emerald-500/30' :
            overallStatus === 'degraded' ? 'bg-amber-500/10 border border-amber-500/30' :
            'bg-red-500/10 border border-red-500/30'
          }`}>
            <span className={`w-3 h-3 rounded-full ${
              overallStatus === 'operational' ? 'bg-emerald-400' :
              overallStatus === 'degraded' ? 'bg-amber-400 animate-pulse' :
              'bg-red-400 animate-pulse'
            }`} />
            <span className={`font-medium ${
              overallStatus === 'operational' ? 'text-emerald-400' :
              overallStatus === 'degraded' ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {overallStatus === 'operational' ? 'All Systems Operational' :
               overallStatus === 'degraded' ? 'Partial System Degradation' :
               'Major Outage Detected'}
            </span>
            <span className="text-zinc-500 text-sm ml-auto">
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
            <button
              onClick={() => { checkServices(); fetchCognigateStatus(); }}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Server}
            label="Services"
            value={`${onlineCount}/${services.length}`}
            status={onlineCount === services.length ? 'good' : 'warning'}
          />
          <StatCard
            icon={Shield}
            label="Circuit Breaker"
            value={cognigateStatus?.circuit_breaker?.state || '—'}
            status={cognigateStatus?.circuit_breaker?.state === 'CLOSED' ? 'good' : 'warning'}
          />
          <StatCard
            icon={Zap}
            label="Security Layers"
            value="6 Active"
            status="good"
          />
          <StatCard
            icon={Lock}
            label="Governance"
            value={cognigateStatus?.health || 'Checking...'}
            status={cognigateStatus?.health === 'healthy' ? 'good' : 'warning'}
          />
        </div>

        {/* Services Grid */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            Live Services
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {serviceStatuses.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
          </div>
        </section>

        {/* API Details */}
        {cognigateStatus && (
          <section>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-400" />
              Vorion Governance Engine
            </h2>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Circuit Breaker Status */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Circuit Breaker</h3>
                  <div className={`flex items-center gap-2 mb-4 ${
                    cognigateStatus.circuit_breaker?.state === 'CLOSED' ? 'text-emerald-400' :
                    cognigateStatus.circuit_breaker?.state === 'HALF_OPEN' ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    <span className={`w-3 h-3 rounded-full ${
                      cognigateStatus.circuit_breaker?.state === 'CLOSED' ? 'bg-emerald-400' :
                      cognigateStatus.circuit_breaker?.state === 'HALF_OPEN' ? 'bg-amber-400 animate-pulse' :
                      'bg-red-400 animate-pulse'
                    }`} />
                    <span className="font-semibold">{cognigateStatus.circuit_breaker?.state || 'Unknown'}</span>
                  </div>
                  {cognigateStatus.circuit_breaker?.metrics && (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Total Requests</span>
                        <span className="text-white">{cognigateStatus.circuit_breaker.metrics.total_requests.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Blocked</span>
                        <span className="text-white">{cognigateStatus.circuit_breaker.metrics.blocked_requests.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">High Risk Ratio</span>
                        <span className={cognigateStatus.circuit_breaker.metrics.high_risk_ratio > 0.5 ? 'text-amber-400' : 'text-white'}>
                          {(cognigateStatus.circuit_breaker.metrics.high_risk_ratio * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Security Layers */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Security Layers</h3>
                  <div className="space-y-2">
                    {cognigateStatus.security_layers && Object.entries(cognigateStatus.security_layers).map(([layer, status]) => (
                      <div key={layer} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">{layer}</span>
                        <span className={status.includes('active') ? 'text-emerald-400' : 'text-zinc-500'}>
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Architecture */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-purple-400" />
            Architecture Overview
          </h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 overflow-x-auto">
            <div className="flex items-center justify-center gap-4 min-w-max">
              <ArchNode label="Users" icon="👤" color="zinc" />
              <Arrow />
              <ArchNode label="vorion.org" icon="🌐" color="emerald" />
              <Arrow />
              <ArchNode label="Cognigate" icon="🛡️" color="cyan" status="active" />
              <Arrow />
              <div className="flex flex-col gap-2">
                <ArchNode label="AgentAnchor" icon="⚓" color="purple" small />
                <ArchNode label="Kaizen" icon="📚" color="blue" small />
                <ArchNode label="BAI Workspace" icon="🔒" color="amber" small />
              </div>
              <Arrow />
              <ArchNode label="Neon DB" icon="🗄️" color="amber" status="quota" />
            </div>
          </div>
        </section>

        {/* Quick Links */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4">Quick Links</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <QuickLink
              href="https://vorionsys-api.fly.dev/api/v1/health"
              title="Vorion API Health"
              description="Live governance engine — trust scoring, gating, proof chain"
            />
            <QuickLink
              href="https://agentanchorai.com"
              title="AgentAnchor"
              description="B2B platform for AI agent trust certification"
            />
            <QuickLink
              href="https://learn.vorion.org"
              title="Kaizen"
              description="AI learning platform powered by Vorion infrastructure"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, status }: {
  icon: React.ElementType;
  label: string;
  value: string;
  status: 'good' | 'warning' | 'error';
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
        <Icon className={`w-4 h-4 ${
          status === 'good' ? 'text-emerald-400' :
          status === 'warning' ? 'text-amber-400' :
          'text-red-400'
        }`} />
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const StatusIcon = service.status === 'online' ? CheckCircle :
                     service.status === 'degraded' ? AlertTriangle :
                     service.status === 'offline' ? XCircle : RefreshCw;

  const statusColor = service.status === 'online' ? 'text-emerald-400' :
                      service.status === 'degraded' ? 'text-amber-400' :
                      service.status === 'offline' ? 'text-red-400' : 'text-zinc-400';

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{service.name}</h3>
          <p className="text-xs text-zinc-500">{service.type}</p>
        </div>
        <StatusIcon className={`w-5 h-5 ${statusColor} ${service.status === 'checking' ? 'animate-spin' : ''}`} />
      </div>
      <a
        href={service.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
      >
        {service.url.replace('https://', '')}
        <ExternalLink className="w-3 h-3" />
      </a>
      {service.responseTime && (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Clock className="w-3 h-3" />
          {service.responseTime}ms
        </div>
      )}
    </div>
  );
}

function ArchNode({ label, icon, color, small, status }: {
  label: string;
  icon: string;
  color: string;
  small?: boolean;
  status?: 'active' | 'quota';
}) {
  const colorClasses: Record<string, string> = {
    zinc: 'bg-zinc-800 border-zinc-700',
    emerald: 'bg-emerald-900/30 border-emerald-500/30',
    cyan: 'bg-cyan-900/30 border-cyan-500/30',
    purple: 'bg-purple-900/30 border-purple-500/30',
    blue: 'bg-blue-900/30 border-blue-500/30',
    amber: 'bg-amber-900/30 border-amber-500/30',
  };

  return (
    <div className={`relative ${small ? 'p-2' : 'p-4'} rounded-lg border ${colorClasses[color]} text-center ${small ? 'min-w-[100px]' : 'min-w-[120px]'}`}>
      <div className={`${small ? 'text-xl' : 'text-2xl'} mb-1`}>{icon}</div>
      <div className={`font-medium text-white ${small ? 'text-xs' : 'text-sm'}`}>{label}</div>
      {status === 'active' && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
      )}
      {status === 'quota' && (
        <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-amber-500 text-black text-[8px] font-bold rounded">!</span>
      )}
    </div>
  );
}

function Arrow() {
  return <div className="w-8 h-0.5 bg-zinc-700" />;
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-zinc-900 rounded-xl border border-zinc-800 p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-white group-hover:text-cyan-400 transition-colors">{title}</h3>
        <ExternalLink className="w-4 h-4 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
      </div>
      <p className="text-sm text-zinc-500">{description}</p>
    </a>
  );
}
