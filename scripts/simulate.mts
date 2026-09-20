/**
 * 여덟 맵을 여러 인원·여러 시드로 끝까지 돌려 본다.
 *
 *   npm run sim                       — 기본(맵 8개 × 인원 6가지 × 시드 3개)
 *   npm run sim -- --maps mix-wind    — 맵을 골라서
 *   npm run sim -- --racers 30 --seeds 10
 *   npm run sim -- --json out.json    — 결과를 파일로
 *
 * 찾는 것: 벽 이탈, 영구 정체(제한시간 초과), 결승 순서 뒤집힘, 무한 포털.
 * 함께 재는 것: 완주 시간과 계산 비용.
 */

import { writeFileSync } from 'node:fs';
import { ALL_MAPS } from '../packages/game-core/src/maps/index.ts';
import { checkFinishIntegrity, simulate, type SimResult } from '../packages/game-core/src/sim/headless.ts';
import { MAX_TELEPORTS_PER_MARBLE } from '../packages/game-core/src/devices/index.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const mapFilter = arg('maps')?.split(',');
const racerList = (arg('racers') ?? '1,2,8,30,60,100').split(',').map(Number);
const seedCount = Number(arg('seeds') ?? '3');
const useSkills = process.argv.includes('--skills');
const jsonOut = arg('json');

const maps = ALL_MAPS.filter((m) => !mapFilter || mapFilter.includes(m.id));

console.log(
  `맵 ${maps.length}개 × 인원 [${racerList.join(', ')}] × 시드 ${seedCount}개` +
    `${useSkills ? ' (스킬 켬)' : ''} = ${maps.length * racerList.length * seedCount}판\n`,
);

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const results: SimResult[] = [];
const problems: string[] = [];
let worstWall = 0;

for (const map of maps) {
  const perMap: SimResult[] = [];
  for (const racers of racerList) {
    for (let s = 0; s < seedCount; s++) {
      const seed = `sim-${map.id}-${racers}-${s}`;
      const r = simulate({ mapId: map.id, racers, seed, useSkills });
      results.push(r);
      perMap.push(r);
      worstWall = Math.max(worstWall, r.wallMs);

      for (const p of checkFinishIntegrity(r)) {
        problems.push(`[${map.id} ${racers}명 시드${s}] ${p}`);
      }
      if (r.maxTeleports >= MAX_TELEPORTS_PER_MARBLE) {
        problems.push(
          `[${map.id} ${racers}명 시드${s}] 한 구슬이 포털 상한(${MAX_TELEPORTS_PER_MARBLE}회)에 닿았습니다.`,
        );
      }
    }
  }

  // 맵별 요약.
  // 「첫 도착」과 「전원 도착」을 따로 적는다 — 실제 라운드는 규칙이 요구하는 만큼만
  // 도착하면 끝나므로, 첫 도착 시각이 교사가 체감하는 경기 길이에 가깝다.
  const by = (n: number) => perMap.filter((r) => r.racers === n);
  const line = racerList
    .map((n) => {
      const rs = by(n);
      if (rs.length === 0) return '';
      const first = avg(rs.map((r) => r.finishTimes[0] ?? r.durationSec));
      const all = avg(rs.map((r) => r.durationSec));
      const ok = rs.every((r) => r.status === 'completed');
      return `${n}명 ${first.toFixed(0)}~${all.toFixed(0)}초${ok ? '' : '✗'}`;
    })
    .filter(Boolean)
    .join('  ');
  const thirty = by(30);
  const assists = perMap.reduce((a, r) => a + r.assistCount, 0);
  console.log(
    `${map.id.padEnd(15)} ${map.category === 'classic' ? '기본' : '확장'}  ${line}`,
  );
  if (thirty.length) {
    console.log(
      `${''.padEnd(15)} 30명: 첫 ${avg(thirty.map((r) => r.finishTimes[0] ?? 0)).toFixed(1)}초 · ` +
        `절반 ${avg(thirty.map((r) => r.finishTimes[Math.floor(r.finishTimes.length / 2)] ?? 0)).toFixed(1)}초 · ` +
        `전원 ${avg(thirty.map((r) => r.durationSec)).toFixed(1)}초`,
    );
  }
  console.log(
    `${''.padEnd(15)} 탈출보조 ${assists}회 · 최대계산 ${Math.max(...perMap.map((r) => r.wallMs))}ms`,
  );
}

console.log('');
if (problems.length === 0) {
  console.log(`문제 없음. 가장 오래 걸린 한 판의 계산 시간 ${worstWall}ms`);
} else {
  console.log(`문제 ${problems.length}건:`);
  for (const p of problems.slice(0, 40)) console.log('  -', p);
  if (problems.length > 40) console.log(`  ... 외 ${problems.length - 40}건`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ results, problems }, null, 2));
  console.log(`\n결과를 ${jsonOut} 에 적었습니다.`);
}

process.exit(problems.length > 0 ? 1 : 0);
