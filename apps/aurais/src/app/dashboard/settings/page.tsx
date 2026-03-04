import { getProfile } from '@/lib/db'
import SettingsClient from './settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const profile = await getProfile()

  return <SettingsClient profile={profile} />
}
