/**
 * 자석 공장 (mix-magnet)
 *
 * 일정 주기로 켜지는 자력 구역 + 컨베이어 + 주기 개폐문 + 반발 범퍼.
 *
 * 고착 방지:
 *  - 자석은 한 구슬을 MAGNET_MAX_HOLD_MS 넘게 붙잡지 못한다(devices/index.ts).
 *  - 개폐문은 둘을 반대 위상으로 두어 한쪽이 열려 있는 시간이 대부분이다.
 *  - 컨베이어는 끝이 열려 있어 표면 속도가 구슬을 반드시 밖으로 내보낸다.
 */

import type { DeviceDef, MapDefinition } from '../map/types.ts';
import { band, centerPath, collect, courseWalls, floorWithGaps, FRAME, peak, pinGrid, ramp } from './kit.ts';

const FINISH_Y = 135;

/**
 * 개폐문 주기.
 *
 * 닫힘 1200 + 열림 1800 = 한 주기 3000ms 이고, 둘이 정확히 반 주기(1500ms) 어긋나 있다.
 * 그래서 「둘 다 닫혀 있는 순간」이 없다 — 어느 때나 한쪽 구멍은 열려 있다.
 *   왼쪽 닫힘 [0, 1200)   ·   오른쪽 닫힘 [1500, 2700)
 * 앞선 판(닫힘 2400, 열림 2000)에서는 둘 다 닫히는 짧은 구간이 있었고, 빠르게 튕겨 다니던 구슬
 * 하나가 두 구멍을 번갈아 놓치며 제한시간을 넘겼다. 값을 바꿀 때 겹침을 다시 따져라
 * (maps.test.ts 가 검사한다).
 */
const GATE = { closedMs: 1200, openMs: 1800 };

/**
 * 문이 열렸을 때 숨는 자리.
 *
 * 옆으로만 밀어 넣었더니, 물러난 문이 기울어진 바닥 판을 뚫고 올라와 턱이 되었다 —
 * 구멍으로 굴러가던 구슬이 거기 걸려 바닥 위를 오래 오갔다.
 * 그래서 바깥쪽으로 밀면서 **아래로도** 내려 바닥 밑에 완전히 감춘다.
 * (구멍 바로 밑이 아니므로 떨어지는 구슬과도 겹치지 않는다.)
 */
const GATE_TUCK_Y = 1.6;

/** 왼쪽·오른쪽 구멍 위치. 빠르게 지나가는 구슬도 빠지도록 넉넉히 둔다. */
const GAP_LEFT: [number, number] = [6.5, 10.5];
const GAP_RIGHT: [number, number] = [14.5, 18.5];

export const mixMagnet: MapDefinition = {
  id: 'mix-magnet',
  version: 1,
  name: '자석 공장',
  category: 'extended',
  description:
    '컨베이어가 구슬을 지그재그로 실어 나른다. 자력 구역은 주기적으로 켜져 구슬을 끌어당기고, 아래 개폐문은 번갈아 열린다.',
  highlights: ['주기 자력 구역', '지그재그 컨베이어', '주기 개폐문', '반발 범퍼'],

  bounds: { x: 0, y: FRAME.top, w: 24, h: FINISH_Y - FRAME.top + 8 },
  preview: { x: 0, y: -10, w: 24, h: FINISH_Y + 14 },
  spawn: { area: { x: 8.55, y: -8, w: 6.9, h: 10 }, perRow: 10, gap: 0.62 },

  finish: { area: { x: 0, y: FINISH_Y, w: 24, h: 5 } },
  checkpoints: [
    band('cp1', '낙하 핀', 22),
    band('cp2', '컨베이어', 40),
    band('cp3', '자력 구역', 62),
    band('cp4', '개폐문', 86),
    band('cp5', '범퍼 구간', 104),
    band('cp6', '결승 관문', 124),
  ],
  progressPath: centerPath(FINISH_Y),
  estimatedDurationSec: [18, 91],
  timeLimitSec: 170,

  obstacles: collect(
    courseWalls(FINISH_Y),

    pinGrid({ x0: 3.4, x1: 20.6, y0: 19, y1: 27, dx: 1.9, dy: 3.4, r: 0.3 }),

    // 컨베이어 아래를 받치는 턱 — 구슬이 벨트 뒤로 새지 않게 한다
    ramp(3.2, 31, 1.4, 0.5),
    ramp(20.8, 41, 1.4, -0.5),
    ramp(3.2, 51, 1.4, 0.5),

    // 자력 구역 사이의 통로 지붕
    peak(12, 58, 3.6),

    // 개폐문이 달릴 바닥 — 구멍 두 개를 남긴다
    floorWithGaps(90, [GAP_LEFT, GAP_RIGHT], { thickness: 0.6, slope: 0.22 }),

    // 범퍼 구간으로 떨어뜨리는 팔
    ramp(5.4, 98, 2.8, 0.3),
    ramp(18.6, 98, 2.8, -0.3),

    // 결승 앞 정리
    ramp(6.8, 120, 3.2, 0.3),
    ramp(17.2, 120, 3.2, -0.3),
  ),

  devices: [
    // 지그재그 컨베이어 — 기운 방향과 표면 속도가 같은 쪽이다
    { t: 'conveyor', x: 9, y: 34, hw: 6, hh: 0.32, angle: 0.13, speed: 6.5, style: 'belt' },
    { t: 'conveyor', x: 15, y: 44, hw: 6, hh: 0.32, angle: -0.13, speed: -6.5, style: 'belt' },
    { t: 'conveyor', x: 9, y: 54, hw: 6, hh: 0.32, angle: 0.13, speed: 6.5, style: 'belt' },

    // 자력 구역 — 가운데 기둥은 실제로 부딪힌다
    {
      t: 'magnet',
      x: 6.8,
      y: 66,
      r: 6,
      coreRadius: 1.1,
      strength: 20,
      onMs: 1400,
      offMs: 1400,
      phase: 0,
      style: 'magnet',
    },
    {
      t: 'magnet',
      x: 17.2,
      y: 74,
      r: 6,
      coreRadius: 1.1,
      strength: 20,
      onMs: 1400,
      offMs: 1400,
      phase: 0.5,
      style: 'magnet',
    },

    // 개폐문 — 열리면 옆 바닥 속으로 미끄러져 들어간다
    {
      t: 'gate',
      x: (GAP_LEFT[0] + GAP_LEFT[1]) / 2,
      y: 90,
      hw: (GAP_LEFT[1] - GAP_LEFT[0]) / 2,
      hh: 0.28,
      slideX: -(GAP_LEFT[1] - GAP_LEFT[0]) - 0.5,
      slideY: GATE_TUCK_Y,
      ...GATE,
      phase: 0,
      style: 'gate',
    },
    {
      t: 'gate',
      x: (GAP_RIGHT[0] + GAP_RIGHT[1]) / 2,
      y: 90,
      hw: (GAP_RIGHT[1] - GAP_RIGHT[0]) / 2,
      hh: 0.28,
      slideX: GAP_RIGHT[1] - GAP_RIGHT[0] + 0.5,
      slideY: GATE_TUCK_Y,
      ...GATE,
      phase: 0.5,
      style: 'gate',
    },

    // 반발 범퍼
    { t: 'bumper', x: 8, y: 104, r: 1.1, restitution: 1.35, style: 'bumper' },
    { t: 'bumper', x: 16, y: 104, r: 1.1, restitution: 1.35, style: 'bumper' },
    { t: 'bumper', x: 12, y: 110, r: 1.3, restitution: 1.4, style: 'bumper' },
    { t: 'bumper', x: 5.5, y: 112, r: 0.9, restitution: 1.5, style: 'bumper' },
    { t: 'bumper', x: 18.5, y: 112, r: 0.9, restitution: 1.5, style: 'bumper' },

    { t: 'spinner', x: 12, y: 126, hw: 3, hh: 0.24, omega: -2.8, style: 'bar' },
  ] satisfies DeviceDef[],
};
