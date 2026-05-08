/**
 * Sentry — config do servidor Node (Server Components, Server Actions, Route Handlers).
 * Carregada via instrumentation.ts em runtime nodejs.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === 'production',
  })
}
