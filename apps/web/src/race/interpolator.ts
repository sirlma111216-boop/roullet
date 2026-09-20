/**
 * 받은 프레임 사이를 메워 부드럽게 보여 준다.
 *
 * 프레임은 초당 10~15장만 온다. 그대로 그리면 구슬이 뚝뚝 끊겨 보인다.
 * 그래서 «조금 늦게» 그린다 — 가장 최근 프레임보다 BUFFER_MS 만큼 과거를 보여 주면
 * 언제나 앞뒤 두 프레임이 있어 사이를 이을 수 있다.
 *
 * 교사 화면도 같은 길을 쓴다. 화면 코드가 한 벌뿐이라 「교사에서만 이상한」 문제가 안 생긴다.
 */

import type { RaceFrame } from '@marble/protocol';

/** 얼마나 과거를 보여 줄지. 서버 중계 간격(80ms)과 흔들림을 덮을 만큼. */
const BUFFER_MS = 220;
/** 들고 있을 프레임 수 */
const MAX_FRAMES = 30;
/** 이보다 더 벌어지면 따라잡기를 포기하고 바로 맞춘다 */
const RESYNC_MS = 2500;

export interface SampledFrame {
  /** racers 순서대로 [x, y, x, y, …] */
  positions: number[];
  deviceStates: number[];
  ranking: number[];
  /** 지금 보여 주고 있는 경기 시각(ms) */
  raceTimeMs: number;
  /** 아직 한 장도 못 받았는가 */
  empty: boolean;
}

export class FrameInterpolator {
  private frames: RaceFrame[] = [];
  private renderT = 0;
  private started = false;
  /** 지금까지 확정된 도착: racerIndex → rank */
  readonly finished = new Map<number, number>();
  /** 터진 장애물 */
  readonly popped = new Set<number>();

  reset(): void {
    this.frames = [];
    this.renderT = 0;
    this.started = false;
    this.finished.clear();
    this.popped.clear();
  }

  push(frame: RaceFrame): void {
    // 늦게 도착한 프레임은 버린다
    const last = this.frames[this.frames.length - 1];
    if (last && frame.seq <= last.seq) return;

    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();

    // fin 은 [구슬번호, 순위, 통과시각] 세 개씩 이어 붙인 것이다
    for (let i = 0; i + 3 <= frame.fin.length; i += 3) {
      this.finished.set(frame.fin[i]!, frame.fin[i + 1]!);
    }
    if (frame.pop) for (const p of frame.pop) this.popped.add(p);

    if (!this.started) {
      this.renderT = Math.max(0, frame.t - BUFFER_MS);
      this.started = true;
    }
  }

  /** 실제로 흐른 시간만큼 보여 줄 시각을 민다 */
  advance(dtMs: number): void {
    if (!this.started) return;
    const latest = this.frames[this.frames.length - 1];
    if (!latest) return;
    const target = latest.t - BUFFER_MS;

    this.renderT += dtMs;

    const drift = target - this.renderT;
    if (drift > RESYNC_MS || drift < -RESYNC_MS) {
      // 너무 벌어졌다(탭이 멈췄거나 연결이 끊겼다 돌아왔다) — 바로 맞춘다
      this.renderT = target;
      return;
    }
    // 조금씩 따라잡는다. 시간을 되돌리지는 않는다 — 구슬이 뒤로 가면 이상해 보인다.
    this.renderT += drift * 0.06;
    if (this.renderT > latest.t) this.renderT = latest.t;
  }

  sample(): SampledFrame {
    if (this.frames.length === 0) {
      return { positions: [], deviceStates: [], ranking: [], raceTimeMs: 0, empty: true };
    }
    if (this.frames.length === 1) {
      const f = this.frames[0]!;
      return { positions: f.m, deviceStates: f.d, ranking: f.rank, raceTimeMs: f.t, empty: false };
    }

    // renderT 를 감싸는 두 프레임을 찾는다
    let a = this.frames[0]!;
    let b = this.frames[1]!;
    for (let i = 0; i < this.frames.length - 1; i++) {
      const f0 = this.frames[i]!;
      const f1 = this.frames[i + 1]!;
      if (this.renderT >= f0.t && this.renderT <= f1.t) {
        a = f0;
        b = f1;
        break;
      }
      // 가장 최근 두 장 너머라면 그대로 마지막 두 장을 쓴다
      if (i === this.frames.length - 2) {
        a = f0;
        b = f1;
      }
    }

    const span = b.t - a.t;
    const t = span > 0 ? clamp01((this.renderT - a.t) / span) : 1;

    const n = Math.min(a.m.length, b.m.length);
    const positions = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      positions[i] = a.m[i]! + (b.m[i]! - a.m[i]!) * t;
    }

    const dn = Math.min(a.d.length, b.d.length);
    const deviceStates = new Array<number>(dn);
    for (let i = 0; i < dn; i++) {
      // 각도는 한 바퀴를 넘어 뛸 수 있다 — 크게 벌어지면 잇지 않고 최신 값을 쓴다
      const d0 = a.d[i]!;
      const d1 = b.d[i]!;
      deviceStates[i] = Math.abs(d1 - d0) > Math.PI ? d1 : d0 + (d1 - d0) * t;
    }

    return { positions, deviceStates, ranking: b.rank, raceTimeMs: this.renderT, empty: false };
  }

  /** 마지막으로 받은 프레임의 경기 시각 */
  get latestRaceTimeMs(): number {
    return this.frames[this.frames.length - 1]?.t ?? 0;
  }

  get frameCount(): number {
    return this.frames.length;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
