/**
 * HTTP 부분. 상태 확인 API와 빌드된 클라이언트(dist/client) 정적 파일을 제공한다. [담당: server 에이전트]
 */
import path from 'node:path';
import express, { type Express } from 'express';
import { ROOM_ID_PATTERN } from '../shared/types';

export interface HttpDeps {
  /** 빌드된 클라이언트 폴더. 없어도 된다(그때는 API와 웹소켓만 동작). */
  staticDir: string;
  stats(): { rooms: number; connections: number };
  roomInfo(roomId: string): Promise<{ exists: boolean; clients: number }>;
  /** 서버가 떠 있던 시간(초) */
  uptime(): number;
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function createApp(deps: HttpDeps): Express {
  const staticDir = path.resolve(deps.staticDir);
  const assetsDir = path.join(staticDir, 'assets') + path.sep;
  const indexFile = path.join(staticDir, 'index.html');

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // 방은 주소를 받은 사람만 들어오는 곳이고 API는 화면이 아니다. 둘 다 검색에 나오지 않게 한다.
  // robots.txt에서 /r/ 을 막지 않는 것도 검색 로봇이 이 표시를 읽게 하기 위해서다.
  app.use((req, res, next) => {
    if (isUnder(req.path, '/r') || isUnder(req.path, '/api')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // ───────────────────────── API ─────────────────────────

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...deps.stats(), uptime: deps.uptime() });
  });

  app.get('/api/rooms/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!ROOM_ID_PATTERN.test(id)) {
      res.status(400).json({ exists: false, clients: 0, error: 'invalid room id' });
      return;
    }
    res.json(await deps.roomInfo(id));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // ───────────────────────── 정적 파일 ─────────────────────────

  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.startsWith(assetsDir)) {
          // 파일 이름에 해시가 들어 있어 내용이 바뀌면 이름도 바뀐다
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          // robots.txt, sitemap.xml, 아이콘, og.png 같은 루트 파일. 이름이 그대로라 내용이 바뀔 수 있으니 짧게만 캐시한다
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );

  // 나머지 GET은 SPA 경로(/r/<id>)로 보고 index.html을 준다
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = req.path;
    if (isUnder(pathname, '/api') || isUnder(pathname, '/ws') || isUnder(pathname, '/assets')) return next();
    // 확장자가 있는 경로는 없는 파일을 찾는 요청이다. html을 대신 주지 않는다.
    if (path.posix.basename(pathname).includes('.')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile, (err) => {
      if (!err || res.headersSent) return;
      res.status(404).type('text/plain; charset=utf-8').send('클라이언트가 아직 빌드되지 않았습니다. npm run build:client 를 실행합니다.');
    });
  });

  app.use((_req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Not Found');
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const status = (err as { status?: number } | null)?.status;
    res.status(typeof status === 'number' && status >= 400 && status < 600 ? status : 500).json({ error: 'server error' });
  });

  return app;
}
