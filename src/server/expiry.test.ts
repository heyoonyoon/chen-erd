import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createErdServer, type ErdServer } from './server';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error(`시간 안에 조건이 충족되지 않음: ${what}`);
    await sleep(10);
  }
}

describe('오래 열리지 않은 방의 자동 삭제', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  const providers: WebsocketProvider[] = [];

  const file = (roomId: string) => path.join(dataDir, `${roomId}.bin`);
  const exists = (roomId: string) =>
    fs.access(file(roomId)).then(
      () => true,
      () => false,
    );
  const makeOld = async (roomId: string) => {
    const when = new Date(Date.now() - 31 * DAY);
    await fs.utimes(file(roomId), when, when);
  };
  const health = async () => (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { rooms: number };

  function connect(roomId: string): { doc: Y.Doc; provider: WebsocketProvider } {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    return { doc, provider };
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-expiry-'));
    server = createErdServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      saveDebounceMs: 10,
      unloadDelayMs: 30,
      roomTtlMs: 30 * DAY,
      roomSweepIntervalMs: 60,
      log: () => {},
    });
    port = (await server.start()).port;
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

  it('아무도 없는 오래된 방은 지우고, 다시 들어오면 빈 방으로 시작한다', async () => {
    const a = connect('room-idle');
    await waitFor(() => a.provider.synced, '동기화');
    a.doc.getMap('nodes').set('n1', 'x');
    await waitFor(() => exists('room-idle'), '저장');
    a.provider.destroy();
    await waitFor(async () => (await health()).rooms === 0, '방이 메모리에서 내려감');

    await makeOld('room-idle');
    await waitFor(async () => !(await exists('room-idle')), '오래된 방 삭제');

    const b = connect('room-idle');
    await waitFor(() => b.provider.synced, '다시 접속');
    expect(b.doc.getMap('nodes').size).toBe(0);
  });

  it('열려 있는 방은 오래돼도 지우지 않고, 들어오기만 해도 기한을 다시 센다', async () => {
    const a = connect('room-open');
    await waitFor(() => a.provider.synced, '동기화');
    a.doc.getMap('nodes').set('n1', 'x');
    await waitFor(() => exists('room-open'), '저장');

    await makeOld('room-open');
    await sleep(200);
    expect(await exists('room-open')).toBe(true);

    // 나가면 그때의 시각이 마지막으로 열린 때가 된다
    a.provider.destroy();
    await waitFor(async () => (await health()).rooms === 0, '방이 메모리에서 내려감');
    await sleep(200);
    expect(await exists('room-open')).toBe(true);
    expect(Date.now() - (await fs.stat(file('room-open'))).mtimeMs).toBeLessThan(60_000);
  });
});
