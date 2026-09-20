/**
 * 결과 내보내기.
 *
 * ★ 수식 삽입 방지:
 * 표 계산 프로그램은 `=`, `+`, `-`, `@`, 탭, 캐리지리턴으로 시작하는 칸을 **수식**으로 읽는다.
 * 학생이 닉네임을 `=HYPERLINK(...)` 로 지으면, 교사가 연 파일에서 그 수식이 살아난다.
 * 그래서 그런 칸 앞에 작은따옴표를 붙여 글자임을 못 박는다.
 */

import type { RoundResult } from '@marble/protocol';
import { displayName } from '@marble/protocol';

const DANGEROUS_PREFIX = ['=', '+', '-', '@', '\t', '\r'];

/** 한 칸을 CSV 로 안전하게 만든다 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (s.length > 0 && DANGEROUS_PREFIX.includes(s[0]!)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const OUTCOME_TEXT: Record<RoundResult['outcome'], string> = {
  completed: '정상 종료',
  timeout: '제한시간 초과(당첨자 없음)',
  cancelled: '취소됨',
};

/** 결과 한 건을 표로 */
export function resultToCsv(result: RoundResult, mapName: string, ruleText: string): string {
  const rows: unknown[][] = [];
  rows.push(['교실 구슬 레이스 결과']);
  rows.push(['라운드', result.ruleSnapshot.roundNumber]);
  rows.push(['맵', mapName]);
  rows.push(['당첨 규칙', ruleText]);
  rows.push(['뽑는 방식', result.selectionMode === 'manual' ? '교사 지정(무작위 아님)' : '물리 경기 도착 순서']);
  rows.push(['종료 상태', OUTCOME_TEXT[result.outcome]]);
  rows.push(['확정 시각', new Date(result.finalizedAt).toLocaleString('ko-KR')]);
  rows.push(['결과 판(revision)', result.revision]);
  if (result.revisionNote) rows.push(['수정 사유', result.revisionNote]);
  rows.push([]);

  rows.push(['당첨자']);
  rows.push(['자리', '순위', '이름', '항목', '선정 사유']);
  if (result.winners.length === 0) {
    rows.push(['-', '-', '(없음)', '-', OUTCOME_TEXT[result.outcome]]);
  }
  for (const w of result.winners) {
    rows.push([w.slot + 1, w.rank ?? '-', displayName(w), w.award?.label ?? '', w.selectionReason]);
  }
  rows.push([]);

  rows.push(['도착 순서']);
  rows.push(['순위', '이름', '통과 시각(초)', '동시 통과']);
  for (const f of result.finishOrder) {
    rows.push([f.rank, displayName(f), (f.timeMs / 1000).toFixed(3), f.tiebroken ? '예' : '']);
  }

  return toCsv(rows);
}

/** 사람이 읽는 한 덩어리 글(결과 복사용) */
export function resultToText(result: RoundResult, mapName: string, ruleText: string): string {
  const lines: string[] = [];
  lines.push(`교실 구슬 레이스 — ${result.ruleSnapshot.roundNumber}라운드 결과`);
  lines.push(`맵: ${mapName} · 규칙: ${ruleText}`);
  if (result.selectionMode === 'manual') lines.push('※ 교사가 직접 지정했습니다 (무작위 추첨 아님)');
  if (result.outcome === 'timeout') lines.push('※ 제한시간을 넘겨 당첨자를 정하지 않았습니다');
  lines.push('');
  if (result.winners.length > 0) {
    lines.push('[당첨]');
    for (const w of result.winners) {
      const award = w.award ? ` — ${w.award.label}` : '';
      const rank = w.rank ? `${w.rank}위 ` : '';
      lines.push(`  ${rank}${displayName(w)}${award}`);
    }
    lines.push('');
  }
  lines.push('[도착 순서]');
  for (const f of result.finishOrder) {
    lines.push(`  ${f.rank}. ${displayName(f)} (${(f.timeMs / 1000).toFixed(2)}초)${f.tiebroken ? ' *동시통과' : ''}`);
  }
  return lines.join('\n');
}

/** 브라우저에서 파일로 내려받는다 */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  // 엑셀이 한글을 깨뜨리지 않도록 BOM 을 붙인다
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' + text : text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
