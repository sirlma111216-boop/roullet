# 다른 웹앱에 붙일 때 쓰는 프롬프트

아래 `---` 사이를 통째로 복사해 **다른 Claude Code 세션**(붙이려는 수업 앱 저장소)에
붙여 넣으세요. 그 세션은 이 저장소를 볼 수 없으므로, 필요한 계약과 코드를 전부 담았습니다.

> **먼저 이쪽에서 해야 할 일이 있습니다.** 아래 「0. 먼저 할 일」을 끝내고
> 발급된 비밀과 연동 id 를 프롬프트의 자리표시자에 채워 넣으세요.
> 그러지 않으면 붙이는 쪽에서 아무리 잘 만들어도 서버가 티켓을 거절합니다.

---

## 0. 먼저 할 일 (이 저장소에서, 한 번만)

### 이게 뭐 하는 단계인가

지금 구슬 레이스는 **독립된 가게**처럼 혼자 잘 열려 있습니다.
이 단계는 나중에 **다른 수업 앱 안에 입점**할 때, 두 앱이 서로를 알아보도록
**출입증 도장을 맞춰 두는 일**입니다.

왜 필요한가: 다른 앱이 "이 학생은 우리 반 김하늘이고, 이 사람은 선생님이다" 라고
알려 주면 구슬 레이스는 그 말을 믿고 교사 권한까지 줍니다. 아무나 그렇게 말할 수 있으면
누구든 교사가 됩니다. 그래서 **두 앱만 아는 암호**로 서명한 쪽지(티켓)만 믿습니다.
그 암호를 양쪽에 똑같이 넣어 두는 것이 이 단계입니다.

### 언제 하나

**다른 앱이 배포되어 주소가 생긴 뒤에** 합니다. 그 전에는 할 수 없고, 할 필요도 없습니다.
구슬 레이스를 혼자 쓰는 동안에는 이 설정이 아예 필요 없습니다.

필요한 것은 두 가지입니다.

| 필요한 것 | 어디서 오나 |
|---|---|
| 공유 암호 (두 앱이 서로를 알아보는 비밀번호) | 아래 1번에서 만듭니다 |
| 다른 앱의 **웹 주소** | 그 앱을 배포해야 생깁니다 (예: `https://내수업앱.pages.dev`) |

### 하는 법

```bash
# 1) 공유 암호를 만든다. 나온 값을 복사해 둔다.
#    (채팅·이슈·커밋에 붙여 넣지 말 것)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# 2) 다른 앱 주소를 iframe 허용 목록에 넣는다.
#    apps/worker/wrangler.jsonc 파일을 열어 이 줄을 고친다:
#      "vars": { "EMBED_ALLOWED_ORIGINS": "https://내수업앱.pages.dev" }
#    이게 없으면 다른 앱 안에서 화면이 하얗게만 뜬다.
```

```bash
# 3) 연동을 등록한다. 명령을 치면 "값을 입력하세요" 하고 기다린다.
#    아래 JSON 을 한 줄로 만들어 붙여 넣고 Enter.
npx wrangler secret put INTEGRATION_SECRETS --config apps/worker/wrangler.jsonc
```

붙여 넣을 내용 (줄바꿈 없이 한 줄로):

```json
{"내수업앱":{"secret":"1번에서_만든_값","resultUrl":"https://내수업앱.pages.dev/api/marble-race/result","origins":["https://내수업앱.pages.dev"]}}
```

| 칸 | 뜻 |
|---|---|
| `내수업앱` | 연동 id. 아무 이름이나 좋고, 양쪽이 같기만 하면 된다 |
| `secret` | 1번에서 만든 암호. **다른 앱의 서버 환경 변수에도 같은 값**을 넣는다 |
| `resultUrl` | 결과를 보내 줄 주소. 다른 앱에서 만들 webhook 수신 경로 |
| `origins` | 이 연동의 티켓이 나올 수 있는 주소. 비워 두면 주소 검사를 안 한다 |

```bash
# 4) 다시 배포하고 확인한다. integrationsConfigured 에 id 가 보이면 끝.
npm run build && npm run deploy
curl -s https://classroom-marble-race.sirlma.workers.dev/api/health
```

`resultUrl` 은 다른 앱을 아직 안 만들었으면 나중에 고쳐도 됩니다 —
3번과 4번을 다시 하면 됩니다.

---

여기부터 복사

---

# 과제: 「교실 구슬 레이스」를 이 수업 앱에 활동 모듈로 붙이기

우리 수업 앱에, 이미 배포되어 있는 외부 활동 앱을 iframe 으로 붙인다.
구슬이 굴러 내려가 도착한 순서로 **발표자·정리 도우미** 같은 역할을 정하는 활동이다.
학생은 코드·닉네임을 입력하지 않고, 우리 앱이 이미 가진 명단으로 그대로 참가한다.

## 활동 앱 정보 (이미 배포됨, 고칠 수 없음)

| 항목 | 값 |
|---|---|
| 주소 | `https://classroom-marble-race.sirlma.workers.dev` |
| 연동 id | `<<여기에 연동 id>>` (예: `my-class-app`) |
| 공유 비밀 | `<<여기에 공유 비밀>>` — **서버 환경 변수로만.** 코드·브라우저에 넣지 마라 |
| SDK | `https://classroom-marble-race.sirlma.workers.dev/sdk/marble-race-sdk.js` |
| 프로토콜 판 | 1 |

## 구조 — 세 층으로 나뉜다

```
우리 앱 [서버]  ──공유 비밀──▶  활동 앱: 방 만들기
우리 앱 [서버]                  티켓 서명 (학생·교사 신원)
우리 앱 [화면]  ──iframe──▶     활동 앱: 티켓 제시 → 역할 부여 → 경기
우리 앱 [서버]  ◀──서명된 webhook──  확정 결과   ★ 이것만 기록한다
```

## 반드시 지킬 것 (어기면 되돌려야 한다)

1. **공유 비밀은 서버에만 둔다.** 브라우저로 내려보내거나 클라이언트 번들에 넣지 마라.
   브라우저에서 티켓을 만들 수 있게 되면 누구나 교사 티켓을 찍어 낸다.
2. **티켓은 우리 서버가 발급한다.** 교사 티켓은 실제로 강사인지 우리 DB 로 확인한 뒤에만,
   학생 티켓은 그 수업에 등록된 학생에게만 준다. 브라우저가 보낸 id·이름을 믿지 마라.
3. **발표자를 기록할 때는 서명된 webhook 만 쓴다.** iframe 이 `roundFinished` 로 보내는
   결과는 학생 브라우저를 거치므로 손댈 수 있다. 화면에는 「확인 중」으로만 두고,
   서버가 서명을 검증한 결과가 도착한 뒤에 이름을 그린다.
4. **webhook 서명은 파싱하기 전 원문(raw body)에 대해 검증한다.** JSON 으로 파싱한 뒤
   다시 문자열로 만들면 바이트가 달라져 서명이 안 맞는다.
5. **결과 기록은 멱등하게.** `(roundId, revision)` 으로 「없을 때만」 기록한다.
   같은 결과가 두 번 와도 발표자를 두 번 세지 마라.
6. **postMessage 에 `'*'` 를 쓰지 마라.** SDK 가 알아서 하지만, 우리가 따로 붙이는
   메시지 처리가 있다면 `event.origin` 과 `event.source` 를 모두 확인한다.
7. `destroy()` 를 반드시 부른다. React StrictMode 의 이중 마운트에서 방이 두 개 생긴다.

## 1. 서버: 방 만들기

활동 한 번(차시 하나)을 시작할 때 **우리 서버가** 부른다.

```js
// activityId 는 이 실행 한 번을 가리킨다. 같은 차시를 두 번 해도 구분되게.
const activityId = `${classId}:${lessonId}:${Date.now().toString(36)}`;

const res = await fetch(`${ACTIVITY_ORIGIN}/api/rooms`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-marble-secret': SHARED_SECRET,      // 이게 없으면 401
  },
  body: JSON.stringify({ capacity: 60, integrationId: INTEGRATION_ID, activityId }),
});
if (!res.ok) throw new Error(`방을 만들지 못했습니다: ${res.status} ${await res.text()}`);

const { joinCode, roomId, teacherToken } = await res.json();
// joinCode      : 티켓에 넣는다
// teacherToken  : 서버에만 보관. 결과 조회 API 에 쓴다. 브라우저로 내려보내지 마라.
```

세션 문서에 `{ activityId, joinCode, teacherToken, status: 'open' }` 을 저장해 둔다.
이미 열린 활동이 있으면 새로 만들지 말고 그것을 다시 쓴다(교사가 새로고침해도 방이 하나).

## 2. 서버: 티켓 발급

```
ticket = base64url(JSON) + '.' + base64url(HMAC-SHA256(secret, base64url(JSON)))
```

```js
import { createHmac, randomUUID } from 'node:crypto';

function makeTicket({ sub, name, role, session }) {
  const now = Date.now();
  const claims = {
    iss: 'my-class-app',              // 우리 앱 이름(아무 문자열)
    aud: 'classroom-marble-race',     // 고정값. 다르면 거절된다
    integrationId: INTEGRATION_ID,
    sessionId: `${session.classId}:${session.lessonId}`,
    activityId: session.activityId,   // 1번에서 만든 것
    roomCode: session.joinCode,       // 1번에서 받은 것
    sub,                              // 우리 앱의 **안정적인** 사용자 id
    name: String(name).slice(0, 18),  // 화면에 적힐 이름
    role,                             // 'teacher' | 'student'
    origin: PUBLIC_ORIGIN,            // 우리 앱 주소
    iat: now,
    exp: now + 120 * 60 * 1000,       // 한 수업 시간. 짧으면 경기 중 만료된다
    jti: randomUUID(),
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', SHARED_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
```

Node 가 아닌 런타임(Workers·Deno 등)이면 WebCrypto 로:

```js
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}
```

**엔드포인트 두 개를 만든다.**

- `POST /api/marble-race/start` — 강사만. 방을 만들고(1번) 교사 티켓을 돌려준다.
- `POST /api/marble-race/student-ticket` — 로그인한 학생 본인만.
  그 수업에 **등록된** 학생인지, 지금 열린 활동인지 확인한 뒤 학생 티켓을 돌려준다.

활동 앱은 티켓 안의 값만 쓴다. 학생 티켓으로 교사 화면을 요청해도 학생 권한만 받는다.

## 3. 화면: iframe 띄우기

```js
import { createMarbleRace }
  from 'https://classroom-marble-race.sirlma.workers.dev/sdk/marble-race-sdk.js';
// 번들러를 쓴다면 이 파일을 내려받아 저장소에 두고 가져와도 된다(6KB, 의존성 없음).

const race = createMarbleRace({
  activityOrigin: 'https://classroom-marble-race.sirlma.workers.dev',
  integrationId: INTEGRATION_ID,
  ticket,                 // 우리 서버에서 받아 온 것
  view: 'teacher',        // 또는 'student'
  hideJoinUi: true,       // 연동 모드에서는 코드·QR 상자를 숨긴다
  title: '구슬 레이스',
});

// 받을 준비를 먼저, mount 는 그다음 (SDK 가 순서를 지켜 준다)
race.on('available', (p) => {
  // 우리가 쓰는 기능이 없으면 「활동 앱을 다시 배포하세요」를 화면에 적는다.
  // 이게 없으면 「왜 안 되지」가 배포 어긋남인지 우리 버그인지 알 수 없다.
  const need = ['participants.set', 'round.start', 'result.signed-webhook'];
  const missing = need.filter((n) => !p.capabilities.includes(n));
  if (missing.length) showBanner(`활동 앱 판이 낮습니다: ${missing.join(', ')}`);
});

race.on('ready', (p) => enableControls());                 // p.joinCode, p.participantId
race.on('participantsChanged', (p) => setLobby(p.onlineCount, p.totalCount));
race.on('roundStarted', (p) => setStatus('진행 중'));
race.on('roundFinished', () => setStatus('결과 확인 중…')); // ★ 아직 기록하지 않는다
race.on('error', (p) => showBanner(`${p.code}: ${p.message}`)); // ★ 반드시 화면에 적는다

race.mount(document.getElementById('활동자리'));
```

교사 화면에서 쓰는 조작:

```js
await race.setParticipants(roster.map((s) => ({ id: s.id, nickname: s.name })));
await race.setConfig({
  mapId: 'classic-bubble',              // 아래 목록 참고
  rule: { kind: 'topK', k: 3 },         // 아래 목록 참고
  awards: [{ id: 'a', label: '발표자', slot: 0 }],
});
const { roundId } = await race.startRound(3);   // 3초 카운트다운
// await race.cancelRound('사유');
// await race.resetRound();
race.destroy();   // 정리할 때 반드시
```

경기 중에 온 `setParticipants`·`setConfig` 는 **다음 라운드로 미뤄진다**
(응답의 `queuedForNextRound: true`). 진행 중인 경기의 규칙이 몰래 바뀌지 않는다.

### 맵 id

`classic-wheel`(회전 관문) · `classic-bubble`(버블 계곡) · `classic-jar`(항아리 탈출) ·
`classic-night`(네온 장거리) · `mix-wind`(바람 협곡) · `mix-portal`(포털 연구소) ·
`mix-magnet`(자석 공장) · `mix-festival`(종합 운동장)

목록은 `GET /api/maps` 로도 받을 수 있다(이름·설명·예상 길이 포함).

### 당첨 규칙

```js
{ kind: 'first' }                       // 첫 번째 도착
{ kind: 'last' }                        // 마지막 도착
{ kind: 'nth', n: 3 }                   // 3번째 도착
{ kind: 'topK', k: 3 }                  // 먼저 도착한 3명
{ kind: 'bottomK', k: 3 }               // 늦게 도착한 3명
{ kind: 'range', from: 1, to: 3 }       // 1~3위
{ kind: 'ranks', ranks: [2, 5, 8] }     // 2·5·8위
{ kind: 'manual', participantIds: [] }  // 교사 지정 — 무작위 아님이 결과에 표시된다
```

## 4. 서버: 결과 받기 (webhook)

활동 앱이 결과를 확정하면 우리 `resultUrl` 로 보낸다.

```
POST /api/marble-race/result
x-marble-signature: sha256=<hex HMAC(secret, 원문)>
x-marble-event-id: <eventId>

{ "type":"marble-race.round-finished", "sentAt":…,
  "room":{ "code","roomId","integrationId","activityId" },
  "result":{ "eventId","roundId","revision","mapId","ruleSnapshot",
             "finishOrder","winners","outcome","cancelled",
             "selectionMode","finalizedAt" } }
```

```js
// ★ 프레임워크가 JSON 을 자동 파싱하지 않게 하고, 원문 바이트를 그대로 받아야 한다
const raw = await readRawBody(req);
const expected = 'sha256=' + createHmac('sha256', SHARED_SECRET).update(raw).digest('hex');
const got = req.headers['x-marble-signature'] ?? '';

// 길이가 다르면 timingSafeEqual 이 던지므로 먼저 본다
if (got.length !== expected.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
  return json(200, { ok: false, reason: 'bad_signature' });   // 영구 거절 → 재시도 말라는 뜻
}

const env = JSON.parse(raw.toString());
if (env.room.activityId !== session.activityId) {
  return json(200, { ok: false, reason: 'stale_activity' });  // 지난 활동
}

const key = `${env.result.roundId}:${env.result.revision}`;
if (await exists(key)) return json(200, { ok: true, duplicate: true });   // 멱등
await saveResult(key, env.result);
return json(200, { ok: true });
```

**응답 규칙** — 활동 앱이 이걸로 재시도 여부를 정한다.

| 상황 | 응답 | 뜻 |
|---|---|---|
| 잘 받았다 | `2xx` | 끝 |
| 서명·활동 불일치 | `200` + `{ok:false}` | 다시 보내지 마라 |
| 우리 쪽 일시 오류 | `5xx` | 5·20·60초 뒤 다시 보내라 |

### 결과를 읽을 때 주의

- `outcome: 'timeout'` → **당첨자가 없다.** `winners` 가 빈 배열이다.
  빈 대로 기록하라. 임의로 채우지 마라.
- `selectionMode: 'manual'` → 교사가 직접 지정한 것이다. 무작위 추첨이 아니다.
  우리 화면에도 그렇게 표시하라.
- `winners[].selectionReason` 에 「왜 이 사람이 뽑혔는지」가 한국어로 들어 있다. 그대로 보여라.
- `revision > 1` → 교사가 발표 뒤 고친 것이다. `revisionNote` 에 사유가 있다.
  이전 판을 지우지 말고 새 판으로 남겨라.

### 확인용 조회 (webhook 을 놓쳤을 때)

```
GET /api/rooms/<joinCode>/results/<roundId>
x-marble-integration: <연동 id>
x-marble-secret: <공유 비밀>
```

또는 방 만들 때 받은 `teacherToken` 으로 `authorization: Bearer <토큰>`.
둘 다 없으면 404 다(있는지 없는지도 알려 주지 않는다).

## 5. 우리 앱 화면 설계

- **강사가 하는 일은 둘뿐이다**: 다 들어왔는지 본다 · 시작을 누른다.
  맵·규칙은 우리 앱에서 정해 `setConfig` 로 넘기고, 활동 앱 안에서 다시 고르게 하지 마라.
- **학생은 단추 하나**(「활동 참가」). 코드·닉네임·QR 입력이 없다.
- 콘솔에 세 숫자를 **따로** 보여라: 수강 등록 인원 / 활동에 연결된 인원 / 아직 안 들어온 사람.
  세 숫자는 서로 다른 상태다.
- 활동 앱의 정원은 60명(최대 100명)이다. 넘으면 미리 경고하라.

## 6. 다 됐는지 확인하는 방법

1. 강사로 활동을 열고 → 콘솔에 방이 열렸다고 표시되는가
2. 학생 창을 두세 개 열어 → 「연결 N명」이 실제로 늘어나는가
3. 명단을 넘기고 규칙을 보낸 뒤 시작 → 경기가 보이는가
4. 결과가 나오면 → 화면이 「확인 중」에서 **이름**으로 바뀌는가
   (바뀌지 않으면 webhook 이 안 온 것이다. `resultUrl` 과 서명 검증을 보라)
5. 같은 결과를 일부러 두 번 보내 → 발표자가 두 번 세어지지 않는가
6. 서명을 망가뜨려 보내 → 거절되는가
7. 지난 활동의 `activityId` 로 보내 → 거절되는가

## 7. 자주 막히는 곳

| 증상 | 원인 |
|---|---|
| `ticket_invalid: 서명이 맞지 않습니다` | 양쪽 비밀이 다르다 |
| `ticket_invalid: 모르는 연동입니다` | 활동 앱에 우리 `integrationId` 가 등록되지 않았다 |
| `ticket_invalid: 지난 활동의 티켓입니다` | 방을 새로 만들었는데 옛 `activityId` 로 티켓을 찍었다 |
| iframe 이 하얗게 뜬다 | 활동 앱의 `EMBED_ALLOWED_ORIGINS` 에 우리 주소가 없다(CSP frame-ancestors) |
| `available` 이 안 온다 | iframe `src` 를 넣기 전에 리스너를 걸었는지 확인(SDK 를 쓰면 저절로 된다) |
| `not_ready: 아직 방에 연결되지 않았습니다` | `ready` 를 받기 전에 `setParticipants` 를 불렀다 |
| 방 만들기가 **400** `unknown_integration` | 활동 앱에 우리 `integrationId` 가 등록되지 않았다 (위 0번을 안 했다) |
| 방 만들기가 **401** `bad_integration_secret` | id 는 등록됐는데 `x-marble-secret` 이 없거나 값이 다르다 |
| 결과가 화면에 영영 안 뜬다 | webhook 만 기다리고 있는데 `resultUrl` 이 안 맞는다. 조회 API 로 대비하라 |

## 8. 지금 상태에서 꼭 물어볼 것

작업을 시작하기 전에 나에게 확인하라.

- 우리 앱의 **공개 주소**가 무엇인가 (티켓의 `origin`, 활동 앱의 허용 목록에 넣어야 한다)
- **강사인지 어떻게 판별**하는가 (어느 컬렉션·테이블의 어느 필드)
- **학생 등록**을 어디서 확인하는가
- 결과를 **어디에 저장**하는가. 이미 발표자·점수 구조가 있으면 그 구조에도 적어야 한다
  (새 구조만 만들면 기존 화면·통계가 못 본다)

모르면 추측하지 말고 물어보라.

---

여기까지 복사

---

## 붙여 넣기 전에 바꿀 것

| 자리표시자 | 넣을 값 |
|---|---|
| `<<여기에 연동 id>>` | 위 0번에서 정한 id (예: `my-class-app`) |
| `<<여기에 공유 비밀>>` | 위 0번 1단계에서 만든 32바이트 hex |

공유 비밀을 채팅창에 붙여 넣기 꺼려진다면, 프롬프트에는
`서버 환경 변수 MARBLE_SHARED_SECRET 에 들어 있다` 라고만 적고 값은 직접 `.env` 에 넣으세요.
붙이는 쪽 Claude Code 는 값을 몰라도 코드를 쓸 수 있습니다.
