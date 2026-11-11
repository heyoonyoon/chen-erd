/**
 * 서버의 HTTP API를 부르는 백엔드. 'modelll mcp'(stdio)가 쓴다.
 * 방 인자는 시작할 때 정한 서버의 것만 받는다(다른 서버를 쓰려면 --server로 띄운다).
 */
import { fetchModel, sendModel, type FetchLike } from '../cli/api';
import { CliError } from '../cli/errors';
import { newRoomId, roomUrl, type RoomRef } from '../cli/room';
import { ToolError, resolveRoom, type DiagramBackend, type WriteResult } from './backend';

/** CLI가 한 줄로 알리는 실패를 도구 결과로 알릴 실패로 바꾼다 */
async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CliError) throw new ToolError(err.message);
    throw err;
  }
}

export function createHttpBackend(fetchImpl: FetchLike, server: string, makeRoomId: () => string = newRoomId): DiagramBackend {
  async function write(ref: RoomRef, text: string, relayout: boolean): Promise<WriteResult> {
    const result = await attempt(() => sendModel(fetchImpl, ref, text, { relayout }));
    return { url: roomUrl(ref), summary: result.summary, warnings: result.warnings ?? [], issues: result.issues ?? [] };
  }

  return {
    create: (text) => write({ server, roomId: makeRoomId() }, text, false),

    async read(room) {
      const ref: RoomRef = { server, roomId: resolveRoom(room, server) };
      return { url: roomUrl(ref), text: await attempt(() => fetchModel(fetchImpl, ref)) };
    },

    async update(room, text, { relayout }) {
      const ref: RoomRef = { server, roomId: resolveRoom(room, server) };
      // 모델 API는 없는 방에 쓰면 방을 만든다. 주소를 잘못 적었을 때 엉뚱한 방이 생기지 않도록 먼저 읽어 본다(없으면 여기서 실패한다).
      // GET /api/rooms/<id> 의 exists는 저장하는 짧은 순간에 false가 될 수 있어서 쓰지 않는다
      await attempt(() => fetchModel(fetchImpl, ref));
      return write(ref, text, relayout);
    },
  };
}
