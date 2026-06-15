import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// API target defaults to HollaEx PRODUCTION (real funds). Set VITE_HOLLAEX_ENV=sandbox
// (e.g. in a .env.local) to point at the sandbox for safe testing.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useSandbox = env.VITE_HOLLAEX_ENV === 'sandbox';
  const apiHost = useSandbox ? 'api.sandbox.hollaex.com' : 'api.hollaex.com';

  return {
    plugins: [react()],
    server: {
      port: 5182,
      proxy: {
        // REST: /api/* -> https://<host>/v2/*
        '/api': {
          target: `https://${apiHost}/v2`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        // WebSocket: /stream -> wss://<host>/stream
        '/stream': {
          target: `wss://${apiHost}`,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
