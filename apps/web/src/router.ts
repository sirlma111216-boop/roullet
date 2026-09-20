/**
 * 아주 작은 라우터.
 *
 * 라우팅 라이브러리를 따로 넣지 않는다 — 화면이 여섯 개뿐이고,
 * 새로고침 처리는 서버(Workers Static Assets)가 맡기 때문이다.
 */

import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  query: URLSearchParams;
}

function current(): Route {
  return { path: location.pathname.replace(/\/+$/, '') || '/', query: new URLSearchParams(location.search) };
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onPop = () => setRoute(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** 학생이 들어오는 주소 — QR 에 넣는 것도 이것이다. 교사 토큰은 절대 넣지 않는다. */
export function studentJoinUrl(joinCode: string): string {
  return `${location.origin}/join?code=${encodeURIComponent(joinCode)}`;
}
