/**
 * 맵이 지켜야 할 규칙.
 *
 * 여기 있는 검사는 전부 «실제로 한 번 깨져서» 생겼다. 맵을 고칠 때 이 검사가 빨갛게 되면
 * 그 자리에서 무슨 일이 났었는지 각 검사의 설명을 읽어라.
 */

import { describe, expect, it } from 'vitest';
import { ALL_MAPS, getMap, MAP_IDS } from './index.ts';
import type { DeviceDef, MapDefinition } from '../map/types.ts';
import { MAX_RESTING_SLOPE } from '../physics/world.ts';
import { rectContains } from '../math/vec2.ts';
import { MAX_CAPACITY } from '@marble/protocol';

const devicesOf = <K extends DeviceDef['t']>(map: MapDefinition, kind: K) =>
  map.devices.filter((d): d is Extract<DeviceDef, { t: K }> => d.t === kind);

describe('맵 등록표', () => {
  it('정확히 8개이고, 기본 4개 + 확장 4개다', () => {
    expect(ALL_MAPS).toHaveLength(8);
    expect(ALL_MAPS.filter((m) => m.category === 'classic')).toHaveLength(4);
    expect(ALL_MAPS.filter((m) => m.category === 'extended')).toHaveLength(4);
  });

  it('id 가 서로 다르고 등록표로 찾을 수 있다', () => {
    expect(new Set(MAP_IDS).size).toBe(8);
    for (const id of MAP_IDS) expect(getMap(id)?.id).toBe(id);
  });

  it('이름·설명이 서로 다르다 — 같은 맵을 색만 바꿔 여러 개로 세지 않는다', () => {
    expect(new Set(ALL_MAPS.map((m) => m.name)).size).toBe(8);
    expect(new Set(ALL_MAPS.map((m) => m.description)).size).toBe(8);
  });

  it('기본 4개는 원본 대응을 기록해 두었다', () => {
    for (const m of ALL_MAPS.filter((m) => m.category === 'classic')) {
      expect(m.origin?.originalTitle, `${m.id} 에 원본 대응이 없습니다`).toBeTruthy();
    }
  });

  it('같은 장애물·장치 배치를 그대로 베낀 맵이 없다', () => {
    const shapes = ALL_MAPS.map((m) => JSON.stringify([m.obstacles, m.devices]));
    expect(new Set(shapes).size).toBe(8);
  });
});

describe.each(ALL_MAPS.map((m) => [m.id, m] as const))('%s 의 생김새', (_id, map) => {
  it('출발 영역이 맵 안에 있고, 100명이 들어가도 넘치지 않는다', () => {
    const { area, perRow, gap } = map.spawn;
    expect(area.x).toBeGreaterThanOrEqual(map.bounds.x);
    expect(area.x + area.w).toBeLessThanOrEqual(map.bounds.x + map.bounds.w);

    // 100명이면 몇 줄이 쌓이는지 — 맨 윗줄이 맵 천장 위로 올라가면 안 된다
    const rows = Math.ceil(MAX_CAPACITY / perRow);
    const topY = area.y + area.h - (rows - 0.5) * gap;
    expect(topY, `${_id}: 100명일 때 맨 윗줄이 맵 밖입니다`).toBeGreaterThan(map.bounds.y);
  });

  it('결승 영역이 출발보다 아래에 있다', () => {
    expect(map.finish.area.y).toBeGreaterThan(map.spawn.area.y + map.spawn.area.h);
  });

  it('구간(checkpoint)이 순서대로 내려간다', () => {
    expect(map.checkpoints.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < map.checkpoints.length; i++) {
      expect(map.checkpoints[i]!.area.y).toBeGreaterThan(map.checkpoints[i - 1]!.area.y);
    }
    // 마지막 구간은 결승보다 위여야 한다
    const last = map.checkpoints[map.checkpoints.length - 1]!;
    expect(last.area.y).toBeLessThan(map.finish.area.y);
  });

  it('진행 기준선이 출발 근처에서 시작해 결승 안에서 끝난다', () => {
    const pts = map.progressPath;
    expect(pts.length).toBeGreaterThanOrEqual(2);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    expect(first[1]).toBeLessThanOrEqual(map.spawn.area.y + map.spawn.area.h);
    expect(last[1]).toBeGreaterThanOrEqual(map.finish.area.y);
    // 기준선은 아래로만 간다 — 되돌아가면 진행률이 뒤집힌다
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]![1], `${_id}: 기준선 ${i}번째 점이 위로 올라갑니다`).toBeGreaterThan(pts[i - 1]![1]);
    }
  });

  it('구간 띠가 기준선을 가로지른다 — 지나칠 수 없어야 순위가 맞는다', () => {
    for (const cp of map.checkpoints) {
      const crossing = map.progressPath.some((p) => rectContains(cp.area, { x: p[0], y: p[1] }));
      const spans =
        cp.area.x <= map.bounds.x + 0.001 && cp.area.x + cp.area.w >= map.bounds.x + map.bounds.w - 0.001;
      expect(crossing || spans, `${_id}: 구간 ${cp.id} 이 코스를 가로지르지 않습니다`).toBe(true);
    }
  });

  it('제한시간과 예상 길이가 적혀 있다', () => {
    expect(map.timeLimitSec).toBeGreaterThan(30);
    expect(map.estimatedDurationSec).toHaveLength(2);
  });
});

describe('장치 규칙', () => {
  /**
   * 포털은 「한 방향 + 아래로만」이다.
   * 양방향이면 두 입구 사이를 끝없이 오갈 수 있고, 출구가 위에 있으면 고리가 생긴다.
   */
  it('모든 포털은 한 방향이고, 나오는 자리가 들어간 자리보다 아래다', () => {
    for (const map of ALL_MAPS) {
      for (const p of devicesOf(map, 'portal')) {
        expect(p.oneWay, `${map.id}: 양방향 포털은 왕복을 만든다`).toBe(true);
        expect(p.b.y, `${map.id}: 포털 출구가 입구보다 위에 있다`).toBeGreaterThan(p.a.y);
        expect(p.cooldownMs).toBeGreaterThan(0);
      }
    }
  });

  it('포털 출구가 결승 구역보다 위다 — 포털로 결승을 건너뛸 수 없다', () => {
    for (const map of ALL_MAPS) {
      for (const p of devicesOf(map, 'portal')) {
        expect(p.b.y + p.b.r).toBeLessThan(map.finish.area.y);
      }
    }
  });

  /**
   * 되튐이 1 을 넘는 평평한 바닥은 제자리 진동을 만든다.
   * 종합 운동장의 가운데 탄성 발판이 평평했을 때, 구슬 하나가 그 위에서 수직으로만
   * 튀며 제한시간까지 안 내려왔다.
   */
  it('되튐이 1 을 넘는 바닥은 평평하지 않다', () => {
    for (const map of ALL_MAPS) {
      for (const s of devicesOf(map, 'spring')) {
        if (s.restitution > 1) {
          expect(Math.abs(s.angle ?? 0), `${map.id}: 평평한 탄성 발판(되튐 ${s.restitution})`).toBeGreaterThan(
            0.05,
          );
        }
      }
    }
  });

  /**
   * 개폐문이 둘 다 닫히는 순간이 있으면, 빠르게 오가는 구슬이 두 구멍을 번갈아 놓친다.
   * 자석 공장에서 실제로 그렇게 한 판이 제한시간을 넘겼다.
   */
  it('자석 공장의 개폐문은 동시에 닫히지 않는다', () => {
    const map = getMap('mix-magnet')!;
    const gates = devicesOf(map, 'gate');
    expect(gates).toHaveLength(2);
    const closedAt = (g: (typeof gates)[number], t: number) => {
      const period = g.openMs + g.closedMs;
      const phase = (g.phase ?? 0) * period;
      const p = (((t + phase) % period) + period) % period;
      return p < g.closedMs;
    };
    const period = (gates[0]!.openMs + gates[0]!.closedMs) * (gates[1]!.openMs + gates[1]!.closedMs);
    for (let t = 0; t < Math.min(period, 30_000); t += 25) {
      const bothClosed = gates.every((g) => closedAt(g, t));
      expect(bothClosed, `${t}ms 에 두 문이 모두 닫혀 있습니다`).toBe(false);
    }
  });

  it('자석은 힘의 범위가 기둥보다 크고, 밀어내기만 하지 않는다', () => {
    for (const map of ALL_MAPS) {
      for (const m of devicesOf(map, 'magnet')) {
        expect(m.r).toBeGreaterThan(m.coreRadius * 2);
        expect(m.onMs).toBeGreaterThan(0);
        expect(m.offMs, '자석이 꺼지는 시간이 없으면 구슬이 붙어 버린다').toBeGreaterThan(0);
      }
    }
  });

  it('컨베이어는 표면 속도가 0 이 아니다 — 장식이 아니라 실제로 끌어야 한다', () => {
    for (const map of ALL_MAPS) {
      for (const c of devicesOf(map, 'conveyor')) {
        expect(Math.abs(c.speed)).toBeGreaterThan(1);
      }
    }
  });

  it('바람·가속·느린 구역은 실제로 힘이 있다', () => {
    for (const map of ALL_MAPS) {
      for (const w of devicesOf(map, 'wind')) {
        expect(Math.hypot(w.ax, w.ay), `${map.id}: 힘이 없는 바람 구역`).toBeGreaterThan(0.5);
        expect(w.onMs).toBeGreaterThan(0);
      }
      for (const b of devicesOf(map, 'booster')) {
        expect(Math.hypot(b.ax, b.ay)).toBeGreaterThan(0.5);
      }
      for (const s of devicesOf(map, 'slow')) {
        expect(s.retainPerSec).toBeGreaterThan(0);
        expect(s.retainPerSec).toBeLessThan(1);
      }
    }
  });

  it('회전하는 장치는 각속도가 0 이 아니다', () => {
    for (const map of ALL_MAPS) {
      for (const d of map.devices) {
        if (d.t === 'spinner' || d.t === 'windmill' || d.t === 'revolvingDoor') {
          expect(Math.abs(d.omega), `${map.id}: 안 도는 회전 장치`).toBeGreaterThan(0.01);
        }
      }
    }
  });

  it('확장 맵 넷은 각자 다른 주력 장치를 쓴다', () => {
    const kindsOf = (id: string) => new Set(getMap(id)!.devices.map((d) => d.t));
    expect(kindsOf('mix-wind')).toContain('wind');
    expect(kindsOf('mix-portal')).toContain('portal');
    expect(kindsOf('mix-portal')).toContain('revolvingDoor');
    expect(kindsOf('mix-magnet')).toContain('magnet');
    expect(kindsOf('mix-magnet')).toContain('conveyor');
    expect(kindsOf('mix-magnet')).toContain('gate');
    expect(kindsOf('mix-festival')).toContain('windmill');
    expect(kindsOf('mix-festival')).toContain('spring');
    expect(kindsOf('mix-festival')).toContain('seesaw');
  });
});

describe('경사로', () => {
  /**
   * 이 엔진의 구슬은 회전하지 않아서, 마찰각보다 완만한 경사에서는 «서 버린다».
   * 포털 연구소에서 12.6° 경사에 구슬이 멈춰 제한시간을 넘긴 적이 있다.
   */
  it('바닥 노릇을 하는 사각 장애물은 구슬이 설 수 있는 경사보다 가파르거나, 아예 벽처럼 서 있다', () => {
    const tooGentle: string[] = [];
    for (const map of ALL_MAPS) {
      // 확장 맵만 본다 — 기본 4개는 원본 배치를 그대로 물려받았고,
      // 평평한 면이 있어도 원본의 구성이므로 고치지 않는다(탈출 보조가 받아 준다).
      if (map.category !== 'extended') continue;
      for (const o of map.obstacles) {
        if (o.t !== 'box') continue;
        const a = Math.abs(((o.angle ?? 0) + Math.PI / 2) % Math.PI) - Math.PI / 2;
        const slope = Math.abs(a);
        // 세로로 선 것(칸막이 기둥)은 바닥이 아니다
        const isWallLike = o.hh > o.hw;
        if (isWallLike) continue;
        if (slope <= MAX_RESTING_SLOPE) tooGentle.push(`${map.id} (${o.x}, ${o.y}) 기울기 ${slope.toFixed(3)}`);
      }
    }
    expect(tooGentle, `구슬이 서 버릴 수 있는 완만한 바닥:\n${tooGentle.join('\n')}`).toEqual([]);
  });
});
