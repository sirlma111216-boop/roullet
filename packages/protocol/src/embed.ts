/**
 * 부모 수업 앱 ↔ /embed iframe 사이의 postMessage 계약.
 *
 * WebSocket 프로토콜과 별개다. 이쪽은 요청/응답이 있고, origin 을 반드시 확인한다.
 */

import type { Participant, RoundConfig, RoundResult, RuleSnapshot } from './domain.ts';

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

export interface MountPayload {
  /** 부모 앱을 가리키는 id(서버에 등록된 값) */
  integrationId: string;
  /** 부모 서버가 발급한 일회성 launch ticket */
  ticket: string;
  /** 화면 언어 — 지금은 'ko' 만 */
  locale?: string;
  /** 교사 화면으로 열 것인가 학생 화면으로 열 것인가 */
  view: 'teacher' | 'student';
  /** 연동 모드에서는 코드·QR 상자를 숨긴다 */
  hideJoinUi?: boolean;
}

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
  roomId: string;
  joinCode: string;
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
  /** 부모가 조회 API 로 다시 확인할 주소 */
  verifyUrl: string;
  /** 서버가 서명해 부모 서버로 보냈는가 */
  webhookSent: boolean;
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
