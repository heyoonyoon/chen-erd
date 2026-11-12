import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { columnKey } from '../shared/relational/settings';
import { fromMarkup, toMarkup } from '../shared/relational/markup';
import { UNDERLINE_ATTR } from '../shared/relational/userSchema';
import { getRelationalText, readColumnSettings, readRelationalSource, setColumnSetting, setRelationalSource } from '../shared/relational/ydoc';
import { getNodes } from '../shared/ydoc';
import { createErdServer, type ErdServer, type ErdServerOptions } from './server';

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const MODEL = `title "수강신청"
entity 학과 { 학과코드 key, 학과명 }
entity 학생 { 학번 key, 이름 }
relationship 소속 (학생 N total, 학과 1)
`;

/** API가 주고받는 일반 텍스트 교환 표기(_이름_ = 밑줄) */
const REL = '학과(_학과코드_, 학과명)\n학생(_학번_, 이름, 학과코드)\nForeign Key (학과코드) references 학과\n';

describe('관계 모델 API', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  const providers: WebsocketProvider[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    port = (await server.start()).port;
  }

  const api = (urlPath: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${urlPath}`, init);
  const put = (roomId: string, text: string) =>
    api(`/api/rooms/${roomId}/model`, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
  const putRel = (roomId: string, body: string, contentType = 'text/plain; charset=utf-8') =>
    api(`/api/rooms/${roomId}/relational`, { method: 'PUT', headers: { 'Content-Type': contentType }, body });

  /** 방에 붙은 클라이언트 문서 */
  async function join(roomId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    await waitFor(() => provider.synced, '동기화');
    return doc;
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-rel-'));
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

  it('없는 방은 404, 잘못된 방 id는 400, 모르는 방언은 400. 방을 만들지 않는다', async () => {
    await boot();
    for (const p of ['/api/rooms/nobody/relational', '/api/rooms/nobody/sql']) {
      const res = await api(p);
      expect(res.status, p).toBe(404);
      expect(await res.json(), p).toEqual({ ok: false, error: 'not-found' });
      expect(res.headers.get('cache-control'), p).toBe('no-store');
    }
    const putMissing = await putRel('nobody', REL);
    expect(putMissing.status).toBe(404);
    expect(await putMissing.json()).toEqual({ ok: false, error: 'not-found' });
    expect((await api('/api/rooms/bad.id/relational')).status).toBe(400);
    expect((await putRel('bad.id', REL)).status).toBe(400);
    expect((await api('/api/rooms/bad.id/sql')).status).toBe(400);
    const bad = await api('/api/rooms/nobody/sql?dialect=sqlite');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('bad-dialect');
    expect(await fs.readdir(dataDir)).toEqual([]);
  });

  it('관계 모델 글이 없으면 빈 글을 주고, SQL에도 다이어그램에서 만든 테이블이 없다', async () => {
    await boot();
    expect((await put('room-empty', MODEL)).status).toBe(200);
    const text = await api('/api/rooms/room-empty/relational');
    expect(text.status).toBe(200);
    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await text.text()).toBe('');
    const sql = await api('/api/rooms/room-empty/sql');
    expect(sql.status).toBe(200);
    expect(await sql.text()).toBe('-- 수강신청 (PostgreSQL)\n\n-- 관계 모델 글에 테이블이 없습니다.\n');
    expect(sql.headers.get('x-missing-types')).toBe('0');
  });

  it('방에서 함께 고친 글과 컬럼 설정으로 SQL을 만든다. 타입을 정하지 않은 컬럼은 머리 주석과 헤더로 알린다', async () => {
    await boot();
    expect((await put('room-rel', MODEL)).status).toBe(200);
    const doc = await join('room-rel');
    // 화면처럼 밑줄 서식으로 적는다. API는 밑줄을 _이름_ 으로 바꿔 준다
    setRelationalSource(doc, fromMarkup(REL));
    expect(getRelationalText(doc).toString()).not.toContain('_');
    setColumnSetting(doc, '학과', '학과코드', { type: 'CHAR(4)' });
    setColumnSetting(doc, '학생', '학번', { type: 'VARCHAR(20)' });
    setColumnSetting(doc, '학생', '이름', { type: 'VARCHAR(50)', notNull: true });
    await waitFor(async () => (await (await api('/api/rooms/room-rel/relational')).text()) === REL, '글 반영');
    await waitFor(async () => (await (await api('/api/rooms/room-rel/sql')).text()).includes('"이름" VARCHAR(50) NOT NULL'), '설정 반영');

    const pg = await api('/api/rooms/room-rel/sql');
    expect(pg.headers.get('x-missing-types')).toBe('1');
    expect(pg.headers.get('x-relational-errors')).toBe('0');
    const body = await pg.text();
    expect(body.split('\n').slice(0, 3)).toEqual([
      '-- 수강신청 (PostgreSQL)',
      '-- 타입을 정하지 않은 컬럼이 1개 있습니다. 타입을 정하기 전에는 이 SQL이 실행되지 않습니다.',
      '--   학과.학과명',
    ]);
    // 외래키 컬럼은 가리키는 컬럼의 타입을 물려받는다
    expect(body).toContain('  "학과코드" CHAR(4),\n  PRIMARY KEY ("학번"),');
    const mysql = await (await api('/api/rooms/room-rel/sql?dialect=MySQL')).text();
    expect(mysql).toContain('CREATE TABLE `학생`');
    const oracle = await (await api('/api/rooms/room-rel/sql?dialect=oracle')).text();
    expect(oracle).toContain('"학번" VARCHAR2(20 CHAR) NOT NULL');
  });

  it('글에 오류가 있으면 읽은 부분만 옮기고 머리 주석과 헤더로 알린다', async () => {
    await boot();
    expect((await put('room-err', MODEL)).status).toBe(200);
    const doc = await join('room-err');
    doc.transact(() => {
      const ytext = getRelationalText(doc);
      ytext.insert(0, '학생(학번, 학과코드)\nForeign Key (학과코드) references 학과\n');
      ytext.format(3, 2, { [UNDERLINE_ATTR]: true });
    });
    await waitFor(async () => (await api('/api/rooms/room-err/sql')).headers.get('x-relational-errors') === '1', '글 반영');
    const body = await (await api('/api/rooms/room-err/sql')).text();
    expect(body).toContain('-- 관계 모델 글에 오류가 1개 있어 읽은 부분만 옮겼습니다.');
    expect(body).toContain('-- 넣지 않은 외래키: "학생" ("학과코드") REFERENCES "학과". 가리키는 테이블이 없습니다.');
    // 밑줄 친 학번이 기본키다
    expect(body).toContain('PRIMARY KEY ("학번")');
    expect(await (await api('/api/rooms/room-err/relational')).text()).toBe('학생(_학번_, 학과코드)\nForeign Key (학과코드) references 학과\n');
  });

  it('PUT으로 글을 바꾸면 방에 있는 사람에게 바로 보이고, 설정과 다이어그램은 그대로다', async () => {
    await boot();
    expect((await put('room-put', MODEL)).status).toBe(200);
    const doc = await join('room-put');
    setColumnSetting(doc, '학생', '학번', { type: 'CHAR(8)' });

    const res = await putRel('room-put', REL.replace(/\n/g, '\r\n') + '로그(시각)\r\n');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      room: 'room-put',
      changed: true,
      tables: 3,
      problems: [{ severity: 'warning', line: 4, column: 1, message: '“로그” has no primary key. Underline the names of the primary-key columns.' }],
    });
    const expected = `${REL}로그(시각)\n`;
    // 방에는 밑줄 서식으로 들어간다(글자에 _ 가 없다)
    await waitFor(() => toMarkup(readRelationalSource(doc)) === expected, 'PUT 반영');
    expect(readRelationalSource(doc)).toEqual(fromMarkup(expected));
    await waitFor(async () => (await (await api('/api/rooms/room-put/sql')).text()).includes('"학번" CHAR(8) NOT NULL'), '설정 반영');
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', '학번')]: { type: 'CHAR(8)' } });
    expect(getNodes(doc).length).toBeGreaterThan(0);

    // 같은 글은 바뀌지 않는다. JSON 본문도 받는다
    const same = await putRel('room-put', JSON.stringify({ text: expected }), 'application/json');
    expect((await same.json()).changed).toBe(false);
    expect((await putRel('room-put', '{"nope": 1}', 'application/json')).status).toBe(400);

    // 다이어그램을 다시 PUT해도 관계 모델 글과 설정은 남는다
    expect((await put('room-put', MODEL.replace('학과명 }', '학과명, 위치 }'))).status).toBe(200);
    await waitFor(() => getNodes(doc).some((n) => n.text === '위치'), '모델 PUT 반영');
    expect(toMarkup(readRelationalSource(doc))).toBe(expected);
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', '학번')]: { type: 'CHAR(8)' } });
    expect(await (await api('/api/rooms/room-put/sql')).text()).toContain('"학번" CHAR(8) NOT NULL');

    // 밑줄만 바꿔도 바뀐 것이다
    const moved = await putRel('room-put', expected.replace('_학번_, 이름', '학번, _이름_'));
    expect(await moved.json()).toMatchObject({ ok: true, changed: true });
    await waitFor(() => toMarkup(readRelationalSource(doc)).includes('학번, _이름_'), '밑줄 반영');
  });

  it('PUT: 오류가 있는 글은 받지 않고 문제를 모두 돌려준다', async () => {
    await boot();
    expect((await put('room-bad', MODEL)).status).toBe(200);
    const res = await putRel('room-bad', '학생(_학번_, 학과코드)\nForeign Key (학과코드) references 학과\n과목(코드');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'syntax',
      message: 'The foreign key points to “학과”, but there is no such table.',
      line: 2,
      column: 31,
      problems: [
        { severity: 'error', line: 2, column: 31, message: 'The foreign key points to “학과”, but there is no such table.' },
        { severity: 'error', line: 3, column: 3, message: 'An opening parenthesis “(” has no matching “)”.' },
      ],
    });
    // 위치는 받은 글(_이름_ 표기) 기준이다
    const dup = await (await putRel('room-bad', '학생(_학번_, _학번_)')).json();
    expect(dup.problems).toEqual([{ severity: 'error', line: 1, column: 11, message: 'The column “학번” appears twice in “학생”.' }]);
    // 화살표 표기는 받지 않는다
    const arrow = await putRel('room-bad', '학과(_학과코드_)\n학생(_학번_, 학과코드 -> 학과)');
    expect(arrow.status).toBe(400);
    expect((await arrow.json()).problems[0]).toMatchObject({ line: 2, column: 10 });
    expect(await (await api('/api/rooms/room-bad/relational')).text()).toBe('');
  });

  it('PUT도 모델 API와 같은 요청 제한을 받는다', async () => {
    await boot({ apiRequestsPerMinute: 2 });
    expect((await put('room-rate', MODEL)).status).toBe(200);
    expect((await putRel('room-rate', REL)).status).toBe(200);
    const limited = await putRel('room-rate', REL);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});
