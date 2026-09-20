/**
 * WebSocket 메시지 형식.
 *
 * 한 프레임 = `{ t: 종류, i?: 요청 번호, d?: 실을 것 }`.
 * `i` 가 있는 요청에는 서버가 같은 `i` 로 `ack` 또는 `nack` 을 돌려준다.
 */

import type {
  Award,
  JoinCode,
  Participant,
  ParticipantId,
  RaceFrame,
  RoomSnapshot,
  RoundConfig,
  RoundId,
  RoundResult,
  RuleSnapshot,
  WinnerEntry,
} from './domain.ts';

export type Role = 'teacher' | 'student' | 'spectator';

/* ------------------------------------------------------------------ 클라이언트 → 서버 */

/** 붙자마자 보내는 첫 인사. 이것 전에는 다른 메시지를 받지 않는다. */
export interface HelloPayload {
  protocolVersion: number;
  role: Role;
  /** 교사 권한 토큰. 학생 연결에는 절대 실리지 않는다. */
  teacherToken?: string;
  /** 다시 붙을 때 쓰는 학생 자격(참가자 복구용) */
  rejoinToken?: string;
  /** 처음 들어오는 학생이 고른 닉네임 */
  nickname?: string;
  /** 부모 수업 앱이 발급한 launch ticket(연동 입장) */
  ticket?: string;
  /** 이 기기를 가리키는 무작위 값. 이름이 아니다. */
  deviceToken?: string;
}

/** 교사가 명단을 만지는 한 가지 동작 */
export type RosterCommand =
  | { op: 'add'; nickname: string }
  | { op: 'addMany'; nicknames: string[] }
  | { op: 'rename'; participantId: ParticipantId; nickname: string }
  | { op: 'exclude'; participantId: ParticipantId; excluded: boolean }
  | { op: 'remove'; participantId: ParticipantId }
  /** 내보내고 같은 자격으로 다시 못 들어오게 한다 */
  | { op: 'kick'; participantId: ParticipantId; banRejoin: boolean }
  | { op: 'lock'; locked: boolean }
  | { op: 'clearExclusions' };

export type ClientMessage =
  | { t: 'hello'; i: string; d: HelloPayload }
  | { t: 'ping'; i?: string; d?: { at: number } }
  /** 교사 브라우저의 물리 런타임이 호스트 자리를 잡는다 */
  | { t: 'host:claim'; i: string; d: { runtimeId: string } }
  /** 경기 중 흐르는 프레임 */
  | { t: 'host:frame'; d: RaceFrame }
  /** 결승 도착. 프레임과 별개로 반드시 도달해야 하므로 ack 를 받는다. */
  | { t: 'host:finish'; i: string; d: { roundId: RoundId; epoch: number; entries: HostFinishEntry[] } }
  /** 라운드가 끝났다(전원 도착 또는 규칙 충족 또는 제한시간) */
  | { t: 'host:complete'; i: string; d: { roundId: RoundId; epoch: number; reason: 'completed' | 'timeout'; assistCount: number } }
  /** 시뮬레이션이 멈췄다 */
  | { t: 'host:stalled'; i: string; d: { roundId: RoundId; epoch: number; reason: string } }
  | { t: 'teacher:config'; i: string; d: { config: RoundConfig } }
  | { t: 'teacher:roster'; i: string; d: { commands: RosterCommand[] } }
  | { t: 'teacher:start'; i: string; d: { countdownSec: number } }
  | { t: 'teacher:cancel'; i: string; d: { roundId: RoundId; reason: string } }
  | { t: 'teacher:close'; i: string; d: { deleteData: boolean } }
  /** 이미 발표한 결과를 고친다. 원본과 사유를 남긴다. */
  | { t: 'teacher:reviseResult'; i: string; d: { roundId: RoundId; winners: WinnerEntry[]; note: string } };

export interface HostFinishEntry {
  /** RuleSnapshot.racers 안에서의 자리 */
  racerIndex: number;
  rank: number;
  timeMs: number;
  tiebroken: boolean;
}

/* ------------------------------------------------------------------ 서버 → 클라이언트 */

export type ServerMessage =
  | { t: 'ack'; i: string; d: unknown }
  | { t: 'nack'; i: string; d: { code: string; message: string } }
  /** 통째로 내려보내는 방 상태. 받는 쪽은 필드별로 다시 만들지 말고 통째로 갈아 끼운다. */
  | { t: 'snapshot'; d: RoomSnapshot }
  | {
      t: 'countdown';
      d: {
        roundId: RoundId;
        /** 서버 시계 기준의 출발 시각. 표시용 참고값일 뿐이다. */
        startsAt: number;
        /**
         * 지금부터 몇 ms 뒤에 출발하는지.
         *
         * ★ 받는 쪽은 **이 길이**를 쓴다. startsAt 을 제 Date.now() 와 빼면
         *   교실 PC 의 시계가 어긋난 만큼 출발이 밀리거나 당겨진다.
         */
        countdownMs: number;
        snapshot: RuleSnapshot;
      };
    }
  | { t: 'frame'; d: RaceFrame }
  | { t: 'result'; d: RoundResult }
  /** 경기가 중단됨 — 새 결과를 확정하지 않는다 */
  | { t: 'interrupted'; d: { roundId: RoundId | null; reason: string; canResume: boolean } }
  | { t: 'closed'; d: { reason: string } }
  | { t: 'error'; d: { code: string; message: string } };

/** hello 에 대한 ack 의 내용 */
export interface HelloAck {
  protocolVersion: number;
  role: Role;
  roomId: string;
  joinCode: JoinCode;
  /** 학생 자신의 참가자 정보(교사·관전자는 null) */
  me: Participant | null;
  /** 다음에 다시 붙을 때 쓸 자격. 이 연결에만 준다. */
  rejoinToken: string | null;
  snapshot: RoomSnapshot;
}

/** host:claim 에 대한 ack */
export interface HostClaimAck {
  epoch: number;
  /** 이미 다른 런타임이 호스트면 false — 그쪽을 밀어내지 않는다 */
  granted: boolean;
  currentRuntimeId: string | null;
}

/* ------------------------------------------------------------------ 오류 코드 */

export const ErrorCodes = {
  BAD_MESSAGE: 'bad_message',
  BAD_PROTOCOL: 'bad_protocol_version',
  NOT_AUTHORIZED: 'not_authorized',
  ROOM_LOCKED: 'room_locked',
  ROOM_FULL: 'room_full',
  ROOM_CLOSED: 'room_closed',
  BAD_STATE: 'bad_state',
  BAD_RULE: 'bad_rule',
  NOT_ENOUGH_PARTICIPANTS: 'not_enough_participants',
  STALE_ROUND: 'stale_round',
  STALE_EPOCH: 'stale_epoch',
  HOST_TAKEN: 'host_taken',
  RATE_LIMITED: 'rate_limited',
  TICKET_INVALID: 'ticket_invalid',
  NICKNAME_INVALID: 'nickname_invalid',
  NOT_FOUND: 'not_found',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/* ------------------------------------------------------------------ 만들기 도우미 */

export function ack(i: string, d: unknown): string {
  return JSON.stringify({ t: 'ack', i, d });
}

export function nack(i: string, code: ErrorCode, message: string): string {
  return JSON.stringify({ t: 'nack', i, d: { code, message } });
}

export function push(t: ServerMessage['t'], d: unknown): string {
  return JSON.stringify({ t, d });
}

/** 들어온 원문을 객체로. 형식이 아니면 null. */
export function decode(raw: unknown): { t: string; i?: string; d?: unknown } | null {
  if (typeof raw !== 'string') return null;
  if (raw.length > 512 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const msg = parsed as Record<string, unknown>;
  if (typeof msg.t !== 'string') return null;
  const out: { t: string; i?: string; d?: unknown } = { t: msg.t };
  if (typeof msg.i === 'string') out.i = msg.i.slice(0, 64);
  if ('d' in msg) out.d = msg.d;
  return out;
}

export type { Award, RoundResult, RuleSnapshot };
