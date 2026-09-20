/**
 * 교사 브라우저의 경기 런타임.
 *
 * Web Worker(물리) ↔ 서버(중계·확정) 사이를 잇는다.
 *
 *  - 프레임은 «버려도 되는» 것이다. 네트워크로는 10Hz 로만 흘린다.
 *  - 도착 기록은 «버리면 안 되는» 것이다. ack 를 받을 때까지 다시 보낸다.
 *  - runtimeId 는 이 페이지가 살아 있는 동안만 같다. 새로고침하면 달라지고,
 *    서버는 그것으로 «물리 상태가 사라졌다» 를 알아 진행 중이던 라운드를 취소한다.
 */

import type { RuleSnapshot } from '@marble/protocol';
import type { RoomConnection } from '../net/connection.ts';
import { FrameInterpolator } from './interpolator.ts';
import type { WorkerFrame, WorkerIn, WorkerOut } from './physics.worker.ts';

/** 서버로 프레임을 보내는 간격(ms). 처음 목표는 10Hz 다. */
const NET_FRAME_INTERVAL_MS = 100;
/** 도착 기록을 다시 보내는 횟수 */
const FINISH_RETRIES = 4;

export interface HostRuntimeEvents {
  onLag?(behindMs: number): void;
  onError?(message: string): void;
  onDone?(reason: 'completed' | 'timeout'): void;
  onFrame?(frame: WorkerFrame): void;
}

export class HostRuntime {
  /** 이 페이지가 살아 있는 동안만 같은 값 */
  readonly runtimeId = `rt-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  readonly interpolator = new FrameInterpolator();

  private worker: Worker | null = null;
  private epoch = 0;
  private roundId: string | null = null;
  private seq = 0;
  private lastNetSend = 0;
  private running = false;
  private assistTotal = 0;

  constructor(
    private readonly conn: RoomConnection,
    private readonly events: HostRuntimeEvents = {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }
  get currentEpoch(): number {
    return this.epoch;
  }

  /** 서버에 호스트 자리를 잡는다. 성공해야 경기를 시작할 수 있다. */
  async claim(): Promise<number> {
    const res = (await this.conn.request('host:claim', { runtimeId: this.runtimeId })) as {
      epoch: number;
      granted: boolean;
    };
    this.epoch = res.epoch;
    return res.epoch;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => this.onWorkerMessage(ev.data);
    w.onerror = (ev) => {
      this.events.onError?.(ev.message || '물리 엔진에서 오류가 났습니다.');
      this.reportStalled(ev.message || '물리 엔진 오류');
    };
    this.worker = w;
    return w;
  }

  /**
   * 라운드를 시작한다.
   * @param startAt performance.now() 기준 시각. 카운트다운이 끝나는 순간.
   */
  start(snapshot: RuleSnapshot, requiredFinishCount: number, startAt: number): void {
    const w = this.ensureWorker();
    this.roundId = snapshot.roundId;
    this.seq = 0;
    this.lastNetSend = 0;
    this.assistTotal = 0;
    this.running = true;
    this.interpolator.reset();

    // 서버가 정한 타이브레이커(참가자 id 순서)를 구슬 번호 순서로 바꾼다
    const indexOf = new Map(snapshot.racers.map((r, i) => [r.participantId, i]));
    const tiebreakOrder = snapshot.tiebreakOrder
      .map((id) => indexOf.get(id))
      .filter((v): v is number => v !== undefined);

    const msg: WorkerIn = {
      type: 'start',
      mapId: snapshot.mapId,
      racerCount: snapshot.racers.length,
      seed: snapshot.seed,
      useSkills: snapshot.useSkills,
      requiredFinishCount,
      timeLimitSec: snapshot.timeLimitSec,
      tiebreakOrder,
      startAt,
    };
    w.postMessage(msg);
  }

  stop(): void {
    this.running = false;
    this.roundId = null;
    const msg: WorkerIn = { type: 'stop' };
    this.worker?.postMessage(msg);
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }

  private onWorkerMessage(msg: WorkerOut): void {
    switch (msg.type) {
      case 'ready':
        break;

      case 'frame': {
        const roundId = this.roundId;
        if (!roundId) return;
        this.seq += 1;
        const full = { ...msg.frame, roundId, epoch: this.epoch, seq: this.seq };
        // 교사 화면도 학생과 같은 길(보간)로 그린다
        this.interpolator.push(full);
        this.events.onFrame?.(msg.frame);
        if (msg.frame.assist) this.assistTotal += msg.frame.assist.length;

        // 네트워크로는 10Hz 로만. 중간 것은 버린다 — 쌓아 두면 학생 화면이 점점 늦어진다.
        const now = performance.now();
        if (now - this.lastNetSend >= NET_FRAME_INTERVAL_MS) {
          this.lastNetSend = now;
          this.conn.send('host:frame', full);
        }
        return;
      }

      case 'finish':
        void this.sendFinishes(msg.entries);
        return;

      case 'lag':
        this.events.onLag?.(msg.behindMs);
        return;

      case 'done': {
        this.running = false;
        const roundId = this.roundId;
        if (!roundId) return;
        void this.sendComplete(roundId, msg.reason, Math.max(this.assistTotal, msg.assistCount));
        this.events.onDone?.(msg.reason);
        return;
      }

      case 'error':
        this.running = false;
        this.events.onError?.(msg.message);
        this.reportStalled(msg.message);
        return;
    }
  }

  /** 도착 기록은 반드시 닿아야 한다 — ack 를 받을 때까지 다시 보낸다 */
  private async sendFinishes(
    entries: Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }>,
  ): Promise<void> {
    const roundId = this.roundId;
    if (!roundId || entries.length === 0) return;
    for (let attempt = 0; attempt <= FINISH_RETRIES; attempt++) {
      try {
        await this.conn.request('host:finish', { roundId, epoch: this.epoch, entries });
        return;
      } catch {
        // 지난 라운드/지난 호스트라면 다시 보내도 소용없다
        if (this.roundId !== roundId) return;
        await sleep(300 * (attempt + 1));
      }
    }
    this.events.onError?.('도착 기록을 서버에 보내지 못했습니다. 결과를 확정할 수 없습니다.');
  }

  private async sendComplete(
    roundId: string,
    reason: 'completed' | 'timeout',
    assistCount: number,
  ): Promise<void> {
    for (let attempt = 0; attempt <= FINISH_RETRIES; attempt++) {
      try {
        await this.conn.request('host:complete', { roundId, epoch: this.epoch, reason, assistCount });
        return;
      } catch {
        await sleep(400 * (attempt + 1));
      }
    }
    this.events.onError?.('경기 종료를 서버에 알리지 못했습니다.');
  }

  private reportStalled(reason: string): void {
    if (!this.roundId) return;
    this.conn.send('host:stalled', { roundId: this.roundId, epoch: this.epoch, reason });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
