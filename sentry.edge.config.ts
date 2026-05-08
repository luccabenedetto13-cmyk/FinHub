/**
 * Sentry — config do edge runtime do Next (middleware.ts e route handlers `runtime: 'edge'`).
 * NÃO confundir com Supabase Edge Functions (Deno) — essas vão por outro caminho.
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
