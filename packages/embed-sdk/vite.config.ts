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
    // 화면 자산 안으로 내보낸다. Vite 가 public/ 을 dist/ 로 복사하므로
    // 배포하면 https://<주소>/sdk/marble-race-sdk.js 로 내려받을 수 있다.
    // 다른 수업 앱이 번들러 없이 <script type="module"> 로 가져다 쓰는 길이다.
    outDir: '../../apps/web/public/sdk',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    minify: false,
  },
});
