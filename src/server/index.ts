/**
 * 서버 진입점. HTTP(정적 파일, API)와 웹소켓(/ws/<roomId>)을 한 포트에서 제공한다. [담당: server 에이전트]
 * 환경변수: PORT(기본 8787), HOST(기본 0.0.0.0), DATA_DIR(기본 ./data), STATIC_DIR(기본 dist/client),
 * MAX_CLIENTS_PER_ROOM(기본 15), MAX_CONNECTIONS_PER_IP(기본 5), ROOM_CREATE_INTERVAL_MS(기본 60000),
 * ROOM_TTL_DAYS(기본 30, 이 날수 동안 아무도 열지 않은 방을 지운다),
 * API_REQUESTS_PER_MINUTE(기본 60, 한 주소가 1분 동안 보낼 수 있는 모델 API 요청 수. /api/rooms/<id>/model 과 /diagram),
 * MCP_REQUESTS_PER_MINUTE(기본 300, 한 주소가 1분 동안 보낼 수 있는 MCP 요청 수. POST /mcp),
 * MCP_ROOM_CREATES_PER_MINUTE(기본 30, 한 주소가 1분 동안 MCP로 만들 수 있는 새 방 수).
 * MAX_CONNECTIONS_PER_IP부터는 0이면 제한하지 않는다.
 * MCP는 호스팅된 AI 클라이언트 여럿이 몇 개의 주소를 함께 쓰므로 위의 주소별 제한(방 만들기 간격, 모델 API 요청 수)과 따로 센다.
 * PUBLIC_URL(예: https://modelll.app. MCP가 돌려주는 방 주소의 앞부분. 비워 두면 요청의 Host와,
 * 사설망의 프록시가 보낸 X-Forwarded-Proto로 알아낸다).
 *
 * 서비스 지표와 관리자 페이지(src/server/stats.ts, src/server/admin.ts)
 * STATS(기본 on. off 또는 0이면 모으지 않고 관리자 페이지도 열지 않는다),
 * STATS_SALT(익명 ID와 방 id를 해시하는 비밀 값. 없으면 DATA_DIR/stats/salt 를 만들어 쓴다),
 * TELEMETRY_REQUESTS_PER_MINUTE(기본 120, 한 주소가 1분 동안 보낼 수 있는 지표 이벤트 수),
 * ADMIN_PORT(기본 9000, 0이면 관리자 페이지를 열지 않는다), ADMIN_HOST(기본 127.0.0.1. 컨테이너 안에서는 0.0.0.0),
 * ADMIN_PASSWORD_HASH(scripts/admin-password.mjs 로 만든 scrypt 해시. 없으면 로그인할 수 없다),
 * ADMIN_PUBLIC_PORT(터널의 로컬 포트를 9000이 아닌 값으로 쓸 때 그 포트. Host 검사에 쓴다).
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

let publicUrl: string | undefined;
if (process.env.PUBLIC_URL) {
  try {
    const url = new URL(process.env.PUBLIC_URL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http');
    publicUrl = url.origin;
  } catch {
    console.error(`[erd] PUBLIC_URL 값이 올바르지 않습니다: ${process.env.PUBLIC_URL}`);
    process.exit(1);
  }
}

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

const statsEnabled = !/^(off|0|false|no)$/i.test(process.env.STATS ?? '');
const adminPort = limitFromEnv('ADMIN_PORT', 9000);
if (adminPort > 65535) {
  console.error(`[erd] ADMIN_PORT 값이 올바르지 않습니다: ${process.env.ADMIN_PORT}`);
  process.exit(1);
}
if (process.env.STATS_SALT && process.env.STATS_SALT.length < 32) {
  console.error('[erd] STATS_SALT는 32자 이상이어야 합니다(openssl rand -hex 32)');
  process.exit(1);
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
  apiRequestsPerMinute: limitFromEnv('API_REQUESTS_PER_MINUTE', 60),
  mcpRequestsPerMinute: limitFromEnv('MCP_REQUESTS_PER_MINUTE', 300),
  mcpRoomCreatesPerMinute: limitFromEnv('MCP_ROOM_CREATES_PER_MINUTE', 30),
  publicUrl,
  log,
  stats: statsEnabled ? { salt: process.env.STATS_SALT || undefined } : false,
  telemetryRequestsPerMinute: limitFromEnv('TELEMETRY_REQUESTS_PER_MINUTE', 120),
  adminPort: statsEnabled && adminPort > 0 ? adminPort : undefined,
  adminHost: process.env.ADMIN_HOST || '127.0.0.1',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || undefined,
  adminPublicPort: limitFromEnv('ADMIN_PUBLIC_PORT', 0) || undefined,
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
