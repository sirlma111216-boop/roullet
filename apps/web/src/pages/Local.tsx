/**
 * 로컬 빠른 뽑기.
 *
 * 서버도 학생 접속도 없이, 교사가 명단을 넣고 이 기기에서만 경기한다.
 * 학교 와이파이가 막혀도 되고, 인원이 적어 굳이 방을 열 필요가 없을 때 쓴다.
 *
 * 물리·규칙·결과 계산은 실시간 모드와 **같은 코드**(game-core)를 쓴다.
 * 다른 점은 서버가 없다는 것뿐이라, 결과 형식도 그대로다.
 */

import { useCallback, useMemo, useState } from 'react';
import { defaultRoundConfig, type RoundConfig } from '@marble/protocol';
import { getMap, requireMap } from '@marble/game-core';
import { describeRule } from '@marble/game-core/rules';
import { MapPicker } from '../components/MapPicker.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { ResultPanel } from '../components/ResultPanel.tsx';
import { RaceView } from '../components/RaceView.tsx';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { buildLocalParticipants, useLocalRace } from '../race/useLocalRace.ts';
import { navigate } from '../router.ts';
import { getViewPrefs, setViewPrefs, type ViewPrefs } from '../util/storage.ts';
import { useRoundSound } from '../hooks/useRoundSound.ts';

const SAMPLE = ['김하늘', '박서준', '이도윤', '최지우', '정민서', '강예린', '조하준', '윤서아'];

export function Local(): React.ReactElement {
  const [namesText, setNamesText] = useState(SAMPLE.join('\n'));
  const [config, setConfig] = useState<RoundConfig>(() => defaultRoundConfig('classic-wheel'));
  const [prefs, setPrefs] = useState<ViewPrefs>(() => getViewPrefs());

  // 경기를 돌리는 일은 전부 이 훅이 한다 — 삽입 화면도 같은 훅을 쓴다
  const race = useLocalRace();
  const { phase, result, error, interpolator } = race;

  const updatePrefs = useCallback((p: ViewPrefs) => {
    setPrefs(p);
    setViewPrefs(p);
  }, []);

  const participants = useMemo(
    () =>
      buildLocalParticipants(namesText.split(/[\n,\t]+/), {
        previousWinnerIds: race.previousWinnerIds,
        excludePreviousWinners: config.excludePreviousWinners,
      }),
    [namesText, race.previousWinnerIds, config.excludePreviousWinners],
  );

  const racers = participants.filter((p) => !p.excluded);

  const start = useCallback(() => {
    race.start({ config, racers });
  }, [race, config, racers]);

  useRoundSound({ muted: prefs.muted, countdownLeft: 0, result });

  const map = getMap(race.snapshot?.mapId ?? config.mapId) ?? requireMap('classic-wheel');

  return (
    <div className="page page--app">
      <div className="row">
        <h1 style={{ margin: 0 }}>로컬 빠른 뽑기</h1>
        <span className="badge">이 기기에서만 · 서버 없음</span>
        <span className="grow" />
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => navigate('/')}>
          첫 화면
        </button>
      </div>

      {error ? (
        <div className="notice notice--bad" role="alert">
          <span className="notice__icon" aria-hidden="true">✕</span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="teacher-layout">
        <main className="stack" style={{ minHeight: 0 }}>
          {phase !== 'setup' && race.snapshot ? (
            <RaceView
              map={map}
              racers={race.snapshot.racers}
              interpolator={interpolator}
              meIndex={null}
              prefs={prefs}
              onPrefsChange={updatePrefs}
              hud={
                <div className="hud-card">
                  <strong>{describeRule(race.snapshot.rule)}</strong>
                  <div className="faint">
                    {map.name} · {race.snapshot.racers.length}명
                  </div>
                </div>
              }
            />
          ) : (
            <section className="card stack">
              <h2>명단</h2>
              <textarea
                className="textarea"
                style={{ minHeight: 240 }}
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
                aria-label="참가자 명단"
                placeholder={'한 줄에 한 명씩\n김하늘\n박서준'}
              />
              <div className="row">
                <span className="badge">{participants.length}명 입력</span>
                <span className="badge">{racers.length}명 참가</span>
              </div>
            </section>
          )}

          {phase !== 'setup' && race.snapshot ? (
            <section className="card card--tight">
              <Leaderboard
                racers={race.snapshot.racers}
                ranking={interpolator.sample().ranking}
                finished={interpolator.finished}
                meIndex={null}
                limit={12}
              />
            </section>
          ) : null}

          {result ? (
            <section className="card">
              <ResultPanel
                result={result}
                onRematch={() => start()}
                onNextRound={() => race.reset()}
              />
            </section>
          ) : null}
        </main>

        <aside className="teacher-side">
          <section className="card stack">
            <h2>설정</h2>
            <MapPicker
              value={config.mapId}
              onChange={(mapId) => setConfig({ ...config, mapId })}
              disabled={phase === 'racing'}
            />
            <RuleEditor
              rule={config.rule}
              onChange={(rule) => setConfig({ ...config, rule })}
              awards={config.awards}
              onAwardsChange={(awards) => setConfig({ ...config, awards })}
              allowDuplicateAwards={config.allowDuplicateAwards}
              onAllowDuplicateChange={(v) => setConfig({ ...config, allowDuplicateAwards: v })}
              racers={racers}
              disabled={phase === 'racing'}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.excludePreviousWinners}
                disabled={phase === 'racing'}
                onChange={(e) => setConfig({ ...config, excludePreviousWinners: e.target.checked })}
              />
              <span>지난 라운드 당첨자는 이번에 빼기</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.useSkills}
                disabled={phase === 'racing'}
                onChange={(e) => setConfig({ ...config, useSkills: e.target.checked })}
              />
              <span>자동 충격 스킬 켜기</span>
            </label>
            <button
              type="button"
              className="btn btn--primary btn--big"
              onClick={start}
              disabled={phase === 'racing' || racers.length === 0}
            >
              {phase === 'racing' ? '경기 중…' : '경기 시작'}
            </button>
            {race.previousWinnerIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => race.clearPreviousWinners()}
                disabled={phase === 'racing'}
              >
                제외 초기화
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
