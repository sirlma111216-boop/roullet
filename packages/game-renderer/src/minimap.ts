/**
 * 미니맵.
 *
 * 맵 전체를 한 칸에 줄여 그리고, 지금 화면이 어디를 보고 있는지 네모로 알려 준다.
 * 구슬은 색 점으로, 내 구슬은 테두리를 씌워 눈에 띄게 한다.
 */

import type { MapDefinition, Rect } from '@marble/game-core';
import { DARK_THEME, marbleColor, type Theme } from './theme.ts';
import type { RenderMarble } from './renderer.ts';

export interface MinimapState {
  map: MapDefinition;
  marbles: RenderMarble[];
  meIndex: number | null;
  /** 지금 큰 화면이 보고 있는 영역 */
  view: Rect;
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private theme: Theme = DARK_THEME;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
    this.ctx = ctx;
  }

  setTheme(t: Theme): void {
    this.theme = t;
  }

  render(state: MinimapState): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.theme.minimapBg;
    ctx.fillRect(0, 0, w, h);

    const b = state.map.bounds;
    const scale = Math.min(w / b.w, h / b.h);
    const ox = (w - b.w * scale) / 2;
    const oy = (h - b.h * scale) / 2;
    const toX = (x: number) => ox + (x - b.x) * scale;
    const toY = (y: number) => oy + (y - b.y) * scale;

    // 코스 윤곽 — 벽만 얇게
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
    ctx.lineWidth = 1;
    for (const o of state.map.obstacles) {
      if (o.t !== 'wall') continue;
      ctx.beginPath();
      for (let i = 0; i < o.points.length; i++) {
        const p = o.points[i]!;
        if (i === 0) ctx.moveTo(toX(p[0]), toY(p[1]));
        else ctx.lineTo(toX(p[0]), toY(p[1]));
      }
      ctx.stroke();
    }

    // 구간 띠
    ctx.fillStyle = 'rgba(96, 165, 250, 0.18)';
    for (const cp of state.map.checkpoints) {
      ctx.fillRect(toX(cp.area.x), toY(cp.area.y), cp.area.w * scale, Math.max(1, cp.area.h * scale));
    }

    // 결승
    const f = state.map.finish.area;
    ctx.fillStyle = 'rgba(244, 63, 94, 0.5)';
    ctx.fillRect(toX(f.x), toY(f.y), f.w * scale, Math.max(2, f.h * scale));

    // 구슬
    for (let i = 0; i < state.marbles.length; i++) {
      const m = state.marbles[i]!;
      if (m.finished) continue;
      const x = toX(m.x);
      const y = toY(m.y);
      ctx.beginPath();
      ctx.arc(x, y, i === state.meIndex ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fillStyle = marbleColor(m.hue, false);
      ctx.fill();
      if (i === state.meIndex) {
        ctx.strokeStyle = this.theme.labelMine;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 지금 보고 있는 영역
    ctx.strokeStyle = this.theme.minimapView;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(toX(state.view.x), toY(state.view.y), state.view.w * scale, state.view.h * scale);
  }
}
