/**
 * 라운드 진행에 맞춰 소리를 낸다.
 *
 * 음원 파일 없이 WebAudio 로 만든 소리다(util/audio.ts).
 * 기본은 꺼짐이고, 화면의 「소리」 단추로 켠다.
 */

import { useEffect, useRef } from 'react';
import type { RoundResult } from '@marble/protocol';
import { makeSound } from '../util/audio.ts';

export interface RoundSoundInput {
  muted: boolean;
  /** 카운트다운 남은 초(없으면 0) */
  countdownLeft: number;
  /** 확정된 결과 */
  result: RoundResult | null;
}

export function useRoundSound({ muted, countdownLeft, result }: RoundSoundInput): void {
  const lastTickRef = useRef(-1);
  const lastResultRef = useRef<string | null>(null);

  useEffect(() => {
    const sound = makeSound(muted);
    if (countdownLeft <= 0) {
      // 0 이 되는 순간 한 번만 출발 소리
      if (lastTickRef.current > 0) {
        lastTickRef.current = 0;
        sound.start();
      }
      return;
    }
    if (countdownLeft !== lastTickRef.current) {
      lastTickRef.current = countdownLeft;
      sound.countdownTick();
    }
  }, [countdownLeft, muted]);

  useEffect(() => {
    if (!result) return;
    // 같은 결과에 두 번 울리지 않게 한다(판이 바뀌면 다시 울린다)
    const key = `${result.roundId}:${result.revision}`;
    if (lastResultRef.current === key) return;
    lastResultRef.current = key;
    makeSound(muted).result();
  }, [result, muted]);
}
