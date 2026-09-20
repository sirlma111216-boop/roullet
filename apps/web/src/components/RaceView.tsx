/**
 * 경기 화면.
 *
 * 교사·학생·임베드가 모두 이 컴포넌트를 쓴다. 다른 점은 「내 구슬이 누구인가」와
 * 조작 단추가 보이는지 정도다 — 화면 코드가 한 벌이라 한쪽에서만 어긋나는 일이 없다.
 */

import { useEffect, useRef, useState } from 'react';
import type { MapDefinition } from '@marble/game-core';
import { MARBLE_RADIUS } from '@marble/game-core';
import { Minimap, Renderer, type RenderMarble, type RenderState } from '@marble/game-renderer';
import type { RacerSnapshot } from '@marble/protocol';
import { displayName } from '@marble/protocol';
import type { FrameInterpolator } from '../race/interpolator.ts';
import type { ViewPrefs } from '../util/storage.ts';
import { makeSound } from '../util/audio.ts';

export interface RaceViewProps {
  map: MapDefinition;
  racers: readonly RacerSnapshot[];
  interpolator: FrameInterpolator;
  /** 이 화면을 보는 사람의 구슬 번호 */
  meIndex: number | null;
  prefs: ViewPrefs;
  onPrefsChange(p: ViewPrefs): void;
  /** 위에 겹쳐 보여 줄 것(카운트다운 등) */
  overlay?: React.ReactNode;
  /** 왼쪽 위 정보 상자 */
  hud?: React.ReactNode;
  /** 조작 단추를 숨긴다(임베드의 학생 화면) */
  hideControls?: boolean;
}

export function RaceView(props: RaceViewProps): React.ReactElement {
  const { map, racers, interpolator, meIndex, prefs, onPrefsChange } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const minimapRef = useRef<Minimap | null>(null);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const [labelBudget, setLabelBudget] = useState(14);
  /** 이미 소리를 낸 도착 수 — 새로 들어온 만큼만 울린다 */
  const soundedRef = useRef(0);

  // 작은 화면에서는 이름표를 적게 — 60명이면 글자가 서로 먹는다
  useEffect(() => {
    const update = () => setLabelBudget(window.innerWidth < 480 ? 6 : window.innerWidth < 900 ? 10 : 18);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const mini = miniRef.current;
    if (!canvas) return;
    rendererRef.current = new Renderer(canvas);
    if (mini) minimapRef.current = new Minimap(mini);
    return () => {
      rendererRef.current = null;
      minimapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const loop = (now: number) => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(loop);
      const renderer = rendererRef.current;
      if (!renderer) return;

      const dt = lastRef.current ? Math.min(now - lastRef.current, 200) : 16;
      lastRef.current = now;

      interpolator.advance(dt);
      const sample = interpolator.sample();

      // 새로 도착한 구슬이 있으면 소리를 낸다(앞 순위일수록 높은 음)
      if (interpolator.finished.size > soundedRef.current) {
        const sound = makeSound(prefs.muted);
        const ranks = [...interpolator.finished.values()].sort((a, b) => a - b);
        for (let i = soundedRef.current; i < ranks.length; i++) sound.finish(ranks[i]!);
        soundedRef.current = ranks.length;
      } else if (interpolator.finished.size === 0) {
        soundedRef.current = 0;
      }

      const marbles: RenderMarble[] = [];
      for (let i = 0; i < racers.length; i++) {
        const r = racers[i]!;
        const x = sample.positions[i * 2];
        const y = sample.positions[i * 2 + 1];
        const rank = interpolator.finished.get(i) ?? 0;
        marbles.push({
          x: x ?? map.spawn.area.x + map.spawn.area.w / 2,
          y: y ?? map.spawn.area.y,
          hue: r.hue,
          label: displayName(r),
          finished: rank > 0,
          rank,
          isMe: i === meIndex,
        });
      }

      const state: RenderState = {
        map,
        marbles,
        deviceStates: sample.deviceStates,
        popped: interpolator.popped,
        ranking: sample.ranking.length > 0 ? sample.ranking : marbles.map((_, i) => i),
        timeMs: sample.raceTimeMs,
        cameraMode: prefs.cameraMode,
        meIndex,
        reduceEffects: prefs.reduceEffects,
        highlightMine: prefs.highlightMine,
        maxLabels: labelBudget,
      };

      renderer.render(state, now);
      minimapRef.current?.render({
        map,
        marbles,
        meIndex,
        view: renderer.camera.visibleRect(),
      });
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      lastRef.current = 0;
    };
  }, [map, racers, interpolator, meIndex, prefs, labelBudget]);

  const setCamera = (mode: ViewPrefs['cameraMode']) => onPrefsChange({ ...prefs, cameraMode: mode });

  return (
    <div className="race">
      <canvas ref={canvasRef} className="race__canvas" aria-label={`${map.name} 경기 화면`} role="img" />
      <div className="race__overlay">
        {props.hud ? <div className="race__hud">{props.hud}</div> : null}
        <div className="race__minimap" aria-hidden="true">
          <canvas ref={miniRef} />
        </div>
        {!props.hideControls ? (
          <div className="race__controls">
            <div className="btn-group" role="group" aria-label="카메라">
              <button
                type="button"
                className="btn btn--sm"
                aria-pressed={prefs.cameraMode === 'whole'}
                onClick={() => setCamera('whole')}
              >
                전체
              </button>
              <button
                type="button"
                className="btn btn--sm"
                aria-pressed={prefs.cameraMode === 'leader'}
                onClick={() => setCamera('leader')}
              >
                선두
              </button>
              {meIndex !== null ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  aria-pressed={prefs.cameraMode === 'me'}
                  onClick={() => setCamera('me')}
                >
                  내 구슬
                </button>
              ) : null}
            </div>
            {meIndex !== null ? (
              <button
                type="button"
                className="btn btn--sm"
                aria-pressed={prefs.highlightMine}
                onClick={() => onPrefsChange({ ...prefs, highlightMine: !prefs.highlightMine })}
              >
                {prefs.highlightMine ? '내 구슬 강조 켜짐' : '내 구슬 강조 꺼짐'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--sm"
              aria-pressed={prefs.reduceEffects}
              onClick={() => onPrefsChange({ ...prefs, reduceEffects: !prefs.reduceEffects })}
            >
              {prefs.reduceEffects ? '효과 줄임' : '효과 보통'}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              aria-pressed={prefs.muted}
              onClick={() => onPrefsChange({ ...prefs, muted: !prefs.muted })}
            >
              {prefs.muted ? '소리 꺼짐' : '소리 켜짐'}
            </button>
          </div>
        ) : null}
        {props.overlay}
      </div>
    </div>
  );
}

export { MARBLE_RADIUS };
