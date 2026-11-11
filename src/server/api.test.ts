import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../shared/types';
import { getEdges, getNodes, getNodesMap, getTitle } from '../shared/ydoc';
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
`;

describe('모델 API', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  const providers: WebsocketProvider[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    port = (await server.start()).port;
  }

  /** 브라우저처럼 웹소켓으로 방에 들어간다 */
  function connect(roomId: string): { doc: Y.Doc; provider: WebsocketProvider } {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    return { doc, provider };
  }

  const api = (urlPath: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${urlPath}`, init);
  const put = (roomId: string, text: string, query = '') =>
    api(`/api/rooms/${roomId}/model${query}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
  const health = async () => (await (await api('/api/health')).json()) as { rooms: number; connections: number };
  const names = (nodes: ErdNode[], kind: ErdNode['kind']) =>
    nodes
      .filter((n) => n.kind === kind)
      .map((n) => n.text)
      .sort();

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-api-'));
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

  it('없는 방을 읽으면 404이고 방이 생기지 않는다', async () => {
    await boot();
    for (const p of ['/api/rooms/nobody/model', '/api/rooms/nobody/diagram']) {
      const res = await api(p);
      expect(res.status, p).toBe(404);
      expect(await res.json(), p).toEqual({ ok: false, error: 'not-found' });
      expect(res.headers.get('x-robots-tag'), p).toBe('noindex, nofollow');
      expect(res.headers.get('cache-control'), p).toBe('no-store');
    }
    expect((await health()).rooms).toBe(0);
    expect(await fs.readdir(dataDir)).toEqual([]);
  });

  it('잘못된 방 id는 400으로 거절한다', async () => {
    await boot();
    for (const bad of ['bad.id', '한글', 'x'.repeat(65), '..%2F..%2Fetc']) {
      const read = await api(`/api/rooms/${bad}/model`);
      expect(read.status, bad).toBe(400);
      expect(await read.json(), bad).toEqual({ ok: false, error: 'invalid-room' });
      expect((await api(`/api/rooms/${bad}/diagram`)).status, bad).toBe(400);
      expect((await put(bad, STUDENTS)).status, bad).toBe(400);
    }
    expect(await fs.readdir(dataDir)).toEqual([]);
  });

  it('쓰면 방이 생기고, 다시 쓰면 그 방을 고친다', async () => {
    await boot();
    const first = await put('room-new', STUDENTS);
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created).toMatchObject({ ok: true, room: 'room-new', created: true, warnings: [] });
    expect(created.summary.added).toBeGreaterThanOrEqual(5);
    expect(created.summary.removed).toBe(0);
    expect(Array.isArray(created.issues)).toBe(true);

    const text = await api('/api/rooms/room-new/model');
    expect(text.status).toBe(200);
    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await text.text();
    expect(body).toMatch(/^title "?수강신청"?$/m);
    expect(body).toContain('학생');
    expect(body).toContain('과목코드');

    const diagram = (await (await api('/api/rooms/room-new/diagram')).json()) as { title: string; nodes: ErdNode[]; edges: ErdEdge[] };
    expect(diagram.title).toBe('수강신청');
    expect(names(diagram.nodes, 'entity')).toEqual(['과목', '학생']);
    expect(names(diagram.nodes, 'attribute')).toEqual(['과목코드', '이름', '학번']);
    expect(diagram.edges).toHaveLength(3);

    // 같은 내용을 다시 보내면 바뀌는 것이 없다
    const same = await (await put('room-new', STUDENTS)).json();
    expect(same).toMatchObject({ ok: true, created: false, summary: { added: 0, updated: 0, removed: 0 } });

    // 엔티티 하나를 빼고 하나를 더한다. 남는 도형은 id와 자리를 그대로 둔다
    const second = await (await put('room-new', 'title "학사"\nentity 학생 { 학번 key, 이름 }\nentity 교수 { 사번 key }\n')).json();
    expect(second).toMatchObject({ ok: true, room: 'room-new', created: false });
    expect(second.summary.added).toBeGreaterThan(0);
    expect(second.summary.removed).toBeGreaterThan(0);

    const after = (await (await api('/api/rooms/room-new/diagram')).json()) as { title: string; nodes: ErdNode[]; edges: ErdEdge[] };
    expect(after.title).toBe('학사');
    expect(names(after.nodes, 'entity')).toEqual(['교수', '학생']);
    expect(names(after.nodes, 'attribute')).toEqual(['사번', '이름', '학번']);
    const before = diagram.nodes.find((n) => n.text === '학생')!;
    expect(after.nodes.find((n) => n.text === '학생')).toEqual(before);
  });

  it('JSON 본문 { text } 로도 받는다', async () => {
    await boot();
    const res = await api('/api/rooms/room-json/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: STUDENTS }),
    });
    expect(res.status).toBe(200);
    expect(await (await api('/api/rooms/room-json/model')).text()).toContain('학번');

    for (const body of ['{ "text": 1 }', 'not json']) {
      const bad = await api('/api/rooms/room-json/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      expect(bad.status, body).toBe(400);
      expect((await bad.json()).error, body).toBe('bad-request');
    }
  });

  it('방을 열어 둔 브라우저가 PUT으로 생긴 변경을 바로 받는다', async () => {
    await boot();
    const a = connect('room-live');
    const b = connect('room-live');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');

    // 한 번의 PUT은 update 한 덩어리로 온다
    let updates = 0;
    a.doc.on('update', () => (updates += 1));
    const res = await put('room-live', STUDENTS);
    expect(await res.json()).toMatchObject({ ok: true, created: false });

    await waitFor(() => getNodesMap(a.doc).size === 5 && getNodesMap(b.doc).size === 5, 'PUT의 변경이 두 접속자에게 도착');
    expect(updates).toBe(1);
    for (const { doc } of [a, b]) {
      expect(names(getNodes(doc), 'entity')).toEqual(['과목', '학생']);
      expect(getEdges(doc)).toHaveLength(3);
      expect(getTitle(doc)).toBe('수강신청');
    }

    // 브라우저에서 고친 내용은 다음 읽기에 들어 있다
    const student = getNodes(a.doc).find((n) => n.text === '학생')!;
    getNodesMap(a.doc).get(student.id)!.set('text', '수강생');
    await waitFor(async () => (await (await api('/api/rooms/room-live/model')).text()).includes('수강생'), '웹소켓 변경이 API에 반영');

    // 접속자가 있는 방은 API가 끝나도 메모리에 남는다
    expect(await health()).toMatchObject({ rooms: 1, connections: 2 });
  });

  it('PUT으로 만든 방은 저장되고, 서버를 내렸다 올려도 읽힌다', async () => {
    await boot({ unloadDelayMs: 50 });
    expect((await put('room-keep', STUDENTS)).status).toBe(200);
    const before = await (await api('/api/rooms/room-keep/model')).text();

    // 접속자가 없으므로 저장한 뒤 메모리에서 내린다
    const file = path.join(dataDir, 'room-keep.bin');
    await waitFor(() => fs.access(file).then(() => true, () => false), '파일 저장');
    await waitFor(async () => (await health()).rooms === 0, '방 내리기');
    expect(await (await api('/api/rooms/room-keep')).json()).toEqual({ exists: true, clients: 0 });

    await server!.stop();
    await boot();
    const after = await api('/api/rooms/room-keep/model');
    expect(after.status).toBe(200);
    expect(await after.text()).toBe(before);

    // 웹소켓으로 들어와도 같은 내용이다
    const c = connect('room-keep');
    await waitFor(() => c.provider.synced, '다시 접속');
    expect(names(getNodes(c.doc), 'entity')).toEqual(['과목', '학생']);
  });

  it('저장을 기다리지 않고 바로 서버를 내려도 PUT한 내용이 남는다', async () => {
    await boot({ saveDebounceMs: 60_000 });
    expect((await put('room-stop', STUDENTS)).status).toBe(200);
    await server!.stop();
    await boot();
    expect(await (await api('/api/rooms/room-stop/model')).text()).toContain('학번');
  });

  it('내용이 없는 모델로 만든 방도 남는다', async () => {
    await boot({ unloadDelayMs: 50 });
    const res = await put('room-empty', '');
    expect(await res.json()).toMatchObject({ ok: true, room: 'room-empty', created: true, summary: { added: 0, updated: 0, removed: 0 } });
    await waitFor(async () => (await health()).rooms === 0, '방 내리기');
    const read = await api('/api/rooms/room-empty/diagram');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ title: '', nodes: [], edges: [] });
  });

  it('문법이 틀린 텍스트는 400으로 돌려보내고 아무것도 바꾸지 않는다', async () => {
    await boot({ roomCreateIntervalMs: 60_000 });
    const bad = 'entity 학생 { 학번 key }\n  ??? 무엇\n';

    // 없는 방: 방이 생기지 않고, 새 방을 만들 기회도 쓰지 않는다
    const fresh = await put('room-bad', bad);
    expect(fresh.status).toBe(400);
    const error = await fresh.json();
    expect(error).toMatchObject({ ok: false, error: 'syntax', line: 2, column: 3 });
    expect(typeof error.message).toBe('string');
    expect(error.message.length).toBeGreaterThan(0);
    expect((await api('/api/rooms/room-bad/model')).status).toBe(404);
    expect(await fs.readdir(dataDir)).toEqual([]);

    // 있는 방: 내용이 그대로다
    expect((await put('room-good', STUDENTS)).status).toBe(200);
    const before = await (await api('/api/rooms/room-good/diagram')).json();
    expect((await put('room-good', bad)).status).toBe(400);
    expect(await (await api('/api/rooms/room-good/diagram')).json()).toEqual(before);
  });

  it('한 주소가 보내는 요청 수가 한도를 넘으면 429와 Retry-After로 답한다', async () => {
    await boot({ apiRequestsPerMinute: 3 });
    expect((await put('room-rate', STUDENTS)).status).toBe(200);
    expect((await api('/api/rooms/room-rate/model')).status).toBe(200);
    expect((await api('/api/rooms/room-rate/diagram')).status).toBe(200);

    for (const res of [await api('/api/rooms/room-rate/model'), await api('/api/rooms/room-rate/diagram'), await put('room-rate', '')]) {
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ ok: false, error: 'rate' });
      const retry = Number(res.headers.get('retry-after'));
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(60);
    }
    // 막힌 쓰기는 반영되지 않았고, 다른 API는 이 제한과 상관없다
    expect((await api('/api/health')).status).toBe(200);
    expect((await api('/api/rooms/room-rate')).status).toBe(200);
    const c = connect('room-rate');
    await waitFor(() => c.provider.synced, '접속');
    expect(getNodesMap(c.doc).size).toBe(5);
  });

  it('새 방을 연달아 만들면 429로 거절하고, 웹소켓으로 만드는 방과 같은 한도를 쓴다', async () => {
    await boot({ roomCreateIntervalMs: 60_000 });
    expect((await put('room-one', STUDENTS)).status).toBe(200);

    const second = await put('room-two', STUDENTS);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ ok: false, error: 'room-rate' });
    expect((await api('/api/rooms/room-two/model')).status).toBe(404);

    // 이미 있는 방은 계속 고칠 수 있다
    expect((await put('room-one', 'entity 학생 { 학번 key }\n')).status).toBe(200);

    // 웹소켓으로 새 방을 여는 것도 같은 기록으로 막힌다
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room-three`);
      ws.on('error', () => {});
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(4430);
  });

  it('본문이 256KB를 넘으면 413으로 거절한다', async () => {
    await boot();
    const big = `${STUDENTS}# ${'가'.repeat(100_000)}\n`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(256 * 1024);
    const res = await put('room-big', big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'body-too-large' });
    expect((await api('/api/rooms/room-big/model')).status).toBe(404);

    // 한도 안쪽이면 주석이 길어도 받는다
    const fits = `${STUDENTS}# ${'a'.repeat(200_000)}\n`;
    expect((await put('room-big', fits)).status).toBe(200);
  });

  it('도형이 3000개를 넘게 되는 모델은 422로 거절한다', async () => {
    await boot();
    const many = Array.from({ length: 3001 }, (_, i) => `entity e${i}`).join('\n');
    const res = await put('room-many', many);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: 'too-large' });
    expect((await api('/api/rooms/room-many/model')).status).toBe(404);
    expect((await health()).rooms).toBe(0);
  });

  it('저장된 파일을 읽지 못한 방은 빈 문서로 내주지 않고 503으로 답한다', async () => {
    // 방 파일 자리에 폴더를 두면 읽기가 실패한다
    await fs.mkdir(path.join(dataDir, 'room-broken.bin'));
    await boot();
    for (const res of [await api('/api/rooms/room-broken/model'), await api('/api/rooms/room-broken/diagram'), await put('room-broken', STUDENTS)]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    }
    expect((await fs.stat(path.join(dataDir, 'room-broken.bin'))).isDirectory()).toBe(true);
    expect((await health()).rooms).toBe(0);
  });
});
