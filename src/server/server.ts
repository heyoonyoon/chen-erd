/**
 * HTTP와 웹소켓을 한 포트로 묶은 서버. 테스트에서도 그대로 띄울 수 있다. [담당: server 에이전트]
 */
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ROOM_ID_PATTERN } from '../shared/types';
import { createApp } from './http';
import { Persistence, type Logger } from './persistence';
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
  /** 로그를 받을 함수. 기본은 console.log */
  log?: Logger;
}

export interface ErdServer {
  start(): Promise<{ port: number }>;
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
  const hub = new SyncHub(persistence, {
    maxClientsPerRoom: opts.maxClientsPerRoom,
    saveDebounceMs: opts.saveDebounceMs,
    unloadDelayMs: opts.unloadDelayMs,
    pingIntervalMs: opts.pingIntervalMs,
    log,
  });

  let startedAt = Date.now();
  const app = createApp({
    staticDir: opts.staticDir ?? defaultStaticDir(),
    stats: () => hub.stats(),
    roomInfo: (roomId) => hub.roomInfo(roomId),
    uptime: () => Math.round((Date.now() - startedAt) / 1000),
  });

  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;

  return {
    async start() {
      if (server) throw new Error('already started');
      await persistence.init();

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
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          if (!ROOM_ID_PATTERN.test(roomId)) {
            // 핸드셰이크를 받아 준 뒤 닫아야 클라이언트가 닫기 코드를 보고 재접속을 멈춘다
            ws.on('error', () => {});
            ws.close(CLOSE_INVALID_ROOM, 'invalid room id');
            return;
          }
          hub.handleConnection(ws, roomId);
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
      return { port: (httpServer.address() as AddressInfo).port };
    },

    async stop() {
      const httpServer = server;
      const wsServer = wss;
      if (!httpServer || !wsServer) return;
      server = null;
      wss = null;

      // 새 접속을 막고, 방을 모두 저장한 다음 남은 소켓을 정리한다
      const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await hub.close();
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close();
      httpServer.closeAllConnections();
      await closed;
    },
  };
}
