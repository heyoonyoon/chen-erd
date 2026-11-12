/**
 * 명령 하나하나의 동작. 파일, 표준 입출력, 네트워크는 CliIo로 받아서 테스트에서 바꿔 끼울 수 있다.
 * 각 함수는 종료 코드를 돌려주고, 사용자에게 한 줄로 알릴 실패는 CliError로 던진다.
 */
import { applyModel, parseModel, printModel } from '../shared/model';
import { parseMarkup } from '../shared/relational/text';
import type { Model } from '../shared/model/types';
import { validateDiagram } from '../shared/rules';
import type { Issue } from '../shared/types';
import { fetchModel, fetchRelational, sendModel, sendRelational, type FetchLike, type PushResult } from './api';
import { COMMANDS, type CliOptions } from './args';
import { CliError } from './errors';
import { formatSummary, formatSyntaxError, issueText, pickLang, problemText, reportLines, type Lang } from './format';
import { newRoomId, parseRoomRef, resolveServer, roomUrl, type RoomRef } from './room';
import { SYNTAX_TEXT } from './syntax';

export interface CliIo {
  env: Record<string, string | undefined>;
  /** 표준 출력에 한 줄(여러 줄이어도 된다)을 쓴다. 끝의 줄바꿈은 붙여 준다 */
  out(text: string): void;
  /** 표준 오류에 한 줄을 쓴다 */
  err(text: string): void;
  /** 파일을 글자로 읽는다. '-'면 표준 입력 */
  readText(file: string): Promise<string>;
  writeText(file: string, text: string): Promise<void>;
  fetch: FetchLike;
  /** 새 방 id를 만든다. 없으면 무작위로 만든다(테스트에서 고정할 때 쓴다) */
  newRoomId?(): string;
}

function isSyntaxError(err: unknown): err is Error & { line: number; column: number } {
  return err instanceof Error && err.name === 'ModelSyntaxError';
}

function printJson(io: CliIo, value: unknown): void {
  io.out(JSON.stringify(value, null, 2));
}

/** JSON으로 낼 때는 검증 결과에 그 언어로 푼 문장(text)을 붙인다 */
function withText(issues: readonly Issue[], lang: Lang): Array<Issue & { text: string }> {
  return issues.map((issue) => ({ ...issue, text: issueText(issue, lang) }));
}

/**
 * 파일을 읽어 모델로 푼다. 문법이 틀렸으면 위치를 알리고 null을 돌려준다(이때 종료 코드는 1이다).
 * 서버에 보내기 전에 여기서 먼저 걸러야 틀린 곳을 바로 알 수 있다.
 */
async function readModel(io: CliIo, file: string, json: boolean): Promise<{ text: string; model: Model } | null> {
  const text = await io.readText(file);
  try {
    return { text, model: parseModel(text) };
  } catch (err) {
    if (!isSyntaxError(err)) throw err;
    io.err(formatSyntaxError(file, err));
    if (json) printJson(io, { ok: false, error: 'syntax', message: err.message, line: err.line, column: err.column });
    return null;
  }
}

/** 서버가 돌려준 결과를 알린다. 요약 줄은 push에서만 낸다 */
function reportPush(io: CliIo, ref: RoomRef, result: PushResult, options: CliOptions, withSummary: boolean): void {
  const lang = pickLang(options.lang, io.env);
  const url = roomUrl(ref);
  if (options.json) {
    printJson(io, { ...result, issues: withText(result.issues ?? [], lang), url });
    return;
  }
  if (withSummary) io.out(formatSummary(result.summary));
  io.out(url);
  for (const line of reportLines(result.warnings ?? [], result.issues ?? [], lang)) io.out(line);
}

export async function runNew(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  const server = resolveServer(options.server, io.env);
  const file = args[0];
  let text = '';
  if (file !== undefined) {
    const read = await readModel(io, file, options.json);
    if (!read) return 1;
    text = read.text;
    // 제목을 바꿔 보내려면 모델을 고쳐서 다시 글로 적는다
    if (options.title !== undefined) text = printModel({ ...read.model, title: options.title });
  } else if (options.title !== undefined) {
    text = printModel({ title: options.title, entities: [], relationships: [], specializations: [], notes: [] });
  }

  const ref: RoomRef = { server, roomId: io.newRoomId ? io.newRoomId() : newRoomId() };
  const result = await sendModel(io.fetch, ref, text, { file });
  reportPush(io, ref, result, options, false);
  return 0;
}

export async function runPull(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  const ref = parseRoomRef(args[0], resolveServer(options.server, io.env));
  const text = (await fetchModel(io.fetch, ref)).replace(/\n+$/, '');
  if (options.output !== undefined && options.output !== '-') {
    await io.writeText(options.output, `${text}\n`);
    io.err(`wrote ${options.output}`);
  } else {
    io.out(text);
  }
  return 0;
}

export async function runPush(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  const ref = parseRoomRef(args[0], resolveServer(options.server, io.env));
  const file = args[1];
  const read = await readModel(io, file, options.json);
  if (!read) return 1;
  const result = await sendModel(io.fetch, ref, read.text, { relayout: options.relayout, file });
  reportPush(io, ref, result, options, true);
  return 0;
}

export async function runValidate(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  const read = await readModel(io, args[0], options.json);
  if (!read) return 1;
  // 빈 다이어그램에 그려 본 결과를 화면과 같은 규칙으로 검사한다
  const drawn = applyModel(read.model, [], [], '');
  const issues = validateDiagram(drawn.nodes, drawn.edges);
  const failed = issues.some((issue) => issue.severity === 'error');
  const lang = pickLang(options.lang, io.env);
  if (options.json) {
    printJson(io, { ok: !failed, warnings: drawn.warnings, issues: withText(issues, lang) });
  } else {
    const lines = reportLines(drawn.warnings, issues, lang);
    for (const line of lines) io.out(line);
    if (lines.length === 0) io.out('no issues');
  }
  return failed ? 1 : 0;
}

/**
 * 방에 사람들이 적은 관계 모델 글을 낸다. 다이어그램에서 만들어 내지 않으므로 아직 아무도 적지 않았으면 그렇다고 알린다.
 * 'relational push <room> <file|->' 는 파일의 글로 방의 관계 모델 글을 바꾼다.
 * 주고받는 글은 일반 텍스트 교환 표기다: 밑줄(기본키)은 _이름_ 으로 적는다(서버가 toMarkup, fromMarkup으로 바꾼다).
 */
export async function runRelational(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  if (args.length === 3 && args[0] === 'push') return runRelationalPush(io, args[1], args[2], options);
  if (args.length !== 1) throw new CliError(`usage: ${COMMANDS.relational.usage}`, 2);
  const ref = parseRoomRef(args[0], resolveServer(options.server, io.env));
  const { text } = await fetchRelational(io.fetch, ref, 'relational');
  const body = text.replace(/\n+$/, '');
  if (body.trim() === '') {
    io.err(`${roomUrl(ref)} has no relational model yet (people write it in the app, or use "modelll relational push")`);
    return 0;
  }
  io.out(body);
  return 0;
}

async function runRelationalPush(io: CliIo, room: string, file: string, options: CliOptions): Promise<number> {
  const ref = parseRoomRef(room, resolveServer(options.server, io.env));
  const text = (await io.readText(file)).replace(/^\uFEFF/, '');
  // 틀린 글은 보내기 전에 모두 알린다(서버도 같은 검사를 한다). _이름_ 은 밑줄이고, 위치는 파일 기준이다
  const lang = pickLang(options.lang, io.env);
  const { problems } = parseMarkup(text.replace(/\r\n?/g, '\n'));
  const lines = problems.map((p) => `${formatSyntaxError(file, { line: p.line, column: p.column, message: `${p.severity}: ${problemText(p, lang)}` })}`);
  if (problems.some((p) => p.severity === 'error')) {
    for (const line of lines) io.err(line);
    if (options.json) printJson(io, { ok: false, error: 'syntax', problems: problems.map((p) => ({ severity: p.severity, line: p.line, column: p.column, message: problemText(p, lang) })) });
    return 1;
  }
  const result = await sendRelational(io.fetch, ref, text, file);
  if (options.json) {
    printJson(io, { ...result, url: roomUrl(ref) });
    return 0;
  }
  io.out(`${result.changed ? 'Updated the relational model of' : 'No changes to the relational model of'} ${roomUrl(ref)} (${result.tables} table${result.tables === 1 ? '' : 's'})`);
  for (const line of lines) io.out(line);
  return 0;
}

/** 방의 관계 모델 글과 컬럼 설정으로 만든 CREATE TABLE 문을 낸다. 타입을 정하지 않은 컬럼이나 글의 오류가 있으면 표준 오류로도 알린다 */
export async function runSql(io: CliIo, args: string[], options: CliOptions): Promise<number> {
  const ref = parseRoomRef(args[0], resolveServer(options.server, io.env));
  const { text, missingTypes, errors } = await fetchRelational(io.fetch, ref, 'sql', options.dialect);
  io.out(text.replace(/\n+$/, ''));
  if (errors > 0) io.err(`warning: the relational model has ${errors} error${errors === 1 ? '' : 's'}; only the parts that could be read were converted`);
  if (missingTypes > 0) io.err(`warning: ${missingTypes} column${missingTypes === 1 ? ' has' : 's have'} no type; set the types in the app (the SQL marks them and will not run as is)`);
  return 0;
}

export function runSyntax(io: CliIo): number {
  io.out(SYNTAX_TEXT.replace(/\n+$/, ''));
  return 0;
}

/** 읽지 못한 파일을 한 줄로 알릴 수 있게 바꾼다 */
export function fileError(file: string, err: unknown): CliError {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const reason =
    code === 'ENOENT' ? 'no such file' : code === 'EISDIR' ? 'it is a directory' : code === 'EACCES' ? 'permission denied' : (err as Error).message;
  return new CliError(`cannot open ${file}: ${reason}`);
}
