/**
 * 이 기기에만 남는 것.
 *
 * 담는 것: 교사 토큰, 학생 재접속 자격, 최근에 연 참여 코드, 화면 설정.
 * 담지 않는 것: 실명·학번 같은 개인정보. 그런 것은 애초에 서버로도 보내지 않는다.
 *
 * 사생활 보호 모드·저장소 차단에서는 읽기·쓰기가 **던질 수 있다.** 그래서 전부 감싼다 —
 * 저장이 안 되더라도 앱은 그대로 돌아가야 한다.
 */

const PREFIX = 'marble:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 저장할 수 없는 환경 — 그냥 넘어간다 */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 무시 */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ 교사 */

export interface TeacherRoomRecord {
  joinCode: string;
  roomId: string;
  teacherToken: string;
  createdAt: number;
}

/**
 * 교사가 연 방들. **여러 개**를 기억한다 —
 * 하나만 두면 [새 방 만들기] 를 잘못 누르는 순간 지난 방으로 돌아갈 길이 사라진다.
 */
export function rememberTeacherRoom(rec: TeacherRoomRecord): void {
  const list = listTeacherRooms().filter((r) => r.joinCode !== rec.joinCode);
  list.unshift(rec);
  write('teacherRooms', JSON.stringify(list.slice(0, 8)));
}

export function listTeacherRooms(): TeacherRoomRecord[] {
  return readJson<TeacherRoomRecord[]>('teacherRooms', []);
}

export function findTeacherRoom(joinCode: string): TeacherRoomRecord | undefined {
  return listTeacherRooms().find((r) => r.joinCode === joinCode);
}

export function forgetTeacherRoom(joinCode: string): void {
  write('teacherRooms', JSON.stringify(listTeacherRooms().filter((r) => r.joinCode !== joinCode)));
}

/* ------------------------------------------------------------------ 학생 */

export function getRejoinToken(joinCode: string): string | undefined {
  return read(`rejoin:${joinCode}`) ?? undefined;
}

export function setRejoinToken(joinCode: string, token: string): void {
  write(`rejoin:${joinCode}`, token);
}

export function clearRejoinToken(joinCode: string): void {
  remove(`rejoin:${joinCode}`);
}

export function getLastNickname(): string {
  return read('nickname') ?? '';
}

export function setLastNickname(nick: string): void {
  write('nickname', nick);
}

/** 이 기기를 가리키는 무작위 값. 이름이 아니다. */
export function deviceToken(): string {
  let t = read('device');
  if (!t) {
    t = `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    write('device', t);
  }
  return t;
}

/* ------------------------------------------------------------------ 화면 설정 */

export interface ViewPrefs {
  muted: boolean;
  /** 잔상·글로우 같은 효과를 줄인다 */
  reduceEffects: boolean;
  /** 내 구슬 강조 */
  highlightMine: boolean;
  cameraMode: 'whole' | 'leader' | 'me';
}

const DEFAULT_PREFS: ViewPrefs = {
  muted: true,
  reduceEffects: false,
  highlightMine: true,
  cameraMode: 'whole',
};

export function getViewPrefs(): ViewPrefs {
  // 「동작 줄이기」를 켜 둔 기기라면 효과 줄이기를 기본으로 한다
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return { ...DEFAULT_PREFS, reduceEffects: prefersReduced ?? false, ...readJson<Partial<ViewPrefs>>('prefs', {}) };
}

export function setViewPrefs(p: ViewPrefs): void {
  write('prefs', JSON.stringify(p));
}
