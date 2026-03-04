// Prevent prerendering of academy pages during build
// Supabase client requires env vars that aren't available at build time
export const dynamic = 'force-dynamic'

export default function AcademyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
