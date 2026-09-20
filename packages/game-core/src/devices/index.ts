/**
 * 장치 — 맵 데이터를 실제로 «힘·충돌·이동·경로» 로 바꾸는 곳.
 *
 * 장식이 아니다. 모든 장치는 콜라이더를 움직이거나 구슬에 힘을 준다.
 * 맵마다 코드를 복제하지 않도록 여기 한 벌만 둔다.
 */

import { rectContains, type Rect } from '../math/vec2.ts';
import type { DeviceDef } from '../map/types.ts';
import type { Collider, Marble, World } from '../physics/world.ts';

/** 장치가 만지는 구슬 — 경기 엔진이 쓰는 추가 정보를 함께 들고 있다 */
export interface DeviceMarble extends Marble {
  /** 포털에서 나온 뒤 다시 못 들어가는 남은 시간(ms) */
  portalCooldownMs: number;
  /** 이번 라운드에 포털을 탄 횟수 */
  teleports: number;
  /** 순간이동해서 진행률 기준점을 다시 찾아야 하는가 */
  pathDirty: boolean;
  /** 자석 구역에 붙잡혀 있던 시간(ms). 너무 길면 자석이 이 구슬을 놓아 준다. */
  magnetHoldMs: number;
}

/**
 * 한 구슬이 한 라운드에 포털을 탈 수 있는 최대 횟수.
 * 이 수를 넘으면 그 구슬에게 포털은 그냥 바닥이 된다 — 무한 왕복을 막는 마지막 빗장이다.
 */
export const MAX_TELEPORTS_PER_MARBLE = 12;

/**
 * 자석이 한 구슬을 붙잡아 둘 수 있는 최대 시간(ms).
 * 넘으면 그 구슬에 대한 자력을 끄고, 구역을 벗어나면 다시 센다.
 */
export const MAGNET_MAX_HOLD_MS = 1800;

export interface RuntimeDevice {
  readonly def: DeviceDef;
  readonly index: number;
  readonly colliderIds: number[];
  /** 각본대로 콜라이더를 옮긴다 */
  update(tMs: number, dtSec: number, world: World): void;
  /** 구역 효과 — 구슬마다 불린다 */
  affect?(m: DeviceMarble, dtSec: number, world: World): void;
  /** 이 장치의 콜라이더에 무언가 부딪혔다 */
  onContact?(impact: number): void;
  /** 네트워크 프레임에 실을 상태 스칼라 하나 */
  state(): number;
}

/* ------------------------------------------------------------------ 공통 도우미 */

/** 켜짐/꺼짐이 되풀이되는 주기에서 지금 켜져 있는지와, 남은 시간의 비율 */
function dutyCycle(tMs: number, onMs: number, offMs: number, phase: number): { on: boolean; t: number } {
  const period = onMs + offMs;
  if (period <= 0) return { on: true, t: 1 };
  const p = (((tMs + phase) % period) + period) % period;
  return p < onMs ? { on: true, t: p / Math.max(1, onMs) } : { on: false, t: (p - onMs) / Math.max(1, offMs) };
}

abstract class BaseDevice implements RuntimeDevice {
  readonly colliderIds: number[] = [];
  readonly def: DeviceDef;
  readonly index: number;
  protected flash = 0;

  constructor(def: DeviceDef, index: number) {
    this.def = def;
    this.index = index;
  }

  abstract update(tMs: number, dtSec: number, world: World): void;

  onContact(impact: number): void {
    this.flash = Math.min(1, this.flash + impact * 0.15);
  }

  protected decayFlash(dtSec: number): void {
    this.flash = Math.max(0, this.flash - dtSec * 3);
  }

  abstract state(): number;
}

/* ------------------------------------------------------------------ 회전 막대 */

class SpinnerDevice extends BaseDevice {
  private angle: number;
  private readonly omega: number;
  private readonly bodies: Collider[] = [];

  constructor(def: Extract<DeviceDef, { t: 'spinner' }>, index: number, world: World) {
    super(def, index);
    this.angle = def.angle ?? 0;
    this.omega = def.omega;
    const c = world.addCollider({
      shape: { kind: 'obb', hw: def.hw, hh: def.hh },
      x: def.x,
      y: def.y,
      angle: this.angle,
      style: def.style ?? 'spinner',
      // 원본의 회전 막대는 되튐이 0 이다 — 구슬을 튕기지 않고 밀어낸다
      restitution: 0.05,
      friction: 0.35,
      deviceIndex: index,
      kinematic: true,
      travelRadius: 0,
    });
    this.bodies.push(c);
    this.colliderIds.push(c.id);
  }

  override update(_tMs: number, dtSec: number): void {
    this.angle += this.omega * dtSec;
    for (const b of this.bodies) {
      b.angle = this.angle;
      b.omega = this.omega;
    }
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.angle;
  }
}

/* ------------------------------------------------------------------ 풍차 */

class WindmillDevice extends BaseDevice {
  private angle: number;
  private readonly omega: number;
  private readonly bodies: Collider[] = [];
  private readonly offsets: number[] = [];

  constructor(def: Extract<DeviceDef, { t: 'windmill' }>, index: number, world: World) {
    super(def, index);
    this.angle = def.angle ?? 0;
    this.omega = def.omega;
    for (let i = 0; i < def.arms; i++) {
      const off = (Math.PI * 2 * i) / def.arms;
      this.offsets.push(off);
      const c = world.addCollider({
        shape: { kind: 'obb', hw: def.hw, hh: def.hh },
        x: def.x,
        y: def.y,
        angle: this.angle + off,
        style: def.style ?? 'windmill',
        restitution: 0.1,
        friction: 0.3,
        deviceIndex: index,
        kinematic: true,
      });
      this.bodies.push(c);
      this.colliderIds.push(c.id);
    }
  }

  override update(_tMs: number, dtSec: number): void {
    this.angle += this.omega * dtSec;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      b.angle = this.angle + this.offsets[i]!;
      b.omega = this.omega;
    }
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.angle;
  }
}

/* ------------------------------------------------------------------ 시소 */

class SeesawDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'seesaw' }>;
  private angle = 0;
  private readonly body: Collider;

  constructor(
    d: Extract<DeviceDef, { t: 'seesaw' }>,
    index: number,
    world: World,
  ) {
    super(d, index);
    this.d = d;
    this.body = world.addCollider({
      shape: { kind: 'obb', hw: d.hw, hh: d.hh },
      x: d.x,
      y: d.y,
      angle: 0,
      style: d.style ?? 'seesaw',
      restitution: 0.1,
      friction: 0.4,
      deviceIndex: index,
      kinematic: true,
    });
    this.colliderIds.push(this.body.id);
  }

  override update(tMs: number, dtSec: number): void {
    const phase = (this.d.phase ?? 0) * this.d.periodMs;
    const w = (Math.PI * 2) / Math.max(1, this.d.periodMs);
    const next = Math.sin((tMs + phase) * w) * this.d.maxAngle;
    // 각속도는 접촉 지점 속도에 쓰이므로 실제 변화량에서 구한다
    this.body.omega = dtSec > 0 ? (next - this.angle) / dtSec : 0;
    this.angle = next;
    this.body.angle = next;
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.angle;
  }
}

/* ------------------------------------------------------------------ 주기 개폐문 */

class GateDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'gate' }>;
  private openRatio = 0;
  private readonly body: Collider;

  constructor(
    d: Extract<DeviceDef, { t: 'gate' }>,
    index: number,
    world: World,
  ) {
    super(d, index);
    this.d = d;
    this.body = world.addCollider({
      shape: { kind: 'obb', hw: d.hw, hh: d.hh },
      x: d.x,
      y: d.y,
      angle: d.angle ?? 0,
      style: d.style ?? 'gate',
      restitution: 0.05,
      friction: 0.35,
      deviceIndex: index,
      kinematic: true,
      travelRadius: Math.hypot(d.slideX, d.slideY),
    });
    this.colliderIds.push(this.body.id);
  }

  override update(tMs: number, dtSec: number): void {
    const { on, t } = dutyCycle(tMs, this.d.closedMs, this.d.openMs, (this.d.phase ?? 0) * (this.d.closedMs + this.d.openMs));
    // on = 닫혀 있는 구간. 열고 닫는 동안은 부드럽게 미끄러진다.
    const EASE = 0.25;
    let target: number;
    if (on) target = t < EASE ? 1 - t / EASE : 0;
    else target = t < EASE ? t / EASE : 1;
    const prev = this.openRatio;
    this.openRatio = target;
    const nx = this.d.x + this.d.slideX * target;
    const ny = this.d.y + this.d.slideY * target;
    if (dtSec > 0) {
      this.body.vx = (nx - this.body.x) / dtSec;
      this.body.vy = (ny - this.body.y) / dtSec;
    }
    this.body.x = nx;
    this.body.y = ny;
    void prev;
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.openRatio;
  }
}

/* ------------------------------------------------------------------ 컨베이어 */

class ConveyorDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'conveyor' }>;
  private phase = 0;

  constructor(
    d: Extract<DeviceDef, { t: 'conveyor' }>,
    index: number,
    world: World,
  ) {
    super(d, index);
    this.d = d;
    const c = world.addCollider({
      shape: { kind: 'obb', hw: d.hw, hh: d.hh },
      x: d.x,
      y: d.y,
      angle: d.angle ?? 0,
      style: d.style ?? 'conveyor',
      restitution: 0.02,
      // 표면 속도가 구슬을 끌려면 마찰이 높아야 한다
      friction: 0.95,
      surfaceSpeed: d.speed,
      deviceIndex: index,
    });
    this.colliderIds.push(c.id);
  }

  override update(_tMs: number, dtSec: number): void {
    this.phase = (this.phase + this.d.speed * dtSec) % 1000;
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.phase;
  }
}

/* ------------------------------------------------------------------ 범퍼 / 탄성 발판 */

class BumperDevice extends BaseDevice {
  constructor(d: Extract<DeviceDef, { t: 'bumper' }>, index: number, world: World) {
    super(d, index);
    const c = world.addCollider({
      shape: { kind: 'circle', r: d.r },
      x: d.x,
      y: d.y,
      style: d.style ?? 'bumper',
      restitution: d.restitution,
      friction: 0.1,
      deviceIndex: index,
    });
    this.colliderIds.push(c.id);
  }

  override update(_tMs: number, dtSec: number): void {
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.flash;
  }
}

class SpringDevice extends BaseDevice {
  constructor(d: Extract<DeviceDef, { t: 'spring' }>, index: number, world: World) {
    super(d, index);
    const c = world.addCollider({
      shape: { kind: 'obb', hw: d.hw, hh: d.hh },
      x: d.x,
      y: d.y,
      angle: d.angle ?? 0,
      style: d.style ?? 'spring',
      restitution: d.restitution,
      friction: 0.2,
      deviceIndex: index,
    });
    this.colliderIds.push(c.id);
  }

  override update(_tMs: number, dtSec: number): void {
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.flash;
  }
}

/* ------------------------------------------------------------------ 바람 */

class WindDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'wind' }>;
  private on = false;

  constructor(
    d: Extract<DeviceDef, { t: 'wind' }>,
    index: number,
  ) {
    super(d, index);
    this.d = d;
  }

  override update(tMs: number, dtSec: number): void {
    this.on = dutyCycle(tMs, this.d.onMs, this.d.offMs, (this.d.phase ?? 0) * (this.d.onMs + this.d.offMs)).on;
    this.decayFlash(dtSec);
  }

  affect(m: DeviceMarble, dtSec: number): void {
    if (!this.on) return;
    if (!rectContains(this.d.area, m)) return;
    m.vx += this.d.ax * dtSec;
    m.vy += this.d.ay * dtSec;
  }

  override state(): number {
    return this.on ? 1 : 0;
  }
}

/* ------------------------------------------------------------------ 포털 */

class PortalDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'portal' }>;
  private pulse = 0;

  constructor(
    d: Extract<DeviceDef, { t: 'portal' }>,
    index: number,
  ) {
    super(d, index);
    this.d = d;
  }

  override update(_tMs: number, dtSec: number): void {
    this.pulse = (this.pulse + dtSec) % 1000;
  }

  affect(m: DeviceMarble): void {
    if (m.portalCooldownMs > 0) return;
    if (m.teleports >= MAX_TELEPORTS_PER_MARBLE) return;

    const { a, b } = this.d;
    const inA = (m.x - a.x) ** 2 + (m.y - a.y) ** 2 < a.r * a.r;
    const inB = !this.d.oneWay && (m.x - b.x) ** 2 + (m.y - b.y) ** 2 < b.r * b.r;
    if (!inA && !inB) return;

    const exit = inA ? b : a;
    const boost = this.d.exitBoost ?? 1;
    m.x = exit.x;
    m.y = exit.y;
    m.vx *= boost;
    m.vy *= boost;
    m.portalCooldownMs = this.d.cooldownMs;
    m.teleports += 1;
    // 순간이동했으니 진행률 기준점을 다시 찾아야 한다
    m.pathDirty = true;
  }

  override state(): number {
    return this.pulse;
  }
}

/* ------------------------------------------------------------------ 자석 */

class MagnetDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'magnet' }>;
  private on = false;

  constructor(
    d: Extract<DeviceDef, { t: 'magnet' }>,
    index: number,
    world: World,
  ) {
    super(d, index);
    this.d = d;
    // 가운데 기둥은 실제로 부딪히는 물체다 — 자석에 「붙는」 느낌을 만든다
    const c = world.addCollider({
      shape: { kind: 'circle', r: d.coreRadius },
      x: d.x,
      y: d.y,
      style: d.style ?? 'magnet-core',
      restitution: 0.05,
      friction: 0.5,
      deviceIndex: index,
    });
    this.colliderIds.push(c.id);
  }

  override update(tMs: number, dtSec: number): void {
    this.on = dutyCycle(tMs, this.d.onMs, this.d.offMs, (this.d.phase ?? 0) * (this.d.onMs + this.d.offMs)).on;
    this.decayFlash(dtSec);
  }

  affect(m: DeviceMarble, dtSec: number): void {
    const dx = this.d.x - m.x;
    const dy = this.d.y - m.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > this.d.r * this.d.r) {
      // 구역 밖 — 붙잡힌 시간을 잊는다
      m.magnetHoldMs = 0;
      return;
    }
    if (!this.on) return;

    m.magnetHoldMs += dtSec * 1000;
    // 너무 오래 붙잡혀 있으면 이 구슬은 놓아 준다(영구 고착 방지)
    if (m.magnetHoldMs > MAGNET_MAX_HOLD_MS) return;

    const dist = Math.sqrt(distSq);
    if (dist < this.d.coreRadius + 0.05) return;
    // 가까울수록 세지만 상한이 있다
    const falloff = 1 - dist / this.d.r;
    const f = this.d.strength * falloff * dtSec;
    m.vx += (dx / dist) * f;
    m.vy += (dy / dist) * f;
  }

  override state(): number {
    return this.on ? 1 : 0;
  }
}

/* ------------------------------------------------------------------ 가속 바닥 / 느린 구역 */

class BoosterDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'booster' }>;
  private phase = 0;

  constructor(
    d: Extract<DeviceDef, { t: 'booster' }>,
    index: number,
  ) {
    super(d, index);
    this.d = d;
  }

  override update(_tMs: number, dtSec: number): void {
    this.phase = (this.phase + dtSec) % 1000;
  }

  affect(m: DeviceMarble, dtSec: number): void {
    if (!rectContains(this.d.area, m)) return;
    const sp = Math.hypot(m.vx, m.vy);
    if (sp >= this.d.maxSpeed) return;
    m.vx += this.d.ax * dtSec;
    m.vy += this.d.ay * dtSec;
  }

  override state(): number {
    return this.phase;
  }
}

class SlowDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'slow' }>;
  private phase = 0;

  constructor(
    d: Extract<DeviceDef, { t: 'slow' }>,
    index: number,
  ) {
    super(d, index);
    this.d = d;
  }

  override update(_tMs: number, dtSec: number): void {
    this.phase = (this.phase + dtSec) % 1000;
  }

  affect(m: DeviceMarble, dtSec: number): void {
    if (!rectContains(this.d.area, m)) return;
    const k = Math.pow(this.d.retainPerSec, dtSec);
    m.vx *= k;
    m.vy *= k;
  }

  override state(): number {
    return this.phase;
  }
}

/* ------------------------------------------------------------------ 회전문 */

class RevolvingDoorDevice extends BaseDevice {
  private readonly d: Extract<DeviceDef, { t: 'revolvingDoor' }>;
  private angle = 0;
  private readonly bodies: Collider[] = [];
  private readonly offsets: number[] = [];

  constructor(
    d: Extract<DeviceDef, { t: 'revolvingDoor' }>,
    index: number,
    world: World,
  ) {
    super(d, index);
    this.d = d;
    for (let i = 0; i < d.blades; i++) {
      const off = (Math.PI * i) / d.blades;
      this.offsets.push(off);
      // 날개는 축을 가로지르는 한 장 — 가운데를 지나는 긴 막대
      const c = world.addCollider({
        shape: { kind: 'obb', hw: d.r, hh: 0.09 },
        x: d.x,
        y: d.y,
        angle: off,
        style: d.style ?? 'door',
        restitution: 0.1,
        friction: 0.3,
        deviceIndex: index,
        kinematic: true,
      });
      this.bodies.push(c);
      this.colliderIds.push(c.id);
    }
  }

  override update(_tMs: number, dtSec: number): void {
    this.angle += this.d.omega * dtSec;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      b.angle = this.angle + this.offsets[i]!;
      b.omega = this.d.omega;
    }
    this.decayFlash(dtSec);
  }

  override state(): number {
    return this.angle;
  }
}

/* ------------------------------------------------------------------ 만들기 */

export function createDevice(def: DeviceDef, index: number, world: World): RuntimeDevice {
  switch (def.t) {
    case 'spinner':
      return new SpinnerDevice(def, index, world);
    case 'windmill':
      return new WindmillDevice(def, index, world);
    case 'seesaw':
      return new SeesawDevice(def, index, world);
    case 'gate':
      return new GateDevice(def, index, world);
    case 'conveyor':
      return new ConveyorDevice(def, index, world);
    case 'bumper':
      return new BumperDevice(def, index, world);
    case 'spring':
      return new SpringDevice(def, index, world);
    case 'wind':
      return new WindDevice(def, index);
    case 'portal':
      return new PortalDevice(def, index);
    case 'magnet':
      return new MagnetDevice(def, index, world);
    case 'booster':
      return new BoosterDevice(def, index);
    case 'slow':
      return new SlowDevice(def, index);
    case 'revolvingDoor':
      return new RevolvingDoorDevice(def, index, world);
  }
}

/** 구역 효과를 가진 장치만 골라 둔다 — 매 스텝 전부 훑지 않으려는 것이다 */
export function hasZoneEffect(d: RuntimeDevice): boolean {
  return typeof d.affect === 'function';
}

export type { Rect };
