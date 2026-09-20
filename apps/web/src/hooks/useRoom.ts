/**
 * 방에 붙어 상태를 들고 있는 훅.
 *
 * ★ 서버가 보낸 방 상태는 **통째로** 갈아 끼운다.
 *   필드별로 다시 만들면(`{a: d.a, b: d.b}`) 서버에 새 칸이 생겼을 때 받는 쪽에서 조용히
 *   사라진다. 그런 버그는 통신도 멀쩡하고 서버 로그에도 값이 있어서 찾기가 아주 어렵다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HelloAck, Participant, RoomSnapshot, RoundResult, RuleSnapshot } from '@marble/protocol';
import { RoomConnection, type ConnectionStatus } from '../net/connection.ts';
import { deviceToken, setRejoinToken } from '../util/storage.ts';

export interface UseRoomOptions {
  code: string;
  role: 'teacher' | 'student' | 'spectator';
  teacherToken?: string;
  rejoinToken?: string;
  nickname?: string;
  ticket?: string;
  enabled?: boolean;
}

export interface CountdownState {
  roundId: string;
  startsAt: number;
  snapshot: RuleSnapshot;
}

export interface RoomState {
  conn: RoomConnection | null;
  status: ConnectionStatus;
  statusDetail?: string;
  snapshot: RoomSnapshot | null;
  countdown: CountdownState | null;
  result: RoundResult | null;
  interruption: { roundId: string | null; reason: string; canResume: boolean } | null;
  me: Participant | null;
  closedReason: string | null;
  error: { code: string; message: string } | null;
  clearError(): void;
  clearCountdown(): void;
}

export function useRoom(opts: UseRoomOptions): RoomState {
  const { code, role, teacherToken, rejoinToken, nickname, ticket, enabled = true } = opts;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [interruption, setInterruption] = useState<RoomState['interruption']>(null);
  const [me, setMe] = useState<Participant | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const connRef = useRef<RoomConnection | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!enabled || !code) return;

    const hello = {
      role,
      teacherToken,
      rejoinToken,
      nickname,
      ticket,
      deviceToken: deviceToken(),
    };
    const conn = new RoomConnection(code, hello);
    connRef.current = conn;
    forceRender((n) => n + 1);

    const offs = [
      conn.on('status', (s, detail) => {
        setStatus(s);
        setStatusDetail(detail);
      }),
      conn.on('hello', (ack: HelloAck) => {
        setMe(ack.me);
        // 다음 새로고침·재연결 때 같은 참가자로 돌아오기 위한 자격
        if (ack.rejoinToken) setRejoinToken(code, ack.rejoinToken);
      }),
      // 통째로 갈아 끼운다 — 칸을 하나씩 옮겨 담지 않는다
      conn.on('snapshot', (s) => {
        setSnapshot(s);
        if (s.lastResult) setResult(s.lastResult);
        setInterruption(s.room.interruption ? { roundId: s.room.currentRoundId, reason: s.room.interruption, canResume: s.room.phase === 'paused' } : null);
        setMe((prev) => (prev ? (s.participants.find((p) => p.id === prev.id) ?? prev) : prev));
      }),
      conn.on('countdown', (d) => {
        setCountdown(d);
        setResult(null);
        setInterruption(null);
      }),
      conn.on('result', (r) => {
        setResult(r);
        setCountdown(null);
      }),
      conn.on('interrupted', (d) => {
        setInterruption(d);
        setCountdown(null);
      }),
      conn.on('closed', (d) => setClosedReason(d.reason)),
      conn.on('error', (e) => setError(e)),
    ];

    conn.connect();

    return () => {
      for (const off of offs) off();
      conn.close();
      connRef.current = null;
    };
    // code/role/자격이 바뀌면 새로 붙는다. nickname 은 첫 입장에만 쓰이므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, role, teacherToken, rejoinToken, ticket, enabled]);

  const clearError = useCallback(() => setError(null), []);
  const clearCountdown = useCallback(() => setCountdown(null), []);

  return useMemo(
    () => ({
      conn: connRef.current,
      status,
      statusDetail,
      snapshot,
      countdown,
      result,
      interruption,
      me,
      closedReason,
      error,
      clearError,
      clearCountdown,
    }),
    [status, statusDetail, snapshot, countdown, result, interruption, me, closedReason, error, clearError, clearCountdown],
  );
}

/** 연결 상태를 사람이 읽는 말로 */
export function statusText(s: ConnectionStatus): { text: string; tone: 'good' | 'warn' | 'bad' } {
  switch (s) {
    case 'open':
      return { text: '연결됨', tone: 'good' };
    case 'connecting':
      return { text: '연결 중…', tone: 'warn' };
    case 'reconnecting':
      return { text: '다시 연결하는 중…', tone: 'warn' };
    case 'closed':
      return { text: '연결 끊김', tone: 'bad' };
    default:
      return { text: '대기', tone: 'warn' };
  }
}
