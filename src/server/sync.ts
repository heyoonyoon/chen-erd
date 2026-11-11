/**
 * Yjs 동기화. 방마다 Y.Doc 하나와 Awareness 하나를 메모리에 두고 접속자끼리 중계한다. [담당: server 에이전트]
 * 프로토콜은 y-websocket 클라이언트(WebsocketProvider)와 같다.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';
import type { Logger, Persistence } from './persistence';

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;
const messageQueryAwareness = 3;

/**
 * 닫기 코드. y-websocket 클라이언트는 4400~4499를 받으면 다시 접속하지 않고,
 * 그 밖의 코드는 일시적인 문제로 보고 다시 접속을 시도한다.
 */
export const CLOSE_INVALID_ROOM = 4400;
export const CLOSE_ROOM_FULL = 4503;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_INTERNAL_ERROR = 1011;

/** 받는 쪽이 이만큼 밀리면 느린 연결로 보고 끊는다. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
/** 방을 읽어 오는 동안 쌓아 둘 수 있는 메시지 수 */
const MAX_QUEUED_MESSAGES = 1000;

export interface SyncOptions {
  /** 방당 최대 접속자. 기본 15 */
  maxClientsPerRoom?: number;
  /** 변경 후 저장까지 기다리는 시간. 기본 1초 */
  saveDebounceMs?: number;
  /** 변경이 계속 이어져도 이 시간 안에는 한 번 저장한다. 기본 5초 */
  saveMaxWaitMs?: number;
  /** 저장에 실패했을 때 다시 시도하기까지의 시간. 기본 5초 */
  saveRetryMs?: number;
  /** 마지막 접속자가 나간 뒤 메모리에서 내리기까지의 시간. 기본 30초 */
  unloadDelayMs?: number;
  /** ping 주기. 한 주기 동안 pong이 없으면 끊는다. 기본 30초 */
  pingIntervalMs?: number;
  log?: Logger;
}

interface Conn {
  ws: WebSocket;
  alive: boolean;
  /** 이 연결이 올린 awareness 상태의 clientID. 끊기면 이 상태들을 지운다. */
  awarenessIds: Set<number>;
  /** 방을 읽어 오는 동안 받은 메시지. 방이 준비되면 null이 된다. */
  queue: Uint8Array[] | null;
}

interface Room {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Conn>;
  state: 'loading' | 'ready' | 'dead';
  /** 읽기가 끝나면 풀린다. 값은 성공 여부 */
  ready: Promise<boolean>;
  dirty: boolean;
  dirtySince: number;
  saveTimer: NodeJS.Timeout | null;
  /** 저장을 한 번에 하나씩만 하도록 잇는 사슬 */
  saving: Promise<void>;
  unloadTimer: NodeJS.Timeout | null;
}

export class SyncHub {
  private readonly rooms = new Map<string, Room>();
  private readonly maxClientsPerRoom: number;
  private readonly saveDebounceMs: number;
  private readonly saveMaxWaitMs: number;
  private readonly saveRetryMs: number;
  private readonly unloadDelayMs: number;
  private readonly pingIntervalMs: number;
  private readonly log: Logger;
  private pingTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(
    private readonly persistence: Persistence,
    opts: SyncOptions = {},
  ) {
    this.maxClientsPerRoom = opts.maxClientsPerRoom ?? 15;
    this.saveDebounceMs = opts.saveDebounceMs ?? 1000;
    this.saveMaxWaitMs = opts.saveMaxWaitMs ?? 5000;
    this.saveRetryMs = opts.saveRetryMs ?? 5000;
    this.unloadDelayMs = opts.unloadDelayMs ?? 30_000;
    this.pingIntervalMs = opts.pingIntervalMs ?? 30_000;
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    this.closing = false;
    this.pingTimer = setInterval(() => this.sweep(), this.pingIntervalMs);
    this.pingTimer.unref();
  }

  stats(): { rooms: number; connections: number } {
    let connections = 0;
    for (const room of this.rooms.values()) connections += room.conns.size;
    return { rooms: this.rooms.size, connections };
  }

  /** roomId는 호출하는 쪽에서 검증한 값이어야 한다. 방을 메모리에 올리지는 않는다. */
  async roomInfo(roomId: string): Promise<{ exists: boolean; clients: number }> {
    const room = this.rooms.get(roomId);
    const clients = room?.conns.size ?? 0;
    const exists = clients > 0 || room?.dirty === true || (await this.persistence.exists(roomId));
    return { exists, clients };
  }

  /** 메모리에도 디스크에도 없는 방인지. roomId는 호출하는 쪽에서 검증한 값이어야 한다. */
  async isNewRoom(roomId: string): Promise<boolean> {
    if (this.rooms.has(roomId)) return false;
    return !(await this.persistence.exists(roomId));
  }

  /** 핸드셰이크를 마친 웹소켓을 방에 넣는다. roomId는 검증을 통과한 값이어야 한다. */
  handleConnection(ws: WebSocket, roomId: string): void {
    ws.on('error', () => {
      // 오류 뒤에는 close가 따라오므로 정리는 거기서 한다
    });
    if (this.closing) {
      ws.close(CLOSE_GOING_AWAY, 'server shutting down');
      return;
    }
    const room = this.getRoom(roomId);
    if (room.conns.size >= this.maxClientsPerRoom) {
      ws.close(CLOSE_ROOM_FULL, 'room full');
      return;
    }
    if (room.unloadTimer) {
      clearTimeout(room.unloadTimer);
      room.unloadTimer = null;
    }

    const conn: Conn = { ws, alive: true, awarenessIds: new Set(), queue: [] };
    room.conns.set(ws, conn);
    this.log(`join room=${room.id} clients=${room.conns.size}`);

    ws.on('message', (data, isBinary) => {
      if (!isBinary || this.closing) return;
      const buf = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
      const message = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      if (conn.queue) {
        if (conn.queue.length >= MAX_QUEUED_MESSAGES) ws.close(CLOSE_INTERNAL_ERROR, 'too many messages');
        else conn.queue.push(message);
        return;
      }
      this.onMessage(room, conn, message);
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('close', () => this.onClose(room, conn));

    if (room.state === 'ready') {
      this.attach(room, conn);
    } else {
      void room.ready.then((ok) => {
        if (ok && room.conns.get(ws) === conn) this.attach(room, conn);
      });
    }
  }

  /** 모든 연결을 닫고 모든 방을 저장한 뒤 메모리를 비운다. */
  async close(): Promise<void> {
    this.closing = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;

    const rooms = Array.from(this.rooms.values());
    for (const room of rooms) {
      if (room.unloadTimer) clearTimeout(room.unloadTimer);
      room.unloadTimer = null;
      for (const conn of room.conns.values()) conn.ws.close(CLOSE_GOING_AWAY, 'server shutting down');
    }
    await Promise.all(
      rooms.map(async (room) => {
        await room.ready;
        await this.flush(room);
        if (room.dirty) this.log(`unsaved changes lost room=${room.id}`);
      }),
    );
    for (const room of rooms) {
      for (const conn of room.conns.values()) conn.ws.terminate();
      this.destroyRoom(room);
    }
  }

  // ───────────────────────── 방 ─────────────────────────

  private getRoom(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    // 서버 자신은 접속자가 아니다
    awareness.setLocalState(null);
    const room: Room = {
      id: roomId,
      doc,
      awareness,
      conns: new Map(),
      state: 'loading',
      ready: Promise.resolve(false),
      dirty: false,
      dirtySince: 0,
      saveTimer: null,
      saving: Promise.resolve(),
      unloadTimer: null,
    };
    this.rooms.set(roomId, room);
    room.ready = this.load(room);
    return room;
  }

  private async load(room: Room): Promise<boolean> {
    try {
      const data = await this.persistence.load(room.id);
      if (data) {
        Y.applyUpdate(room.doc, data, 'load');
        // 고치지 않고 보기만 해도 "열린 방"으로 쳐서 자동 삭제 기한을 다시 센다
        void this.persistence.touch(room.id);
      }
    } catch (err) {
      // 읽지 못한 방을 빈 문서로 열면 저장하면서 기존 파일을 덮어쓰게 된다. 방을 열지 않는다.
      this.log(`load failed room=${room.id}: ${(err as Error).message}`);
      const conns = Array.from(room.conns.values());
      this.destroyRoom(room);
      for (const conn of conns) conn.ws.close(CLOSE_INTERNAL_ERROR, 'room load failed');
      return false;
    }
    room.state = 'ready';

    room.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      // 보낸 사람은 이미 가지고 있는 변경이다
      for (const conn of room.conns.values()) if (conn !== origin) this.send(conn, message);
      this.markDirty(room);
    });

    room.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const sender = this.connOf(room, origin);
        if (sender) {
          // 가장 최근에 그 상태를 올린 연결이 주인이다(같은 clientID로 다시 접속한 경우를 위해 옮긴다)
          for (const id of added.concat(updated)) {
            for (const other of room.conns.values()) if (other !== sender) other.awarenessIds.delete(id);
            sender.awarenessIds.add(id);
          }
          for (const id of removed) sender.awarenessIds.delete(id);
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, added.concat(updated, removed)),
        );
        const message = encoding.toUint8Array(encoder);
        // 보낸 사람에게도 돌려준다. 클라이언트는 30초 동안 아무 메시지도 못 받으면 연결이 죽었다고 보고
        // 다시 접속하는데, 15초마다 올리는 자기 awareness가 되돌아오는 것이 그 생존 신호다.
        for (const conn of room.conns.values()) this.send(conn, message);
      },
    );
    return true;
  }

  private connOf(room: Room, origin: unknown): Conn | null {
    for (const conn of room.conns.values()) if (conn === origin) return conn;
    return null;
  }

  private destroyRoom(room: Room): void {
    if (room.state === 'dead') return;
    room.state = 'dead';
    if (room.saveTimer) clearTimeout(room.saveTimer);
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    room.saveTimer = null;
    room.unloadTimer = null;
    if (this.rooms.get(room.id) === room) this.rooms.delete(room.id);
    room.awareness.destroy();
    room.doc.destroy();
  }

  // ───────────────────────── 연결 ─────────────────────────

  /** 방이 준비된 연결에 서버 상태를 알리고, 기다리던 메시지를 처리한다. */
  private attach(room: Room, conn: Conn): void {
    const queued = conn.queue ?? [];
    conn.queue = null;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    this.send(conn, encoding.toUint8Array(encoder));
    this.sendAwareness(room, conn);

    for (const message of queued) this.onMessage(room, conn, message);
  }

  private sendAwareness(room: Room, conn: Conn): void {
    const ids = Array.from(room.awareness.getStates().keys());
    if (ids.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, ids));
    this.send(conn, encoding.toUint8Array(encoder));
  }

  private onMessage(room: Room, conn: Conn, message: Uint8Array): void {
    if (room.state !== 'ready') return;
    try {
      const decoder = decoding.createDecoder(message);
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          // step1에는 step2로 답하고, step2와 update는 문서에 적용한다(적용되면 doc의 update 이벤트가 중계한다)
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
          if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder));
          break;
        }
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
          break;
        case messageQueryAwareness:
          this.sendAwareness(room, conn);
          break;
        case messageAuth:
        default:
          break;
      }
    } catch (err) {
      this.log(`bad message room=${room.id}: ${(err as Error).message}`);
    }
  }

  private onClose(room: Room, conn: Conn): void {
    if (room.conns.get(conn.ws) !== conn) return;
    room.conns.delete(conn.ws);
    this.log(`leave room=${room.id} clients=${room.conns.size}`);
    if (room.state === 'dead') return;
    // 이 연결이 올린 상태를 지워 다른 사람 화면에서 커서가 사라지게 한다
    if (conn.awarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(conn.awarenessIds), null);
    }
    if (room.conns.size === 0 && !this.closing) {
      void this.flush(room);
      this.scheduleUnload(room);
    }
  }

  private send(conn: Conn, message: Uint8Array): void {
    const ws = conn.ws;
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.terminate();
      return;
    }
    ws.send(message, { binary: true }, (err) => {
      if (err) ws.terminate();
    });
  }

  /** pong이 돌아오지 않은 연결을 끊고 다시 ping을 보낸다. */
  private sweep(): void {
    for (const room of this.rooms.values()) {
      for (const conn of room.conns.values()) {
        if (!conn.alive) {
          conn.ws.terminate();
          continue;
        }
        conn.alive = false;
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.ping();
      }
    }
  }

  // ───────────────────────── 저장 ─────────────────────────

  private markDirty(room: Room): void {
    const now = Date.now();
    if (!room.dirty) {
      room.dirty = true;
      room.dirtySince = now;
    }
    // 디바운스하되, 변경이 끊이지 않아도 최대 대기 시간 안에는 저장한다
    const wait = Math.max(0, Math.min(this.saveDebounceMs, room.dirtySince + this.saveMaxWaitMs - now));
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => void this.flush(room), wait);
  }

  /** 바뀐 내용이 있으면 지금 저장한다. 저장은 방마다 한 번에 하나씩 차례로 한다. */
  private flush(room: Room): Promise<void> {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = null;
    room.saving = room.saving.then(async () => {
      if (!room.dirty || room.state !== 'ready') return;
      room.dirty = false;
      try {
        await this.persistence.save(room.id, Y.encodeStateAsUpdate(room.doc));
      } catch (err) {
        if (!room.dirty) room.dirtySince = Date.now();
        room.dirty = true;
        this.log(`save failed room=${room.id}: ${(err as Error).message}`);
        if (!this.closing && room.state === 'ready' && !room.saveTimer) {
          room.saveTimer = setTimeout(() => void this.flush(room), this.saveRetryMs);
        }
      }
    });
    return room.saving;
  }

  private scheduleUnload(room: Room): void {
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    room.unloadTimer = setTimeout(() => {
      room.unloadTimer = null;
      void this.unload(room);
    }, this.unloadDelayMs);
    room.unloadTimer.unref();
  }

  private async unload(room: Room): Promise<void> {
    if (room.conns.size > 0 || room.state !== 'ready') return;
    await this.flush(room);
    if (room.conns.size > 0 || room.state !== 'ready' || this.closing) return;
    if (room.dirty) {
      // 저장에 실패했다면 내리지 않고 다음에 다시 본다
      this.scheduleUnload(room);
      return;
    }
    // 마지막 사람이 나간 때부터 자동 삭제 기한을 센다
    await this.persistence.touch(room.id);
    if (room.conns.size > 0 || room.state !== 'ready' || this.closing) return;
    this.destroyRoom(room);
  }

  /** 오래 열리지 않은 방을 디스크에서 지운다. 지금 열려 있는 방은 건드리지 않는다. */
  async removeExpiredRooms(ttlMs: number): Promise<string[]> {
    if (this.closing) return [];
    return this.persistence.removeExpired(ttlMs, (roomId) => this.rooms.has(roomId));
  }
}
