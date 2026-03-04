'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Bot,
  Shield,
  Plus,
  Search,
  Clock,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  Edit,
  Filter,
} from 'lucide-react'
import type { Agent, AgentStatus } from '@/lib/db/types'
import { getTierStylesFromScore } from '@/lib/trust-tiers'
import { timeAgo } from '@/lib/time'

interface AgentsClientProps {
  agents: Agent[]
}

const STATUS_DISPLAY: Record<AgentStatus, { label: string; dotClass: string; textClass: string }> = {
  draft: { label: 'Draft', dotClass: 'bg-gray-400', textClass: 'text-gray-400' },
  training: { label: 'Training', dotClass: 'bg-yellow-400', textClass: 'text-yellow-400' },
  active: { label: 'Active', dotClass: 'bg-green-400', textClass: 'text-green-400' },
  suspended: { label: 'Suspended', dotClass: 'bg-red-400', textClass: 'text-red-400' },
  archived: { label: 'Archived', dotClass: 'bg-gray-500', textClass: 'text-gray-500' },
}

export default function AgentsClient({ agents }: AgentsClientProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (agent.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Agents</h1>
          <p className="text-gray-400">Manage your deployed AI agents</p>
        </div>
        <Link
          href="/dashboard/agents/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition"
        >
          <Plus className="w-5 h-5" />
          <span>New Agent</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-aurais-primary"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="training">Training</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Agents List */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Agent</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Trust Score</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Status</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Executions</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Last Active</th>
              <th className="text-right px-6 py-4 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAgents.map((agent) => {
              const tier = getTierStylesFromScore(agent.trust_score)
              const sd = STATUS_DISPLAY[agent.status]
              return (
                <tr key={agent.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-6 py-4">
                    <Link href={`/dashboard/agents/${agent.id}`} className="flex items-center gap-3 group">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-aurais-primary/20 to-aurais-accent/20 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-aurais-primary" />
                      </div>
                      <div>
                        <div className="font-medium group-hover:text-aurais-primary transition">{agent.name}</div>
                        <div className="text-sm text-gray-400 truncate max-w-xs">{agent.description}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{agent.trust_score}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>
                        {tier.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-sm ${sd.textClass}`}>
                      <span className={`w-2 h-2 rounded-full ${sd.dotClass}`} />
                      {sd.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-300">
                    {agent.executions.toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm text-gray-400">
                      <Clock className="w-3 h-3" />
                      {timeAgo(agent.last_active_at)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === agent.id ? null : agent.id)}
                        className="p-2 rounded-lg hover:bg-white/10 transition"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openMenu === agent.id && (
                        <div className="absolute right-0 top-full mt-1 w-40 glass rounded-lg py-1 z-10">
                          <Link href={`/dashboard/agents/${agent.id}`} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 transition">
                            <Edit className="w-4 h-4" />
                            Edit
                          </Link>
                          <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 transition">
                            {agent.status === 'active' ? (
                              <>
                                <Pause className="w-4 h-4" />
                                Suspend
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4" />
                                Activate
                              </>
                            )}
                          </button>
                          <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/10 transition">
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredAgents.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{agents.length === 0 ? 'No agents yet' : 'No agents found'}</p>
            {agents.length === 0 && (
              <Link
                href="/dashboard/agents/new"
                className="inline-flex items-center gap-2 text-aurais-primary hover:text-aurais-secondary transition mt-2"
              >
                <Plus className="w-4 h-4" />
                <span>Create your first agent</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  )
}
