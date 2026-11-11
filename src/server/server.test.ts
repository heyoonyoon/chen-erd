import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createErdServer, type ErdServer, type ErdServerOptions } from './server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error(`시간 안에 조건이 충족되지 않음: ${what}`);
    await sleep(10);
  }
}

describe('ERD 서버', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  const providers: WebsocketProvider[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    port = (await server.start()).port;
  }

  /** 브라우저의 Room과 같은 방식으로 접속한다. 같은 프로세스 안에서 BroadcastChannel로 새지 않게 끈다. */
  function connect(roomId: string): { doc: Y.Doc; provider: WebsocketProvider } {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    return { doc, provider };
  }

  /** 날것의 웹소켓으로 접속해 어떻게 끝나는지 본다. */
  function rawClose(urlPath: string): Promise<{ opened: boolean; code: number; error: string | null }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`);
      let opened = false;
      let error: string | null = null;
      ws.on('open', () => (opened = true));
      ws.on('error', (err) => (error = err.message));
      ws.on('close', (code) => resolve({ opened, code, error }));
    });
  }

  const api = (urlPath: string) => fetch(`http://127.0.0.1:${port}${urlPath}`);

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-server-'));
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

  it('같은 방의 두 접속자가 Y.Map 변경을 서로 받는다', async () => {
    await boot();
    const a = connect('room-a');
    const b = connect('room-a');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');

    a.doc.getMap('nodes').set('n1', 'from-a');
    await waitFor(() => b.doc.getMap('nodes').get('n1') === 'from-a', 'a의 변경이 b에 도착');

    b.doc.getMap('nodes').set('n2', 'from-b');
    await waitFor(() => a.doc.getMap('nodes').get('n2') === 'from-b', 'b의 변경이 a에 도착');

    // 다른 방에는 전달되지 않는다
    const other = connect('room-b');
    await waitFor(() => other.provider.synced, '다른 방 동기화');
    expect(other.doc.getMap('nodes').size).toBe(0);

    // 나중에 들어온 사람도 전체 내용을 받는다
    const late = connect('room-a');
    await waitFor(() => late.doc.getMap('nodes').size === 2, '늦게 들어온 접속자');
    expect(late.doc.getMap('nodes').toJSON()).toEqual({ n1: 'from-a', n2: 'from-b' });
  });

  it('awareness가 상대에게 전달되고 연결이 끊기면 사라진다', async () => {
    await boot();
    const a = connect('room-aw');
    const b = connect('room-aw');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');

    a.provider.awareness.setLocalState({ user: { id: 'u1', name: '가', color: '#000' }, cursor: { x: 1, y: 2 } });
    b.provider.awareness.setLocalState({ user: { id: 'u2', name: '나', color: '#111' }, cursor: null });
    const aId = a.doc.clientID;
    const bId = b.doc.clientID;
    await waitFor(() => b.provider.awareness.getStates().has(aId), 'a의 상태가 b에 도착');
    await waitFor(() => a.provider.awareness.getStates().has(bId), 'b의 상태가 a에 도착');
    expect(b.provider.awareness.getStates().get(aId)).toMatchObject({ cursor: { x: 1, y: 2 } });

    // 나중에 들어온 사람은 접속하자마자 기존 접속자들의 상태를 받는다
    const c = connect('room-aw');
    await waitFor(() => c.provider.awareness.getStates().has(aId) && c.provider.awareness.getStates().has(bId), '기존 상태 전달');

    // 작별 인사 없이 소켓이 죽은 경우에도 서버가 상태를 지워 준다
    a.provider.shouldConnect = false;
    (a.provider.ws as unknown as WebSocket).terminate();
    await waitFor(() => !b.provider.awareness.getStates().has(aId), 'a의 상태가 b에서 사라짐');
    await waitFor(() => !c.provider.awareness.getStates().has(aId), 'a의 상태가 c에서 사라짐');
    expect(b.provider.awareness.getStates().has(bId)).toBe(true);
  });

  it('서버를 내렸다 다시 올려도 문서 내용이 남는다', async () => {
    await boot({ saveDebounceMs: 60_000 });
    const a = connect('room-keep');
    const b = connect('room-keep');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');
    a.doc.getMap('nodes').set('n1', { text: '학생' });
    a.doc.getMap('meta').set('title', '수강신청 ERD');
    await waitFor(() => b.doc.getMap('meta').get('title') === '수강신청 ERD', '서버를 거쳐 b에 도착');

    // 디바운스가 끝나기 전에 내려도 종료하면서 저장한다
    for (const p of providers.splice(0)) p.destroy();
    await server!.stop();
    expect((await fs.stat(path.join(dataDir, 'room-keep.bin'))).size).toBeGreaterThan(0);
    expect(await fs.readdir(path.join(dataDir, 'backups', 'room-keep'))).toHaveLength(1);

    await boot();
    const c = connect('room-keep');
    await waitFor(() => c.provider.synced, '다시 접속');
    expect(c.doc.getMap('nodes').get('n1')).toEqual({ text: '학생' });
    expect(c.doc.getMap('meta').get('title')).toBe('수강신청 ERD');
  });

  it('변경하면 잠시 뒤 파일로 저장하고, 모두 나가면 메모리에서 내린다', async () => {
    await boot({ saveDebounceMs: 20, unloadDelayMs: 50 });
    const a = connect('room-save');
    await waitFor(() => a.provider.synced, '동기화');
    expect((await (await api('/api/rooms/room-save')).json()).exists).toBe(true);

    a.doc.getMap('nodes').set('n1', 1);
    const file = path.join(dataDir, 'room-save.bin');
    await waitFor(() => fs.access(file).then(() => true, () => false), '파일 저장');

    a.provider.destroy();
    await waitFor(async () => (await (await api('/api/health')).json()).rooms === 0, '방 내리기');
    expect(await (await api('/api/rooms/room-save')).json()).toEqual({ exists: true, clients: 0 });

    // 내린 방에 다시 들어오면 파일에서 읽어 온다
    const b = connect('room-save');
    await waitFor(() => b.provider.synced, '다시 접속');
    expect(b.doc.getMap('nodes').get('n1')).toBe(1);
  });

  it('잘못된 roomId는 거절한다', async () => {
    await boot();
    for (const bad of ['bad.id', 'a/b', '..%2F..%2Fetc%2Fpasswd', 'x'.repeat(65), '한글', '']) {
      const result = await rawClose(`/ws/${bad}`);
      expect(result.code, bad).toBe(4400);
    }
    // /ws 밖의 경로는 핸드셰이크부터 받아 주지 않는다
    const outside = await rawClose('/somewhere');
    expect(outside.opened).toBe(false);
    expect(outside.error).toContain('404');

    expect(await (await api('/api/health')).json()).toMatchObject({ rooms: 0, connections: 0 });
    expect(await fs.readdir(dataDir)).toEqual([]);

    // 클라이언트는 4400을 받으면 재접속을 그만둔다
    const { provider } = connect('bad.id');
    const closed = await new Promise<{ code: number }>((resolve) => provider.on('closed', (event) => resolve(event)));
    expect(closed.code).toBe(4400);
    expect(provider.shouldConnect).toBe(false);
  });

  it('방이 가득 차면 더 받지 않는다', async () => {
    await boot({ maxClientsPerRoom: 1 });
    const a = connect('room-full');
    await waitFor(() => a.provider.synced, '동기화');
    expect((await rawClose('/ws/room-full')).code).toBe(4503);
    expect((await (await api('/api/rooms/room-full')).json()).clients).toBe(1);
  });

  it('pong이 없는 연결을 정리한다', async () => {
    await boot({ pingIntervalMs: 40 });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room-ping`, { autoPong: false });
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    await new Promise((resolve) => ws.on('open', resolve));
    // 정상적으로 pong을 돌려주는 연결은 남는다
    const alive = connect('room-ping');
    await waitFor(() => alive.provider.synced, '동기화');

    expect(await closed).toBe(1006);
    await sleep(120);
    expect(alive.provider.wsconnected).toBe(true);
    expect((await (await api('/api/rooms/room-ping')).json()).clients).toBe(1);
  });

  it('health와 rooms API', async () => {
    await boot();
    const empty = await api('/api/health');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true, rooms: 0, connections: 0, uptime: expect.any(Number) });
    expect(await (await api('/api/rooms/nobody')).json()).toEqual({ exists: false, clients: 0 });

    const a = connect('room-h');
    const b = connect('room-h');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');
    expect(await (await api('/api/health')).json()).toMatchObject({ ok: true, rooms: 1, connections: 2 });
    expect(await (await api('/api/rooms/room-h')).json()).toEqual({ exists: true, clients: 2 });
    // 조회만으로 방이 생기지는 않는다
    expect((await (await api('/api/health')).json()).rooms).toBe(1);

    const bad = await api('/api/rooms/bad.id');
    expect(bad.status).toBe(400);
    expect((await bad.json()).exists).toBe(false);
    expect((await api('/api/nope')).status).toBe(404);
  });

  it('정적 파일과 SPA 경로를 제공한다', async () => {
    const staticDir = path.join(dataDir, 'client');
    await fs.mkdir(path.join(staticDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>erd</title>');
    await fs.writeFile(path.join(staticDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    await boot({ dataDir: path.join(dataDir, 'data'), staticDir });

    for (const p of ['/', '/r/abc123', '/index.html']) {
      const res = await api(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type'), p).toContain('text/html');
      expect(res.headers.get('cache-control'), p).toBe('no-cache');
      expect(await res.text()).toContain('<title>erd</title>');
    }

    const asset = await api('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    // 없는 파일에 html을 대신 주지 않는다
    expect((await api('/assets/missing.js')).status).toBe(404);
    expect((await api('/favicon.ico')).status).toBe(404);
    // 정적 폴더 밖으로 나가지 못한다
    const escape = await api('/..%2Fdata%2Fx.bin');
    expect(escape.status).not.toBe(200);
  });

  it('클라이언트 빌드가 없어도 API는 동작한다', async () => {
    await boot({ staticDir: path.join(dataDir, 'no-such-dir') });
    expect((await api('/api/health')).status).toBe(200);
    expect((await api('/r/abc')).status).toBe(404);
  });

  it('방 하나에는 기본으로 15명까지 들어온다', async () => {
    await boot();
    const opened: WebSocket[] = [];
    for (let i = 0; i < 15; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room-cap`);
      ws.on('error', () => {});
      opened.push(ws);
    }
    await waitFor(async () => (await (await api('/api/health')).json()).connections === 15, '15명 접속');
    expect((await rawClose('/ws/room-cap')).code).toBe(4503);
    for (const ws of opened) ws.terminate();
  });

  it('한 주소의 동시 연결이 한도를 넘으면 4429로 닫는다', async () => {
    await boot({ maxConnectionsPerIp: 2 });
    const a = connect('room-limit');
    const b = connect('room-limit');
    await waitFor(() => a.provider.synced && b.provider.synced, '두 접속자 동기화');

    const third = await rawClose('/ws/room-limit');
    expect(third.opened).toBe(true);
    expect(third.code).toBe(4429);

    // 하나가 나가면 자리가 난다
    a.provider.destroy();
    await waitFor(async () => (await (await api('/api/health')).json()).connections === 1, '연결 하나 정리');
    const c = connect('room-limit');
    await waitFor(() => c.provider.synced, '빈 자리로 접속');
  });

  it('한 주소가 새 방을 연달아 만들면 4430으로 닫고, 있는 방에는 들어갈 수 있다', async () => {
    await boot({ roomCreateIntervalMs: 60_000 });
    const a = connect('room-first');
    await waitFor(() => a.provider.synced, '첫 방 동기화');
    a.doc.getMap('nodes').set('n1', 'x');

    const second = await rawClose('/ws/room-second');
    expect(second.opened).toBe(true);
    expect(second.code).toBe(4430);

    // 이미 열려 있는 방과 방금 만든 방에 다시 들어오는 것은 막지 않는다
    const b = connect('room-first');
    await waitFor(() => b.provider.synced && b.doc.getMap('nodes').get('n1') === 'x', '있는 방에 접속');
  });
});
