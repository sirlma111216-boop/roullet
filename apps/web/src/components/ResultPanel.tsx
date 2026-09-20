/**
 * 결과 발표.
 *
 * 규칙:
 *  - **서버가 확정한 결과**만 여기 온다. 화면이 스스로 당첨자를 정하지 않는다.
 *  - 제한시간으로 끊긴 라운드는 당첨자를 만들어 내지 않고, 다음에 무엇을 할지 묻는다.
 *  - 교사 지정 모드는 다른 연출을 쓰고, 「무작위가 아님」을 감추지 않는다.
 *  - 결과는 DOM 글자로도 있다(화면 읽기 프로그램·복사·CSV).
 */

import { useState } from 'react';
import { displayName, type RoundResult } from '@marble/protocol';
import { describeRule } from '@marble/game-core/rules';
import { getMap } from '@marble/game-core';
import { copyText, downloadText, resultToCsv, resultToText } from '../util/csv.ts';

export interface ResultPanelProps {
  result: RoundResult;
  /** 이 화면을 보는 학생의 참가자 id(교사 화면이면 null) */
  myParticipantId?: string | null;
  /** 교사만 보이는 조작 */
  onRematch?(): void;
  onNextRound?(): void;
  busy?: boolean;
}

export function ResultPanel(props: ResultPanelProps): React.ReactElement {
  const { result, myParticipantId } = props;
  const [copied, setCopied] = useState(false);
  const map = getMap(result.mapId);
  const mapName = map?.name ?? result.mapId;
  const ruleText = describeRule(result.ruleSnapshot.rule);

  const mine = myParticipantId ? result.finishOrder.find((f) => f.participantId === myParticipantId) : undefined;
  const iWon = myParticipantId ? result.winners.some((w) => w.participantId === myParticipantId) : false;

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{result.ruleSnapshot.roundNumber}라운드 결과</h2>
        <span className="badge">{mapName}</span>
        <span className="badge">{ruleText}</span>
        {result.revision > 1 ? <span className="badge badge--warn">수정됨 (판 {result.revision})</span> : null}
      </div>

      {result.selectionMode === 'manual' ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>
            이 결과는 <strong>교사가 직접 지정</strong>한 것입니다. 구슬 경기로 뽑은 것이 아니며, 도착 순위도
            만들어 내지 않았습니다.
          </span>
        </div>
      ) : null}

      {result.outcome === 'timeout' ? (
        <div className="notice notice--bad">
          <span className="notice__icon" aria-hidden="true">⏱</span>
          <span>
            제한시간({result.ruleSnapshot.timeLimitSec}초) 안에 규칙이 요구한 만큼 도착하지 못했습니다.
            <strong> 당첨자를 임의로 만들지 않았습니다.</strong> 아래에서 다시 경기하거나 이대로 중단하세요.
          </span>
        </div>
      ) : null}

      {result.revisionNote ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">✎</span>
          <span>
            이전 판({result.previousRevision})을 고쳤습니다 — {result.revisionNote}
          </span>
        </div>
      ) : null}

      {mine ? (
        <div className={iWon ? 'notice notice--good' : 'notice'}>
          <span className="notice__icon" aria-hidden="true">{iWon ? '★' : '•'}</span>
          <span>
            내 결과: <strong>{mine.rank}위</strong> ({(mine.timeMs / 1000).toFixed(2)}초)
            {iWon ? ' — 당첨되었습니다!' : ''}
          </span>
        </div>
      ) : null}

      {result.winners.length > 0 ? (
        <section aria-label="당첨자">
          <h3>당첨</h3>
          <ol className="winner-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {result.winners.map((w) => (
              <li className="winner" key={`${w.slot}-${w.participantId}`}>
                <span className="winner__rank">{w.rank !== null ? `${w.rank}위` : '지정'}</span>
                <span className="winner__name">{displayName(w)}</span>
                {w.award ? <span className="winner__award">{w.award.label}</span> : null}
                <span className="sr-only">선정 사유: {w.selectionReason}</span>
              </li>
            ))}
          </ol>
          <ul className="faint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {result.winners.map((w) => (
              <li key={`why-${w.slot}`}>
                {displayName(w)} — {w.selectionReason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.finishOrder.length > 0 ? (
        <details>
          <summary>도착 순서 전체 ({result.finishOrder.length}명)</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th scope="col">순위</th>
                <th scope="col">이름</th>
                <th scope="col">통과 시각</th>
              </tr>
            </thead>
            <tbody>
              {result.finishOrder.map((f) => (
                <tr key={f.participantId} style={f.participantId === myParticipantId ? { fontWeight: 700 } : undefined}>
                  <td>{f.rank}</td>
                  <td>{displayName(f)}</td>
                  <td>
                    {(f.timeMs / 1000).toFixed(2)}초{f.tiebroken ? ' (동시 통과)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {typeof result.assistCount === 'number' && result.assistCount > 0 ? (
        <p className="faint">
          정체 탈출 보조가 {result.assistCount}번 적용되었습니다. 같은 조건의 모든 구슬에 같은 규칙으로 적용됩니다.
        </p>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => {
            const ok = await copyText(resultToText(result, mapName, ruleText));
            setCopied(ok);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? '복사했습니다' : '결과 복사'}
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            downloadText(
              `구슬레이스_${result.ruleSnapshot.roundNumber}라운드.csv`,
              resultToCsv(result, mapName, ruleText),
            )
          }
        >
          CSV 내보내기
        </button>
        {props.onRematch ? (
          <button type="button" className="btn btn--sm" disabled={props.busy} onClick={props.onRematch}>
            같은 설정으로 재경기
          </button>
        ) : null}
        {props.onNextRound ? (
          <button type="button" className="btn btn--sm btn--primary" disabled={props.busy} onClick={props.onNextRound}>
            다음 라운드 준비
          </button>
        ) : null}
      </div>
    </div>
  );
}
