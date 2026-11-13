import { randomBytes, scryptSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { CSRF_COOKIE, SESSION_COOKIE, createAdminServer, parsePasswordHash, verifyPassword, type AdminServer } from './admin';
import { adminPageHtml, escapeHtml, loginPageHtml } from './adminPage';
import { createErdServer, type ErdServer } from './server';
import { StatsCollector } from './stats';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PASSWORD = 'correct horse battery staple';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 테스트용으로 가볍게(N=1024) 만든 해시 */
function hashOf(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  return `scrypt$1024$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Host, Origin 같은 헤더를 마음대로 넣어 보낸다 */
function request(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: { host: `localhost:${port}`, ...opts.headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function cookieOf(reply: Reply, name: string): string | null {
  for (const line of reply.headers['set-cookie'] ?? []) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(line);
    if (m) return m[1];
  }
  return null;
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

describe('관리자 페이지 보안', () => {
  let dir: string;
  let metrics: StatsCollector;
  let admin: AdminServer;
  let port: number;

  async function boot(passwordHash: string | undefined): Promise<void> {
    admin = createAdminServer({ metrics, live: () => ({ connections: 0, openRooms: 0 }), passwordHash, failureDelayMs: () => 0 });
    port = await admin.listen(0, '127.0.0.1');
  }

  /** 로그인 화면을 열어 CSRF 토큰과 쿠키를 받는다 */
  async function loginForm(): Promise<{ csrf: string; cookie: string }> {
    const page = await request(port, { path: '/login' });
    const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(page.body)?.[1] ?? '';
    return { csrf, cookie: `${CSRF_COOKIE}=${cookieOf(page, CSRF_COOKIE)}` };
  }

  async function login(password: string, extra: Record<string, string> = {}): Promise<Reply> {
    const { csrf, cookie } = await loginForm();
    return request(port, {
      method: 'POST',
      path: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://localhost:${port}`, cookie, ...extra },
      body: form({ csrf, password }),
    });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-admin-'));
    metrics = new StatsCollector({ dir, salt: 'y'.repeat(64) });
    await metrics.init();
  });
  afterEach(async () => {
    await admin?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('비밀번호 해시를 읽고 상수 시간으로 비교한다', async () => {
    const hash = hashOf(PASSWORD);
    expect(parsePasswordHash(hash)).not.toBeNull();
    expect(parsePasswordHash('plain-text-password')).toBeNull();
    expect(parsePasswordHash('scrypt$3$8$1$aaaa$bbbb')).toBeNull();
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, undefined)).toBe(false);
  });

  it('로그인 전에는 화면과 API를 주지 않는다', async () => {
    await boot(hashOf(PASSWORD));
    expect((await request(port, { path: '/api/summary' })).status).toBe(401);
    expect((await request(port, { path: '/api/daily?days=7' })).status).toBe(401);
    expect((await request(port, { path: '/api/live' })).status).toBe(401);
    const home = await request(port, { path: '/' });
    expect(home.status).toBe(303);
    expect(home.headers.location).toBe('/login');
    // 가짜 세션 쿠키도 통하지 않는다
    expect((await request(port, { path: '/api/summary', headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(64)}` } })).status).toBe(401);
  });

  it('Host가 localhost:포트가 아니면 거절한다(DNS 리바인딩)', async () => {
    await boot(hashOf(PASSWORD));
    expect((await request(port, { path: '/login', headers: { host: 'evil.example' } })).status).toBe(421);
    expect((await request(port, { path: '/login', headers: { host: `evil.example:${port}` } })).status).toBe(421);
    expect((await request(port, { path: '/login', headers: { host: 'localhost:1' } })).status).toBe(421);
    expect((await request(port, { path: '/login', headers: { host: `127.0.0.1:${port}` } })).status).toBe(200);
  });

  it('보안 헤더를 붙인다', async () => {
    await boot(hashOf(PASSWORD));
    const page = await request(port, { path: '/login' });
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain('unsafe-inline');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['referrer-policy']).toBe('same-origin');
    expect(page.headers['cache-control']).toBe('no-store');
    // 스크립트와 스타일은 그 응답의 nonce를 단다
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(page.body).toContain(`<style nonce="${nonce}">`);
  });

  it('로그인하면 HttpOnly, SameSite=Strict 세션 쿠키를 주고, 로그아웃은 CSRF 토큰이 있어야 한다', async () => {
    await boot(hashOf(PASSWORD));
    const ok = await login(PASSWORD);
    expect(ok.status).toBe(303);
    const line = (ok.headers['set-cookie'] ?? []).find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(line).toMatch(new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200$`));
    const cookie = `${SESSION_COOKIE}=${cookieOf(ok, SESSION_COOKIE)}`;

    const summary = await request(port, { path: '/api/summary', headers: { cookie } });
    expect(summary.status).toBe(200);
    expect(JSON.parse(summary.body)).toHaveProperty('totals');
    const daily = await request(port, { path: '/api/daily?days=7', headers: { cookie } });
    expect(JSON.parse(daily.body).rows).toHaveLength(7);

    const page = await request(port, { path: '/', headers: { cookie } });
    expect(page.status).toBe(200);
    const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(page.body)?.[1] ?? '';
    const origin = `http://localhost:${port}`;
    const type = 'application/x-www-form-urlencoded';
    // 토큰이 없거나 다르거나, 다른 출처에서 온 로그아웃은 거절한다
    expect((await request(port, { method: 'POST', path: '/logout', headers: { cookie, origin, 'content-type': type }, body: '' })).status).toBe(403);
    expect((await request(port, { method: 'POST', path: '/logout', headers: { cookie, origin, 'content-type': type }, body: form({ csrf: 'f'.repeat(64) }) })).status).toBe(403);
    expect((await request(port, { method: 'POST', path: '/logout', headers: { cookie, origin: 'http://evil.example', 'content-type': type }, body: form({ csrf }) })).status).toBe(403);
    const out = await request(port, { method: 'POST', path: '/logout', headers: { cookie, origin, 'content-type': type }, body: form({ csrf }) });
    expect(out.status).toBe(303);
    expect((await request(port, { path: '/api/summary', headers: { cookie } })).status).toBe(401);
  });

  it('CSRF: Origin이 없거나 다르거나 토큰이 틀린 로그인은 거절한다', async () => {
    await boot(hashOf(PASSWORD));
    expect((await login(PASSWORD, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await login(PASSWORD, { origin: 'null' })).status).toBe(403);
    const { csrf, cookie } = await loginForm();
    const noOrigin = await request(port, {
      method: 'POST',
      path: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form({ csrf, password: PASSWORD }),
    });
    expect(noOrigin.status).toBe(403);
    const wrongToken = await request(port, {
      method: 'POST',
      path: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://localhost:${port}`, cookie },
      body: form({ csrf: '0'.repeat(64), password: PASSWORD }),
    });
    expect(wrongToken.status).toBe(403);
  });

  it('5번 틀리면 잠기고, 잠긴 동안에는 맞는 비밀번호도 받지 않는다', async () => {
    await boot(hashOf(PASSWORD));
    for (let i = 0; i < 4; i++) expect((await login('wrong password')).status).toBe(401);
    expect((await login('wrong password')).status).toBe(429);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(cookieOf(locked, SESSION_COOKIE)).toBeNull();
  });

  it('비밀번호 해시가 없으면 아무도 로그인할 수 없다', async () => {
    await boot(undefined);
    const page = await request(port, { path: '/login' });
    expect(page.body).toContain('ADMIN_PASSWORD_HASH');
    expect((await login('')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(401);
  });

  it('화면에 넣는 값은 이스케이프한다', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">\'`&')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&#96;&amp;');
    const html = loginPageHtml({ nonce: 'n"><script>', csrf: '"><b>', message: '<script>alert(1)</script>', disabled: false });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"><b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // 대시보드 스크립트는 값을 innerHTML에 넣기 전에 esc()로 감싼다
    const page = adminPageHtml({ nonce: 'abc', csrf: 'def' });
    expect(page).toContain('function esc(');
    expect(page).not.toMatch(/ style="/);
  });
});

describe('공개 포트와 지표 수집', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  let adminPort = 0;
  const providers: WebsocketProvider[] = [];

  class BrowserSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { 'User-Agent': UA } });
    }
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-admin-int-'));
    server = createErdServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      saveDebounceMs: 20,
      log: () => {},
      stats: { salt: 'z'.repeat(64) },
      telemetryRequestsPerMinute: 30,
      adminPort: 0,
      adminPasswordHash: hashOf(PASSWORD),
    });
    const started = await server.start();
    port = started.port;
    adminPort = started.adminPort ?? 0;
  });
  afterEach(async () => {
    for (const p of providers.splice(0)) {
      p.destroy();
      p.doc.destroy();
    }
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const beacon = (body: unknown, headers: Record<string, string> = {}) =>
    request(port, { method: 'POST', path: '/api/t', headers: { 'content-type': 'text/plain', 'user-agent': UA, host: `127.0.0.1:${port}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('공개 포트에는 관리자 경로가 없다', async () => {
    expect(adminPort).toBeGreaterThan(0);
    expect(adminPort).not.toBe(port);
    for (const p of ['/admin', '/admin/', '/admin/login', '/stats', '/stats/summary', '/metrics', '/api/summary', '/api/daily?days=7', '/api/live']) {
      const res = await request(port, { path: p });
      expect(res.status, p).toBe(404);
      expect(res.body).not.toContain('modelll 관리자');
    }
    for (const p of ['/login', '/logout']) {
      const res = await request(port, { method: 'POST', path: p, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x' });
      expect(res.status, p).toBe(404);
    }
    expect((await request(port, { path: '/admin' })).status).toBe(404);
    expect((await request(port, { path: '/stats' })).status).toBe(404);
    // 관리자 포트는 따로 있다
    expect((await request(adminPort, { path: '/login' })).status).toBe(200);
  });

  it('지표 이벤트를 받고, 다른 사이트에서 온 것과 큰 본문은 버린다', async () => {
    const a = '0123456789abcdef0123456789abcdef';
    expect((await beacon({ a, e: 'home_view' }, { origin: `http://127.0.0.1:${port}` })).status).toBe(204);
    expect((await beacon({ a: 'fedcba9876543210fedcba9876543210', e: 'home_view' }, { origin: 'https://evil.example' })).status).toBe(204);
    expect((await beacon('{not json')).status).toBe(204);
    const big = await beacon({ a, e: 'home_view', pad: 'x'.repeat(4000) });
    expect(big.status).toBe(413);
    expect(big.body).toBe('');
    expect((await request(port, { method: 'GET', path: '/api/t' })).status).toBe(404);
    // 요청 제한(1분 30개)을 넘으면 읽지 않고 버린다
    for (let i = 0; i < 40; i++) await beacon({ a: `${i.toString(16).padStart(2, '0')}${'0'.repeat(30)}`, e: 'home_view' });

    const cookie = await adminLogin();
    const summary = JSON.parse((await request(adminPort, { path: '/api/summary', headers: { cookie } })).body);
    // 첫 번째 것(같은 출처) + 제한 안에 들어온 것만
    expect(summary.today.u.home).toBeGreaterThanOrEqual(1);
    expect(summary.today.u.home).toBeLessThanOrEqual(30);
  });

  async function adminLogin(): Promise<string> {
    const page = await request(adminPort, { path: '/login' });
    const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(page.body)?.[1] ?? '';
    const res = await request(adminPort, {
      method: 'POST',
      path: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://localhost:${adminPort}`, cookie: `${CSRF_COOKIE}=${cookieOf(page, CSRF_COOKIE)}` },
      body: form({ csrf, password: PASSWORD }),
    });
    return `${SESSION_COOKIE}=${cookieOf(res, SESSION_COOKIE)}`;
  }

  it('웹소켓 접속과 편집, 새 방, CLI 호출을 센다', async () => {
    const connect = (anon: string) => {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, 'stats-room', doc, {
        WebSocketPolyfill: BrowserSocket as unknown as typeof globalThis.WebSocket,
        disableBc: true,
        params: { a: anon },
      });
      providers.push(provider);
      return { doc, provider };
    };
    const x = connect('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const y = connect('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    const cookie = await adminLogin();
    const live = async () => JSON.parse((await request(adminPort, { path: '/api/live', headers: { cookie } })).body);
    for (let i = 0; i < 100 && (await live()).users < 2; i++) await sleep(20);
    expect(await live()).toMatchObject({ users: 2, collabRooms: 1, openRooms: 1, connections: 2 });

    x.doc.getMap('misc').set('k', 'hello');
    await sleep(150);
    const cli = await fetch(`http://127.0.0.1:${port}/api/rooms/stats-room/model`);
    expect(cli.status).toBe(200);

    const s = JSON.parse((await request(adminPort, { path: '/api/summary', headers: { cookie } })).body);
    expect(s.today.u).toMatchObject({ app: 2, 'r:collab': 1, 'r:active': 1, 'r:new': 1 });
    expect(s.today.c).toMatchObject({ edits: 1, 'cli:pull': 1 });
    expect(s.totals).toMatchObject({ rooms: 1, cli: 1 });
    y.provider.destroy();
  });
});
