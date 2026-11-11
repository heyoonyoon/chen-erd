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

  describe('오래 열리지 않은 방 지우기', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const setAge = async (roomId: string, days: number) => {
      const when = new Date(Date.now() - days * DAY);
      await fs.utimes(path.join(dir, `${roomId}.bin`), when, when);
    };
    const has = (roomId: string) =>
      fs.access(path.join(dir, `${roomId}.bin`)).then(
        () => true,
        () => false,
      );

    it('기한이 지난 방만 백업과 함께 지운다', async () => {
      const p = new Persistence({ dataDir: dir, backupIntervalMs: 0 });
      await p.init();
      await p.save('old-room', docUpdate('old'));
      await p.save('new-room', docUpdate('new'));
      expect(await p.listBackups('old-room')).toHaveLength(1);
      await setAge('old-room', 31);
      await setAge('new-room', 29);

      expect(await p.removeExpired(30 * DAY, () => false)).toEqual(['old-room']);
      expect(await has('old-room')).toBe(false);
      expect(await has('new-room')).toBe(true);
      await expect(fs.access(path.join(dir, 'backups', 'old-room'))).rejects.toThrow();
      expect(await p.listBackups('new-room')).toHaveLength(1);
      expect(await p.load('old-room')).toBeNull();
    });

    it('지금 쓰이는 방은 기한이 지나도 지우지 않는다', async () => {
      const p = new Persistence({ dataDir: dir });
      await p.init();
      await p.save('open-room', docUpdate('x'));
      await setAge('open-room', 100);
      expect(await p.removeExpired(30 * DAY, (id) => id === 'open-room')).toEqual([]);
      expect(await has('open-room')).toBe(true);
    });

    it('방을 연 흔적을 남기면 기한을 다시 센다', async () => {
      const p = new Persistence({ dataDir: dir });
      await p.init();
      await p.save('seen-room', docUpdate('x'));
      await setAge('seen-room', 100);
      await p.touch('seen-room');
      expect(await p.removeExpired(30 * DAY, () => false)).toEqual([]);
      expect(readValue(await p.load('seen-room'))).toBe('x');
      // 저장된 적 없는 방에 흔적을 남겨도 파일이 생기지 않는다
      await p.touch('never-saved');
      expect(await has('never-saved')).toBe(false);
    });

    it('기한이 0이면 아무것도 지우지 않고, 방 파일이 아닌 것은 건드리지 않는다', async () => {
      const p = new Persistence({ dataDir: dir });
      await p.init();
      await p.save('room-a', docUpdate('x'));
      await setAge('room-a', 400);
      await fs.writeFile(path.join(dir, 'notes.txt'), 'keep');
      await fs.writeFile(path.join(dir, 'bad name.bin'), 'keep');
      const old = new Date(Date.now() - 400 * DAY);
      await fs.utimes(path.join(dir, 'bad name.bin'), old, old);

      expect(await p.removeExpired(0, () => false)).toEqual([]);
      expect(await has('room-a')).toBe(true);
      expect(await p.removeExpired(30 * DAY, () => false)).toEqual(['room-a']);
      // 백업 폴더의 틀은 남고 그 방의 백업만 사라진다
      expect((await fs.readdir(dir)).sort()).toEqual(['backups', 'bad name.bin', 'notes.txt']);
      expect(await fs.readdir(path.join(dir, 'backups'))).toEqual([]);
    });
  });
});
