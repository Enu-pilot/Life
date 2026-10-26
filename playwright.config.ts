import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173', locale: 'ja-JP' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // 古いビルドを配信しているサーバーを誤って使わないよう、常に新しくビルドして起動する
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
