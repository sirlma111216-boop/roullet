/**
 * 충돌 모양과 「가장 가까운 점」 계산.
 *
 * 움직이는 물체는 구슬(원)뿐이므로, 모든 충돌은
 * **원 vs (원·선분·회전 사각형)** 한 가지 꼴로 줄어든다.
 * 각 모양은 «구슬 중심에서 가장 가까운 점 + 그 모양의 두께» 만 내놓으면 된다.
 */

import { closestPointOnSegment } from '../math/vec2.ts';

export interface CircleShape {
  kind: 'circle';
  r: number;
}

/** 두께가 있는 선분. 벽(두께 0)과 굵은 막대를 모두 표현한다. */
export interface SegmentShape {
  kind: 'segment';
  /** 콜라이더 기준 좌표 */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

/** 회전하는 직사각형. hw·hh 는 절반 길이(원본 Box2D SetAsBox 와 같은 뜻). */
export interface ObbShape {
  kind: 'obb';
  hw: number;
  hh: number;
}

export type Shape = CircleShape | SegmentShape | ObbShape;

export interface ClosestResult {
  /** 월드 좌표에서 구슬 중심에 가장 가까운 점 */
  cx: number;
  cy: number;
  /** 그 모양이 가진 두께 — 실제 접촉 거리는 구슬 반지름 + 이 값 */
  pad: number;
  /**
   * 구슬 중심이 모양 안에 들어와 있는가.
   * 그렇다면 cx,cy 로는 방향을 못 구하므로 nx,ny 를 따로 쓴다.
   */
  inside: boolean;
  nx: number;
  ny: number;
  /** inside 일 때의 파고든 깊이(구슬 반지름을 더하기 전) */
  depth: number;
}

const OUT: ClosestResult = { cx: 0, cy: 0, pad: 0, inside: false, nx: 0, ny: 0, depth: 0 };

/**
 * 모양 위에서 점 p 에 가장 가까운 곳을 찾는다.
 *
 * 돌려주는 객체는 **매번 같은 것을 다시 쓴다** — 뜨거운 반복문에서 쓰레기를 만들지 않으려는 것이다.
 *
 * @param fromX,fromY 직전 자리(있으면). 점이 사각형 **안에** 들어와 있을 때,
 *   「가장 얕은 면」이 아니라 「들어온 쪽 면」으로 밀어내는 데 쓴다.
 *   두꺼운 벽(네온 장거리 맵의 좌우 벽은 두께 2)에서 가장 얕은 면이 바깥쪽이 되면
 *   구슬을 맵 밖으로 밀어내 버린다 — 실제로 그렇게 한 개가 샜다.
 */
export function closestOnShape(
  shape: Shape,
  px: number,
  py: number,
  ox: number,
  oy: number,
  angle: number,
  fromX?: number,
  fromY?: number,
): ClosestResult {
  switch (shape.kind) {
    case 'circle': {
      OUT.cx = ox;
      OUT.cy = oy;
      OUT.pad = shape.r;
      OUT.inside = false;
      OUT.depth = 0;
      return OUT;
    }
    case 'segment': {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const ax = ox + shape.ax * c - shape.ay * s;
      const ay = oy + shape.ax * s + shape.ay * c;
      const bx = ox + shape.bx * c - shape.by * s;
      const by = oy + shape.bx * s + shape.by * c;
      const r = closestPointOnSegment({ x: px, y: py }, { x: ax, y: ay }, { x: bx, y: by });
      OUT.cx = r.point.x;
      OUT.cy = r.point.y;
      OUT.pad = shape.r;
      OUT.inside = false;
      OUT.depth = 0;
      return OUT;
    }
    case 'obb': {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // 점을 사각형의 제 좌표계로 옮긴다
      const dx = px - ox;
      const dy = py - oy;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const { hw, hh } = shape;

      if (lx > -hw && lx < hw && ly > -hh && ly < hh) {
        // 중심이 안에 들어왔다 — 「들어온 쪽」 면으로 되밀어낸다.
        const px2 = hw - Math.abs(lx);
        const py2 = hh - Math.abs(ly);
        let nlx: number;
        let nly: number;
        let depth: number;

        // 직전 자리가 밖이었다면, 그쪽이 나가야 할 방향이다.
        // 축(가로/세로)뿐 아니라 «어느 면인지»(부호)까지 직전 자리에서 가져온다 —
        // 이미 반대편으로 지나쳤을 때 먼 쪽 면으로 밀려 나가는 것을 막는다.
        let preferX: boolean | null = null;
        let signX = 0;
        let signY = 0;
        if (fromX !== undefined && fromY !== undefined) {
          const fdx = fromX - ox;
          const fdy = fromY - oy;
          const flx = fdx * c + fdy * s;
          const fly = -fdx * s + fdy * c;
          const outX = Math.abs(flx) >= hw;
          const outY = Math.abs(fly) >= hh;
          if (outX && !outY) preferX = true;
          else if (outY && !outX) preferX = false;
          else if (outX && outY) preferX = Math.abs(flx) - hw > Math.abs(fly) - hh;
          if (outX) signX = flx >= 0 ? 1 : -1;
          if (outY) signY = fly >= 0 ? 1 : -1;
        }
        const useX = preferX ?? px2 < py2;

        if (useX) {
          nlx = signX !== 0 ? signX : lx >= 0 ? 1 : -1;
          nly = 0;
          depth = hw - nlx * lx;
          OUT.cx = ox + nlx * hw * c - ly * s;
          OUT.cy = oy + nlx * hw * s + ly * c;
        } else {
          nlx = 0;
          nly = signY !== 0 ? signY : ly >= 0 ? 1 : -1;
          depth = hh - nly * ly;
          OUT.cx = ox + lx * c - nly * hh * s;
          OUT.cy = oy + lx * s + nly * hh * c;
        }
        OUT.nx = nlx * c - nly * s;
        OUT.ny = nlx * s + nly * c;
        OUT.pad = 0;
        OUT.inside = true;
        OUT.depth = depth;
        return OUT;
      }

      const qx = lx < -hw ? -hw : lx > hw ? hw : lx;
      const qy = ly < -hh ? -hh : ly > hh ? hh : ly;
      OUT.cx = ox + qx * c - qy * s;
      OUT.cy = oy + qx * s + qy * c;
      OUT.pad = 0;
      OUT.inside = false;
      OUT.depth = 0;
      return OUT;
    }
  }
}

/** 콜라이더가 어디까지 움직여도 이 원 밖으로는 안 나간다는 보수적인 반지름 */
export function shapeBoundingRadius(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return shape.r;
    case 'segment': {
      const la = Math.hypot(shape.ax, shape.ay);
      const lb = Math.hypot(shape.bx, shape.by);
      return Math.max(la, lb) + shape.r;
    }
    case 'obb':
      return Math.hypot(shape.hw, shape.hh);
  }
}
