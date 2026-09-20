/**
 * 서버 없이 이 브라우저에서만 도는 한 판.
 *
 * 「로컬 빠른 뽑기」 화면과 「서버 없는 삽입 모드」가 **둘 다 이것을 쓴다**.
 * 갈라 두면 규칙·마무리 처리를 한쪽에서만 고쳐 두 화면이 서로 다른 답을 낸다 —
 * 실제로 이 저장소에서 여러 번 겪은 종류의 어긋남이다.
 *
 * 실시간 모드와 일부러 똑같이 맞춘 것:
 *  - 제한 시간으로 끊긴 판은 **당첨자를 만들어 내지 않는다**.
 *  - 교사 지정(manual)은 경기를 돌리지 않고 바로 마무리한다.
 *  - 동점은 시드로 만든 tiebreakOrder 로만 가른다.
 *
 * 다른 것 하나: 여기서 나온 결과는 **이 브라우저가 계산한 값**이다.
 * 서버가 확인해 준 것이 아니므로, 부모 앱에 돌려줄 때 그렇다고 적어 보낸다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cleanNickname,
  parseWinnerRule,
  validateRuleAgainstRacers,
  type Participant,
  type RacerSnapshot,
  type RoundConfig,
  type RoundResult,
  type RuleSnapshot,
} from '@marble/protocol';
import { makeTiebreakOrder, requireMap } from '@marble/game-core';
import { requiredFinishCount, selectWinners } from '@marble/game-core/rules';
import { FrameInterpolator } from './interpolator.ts';
import type { WorkerIn, WorkerOut } from './physics.worker.ts';

/** 시작 신호를 주고 실제로 구슬이 떨어지기까지 — 화면이 자리를 잡을 틈 */
export const LOCAL_START_DELAY_MS = 600;

export type LocalPhase = 'setup' | 'racing' | 'done';

export interface LocalStartInput {
  config: RoundConfig;
  /** 이미 제외된 사람은 빼고 넘긴다 */
  racers: Participant[];
  /** 없으면 기본값. 부모 앱이 카운트다운을 길게 주고 싶을 때 쓴다. */
  startDelayMs?: number;
}

export type LocalStartResult =
  | { ok: true; roundId: string }
  | { ok: false; code: string; message: string };

export interface LocalRace {
  phase: LocalPhase;
  result: RoundResult | null;
  error: string | null;
  /** 지금 돌고 있는(또는 방금 끝난) 판의 확정된 내용 */
  snapshot: RuleSnapshot | null;
  interpolator: FrameInterpolator;
  roundNumber: number;
  /** 바로 앞 판의 당첨자 — 「연속 당첨 제외」에 쓴다 */
  previousWinnerIds: string[];
  start: (input: LocalStartInput) => LocalStartResult;
  /** 결과를 치우고 다음 판 준비 상태로 */
  reset: () => void;
  /** 연속 당첨 제외 목록을 비운다 */
  clearPreviousWinners: () => void;
}

export interface LocalRaceEvents {
  onStarted?: (snapshot: RuleSnapshot, startDelayMs: number) => void;
  onFinished?: (result: RoundResult) => void;
  onError?: (message: string) => void;
}

/**
 * 이름 목록을 참가자로 바꾼다. 실시간 모드에서 **서버가 하던 일**을 여기서 한다
 * (다듬기·같은 이름 번호 붙이기·색 고르기·연속 당첨 제외).
 */
export function buildLocalParticipants(
  names: readonly string[],
  opts: { previousWinnerIds?: readonly string[]; excludePreviousWinners?: boolean; ids?: readonly string[] } = {},
): Participant[] {
  const cleaned: Array<{ nickname: string; id: string }> = [];
  for (let i = 0; i < names.length; i++) {
    const nickname = cleanNickname(names[i] ?? '');
    if (!nickname) continue;
    cleaned.push({ nickname, id: opts.ids?.[i] ?? `local-${i}` });
  }

  const counts = new Map<string, number>();
  for (const n of cleaned) counts.set(n.nickname, (counts.get(n.nickname) ?? 0) + 1);
  const seen = new Map<string, number>();
  const prev = opts.previousWinnerIds ?? [];

  return cleaned.map((entry, i) => {
    let dupIndex = 0;
    if ((counts.get(entry.nickname) ?? 0) > 1) {
      dupIndex = (seen.get(entry.nickname) ?? 0) + 1;
      seen.set(entry.nickname, dupIndex);
    }
    return {
      id: entry.id,
      nickname: entry.nickname,
      dupIndex,
      hue: Math.round(((i * 360) / Math.max(1, cleaned.length) + (i % 2) * 180) % 360),
      source: 'teacher' as const,
      online: true,
      excluded: Boolean(opts.excludePreviousWinners) && prev.includes(entry.id),
      joinedAt: i,
    };
  });
}

export function useLocalRace(events: LocalRaceEvents = {}): LocalRace {
  const [phase, setPhase] = useState<LocalPhase>('setup');
  const [result, setResult] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [previousWinnerIds, setPreviousWinnerIds] = useState<string[]>([]);
  /** 프레임이 올 때마다 다시 그리게 하는 값. 화면에 직접 쓰이지는 않는다. */
  const [, tick] = useState(0);

  const interpolator = useMemo(() => new FrameInterpolator(), []);
  const workerRef = useRef<Worker | null>(null);
  const snapshotRef = useRef<RuleSnapshot | null>(null);
  const finishesRef = useRef<Array<{ racerIndex: number; rank: number; timeMs: number; tiebroken: boolean }>>([]);
  const seqRef = useRef(0);

  /** 콜백은 매 렌더 새로 만들어질 수 있다. 워커 쪽에서는 늘 최신 것을 본다. */
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const finalize = useCallback((reason: 'completed' | 'timeout', assistCount: number) => {
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
    eventsRef.current.onFinished?.(r);
  }, []);

  const start = useCallback(
    (input: LocalStartInput): LocalStartResult => {
      setError(null);

      const parsed = parseWinnerRule(input.config.rule);
      if (!parsed.ok) {
        setError(parsed.message);
        return { ok: false, code: 'bad_rule', message: parsed.message };
      }
      const check = validateRuleAgainstRacers(
        parsed.value,
        input.racers.map((r) => r.id),
      );
      if (!check.ok) {
        setError(check.message);
        return { ok: false, code: 'rule_mismatch', message: check.message };
      }
      if (input.racers.length === 0) {
        const message = '경기에 나갈 사람이 없습니다.';
        setError(message);
        return { ok: false, code: 'no_racers', message };
      }

      const map = requireMap(input.config.mapId);
      const seed = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const racerSnaps: RacerSnapshot[] = input.racers.map((p) => ({
        participantId: p.id,
        nickname: p.nickname,
        dupIndex: p.dupIndex,
        hue: p.hue,
      }));

      const next = roundNumber + 1;
      const snapshot: RuleSnapshot = {
        roundId: `local-round-${next}`,
        roundNumber: next,
        mapId: map.id,
        mapVersion: map.version,
        rule: parsed.value,
        awards: input.config.awards,
        allowDuplicateAwards: input.config.allowDuplicateAwards,
        useSkills: input.config.useSkills,
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
      setRoundNumber(next);

      const delay = input.startDelayMs ?? LOCAL_START_DELAY_MS;
      eventsRef.current.onStarted?.(snapshot, delay);

      // 교사 지정은 경기를 돌리지 않는다
      if (snapshot.selectionMode === 'manual') {
        finalize('completed', 0);
        return { ok: true, roundId: snapshot.roundId };
      }

      setPhase('racing');

      workerRef.current?.terminate();
      const w = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
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
          eventsRef.current.onError?.(msg.message);
        }
      };

      const startMsg: WorkerIn = {
        type: 'start',
        mapId: map.id,
        racerCount: racerSnaps.length,
        seed,
        useSkills: input.config.useSkills,
        requiredFinishCount: requiredFinishCount(parsed.value, racerSnaps.length),
        timeLimitSec: map.timeLimitSec,
        tiebreakOrder: makeTiebreakOrder(seed, racerSnaps.length),
        // 절대 시각을 넘기지 않는다 — 워커의 performance.now() 기준점이 다르다
        startDelayMs: delay,
      };
      w.postMessage(startMsg);

      return { ok: true, roundId: snapshot.roundId };
    },
    [finalize, interpolator, roundNumber],
  );

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    snapshotRef.current = null;
    finishesRef.current = [];
    seqRef.current = 0;
    interpolator.reset();
    setResult(null);
    setError(null);
    setPhase('setup');
  }, [interpolator]);

  const clearPreviousWinners = useCallback(() => setPreviousWinnerIds([]), []);

  return {
    phase,
    result,
    error,
    snapshot: snapshotRef.current,
    interpolator,
    roundNumber,
    previousWinnerIds,
    start,
    reset,
    clearPreviousWinners,
  };
}
