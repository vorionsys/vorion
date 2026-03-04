'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bot,
  Shield,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Database,
  Code,
  MessageSquare,
  Cpu,
  Brain,
  Check,
  Loader2,
} from 'lucide-react'

const agentTemplates = [
  {
    id: 'data-processor',
    name: 'Data Processor',
    description: 'Automated data pipeline agent for ETL workflows',
    icon: Database,
    tier: 'T3 Verified',
    capabilities: ['Read databases', 'Transform data', 'Write approved schemas'],
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'AI-powered code review and security analysis',
    icon: Code,
    tier: 'T4 Operational',
    capabilities: ['Read source code', 'Security analysis', 'CI/CD integration'],
  },
  {
    id: 'support-agent',
    name: 'Support Agent',
    description: 'Multi-channel customer inquiry handler',
    icon: MessageSquare,
    tier: 'T2 Provisional',
    capabilities: ['Read messages', 'Send responses', 'Sentiment analysis'],
  },
  {
    id: 'automation',
    name: 'Workflow Automation',
    description: 'Visual workflow builder with integrations',
    icon: Cpu,
    tier: 'T3 Verified',
    capabilities: ['Execute workflows', 'API integrations', 'Scheduled tasks'],
  },
  {
    id: 'research',
    name: 'Research Assistant',
    description: 'AI research and document analysis',
    icon: Brain,
    tier: 'T2 Provisional',
    capabilities: ['Search papers', 'Summarization', 'Citation management'],
  },
  {
    id: 'custom',
    name: 'Custom Agent',
    description: 'Build your own agent from scratch',
    icon: Bot,
    tier: 'T0 Sandbox',
    capabilities: ['Configurable', 'Start minimal', 'Earn trust'],
  },
]

export default function NewAgentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [agentName, setAgentName] = useState('')
  const [agentDescription, setAgentDescription] = useState('')

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const template = agentTemplates.find(t => t.id === selectedTemplate)
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          description: agentDescription || template?.description,
          specialization: selectedTemplate === 'custom' ? 'core' : selectedTemplate,
          capabilities: template?.capabilities ?? [],
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to create agent')
        return
      }
      router.push('/dashboard/agents')
    } catch {
      setError('Network error — please try again')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/agents" className="hover:text-white transition flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" />
          My Agents
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-white">New Agent</span>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-4 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              s === step ? 'bg-aurais-primary text-white' :
              s < step ? 'bg-green-500 text-white' : 'bg-white/10 text-gray-400'
            }`}>
              {s < step ? <Check className="w-4 h-4" /> : s}
            </div>
            <span className={s === step ? 'text-white' : 'text-gray-400'}>
              {s === 1 ? 'Choose Template' : s === 2 ? 'Configure' : 'Review'}
            </span>
            {s < 3 && <div className="w-12 h-px bg-white/10" />}
          </div>
        ))}
      </div>

      {/* Step 1: Choose Template */}
      {step === 1 && (
        <div>
          <h1 className="text-2xl font-bold mb-2">Choose a Template</h1>
          <p className="text-gray-400 mb-6">Start with a pre-configured agent or build from scratch</p>

          <div className="grid grid-cols-3 gap-4">
            {agentTemplates.map((template) => {
              const Icon = template.icon
              const isSelected = selectedTemplate === template.id
              return (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id)}
                  className={`text-left p-6 rounded-xl transition ${
                    isSelected
                      ? 'glass border-2 border-aurais-primary'
                      : 'glass glass-hover border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      isSelected ? 'bg-aurais-primary/20' : 'bg-white/5'
                    }`}>
                      <Icon className={`w-6 h-6 ${isSelected ? 'text-aurais-primary' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold">{template.name}</h3>
                      <span className="text-xs text-gray-400">{template.tier}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{template.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {template.capabilities.slice(0, 2).map((cap, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded-full bg-white/5 text-gray-400">
                        {cap}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex justify-end mt-8">
            <button
              onClick={() => setStep(2)}
              disabled={!selectedTemplate}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div>
          <h1 className="text-2xl font-bold mb-2">Configure Your Agent</h1>
          <p className="text-gray-400 mb-6">Customize the basic settings for your agent</p>

          <div className="max-w-xl space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">Agent Name</label>
              <input
                id="name"
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="My Data Processor"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-2">Description</label>
              <textarea
                id="description"
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                placeholder="Describe what your agent will do..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none resize-none"
              />
            </div>

            <div className="p-4 rounded-xl bg-aurais-primary/10 border border-aurais-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-aurais-primary" />
                <span className="font-medium">Trust Level</span>
              </div>
              <p className="text-sm text-gray-400">
                New agents start at T0 (Sandbox) and earn trust through successful operations.
                Higher trust levels unlock more capabilities.
              </p>
            </div>
          </div>

          <div className="flex justify-between mt-8">
            <button
              onClick={() => setStep(1)}
              className="px-6 py-3 rounded-xl glass glass-hover transition"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!agentName}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div>
          <h1 className="text-2xl font-bold mb-2">Review & Create</h1>
          <p className="text-gray-400 mb-6">Review your agent configuration before creating</p>

          <div className="max-w-xl glass rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-aurais-primary/20 to-aurais-accent/20 flex items-center justify-center">
                <Bot className="w-8 h-8 text-aurais-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{agentName}</h2>
                <span className="text-sm text-gray-400">
                  Template: {agentTemplates.find(t => t.id === selectedTemplate)?.name}
                </span>
              </div>
            </div>

            <p className="text-gray-300">{agentDescription || 'No description provided'}</p>

            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Starting Trust Tier</span>
                <span className="text-red-400">T0 Sandbox</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-gray-400">Initial Capabilities</span>
                <span>Read-only, no external access</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-between mt-8">
            <button
              onClick={() => setStep(2)}
              disabled={creating}
              className="px-6 py-3 rounded-xl glass glass-hover transition disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-aurais-primary hover:bg-aurais-secondary transition disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {creating ? 'Creating...' : 'Create Agent'}
              {!creating && <ArrowRight className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
