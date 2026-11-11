/**
 * 서버 진입점. HTTP(정적 파일, API)와 웹소켓(/ws/<roomId>)을 한 포트에서 제공한다. [담당: server 에이전트]
 * 환경변수: PORT(기본 8787), HOST(기본 0.0.0.0), DATA_DIR(기본 ./data), STATIC_DIR(기본 dist/client),
 * MAX_CLIENTS_PER_ROOM(기본 15), MAX_CONNECTIONS_PER_IP(기본 5), ROOM_CREATE_INTERVAL_MS(기본 60000),
 * ROOM_TTL_DAYS(기본 30, 이 날수 동안 아무도 열지 않은 방을 지운다).
 * 뒤의 셋은 0이면 제한하지 않는다.
 */
import path from 'node:path';
import { createErdServer } from './server';

const log = (message: string) => console.log(`[erd] ${message}`);

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[erd] PORT 값이 올바르지 않습니다: ${process.env.PORT}`);
  process.exit(1);
}
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.DATA_DIR || './data';

/** 0 이상의 정수 환경변수. 비어 있으면 기본값을 쓴다 */
function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`[erd] ${name} 값이 올바르지 않습니다: ${raw}`);
    process.exit(1);
  }
  return value;
}

const server = createErdServer({
  port,
  host,
  dataDir,
  staticDir: process.env.STATIC_DIR || undefined,
  maxClientsPerRoom: limitFromEnv('MAX_CLIENTS_PER_ROOM', 15) || undefined,
  maxConnectionsPerIp: limitFromEnv('MAX_CONNECTIONS_PER_IP', 5),
  roomCreateIntervalMs: limitFromEnv('ROOM_CREATE_INTERVAL_MS', 60_000),
  roomTtlMs: limitFromEnv('ROOM_TTL_DAYS', 30) * 24 * 60 * 60 * 1000,
  log,
});

let stopping = false;
async function shutdown(reason: string, code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(`${reason}, saving rooms`);
  // 저장이 끝나지 않더라도 무한정 기다리지는 않는다
  setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await server.stop();
  } catch (err) {
    console.error('[erd] shutdown failed', err);
    code = 1;
  }
  process.exit(code);
}

process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  console.error('[erd] uncaught exception', err);
  void shutdown('uncaught exception', 1);
});

server.start().then(
  ({ port: actual }) => log(`listening http://${host}:${actual} data=${path.resolve(dataDir)}`),
  (err) => {
    console.error(`[erd] 서버를 시작하지 못했습니다: ${(err as Error).message}`);
    process.exit(1);
  },
);
