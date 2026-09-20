/**
 * 진행 순위.
 *
 * 순위는 **코스 진행률** 로 매긴다 — y 좌표가 아니다. 포털 맵에서는 아래로 갔다고 앞선 것이
 * 아니고, 되돌아오는 구간에서도 뒤집힌다. 그 계산은 game-core 가 하고 여기서는 받아 적는다.
 */

import { displayName, type RacerSnapshot } from '@marble/protocol';

export interface LeaderboardProps {
  racers: readonly RacerSnapshot[];
  /** 앞선 순서대로의 구슬 번호 */
  ranking: readonly number[];
  /** 구슬 번호 → 결승 순위 */
  finished: ReadonlyMap<number, number>;
  meIndex: number | null;
  /** 몇 명까지 보여 줄지 */
  limit?: number;
}

export function Leaderboard({ racers, ranking, finished, meIndex, limit = 12 }: LeaderboardProps): React.ReactElement {
  const order = ranking.length > 0 ? ranking : racers.map((_, i) => i);

  // 내 구슬이 목록 밖으로 밀려나도 반드시 한 줄은 보이게 한다
  const shown = order.slice(0, limit);
  const myPlace = meIndex === null ? -1 : order.indexOf(meIndex);
  const myHidden = meIndex !== null && myPlace >= limit;

  return (
    <div className="leaderboard" aria-label="진행 순위" role="list">
      {shown.map((idx, place) => (
        <Row key={idx} racer={racers[idx]} place={place + 1} rank={finished.get(idx)} mine={idx === meIndex} />
      ))}
      {myHidden && meIndex !== null ? (
        <>
          <div className="faint" style={{ textAlign: 'center' }}>
            ⋯
          </div>
          <Row racer={racers[meIndex]} place={myPlace + 1} rank={finished.get(meIndex)} mine />
        </>
      ) : null}
    </div>
  );
}

function Row({
  racer,
  place,
  rank,
  mine,
}: {
  racer: RacerSnapshot | undefined;
  place: number;
  rank: number | undefined;
  mine: boolean;
}): React.ReactElement | null {
  if (!racer) return null;
  const done = rank !== undefined && rank > 0;
  return (
    <div className={`lb-row${mine ? ' lb-row--mine' : ''}${done ? ' lb-row--done' : ''}`} role="listitem">
      <span className="lb-rank">{done ? `${rank}위` : place}</span>
      <span className="lb-name">
        <span className="swatch" style={{ background: `hsl(${racer.hue} 85% 62%)` }} aria-hidden="true" />
        <span>{displayName(racer)}</span>
        {mine ? <span className="badge badge--warn">나</span> : null}
      </span>
      <span className="faint">{done ? '도착' : ''}</span>
    </div>
  );
}
