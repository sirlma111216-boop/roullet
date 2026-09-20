/**
 * 시간 값 검사.
 *
 * 여기 있는 검사는 실제로 터진 버그에서 나왔다. 교사가 페이지를 오래 열어 둔 뒤
 * 「경기 시작」을 누르면, 열어 둔 시간만큼 기다렸다가 출발했다.
 * 원인은 메인 스레드의 `performance.now()` 를 Web Worker 에 그대로 넘긴 것이었다.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clampCountdownMs,
  clampStartDelayMs,
  looksLikeAbsoluteTime,
  MAX_COUNTDOWN_MS,
  MAX_START_DELAY_MS,
} from './timing.ts';

describe('출발 지연', () => {
  it('보통 카운트다운 길이는 그대로 통과한다', () => {
    expect(clampStartDelayMs(0)).toBe(0);
    expect(clampStartDelayMs(600)).toBe(600);
    expect(clampStartDelayMs(3000)).toBe(3000);
    expect(clampStartDelayMs(MAX_START_DELAY_MS)).toBe(MAX_START_DELAY_MS);
  });

  it('음수·숫자 아닌 값은 0 으로 본다', () => {
    expect(clampStartDelayMs(-5)).toBe(0);
    expect(clampStartDelayMs(Number.NaN)).toBe(0);
    expect(clampStartDelayMs(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampStartDelayMs(undefined)).toBe(0);
    expect(clampStartDelayMs('3000')).toBe(0);
  });

  /**
   * ★ 이것이 실제로 터졌던 버그다.
   * 페이지를 9분 열어 두면 메인 스레드의 performance.now() 는 568,000 쯤 된다.
   * 그 값이 「길이」 자리로 넘어오면 워커는 9분을 기다린다.
   */
  it('메인 스레드의 performance.now() 가 넘어오면 무시하고 바로 출발한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 페이지를 9분 열어 둔 상태에서 3초 카운트다운을 더한 값
    expect(clampStartDelayMs(568_237 + 3000)).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('Date.now() 가 넘어와도 바로 출발한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(clampStartDelayMs(Date.now())).toBe(0);
    warn.mockRestore();
  });

  it('상한을 넘는 값을 상한으로 깎지 않는다 — 그러면 15초를 멀거니 기다린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(clampStartDelayMs(MAX_START_DELAY_MS + 1)).not.toBe(MAX_START_DELAY_MS);
    expect(clampStartDelayMs(MAX_START_DELAY_MS + 1)).toBe(0);
    warn.mockRestore();
  });

  it('절대 시각처럼 보이는지 가려낸다', () => {
    expect(looksLikeAbsoluteTime(3000)).toBe(false);
    expect(looksLikeAbsoluteTime(MAX_START_DELAY_MS)).toBe(false);
    expect(looksLikeAbsoluteTime(568_237)).toBe(true);
    expect(looksLikeAbsoluteTime(Date.now())).toBe(true);
  });
});

describe('카운트다운 길이', () => {
  it('보통 값은 그대로', () => {
    expect(clampCountdownMs(0)).toBe(0);
    expect(clampCountdownMs(3000)).toBe(3000);
  });

  it('상한을 넘으면 깎는다', () => {
    expect(clampCountdownMs(999_999)).toBe(MAX_COUNTDOWN_MS);
  });

  it('없거나 이상하면 기본 3초', () => {
    expect(clampCountdownMs(undefined)).toBe(3000);
    expect(clampCountdownMs(Number.NaN)).toBe(3000);
    expect(clampCountdownMs(null)).toBe(3000);
  });

  it('음수는 0', () => {
    expect(clampCountdownMs(-1000)).toBe(0);
  });
});
