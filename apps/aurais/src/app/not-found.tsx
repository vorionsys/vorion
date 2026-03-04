import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-aurais-dark text-white">
      <h1 className="mb-2 text-6xl font-bold tracking-tight">404</h1>
      <p className="mb-8 text-lg text-zinc-400">Page not found</p>
      <Link
        href="/"
        className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium transition-colors hover:bg-blue-700"
      >
        Back to Home
      </Link>
    </div>
  )
}
