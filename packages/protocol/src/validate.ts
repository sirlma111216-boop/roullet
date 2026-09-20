/**
 * 들어온 값 다듬기와 규칙 검사.
 *
 * 클라이언트가 보낸 것은 무엇도 그대로 믿지 않는다. 서버(Durable Object)와
 * 교사 화면이 **같은 함수**를 써서 같은 판단을 하도록 여기 한곳에 모았다.
 */

import { MAX_CAPACITY, NICK_MAX, type Award, type ParticipantId, type RoundConfig, type WinnerRule } from './domain.ts';
import { ErrorCodes, type ErrorCode, type RosterCommand } from './messages.ts';

export interface Invalid {
  ok: false;
  code: ErrorCode;
  message: string;
}
export interface Valid<T> {
  ok: true;
  value: T;
}
export type Checked<T> = Valid<T> | Invalid;

const bad = (code: ErrorCode, message: string): Invalid => ({ ok: false, code, message });
const good = <T>(value: T): Valid<T> => ({ ok: true, value });

/* ------------------------------------------------------------------ 글자 다듬기 */

/**
 * 화면에 그대로 나가는 글자에서 빼는 기호.
 * 정규식 대신 한 글자씩 거른다 — escape 사고를 피하려는 것이다.
 */
const UNSAFE_CHARS = ['<', '>', '&', '"', "'", '`', '\\'];

/**
 * 닉네임을 다듬는다. 제어문자·태그 기호를 빼고 길이를 자른다.
 * 서버에서도 반드시 다시 돌린다 — 클라이언트만 믿지 않는다.
 */
export function cleanNickname(input: unknown): string {
  const s = typeof input === 'string' ? input.normalize('NFC') : '';
  let out = '';
  for (let i = 0; i < s.length && out.length < NICK_MAX; i++) {
    const ch = s[i]!;
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue; // 제어문자
    if (code >= 0x200b && code <= 0x200f) continue; // 폭 없는 문자 — 보이지 않는 이름 방지
    if (code === 0xfeff) continue;
    if (UNSAFE_CHARS.includes(ch)) continue;
    out += ch;
  }
  return out.trim();
}

export function checkNickname(input: unknown): Checked<string> {
  const nick = cleanNickname(input);
  if (nick.length === 0) {
    return bad(ErrorCodes.NICKNAME_INVALID, '닉네임을 한 글자 이상 적어 주세요.');
  }
  return good(nick);
}

/** 자유 입력 글(당첨 항목 이름 등) */
export function cleanLabel(input: unknown, max = 40): string {
  const s = typeof input === 'string' ? input.normalize('NFC') : '';
  let out = '';
  for (let i = 0; i < s.length && out.length < max; i++) {
    const ch = s[i]!;
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue;
    if (UNSAFE_CHARS.includes(ch)) continue;
    out += ch;
  }
  return out.trim();
}

/* ------------------------------------------------------------------ 당첨 규칙 */

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/**
 * 규칙 자체가 말이 되는지 본다(참가 인원과 상관없는 검사).
 * 인원까지 보는 검사는 {@link validateRuleAgainstRacers}.
 */
export function parseWinnerRule(input: unknown): Checked<WinnerRule> {
  if (!input || typeof input !== 'object') return bad(ErrorCodes.BAD_RULE, '당첨 규칙이 없습니다.');
  const r = input as Record<string, unknown>;
  switch (r.kind) {
    case 'first':
      return good({ kind: 'first' });
    case 'last':
      return good({ kind: 'last' });
    case 'nth':
      if (!isPositiveInt(r.n)) return bad(ErrorCodes.BAD_RULE, '몇 번째로 도착한 사람인지 1 이상의 정수로 정해 주세요.');
      if (r.n > MAX_CAPACITY) return bad(ErrorCodes.BAD_RULE, `순위는 ${MAX_CAPACITY} 이하여야 합니다.`);
      return good({ kind: 'nth', n: r.n });
    case 'topK':
      if (!isPositiveInt(r.k)) return bad(ErrorCodes.BAD_RULE, '상위 몇 명인지 1 이상의 정수로 정해 주세요.');
      return good({ kind: 'topK', k: Math.min(r.k, MAX_CAPACITY) });
    case 'bottomK':
      if (!isPositiveInt(r.k)) return bad(ErrorCodes.BAD_RULE, '하위 몇 명인지 1 이상의 정수로 정해 주세요.');
      return good({ kind: 'bottomK', k: Math.min(r.k, MAX_CAPACITY) });
    case 'range': {
      if (!isPositiveInt(r.from) || !isPositiveInt(r.to)) {
        return bad(ErrorCodes.BAD_RULE, '순위 범위는 1 이상의 정수여야 합니다.');
      }
      if (r.to < r.from) {
        return bad(ErrorCodes.BAD_RULE, `순위 범위가 뒤집혔습니다 (${r.from}위 ~ ${r.to}위). 앞이 더 작아야 합니다.`);
      }
      if (r.to > MAX_CAPACITY) return bad(ErrorCodes.BAD_RULE, `순위는 ${MAX_CAPACITY} 이하여야 합니다.`);
      return good({ kind: 'range', from: r.from, to: r.to });
    }
    case 'ranks': {
      if (!Array.isArray(r.ranks) || r.ranks.length === 0) {
        return bad(ErrorCodes.BAD_RULE, '뽑을 순위를 하나 이상 골라 주세요.');
      }
      if (r.ranks.length > MAX_CAPACITY) return bad(ErrorCodes.BAD_RULE, '순위를 너무 많이 골랐습니다.');
      const seen = new Set<number>();
      for (const n of r.ranks) {
        if (!isPositiveInt(n)) return bad(ErrorCodes.BAD_RULE, '순위는 1 이상의 정수여야 합니다.');
        if (n > MAX_CAPACITY) return bad(ErrorCodes.BAD_RULE, `순위는 ${MAX_CAPACITY} 이하여야 합니다.`);
        if (seen.has(n)) return bad(ErrorCodes.BAD_RULE, `${n}위를 두 번 골랐습니다.`);
        seen.add(n);
      }
      return good({ kind: 'ranks', ranks: [...seen].sort((a, b) => a - b) });
    }
    case 'manual': {
      if (!Array.isArray(r.participantIds) || r.participantIds.length === 0) {
        return bad(ErrorCodes.BAD_RULE, '지정할 학생을 한 명 이상 고르세요.');
      }
      const ids: ParticipantId[] = [];
      const seen = new Set<string>();
      for (const id of r.participantIds) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
          return bad(ErrorCodes.BAD_RULE, '지정한 학생이 올바르지 않습니다.');
        }
        if (seen.has(id)) return bad(ErrorCodes.BAD_RULE, '같은 학생을 두 번 지정했습니다.');
        seen.add(id);
        ids.push(id);
      }
      return good({ kind: 'manual', participantIds: ids });
    }
    default:
      return bad(ErrorCodes.BAD_RULE, '모르는 당첨 규칙입니다.');
  }
}

/**
 * 규칙이 이번 라운드의 인원으로 실제로 뽑을 수 있는지 본다.
 * 참가자 0명·1명, 제외하고 나서 모자란 경우를 여기서 잡는다.
 */
export function validateRuleAgainstRacers(rule: WinnerRule, racerIds: readonly ParticipantId[]): Checked<true> {
  const n = racerIds.length;
  if (n === 0) {
    return bad(ErrorCodes.NOT_ENOUGH_PARTICIPANTS, '참가자가 없습니다. 명단에 한 명 이상 있어야 시작할 수 있습니다.');
  }
  switch (rule.kind) {
    case 'first':
    case 'last':
      return good(true);
    case 'nth':
      if (rule.n > n) {
        return bad(
          ErrorCodes.NOT_ENOUGH_PARTICIPANTS,
          `${rule.n}번째 도착자를 뽑으려면 ${rule.n}명 이상이 필요한데 지금은 ${n}명입니다.`,
        );
      }
      return good(true);
    case 'topK':
      if (rule.k > n) {
        return bad(ErrorCodes.NOT_ENOUGH_PARTICIPANTS, `상위 ${rule.k}명을 뽑기에는 참가자가 ${n}명뿐입니다.`);
      }
      return good(true);
    case 'bottomK':
      if (rule.k > n) {
        return bad(ErrorCodes.NOT_ENOUGH_PARTICIPANTS, `하위 ${rule.k}명을 뽑기에는 참가자가 ${n}명뿐입니다.`);
      }
      return good(true);
    case 'range':
      if (rule.to > n) {
        return bad(
          ErrorCodes.NOT_ENOUGH_PARTICIPANTS,
          `${rule.from}위~${rule.to}위를 뽑으려면 ${rule.to}명 이상이 필요한데 지금은 ${n}명입니다.`,
        );
      }
      return good(true);
    case 'ranks': {
      const over = rule.ranks.filter((r) => r > n);
      if (over.length > 0) {
        return bad(
          ErrorCodes.NOT_ENOUGH_PARTICIPANTS,
          `${over.join('·')}위는 참가자 ${n}명으로는 나올 수 없습니다.`,
        );
      }
      return good(true);
    }
    case 'manual': {
      const set = new Set(racerIds);
      const missing = rule.participantIds.filter((id) => !set.has(id));
      if (missing.length > 0) {
        return bad(ErrorCodes.BAD_RULE, '지정한 학생 중 이번 라운드 명단에 없는 사람이 있습니다.');
      }
      return good(true);
    }
  }
}

/** 규칙이 만들어 내는 당첨 자리 수 */
export function winnerSlotCount(rule: WinnerRule, racerCount: number): number {
  switch (rule.kind) {
    case 'first':
    case 'last':
      return Math.min(1, racerCount);
    case 'nth':
      return rule.n <= racerCount ? 1 : 0;
    case 'topK':
      return Math.min(rule.k, racerCount);
    case 'bottomK':
      return Math.min(rule.k, racerCount);
    case 'range':
      return Math.max(0, Math.min(rule.to, racerCount) - rule.from + 1);
    case 'ranks':
      return rule.ranks.filter((r) => r <= racerCount).length;
    case 'manual':
      return rule.participantIds.length;
  }
}

/* ------------------------------------------------------------------ 당첨 항목 */

export function parseAwards(input: unknown, slotCount: number): Checked<Award[]> {
  if (input == null) return good([]);
  if (!Array.isArray(input)) return bad(ErrorCodes.BAD_RULE, '당첨 항목 목록이 올바르지 않습니다.');
  if (input.length > 50) return bad(ErrorCodes.BAD_RULE, '당첨 항목이 너무 많습니다.');
  const out: Award[] = [];
  const usedSlots = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const label = cleanLabel(a.label);
    if (!label) continue;
    const slot = typeof a.slot === 'number' && Number.isInteger(a.slot) ? a.slot : out.length;
    if (slot < 0 || slot >= Math.max(slotCount, 1)) {
      return bad(ErrorCodes.BAD_RULE, `'${label}' 항목이 가리키는 당첨 자리(${slot + 1}번째)가 이 규칙에는 없습니다.`);
    }
    if (usedSlots.has(slot)) {
      return bad(ErrorCodes.BAD_RULE, `당첨 자리 ${slot + 1}번에 항목이 두 개 붙었습니다.`);
    }
    usedSlots.add(slot);
    const id = typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 64 ? a.id : `award-${slot}`;
    out.push({ id, label, slot });
  }
  out.sort((x, y) => x.slot - y.slot);
  return good(out);
}

/* ------------------------------------------------------------------ 라운드 설정 */

export function parseRoundConfig(input: unknown, knownMapIds: readonly string[]): Checked<RoundConfig> {
  if (!input || typeof input !== 'object') return bad(ErrorCodes.BAD_MESSAGE, '설정이 없습니다.');
  const c = input as Record<string, unknown>;

  const mapId = typeof c.mapId === 'string' ? c.mapId : '';
  if (!knownMapIds.includes(mapId)) return bad(ErrorCodes.BAD_MESSAGE, '모르는 맵입니다.');

  const rule = parseWinnerRule(c.rule);
  if (!rule.ok) return rule;

  const excluded: ParticipantId[] = [];
  if (Array.isArray(c.excludedParticipantIds)) {
    for (const id of c.excludedParticipantIds.slice(0, MAX_CAPACITY)) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 64) excluded.push(id);
    }
  }

  // 자리 수는 규칙만으로 정해지는 상한을 쓴다. 실제 인원 검사는 시작할 때 다시 한다.
  const slots = winnerSlotCount(rule.value, MAX_CAPACITY);
  const awards = parseAwards(c.awards, slots);
  if (!awards.ok) return awards;

  return good({
    mapId,
    rule: rule.value,
    excludedParticipantIds: excluded,
    excludePreviousWinners: c.excludePreviousWinners === true,
    useSkills: c.useSkills === true,
    awards: awards.value,
    allowDuplicateAwards: c.allowDuplicateAwards === true,
  });
}

/* ------------------------------------------------------------------ 명단 명령 */

export function parseRosterCommands(input: unknown): Checked<RosterCommand[]> {
  if (!Array.isArray(input)) return bad(ErrorCodes.BAD_MESSAGE, '명단 명령이 올바르지 않습니다.');
  if (input.length > 200) return bad(ErrorCodes.BAD_MESSAGE, '한 번에 보낼 수 있는 명단 명령을 넘었습니다.');
  const out: RosterCommand[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const pid = typeof c.participantId === 'string' ? c.participantId.slice(0, 64) : '';
    switch (c.op) {
      case 'add': {
        const nick = checkNickname(c.nickname);
        if (!nick.ok) return nick;
        out.push({ op: 'add', nickname: nick.value });
        break;
      }
      case 'addMany': {
        if (!Array.isArray(c.nicknames)) return bad(ErrorCodes.BAD_MESSAGE, '붙여넣은 명단이 올바르지 않습니다.');
        const nicks: string[] = [];
        for (const n of c.nicknames.slice(0, MAX_CAPACITY)) {
          const cleaned = cleanNickname(n);
          if (cleaned) nicks.push(cleaned);
        }
        if (nicks.length === 0) return bad(ErrorCodes.NICKNAME_INVALID, '쓸 수 있는 이름이 하나도 없습니다.');
        out.push({ op: 'addMany', nicknames: nicks });
        break;
      }
      case 'rename': {
        if (!pid) return bad(ErrorCodes.BAD_MESSAGE, '누구를 고칠지 알 수 없습니다.');
        const nick = checkNickname(c.nickname);
        if (!nick.ok) return nick;
        out.push({ op: 'rename', participantId: pid, nickname: nick.value });
        break;
      }
      case 'exclude':
        if (!pid) return bad(ErrorCodes.BAD_MESSAGE, '누구를 뺄지 알 수 없습니다.');
        out.push({ op: 'exclude', participantId: pid, excluded: c.excluded === true });
        break;
      case 'remove':
        if (!pid) return bad(ErrorCodes.BAD_MESSAGE, '누구를 지울지 알 수 없습니다.');
        out.push({ op: 'remove', participantId: pid });
        break;
      case 'kick':
        if (!pid) return bad(ErrorCodes.BAD_MESSAGE, '누구를 내보낼지 알 수 없습니다.');
        out.push({ op: 'kick', participantId: pid, banRejoin: c.banRejoin === true });
        break;
      case 'lock':
        out.push({ op: 'lock', locked: c.locked === true });
        break;
      case 'clearExclusions':
        out.push({ op: 'clearExclusions' });
        break;
      default:
        return bad(ErrorCodes.BAD_MESSAGE, '모르는 명단 명령입니다.');
    }
  }
  return good(out);
}

/* ------------------------------------------------------------------ 입장 코드 */

/**
 * 사람이 부르고 받아적는 코드.
 * 헷갈리는 글자(0/O, 1/I/L)를 뺀 32글자에서 고른다.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/**
 * 사람이 손으로 적다가 헷갈리기 쉬운 글자를 알파벳 안의 글자로 되돌린다.
 * 코드에는 0·1·I·L·O 가 아예 없으므로, 그렇게 적혔다면 닮은 글자를 뜻한 것이다.
 */
const CODE_LOOKALIKE: Record<string, string> = {
  '0': 'Q',
  O: 'Q',
  I: 'J',
  L: 'J',
};

export function normalizeJoinCode(input: unknown): string {
  const s = typeof input === 'string' ? input.toUpperCase() : '';
  let out = '';
  for (const raw of s) {
    const ch = CODE_LOOKALIKE[raw] ?? raw;
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length >= CODE_LENGTH) break;
  }
  return out;
}

export function isValidJoinCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}
