/**
 * 교실 구슬 레이스 — 도메인 타입.
 *
 * 이 파일은 worker(서버)·web(교사/학생 화면)·embed-sdk 가 모두 같은 것을 뜻하도록
 * 한곳에 모아 둔 계약이다. 여기만 고치면 세 곳이 같이 따라온다.
 */

/** 프로토콜 판. 서버와 클라이언트가 다르면 붙기 전에 알려 준다. */
export const PROTOCOL_VERSION = 1;

/** 기본 수용 인원(교사에게 권하는 값) */
export const DEFAULT_CAPACITY = 60;
/** 검증 상한. 이 수를 넘으면 서버가 입장을 거절한다. */
export const MAX_CAPACITY = 100;

/** 닉네임 길이 상한(글자 수) */
export const NICK_MAX = 12;

/** 방·결과 기본 보존 기간 — 마지막 활동 후 24시간 */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export type RoomId = string;
export type JoinCode = string;
export type ParticipantId = string;
export type RoundId = string;

/** 방의 상태. 전이는 stateMachine.ts 에서 한곳으로 검사한다. */
export type RoomPhase =
  | 'lobby'
  | 'countdown'
  | 'running'
  | 'finished'
  | 'paused'
  | 'cancelled'
  | 'closed';

/** 참가자가 명단에 오른 경로 */
export type ParticipantSource =
  /** 학생이 코드/QR 로 직접 들어옴 */
  | 'self'
  /** 교사가 손으로 추가(기기 없는 학생) */
  | 'teacher'
  /** 부모 수업 앱이 setParticipants 로 넘겨줌 */
  | 'host-app';

export interface Participant {
  id: ParticipantId;
  nickname: string;
  /**
   * 같은 닉네임이 여러 명일 때만 화면에 붙는 짧은 구분 번호(2,3,…).
   * 유일한 닉네임이면 0 이고 화면에 아무것도 붙지 않는다.
   */
  dupIndex: number;
  /** 구슬 색(HSL hue 0~359). 서버가 시드로 배정한다. */
  hue: number;
  source: ParticipantSource;
  /** 부모 수업 앱의 안정적인 학생 ID. 닉네임과 별개로 보관한다. */
  externalId?: string;
  /** 지금 WebSocket 이 붙어 있는가 */
  online: boolean;
  /** 이번 라운드에서 빼기로 한 사람 */
  excluded: boolean;
  joinedAt: number;
}

/** 화면에 적을 이름. 중복일 때만 구분 번호가 붙는다. */
export function displayName(p: Pick<Participant, 'nickname' | 'dupIndex'>): string {
  return p.dupIndex > 0 ? `${p.nickname} (${p.dupIndex})` : p.nickname;
}

/* ------------------------------------------------------------------ 당첨 규칙 */

export type WinnerRule =
  /** 첫 번째 도착자 */
  | { kind: 'first' }
  /** 마지막 도착자 */
  | { kind: 'last' }
  /** 지정한 n번째 도착자 (1부터) */
  | { kind: 'nth'; n: number }
  /** 상위 k명 */
  | { kind: 'topK'; k: number }
  /** 하위 k명 */
  | { kind: 'bottomK'; k: number }
  /** 연속 순위 a~b (둘 다 포함) */
  | { kind: 'range'; from: number; to: number }
  /** 개별 순위 목록 (예: 2·5·8위) */
  | { kind: 'ranks'; ranks: number[] }
  /** 교사 지정 — 물리 경기 결과로 뽑지 않는다 */
  | { kind: 'manual'; participantIds: ParticipantId[] };

export type WinnerRuleKind = WinnerRule['kind'];

/** 당첨자가 맡는 일(발표자·정리 도우미 …) */
export interface Award {
  id: string;
  /** 화면에 적는 말 */
  label: string;
  /**
   * 이 항목이 붙는 순위 슬롯(규칙이 만들어 내는 당첨 자리의 순서, 0부터).
   * 규칙이 3명을 뽑으면 슬롯은 0,1,2 이다.
   */
  slot: number;
}

/** 뽑는 방식. 결과·기록·연동 응답에 그대로 실린다. */
export type SelectionMode = 'physics' | 'manual';

/** 라운드 준비 단계에서 교사가 만지는 설정 */
export interface RoundConfig {
  mapId: string;
  rule: WinnerRule;
  /** 이번 라운드에서 뺄 사람 */
  excludedParticipantIds: ParticipantId[];
  /** 지난 라운드 당첨자를 이번에 빼는가 */
  excludePreviousWinners: boolean;
  /** 자동 충격 스킬(모두에게 같은 규칙). 기본 끔. */
  useSkills: boolean;
  awards: Award[];
  /** 한 사람이 여러 항목을 겹쳐 받게 둘 것인가. 기본 false. */
  allowDuplicateAwards: boolean;
}

export function defaultRoundConfig(mapId: string): RoundConfig {
  return {
    mapId,
    rule: { kind: 'first' },
    excludedParticipantIds: [],
    excludePreviousWinners: false,
    useSkills: false,
    awards: [],
    allowDuplicateAwards: false,
  };
}

/* ------------------------------------------------------------------ 스냅샷 */

/** 라운드에 실제로 나가는 구슬 한 개 */
export interface RacerSnapshot {
  participantId: ParticipantId;
  nickname: string;
  dupIndex: number;
  hue: number;
}

/**
 * 카운트다운 직전에 얼어붙는 것. 이후 라운드가 끝날 때까지 바뀌지 않는다.
 * 진행 중 설정을 바꾸면 다음 라운드의 스냅샷에 들어간다.
 */
export interface RuleSnapshot {
  roundId: RoundId;
  /** 방에서 몇 번째 라운드인가 (1부터) */
  roundNumber: number;
  mapId: string;
  mapVersion: number;
  rule: WinnerRule;
  awards: Award[];
  allowDuplicateAwards: boolean;
  useSkills: boolean;
  selectionMode: SelectionMode;
  /** 배치·타이브레이커에 쓰는 서버 발급 시드 */
  seed: string;
  /**
   * 같은 물리 스텝에 결승선을 통과했고 보간 시점마저 같을 때 쓰는 순서.
   * 라운드 시작 전에 시드로 섞어 정해 둔다. participantId 배열.
   */
  tiebreakOrder: ParticipantId[];
  timeLimitSec: number;
  createdAt: number;
  /** 참가 명단 스냅샷의 판(참가자가 바뀔 때마다 올라간다) */
  participantSnapshotVersion: number;
  racers: RacerSnapshot[];
}

/* ------------------------------------------------------------------ 결과 */

export interface FinishEntry {
  rank: number;
  participantId: ParticipantId;
  nickname: string;
  dupIndex: number;
  /** 결승선 통과 시각(라운드 시작 기준 ms). 보간한 값이다. */
  timeMs: number;
  /** 같은 스텝에 통과해 타이브레이커로 갈린 경우 true */
  tiebroken: boolean;
}

export interface WinnerEntry {
  /** 규칙이 만든 당첨 자리 번호(0부터) */
  slot: number;
  /** 이 자리가 가리키는 도착 순위. manual 모드에서는 null. */
  rank: number | null;
  participantId: ParticipantId;
  nickname: string;
  dupIndex: number;
  /** 붙은 당첨 항목(없으면 null) */
  award: Award | null;
  /** 어떻게 이 사람이 뽑혔는지 — 화면과 기록에 그대로 적는다 */
  selectionReason: string;
}

/** 라운드가 끝난 이유 */
export type RoundOutcome =
  /** 규칙이 요구한 만큼 도착해 정상 확정 */
  | 'completed'
  /** 제한시간을 넘겨 멈춤. 당첨자를 만들어 내지 않는다. */
  | 'timeout'
  /** 교사가 취소했거나 호스트가 사라짐 */
  | 'cancelled';

export interface RoundResult {
  /** 이 결과 전송 한 건의 id. 중복 수신을 걸러 내는 열쇠. */
  eventId: string;
  roundId: RoundId;
  /** 결과를 고칠 때마다 1씩 올라간다. 최초 확정은 1. */
  revision: number;
  mapId: string;
  mapVersion: number;
  ruleSnapshot: RuleSnapshot;
  participantSnapshotVersion: number;
  finishOrder: FinishEntry[];
  winners: WinnerEntry[];
  outcome: RoundOutcome;
  cancelled: boolean;
  selectionMode: SelectionMode;
  finalizedAt: number;
  /** 결과를 고쳤다면 그 사유와 이전 판 */
  revisionNote?: string;
  previousRevision?: number;
  /** 정체 탈출 보조가 몇 번 적용됐는가(공개 값) */
  assistCount?: number;
}

/* ------------------------------------------------------------------ 실시간 프레임 */

/**
 * 경기 중 10Hz 로 흐르는 압축 프레임.
 * 이름·색 같은 고정 정보는 들어 있지 않다 — RuleSnapshot.racers 의 순서를 쓴다.
 */
export interface RaceFrame {
  roundId: RoundId;
  /** 호스트 lease 세대. 옛 호스트의 프레임을 걸러 낸다. */
  epoch: number;
  /** 이 라운드에서 단조 증가. 늦게 도착한 프레임을 버린다. */
  seq: number;
  /** 라운드 시작 기준 경과 ms */
  t: number;
  /**
   * 구슬 위치. racers 순서대로 [x, y, x, y, …] (소수 둘째 자리로 반올림).
   * 결승한 구슬은 NaN 대신 마지막 위치를 유지한다.
   */
  m: number[];
  /** 움직이는 장치의 상태 스칼라(각도·위상). 맵이 정한 순서. */
  d: number[];
  /** 진행 순위 — racers 인덱스를 앞선 순서로 나열 */
  rank: number[];
  /** 이 프레임까지 결승한 구슬: [racerIndex, rank, timeMs, …] */
  fin: number[];
  /** 정체 탈출 보조가 적용된 구슬 인덱스 */
  assist?: number[];
  /** 이 프레임에 터진 장애물(맵 데이터 기준 번호) */
  pop?: number[];
}

/* ------------------------------------------------------------------ 방 상태 */

export interface RoomSummary {
  roomId: RoomId;
  joinCode: JoinCode;
  phase: RoomPhase;
  /** 입장 잠금 */
  locked: boolean;
  capacity: number;
  roundNumber: number;
  currentRoundId: RoundId | null;
  config: RoundConfig;
  participantSnapshotVersion: number;
  /** 호스트(교사 물리 런타임)가 붙어 있는가 */
  hostOnline: boolean;
  /** 경기가 중단된 상태면 그 이유 */
  interruption: string | null;
  createdAt: number;
  updatedAt: number;
  /** 부모 수업 앱과 연동된 방인가 */
  integrationId: string | null;
}

/** 학생·교사 화면이 통째로 받는 한 덩어리 */
export interface RoomSnapshot {
  room: RoomSummary;
  participants: Participant[];
  /** 준비된 라운드의 확정 스냅샷(카운트다운 이후에만 있다) */
  activeRound: RuleSnapshot | null;
  /** 마지막으로 확정된 결과 */
  lastResult: RoundResult | null;
  /** 이전 라운드 당첨자(다음 라운드 제외 옵션이 쓴다) */
  previousWinnerIds: ParticipantId[];
  serverTime: number;
}
