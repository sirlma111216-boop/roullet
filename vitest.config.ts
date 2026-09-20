import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 맵 시뮬레이션 검사는 수천 스텝을 돌리므로 기본 5초로는 모자란다
    testTimeout: 60_000,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**'],
  },
});
