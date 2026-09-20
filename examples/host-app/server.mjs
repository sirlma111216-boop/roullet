/**
 * 예제 «수업 앱» 의 서버.
 *
 * 이 작은 서버가 부모 수업 앱을 흉내 낸다. 하는 일은 네 가지다.
 *
 *  1. 방을 만든다        — 공유 비밀로 활동 앱의 /api/rooms 를 부른다(브라우저가 아니라 **서버**가)
 *  2. 티켓을 발급한다     — 학생·교사의 신원을 서명해 건넨다
 *  3. 결과를 받는다       — 활동 앱이 서명해 보낸 webhook 을 검증하고 기록한다
 *  4. 화면을 내보낸다     — SDK 로 iframe 을 띄우는 예제 페이지
 *
 * ★ 공유 비밀은 **이 서버에만** 있다. 브라우저로 내려보내지 않는다.
 *   브라우저에서 티켓을 만들 수 있게 두면, 누구나 교사 티켓을 찍어 낼 수 있다.
 *
 *   node server.mjs
 *   환경 변수:
 *     PORT                기본 5180
 *     ACTIVITY_ORIGIN     활동 앱 주소 (기본 http://127.0.0.1:8787)
 *     INTEGRATION_ID      기본 demo-class
 *     SHARED_SECRET       활동 앱의 INTEGRATION_SECRETS 에 넣은 것과 **같은 값**
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 5180);
const ACTIVITY_ORIGIN = process.env.ACTIVITY_ORIGIN ?? 'http://127.0.0.1:8787';
const INTEGRATION_ID = process.env.INTEGRATION_ID ?? 'demo-class';
const SHARED_SECRET = process.env.SHARED_SECRET ?? 'local-dev-secret-change-me-0123456789';

/** 이 예제의 «수업» 한 칸. 진짜 앱이라면 데이터베이스에 있을 것이다. */
const lesson = {
  classId: 'class-1',
  lessonId: 'lesson-3',
  /** 이 활동 실행 한 번을 가리키는 id. 같은 차시를 두 번 해도 구분된다. */
  activityId: null,
  roomCode: null,
  /** 활동 앱이 준 교사 토큰. **브라우저로 내려보내지 않는다.** */
  teacherToken: null,
  /** 수업 앱이 이미 들고 있는 학생 명단(실명이 아니라 표시 이름) */
  roster: [
    { id: 'u-101', name: '김하늘' },
    { id: 'u-102', name: '박서준' },
    { id: 'u-103', name: '이도윤' },
    { id: 'u-104', name: '최지우' },
    { id: 'u-105', name: '정민서' },
    { id: 'u-106', name: '강예린' },
    { id: 'u-107', name: '조하준' },
    { id: 'u-108', name: '윤서아' },
  ],
  /** 활동 앱이 서명해 보내 준 결과 — 이것만 발표자로 믿는다 */
  confirmedResults: new Map(),
};

/* ------------------------------------------------------------------ 티켓 */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signTicket(claims) {
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', SHARED_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** 한 수업 시간. 경기 중 새로고침해도 같은 티켓으로 다시 들어와야 한다. */
const TICKET_TTL_MS = 120 * 60 * 1000;

function makeTicket({ sub, name, role }) {
  const now = Date.now();
  return signTicket({
    iss: 'example-host-app',
    aud: 'classroom-marble-race',
    integrationId: INTEGRATION_ID,
    sessionId: `${lesson.classId}:${lesson.lessonId}`,
    activityId: lesson.activityId,
    roomCode: lesson.roomCode,
    sub,
    name: String(name).slice(0, 18),
    role,
    origin: `http://127.0.0.1:${PORT}`,
    iat: now,
    exp: now + TICKET_TTL_MS,
    jti: randomUUID(),
  });
}

/* ------------------------------------------------------------------ 방 만들기 */

async function ensureRoom() {
  if (lesson.roomCode) return { roomCode: lesson.roomCode, reused: true };

  lesson.activityId = `${lesson.classId}:${lesson.lessonId}:${Date.now().toString(36)}`;

  const res = await fetch(`${ACTIVITY_ORIGIN}/api/rooms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // 연동 방은 서버만 만들 수 있다 — 공유 비밀로 증명한다
      'x-marble-secret': SHARED_SECRET,
    },
    body: JSON.stringify({
      capacity: 60,
      integrationId: INTEGRATION_ID,
      activityId: lesson.activityId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`활동 앱이 방을 만들어 주지 않았습니다 (${res.status}): ${text}`);
  }
  const room = await res.json();
  lesson.roomCode = room.joinCode;
  lesson.teacherToken = room.teacherToken; // 서버에만 둔다
  return { roomCode: room.joinCode, reused: false };
}

/* ------------------------------------------------------------------ HTTP */

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    /* ---- 화면 ---- */
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(join(HERE, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html.replaceAll('__ACTIVITY_ORIGIN__', ACTIVITY_ORIGIN).replaceAll('__INTEGRATION_ID__', INTEGRATION_ID));
      return;
    }
    // 서버가 필요 없는 모드 데모 — 이 경로는 서버 쪽 코드를 하나도 쓰지 않는다
    if (req.method === 'GET' && url.pathname === '/local') {
      const html = await readFile(join(HERE, 'local.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/sdk.js') {
      // 저장소에서 바로 읽어 내보낸다(예제라서 이렇게 한다).
      // 진짜 수업 앱이라면 제 번들러로 @marble/embed-sdk 를 가져다 쓰면 된다.
      // SDK 는 apps/web/public/sdk 로 빌드된다(활동 앱이 그대로 내보내는 자리).
      // 옛 경로(packages/embed-sdk/dist)를 읽으면 낡은 번들을 조용히 내보내게 된다.
      const sdkPath = join(HERE, '../../apps/web/public/sdk/marble-race-sdk.js');
      const js = await readFile(sdkPath, 'utf8').catch(() => null);
      if (!js) {
        return json(res, 500, {
          error: 'SDK 번들이 없습니다. 먼저 npm run build --workspace=packages/embed-sdk 를 하세요.',
        });
      }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(js);
      return;
    }

    /* ---- 수업 정보 ---- */
    if (req.method === 'GET' && url.pathname === '/api/lesson') {
      return json(res, 200, {
        classId: lesson.classId,
        lessonId: lesson.lessonId,
        activityId: lesson.activityId,
        roomCode: lesson.roomCode,
        roster: lesson.roster,
        activityOrigin: ACTIVITY_ORIGIN,
        integrationId: INTEGRATION_ID,
        // 비밀도 교사 토큰도 절대 내보내지 않는다
        confirmed: [...lesson.confirmedResults.values()],
      });
    }

    /* ---- 활동 시작: 방을 만들고 교사 티켓을 준다 ---- */
    if (req.method === 'POST' && url.pathname === '/api/activity/start') {
      const room = await ensureRoom();
      const ticket = makeTicket({ sub: 'teacher-1', name: '선생님', role: 'teacher' });
      return json(res, 200, { ...room, ticket, activityId: lesson.activityId, roster: lesson.roster });
    }

    /* ---- 학생 티켓 ---- */
    if (req.method === 'POST' && url.pathname === '/api/activity/student-ticket') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const student = lesson.roster.find((s) => s.id === body.studentId);
      // 명단에 있는 학생에게만 준다. 브라우저가 보낸 이름은 쓰지 않는다.
      if (!student) return json(res, 403, { error: '이 수업의 학생이 아닙니다.' });
      if (!lesson.roomCode) return json(res, 409, { error: '아직 활동이 시작되지 않았습니다.' });
      const ticket = makeTicket({ sub: student.id, name: student.name, role: 'student' });
      return json(res, 200, { ticket });
    }

    /* ---- 활동 앱이 서명해 보낸 결과 ---- */
    if (req.method === 'POST' && url.pathname === '/api/activity/result') {
      const raw = await readBody(req);
      const header = req.headers['x-marble-signature'] ?? '';
      const expected = `sha256=${createHmac('sha256', SHARED_SECRET).update(raw).digest('hex')}`;

      // ★ 서명은 **파싱하기 전 원문**에 대해 검사한다
      const a = Buffer.from(String(header));
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        console.warn('[결과] 서명이 맞지 않아 버렸습니다.');
        // 영구 거절이므로 다시 보내지 말라는 뜻으로 200 + ok:false
        return json(res, 200, { ok: false, reason: 'bad_signature' });
      }

      const envelope = JSON.parse(raw.toString());
      if (envelope.room?.activityId !== lesson.activityId) {
        console.warn('[결과] 지난 활동의 결과라 버렸습니다.');
        return json(res, 200, { ok: false, reason: 'stale_activity' });
      }

      // 멱등 — (roundId, revision) 으로 한 번만 기록한다
      const key = `${envelope.result.roundId}:${envelope.result.revision}`;
      if (lesson.confirmedResults.has(key)) {
        return json(res, 200, { ok: true, duplicate: true });
      }
      lesson.confirmedResults.set(key, {
        key,
        roundId: envelope.result.roundId,
        revision: envelope.result.revision,
        selectionMode: envelope.result.selectionMode,
        outcome: envelope.result.outcome,
        winners: envelope.result.winners.map((w) => ({
          rank: w.rank,
          name: w.nickname,
          award: w.award?.label ?? null,
          reason: w.selectionReason,
        })),
        finalizedAt: envelope.result.finalizedAt,
      });
      console.log(
        `[결과] ${envelope.result.roundId} 판${envelope.result.revision} — 당첨 ${envelope.result.winners
          .map((w) => w.nickname)
          .join(', ')}`,
      );
      return json(res, 200, { ok: true });
    }

    /* ---- 활동 정리 ---- */
    if (req.method === 'POST' && url.pathname === '/api/activity/reset') {
      lesson.roomCode = null;
      lesson.activityId = null;
      lesson.teacherToken = null;
      lesson.confirmedResults.clear();
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: '없는 주소입니다.' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err instanceof Error ? err.message : '알 수 없는 오류' });
  }
});

server.listen(PORT, () => {
  console.log(`예제 수업 앱: http://127.0.0.1:${PORT}`);
  console.log(`활동 앱: ${ACTIVITY_ORIGIN} · 연동 id: ${INTEGRATION_ID}`);
  if (SHARED_SECRET.startsWith('local-dev')) {
    console.log('※ 지금은 개발용 비밀을 쓰고 있습니다. 운영에서는 SHARED_SECRET 을 반드시 바꾸세요.');
  }
});
