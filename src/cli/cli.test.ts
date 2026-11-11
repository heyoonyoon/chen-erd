import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { createErdServer, type ErdServer, type ErdServerOptions } from '../server/server';
import { applyModel, parseModel } from '../shared/model';
import type { Model, ModelAttribute } from '../shared/model/types';
import { validateDiagram } from '../shared/rules';
import { ROOM_ID_PATTERN } from '../shared/types';
import type { CliIo } from './commands';
import { runCli } from './run';
import { SYNTAX_EXAMPLE, SYNTAX_TEXT } from './syntax';

const MODEL = `title "수강신청"
entity 학생 { 학번 key, 이름 }
entity 과목 { 과목코드 key }
`;

/** 엔티티와 속성을 이름순으로 맞춘 모델. 방에서 다시 읽은 글은 적은 순서와 다를 수 있다 */
function canonical(text: string): Model {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const sortAttributes = (attributes: ModelAttribute[]): ModelAttribute[] =>
    attributes.map((a) => (a.parts ? { ...a, parts: sortAttributes(a.parts) } : a)).sort(byName);
  const model = parseModel(text);
  return {
    ...model,
    entities: model.entities.map((e) => ({ ...e, attributes: sortAttributes(e.attributes) })).sort(byName),
    relationships: model.relationships.map((r) => ({ ...r, attributes: sortAttributes(r.attributes) })).sort(byName),
    notes: [...model.notes].sort(),
  };
}

/** 파일과 표준 입출력을 메모리에 둔 실행 환경 */
function fakeIo(files: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    async readText(file) {
      if (!(file in files)) throw new Error(`cannot open ${file}: no such file`);
      return files[file];
    },
    async writeText(file, text) {
      files[file] = text;
    },
    fetch: (url, init) => fetch(url, init),
  };
  return { io, out, err, files };
}

describe('modelll CLI', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let origin = '';

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    origin = `http://127.0.0.1:${(await server.start()).port}`;
  }

  /** 명령 하나를 실행하고 종료 코드와 출력을 돌려준다 */
  async function run(argv: string[], files: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
    const ctx = fakeIo(files, { MODELLL_SERVER: origin, ...env });
    const code = await runCli(argv, ctx.io);
    return { code, out: ctx.out, err: ctx.err, files: ctx.files };
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-cli-'));
  });

  afterEach(async () => {
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('new로 방을 만들고 pull, push, pull로 내용을 주고받는다', async () => {
    await boot();

    // new: 방 주소를 알려 준다
    const created = await run(['new', 'model.mdl'], { 'model.mdl': MODEL });
    expect(created.err).toEqual([]);
    expect(created.code).toBe(0);
    const url = created.out[0];
    expect(url.startsWith(`${origin}/r/`)).toBe(true);
    const roomId = url.slice(`${origin}/r/`.length);
    expect(roomId).toMatch(/^[a-z2-9]{10}$/);
    expect(ROOM_ID_PATTERN.test(roomId)).toBe(true);

    // pull: 주소 전체로도, id만으로도 받는다
    const pulled = await run(['pull', url], {}, { MODELLL_SERVER: 'http://127.0.0.1:1' });
    expect(pulled.code).toBe(0);
    expect(pulled.out).toHaveLength(1);
    expect(canonical(pulled.out[0])).toEqual(canonical(MODEL));
    const saved = await run(['pull', roomId, '-o', 'out.mdl']);
    expect(saved.code).toBe(0);
    expect(saved.out).toEqual([]);
    expect(saved.files['out.mdl']).toBe(`${pulled.out[0]}\n`);

    // push: 받은 글을 고쳐서 올린다
    const edited = `${saved.files['out.mdl']}entity 교수 { 사번 key }\n`;
    const pushed = await run(['push', roomId, 'out.mdl'], { 'out.mdl': edited });
    expect(pushed.err).toEqual([]);
    expect(pushed.code).toBe(0);
    expect(pushed.out[0]).toMatch(/^\+\d+ added$/);
    expect(pushed.out[1]).toBe(url);
    for (const line of pushed.out.slice(2)) expect(line).toMatch(/^(error|warning): /);

    const again = await run(['push', url, '-'], { '-': edited });
    expect(again.out.slice(0, 2)).toEqual(['no changes', url]);

    // pull: 고친 내용이 들어 있다
    const final = await run(['pull', roomId]);
    expect(canonical(final.out[0])).toEqual(canonical(edited));
    expect(parseModel(final.out[0]).entities.map((e) => e.name).sort()).toEqual(['과목', '교수', '학생']);
  });

  it('new는 파일 없이도 방을 만들고 --title로 제목을 넣는다', async () => {
    await boot();
    const empty = await run(['new']);
    expect(empty.code).toBe(0);
    expect(empty.out).toHaveLength(1);
    const pulledEmpty = await run(['pull', empty.out[0]]);
    expect(pulledEmpty.code).toBe(0);
    expect(canonical(pulledEmpty.out[0])).toEqual(canonical(''));

    const titled = await run(['new', '--title', '빈 "모델"']);
    expect(parseModel((await run(['pull', titled.out[0]])).out[0]).title).toBe('빈 "모델"');

    // 파일에 제목이 있어도 --title이 이긴다
    const overridden = await run(['new', '-', '--title', '학사'], { '-': MODEL });
    const model = canonical((await run(['pull', overridden.out[0]])).out[0]);
    expect(model.title).toBe('학사');
    expect(model.entities).toEqual(canonical(MODEL).entities);
  });

  it('--json은 서버의 응답에 방 주소를 붙여 낸다', async () => {
    await boot();
    const created = await run(['new', 'model.mdl', '--json'], { 'model.mdl': MODEL });
    expect(created.code).toBe(0);
    const result = JSON.parse(created.out.join('\n'));
    expect(result).toMatchObject({ ok: true, created: true, warnings: [] });
    expect(result.url).toBe(`${origin}/r/${result.room}`);
    expect(result.summary.added).toBeGreaterThan(0);
    for (const issue of result.issues) expect(typeof issue.text).toBe('string');

    const pushed = await run(['push', result.room, 'model.mdl', '--json', '--relayout'], { 'model.mdl': MODEL });
    expect(JSON.parse(pushed.out.join('\n'))).toMatchObject({ ok: true, created: false, room: result.room, url: result.url });
  });

  it('문법이 틀린 파일은 보내지 않고 파일:줄:칸으로 알린다', async () => {
    await boot();
    const made = await run(['new', 'model.mdl'], { 'model.mdl': MODEL });
    const url = made.out[0];
    const before = (await run(['pull', url])).out[0];

    const bad = 'entity 학생 { 학번 key }\n  ??? 무엇\n';
    const pushed = await run(['push', url, 'bad.mdl'], { 'bad.mdl': bad });
    expect(pushed.code).toBe(1);
    expect(pushed.out).toEqual([]);
    expect(pushed.err).toHaveLength(1);
    expect(pushed.err[0]).toMatch(/^bad\.mdl:2:3: \S/);
    expect((await run(['pull', url])).out[0]).toBe(before);

    const fromStdin = await run(['new', '-'], { '-': bad });
    expect(fromStdin.code).toBe(1);
    expect(fromStdin.err[0]).toMatch(/^<stdin>:2:3: /);
    expect((await (await fetch(`${origin}/api/health`)).json()).rooms).toBeLessThanOrEqual(1);

    const checked = await run(['validate', 'bad.mdl', '--json'], { 'bad.mdl': bad });
    expect(checked.code).toBe(1);
    expect(JSON.parse(checked.out.join('\n'))).toMatchObject({ ok: false, error: 'syntax', line: 2, column: 3 });
  });

  it('validate는 서버 없이 검사하고, 오류가 있으면 1로 끝난다', async () => {
    // 서버를 띄우지 않는다
    const env = { MODELLL_SERVER: 'http://127.0.0.1:1' };

    // 키가 없는 엔티티는 경고일 뿐이다
    const warned = await run(['validate', 'a.mdl'], { 'a.mdl': 'entity 학생 { 이름 }\nentity 과목 { 과목코드 key }\nrelationship 수강 (학생 M, 과목 N)\n' }, env);
    expect(warned.code).toBe(0);
    expect(warned.out).toContain('warning: Entity “학생” has no key attribute.');
    expect(warned.out.every((line) => line.startsWith('warning: '))).toBe(true);

    // 엔티티 하나에만 이어진 관계는 오류다
    const text = 'entity 학생 { 학번 key }\nrelationship 수강 (학생 M)\n';
    const failed = await run(['validate', 'a.mdl'], { 'a.mdl': text }, env);
    expect(failed.code).toBe(1);
    expect(failed.out.some((line) => line.startsWith('error: Relationship “수강” must be connected'))).toBe(true);

    // 언어는 --lang, MODELLL_LANG, LANG 순으로 고른다
    const korean = await run(['validate', 'a.mdl', '--lang', 'ko'], { 'a.mdl': text }, env);
    expect(korean.out.some((line) => line.startsWith("error: '수강' 관계는 엔티티와 선 2개 이상으로"))).toBe(true);
    const byEnv = await run(['validate', 'a.mdl'], { 'a.mdl': text }, { ...env, LANG: 'ko_KR.UTF-8' });
    expect(byEnv.out).toEqual(korean.out);

    const json = await run(['validate', 'a.mdl', '--json'], { 'a.mdl': text }, env);
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.out.join('\n'));
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((issue: { severity: string; text: string }) => issue.severity === 'error' && issue.text.startsWith('Relationship'))).toBe(true);

    const clean = await run(['validate', 'a.mdl'], { 'a.mdl': SYNTAX_EXAMPLE }, env);
    expect(clean.out).toEqual(['no issues']);
    expect(clean.code).toBe(0);
  });

  it('서버와 네트워크의 실패를 한 줄로 알리고 0이 아닌 코드로 끝난다', async () => {
    await boot({ roomCreateIntervalMs: 60_000, apiRequestsPerMinute: 4 });

    const missing = await run(['pull', 'nobody']);
    expect(missing.code).toBe(1);
    expect(missing.out).toEqual([]);
    expect(missing.err).toEqual([`error: room "nobody" does not exist on ${origin}`]);

    expect((await run(['new', 'model.mdl'], { 'model.mdl': MODEL })).code).toBe(0);
    const limited = await run(['new', 'model.mdl'], { 'model.mdl': MODEL });
    expect(limited.code).toBe(1);
    expect(limited.err).toEqual(['error: this address can create one new room per minute; try again shortly']);

    expect((await run(['pull', 'nobody'])).code).toBe(1);
    const throttled = await run(['pull', 'nobody']);
    expect(throttled.code).toBe(1);
    expect(throttled.err).toHaveLength(1);
    expect(throttled.err[0]).toMatch(/^error: too many requests from this address; try again in \d+ seconds?$/);

    const unreachable = await run(['pull', 'abc123'], {}, { MODELLL_SERVER: 'http://127.0.0.1:1' });
    expect(unreachable.code).toBe(1);
    expect(unreachable.err).toHaveLength(1);
    expect(unreachable.err[0]).toMatch(/^error: cannot reach http:\/\/127\.0\.0\.1:1 \(.+\)$/);

    const noFile = await run(['push', 'abc123', 'missing.mdl']);
    expect(noFile.code).toBe(1);
    expect(noFile.err).toEqual(['error: cannot open missing.mdl: no such file']);
  });

  it('잘못 적은 명령은 2로 끝난다', async () => {
    for (const argv of [['pulll'], ['pull'], ['push', 'abc123'], ['pull', 'not a room'], ['pull', 'abc123', '--server', 'ftp://x']]) {
      const result = await run(argv);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.err, argv.join(' ')).toHaveLength(1);
      expect(result.err[0], argv.join(' ')).toMatch(/^error: /);
    }
  });

  it('help와 --version', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const help = await run(argv);
      expect(help.code).toBe(0);
      const text = help.out.join('\n');
      for (const word of ['modelll new', 'modelll pull', 'modelll push', 'modelll validate', 'modelll syntax', '--server', '--json', '--lang', 'MODELLL_SERVER']) {
        expect(text, word).toContain(word);
      }
    }
    expect((await run(['--version'])).out).toEqual([`modelll ${version}`]);
  });

  it('syntax가 보여 주는 예시는 실제 파서로 읽히고 검증 오류가 없다', async () => {
    const shown = await run(['syntax']);
    expect(shown.code).toBe(0);
    expect(shown.out.join('\n')).toBe(SYNTAX_TEXT.trimEnd());
    for (const line of SYNTAX_EXAMPLE.trimEnd().split('\n')) expect(SYNTAX_TEXT).toContain(line);

    const model = parseModel(SYNTAX_EXAMPLE);
    expect(model.title).toBe('Company');
    expect(model.entities.map((e) => e.name)).toEqual(['Employee', 'Department', 'Secretary', 'Engineer', 'Dependent']);
    expect(model.entities[0].attributes).toEqual([
      { name: 'id', key: 'key' },
      { name: 'name', parts: [{ name: 'first' }, { name: 'last' }] },
      { name: 'phone', multivalued: true },
    ]);
    expect(model.entities[4]).toEqual({ name: 'Dependent', weak: true, attributes: [{ name: 'name', key: 'partial' }] });
    expect(model.relationships.map((r) => r.name)).toEqual(['works_in', 'manages', 'has']);
    expect(model.relationships[0].participants).toEqual([
      { entity: 'Employee', cardinality: 'N', total: true },
      { entity: 'Department', cardinality: '1' },
    ]);
    expect(model.relationships[1].participants).toEqual([
      { entity: 'Employee', cardinality: '1', role: 'boss' },
      { entity: 'Employee', cardinality: 'N', role: 'report' },
    ]);
    expect(model.relationships[2].identifying).toBe(true);
    expect(model.specializations).toEqual([{ parent: 'Employee', kind: 'd', total: true, children: ['Secretary', 'Engineer'] }]);
    expect(model.notes).toEqual(['Draft']);

    const drawn = applyModel(model, [], [], '');
    expect(drawn.warnings).toEqual([]);
    expect(validateDiagram(drawn.nodes, drawn.edges).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
