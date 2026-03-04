'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bot,
  Activity,
  Settings,
  LogOut,
  BarChart3,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3, exact: true },
  { href: '/dashboard/agents', label: 'My Agents', icon: Bot },
  { href: '/marketplace', label: 'Marketplace', icon: Users },
  { href: '/dashboard/activity', label: 'Activity', icon: Activity },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
]

export default function DashboardSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 glass border-r border-white/10 p-4 flex flex-col z-30">
      <div className="flex items-center gap-2 mb-8 px-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aurais-primary to-aurais-accent flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold text-gradient">Aurais</span>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
              isActive(href, exact)
                ? 'bg-aurais-primary/10 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="pt-4 border-t border-white/10">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition w-full"
        >
          <LogOut className="w-5 h-5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
