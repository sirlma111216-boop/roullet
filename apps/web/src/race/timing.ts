/**
 * 경계를 넘나드는 «시간» 을 다루는 곳.
 *
 * ── 이 파일이 있는 이유 ──────────────────────────────────────────────────
 * 시각을 나타내는 값은 전부 `number` 라서, 타입 검사가 «절대 시각» 과 «길이» 를
 * 구별해 주지 못한다. 그래서 다음 두 사고가 실제로 났다.
 *
 *  1. 메인 스레드의 `performance.now()` 를 Web Worker 에 그대로 넘겼다.
 *     performance.now() 의 기준점(timeOrigin)은 **컨텍스트마다 다르다** —
 *     메인은 페이지를 연 시각이 0, 워커는 워커가 만들어진 시각이 0 이다.
 *     그래서 「페이지를 열어 둔 시간」만큼 출발이 늦어졌다. 9분 열어 두면 9분을 기다렸다.
 *
 *  2. 서버의 `Date.now()` 로 만든 출발 시각을 클라이언트가 제 `Date.now()` 와 뺐다.
 *     교실 PC 의 시계가 어긋난 만큼 카운트다운이 밀린다.
 *
 * 규칙: **경계를 넘는 시간은 언제나 «길이(ms)» 로 주고받는다.**
 * 절대 시각은 그 값을 만든 컨텍스트 안에서만 쓴다.
 * ────────────────────────────────────────────────────────────────────────
 */

/** 카운트다운으로 미룰 수 있는 최대 시간. 교사가 고를 수 있는 값의 상한이다. */
export const MAX_COUNTDOWN_MS = 10_000;

/**
 * 출발을 미룰 수 있는 최대 시간.
 * 카운트다운(최대 10초)에 약간의 여유를 더한 값이다.
 */
export const MAX_START_DELAY_MS = 15_000;

/**
 * 「길이」로 왔어야 할 값이 실은 절대 시각인지 가려낸다.
 *
 * `performance.now()` 는 페이지를 연 지 몇 초만 지나도 수천을 넘고,
 * `Date.now()` 는 1.7조가 넘는다. 어느 쪽이든 상한을 한참 넘는다.
 */
export function looksLikeAbsoluteTime(ms: number): boolean {
  return ms > MAX_START_DELAY_MS;
}

/**
 * 워커에 넘길 출발 지연을 믿을 수 있는 값으로 만든다.
 *
 * 상한을 넘으면 **0 으로 본다** — 상한으로 깎으면 15초를 멀거니 기다리게 되는데,
 * 그건 실수를 덜 아프게 만들 뿐 고쳐 주지는 않는다. 바로 출발하는 편이 낫고,
 * 무엇이 잘못됐는지 콘솔에 남긴다.
 */
export function clampStartDelayMs(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  if (looksLikeAbsoluteTime(ms)) {
    console.warn(
      `[race] 출발 지연으로 ${Math.round(ms)}ms 가 들어왔습니다. ` +
        '절대 시각을 넘긴 것 같아 무시하고 바로 출발합니다 (길이로 넘겨야 합니다).',
    );
    return 0;
  }
  return ms;
}

/** 서버가 보낸 카운트다운 길이를 믿을 수 있는 값으로 만든다 */
export function clampCountdownMs(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 3000;
  return Math.max(0, Math.min(MAX_COUNTDOWN_MS, ms));
}
