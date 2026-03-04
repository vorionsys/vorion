/**
 * Environment variable validation for Aurais.
 * Fails fast with clear error messages instead of cryptic runtime crashes.
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `See .env.example for required variables.`
    )
  }
  return value
}

/** Validated environment variables — import this instead of using process.env directly. */
export const env = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  },
  get NEXT_PUBLIC_URL() {
    return process.env.NEXT_PUBLIC_URL || 'https://aurais.net'
  },
  get COGNIGATE_API_URL() {
    return process.env.COGNIGATE_API_URL || 'https://cognigate.dev'
  },
  get COGNIGATE_API_KEY() {
    return process.env.COGNIGATE_API_KEY
  },
} as const
