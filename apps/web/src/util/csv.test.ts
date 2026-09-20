/**
 * CSV 내보내기 검사.
 *
 * 여기서 막지 못하면, 학생이 지은 닉네임이 교사의 표 계산 프로그램에서 **수식으로 실행**된다.
 */

import { describe, expect, it } from 'vitest';
import type { RoundResult } from '@marble/protocol';
import { csvCell, resultToCsv, resultToText, toCsv } from './csv.ts';

describe('수식 삽입 방지', () => {
  it('수식으로 읽힐 수 있는 첫 글자 앞에 작은따옴표를 붙인다', () => {
    expect(csvCell('=HYPERLINK("http://x","눌러")')).toBe(`"'=HYPERLINK(""http://x"",""눌러"")"`);
    expect(csvCell('+1+1')).toBe(`'+1+1`);
    expect(csvCell('-2+3')).toBe(`'-2+3`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    // 탭은 CSV 에서 따로 감쌀 필요가 없다. 작은따옴표만 붙는다.
    expect(csvCell('\tcmd')).toBe(`'\tcmd`);
    // 캐리지리턴은 칸을 깨뜨리므로 감싼다
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
  });

  it('보통 글자는 그대로 둔다', () => {
    expect(csvCell('김하늘')).toBe('김하늘');
    expect(csvCell(3)).toBe('3');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('쉼표·따옴표·줄바꿈이 있으면 감싸고 따옴표를 겹친다', () => {
    expect(csvCell('가,나')).toBe('"가,나"');
    expect(csvCell('그는 "말"했다')).toBe('"그는 ""말""했다"');
    expect(csvCell('첫줄\n둘째줄')).toBe('"첫줄\n둘째줄"');
  });

  it('표를 CRLF 로 잇는다 (엑셀이 기대하는 형식)', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });
});

/** 검사에 쓰는 결과 한 건 */
function makeResult(over: Partial<RoundResult> = {}): RoundResult {
  const snapshot = {
    roundId: 'r1',
    roundNumber: 2,
    mapId: 'classic-wheel',
    mapVersion: 1,
    rule: { kind: 'topK' as const, k: 2 },
    awards: [{ id: 'a', label: '발표자', slot: 0 }],
    allowDuplicateAwards: false,
    useSkills: false,
    selectionMode: 'physics' as const,
    seed: 'seed',
    tiebreakOrder: ['p1', 'p2'],
    timeLimitSec: 150,
    createdAt: 0,
    participantSnapshotVersion: 1,
    racers: [
      { participantId: 'p1', nickname: '=위험', dupIndex: 0, hue: 0 },
      { participantId: 'p2', nickname: '김하늘', dupIndex: 0, hue: 180 },
    ],
  };
  return {
    eventId: 'e1',
    roundId: 'r1',
    revision: 1,
    mapId: 'classic-wheel',
    mapVersion: 1,
    ruleSnapshot: snapshot,
    participantSnapshotVersion: 1,
    finishOrder: [
      { rank: 1, participantId: 'p1', nickname: '=위험', dupIndex: 0, timeMs: 12340, tiebroken: false },
      { rank: 2, participantId: 'p2', nickname: '김하늘', dupIndex: 0, timeMs: 15670, tiebroken: true },
    ],
    winners: [
      {
        slot: 0,
        rank: 1,
        participantId: 'p1',
        nickname: '=위험',
        dupIndex: 0,
        award: { id: 'a', label: '발표자', slot: 0 },
        selectionReason: '상위 2명 중 1위',
      },
    ],
    outcome: 'completed',
    cancelled: false,
    selectionMode: 'physics',
    finalizedAt: 0,
    ...over,
  };
}

describe('결과 표', () => {
  it('위험한 닉네임이 표 안에서도 글자로 남는다', () => {
    const csv = resultToCsv(makeResult(), '회전 관문', '먼저 도착한 2명');
    // `=위험` 이 그대로 칸 앞에 오면 안 된다
    expect(csv).not.toMatch(/(^|\r\n|,)=위험/);
    expect(csv).toContain(`'=위험`);
  });

  it('제한시간으로 끝난 라운드는 당첨자를 만들어 내지 않는다', () => {
    const csv = resultToCsv(makeResult({ outcome: 'timeout', winners: [] }), '회전 관문', '먼저 도착한 2명');
    expect(csv).toContain('제한시간 초과(당첨자 없음)');
    expect(csv).toContain('(없음)');
  });

  it('교사 지정이면 그렇게 적는다', () => {
    const csv = resultToCsv(makeResult({ selectionMode: 'manual' }), '회전 관문', '교사 지정');
    expect(csv).toContain('교사 지정(무작위 아님)');
  });

  it('도착 순서와 동시 통과 표시가 들어간다', () => {
    const csv = resultToCsv(makeResult(), '회전 관문', '먼저 도착한 2명');
    expect(csv).toContain('12.340');
    expect(csv).toContain('15.670');
    // 2위는 동시 통과 표시
    expect(csv).toMatch(/2,김하늘,15\.670,예/);
  });

  it('사람이 읽는 글에도 같은 사실이 들어간다', () => {
    const text = resultToText(makeResult({ selectionMode: 'manual', outcome: 'timeout' }), '회전 관문', '교사 지정');
    expect(text).toContain('무작위 추첨 아님');
    expect(text).toContain('제한시간을 넘겨 당첨자를 정하지 않았습니다');
  });
});
