'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Bot,
  Shield,
  Zap,
  TrendingUp,
  Plus,
  Search,
  ChevronRight,
  Clock,
} from 'lucide-react'
import type { Agent } from '@/lib/db/types'
import { getTierStylesFromScore } from '@/lib/trust-tiers'
import { timeAgo } from '@/lib/time'

interface DashboardClientProps {
  agents: Agent[]
  userName: string | null
}

export default function DashboardClient({ agents, userName }: DashboardClientProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredAgents = agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (agent.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalExecutions = agents.reduce((sum, a) => sum + a.executions, 0)
  const avgTrustScore = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.trust_score, 0) / agents.length)
    : 0
  const activeCount = agents.filter(a => a.status === 'active').length

  const stats = [
    { label: 'Total Agents', value: String(agents.length), icon: Bot, change: `${activeCount} active` },
    { label: 'Avg Trust Score', value: String(avgTrustScore), icon: Shield, change: `/ 1000` },
    { label: 'Total Executions', value: totalExecutions >= 1000 ? `${(totalExecutions / 1000).toFixed(1)}K` : String(totalExecutions), icon: Zap, change: '' },
    { label: 'Active Agents', value: String(activeCount), icon: TrendingUp, change: '' },
  ]

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-400">Welcome back{userName ? `, ${userName}` : ''}! Here&apos;s your agent overview.</p>
        </div>
        <Link
          href="/dashboard/agents/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition"
        >
          <Plus className="w-5 h-5" />
          <span>New Agent</span>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <div key={i} className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-aurais-primary/20 flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-aurais-primary" />
              </div>
              {stat.change && <span className="text-xs text-gray-400">{stat.change}</span>}
            </div>
            <div className="text-2xl font-bold mb-1">{stat.value}</div>
            <div className="text-sm text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Agents Section */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Your Agents</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none text-sm w-64"
            />
          </div>
        </div>

        <div className="space-y-3">
          {filteredAgents.map((agent) => {
            const tier = getTierStylesFromScore(agent.trust_score)
            return (
              <Link
                key={agent.id}
                href={`/dashboard/agents/${agent.id}`}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition group"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-aurais-primary/20 to-aurais-accent/20 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-aurais-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{agent.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        agent.status === 'active'
                          ? 'bg-green-500/20 text-green-400'
                          : agent.status === 'suspended'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 truncate">{agent.description}</p>
                </div>

                <div className="text-right">
                  <div className="flex items-center gap-2 justify-end mb-1">
                    <Shield className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">{agent.trust_score}</span>
                    <span className={`text-xs capitalize ${tier.color}`}>
                      {tier.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    <span>{timeAgo(agent.last_active_at)}</span>
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition" />
              </Link>
            )
          })}
        </div>

        {filteredAgents.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{agents.length === 0 ? 'No agents yet' : 'No agents found'}</p>
            <Link
              href="/dashboard/agents/new"
              className="inline-flex items-center gap-2 text-aurais-primary hover:text-aurais-secondary transition mt-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create your first agent</span>
            </Link>
          </div>
        )}
      </div>

      {/* Trust Insights */}
      {agents.length > 0 && (
        <div className="glass rounded-xl p-6 mt-6">
          <h3 className="font-semibold mb-4">Trust Insights</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">Average Trust Score</span>
                <span>{avgTrustScore} / 1000</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-aurais-primary to-aurais-accent"
                  style={{ width: `${(avgTrustScore / 1000) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Highest Tier</span>
              <span className={getTierStylesFromScore(Math.max(...agents.map(a => a.trust_score))).color + ' font-medium'}>
                {getTierStylesFromScore(Math.max(...agents.map(a => a.trust_score))).name}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
