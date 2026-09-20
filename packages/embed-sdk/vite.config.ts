import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * 삽입 SDK 를 파일 하나짜리 ESM 으로 묶는다.
 *
 * 부모 수업 앱이 번들러 없이도 `<script type="module" src=".../sdk.js">` 로 쓸 수 있어야 한다 —
 * 학교 쪽 앱이 어떤 도구를 쓰는지 우리가 정할 수 없기 때문이다.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'marble-race-sdk.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    minify: false,
  },
});
