import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5191, strictPort: true,
    allowedHosts: ['app.tarjetas.test', 'app.tarjetas-browser.test'],
    hmr: { protocol: 'wss', host: process.env.VITE_API_BASE_URL?.includes('browser') ? 'app.tarjetas-browser.test' : 'app.tarjetas.test', clientPort: 443 },
  },
  test: { env: { VITE_API_BASE_URL: 'https://api.tarjetas-browser.test/api/v1' }, include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
