/**
 * 교사 화면.
 *
 * 이 화면이 «호스트» 다 — 물리 계산이 여기(Web Worker)에서 돌고, 서버는 그것을 검증해
 * 학생들에게 중계한다. 그래서 교사 화면을 닫으면 진행 중이던 경기가 멈춘다.
 * 새로고침하면 물리 상태가 사라지므로 서버가 그 라운드를 취소하고 재경기를 안내한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultRoundConfig,
  type Participant,
  type RoundConfig,
  type RosterCommand,
  type RuleSnapshot,
} from '@marble/protocol';
import { getMap, requireMap } from '@marble/game-core';
import { describeRule, requiredFinishCount } from '@marble/game-core/rules';
import { HostRuntime } from '../race/hostRuntime.ts';
import { FrameInterpolator } from '../race/interpolator.ts';
import { RaceView } from '../components/RaceView.tsx';
import { MapPicker } from '../components/MapPicker.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { RosterPanel } from '../components/RosterPanel.tsx';
import { ResultPanel } from '../components/ResultPanel.tsx';
import { QrCode } from '../components/QrCode.tsx';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { statusText, useRoom } from '../hooks/useRoom.ts';
import { useRoundSound } from '../hooks/useRoundSound.ts';
import { navigate, studentJoinUrl } from '../router.ts';
import { findTeacherRoom, getViewPrefs, setViewPrefs, type ViewPrefs } from '../util/storage.ts';
import { RequestRejected } from '../net/connection.ts';

export function Teacher({ code }: { code: string }): React.ReactElement {
  const record = useMemo(() => findTeacherRoom(code), [code]);
  const room = useRoom({
    code,
    role: 'teacher',
    teacherToken: record?.teacherToken,
    enabled: Boolean(record),
  });

  // 교실 앞 큰 화면에서는 「선두 따라보기」가 기본이다.
  // 전체 보기로 두면 긴 맵(네온 장거리는 세로 275칸)에서 구슬이 좁쌀만 해져
  // 뒷자리에서는 아무것도 안 보인다. 실제로 띄워 보고 바꿨다.
  const [prefs, setPrefs] = useState<ViewPrefs>(() => ({ ...getViewPrefs(), cameraMode: 'leader' }));
  const updatePrefs = useCallback((p: ViewPrefs) => {
    setPrefs(p);
    setViewPrefs(p);
  }, []);

  const [config, setConfig] = useState<RoundConfig>(() => defaultRoundConfig('classic-wheel'));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  const [lagMs, setLagMs] = useState(0);
  const [hostReady, setHostReady] = useState(false);
  /** 교사가 「다음 라운드 준비」로 치운 결과 — 다시 띄우지 않는다 */
  const [dismissedRoundId, setDismissedRoundId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const hostRef = useRef<HostRuntime | null>(null);
  const activeSnapshotRef = useRef<RuleSnapshot | null>(null);

  /* ---- 서버가 준 설정을 한 번만 받아 온다(그 뒤로는 교사 화면이 주인) ---- */
  useEffect(() => {
    if (configLoaded || !room.snapshot) return;
    setConfig(room.snapshot.room.config);
    setConfigLoaded(true);
  }, [room.snapshot, configLoaded]);

  /* ---- 호스트 런타임 ---- */
  useEffect(() => {
    if (!room.conn || room.status !== 'open') return;
    const host = new HostRuntime(room.conn, {
      onLag: (ms) => setLagMs(ms),
      onError: (message) => setNotice({ tone: 'bad', text: message }),
      onDone: () => setNotice({ tone: 'good', text: '경기가 끝났습니다. 서버가 결과를 확정합니다.' }),
    });
    hostRef.current = host;
    let alive = true;
    host
      .claim()
      .then(() => {
        if (alive) setHostReady(true);
      })
      .catch((err: unknown) => {
        setNotice({
          tone: 'bad',
          text: err instanceof Error ? err.message : '경기 엔진을 서버에 등록하지 못했습니다.',
        });
      });
    return () => {
      alive = false;
      setHostReady(false);
      host.dispose();
      hostRef.current = null;
    };
  }, [room.conn, room.status]);

  /* ---- 카운트다운이 오면 그 시각에 맞춰 물리를 시작한다 ---- */
  useEffect(() => {
    const cd = room.countdown;
    const host = hostRef.current;
    if (!cd || !host) return;
    activeSnapshotRef.current = cd.snapshot;
    const needed = requiredFinishCount(cd.snapshot.rule, cd.snapshot.racers.length);
    // 남은 «길이» 를 넘긴다. 절대 시각을 넘기면 워커의 기준점이 달라 엉뚱하게 기다린다.
    host.start(cd.snapshot, needed, Math.max(0, cd.startsAt - Date.now()));
  }, [room.countdown]);

  /* ---- 카운트다운 숫자 ---- */
  useEffect(() => {
    if (!room.countdown) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [room.countdown]);

  const snap = room.snapshot;
  const participants: Participant[] = snap?.participants ?? [];
  const autoExcluded = config.excludePreviousWinners ? (snap?.previousWinnerIds ?? []) : [];
  const racers = participants.filter((p) => !p.excluded && !autoExcluded.includes(p.id));
  const phase = snap?.room.phase ?? 'lobby';
  const racing = phase === 'countdown' || phase === 'running';

  const activeSnapshot = room.countdown?.snapshot ?? activeSnapshotRef.current;
  const showResult = room.result && room.result.roundId !== dismissedRoundId ? room.result : null;
  const map = getMap(activeSnapshot?.mapId ?? config.mapId) ?? requireMap('classic-wheel');

  /* ---- 서버로 설정 보내기 ---- */
  const pushConfig = useCallback(
    async (next: RoundConfig) => {
      setConfig(next);
      if (!room.conn) return;
      try {
        await room.conn.request('teacher:config', { config: next });
      } catch (err) {
        if (err instanceof RequestRejected) setNotice({ tone: 'bad', text: err.message });
      }
    },
    [room.conn],
  );

  const sendRoster = useCallback(
    async (commands: RosterCommand[]) => {
      if (!room.conn) return;
      try {
        await room.conn.request('teacher:roster', { commands });
      } catch (err) {
        if (err instanceof RequestRejected) setNotice({ tone: 'bad', text: err.message });
      }
    },
    [room.conn],
  );

  const start = useCallback(async () => {
    if (!room.conn) return;
    setBusy(true);
    setNotice(null);
    try {
      await room.conn.request('teacher:config', { config });
      await room.conn.request('teacher:start', { countdownSec: 3 });
    } catch (err) {
      setNotice({
        tone: 'bad',
        text: err instanceof Error ? err.message : '시작하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  }, [room.conn, config]);

  const cancel = useCallback(async () => {
    if (!room.conn) return;
    hostRef.current?.stop();
    try {
      await room.conn.request('teacher:cancel', {
        roundId: snap?.room.currentRoundId ?? undefined,
        reason: '교사가 경기를 중단했습니다.',
      });
      setNotice({ tone: 'warn', text: '경기를 중단했습니다. 결과는 확정되지 않았습니다.' });
    } catch (err) {
      if (err instanceof RequestRejected) setNotice({ tone: 'bad', text: err.message });
    }
  }, [room.conn, snap?.room.currentRoundId]);

  const closeRoom = useCallback(
    async (deleteData: boolean) => {
      if (!room.conn) return;
      if (!window.confirm(deleteData ? '방을 닫고 기록을 모두 지웁니다. 계속할까요?' : '방을 닫을까요?')) return;
      try {
        await room.conn.request('teacher:close', { deleteData });
      } catch {
        /* 닫는 중 연결이 끊길 수 있다 */
      }
      navigate('/');
    },
    [room.conn],
  );

  // 카운트다운 남은 초 — 훅보다 먼저 계산해야 한다(훅은 조기 return 뒤에 올 수 없다)
  const countdownLeft = room.countdown ? Math.max(0, Math.ceil((room.countdown.startsAt - now) / 1000)) : 0;
  useRoundSound({ muted: prefs.muted, countdownLeft, result: showResult });

  /* ---- 화면 ---- */

  if (!record) {
    return (
      <div className="page page--narrow">
        <div className="notice notice--bad">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>
            이 기기에 <strong>{code}</strong> 방의 교사 권한이 없습니다. 방을 만든 기기·브라우저에서 열거나
            새 방을 만들어 주세요.
          </span>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          첫 화면으로
        </button>
      </div>
    );
  }

  if (room.closedReason) {
    return (
      <div className="page page--narrow">
        <div className="notice">
          <span>{room.closedReason}</span>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          첫 화면으로
        </button>
      </div>
    );
  }

  const st = statusText(room.status);

  return (
    <div className="page page--app">
      <div className="row">
        <h1 style={{ margin: 0 }}>교사 화면</h1>
        <span className={`badge badge--${st.tone}`}>
          <span className="dot" aria-hidden="true" />
          {st.text}
        </span>
        <span className={`badge badge--${hostReady ? 'good' : 'warn'}`}>
          경기 엔진 {hostReady ? '준비됨' : '준비 중'}
        </span>
        <span className="badge">{phaseLabel(phase)}</span>
        <span className="grow" />
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => closeRoom(false)}>
          방 닫기
        </button>
        <button type="button" className="btn btn--sm btn--danger" onClick={() => closeRoom(true)}>
          닫고 기록 지우기
        </button>
      </div>

      {notice ? (
        <div className={`notice notice--${notice.tone}`} role="status">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{notice.text}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setNotice(null)}>
            닫기
          </button>
        </div>
      ) : null}

      {room.interruption ? (
        <div className="notice notice--bad" role="alert">
          <span className="notice__icon" aria-hidden="true">⚠</span>
          <span>
            {room.interruption.reason}
            {room.interruption.canResume ? ' 연결이 돌아오면 이어집니다.' : ' 다시 시작해 주세요.'}
          </span>
        </div>
      ) : null}

      {lagMs > 0 ? (
        <div className="notice notice--warn" role="status">
          <span className="notice__icon" aria-hidden="true">⏱</span>
          <span>
            이 탭이 {Math.round(lagMs)}ms 동안 멈춰 있었습니다(다른 탭·절전). 경기 화면을 켜 두세요.
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setLagMs(0)}>
              확인
            </button>
          </span>
        </div>
      ) : null}

      <div className="teacher-layout">
        <main className="stack" style={{ minHeight: 0 }}>
          {racing || showResult ? (
            <RaceView
              map={map}
              racers={activeSnapshot?.racers ?? []}
              interpolator={hostRef.current?.interpolator ?? EMPTY_INTERPOLATOR}
              meIndex={null}
              prefs={prefs}
              onPrefsChange={updatePrefs}
              hud={
                <>
                  <div className="hud-card">
                    <strong>{describeRule(activeSnapshot?.rule ?? config.rule)}</strong>
                    <div className="faint">
                      {map.name} · {activeSnapshot?.racers.length ?? racers.length}명
                    </div>
                  </div>
                  {activeSnapshot ? (
                    <div className="hud-card">
                      <Leaderboard
                        racers={activeSnapshot.racers}
                        ranking={hostRef.current?.interpolator.sample().ranking ?? []}
                        finished={hostRef.current?.interpolator.finished ?? new Map()}
                        meIndex={null}
                        limit={8}
                      />
                    </div>
                  ) : null}
                </>
              }
              overlay={
                room.countdown && countdownLeft > 0 ? (
                  <div className="countdown" role="status" aria-live="assertive">
                    {countdownLeft}
                    <small>곧 시작합니다</small>
                  </div>
                ) : null
              }
            />
          ) : (
            <section className="card stack" aria-labelledby="join-h">
              <h2 id="join-h">학생 입장</h2>
              <div className="joinbox">
                <QrCode url={studentJoinUrl(code)} />
                <div className="stack grow">
                  <div className="joincode" aria-label={`참여 코드 ${code.split('').join(' ')}`}>
                    {code}
                  </div>
                  <div className="muted" style={{ textAlign: 'center' }}>
                    {studentJoinUrl(code)}
                  </div>
                  <p className="faint">
                    QR 에는 학생용 입장 주소만 들어 있습니다. 교사 권한은 들어 있지 않으니 화면에 띄워도
                    안전합니다.
                  </p>
                </div>
              </div>
            </section>
          )}

          {showResult ? (
            <section className="card">
              <ResultPanel
                result={showResult}
                busy={busy}
                onRematch={() => void start()}
                onNextRound={() => {
                  // 결과를 치우고 대기실(QR·명단)로 돌아간다
                  setDismissedRoundId(showResult.roundId);
                  activeSnapshotRef.current = null;
                  setNotice(null);
                }}
              />
            </section>
          ) : null}
        </main>

        <aside className="teacher-side">
          <section className="card stack">
            <h2>이번 라운드</h2>
            <MapPicker value={config.mapId} onChange={(mapId) => void pushConfig({ ...config, mapId })} disabled={racing} />
            <RuleEditor
              rule={config.rule}
              onChange={(rule) => void pushConfig({ ...config, rule })}
              awards={config.awards}
              onAwardsChange={(awards) => void pushConfig({ ...config, awards })}
              allowDuplicateAwards={config.allowDuplicateAwards}
              onAllowDuplicateChange={(v) => void pushConfig({ ...config, allowDuplicateAwards: v })}
              racers={racers}
              disabled={racing}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.excludePreviousWinners}
                disabled={racing}
                onChange={(e) => void pushConfig({ ...config, excludePreviousWinners: e.target.checked })}
              />
              <span>지난 라운드 당첨자는 이번에 빼기</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.useSkills}
                disabled={racing}
                onChange={(e) => void pushConfig({ ...config, useSkills: e.target.checked })}
              />
              <span>
                자동 충격 스킬 켜기 <span className="faint">(기본 꺼짐 · 모든 구슬에 같은 규칙)</span>
              </span>
            </label>

            {racing ? (
              <button type="button" className="btn btn--danger btn--big" onClick={() => void cancel()}>
                경기 중단
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--big"
                onClick={() => void start()}
                disabled={busy || racers.length === 0 || (!hostReady && config.rule.kind !== 'manual')}
              >
                {busy ? '준비 중…' : config.rule.kind === 'manual' ? '지정한 대로 발표' : '카운트다운 시작'}
              </button>
            )}
            {racing ? (
              <p className="faint">
                진행 중에 바꾼 설정은 <strong>다음 라운드</strong>에 적용됩니다. 지금 바꾸려면 중단하고 다시
                시작하세요.
              </p>
            ) : null}
          </section>

          <section className="card">
            <RosterPanel
              participants={participants}
              capacity={snap?.room.capacity ?? 60}
              locked={snap?.room.locked ?? false}
              autoExcludedIds={autoExcluded}
              disabled={racing}
              onCommands={(c) => void sendRoster(c)}
            />
          </section>

          <section className="card stack">
            <h3>도움말</h3>
            <ul className="faint" style={{ margin: 0, paddingLeft: 18 }}>
              <li>경기 중에는 이 탭을 계속 앞에 두세요. 뒤로 가면 계산이 느려집니다.</li>
              <li>새로고침하면 진행 중이던 경기가 취소됩니다(물리 상태가 사라지기 때문).</li>
              <li>경기 도중 들어온 학생은 관전하고 다음 라운드부터 참가합니다.</li>
              <li>
                결과는 서버가 확정한 뒤에 나옵니다. 화면이 스스로 당첨자를 정하지 않습니다.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function phaseLabel(p: string): string {
  switch (p) {
    case 'lobby':
      return '대기실';
    case 'countdown':
      return '카운트다운';
    case 'running':
      return '경기 중';
    case 'finished':
      return '결과 발표';
    case 'paused':
      return '중단됨';
    case 'cancelled':
      return '취소됨';
    case 'closed':
      return '닫힘';
    default:
      return p;
  }
}

/** 아직 호스트 런타임이 없을 때(연결 전) 쓰는 빈 보간기 */
const EMPTY_INTERPOLATOR = new FrameInterpolator();
