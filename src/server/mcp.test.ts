import { promises as fs } from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { version } from '../../package.json';
import { parseModel } from '../shared/model';
import { ROOM_ID_PATTERN } from '../shared/types';
import { getNodes, getTitle } from '../shared/ydoc';
import { publicOrigin } from './mcp';
import { createErdServer, type ErdServer, type ErdServerOptions } from './server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error(`시간 안에 조건이 충족되지 않음: ${what}`);
    await sleep(10);
  }
}

const STUDENTS = `title "수강신청"
entity 학생 { 학번 key, 이름 }
entity 과목 { 과목코드 key }
relationship 수강 (학생 M, 과목 N)
`;

interface Called {
  isError: boolean;
  text: string;
}

describe('MCP 엔드포인트', () => {
  let dataDir: string;
  let staticDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  let origin = '';
  const clients: Client[] = [];
  const providers: WebsocketProvider[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, staticDir, saveDebounceMs: 20, log: () => {}, ...extra });
    port = (await server.start()).port;
    origin = `http://127.0.0.1:${port}`;
  }

  /** 실제 MCP 클라이언트로 접속한다. headers는 요청마다 붙는다(프록시가 붙이는 헤더를 흉내 낼 때 쓴다) */
  async function connect(mode: VersionNegotiationMode = 'legacy', headers: Record<string, string> = {}): Promise<Client> {
    const client = new Client({ name: 'mcp-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers } }));
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Called> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    return { isError: result.isError === true, text: content[0].text };
  }

  /** 만들기 결과의 첫 줄에서 방 주소를 꺼낸다 */
  function createdUrl(result: Called): string {
    expect(result.isError, result.text).toBe(false);
    const m = /^Created (\S+) \(/.exec(result.text);
    expect(m, result.text).not.toBeNull();
    return m![1];
  }

  /** SDK를 거치지 않고 요청 하나를 보낸다. fetch로는 바꿀 수 없는 Host도 정할 수 있다 */
  function raw(
    method: string,
    urlPath: string,
    opts: { headers?: Record<string, string>; body?: string | Buffer } = {},
  ): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: opts.headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  }

  /** 2026-07-28 규격의 도구 호출 하나를 직접 보낸다(요청마다 버전을 싣고 initialize가 없다) */
  async function rawCall(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
    const res = await raw('POST', '/mcp', {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': name,
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    expect(res.status, res.body).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const result = (JSON.parse(res.body) as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    return { isError: result.isError === true, text: result.content[0].text, headers: res.headers };
  }

  /** 저장된 방 파일. 방이 저장되기까지는 조금 걸린다 */
  const roomFiles = async () => (await fs.readdir(dataDir)).filter((name) => name.endsWith('.bin'));

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-mcp-'));
    // SPA 화면이 잘못 나가는지 알아볼 수 있도록 index.html이 있는 정적 폴더를 둔다
    staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-mcp-static-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>spa</title>');
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) {
      p.destroy();
      p.doc.destroy();
    }
    for (const c of clients.splice(0)) await c.close().catch(() => {});
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  describe.each([
    { label: '예전 규격(initialize로 시작)', mode: 'legacy' as const, era: 'legacy' },
    { label: '2026-07-28 규격(요청마다 버전을 싣는다)', mode: 'auto' as const, era: 'modern' },
  ])('$label', ({ mode, era }) => {
    it('접속해서 도구 목록을 받는다', async () => {
      await boot();
      const client = await connect(mode);
      expect(client.getProtocolEra()).toBe(era);
      expect(client.getServerVersion()).toMatchObject({ name: 'modelll', version });
      expect(client.getInstructions()).toContain('read_diagram');

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['create_diagram', 'read_diagram', 'update_diagram', 'validate_diagram', 'diagram_syntax', 'diagram_to_sql']);
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(byName.read_diagram.annotations?.readOnlyHint).toBe(true);
      expect(byName.update_diagram.annotations?.destructiveHint).toBe(true);
      expect(byName.create_diagram.description).toContain('entity <name>');
      // 접속하고 목록을 보는 것만으로는 방이 생기지 않는다
      expect(await roomFiles()).toEqual([]);
    });

    it('만들고, 읽고, 고치고, 다시 읽는다', async () => {
      await boot();
      const client = await connect(mode);

      const created = await call(client, 'create_diagram', { text: STUDENTS });
      const url = createdUrl(created);
      expect(url.startsWith(`${origin}/r/`)).toBe(true);
      const roomId = url.slice(`${origin}/r/`.length);
      expect(roomId).toMatch(/^[a-z2-9]{10}$/);
      expect(ROOM_ID_PATTERN.test(roomId)).toBe(true);
      expect(created.text.split('\n')).toEqual([expect.stringMatching(/^Created \S+ \(\+\d+ added\)$/), 'no issues']);

      // 주소 전체로도, id만으로도 읽는다
      const read = await call(client, 'read_diagram', { room: url });
      expect(read.isError).toBe(false);
      const model = parseModel(read.text);
      expect(model.title).toBe('수강신청');
      expect(model.entities.map((e) => e.name).sort()).toEqual(['과목', '학생']);
      expect(model.relationships.map((r) => r.name)).toEqual(['수강']);
      expect((await call(client, 'read_diagram', { room: roomId })).text).toBe(read.text);

      // 읽은 글을 고쳐서 전체를 다시 보낸다. 과목이 빠지고 교수가 들어온다
      const edited = `title "수강신청"\nentity 학생 { 학번 key, 이름 }\nentity 교수 { 사번 key }\nrelationship 지도 (교수 1, 학생 N)\n`;
      const updated = await call(client, 'update_diagram', { room: roomId, text: edited });
      expect(updated.isError).toBe(false);
      expect(updated.text.split('\n')[0]).toMatch(new RegExp(`^Updated ${url} \\(\\+\\d+ added, .*-\\d+ removed\\)$`));

      const again = parseModel((await call(client, 'read_diagram', { room: url })).text);
      expect(again.entities.map((e) => e.name).sort()).toEqual(['교수', '학생']);
      expect(again.relationships.map((r) => r.name)).toEqual(['지도']);

      // 같은 글을 다시 보내면 바뀌는 것이 없다
      const same = await call(client, 'update_diagram', { room: url, text: edited, relayout: false });
      expect(same.text.split('\n')[0]).toBe(`Updated ${url} (no changes)`);

      // 모델 API로도 같은 방이 보인다
      const viaApi = await fetch(`${origin}/api/rooms/${roomId}/model`);
      expect(viaApi.status).toBe(200);
      expect(parseModel(await viaApi.text()).entities.map((e) => e.name).sort()).toEqual(['교수', '학생']);

      // 관계 모델 글이 없으면 다이어그램에서 만들지 않고 그렇다고 알린다
      const none = await call(client, 'diagram_to_sql', { room: url });
      expect(none.isError).toBe(true);
      expect(none.text).toContain('has no relational model yet');

      // 사람이 적은 관계 모델 글을 SQL로 옮긴다(읽기만 한다)
      const put = await fetch(`${origin}/api/rooms/${roomId}/relational`, { method: 'PUT', body: '교수(_사번_)\n학생(_학번_, 이름, 사번)\nForeign Key (사번) references 교수 (사번)\n' });
      expect(put.status).toBe(200);
      const sql = await call(client, 'diagram_to_sql', { room: url, dialect: 'oracle' });
      expect(sql.isError).toBe(false);
      expect(sql.text).toContain('학생(_학번_, 이름, 사번)\nForeign Key (사번) references 교수 (사번)');
      expect(sql.text).toContain('FOREIGN KEY ("사번") REFERENCES "교수" ("사번")');
      expect(sql.text).toContain('-- 수강신청 (Oracle)');
      expect(sql.text).toContain('"이름" /* 타입 미지정 */');
      expect((await call(client, 'diagram_to_sql', { room: 'nobody1234' })).isError).toBe(true);
    });

    it('문법 오류는 줄:칸: 메시지가 담긴 실패 결과이고 방을 만들지 않는다', async () => {
      await boot();
      const client = await connect(mode);

      const bad = await call(client, 'create_diagram', { text: 'entity A { id key }\nrelationship r (A 1, Zed N)\n' });
      expect(bad.isError).toBe(true);
      expect(bad.text.split('\n')[0]).toBe('2:22: unknown entity "Zed" in relationship "r" — declare it with: entity Zed');
      expect(await roomFiles()).toEqual([]);

      const checked = await call(client, 'validate_diagram', { text: 'entity A { x key foo }' });
      expect(checked.isError).toBe(true);
      expect(checked.text).toMatch(/^1:18: unknown attribute modifier "foo"/);

      // 검증에서 나온 문제는 실패가 아니다
      const found = await call(client, 'validate_diagram', { text: 'entity A { x }' });
      expect(found.isError).toBe(false);
      expect(found.text).toMatch(/^warning: Entity “A” has no key attribute\.$/m);

      expect((await call(client, 'diagram_syntax')).text).toContain('STATEMENTS');
    });
  });

  it('고친 내용은 방을 열어 둔 브라우저에 바로 보인다', async () => {
    await boot();
    const client = await connect();
    const url = createdUrl(await call(client, 'create_diagram', { text: STUDENTS, title: '학사' }));
    const roomId = url.split('/').pop()!;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    await waitFor(() => getNodes(doc).some((n) => n.text === '학생'), '방 내용 받기');
    expect(getTitle(doc)).toBe('학사');

    await call(client, 'update_diagram', { room: roomId, text: `${STUDENTS}entity 교수 { 사번 key }\n` });
    await waitFor(() => getNodes(doc).some((n) => n.text === '교수'), '고친 내용 받기');
    expect(getTitle(doc)).toBe('수강신청');
  });

  it('없는 방은 읽어도 고쳐도 실패 결과이고 방이 생기지 않는다', async () => {
    await boot();
    const client = await connect();

    const read = await call(client, 'read_diagram', { room: 'nobody' });
    expect(read).toEqual({ isError: true, text: `room "nobody" does not exist on ${origin}` });
    const updated = await call(client, 'update_diagram', { room: `${origin}/r/nobody`, text: STUDENTS });
    expect(updated).toEqual({ isError: true, text: `room "nobody" does not exist on ${origin}` });
    expect((await call(client, 'read_diagram', { room: 'bad id!' })).text).toContain('is not a valid room id');

    expect(await roomFiles()).toEqual([]);
    expect(((await (await fetch(`${origin}/api/health`)).json()) as { rooms: number }).rooms).toBe(0);
  });

  it('다른 호스트의 방 주소는 거절한다', async () => {
    await boot();
    const client = await connect();
    const url = createdUrl(await call(client, 'create_diagram', { text: STUDENTS }));
    const roomId = url.split('/').pop()!;

    for (const elsewhere of [`https://modelll.app/r/${roomId}`, `http://127.0.0.1:${port + 1}/r/${roomId}`, `http://localhost:${port}/r/${roomId}`]) {
      for (const result of [await call(client, 'read_diagram', { room: elsewhere }), await call(client, 'update_diagram', { room: elsewhere, text: '' })]) {
        expect(result.isError, elsewhere).toBe(true);
        expect(result.text, elsewhere).toBe(`"${elsewhere}" is on a different server; this MCP server only works with diagrams on ${origin}`);
      }
    }
    // 거절된 고치기는 방을 건드리지 않았다
    expect(parseModel((await call(client, 'read_diagram', { room: url })).text).entities).toHaveLength(2);
  });

  it('GET과 DELETE는 405이고, /mcp에서는 SPA 화면이 나가지 않는다', async () => {
    await boot();
    // 정적 폴더가 제대로 걸려 있어야 아래의 확인이 뜻이 있다
    const spa = await fetch(`${origin}/r/abc`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>spa</title>');

    for (const method of ['GET', 'DELETE', 'PUT', 'HEAD']) {
      const res = await fetch(`${origin}/mcp`, { method, headers: { Accept: 'text/event-stream' } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('POST, OPTIONS');
      expect(res.headers.get('content-type'), method).toMatch(/^application\/json/);
      expect(res.headers.get('access-control-allow-origin'), method).toBe('*');
      expect(res.headers.get('x-robots-tag'), method).toBe('noindex, nofollow');
      if (method !== 'HEAD') expect(await res.json(), method).toEqual({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    }

    for (const p of ['/mcp/', '/mcp/sse', '/mcp/anything/else']) {
      const res = await fetch(`${origin}${p}`);
      expect(res.status === 404 || res.status === 405, p).toBe(true);
      expect(res.headers.get('content-type'), p).toMatch(/^application\/json/);
      expect(await res.text(), p).not.toContain('<title>');
    }
  });

  it('/.well-known 아래는 실제 파일이 아니면 JSON 404다', async () => {
    await fs.mkdir(path.join(staticDir, '.well-known'));
    await fs.writeFile(path.join(staticDir, '.well-known', 'security.txt'), 'Contact: https://modelll.app\n');
    await boot();

    for (const p of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
      '/.well-known',
      '/.well-known/',
    ]) {
      const res = await fetch(`${origin}${p}`);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-type'), p).toMatch(/^application\/json/);
      expect(await res.json(), p).toEqual({ error: 'not found' });
    }
    const post = await fetch(`${origin}/.well-known/oauth-authorization-server`, { method: 'POST' });
    expect(post.status).toBe(404);
    expect(post.headers.get('content-type')).toMatch(/^application\/json/);

    const real = await fetch(`${origin}/.well-known/security.txt`);
    expect(real.status).toBe(200);
    expect(await real.text()).toBe('Contact: https://modelll.app\n');
  });

  it('인증을 요구하지 않는다(어떤 요청에도 401이 없다)', async () => {
    await boot();
    const json = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const responses = [
      await raw('POST', '/mcp', { headers: json, body: 'not json' }),
      await raw('POST', '/mcp', { headers: json, body: '' }),
      await raw('POST', '/mcp', { headers: json, body: '{"jsonrpc":"2.0","id":1,"method":"no/such"}' }),
      await raw('POST', '/mcp', { headers: { ...json, Authorization: 'Bearer nonsense' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }),
      await raw('POST', '/mcp', { headers: { 'Content-Type': 'text/plain' }, body: 'hello' }),
      await raw('GET', '/mcp'),
    ];
    for (const res of responses) {
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.headers['www-authenticate']).toBeUndefined();
      expect(res.body).not.toContain('<title>');
    }
    expect(responses[0].status).toBe(400);
  });

  it('CORS는 /mcp에만 열려 있다', async () => {
    await boot();
    const preflight = await fetch(`${origin}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://claude.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, mcp-protocol-version, mcp-method, mcp-name',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type, mcp-protocol-version, mcp-method, mcp-name');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();

    // 묻는 헤더를 적지 않았으면 MCP가 쓰는 헤더를 알려 준다
    const bare = await fetch(`${origin}/mcp`, { method: 'OPTIONS' });
    expect(bare.status).toBe(204);
    expect(bare.headers.get('access-control-allow-headers')).toContain('MCP-Protocol-Version');
    expect(bare.headers.get('access-control-allow-headers')).toContain('Mcp-Method');

    const called = await rawCall('validate_diagram', { text: STUDENTS }, { Origin: 'https://claude.ai' });
    expect(called.headers['access-control-allow-origin']).toBe('*');
    expect(called.text).toBe('no issues');

    for (const p of ['/api/health', '/api/rooms/abc/model', '/']) {
      const res = await fetch(`${origin}${p}`, { headers: { Origin: 'https://claude.ai' } });
      expect(res.headers.get('access-control-allow-origin'), p).toBeNull();
    }
    const apiPreflight = await fetch(`${origin}/api/rooms/abc/model`, { method: 'OPTIONS', headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'PUT' } });
    expect(apiPreflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('돌려주는 방 주소는 요청의 Host와, 프록시가 알려 준 스킴을 따른다', async () => {
    await boot();
    const plain = await rawCall('create_diagram', { text: STUDENTS }, { Host: 'erd.example:8080' });
    expect(plain.text).toMatch(/^Created http:\/\/erd\.example:8080\/r\/[a-z2-9]{10} /);

    // 테스트의 요청은 루프백에서 오므로 같은 서버의 프록시가 보낸 것으로 본다
    const proxied = await rawCall('create_diagram', { text: STUDENTS }, { Host: 'modelll.app', 'X-Forwarded-Proto': 'https' });
    const url = /^Created (\S+) /.exec(proxied.text)![1];
    expect(url).toMatch(/^https:\/\/modelll\.app\/r\/[a-z2-9]{10}$/);

    // 그 주소로 다시 읽을 수 있고, 다른 호스트로 들어온 요청에서는 거절된다
    expect((await rawCall('read_diagram', { room: url }, { Host: 'modelll.app', 'X-Forwarded-Proto': 'https' })).isError).toBe(false);
    expect((await rawCall('read_diagram', { room: url }, { Host: 'modelll.app' })).isError).toBe(false);
    const other = await rawCall('read_diagram', { room: url }, { Host: 'erd.example:8080' });
    expect(other.isError).toBe(true);
    expect(other.text).toContain('is on a different server');
  });

  it('PUBLIC_URL을 정하면 Host와 상관없이 그 주소를 쓴다', async () => {
    await boot({ publicUrl: 'https://modelll.app/' });
    const created = await rawCall('create_diagram', { text: STUDENTS }, { Host: 'evil.example', 'X-Forwarded-Proto': 'http' });
    const url = /^Created (\S+) /.exec(created.text)![1];
    expect(url).toMatch(/^https:\/\/modelll\.app\/r\/[a-z2-9]{10}$/);
    expect((await rawCall('read_diagram', { room: url }, { Host: 'evil.example' })).isError).toBe(false);
    const other = await rawCall('read_diagram', { room: url.replace('modelll.app', 'evil.example') }, { Host: 'evil.example' });
    expect(other.text).toContain('only works with diagrams on https://modelll.app');
  });

  it('모델 API의 주소별 제한은 MCP에 걸리지 않는다', async () => {
    // 운영 서버의 값: 새 방은 1분에 하나, 모델 API는 1분에 몇 번
    await boot({ roomCreateIntervalMs: 60_000, apiRequestsPerMinute: 2 });
    const client = await connect();
    const urls: string[] = [];
    for (let i = 0; i < 5; i++) urls.push(createdUrl(await call(client, 'create_diagram', { text: STUDENTS })));
    expect(new Set(urls).size).toBe(5);
    for (const url of urls) expect((await call(client, 'read_diagram', { room: url })).isError).toBe(false);

    // 반대로 MCP로 보낸 요청은 모델 API의 몫을 쓰지 않았다
    expect((await fetch(`${origin}/api/rooms/${urls[0].split('/').pop()}/model`)).status).toBe(200);
  });

  it('MCP 요청 제한에 걸린 도구 호출은 언제 다시 부를지 알리는 실패 결과다', async () => {
    await boot({ mcpRequestsPerMinute: 6 });
    // 접속(initialize와 그 알림)이 두 번을 쓴다
    const client = await connect('legacy', { 'X-Forwarded-For': '203.0.113.7' });
    for (let i = 0; i < 4; i++) expect((await call(client, 'validate_diagram', { text: STUDENTS })).isError, `${i}`).toBe(false);

    for (const [name, args] of [
      ['validate_diagram', { text: STUDENTS }],
      ['create_diagram', { text: STUDENTS }],
      ['diagram_syntax', {}],
    ] as const) {
      const limited = await call(client, name, args);
      expect(limited.isError, name).toBe(true);
      expect(limited.text, name).toMatch(/^too many requests from this address; try again in \d+ seconds?$/);
    }
    expect(await roomFiles()).toEqual([]);

    // 도구 호출이 아닌 요청은 429로 돌려보낸다
    const list = await raw('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Forwarded-For': '203.0.113.7' },
      body: '{"jsonrpc":"2.0","id":7,"method":"tools/list"}',
    });
    expect(list.status).toBe(429);
    expect(Number(list.headers['retry-after'])).toBeGreaterThan(0);
    expect(list.headers['access-control-allow-origin']).toBe('*');
    expect(JSON.parse(list.body)).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32000 } });

    // 다른 주소는 영향을 받지 않는다
    const other = await connect('legacy', { 'X-Forwarded-For': '203.0.113.8' });
    expect((await call(other, 'validate_diagram', { text: STUDENTS })).isError).toBe(false);
  });

  it('MCP로 방을 만드는 빈도를 주소별로 제한한다', async () => {
    await boot({ mcpRoomCreatesPerMinute: 2 });
    const client = await connect('auto', { 'X-Forwarded-For': '203.0.113.7' });
    const first = createdUrl(await call(client, 'create_diagram', { text: STUDENTS }));
    createdUrl(await call(client, 'create_diagram', { text: STUDENTS }));

    const limited = await call(client, 'create_diagram', { text: STUDENTS });
    expect(limited.isError).toBe(true);
    expect(limited.text).toMatch(/^too many new diagrams from this address; try again in \d+ seconds?$/);
    await waitFor(async () => (await roomFiles()).length === 2, '방 두 개 저장');

    // 문법이 틀린 글은 몫을 쓰지 않고, 읽기와 고치기는 계속 된다
    expect((await call(client, 'read_diagram', { room: first })).isError).toBe(false);
    expect((await call(client, 'update_diagram', { room: first, text: `${STUDENTS}note "메모"\n` })).isError).toBe(false);

    const other = await connect('auto', { 'X-Forwarded-For': '203.0.113.8' });
    createdUrl(await call(other, 'create_diagram', { text: STUDENTS }));
  });

  it('너무 큰 다이어그램과 너무 큰 글은 받지 않는다', async () => {
    await boot();
    const client = await connect();

    // 도형이 3000개를 넘는 모델
    const many = Array.from({ length: 3001 }, (_, i) => `entity E${i}`).join('\n');
    const tooMany = await call(client, 'create_diagram', { text: many });
    expect(tooMany).toEqual({ isError: true, text: 'the diagram would have more than 3000 shapes, which the server does not accept' });

    // 있는 방에 더해서 3000개를 넘는 경우
    const url = createdUrl(await call(client, 'create_diagram', { text: STUDENTS }));
    const grown = await call(client, 'update_diagram', { room: url, text: many });
    expect(grown.isError).toBe(true);
    expect(parseModel((await call(client, 'read_diagram', { room: url })).text).entities).toHaveLength(2);

    // 256 KB를 넘는 글
    const long = `note "${'x'.repeat(257 * 1024)}"`;
    const tooLong = await call(client, 'create_diagram', { text: long });
    expect(tooLong).toEqual({ isError: true, text: 'the model text is too large (the limit is 256 KB)' });
    expect(((await (await fetch(`${origin}/api/health`)).json()) as { rooms: number }).rooms).toBe(1);

    // 본문 자체가 한도를 넘으면 읽지 않고 413으로 답한다
    const huge = await raw('POST', '/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'validate_diagram', arguments: { text: 'x'.repeat(600 * 1024) } } }),
    });
    expect(huge.status).toBe(413);
    expect(huge.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(huge.body)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32000 } });
  });
});

describe('publicOrigin', () => {
  /** 요청을 흉내 낸다 */
  function req(remoteAddress: string, headers: Record<string, string>, encrypted = false): IncomingMessage {
    return { headers, socket: { remoteAddress, encrypted, localPort: 8787 } } as unknown as IncomingMessage;
  }

  it('설정값이 있으면 그것을 쓴다', () => {
    expect(publicOrigin(req('203.0.113.7', { host: 'evil.example' }), 'https://modelll.app')).toBe('https://modelll.app');
  });

  it('Host에 스킴을 붙이고, 기본 포트는 뺀다', () => {
    expect(publicOrigin(req('203.0.113.7', { host: 'modelll.app' }))).toBe('http://modelll.app');
    expect(publicOrigin(req('203.0.113.7', { host: 'MODELLL.app:80' }))).toBe('http://modelll.app');
    expect(publicOrigin(req('203.0.113.7', { host: 'localhost:8787' }))).toBe('http://localhost:8787');
    expect(publicOrigin(req('203.0.113.7', { host: '[::1]:8787' }))).toBe('http://[::1]:8787');
    expect(publicOrigin(req('203.0.113.7', { host: 'modelll.app' }, true))).toBe('https://modelll.app');
  });

  it('X-Forwarded-Proto는 사설망에서 온 요청일 때만 믿는다', () => {
    const headers = { host: 'modelll.app', 'x-forwarded-proto': 'https' };
    for (const proxy of ['127.0.0.1', '::1', '::ffff:172.18.0.3', '10.0.0.2', '192.168.0.5']) {
      expect(publicOrigin(req(proxy, headers)), proxy).toBe('https://modelll.app');
    }
    // 인터넷에서 바로 들어온 요청의 헤더는 꾸밀 수 있다
    expect(publicOrigin(req('203.0.113.7', headers))).toBe('http://modelll.app');
    expect(publicOrigin(req('', headers))).toBe('http://modelll.app');
    // 여러 프록시를 거쳤으면 가장 가까운 프록시의 값을 쓴다
    expect(publicOrigin(req('127.0.0.1', { host: 'modelll.app', 'x-forwarded-proto': 'http, https' }))).toBe('https://modelll.app');
    expect(publicOrigin(req('127.0.0.1', { host: 'modelll.app', 'x-forwarded-proto': 'javascript' }))).toBe('http://modelll.app');
  });

  it('이름과 포트로 된 값이 아닌 Host는 쓰지 않는다', () => {
    for (const host of ['', 'evil.example/r/abc', 'user@evil.example', 'a b', 'evil.example:99999999', '<script>']) {
      expect(publicOrigin(req('203.0.113.7', { host })), host).toBe('http://localhost:8787');
    }
  });
});
