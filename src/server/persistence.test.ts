import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Persistence } from './persistence';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docUpdate(value: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('nodes').set('a', value);
  return Y.encodeStateAsUpdate(doc);
}

function readValue(update: Uint8Array | null): unknown {
  if (!update) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc.getMap('nodes').get('a');
}

describe('Persistence', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-persist-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('저장한 문서를 다시 읽는다. 없는 방은 null이다', async () => {
    const p = new Persistence({ dataDir: dir });
    await p.init();
    expect(await p.load('room1')).toBeNull();
    expect(await p.exists('room1')).toBe(false);

    await p.save('room1', docUpdate('hello'));
    expect(await p.exists('room1')).toBe(true);
    expect(readValue(await p.load('room1'))).toBe('hello');
    // 임시 파일이 남지 않는다
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('검증을 통과하지 못한 roomId로는 경로를 만들지 않는다', async () => {
    const p = new Persistence({ dataDir: dir });
    await p.init();
    await expect(p.save('../evil', docUpdate('x'))).rejects.toThrow('invalid room id');
    await expect(p.load('a/b')).rejects.toThrow('invalid room id');
    expect(await p.exists('..')).toBe(false);
    expect(await fs.readdir(path.dirname(dir))).not.toContain('evil.bin');
  });

  it('백업 간격이 지나지 않았으면 백업을 새로 만들지 않는다', async () => {
    const p = new Persistence({ dataDir: dir });
    await p.init();
    await p.save('room1', docUpdate('1'));
    await sleep(5);
    await p.save('room1', docUpdate('2'));
    expect(await p.listBackups('room1')).toHaveLength(1);

    // 서버를 다시 켜도 폴더에 남은 백업 시각을 기준으로 삼는다
    const again = new Persistence({ dataDir: dir });
    await again.save('room1', docUpdate('3'));
    expect(await again.listBackups('room1')).toHaveLength(1);
  });

  it('백업은 최근 것만 정해진 개수로 남긴다', async () => {
    const p = new Persistence({ dataDir: dir, backupIntervalMs: 0, maxBackups: 3 });
    await p.init();
    for (let i = 1; i <= 5; i++) {
      await p.save('room1', docUpdate(String(i)));
      await sleep(5);
    }
    const names = await p.listBackups('room1');
    expect(names).toHaveLength(3);
    const newest = await fs.readFile(path.join(dir, 'backups', 'room1', names[2]));
    expect(readValue(newest)).toBe('5');
    const oldest = await fs.readFile(path.join(dir, 'backups', 'room1', names[0]));
    expect(readValue(oldest)).toBe('3');
  });

  it('본 파일이 깨져 있으면 치워 두고 최근 백업으로 되살린다', async () => {
    const p = new Persistence({ dataDir: dir, backupIntervalMs: 0 });
    await p.init();
    await p.save('room1', docUpdate('good'));
    await fs.writeFile(path.join(dir, 'room1.bin'), new Uint8Array(0));

    expect(readValue(await p.load('room1'))).toBe('good');
    const names = await fs.readdir(dir);
    expect(names.some((n) => n.startsWith('room1.bin.corrupt-'))).toBe(true);
    // 되살린 내용이 본 파일로 다시 쓰인다
    expect(readValue(await fs.readFile(path.join(dir, 'room1.bin')))).toBe('good');
  });
});
