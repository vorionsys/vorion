import { listAgents, getProfile } from '@/lib/db'
import DashboardClient from './dashboard-client'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [agents, profile] = await Promise.all([listAgents(), getProfile()])

  return (
    <DashboardClient
      agents={agents}
      userName={profile?.name ?? null}
    />
  )
}
