/**
 * 당첨 규칙 → 당첨자.
 *
 * 물리 경기가 만든 «도착 순서» 는 건드리지 않는다. 여기서는 그 순서에서
 * 규칙이 가리키는 자리를 골라 낼 뿐이다. 교사 지정(manual)은 경기 순위를
 * 위조하지 않고 아예 다른 길로 간다.
 */

import type { Award, FinishEntry, RacerSnapshot, WinnerEntry, WinnerRule } from '@marble/protocol';

/** 규칙을 만족시키려면 몇 명이 도착해야 하는가 */
export function requiredFinishCount(rule: WinnerRule, racerCount: number): number {
  switch (rule.kind) {
    case 'first':
      return 1;
    case 'nth':
      return Math.min(rule.n, racerCount);
    case 'topK':
      return Math.min(rule.k, racerCount);
    case 'range':
      return Math.min(rule.to, racerCount);
    case 'ranks':
      return Math.min(Math.max(...rule.ranks), racerCount);
    // 뒤에서 세는 규칙은 전원이 들어와야 순위가 확정된다
    case 'last':
    case 'bottomK':
      return racerCount;
    case 'manual':
      return 0;
  }
}

/** 규칙이 가리키는 순위 목록(1부터). 도착 인원이 정해져야 계산된다. */
export function targetRanks(rule: WinnerRule, finishedCount: number): number[] {
  switch (rule.kind) {
    case 'first':
      return finishedCount >= 1 ? [1] : [];
    case 'last':
      return finishedCount >= 1 ? [finishedCount] : [];
    case 'nth':
      return rule.n <= finishedCount ? [rule.n] : [];
    case 'topK':
      return Array.from({ length: Math.min(rule.k, finishedCount) }, (_, i) => i + 1);
    case 'bottomK': {
      const k = Math.min(rule.k, finishedCount);
      return Array.from({ length: k }, (_, i) => finishedCount - k + i + 1);
    }
    case 'range': {
      const out: number[] = [];
      for (let r = rule.from; r <= Math.min(rule.to, finishedCount); r++) out.push(r);
      return out;
    }
    case 'ranks':
      return rule.ranks.filter((r) => r <= finishedCount);
    case 'manual':
      return [];
  }
}

function reasonFor(rule: WinnerRule, rank: number, finishedCount: number): string {
  switch (rule.kind) {
    case 'first':
      return '첫 번째로 도착';
    case 'last':
      return `마지막(${rank}번째)으로 도착`;
    case 'nth':
      return `${rule.n}번째로 도착`;
    case 'topK':
      return `상위 ${rule.k}명 중 ${rank}위`;
    case 'bottomK':
      return `하위 ${rule.k}명 중 ${rank}위 (전체 ${finishedCount}명)`;
    case 'range':
      return `${rule.from}위~${rule.to}위 범위의 ${rank}위`;
    case 'ranks':
      return `지정한 순위(${rule.ranks.join('·')}위) 중 ${rank}위`;
    case 'manual':
      return '교사가 직접 지정';
  }
}

export interface SelectInput {
  rule: WinnerRule;
  awards: readonly Award[];
  allowDuplicateAwards: boolean;
  finishOrder: readonly FinishEntry[];
  racers: readonly RacerSnapshot[];
}

/**
 * 당첨자를 고른다.
 *
 * 규칙이 요구한 순위 중 **실제로 도착하지 않은 자리는 만들어 내지 않는다.**
 * 제한시간으로 끊긴 라운드에서 빈자리를 채우지 않는 것이 여기서 지켜진다.
 */
export function selectWinners(input: SelectInput): WinnerEntry[] {
  const { rule, awards, allowDuplicateAwards, finishOrder, racers } = input;

  if (rule.kind === 'manual') {
    const byId = new Map(racers.map((r) => [r.participantId, r]));
    const out: WinnerEntry[] = [];
    rule.participantIds.forEach((pid, slot) => {
      const racer = byId.get(pid);
      if (!racer) return;
      out.push({
        slot,
        rank: null,
        participantId: pid,
        nickname: racer.nickname,
        dupIndex: racer.dupIndex,
        award: awards.find((a) => a.slot === slot) ?? null,
        selectionReason: '교사가 직접 지정 (무작위 추첨이 아닙니다)',
      });
    });
    return dedupeAwards(out, allowDuplicateAwards);
  }

  const byRank = new Map(finishOrder.map((f) => [f.rank, f]));
  const ranks = targetRanks(rule, finishOrder.length);
  const out: WinnerEntry[] = [];
  ranks.forEach((rank, slot) => {
    const f = byRank.get(rank);
    if (!f) return;
    out.push({
      slot,
      rank,
      participantId: f.participantId,
      nickname: f.nickname,
      dupIndex: f.dupIndex,
      award: awards.find((a) => a.slot === slot) ?? null,
      selectionReason: reasonFor(rule, rank, finishOrder.length) + (f.tiebroken ? ' · 동시 통과라 타이브레이커로 갈림' : ''),
    });
  });
  return dedupeAwards(out, allowDuplicateAwards);
}

/** 한 학생이 항목을 두 개 이상 받지 않게 한다(기본값) */
function dedupeAwards(winners: WinnerEntry[], allowDuplicate: boolean): WinnerEntry[] {
  if (allowDuplicate) return winners;
  const given = new Set<string>();
  return winners.map((w) => {
    if (!w.award) return w;
    if (given.has(w.participantId)) {
      return {
        ...w,
        award: null,
        selectionReason: `${w.selectionReason} · 이미 다른 항목을 받아 이 항목은 건너뜀`,
      };
    }
    given.add(w.participantId);
    return w;
  });
}

/** 화면에 적는 규칙 설명 */
export function describeRule(rule: WinnerRule): string {
  switch (rule.kind) {
    case 'first':
      return '첫 번째로 도착한 사람';
    case 'last':
      return '마지막으로 도착한 사람';
    case 'nth':
      return `${rule.n}번째로 도착한 사람`;
    case 'topK':
      return `먼저 도착한 ${rule.k}명`;
    case 'bottomK':
      return `늦게 도착한 ${rule.k}명`;
    case 'range':
      return `${rule.from}위부터 ${rule.to}위까지`;
    case 'ranks':
      return `${rule.ranks.join('·')}위`;
    case 'manual':
      return `교사 지정 (${rule.participantIds.length}명)`;
  }
}
