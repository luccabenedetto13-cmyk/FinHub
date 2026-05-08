/**
 * Sentry — config do navegador.
 * Carregada via `withSentryConfig` no next.config.mjs.
 *
 * Não inicializa se NEXT_PUBLIC_SENTRY_DSN não estiver setado, então é seguro
 * deixar este arquivo no repo mesmo sem credenciais — em dev fica no-op.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    // Ajuste conforme volume e custo. 0.1 = 10% das tx instrumentadas.
    tracesSampleRate: 0.1,
    // Replay (gravação de sessão) é caro — desabilitado por padrão.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Em dev, evita poluir o Sentry de prod
    enabled: process.env.NODE_ENV === 'production',
  })
}
