/**
 * mount 요청 검사.
 *
 * 여기서 모드를 잘못 가르면 부모 앱은 「왜 학생이 못 들어오지」 또는
 * 「왜 방이 안 만들어지지」를 오래 헤맨다. 조용히 다른 모드로 넘어가지 않게 한다.
 */

import { describe, expect, it } from 'vitest';
import { EMBED_CAPABILITIES, LOCAL_MAX_PARTICIPANTS, parseMountPayload } from './embed.ts';

const live = { mode: 'live', view: 'teacher', ticket: 'abc.def', integrationId: '수업앱' };

describe('parseMountPayload — 모드 가르기', () => {
  it('mode 가 없으면 live 로 본다 (이 값을 모르던 옛 부모 앱)', () => {
    const r = parseMountPayload({ view: 'student', ticket: 'abc.def' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mode).toBe('live');
  });

  it('모르는 모드는 거절한다', () => {
    const r = parseMountPayload({ ...live, mode: 'offline' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_mode');
  });

  it('view 가 없으면 거절한다', () => {
    const r = parseMountPayload({ mode: 'live', ticket: 'abc.def' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_view');
  });

  it('내용이 통째로 비면 거절한다', () => {
    expect(parseMountPayload(null).ok).toBe(false);
    expect(parseMountPayload('mount').ok).toBe(false);
  });
});

describe('parseMountPayload — live', () => {
  it('티켓이 있으면 통과한다', () => {
    const r = parseMountPayload(live);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ticket).toBe('abc.def');
      expect(r.value.integrationId).toBe('수업앱');
    }
  });

  it('티켓이 없으면 거절하고, local 을 쓰라고 알려 준다', () => {
    const r = parseMountPayload({ mode: 'live', view: 'teacher' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('no_ticket');
      // 무엇을 하라는 것인지 메시지에 들어 있어야 한다
      expect(r.message).toContain('local');
    }
  });
});

describe('parseMountPayload — local', () => {
  it('티켓 없이 통과하고, 늘 교사 화면이다', () => {
    const r = parseMountPayload({ mode: 'local', view: 'student' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('local');
      // local 은 이 iframe 자체가 진행자 화면이다 — 학생 화면이라는 개념이 없다
      expect(r.value.view).toBe('teacher');
      expect(r.value.ticket).toBeUndefined();
    }
  });

  it('티켓을 들고 오면 거절한다 — 부모가 모드를 헷갈린 것이다', () => {
    const r = parseMountPayload({ mode: 'local', view: 'teacher', ticket: 'abc.def' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ticket_in_local');
      expect(r.message).toContain('live');
    }
  });

  it('명단을 함께 받고, 빈 이름은 버린다', () => {
    const r = parseMountPayload({
      mode: 'local',
      view: 'teacher',
      participants: [
        { id: 'u1', nickname: '김하늘' },
        { id: 'u2', nickname: '   ' },
        { id: 'u3', nickname: '박서준' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.participants).toHaveLength(2);
      expect(r.value.participants?.map((x) => x.nickname)).toEqual(['김하늘', '박서준']);
    }
  });

  it('id 를 안 주면 자리 번호로 만들어 준다', () => {
    const r = parseMountPayload({ mode: 'local', view: 'teacher', participants: [{ nickname: '김하늘' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.participants?.[0]?.id).toBe('p0');
  });

  it('상한을 넘는 명단은 거절한다', () => {
    const many = Array.from({ length: LOCAL_MAX_PARTICIPANTS + 1 }, (_, i) => ({ id: `u${i}`, nickname: `학생${i}` }));
    const r = parseMountPayload({ mode: 'local', view: 'teacher', participants: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_participants');
  });

  it('명단이 배열이 아니면 거절한다', () => {
    const r = parseMountPayload({ mode: 'local', view: 'teacher', participants: '김하늘,박서준' });
    expect(r.ok).toBe(false);
  });
});

describe('capabilities', () => {
  it('local 모드를 할 줄 안다고 알린다 — 부모가 옛 배포를 알아볼 수 있어야 한다', () => {
    expect(EMBED_CAPABILITIES).toContain('mode.local');
  });
});
