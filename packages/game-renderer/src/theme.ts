/**
 * 화면 색.
 *
 * 원본의 «검은 배경 + 네온 장애물 + 색 구슬» 느낌을 참고하되, 색은 새로 골랐다.
 * 원본의 순검정·시안 한 쌍 대신 짙은 남색 바탕에 장치 종류마다 다른 색을 준다 —
 * 확장 맵에 장치가 여러 가지라서, 색이 곧 «무엇인지» 를 알려 주어야 하기 때문이다.
 *
 * 색만으로 구분하지 않는다: 장치마다 모양·무늬·글자가 함께 다르다(§8 접근성).
 */

export interface Theme {
  background: string;
  backgroundDeep: string;
  grid: string;
  wall: string;
  wallGlow: string;
  box: string;
  pin: string;
  bubble: string;
  bubbleGlow: string;
  divider: string;
  floor: string;
  ramp: string;
  spinner: string;
  windmill: string;
  seesaw: string;
  gate: string;
  belt: string;
  beltStripe: string;
  bumper: string;
  spring: string;
  windOn: string;
  windOff: string;
  boosterZone: string;
  slowZone: string;
  magnetOn: string;
  magnetOff: string;
  magnetCore: string;
  portalA: string;
  portalB: string;
  door: string;
  finish: string;
  finishLine: string;
  checkpoint: string;
  checkpointText: string;
  label: string;
  labelBg: string;
  labelMine: string;
  minimapBg: string;
  minimapView: string;
  text: string;
  textDim: string;
}

export const DARK_THEME: Theme = {
  background: '#0b1020',
  backgroundDeep: '#060812',
  grid: 'rgba(120, 150, 210, 0.07)',
  wall: '#7dd3fc',
  wallGlow: 'rgba(125, 211, 252, 0.35)',
  box: '#38bdf8',
  pin: '#94a3b8',
  bubble: '#fde047',
  bubbleGlow: 'rgba(253, 224, 71, 0.4)',
  divider: '#64748b',
  floor: '#475569',
  ramp: '#5eead4',
  spinner: '#fb7185',
  windmill: '#fb923c',
  seesaw: '#c084fc',
  gate: '#f472b6',
  belt: '#22d3ee',
  beltStripe: 'rgba(8, 25, 35, 0.6)',
  bumper: '#f97316',
  spring: '#4ade80',
  windOn: 'rgba(96, 165, 250, 0.26)',
  windOff: 'rgba(96, 165, 250, 0.07)',
  boosterZone: 'rgba(52, 211, 153, 0.18)',
  slowZone: 'rgba(168, 85, 247, 0.18)',
  magnetOn: 'rgba(248, 113, 113, 0.22)',
  magnetOff: 'rgba(248, 113, 113, 0.06)',
  magnetCore: '#ef4444',
  portalA: '#e879f9',
  portalB: '#67e8f9',
  door: '#facc15',
  finish: 'rgba(244, 63, 94, 0.18)',
  finishLine: '#fb7185',
  checkpoint: 'rgba(59, 130, 246, 0.10)',
  checkpointText: 'rgba(148, 183, 226, 0.75)',
  label: '#e2e8f0',
  labelBg: 'rgba(8, 12, 24, 0.72)',
  labelMine: '#fde047',
  minimapBg: 'rgba(6, 10, 22, 0.86)',
  minimapView: 'rgba(226, 232, 240, 0.85)',
  text: '#e2e8f0',
  textDim: '#94a3b8',
};

/** 구슬 색 — 참가자마다 서버가 정한 hue 를 쓴다 */
export function marbleColor(hue: number, finished: boolean): string {
  return finished ? `hsl(${hue} 45% 45%)` : `hsl(${hue} 85% 62%)`;
}

export function marbleEdge(hue: number): string {
  return `hsl(${hue} 90% 82%)`;
}

/** 장치 종류마다 붙는 짧은 글자 — 색을 못 보는 경우에도 구분되게 한다 */
export const DEVICE_GLYPH: Record<string, string> = {
  wind: '바람',
  booster: '가속',
  slow: '감속',
  magnet: '자석',
  portal: '포털',
  gate: '문',
  conveyor: '벨트',
  spring: '발판',
  bumper: '범퍼',
  seesaw: '시소',
  windmill: '풍차',
  revolvingDoor: '회전문',
  spinner: '막대',
};
