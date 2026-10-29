import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:5000';
  return {
    plugins: [react()],
    // "/" for local/Express hosting; set VITE_BASE=/RoleFit-AI/ for GitHub Pages.
    base: env.VITE_BASE || '/',
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      // Same-origin in development: cookies and the CSRF token stay first-party.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
        '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: false,
    },
  };
});
