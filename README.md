# 교실 구슬 레이스

**실제 주소: <https://classroom-marble-race.sirlma.workers.dev>**
저장소: <https://github.com/sirlma111216-boop/roullet>

구슬이 굴러 내려가 결승선을 통과한 순서로 **발표자·정리 도우미·문제 선택권**을 정하는
수업용 웹 앱입니다. 학생은 앱을 깔지 않고 휴대폰 브라우저로 들어옵니다.

- 8개 맵 — 기본 4개(원본 계승) + 확장 4개(바람·포털·자석·종합)
- 교사가 당첨 규칙을 바꿉니다 — 첫 번째·마지막·n번째·상위 k·하위 k·순위 범위·개별 순위·교사 지정
- 자체 주소에서 혼자 돌아가고, **동시에** 다른 수업 앱에 iframe 으로 붙습니다
- 인터넷이 막힌 교실을 위한 「혼자 빠르게 뽑기」도 있습니다

> 이 저장소는 [lazygyu/roulette](https://github.com/lazygyu/roulette)(MIT)의
> 맵 기하 정보를 계승해 새로 만든 교실용 앱입니다. 출처와 라이선스는
> [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 를 보세요.
> 원본의 제품명·로고·광고 코드는 쓰지 않습니다.

---

## 빨리 해 보기

```bash
npm install
npm run build          # 화면 + 삽입 SDK
npm run dev:worker     # http://127.0.0.1:8787
```

<http://127.0.0.1:8787> 을 열고 **새 방 만들기** → 참여 코드나 QR 로 학생이 들어옵니다.

서버 없이 혼자 돌려 보려면 <http://127.0.0.1:8787/local> 로 가세요.

---

## 수업에서 쓰는 순서

**교사**: 방 만들기 → QR·참여 코드 보여 주기 → 명단 확인·수정 → 맵과 당첨 규칙 고르기 →
카운트다운 → 경기 → 결과 발표 → 다음 라운드

**학생**: QR 또는 참여 코드 → 닉네임 → 대기실 → 같은 경기 관전 → 내 결과 확인

- 기본 정원 60명, 100명까지 검증했습니다.
- 1인 1구슬이고 모든 구슬의 물리 속성이 같습니다. 학생은 결과를 바꿀 수 없습니다.
- QR 에는 **학생용 입장 주소만** 들어갑니다. 교사 권한은 들어가지 않습니다.
- 경기 시작 시 명단이 고정됩니다. 도중 들어온 학생은 관전하고 다음 라운드부터 참가합니다.
- 경기 중 연결이 끊긴 학생의 구슬은 계속 달립니다. 다시 붙으면 같은 참가자로 돌아옵니다.
- 기기가 없는 학생은 교사가 명단에 직접 적어 넣으면 구슬이 생깁니다.

무엇이 어떻게 정해지는지는 **[docs/rules.md](docs/rules.md)** 에 전부 적어 두었습니다
(출발 자리 섞기, 동시 통과 처리, 정체 탈출 보조, 제한시간, 교사 지정 표시).

---

## 8개 맵

측정치는 **30명 기준**이고, 「첫 도착 ~ 전원 도착」입니다.
(재는 방법은 [docs/verification.md](docs/verification.md))

| 이름 | 분류 | 핵심 장치 | 30명 길이 |
|---|---|---|---|
| 회전 관문 | 기본 | 굴곡 통로 · 교차 회전 막대 · 핀 구간 · 좁은 결승 관문 | 11~53초 |
| 버블 계곡 | 기본 | 터지는 원형 장애물 · 지그재그 · 회전 장치와 좁은 출구 | 14~21초 |
| 항아리 탈출 | 기본 | 넓은 상부 · 큰 회전 발판 · 하부 중앙 구조와 양쪽 통로 | 5~72초 |
| 네온 장거리 | 기본 | 긴 다단 코스 · 여러 색 막대 · 원형 장애물 군집 | 20~37초 |
| 바람 협곡 | 확장 | 좌우 교대 바람 · 낙하 핀 · 시소 · 분기 후 합류 | 12~28초 |
| 포털 연구소 | 확장 | 짝지어진 포털 · 회전문 · 가속 바닥 · 느린 구역 | 12~31초 |
| 자석 공장 | 확장 | 주기 자력 구역 · 지그재그 컨베이어 · 주기 개폐문 · 반발 범퍼 | 18~91초 |
| 종합 운동장 | 확장 | 회전 풍차 · 탄성 발판 · 두 갈래 길 · 마지막 시소 | 13~91초 |

맵은 **데이터**입니다(`packages/game-core/src/maps/`). 장치를 실제 힘·충돌로 바꾸는
코드는 `devices/index.ts` 한 벌뿐이라, 맵마다 물리 코드가 복제되지 않습니다.

기본 4개는 `tools/derive-classic-maps.mjs` 가 원본의 고정된 커밋에서 내려받아
기계적으로 옮깁니다. 눈대중으로 베끼지 않았고, 다시 돌리면 같은 결과가 나옵니다.

---

## 당첨 규칙

| 규칙 | 뽑는 것 |
|---|---|
| 첫 번째 / 마지막 / n번째 | 한 명 |
| 상위 k명 / 하위 k명 | k명 |
| 순위 범위 (a~b위) | 여러 명 |
| 개별 순위 (2·5·8위) | 여러 명 |
| 교사 지정 | 교사가 고른 사람 — **무작위 추첨이 아니라고 화면·기록·연동 결과에 표시합니다** |

- 당첨 항목(발표자·정리 도우미·문제 선택권 …)을 순위 자리마다 붙일 수 있습니다.
  기본적으로 한 학생이 항목을 두 개 받지 않습니다.
- 지난 라운드 당첨자를 다음 라운드에서 빼는 선택지가 있고, 제외를 초기화할 수 있습니다.
- 참가자 0명·1명, 제외 후 부족한 인원, 뒤집힌 범위, 중복 순위는 **서버와 화면이 같은 함수로**
  검사해 거절합니다. 화면에서 되는데 서버가 막는 일이 없습니다.

---

## 구조

```
packages/protocol       메시지·상태 타입과 값 검사 (서버·화면이 같이 쓴다)
packages/game-core      물리·맵·장치·결승 판정·당첨 규칙 (DOM 을 모른다)
packages/game-renderer  캔버스·카메라·미니맵·맵 미리보기
packages/embed-sdk      부모 수업 앱이 쓰는 iframe SDK
apps/web                교사·학생·혼자뽑기·임베드 화면
apps/worker             Cloudflare Worker + Durable Object
examples/host-app       명단 전달과 결과 수신이 실제로 도는 예제 수업 앱
```

물리는 **교사 브라우저의 Web Worker 하나**가 돌리고, 서버가 검증해 학생들에게 중계합니다.
당첨자는 **서버만** 정합니다. 왜 이렇게 했는지와 이 구조가 막지 못하는 것은
**[docs/architecture.md](docs/architecture.md)** 에 적어 두었습니다.

물리 엔진에 외부 꾸러미를 쓰지 않습니다. 움직이는 것이 구슬(원)뿐이라
모든 충돌이 «원 vs (원·선분·회전 사각형)» 한 가지 꼴로 줄어들기 때문입니다.

---

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm install` | 설치 |
| `npm run dev` | 화면 개발 서버 (5173, `/api`·`/ws` 는 8787 로 넘긴다) |
| `npm run dev:worker` | Worker + Durable Object (8787) |
| `npm run dev:host` | 예제 수업 앱 (5180) |
| `npm run typecheck` | 타입 검사 (node·web·worker 세 갈래) |
| `npm test` | 단위·통합 검사 |
| `npm run build` | 화면 + SDK 빌드 |
| `npm run verify` | 타입 검사 + 검사 + 빌드 |
| `npm run sim` | 8개 맵을 여러 인원·시드로 자동 시뮬레이션 |
| `npm run e2e` | 실제 WebSocket 으로 한 판 끝까지 |
| `npm run loadtest -- --students 60` | 실제 연결 부하 시험 |
| `npm run test:embed` | 연동 보안 경계 검사 |
| `npm run deploy:dry` / `npm run deploy` | Cloudflare 배포 |

`e2e`·`loadtest`·`test:embed` 는 서버가 떠 있어야 합니다.

---

## 배포

Cloudflare Workers Static Assets(화면) + Worker API + Durable Objects(실시간)로 올립니다.
정적 호스팅만으로는 여러 기기 동기화가 안 됩니다.

자세한 절차·비밀 등록·되돌리기·GitHub 자동 배포는
**[docs/deploy.md](docs/deploy.md)** 를 보세요.

---

## 다른 수업 앱에 붙이기

```js
const race = createMarbleRace({ activityOrigin, integrationId, ticket, view: 'teacher' });
race.on('roundFinished', (p) => setStatus('결과 확인 중…'));  // 화면용
race.mount(el);
await race.setParticipants(roster);
await race.setConfig({ mapId: 'mix-wind', rule: { kind: 'topK', k: 3 } });
await race.startRound();
```

발표자를 실제로 기록할 때는 활동 서버가 **서명해 보낸 webhook** 만 씁니다.
브라우저를 거쳐 온 결과는 화면용입니다.

계약 전체와 티켓 만드는 법은 **[docs/embedding.md](docs/embedding.md)**,
돌아가는 예제는 `examples/host-app` 에 있습니다.

### 붙이는 방법이 두 가지입니다

고르는 기준은 **학생 휴대폰이 필요한가** 하나뿐입니다.

| | 화면 하나에서만 (`mode: 'local'`) | 학생 휴대폰까지 (`mode: 'live'`) |
|---|---|---|
| 부모 앱에 서버가 | 없어도 된다 (정적 사이트도 가능) | 있어야 한다 |
| 미리 등록할 것 | **없다** | 공유 비밀 + 주소 등록 |
| 결과를 서버가 확인해 주나 | 아니오 (`serverVerified: false`) | 예 (서명된 webhook) |
| 쓰는 문서 | [integration-prompt-local.md](docs/integration-prompt-local.md) | [integration-prompt.md](docs/integration-prompt.md) |

사다리타기·발표자 뽑기를 대신하는 용도라면 왼쪽으로 충분하고, 준비할 것이 없습니다.
위 그림과 「서명된 webhook」 설명은 오른쪽(live) 이야기입니다.

**다른 Claude Code 세션에 붙여 넣을 프롬프트**는 위 표의 문서를 통째로 복사하세요.
붙이는 쪽이 이 저장소를 안 봐도 되도록 계약과 코드를 전부 담았습니다.

---

## 확인한 것과 확인하지 못한 것

**[docs/verification.md](docs/verification.md)** 에 통과·실패·미검증을 구분해 적었습니다.
요약하면:

- 단위·통합 검사 155건, 실시간 검사 33건, 연동 보안 검사 16건 통과
- 8개 맵 × 인원 6가지 × 시드 3개 = 144판 자동 시뮬레이션에서 벽 이탈·영구 정체 0건
- 브라우저로 8개 맵을 모두 시작→진행→결과까지 플레이
- 실제 WebSocket 60명·100명 부하 시험 통과
- **배포했습니다.** 운영 주소에서 같은 검사 33건을 다시 돌려 통과했고, 학생 60명
  동시 접속도 통과했습니다(지연 중앙 87ms).
- **실제 모바일 기기로는 확인하지 못했습니다.** 화면 크기 에뮬레이션으로만 봤습니다.

### 남은 선택 사항

- **다른 수업 앱 연동을 쓰려면** 운영 비밀을 넣어야 합니다. 지금은 꺼져 있습니다.
  ```bash
  npx wrangler secret put INTEGRATION_SECRETS --config apps/worker/wrangler.jsonc
  ```
  그리고 `apps/worker/wrangler.jsonc` 의 `EMBED_ALLOWED_ORIGINS` 에 부모 앱 주소를 적습니다.
  자세한 형식은 [docs/embedding.md](docs/embedding.md).
- **push 할 때마다 자동 배포**하려면 Cloudflare 대시보드에서 Workers Builds 로
  이 저장소를 연결하세요([docs/deploy.md](docs/deploy.md) 5절).

---

## 라이선스

MIT — [LICENSE](LICENSE). 재사용한 소프트웨어의 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
