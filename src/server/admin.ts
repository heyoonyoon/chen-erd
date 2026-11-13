/**
 * 관리자 페이지. 공개 앱과 다른 포트(기본 9000)에서 127.0.0.1에만 연다. SSH 터널로만 들어온다(scripts/admin-tunnel.sh).
 * Caddy는 이 포트로 넘기지 않고, 공개 포트(8787)에는 관리자 경로가 하나도 없다.
 *
 * 보안
 * - 비밀번호: 서버에는 scrypt 해시(ADMIN_PASSWORD_HASH, scripts/admin-password.mjs로 만든다)만 둔다. 없으면 아무도 로그인할 수 없다.
 *   비교는 timingSafeEqual. 실패가 5번 쌓이면 15분 잠그고, 실패할 때마다 답을 늦춘다.
 * - 세션: 무작위 256비트 토큰을 HttpOnly, SameSite=Strict 쿠키로. 서버 메모리에만 두고 12시간 뒤 끝난다.
 * - CSRF: 상태를 바꾸는 요청(로그인, 로그아웃)은 Origin이 이 페이지여야 하고 폼의 CSRF 토큰이 맞아야 한다.
 * - DNS 리바인딩: Host가 localhost, 127.0.0.1, [::1] 과 관리자 포트가 아니면 거절한다.
 * - 응답 헤더: CSP(스크립트와 스타일은 응답마다 새 nonce), frame-ancestors 'none', nosniff, Referrer-Policy same-origin, no-store.
 * - 화면에 나오는 값은 모두 이스케이프한다(리퍼러 도메인, UTM처럼 밖에서 온 값이 섞인다).
 *
 * 경로: GET / (화면), GET /login, POST /login, POST /logout, GET /api/summary, GET /api/daily?days=N, GET /api/live
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { adminPageHtml, loginPageHtml } from './adminPage';
import type { StatsCollector } from './stats';

export const SESSION_COOKIE = 'modelll_admin';
export const CSRF_COOKIE = 'modelll_admin_csrf';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FORM_BYTES = 2048;
const MAX_SESSIONS = 50;

export interface AdminDeps {
  metrics: StatsCollector;
  /** 지금 연결 수와 열린 방 수(SyncHub) */
  live(): { connections: number; openRooms: number };
  passwordHash?: string;
  log?: (message: string) => void;
  now?: () => number;
  /** 실패한 로그인에 답하기 전에 기다리는 시간. 테스트에서 줄인다 */
  failureDelayMs?: (failures: number) => number;
}

export interface AdminServer {
  /** 연 포트를 돌려준다. publicPort는 Host 검사에 쓸 포트(기본은 연 포트) */
  listen(port: number, host: string, publicPort?: number): Promise<number>;
  close(): Promise<void>;
}

// ───────────────────────── 비밀번호 ─────────────────────────

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** 'scrypt$N$r$p$소금(base64url)$해시(base64url)' */
export function parsePasswordHash(text: string | undefined): ParsedHash | null {
  if (!text) return null;
  const parts = text.trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || (N & (N - 1)) !== 0 || N < 1024 || N > 2 ** 20) return null;
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length < 16 || hash.length < 32) return null;
  return { N, r, p, salt, hash };
}

function scryptAsync(password: string, h: ParsedHash): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: 256 * h.N * h.r + 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const h = parsePasswordHash(stored);
  if (!h || password.length === 0 || password.length > 1024) return false;
  const key = await scryptAsync(password, h);
  return key.length === h.hash.length && timingSafeEqual(key, h.hash);
}

// ───────────────────────── 도우미 ─────────────────────────

function token(): string {
  return randomBytes(32).toString('hex');
}

function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookies(req: http.IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

function securityHeaders(res: http.ServerResponse, nonce: string): void {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // no-referrer로 두면 Chrome이 폼 POST의 Origin을 null로 보내 CSRF 확인을 할 수 없다. 같은 출처에만 보내고 바깥으로는 아무것도 안 보낸다
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function readForm(req: http.IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        done = true;
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => {
      if (!done) resolve(null);
      done = true;
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── 서버 ─────────────────────────

export function createAdminServer(deps: AdminDeps): AdminServer {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const delay = deps.failureDelayMs ?? ((n: number) => Math.min(5000, 500 * n));
  const sessions = new Map<string, { expires: number; csrf: string }>();
  let failures = 0;
  let lockedUntil = 0;
  let checking = false;
  let allowedHosts = new Set<string>();
  let server: http.Server | null = null;

  function session(req: http.IncomingMessage): { id: string; csrf: string } | null {
    const id = cookies(req).get(SESSION_COOKIE);
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
    const s = sessions.get(id);
    if (!s) return null;
    if (s.expires <= now()) {
      sessions.delete(id);
      return null;
    }
    return { id, csrf: s.csrf };
  }

  /** 상태를 바꾸는 요청이 이 페이지에서 왔는지(Origin이 있어야 하고 허용된 주소여야 한다) */
  function sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string') return false;
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && allowedHosts.has(url.host) && url.host === req.headers.host;
    } catch {
      return false;
    }
  }

  function loginPage(res: http.ServerResponse, nonce: string, status: number, message: string | null): void {
    const csrf = token();
    res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    const disabled = !parsePasswordHash(deps.passwordHash);
    send(res, status, 'text/html; charset=utf-8', loginPageHtml({ nonce, csrf, message, disabled }));
  }

  function summary() {
    const m = deps.metrics;
    return {
      now: new Date(now()).toISOString(),
      live: { ...deps.live(), ...m.liveCounts() },
      today: m.today(),
      active: m.activeUsers(),
      totals: m.totalsNow(),
      retention: m.retention(30),
      roomNextDay: m.roomNextDay(30),
    };
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const nonce = randomBytes(16).toString('base64');
    securityHeaders(res, nonce);
    // DNS 리바인딩: 다른 이름으로 들어온 요청은 받지 않는다
    if (!allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) {
      send(res, 421, 'text/plain; charset=utf-8', 'Misdirected Request');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const s = session(req);

    if (method === 'GET' && path === '/') {
      if (!s) {
        res.setHeader('Location', '/login');
        send(res, 303, 'text/plain; charset=utf-8', '');
        return;
      }
      send(res, 200, 'text/html; charset=utf-8', adminPageHtml({ nonce, csrf: s.csrf }));
      return;
    }

    if (method === 'GET' && path === '/login') {
      if (s) {
        res.setHeader('Location', '/');
        send(res, 303, 'text/plain; charset=utf-8', '');
        return;
      }
      loginPage(res, nonce, 200, null);
      return;
    }

    if (method === 'POST' && path === '/login') {
      const form = await readForm(req);
      if (!sameOrigin(req) || !form || !sameToken(form.get('csrf') ?? undefined, cookies(req).get(CSRF_COOKIE))) {
        send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
      }
      if (lockedUntil > now()) {
        const minutes = Math.ceil((lockedUntil - now()) / 60_000);
        loginPage(res, nonce, 429, `로그인 실패가 많아 잠겼습니다. ${minutes}분 뒤에 다시 시도하세요.`);
        return;
      }
      // 동시에 여러 번 시도해 실패 횟수 세기를 앞지르지 못하게 한 번에 하나씩만 확인한다
      if (checking) {
        loginPage(res, nonce, 429, '다른 로그인 시도를 확인하는 중입니다. 잠시 뒤에 다시 시도하세요.');
        return;
      }
      checking = true;
      let ok = false;
      try {
        ok = await verifyPassword(form.get('password') ?? '', deps.passwordHash);
        if (!ok) await wait(delay(failures + 1));
      } finally {
        checking = false;
      }
      if (!ok) {
        failures += 1;
        if (failures >= MAX_FAILURES) {
          lockedUntil = now() + LOCK_MS;
          failures = 0;
          log('admin login locked for 15 minutes after repeated failures');
        }
        const message = !parsePasswordHash(deps.passwordHash) ? '관리자 비밀번호가 설정되지 않아 로그인할 수 없습니다.' : '비밀번호가 맞지 않습니다.';
        loginPage(res, nonce, lockedUntil > now() ? 429 : 401, lockedUntil > now() ? '로그인 실패가 많아 15분 동안 잠겼습니다.' : message);
        return;
      }
      failures = 0;
      // 오래된 세션부터 지운다
      for (const [id, v] of sessions) if (v.expires <= now()) sessions.delete(id);
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
      const id = token();
      sessions.set(id, { expires: now() + SESSION_MS, csrf: token() });
      res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
        `${CSRF_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      ]);
      res.setHeader('Location', '/');
      send(res, 303, 'text/plain; charset=utf-8', '');
      return;
    }

    if (method === 'POST' && path === '/logout') {
      const form = await readForm(req);
      if (!s || !sameOrigin(req) || !form || !sameToken(form.get('csrf') ?? undefined, s.csrf)) {
        send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
      }
      sessions.delete(s.id);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      res.setHeader('Location', '/login');
      send(res, 303, 'text/plain; charset=utf-8', '');
      return;
    }

    if (method === 'GET' && path.startsWith('/api/')) {
      if (!s) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      if (path === '/api/summary') return json(res, 200, summary());
      if (path === '/api/live') return json(res, 200, { now: new Date(now()).toISOString(), ...deps.live(), ...deps.metrics.liveCounts() });
      if (path === '/api/daily') {
        const raw = url.searchParams.get('days');
        const n = raw === null || raw === 'all' ? 0 : Number(raw);
        const days = Number.isInteger(n) && n > 0 && n <= 3660 ? n : undefined;
        return json(res, 200, { rows: deps.metrics.daily(days) });
      }
      json(res, 404, { error: 'not found' });
      return;
    }

    send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
  }

  return {
    async listen(port, host, publicPort) {
      if (server) throw new Error('already listening');
      const srv = http.createServer((req, res) => {
        handle(req, res).catch((err: unknown) => {
          log(`admin request failed: ${(err as Error).message}`);
          if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Server Error');
          else res.destroy();
        });
      });
      srv.requestTimeout = 15_000;
      srv.headersTimeout = 10_000;
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(port, host, () => {
          srv.off('error', reject);
          resolve();
        });
      });
      server = srv;
      const actual = (srv.address() as AddressInfo).port;
      const p = publicPort ?? actual;
      allowedHosts = new Set([`localhost:${p}`, `127.0.0.1:${p}`, `[::1]:${p}`]);
      return actual;
    },
    async close() {
      const srv = server;
      server = null;
      sessions.clear();
      if (!srv) return;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections();
      });
    },
  };
}
