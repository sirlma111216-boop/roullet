/**
 * 원본(lazygyu/roulette, MIT)의 맵 데이터에서 기본 4개 맵을 뽑아낸다.
 *
 * 왜 스크립트인가: 눈대중으로 베끼면 외곽선·분기·회전 방향이 미묘하게 달라진다.
 * 고정한 커밋에서 내려받아 기계적으로 옮기고, 사람이 정하는 것(구간·기준선·결승·이름)만
 * 아래 META 에 손으로 적는다. 다시 돌리면 같은 결과가 나온다.
 *
 *   node tools/derive-classic-maps.mjs
 *
 * 출처와 라이선스는 THIRD_PARTY_NOTICES.md 를 보라.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packages/game-core/src/maps');
const CACHE = join(ROOT, 'tools/.cache');

/** 이 커밋의 src/data/maps.ts 를 기준으로 옮겼다. */
export const SOURCE_COMMIT = '47230e32242e1c82030eacb4a263420fe95cedb6';
const SOURCE_URL = `https://raw.githubusercontent.com/lazygyu/roulette/${SOURCE_COMMIT}/src/data/maps.ts`;

/** 위로 뻗은 벽은 y=-300 까지 간다. 구슬은 아무리 많아도 -6 위로 안 가므로 잘라 쓴다. */
const TOP_CLIP = -20;

async function loadStages() {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, `maps-${SOURCE_COMMIT}.ts`);
  if (!existsSync(cached)) {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`원본을 받지 못했습니다: ${res.status}`);
    writeFileSync(cached, await res.text());
  }
  let src = readFileSync(cached, 'utf8');
  src = src.replace(/^import type .*$/m, '');
  src = src.replace(/export type AdBoard = \{[\s\S]*?\n\};/, '');
  src = src.replace(/export type StageDef = \{[\s\S]*?\n\};/, '');
  src = src.replace('export const stages: StageDef[] =', 'globalThis.__stages =');
  // 광고판 정보는 새 서비스에 넣지 않는다 — 통째로 버린다.
  const mod = new Function(src.replace(/export /g, ''));
  mod();
  return globalThis.__stages;
}

const r2 = (n) => Math.round(n * 1000) / 1000;

/**
 * 각도를 -π..π 로 접는다.
 *
 * 원본 데이터에는 rotation 이 -45 같은 큰 값으로 적혀 있다. 원본은 물리(SetAsBox 의 angle)와
 * 그림(ctx.rotate) 모두에 **라디안 그대로** 넘기므로, 우리도 값을 바꾸지 않는다.
 * 여기서는 같은 각을 읽기 좋은 범위로 접기만 한다 — 회전 결과는 완전히 같다.
 */
function wrapAngle(a) {
  const TWO = Math.PI * 2;
  let v = a % TWO;
  if (v > Math.PI) v -= TWO;
  if (v < -Math.PI) v += TWO;
  return r2(v);
}

/**
 * 사람이 정하는 부분.
 * goalY 는 원본 값을 그대로 쓴다(원본은 `marble.y > goalY` 로 판정했다).
 */
const META = {
  'Wheel of fortune': {
    id: 'classic-wheel',
    name: '회전 관문',
    description: '굴곡 통로를 지나 경사 장애물과 교차 회전 막대를 통과하고, 핀 구간을 거쳐 좁은 결승 관문으로 들어간다.',
    highlights: ['굴곡 통로', '교차 회전 막대', '핀 구간', '좁은 결승 관문'],
    origin: { originalTitle: 'Wheel of fortune', note: '원본의 외곽선·구간 순서·회전 방향·결승 병목을 계승했다.' },
    bounds: { x: 0, y: TOP_CLIP, w: 26, h: 140 },
    preview: { x: 0, y: -8, w: 26, h: 124 },
    spawn: { area: { x: 9.7, y: -8, w: 6.35, h: 10 }, perRow: 10, gap: 0.62 },
    // 좌우 벽의 같은 순번 점을 이은 중심선 (아래 buildCenterline 이 만든다)
    centerline: { left: 0, right: 1 },
    checkpointYs: [
      [22, '굴곡 통로'],
      [40, '경사 장애물'],
      [56, '교차 회전 막대'],
      [80, '핀 구간'],
      [104, '결승 관문'],
    ],
    estimatedDurationSec: [11, 53],
    timeLimitSec: 150,
  },
  BubblePop: {
    id: 'classic-bubble',
    name: '버블 계곡',
    description: '원형 장애물을 터뜨리며 지그재그 구간과 다각형 지형을 지나고, 회전 장치가 지키는 좁은 출구로 빠져나간다.',
    highlights: ['터지는 원형 장애물', '지그재그 구간', '다각형 지형', '회전 장치와 좁은 출구'],
    origin: { originalTitle: 'BubblePop', note: '터지는 원형 장애물과 출구 회전 장치, 좁은 결승 통로를 계승했다.' },
    bounds: { x: 0, y: TOP_CLIP, w: 26, h: 112 },
    preview: { x: 2, y: -8, w: 22, h: 96 },
    spawn: { area: { x: 9.7, y: -8, w: 6.35, h: 10 }, perRow: 10, gap: 0.62 },
    centerline: { left: 0, right: 1 },
    checkpointYs: [
      [20, '첫 낙하'],
      [34, '지그재그'],
      [48, '버블 구간'],
      [64, '다각형 지형'],
      [76, '좁은 출구'],
    ],
    estimatedDurationSec: [14, 21],
    timeLimitSec: 150,
  },
  'Pot of greed': {
    id: 'classic-jar',
    name: '항아리 탈출',
    description: '넓은 상부에서 큰 회전 발판들에 부딪히며 내려오다가, 항아리 바닥의 양쪽 통로 중 한쪽을 골라 중앙 출구로 빠져나간다.',
    highlights: ['넓은 상부', '큰 회전 발판', '하부 중앙 구조', '양쪽 통로 분기'],
    origin: { originalTitle: 'Pot of greed', note: '넓은 상부와 하부 중앙 구조, 양쪽 통로와 회전 발판 배치를 계승했다.' },
    bounds: { x: 0, y: TOP_CLIP, w: 26, h: 120 },
    preview: { x: 0, y: -8, w: 26, h: 104 },
    spawn: { area: { x: 9.45, y: -8, w: 7.1, h: 10 }, perRow: 10, gap: 0.62 },
    centerline: { left: 0, right: 2 },
    // 항아리 바닥에서 중앙 출구로 내려가는 길을 손으로 잇는다
    tailPath: [
      [13, 62],
      [13, 70],
      [13, 78],
      [13, 84],
      [13, 88],
      [13, 93],
    ],
    checkpointYs: [
      [18, '넓은 상부'],
      [35, '회전 발판'],
      [55, '항아리 허리'],
      [72, '바닥 분기'],
      [86, '중앙 출구'],
    ],
    estimatedDurationSec: [5, 72],
    timeLimitSec: 150,
  },
  'Yoru ni Kakeru': {
    id: 'classic-night',
    name: '네온 장거리',
    description: '긴 다단 코스를 따라 여러 색 회전 막대와 원형 장애물 군집, 경사로가 이어진다. 여덟 맵 가운데 가장 길다.',
    highlights: ['긴 다단 코스', '여러 색 회전 막대', '원형 장애물 군집', '연속 경사로'],
    origin: { originalTitle: 'Yoru ni Kakeru (by item4)', note: '긴 코스의 구간 순서와 장애물 군집 배치를 계승했다.' },
    bounds: { x: 0, y: TOP_CLIP, w: 24, h: 275 },
    preview: { x: 1, y: -8, w: 22, h: 262 },
    spawn: { area: { x: 8.2, y: -8, w: 6.6, h: 10 }, perRow: 10, gap: 0.62 },
    // 좌우 벽이 거대한 박스라 중심선을 쌍으로 만들 수 없다 — 가운데를 곧게 내려간다
    verticalPath: { x: 11.5, from: -8, to: 250, step: 6 },
    checkpointYs: [
      [30, '첫 핀 구간'],
      [70, '원형 장애물 군집'],
      [110, '중반 회전 막대'],
      [150, '후반 군집'],
      [200, '마지막 회전 발판'],
      [240, '결승 직선'],
    ],
    estimatedDurationSec: [20, 37],
    timeLimitSec: 240,
  },
};

/* ------------------------------------------------------------------ 변환 */

function convertEntities(entities) {
  const obstacles = [];
  const devices = [];
  for (const e of entities) {
    const { position: pos, shape, props, type } = e;
    if (shape.type === 'polyline') {
      const pts = shape.points.map(([x, y]) => [r2(pos.x + x), Math.max(TOP_CLIP, r2(pos.y + y))]);
      // 잘라 낸 뒤 같은 자리에 겹친 점은 하나로 줄인다
      const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
      if (dedup.length >= 2) {
        obstacles.push({ t: 'wall', points: dedup, style: 'wall' });
      }
    } else if (shape.type === 'box') {
      if (type === 'kinematic' && props.angularVelocity) {
        devices.push({
          t: 'spinner',
          x: r2(pos.x),
          y: r2(pos.y),
          hw: r2(shape.width),
          hh: r2(shape.height),
          omega: r2(props.angularVelocity),
          angle: wrapAngle(shape.rotation || 0),
          style: shape.color ? 'bar' : 'spinner',
        });
      } else {
        obstacles.push({
          t: 'box',
          x: r2(pos.x),
          y: r2(pos.y),
          hw: r2(shape.width),
          hh: r2(shape.height),
          angle: wrapAngle(shape.rotation || 0),
          style: 'box',
          restitution: props.restitution ?? 0.1,
        });
      }
    } else if (shape.type === 'circle') {
      const pop = (props.life ?? -1) > 0;
      obstacles.push({
        t: 'circle',
        x: r2(pos.x),
        y: r2(pos.y),
        r: r2(shape.radius),
        pop,
        style: pop ? 'bubble' : 'circle',
        restitution: props.restitution ?? (pop ? 1.2 : 0.3),
      });
    }
  }
  return { obstacles, devices };
}

/** 좌우 벽의 같은 순번 점을 이어 코스 중심선을 만든다 */
function buildCenterline(entities, leftIdx, rightIdx) {
  const pls = entities.filter((e) => e.shape.type === 'polyline');
  const L = pls[leftIdx];
  const R = pls[rightIdx];
  if (!L || !R) throw new Error('중심선을 만들 벽을 찾지 못했습니다.');
  // 점마다 먼저 잘라 낸 뒤 평균을 낸다.
  // (평균을 내고 나서 자르면 위쪽 점들이 모두 같은 값이 되어 한 점으로 뭉개진다.)
  const clip = (y) => Math.max(TOP_CLIP, y);
  const lp = L.shape.points.map(([x, y]) => [L.position.x + x, clip(L.position.y + y)]);
  const rp = R.shape.points.map(([x, y]) => [R.position.x + x, clip(R.position.y + y)]);
  const n = Math.min(lp.length, rp.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = r2((lp[i][0] + rp[i][0]) / 2);
    const y = r2((lp[i][1] + rp[i][1]) / 2);
    if (out.length === 0 || out[out.length - 1][1] < y) out.push([x, y]);
  }
  return out;
}

function verticalPath({ x, from, to, step }) {
  const out = [];
  for (let y = from; y < to; y += step) out.push([x, y]);
  out.push([x, to]);
  return out;
}

/* ------------------------------------------------------------------ 쓰기 */

const j = (v) => JSON.stringify(v);

function emit(meta, stage, converted, path) {
  const goalY = stage.goalY;
  const b = meta.bounds;
  const finish = { x: b.x, y: goalY, w: b.w, h: 6 };
  const checkpoints = meta.checkpointYs.map(([y, name], i) => ({
    id: `cp${i + 1}`,
    name,
    area: { x: b.x, y, w: b.w, h: 2 },
  }));

  const lines = [];
  lines.push('/**');
  lines.push(` * ${meta.name} (${meta.id})`);
  lines.push(' *');
  lines.push(' * 이 파일은 tools/derive-classic-maps.mjs 가 만든다. 손으로 고치지 말고 그 스크립트를 고쳐라.');
  lines.push(` * 원본: lazygyu/roulette (MIT) 커밋 ${SOURCE_COMMIT} 의 src/data/maps.ts — "${meta.origin.originalTitle}"`);
  lines.push(' * 자세한 출처와 라이선스는 THIRD_PARTY_NOTICES.md 를 보라.');
  lines.push(' */');
  lines.push('');
  lines.push("import type { MapDefinition } from '../map/types.ts';");
  lines.push('');
  lines.push(`export const ${toCamel(meta.id)}: MapDefinition = {`);
  lines.push(`  id: ${j(meta.id)},`);
  lines.push('  version: 1,');
  lines.push(`  name: ${j(meta.name)},`);
  lines.push("  category: 'classic',");
  lines.push(`  description: ${j(meta.description)},`);
  lines.push(`  highlights: ${j(meta.highlights)},`);
  lines.push(`  origin: ${j(meta.origin)},`);
  lines.push(`  bounds: ${j(b)},`);
  lines.push(`  preview: ${j(meta.preview)},`);
  lines.push(`  spawn: ${j(meta.spawn)},`);
  lines.push(`  finish: { area: ${j(finish)} },`);
  lines.push(`  checkpoints: ${j(checkpoints)},`);
  lines.push(`  estimatedDurationSec: ${j(meta.estimatedDurationSec)},`);
  lines.push(`  timeLimitSec: ${meta.timeLimitSec},`);
  lines.push('  progressPath: [');
  for (const p of path) lines.push(`    ${j(p)},`);
  lines.push('  ],');
  lines.push('  obstacles: [');
  for (const o of converted.obstacles) lines.push(`    ${j(o)},`);
  lines.push('  ],');
  lines.push('  devices: [');
  for (const d of converted.devices) lines.push(`    ${j(d)},`);
  lines.push('  ],');
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const toCamel = (id) => id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

async function main() {
  const stages = await loadStages();
  mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const stage of stages) {
    const meta = META[stage.title];
    if (!meta) {
      console.warn(`건너뜀(대응표에 없음): ${stage.title}`);
      continue;
    }
    const converted = convertEntities(stage.entities || []);
    let path;
    if (meta.verticalPath) {
      path = verticalPath(meta.verticalPath);
    } else {
      const mid = buildCenterline(stage.entities, meta.centerline.left, meta.centerline.right);
      // 기준선은 출발 통로 한가운데에서 시작한다 — 벽이 맞물리는 꼭대기 모서리가 아니라.
      const spawnCx = r2(meta.spawn.area.x + meta.spawn.area.w / 2);
      const startY = TOP_CLIP + 2;
      path = [[spawnCx, startY], ...mid.filter((p) => p[1] > startY + 1)];
      if (meta.tailPath) {
        for (const p of meta.tailPath) if (path[path.length - 1][1] < p[1]) path.push(p);
      }
    }
    // 결승 안쪽까지 기준선을 잇는다
    const goalY = stage.goalY;
    if (path[path.length - 1][1] < goalY + 2) {
      path.push([path[path.length - 1][0], goalY + 2]);
    }

    const file = join(OUT_DIR, `${meta.id}.ts`);
    writeFileSync(file, emit(meta, stage, converted, path), 'utf8');
    console.log(
      `${meta.id}: 장애물 ${converted.obstacles.length}, 장치 ${converted.devices.length}, 기준선 ${path.length}점, goalY ${goalY}`,
    );
    count++;
  }
  if (count !== 4) throw new Error(`기본 맵 4개가 나와야 하는데 ${count}개만 만들어졌습니다.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
