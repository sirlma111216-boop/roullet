/**
 * 확정된 결과를 부모 수업 앱의 서버로 **서명해서** 보낸다.
 *
 * 왜 postMessage 로 끝내지 않는가: iframe 이 부모에게 보낸 결과는 «화면용» 이다.
 * 학생 브라우저를 거치므로 손댈 수 있다. 부모 앱이 발표자를 실제로 기록할 때는
 * 이 webhook(또는 인증된 조회 API)으로 받은 것만 써야 한다.
 *
 * 멱등: 봉투에 eventId·roundId·revision 이 들어 있다. 부모 서버는
 * (activityId, roundId, revision) 으로 「없을 때만」 기록하고, 두 번째부터는 중복으로 답한다.
 */

import type { RoundResult } from '@marble/protocol';
import { hmacHex } from './crypto.ts';
import type { IntegrationConfig } from './tickets.ts';

export interface WebhookPayload {
  roomCode: string;
  roomId: string;
  integrationId: string;
  activityId: string | null;
  result: RoundResult;
}

/** 다시 보내기 간격(초). 일시적 오류에만 쓴다. */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

export async function sendResultWebhook(cfg: IntegrationConfig, payload: WebhookPayload): Promise<boolean> {
  if (!cfg.resultUrl) return false;

  const envelope = {
    type: 'marble-race.round-finished',
    sentAt: Date.now(),
    room: {
      code: payload.roomCode,
      roomId: payload.roomId,
      integrationId: payload.integrationId,
      activityId: payload.activityId,
    },
    result: payload.result,
  };
  // 서명은 «보낼 본문 그대로» 에 대해 만든다. 받는 쪽도 파싱 전 원문으로 검사해야 한다.
  const body = JSON.stringify(envelope);
  const signature = await hmacHex(cfg.secret, body);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(cfg.resultUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-marble-signature': `sha256=${signature}`,
          'x-marble-event-id': payload.result.eventId,
        },
        body,
      });
      // 2xx 는 받아들여진 것. 4xx 는 영구 거절이므로 다시 보내지 않는다.
      if (res.status >= 200 && res.status < 300) return true;
      if (res.status >= 400 && res.status < 500) return false;
    } catch {
      /* 네트워크 오류 — 아래에서 다시 시도한다 */
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
