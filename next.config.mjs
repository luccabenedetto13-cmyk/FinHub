import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {}

const hasSentry = !!(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
)

const sentryOptions = {
  // Mantém build silencioso quando não há DSN ou auth token.
  silent: !hasSentry,
  // Skip upload de source maps a menos que o user configure SENTRY_AUTH_TOKEN.
  // Em produção real, defina SENTRY_ORG, SENTRY_PROJECT e SENTRY_AUTH_TOKEN.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Não expandir limites de transação automaticamente
  widenClientFileUpload: false,
  // Tunnel evita ad blockers em prod, mas exige rota — desligado por padrão.
  tunnelRoute: undefined,
  disableLogger: true,
}

export default withSentryConfig(nextConfig, sentryOptions)
