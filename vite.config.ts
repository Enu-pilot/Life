/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相対パスで配信できるようにする（静的ホスティング・サブディレクトリ配置に対応）
  base: './',
  plugins: [react()],
  build: {
    // 本体チャンク（React・React Router・Zod）は約 530KB（gzip 約 160KB）。ローカルで使う個人用アプリとして許容し、
    // グラフ（Recharts）は遅延読み込みで別チャンクに分けている（docs/phase-reports.md Phase 6）
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/storage/**', 'src/domain/**'],
      exclude: ['**/*.test.ts'],
    },
  },
});
