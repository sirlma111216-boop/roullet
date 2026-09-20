/**
 * 캔버스 그리기.
 *
 * 그리는 쪽은 물리를 모른다 — 「지금 무엇이 어디에 있는가」만 받아서 그린다.
 * 그래서 교사 화면(직접 계산)과 학생 화면(서버에서 받아 보간)이 같은 그림을 쓴다.
 */

import type { DeviceDef, MapDefinition, ObstacleDef, Rect } from '@marble/game-core';
import { MARBLE_RADIUS } from '@marble/game-core';
import { Camera, type CameraMode } from './camera.ts';
import { DARK_THEME, DEVICE_GLYPH, marbleColor, marbleEdge, type Theme } from './theme.ts';

export interface RenderMarble {
  x: number;
  y: number;
  hue: number;
  /** 화면에 적을 이름(구분 번호 포함) */
  label: string;
  finished: boolean;
  /** 결승했다면 순위(1부터), 아니면 0 */
  rank: number;
  /** 이 화면을 보는 사람의 구슬인가 */
  isMe: boolean;
}

export interface RenderState {
  map: MapDefinition;
  marbles: RenderMarble[];
  /** 장치별 상태 스칼라. 맵의 devices 순서와 같다. */
  deviceStates: number[];
  /** 터진 장애물 번호 */
  popped: ReadonlySet<number>;
  /** 앞선 순서대로의 구슬 번호 */
  ranking: number[];
  timeMs: number;
  cameraMode: CameraMode;
  /** 내 구슬 번호(없으면 null) */
  meIndex: number | null;
  /** 효과 줄이기 — 잔상·글로우를 끈다 */
  reduceEffects: boolean;
  /** 내 구슬 강조 */
  highlightMine: boolean;
  /** 이름표를 몇 개까지 그릴지(작은 화면에서 줄인다) */
  maxLabels: number;
}

/** 이름표가 겹치지 않게 이미 쓴 자리를 기억한다 */
interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Renderer {
  readonly camera: Camera;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private lastTime = 0;
  private theme: Theme = DARK_THEME;
  private currentMapId = '';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
    this.ctx = ctx;
    this.camera = new Camera(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  setTheme(t: Theme): void {
    this.theme = t;
  }

  /**
   * 캔버스 크기를 화면 크기·픽셀 밀도에 맞춘다.
   *
   * 배치가 어긋나 캔버스가 터무니없이 커지는 일이 있었다(높이 4000px 이 넘었다).
   * 그때 픽셀 밀도까지 곱하면 메모리를 수십 MB 씩 먹는다 — 넓이가 크면 밀도를 1 로 낮춘다.
   */
  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = w * h > 3_000_000 ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.camera.resize(w, h);
  }

  render(state: RenderState, nowMs: number): void {
    this.resize();
    const dt = this.lastTime ? Math.min((nowMs - this.lastTime) / 1000, 0.1) : 0.016;
    this.lastTime = nowMs;

    if (state.map.id !== this.currentMapId) {
      this.currentMapId = state.map.id;
      this.camera.snap();
    }

    this.updateCamera(state);
    this.camera.update(dt);

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const vw = this.canvas.clientWidth;
    const vh = this.canvas.clientHeight;
    this.drawBackground(vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const view = this.camera.visibleRect();
    this.drawCheckpoints(state.map, view);
    this.drawZones(state, view);
    this.drawObstacles(state, view);
    this.drawDevices(state, view);
    this.drawFinish(state.map);
    this.drawMarbles(state);

    ctx.restore();

    this.drawLabels(state, vw, vh);
    ctx.restore();
  }

  private updateCamera(state: RenderState): void {
    const { map } = state;
    if (state.cameraMode === 'whole') {
      this.camera.fit(map.bounds);
      return;
    }
    let target: RenderMarble | undefined;
    if (state.cameraMode === 'me' && state.meIndex !== null) {
      target = state.marbles[state.meIndex];
    }
    if (!target) {
      const leadIndex = state.ranking[0];
      target = leadIndex === undefined ? undefined : state.marbles[leadIndex];
    }
    if (!target) {
      this.camera.fit(map.bounds);
      return;
    }
    this.camera.follow(target, map.bounds);
  }

  /* ---------------------------------------------------------------- 배경 */

  private drawBackground(w: number, h: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this.theme.backgroundDeep);
    g.addColorStop(1, this.theme.background);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawCheckpoints(map: MapDefinition, view: Rect): void {
    const ctx = this.ctx;
    for (const cp of map.checkpoints) {
      if (!overlaps(cp.area, view)) continue;
      ctx.fillStyle = this.theme.checkpoint;
      ctx.fillRect(cp.area.x, cp.area.y, cp.area.w, cp.area.h);
      if (this.camera.zoom > 6) {
        ctx.fillStyle = this.theme.checkpointText;
        ctx.font = `${1.1}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(cp.name, cp.area.x + 0.4, cp.area.y + cp.area.h / 2);
      }
    }
  }

  /* ---------------------------------------------------------------- 구역 장치 */

  /** 바람·가속·감속·자석은 «구역» 이라 장애물보다 먼저(뒤에) 깔아야 한다 */
  private drawZones(state: RenderState, view: Rect): void {
    const ctx = this.ctx;
    const { map, deviceStates } = state;
    for (let i = 0; i < map.devices.length; i++) {
      const d = map.devices[i]!;
      const s = deviceStates[i] ?? 0;
      if (d.t === 'wind') {
        if (!overlaps(d.area, view)) continue;
        const on = s > 0.5;
        ctx.fillStyle = on ? this.theme.windOn : this.theme.windOff;
        ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
        this.drawZoneBorder(d.area, on);
        this.drawArrows(d.area, d.ax, d.ay, on, state.timeMs);
        this.drawZoneTag(d.area, `${DEVICE_GLYPH.wind} ${on ? '켜짐' : '꺼짐'}`, on);
      } else if (d.t === 'booster') {
        if (!overlaps(d.area, view)) continue;
        ctx.fillStyle = this.theme.boosterZone;
        ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
        this.drawZoneBorder(d.area, true);
        this.drawArrows(d.area, d.ax, d.ay, true, state.timeMs);
        this.drawZoneTag(d.area, DEVICE_GLYPH.booster!, true);
      } else if (d.t === 'slow') {
        if (!overlaps(d.area, view)) continue;
        ctx.fillStyle = this.theme.slowZone;
        ctx.fillRect(d.area.x, d.area.y, d.area.w, d.area.h);
        this.drawZoneBorder(d.area, true);
        this.drawZoneTag(d.area, DEVICE_GLYPH.slow!, true);
      } else if (d.t === 'magnet') {
        const on = s > 0.5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = on ? this.theme.magnetOn : this.theme.magnetOff;
        ctx.fill();
        ctx.strokeStyle = on ? this.theme.magnetCore : 'rgba(248,113,113,0.25)';
        ctx.lineWidth = on ? 0.12 : 0.06;
        ctx.setLineDash(on ? [] : [0.4, 0.4]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.camera.zoom > 5) {
          ctx.fillStyle = on ? '#fecaca' : 'rgba(254,202,202,0.5)';
          ctx.font = '0.95px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${DEVICE_GLYPH.magnet} ${on ? '켜짐' : '꺼짐'}`, d.x, d.y - d.r + 0.9);
        }
      }
    }
  }

  private drawZoneBorder(area: Rect, strong: boolean): void {
    const ctx = this.ctx;
    ctx.strokeStyle = strong ? 'rgba(191, 219, 254, 0.55)' : 'rgba(191, 219, 254, 0.18)';
    ctx.lineWidth = 0.08;
    ctx.setLineDash([0.5, 0.4]);
    ctx.strokeRect(area.x, area.y, area.w, area.h);
    ctx.setLineDash([]);
  }

  private drawZoneTag(area: Rect, text: string, strong: boolean): void {
    if (this.camera.zoom < 5) return;
    const ctx = this.ctx;
    ctx.fillStyle = strong ? 'rgba(219, 234, 254, 0.9)' : 'rgba(219, 234, 254, 0.4)';
    ctx.font = '0.95px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, area.x + 0.3, area.y + 0.25);
  }

  /** 힘의 방향을 화살표로 보여 준다 — 색 없이도 방향을 알 수 있게 */
  private drawArrows(area: Rect, ax: number, ay: number, on: boolean, timeMs: number): void {
    if (!on || this.camera.zoom < 4) return;
    const ctx = this.ctx;
    const len = Math.hypot(ax, ay);
    if (len < 0.01) return;
    const ux = ax / len;
    const uy = ay / len;
    const drift = ((timeMs / 500) % 1) * 2.5;
    ctx.strokeStyle = 'rgba(219, 234, 254, 0.5)';
    ctx.lineWidth = 0.09;
    const step = 2.5;
    for (let gy = area.y + 1.2; gy < area.y + area.h; gy += step) {
      for (let gx = area.x + 1.2; gx < area.x + area.w; gx += step) {
        const px = gx + ux * drift;
        const py = gy + uy * drift;
        ctx.beginPath();
        ctx.moveTo(px - ux * 0.5, py - uy * 0.5);
        ctx.lineTo(px + ux * 0.5, py + uy * 0.5);
        // 화살촉
        ctx.lineTo(px + ux * 0.5 - ux * 0.3 - uy * 0.22, py + uy * 0.5 - uy * 0.3 + ux * 0.22);
        ctx.moveTo(px + ux * 0.5, py + uy * 0.5);
        ctx.lineTo(px + ux * 0.5 - ux * 0.3 + uy * 0.22, py + uy * 0.5 - uy * 0.3 - ux * 0.22);
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------- 장애물 */

  private drawObstacles(state: RenderState, view: Rect): void {
    const ctx = this.ctx;
    const { map } = state;
    for (let i = 0; i < map.obstacles.length; i++) {
      if (state.popped.has(i)) continue;
      const o = map.obstacles[i]!;
      this.drawObstacle(o, view, state.reduceEffects);
    }
    void ctx;
  }

  private drawObstacle(o: ObstacleDef, view: Rect, reduce: boolean): void {
    const ctx = this.ctx;
    switch (o.t) {
      case 'wall': {
        ctx.beginPath();
        for (let i = 0; i < o.points.length; i++) {
          const p = o.points[i]!;
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.lineWidth = Math.max(0.18, (o.thickness ?? 0) * 2);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (!reduce) {
          ctx.strokeStyle = this.theme.wallGlow;
          ctx.lineWidth = Math.max(0.5, (o.thickness ?? 0) * 2 + 0.35);
          ctx.stroke();
          ctx.lineWidth = Math.max(0.18, (o.thickness ?? 0) * 2);
        }
        ctx.strokeStyle = o.style === 'divider' ? this.theme.divider : this.theme.wall;
        ctx.stroke();
        break;
      }
      case 'box': {
        if (!overlaps({ x: o.x - o.hw - o.hh, y: o.y - o.hw - o.hh, w: (o.hw + o.hh) * 2, h: (o.hw + o.hh) * 2 }, view))
          return;
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.angle ?? 0);
        ctx.fillStyle =
          o.style === 'floor'
            ? this.theme.floor
            : o.style === 'ramp' || o.style === 'roof' || o.style === 'boost-floor'
              ? this.theme.ramp
              : o.style === 'divider'
                ? this.theme.divider
                : this.theme.box;
        roundRect(ctx, -o.hw, -o.hh, o.hw * 2, o.hh * 2, Math.min(0.12, o.hh));
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'circle': {
        if (!overlaps({ x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 }, view)) return;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        if (o.pop) {
          if (!reduce) {
            ctx.fillStyle = this.theme.bubbleGlow;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.r * 0.82, 0, Math.PI * 2);
          }
          ctx.fillStyle = this.theme.bubble;
          ctx.fill();
          // 터지는 것임을 색 말고도 알 수 있게 가운데를 비운다
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r * 0.42, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(12, 16, 30, 0.55)';
          ctx.fill();
        } else {
          ctx.fillStyle = this.theme.pin;
          ctx.fill();
        }
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- 장치 */

  private drawDevices(state: RenderState, view: Rect): void {
    const { map, deviceStates } = state;
    for (let i = 0; i < map.devices.length; i++) {
      this.drawDevice(map.devices[i]!, deviceStates[i] ?? 0, view, state);
    }
  }

  private drawDevice(d: DeviceDef, s: number, view: Rect, state: RenderState): void {
    const ctx = this.ctx;
    switch (d.t) {
      case 'spinner':
        this.drawBar(d.x, d.y, d.hw, d.hh, s, this.theme.spinner, d.omega);
        break;
      case 'windmill':
        for (let a = 0; a < d.arms; a++) {
          this.drawBar(d.x, d.y, d.hw, d.hh, s + (Math.PI * 2 * a) / d.arms, this.theme.windmill, d.omega);
        }
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.3, 0, Math.PI * 2);
        ctx.fillStyle = this.theme.windmill;
        ctx.fill();
        break;
      case 'seesaw':
        this.drawBar(d.x, d.y, d.hw, d.hh, s, this.theme.seesaw, 0);
        ctx.beginPath();
        ctx.moveTo(d.x - 0.35, d.y + 0.65);
        ctx.lineTo(d.x + 0.35, d.y + 0.65);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fillStyle = this.theme.seesaw;
        ctx.fill();
        break;
      case 'revolvingDoor':
        for (let a = 0; a < d.blades; a++) {
          this.drawBar(d.x, d.y, d.r, 0.09, s + (Math.PI * a) / d.blades, this.theme.door, d.omega);
        }
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.25)';
        ctx.lineWidth = 0.07;
        ctx.setLineDash([0.4, 0.4]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'gate': {
        const nx = d.x + d.slideX * s;
        const ny = d.y + d.slideY * s;
        ctx.save();
        ctx.translate(nx, ny);
        ctx.rotate(d.angle ?? 0);
        ctx.fillStyle = this.theme.gate;
        ctx.globalAlpha = 0.35 + 0.65 * (1 - s);
        roundRect(ctx, -d.hw, -d.hh, d.hw * 2, d.hh * 2, 0.1);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        if (this.camera.zoom > 5) {
          ctx.fillStyle = s > 0.5 ? 'rgba(134, 239, 172, 0.95)' : 'rgba(251, 113, 133, 0.95)';
          ctx.font = '0.9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(s > 0.5 ? '열림' : '닫힘', d.x, d.y - 0.5);
        }
        break;
      }
      case 'conveyor': {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle ?? 0);
        ctx.fillStyle = this.theme.belt;
        roundRect(ctx, -d.hw, -d.hh, d.hw * 2, d.hh * 2, d.hh);
        ctx.fill();
        // 흐르는 무늬 — 어느 쪽으로 미는지 보이게
        if (!state.reduceEffects && this.camera.zoom > 4) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(-d.hw, -d.hh, d.hw * 2, d.hh * 2);
          ctx.clip();
          ctx.strokeStyle = this.theme.beltStripe;
          ctx.lineWidth = 0.16;
          const off = ((s % 1) + 1) % 1;
          for (let x = -d.hw - 1 + off; x < d.hw + 1; x += 0.8) {
            ctx.beginPath();
            ctx.moveTo(x, -d.hh);
            ctx.lineTo(x + (d.speed > 0 ? 0.3 : -0.3), d.hh);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 'bumper': {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * (1 + s * 0.08), 0, Math.PI * 2);
        ctx.fillStyle = this.theme.bumper;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(12, 16, 30, 0.45)';
        ctx.fill();
        break;
      }
      case 'spring': {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle ?? 0);
        ctx.fillStyle = this.theme.spring;
        roundRect(ctx, -d.hw, -d.hh - s * 0.1, d.hw * 2, d.hh * 2, 0.12);
        ctx.fill();
        // 용수철 무늬
        ctx.strokeStyle = 'rgba(6, 40, 20, 0.6)';
        ctx.lineWidth = 0.1;
        for (let x = -d.hw + 0.3; x < d.hw; x += 0.5) {
          ctx.beginPath();
          ctx.moveTo(x, -d.hh);
          ctx.lineTo(x + 0.25, d.hh);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'portal': {
        this.drawPortalMouth(d.a.x, d.a.y, d.a.r, this.theme.portalA, s, '들어가기');
        this.drawPortalMouth(d.b.x, d.b.y, d.b.r, this.theme.portalB, s, '나오기');
        ctx.strokeStyle = 'rgba(232, 121, 249, 0.2)';
        ctx.lineWidth = 0.07;
        ctx.setLineDash([0.5, 0.5]);
        ctx.beginPath();
        ctx.moveTo(d.a.x, d.a.y);
        ctx.lineTo(d.b.x, d.b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      default:
        break;
    }
    void view;
  }

  private drawPortalMouth(x: number, y: number, r: number, color: string, phase: number, tag: string): void {
    const ctx = this.ctx;
    const pulse = 0.85 + 0.15 * Math.sin(phase * 3);
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.12;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (this.camera.zoom > 6) {
      ctx.fillStyle = color;
      ctx.font = '0.8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, x, y);
    }
  }

  private drawBar(x: number, y: number, hw: number, hh: number, angle: number, color: string, omega: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    const h = Math.max(hh, 0.09);
    roundRect(ctx, -hw, -h, hw * 2, h * 2, h);
    ctx.fill();
    // 도는 방향을 한쪽 끝 점으로 알린다
    if (omega !== 0 && this.camera.zoom > 8) {
      ctx.beginPath();
      ctx.arc(omega > 0 ? hw - h : -hw + h, 0, h * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFinish(map: MapDefinition): void {
    const ctx = this.ctx;
    const a = map.finish.area;
    ctx.fillStyle = this.theme.finish;
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = this.theme.finishLine;
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + a.w, a.y);
    ctx.stroke();
    if (this.camera.zoom > 5) {
      ctx.fillStyle = this.theme.finishLine;
      ctx.font = 'bold 1.4px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('결승선', a.x + a.w / 2, a.y + 0.4);
    }
  }

  /* ---------------------------------------------------------------- 구슬 */

  private drawMarbles(state: RenderState): void {
    const ctx = this.ctx;
    const r = MARBLE_RADIUS;
    for (let i = 0; i < state.marbles.length; i++) {
      const m = state.marbles[i]!;
      if (m.finished) continue;
      const mine = m.isMe && state.highlightMine;

      if (mine && !state.reduceEffects) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(253, 224, 71, 0.18)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fillStyle = marbleColor(m.hue, false);
      ctx.fill();
      ctx.lineWidth = mine ? 0.12 : 0.06;
      ctx.strokeStyle = mine ? this.theme.labelMine : marbleEdge(m.hue);
      ctx.stroke();

      // 내 구슬은 색 말고도 표시가 있어야 한다
      if (mine) {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - r * 2.2);
        ctx.lineTo(m.x - r * 0.75, m.y - r * 1.25);
        ctx.lineTo(m.x + r * 0.75, m.y - r * 1.25);
        ctx.closePath();
        ctx.fillStyle = this.theme.labelMine;
        ctx.fill();
      }
    }
  }

  /**
   * 이름표.
   *
   * 화면에 다 쓰면 60명일 때 글자가 뭉개진다. 중요한 것부터 쓰고,
   * 이미 쓴 글자와 겹치면 건너뛴다 — 내 구슬과 선두는 언제나 먼저다.
   */
  private drawLabels(state: RenderState, vw: number, vh: number): void {
    const ctx = this.ctx;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const order: number[] = [];
    if (state.meIndex !== null && state.marbles[state.meIndex]) order.push(state.meIndex);
    for (const i of state.ranking) if (i !== state.meIndex) order.push(i);

    const drawn: LabelBox[] = [];
    let count = 0;
    for (const i of order) {
      if (count >= state.maxLabels) break;
      const m = state.marbles[i];
      if (!m || m.finished) continue;
      const p = this.camera.worldToScreen(m.x, m.y);
      if (p.x < -60 || p.x > vw + 60 || p.y < -30 || p.y > vh + 30) continue;

      const mine = m.isMe;
      const text = m.label;
      const w = ctx.measureText(text).width + 8;
      const h = 16;
      const box: LabelBox = { x: p.x - w / 2, y: p.y - 22 - h, w, h };
      if (!mine && drawn.some((b) => boxesOverlap(b, box))) continue;
      drawn.push(box);
      count++;

      ctx.fillStyle = this.theme.labelBg;
      roundRectPx(ctx, box.x, box.y, box.w, box.h, 4);
      ctx.fill();
      if (mine) {
        ctx.strokeStyle = this.theme.labelMine;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = mine ? this.theme.labelMine : this.theme.label;
      ctx.fillText(text, p.x, box.y + h - 3);
    }
  }
}

/* ------------------------------------------------------------------ 도우미 */

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

const roundRectPx = roundRect;

export type { CameraMode };
