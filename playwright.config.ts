import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config para os fluxos críticos do FinHub.
 *
 * Como rodar:
 *   1. Instale browsers (uma vez): `npx playwright install`
 *   2. Em outro terminal, rode o app: `npm run dev`
 *   3. Rode os testes: `npm run test:e2e`
 *
 * Os testes deste sprint cobrem apenas rotas públicas e o middleware de auth.
 * Para testes autenticados, adicione `globalSetup` que cria um usuário via
 * service role e salva o storage state (sessão) para reuso.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
