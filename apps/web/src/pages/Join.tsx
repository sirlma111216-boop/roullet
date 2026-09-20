/** 학생 입장 — 코드 확인 + 닉네임. */

import { useEffect, useState } from 'react';
import { checkNickname, NICK_MAX, normalizeJoinCode } from '@marble/protocol';
import { ApiFailure, getRoomInfo, type RoomInfo } from '../net/api.ts';
import { navigate } from '../router.ts';
import { getLastNickname, getRejoinToken, setLastNickname } from '../util/storage.ts';

export function Join({ initialCode }: { initialCode: string }): React.ReactElement {
  const [code, setCode] = useState(() => normalizeJoinCode(initialCode));
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => getLastNickname());

  const hasRejoin = Boolean(getRejoinToken(code));

  useEffect(() => {
    if (code.length !== 6) {
      setInfo(null);
      return;
    }
    let alive = true;
    setChecking(true);
    setError(null);
    getRoomInfo(code)
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setInfo(null);
        setError(err instanceof ApiFailure ? err.message : '방을 확인하지 못했습니다.');
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const nickCheck = checkNickname(nickname);
  const canEnter = info?.exists === true && (hasRejoin || nickCheck.ok);

  const enter = () => {
    if (!canEnter) return;
    if (nickCheck.ok) setLastNickname(nickCheck.value);
    navigate(`/play?code=${code}${nickCheck.ok ? `&nick=${encodeURIComponent(nickCheck.value)}` : ''}`);
  };

  return (
    <div className="page page--narrow">
      <h1>구슬 레이스 참여</h1>

      <div className="field">
        <label htmlFor="code">참여 코드</label>
        <input
          id="code"
          className="input input--code"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
        />
      </div>

      {checking ? <div className="muted">방을 확인하는 중…</div> : null}

      {error ? (
        <div className="notice notice--bad">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>{error}</span>
        </div>
      ) : null}

      {info?.exists ? (
        <div className="notice notice--good">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span>
            방을 찾았습니다. 지금 {info.participants}명 / 정원 {info.capacity}명
            {info.locked ? ' · 입장이 잠겨 있습니다' : ''}
          </span>
        </div>
      ) : null}

      {info?.locked && !hasRejoin ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">🔒</span>
          <span>교사가 입장을 잠갔습니다. 선생님께 말씀해 주세요.</span>
        </div>
      ) : null}

      {hasRejoin ? (
        <div className="notice">
          <span className="notice__icon" aria-hidden="true">↩</span>
          <span>
            이 기기로 전에 들어왔던 방입니다. 닉네임을 다시 적지 않아도 <strong>같은 참가자</strong>로
            돌아갑니다.
          </span>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="nick">닉네임 ({NICK_MAX}자까지)</label>
          <input
            id="nick"
            className="input"
            maxLength={NICK_MAX}
            autoComplete="off"
            placeholder="화면에 보일 이름"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enter();
            }}
          />
          <span className="faint">
            친구들 화면에 그대로 보입니다. 같은 이름이 여러 개면 뒤에 구분 번호가 붙습니다.
          </span>
        </div>
      )}

      <button type="button" className="btn btn--primary btn--big" onClick={enter} disabled={!canEnter}>
        대기실 들어가기
      </button>

      <p className="faint">
        기기를 바꾸면 이전 참가 기록을 되살릴 수 없습니다. 그럴 때는 선생님께 말씀해 주세요.
      </p>
    </div>
  );
}
