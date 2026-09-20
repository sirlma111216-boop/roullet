/**
 * Worker 진입점.
 *
 * 하는 일:
 *  1. `/api/*` 와 `/ws` 를 방(Durable Object)으로 넘긴다
 *  2. 그 밖에는 화면(정적 자산)을 내보내고, 없는 경로는 index.html 로 돌려 SPA 새로고침을 살린다
 *
 * 중요: `/api/*` 의 404·500 을 **index.html 로 바꾸지 않는다.** 그렇게 하면
 * 클라이언트가 JSON 을 기대하는 자리에서 HTML 을 받아 「알 수 없는 오류」만 보게 된다.
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isValidJoinCode,
  MAX_CAPACITY,
  normalizeJoinCode,
  PROTOCOL_VERSION,
} from '@marble/protocol';
import { ALL_MAPS } from '@marble/game-core/maps';
import { parseIntegrations } from './tickets.ts';
import { timingSafeEqual } from './crypto.ts';

import type { RoomDO } from './room.ts';
export { RoomDO } from './room.ts';

export interface Env {
  /** 방 하나가 Durable Object 하나다. 클래스를 붙여 두면 메서드 호출이 타입으로 검사된다. */
  ROOM: DurableObjectNamespace<RoomDO>;
  ASSETS: Fetcher;
  INTEGRATION_SECRETS?: string;
  /** iframe 으로 띄울 수 있는 부모 origin 목록(쉼표로 구분). CSP frame-ancestors 와 같은 값을 쓴다. */
  EMBED_ALLOWED_ORIGINS?: string;
}

const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });

const fail = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, { status });

const roomStub = (env: Env, code: string): DurableObjectStub<RoomDO> =>
  env.ROOM.get(env.ROOM.idFromName(`room:${code}`));

function makeCode(): string {
  const b = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(b);
  let out = '';
  for (const x of b) out += CODE_ALPHABET[x % CODE_ALPHABET.length];
  return out;
}

/** 방 만들기에 거는 아주 단순한 속도 제한(같은 IP 기준) */
const createBuckets = new Map<string, { tokens: number; at: number }>();
const CREATE_PER_MINUTE = 10;

function allowCreate(ip: string): boolean {
  const now = Date.now();
  let b = createBuckets.get(ip);
  if (!b) {
    b = { tokens: CREATE_PER_MINUTE, at: now };
    createBuckets.set(ip, b);
  }
  b.tokens = Math.min(CREATE_PER_MINUTE, b.tokens + ((now - b.at) / 60_000) * CREATE_PER_MINUTE);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  // 오래된 것을 가끔 비운다
  if (createBuckets.size > 5000) createBuckets.clear();
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/ws' || pathname.startsWith('/api/')) {
        return await handleApi(request, env, url);
      }
    } catch (err) {
      // API 오류는 API 형식으로 돌려준다 — 절대로 index.html 로 바꾸지 않는다
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      return fail(500, 'internal_error', message);
    }

    return serveAssets(request, env, url);
  },
};

/* ------------------------------------------------------------------ API */

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;

  /* ---- 실시간 ---- */
  if (pathname === '/ws') {
    const code = normalizeJoinCode(url.searchParams.get('code'));
    if (!isValidJoinCode(code)) return fail(400, 'bad_code', '참여 코드가 올바르지 않습니다.');
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return fail(426, 'upgrade_required', 'WebSocket 연결이 아닙니다.');
    }
    return roomStub(env, code).fetch(request);
  }

  /* ---- 건강 확인 ---- */
  if (pathname === '/api/health') {
    const integrations = parseIntegrations(env.INTEGRATION_SECRETS);
    return json({
      ok: true,
      runtime: 'cloudflare-workers',
      protocolVersion: PROTOCOL_VERSION,
      maps: ALL_MAPS.length,
      // 비밀 자체는 절대 내보내지 않는다. 「설정됐는지」만 알린다.
      integrationsConfigured: Object.keys(integrations),
      embedOriginsConfigured: (env.EMBED_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean).length,
    });
  }

  /* ---- 맵 목록(화면이 카드 만들 때 쓸 수 있다) ---- */
  if (pathname === '/api/maps') {
    return json({
      maps: ALL_MAPS.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        version: m.version,
        description: m.description,
        highlights: m.highlights,
        estimatedDurationSec: m.estimatedDurationSec,
        timeLimitSec: m.timeLimitSec,
      })),
    });
  }

  /* ---- 방 만들기 ---- */
  if (pathname === '/api/rooms' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!allowCreate(ip)) return fail(429, 'rate_limited', '방을 너무 자주 만들었습니다. 잠시 뒤 다시 시도하세요.');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const capacity = typeof body.capacity === 'number' ? Math.min(MAX_CAPACITY, Math.max(1, body.capacity)) : 60;
    const integrationId = typeof body.integrationId === 'string' ? body.integrationId.slice(0, 64) : null;
    const activityId = typeof body.activityId === 'string' ? body.activityId.slice(0, 128) : null;

    // 연동 방은 **부모 앱의 서버**만 만들 수 있다. 공유 비밀을 헤더로 증명해야 한다.
    // (브라우저에서 만들 수 있게 두면 아무나 남의 수업 앱 이름으로 방을 열 수 있다.)
    if (integrationId) {
      const integrations = parseIntegrations(env.INTEGRATION_SECRETS);
      const cfg = integrations[integrationId];
      if (!cfg) return fail(400, 'unknown_integration', '등록되지 않은 연동입니다.');
      const presented = request.headers.get('x-marble-secret') ?? '';
      if (!presented || !timingSafeEqual(presented, cfg.secret)) {
        return fail(401, 'bad_integration_secret', '연동 비밀이 맞지 않습니다. 부모 앱 서버에서 호출해야 합니다.');
      }
    }

    // 코드가 이미 쓰이고 있으면 다른 코드로 다시 시도한다
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeCode();
      const created = await roomStub(env, code).createRoom({ joinCode: code, capacity, integrationId, activityId });
      if (created) {
        return json({
          joinCode: code,
          roomId: created.roomId,
          // 이 토큰은 여기서 한 번만 나간다. 교사 기기에만 보관된다.
          teacherToken: created.teacherToken,
          capacity,
          protocolVersion: PROTOCOL_VERSION,
        });
      }
    }
    return fail(503, 'code_exhausted', '지금은 방을 만들 수 없습니다. 잠시 뒤 다시 시도하세요.');
  }

  /* ---- 방 확인 (학생 입장 화면) ---- */
  const infoMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{1,8})$/);
  if (infoMatch && request.method === 'GET') {
    const code = normalizeJoinCode(infoMatch[1]);
    if (!isValidJoinCode(code)) return fail(400, 'bad_code', '참여 코드가 올바르지 않습니다.');
    const info = await roomStub(env, code).publicInfo();
    if (!info.exists) return fail(404, 'not_found', '그 코드의 방을 찾을 수 없습니다.');
    return json(info);
  }

  /* ---- 결과 다시 확인 (교사 또는 연동된 부모 앱 서버) ---- */
  const resultMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{1,8})\/results\/([A-Za-z0-9]{1,64})$/);
  if (resultMatch && request.method === 'GET') {
    const code = normalizeJoinCode(resultMatch[1]);
    if (!isValidJoinCode(code)) return fail(400, 'bad_code', '참여 코드가 올바르지 않습니다.');
    const auth = request.headers.get('authorization') ?? '';
    const teacherToken = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const integrationId = request.headers.get('x-marble-integration') ?? undefined;

    // 연동 서버라면 공유 비밀을 헤더로 증명해야 한다
    let verifiedIntegration: string | undefined;
    if (integrationId) {
      const integrations = parseIntegrations(env.INTEGRATION_SECRETS);
      const cfg = integrations[integrationId];
      const presented = request.headers.get('x-marble-secret') ?? '';
      // 앞자리부터 맞춰 가며 알아내지 못하도록 길이에 상관없이 같은 시간으로 견준다
      if (cfg && presented && timingSafeEqual(presented, cfg.secret)) verifiedIntegration = integrationId;
    }

    const result = await roomStub(env, code).getResult(resultMatch[2]!, teacherToken, verifiedIntegration);
    if (!result) return fail(404, 'not_found', '결과를 찾을 수 없거나 볼 권한이 없습니다.');
    return json({ result });
  }

  return fail(404, 'not_found', '그런 API 는 없습니다.');
}

/* ------------------------------------------------------------------ 화면 */

async function serveAssets(request: Request, env: Env, url: URL): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return withSecurityHeaders(asset, env, url);

  // SPA — 없는 경로는 첫 화면으로 돌려보낸다
  const index = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
  return withSecurityHeaders(index, env, url);
}

/**
 * 보안 헤더.
 *
 * frame-ancestors 는 «누가 우리를 iframe 에 넣을 수 있는가» 다.
 * 설정한 origin 이 없으면 아무도 못 넣는다 — 기본을 열어 두지 않는다.
 */
function withSecurityHeaders(res: Response, env: Env, url: URL): Response {
  const origins = (env.EMBED_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const frameAncestors = origins.length > 0 ? `'self' ${origins.join(' ')}` : `'self'`;

  const headers = new Headers(res.headers);
  headers.set(
    'content-security-policy',
    [
      `default-src 'self'`,
      // 번들은 자기 자신에서만 온다. 외부 스크립트·추적 코드를 넣지 않는다.
      `script-src 'self' 'wasm-unsafe-eval'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob:`,
      `font-src 'self'`,
      `connect-src 'self' ws: wss:`,
      `worker-src 'self' blob:`,
      `frame-ancestors ${frameAncestors}`,
      `base-uri 'self'`,
      `form-action 'none'`,
    ].join('; '),
  );
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  // /embed 는 iframe 안에서 열리므로 X-Frame-Options 를 쓰지 않는다(CSP 로 다룬다)
  if (!url.pathname.startsWith('/embed')) headers.set('x-frame-options', 'SAMEORIGIN');

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
