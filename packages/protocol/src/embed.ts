/**
 * 부모 수업 앱 ↔ /embed iframe 사이의 postMessage 계약.
 *
 * WebSocket 프로토콜과 별개다. 이쪽은 요청/응답이 있고, origin 을 반드시 확인한다.
 */

import type { Participant, RoundConfig, RoundResult, RuleSnapshot } from './domain.ts';
import { cleanNickname } from './validate.ts';

export const EMBED_PROTOCOL_VERSION = 1;

/** 활동 앱이 할 수 있다고 알리는 것. 부모는 필요한 것이 없으면 화면에 적는다. */
export const EMBED_CAPABILITIES = [
  'participants.set',
  'config.set',
  'round.start',
  'round.cancel',
  'round.reset',
  'result.signed-webhook',
  'ticket.exchange',
  /** 서버 없이 iframe 안에서만 도는 모드를 할 줄 안다 */
  'mode.local',
] as const;

export type EmbedCapability = (typeof EMBED_CAPABILITIES)[number];

/** 모든 메시지가 공통으로 지고 다니는 봉투 */
export interface EmbedEnvelope<T extends string = string, P = unknown> {
  /** 이 봉투가 우리 것임을 알아보는 표식 */
  channel: 'classroom-marble-race';
  protocolVersion: number;
  /** 한 iframe 마운트의 생애. 다른 세션의 메시지는 버린다. */
  sessionId: string;
  /** 요청/응답 짝짓기. 알림(이벤트)에는 없다. */
  requestId?: string;
  type: T;
  payload: P;
}

/* ------------------------------------------------------------------ 부모 → 활동 */

export type HostRequestType =
  | 'mount'
  | 'setParticipants'
  | 'setConfig'
  | 'startRound'
  | 'cancelRound'
  | 'resetRound'
  | 'getResult'
  | 'destroy';

/**
 * 두 가지 모드가 있다. 고르는 기준은 **학생 휴대폰이 필요한가** 하나뿐이다.
 *
 * - `local`  : iframe 안에서 혼자 돈다. 서버도 방도 티켓도 없다.
 *              화면 하나(프로젝터)에서 뽑을 때. 부모 앱에 서버가 없어도 된다.
 *              결과는 **이 브라우저가 계산한 값**이다 — 서버가 확인해 준 것이 아니다.
 * - `live`   : 방을 만들고 학생이 각자 기기로 들어온다. 부모 **서버**가 서명한
 *              티켓이 필요하고, 활동 앱에 그 연동을 미리 등록해 두어야 한다.
 */
export type EmbedMode = 'local' | 'live';

export interface MountPayload {
  /**
   * 어느 모드로 열 것인가. 없으면 `live` 로 본다(옛 부모 앱과 호환).
   */
  mode?: EmbedMode;
  /** 부모 앱을 가리키는 id(서버에 등록된 값). `local` 에서는 쓰지 않는다. */
  integrationId?: string;
  /** 부모 서버가 발급한 일회성 launch ticket. `local` 에서는 없어야 한다. */
  ticket?: string;
  /** 화면 언어 — 지금은 'ko' 만 */
  locale?: string;
  /** 교사 화면으로 열 것인가 학생 화면으로 열 것인가. `local` 은 늘 교사 화면이다. */
  view: 'teacher' | 'student';
  /** 연동 모드에서는 코드·QR 상자를 숨긴다 */
  hideJoinUi?: boolean;
  /**
   * `local` 전용 — 처음부터 넣어 둘 명단.
   * 이것을 주면 mount 한 번으로 바로 시작할 수 있다.
   */
  participants?: SetParticipantsPayload['participants'];
}

export type MountCheck =
  | { ok: true; value: MountPayload & { mode: EmbedMode } }
  | { ok: false; code: string; message: string };

/**
 * mount 요청을 검사한다.
 *
 * 핵심은 **모드마다 요구하는 것이 다르다**는 점이다. local 인데 티켓을 받거나,
 * live 인데 티켓이 없으면 거절한다. 조용히 다른 모드로 넘어가면 부모 앱은
 * 「왜 학생이 못 들어오지」를 영영 알 수 없다.
 */
export function parseMountPayload(raw: unknown): MountCheck {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'bad_payload', message: 'mount 내용이 비었습니다.' };
  }
  const p = raw as Record<string, unknown>;

  // 없으면 live — 이 값을 모르던 옛 부모 앱이 그대로 돌아야 한다
  if (p.mode !== undefined && p.mode !== 'local' && p.mode !== 'live') {
    return { ok: false, code: 'bad_mode', message: `모르는 모드입니다: ${String(p.mode)}` };
  }
  const mode: EmbedMode = p.mode === 'local' ? 'local' : 'live';

  if (p.view !== 'teacher' && p.view !== 'student') {
    return { ok: false, code: 'bad_view', message: "view 는 'teacher' 또는 'student' 여야 합니다." };
  }

  if (mode === 'local') {
    // 티켓을 들고 local 로 오는 것은 부모 앱이 모드를 헷갈린 것이다.
    // 받아 주면 「서명했는데 왜 학생이 못 들어오지」로 오래 헤매게 된다.
    if (typeof p.ticket === 'string' && p.ticket) {
      return {
        ok: false,
        code: 'ticket_in_local',
        message: "local 모드에는 티켓이 필요 없습니다. 학생 기기까지 쓰려면 mode: 'live' 로 여세요.",
      };
    }
    const participants = p.participants === undefined ? undefined : parseLocalParticipants(p.participants);
    if (participants && 'message' in participants) {
      return { ok: false, code: 'bad_participants', message: participants.message };
    }
    return {
      ok: true,
      value: {
        mode,
        // local 은 언제나 교사 화면이다 — 이 iframe 이 곧 진행자 화면이다
        view: 'teacher',
        locale: typeof p.locale === 'string' ? p.locale : undefined,
        hideJoinUi: p.hideJoinUi !== false,
        participants: participants as SetParticipantsPayload['participants'] | undefined,
      },
    };
  }

  if (typeof p.ticket !== 'string' || !p.ticket) {
    return {
      ok: false,
      code: 'no_ticket',
      message: "티켓이 없습니다. 서버 없이 쓰려면 mode: 'local' 로 여세요.",
    };
  }

  return {
    ok: true,
    value: {
      mode,
      integrationId: typeof p.integrationId === 'string' ? p.integrationId : '',
      ticket: p.ticket,
      locale: typeof p.locale === 'string' ? p.locale : undefined,
      view: p.view,
      hideJoinUi: p.hideJoinUi !== false,
    },
  };
}

/** local 모드 명단 다듬기. 빈 이름은 버리고, 너무 많으면 거절한다. */
function parseLocalParticipants(
  raw: unknown,
): SetParticipantsPayload['participants'] | { message: string } {
  if (!Array.isArray(raw)) return { message: '명단은 배열이어야 합니다.' };
  if (raw.length > LOCAL_MAX_PARTICIPANTS) {
    return { message: `한 번에 ${LOCAL_MAX_PARTICIPANTS}명까지만 넣을 수 있습니다.` };
  }
  const out: SetParticipantsPayload['participants'] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') continue;
    const nickname = cleanNickname(String(v.nickname ?? ''));
    if (!nickname) continue;
    out.push({
      // 부모가 id 를 안 주면 자리 번호로 만든다 — 결과를 되짚을 수 있어야 한다
      id: typeof v.id === 'string' && v.id ? v.id : `p${i}`,
      nickname,
      avatarColor: typeof v.avatarColor === 'string' ? v.avatarColor : undefined,
    });
  }
  return out;
}

/** local 모드 한 판 인원 상한 — 실시간 모드의 방 정원과 같다 */
export const LOCAL_MAX_PARTICIPANTS = 100;

export interface SetParticipantsPayload {
  participants: Array<{
    /** 부모 수업 앱의 안정적인 학생 ID. 닉네임이 아니다. */
    id: string;
    nickname: string;
    /** 없으면 서버가 시드로 정한다 */
    avatarColor?: string;
  }>;
}

export interface SetConfigPayload {
  config: Partial<RoundConfig>;
}

export interface StartRoundPayload {
  countdownSec?: number;
}

/* ------------------------------------------------------------------ 활동 → 부모 */

export type EmbedEventType =
  /** iframe 이 살아 있고 이 판을 쓴다 — mount 전에 먼저 보낸다 */
  | 'available'
  /** mount 를 받아들이고 방이 준비됨 */
  | 'ready'
  /** 로비 인원·접속 상태가 바뀜 */
  | 'participantsChanged'
  | 'roundStarted'
  | 'roundFinished'
  | 'error';

export interface AvailablePayload {
  protocolVersion: number;
  capabilities: readonly EmbedCapability[];
  /** 배포 판 — 부모가 「옛 배포」를 알아볼 수 있게 */
  build: string;
}

export interface ReadyPayload {
  /** 어느 모드로 열렸는지. 부모는 이걸로 자기 화면을 맞춘다. */
  mode: EmbedMode;
  /** local 모드에는 방이 없다 */
  roomId: string | null;
  /** local 모드에는 참여 코드가 없다 */
  joinCode: string | null;
  view: 'teacher' | 'student';
  /** 연동으로 들어온 이 사람의 참가자 id(학생 화면일 때) */
  participantId: string | null;
  mapIds: string[];
  config: RoundConfig;
}

export interface ParticipantsChangedPayload {
  participants: Array<Pick<Participant, 'id' | 'nickname' | 'online' | 'excluded'> & { externalId?: string }>;
  /** 붙어 있는 사람 수 — 부모 콘솔의 「연결 N명」 */
  onlineCount: number;
  totalCount: number;
  participantSnapshotVersion: number;
}

export interface RoundStartedPayload {
  roundId: string;
  snapshot: RuleSnapshot;
  startsAt: number;
}

/**
 * 화면용 결과. **이것만 믿고 발표하지 않는다** — 부모 앱은 서명된 webhook 또는
 * 인증된 조회 API 로 같은 roundId/revision 을 다시 확인한다.
 */
export interface RoundFinishedPayload {
  result: RoundResult;
  /**
   * 부모가 조회 API 로 다시 확인할 주소.
   * **local 모드에서는 null** 이다 — 확인해 줄 서버가 애초에 없다.
   */
  verifyUrl: string | null;
  /** 서버가 서명해 부모 서버로 보냈는가. local 모드에서는 늘 false. */
  webhookSent: boolean;
  /**
   * 이 결과를 **서버가 정했는가**.
   *
   * live 모드는 true — 당첨자는 서버만 고르고, 화면은 그것을 받아 그린다.
   * local 모드는 false — 이 브라우저가 계산한 값이다. 개발자 도구를 열 수 있는
   * 사람이라면 바꿀 수 있다. 화면 하나에서 다 같이 보는 용도이므로 그것으로 충분하지만,
   * 성적처럼 다툼이 생길 수 있는 곳에 쓰려면 live 모드를 써야 한다.
   */
  serverVerified: boolean;
}

export interface EmbedErrorPayload {
  code: string;
  message: string;
  /** 어떤 요청 때문에 났는지(있으면) */
  requestId?: string;
}

/* ------------------------------------------------------------------ 응답 */

export interface EmbedResponsePayload<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/** 요청 하나가 답을 기다리는 시간 */
export const EMBED_REQUEST_TIMEOUT_MS = 15_000;

/** 봉투가 우리 것인지 본다. origin·source 확인은 부르는 쪽이 따로 한다. */
export function isEmbedEnvelope(data: unknown): data is EmbedEnvelope {
  if (!data || typeof data !== 'object') return false;
  const e = data as Record<string, unknown>;
  return (
    e.channel === 'classroom-marble-race' &&
    typeof e.protocolVersion === 'number' &&
    typeof e.sessionId === 'string' &&
    typeof e.type === 'string'
  );
}
