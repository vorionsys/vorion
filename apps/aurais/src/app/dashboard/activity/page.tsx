import { listActivity, getActivityStats } from '@/lib/db'
import ActivityClient from './activity-client'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const [activity, stats] = await Promise.all([listActivity(), getActivityStats()])

  return <ActivityClient activity={activity} stats={stats} />
}
