import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production the Express server serves the build under /app/ and sends index.html for /, /shop and /product/:slug.
// In development (npm run dev inside web/) Vite proxies the API and the old HTML pages to the store server on :3000.
const store = 'http://localhost:3000';
const proxy = Object.fromEntries(
  ['/api', '/uploads', '/img', '/invoice', '/media', '/css', '/js', '/vendor', '/admin', '/bag', '/checkout', '/track', '/account', '/story', '/bulk', '/policies', '/thank-you']
    .map((p) => [p, store]),
);

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',
  plugins: [react()],
  server: { port: 5173, proxy },
  build: { outDir: 'dist', emptyOutDir: true },
}));
