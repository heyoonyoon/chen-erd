/**
 * HTTP와 웹소켓을 한 포트로 묶은 서버. 테스트에서도 그대로 띄울 수 있다. [담당: server 에이전트]
 */
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ROOM_ID_PATTERN } from '../shared/types';
import { createAdminServer, type AdminServer } from './admin';
import { createApp } from './http';
import { CLOSE_ROOM_RATE_LIMIT, CLOSE_TOO_MANY_CONNECTIONS, ClientLimits, RequestRateLimiter, clientIp } from './limits';
import { Persistence, type Logger } from './persistence';
import { StatsCollector } from './stats';
import { CLOSE_INVALID_ROOM, SyncHub } from './sync';

export interface ErdServerOptions {
  /** 기본 8787. 0이면 빈 포트를 고른다 */
  port?: number;
  /** 기본 0.0.0.0 */
  host?: string;
  /** 방 문서를 저장하는 폴더. 기본 ./data */
  dataDir?: string;
  /** 빌드된 클라이언트 폴더. 기본 dist/client */
  staticDir?: string;
  // 아래는 주로 테스트에서 시간을 줄이려고 쓴다
  maxClientsPerRoom?: number;
  saveDebounceMs?: number;
  unloadDelayMs?: number;
  pingIntervalMs?: number;
  backupIntervalMs?: number;
  maxBackups?: number;
  /** IP당 동시 연결 수. 기본 0(제한 없음) */
  maxConnectionsPerIp?: number;
  /** 같은 IP가 새 방을 다시 만들 수 있기까지의 시간. 기본 0(제한 없음) */
  roomCreateIntervalMs?: number;
  /** 한 IP가 1분 동안 보낼 수 있는 모델 API 요청 수. 기본 0(제한 없음) */
  apiRequestsPerMinute?: number;
  /** 한 IP가 1분 동안 보낼 수 있는 MCP 요청 수(POST /mcp). 기본 0(제한 없음) */
  mcpRequestsPerMinute?: number;
  /** 한 IP가 1분 동안 MCP로 만들 수 있는 새 방 수. 기본 0(제한 없음) */
  mcpRoomCreatesPerMinute?: number;
  /** 밖에서 보이는 주소(https://modelll.app). MCP가 돌려주는 방 주소에 쓴다. 없으면 요청의 Host에서 알아낸다 */
  publicUrl?: string;
  /** 이 시간 동안 아무도 열지 않은 방을 지운다. 기본 0(지우지 않음) */
  roomTtlMs?: number;
  /** 지울 방을 찾는 주기. 기본 6시간 */
  roomSweepIntervalMs?: number;
  /** 로그를 받을 함수. 기본은 console.log */
  log?: Logger;
  /** 서비스 지표를 모은다(DATA_DIR/stats). 기본 false */
  stats?: boolean | { salt?: string; flushIntervalMs?: number; now?: () => number };
  /** 한 IP가 1분 동안 보낼 수 있는 지표 이벤트 수(POST /api/t). 기본 0(제한 없음) */
  telemetryRequestsPerMinute?: number;
  /** 관리자 페이지 포트. 없으면 열지 않는다. 0이면 빈 포트를 고른다. stats가 켜져 있어야 한다 */
  adminPort?: number;
  /** 관리자 페이지를 여는 주소. 기본 127.0.0.1(컨테이너 안에서는 0.0.0.0으로 열고 호스트에서 127.0.0.1로만 잇는다) */
  adminHost?: string;
  /** 관리자 비밀번호의 scrypt 해시(scripts/admin-password.mjs). 없으면 아무도 로그인할 수 없다 */
  adminPasswordHash?: string;
  /** 관리자 페이지가 받는 Host의 포트. 기본은 관리자 포트(터널의 로컬 포트를 다르게 쓰면 여기에 그 포트) */
  adminPublicPort?: number;
}

export interface ErdServer {
  start(): Promise<{ port: number; adminPort?: number }>;
  stop(): Promise<void>;
}

const MAX_PAYLOAD = 8 * 1024 * 1024;

/** 번들(dist/server/index.js) 옆의 dist/client를 먼저 찾고, 없으면 실행 폴더의 dist/client를 쓴다. */
function defaultStaticDir(): string {
  const fromCwd = path.resolve(process.cwd(), 'dist/client');
  try {
    const besideBundle = fileURLToPath(new URL('../client', import.meta.url));
    if (existsSync(path.join(besideBundle, 'index.html'))) return besideBundle;
  } catch {
    // file: URL이 아닌 환경에서는 실행 폴더 기준만 쓴다
  }
  return fromCwd;
}

interface ConnMeta {
  anonId: string | null;
  ua: string | undefined;
}

function anonIdOf(url: string): string | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('a');
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createErdServer(opts: ErdServerOptions = {}): ErdServer {
  const port = opts.port ?? 8787;
  const host = opts.host ?? '0.0.0.0';
  const log: Logger = opts.log ?? ((message) => console.log(`[erd] ${message}`));

  const persistence = new Persistence({
    dataDir: opts.dataDir ?? './data',
    backupIntervalMs: opts.backupIntervalMs,
    maxBackups: opts.maxBackups,
    log,
  });
  const statsOpts = typeof opts.stats === 'object' ? opts.stats : {};
  const metrics = opts.stats
    ? new StatsCollector({ dir: path.join(opts.dataDir ?? './data', 'stats'), salt: statsOpts.salt, flushIntervalMs: statsOpts.flushIntervalMs, now: statsOpts.now, log })
    : undefined;
  const hub = new SyncHub(persistence, {
    onEdit: metrics ? (roomId) => metrics.edit(roomId) : undefined,
    onRoomCreated: metrics ? (roomId) => metrics.roomCreated(roomId) : undefined,
    maxClientsPerRoom: opts.maxClientsPerRoom,
    saveDebounceMs: opts.saveDebounceMs,
    unloadDelayMs: opts.unloadDelayMs,
    pingIntervalMs: opts.pingIntervalMs,
    log,
  });

  const limits = new ClientLimits({
    maxConnectionsPerIp: opts.maxConnectionsPerIp,
    roomCreateIntervalMs: opts.roomCreateIntervalMs,
  });
  const apiRate = new RequestRateLimiter({ max: opts.apiRequestsPerMinute });
  // MCP는 여러 사람이 같은 주소로 들어오므로 모델 API와 따로 센다
  const mcpRate = new RequestRateLimiter({ max: opts.mcpRequestsPerMinute });
  const mcpCreateRate = new RequestRateLimiter({ max: opts.mcpRoomCreatesPerMinute });
  const telemetryRate = new RequestRateLimiter({ max: opts.telemetryRequestsPerMinute });

  /** 방에 실제로 들어간 연결을 지표에 넣는다(방이 꽉 차서 닫힌 연결은 빼고) */
  function joined(ws: WebSocket, roomId: string, meta: ConnMeta): void {
    if (!metrics || ws.readyState !== WebSocket.OPEN) return;
    metrics.wsOpen(ws, roomId, meta.anonId, meta.ua);
    ws.once('close', (code: number) => metrics.wsClose(ws, code));
  }

  /** 새 방이면 만드는 빈도를 확인한 뒤 방에 넣는다. 확인하는 동안 온 메시지는 모아 두었다가 넘긴다. */
  async function admit(ws: WebSocket, roomId: string, ip: string, meta: ConnMeta): Promise<void> {
    if (!limits.roomRateLimited) {
      hub.handleConnection(ws, roomId);
      joined(ws, roomId, meta);
      return;
    }
    const early: Array<[RawData, boolean]> = [];
    const onEarly = (data: RawData, isBinary: boolean) => void early.push([data, isBinary]);
    ws.on('message', onEarly);
    let isNew = false;
    try {
      isNew = await hub.isNewRoom(roomId);
    } catch {
      // 확인하지 못하면 제한 없이 넘기고, 읽기 오류는 방을 여는 쪽에서 처리한다
    }
    ws.off('message', onEarly);
    if (ws.readyState !== WebSocket.OPEN) return;
    if (isNew && !limits.tryCreateRoom(ip, roomId)) {
      log(`room rate limited ip=${ip}`);
      ws.close(CLOSE_ROOM_RATE_LIMIT, 'room creation rate limited');
      return;
    }
    hub.handleConnection(ws, roomId);
    joined(ws, roomId, meta);
    for (const [data, isBinary] of early) ws.emit('message', data, isBinary);
  }

  let startedAt = Date.now();
  const app = createApp({
    staticDir: opts.staticDir ?? defaultStaticDir(),
    stats: () => hub.stats(),
    roomInfo: (roomId) => hub.roomInfo(roomId),
    uptime: () => Math.round((Date.now() - startedAt) / 1000),
    isNewRoom: (roomId) => hub.isNewRoom(roomId),
    withDoc: (roomId, fn) => hub.withDoc(roomId, fn),
    tryCreateRoom: (ip, roomId) => {
      const allowed = limits.tryCreateRoom(ip, roomId);
      if (!allowed) log(`room rate limited ip=${ip}`);
      return allowed;
    },
    takeApiRequest: (ip) => apiRate.take(ip),
    takeMcpRequest: (ip) => mcpRate.take(ip),
    takeMcpRoomCreate: (ip) => {
      const wait = mcpCreateRate.take(ip);
      if (wait > 0) log(`mcp room rate limited ip=${ip}`);
      return wait;
    },
    takeTelemetryRequest: (ip) => telemetryRate.take(ip),
    metrics,
    publicUrl: opts.publicUrl,
    log,
  });
  const admin: AdminServer | null =
    metrics && opts.adminPort !== undefined
      ? createAdminServer({
          metrics,
          live: () => {
            const sizes = hub.roomSizes();
            return { connections: sizes.reduce((a, b) => a + b, 0), openRooms: sizes.length };
          },
          passwordHash: opts.adminPasswordHash,
          log,
        })
      : null;

  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;

  const roomTtlMs = opts.roomTtlMs ?? 0;
  const roomSweepIntervalMs = opts.roomSweepIntervalMs ?? 6 * 60 * 60 * 1000;
  let sweepTimer: NodeJS.Timeout | null = null;
  let firstSweepTimer: NodeJS.Timeout | null = null;
  const sweepRooms = () => {
    hub.removeExpiredRooms(roomTtlMs).catch((err: unknown) => log(`room sweep failed: ${(err as Error).message}`));
  };

  return {
    async start() {
      if (server) throw new Error('already started');
      await persistence.init();
      if (metrics) await metrics.init();

      const httpServer = http.createServer(app);
      const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

      httpServer.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {});
        const pathname = (req.url ?? '').split('?')[0];
        if (!pathname.startsWith('/ws/')) {
          rejectUpgrade(socket, 404, 'Not Found');
          return;
        }
        // 디코딩하지 않은 경로를 그대로 검사한다. 올바른 방 id에는 인코딩이 필요한 글자가 없다.
        const roomId = pathname.slice('/ws/'.length);
        // 지표용 익명 ID(?a=). 형식 확인은 지표 쪽에서 한다. User-Agent는 봇인지 보는 데만 쓰고 남기지 않는다
        const meta: ConnMeta = { anonId: anonIdOf(req.url ?? ''), ua: req.headers['user-agent'] };
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          if (!ROOM_ID_PATTERN.test(roomId)) {
            // 핸드셰이크를 받아 준 뒤 닫아야 클라이언트가 닫기 코드를 보고 재접속을 멈춘다
            ws.on('error', () => {});
            ws.close(CLOSE_INVALID_ROOM, 'invalid room id');
            return;
          }
          const ip = clientIp(req);
          if (!limits.acquire(ip)) {
            log(`too many connections ip=${ip}`);
            ws.on('error', () => {});
            ws.close(CLOSE_TOO_MANY_CONNECTIONS, 'too many connections');
            return;
          }
          ws.once('close', () => limits.release(ip));
          ws.on('error', () => {});
          void admit(ws, roomId, ip, meta);
        });
      });

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve();
        });
      });

      server = httpServer;
      wss = wsServer;
      startedAt = Date.now();
      hub.start();
      metrics?.start();
      let adminPort: number | undefined;
      if (admin && opts.adminPort !== undefined) {
        try {
          adminPort = await admin.listen(opts.adminPort, opts.adminHost ?? '127.0.0.1', opts.adminPublicPort);
          log(`admin page on http://${opts.adminHost ?? '127.0.0.1'}:${adminPort}${opts.adminPasswordHash ? '' : ' (ADMIN_PASSWORD_HASH is not set, login is disabled)'}`);
        } catch (err) {
          // 관리자 페이지가 못 떠도 공개 앱은 계속 돈다
          log(`admin page failed to start: ${(err as Error).message}`);
        }
      }
      if (roomTtlMs > 0) {
        // 켜진 직후에 한 번 보고, 그 뒤로는 주기마다 본다
        firstSweepTimer = setTimeout(sweepRooms, Math.min(60_000, roomSweepIntervalMs));
        firstSweepTimer.unref();
        sweepTimer = setInterval(sweepRooms, roomSweepIntervalMs);
        sweepTimer.unref();
      }
      return { port: (httpServer.address() as AddressInfo).port, adminPort };
    },

    async stop() {
      const httpServer = server;
      const wsServer = wss;
      if (!httpServer || !wsServer) return;
      server = null;
      wss = null;
      if (firstSweepTimer) clearTimeout(firstSweepTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      firstSweepTimer = null;
      sweepTimer = null;

      // 새 접속을 막고, 방을 모두 저장한 다음 남은 소켓을 정리한다
      const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await hub.close();
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close();
      httpServer.closeAllConnections();
      await closed;
      await admin?.close();
      await metrics?.stop();
    },
  };
}
