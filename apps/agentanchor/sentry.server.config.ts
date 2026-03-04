/**
 * Sentry Server Configuration
 *
 * This configuration is used for server-side error tracking in API routes and Server Components.
 * Reads env vars directly to avoid triggering full config validation at instrumentation time.
 */

import * as Sentry from '@sentry/nextjs'

const sentryDsn = process.env.SENTRY_DSN
const sentryEnvironment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'
const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1')

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    tracesSampleRate,
    debug: false,

    ignoreErrors: [
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
    ],

    beforeSend(event, hint) {
      const error = hint.originalException

      if (event.request?.url?.includes('/api/health')) {
        return null
      }

      if (error instanceof Error) {
        event.extra = {
          ...event.extra,
          errorName: error.name,
          errorStack: error.stack,
        }
      }

      return event
    },
  })
}
