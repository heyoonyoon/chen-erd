/**
 * 방 문서를 파일로 저장하고 읽는다. [담당: server 에이전트]
 * 본 파일은 DATA_DIR/<roomId>.bin, 백업은 DATA_DIR/backups/<roomId>/<시각>.bin 이다.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { ROOM_ID_PATTERN } from '../shared/types';

export type Logger = (message: string) => void;

export interface PersistenceOptions {
  dataDir: string;
  /** 마지막 백업이 이 시간보다 오래됐을 때만 새 백업을 만든다. 기본 10분 */
  backupIntervalMs?: number;
  /** 방마다 남겨 둘 백업 개수. 기본 50 */
  maxBackups?: number;
  log?: Logger;
}

/** 백업 파일 이름. ISO 시각에서 파일 이름에 못 쓰는 ':'과 '.'을 '-'로 바꾼 형태라 이름순이 곧 시간순이다. */
const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.bin$/;

function backupName(time: number): string {
  return `${new Date(time).toISOString().replace(/[:.]/g, '-')}.bin`;
}

function backupTime(name: string): number {
  const m = BACKUP_NAME.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** 읽은 바이트가 Yjs update로 풀리는지 빈 문서에 적용해 확인한다. */
function isValidUpdate(data: Uint8Array): boolean {
  if (data.byteLength === 0) return false;
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, data);
    return true;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

export class Persistence {
  readonly dataDir: string;
  private readonly backupIntervalMs: number;
  private readonly maxBackups: number;
  private readonly log: Logger;
  private readonly lastBackupAt = new Map<string, number>();
  private seq = 0;

  constructor(opts: PersistenceOptions) {
    this.dataDir = path.resolve(opts.dataDir);
    this.backupIntervalMs = opts.backupIntervalMs ?? 10 * 60 * 1000;
    this.maxBackups = opts.maxBackups ?? 50;
    this.log = opts.log ?? (() => {});
  }

  /** 저장 폴더를 만들고, 비정상 종료로 남은 임시 파일을 치운다. */
  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const names = await fs.readdir(this.dataDir);
    await Promise.all(
      names.filter((n) => n.endsWith('.tmp')).map((n) => fs.rm(path.join(this.dataDir, n), { force: true })),
    );
  }

  /** 경로는 반드시 검증을 통과한 roomId로만 만든다(경로 조작 방지). */
  private roomFile(roomId: string): string {
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error('invalid room id');
    return path.join(this.dataDir, `${roomId}.bin`);
  }

  private backupDir(roomId: string): string {
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error('invalid room id');
    return path.join(this.dataDir, 'backups', roomId);
  }

  async exists(roomId: string): Promise<boolean> {
    try {
      await fs.access(this.roomFile(roomId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 저장된 문서를 읽는다. 파일이 없으면 null.
   * 파일이 깨져 있으면 옆으로 치워 두고 가장 최근의 멀쩡한 백업으로 되살린다.
   * 그 밖의 읽기 오류는 그대로 던진다(빈 문서로 덮어쓰는 일을 막기 위해).
   */
  async load(roomId: string): Promise<Uint8Array | null> {
    const file = this.roomFile(roomId);
    let data: Uint8Array;
    try {
      data = await fs.readFile(file);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    if (isValidUpdate(data)) return data;

    const aside = `${file}.corrupt-${Date.now()}`;
    await fs.rename(file, aside);
    this.log(`corrupt file room=${roomId} moved to ${path.basename(aside)}`);
    const dir = this.backupDir(roomId);
    for (const name of (await this.listBackups(roomId)).reverse()) {
      try {
        const backup = await fs.readFile(path.join(dir, name));
        if (!isValidUpdate(backup)) continue;
        await this.writeAtomic(file, backup);
        this.log(`restored room=${roomId} from backup ${name}`);
        return backup;
      } catch {
        // 다음 백업을 시도한다
      }
    }
    this.log(`no usable backup room=${roomId}, starting empty`);
    return null;
  }

  /** 문서 전체 상태를 원자적으로 저장하고, 필요하면 백업을 남긴다. */
  async save(roomId: string, update: Uint8Array): Promise<void> {
    const file = this.roomFile(roomId);
    await this.writeAtomic(file, update);
    try {
      await this.maybeBackup(roomId, file);
    } catch (err) {
      // 백업 실패가 본 저장의 실패는 아니다
      this.log(`backup failed room=${roomId}: ${(err as Error).message}`);
    }
  }

  /** 시간순(오래된 것부터)으로 정렬된 백업 파일 이름 */
  async listBackups(roomId: string): Promise<string[]> {
    try {
      const names = await fs.readdir(this.backupDir(roomId));
      return names.filter((n) => BACKUP_NAME.test(n)).sort();
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  private async maybeBackup(roomId: string, file: string): Promise<void> {
    const now = Date.now();
    let last = this.lastBackupAt.get(roomId);
    if (last === undefined) {
      // 서버를 다시 켠 직후에는 폴더에 남은 가장 최근 백업을 기준으로 삼는다
      const newest = (await this.listBackups(roomId)).at(-1);
      const time = newest ? backupTime(newest) : NaN;
      last = Number.isFinite(time) ? time : 0;
      this.lastBackupAt.set(roomId, last);
    }
    if (now - last < this.backupIntervalMs) return;

    const dir = this.backupDir(roomId);
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(file, path.join(dir, backupName(now)));
    this.lastBackupAt.set(roomId, now);

    const names = await this.listBackups(roomId);
    const excess = names.slice(0, Math.max(0, names.length - this.maxBackups));
    await Promise.all(excess.map((n) => fs.rm(path.join(dir, n), { force: true })));
  }

  /** 임시 파일에 쓰고 디스크에 내린 뒤 rename한다. 쓰는 도중 꺼져도 기존 파일은 온전하다. */
  private async writeAtomic(file: string, data: Uint8Array): Promise<void> {
    const tmp = `${file}.${process.pid}.${++this.seq}.tmp`;
    try {
      const handle = await fs.open(tmp, 'w');
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}
