/**
 * 맵 고르기 — 여덟 장의 카드.
 *
 * 미리보기는 그림 파일이 아니라 **맵 데이터를 그대로 줄여 그린 것**이다.
 * 맵을 고치면 카드도 저절로 맞는다.
 */

import { useEffect, useRef } from 'react';
import { ALL_MAPS, type MapDefinition } from '@marble/game-core';
import { drawMapPreview } from '@marble/game-renderer';

export interface MapPickerProps {
  value: string;
  onChange(mapId: string): void;
  disabled?: boolean;
}

export function MapPicker({ value, onChange, disabled }: MapPickerProps): React.ReactElement {
  return (
    <div className="map-grid" role="radiogroup" aria-label="맵 고르기">
      {ALL_MAPS.map((m) => (
        <MapCard key={m.id} map={m} selected={m.id === value} onSelect={() => onChange(m.id)} disabled={disabled} />
      ))}
    </div>
  );
}

function MapCard({
  map,
  selected,
  onSelect,
  disabled,
}: {
  map: MapDefinition;
  selected: boolean;
  onSelect(): void;
  disabled?: boolean;
}): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => drawMapPreview(canvas, map);
    draw();
    // 카드 크기가 바뀌면 다시 그린다(화면 회전·창 크기)
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [map]);

  const [fast, slow] = map.estimatedDurationSec;

  return (
    <button
      type="button"
      className="map-card"
      role="radio"
      aria-checked={selected}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <canvas ref={ref} className="map-card__canvas" aria-hidden="true" />
      <div className="map-card__title">
        <span
          className="tag"
          style={{
            borderColor: map.category === 'classic' ? '#3a4a75' : '#6b4b8a',
            color: map.category === 'classic' ? '#9aabc9' : '#d8b4fe',
          }}
        >
          {map.category === 'classic' ? '기본' : '확장'}
        </span>
        <span>{map.name}</span>
        {selected ? <span aria-hidden="true">✓</span> : null}
      </div>
      <div className="faint">{map.description}</div>
      <div className="map-card__tags" aria-label="핵심 장치">
        {map.highlights.map((h) => (
          <span key={h} className="tag">
            {h}
          </span>
        ))}
      </div>
      <div className="faint">
        예상 길이 30명 기준 <strong>{fast}~{slow}초</strong>
        <span className="sr-only">
          . 첫 도착까지 약 {fast}초, 전원 도착까지 약 {slow}초. 제한시간 {map.timeLimitSec}초.
        </span>
      </div>
    </button>
  );
}
