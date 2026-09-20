/** 첫 화면 — 교사·학생·혼자 뽑기 세 갈래. */

import { useState } from 'react';
import { DEFAULT_CAPACITY, MAX_CAPACITY, normalizeJoinCode } from '@marble/protocol';
import { createRoom, ApiFailure } from '../net/api.ts';
import { navigate } from '../router.ts';
import { listTeacherRooms, rememberTeacherRoom } from '../util/storage.ts';

export function Home(): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const recent = listTeacherRooms();

  const openRoom = async () => {
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom({ capacity });
      rememberTeacherRoom({
        joinCode: room.joinCode,
        roomId: room.roomId,
        teacherToken: room.teacherToken,
        createdAt: Date.now(),
      });
      navigate(`/teacher?code=${room.joinCode}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : '방을 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page page--narrow">
      <header className="stack">
        <h1>교실 구슬 레이스</h1>
        <p className="muted">
          구슬이 굴러 내려가 결승선을 통과한 순서로 발표자·도우미를 정합니다. 학생은 앱을 깔지 않고
          휴대폰 브라우저로 들어옵니다.
        </p>
      </header>

      <section className="card stack" aria-labelledby="teacher-h">
        <h2 id="teacher-h">교사 — 방 열기</h2>
        <div className="field">
          <label htmlFor="cap">정원</label>
          <input
            id="cap"
            className="input"
            type="number"
            min={1}
            max={MAX_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Math.min(MAX_CAPACITY, Number(e.target.value) || 1)))}
          />
          <span className="faint">
            기본 {DEFAULT_CAPACITY}명. 최대 {MAX_CAPACITY}명까지 검증했습니다.
          </span>
        </div>
        <button type="button" className="btn btn--primary btn--big" onClick={openRoom} disabled={creating}>
          {creating ? '방을 만드는 중…' : '새 방 만들기'}
        </button>
        {error ? (
          <div className="notice notice--bad">
            <span className="notice__icon" aria-hidden="true">✕</span>
            <span>{error}</span>
          </div>
        ) : null}

        {recent.length > 0 ? (
          <div className="stack">
            <strong className="muted">최근에 연 방</strong>
            {recent.map((r) => (
              <button
                key={r.joinCode}
                type="button"
                className="btn btn--ghost"
                onClick={() => navigate(`/teacher?code=${r.joinCode}`)}
              >
                {r.joinCode} · {new Date(r.createdAt).toLocaleString('ko-KR')}
              </button>
            ))}
            <span className="faint">
              방과 결과는 마지막 활동 후 24시간 동안 남습니다. 그 뒤에는 코드를 넣어도 비어 있습니다.
            </span>
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="student-h">
        <h2 id="student-h">학생 — 참여 코드로 들어가기</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const c = normalizeJoinCode(code);
            if (c.length === 6) navigate(`/join?code=${c}`);
          }}
        >
          <div className="field">
            <label htmlFor="join-code">참여 코드 6자리</label>
            <input
              id="join-code"
              className="input input--code"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={6}
              placeholder="ABC234"
              value={code}
              onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
            />
          </div>
          <button type="submit" className="btn btn--primary btn--big" disabled={normalizeJoinCode(code).length !== 6}>
            들어가기
          </button>
        </form>
      </section>

      <section className="card stack" aria-labelledby="local-h">
        <h2 id="local-h">혼자 빠르게 뽑기</h2>
        <p className="muted">
          명단을 직접 넣고 이 기기에서만 경기합니다. 서버도, 학생 접속도 필요 없습니다 — 인터넷이 막힌
          교실에서도 됩니다.
        </p>
        <button type="button" className="btn btn--big" onClick={() => navigate('/local')}>
          로컬 빠른 뽑기
        </button>
      </section>

      <footer className="faint">
        <p>
          이 서비스는 lazygyu/roulette(MIT)의 맵 구성을 계승해 새로 만든 교실용 앱입니다. 출처와 라이선스는
          저장소의 THIRD_PARTY_NOTICES.md 를 보세요.
        </p>
      </footer>
    </div>
  );
}
