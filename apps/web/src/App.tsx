/**
 * 화면 고르기.
 *
 * 주소는 서버(Workers Static Assets)가 SPA 로 되돌려 주므로,
 * 학생이 /join?code=... 을 직접 열거나 새로고침해도 그대로 열린다.
 */

import { normalizeJoinCode } from '@marble/protocol';
import { useRoute } from './router.ts';
import { Home } from './pages/Home.tsx';
import { Teacher } from './pages/Teacher.tsx';
import { Join } from './pages/Join.tsx';
import { Play } from './pages/Play.tsx';
import { Local } from './pages/Local.tsx';
import { Embed } from './pages/Embed.tsx';

export function App(): React.ReactElement {
  const route = useRoute();
  const code = normalizeJoinCode(route.query.get('code') ?? '');

  switch (route.path) {
    case '/teacher':
      return <Teacher code={code} />;
    case '/join':
      return <Join initialCode={code} />;
    case '/play':
      return <Play code={code} nickname={route.query.get('nick') ?? undefined} />;
    case '/local':
      return <Local />;
    case '/embed':
      return <Embed />;
    case '/':
      return <Home />;
    default:
      return <Home />;
  }
}
