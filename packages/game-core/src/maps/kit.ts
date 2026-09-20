/**
 * 맵 조립 부품.
 *
 * 확장 맵 넷은 여기 있는 부품을 늘어놓아 만든다. 좌표를 손으로 베껴 쓰지 않으려는 것이고,
 * 부품 하나를 고치면 네 맵이 같이 고쳐지게 하려는 것이다.
 */

import type { BoxDef, Checkpoint, CircleDef, ObstacleDef, WallDef } from '../map/types.ts';
import type { Rect } from '../math/vec2.ts';

/** 확장 맵이 공통으로 쓰는 틀 */
export const FRAME = {
  /** 출발 통로의 좌우 */
  chuteLeft: 8.2,
  chuteRight: 15.8,
  /** 통로가 열려 코스 폭이 되는 지점 */
  openY: 8,
  openEndY: 16,
  /** 코스 좌우 벽 */
  left: 2,
  right: 22,
  /** 결승 관문의 좌우 */
  gateLeft: 11,
  gateRight: 13,
  /** 관문이 좁아지기 시작하는 높이(바닥에서 위로) */
  gateRise: 16,
  /** 맵 위쪽 여유 — 100명이 들어와도 구슬이 이 위로 가지 않는다 */
  top: -20,
} as const;

/** 위 통로 → 넓은 코스 → 아래 관문으로 이어지는 좌우 벽 한 쌍 */
export function courseWalls(finishY: number): WallDef[] {
  const f = FRAME;
  const gateTopY = finishY - f.gateRise;
  const gateBottomY = finishY - 4;
  return [
    {
      t: 'wall',
      style: 'wall',
      points: [
        [f.chuteLeft, f.top],
        [f.chuteLeft, f.openY],
        [f.left, f.openEndY],
        [f.left, gateTopY],
        [f.gateLeft, gateBottomY],
        [f.gateLeft, finishY + 3],
      ],
    },
    {
      t: 'wall',
      style: 'wall',
      points: [
        [f.chuteRight, f.top],
        [f.chuteRight, f.openY],
        [f.right, f.openEndY],
        [f.right, gateTopY],
        [f.gateRight, gateBottomY],
        [f.gateRight, finishY + 3],
      ],
    },
  ];
}

/** 확장 맵의 기본 진행 기준선 — 가운데를 곧게 내려간다 */
export function centerPath(finishY: number, step = 6): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = FRAME.top + 12; y < finishY + 2; y += step) out.push([12, y]);
  out.push([12, finishY + 2]);
  return out;
}

/** 코스를 가로지르는 구간 띠 */
export function band(id: string, name: string, y: number): Checkpoint {
  return { id, name, area: { x: 0, y, w: 24, h: 2 } };
}

export interface PinGridOptions {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** 가로 간격 */
  dx: number;
  /** 세로 간격 */
  dy: number;
  r?: number;
  /** 한 줄 걸러 반 칸씩 밀어 지그재그로 만든다 */
  stagger?: boolean;
  style?: string;
  restitution?: number;
}

/** 낙하 핀 구간 */
export function pinGrid(o: PinGridOptions): CircleDef[] {
  const out: CircleDef[] = [];
  const r = o.r ?? 0.28;
  let row = 0;
  for (let y = o.y0; y <= o.y1 + 1e-6; y += o.dy) {
    const off = o.stagger !== false && row % 2 === 1 ? o.dx / 2 : 0;
    for (let x = o.x0 + off; x <= o.x1 + 1e-6; x += o.dx) {
      out.push({
        t: 'circle',
        x: round(x),
        y: round(y),
        r,
        style: o.style ?? 'pin',
        restitution: o.restitution ?? 0.35,
      });
    }
    row++;
  }
  return out;
}

/**
 * 가운데를 나누는 칸막이.
 *
 * **속이 찬 사각형**으로 만든다. 선으로 두른 빈 껍데기로 만들었더니, 뾰족한 꼭대기의
 * 이음매로 구슬이 한 개씩 안으로 새어 들어가 바닥에 갇혔다(mix-wind 검사에서 잡았다).
 * 속이 차 있으면 안으로 들어가도 가장 가까운 면으로 밀려 나온다.
 *
 * 꼭대기는 ∧ 모양으로 덮는다 — 평평하면 구슬이 그 위에 얹혀 오래 버틴다.
 */
export function divider(x: number, yTop: number, yBottom: number, halfWidth = 0.45): ObstacleDef[] {
  const shoulder = yTop + halfWidth * 2.2;
  const slope = Math.atan2(shoulder - yTop, halfWidth);
  const capLen = Math.hypot(halfWidth, shoulder - yTop) / 2;
  return [
    // 기둥
    {
      t: 'box',
      x,
      y: round((shoulder + yBottom) / 2),
      hw: halfWidth,
      hh: round((yBottom - shoulder) / 2),
      style: 'divider',
      restitution: 0.05,
    },
    // ∧ 지붕 두 장
    {
      t: 'box',
      x: round(x - halfWidth / 2),
      y: round((yTop + shoulder) / 2),
      hw: round(capLen),
      hh: 0.16,
      angle: round(-slope),
      style: 'divider',
      restitution: 0.05,
    },
    {
      t: 'box',
      x: round(x + halfWidth / 2),
      y: round((yTop + shoulder) / 2),
      hw: round(capLen),
      hh: 0.16,
      angle: round(slope),
      style: 'divider',
      restitution: 0.05,
    },
  ];
}

/**
 * ∧ 모양 지붕.
 *
 * 평평한 판(angle 0)은 구슬을 세워 둔다 — 회전을 풀지 않는 이 엔진에서는 영영 안 내려온다.
 * 가운데를 막고 싶을 때는 반드시 이 부품을 쓴다.
 */
export function peak(x: number, y: number, halfWidth: number, slope = 0.3, style = 'roof'): BoxDef[] {
  const half = halfWidth / 2;
  const rise = Math.tan(slope) * half;
  return [
    {
      t: 'box',
      x: round(x - half),
      y: round(y + rise / 2),
      hw: round(Math.hypot(half, rise)),
      hh: 0.24,
      angle: round(-slope),
      style,
      restitution: 0.08,
    },
    {
      t: 'box',
      x: round(x + half),
      y: round(y + rise / 2),
      hw: round(Math.hypot(half, rise)),
      hh: 0.24,
      angle: round(slope),
      style,
      restitution: 0.08,
    },
  ];
}

/**
 * 구멍이 뚫린 바닥.
 * 구멍마다 개폐문을 달 수 있도록, 남는 부분을 사각 장애물로 돌려준다.
 *
 * 각 조각은 **가장 가까운 구멍 쪽으로 기울여** 둔다. 평평하게 두면 구슬이 그 위에 서서
 * 안 내려온다(이 엔진의 구슬은 구르지 않는다 — MAX_RESTING_SLOPE 설명을 보라).
 * 양쪽이 다 구멍인 가운데 조각은 ∧ 로 만든다.
 */
export function floorWithGaps(
  y: number,
  gaps: Array<[number, number]>,
  opts: { left?: number; right?: number; thickness?: number; style?: string; slope?: number } = {},
): BoxDef[] {
  const left = opts.left ?? FRAME.left;
  const right = opts.right ?? FRAME.right;
  const hh = (opts.thickness ?? 0.6) / 2;
  const slope = opts.slope ?? 0.16;
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);

  // 구멍 사이·양 끝의 «남는 구간» 을 먼저 모은다
  const spans: Array<{ x0: number; x1: number; gapLeft: boolean; gapRight: boolean }> = [];
  let cursor = left;
  for (const [g0, g1] of sorted) {
    if (g0 > cursor) spans.push({ x0: cursor, x1: g0, gapLeft: cursor !== left, gapRight: true });
    cursor = Math.max(cursor, g1);
  }
  if (cursor < right) spans.push({ x0: cursor, x1: right, gapLeft: cursor !== left, gapRight: false });

  const out: BoxDef[] = [];
  for (const sp of spans) {
    if (sp.gapLeft && sp.gapRight) {
      out.push(...peak((sp.x0 + sp.x1) / 2, y, sp.x1 - sp.x0, slope, opts.style ?? 'floor'));
    } else {
      // 구멍이 있는 쪽으로 내려가게 기울인다 (+각 = 오른쪽이 아래)
      out.push(slab(sp.x0, sp.x1, y, hh, sp.gapRight ? slope : -slope, opts.style));
    }
  }
  return out;
}

function slab(x0: number, x1: number, y: number, hh: number, angle: number, style?: string): BoxDef {
  return {
    t: 'box',
    x: round((x0 + x1) / 2),
    y,
    hw: round((x1 - x0) / 2),
    hh,
    angle: round(angle),
    style: style ?? 'floor',
    restitution: 0.05,
  };
}

/** 비스듬한 경사로 */
export function ramp(
  x: number,
  y: number,
  halfLength: number,
  angle: number,
  style = 'ramp',
  thickness = 0.28,
): BoxDef {
  return { t: 'box', x, y, hw: halfLength, hh: thickness, angle, style, restitution: 0.08 };
}

/** 구역 사각형을 짧게 적는다 */
export function area(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function collect(...groups: Array<ObstacleDef[] | ObstacleDef>): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  for (const g of groups) {
    if (Array.isArray(g)) out.push(...g);
    else out.push(g);
  }
  return out;
}
