/**
 * 'modelll mcp': 표준 입출력으로 말하는 MCP 서버. AI 클라이언트가 이 프로세스를 띄워 도구를 부르고,
 * 도구는 다른 명령과 같은 서버(--server, MODELLL_SERVER, 기본 주소)의 HTTP API를 부른다.
 * 표준 출력에는 프로토콜 메시지만 나가야 하므로 알릴 것은 모두 표준 오류로 보낸다.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createHttpBackend } from '../mcp/httpBackend';
import { buildMcpServer } from '../mcp/server';
import type { CliOptions } from './args';
import type { CliIo } from './commands';
import { resolveServer } from './room';

/** 클라이언트가 입력을 닫을 때까지 서버로 동작하고 종료 코드를 돌려준다 */
export async function runMcp(io: CliIo, options: CliOptions): Promise<number> {
  const backend = createHttpBackend(io.fetch, resolveServer(options.server, io.env), io.newRoomId);
  const handle = serveStdio(() => buildMcpServer(backend), {
    onerror: (error) => io.err(`error: ${error.message}`),
  });
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  await handle.close();
  return 0;
}
