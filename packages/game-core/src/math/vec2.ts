/** 2차원 벡터. y 는 아래로 자란다(원본 좌표계를 그대로 물려받았다). */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2차원 외적의 스칼라 부분 (a × b) */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 축에 나란한 사각형. x,y 는 왼쪽 위 모서리. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 점 p 에서 선분 ab 위의 가장 가까운 점 */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const d = abx * abx + aby * aby;
  if (d < 1e-12) return { point: { x: a.x, y: a.y }, t: 0 };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / d;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { point: { x: a.x + abx * t, y: a.y + aby * t }, t };
}

/** 점 p 와 선분 ab 사이의 거리 */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const { point } = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - point.x, p.y - point.y);
}
