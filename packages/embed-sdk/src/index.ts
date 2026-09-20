/**
 * 교실 구슬 레이스 — 삽입 SDK.
 *
 * 프레임워크에 매이지 않는다(React 전용이 아니다). 부모 수업 앱은 이 파일 하나만 들고
 * iframe 을 띄워 명단을 넘기고 결과를 돌려받는다.
 *
 * ── 반드시 지키는 순서 ────────────────────────────────────────────────
 *  1. 메시지 «받을 준비» 를 먼저 한다. 그다음에 iframe 의 src 를 넣는다.
 *     (반대로 하면 활동 앱이 먼저 보낸 available 을 놓친다.)
 *  2. available 을 받은 뒤 mount 를 **한 번만** 보낸다. mount 는 새로 만드는 것이다.
 *  3. 정리할 때 destroy 를 보내고 iframe 을 통째로 버린다 —
 *     React StrictMode 의 두 번 마운트에서 방·소켓이 두 개 생기지 않게.
 *
 * ── 결과를 믿는 방법 ─────────────────────────────────────────────────
 *  roundFinished 로 오는 결과는 **화면용** 이다. 브라우저를 거치므로 손댈 수 있다.
 *  실제로 발표자를 기록할 때는 활동 서버가 서명해 보낸 webhook 이나,
 *  payload.verifyUrl 을 부모 **서버**에서 다시 조회한 값을 써라.
 */

import {
  EMBED_PROTOCOL_VERSION,
  EMBED_REQUEST_TIMEOUT_MS,
  isEmbedEnvelope,
  type AvailablePayload,
  type EmbedEnvelope,
  type EmbedErrorPayload,
  type HostRequestType,
  type MountPayload,
  type ParticipantsChangedPayload,
  type ReadyPayload,
  type RoundFinishedPayload,
  type RoundStartedPayload,
  type SetConfigPayload,
  type SetParticipantsPayload,
  type EmbedResponsePayload,
} from '@marble/protocol';

export interface MarbleRaceEvents {
  available(p: AvailablePayload): void;
  ready(p: ReadyPayload): void;
  participantsChanged(p: ParticipantsChangedPayload): void;
  roundStarted(p: RoundStartedPayload): void;
  roundFinished(p: RoundFinishedPayload): void;
  error(p: EmbedErrorPayload): void;
}

export interface MarbleRaceOptions {
  /** 활동 앱이 배포된 주소 (예: https://marble.example.workers.dev) */
  activityOrigin: string;
  /** 부모 수업 앱에 등록된 연동 id */
  integrationId: string;
  /**
   * 부모 앱 **서버**가 발급한 launch ticket.
   * 브라우저에서 만들지 마라 — 공유 비밀이 새어 나간다.
   */
  ticket: string;
  /** 교사 화면으로 열지 학생 화면으로 열지 */
  view: 'teacher' | 'student';
  /** 연동 모드에서는 코드·QR 상자를 숨긴다(학생은 단추 하나로 들어온다) */
  hideJoinUi?: boolean;
  /** iframe 에 붙일 제목(접근성) */
  title?: string;
}

export interface MarbleRaceHandle {
  /** iframe 을 element 안에 만든다. 같은 핸들로 두 번 부르지 않는다. */
  mount(element: HTMLElement): void;
  /** iframe 과 리스너를 모두 정리한다 */
  destroy(): void;

  setParticipants(participants: SetParticipantsPayload['participants']): Promise<void>;
  setConfig(config: SetConfigPayload['config']): Promise<void>;
  startRound(countdownSec?: number): Promise<{ roundId: string }>;
  cancelRound(reason?: string): Promise<void>;
  resetRound(): Promise<void>;
  /** 마지막 결과를 다시 물어본다(화면용) */
  getResult(): Promise<RoundFinishedPayload | null>;

  on<K extends keyof MarbleRaceEvents>(type: K, fn: MarbleRaceEvents[K]): () => void;

  /** 지금 활동 앱이 할 수 있다고 알려 온 것 */
  readonly capabilities: readonly string[];
  readonly sessionId: string;
}

export function createMarbleRace(options: MarbleRaceOptions): MarbleRaceHandle {
  const sessionId = `mr-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const activityOrigin = new URL(options.activityOrigin).origin;

  let iframe: HTMLIFrameElement | null = null;
  let container: HTMLElement | null = null;
  let mounted = false;
  let destroyed = false;
  let capabilities: readonly string[] = [];
  let lastResult: RoundFinishedPayload | null = null;

  // 제네릭 키로 인덱싱한 Set 에 넣고 빼는 것을 TS 가 좁히지 못한다.
  // 안쪽은 한 가지 형태로 두고, 드나드는 자리에서만 형을 맞춘다.
  const listeners = new Map<string, Set<(p: never) => void>>();
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  let seq = 0;

  const emit = <K extends keyof MarbleRaceEvents>(type: K, payload: Parameters<MarbleRaceEvents[K]>[0]): void => {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as unknown as (p: unknown) => void)(payload);
      } catch (err) {
        console.error('[marble-race] 이벤트 처리 중 오류', err);
      }
    }
  };

  /** 받은 메시지가 정말 우리 iframe 에서 온 것인지 본다 */
  const onMessage = (ev: MessageEvent): void => {
    if (destroyed) return;
    // ★ origin 과 source 를 모두 본다. 하나만 보면 다른 프레임이 흉내 낼 수 있다.
    if (ev.origin !== activityOrigin) return;
    if (!iframe || ev.source !== iframe.contentWindow) return;
    if (!isEmbedEnvelope(ev.data)) return;

    const env = ev.data as EmbedEnvelope;
    if (env.protocolVersion !== EMBED_PROTOCOL_VERSION) {
      emit('error', {
        code: 'protocol_mismatch',
        message: `활동 앱의 판(${env.protocolVersion})이 이 SDK(${EMBED_PROTOCOL_VERSION})와 다릅니다. 활동 앱을 다시 배포하세요.`,
      });
      return;
    }
    // available 은 아직 세션이 정해지기 전이라 sessionId 를 검사하지 않는다
    if (env.type !== 'available' && env.sessionId !== sessionId) return;

    if (env.requestId) {
      const p = pending.get(env.requestId);
      if (p) {
        pending.delete(env.requestId);
        clearTimeout(p.timer);
        const res = env.payload as EmbedResponsePayload;
        if (res?.ok) p.resolve(res.data);
        else p.reject(new Error(res?.error?.message ?? '활동 앱이 요청을 거절했습니다.'));
      }
      return;
    }

    switch (env.type) {
      case 'available': {
        const p = env.payload as AvailablePayload;
        capabilities = p.capabilities;
        emit('available', p);
        // available 을 받은 뒤에 딱 한 번 mount 를 보낸다
        if (!mounted) {
          mounted = true;
          void send('mount', {
            integrationId: options.integrationId,
            ticket: options.ticket,
            view: options.view,
            hideJoinUi: options.hideJoinUi ?? true,
            locale: 'ko',
          } satisfies MountPayload).catch((err: unknown) => {
            emit('error', {
              code: 'mount_failed',
              message: err instanceof Error ? err.message : '활동 앱을 띄우지 못했습니다.',
            });
          });
        }
        return;
      }
      case 'ready':
        emit('ready', env.payload as ReadyPayload);
        return;
      case 'participantsChanged':
        emit('participantsChanged', env.payload as ParticipantsChangedPayload);
        return;
      case 'roundStarted':
        emit('roundStarted', env.payload as RoundStartedPayload);
        return;
      case 'roundFinished':
        lastResult = env.payload as RoundFinishedPayload;
        emit('roundFinished', lastResult);
        return;
      case 'error':
        emit('error', env.payload as EmbedErrorPayload);
        return;
      default:
        return;
    }
  };

  function send(type: HostRequestType, payload: unknown): Promise<unknown> {
    const win = iframe?.contentWindow;
    if (!win) return Promise.reject(new Error('활동 앱이 아직 준비되지 않았습니다.'));
    const requestId = `q${++seq}`;
    const env: EmbedEnvelope = {
      channel: 'classroom-marble-race',
      protocolVersion: EMBED_PROTOCOL_VERSION,
      sessionId,
      requestId,
      type,
      payload,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`활동 앱이 ${EMBED_REQUEST_TIMEOUT_MS / 1000}초 안에 답하지 않았습니다 (${type}).`));
      }, EMBED_REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
      // ★ '*' 를 쓰지 않는다. 정확한 origin 으로만 보낸다.
      win.postMessage(env, activityOrigin);
    });
  }

  return {
    get capabilities() {
      return capabilities;
    },
    sessionId,

    mount(element: HTMLElement): void {
      if (destroyed) throw new Error('이미 정리된 핸들입니다.');
      if (iframe) throw new Error('이미 mount 했습니다. 다시 붙이려면 destroy 후 새로 만드세요.');
      container = element;

      // 1) 먼저 듣는다
      window.addEventListener('message', onMessage);

      // 2) 그다음 iframe 을 만든다
      const f = document.createElement('iframe');
      f.title = options.title ?? '교실 구슬 레이스';
      f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#080b14';
      f.allow = 'autoplay';
      // 필요한 것만 연다
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      const url = new URL('/embed', activityOrigin);
      url.searchParams.set('parentOrigin', location.origin);
      url.searchParams.set('session', sessionId);
      f.src = url.toString();
      iframe = f;
      element.appendChild(f);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (iframe?.contentWindow) {
        try {
          void send('destroy', {});
        } catch {
          /* 이미 사라진 프레임 */
        }
      }
      window.removeEventListener('message', onMessage);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('정리되었습니다.'));
      }
      pending.clear();
      if (iframe) {
        // src 를 비우고 통째로 버린다 — 방·소켓이 남지 않게
        iframe.src = 'about:blank';
        iframe.remove();
      }
      iframe = null;
      container = null;
      void container;
    },

    async setParticipants(participants): Promise<void> {
      await send('setParticipants', { participants } satisfies SetParticipantsPayload);
    },

    async setConfig(config): Promise<void> {
      await send('setConfig', { config } satisfies SetConfigPayload);
    },

    async startRound(countdownSec = 3): Promise<{ roundId: string }> {
      return (await send('startRound', { countdownSec })) as { roundId: string };
    },

    async cancelRound(reason = '부모 앱이 취소했습니다.'): Promise<void> {
      await send('cancelRound', { reason });
    },

    async resetRound(): Promise<void> {
      await send('resetRound', {});
    },

    async getResult(): Promise<RoundFinishedPayload | null> {
      const r = (await send('getResult', {})) as RoundFinishedPayload | null;
      return r ?? lastResult;
    },

    on(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const entry = fn as unknown as (p: never) => void;
      set.add(entry);
      return () => set.delete(entry);
    },
  };
}

export type {
  AvailablePayload,
  EmbedErrorPayload,
  ParticipantsChangedPayload,
  ReadyPayload,
  RoundFinishedPayload,
  RoundStartedPayload,
};
export { EMBED_PROTOCOL_VERSION };
