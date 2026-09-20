/**
 * 연동(임베드) 보안 경계 검사.
 *
 *   npm run test:embed
 *
 * 먼저 두 서버를 띄워 두어야 한다:
 *   npm run dev:worker      (apps/worker, .dev.vars 에 INTEGRATION_SECRETS 필요)
 *   npm run dev:host        (examples/host-app)
 *
 * 무엇을 보는가 (요구사항 9):
 *  - 부모 서버가 발급한 티켓으로만 들어갈 수 있다
 *  - 서명이 틀린 티켓 · 만료된 티켓 · 다른 활동의 티켓을 거절한다
 *  - 브라우저가 보낸 role 글자만으로 교사가 되지 않는다
 *  - 연동 방은 공유 비밀 없이 만들 수 없다
 *  - 결과 webhook 은 서명이 맞아야만 기록된다
 */

import { createHmac, randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.ts';

const WORKER = process.env.ACTIVITY_ORIGIN ?? 'http://127.0.0.1:8787';
const HOST = process.env.HOST_APP ?? 'http://127.0.0.1:5180';
const SECRET = process.env.SHARED_SECRET ?? 'local-dev-secret-change-me-0123456789';
const INTEGRATION_ID = 'demo-class';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const b64url = (s: string): string => Buffer.from(s).toString('base64url');

function makeTicket(
  claims: Record<string, unknown>,
  secret = SECRET,
): string {
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function baseClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    iss: 'example-host-app',
    aud: 'classroom-marble-race',
    integrationId: INTEGRATION_ID,
    sessionId: 'class-1:lesson-3',
    activityId: 'activity-x',
    roomCode: 'AAAAAA',
    sub: 'u-999',
    name: '검사용',
    role: 'student',
    origin: HOST,
    iat: now,
    exp: now + 60_000,
    jti: randomUUID(),
    ...over,
  };
}

/** 방에 붙어 hello 를 보내고, 받아들여졌는지만 본다 */
async function tryHello(
  code: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; role?: string; reason?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WORKER.replace(/^http/, 'ws')}/ws?code=${code}`);
    const done = (r: { ok: boolean; role?: string; reason?: string }) => {
      try {
        ws.close();
      } catch {
        /* 이미 닫힘 */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 8000);
    ws.onerror = () => {
      clearTimeout(timer);
      done({ ok: false, reason: 'ws error' });
    };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', i: 'h', d: { protocolVersion: PROTOCOL_VERSION, ...payload } }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { t: string; i?: string; d?: Record<string, unknown> };
      if (m.i !== 'h') return;
      clearTimeout(timer);
      if (m.t === 'ack') done({ ok: true, role: m.d?.role as string });
      else done({ ok: false, reason: (m.d?.message as string) ?? 'nack' });
    };
  });
}

async function main(): Promise<void> {
  console.log(`활동 앱 ${WORKER} · 수업 앱 ${HOST}\n`);

  /* ---- 연동 방 만들기 권한 ---- */
  console.log('[1] 연동 방 만들기');
  const noSecret = await fetch(`${WORKER}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ integrationId: INTEGRATION_ID, activityId: 'x' }),
  });
  check('공유 비밀 없이는 연동 방을 못 만든다', noSecret.status === 401, `status ${noSecret.status}`);

  const wrongSecret = await fetch(`${WORKER}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-marble-secret': 'nope-nope-nope-nope-nope' },
    body: JSON.stringify({ integrationId: INTEGRATION_ID, activityId: 'x' }),
  });
  check('틀린 비밀로도 못 만든다', wrongSecret.status === 401, `status ${wrongSecret.status}`);

  const unknown = await fetch(`${WORKER}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-marble-secret': SECRET },
    body: JSON.stringify({ integrationId: '없는연동', activityId: 'x' }),
  });
  check('등록되지 않은 연동 id 를 거절한다', unknown.status === 400, `status ${unknown.status}`);

  const activityId = `test:${Date.now().toString(36)}`;
  const created = await fetch(`${WORKER}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-marble-secret': SECRET },
    body: JSON.stringify({ capacity: 30, integrationId: INTEGRATION_ID, activityId }),
  });
  check('올바른 비밀로는 만들 수 있다', created.ok, `status ${created.status}`);
  const room = (await created.json()) as { joinCode: string; teacherToken: string };
  const code = room.joinCode;
  console.log(`    방 ${code}`);

  /* ---- 티켓 검증 ---- */
  console.log('\n[2] 티켓');

  const good = await tryHello(code, { role: 'student', ticket: makeTicket(baseClaims({ roomCode: code, activityId })) });
  check('올바른 학생 티켓은 통과한다', good.ok && good.role === 'student', good.reason);

  const badSig = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId }), '엉뚱한-비밀-0123456789'),
  });
  check('서명이 틀린 티켓을 거절한다', !badSig.ok, badSig.reason);

  const expired = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, exp: Date.now() - 1000 })),
  });
  check('만료된 티켓을 거절한다', !expired.ok, expired.reason);

  const otherActivity = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId: '지난-활동' })),
  });
  check('지난 활동의 티켓을 거절한다', !otherActivity.ok, otherActivity.reason);

  const otherAud = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, aud: '다른-앱' })),
  });
  check('다른 앱을 가리키는 티켓을 거절한다', !otherAud.ok, otherAud.reason);

  const wrongOrigin = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, origin: 'https://남의사이트.example' })),
  });
  check('등록되지 않은 주소에서 나온 티켓을 거절한다', !wrongOrigin.ok, wrongOrigin.reason);

  const unknownIntegration = await tryHello(code, {
    role: 'student',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, integrationId: '없는연동' })),
  });
  check('모르는 연동의 티켓을 거절한다', !unknownIntegration.ok, unknownIntegration.reason);

  /* ---- 권한 상승 ---- */
  console.log('\n[3] 권한');

  const fakeTeacherByString = await tryHello(code, { role: 'teacher' });
  check('role 글자만으로는 교사가 되지 않는다', !fakeTeacherByString.ok, fakeTeacherByString.reason);

  // 학생 티켓을 들고 교사라고 주장해도 학생이어야 한다
  const studentClaimingTeacher = await tryHello(code, {
    role: 'teacher',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, role: 'student' })),
  });
  check(
    '학생 티켓으로 교사 화면을 달라고 해도 학생 권한만 준다',
    studentClaimingTeacher.ok && studentClaimingTeacher.role === 'student',
    `role=${studentClaimingTeacher.role} ${studentClaimingTeacher.reason ?? ''}`,
  );

  const realTeacher = await tryHello(code, {
    role: 'teacher',
    ticket: makeTicket(baseClaims({ roomCode: code, activityId, role: 'teacher', sub: 'teacher-1' })),
  });
  check('서명된 교사 티켓은 교사 권한을 받는다', realTeacher.ok && realTeacher.role === 'teacher', realTeacher.reason);

  /* ---- 결과 webhook ---- */
  console.log('\n[4] 결과 webhook');

  const envelope = {
    type: 'marble-race.round-finished',
    sentAt: Date.now(),
    room: { code, roomId: 'r', integrationId: INTEGRATION_ID, activityId: 'activity-그른것' },
    result: { roundId: 'x', revision: 1, winners: [], selectionMode: 'physics', outcome: 'completed', finalizedAt: Date.now() },
  };
  const body = JSON.stringify(envelope);

  const unsigned = await fetch(`${HOST}/api/activity/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const unsignedBody = (await unsigned.json()) as { ok: boolean; reason?: string };
  check('서명 없는 결과는 기록되지 않는다', unsignedBody.ok === false && unsignedBody.reason === 'bad_signature');

  const wrongSig = await fetch(`${HOST}/api/activity/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-marble-signature': 'sha256=00' },
    body,
  });
  const wrongSigBody = (await wrongSig.json()) as { ok: boolean; reason?: string };
  check('서명이 틀린 결과는 기록되지 않는다', wrongSigBody.ok === false);

  const signedStale = await fetch(`${HOST}/api/activity/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-marble-signature': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
    },
    body,
  });
  const staleBody = (await signedStale.json()) as { ok: boolean; reason?: string };
  check('서명은 맞지만 지난 활동의 결과는 기록되지 않는다', staleBody.ok === false && staleBody.reason === 'stale_activity');

  console.log('');
  if (failures.length === 0) {
    console.log(`통과 ${passed}건, 실패 0건`);
  } else {
    console.log(`통과 ${passed}건, 실패 ${failures.length}건:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('검사 중 오류:', err);
  process.exit(1);
});
