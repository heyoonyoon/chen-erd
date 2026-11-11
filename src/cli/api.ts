/**
 * 서버의 모델 API를 부른다. 실패는 모두 한 줄짜리 CliError로 바꿔 던진다.
 */
import type { Issue } from '../shared/types';
import { CliError } from './errors';
import { formatSyntaxError, httpErrorMessage, type ChangeSummary } from './format';
import type { RoomRef } from './room';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** PUT /api/rooms/:id/model 의 성공 응답 */
export interface PushResult {
  ok: true;
  room: string;
  /** 이 요청으로 방이 새로 생겼는지 */
  created: boolean;
  summary: ChangeSummary;
  warnings: string[];
  issues: Issue[];
}

/** 응답을 이만큼 기다린다 */
const TIMEOUT_MS = 30_000;

function apiUrl(ref: RoomRef, query = ''): string {
  return `${ref.server}/api/rooms/${encodeURIComponent(ref.roomId)}/model${query}`;
}

async function request(fetchImpl: FetchLike, ref: RoomRef, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new CliError(`${ref.server} did not answer within ${TIMEOUT_MS / 1000} seconds`);
    }
    // fetch의 메시지는 'fetch failed'뿐이라 원인(ECONNREFUSED 등)을 붙인다
    const detail = e.cause?.code || e.cause?.message || e.message;
    throw new CliError(`cannot reach ${ref.server} (${detail})`);
  }
}

/** 실패한 응답을 CliError로 바꾼다. file은 문법 오류의 위치를 적을 때 쓴다 */
async function failure(res: Response, ref: RoomRef, file?: string): Promise<CliError> {
  let body: { error?: unknown; message?: unknown; line?: unknown; column?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch {
    // 프록시가 만든 오류 화면처럼 JSON이 아닌 응답은 상태 코드만 본다
  }
  const code = typeof body.error === 'string' ? body.error : '';
  if (code === 'syntax' && typeof body.line === 'number' && typeof body.column === 'number') {
    return new CliError(
      formatSyntaxError(file ?? 'model', { message: String(body.message ?? 'syntax error'), line: body.line, column: body.column }),
    );
  }
  const retryAfter = Number(res.headers.get('retry-after') ?? 0);
  return new CliError(
    httpErrorMessage({
      status: res.status,
      code,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0,
      server: ref.server,
      roomId: ref.roomId,
    }),
  );
}

/** 방의 내용을 모델 텍스트로 받는다 */
export async function fetchModel(fetchImpl: FetchLike, ref: RoomRef): Promise<string> {
  const res = await request(fetchImpl, ref, apiUrl(ref), { method: 'GET' });
  if (!res.ok) throw await failure(res, ref);
  return res.text();
}

/** 모델 텍스트를 보내 방을 그 내용으로 맞춘다. 없는 방이면 서버가 만든다 */
export async function sendModel(
  fetchImpl: FetchLike,
  ref: RoomRef,
  text: string,
  opts: { relayout?: boolean; file?: string } = {},
): Promise<PushResult> {
  const res = await request(fetchImpl, ref, apiUrl(ref, opts.relayout ? '?relayout=1' : ''), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
  if (!res.ok) throw await failure(res, ref, opts.file);
  try {
    return (await res.json()) as PushResult;
  } catch {
    throw new CliError(`${ref.server} sent a reply that is not JSON`);
  }
}
