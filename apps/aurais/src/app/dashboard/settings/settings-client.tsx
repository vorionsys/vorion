'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  User,
  Bell,
  Key,
  CreditCard,
  Globe,
  Save,
  Mail,
  Building,
  Loader2,
} from 'lucide-react'
import type { Profile } from '@/lib/db/types'

interface SettingsClientProps {
  profile: Profile | null
}

export default function SettingsClient({ profile }: SettingsClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'billing'>('profile')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [profileData, setProfileData] = useState({
    name: profile?.name ?? '',
    email: profile?.email ?? '',
    organization: profile?.organization ?? '',
    timezone: profile?.timezone ?? 'America/New_York',
  })

  const [notifications, setNotifications] = useState({
    email: true,
    agentAlerts: true,
    weeklyReport: true,
    marketing: false,
  })

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileData.name || null,
          organization: profileData.organization || null,
          timezone: profileData.timezone,
        }),
      })
      if (res.ok) {
        setSaved(true)
        router.refresh()
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  const currentPlan = profile?.plan ?? 'core'

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-gray-400">Manage your account and preferences</p>
      </div>

      <div className="flex gap-6">
        {/* Settings Nav */}
        <div className="w-48 space-y-1">
          {([
            { key: 'profile' as const, icon: User, label: 'Profile' },
            { key: 'notifications' as const, icon: Bell, label: 'Notifications' },
            { key: 'security' as const, icon: Key, label: 'Security' },
            { key: 'billing' as const, icon: CreditCard, label: 'Billing' },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
                activeTab === key ? 'bg-aurais-primary/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>

        {/* Settings Content */}
        <div className="flex-1 max-w-2xl">
          {activeTab === 'profile' && (
            <div className="glass rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-6">Profile Settings</h2>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <User className="w-4 h-4 inline mr-2" />
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileData.name}
                    onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Mail className="w-4 h-4 inline mr-2" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={profileData.email}
                    disabled
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-gray-400 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-500 mt-1">Email is managed by your auth provider</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Building className="w-4 h-4 inline mr-2" />
                    Organization
                  </label>
                  <input
                    type="text"
                    value={profileData.organization}
                    onChange={(e) => setProfileData({ ...profileData, organization: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Globe className="w-4 h-4 inline mr-2" />
                    Timezone
                  </label>
                  <select
                    value={profileData.timezone}
                    onChange={(e) => setProfileData({ ...profileData, timezone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-aurais-primary focus:outline-none"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="Europe/London">London (GMT)</option>
                    <option value="Europe/Paris">Paris (CET)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="glass rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-6">Notification Preferences</h2>
              <div className="space-y-4">
                {[
                  { key: 'email', label: 'Email Notifications', desc: 'Receive important updates via email' },
                  { key: 'agentAlerts', label: 'Agent Alerts', desc: 'Get notified about agent status changes' },
                  { key: 'weeklyReport', label: 'Weekly Report', desc: 'Summary of agent activity and trust scores' },
                  { key: 'marketing', label: 'Marketing', desc: 'Product updates and announcements' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer hover:bg-white/10 transition">
                    <div>
                      <div className="font-medium">{item.label}</div>
                      <div className="text-sm text-gray-400">{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications[item.key as keyof typeof notifications]}
                      onChange={(e) => setNotifications({ ...notifications, [item.key]: e.target.checked })}
                      className="w-5 h-5 rounded border-white/20 bg-white/5 text-aurais-primary focus:ring-aurais-primary"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="glass rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-6">Security Settings</h2>
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-white/5">
                  <h3 className="font-medium mb-2">Change Password</h3>
                  <p className="text-sm text-gray-400 mb-4">Update your password to keep your account secure</p>
                  <button className="px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition">
                    Change Password
                  </button>
                </div>
                <div className="p-4 rounded-xl bg-white/5">
                  <h3 className="font-medium mb-2">Two-Factor Authentication</h3>
                  <p className="text-sm text-gray-400 mb-4">Add an extra layer of security to your account</p>
                  <button className="px-4 py-2 rounded-lg glass glass-hover transition">
                    Enable 2FA
                  </button>
                </div>
                <div className="p-4 rounded-xl bg-white/5">
                  <h3 className="font-medium mb-2">API Keys</h3>
                  <p className="text-sm text-gray-400 mb-4">Manage API keys for programmatic access</p>
                  <button className="px-4 py-2 rounded-lg glass glass-hover transition">
                    Manage API Keys
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="glass rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-6">Billing & Subscription</h2>
              <div className="p-4 rounded-xl bg-aurais-primary/10 border border-aurais-primary/20 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Current Plan</span>
                  <span className="px-2 py-1 rounded-full bg-aurais-primary text-xs font-medium capitalize">{currentPlan}</span>
                </div>
                <p className="text-sm text-gray-400">
                  {currentPlan === 'core' ? 'Free tier with basic features' :
                   currentPlan === 'starter' ? '10 agents, API access, private agents' :
                   currentPlan === 'pro' ? 'Unlimited agents, team collaboration, webhooks' :
                   currentPlan === 'team' ? 'SSO/SAML, RBAC, compliance dashboards' :
                   'Custom enterprise deployment'}
                </p>
              </div>
              <div className="space-y-4">
                {[
                  { plan: 'starter', label: 'Starter Plan', desc: '10 agents, API access, private agents', price: '$12/mo' },
                  { plan: 'pro', label: 'Pro Plan', desc: 'Unlimited agents, team collaboration, webhooks', price: '$49/mo' },
                  { plan: 'team', label: 'Team Plan', desc: 'SSO/SAML, RBAC, compliance dashboards', price: '$99/mo' },
                ].filter(p => p.plan !== currentPlan).map((tier) => (
                  <div key={tier.plan} className="p-4 rounded-xl bg-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="font-medium">{tier.label}</h3>
                        <p className="text-sm text-gray-400">{tier.desc}</p>
                      </div>
                      <span className="text-xl font-bold">{tier.price}</span>
                    </div>
                    <button className="w-full px-4 py-2 rounded-lg bg-aurais-primary hover:bg-aurais-secondary transition mt-2">
                      Upgrade to {tier.label.replace(' Plan', '')}
                    </button>
                  </div>
                ))}
                <Link href="/contact" className="block p-4 rounded-xl bg-white/5 text-center text-sm text-gray-400 hover:text-white transition">
                  Need Enterprise? Contact Sales
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
