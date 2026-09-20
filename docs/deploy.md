# 배포 — GitHub + Cloudflare

## 왜 정적 호스팅만으로는 안 되는가

여러 기기가 같은 경기를 함께 보려면 **연결을 들고 있는 서버**가 필요합니다.
GitHub Pages 같은 정적 호스팅은 파일만 내보내므로 WebSocket 을 받을 수 없습니다.

그래서 구조는 이렇습니다.

```
브라우저 ──▶ Cloudflare Worker
              ├─ /api/*, /ws  → Durable Object (방 하나 = 객체 하나)
              └─ 그 밖         → Workers Static Assets (화면 파일)
```

`run_worker_first: true` 로 **모든 요청을 Worker 가 먼저** 봅니다.

경로 몇 개만 적어 두면(예: `["/api/*", "/ws"]`) 나머지는 Worker 를 아예 거치지 않고
정적 자산 계층이 바로 내보냅니다. 그러면 두 가지가 깨집니다.

- API 오류가 `index.html` 로 바뀌어, 클라이언트가 JSON 을 기대한 자리에서 HTML 을 받습니다.
- Worker 가 붙이는 **보안 헤더가 화면 파일에 하나도 안 붙습니다**
  (CSP·frame-ancestors·nosniff·referrer-policy). 실제로 그렇게 배포되어 있었고,
  운영 주소의 응답에 보안 헤더가 하나도 없었습니다.

정적 파일은 여전히 `env.ASSETS` 가 내보내고, Worker 는 헤더만 씌웁니다.
`frame-ancestors` 는 환경 변수로 정하므로 코드에서 붙일 수밖에 없습니다 —
`_headers` 파일은 정적 자산 전용이라 환경 변수를 읽지 못합니다.

---

## 1. 처음 한 번

```bash
npm install
npm run verify          # 타입 검사 + 단위 검사 + 빌드
```

### Cloudflare 계정 붙이기

```bash
npx wrangler login
npx wrangler whoami     # 어느 계정인지 확인
```

`apps/worker/wrangler.jsonc` 의 `name` 을 원하는 이름으로 바꾸세요.
배포되면 `https://<name>.<계정>.workers.dev` 로 열립니다.

---

## 2. 로컬 개발

터미널 두 개가 필요합니다.

```bash
# 1) 화면 빌드 (Worker 가 ../web/dist 를 내보냅니다)
npm run build --workspace=apps/web

# 2) Worker + Durable Object
npm run dev:worker      # http://127.0.0.1:8787
```

화면을 고치며 볼 때는 Vite 개발 서버를 쓰는 편이 빠릅니다.

```bash
npm run dev             # http://127.0.0.1:5173 — /api 와 /ws 는 8787 로 넘깁니다
```

### 로컬 비밀

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

`.dev.vars` 는 `.gitignore` 에 있습니다. **절대 커밋하지 마세요.**

---

## 3. 운영 비밀 넣기

`vars` 에 적는 값은 공개됩니다. 비밀은 반드시 `secret` 으로 넣으세요.

```bash
cd apps/worker

# 부모 수업 앱 연동 (JSON 한 줄)
npx wrangler secret put INTEGRATION_SECRETS
# 붙여넣을 형식:
# {"수업앱id":{"secret":"<32바이트 이상 무작위>","resultUrl":"https://수업앱/api/.../result","origins":["https://수업앱"]}}
```

비밀 만들기:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 이 값은 **부모 수업 앱 서버의 `SHARED_SECRET` 과 같은 값**이어야 합니다.
> 채팅·이슈·커밋에 적지 말고 안전한 경로로 전달하세요.

iframe 허용 origin 은 비밀이 아니므로 `wrangler.jsonc` 의 `vars` 에 적습니다.

```jsonc
"vars": { "EMBED_ALLOWED_ORIGINS": "https://수업앱.example.com" }
```

이 값이 그대로 CSP `frame-ancestors` 에 들어갑니다. **비워 두면 아무도 iframe 에 넣을 수 없습니다**
(기본을 열어 두지 않습니다).

---

## 4. 배포

```bash
npm run build                 # 화면 + SDK
npm run deploy:dry            # 실제로 올리지 않고 번들만 만들어 본다
npm run deploy                # 올린다
```

배포 뒤 확인:

```bash
curl -s https://<주소>/api/health
# {"ok":true,"maps":8,"integrationsConfigured":["..."],...}

# API 404 가 HTML 로 바뀌지 않는지 (이게 가장 자주 깨집니다)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<주소>/api/nope
# 404 application/json  ← 이래야 정상

# SPA 새로고침이 되는지
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<주소>/teacher
# 200 text/html
```

### 되돌리기

```bash
npx wrangler deployments list
npx wrangler rollback --message "되돌리는 이유"
```

Durable Object 의 **저장된 데이터는 되돌아가지 않습니다.** 코드만 되돌아갑니다.
방 상태의 모양을 바꾸는 변경을 되돌릴 때는, 예전 코드가 새 모양을 읽어도 터지지 않는지
확인하세요(`load()` 가 기본값을 앞에 깔아 두는 이유입니다).

---

## 5. GitHub 자동 배포 (Cloudflare Workers Builds)

1. 이 저장소를 GitHub 에 올립니다.
2. Cloudflare 대시보드 → **Workers & Pages** → 해당 Worker → **Settings** → **Build**
3. **Connect to Git** 으로 저장소를 고릅니다.
4. 빌드 설정:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/` (저장소 루트)
5. **Settings → Variables and Secrets** 에서 `INTEGRATION_SECRETS` 를 Secret 으로 넣습니다.
   (`wrangler secret put` 으로 넣은 값과 같은 곳입니다.)

이렇게 하면 기본 브랜치에 push 할 때마다 배포됩니다.
`.github/workflows/ci.yml` 은 배포 전에 타입 검사·단위 검사·빌드를 돌려 줍니다.

---

## 6. 무료 요금제로 되는가

핵심은 **Durable Objects 는 SQLite 방식(`new_sqlite_classes`)이어야 무료 요금제에서
쓸 수 있다**는 것입니다. `wrangler.jsonc` 의 migration 이 그렇게 되어 있습니다.

실제로 얼마나 쓰는지는 이 저장소에서 잰 값으로 가늠할 수 있습니다(아래 측정 조건은
`docs/verification.md` 에 있습니다).

- 100명 한 판(34초): 교사→서버 프레임 307장, 학생 한 명이 받는 양 약 531KB
- 서버가 내보내는 총량 ≈ 531KB × 100명 ≈ 53MB / 한 판

Workers 무료 요금제는 **요청 수**와 **CPU 시간**으로 셉니다. WebSocket 은
연결 하나가 요청 하나이고, 이후 메시지는 Durable Object 의 처리 시간으로 잡힙니다.

> **정확한 비용은 이 문서로 단정하지 않습니다.** 요금 체계는 바뀌고, 교실마다 사용량이
> 다릅니다. 실제로 쓰기 전에 Cloudflare 의 현재 요금 페이지를 확인하고,
> 대시보드의 Metrics 로 한 수업을 돌려 본 뒤 판단하세요.
> 위 숫자는 「한 판에 이 정도가 오간다」는 가늠용입니다.

한 가지 분명한 것: **hibernation API 를 쓴다고 경기 중 비용까지 사라지지는 않습니다.**
잠들어 있는 동안의 연결 유지 비용은 줄지만, 경기 중에는 초당 10장 넘는 메시지가
오가므로 그만큼의 처리 시간이 듭니다.

---

## 7. 주소

| 쓰는 사람 | 주소 |
|---|---|
| 첫 화면 | `https://<주소>/` |
| 교사 | `https://<주소>/teacher?code=<코드>` (방을 만든 기기에서만 열립니다) |
| 학생 | `https://<주소>/join?code=<코드>` — QR 에 들어가는 것도 이것입니다 |
| 혼자 뽑기 | `https://<주소>/local` (서버 없이 됩니다) |
| 삽입용 | `https://<주소>/embed` (SDK 가 iframe 으로 띄웁니다. 직접 열면 아무 일도 없습니다) |

교사 권한은 방을 만든 브라우저의 저장소에만 있습니다. QR 에는 들어가지 않습니다.

---

## 8. 예제 수업 앱 돌려 보기

```bash
npm run build --workspace=packages/embed-sdk   # SDK 번들
npm run dev:worker                              # 8787
npm run dev:host                                # 5180
```

`apps/worker/.dev.vars` 의 `INTEGRATION_SECRETS` 안 `secret` 과
예제 서버의 `SHARED_SECRET`(기본 `local-dev-secret-change-me-0123456789`)이
같아야 합니다.

그다음 <http://127.0.0.1:5180> 에서 「활동 열기(교사)」를 누르세요.
