/**
 * MCP 엔드포인트(POST /mcp). AI 도구가 다이어그램을 만들고 읽고 고치는 데 쓴다. [담당: server 에이전트]
 * 도구는 src/mcp 에 한 번만 적혀 있고, 여기서는 그 도구가 방을 직접 다루도록(HTTP로 돌아 들어오지 않고) 이어 준다.
 *
 * - Streamable HTTP, 세션이 없다. 요청마다 서버 객체를 새로 만들어 답하고 버린다.
 *   2026-07-28 규격(요청마다 버전을 싣는다)과 그 전 규격(initialize로 시작한다)을 SDK가 함께 받아 준다.
 * - 인증이 없다. 401로 답하는 일이 없어야 클라이언트가 OAuth를 시도하지 않는다.
 * - 쿠키나 자격 증명을 쓰지 않으므로 어느 출처에서든 부를 수 있게 CORS를 연다(/mcp에만).
 * - 호스팅된 클라이언트(claude.ai 등)는 몇 개의 주소를 여럿이 함께 쓴다. 그래서 모델 API와 다른, 넉넉한 요청 제한을 따로 둔다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { TLSSocket } from 'node:tls';
import { createMcpHandler } from '@modelcontextprotocol/server';
import express, { type Express, type NextFunction, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { httpErrorMessage } from '../cli/format';
import { newRoomId } from '../cli/room';
import { ToolError, resolveRoom, type DiagramBackend, type WriteResult } from '../mcp/backend';
import { buildMcpServer } from '../mcp/server';
import { diagramToText, parseModel } from '../shared/model';
import type { Model } from '../shared/model/types';
import { getEdges, getNodes, getTitle } from '../shared/ydoc';
import { clientIp, isPrivateAddress } from './limits';
import { MAX_MODEL_BYTES, MAX_NODES, modelNodeCount, writeModel, type WithDoc } from './model';
import { RoomUnavailableError } from './sync';

export interface McpDeps {
  /** 메모리에도 디스크에도 없는 방인지 */
  isNewRoom(roomId: string): Promise<boolean>;
  withDoc: WithDoc;
  /** MCP 요청 하나를 센다. 받아도 되면 0, 아니면 다시 보낼 수 있을 때까지 남은 초 */
  takeMcpRequest(ip: string): number;
  /** MCP로 새 방을 만드는 것을 하나 센다. 만들어도 되면 0, 아니면 남은 초 */
  takeMcpRoomCreate(ip: string): number;
  /** 밖에서 보이는 주소(https://modelll.app). 돌려주는 방 주소에 쓴다. 없으면 요청의 Host에서 알아낸다 */
  publicUrl?: string;
  /** 서버 로그에 한 줄을 남긴다 */
  log?(message: string): void;
}

/**
 * 요청 본문의 최대 크기. 모델 텍스트는 JSON 문자열로 실려 오면서 줄바꿈과 따옴표가 두 글자로 늘어나므로
 * 텍스트 제한(256 KB)의 두 배에 봉투 몫을 더한다. 텍스트 자체의 크기는 도구가 다시 확인한다.
 */
const MAX_MCP_BODY_BYTES = 2 * MAX_MODEL_BYTES + 16 * 1024;

/** 미리 묻는 요청(preflight)이 헤더를 적지 않았을 때 허용한다고 답할 헤더 */
const CORS_HEADERS = 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID';

/** 요청 하나를 처리하는 동안 도구가 알아야 하는 것 */
interface McpCall {
  ip: string;
  /** 돌려줄 방 주소의 앞부분 */
  origin: string;
  /** 요청 제한에 걸렸으면 다시 보낼 수 있을 때까지 남은 초. 아니면 0 */
  wait: number;
  /** SDK가 알려 준 마지막 오류. 500으로 답했을 때 로그에 남긴다 */
  error?: string;
}

function rpcError(code: number, message: string, id: string | number | null = null) {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

function seconds(n: number): string {
  return `${n} second${n === 1 ? '' : 's'}`;
}

function lastOf(header: string | string[] | undefined): string {
  const joined = Array.isArray(header) ? header.join(',') : (header ?? '');
  return joined.split(',').pop()?.trim() ?? '';
}

/**
 * 밖에서 보이는 주소(origin). 설정값이 있으면 그것을 쓰고, 없으면 요청의 Host에 스킴을 붙인다.
 * X-Forwarded-Proto는 사설망에서 온 요청(같은 서버의 프록시)일 때만 믿는다(clientIp와 같은 규칙).
 */
export function publicOrigin(req: IncomingMessage, configured?: string): string {
  if (configured) return configured;
  let proto = (req.socket as Partial<TLSSocket>).encrypted ? 'https' : 'http';
  const forwarded = lastOf(req.headers['x-forwarded-proto']).toLowerCase();
  if ((forwarded === 'http' || forwarded === 'https') && isPrivateAddress(req.socket.remoteAddress ?? '')) proto = forwarded;
  const host = req.headers.host ?? '';
  // Host는 보낸 쪽이 마음대로 적을 수 있다. 이름과 포트로만 된 값일 때만 쓴다
  if (/^([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$/i.test(host)) {
    try {
      return new URL(`${proto}://${host}`).origin;
    } catch {
      // 아래의 기본값을 쓴다
    }
  }
  return `http://localhost:${req.socket.localPort ?? 80}`;
}

/** 본문이 도구 호출인지와 그 요청 id. 읽을 수 없으면 도구 호출이 아닌 것으로 본다 */
function peek(raw: Buffer): { toolCall: boolean; id: string | number | null } {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const { method, id } = value as { method?: unknown; id?: unknown };
      return { toolCall: method === 'tools/call', id: typeof id === 'string' || typeof id === 'number' ? id : null };
    }
  } catch {
    // JSON이 아니면 SDK가 오류로 답한다
  }
  return { toolCall: false, id: null };
}

/** 서버 안에서 방을 직접 다루는 백엔드. 요청 하나에 하나씩 만든다 */
function hubBackend(deps: McpDeps, call: McpCall): DiagramBackend {
  const refusal = (code: string, roomId = '') => new ToolError(httpErrorMessage({ status: 0, code, retryAfter: 0, server: call.origin, roomId }));

  /** 종료 중이거나 방을 읽지 못한 경우를 알릴 수 있는 실패로 바꾼다 */
  async function attempt<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RoomUnavailableError) throw refusal('unavailable');
      throw err;
    }
  }

  function parse(text: string): Model {
    const model = parseModel(text);
    if (modelNodeCount(model) > MAX_NODES) throw refusal('too-large');
    return model;
  }

  async function write(roomId: string, model: Model, opts: { relayout: boolean; created: boolean }): Promise<WriteResult> {
    const outcome = await writeModel(deps.withDoc, roomId, model, opts);
    if (!outcome) throw refusal('too-large');
    return { url: `${call.origin}/r/${roomId}`, ...outcome };
  }

  /** 방 인자를 이미 있는 방의 id로 푼다. 읽기나 고치기로 방이 생기면 안 된다 */
  async function existing(room: string): Promise<string> {
    const roomId = resolveRoom(room, call.origin);
    if (await deps.isNewRoom(roomId)) throw refusal('not-found', roomId);
    return roomId;
  }

  return {
    create: (text) =>
      attempt(async () => {
        const model = parse(text);
        const wait = deps.takeMcpRoomCreate(call.ip);
        if (wait > 0) throw new ToolError(`too many new diagrams from this address; try again in ${seconds(wait)}`);
        let roomId = newRoomId();
        // id가 겹칠 일은 사실상 없지만, 겹쳤을 때 남의 방을 덮어쓰면 안 된다
        for (let i = 0; i < 4 && !(await deps.isNewRoom(roomId)); i++) roomId = newRoomId();
        if (!(await deps.isNewRoom(roomId))) throw refusal('unavailable');
        return write(roomId, model, { relayout: false, created: true });
      }),

    read: (room) =>
      attempt(async () => {
        const roomId = await existing(room);
        const text = await deps.withDoc(roomId, (doc) => diagramToText(getNodes(doc), getEdges(doc), getTitle(doc) || undefined));
        return { url: `${call.origin}/r/${roomId}`, text };
      }),

    update: (room, text, { relayout }) =>
      attempt(async () => {
        const model = parse(text);
        return write(await existing(room), model, { relayout, created: false });
      }),
  };
}

/** express의 요청을 SDK가 받는 웹 표준 Request로 옮긴다 */
function toWebRequest(req: ExpressRequest, origin: string, body: Buffer, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // 본문을 이미 다 읽어 풀었으므로 길이와 인코딩에 관한 헤더는 맞지 않는다
    if (value === undefined || ['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name)) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return new Request(`${origin}/mcp`, { method: 'POST', headers, body: new Uint8Array(body), signal });
}

export function mountMcp(app: Express, deps: McpDeps): void {
  const configured = deps.publicUrl ? new URL(deps.publicUrl).origin : undefined;
  // 도구가 요청을 보낸 주소와 돌려줄 방 주소를 알 수 있도록 요청별 값을 비동기 흐름에 실어 둔다
  const calls = new AsyncLocalStorage<McpCall>();

  const handler = createMcpHandler(
    () => {
      const call = calls.getStore();
      if (!call) throw new Error('mcp request context is missing');
      return buildMcpServer(hubBackend(deps, call), { limited: () => call.wait });
    },
    {
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
      onerror: (error) => {
        const call = calls.getStore();
        if (call) call.error = error.message;
      },
    },
  );

  app.use('/mcp', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.options('/mcp', (req, res) => {
    const requested = String(req.headers['access-control-request-headers'] ?? '');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    // 규격이 바뀌며 헤더가 늘어도 막히지 않도록, 묻는 헤더를 그대로 허용한다(자격 증명을 쓰지 않으니 안전하다)
    res.setHeader('Access-Control-Allow-Headers', /^[\w\-, ]+$/.test(requested) ? requested : CORS_HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Access-Control-Request-Headers');
    res.status(204).end();
  });

  // 본문은 바이트로 받아 SDK에 그대로 넘긴다(Content-Type 확인과 JSON 풀이는 SDK가 한다)
  const readBody = express.raw({ type: () => true, limit: MAX_MCP_BODY_BYTES });

  app.post('/mcp', readBody, async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const ip = clientIp(req);
    const call: McpCall = { ip, origin: publicOrigin(req, configured), wait: deps.takeMcpRequest(ip) };
    if (call.wait > 0) {
      const { toolCall, id } = peek(body);
      // 도구 호출은 모델이 읽고 기다릴 수 있도록 도구 결과로 알린다(아래에서 도구가 답한다). 나머지는 429로 돌려보낸다
      if (!toolCall) {
        res.setHeader('Retry-After', String(call.wait));
        res.status(429).json(rpcError(-32000, `Too many requests from this address; try again in ${seconds(call.wait)}`, id));
        return;
      }
    }

    // 클라이언트가 응답을 다 받기 전에 끊으면 SDK에 취소로 알린다
    const aborter = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) aborter.abort();
    });

    const response = await calls.run(call, () => handler.fetch(toWebRequest(req, call.origin, body, aborter.signal)));
    if (response.status >= 500) deps.log?.(`mcp request failed status=${response.status}${call.error ? ` error=${call.error}` : ''}`);
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (!response.body) {
      res.end();
      return;
    }
    // 예전 규격의 클라이언트에는 SDK가 SSE로 답하므로 버퍼에 모으지 않고 흘려보낸다
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
      .on('error', () => res.destroy())
      .pipe(res);
  });

  // 세션이 없어 GET(알림 스트림)과 DELETE(세션 끝내기)가 할 일이 없다. SPA 화면이 대신 나가서도 안 된다
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json(rpcError(-32000, 'Method not allowed.'));
  });

  app.use('/mcp', (err: unknown, _req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if ((err as { type?: string } | null)?.type === 'entity.too.large') {
      res.status(413).json(rpcError(-32000, `Request body too large (the limit is ${MAX_MCP_BODY_BYTES / 1024} KB)`));
      return;
    }
    deps.log?.(`mcp request failed: ${(err as Error)?.message ?? String(err)}`);
    res.status(500).json(rpcError(-32603, 'Internal server error'));
  });

  app.use('/mcp', (_req, res) => {
    res.status(404).json(rpcError(-32000, 'Not found. The MCP endpoint is POST /mcp'));
  });
}
