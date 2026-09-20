/**
 * 바람 협곡 (mix-wind)
 *
 * 좌우 바람 구역 + 핀 + 시소 + 분기 후 합류.
 * 바람은 번갈아 켜진다 — 화면에서 방향과 남은 시간을 볼 수 있다(그림 담당이 그린다).
 */

import type { DeviceDef, MapDefinition } from '../map/types.ts';
import { area, band, centerPath, collect, courseWalls, divider, FRAME, pinGrid, ramp } from './kit.ts';

const FINISH_Y = 130;

/** 바람 한 주기(ms). 좌우가 반 주기씩 어긋나 번갈아 분다. */
const GUST = { onMs: 2000, offMs: 1600 };

export const mixWind: MapDefinition = {
  id: 'mix-wind',
  version: 1,
  name: '바람 협곡',
  category: 'extended',
  description:
    '좌우에서 번갈아 부는 바람이 구슬을 옆으로 민다. 핀 구간과 시소를 지나 두 갈래로 갈렸다가 아래에서 다시 만난다.',
  highlights: ['좌우 교대 바람', '낙하 핀', '시소 두 개', '분기 후 합류'],

  bounds: { x: 0, y: FRAME.top, w: 24, h: FINISH_Y - FRAME.top + 8 },
  preview: { x: 0, y: -10, w: 24, h: FINISH_Y + 14 },
  spawn: { area: { x: 8.55, y: -8, w: 6.9, h: 10 }, perRow: 10, gap: 0.62 },

  finish: { area: { x: 0, y: FINISH_Y, w: 24, h: 5 } },
  checkpoints: [
    band('cp1', '핀 구간', 22),
    band('cp2', '바람 협곡', 46),
    band('cp3', '시소', 68),
    band('cp4', '두 갈래', 88),
    band('cp5', '합류', 108),
    band('cp6', '결승 관문', 122),
  ],
  progressPath: centerPath(FINISH_Y),
  estimatedDurationSec: [12, 28],
  timeLimitSec: 150,

  obstacles: collect(
    courseWalls(FINISH_Y),

    // 낙하 핀
    pinGrid({ x0: 3.4, x1: 20.6, y0: 19, y1: 30, dx: 1.9, dy: 3.6, r: 0.3 }),

    // 바람 협곡 — 바람에 밀린 구슬이 걸리도록 핀을 성기게 둔다
    pinGrid({ x0: 4.2, x1: 19.8, y0: 36, y1: 52, dx: 2.6, dy: 4, r: 0.34 }),

    // 시소 구간으로 떨어뜨리는 경사로
    ramp(5.4, 58, 3.4, 0.2),
    ramp(18.6, 58, 3.4, -0.2),

    // 두 갈래 — 가운데 칸막이
    divider(12, 80, 104, 0.5),
    // 각 갈래의 안쪽 경사로
    ramp(7, 92, 3.2, 0.16),
    ramp(17, 92, 3.2, -0.16),

    // 합류부 — 가운데로 모으는 팔
    ramp(6.6, 110, 4, 0.26),
    ramp(17.4, 110, 4, -0.26),
  ),

  devices: [
    // 왼쪽에서 오른쪽으로 미는 바람
    {
      t: 'wind',
      area: area(FRAME.left, 34, 10, 20),
      ax: 7.5,
      ay: 0,
      ...GUST,
      phase: 0,
      style: 'wind-right',
    },
    // 오른쪽에서 왼쪽으로 미는 바람 — 반 주기 늦게 분다
    {
      t: 'wind',
      area: area(12, 34, 10, 20),
      ax: -7.5,
      ay: 0,
      ...GUST,
      phase: 0.5,
      style: 'wind-left',
    },

    { t: 'seesaw', x: 7.5, y: 64, hw: 4.2, hh: 0.26, maxAngle: 0.5, periodMs: 3000, style: 'seesaw' },
    { t: 'seesaw', x: 16.5, y: 71, hw: 4.2, hh: 0.26, maxAngle: 0.5, periodMs: 3400, phase: 0.5, style: 'seesaw' },

    // 왼쪽 갈래 — 아래로 밀어 내리는 바람
    { t: 'wind', area: area(3, 84, 8.4, 18), ax: 0, ay: 6, onMs: 1500, offMs: 1500, phase: 0.25, style: 'wind-down' },
    // 오른쪽 갈래 — 회전 막대
    { t: 'spinner', x: 17, y: 86, hw: 2.6, hh: 0.22, omega: 3.1, style: 'bar' },
    { t: 'spinner', x: 16, y: 99, hw: 2.6, hh: 0.22, omega: -3.4, style: 'bar' },

    // 합류 직후
    { t: 'spinner', x: 12, y: 116, hw: 3.2, hh: 0.24, omega: 2.6, style: 'bar' },
  ] satisfies DeviceDef[],
};
