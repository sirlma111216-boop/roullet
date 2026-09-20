/**
 * 맵 데이터 → 실제 물리 세계.
 *
 * 맵마다 따로 만드는 코드는 없다. 여기 한 벌이 여덟 맵 모두를 세운다.
 */

import { createDevice, type RuntimeDevice } from '../devices/index.ts';
import type { MapDefinition, ObstacleDef } from './types.ts';
import { World } from '../physics/world.ts';

export interface BuiltMap {
  world: World;
  devices: RuntimeDevice[];
  /** 구역 효과를 가진 장치만 추려 둔 것 */
  zoneDevices: RuntimeDevice[];
  /** 콜라이더 id → 장치 번호 (접촉 효과를 되돌려 주려고) */
  deviceOfCollider: Map<number, number>;
  /**
   * 콜라이더 id → 맵 데이터의 장애물 번호.
   * 터진 버블을 학생 화면에도 알려 주려면, 콜라이더 id 가 아니라
   * 「맵 데이터 몇 번째 장애물인가」로 보내야 한다(id 는 만든 순서에 따라 달라진다).
   */
  obstacleOfCollider: Map<number, number>;
}

function addObstacle(world: World, o: ObstacleDef): void {
  switch (o.t) {
    case 'wall': {
      const thickness = o.thickness ?? 0;
      for (let i = 0; i < o.points.length - 1; i++) {
        const a = o.points[i]!;
        const b = o.points[i + 1]!;
        world.addCollider({
          shape: { kind: 'segment', ax: a[0], ay: a[1], bx: b[0], by: b[1], r: thickness },
          x: 0,
          y: 0,
          style: o.style ?? 'wall',
          restitution: o.restitution ?? 0.05,
          friction: o.friction ?? 0.3,
        });
      }
      break;
    }
    case 'box':
      world.addCollider({
        shape: { kind: 'obb', hw: o.hw, hh: o.hh },
        x: o.x,
        y: o.y,
        angle: o.angle ?? 0,
        style: o.style ?? 'box',
        restitution: o.restitution ?? 0.1,
        friction: o.friction ?? 0.3,
      });
      break;
    case 'circle':
      world.addCollider({
        shape: { kind: 'circle', r: o.r },
        x: o.x,
        y: o.y,
        style: o.style ?? (o.pop ? 'bubble' : 'circle'),
        restitution: o.restitution ?? (o.pop ? 1.2 : 0.3),
        friction: o.friction ?? 0.2,
        life: o.pop ? 1 : -1,
      });
      break;
  }
}

/**
 * 맵 테두리 — 어떤 맵에도 빠짐없이 두르는 마지막 경계.
 *
 * 왜 필요한가: 네온 장거리 맵에는 천장이 없었다. 빠르게 도는 막대에 걷어차인 구슬 하나가
 * 초속 29로 위로 솟구쳐 맵 밖으로 나갔다. 맵마다 천장을 적어 넣게 하는 대신,
 * bounds 를 따라 닫힌 상자를 여기서 한 번에 두른다.
 *
 * 보통 경기에서는 구슬이 여기에 닿지 않는다 — 닿았다면 무언가 잘못된 것이고,
 * 그때도 밖으로 나가지는 않는다.
 */
function addBoundary(world: World, def: MapDefinition): void {
  const b = def.bounds;
  const x0 = b.x;
  const y0 = b.y;
  const x1 = b.x + b.w;
  const y1 = b.y + b.h;
  const corners: Array<[number, number]> = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]!;
    const c = corners[i + 1]!;
    world.addCollider({
      shape: { kind: 'segment', ax: a[0], ay: a[1], bx: c[0], by: c[1], r: 0.2 },
      x: 0,
      y: 0,
      style: 'bounds',
      restitution: 0.02,
      friction: 0.2,
    });
  }
}

export function buildMap(def: MapDefinition): BuiltMap {
  const world = new World();

  addBoundary(world, def);

  const obstacleOfCollider = new Map<number, number>();
  for (let i = 0; i < def.obstacles.length; i++) {
    const before = world.colliders.length;
    addObstacle(world, def.obstacles[i]!);
    // 벽 하나는 선분 여러 개가 된다 — 새로 생긴 것 전부를 이 장애물로 표시한다
    for (let k = before; k < world.colliders.length; k++) {
      obstacleOfCollider.set(world.colliders[k]!.id, i);
    }
  }

  const devices: RuntimeDevice[] = [];
  for (let i = 0; i < def.devices.length; i++) {
    devices.push(createDevice(def.devices[i]!, i, world));
  }

  const deviceOfCollider = new Map<number, number>();
  for (const d of devices) {
    for (const id of d.colliderIds) deviceOfCollider.set(id, d.index);
  }

  const b = def.bounds;
  world.build(b.x, b.y, b.x + b.w, b.y + b.h);

  return {
    world,
    devices,
    zoneDevices: devices.filter((d) => typeof d.affect === 'function'),
    deviceOfCollider,
    obstacleOfCollider,
  };
}
