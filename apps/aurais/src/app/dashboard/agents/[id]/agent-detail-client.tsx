'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Bot,
  Shield,
  ChevronLeft,
  ChevronRight,
  Clock,
  Play,
  Pause,
  Trash2,
  Edit,
  CheckCircle,
  TrendingUp,
  Zap,
  Calendar,
  Terminal,
} from 'lucide-react'
import type { Agent } from '@/lib/db/types'
import { getTierStylesFromScore } from '@/lib/trust-tiers'
import { timeAgo, shortDate } from '@/lib/time'

interface AgentDetailClientProps {
  agent: Agent
}

export default function AgentDetailClient({ agent }: AgentDetailClientProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'config'>('overview')
  const tier = getTierStylesFromScore(agent.trust_score)

  return (
    <>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/agents" className="hover:text-white transition flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" />
          My Agents
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-white">{agent.name}</span>
      </div>

      {/* Agent Header */}
      <div className="glass rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-aurais-primary/20 to-aurais-accent/20 flex items-center justify-center">
              <Bot className="w-8 h-8 text-aurais-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{agent.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-full ${
                  agent.status === 'active' ? 'bg-green-500/20 text-green-400'
                  : agent.status === 'suspended' ? 'bg-red-500/20 text-red-400'
                  : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    agent.status === 'active' ? 'bg-green-400'
                    : agent.status === 'suspended' ? 'bg-red-400'
                    : 'bg-yellow-400'
                  }`} />
                  {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                </span>
              </div>
              <p className="text-gray-400 max-w-xl">{agent.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-lg glass glass-hover transition">
              <Edit className="w-5 h-5" />
            </button>
            <button className="p-2 rounded-lg glass glass-hover transition">
              {agent.status === 'active' ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button className="p-2 rounded-lg glass glass-hover transition text-red-400">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-aurais-primary" />
            <span className="text-sm text-gray-400">Trust Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{agent.trust_score}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>{tier.name}</span>
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span className="text-sm text-gray-400">Executions</span>
          </div>
          <div className="text-2xl font-bold">{agent.executions.toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">Specialization</span>
          </div>
          <div className="text-2xl font-bold capitalize">{agent.specialization}</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-blue-400" />
            <span className="text-sm text-gray-400">Last Active</span>
          </div>
          <div className="text-lg font-bold">{timeAgo(agent.last_active_at)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 glass rounded-xl w-fit">
        {(['overview', 'activity', 'config'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${
              activeTab === tab ? 'bg-aurais-primary text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'config' ? 'Configuration' : tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="glass rounded-xl p-6">
            <h3 className="font-semibold mb-4">Capabilities</h3>
            <div className="space-y-2">
              {agent.capabilities.length > 0 ? (
                agent.capabilities.map((cap: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span className="text-gray-300">{cap}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No capabilities configured</p>
              )}
            </div>
          </div>

          <div className="glass rounded-xl p-6">
            <h3 className="font-semibold mb-4">Personality Traits</h3>
            <div className="flex flex-wrap gap-2">
              {agent.personality_traits.length > 0 ? (
                agent.personality_traits.map((trait: string, i: number) => (
                  <span key={i} className="text-xs px-3 py-1 rounded-full bg-aurais-primary/10 text-aurais-primary">
                    {trait}
                  </span>
                ))
              ) : (
                <p className="text-sm text-gray-500">No traits configured</p>
              )}
            </div>
          </div>

          <div className="col-span-2 glass rounded-xl p-6">
            <h3 className="font-semibold mb-4">Agent Details</h3>
            <dl className="grid grid-cols-4 gap-4">
              <div>
                <dt className="text-sm text-gray-400">Created</dt>
                <dd className="flex items-center gap-1 mt-1">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  {shortDate(agent.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-400">Last Active</dt>
                <dd className="flex items-center gap-1 mt-1">
                  <Clock className="w-4 h-4 text-gray-400" />
                  {timeAgo(agent.last_active_at)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-400">Agent ID</dt>
                <dd className="flex items-center gap-1 mt-1">
                  <Terminal className="w-4 h-4 text-gray-400" />
                  <code className="text-xs">{agent.id.slice(0, 8)}...</code>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-400">Model</dt>
                <dd className="mt-1 text-sm">{agent.model}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="glass rounded-xl p-6">
          <h3 className="font-semibold mb-4">Activity Log</h3>
          <p className="text-gray-400">Activity logging will populate as the agent runs.</p>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="glass rounded-xl p-6 space-y-6">
          <h3 className="font-semibold mb-4">Agent Configuration</h3>
          <div>
            <label className="text-sm text-gray-400">System Prompt</label>
            <div className="mt-2 p-4 rounded-lg bg-white/5 text-sm text-gray-300 whitespace-pre-wrap">
              {agent.system_prompt || 'No system prompt configured'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Model</label>
              <div className="mt-1 text-sm">{agent.model}</div>
            </div>
            <div>
              <label className="text-sm text-gray-400">Specialization</label>
              <div className="mt-1 text-sm capitalize">{agent.specialization}</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
