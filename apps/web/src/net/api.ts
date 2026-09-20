/** 서버의 HTTP API. WebSocket 은 connection.ts 가 맡는다. */

import type { RoomPhase, RoundResult } from '@marble/protocol';

export interface ApiError {
  code: string;
  message: string;
}

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiFailure('network', '서버에 닿지 못했습니다. 인터넷 연결을 확인해 주세요.', 0);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // API 자리에서 HTML 이 오면 라우팅이 잘못된 것이다 — 그대로 알려 준다
    throw new ApiFailure('bad_response', '서버가 예상과 다른 형식으로 답했습니다.', res.status);
  }

  if (!res.ok) {
    const e = (body as { error?: ApiError })?.error;
    throw new ApiFailure(e?.code ?? 'http_error', e?.message ?? `요청이 실패했습니다 (${res.status})`, res.status);
  }
  return body as T;
}

export interface CreatedRoom {
  joinCode: string;
  roomId: string;
  teacherToken: string;
  capacity: number;
  protocolVersion: number;
}

export function createRoom(opts: { capacity?: number; integrationId?: string; activityId?: string } = {}) {
  return request<CreatedRoom>('/api/rooms', { method: 'POST', body: JSON.stringify(opts) });
}

export interface RoomInfo {
  exists: boolean;
  phase?: RoomPhase;
  locked?: boolean;
  participants?: number;
  capacity?: number;
}

export function getRoomInfo(code: string) {
  return request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`);
}

export function getResult(code: string, roundId: string, teacherToken: string) {
  return request<{ result: RoundResult }>(
    `/api/rooms/${encodeURIComponent(code)}/results/${encodeURIComponent(roundId)}`,
    { headers: { authorization: `Bearer ${teacherToken}` } },
  );
}

export interface HealthInfo {
  ok: boolean;
  runtime: string;
  protocolVersion: number;
  maps: number;
  integrationsConfigured: string[];
  embedOriginsConfigured: number;
}

export function getHealth() {
  return request<HealthInfo>('/api/health');
}
