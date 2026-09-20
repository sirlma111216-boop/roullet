/**
 * 포털 연구소 (mix-portal)
 *
 * 짝지어진 포털 + 회전문 + 가속 바닥 + 느린 구역.
 *
 * 포털 규칙(검사로 지킨다 — maps.test.ts):
 *  1. 모든 포털은 한 방향이다. 나온 자리로 되들어갈 수 없다.
 *  2. 나오는 자리는 들어간 자리보다 **반드시 아래**다. 그래서 왕복이 생기지 않는다.
 *  3. 나오는 자리는 결승 구역보다 위다. 포털로 결승 판정을 건너뛸 수 없다.
 *  4. 나온 뒤 쿨다운 동안은 어떤 포털에도 못 들어간다.
 */

import type { DeviceDef, MapDefinition } from '../map/types.ts';
import { area, band, centerPath, collect, courseWalls, FRAME, peak, pinGrid, ramp } from './kit.ts';

const FINISH_Y = 140;

/** 나온 뒤 다시 포털에 들어갈 수 없는 시간 */
const PORTAL_COOLDOWN_MS = 1200;

export const mixPortal: MapDefinition = {
  id: 'mix-portal',
  version: 1,
  name: '포털 연구소',
  category: 'extended',
  description:
    '회전문을 지나 가속 바닥에서 속도를 얻고 느린 구역에서 잃는다. 아래쪽 포털에 들어가면 색이 같은 출구로 순간이동한다.',
  highlights: ['짝지어진 포털', '회전문', '가속 바닥', '느린 구역'],

  bounds: { x: 0, y: FRAME.top, w: 24, h: FINISH_Y - FRAME.top + 8 },
  preview: { x: 0, y: -10, w: 24, h: FINISH_Y + 14 },
  spawn: { area: { x: 8.55, y: -8, w: 6.9, h: 10 }, perRow: 10, gap: 0.62 },

  finish: { area: { x: 0, y: FINISH_Y, w: 24, h: 5 } },
  checkpoints: [
    band('cp1', '낙하 핀', 22),
    band('cp2', '회전문', 50),
    band('cp3', '가속 바닥', 64),
    band('cp4', '느린 구역', 82),
    band('cp5', '포털 구역', 112),
    band('cp6', '결승 관문', 132),
  ],
  progressPath: centerPath(FINISH_Y),
  estimatedDurationSec: [12, 31],
  timeLimitSec: 160,

  obstacles: collect(
    courseWalls(FINISH_Y),

    pinGrid({ x0: 3.4, x1: 20.6, y0: 19, y1: 28, dx: 1.9, dy: 3.4, r: 0.3 }),

    // 회전문을 향해 모으는 팔
    ramp(4.6, 34, 2.6, 0.32),
    ramp(19.4, 34, 2.6, -0.32),
    // 가운데로 흘러내리지 않도록 회전문 사이를 가르는 지붕
    peak(12, 36.5, 3.4),

    // 가속 바닥 — 아래로 기울어진 활주로
    ramp(7.5, 56, 5.2, 0.22, 'boost-floor'),
    ramp(16.5, 63, 5.2, -0.22, 'boost-floor'),

    // 느린 구역의 걸림돌
    pinGrid({ x0: 4.5, x1: 19.5, y0: 72, y1: 82, dx: 2.5, dy: 3.4, r: 0.36, style: 'slow-pin' }),

    // 포털 구역 바닥 — 들어가지 않은 구슬도 지나갈 길을 남긴다
    ramp(6.2, 100, 3.4, 0.3),
    ramp(17.8, 100, 3.4, -0.3),
    peak(12, 118, 9),

    // 결승 앞 정리
    ramp(6.8, 126, 3.2, 0.3),
    ramp(17.2, 126, 3.2, -0.3),
  ),

  devices: [
    // 회전문 두 개 — 서로 반대로 돈다
    { t: 'revolvingDoor', x: 7, y: 42, r: 3.4, blades: 2, omega: 1.5, style: 'door' },
    { t: 'revolvingDoor', x: 17, y: 42, r: 3.4, blades: 2, omega: -1.5, style: 'door' },

    // 가속 바닥
    { t: 'booster', area: area(3, 52, 18, 14), ax: 0, ay: 20, maxSpeed: 27, style: 'booster' },

    // 느린 구역
    { t: 'slow', area: area(3, 70, 18, 16), retainPerSec: 0.22, style: 'slow' },

    // ---- 포털: 모두 한 방향이고, 나오는 곳은 들어간 곳보다 아래다 ----
    {
      t: 'portal',
      a: { x: 5.2, y: 92, r: 1.35 },
      b: { x: 15.5, y: 110, r: 1.35 },
      cooldownMs: PORTAL_COOLDOWN_MS,
      oneWay: true,
      exitBoost: 0.55,
      style: 'portal-violet',
    },
    {
      t: 'portal',
      a: { x: 18.8, y: 92, r: 1.35 },
      b: { x: 8.5, y: 110, r: 1.35 },
      cooldownMs: PORTAL_COOLDOWN_MS,
      oneWay: true,
      exitBoost: 0.55,
      style: 'portal-cyan',
    },
    {
      t: 'portal',
      a: { x: 12, y: 96, r: 1.5 },
      b: { x: 12, y: 122, r: 1.5 },
      cooldownMs: PORTAL_COOLDOWN_MS,
      oneWay: true,
      exitBoost: 0.5,
      style: 'portal-amber',
    },

    // 포털에 안 들어간 구슬을 흔드는 막대
    { t: 'spinner', x: 12, y: 106, hw: 2.8, hh: 0.22, omega: 2.8, style: 'bar' },
    { t: 'spinner', x: 7.5, y: 116, hw: 2.4, hh: 0.22, omega: -3.2, style: 'bar' },
    { t: 'spinner', x: 16.5, y: 116, hw: 2.4, hh: 0.22, omega: 3.2, style: 'bar' },
  ] satisfies DeviceDef[],
};
