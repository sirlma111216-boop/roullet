/**
 * 화면 없이 경기를 끝까지 돌린다.
 *
 * 벽 이탈·영구 정체·결승 중복·무한 포털을 찾는 자동 검사와,
 * 완주 시간을 재는 측정에 쓴다.
 */

import { Rng } from '../math/rng.ts';
import { requireMap } from '../maps/index.ts';
import { FIXED_DT, RaceEngine, type RaceStatus } from '../race/engine.ts';

export interface SimOptions {
  mapId: string;
  racers: number;
  seed: string;
  useSkills?: boolean;
  /** 규칙이 요구하는 도착 수. 기본은 전원(가장 혹독한 조건). */
  requiredFinishCount?: number;
  /** 이 시간을 넘으면 멈춘다. 기본은 맵의 제한시간. */
  timeLimitSec?: number;
}

export interface SimResult {
  mapId: string;
  racers: number;
  seed: string;
  status: RaceStatus;
  /** 경기 안에서 흐른 시간(초) */
  durationSec: number;
  finishedCount: number;
  /** 도착 순서대로의 통과 시각(초) */
  finishTimes: number[];
  /** 정체 탈출 보조가 적용된 횟수 */
  assistCount: number;
  /** 맵 밖으로 새어 나간 횟수. 0 이어야 한다. */
  escapeCount: number;
  /** 한 구슬이 포털을 탄 최대 횟수 */
  maxTeleports: number;
  /** 실제로 계산하는 데 걸린 시간(ms) — 성능 측정용 */
  wallMs: number;
  /** 물리 스텝 수 */
  steps: number;
  /** 끝나지 못한 구슬의 번호 */
  unfinished: number[];
}

/** 시드에서 타이브레이커 순서를 만든다(서버가 하는 일과 같은 방식) */
export function makeTiebreakOrder(seed: string, racers: number): number[] {
  const rng = new Rng(`${seed}:tiebreak`);
  return rng.shuffled(Array.from({ length: racers }, (_, i) => i));
}

export function simulate(opts: SimOptions): SimResult {
  const map = requireMap(opts.mapId);
  const racers = opts.racers;
  const engine = new RaceEngine({
    map,
    racerCount: racers,
    seed: opts.seed,
    useSkills: opts.useSkills ?? false,
    requiredFinishCount: opts.requiredFinishCount ?? racers,
    timeLimitSec: opts.timeLimitSec,
    tiebreakOrder: makeTiebreakOrder(opts.seed, racers),
  });

  engine.start();
  const t0 = performance.now();
  let steps = 0;
  while (engine.status === 'running') {
    engine.step();
    steps++;
  }
  const wallMs = performance.now() - t0;

  let maxTeleports = 0;
  const unfinished: number[] = [];
  for (const m of engine.marbles) {
    if (m.teleports > maxTeleports) maxTeleports = m.teleports;
    if (!m.finished) unfinished.push(m.index);
  }

  return {
    mapId: opts.mapId,
    racers,
    seed: opts.seed,
    status: engine.status,
    durationSec: steps * FIXED_DT,
    finishedCount: engine.finishedCount,
    finishTimes: engine.finishOrder.map((f) => Math.round(f.timeMs) / 1000),
    assistCount: engine.assistCount,
    escapeCount: engine.escapeCount,
    maxTeleports,
    wallMs: Math.round(wallMs),
    steps,
    unfinished,
  };
}

/** 결승 순위가 규칙에 맞게 나왔는지 본다(중복·빠짐 검사) */
export function checkFinishIntegrity(result: SimResult): string[] {
  const problems: string[] = [];
  if (result.escapeCount > 0) {
    problems.push(`구슬이 맵 밖으로 ${result.escapeCount}번 새어 나갔습니다.`);
  }
  if (result.status === 'timeout') {
    problems.push(
      `제한시간 안에 끝나지 못했습니다 (도착 ${result.finishedCount}/${result.racers}, ${result.durationSec.toFixed(1)}초).`,
    );
  }
  // 통과 시각은 순위와 같은 방향으로 늘어나야 한다
  for (let i = 1; i < result.finishTimes.length; i++) {
    if (result.finishTimes[i]! < result.finishTimes[i - 1]!) {
      problems.push(`${i + 1}위의 통과 시각이 ${i}위보다 빠릅니다.`);
      break;
    }
  }
  return problems;
}
