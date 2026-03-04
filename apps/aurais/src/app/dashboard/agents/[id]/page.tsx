import { notFound } from 'next/navigation'
import { getAgent } from '@/lib/db'
import AgentDetailClient from './agent-detail-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params
  const agent = await getAgent(id)

  if (!agent) {
    notFound()
  }

  return <AgentDetailClient agent={agent} />
}
