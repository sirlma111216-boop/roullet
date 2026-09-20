/**
 * 참가 명단.
 *
 * 교사가 하는 일: 확인 · 이름 고치기 · 빼기 · 내보내기 · 잠그기 · 직접 추가(기기 없는 학생).
 */

import { useState } from 'react';
import { displayName, type Participant, type RosterCommand } from '@marble/protocol';

export interface RosterPanelProps {
  participants: Participant[];
  capacity: number;
  locked: boolean;
  /** 이번 라운드에서 빠지는 사람(지난 당첨자 제외 등) */
  autoExcludedIds: readonly string[];
  disabled?: boolean;
  onCommands(commands: RosterCommand[]): void;
}

const SOURCE_LABEL: Record<Participant['source'], string> = {
  self: '직접 입장',
  teacher: '교사 추가',
  'host-app': '수업 앱',
};

export function RosterPanel(props: RosterPanelProps): React.ReactElement {
  const { participants, capacity, locked, autoExcludedIds, disabled, onCommands } = props;
  const [bulk, setBulk] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const online = participants.filter((p) => p.online).length;
  const included = participants.filter((p) => !p.excluded && !autoExcludedIds.includes(p.id)).length;

  const addBulk = () => {
    const nicknames = bulk
      .split(/[\n,\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (nicknames.length === 0) return;
    onCommands([{ op: 'addMany', nicknames }]);
    setBulk('');
  };

  return (
    <div className="stack">
      <div className="row">
        <strong>참가 명단</strong>
        <span className="badge">
          명단 {participants.length} / 정원 {capacity}
        </span>
        <span className="badge badge--good">
          <span className="dot" aria-hidden="true" />
          접속 {online}
        </span>
        <span className="badge">이번 라운드 {included}명</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn--sm"
          aria-pressed={locked}
          disabled={disabled}
          onClick={() => onCommands([{ op: 'lock', locked: !locked }])}
        >
          {locked ? '🔒 입장 잠김' : '🔓 입장 열림'}
        </button>
      </div>

      {participants.length === 0 ? (
        <div className="faint">
          아직 아무도 들어오지 않았습니다. 학생은 QR 이나 참여 코드로 들어옵니다. 기기가 없는 학생은 아래에서 직접
          추가하세요.
        </div>
      ) : null}

      <div className="card card--tight" style={{ maxHeight: 340, overflow: 'auto' }}>
        <table className="table">
          <caption className="sr-only">참가자 목록</caption>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">상태</th>
              <th scope="col">경로</th>
              <th scope="col">
                <span className="sr-only">조작</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const auto = autoExcludedIds.includes(p.id);
              const out = p.excluded || auto;
              return (
                <tr key={p.id}>
                  <td>
                    {editing === p.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (draft.trim()) onCommands([{ op: 'rename', participantId: p.id, nickname: draft }]);
                          setEditing(null);
                        }}
                      >
                        <input
                          className="input"
                          autoFocus
                          maxLength={12}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => setEditing(null)}
                          aria-label={`${p.nickname} 이름 고치기`}
                        />
                      </form>
                    ) : (
                      <span style={{ textDecoration: out ? 'line-through' : undefined }}>
                        <span
                          className="swatch"
                          style={{ background: `hsl(${p.hue} 85% 62%)`, display: 'inline-block', marginRight: 6 }}
                          aria-hidden="true"
                        />
                        {displayName(p)}
                      </span>
                    )}
                  </td>
                  <td>
                    {p.online ? (
                      <span className="badge badge--good">접속</span>
                    ) : (
                      <span className="badge">대기</span>
                    )}
                    {out ? (
                      <span className="badge badge--warn" title={auto ? '지난 라운드 당첨자' : '교사가 제외'}>
                        제외{auto ? '(당첨자)' : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="faint">{SOURCE_LABEL[p.source]}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={disabled}
                        onClick={() => {
                          setEditing(p.id);
                          setDraft(p.nickname);
                        }}
                      >
                        이름
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={disabled || auto}
                        onClick={() => onCommands([{ op: 'exclude', participantId: p.id, excluded: !p.excluded }])}
                      >
                        {p.excluded ? '넣기' : '빼기'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        disabled={disabled}
                        onClick={() => {
                          const ban = window.confirm(
                            `${displayName(p)} 님을 내보냅니다.\n\n[확인] 다시 못 들어오게 막기\n[취소] 내보내되 다시 들어올 수 있게`,
                          );
                          onCommands([{ op: 'kick', participantId: p.id, banRejoin: ban }]);
                        }}
                      >
                        내보내기
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details>
        <summary>명단 직접 입력 · 붙여넣기</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <textarea
            className="textarea"
            placeholder={'한 줄에 한 명씩 붙여넣으세요.\n김하늘\n박서준\n이도윤'}
            value={bulk}
            disabled={disabled}
            onChange={(e) => setBulk(e.target.value)}
            aria-label="명단 붙여넣기"
          />
          <div className="row">
            <button type="button" className="btn" onClick={addBulk} disabled={disabled || !bulk.trim()}>
              명단에 추가
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={disabled}
              onClick={() => onCommands([{ op: 'clearExclusions' }])}
            >
              제외 초기화
            </button>
          </div>
          <p className="faint">
            기기가 없는 학생도 이렇게 넣으면 구슬이 생깁니다. 닉네임은 12자까지이고, 화면에 그대로 나가므로 태그
            기호는 지워집니다.
          </p>
        </div>
      </details>
    </div>
  );
}
