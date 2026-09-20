import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 원인을 찾을 수 있도록 소스맵을 남긴다(운영에서도 도움이 된다)
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    // 로컬 개발에서는 API·WebSocket 만 wrangler dev 로 넘긴다
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
