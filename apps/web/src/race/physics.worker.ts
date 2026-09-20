/**
 * 물리 시뮬레이션 Web Worker.
 *
 * 교사 브라우저에서만 돈다. 한 방에 이 런타임은 **하나** 이고, 서버가 lease 로 그것을 보장한다.
 *
 * 왜 Worker 인가: 물리는 고정 간격으로 흔들림 없이 돌아야 하는데, 메인 스레드는
 * React 가 그리는 동안 멈춘다. 60명이 붙는 순간 화면 갱신 때문에 경기가 덜컥거리면
 * 결과가 아니라 «보는 맛» 이 무너진다.
 *
 * 탭이 뒤로 가면 타이머가 느려진다. 그때는 다음 깨어남에 몰아서 계산해 따라잡고,
 * 얼마나 밀렸는지 메인 스레드에 알린다(교사 화면이 «느려지고 있음» 을 띄울 수 있게).
 */

/// <reference lib="webworker" />

import { FIXED_DT, makeTiebreakOrder, RaceEngine, requireMap } from '@marble/game-core';

export interface StartMessage {
  type: 'start';
  mapId: string;
  racerCount: number;
  seed: string;
  useSkills: boolean;
  requiredFinishCount: number;
  timeLimitSec?: number;
  /** 서버 스냅샷의 tiebreakOrder 를 구슬 번호로 바꾼 것 */
  tiebreakOrder: number[];
  /** 경기를 실제로 시작할 시각(performance.now 기준). 카운트다운 동안은 멈춰 있는다. */
  startAt: number;
}

export type WorkerIn = StartMessage | { type: 'stop' } | { type: 'ping' };

export interface WorkerFrame {
  t: number;
  m: number[];
  d: number[];
  rank: number[];
  fin: number[];
  assist?: number[];
  pop?: number[];
}

export type WorkerOut =
  | { type: 'ready'; deviceCount: number }
  | { type: 'frame'; frame: WorkerFrame }
  | { type: 'finish'; entries: Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }> }
  | { type: 'done'; reason: 'completed' | 'timeout'; assistCount: number; escapeCount: number }
  | { type: 'lag'; behindMs: number }
  | { type: 'error'; message: string };

/** 메인 스레드로 프레임을 보내는 간격(ms). 화면은 이 사이를 이어서 그린다. */
const FRAME_INTERVAL_MS = 1000 / 30;
/** 한 번 깨어났을 때 몰아서 돌릴 수 있는 최대 스텝 수(0.5초 분량) */
const MAX_CATCHUP_STEPS = 30;
/** 이만큼 밀리면 메인 스레드에 알린다 */
const LAG_WARN_MS = 1200;

let engine: RaceEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let accumulatorMs = 0;
let lastTickAt = 0;
let lastFrameSentAt = 0;
let pendingFinishes: Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }> = [];
let startAt = 0;

const post = (msg: WorkerOut): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
};

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  engine = null;
  pendingFinishes = [];
  accumulatorMs = 0;
}

function buildFrame(e: RaceEngine): WorkerFrame {
  const snap = e.snapshot();
  const fin: number[] = [];
  for (const f of e.justFinished) fin.push(f.racerIndex, f.rank, Math.round(f.timeMs));
  const frame: WorkerFrame = {
    t: Math.round(e.timeMs),
    m: snap.m,
    d: snap.d,
    rank: snap.rank,
    fin,
  };
  if (e.justAssisted.length > 0) frame.assist = [...e.justAssisted];
  if (e.justPopped.length > 0) frame.pop = [...e.justPopped];
  return frame;
}

function tick(): void {
  const e = engine;
  if (!e) return;

  const now = performance.now();
  if (now < startAt) {
    // 아직 카운트다운 중. 기준 시각을 함께 밀어 두지 않으면 카운트다운 시간이
    // 통째로 「밀린 시간」으로 잡혀, 시작하자마자 지연 경고가 뜬다.
    lastTickAt = now;
    return;
  }

  const elapsed = now - lastTickAt;
  lastTickAt = now;
  accumulatorMs += elapsed;

  if (elapsed > LAG_WARN_MS) post({ type: 'lag', behindMs: Math.round(elapsed) });

  const stepMs = FIXED_DT * 1000;
  let steps = 0;
  while (accumulatorMs >= stepMs && steps < MAX_CATCHUP_STEPS && e.status === 'running') {
    e.step();
    accumulatorMs -= stepMs;
    steps++;

    // 도착은 프레임과 따로, 빠짐없이 모아 둔다 — 프레임은 버려도 되지만 도착은 안 된다
    for (const f of e.justFinished) {
      pendingFinishes.push({
        racerIndex: f.racerIndex,
        rank: f.rank,
        timeMs: Math.round(f.timeMs),
        tiebroken: f.tiebroken,
      });
    }
  }
  // 너무 많이 밀렸다면 나머지는 버린다. 물리는 스텝 수로 흘러가므로 결과는 공정하다.
  if (accumulatorMs > stepMs * MAX_CATCHUP_STEPS) accumulatorMs = 0;

  if (steps > 0) {
    if (pendingFinishes.length > 0) {
      post({ type: 'finish', entries: pendingFinishes });
      pendingFinishes = [];
    }
    if (now - lastFrameSentAt >= FRAME_INTERVAL_MS || e.status !== 'running') {
      lastFrameSentAt = now;
      post({ type: 'frame', frame: buildFrame(e) });
    }
  }

  if (e.status !== 'running') {
    post({ type: 'frame', frame: buildFrame(e) });
    post({
      type: 'done',
      reason: e.status === 'timeout' ? 'timeout' : 'completed',
      assistCount: e.assistCount,
      escapeCount: e.escapeCount,
    });
    stop();
  }
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'stop') {
      stop();
      return;
    }
    if (msg.type === 'ping') return;

    if (msg.type === 'start') {
      stop();
      const map = requireMap(msg.mapId);
      const tiebreak =
        msg.tiebreakOrder.length === msg.racerCount
          ? msg.tiebreakOrder
          : makeTiebreakOrder(msg.seed, msg.racerCount);
      engine = new RaceEngine({
        map,
        racerCount: msg.racerCount,
        seed: msg.seed,
        useSkills: msg.useSkills,
        requiredFinishCount: msg.requiredFinishCount,
        timeLimitSec: msg.timeLimitSec,
        tiebreakOrder: tiebreak,
      });
      engine.start();
      startAt = msg.startAt;
      lastTickAt = performance.now();
      lastFrameSentAt = 0;
      accumulatorMs = 0;
      post({ type: 'ready', deviceCount: engine.devices.length });
      // 첫 그림을 바로 보내 대기 화면에 구슬이 보이게 한다
      post({ type: 'frame', frame: buildFrame(engine) });
      timer = setInterval(tick, 8);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : '알 수 없는 오류' });
    stop();
  }
};
