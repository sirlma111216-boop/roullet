/**
 * 방 하나 = Durable Object 하나.
 *
 * 참가 명단·권한·상태 전이·규칙·라운드 id·확정 결과를 여기서만 다룬다.
 * 클라이언트가 보낸 것은 무엇도 그대로 믿지 않는다.
 *
 * ── 이 구조가 무엇을 지키고 무엇을 안 지키는지 ──────────────────────────────
 * 물리 계산은 **신뢰된 교사 브라우저**의 Web Worker 하나가 한다. 서버는 그 결과를
 * 검증(호스트 lease·epoch·roundId·순서·중복·참가자 유효성)하고 학생들에게 중계한다.
 * 이것은 «교사를 믿는 교실용 모델» 이다. 교사가 마음먹고 결과를 조작하는 것까지
 * 막지는 못한다. 서버가 물리를 다시 돌려 검증하지 않기 때문이다.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { DurableObject } from 'cloudflare:workers';
import {
  ack,
  cleanNickname,
  decode,
  defaultRoundConfig,
  DEFAULT_CAPACITY,
  ErrorCodes,
  MAX_CAPACITY,
  nack,
  parseRosterCommands,
  parseRoundConfig,
  parseWinnerRule,
  PROTOCOL_VERSION,
  push,
  ROOM_TTL_MS,
  validateRuleAgainstRacers,
  type ErrorCode,
  type FinishEntry,
  type HelloAck,
  type HostClaimAck,
  type Participant,
  type RaceFrame,
  type RoomPhase,
  type RoomSnapshot,
  type RoundConfig,
  type RoundResult,
  type RosterCommand,
  type RuleSnapshot,
  type WinnerEntry,
} from '@marble/protocol';
import { MAP_IDS, requireMap } from '@marble/game-core/maps';
import { selectWinners } from '@marble/game-core/rules';
import { randomToken, sha256Hex, verifyToken } from './crypto.ts';
import { parseIntegrations, verifyTicket, type IntegrationConfig } from './tickets.ts';
import { sendResultWebhook } from './webhook.ts';

/** 가벼운 알림을 묶어 보내는 간격 */
const BROADCAST_MS = 250;
/** 경기 중 프레임을 학생에게 내보내는 최소 간격(초당 약 12장) */
const FRAME_MIN_INTERVAL_MS = 80;
/** 한 연결이 1초에 보낼 수 있는 메시지 수 */
const RATE_LIMIT_PER_SEC = 40;
/** 호스트(교사 물리 런타임)는 프레임을 자주 보내므로 따로 둔다 */
const HOST_RATE_LIMIT_PER_SEC = 240;

interface StoredParticipant extends Participant {
  /** 재접속 자격의 해시. 원문은 저장하지 않는다. */
  rejoinHash: string | null;
  /** 내보낸 뒤 다시 못 들어오게 막혔는가 */
  banned: boolean;
}

interface RoomData {
  roomId: string;
  joinCode: string;
  createdAt: number;
  updatedAt: number;
  phase: RoomPhase;
  locked: boolean;
  capacity: number;
  roundNumber: number;
  currentRoundId: string | null;
  config: RoundConfig;
  participants: Record<string, StoredParticipant>;
  participantSnapshotVersion: number;
  teacherTokenHash: string | null;
  previousWinnerIds: string[];
  activeRound: RuleSnapshot | null;
  lastResult: RoundResult | null;
  /** 호스트 lease 세대. 새 런타임이 잡을 때마다 오른다. */
  hostEpoch: number;
  hostRuntimeId: string | null;
  interruption: string | null;
  integrationId: string | null;
  /** 연동으로 들어온 활동 실행 id — 지난 활동의 티켓을 막는다 */
  activityId: string | null;
  /** 연동 학생 매핑: 부모 앱 id → 우리 participantId */
  externalMap: Record<string, string>;
  /** 이번 라운드에 서버가 받아 둔 도착 기록 */
  finishEntries: Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }>;
  /** 마지막으로 받아들인 프레임 순번 */
  lastSeq: number;
  /** 이번 라운드의 탈출 보조 횟수 */
  assistCount: number;
}

interface Attachment {
  role: 'teacher' | 'student' | 'spectator';
  participantId?: string;
  /** 이 연결이 호스트 런타임인가 */
  host?: boolean;
  runtimeId?: string;
}

interface Env {
  ROOM: DurableObjectNamespace;
  INTEGRATION_SECRETS?: string;
}

export class RoomDO extends DurableObject<Env> {
  private data: RoomData | null = null;
  private loading: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameOut = 0;
  private readonly buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();
  private integrations: Record<string, IntegrationConfig>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.integrations = parseIntegrations(env.INTEGRATION_SECRETS);
  }

  /* ---------------------------------------------------------------- 저장 */

  private async load(): Promise<RoomData> {
    if (this.data) return this.data;
    this.loading ??= (async () => {
      const saved = await this.ctx.storage.get<RoomData>('room');
      if (saved) {
        // 예전 판에 없던 칸이 생겨도 undefined 로 터지지 않게 기본값을 앞에 깔아 둔다
        this.data = { ...emptyRoom(saved.roomId, saved.joinCode), ...saved };
      }
    })();
    await this.loading;
    this.loading = null;
    if (!this.data) throw new Error('아직 만들어지지 않은 방입니다.');
    return this.data;
  }

  private async save(): Promise<void> {
    if (!this.data) return;
    this.data.updatedAt = Date.now();
    await this.ctx.storage.put('room', this.data);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  /** 보존 기간이 지나면 스스로 지운다 */
  override async alarm(): Promise<void> {
    const saved = await this.ctx.storage.get<RoomData>('room');
    if (saved && Date.now() - saved.updatedAt < ROOM_TTL_MS) {
      await this.ctx.storage.setAlarm(saved.updatedAt + ROOM_TTL_MS);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, '보존 기간이 지나 방을 닫았습니다.');
      } catch {
        /* 이미 닫힌 연결 */
      }
    }
    await this.ctx.storage.deleteAll();
    this.data = null;
  }

  /* ---------------------------------------------------------------- 방 만들기 */

  /**
   * 이 코드로 방을 연다. 이미 살아 있는 방이면 null 을 돌려주어 다른 코드로 다시 시도하게 한다.
   */
  async createRoom(opts: {
    joinCode: string;
    capacity: number;
    integrationId: string | null;
    activityId: string | null;
  }): Promise<{ roomId: string; teacherToken: string } | null> {
    const saved = await this.ctx.storage.get<RoomData>('room');
    if (saved && saved.phase !== 'closed' && Date.now() - saved.updatedAt < ROOM_TTL_MS) {
      // 연동 방은 같은 활동이면 다시 이어 쓴다(교사가 새로고침해도 새 방이 생기지 않게)
      if (opts.integrationId && saved.integrationId === opts.integrationId && saved.activityId === opts.activityId) {
        return null;
      }
      return null;
    }
    const roomId = randomToken(12);
    const teacherToken = randomToken(32);
    this.data = emptyRoom(roomId, opts.joinCode);
    this.data.capacity = clampCapacity(opts.capacity);
    this.data.teacherTokenHash = await sha256Hex(teacherToken);
    this.data.integrationId = opts.integrationId;
    this.data.activityId = opts.activityId;
    await this.save();
    return { roomId, teacherToken };
  }

  /** 화면 없이 보는 요약(입장 화면이 코드를 확인할 때) */
  async publicInfo(): Promise<{
    exists: boolean;
    phase?: RoomPhase;
    locked?: boolean;
    participants?: number;
    capacity?: number;
  }> {
    const saved = await this.ctx.storage.get<RoomData>('room');
    if (!saved || saved.phase === 'closed') return { exists: false };
    return {
      exists: true,
      phase: saved.phase,
      locked: saved.locked,
      participants: Object.values(saved.participants).filter((p) => !p.banned).length,
      capacity: saved.capacity,
    };
  }

  /** 인증된 결과 조회 — 부모 앱이 다시 확인할 때 */
  async getResult(roundId: string, teacherToken?: string, integrationId?: string): Promise<RoundResult | null> {
    const d = await this.load().catch(() => null);
    if (!d) return null;
    const allowed =
      (integrationId && d.integrationId === integrationId) || (await verifyToken(teacherToken, d.teacherTokenHash));
    if (!allowed) return null;
    return (await this.ctx.storage.get<RoundResult>(`result:${roundId}`)) ?? null;
  }

  /* ---------------------------------------------------------------- 연결 */

  override async fetch(_request: Request): Promise<Response> {
    const d = await this.load().catch(() => null);
    if (!d) return new Response('방을 찾을 수 없습니다.', { status: 404 });
    if (d.phase === 'closed') return new Response('닫힌 방입니다.', { status: 410 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // hibernation API — 잠들었다 깨어나도 연결이 살아 있다
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attachmentOf(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment) ?? null;
    } catch {
      return null;
    }
  }

  private allow(ws: WebSocket, host: boolean): boolean {
    const limit = host ? HOST_RATE_LIMIT_PER_SEC : RATE_LIMIT_PER_SEC;
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) {
      b = { tokens: limit, at: now };
      this.buckets.set(ws, b);
    }
    const elapsed = (now - b.at) / 1000;
    b.at = now;
    b.tokens = Math.min(limit, b.tokens + elapsed * limit);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = decode(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    if (!msg) return;
    const att = this.attachmentOf(ws);

    if (!this.allow(ws, att?.host === true)) {
      if (msg.i) ws.send(nack(msg.i, ErrorCodes.RATE_LIMITED, '너무 자주 보냈습니다. 잠시 뒤 다시 시도하세요.'));
      return;
    }

    const d = await this.load().catch(() => null);
    if (!d) {
      ws.close(1011, '방을 찾을 수 없습니다.');
      return;
    }

    // hello 전에는 아무것도 받지 않는다
    if (!att && msg.t !== 'hello') {
      if (msg.i) ws.send(nack(msg.i, ErrorCodes.NOT_AUTHORIZED, '먼저 인사(hello)를 보내야 합니다.'));
      return;
    }

    try {
      await this.handle(ws, att, msg, d);
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류';
      if (msg.i) ws.send(nack(msg.i, ErrorCodes.BAD_MESSAGE, message));
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const att = this.attachmentOf(ws);
    const d = await this.load().catch(() => null);
    if (!d || !att) return;

    if (att.host && d.hostRuntimeId === att.runtimeId) {
      // 교사의 물리 런타임이 사라졌다 — 새 결과를 확정하지 않는다
      if (d.phase === 'running' || d.phase === 'countdown') {
        d.phase = 'paused';
        d.interruption = '교사 화면과의 연결이 끊겼습니다. 결과를 확정하지 않고 기다립니다.';
        this.broadcast(
          push('interrupted', { roundId: d.currentRoundId, reason: d.interruption, canResume: true }),
        );
      }
      await this.save();
    }
    this.scheduleBroadcast();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ---------------------------------------------------------------- 메시지 */

  private async handle(
    ws: WebSocket,
    att: Attachment | null,
    msg: { t: string; i?: string; d?: unknown },
    d: RoomData,
  ): Promise<void> {
    const reply = (payload: unknown) => {
      if (msg.i) ws.send(ack(msg.i, payload));
    };
    const deny = (code: ErrorCode, text: string) => {
      if (msg.i) ws.send(nack(msg.i, code, text));
    };

    switch (msg.t) {
      case 'hello':
        await this.onHello(ws, msg, d);
        return;

      case 'ping':
        reply({ at: Date.now() });
        return;

      /* ---- 호스트(교사 물리 런타임) ---- */

      case 'host:claim': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 호스트가 될 수 있습니다.');
        const runtimeId = String((msg.d as { runtimeId?: string })?.runtimeId ?? '').slice(0, 64);
        if (!runtimeId) return deny(ErrorCodes.BAD_MESSAGE, '런타임 id 가 없습니다.');

        const sameRuntime = d.hostRuntimeId === runtimeId;
        if (!sameRuntime && (d.phase === 'running' || d.phase === 'countdown')) {
          // 물리 상태를 들고 있던 런타임이 사라졌다 — 결과를 짐작해 복원하지 않는다
          await this.cancelRound(d, '교사 화면이 새로 열려 진행 중이던 경기의 물리 상태가 사라졌습니다. 다시 시작해 주세요.');
        }
        if (!sameRuntime) d.hostEpoch += 1;
        d.hostRuntimeId = runtimeId;
        if (d.phase === 'paused') {
          d.phase = 'lobby';
          d.interruption = null;
        }
        // 이 연결이 호스트임을 표시한다 — 프레임은 이 표시로만 받아들인다
        ws.serializeAttachment({ ...att, host: true, runtimeId } satisfies Attachment);
        await this.save();
        this.scheduleBroadcast();
        const out: HostClaimAck = { epoch: d.hostEpoch, granted: true, currentRuntimeId: runtimeId };
        reply(out);
        return;
      }

      case 'host:frame': {
        if (att?.host !== true) return;
        const frame = msg.d as RaceFrame;
        if (!this.frameIsCurrent(d, frame)) return;
        if (d.phase === 'countdown') {
          d.phase = 'running';
          void this.save();
        }
        if (typeof frame.seq === 'number') d.lastSeq = frame.seq;
        if (Array.isArray(frame.assist)) d.assistCount += frame.assist.length;
        this.relayFrame(frame);
        return;
      }

      case 'host:finish': {
        if (att?.host !== true) return deny(ErrorCodes.NOT_AUTHORIZED, '호스트만 보낼 수 있습니다.');
        const p = msg.d as { roundId: string; epoch: number; entries: unknown };
        if (p.roundId !== d.currentRoundId) return deny(ErrorCodes.STALE_ROUND, '지난 라운드의 기록입니다.');
        if (p.epoch !== d.hostEpoch) return deny(ErrorCodes.STALE_EPOCH, '지난 호스트의 기록입니다.');
        const added = this.recordFinishes(d, p.entries);
        await this.save();
        reply({ recorded: d.finishEntries.length, added });
        return;
      }

      case 'host:complete': {
        if (att?.host !== true) return deny(ErrorCodes.NOT_AUTHORIZED, '호스트만 보낼 수 있습니다.');
        const p = msg.d as { roundId: string; epoch: number; reason: 'completed' | 'timeout'; assistCount?: number };
        if (p.roundId !== d.currentRoundId) return deny(ErrorCodes.STALE_ROUND, '지난 라운드입니다.');
        if (p.epoch !== d.hostEpoch) return deny(ErrorCodes.STALE_EPOCH, '지난 호스트입니다.');
        if (d.phase === 'finished') {
          // 같은 라운드의 완료가 두 번 왔다 — 멱등하게 같은 결과를 돌려준다
          reply({ alreadyFinalized: true, roundId: p.roundId });
          return;
        }
        if (typeof p.assistCount === 'number') d.assistCount = Math.max(d.assistCount, p.assistCount);
        const result = await this.finalize(d, p.reason === 'timeout' ? 'timeout' : 'completed');
        reply({ roundId: result.roundId, revision: result.revision, eventId: result.eventId });
        return;
      }

      case 'host:stalled': {
        if (att?.host !== true) return;
        const p = msg.d as { roundId: string; epoch: number; reason: string };
        if (p.roundId !== d.currentRoundId || p.epoch !== d.hostEpoch) return;
        d.phase = 'paused';
        d.interruption = String(p.reason ?? '시뮬레이션이 멈췄습니다.').slice(0, 200);
        await this.save();
        this.broadcast(push('interrupted', { roundId: d.currentRoundId, reason: d.interruption, canResume: false }));
        this.scheduleBroadcast();
        return;
      }

      /* ---- 교사 ---- */

      case 'teacher:config': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 설정을 바꿀 수 있습니다.');
        const parsed = parseRoundConfig((msg.d as { config?: unknown })?.config, MAP_IDS);
        if (!parsed.ok) return deny(parsed.code, parsed.message);
        // 진행 중에 바꾼 설정은 «다음 라운드» 에 쓰인다. 이번 라운드의 스냅샷은 건드리지 않는다.
        d.config = parsed.value;
        await this.save();
        this.scheduleBroadcast();
        reply({ config: d.config, appliesToNextRound: d.phase !== 'lobby' && d.phase !== 'finished' });
        return;
      }

      case 'teacher:roster': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 명단을 바꿀 수 있습니다.');
        const parsed = parseRosterCommands((msg.d as { commands?: unknown })?.commands);
        if (!parsed.ok) return deny(parsed.code, parsed.message);
        const applied = this.applyRoster(d, parsed.value);
        await this.save();
        this.scheduleBroadcast();
        reply({ applied, participants: this.publicParticipants(d) });
        return;
      }

      case 'teacher:start': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 시작할 수 있습니다.');
        if (d.phase === 'countdown' || d.phase === 'running') {
          // 중복 시작 요청 — 지금 라운드를 그대로 알려 준다
          reply({ roundId: d.currentRoundId, alreadyRunning: true });
          return;
        }
        const countdownSec = clampInt((msg.d as { countdownSec?: unknown })?.countdownSec, 0, 10, 3);
        const built = this.buildSnapshot(d);
        if (!built.ok) return deny(built.code, built.message);

        // 교사 지정 모드는 물리 경기를 돌리지 않는다.
        // 도착 순위를 만들어 내지 않고, 수동 지정임을 결과에 그대로 남긴 채 바로 확정한다.
        if (built.value.selectionMode === 'manual') {
          d.activeRound = built.value;
          d.currentRoundId = built.value.roundId;
          d.finishEntries = [];
          d.assistCount = 0;
          const manual = await this.finalize(d, 'completed');
          reply({ roundId: manual.roundId, manual: true, revision: manual.revision });
          return;
        }

        if (!d.hostRuntimeId) {
          return deny(ErrorCodes.BAD_STATE, '교사 화면의 경기 엔진이 아직 준비되지 않았습니다.');
        }
        d.activeRound = built.value;
        d.currentRoundId = built.value.roundId;
        d.phase = 'countdown';
        d.interruption = null;
        d.finishEntries = [];
        d.lastSeq = -1;
        d.assistCount = 0;
        await this.save();
        const countdownMs = countdownSec * 1000;
        const startsAt = Date.now() + countdownMs;
        // startsAt 은 참고값이고, 받는 쪽은 countdownMs(길이)를 쓴다 — 시계 차이에 흔들리지 않게.
        this.broadcast(
          push('countdown', { roundId: built.value.roundId, startsAt, countdownMs, snapshot: built.value }),
        );
        this.scheduleBroadcast();
        reply({ roundId: built.value.roundId, startsAt, countdownMs, snapshot: built.value });
        return;
      }

      case 'teacher:cancel': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 취소할 수 있습니다.');
        const p = msg.d as { roundId?: string; reason?: string };
        if (p.roundId && p.roundId !== d.currentRoundId) {
          return deny(ErrorCodes.STALE_ROUND, '지난 라운드는 취소할 수 없습니다.');
        }
        await this.cancelRound(d, String(p.reason ?? '교사가 취소했습니다.').slice(0, 200));
        reply({ cancelled: true });
        return;
      }

      case 'teacher:reviseResult': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 고칠 수 있습니다.');
        const p = msg.d as { roundId?: string; winners?: unknown; note?: unknown };
        const roundId = String(p.roundId ?? '');
        const prev = await this.ctx.storage.get<RoundResult>(`result:${roundId}`);
        if (!prev) return deny(ErrorCodes.NOT_FOUND, '그 라운드의 결과가 없습니다.');
        const note = String(p.note ?? '').slice(0, 300);
        if (!note) return deny(ErrorCodes.BAD_MESSAGE, '고치는 사유를 적어 주세요.');
        const winners = sanitizeWinners(p.winners, prev);
        if (!winners) return deny(ErrorCodes.BAD_MESSAGE, '고친 당첨자 목록이 올바르지 않습니다.');
        const revised: RoundResult = {
          ...prev,
          eventId: randomToken(12),
          revision: prev.revision + 1,
          previousRevision: prev.revision,
          revisionNote: note,
          winners,
          finalizedAt: Date.now(),
        };
        await this.ctx.storage.put(`result:${roundId}`, revised);
        await this.ctx.storage.put(`result:${roundId}:v${prev.revision}`, prev);
        if (d.lastResult?.roundId === roundId) d.lastResult = revised;
        await this.save();
        this.broadcast(push('result', revised));
        void this.maybeWebhook(d, revised);
        reply({ revision: revised.revision });
        return;
      }

      case 'teacher:close': {
        if (att?.role !== 'teacher') return deny(ErrorCodes.NOT_AUTHORIZED, '교사만 닫을 수 있습니다.');
        const wipe = (msg.d as { deleteData?: boolean })?.deleteData === true;
        d.phase = 'closed';
        await this.save();
        this.broadcast(push('closed', { reason: wipe ? '교사가 방을 닫고 기록을 지웠습니다.' : '교사가 방을 닫았습니다.' }));
        for (const sock of this.ctx.getWebSockets()) {
          try {
            sock.close(1000, '방이 닫혔습니다.');
          } catch {
            /* 이미 닫힘 */
          }
        }
        if (wipe) {
          await this.ctx.storage.deleteAll();
          this.data = null;
        }
        reply({ closed: true, deleted: wipe });
        return;
      }

      default:
        return deny(ErrorCodes.BAD_MESSAGE, `모르는 메시지입니다: ${msg.t}`);
    }
  }

  /* ---------------------------------------------------------------- 인사 */

  private async onHello(ws: WebSocket, msg: { i?: string; d?: unknown }, d: RoomData): Promise<void> {
    const p = (msg.d ?? {}) as Record<string, unknown>;
    const deny = (code: ErrorCode, text: string) => {
      if (msg.i) ws.send(nack(msg.i, code, text));
    };

    if (p.protocolVersion !== PROTOCOL_VERSION) {
      return deny(ErrorCodes.BAD_PROTOCOL, '화면을 새로고침해 주세요. 서버와 판이 다릅니다.');
    }

    const wanted = p.role === 'teacher' ? 'teacher' : p.role === 'spectator' ? 'spectator' : 'student';
    let role: Attachment['role'] = 'spectator';
    let participantId: string | undefined;
    let rejoinToken: string | null = null;
    let externalId: string | undefined;
    let ticketName: string | undefined;

    /* ---- 연동 티켓이 있으면 그것이 신원이다 ---- */
    if (typeof p.ticket === 'string' && p.ticket) {
      const check = await verifyTicket(p.ticket, (id) => this.integrations[id]?.secret ?? null);
      if (!check.ok) return deny(ErrorCodes.TICKET_INVALID, check.reason);
      const c = check.claims;
      if (d.integrationId && c.integrationId !== d.integrationId) {
        return deny(ErrorCodes.TICKET_INVALID, '이 방과 다른 수업 앱의 티켓입니다.');
      }
      if (d.activityId && c.activityId !== d.activityId) {
        return deny(ErrorCodes.TICKET_INVALID, '지난 활동의 티켓입니다.');
      }
      // 역할은 **서명된 티켓** 에서만 온다. 브라우저가 보낸 role 문자열은 안 믿는다.
      role = c.role;
      externalId = c.sub;
      ticketName = c.name;
    } else if (wanted === 'teacher') {
      /* ---- 교사는 토큰으로만 ---- */
      const okToken = await verifyToken(typeof p.teacherToken === 'string' ? p.teacherToken : undefined, d.teacherTokenHash);
      if (!okToken) return deny(ErrorCodes.NOT_AUTHORIZED, '교사 권한이 확인되지 않았습니다.');
      role = 'teacher';
    } else {
      role = wanted === 'spectator' ? 'spectator' : 'student';
    }

    /* ---- 학생이면 참가자를 찾거나 만든다 ---- */
    if (role === 'student') {
      const found = await this.resolveParticipant(d, {
        rejoinToken: typeof p.rejoinToken === 'string' ? p.rejoinToken : undefined,
        nickname: typeof p.nickname === 'string' ? p.nickname : ticketName,
        externalId,
      });
      if (!found.ok) return deny(found.code, found.message);
      participantId = found.participantId;
      rejoinToken = found.rejoinToken;
      await this.save();
    }

    const attachment: Attachment = { role };
    if (participantId) attachment.participantId = participantId;
    ws.serializeAttachment(attachment);

    const me = participantId ? toPublic(d.participants[participantId]!) : null;
    const out: HelloAck = {
      protocolVersion: PROTOCOL_VERSION,
      role,
      roomId: d.roomId,
      joinCode: d.joinCode,
      me,
      rejoinToken,
      snapshot: this.snapshot(d),
    };
    if (msg.i) ws.send(ack(msg.i, out));
    this.scheduleBroadcast();
  }

  /**
   * 들어온 학생을 기존 참가자와 잇는다.
   *
   * 로그인이 없으므로 «같은 사람인지» 를 완벽히 가릴 수 없다. 대신 세 가지 길만 둔다.
   *  1. 재접속 자격(rejoinToken) — 같은 기기의 새로고침·재연결
   *  2. 연동 티켓의 외부 id — 부모 수업 앱이 보증한 신원
   *  3. 새 참가자
   * **닉네임이 같다는 이유만으로 기존 참가자를 차지하지 못한다.**
   */
  private async resolveParticipant(
    d: RoomData,
    input: { rejoinToken?: string; nickname?: string; externalId?: string },
  ): Promise<
    { ok: true; participantId: string; rejoinToken: string | null } | { ok: false; code: ErrorCode; message: string }
  > {
    // 1) 재접속 자격
    if (input.rejoinToken) {
      for (const p of Object.values(d.participants)) {
        if (await verifyToken(input.rejoinToken, p.rejoinHash)) {
          if (p.banned) return { ok: false, code: ErrorCodes.NOT_AUTHORIZED, message: '입장이 막혔습니다.' };
          p.online = true;
          return { ok: true, participantId: p.id, rejoinToken: null };
        }
      }
    }

    // 2) 연동 티켓의 외부 id
    if (input.externalId) {
      const existing = d.externalMap[input.externalId];
      if (existing && d.participants[existing]) {
        const p = d.participants[existing]!;
        if (p.banned) return { ok: false, code: ErrorCodes.NOT_AUTHORIZED, message: '입장이 막혔습니다.' };
        p.online = true;
        const token = randomToken(24);
        p.rejoinHash = await sha256Hex(token);
        return { ok: true, participantId: p.id, rejoinToken: token };
      }
    }

    // 3) 새 참가자
    if (d.locked) return { ok: false, code: ErrorCodes.ROOM_LOCKED, message: '입장이 잠겨 있습니다.' };
    const active = Object.values(d.participants).filter((p) => !p.banned);
    if (active.length >= d.capacity) {
      return { ok: false, code: ErrorCodes.ROOM_FULL, message: `정원(${d.capacity}명)이 찼습니다.` };
    }
    const nickname = cleanNickname(input.nickname);
    if (!nickname) return { ok: false, code: ErrorCodes.NICKNAME_INVALID, message: '닉네임을 적어 주세요.' };

    const p = this.addParticipant(d, nickname, input.externalId ? 'host-app' : 'self', input.externalId);
    p.online = true;
    const token = randomToken(24);
    p.rejoinHash = await sha256Hex(token);
    return { ok: true, participantId: p.id, rejoinToken: token };
  }

  private addParticipant(
    d: RoomData,
    nickname: string,
    source: Participant['source'],
    externalId?: string,
  ): StoredParticipant {
    const id = randomToken(10);
    const p: StoredParticipant = {
      id,
      nickname,
      dupIndex: 0,
      hue: 0,
      source,
      online: false,
      excluded: false,
      joinedAt: Date.now(),
      rejoinHash: null,
      banned: false,
    };
    if (externalId) {
      p.externalId = externalId;
      d.externalMap[externalId] = id;
    }
    d.participants[id] = p;
    this.reindex(d);
    return p;
  }

  /**
   * 같은 닉네임에 구분 번호를 붙이고, 색을 고르게 나눈다.
   * 참가자가 바뀔 때마다 부른다.
   */
  private reindex(d: RoomData): void {
    const list = Object.values(d.participants)
      .filter((p) => !p.banned)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

    const counts = new Map<string, number>();
    for (const p of list) counts.set(p.nickname, (counts.get(p.nickname) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const p of list) {
      if ((counts.get(p.nickname) ?? 0) > 1) {
        const n = (seen.get(p.nickname) ?? 0) + 1;
        seen.set(p.nickname, n);
        p.dupIndex = n;
      } else {
        p.dupIndex = 0;
      }
    }
    // 색은 전체에 고르게 퍼뜨린다 — 옆 사람과 비슷한 색이 되지 않게
    const n = Math.max(1, list.length);
    for (let i = 0; i < list.length; i++) {
      list[i]!.hue = Math.round(((i * 360) / n + (i % 2) * 180) % 360);
    }
    d.participantSnapshotVersion += 1;
  }

  private applyRoster(d: RoomData, commands: RosterCommand[]): number {
    let applied = 0;
    for (const c of commands) {
      switch (c.op) {
        case 'add':
          if (Object.values(d.participants).filter((p) => !p.banned).length >= d.capacity) break;
          this.addParticipant(d, c.nickname, 'teacher');
          applied++;
          break;
        case 'addMany':
          for (const nick of c.nicknames) {
            if (Object.values(d.participants).filter((p) => !p.banned).length >= d.capacity) break;
            this.addParticipant(d, nick, 'teacher');
            applied++;
          }
          break;
        case 'rename': {
          const p = d.participants[c.participantId];
          if (!p) break;
          p.nickname = c.nickname;
          this.reindex(d);
          applied++;
          break;
        }
        case 'exclude': {
          const p = d.participants[c.participantId];
          if (!p) break;
          p.excluded = c.excluded;
          applied++;
          break;
        }
        case 'remove': {
          if (!d.participants[c.participantId]) break;
          const ext = d.participants[c.participantId]!.externalId;
          if (ext) delete d.externalMap[ext];
          delete d.participants[c.participantId];
          this.reindex(d);
          applied++;
          break;
        }
        case 'kick': {
          const p = d.participants[c.participantId];
          if (!p) break;
          p.online = false;
          if (c.banRejoin) {
            p.banned = true;
            p.rejoinHash = null;
          } else {
            // 내보내되 다시 들어올 수 있게 — 자격만 무효로 만든다
            p.rejoinHash = null;
          }
          this.disconnectParticipant(c.participantId, c.banRejoin ? '입장이 막혔습니다.' : '교사가 내보냈습니다.');
          this.reindex(d);
          applied++;
          break;
        }
        case 'lock':
          d.locked = c.locked;
          applied++;
          break;
        case 'clearExclusions':
          for (const p of Object.values(d.participants)) p.excluded = false;
          d.previousWinnerIds = [];
          applied++;
          break;
      }
    }
    return applied;
  }

  private disconnectParticipant(participantId: string, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (att?.participantId !== participantId) continue;
      try {
        ws.send(push('error', { code: ErrorCodes.NOT_AUTHORIZED, message: reason }));
        ws.close(1000, reason);
      } catch {
        /* 이미 닫힘 */
      }
    }
  }

  /* ---------------------------------------------------------------- 라운드 */

  /** 카운트다운 직전에 모든 것을 얼린다 */
  private buildSnapshot(
    d: RoomData,
  ): { ok: true; value: RuleSnapshot } | { ok: false; code: ErrorCode; message: string } {
    const map = requireMap(d.config.mapId);

    const excluded = new Set(d.config.excludedParticipantIds);
    if (d.config.excludePreviousWinners) for (const id of d.previousWinnerIds) excluded.add(id);

    const racers = Object.values(d.participants)
      .filter((p) => !p.banned && !p.excluded && !excluded.has(p.id))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

    const rule = parseWinnerRule(d.config.rule);
    if (!rule.ok) return { ok: false, code: rule.code, message: rule.message };

    const check = validateRuleAgainstRacers(
      rule.value,
      racers.map((r) => r.id),
    );
    if (!check.ok) return { ok: false, code: check.code, message: check.message };

    const seed = randomToken(16);
    // 타이브레이커 순서는 시작 전에 정해 스냅샷에 남긴다 — 나중에 바꿀 수 없다
    const tiebreak = shuffleWithSeed(
      racers.map((r) => r.id),
      `${seed}:tiebreak`,
    );

    return {
      ok: true,
      value: {
        roundId: randomToken(12),
        roundNumber: d.roundNumber + 1,
        mapId: map.id,
        mapVersion: map.version,
        rule: rule.value,
        awards: d.config.awards,
        allowDuplicateAwards: d.config.allowDuplicateAwards,
        useSkills: d.config.useSkills,
        selectionMode: rule.value.kind === 'manual' ? 'manual' : 'physics',
        seed,
        tiebreakOrder: tiebreak,
        timeLimitSec: map.timeLimitSec,
        createdAt: Date.now(),
        participantSnapshotVersion: d.participantSnapshotVersion,
        racers: racers.map((r) => ({
          participantId: r.id,
          nickname: r.nickname,
          dupIndex: r.dupIndex,
          hue: r.hue,
        })),
      },
    };
  }

  private frameIsCurrent(d: RoomData, f: RaceFrame | undefined): boolean {
    if (!f || typeof f !== 'object') return false;
    if (f.roundId !== d.currentRoundId) return false;
    if (f.epoch !== d.hostEpoch) return false;
    if (typeof f.seq !== 'number' || f.seq <= d.lastSeq) return false;
    return d.phase === 'countdown' || d.phase === 'running';
  }

  /** 도착 기록을 받아 둔다. 중복·범위 밖은 조용히 버린다. */
  private recordFinishes(d: RoomData, raw: unknown): number {
    if (!Array.isArray(raw)) return 0;
    const snap = d.activeRound;
    if (!snap) return 0;
    const seenRacer = new Set(d.finishEntries.map((e) => e.racerIndex));
    const seenRank = new Set(d.finishEntries.map((e) => e.rank));
    let added = 0;
    for (const item of raw.slice(0, MAX_CAPACITY)) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const racerIndex = Number(e.racerIndex);
      const rank = Number(e.rank);
      const timeMs = Number(e.timeMs);
      if (!Number.isInteger(racerIndex) || racerIndex < 0 || racerIndex >= snap.racers.length) continue;
      if (!Number.isInteger(rank) || rank < 1 || rank > snap.racers.length) continue;
      if (!Number.isFinite(timeMs) || timeMs < 0) continue;
      // 한 구슬은 한 번, 한 순위도 한 번
      if (seenRacer.has(racerIndex) || seenRank.has(rank)) continue;
      seenRacer.add(racerIndex);
      seenRank.add(rank);
      d.finishEntries.push({ racerIndex, rank, timeMs, tiebroken: e.tiebroken === true });
      added++;
    }
    d.finishEntries.sort((a, b) => a.rank - b.rank);
    return added;
  }

  /** 서버가 결과를 확정한다. 당첨자는 여기서만 정해진다. */
  private async finalize(d: RoomData, reason: 'completed' | 'timeout'): Promise<RoundResult> {
    const snap = d.activeRound!;
    const byIndex = snap.racers;

    const finishOrder: FinishEntry[] = d.finishEntries
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((e) => {
        const r = byIndex[e.racerIndex]!;
        return {
          rank: e.rank,
          participantId: r.participantId,
          nickname: r.nickname,
          dupIndex: r.dupIndex,
          timeMs: Math.round(e.timeMs),
          tiebroken: e.tiebroken,
        };
      });

    // 제한시간으로 끊겼으면 당첨자를 만들어 내지 않는다
    let winners: WinnerEntry[] = [];
    if (reason === 'completed') {
      winners = selectWinners({
        rule: snap.rule,
        awards: snap.awards,
        allowDuplicateAwards: snap.allowDuplicateAwards,
        finishOrder,
        racers: snap.racers,
      });
    }

    const result: RoundResult = {
      eventId: randomToken(12),
      roundId: snap.roundId,
      revision: 1,
      mapId: snap.mapId,
      mapVersion: snap.mapVersion,
      ruleSnapshot: snap,
      participantSnapshotVersion: snap.participantSnapshotVersion,
      finishOrder,
      winners,
      outcome: reason,
      cancelled: false,
      selectionMode: snap.selectionMode,
      finalizedAt: Date.now(),
      assistCount: d.assistCount,
    };

    await this.ctx.storage.put(`result:${snap.roundId}`, result);
    d.lastResult = result;
    d.roundNumber = snap.roundNumber;
    d.phase = 'finished';
    d.activeRound = null;
    d.previousWinnerIds = winners.map((w) => w.participantId);
    await this.save();

    this.broadcast(push('result', result));
    this.scheduleBroadcast();
    void this.maybeWebhook(d, result);
    return result;
  }

  private async cancelRound(d: RoomData, reason: string): Promise<void> {
    const roundId = d.currentRoundId;
    d.phase = 'cancelled';
    d.interruption = reason;
    d.activeRound = null;
    d.currentRoundId = null;
    d.finishEntries = [];
    await this.save();
    this.broadcast(push('interrupted', { roundId, reason, canResume: false }));
    // 곧바로 대기실로 되돌려 다음 라운드를 준비할 수 있게 한다
    d.phase = 'lobby';
    await this.save();
    this.scheduleBroadcast();
  }

  private async maybeWebhook(d: RoomData, result: RoundResult): Promise<void> {
    if (!d.integrationId) return;
    const cfg = this.integrations[d.integrationId];
    if (!cfg?.resultUrl) return;
    await sendResultWebhook(cfg, {
      roomCode: d.joinCode,
      roomId: d.roomId,
      integrationId: d.integrationId,
      activityId: d.activityId,
      result,
    });
  }

  /* ---------------------------------------------------------------- 내보내기 */

  private publicParticipants(d: RoomData): Participant[] {
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (att?.participantId) online.add(att.participantId);
    }
    return Object.values(d.participants)
      .filter((p) => !p.banned)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ ...toPublic(p), online: online.has(p.id) }));
  }

  private snapshot(d: RoomData): RoomSnapshot {
    return {
      room: {
        roomId: d.roomId,
        joinCode: d.joinCode,
        phase: d.phase,
        locked: d.locked,
        capacity: d.capacity,
        roundNumber: d.roundNumber,
        currentRoundId: d.currentRoundId,
        config: d.config,
        participantSnapshotVersion: d.participantSnapshotVersion,
        hostOnline: d.hostRuntimeId !== null && this.hostConnected(),
        interruption: d.interruption,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        integrationId: d.integrationId,
      },
      participants: this.publicParticipants(d),
      activeRound: d.activeRound,
      lastResult: d.lastResult,
      previousWinnerIds: d.previousWinnerIds,
      serverTime: Date.now(),
    };
  }

  private hostConnected(): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachmentOf(ws)?.host === true) return true;
    }
    return false;
  }

  /** 프레임은 학생·관전자에게만 보낸다(교사는 제 화면에서 직접 그린다) */
  private relayFrame(frame: RaceFrame): void {
    const now = Date.now();
    // 느린 쪽을 위해 내보내는 빈도를 여기서 한 번 더 묶는다.
    // 중간 프레임은 버린다 — 큐에 쌓아 두면 뒤로 갈수록 화면이 늦어진다.
    if (now - this.lastFrameOut < FRAME_MIN_INTERVAL_MS) return;
    this.lastFrameOut = now;
    const text = push('frame', frame);
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (!att || att.host) continue;
      try {
        ws.send(text);
      } catch {
        /* 끊긴 연결 */
      }
    }
  }

  private broadcast(text: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* 끊긴 연결 */
      }
    }
  }

  /** 상태 알림을 묶어 보낸다 — 30명이 한꺼번에 들어와도 방송이 폭주하지 않게 */
  private scheduleBroadcast(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.data) return;
      this.broadcast(push('snapshot', this.snapshot(this.data)));
    }, BROADCAST_MS);
  }

}

/* ------------------------------------------------------------------ 도우미 */

function emptyRoom(roomId: string, joinCode: string): RoomData {
  const now = Date.now();
  return {
    roomId,
    joinCode,
    createdAt: now,
    updatedAt: now,
    phase: 'lobby',
    locked: false,
    capacity: DEFAULT_CAPACITY,
    roundNumber: 0,
    currentRoundId: null,
    config: defaultRoundConfig(MAP_IDS[0]!),
    participants: {},
    participantSnapshotVersion: 0,
    teacherTokenHash: null,
    previousWinnerIds: [],
    activeRound: null,
    lastResult: null,
    hostEpoch: 0,
    hostRuntimeId: null,
    interruption: null,
    integrationId: null,
    activityId: null,
    externalMap: {},
    finishEntries: [],
    lastSeq: -1,
    assistCount: 0,
  };
}

function toPublic(p: StoredParticipant): Participant {
  const { rejoinHash: _r, banned: _b, ...rest } = p;
  return rest;
}

function clampCapacity(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_CAPACITY;
  return Math.max(1, Math.min(MAX_CAPACITY, v));
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** 시드로 섞는다 — 서버가 라운드마다 새 시드를 만든다 */
function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** 고친 당첨자 목록이 이 라운드의 참가자 안에 있는지 본다 */
function sanitizeWinners(raw: unknown, prev: RoundResult): WinnerEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const byId = new Map(prev.ruleSnapshot.racers.map((r) => [r.participantId, r]));
  const out: WinnerEntry[] = [];
  for (const item of raw.slice(0, MAX_CAPACITY)) {
    if (!item || typeof item !== 'object') return null;
    const w = item as Record<string, unknown>;
    const pid = typeof w.participantId === 'string' ? w.participantId : '';
    const r = byId.get(pid);
    if (!r) return null;
    out.push({
      slot: typeof w.slot === 'number' ? w.slot : out.length,
      rank: typeof w.rank === 'number' ? w.rank : null,
      participantId: pid,
      nickname: r.nickname,
      dupIndex: r.dupIndex,
      award: (w.award as WinnerEntry['award']) ?? null,
      selectionReason: '교사가 발표 뒤 고침',
    });
  }
  return out;
}
