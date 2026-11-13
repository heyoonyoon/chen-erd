/**
 * 서비스 지표 모으기. 관리자 페이지(src/server/admin.ts)가 읽는다.
 *
 * 개인정보를 저장하지 않는다. 이름, 이메일, IP, 방 내용, User-Agent 원문은 받지도 쓰지도 않는다.
 * 사람은 브라우저가 만든 무작위 익명 ID(128비트)로만 구분하고, 그 ID와 방 id는 서버 비밀 솔트로 HMAC한 값만 남긴다.
 * 봇(User-Agent에 bot, crawler, spider, headless 등)은 세지 않는다.
 *
 * 핫패스(편집, 접속)에서는 메모리의 카운터와 집합만 고치고, 파일은 1분마다 한 번 쓴다.
 * 날짜 경계는 Asia/Seoul(UTC+9, 일광절약시간 없음)이다.
 *
 * 파일(DATA_DIR/stats/). 모두 임시 파일에 쓴 뒤 rename한다.
 *   daily.jsonl  확정된 하루 집계. 날짜별 한 줄(숫자만, 해시도 없다)
 *   today.json   오늘 진행 중인 집계. 1분마다 덮어써서 다시 켜도 이어 센다(고유 집계를 위해 해시 집합을 담는다)
 *   users.json   사용자(해시) → [첫 방문일, 마지막 방문일, 방문한 날 수, 표시], 그리고 누적 카운터
 *   rooms.json   방(해시) → [처음 본 날, 마지막으로 열린 날, 표시]. 120일 동안 안 열린 방은 지운다
 *   salt         STATS_SALT 환경변수가 없을 때 만들어 두는 비밀 솔트
 */
import { createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOM_ID_PATTERN } from '../shared/types';
import {
  ANON_ID_PATTERN,
  DIALECTS,
  ENTRY_KINDS,
  EXPORT_KINDS,
  TELEMETRY_EVENTS,
  type TelemetryEvent,
} from '../shared/telemetry';

export const DAY_MS = 86_400_000;
/** Asia/Seoul은 1988년 이후 일광절약시간이 없어 언제나 UTC+9다 */
const SEOUL_OFFSET_MS = 9 * 3_600_000;

/** 서울 날짜의 일련번호(1970-01-01 = 0) */
export function dayNumber(ms: number): number {
  return Math.floor((ms + SEOUL_OFFSET_MS) / DAY_MS);
}
export function dayLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
export function labelDay(label: string): number {
  return Math.floor(Date.parse(`${label}T00:00:00Z`) / DAY_MS);
}

const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl\/|wget|python|httpclient|axios|node-fetch|undici|go-http|java\/|okhttp|scrapy|monitor|uptime/i;

/** 사람이 쓰는 브라우저가 아닌지. User-Agent가 없으면 프로그램으로 본다 */
export function isBot(ua: string | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return BOT_UA.test(ua);
}

/** WebSocket 닫기 코드가 비정상 종료인지. 1000/1001/1005는 정상, 4000번대는 서버가 일부러 닫은 것(제한 등)이다 */
export function isAbnormalClose(code: number): boolean {
  if (code === 1000 || code === 1001 || code === 1005) return false;
  if (code >= 4000 && code < 5000) return false;
  return true;
}

/** 들어온 곳의 도메인을 다듬는다. 도메인 꼴이 아니면 null */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.trim().toLowerCase();
  if (d === 'direct') return 'direct';
  if (d.startsWith('www.')) d = d.slice(4);
  // 호스트 이름만 받는다(유니코드 도메인은 브라우저가 punycode로 준다). 허용 글자와 길이를 좁혀 둔다
  if (d.length > 64 || !/^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(d)) return null;
  return d;
}

/** 하루에 이 값을 넘는 서로 다른 값(도메인, utm, 언어)은 '기타'로 묶는다(파일과 메모리가 불어나지 않게) */
const MAX_DISTINCT = 50;
const OTHER = '(기타)';
/** 중앙값을 구하려고 남겨 두는 체류 시간 표본 수 */
const MAX_DURATION_SAMPLES = 5000;
/** 방 기록을 남겨 두는 기간 */
const ROOM_KEEP_DAYS = 120;
/** 해시 결과를 기억해 두는 개수(같은 사람, 같은 방을 매번 다시 해시하지 않게) */
const HASH_CACHE = 20_000;

// 사용자 표시
const U_APP = 1;
const U_D1 = 2;
const U_D7 = 4;
const U_D30 = 8;
// 방 표시
const R_CREATED = 1;
const R_NEXT_DAY = 2;
const R_REL = 4;
const R_AI = 8;

/** [첫 방문일, 마지막 방문일, 방문한 날 수, 표시] */
type UserEntry = [number, number, number, number];
/** [처음 본 날, 마지막으로 열린 날, 표시] */
type RoomEntry = [number, number, number];

export interface Totals {
  rooms: number;
  cli: number;
  mcp: number;
  sql: number;
  aiRooms: number;
  relRooms: number;
}
const ZERO_TOTALS: Totals = { rooms: 0, cli: 0, mcp: 0, sql: 0, aiRooms: 0, relRooms: 0 };

interface DayState {
  day: number;
  /** 고유 집계. 사용자 해시나 방 해시의 집합 */
  sets: Map<string, Set<string>>;
  counts: Map<string, number>;
  peak: number;
  durSum: number;
  durN: number;
  durSample: number[];
}

/** 확정된(또는 진행 중인) 하루 집계. 숫자만 담는다 */
export interface DailyRow {
  day: string;
  /** 고유 집계의 크기(사람 수, 방 수) */
  u: Record<string, number>;
  /** 횟수 */
  c: Record<string, number>;
  /** 최대 동시 접속(고유 브라우저) */
  peak: number;
  /** 방 연결 세션: 수, 평균 초, 중앙 초 */
  sess: { n: number; avg: number; med: number };
  /** 그날 기준 최근 7일, 30일 동안 온 사람 수 */
  wau: number;
  mau: number;
}

export interface StatsOptions {
  /** 파일을 둘 폴더(DATA_DIR/stats) */
  dir: string;
  /** 해시 솔트. 없으면 dir/salt 를 만들어 쓴다 */
  salt?: string;
  /** 파일에 쓰는 주기. 기본 60초 */
  flushIntervalMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

export type CliCommand = 'new' | 'push' | 'pull' | 'diagram' | 'relational' | 'relational-push' | 'sql';
export const MCP_TOOLS = ['create_diagram', 'read_diagram', 'update_diagram', 'validate_diagram', 'diagram_syntax', 'diagram_to_sql'] as const;

interface LiveConn {
  userKey: string;
  roomId: string;
  start: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function freshDay(day: number): DayState {
  return { day, sets: new Map(), counts: new Map(), peak: 0, durSum: 0, durN: 0, durSample: [] };
}

export class StatsCollector {
  readonly dir: string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly flushIntervalMs: number;
  private salt: string;

  private state: DayState;
  private rows: DailyRow[] = [];
  private users = new Map<string, UserEntry>();
  private rooms = new Map<string, RoomEntry>();
  private totals: Totals = { ...ZERO_TOTALS };

  private readonly live = new Map<object, LiveConn>();
  private readonly userConns = new Map<string, number>();
  private readonly roomUsers = new Map<string, Map<string, number>>();
  private anonSeq = 0;

  private readonly userHashes = new Map<string, string>();
  private readonly roomHashes = new Map<string, string>();

  private usersDirty = false;
  private roomsDirty = false;
  private dailyDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(opts: StatsOptions) {
    this.dir = path.resolve(opts.dir);
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.flushIntervalMs = opts.flushIntervalMs ?? 60_000;
    this.salt = opts.salt ?? '';
    this.state = freshDay(dayNumber(this.now()));
  }

  // ───────────────────────── 시작과 끝 ─────────────────────────

  /** 폴더를 만들고 저장된 집계를 읽는다. 저장된 '오늘'이 지난 날이면 확정해 daily.jsonl로 옮긴다 */
  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    if (!this.salt) this.salt = await this.loadSalt();

    const daily = await this.readText('daily.jsonl');
    if (daily) {
      for (const line of daily.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as DailyRow;
          if (row && typeof row.day === 'string') this.rows.push(row);
        } catch {
          this.log('stats: skipped a broken line in daily.jsonl');
        }
      }
      this.rows = dedupeRows(this.rows);
    }

    const users = await this.readJson('users.json');
    if (isRecord(users)) {
      if (isRecord(users.users)) {
        for (const [h, e] of Object.entries(users.users)) if (Array.isArray(e) && e.length === 4) this.users.set(h, e as UserEntry);
      }
      if (isRecord(users.totals)) this.totals = { ...ZERO_TOTALS, ...(users.totals as Partial<Totals>) };
    }
    const rooms = await this.readJson('rooms.json');
    if (isRecord(rooms) && isRecord(rooms.rooms)) {
      for (const [h, e] of Object.entries(rooms.rooms)) if (Array.isArray(e) && e.length === 3) this.rooms.set(h, e as RoomEntry);
    }

    const today = await this.readJson('today.json');
    if (isRecord(today) && typeof today.day === 'number') {
      const restored = freshDay(today.day);
      if (isRecord(today.sets)) {
        for (const [k, v] of Object.entries(today.sets)) if (Array.isArray(v)) restored.sets.set(k, new Set(v.map(String)));
      }
      if (isRecord(today.counts)) {
        for (const [k, v] of Object.entries(today.counts)) if (typeof v === 'number') restored.counts.set(k, v);
      }
      restored.peak = Number(today.peak) || 0;
      restored.durSum = Number(today.durSum) || 0;
      restored.durN = Number(today.durN) || 0;
      if (Array.isArray(today.durSample)) restored.durSample = today.durSample.filter((n): n is number => typeof n === 'number');
      this.state = restored;
    }
    // 꺼져 있는 사이에 날이 바뀌었으면 여기서 확정한다
    this.rollover(this.now());
    await this.flush();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.rollover(this.now());
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rollover(this.now());
    await this.flush();
  }

  // ───────────────────────── 기록: 웹소켓 ─────────────────────────

  /** 방에 연결이 붙었다. key는 연결마다 다른 객체(웹소켓) */
  wsOpen(key: object, roomId: string, anonId: string | null, ua: string | undefined): void {
    if (isBot(ua) || this.live.has(key)) return;
    const now = this.now();
    this.rollover(now);
    const user = anonId && ANON_ID_PATTERN.test(anonId) ? this.hashUser(anonId) : null;
    const userKey = user ?? `#${++this.anonSeq}`;
    this.live.set(key, { userKey, roomId, start: now });
    this.userConns.set(userKey, (this.userConns.get(userKey) ?? 0) + 1);
    let inRoom = this.roomUsers.get(roomId);
    if (!inRoom) this.roomUsers.set(roomId, (inRoom = new Map()));
    inRoom.set(userKey, (inRoom.get(userKey) ?? 0) + 1);

    this.count('conns');
    if (user) {
      this.touchUser(user, now, true);
      this.addSet('app', user);
    }
    const room = this.hashRoom(roomId);
    this.touchRoom(room, now);
    this.addSet('r:open', room);
    if (inRoom.size >= 2) this.addSet('r:collab', room);
    if (this.userConns.size > this.state.peak) this.state.peak = this.userConns.size;
  }

  wsClose(key: object, code: number): void {
    const conn = this.live.get(key);
    if (!conn) return;
    this.live.delete(key);
    const now = this.now();
    this.rollover(now);
    const left = (this.userConns.get(conn.userKey) ?? 1) - 1;
    if (left > 0) this.userConns.set(conn.userKey, left);
    else this.userConns.delete(conn.userKey);
    const inRoom = this.roomUsers.get(conn.roomId);
    if (inRoom) {
      const n = (inRoom.get(conn.userKey) ?? 1) - 1;
      if (n > 0) inRoom.set(conn.userKey, n);
      else inRoom.delete(conn.userKey);
      if (inRoom.size === 0) this.roomUsers.delete(conn.roomId);
    }
    const sec = Math.max(0, (now - conn.start) / 1000);
    const s = this.state;
    s.durSum += sec;
    s.durN += 1;
    if (s.durSample.length < MAX_DURATION_SAMPLES) s.durSample.push(Math.round(sec));
    else s.durSample[Math.floor(Math.random() * MAX_DURATION_SAMPLES)] = Math.round(sec);
    if (isAbnormalClose(code)) this.count('wsAbnormal');
  }

  /** 접속자가 방 문서를 고쳤다(Yjs 업데이트 하나) */
  edit(roomId: string): void {
    this.rollover(this.now());
    this.count('edits');
    this.addSet('r:active', this.hashRoom(roomId));
  }

  /** 없던 방이 처음 저장됐다 */
  roomCreated(roomId: string): void {
    const now = this.now();
    this.rollover(now);
    const room = this.hashRoom(roomId);
    const entry = this.touchRoom(room, now);
    if (entry[2] & R_CREATED) return;
    entry[2] |= R_CREATED;
    this.addSet('r:new', room);
    this.totals.rooms += 1;
    this.usersDirty = true;
  }

  // ───────────────────────── 기록: AI(CLI, MCP) ─────────────────────────

  /** CLI(모델 API) 호출 하나. 명령은 API 경로로 구분한다 */
  cliCall(cmd: CliCommand): void {
    this.rollover(this.now());
    this.count(`cli:${cmd}`);
    this.totals.cli += 1;
    if (cmd === 'sql') this.countSql();
    this.usersDirty = true;
  }

  mcpCall(tool: string): void {
    if (!(MCP_TOOLS as readonly string[]).includes(tool)) return;
    this.rollover(this.now());
    this.count(`mcp:${tool}`);
    this.totals.mcp += 1;
    if (tool === 'diagram_to_sql') this.countSql();
    this.usersDirty = true;
  }

  /** AI(CLI 또는 MCP)가 방을 만들었거나 고쳤다 */
  aiRoom(roomId: string, kind: 'create' | 'modify'): void {
    const now = this.now();
    this.rollover(now);
    const room = this.hashRoom(roomId);
    const entry = this.touchRoom(room, now, false);
    if (kind === 'create') {
      this.addSet('r:ainew', room);
      if (!(entry[2] & R_AI)) {
        entry[2] |= R_AI;
        this.totals.aiRooms += 1;
        this.usersDirty = true;
      }
    } else {
      this.addSet('r:aimod', room);
    }
  }

  /** AI가 관계 모델 글을 썼다 */
  relationalWritten(roomId: string): void {
    this.markRelRoom(this.hashRoom(roomId), this.now());
  }

  serverError(): void {
    this.rollover(this.now());
    this.count('err5xx');
  }

  // ───────────────────────── 기록: 브라우저 이벤트 ─────────────────────────

  /** POST /api/t 로 온 이벤트 하나. 모르는 이벤트나 형식이 틀린 값은 버린다. 받아들였으면 true */
  clientEvent(body: unknown, ua: string | undefined): boolean {
    if (isBot(ua) || !isRecord(body)) return false;
    const { a, e } = body;
    if (typeof a !== 'string' || !ANON_ID_PATTERN.test(a)) return false;
    if (typeof e !== 'string' || !(TELEMETRY_EVENTS as readonly string[]).includes(e)) return false;
    const event = e as TelemetryEvent;
    const roomId = typeof body.r === 'string' && ROOM_ID_PATTERN.test(body.r) ? body.r : null;
    const now = this.now();
    this.rollover(now);
    const user = this.hashUser(a);
    const inRoom = event !== 'home_view' && event !== 'create_click' && event !== 'migrate_open';
    this.touchUser(user, now, inRoom);
    if (inRoom) this.addSet('app', user);

    if (body.land === 1) this.landing(event, body, user);

    switch (event) {
      case 'home_view':
        this.addSet('home', user);
        break;
      case 'room_enter': {
        const entry = typeof body.entry === 'string' && (ENTRY_KINDS as readonly string[]).includes(body.entry) ? body.entry : null;
        if (entry) {
          this.count(`entry:${entry}`);
          if (entry === 'link') this.addSet('invite', user);
        }
        break;
      }
      case 'create_click':
        this.addSet('f:create', user);
        break;
      case 'migrate_open':
        this.addSet('u:migrate', user);
        break;
      case 'shape_add':
        this.addSet('f:shape', user);
        break;
      case 'rel_write':
        this.addSet('f:rel', user);
        if (roomId) this.markRelRoom(this.hashRoom(roomId), now);
        break;
      case 'ie_edit':
        this.addSet('f:ie', user);
        break;
      case 'sql_view':
        this.addSet('f:sqlview', user);
        this.countSql();
        break;
      case 'sql_copy':
      case 'sql_download':
        this.addSet('f:sqlexport', user);
        this.count(`sqlx:${event === 'sql_copy' ? 'copy' : 'download'}`);
        break;
      case 'export': {
        const kind = typeof body.kind === 'string' && (EXPORT_KINDS as readonly string[]).includes(body.kind) ? body.kind : null;
        if (!kind) return false;
        this.count(`exp:${kind}`);
        this.addSet('u:export', user);
        break;
      }
      case 'dbms': {
        const v = typeof body.v === 'string' && (DIALECTS as readonly string[]).includes(body.v) ? body.v : null;
        if (!v) return false;
        this.count(`dbms:${v}`);
        break;
      }
      case 'validate_open':
        this.addSet('u:validate', user);
        break;
      case 'legend_open':
        this.addSet('u:legend', user);
        break;
      case 'help_open':
        this.addSet('u:help', user);
        break;
      case 'layout_change':
        this.addSet('u:layout', user);
        break;
      case 'share_link':
        this.count('share');
        this.addSet('u:share', user);
        break;
    }
    return true;
  }

  /** 페이지를 처음 연 이벤트: 유입 경로, 언어, 기기 */
  private landing(event: TelemetryEvent, body: Record<string, unknown>, user: string): void {
    if (event === 'home_view') this.count('land:home');
    else if (event === 'room_enter') this.count(body.entry === 'link' ? 'land:link' : 'land:room');
    const ref = normalizeDomain(body.ref) ?? 'direct';
    this.count(this.capped('ref:', ref));
    if (typeof body.utm === 'string') {
      const utm = body.utm.trim().toLowerCase();
      if (/^[a-z0-9_.\-]{1,40}$/.test(utm)) this.count(this.capped('utm:', utm));
    }
    if (typeof body.lang === 'string' && /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(body.lang)) {
      this.addSet(this.capped('lang:', body.lang.toLowerCase()), user);
    }
    if (body.dev === 'm' || body.dev === 'd') this.addSet(`dev:${body.dev}`, user);
  }

  // ───────────────────────── 읽기 ─────────────────────────

  /** 지금 방에 연결된 고유 브라우저 수와 두 사람 이상이 함께 있는 방 수 */
  liveCounts(): { users: number; trackedConnections: number; rooms: number; collabRooms: number } {
    let collab = 0;
    for (const users of this.roomUsers.values()) if (users.size >= 2) collab += 1;
    return { users: this.userConns.size, trackedConnections: this.live.size, rooms: this.roomUsers.size, collabRooms: collab };
  }

  /** 오늘(진행 중) 집계 */
  today(): DailyRow {
    this.rollover(this.now());
    return this.rowOf(this.state);
  }

  /** 최근 days일의 일별 집계(오늘 포함, 오래된 날부터). 기록이 없는 날은 0으로 채운다. days가 없으면 기록이 있는 첫날부터 */
  daily(days?: number): DailyRow[] {
    const today = this.today();
    const todayN = this.state.day;
    const byDay = new Map(this.rows.map((r) => [r.day, r]));
    byDay.set(today.day, today);
    const first = this.rows.length > 0 ? labelDay(this.rows[0].day) : todayN;
    const from = days && days > 0 ? todayN - Math.min(days, 3660) + 1 : Math.min(first, todayN);
    const out: DailyRow[] = [];
    for (let d = from; d <= todayN; d++) {
      const label = dayLabel(d);
      out.push(byDay.get(label) ?? emptyRow(label));
    }
    return out;
  }

  totalsNow(): Totals & { visitors: number; appUsers: number } {
    let app = 0;
    for (const e of this.users.values()) if (e[3] & U_APP) app += 1;
    return { ...this.totals, visitors: this.users.size, appUsers: app };
  }

  /** 첫 방문일 코호트별 재방문(첫 방문 뒤 1, 7, 30일 안에 다시 온 사람). ready는 그 기간이 다 지났는지 */
  retention(days = 30): Array<{ day: string; n: number; d1: number; d7: number; d30: number; ready: [boolean, boolean, boolean] }> {
    this.rollover(this.now());
    const today = this.state.day;
    const from = today - days + 1;
    const cohorts = new Map<number, { n: number; d1: number; d7: number; d30: number }>();
    for (const [f, , , flags] of this.users.values()) {
      if (f < from) continue;
      let c = cohorts.get(f);
      if (!c) cohorts.set(f, (c = { n: 0, d1: 0, d7: 0, d30: 0 }));
      c.n += 1;
      if (flags & U_D1) c.d1 += 1;
      if (flags & U_D7) c.d7 += 1;
      if (flags & U_D30) c.d30 += 1;
    }
    const out = [];
    for (let d = today; d >= from; d--) {
      const c = cohorts.get(d) ?? { n: 0, d1: 0, d7: 0, d30: 0 };
      out.push({ day: dayLabel(d), ...c, ready: [today > d + 1, today > d + 7, today > d + 30] as [boolean, boolean, boolean] });
    }
    return out;
  }

  /** 새로 만든 방 가운데 다음 날 다시 열린 방(만든 날별) */
  roomNextDay(days = 30): Array<{ day: string; created: number; reopened: number; ready: boolean }> {
    this.rollover(this.now());
    const today = this.state.day;
    const from = today - days + 1;
    const by = new Map<number, { created: number; reopened: number }>();
    for (const [f, , flags] of this.rooms.values()) {
      if (f < from || !(flags & R_CREATED)) continue;
      let c = by.get(f);
      if (!c) by.set(f, (c = { created: 0, reopened: 0 }));
      c.created += 1;
      if (flags & R_NEXT_DAY) c.reopened += 1;
    }
    const out = [];
    for (let d = today; d >= from; d--) {
      const c = by.get(d) ?? { created: 0, reopened: 0 };
      out.push({ day: dayLabel(d), ...c, ready: today > d + 1 });
    }
    return out;
  }

  /** 지금 기준 최근 7일, 30일 동안 온 사람 수 */
  activeUsers(): { wau: number; mau: number } {
    this.rollover(this.now());
    return this.activeAsOf(this.state.day);
  }

  // ───────────────────────── 안쪽 ─────────────────────────

  private activeAsOf(day: number): { wau: number; mau: number } {
    let wau = 0;
    let mau = 0;
    for (const [, last] of this.users.values()) {
      if (last > day) continue;
      if (last > day - 7) wau += 1;
      if (last > day - 30) mau += 1;
    }
    return { wau, mau };
  }

  private rowOf(s: DayState): DailyRow {
    const u: Record<string, number> = {};
    for (const [k, set] of s.sets) u[k] = set.size;
    u.returning = (u.visitors ?? 0) - (u.new ?? 0);
    const c: Record<string, number> = {};
    for (const [k, n] of s.counts) c[k] = n;
    return {
      day: dayLabel(s.day),
      u,
      c,
      peak: s.peak,
      sess: { n: s.durN, avg: s.durN > 0 ? Math.round(s.durSum / s.durN) : 0, med: Math.round(median(s.durSample)) },
      ...this.activeAsOf(s.day),
    };
  }

  /** 날이 바뀌었으면 어제 집계를 확정하고 새 날을 시작한다 */
  private rollover(now: number): void {
    const day = dayNumber(now);
    if (day === this.state.day) return;
    if (day < this.state.day) return; // 시계가 뒤로 갔다. 그대로 이어 센다
    const row = this.rowOf(this.state);
    this.rows = dedupeRows([...this.rows, row]);
    this.dailyDirty = true;
    this.state = freshDay(day);
    // 날을 넘어 이어진 연결도 새 날의 동시 접속으로 친다
    this.state.peak = this.userConns.size;
    this.userHashes.clear();
    this.roomHashes.clear();
    for (const [h, e] of this.rooms) if (e[1] < day - ROOM_KEEP_DAYS) this.rooms.delete(h);
    this.roomsDirty = true;
  }

  private count(key: string, n = 1): void {
    this.state.counts.set(key, (this.state.counts.get(key) ?? 0) + n);
  }

  private countSql(): void {
    this.count('sql');
    this.totals.sql += 1;
    this.usersDirty = true;
  }

  private addSet(key: string, value: string): void {
    let set = this.state.sets.get(key);
    if (!set) this.state.sets.set(key, (set = new Set()));
    set.add(value);
  }

  /** 접두어마다 서로 다른 값을 MAX_DISTINCT개까지만 따로 센다 */
  private capped(prefix: string, value: string): string {
    const key = prefix + value;
    if (this.state.counts.has(key) || this.state.sets.has(key)) return key;
    let distinct = 0;
    for (const k of this.state.counts.keys()) if (k.startsWith(prefix)) distinct += 1;
    for (const k of this.state.sets.keys()) if (k.startsWith(prefix)) distinct += 1;
    return distinct < MAX_DISTINCT ? key : prefix + OTHER;
  }

  private touchUser(user: string, now: number, app: boolean): void {
    const today = dayNumber(now);
    let e = this.users.get(user);
    if (!e) {
      e = [today, today, 1, 0];
      this.users.set(user, e);
      this.addSet('new', user);
    } else if (e[1] < today) {
      const since = today - e[0];
      if (since >= 1) {
        if (since <= 1) e[3] |= U_D1;
        if (since <= 7) e[3] |= U_D7;
        if (since <= 30) e[3] |= U_D30;
      }
      e[1] = today;
      e[2] += 1;
    }
    if (app) e[3] |= U_APP;
    this.addSet('visitors', user);
    this.usersDirty = true;
  }

  private touchRoom(room: string, now: number, opened = true): RoomEntry {
    const today = dayNumber(now);
    let e = this.rooms.get(room);
    if (!e) {
      e = [today, today, 0];
      this.rooms.set(room, e);
    } else if (opened && e[1] < today) {
      if (today - e[0] === 1) e[2] |= R_NEXT_DAY;
      e[1] = today;
    }
    this.roomsDirty = true;
    return e;
  }

  private markRelRoom(room: string, now: number): void {
    this.rollover(now);
    this.addSet('r:rel', room);
    const entry = this.touchRoom(room, now, false);
    if (!(entry[2] & R_REL)) {
      entry[2] |= R_REL;
      this.totals.relRooms += 1;
      this.usersDirty = true;
    }
  }

  private hmac(kind: string, value: string): string {
    return createHmac('sha256', this.salt).update(`${kind}:${value}`).digest('base64url').slice(0, 16);
  }

  private hashUser(anonId: string): string {
    let h = this.userHashes.get(anonId);
    if (!h) {
      if (this.userHashes.size >= HASH_CACHE) this.userHashes.clear();
      h = this.hmac('u', anonId);
      this.userHashes.set(anonId, h);
    }
    return h;
  }

  private hashRoom(roomId: string): string {
    let h = this.roomHashes.get(roomId);
    if (!h) {
      if (this.roomHashes.size >= HASH_CACHE) this.roomHashes.clear();
      h = this.hmac('r', roomId);
      this.roomHashes.set(roomId, h);
    }
    return h;
  }

  // ───────────────────────── 파일 ─────────────────────────

  /** 바뀐 파일을 쓴다. 한 번에 하나씩 차례로 */
  flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      try {
        if (this.dailyDirty) {
          this.dailyDirty = false;
          await this.writeAtomic('daily.jsonl', this.rows.map((r) => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : ''));
        }
        const s = this.state;
        const sets: Record<string, string[]> = {};
        for (const [k, v] of s.sets) sets[k] = Array.from(v);
        await this.writeAtomic(
          'today.json',
          JSON.stringify({ v: 1, day: s.day, label: dayLabel(s.day), sets, counts: Object.fromEntries(s.counts), peak: s.peak, durSum: s.durSum, durN: s.durN, durSample: s.durSample }),
        );
        if (this.usersDirty) {
          this.usersDirty = false;
          await this.writeAtomic('users.json', JSON.stringify({ v: 1, totals: this.totals, users: Object.fromEntries(this.users) }));
        }
        if (this.roomsDirty) {
          this.roomsDirty = false;
          await this.writeAtomic('rooms.json', JSON.stringify({ v: 1, rooms: Object.fromEntries(this.rooms) }));
        }
      } catch (err) {
        this.dailyDirty = this.usersDirty = this.roomsDirty = true;
        this.log(`stats: write failed: ${(err as Error).message}`);
      }
    });
    return this.writing;
  }

  private async writeAtomic(name: string, text: string): Promise<void> {
    const file = path.join(this.dir, name);
    const tmp = `${file}.${process.pid}.${++this.seq}.tmp`;
    try {
      await fs.writeFile(tmp, text, { mode: 0o600 });
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  private async readText(name: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dir, name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** 읽지 못하는 파일은 옆으로 치워 두고(덮어쓰지 않게) 없는 것으로 본다 */
  private async readJson(name: string): Promise<unknown> {
    const text = await this.readText(name);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      const aside = path.join(this.dir, `${name}.broken-${Date.now()}`);
      await fs.rename(path.join(this.dir, name), aside).catch(() => {});
      this.log(`stats: ${name} was unreadable, moved to ${path.basename(aside)}`);
      return null;
    }
  }

  private async loadSalt(): Promise<string> {
    const file = path.join(this.dir, 'salt');
    try {
      const salt = (await fs.readFile(file, 'utf8')).trim();
      if (salt.length >= 32) return salt;
    } catch {
      // 아래에서 만든다
    }
    const salt = randomBytes(32).toString('hex');
    await fs.writeFile(file, `${salt}\n`, { mode: 0o600 });
    this.log('stats: created a new hashing salt (set STATS_SALT to manage it yourself)');
    return salt;
  }
}

function emptyRow(day: string): DailyRow {
  return { day, u: {}, c: {}, peak: 0, sess: { n: 0, avg: 0, med: 0 }, wau: 0, mau: 0 };
}

/** 같은 날이 두 번 있으면 뒤의 것을 남기고 날짜순으로 */
function dedupeRows(rows: DailyRow[]): DailyRow[] {
  const by = new Map<string, DailyRow>();
  for (const r of rows) by.set(r.day, r);
  return Array.from(by.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
