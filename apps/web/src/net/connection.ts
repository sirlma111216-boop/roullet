/**
 * 방 WebSocket 연결.
 *
 * 지키는 것:
 *  - 받은 상태는 **통째로** 갈아 끼운다. 필드별로 다시 만들면, 서버에 새 칸이 생겼을 때
 *    받는 쪽에서 조용히 사라진다(이 함정으로 예전 프로젝트에서 오래 헤맸다).
 *  - 끊기면 점점 늘어나는 간격으로 다시 붙는다. 붙으면 같은 자격으로 참가자를 되찾는다.
 *  - 요청에는 답이 오거나 시간이 지나면 실패한다. 영원히 기다리지 않는다.
 */

import {
  decode,
  PROTOCOL_VERSION,
  type HelloAck,
  type HelloPayload,
  type RaceFrame,
  type RoomSnapshot,
  type RoundResult,
  type RuleSnapshot,
} from '@marble/protocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnectionEvents {
  status(s: ConnectionStatus, detail?: string): void;
  /** 방 상태가 통째로 왔다 */
  snapshot(s: RoomSnapshot): void;
  countdown(d: { roundId: string; startsAt: number; countdownMs: number; snapshot: RuleSnapshot }): void;
  frame(f: RaceFrame): void;
  result(r: RoundResult): void;
  interrupted(d: { roundId: string | null; reason: string; canResume: boolean }): void;
  closed(d: { reason: string }): void;
  error(d: { code: string; message: string }): void;
  /** hello 가 받아들여졌다 */
  hello(a: HelloAck): void;
}

type Listener<K extends keyof ConnectionEvents> = ConnectionEvents[K];

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_BACKOFF_MS = 15_000;

export class RoomConnection {
  private ws: WebSocket | null = null;
  // 제네릭 키로 인덱싱한 Set 에 넣고 빼는 것을 TS 가 좁히지 못한다.
  // 안쪽은 한 가지 형태로 두고, 드나드는 자리에서만 형을 맞춘다.
  private listeners = new Map<string, Set<(...args: never[]) => void>>();
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: number }>();
  private seq = 0;
  private backoff = 500;
  private reconnectTimer: number | null = null;
  private closedByUs = false;
  private _status: ConnectionStatus = 'idle';
  private hello: HelloPayload;

  constructor(
    private readonly code: string,
    hello: Omit<HelloPayload, 'protocolVersion'>,
  ) {
    this.hello = { ...hello, protocolVersion: PROTOCOL_VERSION };
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  on<K extends keyof ConnectionEvents>(type: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const entry = fn as unknown as (...args: never[]) => void;
    set.add(entry);
    return () => set.delete(entry);
  }

  private emit<K extends keyof ConnectionEvents>(type: K, ...args: Parameters<ConnectionEvents[K]>): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as unknown as (...a: Parameters<ConnectionEvents[K]>) => void)(...args);
      } catch (err) {
        console.error('연결 이벤트 처리 중 오류', err);
      }
    }
  }

  private setStatus(s: ConnectionStatus, detail?: string): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s, detail);
  }

  /** 다음에 다시 붙을 때 쓸 자격을 갈아 끼운다 */
  setRejoinToken(token: string | null): void {
    if (token) this.hello = { ...this.hello, rejoinToken: token };
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closedByUs = false;
    this.setStatus(this._status === 'idle' ? 'connecting' : 'reconnecting');

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?code=${encodeURIComponent(this.code)}`);
    this.ws = ws;

    ws.onopen = () => {
      void this.sendHello();
    };

    ws.onmessage = (ev) => {
      const msg = decode(typeof ev.data === 'string' ? ev.data : '');
      if (!msg) return;
      this.route(msg);
    };

    ws.onclose = (ev) => {
      this.ws = null;
      this.failAllPending(new Error('연결이 끊겼습니다.'));
      if (this.closedByUs) {
        this.setStatus('closed');
        return;
      }
      this.setStatus('reconnecting', ev.reason || undefined);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose 가 이어서 불린다. 여기서는 따로 하지 않는다.
    };
  }

  private async sendHello(): Promise<void> {
    try {
      const ack = (await this.request('hello', this.hello)) as HelloAck;
      this.backoff = 500;
      // 새로 받은 재접속 자격을 보관해 다음 재연결에 쓴다
      if (ack.rejoinToken) this.setRejoinToken(ack.rejoinToken);
      this.setStatus('open');
      this.emit('hello', ack);
      this.emit('snapshot', ack.snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : '인사에 실패했습니다.';
      this.emit('error', { code: 'hello_failed', message });
      this.closedByUs = true;
      this.ws?.close();
      this.setStatus('closed', message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const wait = this.backoff;
    this.backoff = Math.min(MAX_BACKOFF_MS, Math.round(this.backoff * 1.7));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private route(msg: { t: string; i?: string; d?: unknown }): void {
    if (msg.t === 'ack' || msg.t === 'nack') {
      const p = msg.i ? this.pending.get(msg.i) : undefined;
      if (!p || !msg.i) return;
      this.pending.delete(msg.i);
      clearTimeout(p.timer);
      if (msg.t === 'ack') p.resolve(msg.d);
      else {
        const e = msg.d as { code: string; message: string };
        p.reject(new RequestRejected(e?.code ?? 'rejected', e?.message ?? '요청이 거절되었습니다.'));
      }
      return;
    }

    switch (msg.t) {
      case 'snapshot':
        // 통째로 갈아 끼운다
        this.emit('snapshot', msg.d as RoomSnapshot);
        break;
      case 'countdown':
        this.emit('countdown', msg.d as { roundId: string; startsAt: number; countdownMs: number; snapshot: RuleSnapshot });
        break;
      case 'frame':
        this.emit('frame', msg.d as RaceFrame);
        break;
      case 'result':
        this.emit('result', msg.d as RoundResult);
        break;
      case 'interrupted':
        this.emit('interrupted', msg.d as { roundId: string | null; reason: string; canResume: boolean });
        break;
      case 'closed':
        this.closedByUs = true;
        this.emit('closed', msg.d as { reason: string });
        break;
      case 'error':
        this.emit('error', msg.d as { code: string; message: string });
        break;
      default:
        break;
    }
  }

  /** 답을 기다리는 요청 */
  request(type: string, payload: unknown): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RequestRejected('not_connected', '서버에 연결되어 있지 않습니다.'));
    }
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new RequestRejected('timeout', '서버가 답하지 않았습니다.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ t: type, i: id, d: payload }));
    });
  }

  /** 답을 기다리지 않는 전송(프레임처럼 자주 보내는 것) */
  send(type: string, payload: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: type, d: payload }));
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.failAllPending(new Error('연결을 닫았습니다.'));
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }
}

export class RequestRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestRejected';
  }
}
