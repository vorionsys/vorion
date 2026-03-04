import { listAgents } from '@/lib/db'
import AgentsClient from './agents-client'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const agents = await listAgents()

  return <AgentsClient agents={agents} />
}
