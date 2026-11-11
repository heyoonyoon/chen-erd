import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { APP_NAME } from './src/shared/app.ts';

const SERVER = process.env.ERD_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    {
      // index.html의 제품 이름 자리를 상수 값으로 채운다
      name: 'app-name',
      transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': { target: SERVER },
      '/mcp': { target: SERVER },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
