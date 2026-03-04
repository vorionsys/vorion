'use client'

import { useState } from 'react'
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  Clock,
  Filter,
  Search,
  XCircle,
  Info,
  Zap,
} from 'lucide-react'
import type { ActivityLogEntry } from '@/lib/db/types'
import { timeAgo } from '@/lib/time'

interface ActivityClientProps {
  activity: ActivityLogEntry[]
  stats: { total: number; byAction: Record<string, number> }
}

const eventIcons: Record<string, typeof CheckCircle> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
}

const eventColors: Record<string, string> = {
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  info: 'text-aurais-primary',
}

function getActionType(action: string): string {
  if (action.includes('error') || action.includes('fail')) return 'error'
  if (action.includes('warn') || action.includes('limit')) return 'warning'
  if (action.includes('info') || action.includes('update')) return 'info'
  return 'success'
}

export default function ActivityClient({ activity, stats }: ActivityClientProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filteredActivity = activity.filter((event) => {
    const matchesSearch = (event.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.action.toLowerCase().includes(searchQuery.toLowerCase())
    const eventType = getActionType(event.action)
    const matchesType = typeFilter === 'all' || eventType === typeFilter
    return matchesSearch && matchesType
  })

  const warningCount = Object.entries(stats.byAction)
    .filter(([k]) => k.includes('warn') || k.includes('limit'))
    .reduce((sum, [, v]) => sum + v, 0)

  const errorCount = Object.entries(stats.byAction)
    .filter(([k]) => k.includes('error') || k.includes('fail'))
    .reduce((sum, [, v]) => sum + v, 0)

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Activity Log</h1>
          <p className="text-gray-400">Monitor all agent events and actions</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-aurais-primary" />
            <span className="text-sm text-gray-400">Total Events (24h)</span>
          </div>
          <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">Success Rate</span>
          </div>
          <div className="text-2xl font-bold">
            {stats.total > 0
              ? `${Math.round(((stats.total - warningCount - errorCount) / stats.total) * 100)}%`
              : '—'}
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-gray-400">Warnings</span>
          </div>
          <div className="text-2xl font-bold">{warningCount}</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-5 h-5 text-red-400" />
            <span className="text-sm text-gray-400">Errors</span>
          </div>
          <div className="text-2xl font-bold">{errorCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-aurais-primary"
          >
            <option value="all">All Types</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="info">Info</option>
          </select>
        </div>
      </div>

      {/* Activity List */}
      <div className="glass rounded-xl overflow-hidden">
        {filteredActivity.length > 0 ? (
          <div className="divide-y divide-white/5">
            {filteredActivity.map((event) => {
              const type = getActionType(event.action)
              const Icon = eventIcons[type] ?? Info
              const color = eventColors[type] ?? 'text-gray-400'
              return (
                <div key={event.id} className="p-4 hover:bg-white/5 transition">
                  <div className="flex items-start gap-4">
                    <div className={`mt-1 ${color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium capitalize">{event.action.replace(/_/g, ' ')}</span>
                      </div>
                      {event.description && (
                        <div className="text-sm text-gray-400">{event.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Clock className="w-3 h-3" />
                      {timeAgo(event.created_at)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{activity.length === 0 ? 'No activity yet' : 'No events found'}</p>
            {activity.length === 0 && (
              <p className="text-sm mt-2 text-gray-500">Activity will appear here as your agents run</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
