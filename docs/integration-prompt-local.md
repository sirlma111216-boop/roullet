# 붙여 넣는 프롬프트 — 서버 없이 넣기

다른 수업 앱의 Claude Code 창에 **아래 회색 칸을 통째로 복사**해 넣으세요.
그 앱을 만드는 Claude 가 읽고 알아서 붙입니다.

이 길에는 **준비할 것이 없습니다.** 공유 비밀도, 연동 등록도, 서버 코드도 없습니다.
사다리타기·발표자 뽑기를 대신하는 용도라면 이것으로 충분합니다.

> 학생이 **각자 휴대폰으로** 들어와 자기 구슬을 보게 하려면 이 문서가 아니라
> [integration-prompt.md](integration-prompt.md) 를 쓰세요. 그쪽은 부모 앱에 서버가
> 있어야 하고, 활동 앱에 연동을 한 번 등록해야 합니다.

---

## 붙여 넣을 내용

````markdown
# 과제: 「교실 구슬 레이스」로 발표자 뽑기를 바꾸기

지금 이 앱에 있는 뽑기(사다리타기 등)를 구슬 레이스로 바꾼다.
구슬 레이스는 이미 배포되어 있고 고칠 수 없다. iframe 으로 가져다 쓴다.

## 활동 앱 정보

- 주소: `https://classroom-marble-race.sirlma.workers.dev`
- SDK: `https://classroom-marble-race.sirlma.workers.dev/sdk/marble-race-sdk.js`
  (ES 모듈이다. CORS 열려 있어 다른 주소에서 그대로 가져다 쓸 수 있다.)

## 이 방식이 요구하지 않는 것 — 하지 마라

- 서버 코드: **한 줄도 필요 없다.** API 경로를 새로 만들지 마라.
- 공유 비밀·티켓·서명: 없다. 만들려고 하지 마라.
- 활동 앱에 등록: 없다.
- 학생 기기 연결: 이 방식은 **화면 하나(교사 화면·프로젝터)** 에서만 돈다.

정적 사이트여도 되고, 백엔드가 없어도 된다.

## 붙이는 법

```js
import { createMarbleRace } from 'https://classroom-marble-race.sirlma.workers.dev/sdk/marble-race-sdk.js';

const race = createMarbleRace({
  activityOrigin: 'https://classroom-marble-race.sirlma.workers.dev',
  mode: 'local',                 // ← 서버 없는 모드. 이 줄이 핵심이다.
  participants: [                // 처음부터 넣어 둘 명단(나중에 바꿔도 된다)
    { id: 'u-101', nickname: '김하늘' },
    { id: 'u-102', nickname: '박서준' },
  ],
  title: '발표자 뽑기',
});

race.on('ready', () => { /* 여기서부터 시작 단추를 켠다 */ });

race.on('roundFinished', (p) => {
  const winners = p.result.winners;      // [{ participantId, nickname, rank, ... }]
  // participantId 는 위에서 넣은 id 그대로다 — 우리 앱 학생과 바로 맞출 수 있다
});

race.on('error', (e) => { /* 화면에 e.message 를 적는다. 삼키지 마라. */ });

race.mount(document.getElementById('무대'));   // 이 안에 iframe 이 생긴다
```

한 판 돌리기:

```js
await race.setParticipants(명단);   // 명단이 바뀌었을 때만
await race.startRound(3);           // 3 = 시작까지 기다릴 초
```

다시 뽑기:

```js
await race.resetRound();
await race.startRound(3);
```

## 규칙·맵 고르기 (선택)

```js
await race.setConfig({
  mapId: 'classic-wheel',
  rule: { kind: 'firstN', n: 1 },   // 첫 도착 1명 = 발표자 한 명
});
```

- 맵 id: `classic-wheel` `classic-bubble` `classic-jar` `classic-night`
  `ext-wind` `ext-portal` `ext-magnet` `mix-festival`
- 규칙: `{kind:'firstN', n}` 첫 n명 · `{kind:'lastN', n}` 꼴찌 n명 ·
  `{kind:'ranks', ranks:[2,5,8]}` 지정 등수

`setConfig` 를 안 부르면 회전 관문 맵 + 첫 도착 1명으로 돈다.

## 반드시 지킬 것

1. **`mount` 은 한 번만.** 다시 붙이려면 `destroy()` 하고 새로 만든다.
   React StrictMode 에서 두 번 마운트되지 않게 주의하라.
2. **`ready` 를 받기 전에 `startRound` 를 부르지 마라.** 거절당한다.
3. **`error` 를 화면에 적어라.** 삼키면 「왜 안 되지」를 영영 알 수 없다.
4. **결과를 성적·평가에 쓰지 마라.**
   `roundFinished` 의 `p.serverVerified` 는 이 모드에서 **항상 `false`** 다.
   이 결과는 교사 브라우저가 계산한 값이고, 확인해 줄 서버가 없다.
   화면 하나에서 다 같이 보는 용도에는 충분하지만, 다툼이 생길 수 있는 곳에는
   쓰면 안 된다. 그런 용도라면 live 모드가 따로 있다.
5. **iframe 을 CSS 로 찌그러뜨리지 마라.** 담는 요소에 실제 높이를 줘라
   (예: `height: 560px` 또는 `aspect-ratio`). 높이가 0이면 검은 칸만 보인다.

## 끝났는지 확인하는 방법

- [ ] 페이지를 열면 몇 초 안에 구슬 레이스 로비가 보이고 명단이 들어가 있다
- [ ] 시작을 누르면 구슬이 떨어지고 끝나면 당첨자 이름이 우리 앱 화면에 뜬다
- [ ] 당첨자의 `participantId` 가 우리 앱의 학생 id 와 맞는다
- [ ] **연속 세 판**을 돌려도 매번 끝난다 (한 판만 보고 끝내지 마라)
- [ ] 명단을 바꾸고 다시 돌리면 바뀐 명단으로 돈다
- [ ] 네트워크 탭에 우리 서버로 가는 새 요청이 **없다**
      (이 방식은 서버를 쓰지 않는다 — 있다면 뭔가 잘못 붙인 것이다)
- [ ] 콘솔에 오류가 없다

## 기존 뽑기를 어떻게 바꿀 것인가

기존 뽑기가 쓰던 자리를 그대로 이어받아라.

- 들어가는 것: 기존 뽑기에 넘기던 **명단** → `participants`
- 나오는 것: 기존 뽑기가 정하던 **당첨자** → `roundFinished` 의 `winners`
- 기존 결과 저장 구조(발표자 필드·기록 등)가 있으면 **그 구조에 그대로** 적어라.
  새 구조만 만들면 기존 화면과 통계가 못 본다.

기존 뽑기 코드는 지우기 전에, 새 방식이 끝까지 도는 것을 먼저 확인하라.
````

---

## 이 프롬프트를 쓸 때 바꿀 것

활동 앱을 다른 주소로 배포했다면 위 두 군데의 주소를 바꾸세요.
그 밖에는 고칠 것이 없습니다.
