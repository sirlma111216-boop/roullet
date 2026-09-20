/**
 * 실제 서버에 붙어 한 판을 끝까지 돌려 보는 검사.
 *
 *   npm run e2e                     — 기본(학생 4명)
 *   npm run e2e -- --students 12
 *   npm run e2e -- --base http://127.0.0.1:8787
 *
 * 먼저 서버를 띄워 두어야 한다:  npm run dev:worker
 *
 * 무엇을 보는가 (요구사항 1·5·6):
 *  1. 교사 1명 + **서로 다른 연결** 의 학생 여러 명이 같은 라운드 결과를 받는다
 *  5. 늦은 입장 · 학생 재연결 · 교사 연결 끊김에서 정해 둔 대로 움직인다
 *  6. 중복 시작 · 중복 결과 · 지난 roundId · 호스트 lease 충돌 · 조작된 학생 메시지를 막는다
 *
 * 물리는 여기서 game-core 로 직접 돌린다 — 교사 브라우저가 하는 일과 같은 코드다.
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
const STUDENTS = Number(arg('students', '4'));
const MAP_ID = arg('map', 'classic-bubble');

/* ------------------------------------------------------------------ 결과 모으기 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ 작은 클라이언트 */

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
}

class Client {
  private ws!: WebSocket;
  private pending = new Map<string, Pending>();
  private seq = 0;
  readonly events: Array<{ t: string; d: unknown }> = [];
  readonly results: RoundResult[] = [];
  readonly frames: unknown[] = [];
  countdown: { roundId: string; startsAt: number; snapshot: RuleSnapshot } | null = null;
  rejoinToken: string | null = null;
  participantId: string | null = null;
  closed = false;

  readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  async connect(code: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws?code=${code}`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error(`${this.label}: 연결 실패`));
      this.ws.onclose = () => {
        this.closed = true;
      };
      this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    });
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw) as { t: string; i?: string; d?: unknown };
    if ((msg.t === 'ack' || msg.t === 'nack') && msg.i) {
      const p = this.pending.get(msg.i);
      if (!p) return;
      this.pending.delete(msg.i);
      if (msg.t === 'ack') p.resolve(msg.d);
      else {
        const e = msg.d as { code: string; message: string };
        const err = new Error(e.message) as Error & { code?: string };
        err.code = e.code;
        p.reject(err);
      }
      return;
    }
    this.events.push({ t: msg.t, d: msg.d });
    if (msg.t === 'result') this.results.push(msg.d as RoundResult);
    if (msg.t === 'frame') this.frames.push(msg.d);
    if (msg.t === 'countdown') this.countdown = msg.d as Client['countdown'];
  }

  request(t: string, d: unknown): Promise<unknown> {
    const i = `${this.label}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(i);
        reject(new Error(`${this.label}: ${t} 응답 없음`));
      }, 10_000);
      this.pending.set(i, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ t, i, d }));
    });
  }

  send(t: string, d: unknown): void {
    this.ws.send(JSON.stringify({ t, d }));
  }

  async hello(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ack = (await this.request('hello', { protocolVersion: PROTOCOL_VERSION, ...payload })) as Record<
      string,
      unknown
    >;
    this.rejoinToken = (ack.rejoinToken as string | null) ?? null;
    this.participantId = ((ack.me as { id?: string } | null)?.id as string) ?? null;
    return ack;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* 이미 닫힘 */
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 어떤 일이 일어날 때까지 기다린다 */
async function waitFor(what: string, fn: () => boolean, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error(`기다리다 지쳤습니다: ${what}`);
}

/* ------------------------------------------------------------------ 본문 */

async function main(): Promise<void> {
  console.log(`서버 ${BASE} · 학생 ${STUDENTS}명 · 맵 ${MAP_ID}\n`);

  /* ---- 방 만들기 ---- */
  const created = (await (
    await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capacity: 100 }),
    })
  ).json()) as { joinCode: string; teacherToken: string };
  const code = created.joinCode;
  console.log(`[1] 방 ${code}\n`);

  /* ---- 교사 ---- */
  const teacher = new Client('T');
  await teacher.connect(code);
  const tAck = await teacher.hello({ role: 'teacher', teacherToken: created.teacherToken });
  check('교사가 토큰으로 들어간다', tAck.role === 'teacher');

  // 토큰 없이 교사를 주장하면 거절되어야 한다
  const faker = new Client('X');
  await faker.connect(code);
  let deniedTeacher = false;
  try {
    await faker.hello({ role: 'teacher' });
  } catch {
    deniedTeacher = true;
  }
  check('토큰 없는 교사 주장은 거절된다', deniedTeacher);
  faker.close();

  /* ---- 학생들 (각자 다른 연결) ---- */
  const students: Client[] = [];
  for (let i = 0; i < STUDENTS; i++) {
    const s = new Client(`S${i}`);
    await s.connect(code);
    await s.hello({ role: 'student', nickname: `학생${i + 1}` });
    students.push(s);
  }
  check(
    `학생 ${STUDENTS}명이 각자의 연결로 들어간다`,
    students.every((s) => s.participantId !== null),
  );
  check(
    '학생마다 서로 다른 참가자 id 를 받는다',
    new Set(students.map((s) => s.participantId)).size === STUDENTS,
  );

  /* ---- 학생이 교사 권한 메시지를 보내면 거절 ---- */
  let studentStartDenied = false;
  try {
    await students[0]!.request('teacher:start', { countdownSec: 0 });
  } catch (err) {
    studentStartDenied = (err as { code?: string }).code === 'not_authorized';
  }
  check('학생의 teacher:start 는 거절된다', studentStartDenied);

  let studentRosterDenied = false;
  try {
    await students[0]!.request('teacher:roster', { commands: [{ op: 'lock', locked: true }] });
  } catch (err) {
    studentRosterDenied = (err as { code?: string }).code === 'not_authorized';
  }
  check('학생의 명단 변경은 거절된다', studentRosterDenied);

  /* ---- 호스트 lease ---- */
  const claim = (await teacher.request('host:claim', { runtimeId: 'runtime-A' })) as { epoch: number };
  check('교사가 호스트 자리를 잡는다', claim.epoch >= 1);

  // 학생은 호스트가 될 수 없다
  let studentClaimDenied = false;
  try {
    await students[0]!.request('host:claim', { runtimeId: 'runtime-EVIL' });
  } catch (err) {
    studentClaimDenied = (err as { code?: string }).code === 'not_authorized';
  }
  check('학생은 호스트가 될 수 없다', studentClaimDenied);

  /* ---- 설정 ---- */
  await teacher.request('teacher:config', {
    config: {
      mapId: MAP_ID,
      rule: { kind: 'topK', k: 3 },
      excludedParticipantIds: [],
      excludePreviousWinners: false,
      useSkills: false,
      awards: [
        { id: 'a', label: '발표자', slot: 0 },
        { id: 'b', label: '정리 도우미', slot: 1 },
      ],
      allowDuplicateAwards: false,
    },
  });

  // 잘못된 규칙은 거절
  let badRuleRejected = false;
  try {
    await teacher.request('teacher:config', {
      config: { mapId: MAP_ID, rule: { kind: 'range', from: 5, to: 2 } },
    });
  } catch (err) {
    badRuleRejected = (err as { code?: string }).code === 'bad_rule';
  }
  check('역전된 순위 범위를 서버가 거절한다', badRuleRejected);

  // 위 실패가 설정을 망가뜨리지 않았는지 확인 겸 다시 세운다
  await teacher.request('teacher:config', {
    config: {
      mapId: MAP_ID,
      rule: { kind: 'topK', k: 3 },
      excludedParticipantIds: [],
      excludePreviousWinners: false,
      useSkills: false,
      awards: [{ id: 'a', label: '발표자', slot: 0 }],
      allowDuplicateAwards: false,
    },
  });

  /* ---- 시작 ---- */
  console.log('\n[2] 라운드 시작');
  const started = (await teacher.request('teacher:start', { countdownSec: 0 })) as {
    roundId: string;
    snapshot: RuleSnapshot;
  };
  const snapshot = started.snapshot;
  check('라운드 스냅샷이 만들어진다', Boolean(snapshot?.roundId));
  check('스냅샷에 타이브레이커 순서가 있다', snapshot.tiebreakOrder.length === snapshot.racers.length);
  check('스냅샷의 참가자 수가 학생 수와 같다', snapshot.racers.length === STUDENTS);

  // 중복 시작 요청
  const again = (await teacher.request('teacher:start', { countdownSec: 0 })) as { alreadyRunning?: boolean };
  check('중복 시작 요청은 지금 라운드를 그대로 알려 준다', again.alreadyRunning === true);

  // 학생들이 카운트다운을 받았는지
  await waitFor('학생들이 카운트다운을 받음', () => students.every((s) => s.countdown?.roundId === snapshot.roundId));
  check('모든 학생이 같은 라운드의 카운트다운을 받는다', true);

  /* ---- 물리 돌리기 (교사 브라우저가 하는 일) ---- */
  console.log('[3] 물리 시뮬레이션 + 프레임 중계');
  const map = requireMap(snapshot.mapId);
  const indexOf = new Map(snapshot.racers.map((r, i) => [r.participantId, i]));
  const tiebreak = snapshot.tiebreakOrder.map((id) => indexOf.get(id)!).filter((v) => v !== undefined);
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

  let seq = 0;
  let staleTested = false;
  let epochTested = false;

  while (engine.status === 'running') {
    engine.step();

    if (engine.justFinished.length > 0) {
      await teacher.request('host:finish', {
        roundId: snapshot.roundId,
        epoch: claim.epoch,
        entries: engine.justFinished.map((f) => ({
          racerIndex: f.racerIndex,
          rank: f.rank,
          timeMs: Math.round(f.timeMs),
          tiebroken: f.tiebroken,
        })),
      });
    }

    // 6번 스텝마다 프레임(=10Hz)
    if (seq % 6 === 0) {
      const snap = engine.snapshot();
      teacher.send('host:frame', {
        roundId: snapshot.roundId,
        epoch: claim.epoch,
        seq: seq,
        t: Math.round(engine.timeMs),
        m: snap.m,
        d: snap.d,
        rank: snap.rank,
        fin: [],
      });
    }
    seq++;

    // 경기 도중에 몇 가지 «나쁜 메시지» 를 끼워 본다
    if (!staleTested && seq === 60) {
      staleTested = true;
      let rejected = false;
      try {
        await teacher.request('host:finish', {
          roundId: 'round-없는것',
          epoch: claim.epoch,
          entries: [{ racerIndex: 0, rank: 1, timeMs: 1, tiebroken: false }],
        });
      } catch (err) {
        rejected = (err as { code?: string }).code === 'stale_round';
      }
      check('지난 roundId 의 도착 기록을 거절한다', rejected);
    }
    if (!epochTested && seq === 90) {
      epochTested = true;
      let rejected = false;
      try {
        await teacher.request('host:finish', {
          roundId: snapshot.roundId,
          epoch: claim.epoch + 99,
          entries: [{ racerIndex: 0, rank: 1, timeMs: 1, tiebroken: false }],
        });
      } catch (err) {
        rejected = (err as { code?: string }).code === 'stale_epoch';
      }
      check('지난 호스트 세대(epoch)의 기록을 거절한다', rejected);

      // 학생이 호스트인 척 프레임을 보내도 중계되지 않아야 한다
      const before = students[1]!.frames.length;
      students[1]!.send('host:frame', {
        roundId: snapshot.roundId,
        epoch: claim.epoch,
        seq: 999_999,
        t: 0,
        m: [],
        d: [],
        rank: [],
        fin: [],
      });
      await sleep(300);
      check('학생이 보낸 프레임은 중계되지 않는다', students[1]!.frames.length >= before);
    }

    // 늦게 들어온 학생은 이번 경기를 관전만 한다
    if (seq === 120) {
      const late = new Client('LATE');
      await late.connect(code);
      await late.hello({ role: 'student', nickname: '늦은학생' });
      check('경기 중에도 새 학생이 들어올 수 있다', late.participantId !== null);
      check(
        '늦게 온 학생은 이번 라운드 명단에 없다',
        !snapshot.racers.some((r) => r.participantId === late.participantId),
      );
      students.push(late);
    }

    // 학생 하나가 끊겼다 다시 붙는다
    if (seq === 150) {
      const s = students[2]!;
      const token = s.rejoinToken;
      const pid = s.participantId;
      s.close();
      await sleep(200);
      const back = new Client('S2-again');
      await back.connect(code);
      const ack = await back.hello({ role: 'student', rejoinToken: token });
      check(
        '끊겼던 학생이 같은 참가자로 돌아온다',
        (ack.me as { id?: string } | null)?.id === pid,
        `기대 ${pid}, 실제 ${(ack.me as { id?: string } | null)?.id}`,
      );
      students[2] = back;
    }
  }

  console.log(`    물리 끝: ${engine.status}, ${engine.finishedCount}명 도착, ${(engine.timeMs / 1000).toFixed(1)}초`);

  /* ---- 완료 ---- */
  const completed = (await teacher.request('host:complete', {
    roundId: snapshot.roundId,
    epoch: claim.epoch,
    reason: engine.status === 'timeout' ? 'timeout' : 'completed',
    assistCount: engine.assistCount,
  })) as { roundId: string; revision: number };
  check('서버가 결과를 확정한다', completed.revision === 1);

  // 중복 완료 — 멱등
  const dup = (await teacher.request('host:complete', {
    roundId: snapshot.roundId,
    epoch: claim.epoch,
    reason: 'completed',
    assistCount: 0,
  })) as { alreadyFinalized?: boolean };
  check('같은 라운드의 두 번째 완료는 멱등하게 처리된다', dup.alreadyFinalized === true);

  /* ---- 모두가 같은 결과를 받았는가 ---- */
  console.log('\n[4] 결과 확인');
  const racerStudents = students.filter((s) => snapshot.racers.some((r) => r.participantId === s.participantId));
  await waitFor('학생들이 결과를 받음', () => racerStudents.every((s) => s.results.length > 0), 15_000);

  const teacherResult = teacher.results[teacher.results.length - 1];
  check('교사가 결과를 받는다', Boolean(teacherResult));

  const allSame = racerStudents.every((s) => {
    const r = s.results[s.results.length - 1];
    return r && r.roundId === teacherResult!.roundId && r.eventId === teacherResult!.eventId;
  });
  check(`학생 ${racerStudents.length}명이 교사와 똑같은 결과(eventId)를 받는다`, allSame);

  const winnersSame = racerStudents.every((s) => {
    const r = s.results[s.results.length - 1]!;
    return JSON.stringify(r.winners) === JSON.stringify(teacherResult!.winners);
  });
  check('당첨자 목록이 모든 화면에서 같다', winnersSame);

  check('규칙대로 3명이 뽑혔다', teacherResult!.winners.length === Math.min(3, snapshot.racers.length));
  check('첫 당첨자에게 항목이 붙었다', teacherResult!.winners[0]?.award?.label === '발표자');
  check(
    '도착 순위가 1부터 빠짐없이 이어진다',
    teacherResult!.finishOrder.every((f, i) => f.rank === i + 1),
  );
  check('결과에 어떤 화면도 스스로 정하지 않았음이 남는다', teacherResult!.selectionMode === 'physics');

  /* ---- 인증된 조회 ---- */
  const fetched = await fetch(`${BASE}/api/rooms/${code}/results/${snapshot.roundId}`, {
    headers: { authorization: `Bearer ${created.teacherToken}` },
  });
  const fetchedBody = (await fetched.json()) as { result?: RoundResult };
  check('교사 토큰으로 결과를 다시 조회할 수 있다', fetchedBody.result?.roundId === snapshot.roundId);

  const unauth = await fetch(`${BASE}/api/rooms/${code}/results/${snapshot.roundId}`);
  check('토큰 없이는 결과를 조회할 수 없다', unauth.status === 404);

  /* ---- 교사 연결이 끊기면 ---- */
  console.log('\n[5] 교사 연결 끊김');
  const teacher2 = new Client('T2');
  await teacher2.connect(code);
  await teacher2.hello({ role: 'teacher', teacherToken: created.teacherToken });
  // 새 런타임 id 로 잡으면 «새로고침» 과 같다
  const claim2 = (await teacher2.request('host:claim', { runtimeId: 'runtime-B' })) as { epoch: number };
  check('다른 런타임이 호스트를 잡으면 세대가 올라간다', claim2.epoch > claim.epoch);

  let oldHostRejected = false;
  try {
    await teacher.request('host:complete', {
      roundId: snapshot.roundId,
      epoch: claim.epoch,
      reason: 'completed',
      assistCount: 0,
    });
  } catch (err) {
    oldHostRejected = ['stale_epoch', 'stale_round'].includes((err as { code?: string }).code ?? '');
  }
  check('옛 호스트의 메시지는 거절된다', oldHostRejected);

  /* ---- 정리 ---- */
  for (const s of students) s.close();
  teacher.close();
  teacher2.close();

  console.log('');
  if (failed === 0) {
    console.log(`통과 ${passed}건, 실패 0건`);
  } else {
    console.log(`통과 ${passed}건, 실패 ${failed}건:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\n검사 중 오류:', err);
  process.exit(1);
});
