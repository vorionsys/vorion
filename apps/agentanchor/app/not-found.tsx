export default function NotFound() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem' }}>404</h1>
      <p style={{ fontSize: '1.25rem', color: '#6b7280' }}>Page not found</p>
      <a href="/dashboard" style={{ color: '#3b82f6', marginTop: '1rem', display: 'inline-block' }}>
        Go to Dashboard
      </a>
    </div>
  )
}
