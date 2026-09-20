# 다른 수업 앱에 붙이기

돌아가는 예제가 `examples/host-app` 에 있습니다. 이 문서는 그 예제가 하는 일을 설명합니다.

---

## 한눈에

```
부모 수업 앱                        구슬 레이스
─────────────                      ──────────────
[서버] 방 만들기 ───공유 비밀───▶ POST /api/rooms   → { joinCode, teacherToken }
[서버] 티켓 서명
[화면] SDK 로 iframe 띄우기 ◀──── available ────
       mount(티켓) ──────────────▶ 티켓 검증 → 역할 부여
                          ◀───── ready
       setParticipants() ────────▶ 명단
       setConfig() ──────────────▶ 맵·규칙
       startRound() ─────────────▶ 경기
                          ◀───── roundStarted / roundFinished (화면용)
[서버] ◀──── 서명된 webhook ────── 확정 결과  ★ 이것만 기록한다
```

**★ 이 한 줄이 핵심입니다.** `roundFinished` 로 오는 결과는 학생 브라우저를 거치므로
손댈 수 있습니다. 실제로 발표자를 기록할 때는 서명된 webhook(또는 `verifyUrl` 을
부모 **서버**에서 조회한 값)만 쓰세요.

---

## 1. 준비

양쪽에 **같은 비밀**을 둡니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| 어디 | 이름 | 값 |
|---|---|---|
| 구슬 레이스 (Worker secret) | `INTEGRATION_SECRETS` | `{"수업앱id":{"secret":"<위 값>","resultUrl":"https://수업앱/api/.../result","origins":["https://수업앱"]}}` |
| 구슬 레이스 (`wrangler.jsonc` vars) | `EMBED_ALLOWED_ORIGINS` | `https://수업앱` |
| 부모 수업 앱 (서버 환경 변수) | `SHARED_SECRET` | `<위 값>` |

비밀은 **부모 앱 서버에만** 둡니다. 브라우저로 내려보내면 누구나 교사 티켓을 만들 수 있습니다.

---

## 2. 방 만들기 (부모 앱 **서버**)

```js
const res = await fetch(`${ACTIVITY_ORIGIN}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-marble-secret': SHARED_SECRET },
  body: JSON.stringify({
    capacity: 60,
    integrationId: 'demo-class',
    // 이 활동 실행 한 번을 가리키는 id. 같은 차시를 두 번 해도 구분되게.
    activityId: `${classId}:${lessonId}:${Date.now().toString(36)}`,
  }),
});
const { joinCode, teacherToken } = await res.json();
// teacherToken 은 서버에만 둔다 — 결과 조회 API 에 쓴다
```

비밀 없이 부르면 `401` 입니다.

---

## 3. 티켓 발급 (부모 앱 **서버**)

```
ticket = base64url(JSON) + '.' + base64url(HMAC-SHA256(secret, base64url(JSON)))
```

```js
import { createHmac, randomUUID } from 'node:crypto';

const claims = {
  iss: 'my-class-app',
  aud: 'classroom-marble-race',   // 고정
  integrationId: 'demo-class',
  sessionId: `${classId}:${lessonId}`,
  activityId,                      // 위에서 만든 것
  roomCode: joinCode,              // 위에서 받은 것
  sub: student.id,                 // 수업 앱의 **안정적인** 학생 id
  name: student.name.slice(0, 18), // 화면에 적을 이름
  role: 'student',                 // 또는 'teacher'
  origin: 'https://수업앱',
  iat: Date.now(),
  exp: Date.now() + 120 * 60 * 1000,  // 한 수업 시간
  jti: randomUUID(),
};
const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
const sig = createHmac('sha256', SHARED_SECRET).update(body).digest('base64url');
const ticket = `${body}.${sig}`;
```

### 발급할 때 지켜야 할 것

- **교사 티켓은 교사에게만.** 수업 앱의 강사 문서 등으로 확인한 뒤 발급합니다.
- **학생 티켓은 그 수업에 등록된 학생에게만.** 브라우저가 보낸 id·이름을 믿지 마세요.
- 유효 기간은 한 수업 시간. 경기 중 새로고침해도 같은 티켓으로 다시 들어와야 합니다.

구슬 레이스 서버는 **티켓 안의 값만** 씁니다. 브라우저가 따로 보낸 `role`·닉네임은 무시합니다.
그래서 학생 티켓으로 `view: 'teacher'` 를 달라고 해도 학생 권한만 받습니다.

---

## 4. iframe 띄우기 (부모 앱 화면)

```js
import { createMarbleRace } from '@marble/embed-sdk';
// 번들러가 없다면 배포된 파일 하나를 그대로 가져다 써도 됩니다:
// import { createMarbleRace } from 'https://구슬레이스/sdk/marble-race-sdk.js';

const race = createMarbleRace({
  activityOrigin: 'https://구슬레이스',
  integrationId: 'demo-class',
  ticket,                 // 서버에서 받아 온 것
  view: 'teacher',        // 또는 'student'
  hideJoinUi: true,       // 연동 모드에서는 코드·QR 상자를 숨긴다
});

race.on('available', (p) => {
  // 필요한 기능이 없으면 「옛 배포 — 다시 배포하세요」를 화면에 적는다
  const need = ['participants.set', 'round.start', 'result.signed-webhook'];
  const missing = need.filter((n) => !p.capabilities.includes(n));
  if (missing.length) showBanner(`활동 앱을 다시 배포해야 합니다: ${missing.join(', ')}`);
});

race.on('ready', (p) => enableControls(p));
race.on('participantsChanged', (p) => setLobbyCount(p.onlineCount, p.totalCount));
race.on('roundStarted', (p) => setStatus(`${p.snapshot.roundNumber}라운드 진행 중`));
race.on('roundFinished', (p) => setStatus('결과 확인 중…'));   // ★ 아직 기록하지 않는다
race.on('error', (p) => showBanner(`${p.code}: ${p.message}`)); // ★ 반드시 화면에 적는다

race.mount(document.getElementById('활동자리'));
```

정리할 때는 **반드시** `race.destroy()` 를 부르세요. iframe 을 통째로 버려 방·소켓이
두 개 생기는 것을 막습니다(React StrictMode 의 이중 마운트).

### 메서드

| 메서드 | 하는 일 |
|---|---|
| `mount(element)` | iframe 을 만든다. 핸들 하나에 한 번만. |
| `destroy()` | iframe 과 리스너를 정리한다. |
| `setParticipants([{ id, nickname, avatarColor? }])` | 명단을 넘긴다. |
| `setConfig({ mapId, rule, awards, useSkills, ... })` | 맵·규칙을 정한다. |
| `startRound(countdownSec?)` | 시작한다. |
| `cancelRound(reason?)` | 중단한다. |
| `resetRound()` | 쌓아 둔 변경과 화면을 비운다. |
| `getResult()` | 마지막 결과를 다시 묻는다(화면용). |
| `on(type, fn)` | 이벤트를 듣는다. 해제 함수를 돌려준다. |

**경기 중에 온 `setParticipants`·`setConfig` 는 다음 라운드로 미룹니다.** 이때 응답의
`queuedForNextRound: true` 로 알려 줍니다. 진행 중인 경기의 규칙이 몰래 바뀌지 않습니다.

---

## 5. 결과 받기 (부모 앱 **서버**)

구슬 레이스 서버가 확정된 결과를 `resultUrl` 로 보냅니다.

```
POST <resultUrl>
x-marble-signature: sha256=<hex HMAC(secret, 본문 그대로)>
x-marble-event-id: <eventId>

{ "type": "marble-race.round-finished", "sentAt": …,
  "room": { "code", "roomId", "integrationId", "activityId" },
  "result": { "eventId", "roundId", "revision", "mapId", "ruleSnapshot",
              "participantSnapshotVersion", "finishOrder", "winners",
              "outcome", "cancelled", "selectionMode", "finalizedAt" } }
```

받는 쪽이 지킬 것:

```js
// ★ 서명은 파싱하기 **전** 원문에 대해 검사한다
const expected = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
if (!timingSafeEqualStr(req.headers['x-marble-signature'], expected)) {
  return res.json({ ok: false, reason: 'bad_signature' });   // 200 — 다시 보내지 말라는 뜻
}

const env = JSON.parse(rawBody);
// 지금 진행 중인 활동의 결과가 맞는가
if (env.room.activityId !== session.activityId) {
  return res.json({ ok: false, reason: 'stale_activity' });
}

// 멱등 — (roundId, revision) 으로 «없을 때만» 기록한다
const key = `${env.result.roundId}:${env.result.revision}`;
if (await exists(key)) return res.json({ ok: true, duplicate: true });
await save(key, env.result);
res.json({ ok: true });
```

### 응답 규칙

| 상황 | 응답 | 왜 |
|---|---|---|
| 잘 받았다 | `2xx` | 끝 |
| 서명·활동이 안 맞는다 | `200` + `{ok:false}` 또는 `4xx` | 영구 거절 — 다시 보내지 않는다 |
| 우리 쪽 일시 오류 | `5xx` | 5·20·60초 뒤 다시 보낸다 |

### 결과를 읽을 때

- `outcome: 'timeout'` 이면 **당첨자가 없습니다.** 빈 대로 기록하세요. 임의로 채우지 마세요.
- `selectionMode: 'manual'` 이면 교사가 직접 지정한 것입니다. 무작위 추첨이 아닙니다.
  수업 앱 화면에도 그렇게 표시하세요.
- `winners[].selectionReason` 에 «왜 이 사람이 뽑혔는지»가 한국어로 들어 있습니다.
- `revision > 1` 이면 교사가 발표 뒤 고친 것입니다. `revisionNote` 에 사유가 있습니다.

---

## 6. 다시 확인하기 (선택)

webhook 을 못 받았거나 의심스러우면 부모 앱 서버에서 직접 물어볼 수 있습니다.

```
GET /api/rooms/<코드>/results/<roundId>
x-marble-integration: demo-class
x-marble-secret: <공유 비밀>
```

또는 방을 만들 때 받은 교사 토큰으로:

```
GET /api/rooms/<코드>/results/<roundId>
authorization: Bearer <teacherToken>
```

둘 다 없으면 `404` 입니다(있는지 없는지도 알려 주지 않습니다).

---

## 7. 학생을 어떻게 잇는가

이 서비스는 **세 가지 길**로만 학생을 기존 참가자와 잇습니다.

1. **재접속 자격**(`rejoinToken`) — 같은 기기의 새로고침·재연결
2. **연동 티켓의 `sub`** — 부모 수업 앱이 보증한 신원
3. 그 밖에는 **새 참가자**

**닉네임이 같다는 이유만으로 기존 참가자를 차지할 수 없습니다.** 로그인 없는 환경에서
「같은 사람인지」를 완벽히 가리는 것은 불가능하고, 그렇게 주장하지도 않습니다.

- 단독 입장(코드·QR)으로 들어온 학생과 연동으로 들어온 학생은 **서로 다른 참가자**입니다.
  둘을 잇고 싶다면 교사가 명단에서 한쪽을 빼거나, 처음부터 연동으로만 입장시키세요.
- 기기를 바꾸면 이전 참가 기록을 되살릴 수 없습니다. 학생 화면이 그렇게 안내합니다.

---

## 8. postMessage 안전 규칙

SDK 와 `/embed` 양쪽이 지킵니다.

- 보낼 때 **정확한 targetOrigin**. `'*'` 를 쓰지 않습니다.
- 받을 때 `event.origin`, `event.source`, 봉투 형식, `protocolVersion`, `sessionId` 를 모두 봅니다.
- 임의 origin 에서 온 설정 변경·시작 명령은 그냥 버립니다.
- iframe 을 띄울 수 있는 origin 은 `EMBED_ALLOWED_ORIGINS` 로 관리하고, 같은 값이
  CSP `frame-ancestors` 에 들어갑니다. 비워 두면 아무도 못 넣습니다.
- 서드파티 쿠키에 기대지 않습니다. 신원은 티켓으로만 오갑니다.
