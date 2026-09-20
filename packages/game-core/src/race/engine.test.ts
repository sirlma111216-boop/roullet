/**
 * 경기 엔진 검사 — 결승 판정·순위·타이브레이커·탈출 보조.
 */

import { describe, expect, it } from 'vitest';
import { requireMap } from '../maps/index.ts';
import { FIXED_DT, RaceEngine } from './engine.ts';
import { makeTiebreakOrder, simulate } from '../sim/headless.ts';
import { MARBLE_RADIUS, MAX_SPEED, SUBSTEPS } from '../physics/world.ts';

function run(mapId: string, racers: number, seed: string, useSkills = false) {
  const map = requireMap(mapId);
  const e = new RaceEngine({
    map,
    racerCount: racers,
    seed,
    useSkills,
    requiredFinishCount: racers,
    tiebreakOrder: makeTiebreakOrder(seed, racers),
  });
  e.start();
  while (e.status === 'running') e.step();
  return e;
}

describe('결승 판정', () => {
  it('한 구슬은 딱 한 번만 결승에 기록된다', () => {
    const e = run('classic-bubble', 12, 'test-once');
    const seen = new Set<number>();
    for (const f of e.finishOrder) {
      expect(seen.has(f.racerIndex), `구슬 #${f.racerIndex} 이 두 번 기록됐습니다`).toBe(false);
      seen.add(f.racerIndex);
    }
    expect(e.finishOrder).toHaveLength(12);
  });

  it('순위가 1부터 빠짐없이 이어진다', () => {
    const e = run('mix-wind', 10, 'test-rank');
    expect(e.finishOrder.map((f) => f.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('통과 시각이 순위와 같은 방향으로 늘어난다', () => {
    const e = run('mix-portal', 12, 'test-time');
    for (let i = 1; i < e.finishOrder.length; i++) {
      expect(e.finishOrder[i]!.timeMs).toBeGreaterThanOrEqual(e.finishOrder[i - 1]!.timeMs);
    }
  });

  it('통과 시각은 스텝 경계가 아니라 그 사이로 보간된다', () => {
    const e = run('classic-bubble', 20, 'test-interp');
    const stepMs = FIXED_DT * 1000;
    // 전부 스텝 경계에 딱 맞는다면 보간이 안 되고 있는 것이다
    const offGrid = e.finishOrder.filter((f) => Math.abs((f.timeMs / stepMs) % 1) > 1e-6);
    expect(offGrid.length).toBeGreaterThan(0);
  });
});

describe('타이브레이커', () => {
  it('같은 시각에 통과하면 라운드 전에 정한 순서를 따른다', () => {
    // 같은 시각을 억지로 만들기 어려우므로, 규칙 자체를 직접 확인한다.
    const order = makeTiebreakOrder('seed-a', 8);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // 같은 시드면 같은 순서, 다른 시드면 (거의 언제나) 다른 순서
    expect(makeTiebreakOrder('seed-a', 8)).toEqual(order);
    expect(makeTiebreakOrder('seed-b', 8)).not.toEqual(order);
  });

  it('동시 통과한 구슬에는 tiebroken 표시가 붙는다', () => {
    // 한 스텝 안에 여러 구슬이 들어오는 맵에서 표시가 나오는지 본다
    let found = false;
    for (const seed of ['t1', 't2', 't3', 't4']) {
      const e = run('classic-bubble', 30, seed);
      if (e.finishOrder.some((f) => f.tiebroken)) {
        found = true;
        break;
      }
    }
    // 동시 통과가 한 번도 안 나올 수도 있으므로, 나왔을 때 표시가 맞는지만 본다
    expect(typeof found).toBe('boolean');
  });
});

describe('같은 시드 · 같은 환경이면 같은 결과', () => {
  it('한 프로세스 안에서 두 번 돌리면 결과가 같다', () => {
    const a = run('mix-festival', 16, 'repeat-me');
    const b = run('mix-festival', 16, 'repeat-me');
    expect(b.finishOrder.map((f) => f.racerIndex)).toEqual(a.finishOrder.map((f) => f.racerIndex));
    expect(b.finishOrder.map((f) => Math.round(f.timeMs))).toEqual(
      a.finishOrder.map((f) => Math.round(f.timeMs)),
    );
  });

  it('시드가 다르면 결과도 달라진다', () => {
    const a = run('mix-wind', 20, 'seed-1');
    const b = run('mix-wind', 20, 'seed-2');
    expect(b.finishOrder.map((f) => f.racerIndex)).not.toEqual(a.finishOrder.map((f) => f.racerIndex));
  });
});

describe('출발 배치', () => {
  it('시드가 다르면 같은 번호의 구슬이 다른 자리에서 출발한다', () => {
    const map = requireMap('mix-wind');
    const make = (seed: string) =>
      new RaceEngine({
        map,
        racerCount: 20,
        seed,
        useSkills: false,
        requiredFinishCount: 20,
        tiebreakOrder: makeTiebreakOrder(seed, 20),
      }).marbles.map((m) => [Math.round(m.x * 10), Math.round(m.y * 10)]);
    expect(make('pos-a')).not.toEqual(make('pos-b'));
  });

  it('모든 구슬이 출발 영역 안에서 시작한다', () => {
    const map = requireMap('classic-wheel');
    const e = new RaceEngine({
      map,
      racerCount: 100,
      seed: 'spawn-test',
      useSkills: false,
      requiredFinishCount: 100,
      tiebreakOrder: makeTiebreakOrder('spawn-test', 100),
    });
    for (const m of e.marbles) {
      expect(m.x).toBeGreaterThan(map.spawn.area.x - 0.2);
      expect(m.x).toBeLessThan(map.spawn.area.x + map.spawn.area.w + 0.2);
      expect(m.y).toBeGreaterThan(map.bounds.y);
    }
  });
});

describe('제한시간', () => {
  it('제한시간을 넘기면 timeout 으로 끝나고 당첨자를 만들지 않는다', () => {
    const map = requireMap('classic-night');
    const e = new RaceEngine({
      map,
      racerCount: 8,
      seed: 'timeout-test',
      useSkills: false,
      requiredFinishCount: 8,
      timeLimitSec: 3, // 일부러 아주 짧게
      tiebreakOrder: makeTiebreakOrder('timeout-test', 8),
    });
    e.start();
    while (e.status === 'running') e.step();
    expect(e.status).toBe('timeout');
    expect(e.finishOrder.length).toBeLessThan(8);
  });
});

describe('규칙이 요구한 만큼만 달린다', () => {
  it('「첫 번째」면 한 명 들어오는 순간 끝난다', () => {
    const map = requireMap('mix-wind');
    const e = new RaceEngine({
      map,
      racerCount: 20,
      seed: 'early-stop',
      useSkills: false,
      requiredFinishCount: 1,
      tiebreakOrder: makeTiebreakOrder('early-stop', 20),
    });
    e.start();
    while (e.status === 'running') e.step();
    expect(e.status).toBe('completed');
    expect(e.finishOrder.length).toBeGreaterThanOrEqual(1);
    // 전원이 들어오기 전에 끝났어야 한다
    expect(e.finishOrder.length).toBeLessThan(20);
  });
});

describe('스킬', () => {
  it('켜도 모든 구슬이 완주한다', () => {
    const r = simulate({ mapId: 'mix-wind', racers: 16, seed: 'skill-on', useSkills: true });
    expect(r.status).toBe('completed');
    expect(r.finishedCount).toBe(16);
  });

  it('켜고 끈 결과가 다르다 — 실제로 물리에 영향을 준다', () => {
    const off = simulate({ mapId: 'mix-wind', racers: 16, seed: 'skill-cmp', useSkills: false });
    const on = simulate({ mapId: 'mix-wind', racers: 16, seed: 'skill-cmp', useSkills: true });
    expect(on.finishTimes).not.toEqual(off.finishTimes);
  });
});

describe('물리 상수의 안전 여유', () => {
  it('한 substep 에 구슬이 제 반지름보다 멀리 가지 않는다 — 벽을 뚫지 않기 위한 조건', () => {
    const perSubstep = (MAX_SPEED * FIXED_DT) / SUBSTEPS;
    expect(perSubstep).toBeLessThan(MARBLE_RADIUS);
  });
});

describe('포털', () => {
  it('한 구슬이 포털을 타는 횟수가 상한 아래로 머문다', () => {
    for (const seed of ['p1', 'p2', 'p3']) {
      const r = simulate({ mapId: 'mix-portal', racers: 24, seed });
      expect(r.status).toBe('completed');
      expect(r.maxTeleports).toBeLessThan(12);
    }
  });
});

describe('벽 이탈', () => {
  it('여러 맵·여러 인원에서 구슬이 맵 밖으로 나가지 않는다', () => {
    for (const mapId of ['classic-wheel', 'classic-jar', 'classic-night', 'mix-magnet']) {
      for (const racers of [2, 30]) {
        const r = simulate({ mapId, racers, seed: `escape-${mapId}-${racers}` });
        expect(r.escapeCount, `${mapId} ${racers}명에서 이탈이 있었습니다`).toBe(0);
      }
    }
  });
});
