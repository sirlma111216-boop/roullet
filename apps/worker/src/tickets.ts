/**
 * launch ticket — 부모 수업 앱이 「이 사람은 누구다」를 서명해 건네는 쪽지.
 *
 *   ticket = base64url(JSON) + '.' + base64url(HMAC-SHA256(secret, base64url(JSON)))
 *
 * 발급은 **부모 앱의 서버**만 한다. 이 파일은 검증만 한다(그리고 예제 앱이 발급에 쓴다).
 *
 * 지키는 것:
 *  - 닉네임 문자열이나 role 글자만으로 교사 권한을 주지 않는다. 서명이 맞아야 한다.
 *  - 브라우저가 따로 보낸 id·이름은 무시하고, **티켓 안의 값만** 쓴다.
 *  - 만료를 본다. 유효 기간은 한 수업 시간 정도(기본 120분)로 잡는다 —
 *    경기 중 새로고침해도 같은 티켓으로 다시 들어와야 하기 때문이다.
 */

import { b64urlDecodeString, b64urlEncodeString, hmacB64url, timingSafeEqual } from './crypto.ts';

export interface TicketClaims {
  /** 발급자(부모 수업 앱) */
  iss: string;
  /** 이 티켓이 쓰일 활동 앱 */
  aud: string;
  /** 연동 id — 서버가 비밀을 찾는 열쇠 */
  integrationId: string;
  /** 부모 앱의 수업/세션 id */
  sessionId: string;
  /** 이 활동 실행 한 번을 가리키는 id. 지난 활동의 티켓을 막는다. */
  activityId: string;
  /**
   * 들어갈 방의 참여 코드.
   *
   * 방은 **부모 앱의 서버**가 미리 만들고, 그 코드를 티켓에 적어 건넨다.
   * 그래서 교사 토큰이 브라우저로 내려갈 일이 없다 — 교사 권한은 서명된 티켓이 증명한다.
   */
  roomCode: string;
  /** 부모 앱의 안정적인 학생·교사 id */
  sub: string;
  /** 화면에 적을 이름 */
  name: string;
  role: 'teacher' | 'student';
  /** 이 티켓으로 열 수 있는 부모 페이지의 origin */
  origin: string;
  /** 발급 시각(ms) */
  iat: number;
  /** 만료 시각(ms) */
  exp: number;
  /** 한 번만 쓰도록 하는 값 */
  jti: string;
}

export const TICKET_AUDIENCE = 'classroom-marble-race';
/** 기본 유효 기간 — 한 수업 시간 */
export const TICKET_TTL_MS = 120 * 60 * 1000;

export async function signTicket(secret: string, claims: TicketClaims): Promise<string> {
  const body = b64urlEncodeString(JSON.stringify(claims));
  const sig = await hmacB64url(secret, body);
  return `${body}.${sig}`;
}

export type TicketCheck =
  | { ok: true; claims: TicketClaims }
  | { ok: false; reason: string };

/**
 * 티켓을 검증한다.
 * @param lookupSecret integrationId 로 비밀을 찾아 주는 함수. 모르면 null.
 * @param lookupOrigins 그 연동에 등록된 부모 앱 주소들. 비어 있으면 주소 검사를 건너뛴다.
 */
export async function verifyTicket(
  ticket: string,
  lookupSecret: (integrationId: string) => string | null,
  now = Date.now(),
  lookupOrigins: (integrationId: string) => string[] = () => [],
): Promise<TicketCheck> {
  if (typeof ticket !== 'string' || ticket.length > 4096) return { ok: false, reason: '티켓 형식이 아닙니다.' };
  const dot = ticket.indexOf('.');
  if (dot <= 0) return { ok: false, reason: '티켓 형식이 아닙니다.' };
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);

  let claims: TicketClaims;
  try {
    claims = JSON.parse(b64urlDecodeString(body)) as TicketClaims;
  } catch {
    return { ok: false, reason: '티켓을 읽을 수 없습니다.' };
  }

  if (!claims || typeof claims !== 'object') return { ok: false, reason: '티켓 내용이 비었습니다.' };
  if (typeof claims.integrationId !== 'string' || !claims.integrationId) {
    return { ok: false, reason: '연동 id 가 없습니다.' };
  }

  const secret = lookupSecret(claims.integrationId);
  if (!secret) return { ok: false, reason: '모르는 연동입니다.' };

  // 서명을 먼저 본다 — 내용은 서명이 맞은 뒤에야 믿는다
  const expected = await hmacB64url(secret, body);
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: '서명이 맞지 않습니다.' };

  if (claims.aud !== TICKET_AUDIENCE) return { ok: false, reason: '다른 앱의 티켓입니다.' };
  if (typeof claims.exp !== 'number' || now > claims.exp) return { ok: false, reason: '티켓이 만료되었습니다.' };
  if (typeof claims.iat === 'number' && claims.iat - 60_000 > now) {
    return { ok: false, reason: '티켓의 발급 시각이 미래입니다.' };
  }
  if (claims.role !== 'teacher' && claims.role !== 'student') {
    return { ok: false, reason: '역할이 올바르지 않습니다.' };
  }
  if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, reason: '참가자 id 가 없습니다.' };
  if (typeof claims.activityId !== 'string' || !claims.activityId) {
    return { ok: false, reason: '활동 id 가 없습니다.' };
  }
  if (typeof claims.roomCode !== 'string' || !claims.roomCode) {
    return { ok: false, reason: '방 코드가 없습니다.' };
  }

  // 부모 앱 주소를 적어 두었다면, 티켓이 그중 하나에서 나왔는지 본다.
  // 비워 두면 검사하지 않는다(주소를 모르는 동안에도 쓸 수 있게).
  const allowed = lookupOrigins(claims.integrationId);
  if (allowed.length > 0 && !allowed.includes(claims.origin)) {
    return { ok: false, reason: '이 연동에 등록되지 않은 주소에서 나온 티켓입니다.' };
  }

  return { ok: true, claims };
}

/* ------------------------------------------------------------------ 연동 설정 */

export interface IntegrationConfig {
  secret: string;
  /** 확정된 결과를 서명해 보낼 곳 */
  resultUrl?: string;
  /** iframe 을 띄울 수 있는 부모 origin 목록 */
  origins: string[];
}

/**
 * 환경 변수에서 연동 설정을 읽는다.
 * 형식: {"수업앱id": {"secret":"...", "resultUrl":"https://...", "origins":["https://..."]}}
 *
 * 값이 없거나 형식이 틀리면 **빈 목록**을 돌려준다 — 연동을 조용히 열어 두지 않는다.
 */
export function parseIntegrations(raw: string | undefined): Record<string, IntegrationConfig> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, IntegrationConfig> = {};
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    if (typeof c.secret !== 'string' || c.secret.length < 16) continue;
    out[id] = {
      secret: c.secret,
      resultUrl: typeof c.resultUrl === 'string' ? c.resultUrl : undefined,
      origins: Array.isArray(c.origins) ? c.origins.filter((o): o is string => typeof o === 'string') : [],
    };
  }
  return out;
}
