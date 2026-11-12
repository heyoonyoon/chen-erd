import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { SYNTAX_TEXT } from '../cli/syntax';
import { applyModel, parseModel } from '../shared/model';
import { columnKey } from '../shared/relational/settings';
import type { ColumnSettings } from '../shared/relational/userSchema';
import { validateDiagram } from '../shared/rules';
import { ToolError, resolveRoom, type DiagramBackend, type WriteResult } from './backend';
import { DESCRIPTIONS, SUMMARY_EXAMPLE, SYNTAX_SUMMARY, TOOL_NAMES } from './descriptions';
import { buildMcpServer } from './server';
import { MAX_TEXT_BYTES, createDiagramTools, type ToolResult } from './tools';

const ORIGIN = 'https://modelll.app';

const STUDENTS = `title "수강신청"
entity 학생 { 학번 key, 이름 }
entity 과목 { 과목코드 key }
relationship 수강 (학생 M, 과목 N)
`;

/** 방을 메모리에 두는 백엔드. 받은 호출을 calls에 적어 둔다 */
function fakeBackend(rooms: Record<string, string> = {}, relational: Record<string, { text: string; settings?: ColumnSettings }> = {}) {
  const calls: Array<{ op: string; room?: string; text?: string; relayout?: boolean }> = [];
  let created = 0;

  function write(roomId: string, text: string): WriteResult {
    const before = rooms[roomId];
    rooms[roomId] = text;
    const drawn = applyModel(parseModel(text), [], [], '');
    const added = before === undefined ? drawn.nodes.length + drawn.edges.length : 0;
    return { url: `${ORIGIN}/r/${roomId}`, summary: { added, updated: before !== undefined && before !== text ? 1 : 0, removed: 0 }, warnings: drawn.warnings, issues: validateDiagram(drawn.nodes, drawn.edges) };
  }

  const backend: DiagramBackend = {
    async create(text) {
      calls.push({ op: 'create', text });
      created += 1;
      return write(`new${created}`, text);
    },
    async read(room) {
      calls.push({ op: 'read', room });
      const roomId = resolveRoom(room, ORIGIN);
      if (!(roomId in rooms)) throw new ToolError(`room "${roomId}" does not exist on ${ORIGIN}`);
      return { url: `${ORIGIN}/r/${roomId}`, text: rooms[roomId] };
    },
    async update(room, text, { relayout }) {
      calls.push({ op: 'update', room, text, relayout });
      const roomId = resolveRoom(room, ORIGIN);
      if (!(roomId in rooms)) throw new ToolError(`room "${roomId}" does not exist on ${ORIGIN}`);
      return write(roomId, text);
    },
    async relational(room) {
      calls.push({ op: 'relational', room });
      const roomId = resolveRoom(room, ORIGIN);
      if (!(roomId in rooms)) throw new ToolError(`room "${roomId}" does not exist on ${ORIGIN}`);
      const model = parseModel(rooms[roomId]);
      return { url: `${ORIGIN}/r/${roomId}`, title: model.title ?? '', text: relational[roomId]?.text ?? '', settings: relational[roomId]?.settings ?? {} };
    },
  };
  return { backend, rooms, calls };
}

function textOf(result: ToolResult): string {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return result.content[0].text;
}

describe('MCP 도구', () => {
  it('create_diagram은 방 주소와 바뀐 수, 검증 결과를 돌려준다', async () => {
    const { backend, rooms, calls } = fakeBackend();
    const tools = createDiagramTools(backend);

    const result = await tools.create({ text: STUDENTS });
    expect(result.isError).toBeUndefined();
    const lines = textOf(result).split('\n');
    expect(lines[0]).toMatch(/^Created https:\/\/modelll\.app\/r\/new1 \(\+\d+ added\)$/);
    expect(lines.slice(1)).toEqual(['no issues']);
    expect(rooms.new1).toBe(STUDENTS);
    expect(calls).toEqual([{ op: 'create', text: STUDENTS }]);
  });

  it('검증 결과는 영어로 error:, warning: 줄이 되고 그래도 실패로 치지 않는다', async () => {
    const { backend } = fakeBackend();
    const tools = createDiagramTools(backend);

    const result = await tools.create({ text: 'entity A { x }\nweak entity B { y }\nrelationship r (A, B)\n' });
    expect(result.isError).toBeUndefined();
    const lines = textOf(result).split('\n');
    expect(lines[0]).toMatch(/^Created /);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(1)) expect(line).toMatch(/^(error|warning): [A-Z]/);
    expect(lines.some((line) => line.startsWith('error: Weak entity'))).toBe(true);
    expect(lines.some((line) => line.startsWith('warning: Entity'))).toBe(true);
  });

  it('create_diagram의 title은 글의 제목을 바꿔서 보낸다', async () => {
    const { backend, rooms } = fakeBackend();
    const tools = createDiagramTools(backend);

    await tools.create({ text: STUDENTS, title: '학사 "2026"' });
    const model = parseModel(rooms.new1);
    expect(model.title).toBe('학사 "2026"');
    expect(model.entities.map((e) => e.name)).toEqual(['학생', '과목']);

    // 제목이 없는 글에도 넣는다
    await tools.create({ text: 'entity A { id key }', title: 'T' });
    expect(parseModel(rooms.new2).title).toBe('T');
  });

  it('문법 오류는 줄:칸: 메시지로 시작하는 실패 결과이고 백엔드를 부르지 않는다', async () => {
    const { backend, calls } = fakeBackend({ abc: STUDENTS });
    const tools = createDiagramTools(backend);
    const bad = 'entity A { x key foo }\n';

    for (const result of [await tools.create({ text: bad }), await tools.update({ room: 'abc', text: bad }), await tools.validate({ text: bad })]) {
      expect(result.isError).toBe(true);
      const [first, second] = textOf(result).split('\n');
      expect(first).toMatch(/^1:18: unknown attribute modifier "foo"/);
      expect(second).toContain('nothing was saved');
      expect(second).toContain(TOOL_NAMES.syntax);
    }
    expect(calls).toEqual([]);
  });

  it('read_diagram은 방의 글을 그대로 주고, 빈 방은 주석 한 줄로 알린다', async () => {
    const { backend } = fakeBackend({ abc: STUDENTS, empty: '' });
    const tools = createDiagramTools(backend);

    const byId = await tools.read({ room: 'abc' });
    expect(byId.isError).toBeUndefined();
    expect(textOf(byId)).toBe(STUDENTS.trimEnd());
    expect(textOf(await tools.read({ room: 'https://modelll.app/r/abc' }))).toBe(STUDENTS.trimEnd());

    const empty = textOf(await tools.read({ room: 'empty' }));
    expect(empty).toBe('# https://modelll.app/r/empty is an empty diagram');
    // 그대로 다시 보내도 읽힌다
    expect(parseModel(empty).entities).toEqual([]);
  });

  it('없는 방, 잘못된 방 인자, 다른 서버의 주소는 실패 결과다', async () => {
    const { backend, rooms } = fakeBackend({ abc: STUDENTS });
    const tools = createDiagramTools(backend);

    const missing = await tools.read({ room: 'nobody' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe('room "nobody" does not exist on https://modelll.app');

    const invalid = await tools.read({ room: 'bad id!' });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toContain('is not a valid room id');

    const notRoom = await tools.read({ room: 'https://modelll.app/about' });
    expect(notRoom.isError).toBe(true);
    expect(textOf(notRoom)).toContain('is not a room URL');

    const elsewhere = await tools.update({ room: 'https://evil.example/r/abc', text: 'entity X { id key }' });
    expect(elsewhere.isError).toBe(true);
    expect(textOf(elsewhere)).toBe('"https://evil.example/r/abc" is on a different server; this MCP server only works with diagrams on https://modelll.app');
    expect(rooms.abc).toBe(STUDENTS);

    const updateMissing = await tools.update({ room: 'nobody', text: STUDENTS });
    expect(updateMissing.isError).toBe(true);
    expect(rooms.nobody).toBeUndefined();
  });

  it('방 주소는 스킴이 달라도 같은 호스트면 받는다', () => {
    expect(resolveRoom('http://modelll.app/r/abc', ORIGIN)).toBe('abc');
    expect(resolveRoom('modelll.app/r/abc/', ORIGIN)).toBe('abc');
    expect(resolveRoom('  abc  ', ORIGIN)).toBe('abc');
    expect(() => resolveRoom('https://modelll.app:8443/r/abc', ORIGIN)).toThrow(ToolError);
    expect(() => resolveRoom('https://www.modelll.app/r/abc', ORIGIN)).toThrow(/different server/);
  });

  it('update_diagram은 전체 글을 보내고 relayout을 넘긴다', async () => {
    const { backend, rooms, calls } = fakeBackend({ abc: STUDENTS });
    const tools = createDiagramTools(backend);
    const next = `${STUDENTS}entity 교수 { 사번 key }\n`;

    const result = await tools.update({ room: 'https://modelll.app/r/abc', text: next });
    expect(result.isError).toBeUndefined();
    expect(textOf(result).split('\n')).toEqual([
      'Updated https://modelll.app/r/abc (~1 changed)',
      'warning: Entity “교수” isn’t connected to any relationship or specialization.',
    ]);
    expect(rooms.abc).toBe(next);

    const same = await tools.update({ room: 'abc', text: next, relayout: true });
    expect(textOf(same).split('\n')[0]).toBe('Updated https://modelll.app/r/abc (no changes)');
    expect(calls.map((c) => c.relayout)).toEqual([false, true]);
  });

  it('맨 앞의 BOM은 떼고 보낸다', async () => {
    const { backend, rooms } = fakeBackend({ abc: '' });
    const tools = createDiagramTools(backend);
    expect((await tools.update({ room: 'abc', text: `\uFEFF${STUDENTS}` })).isError).toBeUndefined();
    expect(rooms.abc).toBe(STUDENTS);
  });

  it('validate_diagram은 저장하지 않고 검사만 한다', async () => {
    const { backend, calls } = fakeBackend();
    const tools = createDiagramTools(backend);

    expect(textOf(await tools.validate({ text: STUDENTS }))).toBe('no issues');
    const found = await tools.validate({ text: 'entity A { x }' });
    expect(found.isError).toBeUndefined();
    expect(textOf(found).split('\n')).toEqual([
      'warning: Entity “A” has no key attribute.',
      'warning: Entity “A” isn’t connected to any relationship or specialization.',
    ]);
    expect(calls).toEqual([]);
  });

  it('diagram_syntax는 CLI의 형식 안내를 그대로 준다', async () => {
    const tools = createDiagramTools(fakeBackend().backend);
    expect(textOf(await tools.syntax())).toBe(SYNTAX_TEXT.trimEnd());
  });

  it('diagram_to_sql은 사람이 적은 관계 모델 글과 그 글에서 만든 CREATE TABLE 문을 함께 준다', async () => {
    const text = '학생(_학번_, 이름)\n수강(_학번_, 성적)\nForeign Key (학번) references 학생\n';
    const { backend } = fakeBackend({ abc: STUDENTS }, { abc: { text, settings: { [columnKey('학생', '학번')]: { type: 'CHAR(8)' }, [columnKey('학생', '이름')]: { type: 'VARCHAR(20)' } } } });
    const tools = createDiagramTools(backend);
    const pg = textOf(await tools.sql({ room: `${ORIGIN}/r/abc` }));
    expect(pg).toContain(`Relational model written in https://modelll.app/r/abc (_x_ = underlined primary-key column; Foreign Key lines belong to the table above):\n${text.trimEnd()}\n`);
    expect(pg).toContain('Columns without a type (1); the SQL marks each with a placeholder');
    expect(pg).toContain('  수강.성적');
    expect(pg).toContain('SQL (postgresql):\n-- 수강신청 (PostgreSQL)');
    expect(pg).toContain('CREATE TABLE "수강" (\n  "학번" CHAR(8) NOT NULL,\n  "성적" /* 타입 미지정 */,');
    expect(pg).toContain('CONSTRAINT "수강_fk1" FOREIGN KEY ("학번") REFERENCES "학생" ("학번")');
    expect(pg).not.toContain('Problems');
    expect(textOf(await tools.sql({ room: 'abc', dialect: 'mysql' }))).toContain('CREATE TABLE `학생`');
    const missing = await tools.sql({ room: 'nobody' });
    expect(missing.isError).toBe(true);
  });

  it('diagram_to_sql은 글의 문제를 줄과 칸으로 알린다', async () => {
    const { backend } = fakeBackend({ abc: STUDENTS }, { abc: { text: '학생(_학번_, 학과코드)\nForeign Key (학과코드) references 학과\n로그(시각)' } });
    const result = textOf(await createDiagramTools(backend).sql({ room: 'abc' }));
    expect(result).toContain('Problems in that text (line:column):\nerror: 2:31: The foreign key points to “학과”, but there is no such table.\nwarning: 3:1: “로그” has no primary key. Underline the names of the primary-key columns.');
    expect(result).toContain('-- 관계 모델 글에 오류가 1개 있어 읽은 부분만 옮겼습니다.');
  });

  it('diagram_to_sql은 관계 모델 글이 없으면 다이어그램에서 만들지 않고 그렇다고 알린다', async () => {
    for (const text of [undefined, '', '  \n# 아직 비어 있음\n']) {
      const { backend } = fakeBackend({ abc: STUDENTS }, text === undefined ? {} : { abc: { text } });
      const result = await createDiagramTools(backend).sql({ room: 'abc' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        "https://modelll.app/r/abc has no relational model yet, so there is nothing to convert. People write the relational model themselves in the app's relational model pane; this tool does not derive tables from the ER diagram.",
      );
    }
  });

  it('256 KB가 넘는 글은 받지 않는다', async () => {
    const { backend, calls } = fakeBackend();
    const tools = createDiagramTools(backend);
    const huge = `note "${'가'.repeat(Math.ceil(MAX_TEXT_BYTES / 3))}"`;
    const result = await tools.create({ text: huge });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('the model text is too large (the limit is 256 KB)');
    expect(calls).toEqual([]);
  });

  it('요청 제한에 걸리면 언제 다시 부를지 알리고 아무것도 하지 않는다', async () => {
    const { backend, calls } = fakeBackend({ abc: STUDENTS });
    let wait = 17;
    const tools = createDiagramTools(backend, { limited: () => wait });

    for (const result of [
      await tools.create({ text: STUDENTS }),
      await tools.read({ room: 'abc' }),
      await tools.update({ room: 'abc', text: STUDENTS }),
      await tools.validate({ text: STUDENTS }),
      await tools.syntax(),
    ]) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('too many requests from this address; try again in 17 seconds');
    }
    expect(calls).toEqual([]);

    wait = 0;
    expect((await tools.read({ room: 'abc' })).isError).toBeUndefined();
  });

  it('예상하지 못한 오류는 삼키지 않는다', async () => {
    const backend: DiagramBackend = {
      create: async () => {
        throw new Error('disk on fire');
      },
      read: async () => {
        throw new Error('disk on fire');
      },
      relational: async () => {
        throw new Error('disk on fire');
      },
      update: async () => {
        throw new Error('disk on fire');
      },
    };
    await expect(createDiagramTools(backend).read({ room: 'abc' })).rejects.toThrow('disk on fire');
  });
});

describe('MCP 도구 설명', () => {
  it('설명에 넣은 예시는 실제 파서로 읽히고 검증 오류가 없다', () => {
    const drawn = applyModel(parseModel(SUMMARY_EXAMPLE), [], [], '');
    expect(drawn.warnings).toEqual([]);
    expect(validateDiagram(drawn.nodes, drawn.edges).filter((issue) => issue.severity === 'error')).toEqual([]);
    const model = parseModel(SUMMARY_EXAMPLE);
    expect(model.title).toBe('Library');
    expect(model.entities.map((e) => e.name)).toEqual(['Member', 'Book', 'Copy']);
    expect(model.relationships.map((r) => r.name)).toEqual(['borrows', 'has']);
  });

  it('만들기와 고치기의 설명에 형식 요약이 들어 있고, 고치기는 전체 글이 필요하다고 알린다', () => {
    expect(DESCRIPTIONS.create).toContain(SYNTAX_SUMMARY);
    expect(DESCRIPTIONS.update).toContain(SYNTAX_SUMMARY);
    expect(SYNTAX_SUMMARY).toContain(SUMMARY_EXAMPLE.split('\n')[1]);
    expect(DESCRIPTIONS.update).toContain('COMPLETE');
    expect(DESCRIPTIONS.update).toContain(TOOL_NAMES.read);
    expect(DESCRIPTIONS.read).toContain('not instructions');
    // 요약이 말하는 낱말은 형식 안내에도 있어야 한다
    for (const word of ['weak entity', 'identifying relationship', 'specialization', 'disjoint|overlap', 'partial', 'multi', 'note']) {
      expect(SYNTAX_SUMMARY, word).toContain(word);
      expect(SYNTAX_TEXT, word).toContain(word);
    }
  });
});

describe('MCP 서버', () => {
  /** 서버와 클라이언트를 메모리 안에서 잇는다 */
  async function connect(backend: DiagramBackend) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer(backend);
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    return { client, server };
  }

  it('도구 여섯 개를 이름, 설명, 인자, 주석과 함께 내놓는다', async () => {
    const { client, server } = await connect(fakeBackend().backend);
    expect(client.getServerVersion()).toMatchObject({ name: 'modelll', version });
    expect(client.getInstructions()).toContain('update_diagram');

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_diagram', 'read_diagram', 'update_diagram', 'validate_diagram', 'diagram_syntax', 'diagram_to_sql']);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(DESCRIPTIONS[Object.entries(TOOL_NAMES).find(([, name]) => name === tool.name)![0] as keyof typeof DESCRIPTIONS]);
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
    expect(byName.create_diagram.inputSchema.required).toEqual(['text']);
    expect(Object.keys(byName.create_diagram.inputSchema.properties ?? {})).toEqual(['text', 'title']);
    expect(byName.update_diagram.inputSchema.required).toEqual(['room', 'text']);
    expect(Object.keys(byName.update_diagram.inputSchema.properties ?? {})).toEqual(['room', 'text', 'relayout']);
    expect(byName.read_diagram.inputSchema.required).toEqual(['room']);

    // 읽기만 하는 도구와 지울 수 있는 도구를 클라이언트가 구분할 수 있어야 한다
    expect(byName.read_diagram.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.validate_diagram.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.diagram_syntax.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.create_diagram.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.update_diagram.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(byName.diagram_to_sql.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.diagram_to_sql.inputSchema.required).toEqual(['room']);
    expect(Object.keys(byName.diagram_to_sql.inputSchema.properties ?? {})).toEqual(['room', 'dialect']);

    await client.close();
    await server.close();
  });

  it('도구를 부르면 글로 된 결과가 오고, 인자가 틀리면 실패 결과가 온다', async () => {
    const { backend, rooms } = fakeBackend();
    const { client, server } = await connect(backend);

    const created = await client.callTool({ name: 'create_diagram', arguments: { text: STUDENTS } });
    expect(created.isError).toBeFalsy();
    expect(created.content).toEqual([{ type: 'text', text: expect.stringMatching(/^Created https:\/\/modelll\.app\/r\/new1 /) }]);
    expect(rooms.new1).toBe(STUDENTS);

    const syntax = await client.callTool({ name: 'create_diagram', arguments: { text: 'entity {' } });
    expect(syntax.isError).toBe(true);
    expect((syntax.content as Array<{ text: string }>)[0].text).toMatch(/^1:8: /);

    const missingArg = await client.callTool({ name: 'update_diagram', arguments: { room: 'new1' } });
    expect(missingArg.isError).toBe(true);
    expect(rooms.new1).toBe(STUDENTS);

    const reference = await client.callTool({ name: 'diagram_syntax', arguments: {} });
    expect((reference.content as Array<{ text: string }>)[0].text).toContain('STATEMENTS');

    await client.close();
    await server.close();
  });
});
