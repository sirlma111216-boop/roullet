/**
 * 로컬 빠른 뽑기.
 *
 * 서버도 학생 접속도 없이, 교사가 명단을 넣고 이 기기에서만 경기한다.
 * 학교 와이파이가 막혀도 되고, 인원이 적어 굳이 방을 열 필요가 없을 때 쓴다.
 *
 * 물리·규칙·결과 계산은 실시간 모드와 **같은 코드**(game-core)를 쓴다.
 * 다른 점은 서버가 없다는 것뿐이라, 결과 형식도 그대로다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultRoundConfig,
  parseWinnerRule,
  validateRuleAgainstRacers,
  type Participant,
  type RacerSnapshot,
  type RoundConfig,
  type RoundResult,
  type RuleSnapshot,
} from '@marble/protocol';
import { cleanNickname } from '@marble/protocol';
import { getMap, makeTiebreakOrder, requireMap } from '@marble/game-core';
import { describeRule, requiredFinishCount, selectWinners } from '@marble/game-core/rules';
import { MapPicker } from '../components/MapPicker.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { ResultPanel } from '../components/ResultPanel.tsx';
import { RaceView } from '../components/RaceView.tsx';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { FrameInterpolator } from '../race/interpolator.ts';
import type { WorkerIn, WorkerOut } from '../race/physics.worker.ts';
import { navigate } from '../router.ts';
import { getViewPrefs, setViewPrefs, type ViewPrefs } from '../util/storage.ts';

const SAMPLE = ['김하늘', '박서준', '이도윤', '최지우', '정민서', '강예린', '조하준', '윤서아'];

export function Local(): React.ReactElement {
  const [namesText, setNamesText] = useState(SAMPLE.join('\n'));
  const [config, setConfig] = useState<RoundConfig>(() => defaultRoundConfig('classic-wheel'));
  const [prefs, setPrefs] = useState<ViewPrefs>(() => getViewPrefs());
  const [phase, setPhase] = useState<'setup' | 'racing' | 'done'>('setup');
  const [result, setResult] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [previousWinnerIds, setPreviousWinnerIds] = useState<string[]>([]);

  const interpolator = useMemo(() => new FrameInterpolator(), []);
  const workerRef = useRef<Worker | null>(null);
  const snapshotRef = useRef<RuleSnapshot | null>(null);
  const finishesRef = useRef<Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }>>([]);
  const seqRef = useRef(0);
  const [, tick] = useState(0);

  const updatePrefs = useCallback((p: ViewPrefs) => {
    setPrefs(p);
    setViewPrefs(p);
  }, []);

  /** 명단 글을 참가자로 바꾼다. 서버가 하던 일(다듬기·중복 번호·색)을 여기서 한다. */
  const participants: Participant[] = useMemo(() => {
    const raw = namesText
      .split(/[\n,\t]+/)
      .map((s) => cleanNickname(s))
      .filter(Boolean);

    const counts = new Map<string, number>();
    for (const n of raw) counts.set(n, (counts.get(n) ?? 0) + 1);
    const seen = new Map<string, number>();

    return raw.map((nickname, i) => {
      let dupIndex = 0;
      if ((counts.get(nickname) ?? 0) > 1) {
        dupIndex = (seen.get(nickname) ?? 0) + 1;
        seen.set(nickname, dupIndex);
      }
      return {
        id: `local-${i}`,
        nickname,
        dupIndex,
        hue: Math.round(((i * 360) / Math.max(1, raw.length) + (i % 2) * 180) % 360),
        source: 'teacher' as const,
        online: true,
        excluded: previousWinnerIds.includes(`local-${i}`) && config.excludePreviousWinners,
        joinedAt: i,
      };
    });
  }, [namesText, previousWinnerIds, config.excludePreviousWinners]);

  const racers = participants.filter((p) => !p.excluded);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const finalize = useCallback(
    (reason: 'completed' | 'timeout', assistCount: number) => {
      const snap = snapshotRef.current;
      if (!snap) return;
      const byIndex = snap.racers;
      const finishOrder = finishesRef.current
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((e) => {
          const r = byIndex[e.racerIndex]!;
          return {
            rank: e.rank,
            participantId: r.participantId,
            nickname: r.nickname,
            dupIndex: r.dupIndex,
            timeMs: e.timeMs,
            tiebroken: e.tiebroken,
          };
        });

      // 제한시간으로 끊겼으면 당첨자를 만들어 내지 않는다 — 실시간 모드와 같은 규칙이다
      const winners =
        reason === 'completed'
          ? selectWinners({
              rule: snap.rule,
              awards: snap.awards,
              allowDuplicateAwards: snap.allowDuplicateAwards,
              finishOrder,
              racers: snap.racers,
            })
          : [];

      const r: RoundResult = {
        eventId: `local-${Date.now()}`,
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
        assistCount,
      };
      setResult(r);
      setPreviousWinnerIds(winners.map((w) => w.participantId));
      setPhase('done');
    },
    [],
  );

  const start = useCallback(() => {
    setError(null);
    const parsed = parseWinnerRule(config.rule);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const check = validateRuleAgainstRacers(
      parsed.value,
      racers.map((r) => r.id),
    );
    if (!check.ok) {
      setError(check.message);
      return;
    }

    const map = requireMap(config.mapId);
    const seed = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const racerSnaps: RacerSnapshot[] = racers.map((p) => ({
      participantId: p.id,
      nickname: p.nickname,
      dupIndex: p.dupIndex,
      hue: p.hue,
    }));

    const snapshot: RuleSnapshot = {
      roundId: `local-round-${roundNumber + 1}`,
      roundNumber: roundNumber + 1,
      mapId: map.id,
      mapVersion: map.version,
      rule: parsed.value,
      awards: config.awards,
      allowDuplicateAwards: config.allowDuplicateAwards,
      useSkills: config.useSkills,
      selectionMode: parsed.value.kind === 'manual' ? 'manual' : 'physics',
      seed,
      tiebreakOrder: makeTiebreakOrder(seed, racerSnaps.length).map((i) => racerSnaps[i]!.participantId),
      timeLimitSec: map.timeLimitSec,
      createdAt: Date.now(),
      participantSnapshotVersion: 1,
      racers: racerSnaps,
    };

    snapshotRef.current = snapshot;
    finishesRef.current = [];
    seqRef.current = 0;
    interpolator.reset();
    setResult(null);
    setRoundNumber((n) => n + 1);

    // 교사 지정은 경기를 돌리지 않는다
    if (snapshot.selectionMode === 'manual') {
      finalize('completed', 0);
      return;
    }

    setPhase('racing');

    workerRef.current?.terminate();
    const w = new Worker(new URL('../race/physics.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const msg = ev.data;
      if (msg.type === 'frame') {
        seqRef.current += 1;
        interpolator.push({ ...msg.frame, roundId: snapshot.roundId, epoch: 0, seq: seqRef.current });
        tick((n) => n + 1);
      } else if (msg.type === 'finish') {
        finishesRef.current.push(...msg.entries);
      } else if (msg.type === 'done') {
        finalize(msg.reason, msg.assistCount);
        w.terminate();
        workerRef.current = null;
      } else if (msg.type === 'error') {
        setError(msg.message);
        setPhase('setup');
      }
    };

    const start: WorkerIn = {
      type: 'start',
      mapId: map.id,
      racerCount: racerSnaps.length,
      seed,
      useSkills: config.useSkills,
      requiredFinishCount: requiredFinishCount(parsed.value, racerSnaps.length),
      timeLimitSec: map.timeLimitSec,
      tiebreakOrder: makeTiebreakOrder(seed, racerSnaps.length),
      startAt: performance.now() + 600,
    };
    w.postMessage(start);
  }, [config, racers, roundNumber, interpolator, finalize]);

  const map = getMap(snapshotRef.current?.mapId ?? config.mapId) ?? requireMap('classic-wheel');

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
          {phase !== 'setup' && snapshotRef.current ? (
            <RaceView
              map={map}
              racers={snapshotRef.current.racers}
              interpolator={interpolator}
              meIndex={null}
              prefs={prefs}
              onPrefsChange={updatePrefs}
              hud={
                <div className="hud-card">
                  <strong>{describeRule(snapshotRef.current.rule)}</strong>
                  <div className="faint">
                    {map.name} · {snapshotRef.current.racers.length}명
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

          {phase !== 'setup' && snapshotRef.current ? (
            <section className="card card--tight">
              <Leaderboard
                racers={snapshotRef.current.racers}
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
                onNextRound={() => {
                  setPhase('setup');
                  setResult(null);
                }}
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
            {previousWinnerIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPreviousWinnerIds([])}
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
