/** 여덟 맵 등록표. 새 맵을 더하면 여기에만 적으면 된다. */

import type { MapDefinition, MapId } from '../map/types.ts';
import { classicWheel } from './classic-wheel.ts';
import { classicBubble } from './classic-bubble.ts';
import { classicJar } from './classic-jar.ts';
import { classicNight } from './classic-night.ts';
import { mixWind } from './mix-wind.ts';
import { mixPortal } from './mix-portal.ts';
import { mixMagnet } from './mix-magnet.ts';
import { mixFestival } from './mix-festival.ts';

/** 화면에 보이는 순서 — 기본 4개 먼저, 확장 4개 뒤 */
export const ALL_MAPS: readonly MapDefinition[] = [
  classicWheel,
  classicBubble,
  classicJar,
  classicNight,
  mixWind,
  mixPortal,
  mixMagnet,
  mixFestival,
];

export const MAP_IDS: readonly MapId[] = ALL_MAPS.map((m) => m.id);

const BY_ID = new Map<string, MapDefinition>(ALL_MAPS.map((m) => [m.id, m]));

export function getMap(id: string): MapDefinition | undefined {
  return BY_ID.get(id);
}

/** 모르는 id 면 던진다 — 조용히 다른 맵으로 바꿔 치지 않는다 */
export function requireMap(id: string): MapDefinition {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`모르는 맵입니다: ${id}`);
  return m;
}

export const DEFAULT_MAP_ID: MapId = 'classic-wheel';

export {
  classicWheel,
  classicBubble,
  classicJar,
  classicNight,
  mixWind,
  mixPortal,
  mixMagnet,
  mixFestival,
};
