/**
 * 실제 WebSocket 부하 시험.
 *
 *   npm run loadtest -- --students 60
 *   npm run loadtest -- --students 100 --map classic-night
 *
 * 먼저 서버를 띄워 두어야 한다:  npm run dev:worker
 *
 * ★ 이것은 «구슬을 100개 그렸다» 가 아니라 **연결을 100개 맺어** 보는 시험이다.
 *   한 연결이 한 기기를 흉내 낸다. 재는 것:
 *    - 모두 붙는 데 걸린 시간
 *    - 경기 중 한 연결이 받은 프레임 수와 바이트
 *    - 프레임이 만들어진 시각과 받은 시각의 차이(지연)
 *    - 결과가 전원에게 닿았는지, 닿는 데 걸린 시간
 *
 * 한계: 같은 컴퓨터에서 연결을 다 만들기 때문에, 실제 교실의 무선망·기기 성능은
 * 재지 못한다. 그것은 실제 기기로 따로 확인해야 한다.
 */

import { RaceEngine, makeTiebreakOrder, requireMap } from '../packages/game-core/src/index.ts';
import { requiredFinishCount } from '../packages/game-core/src/rules/select.ts';
import { PROTOCOL_VERSION, type RoundResult, type RuleSnapshot } from '../packages/protocol/src/index.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const BASE = arg('base', 'http://127.0.0.1:8787');
const WS_BASE = BASE.replace(/^http/, 'ws');
const N = Number(arg('students', '60'));
const MAP_ID = arg('map', 'classic-bubble');
const RULE = arg('rule', 'first');

interface Stat {
  frames: number;
  bytes: number;
  latencies: number[];
  results: RoundResult[];
  connectedAt: number;
  resultAt: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]!;
}

async function main(): Promise<void> {
  console.log(`부하 시험 — 학생 ${N}명 · 맵 ${MAP_ID} · 규칙 ${RULE}\n서버 ${BASE}\n`);

  const created = (await (
    await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capacity: Math.max(N, 100) }),
    })
  ).json()) as { joinCode: string; teacherToken: string };
  const code = created.joinCode;
  console.log(`방 ${code}`);

  /* ---- 교사 ---- */
  const teacherWs = new WebSocket(`${WS_BASE}/ws?code=${code}`);
  const teacherPending = new Map<string, (v: unknown) => void>();
  const teacherReject = new Map<string, (e: Error) => void>();
  let tseq = 0;
  let teacherResult: RoundResult | null = null;

  const treq = (t: string, d: unknown): Promise<unknown> => {
    const i = `t${++tseq}`;
    return new Promise((resolve, reject) => {
      teacherPending.set(i, resolve);
      teacherReject.set(i, reject);
      teacherWs.send(JSON.stringify({ t, i, d }));
    });
  };

  await new Promise<void>((resolve, reject) => {
    teacherWs.onopen = () => resolve();
    teacherWs.onerror = () => reject(new Error('교사 연결 실패'));
  });
  teacherWs.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { t: string; i?: string; d?: unknown };
    if (m.i && (m.t === 'ack' || m.t === 'nack')) {
      if (m.t === 'ack') teacherPending.get(m.i)?.(m.d);
      else teacherReject.get(m.i)?.(new Error((m.d as { message: string }).message));
      teacherPending.delete(m.i);
      teacherReject.delete(m.i);
      return;
    }
    if (m.t === 'result') teacherResult = m.d as RoundResult;
  };
  await treq('hello', { protocolVersion: PROTOCOL_VERSION, role: 'teacher', teacherToken: created.teacherToken });
  const claim = (await treq('host:claim', { runtimeId: 'load-host' })) as { epoch: number };

  /* ---- 학생 N명 붙이기 ---- */
  console.log(`\n[1] 학생 ${N}명 접속`);
  const t0 = Date.now();
  const stats: Stat[] = [];
  const sockets: WebSocket[] = [];

  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const st: Stat = { frames: 0, bytes: 0, latencies: [], results: [], connectedAt: 0, resultAt: 0 };
      stats[i] = st;
      const ws = new WebSocket(`${WS_BASE}/ws?code=${code}`);
      sockets[i] = ws;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error(`학생 ${i} 연결 실패`));
      });
      ws.onmessage = (ev) => {
        const raw = String(ev.data);
        const m = JSON.parse(raw) as { t: string; i?: string; d?: unknown };
        if (m.t === 'frame') {
          st.frames++;
          st.bytes += raw.length;
          const f = m.d as { sentAt?: number };
          if (typeof f.sentAt === 'number') st.latencies.push(Date.now() - f.sentAt);
        } else if (m.t === 'result') {
          st.results.push(m.d as RoundResult);
          if (st.resultAt === 0) st.resultAt = Date.now();
        } else if (m.t === 'ack' && m.i === 'hello') {
          st.connectedAt = Date.now();
        }
      };
      ws.send(
        JSON.stringify({
          t: 'hello',
          i: 'hello',
          d: { protocolVersion: PROTOCOL_VERSION, role: 'student', nickname: `학생${i + 1}` },
        }),
      );
    }),
  );

  // hello ack 가 다 올 때까지
  const untilConnected = Date.now() + 30_000;
  while (Date.now() < untilConnected && stats.some((s) => s.connectedAt === 0)) await sleep(50);
  const connectMs = Date.now() - t0;
  const connected = stats.filter((s) => s.connectedAt > 0).length;
  console.log(`    ${connected}/${N}명 접속 완료 — ${connectMs}ms (평균 ${(connectMs / N).toFixed(1)}ms/명)`);

  /* ---- 설정 & 시작 ---- */
  const rule = RULE === 'last' ? { kind: 'last' } : RULE === 'all' ? { kind: 'topK', k: N } : { kind: 'first' };
  await treq('teacher:config', {
    config: {
      mapId: MAP_ID,
      rule,
      excludedParticipantIds: [],
      excludePreviousWinners: false,
      useSkills: false,
      awards: [],
      allowDuplicateAwards: false,
    },
  });

  console.log(`\n[2] 경기`);
  const started = (await treq('teacher:start', { countdownSec: 0 })) as { snapshot: RuleSnapshot };
  const snapshot = started.snapshot;
  console.log(`    참가 구슬 ${snapshot.racers.length}개`);

  const map = requireMap(snapshot.mapId);
  const indexOf = new Map(snapshot.racers.map((r, i) => [r.participantId, i]));
  const tiebreak = snapshot.tiebreakOrder.map((id) => indexOf.get(id)!);
  const engine = new RaceEngine({
    map,
    racerCount: snapshot.racers.length,
    seed: snapshot.seed,
    useSkills: snapshot.useSkills,
    requiredFinishCount: requiredFinishCount(snapshot.rule, snapshot.racers.length),
    timeLimitSec: snapshot.timeLimitSec,
    tiebreakOrder: tiebreak.length === snapshot.racers.length ? tiebreak : makeTiebreakOrder(snapshot.seed, snapshot.racers.length),
  });
  engine.start();

  const raceStart = Date.now();
  let seq = 0;
  let sentFrames = 0;
  let sentBytes = 0;

  // 실제 시간에 맞춰 돌린다 — 프레임이 10Hz 로 나가야 지연을 잴 수 있다
  while (engine.status === 'running') {
    engine.step();
    if (engine.justFinished.length > 0) {
      void treq('host:finish', {
        roundId: snapshot.roundId,
        epoch: claim.epoch,
        entries: engine.justFinished.map((f) => ({
          racerIndex: f.racerIndex,
          rank: f.rank,
          timeMs: Math.round(f.timeMs),
          tiebroken: f.tiebroken,
        })),
      }).catch(() => undefined);
    }
    if (seq % 6 === 0) {
      const snap = engine.snapshot();
      const payload = JSON.stringify({
        t: 'host:frame',
        d: {
          roundId: snapshot.roundId,
          epoch: claim.epoch,
          seq,
          t: Math.round(engine.timeMs),
          sentAt: Date.now(),
          m: snap.m,
          d: snap.d,
          rank: snap.rank,
          fin: [],
        },
      });
      teacherWs.send(payload);
      sentFrames++;
      sentBytes += payload.length;
      // 10Hz 에 맞춰 잠깐 쉰다
      await sleep(100);
    }
    seq++;
  }

  await treq('host:complete', {
    roundId: snapshot.roundId,
    epoch: claim.epoch,
    reason: engine.status === 'timeout' ? 'timeout' : 'completed',
    assistCount: engine.assistCount,
  });

  const raceMs = Date.now() - raceStart;

  /* ---- 결과가 다 닿았는가 ---- */
  const untilResult = Date.now() + 20_000;
  while (Date.now() < untilResult && stats.some((s) => s.results.length === 0)) await sleep(50);
  const gotResult = stats.filter((s) => s.results.length > 0).length;
  const resultSpread = Math.max(...stats.filter((s) => s.resultAt > 0).map((s) => s.resultAt)) -
    Math.min(...stats.filter((s) => s.resultAt > 0).map((s) => s.resultAt));

  const sameEvent = teacherResult
    ? stats.filter((s) => s.results[0]?.eventId === (teacherResult as RoundResult).eventId).length
    : 0;

  /* ---- 보고 ---- */
  const allFrames = stats.map((s) => s.frames);
  const allBytes = stats.map((s) => s.bytes);
  const allLat = stats.flatMap((s) => s.latencies);

  console.log(`\n[3] 결과`);
  console.log(`    경기 길이           ${(raceMs / 1000).toFixed(1)}초 (물리 ${(engine.timeMs / 1000).toFixed(1)}초)`);
  console.log(`    교사→서버 프레임     ${sentFrames}장 · ${(sentBytes / 1024).toFixed(0)}KB`);
  console.log(
    `    학생이 받은 프레임   최소 ${Math.min(...allFrames)} · 중앙 ${percentile(allFrames, 0.5)} · 최대 ${Math.max(...allFrames)}`,
  );
  console.log(
    `    학생당 받은 양       중앙 ${(percentile(allBytes, 0.5) / 1024).toFixed(0)}KB · 최대 ${(Math.max(...allBytes) / 1024).toFixed(0)}KB`,
  );
  if (allLat.length > 0) {
    console.log(
      `    프레임 지연          중앙 ${percentile(allLat, 0.5)}ms · p95 ${percentile(allLat, 0.95)}ms · 최대 ${Math.max(...allLat)}ms`,
    );
  }
  console.log(`    결과 도달            ${gotResult}/${N}명 (같은 eventId ${sameEvent}명) · 퍼진 시간 ${resultSpread}ms`);

  for (const ws of sockets) ws.close();
  teacherWs.close();

  const ok = gotResult === N && sameEvent === N;
  console.log(`\n${ok ? '통과' : '실패'} — 전원이 같은 결과를 받았는가: ${ok ? '예' : '아니오'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('부하 시험 중 오류:', err);
  process.exit(1);
});
