/**
 * 소리.
 *
 * 음원 파일을 쓰지 않고 WebAudio 로 직접 만든다 — 외부 자산의 사용 권한을 따질 일이 없고,
 * 내려받을 것이 늘지 않는다.
 *
 * 기본은 **꺼짐**이다. 교실에서 한 사람이 화면을 켜는 순간 소리가 나면 곤란하기 때문이다.
 * 교사·학생이 각자 켤 수 있다.
 *
 * 브라우저는 사용자가 무언가 누르기 전에는 소리를 못 내게 막는다. 그래서 AudioContext 를
 * 미리 만들지 않고, 처음 소리를 낼 때 만든다. 막혀 있으면 조용히 넘어간다.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOptions {
  /** 시작 주파수(Hz) */
  from: number;
  /** 끝 주파수. 없으면 from 과 같다. */
  to?: number;
  /** 길이(초) */
  duration: number;
  /** 0~1 */
  gain?: number;
  type?: OscillatorType;
  /** 지금부터 몇 초 뒤에 */
  delay?: number;
}

function tone(o: ToneOptions): void {
  const ac = context();
  if (!ac) return;
  // 탭이 뒤에 있거나 정책에 막혀 멈춰 있으면 깨운다
  if (ac.state === 'suspended') void ac.resume().catch(() => undefined);

  const at = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const peak = o.gain ?? 0.07;

  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to !== undefined && o.to !== o.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), at + o.duration);
  }

  // 톡 끊기면 「딱」 소리가 나므로 앞뒤를 부드럽게 한다
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, o.duration / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);

  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(at);
  osc.stop(at + o.duration + 0.02);
}

/** 카운트다운 한 칸 */
export function playCountdownTick(): void {
  tone({ from: 560, duration: 0.1, gain: 0.05, type: 'triangle' });
}

/** 출발 */
export function playStart(): void {
  tone({ from: 440, to: 880, duration: 0.28, gain: 0.08, type: 'triangle' });
}

/** 누군가 결승선을 통과했다. 앞 순위일수록 높은 음. */
export function playFinish(rank: number): void {
  // 1위 880Hz 에서 시작해 순위가 내려갈수록 낮아지되 220Hz 아래로는 안 간다
  const base = Math.max(220, 880 - (rank - 1) * 60);
  tone({ from: base, duration: 0.16, gain: 0.07, type: 'sine' });
}

/** 결과 발표 — 짧은 세 음 */
export function playResult(): void {
  tone({ from: 523, duration: 0.14, gain: 0.07 });
  tone({ from: 659, duration: 0.14, gain: 0.07, delay: 0.13 });
  tone({ from: 784, duration: 0.26, gain: 0.08, delay: 0.26 });
}

/** 무언가 잘못됐다 */
export function playError(): void {
  tone({ from: 300, to: 180, duration: 0.22, gain: 0.06, type: 'sawtooth' });
}

/**
 * 소리를 내는 모든 곳이 거치는 문.
 * 음소거이면 아무것도 하지 않는다 — 부르는 쪽에서 매번 if 를 쓰지 않게 한다.
 */
export function makeSound(muted: boolean) {
  const gate = (fn: () => void) => () => {
    if (!muted) fn();
  };
  return {
    countdownTick: gate(playCountdownTick),
    start: gate(playStart),
    finish: (rank: number) => {
      if (!muted) playFinish(rank);
    },
    result: gate(playResult),
    error: gate(playError),
  };
}

export type Sound = ReturnType<typeof makeSound>;
