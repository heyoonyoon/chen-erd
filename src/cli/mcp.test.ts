import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { ToolError } from '../mcp/backend';
import { createHttpBackend } from '../mcp/httpBackend';
import { createErdServer, type ErdServer, type ErdServerOptions } from '../server/server';
import { parseModel } from '../shared/model';
import { TOOL_NAMES } from '../mcp/descriptions';
import { parseCliArgs } from './args';
import { HELP_TEXT } from './help';
import { SYNTAX_EXAMPLE } from './syntax';

const MODEL = `title "수강신청"
entity 학생 { 학번 key, 이름 }
entity 과목 { 과목코드 key }
relationship 수강 (학생 M, 과목 N)
`;

const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));

describe('modelll mcp', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let origin = '';
  const clients: Client[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    origin = `http://127.0.0.1:${(await server.start()).port}`;
  }

  /** CLI를 실제 프로세스로 띄우고 표준 입출력으로 MCP 클라이언트를 잇는다 */
  async function spawnMcp(args: string[], mode: VersionNegotiationMode = 'legacy') {
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', ENTRY, 'mcp', ...args],
      cwd: path.dirname(path.dirname(path.dirname(ENTRY))),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    // 표준 출력에 프로토콜 메시지가 아닌 줄이 섞이면 여기로 온다
    const errors: Error[] = [];
    const client = new Client({ name: 'stdio-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    client.onerror = (error) => errors.push(error);
    await client.connect(transport);
    clients.push(client);
    return { client, stderr, errors };
  }

  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError === true, text: content[0].text };
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-cli-mcp-'));
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close().catch(() => {});
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('표준 입출력으로 접속해 도구를 부르면 서버에 방이 생긴다', async () => {
    await boot();
    const { client, stderr, errors } = await spawnMcp(['--server', origin]);
    expect(client.getServerVersion()).toMatchObject({ name: 'modelll', version });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_diagram', 'read_diagram', 'update_diagram', 'validate_diagram', 'diagram_syntax']);

    const created = await call(client, 'create_diagram', { text: MODEL });
    expect(created.isError, created.text).toBe(false);
    const url = /^Created (\S+) \(\+\d+ added\)\nno issues$/.exec(created.text)?.[1] ?? '';
    expect(url).toMatch(new RegExp(`^${origin}/r/[a-z2-9]{10}$`));

    // 서버의 모델 API로 같은 방이 보인다
    const viaApi = await fetch(`${origin}/api/rooms/${url.split('/').pop()}/model`);
    expect(viaApi.status).toBe(200);
    expect(parseModel(await viaApi.text()).entities.map((e) => e.name).sort()).toEqual(['과목', '학생']);

    const read = await call(client, 'read_diagram', { room: url });
    expect(parseModel(read.text).relationships.map((r) => r.name)).toEqual(['수강']);

    const updated = await call(client, 'update_diagram', { room: url, text: `${read.text}\nentity 교수 { 사번 key }\n` });
    expect(updated.text.split('\n')[0]).toMatch(new RegExp(`^Updated ${url} \\(\\+\\d+ added\\)$`));

    const bad = await call(client, 'update_diagram', { room: url, text: 'entity {' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/^1:8: /);

    expect(errors).toEqual([]);
    expect(stderr.join('')).toBe('');
  }, 30_000);

  it('2026-07-28 규격으로도 접속한다', async () => {
    await boot();
    const { client, errors } = await spawnMcp(['--server', origin], 'auto');
    expect(client.getProtocolEra()).toBe('modern');
    expect((await call(client, 'validate_diagram', { text: MODEL })).text).toBe('no issues');
    const created = await call(client, 'create_diagram', { text: MODEL, title: '학사' });
    expect(created.isError, created.text).toBe(false);
    expect(errors).toEqual([]);
  }, 30_000);

  it('서버에 닿지 못하면 프로세스가 죽지 않고 실패 결과로 알린다', async () => {
    const { client } = await spawnMcp(['--server', 'http://127.0.0.1:1']);
    const failed = await call(client, 'create_diagram', { text: MODEL });
    expect(failed.isError).toBe(true);
    expect(failed.text).toMatch(/^cannot reach http:\/\/127\.0\.0\.1:1 /);
    // 서버 없이 되는 도구는 그대로 된다
    expect((await call(client, 'validate_diagram', { text: MODEL })).text).toBe('no issues');
  }, 30_000);

  it('명령줄에서 mcp를 알아보고 도움말에 적는다', () => {
    expect(parseCliArgs(['mcp'])).toMatchObject({ command: 'mcp', args: [] });
    expect(parseCliArgs(['mcp', '--server', 'http://localhost:8787']).options.server).toBe('http://localhost:8787');
    expect(() => parseCliArgs(['mcp', 'extra'])).toThrow(/usage: modelll mcp/);
    expect(() => parseCliArgs(['mcp', '--title', 'x'])).toThrow(/--title is not an option of "mcp"/);
    expect(HELP_TEXT).toContain('modelll mcp');
    expect(HELP_TEXT).toContain('claude mcp add modelll -- npx -y modelll mcp');
  });

  it('npm에 올릴 README의 예시와 도구 이름이 실제와 같다', async () => {
    const readme = await fs.readFile(fileURLToPath(new URL('../../scripts/npm-readme.md', import.meta.url)), 'utf8');
    const example = /```text\n([\s\S]*?)```/.exec(readme)?.[1];
    expect(example).toBe(SYNTAX_EXAMPLE);
    expect(parseModel(example ?? '').entities).toHaveLength(5);
    for (const name of Object.values(TOOL_NAMES)) expect(readme, name).toContain(`\`${name}\``);
    expect(readme).toContain('claude mcp add modelll -- npx -y modelll mcp');
    expect(readme).toContain('claude mcp add --transport http modelll https://modelll.app/mcp');
  });

  describe('HTTP API 백엔드', () => {
    it('만들고, 읽고, 고친다', async () => {
      await boot();
      const backend = createHttpBackend(fetch, origin, () => 'fixedroom1');

      const created = await backend.create(MODEL);
      expect(created.url).toBe(`${origin}/r/fixedroom1`);
      expect(created.summary.added).toBeGreaterThan(0);
      expect(created.issues).toEqual([]);

      const read = await backend.read(`${origin}/r/fixedroom1`);
      expect(read.url).toBe(created.url);
      expect(parseModel(read.text).title).toBe('수강신청');

      const updated = await backend.update('fixedroom1', 'entity A { id key }', { relayout: true });
      expect(updated.summary.removed).toBeGreaterThan(0);
      expect(parseModel((await backend.read('fixedroom1')).text).entities.map((e) => e.name)).toEqual(['A']);
    });

    it('없는 방은 고치지 않는다(모델 API처럼 새로 만들지 않는다)', async () => {
      await boot();
      const backend = createHttpBackend(fetch, origin);
      await expect(backend.update('nobody', MODEL, { relayout: false })).rejects.toThrow(new ToolError(`room "nobody" does not exist on ${origin}`));
      await expect(backend.read('nobody')).rejects.toThrow(`room "nobody" does not exist on ${origin}`);
      expect((await fetch(`${origin}/api/rooms/nobody/model`)).status).toBe(404);
    });

    it('다른 서버의 방 주소로는 아무 요청도 보내지 않는다', async () => {
      const requests: string[] = [];
      const backend = createHttpBackend(async (url) => {
        requests.push(url);
        return new Response('{}', { status: 500 });
      }, 'https://modelll.app');

      for (const room of ['https://evil.example/r/abc', 'http://localhost:8787/r/abc']) {
        await expect(backend.read(room)).rejects.toThrow(/is on a different server; this MCP server only works with diagrams on https:\/\/modelll\.app/);
        await expect(backend.update(room, MODEL, { relayout: false })).rejects.toThrow(ToolError);
      }
      expect(requests).toEqual([]);
    });

    it('서버의 거절은 한 문장의 ToolError가 된다', async () => {
      await boot({ apiRequestsPerMinute: 1 });
      const backend = createHttpBackend(fetch, origin);
      await backend.create(MODEL);
      await expect(backend.create(MODEL)).rejects.toThrow(/^too many requests from this address; try again in \d+ seconds?$/);
      await expect(backend.create(MODEL)).rejects.toBeInstanceOf(ToolError);
    });
  });
});
