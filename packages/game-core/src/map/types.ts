/**
 * 맵은 «데이터» 다.
 *
 * 물리·그림 코드는 맵마다 복제하지 않는다. 맵은 아래 조각들을 늘어놓기만 하고,
 * 그 조각을 실제 물체로 만드는 일은 buildMap() 과 devices/ 가 한곳에서 맡는다.
 */

import type { Rect } from '../math/vec2.ts';

export type MapId =
  | 'classic-wheel'
  | 'classic-bubble'
  | 'classic-jar'
  | 'classic-night'
  | 'mix-wind'
  | 'mix-portal'
  | 'mix-magnet'
  | 'mix-festival';

export type MapCategory = 'classic' | 'extended';

/* ------------------------------------------------------------------ 고정 장애물 */

/** 벽·바닥 — 이어진 선. 구슬이 절대 뚫지 못하는 경계로도 쓴다. */
export interface WallDef {
  t: 'wall';
  points: Array<[number, number]>;
  /** 선의 두께(반지름). 0 이면 얇은 벽. */
  thickness?: number;
  style?: string;
  restitution?: number;
  friction?: number;
}

/** 고정된 사각 장애물. hw·hh 는 절반 길이. */
export interface BoxDef {
  t: 'box';
  x: number;
  y: number;
  hw: number;
  hh: number;
  angle?: number;
  style?: string;
  restitution?: number;
  friction?: number;
}

/** 고정된 원형 장애물. pop 이면 한 번 닿을 때 터진다(버블). */
export interface CircleDef {
  t: 'circle';
  x: number;
  y: number;
  r: number;
  pop?: boolean;
  style?: string;
  restitution?: number;
  friction?: number;
}

export type ObstacleDef = WallDef | BoxDef | CircleDef;

/* ------------------------------------------------------------------ 장치 */

/** 일정한 속도로 도는 막대 (원본의 kinematic box) */
export interface SpinnerDef {
  t: 'spinner';
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** 각속도(rad/s). 부호가 회전 방향이다. */
  omega: number;
  /** 시작 각도 */
  angle?: number;
  style?: string;
}

/** 여러 날개가 한 축에서 도는 풍차 */
export interface WindmillDef {
  t: 'windmill';
  x: number;
  y: number;
  arms: number;
  hw: number;
  hh: number;
  omega: number;
  angle?: number;
  style?: string;
}

/** 좌우로 기우는 시소 */
export interface SeesawDef {
  t: 'seesaw';
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** 최대 기울기(rad) */
  maxAngle: number;
  /** 한 번 왕복하는 데 걸리는 시간(ms) */
  periodMs: number;
  phase?: number;
  style?: string;
}

/** 주기적으로 열리고 닫히는 문 — 닫히면 길을 막는다 */
export interface GateDef {
  t: 'gate';
  x: number;
  y: number;
  hw: number;
  hh: number;
  angle?: number;
  openMs: number;
  closedMs: number;
  phase?: number;
  /** 열릴 때 미끄러져 들어가는 거리와 방향 */
  slideX: number;
  slideY: number;
  style?: string;
}

/** 표면이 흐르는 바닥 */
export interface ConveyorDef {
  t: 'conveyor';
  x: number;
  y: number;
  hw: number;
  hh: number;
  angle?: number;
  /** 표면 속도. 부호가 방향이다. */
  speed: number;
  style?: string;
}

/** 튕기는 범퍼 */
export interface BumperDef {
  t: 'bumper';
  x: number;
  y: number;
  r: number;
  restitution: number;
  style?: string;
}

/** 탄성 발판 — 밟으면 튀어 오른다 */
export interface SpringDef {
  t: 'spring';
  x: number;
  y: number;
  hw: number;
  hh: number;
  angle?: number;
  restitution: number;
  style?: string;
}

/** 켜졌다 꺼졌다 하는 바람 구역 */
export interface WindDef {
  t: 'wind';
  area: Rect;
  /** 가속도(u/s²) */
  ax: number;
  ay: number;
  onMs: number;
  offMs: number;
  phase?: number;
  style?: string;
}

/** 짝지어진 포털 */
export interface PortalDef {
  t: 'portal';
  a: { x: number; y: number; r: number };
  b: { x: number; y: number; r: number };
  /** 나온 뒤 다시 들어갈 수 없는 시간 */
  cooldownMs: number;
  /** true 면 a → b 로만 간다 */
  oneWay?: boolean;
  /** 나올 때 속도에 곱하는 값 */
  exitBoost?: number;
  style?: string;
}

/** 주기적으로 켜지는 자력 구역. 가운데는 실제로 만질 수 있는 원기둥이다. */
export interface MagnetDef {
  t: 'magnet';
  x: number;
  y: number;
  /** 힘이 닿는 범위 */
  r: number;
  /** 가운데 기둥의 반지름(여기에 부딪힌다) */
  coreRadius: number;
  /** 끌어당기는 세기. 음수면 밀어낸다. */
  strength: number;
  onMs: number;
  offMs: number;
  phase?: number;
  style?: string;
}

/** 가속 바닥 */
export interface BoosterDef {
  t: 'booster';
  area: Rect;
  ax: number;
  ay: number;
  /** 이 속도까지만 밀어 준다 */
  maxSpeed: number;
  style?: string;
}

/** 느린 구역 */
export interface SlowDef {
  t: 'slow';
  area: Rect;
  /** 1초에 남는 속도 비율(0.3 이면 빠르게 느려진다) */
  retainPerSec: number;
  style?: string;
}

/** 회전문 — 가운데 축에 날개가 달려 한 칸씩 통과시킨다 */
export interface RevolvingDoorDef {
  t: 'revolvingDoor';
  x: number;
  y: number;
  r: number;
  blades: number;
  omega: number;
  style?: string;
}

export type DeviceDef =
  | SpinnerDef
  | WindmillDef
  | SeesawDef
  | GateDef
  | ConveyorDef
  | BumperDef
  | SpringDef
  | WindDef
  | PortalDef
  | MagnetDef
  | BoosterDef
  | SlowDef
  | RevolvingDoorDef;

export type DeviceKind = DeviceDef['t'];

/* ------------------------------------------------------------------ 맵 */

export interface Checkpoint {
  id: string;
  /** 화면·기록에 쓰는 구간 이름 */
  name: string;
  area: Rect;
}

export interface MapDefinition {
  id: MapId;
  /** 맵을 고칠 때마다 올린다. 결과 기록에 함께 남는다. */
  version: number;
  /** 새 서비스에서 쓰는 이름 */
  name: string;
  category: MapCategory;
  description: string;
  /** 카드에 적는 핵심 장치 */
  highlights: string[];
  /**
   * 원본 대응 — **개발 문서용**이다. 새 UI 에는 쓰지 않는다.
   * (THIRD_PARTY_NOTICES.md 의 대응표와 짝을 이룬다.)
   */
  origin?: { originalTitle: string; note: string };

  bounds: Rect;
  /** 미리보기 카드가 잡는 화면 */
  preview: Rect;

  spawn: {
    area: Rect;
    /** 한 줄에 몇 개까지 놓을지 */
    perRow: number;
    /** 구슬 사이 간격 */
    gap: number;
  };

  obstacles: ObstacleDef[];
  devices: DeviceDef[];
  checkpoints: Checkpoint[];
  finish: { area: Rect };

  /** 진행률을 재는 기준선. 출발에서 결승까지 이어진다. */
  progressPath: Array<[number, number]>;

  /** 30명 경기에서 예상되는 길이(초) — 실제 측정치로 채운다 */
  estimatedDurationSec: [number, number];
  /** 이 시간을 넘기면 멈춘다. 당첨자를 만들어 내지 않는다. */
  timeLimitSec: number;
}
