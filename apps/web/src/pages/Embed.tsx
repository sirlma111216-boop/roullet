/**
 * /embed — 다른 수업 앱의 iframe 안에서 도는 화면.
 *
 * 지키는 것:
 *  - 부모가 보낸 메시지는 **origin·source·세션·형식**을 모두 본 뒤에만 받아들인다.
 *  - 답할 때는 정확한 targetOrigin 으로만 보낸다. '*' 를 쓰지 않는다.
 *  - live 모드에서 신원은 오직 **서명된 티켓**이다. 부모가 보낸 role 글자나 닉네임만으로
 *    교사가 되지 않는다.
 *  - local 모드에는 방도 티켓도 없다. 이 iframe 안에서 혼자 돌고, 결과는
 *    «서버가 확인해 준 것이 아님»(serverVerified: false)을 달아 돌려준다.
 *  - 경기 중에 온 명단·설정 변경은 다음 라운드로 미룬다.
 *  - 결과는 «화면용» 으로만 돌려주고, 부모가 서버에서 다시 확인할 주소를 함께 준다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultRoundConfig,
  displayName,
  EMBED_CAPABILITIES,
  EMBED_PROTOCOL_VERSION,
  isEmbedEnvelope,
  LOCAL_MAX_PARTICIPANTS,
  parseRoundConfig,
  parseMountPayload,
  type EmbedEnvelope,
  type EmbedMode,
  type Participant,
  type RoundConfig,
  type SetConfigPayload,
  type SetParticipantsPayload,
} from '@marble/protocol';
import { getMap, MAP_IDS, requireMap } from '@marble/game-core';
import { describeRule, requiredFinishCount } from '@marble/game-core/rules';
import { RaceView } from '../components/RaceView.tsx';
import { ResultPanel } from '../components/ResultPanel.tsx';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { HostRuntime } from '../race/hostRuntime.ts';
import { buildLocalParticipants, useLocalRace } from '../race/useLocalRace.ts';
import { FrameInterpolator } from '../race/interpolator.ts';
import { useRoom } from '../hooks/useRoom.ts';
import { useRoundSound } from '../hooks/useRoundSound.ts';
import { getViewPrefs, setViewPrefs, type ViewPrefs } from '../util/storage.ts';

/** 배포 판 — 부모가 「옛 배포」를 알아볼 수 있게 함께 보낸다 */
const BUILD = `embed-${EMBED_PROTOCOL_VERSION}.2`;

/** 티켓에서 방 코드만 꺼낸다(서명 검증은 서버가 한다). */
function readTicket(ticket: string): { roomCode: string; role: 'teacher' | 'student'; name: string } | null {
  try {
    const body = ticket.slice(0, ticket.indexOf('.'));
    const pad = body.length % 4 === 0 ? '' : '='.repeat(4 - (body.length % 4));
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const claims = JSON.parse(decodeURIComponent(escape(json))) as {
      roomCode?: string;
      role?: string;
      name?: string;
    };
    if (!claims.roomCode) return null;
    return {
      roomCode: claims.roomCode,
      role: claims.role === 'teacher' ? 'teacher' : 'student',
      name: claims.name ?? '',
    };
  } catch {
    return null;
  }
}

interface MountState {
  mode: EmbedMode;
  /** local 모드에서는 빈 문자열 */
  ticket: string;
  /** local 모드에서는 빈 문자열 */
  roomCode: string;
  view: 'teacher' | 'student';
  integrationId: string;
  hideJoinUi: boolean;
}

export function Embed(): React.ReactElement {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const parentOrigin = params.get('parentOrigin') ?? '';
  const sessionId = params.get('session') ?? '';

  const [mount, setMount] = useState<MountState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ViewPrefs>(() => getViewPrefs());
  const [config, setConfig] = useState<RoundConfig>(() => defaultRoundConfig('classic-wheel'));
  /** 경기 중에 들어온 변경은 여기 쌓였다가 다음 라운드에 적용된다 */
  const queuedRef = useRef<{ config?: RoundConfig; participants?: SetParticipantsPayload['participants'] }>({});
  const [queuedNotice, setQueuedNotice] = useState(false);

  /** local 모드에서 부모가 넣어 준 명단(원본 그대로 — id 를 지켜야 한다) */
  const [localRoster, setLocalRoster] = useState<SetParticipantsPayload['participants']>([]);

  // local 모드에서는 방에 붙지 않는다 — 붙을 방이 없다
  const room = useRoom({
    code: mount?.roomCode ?? '',
    role: mount?.view ?? 'student',
    ticket: mount?.ticket,
    enabled: mount?.mode === 'live',
  });

  const hostRef = useRef<HostRuntime | null>(null);
  /**
   * 부모 메시지를 처리하는 함수는 방 연결·설정에 따라 매번 새로 만들어진다.
   * 그런데 message 리스너는 한 번만 등록한다 — 그래서 **ref 를 거쳐** 부른다.
   * (이걸 안 하면 리스너가 첫 렌더의 handle 을 붙들고 있어, 방에 붙은 뒤에도
   *  「아직 방에 연결되지 않았습니다」만 돌려준다. 실제로 그렇게 막혔다.)
   */
  const handleRef = useRef<((env: EmbedEnvelope) => Promise<void>) | null>(null);
  const studentInterp = useMemo(() => new FrameInterpolator(), []);
  const activeRef = useRef(room.countdown?.snapshot ?? null);

  const updatePrefs = useCallback((p: ViewPrefs) => {
    setPrefs(p);
    setViewPrefs(p);
  }, []);

  /* ---------------------------------------------------------------- 부모에게 보내기 */

  const post = useCallback(
    (type: string, payload: unknown, requestId?: string) => {
      if (!parentOrigin || !window.parent || window.parent === window) return;
      const env: EmbedEnvelope = {
        channel: 'classroom-marble-race',
        protocolVersion: EMBED_PROTOCOL_VERSION,
        sessionId,
        type,
        payload,
      };
      if (requestId) env.requestId = requestId;
      // ★ 정확한 origin 으로만. '*' 는 쓰지 않는다.
      window.parent.postMessage(env, parentOrigin);
    },
    [parentOrigin, sessionId],
  );

  const reply = useCallback(
    (requestId: string, ok: boolean, data?: unknown, error?: { code: string; message: string }) => {
      post('response', { ok, data, error }, requestId);
    },
    [post],
  );

  const emitError = useCallback(
    (code: string, message: string, requestId?: string) => {
      // 토스트로만 띄우고 끝내지 않는다 — 부모가 「방 만드는 중」에서 영영 멈추기 때문이다
      post('error', { code, message, requestId });
    },
    [post],
  );

  /* ---------------------------------------------------------------- 지역 경기(local 모드) */

  /**
   * 「로컬 빠른 뽑기」 화면과 **같은 훅**이다. 규칙·마무리 처리가 갈라지지 않게 한다.
   * live 모드에서는 start 를 부르지 않으므로 아무 일도 하지 않는다.
   */
  const local = useLocalRace({
    onStarted: (snapshot, delayMs) => {
      post('roundStarted', { roundId: snapshot.roundId, snapshot, startsAt: Date.now() + delayMs });
    },
    onFinished: (result) => {
      post('roundFinished', buildLocalFinishedPayload(result));
    },
    onError: (message) => emitError('engine_error', message),
  });

  /** 부모가 준 id 를 그대로 지킨다 — 결과를 부모 앱 학생과 맞춰 볼 수 있어야 한다 */
  const localParticipants = useMemo(
    () =>
      buildLocalParticipants(
        localRoster.map((x) => x.nickname),
        {
          ids: localRoster.map((x) => x.id),
          previousWinnerIds: local.previousWinnerIds,
          excludePreviousWinners: config.excludePreviousWinners,
        },
      ),
    [localRoster, local.previousWinnerIds, config.excludePreviousWinners],
  );

  /* ---------------------------------------------------------------- 부모에게서 받기 */

  useEffect(() => {
    if (!parentOrigin) {
      setFatal('부모 앱의 origin 이 없습니다. SDK 로 띄워 주세요.');
      return;
    }

    const onMessage = (ev: MessageEvent) => {
      // origin · source · 형식 · 세션을 모두 본다
      if (ev.origin !== parentOrigin) return;
      if (ev.source !== window.parent) return;
      if (!isEmbedEnvelope(ev.data)) return;
      const env = ev.data as EmbedEnvelope;
      if (env.protocolVersion !== EMBED_PROTOCOL_VERSION) return;
      if (env.sessionId !== sessionId) return;
      void handleRef.current?.(env);
    };

    window.addEventListener('message', onMessage);
    // 준비됐음을 알린다. 부모는 이것을 받은 뒤에야 mount 를 보낸다.
    post('available', {
      protocolVersion: EMBED_PROTOCOL_VERSION,
      capabilities: EMBED_CAPABILITIES,
      build: BUILD,
    });
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentOrigin, sessionId]);

  const handle = useCallback(
    async (env: EmbedEnvelope) => {
      const rid = env.requestId;
      const fail = (code: string, message: string) => {
        if (rid) reply(rid, false, undefined, { code, message });
        emitError(code, message, rid);
      };

      switch (env.type) {
        case 'mount': {
          const checked = parseMountPayload(env.payload);
          if (!checked.ok) return fail(checked.code, checked.message);
          const m = checked.value;

          if (m.mode === 'local') {
            setMount({
              mode: 'local',
              ticket: '',
              roomCode: '',
              view: 'teacher',
              integrationId: '',
              hideJoinUi: m.hideJoinUi !== false,
            });
            if (m.participants) setLocalRoster(m.participants);
            if (rid) reply(rid, true, { accepted: true, mode: 'local' });
            return;
          }

          const claims = readTicket(m.ticket!);
          if (!claims) return fail('bad_ticket', '티켓을 읽을 수 없습니다.');
          setMount({
            mode: 'live',
            ticket: m.ticket!,
            roomCode: claims.roomCode,
            // 화면 종류는 부모가 고르되, **권한은 티켓의 role 만** 따른다.
            // 티켓이 학생인데 교사 화면을 달라고 해도 서버가 교사 권한을 주지 않는다.
            view: claims.role === 'teacher' && m.view === 'teacher' ? 'teacher' : 'student',
            integrationId: m.integrationId ?? '',
            hideJoinUi: m.hideJoinUi !== false,
          });
          if (rid) reply(rid, true, { accepted: true, mode: 'live' });
          return;
        }

        case 'setParticipants': {
          const p = env.payload as SetParticipantsPayload;
          if (!Array.isArray(p?.participants)) return fail('bad_payload', '명단 형식이 올바르지 않습니다.');

          if (mount?.mode === 'local') {
            if (p.participants.length > LOCAL_MAX_PARTICIPANTS) {
              return fail('too_many', `한 번에 ${LOCAL_MAX_PARTICIPANTS}명까지만 넣을 수 있습니다.`);
            }
            if (local.phase === 'racing') {
              queuedRef.current.participants = p.participants;
              setQueuedNotice(true);
              if (rid) reply(rid, true, { queuedForNextRound: true });
              return;
            }
            setLocalRoster(p.participants);
            if (rid) reply(rid, true, { applied: p.participants.length });
            return;
          }

          if (!room.conn) return fail('not_ready', '아직 방에 연결되지 않았습니다.');
          const racing = room.snapshot?.room.phase === 'countdown' || room.snapshot?.room.phase === 'running';
          if (racing) {
            queuedRef.current.participants = p.participants;
            setQueuedNotice(true);
            if (rid) reply(rid, true, { queuedForNextRound: true });
            return;
          }
          try {
            await room.conn.request('teacher:roster', {
              commands: [{ op: 'addMany', nicknames: p.participants.map((x) => x.nickname) }],
            });
            if (rid) reply(rid, true, { applied: p.participants.length });
          } catch (err) {
            return fail('roster_failed', err instanceof Error ? err.message : '명단을 넣지 못했습니다.');
          }
          return;
        }

        case 'setConfig': {
          const p = env.payload as SetConfigPayload;
          const merged = { ...config, ...p.config };
          const parsed = parseRoundConfig(merged, MAP_IDS);
          if (!parsed.ok) return fail(parsed.code, parsed.message);

          if (mount?.mode === 'local') {
            // 서버가 없으므로 여기서 받아들이면 곧 적용된 것이다
            if (local.phase === 'racing') {
              queuedRef.current.config = parsed.value;
              setQueuedNotice(true);
              if (rid) reply(rid, true, { queuedForNextRound: true });
              return;
            }
            setConfig(parsed.value);
            if (rid) reply(rid, true, { config: parsed.value });
            return;
          }

          const racing = room.snapshot?.room.phase === 'countdown' || room.snapshot?.room.phase === 'running';
          if (racing) {
            queuedRef.current.config = parsed.value;
            setQueuedNotice(true);
            if (rid) reply(rid, true, { queuedForNextRound: true });
            return;
          }
          // 서버에 못 보냈으면 «바꿨다» 고 답하지 않는다.
          // 조용히 화면에만 반영하면, 부모 앱은 규칙이 바뀐 줄 알고 시작을 누른다.
          if (!room.conn) return fail('not_ready', '아직 방에 연결되지 않았습니다.');
          setConfig(parsed.value);
          try {
            await room.conn.request('teacher:config', { config: parsed.value });
          } catch (err) {
            return fail('config_failed', err instanceof Error ? err.message : '설정을 바꾸지 못했습니다.');
          }
          if (rid) reply(rid, true, { config: parsed.value });
          return;
        }

        case 'startRound': {
          if (mount?.mode === 'local') {
            if (local.phase === 'racing') return fail('already_racing', '이미 경기가 돌고 있습니다.');
            const q = queuedRef.current;
            const roster = q.participants ?? localRoster;
            const cfg = q.config ?? config;
            if (q.participants) setLocalRoster(q.participants);
            if (q.config) setConfig(cfg);
            queuedRef.current = {};
            setQueuedNotice(false);

            const people = buildLocalParticipants(
              roster.map((x) => x.nickname),
              {
                ids: roster.map((x) => x.id),
                previousWinnerIds: local.previousWinnerIds,
                excludePreviousWinners: cfg.excludePreviousWinners,
              },
            );
            const countdownSec = (env.payload as { countdownSec?: number })?.countdownSec;
            const started = local.start({
              config: cfg,
              racers: people.filter((x) => !x.excluded),
              startDelayMs: typeof countdownSec === 'number' ? Math.max(0, countdownSec) * 1000 : undefined,
            });
            if (!started.ok) return fail(started.code, started.message);
            if (rid) reply(rid, true, { roundId: started.roundId });
            return;
          }

          if (!room.conn) return fail('not_ready', '아직 방에 연결되지 않았습니다.');
          const q = queuedRef.current;
          try {
            if (q.participants) {
              await room.conn.request('teacher:roster', {
                commands: [{ op: 'addMany', nicknames: q.participants.map((x) => x.nickname) }],
              });
            }
            const cfg = q.config ?? config;
            await room.conn.request('teacher:config', { config: cfg });
            setConfig(cfg);
            queuedRef.current = {};
            setQueuedNotice(false);
            const countdownSec = (env.payload as { countdownSec?: number })?.countdownSec ?? 3;
            const res = (await room.conn.request('teacher:start', { countdownSec })) as { roundId: string };
            if (rid) reply(rid, true, { roundId: res.roundId });
          } catch (err) {
            return fail('start_failed', err instanceof Error ? err.message : '시작하지 못했습니다.');
          }
          return;
        }

        case 'cancelRound': {
          if (mount?.mode === 'local') {
            local.reset();
            queuedRef.current = {};
            setQueuedNotice(false);
            if (rid) reply(rid, true, { cancelled: true });
            return;
          }
          if (!room.conn) return fail('not_ready', '아직 방에 연결되지 않았습니다.');
          try {
            await room.conn.request('teacher:cancel', {
              roundId: room.snapshot?.room.currentRoundId ?? undefined,
              reason: String((env.payload as { reason?: string })?.reason ?? '부모 앱이 취소했습니다.'),
            });
            if (rid) reply(rid, true, { cancelled: true });
          } catch (err) {
            return fail('cancel_failed', err instanceof Error ? err.message : '취소하지 못했습니다.');
          }
          return;
        }

        case 'resetRound': {
          queuedRef.current = {};
          setQueuedNotice(false);
          activeRef.current = null;
          studentInterp.reset();
          if (mount?.mode === 'local') local.reset();
          if (rid) reply(rid, true, { reset: true });
          return;
        }

        case 'getResult': {
          if (mount?.mode === 'local') {
            if (rid) reply(rid, true, local.result ? buildLocalFinishedPayload(local.result) : null);
            return;
          }
          if (rid) reply(rid, true, room.result ? buildFinishedPayload(room.result, mount) : null);
          return;
        }

        case 'destroy': {
          hostRef.current?.dispose();
          hostRef.current = null;
          if (rid) reply(rid, true, { destroyed: true });
          return;
        }

        default:
          return fail('unknown_type', `모르는 요청입니다: ${env.type}`);
      }
    },
    [config, emitError, local, localRoster, mount, reply, room.conn, room.result, room.snapshot, studentInterp],
  );

  // 리스너가 늘 최신 handle 을 보게 한다
  handleRef.current = handle;

  /* ---------------------------------------------------------------- 호스트(교사 화면일 때) */

  useEffect(() => {
    if (!mount || mount.mode !== 'live' || mount.view !== 'teacher') return;
    if (!room.conn || room.status !== 'open') return;
    const host = new HostRuntime(room.conn, {
      onError: (message) => emitError('engine_error', message),
    });
    hostRef.current = host;
    host.claim().catch((err: unknown) => {
      emitError('claim_failed', err instanceof Error ? err.message : '경기 엔진 등록에 실패했습니다.');
    });
    return () => {
      host.dispose();
      hostRef.current = null;
    };
  }, [mount, room.conn, room.status, emitError]);

  useEffect(() => {
    const cd = room.countdown;
    if (!cd) return;
    activeRef.current = cd.snapshot;
    studentInterp.reset();
    post('roundStarted', { roundId: cd.roundId, snapshot: cd.snapshot, startsAt: cd.startsAt });
    const host = hostRef.current;
    if (host) {
      const needed = requiredFinishCount(cd.snapshot.rule, cd.snapshot.racers.length);
      // 남은 «길이» 를 넘긴다(절대 시각 금지 — 워커의 기준점이 다르다)
      host.start(cd.snapshot, needed, Math.max(0, cd.startsAt - Date.now()));
    }
  }, [room.countdown, post, studentInterp]);

  /* ---- 학생 화면은 서버 프레임을 받는다 ---- */
  useEffect(() => {
    if (!room.conn || mount?.view === 'teacher') return;
    return room.conn.on('frame', (f) => studentInterp.push(f));
  }, [room.conn, mount?.view, studentInterp]);

  /* ---- 로비 변동을 부모에게 알린다 ---- */
  useEffect(() => {
    const snap = room.snapshot;
    if (!snap) return;
    post('participantsChanged', {
      participants: snap.participants.map((p: Participant) => ({
        id: p.id,
        nickname: p.nickname,
        online: p.online,
        excluded: p.excluded,
        externalId: p.externalId,
      })),
      onlineCount: snap.participants.filter((p) => p.online).length,
      totalCount: snap.participants.length,
      participantSnapshotVersion: snap.room.participantSnapshotVersion,
    });
  }, [room.snapshot, post]);

  /* ---- 준비됨 ---- */
  const readySentRef = useRef(false);
  useEffect(() => {
    if (readySentRef.current || !mount) return;
    if (mount.mode === 'local') {
      // 기다릴 방이 없다 — mount 를 받아들인 순간이 곧 준비된 순간이다
      readySentRef.current = true;
      post('ready', {
        mode: 'local',
        roomId: null,
        joinCode: null,
        view: 'teacher',
        participantId: null,
        mapIds: [...MAP_IDS],
        config,
      });
      return;
    }
    if (!room.snapshot) return;
    readySentRef.current = true;
    post('ready', {
      mode: 'live',
      roomId: room.snapshot.room.roomId,
      joinCode: room.snapshot.room.joinCode,
      view: mount.view,
      participantId: room.me?.id ?? null,
      mapIds: [...MAP_IDS],
      config: room.snapshot.room.config,
    });
    // config 는 첫 ready 에만 쓰인다 — 바뀔 때마다 다시 보내지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount, room.snapshot, room.me, post]);

  /* ---- local: 명단이 바뀌면 부모에게 알린다 ---- */
  useEffect(() => {
    if (mount?.mode !== 'local') return;
    post('participantsChanged', {
      participants: localParticipants.map((x) => ({
        id: x.id,
        nickname: x.nickname,
        online: true,
        excluded: x.excluded,
      })),
      onlineCount: localParticipants.length,
      totalCount: localParticipants.length,
      participantSnapshotVersion: 1,
    });
  }, [mount?.mode, localParticipants, post]);

  /* ---- 결과를 부모에게 ---- */
  useEffect(() => {
    if (!room.result) return;
    post('roundFinished', buildFinishedPayload(room.result, mount));
  }, [room.result, mount, post]);

  const shownResult = mount?.mode === 'local' ? local.result : room.result;
  useRoundSound({ muted: prefs.muted, countdownLeft: 0, result: shownResult });

  /* ---------------------------------------------------------------- 화면 */

  if (fatal) {
    return (
      <div className="page page--narrow">
        <div className="notice notice--bad">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>{fatal}</span>
        </div>
      </div>
    );
  }

  if (!mount) {
    return (
      <div className="page page--narrow">
        <div className="muted">수업 앱의 신호를 기다리는 중…</div>
        <p className="faint">
          이 화면은 다른 수업 앱 안에서 열립니다. 직접 열면 아무 일도 일어나지 않습니다.
        </p>
      </div>
    );
  }

  const isLocal = mount.mode === 'local';
  const activeSnapshot = isLocal
    ? local.snapshot
    : (room.countdown?.snapshot ?? room.snapshot?.activeRound ?? activeRef.current);
  const map = getMap(activeSnapshot?.mapId ?? config.mapId) ?? requireMap('classic-wheel');
  const isTeacher = mount.view === 'teacher';
  const interpolator = isLocal
    ? local.interpolator
    : isTeacher
      ? (hostRef.current?.interpolator ?? studentInterp)
      : studentInterp;
  const meIndex =
    activeSnapshot && room.me
      ? (() => {
          const i = activeSnapshot.racers.findIndex((r) => r.participantId === room.me!.id);
          return i >= 0 ? i : null;
        })()
      : null;

  const phase = room.snapshot?.room.phase ?? 'lobby';
  const racing = isLocal ? local.phase === 'racing' : phase === 'countdown' || phase === 'running';
  const errorText = isLocal ? local.error : (room.error?.message ?? null);
  /** 로비에 보여 줄 사람들 — 모드에 따라 출처가 다르다 */
  const lobbyPeople: Array<{ id: string; nickname: string; dupIndex: number; hue: number; online: boolean }> = isLocal
    ? localParticipants
    : (room.snapshot?.participants ?? []);

  return (
    <div className="page page--app play-layout">
      {queuedNotice ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">⏳</span>
          <span>수업 앱이 보낸 변경은 다음 라운드부터 적용됩니다.</span>
        </div>
      ) : null}

      {errorText ? (
        <div className="notice notice--bad" role="alert">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>{errorText}</span>
        </div>
      ) : null}

      {racing || shownResult ? (
        <RaceView
          map={map}
          racers={activeSnapshot?.racers ?? []}
          interpolator={interpolator}
          meIndex={meIndex}
          prefs={prefs}
          onPrefsChange={updatePrefs}
          hideControls={!isTeacher && mount.hideJoinUi}
          hud={
            <div className="hud-card">
              <strong>{describeRule(activeSnapshot?.rule ?? config.rule)}</strong>
              <div className="faint">{map.name}</div>
            </div>
          }
        />
      ) : (
        <section className="card stack">
          <h1>{isTeacher ? '시작 준비' : '대기 중'}</h1>
          <p className="muted">
            {isLocal
              ? lobbyPeople.length > 0
                ? `${lobbyPeople.length}명 · 수업 앱에서 시작을 누르면 경기가 시작됩니다.`
                : '수업 앱이 명단을 넣어 주기를 기다리는 중…'
              : isTeacher
                ? '수업 앱에서 시작을 누르면 경기가 시작됩니다.'
                : '선생님이 시작하면 경기가 보입니다.'}
          </p>
          {/* 연동 모드에서는 코드·QR 을 숨긴다 — 학생은 단추 하나로 들어왔다 */}
          {!mount.hideJoinUi && room.snapshot ? (
            <div className="joincode">{room.snapshot.room.joinCode}</div>
          ) : null}
          {lobbyPeople.length > 0 ? (
            <div className="card card--tight" style={{ maxHeight: 260, overflow: 'auto' }}>
              {lobbyPeople.map((x) => (
                <div key={x.id} className={`lb-row${x.id === room.me?.id ? ' lb-row--mine' : ''}`}>
                  <span className="lb-rank" aria-hidden="true">{x.online ? '●' : '○'}</span>
                  <span className="lb-name">
                    <span className="swatch" style={{ background: `hsl(${x.hue} 85% 62%)` }} aria-hidden="true" />
                    <span>{displayName(x)}</span>
                  </span>
                  <span className="faint">{isLocal ? '참가' : x.online ? '접속' : '대기'}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {racing && activeSnapshot ? (
        <section className="card card--tight">
          <Leaderboard
            racers={activeSnapshot.racers}
            ranking={interpolator.sample().ranking}
            finished={interpolator.finished}
            meIndex={meIndex}
            limit={8}
          />
        </section>
      ) : null}

      {shownResult ? (
        <section className="card">
          <ResultPanel result={shownResult} myParticipantId={room.me?.id ?? null} />
        </section>
      ) : null}
    </div>
  );
}

function buildFinishedPayload(result: import('@marble/protocol').RoundResult, mount: MountState | null) {
  return {
    result,
    // 부모 앱은 이 주소를 **서버에서** 다시 조회해 확인해야 한다.
    // 브라우저를 거쳐 온 위 result 는 화면용이다.
    verifyUrl: `${location.origin}/api/rooms/${mount?.roomCode ?? ''}/results/${result.roundId}`,
    webhookSent: true,
    serverVerified: true,
  };
}

/**
 * local 모드 결과.
 *
 * 확인해 줄 서버가 없으므로 verifyUrl 은 null 이고 serverVerified 는 false 다.
 * 이것을 true 로 적으면 부모 앱은 확인된 값인 줄 알고 성적·평가에 쓴다.
 */
function buildLocalFinishedPayload(result: import('@marble/protocol').RoundResult) {
  return { result, verifyUrl: null, webhookSent: false, serverVerified: false };
}
