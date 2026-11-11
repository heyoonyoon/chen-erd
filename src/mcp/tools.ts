/**
 * MCP 도구의 동작. 전송 방식과 상관없이 한 번만 적고, 방을 읽고 쓰는 일은 DiagramBackend에 맡긴다.
 * 결과는 모두 사람이 읽을 수 있는 짧은 글이다. 모델이 고칠 수 있는 실패(문법 오류, 없는 방, 요청 제한)는
 * 프로토콜 오류가 아니라 isError가 붙은 도구 결과로 돌려준다.
 */
import { formatSummary, httpErrorMessage, reportLines } from '../cli/format';
import { SYNTAX_TEXT } from '../cli/syntax';
import { applyModel, parseModel, printModel } from '../shared/model';
import type { Model } from '../shared/model/types';
import { validateDiagram } from '../shared/rules';
import { ToolError, type DiagramBackend, type WriteResult } from './backend';
import { TOOL_NAMES } from './descriptions';

/** 모델 텍스트의 최대 크기. 서버의 모델 API가 받는 본문 크기와 같다 */
export const MAX_TEXT_BYTES = 256 * 1024;

export interface ToolResult {
  // SDK의 결과 타입에 그대로 넣을 수 있도록 열어 둔다
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolHooks {
  /** 도구 호출 하나를 받아도 되는지. 되면 0, 아니면 다시 부를 수 있을 때까지 남은 초 */
  limited?(): number;
}

export interface DiagramTools {
  create(args: { text: string; title?: string }): Promise<ToolResult>;
  read(args: { room: string }): Promise<ToolResult>;
  update(args: { room: string; text: string; relayout?: boolean }): Promise<ToolResult>;
  validate(args: { text: string }): Promise<ToolResult>;
  syntax(): Promise<ToolResult>;
}

function ok(lines: string[]): ToolResult {
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function failed(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** 읽지 못한 위치가 담긴 오류인지. 번들이 나뉘어 클래스가 달라져도 알아보도록 이름으로 본다 */
function isSyntaxError(err: unknown): err is Error & { line: number; column: number } {
  return err instanceof Error && err.name === 'ModelSyntaxError';
}

/** 텍스트를 모델로 읽는다. 너무 크거나 문법이 틀렸으면 ToolError. 돌려주는 text는 백엔드에 그대로 넘길 수 있게 다듬은 것이다 */
function readModel(raw: string): { text: string; model: Model } {
  if (new TextEncoder().encode(raw).length > MAX_TEXT_BYTES) {
    throw new ToolError(httpErrorMessage({ status: 413, code: 'body-too-large', retryAfter: 0, server: '', roomId: '' }));
  }
  // 메모장 등이 맨 앞에 붙이는 BOM은 뗀다
  const text = raw.replace(/^\uFEFF/, '');
  try {
    return { text, model: parseModel(text) };
  } catch (err) {
    if (!isSyntaxError(err)) throw err;
    throw new ToolError(
      `${err.line}:${err.column}: ${err.message}\nSyntax error at line ${err.line}, column ${err.column}; nothing was saved. Fix the text and call the tool again (${TOOL_NAMES.syntax} returns the full format).`,
    );
  }
}

/** 경고와 검증 결과를 줄 목록으로. 하나도 없으면 'no issues' */
function findings(warnings: readonly string[], issues: WriteResult['issues']): string[] {
  const lines = reportLines(warnings, issues, 'en');
  return lines.length > 0 ? lines : ['no issues'];
}

function written(verb: string, result: WriteResult): ToolResult {
  return ok([`${verb} ${result.url} (${formatSummary(result.summary)})`, ...findings(result.warnings, result.issues)]);
}

export function createDiagramTools(backend: DiagramBackend, hooks: ToolHooks = {}): DiagramTools {
  /** 요청 제한을 확인하고 도구를 실행한다. 알려 줄 수 있는 실패는 isError 결과로 바꾼다 */
  async function run(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
    const wait = hooks.limited?.() ?? 0;
    if (wait > 0) return failed(httpErrorMessage({ status: 429, code: 'rate', retryAfter: wait, server: '', roomId: '' }));
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ToolError) return failed(err.message);
      throw err;
    }
  }

  return {
    create: ({ text, title }) =>
      run(async () => {
        const read = readModel(text);
        // 제목을 따로 받았으면 모델을 고쳐서 다시 글로 적는다
        const body = title !== undefined ? printModel({ ...read.model, title }) : read.text;
        return written('Created', await backend.create(body));
      }),

    read: ({ room }) =>
      run(async () => {
        const { url, text } = await backend.read(room);
        const body = text.replace(/\n+$/, '');
        // 빈 글을 그대로 주면 실패한 것처럼 보인다. 주석 한 줄은 다시 보내도 문법에 맞다
        return ok([body === '' ? `# ${url} is an empty diagram` : body]);
      }),

    update: ({ room, text, relayout }) =>
      run(async () => {
        const read = readModel(text);
        return written('Updated', await backend.update(room, read.text, { relayout: relayout === true }));
      }),

    validate: ({ text }) =>
      run(() => {
        // 빈 다이어그램에 그려 본 결과를 화면과 같은 규칙으로 검사한다
        const drawn = applyModel(readModel(text).model, [], [], '');
        return ok(findings(drawn.warnings, validateDiagram(drawn.nodes, drawn.edges)));
      }),

    syntax: () => run(() => ok([SYNTAX_TEXT.replace(/\n+$/, '')])),
  };
}
