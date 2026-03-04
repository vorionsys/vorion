'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  ArrowRight,
  User,
  Bot,
  Shield,
  FileCheck,
  Eye,
  Link2,
  Sparkles,
} from 'lucide-react'

interface Escalation {
  id: string
  decisionId: string
  agentId: string
  agentName?: string
  status: 'pending' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'expired'
  priority: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  context: {
    actionType: string
    actionDetails: string
    riskLevel: number
    councilVotes?: Record<string, string>
    precedentConflicts?: string[]
  }
  assignedTo?: string
  assignedAt?: string
  resolution?: string
  resolutionReason?: string
  resolvedBy?: string
  resolvedAt?: string
  createsPrecedent?: boolean
  precedentNote?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

interface EscalationStats {
  pending: number
  approved_today: number
  rejected_today: number
  total: number
}

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [stats, setStats] = useState<EscalationStats>({ pending: 0, approved_today: 0, rejected_today: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('pending')

  useEffect(() => {
    fetchEscalations()
  }, [])

  async function fetchEscalations() {
    setLoading(true)
    try {
      const res = await fetch('/api/escalations')
      if (res.ok) {
        const data = await res.json()
        setEscalations(data.escalations || [])
        setStats(data.stats || { pending: 0, approved_today: 0, rejected_today: 0, total: 0 })
      }
    } catch (err) {
      console.error('Failed to fetch escalations:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredEscalations = escalations.filter(e => {
    if (filter === 'pending') return e.status === 'pending'
    if (filter === 'resolved') return e.status !== 'pending'
    return true
  })

  return (
    <div className="space-y-6 sm:space-y-8 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              Human Escalations
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
              Review and resolve agent decisions
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchEscalations()}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors active:scale-95 touch-manipulation"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Stats - Horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-2">
        <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-max sm:min-w-0">
          <StatCard
            label="Pending Review"
            value={stats.pending}
            icon={Clock}
            gradient="from-amber-500 to-orange-600"
            alert={stats.pending > 0}
          />
          <StatCard
            label="Approved Today"
            value={stats.approved_today}
            icon={CheckCircle}
            gradient="from-green-500 to-emerald-600"
          />
          <StatCard
            label="Rejected Today"
            value={stats.rejected_today}
            icon={XCircle}
            gradient="from-red-500 to-rose-600"
          />
          <StatCard
            label="Total Escalations"
            value={stats.total}
            icon={FileCheck}
            gradient="from-blue-500 to-indigo-600"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        {(['pending', 'resolved', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
              filter === f
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Escalations List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading escalations...</p>
        </div>
      ) : filteredEscalations.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-3">
          {filteredEscalations.map((escalation) => (
            <EscalationCard key={escalation.id} escalation={escalation} onResolve={fetchEscalations} />
          ))}
        </div>
      )}

      {/* HITL Evidence Info */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-200 dark:border-indigo-700 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-1">
              Evidence Weighting System
            </h3>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 mb-3">
              Your decisions carry significant weight in agent trust calculations:
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/50 dark:bg-gray-800/50 text-xs">
                <span className="font-semibold text-green-600 dark:text-green-400">HITL Approval</span>
                <span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold">5x</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/50 dark:bg-gray-800/50 text-xs">
                <span className="font-semibold text-red-600 dark:text-red-400">HITL Rejection</span>
                <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-bold">5x</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/50 dark:bg-gray-800/50 text-xs">
                <span className="font-semibold text-blue-600 dark:text-blue-400">Audit</span>
                <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold">3x</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/50 dark:bg-gray-800/50 text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-400">Automated</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 font-bold">1x</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          Related Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction
            title="Governance"
            icon={Shield}
            href="/governance"
            gradient="from-purple-500 to-indigo-500"
          />
          <QuickAction
            title="Observer"
            icon={Eye}
            href="/observer"
            gradient="from-cyan-500 to-blue-500"
          />
          <QuickAction
            title="Audit Trail"
            icon={FileCheck}
            href="/audit"
            gradient="from-green-500 to-emerald-500"
          />
          <QuickAction
            title="Agents"
            icon={Bot}
            href="/agents"
            gradient="from-blue-500 to-indigo-500"
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
  alert,
}: {
  label: string
  value: number
  icon: React.ElementType
  gradient: string
  alert?: boolean
}) {
  return (
    <div className={`flex-shrink-0 w-[140px] sm:w-auto bg-white dark:bg-gray-800 rounded-xl border p-3 sm:p-4 shadow-sm ${
      alert ? 'border-amber-300 dark:border-amber-700' : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate pr-2">{label}</span>
        <div className={`p-1.5 sm:p-2 rounded-lg bg-gradient-to-br ${gradient} flex-shrink-0`}>
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
        </div>
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${alert ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  )
}

function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 sm:p-12 text-center">
      <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 inline-block mb-4 shadow-lg shadow-green-500/25">
        <CheckCircle className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
      </div>
      <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {filter === 'pending' ? 'No Pending Escalations' : 'No Escalations Found'}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        {filter === 'pending'
          ? 'All clear! When agents encounter decisions requiring human oversight, they will appear here for your review.'
          : 'No escalations match the current filter.'}
      </p>
    </div>
  )
}

function EscalationCard({ escalation, onResolve }: { escalation: Escalation; onResolve: () => void }) {
  const [resolving, setResolving] = useState(false)
  const [showProofRecorded, setShowProofRecorded] = useState(false)

  async function handleResolve(resolution: 'approved' | 'rejected') {
    setResolving(true)
    try {
      const res = await fetch(`/api/escalations/${escalation.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution,
          resolutionReason: resolution === 'approved'
            ? 'Action approved by human reviewer'
            : 'Action rejected by human reviewer',
        }),
      })
      if (res.ok) {
        // Show proof recorded notification
        setShowProofRecorded(true)
        setTimeout(() => {
          setShowProofRecorded(false)
          onResolve()
        }, 2000)
      } else {
        const data = await res.json()
        console.error('Failed to resolve:', data.error)
      }
    } catch (err) {
      console.error('Resolution error:', err)
    } finally {
      setResolving(false)
    }
  }

  // Show success message after resolution
  if (showProofRecorded) {
    return (
      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <Link2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-indigo-900 dark:text-indigo-100">
              HITL Evidence Recorded
            </p>
            <p className="text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
              Trust impact weighted at
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">
                <Sparkles className="w-3 h-3" />
                5x
              </span>
              (human-in-the-loop approval)
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statusConfig = {
    pending: {
      gradient: 'from-amber-500 to-orange-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      border: 'border-amber-200 dark:border-amber-800',
      text: 'text-amber-700 dark:text-amber-400',
      label: 'Pending Review',
    },
    approved: {
      gradient: 'from-green-500 to-emerald-600',
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      text: 'text-green-700 dark:text-green-400',
      label: 'Approved',
    },
    rejected: {
      gradient: 'from-red-500 to-rose-600',
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-700 dark:text-red-400',
      label: 'Rejected',
    },
  }

  const status = escalation.status === 'assigned' || escalation.status === 'in_review' || escalation.status === 'expired'
    ? 'pending'
    : escalation.status
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4 sm:p-5`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`p-2 rounded-lg bg-gradient-to-br ${config.gradient} flex-shrink-0`}>
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">
                {escalation.context.actionType}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${config.text} ${config.bg} border ${config.border}`}>
                {config.label}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                escalation.priority === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                escalation.priority === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                escalation.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {escalation.priority}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {escalation.reason}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Bot className="w-3 h-3" />
                {escalation.agentName || escalation.agentId.slice(0, 8)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(escalation.createdAt).toLocaleString()}
              </span>
              {escalation.context.riskLevel > 50 && (
                <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                  <AlertTriangle className="w-3 h-3" />
                  Risk: {escalation.context.riskLevel}%
                </span>
              )}
            </div>
          </div>
        </div>

        {escalation.status === 'pending' ? (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => handleResolve('approved')}
              disabled={resolving}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-lg transition-all active:scale-95 touch-manipulation shadow-lg shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resolving ? 'Resolving...' : 'Approve'}
            </button>
            <button
              onClick={() => handleResolve('rejected')}
              disabled={resolving}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 rounded-lg transition-all active:scale-95 touch-manipulation shadow-lg shadow-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resolving ? 'Resolving...' : 'Reject'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <User className="w-3 h-3" />
              <span>by {escalation.resolvedBy?.slice(0, 8) || 'system'}</span>
            </div>
            {/* Proof Evidence Indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800">
              <Link2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                Proof Recorded
              </span>
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                <Sparkles className="w-2.5 h-2.5" />
                5x
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QuickAction({
  title,
  icon: Icon,
  href,
  gradient,
}: {
  title: string
  icon: React.ElementType
  href: string
  gradient: string
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 active:scale-95 touch-manipulation group"
    >
      <div className={`p-2.5 rounded-xl bg-gradient-to-br ${gradient} group-hover:shadow-lg transition-shadow`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 text-center">{title}</span>
    </Link>
  )
}
