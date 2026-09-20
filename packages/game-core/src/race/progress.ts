/**
 * 진행률.
 *
 * 순위는 «y 좌표» 로 매기지 않는다. 포털 맵에서는 아래로 갔다고 앞선 것이 아니고,
 * 코스가 되돌아오는 구간에서도 뒤집힌다. 대신 맵이 정해 둔 기준선(progressPath)
 * 위에서 얼마나 나아갔는지로 잰다.
 */

import { closestPointOnSegment, rectContains, type Vec2 } from '../math/vec2.ts';
import type { Checkpoint } from '../map/types.ts';

export interface PathHit {
  /** 어느 선분 위인가 */
  idx: number;
  /** 그 선분 안에서의 위치 0~1 */
  t: number;
  /** 출발점부터의 길이 */
  arc: number;
  /** 기준선과 얼마나 떨어져 있나 */
  dist: number;
}

export class ProgressPath {
  readonly pts: Vec2[];
  /** 꼭짓점 i 까지의 누적 길이 */
  readonly cum: number[];
  readonly segLen: number[];
  readonly total: number;

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    if (points.length < 2) throw new Error('progressPath 는 점이 두 개 이상이어야 합니다.');
    this.pts = points.map(([x, y]) => ({ x, y }));
    this.cum = [0];
    this.segLen = [];
    let acc = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i]!;
      const b = this.pts[i + 1]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      this.segLen.push(l);
      acc += l;
      this.cum.push(acc);
    }
    this.total = acc;
  }

  /**
   * 지금 있는 자리에서 가까운 기준선 위의 점.
   *
   * @param fromIdx 지난번에 있던 선분. 그 앞뒤로만 찾아 코스가 겹치는 곳에서 헷갈리지 않게 한다.
   * @param back  뒤로 몇 개 선분까지 볼지
   * @param ahead 앞으로 몇 개 선분까지 볼지
   */
  nearest(p: Vec2, fromIdx: number, back = 6, ahead = 40): PathHit {
    const lo = Math.max(0, fromIdx - back);
    const hi = Math.min(this.segLen.length - 1, fromIdx + ahead);
    return this.search(p, lo, hi);
  }

  /** 기준선 전체에서 찾는다(순간이동 직후처럼 기준점을 잃었을 때) */
  nearestGlobal(p: Vec2): PathHit {
    return this.search(p, 0, this.segLen.length - 1);
  }

  private search(p: Vec2, lo: number, hi: number): PathHit {
    let bestD = Infinity;
    let bestIdx = lo;
    let bestT = 0;
    for (let i = lo; i <= hi; i++) {
      const a = this.pts[i]!;
      const b = this.pts[i + 1]!;
      const { point, t } = closestPointOnSegment(p, a, b);
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
        bestT = t;
      }
    }
    return {
      idx: bestIdx,
      t: bestT,
      arc: this.cum[bestIdx]! + this.segLen[bestIdx]! * bestT,
      dist: Math.sqrt(bestD),
    };
  }
}

/**
 * 구간(checkpoint) 통과 검사.
 * 구간은 순서대로만 인정한다 — 되돌아가서 다시 밟아도 수가 늘지 않는다.
 */
export function advanceCheckpoint(checkpoints: readonly Checkpoint[], current: number, p: Vec2): number {
  const next = checkpoints[current];
  if (!next) return current;
  return rectContains(next.area, p) ? current + 1 : current;
}

/**
 * 순위를 매길 때 쓰는 값. 클수록 앞선다.
 *
 * 구간을 더 지난 쪽이 무조건 앞이고, 같은 구간 안에서는 기준선 위 거리로 가른다.
 * (기준선 거리만 쓰면 코스가 겹치는 곳에서 뒤바뀔 수 있어 구간을 먼저 본다.)
 */
export function progressScore(checkpointIndex: number, arc: number, pathTotal: number): number {
  return checkpointIndex * (pathTotal + 1000) + arc;
}
