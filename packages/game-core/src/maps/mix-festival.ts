/**
 * 종합 운동장 (mix-festival)
 *
 * 낙하 핀 → 회전 풍차 → 탄성 발판 → 두 갈래 길 → 마지막 시소.
 * 앞선 세 확장 맵의 장치(바람·포털·자석·컨베이어)를 조금씩만 섞는다 —
 * 전부 넣으면 무슨 일이 벌어지는지 화면에서 읽을 수 없게 된다.
 */

import type { DeviceDef, MapDefinition } from '../map/types.ts';
import { area, band, centerPath, collect, courseWalls, divider, FRAME, peak, pinGrid, ramp } from './kit.ts';

const FINISH_Y = 145;

export const mixFestival: MapDefinition = {
  id: 'mix-festival',
  version: 1,
  name: '종합 운동장',
  category: 'extended',
  description:
    '핀 구간에서 떨어져 회전 풍차에 튕기고, 탄성 발판을 밟고 두 갈래로 갈린다. 마지막은 시소 두 개가 순위를 뒤집는다.',
  highlights: ['회전 풍차', '탄성 발판', '두 갈래 길', '마지막 시소'],

  bounds: { x: 0, y: FRAME.top, w: 24, h: FINISH_Y - FRAME.top + 8 },
  preview: { x: 0, y: -10, w: 24, h: FINISH_Y + 14 },
  spawn: { area: { x: 8.55, y: -8, w: 6.9, h: 10 }, perRow: 10, gap: 0.62 },

  finish: { area: { x: 0, y: FINISH_Y, w: 24, h: 5 } },
  checkpoints: [
    band('cp1', '낙하 핀', 24),
    band('cp2', '회전 풍차', 52),
    band('cp3', '탄성 발판', 74),
    band('cp4', '두 갈래', 94),
    band('cp5', '합류', 118),
    band('cp6', '마지막 시소', 130),
  ],
  progressPath: centerPath(FINISH_Y),
  estimatedDurationSec: [13, 91],
  timeLimitSec: 170,

  obstacles: collect(
    courseWalls(FINISH_Y),

    // 낙하 핀
    pinGrid({ x0: 3.4, x1: 20.6, y0: 19, y1: 32, dx: 1.8, dy: 3.4, r: 0.3 }),

    // 풍차 사이를 가르는 지붕 — 가운데로 곧장 빠지지 않게 한다
    peak(12, 38, 3.2),
    ramp(3.4, 40, 1.4, 0.45),
    ramp(20.6, 40, 1.4, -0.45),

    // 탄성 발판을 받치는 턱
    ramp(4.4, 70, 2.2, 0.35),
    ramp(19.6, 70, 2.2, -0.35),

    // 두 갈래
    divider(12, 86, 112, 0.5),
    ramp(7, 98, 3, 0.16),
    ramp(17, 98, 3, -0.16),

    // 합류
    ramp(6.6, 120, 3.8, 0.26),
    ramp(17.4, 120, 3.8, -0.26),

    // 결승 앞 — 여기에 판을 놓으면 관문을 통째로 막는다. 비워 둔다.
  ),

  devices: [
    // 회전 풍차
    { t: 'windmill', x: 7, y: 46, arms: 3, hw: 3.2, hh: 0.24, omega: 1.8, style: 'windmill' },
    { t: 'windmill', x: 17, y: 46, arms: 3, hw: 3.2, hh: 0.24, omega: -1.8, style: 'windmill' },

    // 탄성 발판
    { t: 'spring', x: 8, y: 76, hw: 2.4, hh: 0.3, angle: -0.1, restitution: 1.15, style: 'spring' },
    { t: 'spring', x: 16, y: 76, hw: 2.4, hh: 0.3, angle: 0.1, restitution: 1.15, style: 'spring' },
    // 평평하게 두었더니 구슬 하나가 이 위에서 수직으로만 튀며 영영 안 내려왔다
    // (되튐이 1 을 넘는 평면은 그대로 두면 제자리 진동을 만든다).
    // 조금 기울여 되튐이 옆으로 흐르게 한다 — maps.test.ts 가 이 규칙을 검사한다.
    { t: 'spring', x: 12, y: 82, hw: 2.2, hh: 0.3, angle: 0.12, restitution: 1.1, style: 'spring' },

    // 왼쪽 갈래 — 컨베이어(자석 공장에서 빌려 왔다)
    { t: 'conveyor', x: 7, y: 92, hw: 3.6, hh: 0.3, angle: 0.12, speed: 5.5, style: 'belt' },
    // 왼쪽 갈래 — 느린 구역(포털 연구소에서 빌려 왔다)
    { t: 'slow', area: area(3, 100, 8.4, 10), retainPerSec: 0.6, style: 'slow' },

    // 오른쪽 갈래 — 바람(바람 협곡에서 빌려 왔다)
    { t: 'wind', area: area(12.6, 90, 8.4, 14), ax: -5.5, ay: 3, onMs: 1700, offMs: 1400, style: 'wind-left' },
    { t: 'bumper', x: 17, y: 106, r: 1, restitution: 1.5, style: 'bumper' },

    // 합류 직후 회전 막대
    { t: 'spinner', x: 12, y: 116, hw: 3.4, hh: 0.24, omega: 3, style: 'bar' },

    // 마지막 시소 — 여기서 순위가 가장 많이 뒤집힌다
    { t: 'seesaw', x: 8.4, y: 128, hw: 4, hh: 0.28, maxAngle: 0.45, periodMs: 2800, style: 'seesaw' },
    { t: 'seesaw', x: 15.6, y: 134, hw: 4, hh: 0.28, maxAngle: 0.45, periodMs: 3200, phase: 0.5, style: 'seesaw' },
  ] satisfies DeviceDef[],
};
