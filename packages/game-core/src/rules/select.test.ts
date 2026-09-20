/**
 * 당첨 규칙 검사.
 *
 * 요구사항 3번(첫·마지막·n번째·범위·개별 순위·여러 명·이전 당첨 제외·교사 지정)과
 * 경계(0명·1명·제외 후 부족·잘못된 순위·중복 순위·역전된 범위)를 여기서 지킨다.
 */

import { describe, expect, it } from 'vitest';
import {
  parseWinnerRule,
  validateRuleAgainstRacers,
  winnerSlotCount,
  type Award,
  type FinishEntry,
  type RacerSnapshot,
  type WinnerRule,
} from '@marble/protocol';
import { describeRule, requiredFinishCount, selectWinners, targetRanks } from './select.ts';

function racers(n: number): RacerSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    participantId: `p${i + 1}`,
    nickname: `학생${i + 1}`,
    dupIndex: 0,
    hue: i * 10,
  }));
}

/** 참가자 p1..pn 이 번호 순서대로 도착했다고 본다 */
function finishOrder(n: number): FinishEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    participantId: `p${i + 1}`,
    nickname: `학생${i + 1}`,
    dupIndex: 0,
    timeMs: 1000 * (i + 1),
    tiebroken: false,
  }));
}

const pick = (rule: WinnerRule, n: number, awards: Award[] = []) =>
  selectWinners({ rule, awards, allowDuplicateAwards: false, finishOrder: finishOrder(n), racers: racers(n) });

describe('규칙이 가리키는 순위', () => {
  it('첫 번째', () => expect(targetRanks({ kind: 'first' }, 8)).toEqual([1]));
  it('마지막 — 실제 도착 인원의 끝', () => expect(targetRanks({ kind: 'last' }, 8)).toEqual([8]));
  it('n번째', () => expect(targetRanks({ kind: 'nth', n: 3 }, 8)).toEqual([3]));
  it('상위 k명', () => expect(targetRanks({ kind: 'topK', k: 3 }, 8)).toEqual([1, 2, 3]));
  it('하위 k명', () => expect(targetRanks({ kind: 'bottomK', k: 3 }, 8)).toEqual([6, 7, 8]));
  it('연속 범위', () => expect(targetRanks({ kind: 'range', from: 2, to: 4 }, 8)).toEqual([2, 3, 4]));
  it('개별 순위 목록', () => expect(targetRanks({ kind: 'ranks', ranks: [2, 5, 8] }, 8)).toEqual([2, 5, 8]));
});

describe('당첨자 고르기', () => {
  it('첫 번째 도착자를 뽑는다', () => {
    const w = pick({ kind: 'first' }, 8);
    expect(w).toHaveLength(1);
    expect(w[0]!.participantId).toBe('p1');
    expect(w[0]!.rank).toBe(1);
  });

  it('마지막 도착자를 뽑는다', () => {
    const w = pick({ kind: 'last' }, 8);
    expect(w[0]!.participantId).toBe('p8');
  });

  it('개별 순위 여러 명을 뽑고 순위를 그대로 남긴다', () => {
    const w = pick({ kind: 'ranks', ranks: [2, 5, 8] }, 8);
    expect(w.map((x) => x.participantId)).toEqual(['p2', 'p5', 'p8']);
    expect(w.map((x) => x.rank)).toEqual([2, 5, 8]);
  });

  it('당첨 항목을 순위 슬롯에 붙인다', () => {
    const awards: Award[] = [
      { id: 'a', label: '발표자', slot: 0 },
      { id: 'b', label: '정리 도우미', slot: 1 },
    ];
    const w = pick({ kind: 'topK', k: 3 }, 8, awards);
    expect(w[0]!.award?.label).toBe('발표자');
    expect(w[1]!.award?.label).toBe('정리 도우미');
    expect(w[2]!.award).toBeNull();
  });

  it('한 학생이 항목을 두 개 받지 않는다', () => {
    const awards: Award[] = [
      { id: 'a', label: '발표자', slot: 0 },
      { id: 'b', label: '정리 도우미', slot: 1 },
    ];
    // 같은 사람이 두 슬롯에 오는 상황을 일부러 만든다(교사 지정)
    const rule: WinnerRule = { kind: 'manual', participantIds: ['p1', 'p1'] };
    const w = selectWinners({
      rule,
      awards,
      allowDuplicateAwards: false,
      finishOrder: [],
      racers: racers(4),
    });
    expect(w[0]!.award?.label).toBe('발표자');
    expect(w[1]!.award).toBeNull();
    expect(w[1]!.selectionReason).toContain('건너뜀');
  });

  it('교사 지정은 순위를 만들어 내지 않고, 수동임을 남긴다', () => {
    const w = selectWinners({
      rule: { kind: 'manual', participantIds: ['p3'] },
      awards: [],
      allowDuplicateAwards: false,
      finishOrder: finishOrder(8),
      racers: racers(8),
    });
    expect(w).toHaveLength(1);
    expect(w[0]!.participantId).toBe('p3');
    expect(w[0]!.rank).toBeNull();
    expect(w[0]!.selectionReason).toContain('무작위 추첨이 아닙니다');
  });

  it('도착하지 않은 순위는 빈자리로 남긴다 — 임의로 채우지 않는다', () => {
    // 8명이 뛰었지만 3명만 들어온 상태에서 「상위 5명」
    const w = selectWinners({
      rule: { kind: 'topK', k: 5 },
      awards: [],
      allowDuplicateAwards: false,
      finishOrder: finishOrder(3),
      racers: racers(8),
    });
    expect(w).toHaveLength(3);
    expect(w.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('동시 통과로 갈린 경우를 사유에 적는다', () => {
    const fo = finishOrder(3);
    fo[0] = { ...fo[0]!, tiebroken: true };
    const w = selectWinners({
      rule: { kind: 'first' },
      awards: [],
      allowDuplicateAwards: false,
      finishOrder: fo,
      racers: racers(3),
    });
    expect(w[0]!.selectionReason).toContain('타이브레이커');
  });
});

describe('규칙이 요구하는 도착 인원', () => {
  it('첫 번째는 한 명만 들어오면 끝난다', () => {
    expect(requiredFinishCount({ kind: 'first' }, 30)).toBe(1);
  });
  it('마지막·하위 k명은 전원이 들어와야 한다', () => {
    expect(requiredFinishCount({ kind: 'last' }, 30)).toBe(30);
    expect(requiredFinishCount({ kind: 'bottomK', k: 3 }, 30)).toBe(30);
  });
  it('개별 순위는 가장 늦은 순위까지만', () => {
    expect(requiredFinishCount({ kind: 'ranks', ranks: [2, 5, 8] }, 30)).toBe(8);
  });
  it('교사 지정은 경기 결과를 기다리지 않는다', () => {
    expect(requiredFinishCount({ kind: 'manual', participantIds: ['p1'] }, 30)).toBe(0);
  });
});

describe('규칙 검증 — 잘못된 입력', () => {
  it('역전된 범위를 거절한다', () => {
    const r = parseWinnerRule({ kind: 'range', from: 5, to: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('뒤집혔');
  });

  it('중복된 개별 순위를 거절한다', () => {
    const r = parseWinnerRule({ kind: 'ranks', ranks: [2, 5, 2] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('두 번');
  });

  it('0 이하·소수 순위를 거절한다', () => {
    expect(parseWinnerRule({ kind: 'nth', n: 0 }).ok).toBe(false);
    expect(parseWinnerRule({ kind: 'nth', n: -1 }).ok).toBe(false);
    expect(parseWinnerRule({ kind: 'nth', n: 2.5 }).ok).toBe(false);
  });

  it('모르는 규칙을 거절한다', () => {
    expect(parseWinnerRule({ kind: '아무거나' }).ok).toBe(false);
    expect(parseWinnerRule(null).ok).toBe(false);
  });

  it('참가자 0명이면 어떤 규칙도 시작할 수 없다', () => {
    const r = validateRuleAgainstRacers({ kind: 'first' }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('참가자가 없습니다');
  });

  it('참가자 1명이면 첫 번째·마지막은 되고 3번째는 안 된다', () => {
    expect(validateRuleAgainstRacers({ kind: 'first' }, ['p1']).ok).toBe(true);
    expect(validateRuleAgainstRacers({ kind: 'last' }, ['p1']).ok).toBe(true);
    expect(validateRuleAgainstRacers({ kind: 'nth', n: 3 }, ['p1']).ok).toBe(false);
  });

  it('제외하고 나서 인원이 모자라면 막는다', () => {
    const remaining = ['p1', 'p2'];
    const r = validateRuleAgainstRacers({ kind: 'topK', k: 5 }, remaining);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('2명뿐');
  });

  it('교사 지정에 명단 밖 학생이 있으면 막는다', () => {
    const r = validateRuleAgainstRacers({ kind: 'manual', participantIds: ['없는사람'] }, ['p1', 'p2']);
    expect(r.ok).toBe(false);
  });
});

describe('당첨 자리 수', () => {
  it('규칙별로 몇 자리가 나오는지 센다', () => {
    expect(winnerSlotCount({ kind: 'first' }, 10)).toBe(1);
    expect(winnerSlotCount({ kind: 'topK', k: 3 }, 10)).toBe(3);
    expect(winnerSlotCount({ kind: 'range', from: 2, to: 4 }, 10)).toBe(3);
    expect(winnerSlotCount({ kind: 'ranks', ranks: [2, 5, 8] }, 10)).toBe(3);
    // 인원보다 많이 요구하면 가능한 만큼만
    expect(winnerSlotCount({ kind: 'topK', k: 20 }, 10)).toBe(10);
  });
});

describe('설명 문구', () => {
  it('모든 규칙에 사람이 읽을 설명이 있다', () => {
    const rules: WinnerRule[] = [
      { kind: 'first' },
      { kind: 'last' },
      { kind: 'nth', n: 3 },
      { kind: 'topK', k: 2 },
      { kind: 'bottomK', k: 2 },
      { kind: 'range', from: 1, to: 3 },
      { kind: 'ranks', ranks: [1, 4] },
      { kind: 'manual', participantIds: ['p1'] },
    ];
    for (const r of rules) expect(describeRule(r).length).toBeGreaterThan(2);
  });
});
