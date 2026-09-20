/**
 * 당첨 규칙 고르기.
 *
 * 화면에서 고른 값은 서버와 **같은 함수**로 검사한다(@marble/protocol).
 * 그래서 「화면에서는 됐는데 서버가 거절」 하는 일이 안 생기고, 틀린 이유도 같은 말로 나온다.
 */

import { useMemo } from 'react';
import {
  MAX_CAPACITY,
  parseWinnerRule,
  validateRuleAgainstRacers,
  winnerSlotCount,
  type Award,
  type Participant,
  type WinnerRule,
  type WinnerRuleKind,
} from '@marble/protocol';
import { displayName } from '@marble/protocol';
import { describeRule } from '@marble/game-core/rules';

export interface RuleEditorProps {
  rule: WinnerRule;
  onChange(rule: WinnerRule): void;
  awards: Award[];
  onAwardsChange(awards: Award[]): void;
  allowDuplicateAwards: boolean;
  onAllowDuplicateChange(v: boolean): void;
  /** 이번 라운드에 실제로 나갈 사람 */
  racers: Participant[];
  disabled?: boolean;
}

const KIND_LABEL: Record<WinnerRuleKind, string> = {
  first: '첫 번째 도착',
  last: '마지막 도착',
  nth: 'n번째 도착',
  topK: '상위 k명',
  bottomK: '하위 k명',
  range: '순위 범위 (a~b위)',
  ranks: '개별 순위 목록',
  manual: '교사 지정',
};

function defaultFor(kind: WinnerRuleKind, current: WinnerRule): WinnerRule {
  switch (kind) {
    case 'first':
      return { kind: 'first' };
    case 'last':
      return { kind: 'last' };
    case 'nth':
      return { kind: 'nth', n: current.kind === 'nth' ? current.n : 3 };
    case 'topK':
      return { kind: 'topK', k: current.kind === 'topK' ? current.k : 3 };
    case 'bottomK':
      return { kind: 'bottomK', k: current.kind === 'bottomK' ? current.k : 3 };
    case 'range':
      return { kind: 'range', from: 1, to: 3 };
    case 'ranks':
      return { kind: 'ranks', ranks: [2, 5] };
    case 'manual':
      return { kind: 'manual', participantIds: [] };
  }
}

export function RuleEditor(props: RuleEditorProps): React.ReactElement {
  const { rule, onChange, racers, disabled } = props;

  const validation = useMemo(() => {
    const parsed = parseWinnerRule(rule);
    if (!parsed.ok) return { ok: false as const, message: parsed.message };
    const against = validateRuleAgainstRacers(
      parsed.value,
      racers.map((r) => r.id),
    );
    if (!against.ok) return { ok: false as const, message: against.message };
    return { ok: true as const, message: '' };
  }, [rule, racers]);

  const slots = winnerSlotCount(rule, racers.length);

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="rule-kind">당첨 규칙</label>
        <select
          id="rule-kind"
          className="select"
          value={rule.kind}
          disabled={disabled}
          onChange={(e) => onChange(defaultFor(e.target.value as WinnerRuleKind, rule))}
        >
          {(Object.keys(KIND_LABEL) as WinnerRuleKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {rule.kind === 'nth' ? (
        <NumberField
          label="몇 번째 도착자"
          value={rule.n}
          min={1}
          max={MAX_CAPACITY}
          disabled={disabled}
          onChange={(n) => onChange({ kind: 'nth', n })}
        />
      ) : null}

      {rule.kind === 'topK' ? (
        <NumberField
          label="상위 몇 명"
          value={rule.k}
          min={1}
          max={MAX_CAPACITY}
          disabled={disabled}
          onChange={(k) => onChange({ kind: 'topK', k })}
        />
      ) : null}

      {rule.kind === 'bottomK' ? (
        <NumberField
          label="하위 몇 명"
          value={rule.k}
          min={1}
          max={MAX_CAPACITY}
          disabled={disabled}
          onChange={(k) => onChange({ kind: 'bottomK', k })}
        />
      ) : null}

      {rule.kind === 'range' ? (
        <div className="row">
          <NumberField
            label="시작 순위"
            value={rule.from}
            min={1}
            max={MAX_CAPACITY}
            disabled={disabled}
            onChange={(from) => onChange({ kind: 'range', from, to: rule.to })}
          />
          <NumberField
            label="끝 순위"
            value={rule.to}
            min={1}
            max={MAX_CAPACITY}
            disabled={disabled}
            onChange={(to) => onChange({ kind: 'range', from: rule.from, to })}
          />
        </div>
      ) : null}

      {rule.kind === 'ranks' ? (
        <div className="field">
          <label htmlFor="rule-ranks">뽑을 순위 (쉼표로 구분, 예: 2, 5, 8)</label>
          <input
            id="rule-ranks"
            className="input"
            inputMode="numeric"
            disabled={disabled}
            value={rule.ranks.join(', ')}
            onChange={(e) => {
              const ranks = e.target.value
                .split(/[,\s]+/)
                .map((s) => Number.parseInt(s, 10))
                .filter((n) => Number.isFinite(n));
              onChange({ kind: 'ranks', ranks });
            }}
          />
        </div>
      ) : null}

      {rule.kind === 'manual' ? (
        <div className="stack">
          <div className="notice notice--warn">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span>
              교사 지정은 <strong>무작위 추첨이 아닙니다.</strong> 경기를 돌리지 않고 바로 결과를 확정하며,
              화면·기록·연동 결과에 「교사 지정」으로 표시됩니다. 도착 순위는 만들어 내지 않습니다.
            </span>
          </div>
          <div className="field">
            <label>지정할 학생</label>
            <div className="card card--tight" style={{ maxHeight: 200, overflow: 'auto' }}>
              {racers.length === 0 ? <div className="faint">참가자가 없습니다.</div> : null}
              {racers.map((p) => {
                const checked = rule.participantIds.includes(p.id);
                return (
                  <label key={p.id} className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        const ids = checked
                          ? rule.participantIds.filter((id) => id !== p.id)
                          : [...rule.participantIds, p.id];
                        onChange({ kind: 'manual', participantIds: ids });
                      }}
                    />
                    <span>{displayName(p)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className={validation.ok ? 'notice notice--good' : 'notice notice--bad'}>
        <span className="notice__icon" aria-hidden="true">{validation.ok ? '✓' : '✕'}</span>
        <span>
          {validation.ok
            ? `${describeRule(rule)} — 당첨 자리 ${slots}개, 참가 ${racers.length}명`
            : validation.message}
        </span>
      </div>

      <AwardEditor
        awards={props.awards}
        slots={slots}
        onChange={props.onAwardsChange}
        allowDuplicate={props.allowDuplicateAwards}
        onAllowDuplicateChange={props.onAllowDuplicateChange}
        disabled={disabled}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
  disabled?: boolean;
}): React.ReactElement {
  const id = `num-${label.replace(/\s/g, '')}`;
  return (
    <div className="field grow">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
      />
    </div>
  );
}

function AwardEditor({
  awards,
  slots,
  onChange,
  allowDuplicate,
  onAllowDuplicateChange,
  disabled,
}: {
  awards: Award[];
  slots: number;
  onChange(a: Award[]): void;
  allowDuplicate: boolean;
  onAllowDuplicateChange(v: boolean): void;
  disabled?: boolean;
}): React.ReactElement {
  const visible = Math.min(Math.max(slots, 0), 12);

  return (
    <div className="stack">
      <div className="row">
        <strong>당첨 항목</strong>
        <span className="faint">각 당첨 자리에 무엇을 맡길지 적습니다. 비워 두면 표시하지 않습니다.</span>
      </div>
      {visible === 0 ? <div className="faint">규칙이 뽑는 자리가 없습니다.</div> : null}
      {Array.from({ length: visible }, (_, slot) => {
        const a = awards.find((x) => x.slot === slot);
        return (
          <div className="field" key={slot}>
            <label htmlFor={`award-${slot}`}>{slot + 1}번째 당첨 자리</label>
            <input
              id={`award-${slot}`}
              className="input"
              maxLength={40}
              placeholder="예: 발표자 / 정리 도우미 / 문제 선택권"
              value={a?.label ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const label = e.target.value;
                const next = awards.filter((x) => x.slot !== slot);
                if (label.trim()) next.push({ id: `award-${slot}`, label, slot });
                next.sort((x, y) => x.slot - y.slot);
                onChange(next);
              }}
            />
          </div>
        );
      })}
      {visible > 1 ? (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowDuplicate}
            disabled={disabled}
            onChange={(e) => onAllowDuplicateChange(e.target.checked)}
          />
          <span>한 학생이 항목을 여러 개 받아도 된다</span>
        </label>
      ) : null}
    </div>
  );
}
