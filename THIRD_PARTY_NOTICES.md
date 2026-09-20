# 제3자 소프트웨어 고지

이 저장소는 아래 소프트웨어를 재사용합니다. 각 고지를 그대로 보존합니다.

---

## lazygyu/roulette — 기본 4개 맵의 기하 정보

- **출처**: <https://github.com/lazygyu/roulette>
- **라이선스**: MIT
- **가져온 커밋**: `47230e32242e1c82030eacb4a263420fe95cedb6` (2026-09-15)
- **가져온 파일**: `src/data/maps.ts` (맵 기하 데이터만)
- **가져온 방식**: `tools/derive-classic-maps.mjs` 가 위 커밋에서 내려받아 기계적으로 변환합니다.
  눈대중으로 베끼지 않았고, 스크립트를 다시 돌리면 같은 결과가 나옵니다.

### 무엇을 가져왔고 무엇을 가져오지 않았는가

가져온 것:

- 네 스테이지의 **기하 정보** — 외곽선(polyline), 사각·원형 장애물의 위치와 크기,
  회전 막대의 각속도와 회전 방향, 터지는 장애물(`life`) 표시, 결승 y 좌표(`goalY`).
- 물리 상수 중 중력(`(0, 10)`)과 구슬 반지름(`0.25`).

가져오지 않은 것:

- 원본의 렌더러·물리 엔진 코드. 이 저장소의 물리(`packages/game-core/src/physics`)와
  그림(`packages/game-renderer`)은 새로 썼습니다. 원본은 box2d-wasm 을 쓰지만
  이 프로젝트는 의존성 없는 자체 2D 충돌 해석기를 씁니다.
- **광고 관련 코드 일체** (`adRenderer.ts`, `adService.ts`, `keywordService.ts`, `assets/manifest.json`의 광고판 좌표).
  변환 스크립트가 `adBoards` 를 통째로 버립니다. 새 서비스에는 광고·상점·홍보 링크·추적 코드가 없습니다.
- 원본의 제품명·로고·UI 문구. 새 이름과 새 시각 디자인을 씁니다.
- 외부 이미지·음원. 이 저장소에는 외부 자산이 없고, 화면은 전부 캔버스로 그립니다.

### 맵 이름 대응표 (개발 문서 전용)

새 UI 에는 **새 이름만** 나옵니다. 아래 대응은 유지보수를 위한 기록입니다.

| 이 저장소 id | 새 이름 | 원본 스테이지 제목 | 계승한 것 |
|---|---|---|---|
| `classic-wheel` | 회전 관문 | Wheel of fortune | 굴곡 통로 → 경사 장애물 → 교차 회전 막대 → 핀 구간 → 좁은 결승 관문 |
| `classic-bubble` | 버블 계곡 | BubblePop | 터지는 원형 장애물, 지그재그·다각형 구간, 출구의 회전 장치와 좁은 통로 |
| `classic-jar` | 항아리 탈출 | Pot of greed | 넓은 상부, 큰 회전 발판, 하부 중앙 구조와 양쪽 통로 |
| `classic-night` | 네온 장거리 | Yoru ni Kakeru (by item4) | 긴 다단 코스, 여러 색 막대, 원형 장애물 군집, 경사로 |

확장 4개 맵(`mix-wind`, `mix-portal`, `mix-magnet`, `mix-festival`)은 이 저장소에서
새로 설계했으며 원본에 대응하는 스테이지가 없습니다.

### 원본 라이선스 전문

```
MIT License

Copyright (c) 2022 LazyGyu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 원본 스테이지 "Yoru ni Kakeru" 의 제목은 요아소비(YOASOBI)의 곡 제목에서 왔고,
> 원본 저장소에 `by item4` 로 기여자가 적혀 있습니다. 이 저장소는 그 코스의
> **기하 구조만** 가져왔고 곡·가사·음원은 일절 쓰지 않습니다. 새 이름도 곡과 무관한
> 「네온 장거리」로 바꾸었습니다.

---

## npm 의존성

런타임 의존성은 다음 하나뿐입니다.

| 꾸러미 | 라이선스 | 쓰는 곳 |
|---|---|---|
| `react`, `react-dom` | MIT | 화면 |
| `qrcode` | MIT | 교사 화면의 참여 QR |

개발 의존성(`typescript`, `vite`, `vitest`, `wrangler`, `@vitejs/plugin-react`,
`@cloudflare/workers-types`, `@types/*`)은 모두 MIT 또는 Apache-2.0 입니다.
전체 목록과 정확한 판은 `package-lock.json` 을 보세요.

물리 엔진에 외부 꾸러미를 쓰지 않습니다(box2d-wasm 등 WASM 의존성 없음).
