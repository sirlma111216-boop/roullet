/**
 * 물리 세계.
 *
 * - 움직이는 것은 구슬(원)뿐이다. 장애물은 static(고정) 또는 kinematic(각본대로 움직임)이다.
 * - 고정 시간 간격으로 돌린다. 한 스텝을 여러 개의 substep 으로 쪼개 터널링을 막는다.
 * - 무작위는 전부 Rng 를 거친다 — Math.random() 을 부르지 않는다.
 */

import type { Rng } from '../math/rng.ts';
import { closestOnShape, shapeBoundingRadius, type Shape } from './shapes.ts';

/** 모든 구슬이 똑같이 갖는 물리 속성. 학생마다 다르게 하지 않는다. */
export const MARBLE_RADIUS = 0.25;
/**
 * 되튐.
 *
 * 원본은 구슬을 b2Body.CreateFixture(shape, density) 로 만든다 — 이 오버로드는 되튐이 0 이다.
 * 그래서 원본의 구슬은 회전 막대에 「튕기지」 않고 「밀린다」.
 * 처음에 0.12 로 두었더니 항아리 맵의 빠른 노 젓개(각속도 10)에 구슬이 계속 튀어 올라
 * 출구를 못 찾고 맴돌았다. 원본에 가깝게 낮춘다.
 */
export const MARBLE_RESTITUTION = 0.05;

/**
 * 마찰.
 *
 * 이 엔진의 구슬은 **회전하지 않는다**(각운동량을 풀지 않는다). 그래서 마찰을 실제 값만큼
 * 주면 «미끄러지는 상자» 처럼 굴어, 구르는 구슬이라면 내려갔을 완만한 경사에서 멈춰 선다.
 * 실제로 확장 맵 검사에서 12.6° 경사에 구슬이 서 버렸다.
 *
 * 그래서 마찰 계수를 낮게 잡아 «구르는 구슬» 에 가깝게 만든다.
 * 두 값을 곱해 제곱근을 취한 것이 실효 계수이고, 그 arctan 이 «구슬이 서는 최대 경사» 다.
 *   sqrt(0.04 × 0.18) ≈ 0.085 → 약 4.9°
 * 맵의 모든 경사로는 이 각보다 가파르게 둔다 — physics.test.ts 가 검사한다.
 */
export const MARBLE_FRICTION = 0.04;
/** 장애물의 기본 마찰. 컨베이어처럼 끌어야 하는 것만 따로 높인다. */
export const DEFAULT_COLLIDER_FRICTION = 0.18;

/** 구슬이 스스로 서 있을 수 있는 최대 경사(rad). 맵 검사가 이 값을 쓴다. */
export const MAX_RESTING_SLOPE = Math.atan(Math.sqrt(MARBLE_FRICTION * DEFAULT_COLLIDER_FRICTION));

/** 원본과 같은 중력 (y 는 아래로) */
export const GRAVITY_Y = 10;

/** 한 스텝을 몇 조각으로 쪼갤지. 구슬이 반지름보다 더 멀리 못 가게 하는 값. */
export const SUBSTEPS = 6;

/**
 * 속도 상한. 이 값 × (1/60/SUBSTEPS) 이 구슬 반지름보다 작아야 벽을 뚫지 않는다.
 * 55 × (1/360) = 0.153 < 0.25 이므로 안전하다.
 */
export const MAX_SPEED = 55;

/** 되튐이 1 을 넘는 바닥에서 한 번에 얻을 수 있는 최대 속도 */
export const BOUNCE_SPEED_CAP = 26;

export interface Marble {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * 이번 substep 이 시작될 때의 자리. 벽을 뚫었는지 되짚는 데 쓴다.
   * (이 자리는 언제나 «벽 안쪽» 임이 보장된다.)
   */
  px: number;
  py: number;
  /** 물리에 참여하는가. 결승한 구슬은 false 가 된다. */
  active: boolean;
}

export interface Collider {
  id: number;
  shape: Shape;
  /** 월드 위치 */
  x: number;
  y: number;
  angle: number;
  /** 각본대로 움직이는 물체의 속도(접촉 지점 속도 계산에 쓴다) */
  vx: number;
  vy: number;
  omega: number;
  restitution: number;
  friction: number;
  /** 표면이 흐르는 속도(컨베이어). 접선 방향으로 구슬을 끈다. */
  surfaceSpeed: number;
  /** 0 보다 크면 닿는 순간 사라진다(버블). -1 이면 안 사라진다. */
  life: number;
  active: boolean;
  /** 그림 담당이 쓰는 색·종류 힌트 */
  style: string;
  /** 이 콜라이더를 움직이는 장치의 번호. 없으면 -1. */
  deviceIndex: number;
  /** 브로드페이즈용 — 이 콜라이더가 움직여도 벗어나지 않는 반지름 */
  boundRadius: number;
  /** 움직이는 물체인가(각본이 매 스텝 위치를 바꾼다) */
  kinematic: boolean;
  /** kinematic 물체가 돌아다니는 범위(격자에 넣을 때 쓴다) */
  travelRadius: number;
}

export interface ColliderInit {
  shape: Shape;
  x: number;
  y: number;
  angle?: number;
  restitution?: number;
  friction?: number;
  surfaceSpeed?: number;
  life?: number;
  style?: string;
  deviceIndex?: number;
  kinematic?: boolean;
  travelRadius?: number;
}

/** 이번 스텝에 일어난 접촉 — 소리·불꽃 효과와 버블 터뜨리기에 쓴다 */
export interface ContactEvent {
  marbleIndex: number;
  colliderId: number;
  /** 부딪힌 세기(법선 방향 상대속도의 크기) */
  impact: number;
  x: number;
  y: number;
  style: string;
}

/**
 * 콜라이더가 차지하는 월드 사각형.
 *
 * 벽(segment)은 좌표를 shape 안에 절대값으로 들고 있고 콜라이더 위치는 (0,0) 이다.
 * 그래서 «원점 기준 반지름» 으로 잡으면 맵 전체를 덮는 거대한 원이 되어, 벽 하나가
 * 수천 칸에 들어간다(실제로 긴 맵의 계산이 몇 배로 느려졌다). 모양별로 제대로 잰다.
 */
function colliderAabb(c: Collider): { x0: number; y0: number; x1: number; y1: number } {
  const s = c.shape;
  if (s.kind === 'segment') {
    const cos = Math.cos(c.angle);
    const sin = Math.sin(c.angle);
    const ax = c.x + s.ax * cos - s.ay * sin;
    const ay = c.y + s.ax * sin + s.ay * cos;
    const bx = c.x + s.bx * cos - s.by * sin;
    const by = c.y + s.bx * sin + s.by * cos;
    return {
      x0: Math.min(ax, bx) - s.r,
      y0: Math.min(ay, by) - s.r,
      x1: Math.max(ax, bx) + s.r,
      y1: Math.max(ay, by) + s.r,
    };
  }
  // 원과 사각형은 회전해도 이 반지름 밖으로 못 나간다
  const reach = c.boundRadius + c.travelRadius;
  return { x0: c.x - reach, y0: c.y - reach, x1: c.x + reach, y1: c.y + reach };
}

/**
 * 고정 장애물을 미리 칸에 나눠 담아 둔다.
 * 움직이는 장애물도 「돌아다니는 범위」로 한 번만 넣으므로, 격자는 경기 내내 다시 만들지 않는다.
 */
class StaticGrid {
  readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly minX: number;
  private readonly minY: number;

  constructor(colliders: Collider[], cell: number, minX: number, minY: number, _maxX: number, _maxY: number) {
    this.cell = cell;
    this.minX = minX;
    this.minY = minY;
    for (const c of colliders) this.insert(c);
  }

  /**
   * 칸 좌표 → 열쇠.
   * 음수 칸도 서로 다른 값이 나오도록 두 좌표를 섞는다(예전 판은 행 수로 곱해
   * 음수 칸이 다른 행과 같은 열쇠가 되었다 — 틀린 결과는 아니었지만 쓸데없이 겹쳤다).
   */
  private key(cx: number, cy: number): number {
    return cx * 73856093 + cy * 19349663;
  }

  private insert(c: Collider): void {
    const b = colliderAabb(c);
    // 구슬 반지름만큼 넉넉히 — 칸 경계에 걸친 접촉을 놓치지 않게 한다
    const pad = MARBLE_RADIUS + 0.01;
    const x0 = Math.floor((b.x0 - pad - this.minX) / this.cell);
    const x1 = Math.floor((b.x1 + pad - this.minX) / this.cell);
    const y0 = Math.floor((b.y0 - pad - this.minY) / this.cell);
    const y1 = Math.floor((b.y1 + pad - this.minY) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this.key(cx, cy);
        let arr = this.cells.get(k);
        if (!arr) {
          arr = [];
          this.cells.set(k, arr);
        }
        arr.push(c.id);
      }
    }
  }

  /** p 가 든 칸의 후보 id 를 out 에 담는다 */
  query(px: number, py: number, out: number[]): void {
    out.length = 0;
    const cx = Math.floor((px - this.minX) / this.cell);
    const cy = Math.floor((py - this.minY) / this.cell);
    const arr = this.cells.get(this.key(cx, cy));
    if (arr) for (const id of arr) out.push(id);
  }

  /** 두 점이 지나간 칸들의 후보를 모은다(스윕 검사용) */
  queryPath(ax: number, ay: number, bx: number, by: number, out: number[]): void {
    out.length = 0;
    const x0 = Math.floor((Math.min(ax, bx) - this.minX) / this.cell);
    const x1 = Math.floor((Math.max(ax, bx) - this.minX) / this.cell);
    const y0 = Math.floor((Math.min(ay, by) - this.minY) / this.cell);
    const y1 = Math.floor((Math.max(ay, by) - this.minY) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) for (const id of arr) if (!out.includes(id)) out.push(id);
      }
    }
  }
}

export class World {
  readonly marbles: Marble[] = [];
  readonly colliders: Collider[] = [];
  /** 이번 스텝에 생긴 접촉 */
  readonly contacts: ContactEvent[] = [];
  /** 이번 스텝에 사라진 콜라이더 id (버블이 터진 것) */
  readonly popped: number[] = [];

  private grid: StaticGrid | null = null;
  private nextColliderId = 0;
  private readonly candidates: number[] = [];
  private readonly byId = new Map<number, Collider>();

  /** 구슬끼리 부딪히는지 보려고 매 substep 다시 만드는 해시 */
  private readonly marbleCells = new Map<number, number[]>();
  private readonly marbleCell = 1.0;

  readonly gravityY: number;

  constructor(gravityY = GRAVITY_Y) {
    this.gravityY = gravityY;
  }

  addCollider(init: ColliderInit): Collider {
    const c: Collider = {
      id: this.nextColliderId++,
      shape: init.shape,
      x: init.x,
      y: init.y,
      angle: init.angle ?? 0,
      vx: 0,
      vy: 0,
      omega: 0,
      restitution: init.restitution ?? 0.1,
      friction: init.friction ?? DEFAULT_COLLIDER_FRICTION,
      surfaceSpeed: init.surfaceSpeed ?? 0,
      life: init.life ?? -1,
      active: true,
      style: init.style ?? 'wall',
      deviceIndex: init.deviceIndex ?? -1,
      boundRadius: shapeBoundingRadius(init.shape),
      kinematic: init.kinematic ?? false,
      travelRadius: init.travelRadius ?? 0,
    };
    this.colliders.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  addMarble(x: number, y: number): Marble {
    const m: Marble = { index: this.marbles.length, x, y, px: x, py: y, vx: 0, vy: 0, active: true };
    this.marbles.push(m);
    return m;
  }

  /** 콜라이더를 다 넣은 뒤 한 번 부른다 */
  build(minX: number, minY: number, maxX: number, maxY: number): void {
    this.grid = new StaticGrid(this.colliders, 2.0, minX - 4, minY - 4, maxX + 4, maxY + 4);
  }

  getCollider(id: number): Collider | undefined {
    return this.byId.get(id);
  }

  /**
   * 한 스텝 나아간다.
   *
   * @param dt 스텝 길이(초). 고정값을 넘긴다.
   * @param pre  substep 이 시작되기 전 — 장치가 콜라이더를 옮기고 구역 효과를 주는 곳.
   *             substep 마다 부르는 이유는, 빠르게 도는 막대가 한 스텝 사이에
   *             구슬을 지나쳐 버리지 않게 하려는 것이다.
   * @param post substep 이 끝난 뒤 — 결승선 통과를 보간해 잡는 곳.
   */
  step(
    dt: number,
    pre?: (subIndex: number, h: number) => void,
    post?: (subIndex: number, h: number) => void,
  ): void {
    this.contacts.length = 0;
    this.popped.length = 0;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      pre?.(s, h);
      this.integrate(h);
      this.solveStatic(h);
      this.solveMarbles();
      this.guardWalls();
      post?.(s, h);
    }
  }

  private integrate(h: number): void {
    const g = this.gravityY * h;
    for (const m of this.marbles) {
      if (!m.active) continue;
      // 이 substep 이 시작될 때의 자리를 적어 둔다 — 벽을 넘었는지 되짚는 기준점이다
      m.px = m.x;
      m.py = m.y;
      m.vy += g;
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        m.vx *= k;
        m.vy *= k;
      }
      m.x += m.vx * h;
      m.y += m.vy * h;
    }
  }

  /** 구슬 vs 장애물 */
  private solveStatic(h: number): void {
    const grid = this.grid;
    if (!grid) return;
    for (const m of this.marbles) {
      if (!m.active) continue;
      grid.query(m.x, m.y, this.candidates);
      for (const id of this.candidates) {
        const c = this.byId.get(id);
        if (!c || !c.active) continue;
        this.resolveOne(m, c, h);
      }
    }
  }

  private resolveOne(m: Marble, c: Collider, _h: number): void {
    // 직전 자리를 함께 넘겨, 안에 들어왔을 때 「들어온 쪽」으로 되밀어내게 한다
    const r = closestOnShape(c.shape, m.x, m.y, c.x, c.y, c.angle, m.px, m.py);

    let nx: number;
    let ny: number;
    let penetration: number;

    if (r.inside) {
      nx = r.nx;
      ny = r.ny;
      penetration = r.depth + MARBLE_RADIUS;
    } else {
      const dx = m.x - r.cx;
      const dy = m.y - r.cy;
      const distSq = dx * dx + dy * dy;
      const reach = MARBLE_RADIUS + r.pad;
      if (distSq >= reach * reach) return;
      const dist = Math.sqrt(distSq);
      if (dist < 1e-9) {
        // 중심이 정확히 겹쳤다 — 위쪽으로 밀어낸다(결정적으로)
        nx = 0;
        ny = -1;
        penetration = reach;
      } else {
        nx = dx / dist;
        ny = dy / dist;
        penetration = reach - dist;
      }
    }

    // 접촉 지점이 움직이는 속도(회전하는 막대 위라면 0 이 아니다)
    const rx = r.cx - c.x;
    const ry = r.cy - c.y;
    let cpx = c.vx - c.omega * ry;
    let cpy = c.vy + c.omega * rx;

    // 컨베이어: 표면을 따라 흐르는 속도를 더한다(접선 = 법선을 90도 돌린 것)
    if (c.surfaceSpeed !== 0) {
      cpx += -ny * c.surfaceSpeed;
      cpy += nx * c.surfaceSpeed;
    }

    const rvx = m.vx - cpx;
    const rvy = m.vy - cpy;
    const vn = rvx * nx + rvy * ny;

    // 파고든 만큼 밀어낸다
    if (penetration > 0) {
      m.x += nx * penetration;
      m.y += ny * penetration;
    }

    if (vn < 0) {
      const e = Math.max(MARBLE_RESTITUTION, c.restitution);
      let j = -(1 + e) * vn;
      // 되튐이 1 을 넘는 바닥(탄성 발판·버블·범퍼)은 부딪힐 때마다 에너지를 «더해» 준다.
      // 튀어 나가는 속도에 상한을 두어, 몇 번 튕기다 끝없이 빨라지는 일을 막는다.
      if (e > 1 && j > BOUNCE_SPEED_CAP) j = BOUNCE_SPEED_CAP;
      m.vx += nx * j;
      m.vy += ny * j;

      // 마찰 — 접선 방향 상대속도를 줄인다
      const mu = Math.sqrt(MARBLE_FRICTION * c.friction);
      if (mu > 0) {
        const tx = -ny;
        const ty = nx;
        const vt = rvx * tx + rvy * ty;
        const maxJt = mu * j;
        let jt = -vt;
        if (jt > maxJt) jt = maxJt;
        else if (jt < -maxJt) jt = -maxJt;
        m.vx += tx * jt;
        m.vy += ty * jt;
      }

      if (-vn > 1.2) {
        this.contacts.push({
          marbleIndex: m.index,
          colliderId: c.id,
          impact: -vn,
          x: r.cx,
          y: r.cy,
          style: c.style,
        });
      }
    }

    // 닿으면 사라지는 장애물(버블)
    if (c.life > 0) {
      c.active = false;
      this.popped.push(c.id);
    }
  }

  /**
   * 벽 넘어감 막기 (스윕 검사).
   *
   * 왜 필요한가: 벽(segment)은 양면이다. 한 번이라도 반대편으로 넘어가면, 그 다음부터
   * 벽은 구슬을 «더 바깥으로» 밀어낸다 — 그대로 맵을 빠져나간다.
   * 실제로 항아리 맵에서 벽에 걸쳐 도는 막대와 벽 사이에 끼인 구슬이,
   * 한 substep 안에 (이동 + 막대가 밀어낸 거리 + 옆 구슬이 민 거리)를 합쳐
   * 벽을 건너뛰는 일이 일어났다.
   *
   * 그래서 이 substep 동안 지나온 선분이 벽을 가로질렀는지 보고, 가로질렀다면
   * 출발한 쪽으로 되돌려 놓는다. 출발 자리는 언제나 안쪽이므로 되돌릴 곳이 늘 있다.
   */
  private guardWalls(): void {
    const grid = this.grid;
    if (!grid) return;
    for (const m of this.marbles) {
      if (!m.active) continue;
      const dx = m.x - m.px;
      const dy = m.y - m.py;
      if (dx * dx + dy * dy < 1e-10) continue;

      grid.queryPath(m.px, m.py, m.x, m.y, this.candidates);

      let bestT = Infinity;
      let bestNx = 0;
      let bestNy = 0;
      let bestPad = 0;

      for (const id of this.candidates) {
        const c = this.byId.get(id);
        if (!c || !c.active || c.shape.kind !== 'segment') continue;
        const s = c.shape;
        const cos = Math.cos(c.angle);
        const sin = Math.sin(c.angle);
        const ax = c.x + s.ax * cos - s.ay * sin;
        const ay = c.y + s.ax * sin + s.ay * cos;
        const bx = c.x + s.bx * cos - s.by * sin;
        const by = c.y + s.bx * sin + s.by * cos;

        const ex = bx - ax;
        const ey = by - ay;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-12) continue; // 나란하다
        const t = ((ax - m.px) * ey - (ay - m.py) * ex) / denom;
        const u = ((ax - m.px) * dy - (ay - m.py) * dx) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        if (t < bestT) {
          bestT = t;
          // 법선은 출발한 쪽을 향하게 잡는다
          const nx = -ey;
          const ny = ex;
          const len = Math.hypot(nx, ny);
          const sign = (m.px - ax) * nx + (m.py - ay) * ny >= 0 ? 1 : -1;
          bestNx = (nx / len) * sign;
          bestNy = (ny / len) * sign;
          bestPad = s.r;
        }
      }

      if (bestT === Infinity) continue;

      // 넘어간 지점 바로 앞, 출발한 쪽으로 반지름만큼 띄워 놓는다
      const hitX = m.px + dx * bestT;
      const hitY = m.py + dy * bestT;
      const off = MARBLE_RADIUS + bestPad + 0.01;
      m.x = hitX + bestNx * off;
      m.y = hitY + bestNy * off;
      // 벽을 파고들던 속도 성분만 없앤다
      const vn = m.vx * bestNx + m.vy * bestNy;
      if (vn < 0) {
        m.vx -= bestNx * vn;
        m.vy -= bestNy * vn;
      }
    }
  }

  /** 구슬끼리 */
  private solveMarbles(): void {
    const cells = this.marbleCells;
    cells.clear();
    const cs = this.marbleCell;
    for (const m of this.marbles) {
      if (!m.active) continue;
      const k = (Math.floor(m.y / cs) << 16) ^ (Math.floor(m.x / cs) & 0xffff);
      let arr = cells.get(k);
      if (!arr) {
        arr = [];
        cells.set(k, arr);
      }
      arr.push(m.index);
    }

    const d = MARBLE_RADIUS * 2;
    const dSq = d * d;
    // 상대 구슬은 칸 하나에만 들어 있고 j > index 인 짝만 보므로,
    // 한 짝은 정확히 한 번만 걸린다. 따로 중복 검사를 둘 필요가 없다.
    for (const m of this.marbles) {
      if (!m.active) continue;
      const bx = Math.floor(m.x / cs);
      const by = Math.floor(m.y / cs);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const arr = cells.get(((by + oy) << 16) ^ ((bx + ox) & 0xffff));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= m.index) continue;
            const o = this.marbles[j]!;
            if (!o.active) continue;
            const dx = o.x - m.x;
            const dy = o.y - m.y;
            const l2 = dx * dx + dy * dy;
            if (l2 >= dSq || l2 < 1e-12) continue;
            const dist = Math.sqrt(l2);
            const nx = dx / dist;
            const ny = dy / dist;
            const pen = d - dist;

            // 질량이 같으므로 반씩 밀어낸다
            const half = pen * 0.5;
            m.x -= nx * half;
            m.y -= ny * half;
            o.x += nx * half;
            o.y += ny * half;

            const rvx = o.vx - m.vx;
            const rvy = o.vy - m.vy;
            const vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              const e = MARBLE_RESTITUTION;
              const jimp = (-(1 + e) * vn) / 2;
              m.vx -= nx * jimp;
              m.vy -= ny * jimp;
              o.vx += nx * jimp;
              o.vy += ny * jimp;
            }
          }
        }
      }
    }
  }

  /**
   * 한 구슬을 중심으로 주변 구슬을 밀어낸다(자동 충격 스킬).
   * 모두에게 같은 규칙으로만 쓴다.
   */
  impact(from: Marble, radius: number, power: number): void {
    const r2 = radius * radius;
    for (const o of this.marbles) {
      if (o === from || !o.active) continue;
      const dx = o.x - from.x;
      const dy = o.y - from.y;
      const l2 = dx * dx + dy * dy;
      if (l2 > r2 || l2 < 1e-9) continue;
      const dist = Math.sqrt(l2);
      const k = 1 - dist / radius;
      const f = k * k * power;
      o.vx += (dx / dist) * f;
      o.vy += (dy / dist) * f;
    }
  }

  /** 정체 탈출 보조 — 시드 난수로 흔든다 */
  nudge(m: Marble, rng: Rng, power: number): void {
    const a = rng.range(0, Math.PI * 2);
    m.vx += Math.cos(a) * power;
    m.vy += Math.sin(a) * power - power * 0.35; // 살짝 위로 들어 올린다
  }
}
