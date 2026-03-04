function Error({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        {statusCode || 'Error'}
      </h1>
      <p style={{ fontSize: '1.25rem', color: '#6b7280' }}>
        {statusCode === 404 ? 'Page not found' : 'An error occurred'}
      </p>
    </div>
  )
}

Error.getInitialProps = ({ res, err }: { res?: { statusCode: number }; err?: { statusCode: number } }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404
  return { statusCode }
}

export default Error
