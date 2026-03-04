import { createBrowserClient } from '@supabase/ssr'

// Using untyped client - Database types are incomplete
// Run `npx supabase gen types` to generate full types from the database
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  )
