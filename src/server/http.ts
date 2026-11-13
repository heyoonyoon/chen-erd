/**
 * HTTP 부분. 상태 확인 API, 모델 텍스트 API와 빌드된 클라이언트(dist/client) 정적 파일을 제공한다. [담당: server 에이전트]
 *
 * 모델 API(CLI와 다른 프로그램이 쓴다. 응답의 error는 문장이 아니라 코드다)
 *   GET /api/rooms/:id/model      방의 내용을 모델 텍스트로 준다(text/plain)
 *   GET /api/rooms/:id/diagram    방의 도형과 선을 JSON으로 준다
 *   PUT /api/rooms/:id/model      모델 텍스트를 받아 방을 그 내용으로 맞춘다. 없는 방이면 만든다. ?relayout=1 이면 전체를 다시 배치한다
 *   GET /api/rooms/:id/relational 방에서 사람들이 적은 관계 모델 글(text/plain). 아직 없으면 빈 글
 *                                 밑줄(기본키)은 일반 텍스트 교환 표기 _이름_ 으로 바꿔 준다(toMarkup)
 *   PUT /api/rooms/:id/relational 관계 모델 글(_이름_ 표기)을 받아 방의 글과 밑줄을 바꾼다(fromMarkup → setRelationalSource).
 *                                 있는 방만 된다. 문법이나 내용 오류가 있으면 쓰지 않는다(400 syntax, 위치는 받은 글 기준)
 *   GET /api/rooms/:id/sql        관계 모델 글과 컬럼 설정에서 만든 CREATE TABLE 문(text/plain). ?dialect=postgresql | mysql | oracle (없으면 방에서 고른 DBMS, 그것도 없으면 postgresql)
 *                                 ERD에서 아무것도 추측하지 않는다. 타입을 정하지 않은 컬럼은 SQL에 '/* 타입 미지정 *\/' 자리 표시로 들어가고,
 *                                 그 목록은 SQL 머리 주석으로 적고 개수는 X-Missing-Types 헤더로 준다.
 *                                 글에 오류가 있으면 읽은 부분만 옮기고, 그 사실을 머리 주석에, 오류 개수를 X-Relational-Errors 헤더에 적는다
 *
 * MCP(AI 도구가 쓴다. src/server/mcp.ts)
 *   POST /mcp                     Streamable HTTP. 세션과 인증이 없다
 *
 * 지표(src/server/stats.ts)
 *   POST /api/t                   브라우저가 sendBeacon으로 보내는 작은 이벤트. 허용된 이름만 세고 나머지는 버린다. 언제나 204
 *   관리자 페이지와 지표 조회는 이 포트에 없다(따로 연 관리자 포트, src/server/admin.ts). /admin, /stats는 여기서 404다
 */
import path from 'node:path';
import express, { type Express, type Request, type RequestHandler } from 'express';
import { diagramToText, parseModel } from '../shared/model';
import type { Model } from '../shared/model/types';
import { ROOM_ID_PATTERN } from '../shared/types';
import { fromMarkup, parseMarkup, parseRelational, toMarkup, toSql } from '../shared/relational';
import { isSqlDialect } from '../shared/relational/sql';
import { readColumnSettings, readRelationalSource, readRoomDialect, setRelationalSource } from '../shared/relational/ydoc';
import { problemText } from '../cli/format';
import type { RelProblem } from '../shared/relational/userSchema';
import { getEdges, getNodes, getTitle } from '../shared/ydoc';
import { clientIp } from './limits';
import { mountMcp, type McpDeps } from './mcp';
import { MAX_MODEL_BYTES, MAX_NODES, modelNodeCount, writeModel, type WithDoc } from './model';
import type { StatsCollector } from './stats';
import { RoomUnavailableError } from './sync';
import { MAX_TELEMETRY_BYTES, TELEMETRY_PATH } from '../shared/telemetry';

/** MCP가 쓰는 것(요청 제한, 밖에서 보이는 주소, 로그)은 McpDeps에 적혀 있다 */
export interface HttpDeps extends McpDeps {
  /** 빌드된 클라이언트 폴더. 없어도 된다(그때는 API와 웹소켓만 동작). */
  staticDir: string;
  stats(): { rooms: number; connections: number };
  roomInfo(roomId: string): Promise<{ exists: boolean; clients: number }>;
  /** 서버가 떠 있던 시간(초) */
  uptime(): number;
  /** 메모리에도 디스크에도 없는 방인지 */
  isNewRoom(roomId: string): Promise<boolean>;
  /** 방의 문서로 동기 함수를 실행한다(SyncHub.withDoc). 방을 내줄 수 없으면 RoomUnavailableError */
  withDoc: WithDoc;
  /** 이 주소가 새 방을 만들어도 되는지 보고, 되면 기록한다(웹소켓으로 만들 때와 같은 제한) */
  tryCreateRoom(ip: string, roomId: string): boolean;
  /** 모델 API 요청 하나를 센다. 받아도 되면 0, 아니면 다시 보낼 수 있을 때까지 남은 초 */
  takeApiRequest(ip: string): number;
  /** 지표를 모으는 곳. 없으면 지표를 세지 않는다(POST /api/t는 그래도 204) */
  metrics?: StatsCollector;
  /** 지표 이벤트 하나를 센다(요청 제한). 받아도 되면 0 */
  takeTelemetryRequest?(ip: string): number;
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** 읽지 못한 위치가 담긴 오류인지. 번들이 나뉘어 클래스가 달라져도 알아보도록 이름으로 본다 */
function isSyntaxError(err: unknown): err is Error & { line: number; column: number } {
  return err instanceof Error && err.name === 'ModelSyntaxError';
}

/**
 * 요청 본문에서 모델 텍스트를 꺼낸다. JSON이면 { "text": "..." } 의 text, 그 밖의 형식은 본문 전체가 텍스트다.
 * JSON인데 읽을 수 없거나 text가 없으면 null.
 */
function modelTextOf(req: Request): string | null {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  // TextDecoder는 맨 앞의 BOM을 떼어 준다
  const text = new TextDecoder().decode(raw);
  if (!req.is('application/json')) return text;
  try {
    const value: unknown = JSON.parse(text);
    const inner = (value as { text?: unknown } | null)?.text;
    return typeof inner === 'string' ? inner : null;
  } catch {
    return null;
  }
}

/** 관계 모델 글의 문제 하나를 응답용으로. 문장은 영어다 */
function problemJson(p: RelProblem): { severity: RelProblem['severity']; line: number; column: number; message: string } {
  return { severity: p.severity, line: p.line, column: p.column, message: problemText(p, 'en') };
}

/**
 * 지표 이벤트를 보낸 페이지가 이 앱인지. 다른 사이트가 숫자를 부풀리지 못하게 Origin을 본다.
 * Origin이 있으면 요청의 Host(같은 출처)나 PUBLIC_URL과 같아야 한다. 없으면(오래된 브라우저 등) 받되 요청 제한으로 막는다.
 */
export function telemetryOriginAllowed(req: Request, publicUrl?: string): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  if (publicUrl) {
    try {
      if (host === new URL(publicUrl).host) return true;
    } catch {
      // 아래로
    }
  }
  return false;
}

export function createApp(deps: HttpDeps): Express {
  const staticDir = path.resolve(deps.staticDir);
  const assetsDir = path.join(staticDir, 'assets') + path.sep;
  const indexFile = path.join(staticDir, 'index.html');

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 방 주소는 비밀 링크다. 다른 사이트로 넘어갈 때 경로가 Referer로 새지 않게 한다
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // 다른 사이트가 앱을 iframe에 넣어 누르게 만드는 것(클릭재킹)을 막는다
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    next();
  });

  const metrics = deps.metrics;
  if (metrics) {
    // 서버 오류 수. 응답이 끝날 때 상태 코드만 본다
    app.use((_req, res, next) => {
      res.once('finish', () => {
        if (res.statusCode >= 500) metrics.serverError();
      });
      next();
    });
  }

  // 방은 주소를 받은 사람만 들어오는 곳이고 API는 화면이 아니다. 둘 다 검색에 나오지 않게 한다.
  // robots.txt에서 /r/ 을 막지 않는 것도 검색 로봇이 이 표시를 읽게 하기 위해서다.
  app.use((req, res, next) => {
    if (isUnder(req.path, '/r') || isUnder(req.path, '/api') || isUnder(req.path, '/mcp')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
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

  // ───────────────────────── 모델 API ─────────────────────────

  /** 요청 빈도와 방 id를 확인한다. 세 경로 모두 본문을 읽기 전에 거친다 */
  const guardRoom: RequestHandler = (req, res, next) => {
    const wait = deps.takeApiRequest(clientIp(req));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ ok: false, error: 'rate' });
      return;
    }
    if (!ROOM_ID_PATTERN.test(String(req.params.id))) {
      res.status(400).json({ ok: false, error: 'invalid-room' });
      return;
    }
    next();
  };

  // 본문은 형식과 상관없이 바이트로 받아 직접 푼다(curl이 붙이는 기본 Content-Type으로 보내도 받는다)
  const readModelBody = express.raw({ type: () => true, limit: MAX_MODEL_BYTES });

  app.get('/api/rooms/:id/model', guardRoom, async (req, res) => {
    const id = String(req.params.id);
    // 읽기만으로 방이 생기면 안 된다
    if (await deps.isNewRoom(id)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const text = await deps.withDoc(id, (doc) => diagramToText(getNodes(doc), getEdges(doc), getTitle(doc) || undefined));
    metrics?.cliCall('pull');
    res.type('text/plain; charset=utf-8').send(text);
  });

  app.get('/api/rooms/:id/diagram', guardRoom, async (req, res) => {
    const id = String(req.params.id);
    if (await deps.isNewRoom(id)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const diagram = await deps.withDoc(id, (doc) => ({ title: getTitle(doc), nodes: getNodes(doc), edges: getEdges(doc) }));
    metrics?.cliCall('diagram');
    res.json(diagram);
  });

  app.get('/api/rooms/:id/relational', guardRoom, async (req, res) => {
    const id = String(req.params.id);
    if (await deps.isNewRoom(id)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const text = await deps.withDoc(id, (doc) => toMarkup(readRelationalSource(doc)));
    metrics?.cliCall('relational');
    res.type('text/plain; charset=utf-8').send(text);
  });

  app.put('/api/rooms/:id/relational', guardRoom, readModelBody, async (req, res) => {
    const id = String(req.params.id);
    const raw = modelTextOf(req);
    if (raw === null) {
      res.status(400).json({ ok: false, error: 'bad-request', message: 'expected a JSON body like { "text": "..." }' });
      return;
    }
    // 줄 끝을 \n 하나로 맞춘다(화면의 편집기도 \n만 쓴다)
    const text = raw.replace(/\r\n?/g, '\n');
    // 틀린 글은 방을 건드리기 전에 돌려보낸다. 경고(기본키가 없는 테이블)는 받는다. _이름_ 은 밑줄이다
    const { schema, problems } = parseMarkup(text);
    const errors = problems.filter((p) => p.severity === 'error');
    if (errors.length > 0) {
      const first = errors[0];
      res.status(400).json({
        ok: false,
        error: 'syntax',
        message: problemText(first, 'en'),
        line: first.line,
        column: first.column,
        problems: problems.map(problemJson),
      });
      return;
    }
    // 관계 모델 글은 다이어그램이 있는 방에 붙는다. 읽기 API와 같이 없는 방은 만들지 않는다
    if (await deps.isNewRoom(id)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const source = fromMarkup(text);
    const changed = await deps.withDoc(id, (doc) => {
      const before = JSON.stringify(readRelationalSource(doc));
      setRelationalSource(doc, source, 'api');
      return before !== JSON.stringify(readRelationalSource(doc));
    });
    if (metrics) {
      metrics.cliCall('relational-push');
      if (changed) {
        metrics.aiRoom(id, 'modify');
        if (schema.tables.length > 0) metrics.relationalWritten(id);
      }
    }
    res.json({ ok: true, room: id, changed, tables: schema.tables.length, problems: problems.map(problemJson) });
  });

  app.get('/api/rooms/:id/sql', guardRoom, async (req, res) => {
    const id = String(req.params.id);
    const asked = req.query.dialect === undefined ? null : String(req.query.dialect).toLowerCase();
    if (asked !== null && !isSqlDialect(asked)) {
      res.status(400).json({ ok: false, error: 'bad-dialect', message: 'dialect must be postgresql, mysql or oracle' });
      return;
    }
    if (await deps.isNewRoom(id)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const out = await deps.withDoc(id, (doc) => {
      // 따로 묻지 않으면 방에서 고른 DBMS, 고른 적이 없으면 PostgreSQL
      const dialect = asked !== null && isSqlDialect(asked) ? asked : (readRoomDialect(doc) ?? 'postgresql');
      const { schema, problems } = parseRelational(readRelationalSource(doc));
      const errors = problems.filter((p) => p.severity === 'error').length;
      const result = toSql(schema, readColumnSettings(doc), dialect, { title: getTitle(doc) || undefined, listMissingTypes: true, textErrors: errors });
      return { ...result, errors };
    });
    metrics?.cliCall('sql');
    res.setHeader('X-Missing-Types', String(out.missingTypes.length));
    res.setHeader('X-Relational-Errors', String(out.errors));
    res.type('text/plain; charset=utf-8').send(out.sql);
  });

  app.put('/api/rooms/:id/model', guardRoom, readModelBody, async (req, res) => {
    const id = String(req.params.id);
    const text = modelTextOf(req);
    if (text === null) {
      res.status(400).json({ ok: false, error: 'bad-request', message: 'expected a JSON body like { "text": "..." }' });
      return;
    }

    // 읽지 못하는 텍스트는 방을 건드리기 전에 돌려보낸다
    let model: Model;
    try {
      model = parseModel(text);
    } catch (err) {
      if (!isSyntaxError(err)) throw err;
      res.status(400).json({ ok: false, error: 'syntax', message: err.message, line: err.line, column: err.column });
      return;
    }
    if (modelNodeCount(model) > MAX_NODES) {
      res.status(422).json({ ok: false, error: 'too-large' });
      return;
    }

    const relayout = req.query.relayout === '1' || req.query.relayout === 'true';
    const created = await deps.isNewRoom(id);
    if (created && !deps.tryCreateRoom(clientIp(req), id)) {
      res.status(429).json({ ok: false, error: 'room-rate' });
      return;
    }

    const outcome = await writeModel(deps.withDoc, id, model, { relayout, created });
    if (!outcome) {
      res.status(422).json({ ok: false, error: 'too-large' });
      return;
    }
    if (metrics) {
      metrics.cliCall(created ? 'new' : 'push');
      metrics.aiRoom(id, created ? 'create' : 'modify');
    }
    res.json({ ok: true, room: id, created, ...outcome });
  });

  // 모델 API에서 난 오류 가운데 원인을 아는 것은 코드로 알려 준다. 나머지는 맨 아래의 처리로 넘긴다
  app.use('/api/rooms', (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if ((err as { type?: string } | null)?.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: 'body-too-large' });
      return;
    }
    if (err instanceof RoomUnavailableError) {
      res.status(503).json({ ok: false, error: 'unavailable' });
      return;
    }
    next(err);
  });

  // ───────────────────────── 지표 이벤트 ─────────────────────────

  // sendBeacon은 text/plain으로 보낸다(미리 묻는 요청이 없다). 형식과 상관없이 작은 바이트로 받는다
  const readTelemetry = express.raw({ type: () => true, limit: MAX_TELEMETRY_BYTES });
  app.post(TELEMETRY_PATH, (req, res, next) => {
    // 요청 제한에 걸리면 본문을 읽지 않고 버린다. 브라우저는 응답을 보지 않으므로 언제나 204로 답한다
    if (!metrics || !telemetryOriginAllowed(req, deps.publicUrl) || (deps.takeTelemetryRequest?.(clientIp(req)) ?? 0) > 0) {
      res.status(204).end();
      return;
    }
    next();
  }, readTelemetry, (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      metrics?.clientEvent(JSON.parse(raw.toString('utf8')), req.headers['user-agent']);
    } catch {
      // 읽을 수 없는 본문은 버린다
    }
    res.status(204).end();
  });
  app.use(TELEMETRY_PATH, (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status((err as { type?: string } | null)?.type === 'entity.too.large' ? 413 : 400).end();
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // ───────────────────────── MCP ─────────────────────────

  mountMcp(app, deps);

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

  // /.well-known 아래는 프로그램이 읽는 자리다. MCP 클라이언트는 접속하기 전에 여기서 OAuth 설정을 찾는데,
  // index.html을 200으로 주면 그것을 JSON으로 읽으려다 실패한다. 실제 파일이 아니면 JSON 404로 답한다.
  // (위의 정적 파일 처리는 점으로 시작하는 폴더를 건너뛰므로 이 폴더의 파일은 여기서 따로 내준다)
  app.use(
    '/.well-known',
    express.static(path.join(staticDir, '.well-known'), {
      index: false,
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=3600'),
    }),
  );
  app.use('/.well-known', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'not found' });
  });

  // 관리자 화면은 공개 포트에 없다(관리자 포트에만 있다). 첫 화면이 대신 나가지 않게 404로 끝낸다
  app.use((req, res, next) => {
    if (isUnder(req.path, '/admin') || isUnder(req.path, '/stats') || isUnder(req.path, '/metrics')) {
      res.status(404).type('text/plain; charset=utf-8').send('Not Found');
      return;
    }
    next();
  });

  // 나머지 GET은 SPA 경로(/r/<id>)로 보고 index.html을 준다
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = req.path;
    if (isUnder(pathname, '/api') || isUnder(pathname, '/ws') || isUnder(pathname, '/assets') || isUnder(pathname, '/mcp')) return next();
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
