/**
 * MCP 도구가 방을 읽고 쓸 때 거치는 자리. 도구(tools.ts)는 이 인터페이스만 알고,
 * 실제 구현은 서버 안에서 방을 직접 다루는 것 하나다(src/server/mcp.ts, POST /mcp). 테스트에서는 메모리에 둔 가짜로 바꿔 끼운다.
 */
import { CliError } from '../cli/errors';
import type { ChangeSummary } from '../cli/format';
import { parseRoomRef } from '../cli/room';
import type { ColumnSettings, SqlDialect } from '../shared/relational/userSchema';
import type { Issue } from '../shared/types';

/** 도구를 부른 쪽(모델)에게 한 문장으로 알릴 실패. 도구 결과의 isError로 나간다 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** 방을 쓴 결과 */
export interface WriteResult {
  /** 사람이 열어 볼 방 주소 */
  url: string;
  summary: ChangeSummary;
  /** 모델대로 그리지 못한 부분에 대한 설명(영어 문장) */
  warnings: string[];
  /** 쓰고 난 다이어그램을 화면과 같은 규칙으로 검사한 결과 */
  issues: Issue[];
}

/** 실패는 모두 ToolError로 던진다 */
export interface DiagramBackend {
  /** 새 방을 만들어 모델 텍스트를 쓴다 */
  create(text: string): Promise<WriteResult>;
  /** 방의 내용을 모델 텍스트로 준다. room은 방 주소 또는 id */
  read(room: string): Promise<{ url: string; text: string }>;
  /** 이미 있는 방을 모델 텍스트의 내용으로 맞춘다. 없는 방이면 만들지 않고 실패한다 */
  update(room: string, text: string, opts: { relayout: boolean }): Promise<WriteResult>;
  /** 방에서 사람들이 적은 관계 모델 글(없으면 빈 글, 밑줄은 _이름_ 표기로 바꾼 일반 텍스트)과 컬럼 설정을 그대로 준다. 없는 방이면 실패한다 */
  relational(room: string): Promise<{ url: string; title: string; text: string; settings: ColumnSettings; dialect?: SqlDialect | null }>;
}

/**
 * 방 인자(주소 또는 id)에서 방 id를 꺼낸다. 주소라면 이 서버(origin)의 것이어야 한다.
 * 다른 곳의 주소를 받아 주면 모델이 읽은 글에 속아 엉뚱한 서버로 내용을 보내게 만들 수 있다.
 */
export function resolveRoom(room: string, origin: string): string {
  let ref;
  try {
    ref = parseRoomRef(room, origin);
  } catch (err) {
    if (err instanceof CliError) throw new ToolError(err.message);
    throw err;
  }
  // 스킴(http, https)은 프록시 뒤에서 달라질 수 있으니 호스트와 포트만 본다
  if (new URL(ref.server).host !== new URL(origin).host) {
    throw new ToolError(`"${room.trim()}" is on a different server; this MCP server only works with diagrams on ${origin}`);
  }
  return ref.roomId;
}
