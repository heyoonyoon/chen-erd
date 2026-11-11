/**
 * 도구를 MCP 서버에 등록한다. POST /mcp(src/server/mcp.ts)가 요청마다 이 함수로 서버를 새로 만들어 쓰고 버린다.
 */
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { version } from '../../package.json';
import type { DiagramBackend } from './backend';
import { ARGUMENTS, DESCRIPTIONS, SERVER_INSTRUCTIONS, TOOL_NAMES } from './descriptions';
import { createDiagramTools, type ToolHooks } from './tools';

export const MCP_SERVER_NAME = 'modelll';

export function buildMcpServer(backend: DiagramBackend, hooks: ToolHooks = {}): McpServer {
  const tools = createDiagramTools(backend, hooks);
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'modelll', version, websiteUrl: 'https://modelll.app' },
    // 도구 목록은 바뀌지 않는다. 바뀐다고 알리면 클라이언트가 알림을 기다리는 연결을 열어 둔다
    { capabilities: { tools: { listChanged: false } }, instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    TOOL_NAMES.create,
    {
      title: 'Create diagram',
      description: DESCRIPTIONS.create,
      inputSchema: z.object({
        text: z.string().describe(ARGUMENTS.text),
        title: z.string().optional().describe(ARGUMENTS.createTitle),
      }),
      // 방은 주소를 아는 누구나 여는 곳이다(openWorld). 부를 때마다 새 방이 생긴다
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => tools.create(args),
  );

  server.registerTool(
    TOOL_NAMES.read,
    {
      title: 'Read diagram',
      description: DESCRIPTIONS.read,
      inputSchema: z.object({ room: z.string().describe(ARGUMENTS.room) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => tools.read(args),
  );

  server.registerTool(
    TOOL_NAMES.update,
    {
      title: 'Update diagram',
      description: DESCRIPTIONS.update,
      inputSchema: z.object({
        room: z.string().describe(ARGUMENTS.room),
        text: z.string().describe(ARGUMENTS.text),
        relayout: z.boolean().optional().describe(ARGUMENTS.relayout),
      }),
      // 글에 없는 도형은 지워지므로 destructive다. 같은 글을 다시 보내면 바뀌는 것이 없다
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => tools.update(args),
  );

  server.registerTool(
    TOOL_NAMES.validate,
    {
      title: 'Validate diagram text',
      description: DESCRIPTIONS.validate,
      inputSchema: z.object({ text: z.string().describe(ARGUMENTS.text) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => tools.validate(args),
  );

  server.registerTool(
    TOOL_NAMES.syntax,
    {
      title: 'Diagram text format',
      description: DESCRIPTIONS.syntax,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => tools.syntax(),
  );

  return server;
}
