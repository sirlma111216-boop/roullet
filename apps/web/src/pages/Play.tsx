/**
 * 학생 화면.
 *
 * 휴대폰 세로에 맞춘다. 학생이 할 수 있는 것은 **보는 것**뿐이다 —
 * 방을 만들거나 시작하거나 명단을 바꾸는 단추가 아예 없고, 서버도 그 요청을 거절한다.
 * (단추를 숨기는 것만으로 권한 검사를 대신하지 않는다.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displayName } from '@marble/protocol';
import { getMap, requireMap } from '@marble/game-core';
import { describeRule } from '@marble/game-core/rules';
import { RaceView } from '../components/RaceView.tsx';
import { ResultPanel } from '../components/ResultPanel.tsx';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { FrameInterpolator } from '../race/interpolator.ts';
import { statusText, useRoom } from '../hooks/useRoom.ts';
import { navigate } from '../router.ts';
import { getRejoinToken, getViewPrefs, setViewPrefs, type ViewPrefs } from '../util/storage.ts';

export function Play({ code, nickname }: { code: string; nickname?: string }): React.ReactElement {
  const room = useRoom({
    code,
    role: 'student',
    nickname,
    rejoinToken: getRejoinToken(code),
  });

  const [prefs, setPrefs] = useState<ViewPrefs>(() => ({ ...getViewPrefs(), cameraMode: 'me' }));
  const updatePrefs = useCallback((p: ViewPrefs) => {
    setPrefs(p);
    setViewPrefs(p);
  }, []);

  const interpolator = useMemo(() => new FrameInterpolator(), []);
  const [now, setNow] = useState(() => Date.now());
  const activeRef = useRef(room.countdown?.snapshot ?? null);

  /* ---- 프레임 받기 ---- */
  useEffect(() => {
    if (!room.conn) return;
    const off = room.conn.on('frame', (f) => interpolator.push(f));
    return off;
  }, [room.conn, interpolator]);

  /* ---- 새 라운드가 시작되면 보간기를 비운다 ---- */
  useEffect(() => {
    if (!room.countdown) return;
    activeRef.current = room.countdown.snapshot;
    interpolator.reset();
  }, [room.countdown, interpolator]);

  useEffect(() => {
    if (!room.countdown) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [room.countdown]);

  const snap = room.snapshot;
  const activeSnapshot = room.countdown?.snapshot ?? snap?.activeRound ?? activeRef.current;
  const map = getMap(activeSnapshot?.mapId ?? snap?.room.config.mapId ?? 'classic-wheel') ?? requireMap('classic-wheel');
  const phase = snap?.room.phase ?? 'lobby';
  const racing = phase === 'countdown' || phase === 'running';

  const meIndex = useMemo(() => {
    if (!activeSnapshot || !room.me) return null;
    const i = activeSnapshot.racers.findIndex((r) => r.participantId === room.me!.id);
    return i >= 0 ? i : null;
  }, [activeSnapshot, room.me]);

  const st = statusText(room.status);
  const countdownLeft = room.countdown ? Math.max(0, Math.ceil((room.countdown.startsAt - now) / 1000)) : 0;

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

  return (
    <div className="page page--app play-layout">
      <div className="row">
        <span className={`badge badge--${st.tone}`}>
          <span className="dot" aria-hidden="true" />
          {st.text}
        </span>
        <span className="badge">{code}</span>
        {room.me ? <span className="badge">{displayName(room.me)}</span> : null}
        <span className="grow" />
        {snap ? (
          <span className="badge">
            {snap.participants.length}명 참가
          </span>
        ) : null}
      </div>

      {room.error ? (
        <div className="notice notice--bad" role="alert">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>{room.error.message}</span>
        </div>
      ) : null}

      {room.status === 'reconnecting' ? (
        <div className="notice notice--warn" role="status">
          <span className="notice__icon" aria-hidden="true">↻</span>
          <span>연결이 끊겼습니다. 다시 붙는 중입니다 — 내 구슬은 경기에 계속 참가하고 있습니다.</span>
        </div>
      ) : null}

      {room.interruption ? (
        <div className="notice notice--bad" role="alert">
          <span className="notice__icon" aria-hidden="true">⚠</span>
          <span>{room.interruption.reason}</span>
        </div>
      ) : null}

      {meIndex === null && racing ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">👀</span>
          <span>
            이번 경기에는 참가하지 않습니다(경기가 시작된 뒤 들어왔거나 제외되었습니다).
            <strong> 다음 라운드부터 참가합니다.</strong>
          </span>
        </div>
      ) : null}

      {racing || room.result ? (
        <RaceView
          map={map}
          racers={activeSnapshot?.racers ?? []}
          interpolator={interpolator}
          meIndex={meIndex}
          prefs={prefs}
          onPrefsChange={updatePrefs}
          hud={
            <div className="hud-card">
              <strong>{describeRule(activeSnapshot?.rule ?? snap?.room.config.rule ?? { kind: 'first' })}</strong>
              <div className="faint">{map.name}</div>
            </div>
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
        <section className="card stack">
          <h1>대기실</h1>
          <p className="muted">선생님이 시작하면 경기가 보입니다. 이 화면을 그대로 두세요.</p>
          {snap ? (
            <>
              <div className="row">
                <span className="badge">맵 {getMap(snap.room.config.mapId)?.name ?? snap.room.config.mapId}</span>
                <span className="badge">{describeRule(snap.room.config.rule)}</span>
              </div>
              <div className="card card--tight" style={{ maxHeight: 260, overflow: 'auto' }}>
                <div className="leaderboard">
                  {snap.participants.map((p) => (
                    <div
                      key={p.id}
                      className={`lb-row${p.id === room.me?.id ? ' lb-row--mine' : ''}`}
                      role="listitem"
                    >
                      <span className="lb-rank" aria-hidden="true">
                        {p.online ? '●' : '○'}
                      </span>
                      <span className="lb-name">
                        <span className="swatch" style={{ background: `hsl(${p.hue} 85% 62%)` }} aria-hidden="true" />
                        <span>{displayName(p)}</span>
                        {p.excluded ? <span className="badge badge--warn">제외</span> : null}
                      </span>
                      <span className="faint">{p.online ? '접속' : '대기'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="muted">방 정보를 받는 중…</div>
          )}
        </section>
      )}

      {racing && activeSnapshot ? (
        <section className="card card--tight" aria-label="진행 순위">
          <Leaderboard
            racers={activeSnapshot.racers}
            ranking={interpolator.sample().ranking}
            finished={interpolator.finished}
            meIndex={meIndex}
            limit={8}
          />
        </section>
      ) : null}

      {room.result ? (
        <section className="card">
          <ResultPanel result={room.result} myParticipantId={room.me?.id ?? null} />
        </section>
      ) : null}
    </div>
  );
}
