/**
 * 경기 엔진.
 *
 * 한 라운드의 물리·진행률·결승 판정을 모두 여기서 돌린다.
 * DOM·React·네트워크를 모르는 순수 코드라서, 검사에서 수천 판을 그대로 돌려 볼 수 있다.
 */

import type { DeviceMarble, RuntimeDevice } from '../devices/index.ts';
import { buildMap, type BuiltMap } from '../map/build.ts';
import type { MapDefinition } from '../map/types.ts';
import { Rng } from '../math/rng.ts';
import { rectCenter, type Rect, type Vec2 } from '../math/vec2.ts';
import { MARBLE_RADIUS, type Marble } from '../physics/world.ts';
import { advanceCheckpoint, ProgressPath, progressScore } from './progress.ts';

/** 물리 한 스텝의 길이(초). 화면 프레임과 무관하게 고정이다. */
export const FIXED_DT = 1 / 60;

/**
 * 정체 탈출 보조 규칙 — 공개 값이다. docs/rules.md 에 그대로 적어 두었다.
 * 같은 조건에 있는 모든 구슬에 똑같이 적용한다.
 *
 * 「막혔다」를 무엇으로 볼 것인가:
 *   진행률(코스를 얼마나 왔나)만 보면, 항아리처럼 휘저어지는 구간에서 신나게 튀고 있는
 *   구슬까지 막힌 것으로 세어 버린다(실제로 한 판에 수십 번 발동했다).
 *   그래서 **제자리를 벗어났는가** 를 본다 — 기준점에서 escapeRadius 만큼 움직이면
 *   기준점을 새로 잡고 시계를 되돌린다. 좁은 곳을 맴도는 경우까지 잡으려고,
 *   진행률이 아주 오래 안 늘면 걸리는 별도의 빗장을 하나 더 둔다.
 */
export const ASSIST = {
  /** 기준점에서 이만큼 벗어나면 「움직이고 있다」고 본다 */
  escapeRadius: 1.2,
  /** 진행률이 이만큼 늘면 확실히 나아간 것이다 */
  progressEpsilon: 0.08,
  /** 1단계: 살짝 흔든다 */
  level1Ms: 4000,
  level1Power: 3,
  /** 2단계: 세게 흔든다 */
  level2Ms: 8000,
  level2Power: 6.5,
  /** 3단계: 마지막으로 지난 구간 입구로 되돌린다 */
  level3Ms: 13000,
  /** 제자리는 벗어나지만 코스를 못 나아가는 경우의 빗장 */
  noProgressMs: 25000,
} as const;

/** 자동 충격 스킬 — 교사가 켰을 때만 돈다. 모든 구슬에 같은 규칙. */
export const SKILL = {
  chargeMs: 6000,
  /** 주변에 이만큼 안에 다른 구슬이 */
  senseRadius: 6,
  /** 이 수 이상 있으면 터진다 */
  senseCount: 2,
  impactRadius: 8,
  impactPower: 5,
} as const;

export interface RaceMarble extends DeviceMarble {
  /** 기준선 위 어느 선분에 있는가 */
  pathIdx: number;
  /** 기준선 위 거리 */
  arc: number;
  /** 지난 구간 수 */
  checkpoint: number;
  /** 순위 점수(한 번 오르면 내려가지 않는다) */
  score: number;

  stuckMs: number;
  lastScore: number;
  /** 제자리 판정의 기준점 */
  anchorX: number;
  anchorY: number;
  /** 코스를 못 나아간 시간(빗장용) */
  noProgressMs: number;
  /** 이 구슬에 적용된 탈출 보조 단계 */
  assistLevel: number;

  finished: boolean;
  finishTimeMs: number;
  finishRank: number;

  skillChargeMs: number;
}

export interface FinishRecord {
  racerIndex: number;
  /** 라운드 시작부터의 ms. substep 안에서 보간한 값이다. */
  timeMs: number;
  rank: number;
  /** 같은 시각에 통과해 타이브레이커로 갈렸는가 */
  tiebroken: boolean;
}

export type RaceStatus = 'ready' | 'running' | 'completed' | 'timeout';

export interface RaceOptions {
  map: MapDefinition;
  racerCount: number;
  /** 서버가 만든 라운드 시드 */
  seed: string;
  useSkills: boolean;
  /**
   * 이만큼 도착하면 경기를 끝낸다.
   * 「첫 번째」 규칙이면 1, 「마지막」이면 전원. 규칙에서 계산해 넘긴다.
   */
  requiredFinishCount: number;
  /** 제한시간(초). 맵 기본값을 덮어쓸 때만 넘긴다. */
  timeLimitSec?: number;
  /**
   * 같은 시각에 통과했을 때의 순서. 구슬 번호를 앞선 것부터 나열한다.
   * 라운드 시작 전에 시드로 정해 두고 스냅샷에 남긴다.
   */
  tiebreakOrder: number[];
}

/** 선분이 사각형에 처음 들어가는 지점의 t (0~1). 안 들어가면 null. */
function segmentRectEntry(ax: number, ay: number, bx: number, by: number, r: Rect): number | null {
  const insideB = bx >= r.x && bx <= r.x + r.w && by >= r.y && by <= r.y + r.h;
  if (!insideB) return null;
  const insideA = ax >= r.x && ax <= r.x + r.w && ay >= r.y && ay <= r.y + r.h;
  if (insideA) return 0;

  // 끝점은 안에 있고 시작점은 밖에 있다 — 각 면을 자르며 들어온 지점을 찾는다
  let tEnter = 0;
  let tExit = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const slabs: Array<[number, number, number]> = [
    [dx, r.x - ax, r.x + r.w - ax],
    [dy, r.y - ay, r.y + r.h - ay],
  ];
  for (const [d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (lo > 0 || hi < 0) return null;
      continue;
    }
    let t0 = lo / d;
    let t1 = hi / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
    if (tEnter > tExit) return null;
  }
  return Math.max(0, Math.min(1, tEnter));
}

export class RaceEngine {
  readonly map: MapDefinition;
  readonly built: BuiltMap;
  readonly path: ProgressPath;
  readonly marbles: RaceMarble[] = [];
  readonly finishOrder: FinishRecord[] = [];
  readonly devices: RuntimeDevice[];

  /** 탈출 보조가 몇 번 적용됐는가 — 결과에 함께 싣는 공개 값 */
  assistCount = 0;
  /** 맵 밖으로 새어 나간 구슬을 되돌린 횟수. 0 이어야 정상이다. */
  escapeCount = 0;

  private _status: RaceStatus = 'ready';
  private _timeMs = 0;
  private readonly rng: Rng;
  private readonly tiebreakRank = new Map<number, number>();
  private readonly prevX: number[] = [];
  private readonly prevY: number[] = [];
  private readonly timeLimitMs: number;
  private readonly requiredFinishCount: number;
  private readonly useSkills: boolean;
  /** 같은 substep 에 들어온 도착을 모아 두었다가 한꺼번에 순위를 매긴다 */
  private pendingFinish: Array<{ racerIndex: number; timeMs: number }> = [];
  /** 이 스텝에 새로 도착한 구슬 */
  readonly justFinished: FinishRecord[] = [];
  /** 이 스텝에 탈출 보조를 받은 구슬 */
  readonly justAssisted: number[] = [];
  /** 이 스텝에 터진 장애물(맵 데이터 기준 번호) */
  readonly justPopped: number[] = [];
  /** 지금까지 터진 장애물 전부 — 늦게 들어온 화면을 맞출 때 쓴다 */
  readonly poppedObstacles = new Set<number>();

  constructor(opts: RaceOptions) {
    this.map = opts.map;
    this.built = buildMap(opts.map);
    this.devices = this.built.devices;
    this.path = new ProgressPath(opts.map.progressPath);
    this.rng = new Rng(`${opts.seed}:race`);
    this.useSkills = opts.useSkills;
    this.timeLimitMs = (opts.timeLimitSec ?? opts.map.timeLimitSec) * 1000;
    this.requiredFinishCount = Math.max(1, Math.min(opts.requiredFinishCount, opts.racerCount));

    for (let i = 0; i < opts.tiebreakOrder.length; i++) {
      this.tiebreakRank.set(opts.tiebreakOrder[i]!, i);
    }

    this.spawn(opts.racerCount);
  }

  get status(): RaceStatus {
    return this._status;
  }
  get timeMs(): number {
    return this._timeMs;
  }
  get finishedCount(): number {
    return this.finishOrder.length;
  }

  /* ---------------------------------------------------------------- 배치 */

  /**
   * 출발 자리를 시드로 섞는다.
   * 닉네임·참여 순서가 자리에 영향을 주지 않게 하려는 것이다.
   */
  private spawn(n: number): void {
    const { area, perRow, gap } = this.map.spawn;
    const colStep = area.w / perRow;

    const slots: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      slots.push({
        x: area.x + (col + 0.5) * colStep,
        y: area.y + area.h - (row + 0.5) * gap,
      });
    }

    const order = this.rng.shuffled(slots.map((_, i) => i));

    for (let i = 0; i < n; i++) {
      const slot = slots[order[i]!]!;
      const jx = this.rng.range(-0.06, 0.06);
      const jy = this.rng.range(-0.06, 0.06);
      const base = this.built.world.addMarble(slot.x + jx, slot.y + jy);
      const m = base as Marble as RaceMarble;
      m.portalCooldownMs = 0;
      m.teleports = 0;
      m.pathDirty = false;
      m.magnetHoldMs = 0;
      m.pathIdx = 0;
      m.arc = 0;
      m.checkpoint = 0;
      m.score = 0;
      m.stuckMs = 0;
      m.lastScore = 0;
      m.anchorX = slot.x;
      m.anchorY = slot.y;
      m.noProgressMs = 0;
      m.assistLevel = 0;
      m.finished = false;
      m.finishTimeMs = -1;
      m.finishRank = -1;
      m.skillChargeMs = 0;
      this.marbles.push(m);
      this.prevX.push(m.x);
      this.prevY.push(m.y);
    }

    // 출발선에 놓인 첫 위치로 진행률 기준점을 잡아 둔다
    for (const m of this.marbles) {
      const hit = this.path.nearestGlobal(m);
      m.pathIdx = hit.idx;
      m.arc = hit.arc;
      m.score = progressScore(0, hit.arc, this.path.total);
      m.lastScore = m.score;
    }
  }

  /* ---------------------------------------------------------------- 한 스텝 */

  start(): void {
    if (this._status === 'ready') this._status = 'running';
  }

  step(): void {
    if (this._status !== 'running') return;
    this.justFinished.length = 0;
    this.justAssisted.length = 0;
    this.justPopped.length = 0;

    const stepStartMs = this._timeMs;

    for (let i = 0; i < this.marbles.length; i++) {
      const m = this.marbles[i]!;
      this.prevX[i] = m.x;
      this.prevY[i] = m.y;
    }

    this.built.world.step(
      FIXED_DT,
      (s, h) => {
        // 장치는 substep 마다 움직인다 — 빠른 막대가 구슬을 지나쳐 버리지 않게.
        for (const d of this.devices) d.update(stepStartMs + s * h * 1000, h, this.built.world);
        for (const d of this.built.zoneDevices) {
          const affect = d.affect;
          if (!affect) continue;
          for (const m of this.marbles) {
            if (!m.active) continue;
            affect.call(d, m, h, this.built.world);
          }
        }
        for (const m of this.marbles) {
          if (m.portalCooldownMs > 0) m.portalCooldownMs = Math.max(0, m.portalCooldownMs - h * 1000);
        }
      },
      (s, h) => {
        this.checkFinish(stepStartMs, s, h);
        for (let i = 0; i < this.marbles.length; i++) {
          const m = this.marbles[i]!;
          this.prevX[i] = m.x;
          this.prevY[i] = m.y;
        }
      },
    );

    this._timeMs += FIXED_DT * 1000;

    this.collectPops();
    this.applyContactEffects();
    this.updateProgress();
    this.updateStuck();
    if (this.useSkills) this.updateSkills();
    this.flushPendingFinish();

    if (this.finishOrder.length >= this.requiredFinishCount) {
      this._status = 'completed';
    } else if (this._timeMs >= this.timeLimitMs) {
      this._status = 'timeout';
    }
  }

  /* ---------------------------------------------------------------- 결승 판정 */

  private checkFinish(stepStartMs: number, subIndex: number, h: number): void {
    const area = this.map.finish.area;
    for (let i = 0; i < this.marbles.length; i++) {
      const m = this.marbles[i]!;
      if (m.finished || !m.active) continue;
      const t = segmentRectEntry(this.prevX[i]!, this.prevY[i]!, m.x, m.y, area);
      if (t === null) continue;
      // substep 안에서 실제로 선을 넘은 시점까지 보간한다
      const timeMs = stepStartMs + (subIndex + t) * h * 1000;
      m.finished = true;
      m.finishTimeMs = timeMs;
      m.active = false;
      m.vx = 0;
      m.vy = 0;
      this.pendingFinish.push({ racerIndex: i, timeMs });
    }
  }

  /**
   * 도착을 순위로 바꾼다.
   *
   * 1) 보간한 통과 시각이 이른 쪽이 앞이다.
   * 2) 시각마저 같으면(부동소수점으로 완전히 같은 경우) 라운드 시작 전에 시드로 정해 둔
   *    타이브레이커 순서를 쓴다. 이 규칙은 docs/rules.md 에 적어 두었다.
   */
  private flushPendingFinish(): void {
    if (this.pendingFinish.length === 0) return;
    const batch = this.pendingFinish;
    this.pendingFinish = [];
    batch.sort((a, b) => {
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      const ra = this.tiebreakRank.get(a.racerIndex) ?? a.racerIndex;
      const rb = this.tiebreakRank.get(b.racerIndex) ?? b.racerIndex;
      return ra - rb;
    });
    for (let k = 0; k < batch.length; k++) {
      const e = batch[k]!;
      const prev = k > 0 ? batch[k - 1]! : null;
      const next = k + 1 < batch.length ? batch[k + 1]! : null;
      const tiebroken = (prev !== null && prev.timeMs === e.timeMs) || (next !== null && next.timeMs === e.timeMs);
      const rec: FinishRecord = {
        racerIndex: e.racerIndex,
        timeMs: e.timeMs,
        rank: this.finishOrder.length + 1,
        tiebroken,
      };
      this.marbles[e.racerIndex]!.finishRank = rec.rank;
      this.finishOrder.push(rec);
      this.justFinished.push(rec);
    }
  }

  /* ---------------------------------------------------------------- 진행률 */

  private updateProgress(): void {
    const bounds = this.map.bounds;
    for (const m of this.marbles) {
      if (m.finished) continue;

      // 맵 밖으로 새어 나갔다면 되돌린다(마지막 빗장 — 정상이라면 절대 걸리지 않는다)
      if (
        m.x < bounds.x - 2 ||
        m.x > bounds.x + bounds.w + 2 ||
        m.y < bounds.y - 30 ||
        m.y > bounds.y + bounds.h + 2
      ) {
        this.sendToCheckpoint(m);
        this.escapeCount += 1;
        continue;
      }

      const hit = m.pathDirty ? this.path.nearestGlobal(m) : this.path.nearest(m, m.pathIdx);
      m.pathDirty = false;
      m.pathIdx = hit.idx;
      m.arc = hit.arc;
      m.checkpoint = advanceCheckpoint(this.map.checkpoints, m.checkpoint, m);
      const s = progressScore(m.checkpoint, hit.arc, this.path.total);
      if (s > m.score) m.score = s;
    }
  }

  /* ---------------------------------------------------------------- 정체 탈출 */

  private updateStuck(): void {
    const dtMs = FIXED_DT * 1000;
    const r2 = ASSIST.escapeRadius * ASSIST.escapeRadius;
    for (const m of this.marbles) {
      if (m.finished || !m.active) continue;

      // 코스를 나아갔으면 빗장 시계도 되돌린다
      if (m.score > m.lastScore + ASSIST.progressEpsilon) {
        m.lastScore = m.score;
        m.noProgressMs = 0;
      } else {
        m.noProgressMs += dtMs;
      }

      // 제자리는 벗어났지만 코스를 너무 오래 못 나아가는 경우 — 휘저어지는 구간에 갇힌 것이다.
      // 한 번 흔들어 보고, 그래도 안 되면 지난 구간 입구로 되돌린다.
      if (m.noProgressMs >= ASSIST.noProgressMs) {
        m.noProgressMs = 0;
        if (m.assistLevel >= 4) {
          this.sendToCheckpoint(m);
        } else {
          m.assistLevel = 4;
          this.built.world.nudge(m, this.rng, ASSIST.level2Power);
        }
        this.noteAssist(m.index);
        continue;
      }

      // 기준점을 벗어났으면 아직 「움직이는 중」이다
      if ((m.x - m.anchorX) ** 2 + (m.y - m.anchorY) ** 2 > r2) {
        m.anchorX = m.x;
        m.anchorY = m.y;
        m.stuckMs = 0;
        if (m.assistLevel < 4) m.assistLevel = 0;
        continue;
      }

      m.stuckMs += dtMs;

      if (m.assistLevel === 0 && m.stuckMs >= ASSIST.level1Ms) {
        m.assistLevel = 1;
        this.built.world.nudge(m, this.rng, ASSIST.level1Power);
        this.noteAssist(m.index);
      } else if (m.assistLevel === 1 && m.stuckMs >= ASSIST.level2Ms) {
        m.assistLevel = 2;
        this.built.world.nudge(m, this.rng, ASSIST.level2Power);
        this.noteAssist(m.index);
      } else if (m.assistLevel === 2 && m.stuckMs >= ASSIST.level3Ms) {
        m.assistLevel = 3;
        this.sendToCheckpoint(m);
        this.noteAssist(m.index);
      } else if (m.assistLevel === 3 && m.stuckMs >= ASSIST.level3Ms + ASSIST.level2Ms) {
        // 되돌렸는데도 또 막혔다 — 다시 처음 단계부터
        m.assistLevel = 0;
        m.stuckMs = 0;
      }
    }
  }

  private noteAssist(index: number): void {
    this.assistCount += 1;
    this.justAssisted.push(index);
  }

  /** 지난 구간의 가운데(없으면 출발 자리)로 되돌린다 */
  private sendToCheckpoint(m: RaceMarble): void {
    const cp = m.checkpoint > 0 ? this.map.checkpoints[m.checkpoint - 1] : undefined;
    const target = cp ? rectCenter(cp.area) : rectCenter(this.map.spawn.area);
    m.x = target.x + this.rng.range(-0.3, 0.3);
    m.y = target.y;
    m.vx = 0;
    m.vy = 0;
    m.stuckMs = 0;
    m.anchorX = m.x;
    m.anchorY = m.y;
    m.noProgressMs = 0;
    m.pathDirty = true;
    m.magnetHoldMs = 0;
    m.portalCooldownMs = 500;
  }

  /* ---------------------------------------------------------------- 스킬 */

  private updateSkills(): void {
    const dtMs = FIXED_DT * 1000;
    const r2 = SKILL.senseRadius * SKILL.senseRadius;
    for (const m of this.marbles) {
      if (!m.active) continue;
      m.skillChargeMs += dtMs;
      if (m.skillChargeMs < SKILL.chargeMs) continue;
      let near = 0;
      for (const o of this.marbles) {
        if (o === m || !o.active) continue;
        if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 < r2) {
          near++;
          if (near >= SKILL.senseCount) break;
        }
      }
      if (near < SKILL.senseCount) continue;
      this.built.world.impact(m, SKILL.impactRadius, SKILL.impactPower);
      m.skillChargeMs = 0;
    }
  }

  /* ---------------------------------------------------------------- 접촉 효과 */

  /** 터진 버블을 맵 데이터 기준 번호로 모은다 */
  private collectPops(): void {
    for (const id of this.built.world.popped) {
      const oi = this.built.obstacleOfCollider.get(id);
      if (oi === undefined || this.poppedObstacles.has(oi)) continue;
      this.poppedObstacles.add(oi);
      this.justPopped.push(oi);
    }
  }

  private applyContactEffects(): void {
    for (const c of this.built.world.contacts) {
      const di = this.built.deviceOfCollider.get(c.colliderId);
      if (di === undefined) continue;
      this.devices[di]?.onContact?.(c.impact);
    }
  }

  /* ---------------------------------------------------------------- 내보내기 */

  /** 지금 앞선 순서대로 구슬 번호를 돌려준다 */
  ranking(): number[] {
    const idx = this.marbles.map((m) => m.index);
    idx.sort((a, b) => {
      const ma = this.marbles[a]!;
      const mb = this.marbles[b]!;
      if (ma.finished && mb.finished) return ma.finishRank - mb.finishRank;
      if (ma.finished) return -1;
      if (mb.finished) return 1;
      return mb.score - ma.score;
    });
    return idx;
  }

  /** 네트워크로 보낼 만큼만 추린 지금 상태 */
  snapshot(): { m: number[]; d: number[]; rank: number[] } {
    const m: number[] = [];
    for (const b of this.marbles) {
      m.push(Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100);
    }
    const d: number[] = [];
    for (const dev of this.devices) d.push(Math.round(dev.state() * 1000) / 1000);
    return { m, d, rank: this.ranking() };
  }

  /** 맵 전체에서 이 구슬이 얼마나 왔는지 0~1 */
  progressRatio(m: RaceMarble): number {
    if (m.finished) return 1;
    return Math.max(0, Math.min(1, m.arc / this.path.total));
  }
}

export { MARBLE_RADIUS };
