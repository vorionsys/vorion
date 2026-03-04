/**
 * Sentry Client Configuration (instrumentation-client.ts)
 *
 * This configuration is used for client-side error tracking in the browser.
 * Required by @sentry/nextjs v10+.
 * Reads env vars directly to avoid triggering full config validation at load time.
 */

import * as Sentry from '@sentry/nextjs'

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
const sentryEnvironment = process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || 'development'
const tracesSampleRate = parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1')

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    tracesSampleRate,
    debug: false,

    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,

    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    ignoreErrors: [
      'Non-Error promise rejection captured',
      'Network request failed',
      'NetworkError',
      'AbortError',
    ],

    beforeSend(event, hint) {
      if (event.exception) {
        const error = hint.originalException
        if (error instanceof Error) {
          if (error.message?.includes('ResizeObserver loop')) {
            return null
          }
        }
      }

      return event
    },
  })
}
