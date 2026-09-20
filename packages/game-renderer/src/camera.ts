/**
 * 카메라.
 *
 * 세 가지 모드를 둔다.
 *  - whole  : 코스 전체(또는 세로로 길면 폭에 맞춰) 보기
 *  - leader : 지금 선두를 따라간다
 *  - me     : 내 구슬을 따라간다 (모바일의 「내 구슬 따라보기」)
 *
 * 목표 지점으로 바로 튀지 않고 부드럽게 따라간다 — 화면이 덜컥거리면 어지럽다.
 */

import type { Rect } from '@marble/game-core';

export type CameraMode = 'whole' | 'leader' | 'me';

export interface CameraTarget {
  x: number;
  y: number;
}

export class Camera {
  /** 화면 가운데가 가리키는 월드 좌표 */
  x = 0;
  y = 0;
  /** 1 월드 단위가 몇 화면 픽셀인가 */
  zoom = 20;

  private targetX = 0;
  private targetY = 0;
  private targetZoom = 20;
  private initialized = false;

  /** 따라가기 모드에서 한 번에 보여 줄 세로 높이(월드 단위) */
  followHeight = 30;

  constructor(
    private viewW: number,
    private viewH: number,
  ) {}

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** 맵 전체가 들어오도록 맞춘다 */
  fit(bounds: Rect, padding = 1.04): void {
    const zx = this.viewW / (bounds.w * padding);
    const zy = this.viewH / (bounds.h * padding);
    this.targetZoom = Math.min(zx, zy);
    this.targetX = bounds.x + bounds.w / 2;
    this.targetY = bounds.y + bounds.h / 2;
  }

  /** 한 점을 따라간다 */
  follow(p: CameraTarget, bounds: Rect): void {
    this.targetZoom = this.viewH / this.followHeight;
    // 가로로는 맵이 화면보다 좁으면 가운데 고정
    const visibleW = this.viewW / this.targetZoom;
    if (visibleW >= bounds.w) {
      this.targetX = bounds.x + bounds.w / 2;
    } else {
      this.targetX = clamp(p.x, bounds.x + visibleW / 2, bounds.x + bounds.w - visibleW / 2);
    }
    const visibleH = this.viewH / this.targetZoom;
    this.targetY = clamp(p.y, bounds.y + visibleH / 2, bounds.y + bounds.h - visibleH / 2);
  }

  /**
   * 목표 쪽으로 한 프레임 다가간다.
   * @param dt 실제 흐른 시간(초). 프레임 속도가 달라도 같은 속도로 따라가게 한다.
   */
  update(dt: number): void {
    if (!this.initialized) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.zoom = this.targetZoom;
      this.initialized = true;
      return;
    }
    // 1초에 남은 거리의 약 92% 를 따라잡는다
    const k = 1 - Math.pow(0.08, Math.min(dt, 0.1));
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;
  }

  /** 다음 그리기에서 즉시 목표로 맞춘다(맵이 바뀌었을 때) */
  snap(): void {
    this.initialized = false;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  /** 지금 화면에 보이는 월드 영역 */
  visibleRect(): Rect {
    const w = this.viewW / this.zoom;
    const h = this.viewH / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
}
