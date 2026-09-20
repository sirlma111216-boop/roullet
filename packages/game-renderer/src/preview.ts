/**
 * 맵 카드에 쓰는 미리보기.
 *
 * 「실제 미리보기」여야 한다 — 그림 파일을 따로 두지 않고 맵 데이터를 그대로 줄여 그린다.
 * 그래서 맵을 고치면 카드도 저절로 맞는다.
 */

import type { MapDefinition } from '@marble/game-core';
import { DARK_THEME, type Theme } from './theme.ts';

export interface PreviewOptions {
  theme?: Theme;
  /** 장치를 색점으로 함께 그릴지 */
  showDevices?: boolean;
}

/** 맵 하나를 캔버스에 한 장으로 그린다 */
export function drawMapPreview(
  canvas: HTMLCanvasElement,
  map: MapDefinition,
  opts: PreviewOptions = {},
): void {
  const theme = opts.theme ?? DARK_THEME;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const b = map.preview;
  const scale = Math.min(w / b.w, h / b.h);
  const ox = (w - b.w * scale) / 2;
  const oy = (h - b.h * scale) / 2;

  ctx.fillStyle = theme.backgroundDeep;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.translate(-b.x, -b.y);

  // 장애물
  for (const o of map.obstacles) {
    if (o.t === 'wall') {
      ctx.beginPath();
      for (let i = 0; i < o.points.length; i++) {
        const p = o.points[i]!;
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = o.style === 'divider' ? theme.divider : theme.wall;
      ctx.lineWidth = 0.35;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (o.t === 'box') {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.angle ?? 0);
      ctx.fillStyle = o.style === 'floor' ? theme.floor : theme.box;
      ctx.fillRect(-o.hw, -Math.max(o.hh, 0.14), o.hw * 2, Math.max(o.hh, 0.14) * 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(o.x, o.y, Math.max(o.r, 0.22), 0, Math.PI * 2);
      ctx.fillStyle = o.pop ? theme.bubble : theme.pin;
      ctx.fill();
    }
  }

  if (opts.showDevices !== false) {
    for (const d of map.devices) {
      switch (d.t) {
        case 'wind':
          ctx.fillStyle = theme.windOn;
          ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
          break;
        case 'booster':
          ctx.fillStyle = theme.boosterZone;
          ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
          break;
        case 'slow':
          ctx.fillStyle = theme.slowZone;
          ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
          break;
        case 'magnet':
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fillStyle = theme.magnetOn;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.coreRadius, 0, Math.PI * 2);
          ctx.fillStyle = theme.magnetCore;
          ctx.fill();
          break;
        case 'portal':
          for (const [p, color] of [
            [d.a, theme.portalA],
            [d.b, theme.portalB],
          ] as const) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.35;
            ctx.stroke();
          }
          break;
        case 'spinner':
          bar(ctx, d.x, d.y, d.hw, d.hh, d.angle ?? 0, theme.spinner);
          break;
        case 'windmill':
          for (let a = 0; a < d.arms; a++) {
            bar(ctx, d.x, d.y, d.hw, d.hh, (Math.PI * 2 * a) / d.arms, theme.windmill);
          }
          break;
        case 'seesaw':
          bar(ctx, d.x, d.y, d.hw, d.hh, 0, theme.seesaw);
          break;
        case 'revolvingDoor':
          for (let a = 0; a < d.blades; a++) bar(ctx, d.x, d.y, d.r, 0.12, (Math.PI * a) / d.blades, theme.door);
          break;
        case 'gate':
          bar(ctx, d.x, d.y, d.hw, d.hh, d.angle ?? 0, theme.gate);
          break;
        case 'conveyor':
          bar(ctx, d.x, d.y, d.hw, d.hh, d.angle ?? 0, theme.belt);
          break;
        case 'spring':
          bar(ctx, d.x, d.y, d.hw, d.hh, d.angle ?? 0, theme.spring);
          break;
        case 'bumper':
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fillStyle = theme.bumper;
          ctx.fill();
          break;
      }
    }
  }

  // 출발과 결승
  const s = map.spawn.area;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
  ctx.lineWidth = 0.3;
  ctx.setLineDash([1, 0.8]);
  ctx.strokeRect(s.x, s.y, s.w, s.h);
  ctx.setLineDash([]);

  const f = map.finish.area;
  ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
  ctx.fillRect(f.x, f.y, f.w, f.h);

  ctx.restore();
}

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hw: number,
  hh: number,
  angle: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const h = Math.max(hh, 0.16);
  ctx.fillRect(-hw, -h, hw * 2, h * 2);
  ctx.restore();
}
