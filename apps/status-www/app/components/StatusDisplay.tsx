'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, MinusCircle, RefreshCw } from 'lucide-react';
import type { StatusData } from '../lib/status-client';

const REFRESH_INTERVAL_MS = 60_000;

function statusColor(status: string) {
  switch (status) {
    case 'operational':
      return { bg: 'bg-emerald-400', text: 'text-emerald-400', border: 'border-emerald-500/20' };
    case 'degraded':
      return { bg: 'bg-yellow-400', text: 'text-yellow-400', border: 'border-yellow-500/20' };
    case 'outage':
      return { bg: 'bg-red-400', text: 'text-red-400', border: 'border-red-500/20' };
    default:
      return { bg: 'bg-white/30', text: 'text-white/40', border: 'border-white/10' };
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'operational':
      return <CheckCircle className="w-5 h-5 text-emerald-400" />;
    case 'degraded':
      return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
    case 'outage':
      return <XCircle className="w-5 h-5 text-red-400" />;
    default:
      return <MinusCircle className="w-5 h-5 text-white/30" />;
  }
}

function OverallStatusBanner({ status }: { status: string }) {
  const colors = statusColor(status);
  const label =
    status === 'operational'
      ? 'All Systems Operational'
      : status === 'degraded'
        ? 'Partial System Degradation'
        : status === 'outage'
          ? 'Major System Outage'
          : 'Status Unknown';

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border ${colors.border} ${colors.text} text-sm mb-8`}
    >
      <div className={`w-2 h-2 rounded-full ${colors.bg} animate-pulse`} />
      {label}
    </div>
  );
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface StatusDisplayProps {
  initialData: StatusData;
}

export default function StatusDisplay({ initialData }: StatusDisplayProps) {
  const [data, setData] = useState<StatusData>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const newData = await response.json();
        setData(newData);
        setLastRefresh(Date.now());
      }
    } catch {
      // Silently fail — keep showing last known data
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <>
      {/* Overall Status */}
      <div className="text-center">
        <OverallStatusBanner status={data.overallStatus} />
      </div>

      {/* Service List */}
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white/60">Services</h2>
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : `Updated ${timeAgo(data.lastUpdated)}`}
          </button>
        </div>

        <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
          {data.services.map((service) => {
            const colors = statusColor(service.status);
            return (
              <div key={service.name} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <StatusIcon status={service.status} />
                  <div>
                    <div className="font-medium">{service.name}</div>
                    <div className="text-sm text-white/40">{service.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {service.latencyMs > 0 && (
                    <span className="text-xs text-white/30 tabular-nums">
                      {service.latencyMs}ms
                    </span>
                  )}
                  <div className="flex items-center gap-2 text-sm min-w-[100px] justify-end">
                    <div className={`w-2 h-2 rounded-full ${colors.bg}`} />
                    <span className={`${colors.text} capitalize`}>{service.status}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-white/20">
          <span>
            Data source: {data.source === 'dashboard-api' ? 'Vorion monitoring pipeline' : 'Direct health checks'}
          </span>
          <span>Auto-refreshes every 60s</span>
        </div>
      </div>
    </>
  );
}
