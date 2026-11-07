import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { channel: 'chromium', locale: 'es-AR', baseURL: 'https://app.tarjetas-browser.test', ignoreHTTPSErrors: false, trace: 'retain-on-failure' },
  reporter: 'list',
});
